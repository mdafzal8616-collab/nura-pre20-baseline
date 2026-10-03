/* NURA AI boundary: layer routing, tier budgets, timeout + fallback.
 *
 * There is NO model behind NURA today. This file is the gate a future one must pass through, so that adding AI
 * cannot freeze Today, cost more than its tier allows, or run when it has been switched off.
 *
 *   DETERMINISTIC CODE -> RULES -> LOCAL STATS -> SIMPLE AI -> COMPLEX AI -> MULTI-AGENT
 *
 * Always the cheapest layer that can answer correctly. A deterministic function must never be replaced by an AI call.
 */
(function (root) {
  "use strict";

  var Plat = root.NuraPlatform || (typeof require !== "undefined" ? require("./platform.js") : null);

  var LAYERS = ["deterministic", "rules", "local_stats", "simple_ai", "complex_ai", "multi_agent"];
  // What each kind of need is allowed to cost. Salah, timers, percentages, deadlines and averages are L0-L2, always.
  var NEED_LAYER = { salah_time: "deterministic", timer: "deterministic", percentage: "deterministic", deadline: "deterministic", streak_math: "deterministic",
    capacity_average: "local_stats", next_action: "rules", pattern_hint: "local_stats", free_text_understanding: "simple_ai", open_reasoning: "complex_ai", multi_step_planning: "multi_agent" };
  function chooseLayer(need) { return NEED_LAYER[need] || "rules"; }
  function isAI(layer) { return layer === "simple_ai" || layer === "complex_ai" || layer === "multi_agent"; }

  // Per-tier budgets. Numbers are placeholders for the control room to tune; the shape is what matters.
  var TIERS = {
    FREE:     { modelCallsPerDay: 5,   maxFanOut: 1, maxContextTokens: 1500, timeoutMs: 6000,  maxRetries: 0, fallbackModel: "none",  expensiveTools: false },
    GOLD:     { modelCallsPerDay: 40,  maxFanOut: 2, maxContextTokens: 4000, timeoutMs: 10000, maxRetries: 1, fallbackModel: "small", expensiveTools: false },
    PLATINUM: { modelCallsPerDay: 150, maxFanOut: 4, maxContextTokens: 8000, timeoutMs: 15000, maxRetries: 1, fallbackModel: "small", expensiveTools: true }
  };

  function makeBudget(tier, usage) { // usage: {date, calls} mutable object owned by the caller
    var t = TIERS[tier] || TIERS.FREE;
    return {
      tier: TIERS[tier] ? tier : "FREE", limits: t,
      canCall: function (today, wantFanOut, contextTokens) {
        if (!usage || usage.date !== today) { if (usage) { usage.date = today; usage.calls = 0; } }
        var calls = usage ? usage.calls : 0;
        if (calls >= t.modelCallsPerDay) return { ok: false, reason: "daily_calls_spent" };
        if ((wantFanOut || 1) > t.maxFanOut) return { ok: false, reason: "fan_out_too_wide" };
        if ((contextTokens || 0) > t.maxContextTokens) return { ok: false, reason: "context_too_large" };
        return { ok: true, reason: "within_budget" };
      },
      record: function (today) { if (!usage) return; if (usage.date !== today) { usage.date = today; usage.calls = 0; } usage.calls++; }
    };
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var done = false, to = setTimeout(function () { if (!done) { done = true; reject(Plat.makeError(Plat.ERR.AI_TIMEOUT, "timeout after " + ms + "ms")); } }, ms);
      Promise.resolve(promise).then(function (v) { if (!done) { done = true; clearTimeout(to); resolve(v); } }, function (e) { if (!done) { done = true; clearTimeout(to); reject(e); } });
    });
  }

  /**
   * ask({need, run, fallback, flags, budget, today, timeoutMs, retries, safeToRetry, trace, fanOut, contextTokens})
   * Never rejects and never hangs: always resolves {source:'ai'|'fallback', value, reason, cls?, user?}.
   * `fallback` is a synchronous deterministic function; it is what Today actually relies on.
   */
  function ask(o) {
    var layer = chooseLayer(o.need), flags = o.flags, budget = o.budget;
    function fb(reason, err) {
      var rep = err ? Plat.report(err, { where: "ai" }) : null;
      if (o.trace) o.trace.step("fallback", { ok: true, who: reason });
      var v; try { v = o.fallback ? o.fallback() : null; } catch (e) { v = null; }
      return { source: "fallback", value: v, reason: reason, layer: layer, cls: rep ? rep.cls : undefined, user: rep ? rep.user : undefined };
    }
    if (!isAI(layer)) { try { return Promise.resolve({ source: "fallback", value: o.fallback ? o.fallback() : null, reason: "deterministic_layer", layer: layer }); } catch (e) { return Promise.resolve(fb("deterministic_failed", e)); } }
    if (!flags || !flags.isOn("cloud_ai")) return Promise.resolve(fb("kill_switch_or_default_off"));
    if (typeof o.run !== "function") return Promise.resolve(fb("no_provider"));
    var b = budget ? budget.canCall(o.today, o.fanOut, o.contextTokens) : { ok: true };
    if (!b.ok) return Promise.resolve(fb(b.reason));
    var limits = budget ? budget.limits : TIERS.FREE;
    var timeoutMs = o.timeoutMs || limits.timeoutMs, retries = o.safeToRetry ? Math.min(o.retries === undefined ? limits.maxRetries : o.retries, limits.maxRetries) : 0;
    var attempt = 0;
    function once() {
      attempt++;
      if (budget) budget.record(o.today);
      if (o.trace) o.trace.step("model_call", { ok: true, who: o.need });
      return withTimeout(o.run(), timeoutMs).then(function (v) {
        if (o.trace) o.trace.step("result", { ok: true });
        return { source: "ai", value: v, reason: "ok", layer: layer };
      }, function (e) {
        if (attempt <= retries) return once();
        if (o.trace) o.trace.step("result", { ok: false, err: Plat.classify(e) });
        return fb("ai_failed", e);
      });
    }
    return once();
  }

  var api = { LAYERS: LAYERS, chooseLayer: chooseLayer, isAI: isAI, TIERS: TIERS, makeBudget: makeBudget, ask: ask, withTimeout: withTimeout };
  root.NuraAI = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
