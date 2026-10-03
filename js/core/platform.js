/* NURA platform basics: Brain version, error classes, feature flags / kill switches, environment, analytics, traces.
 *
 * Each exists because Sprint 1 needs it now or because skipping it would force an expensive rewrite later.
 * No secrets live here. Flags/environment are plain data a future control room can replace.
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- version
  // Every recommendation and event records which Brain produced it, so a quality drop can be tied to a version.
  var BRAIN_VERSION = "0.1.0";

  // ---------------------------------------------------------------- environment discipline
  // development -> staging -> production. Production must never act like a sandbox: destructive dev tools are off,
  // and schema changes only go through versioned migrations (see data/repo.js).
  var ENV = { name: "development", allowDevTools: true, schemaChangesViaMigrationsOnly: true };
  function detectEnv(hostname) {
    var h = String(hostname || "");
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(h) || /\.localhost$/.test(h)) return { name: "development", allowDevTools: true, schemaChangesViaMigrationsOnly: true };
    if (/staging|preview|\.test$/.test(h)) return { name: "staging", allowDevTools: true, schemaChangesViaMigrationsOnly: true };
    return { name: "production", allowDevTools: false, schemaChangesViaMigrationsOnly: true };
  }

  // ---------------------------------------------------------------- error classification
  // Developers get a precise class and a safe detail; users get one simple sentence. Nothing sensitive crosses.
  var ERR = { NETWORK: "NETWORK_ERROR", AI_TIMEOUT: "AI_TIMEOUT", DATABASE: "DATABASE_ERROR", PERMISSION: "PERMISSION_ERROR", SALAH: "SALAH_CONFIG_ERROR",
    TASK: "INVALID_TASK_DATA", AUTH: "AUTH_ERROR", MODEL: "MODEL_ERROR", UNKNOWN: "UNKNOWN_ERROR" };
  var USER_MESSAGE = {
    NETWORK_ERROR: "No connection right now. Everything on this device still works.",
    AI_TIMEOUT: "Advanced reasoning is temporarily unavailable.",
    DATABASE_ERROR: "Couldn't save that on this device. Please try again.",
    PERMISSION_ERROR: "NURA needs your permission for that.",
    SALAH_CONFIG_ERROR: "Prayer times need a location. Check Salah settings.",
    INVALID_TASK_DATA: "Something in that task needs a closer look.",
    AUTH_ERROR: "That isn't available to this account.",
    MODEL_ERROR: "Advanced reasoning is temporarily unavailable.",
    UNKNOWN_ERROR: "Something didn't work. Your data is safe."
  };
  function classify(e) {
    if (e && e.nuraClass && USER_MESSAGE[e.nuraClass]) return e.nuraClass;
    var m = String((e && (e.message || e)) || "").toLowerCase(), n = e && e.name;
    if (n === "QuotaExceededError" || /quota|storage|database|sqlite|indexeddb/.test(m)) return ERR.DATABASE;
    if (/timeout|timed out/.test(m)) return ERR.AI_TIMEOUT;
    if (/network|failed to fetch|offline|err_internet|cors/.test(m)) return ERR.NETWORK;
    if (/permission|denied|notallowed/.test(m)) return ERR.PERMISSION;
    if (/salah|prayer|location|timezone/.test(m)) return ERR.SALAH;
    if (/task|invalid.*(field|data)|validation/.test(m)) return ERR.TASK;
    if (/unauthor|forbidden|auth|401|403/.test(m)) return ERR.AUTH;
    if (/model|completion|llm|rate.?limit/.test(m)) return ERR.MODEL;
    return ERR.UNKNOWN;
  }
  function makeError(cls, detail) { var e = new Error(detail || cls); e.nuraClass = cls; return e; }
  // Redacts anything that could be a secret or personal text before it is kept for developers.
  function safeDetail(e) {
    var s = String((e && e.message) || e || "").slice(0, 160);
    return s.replace(/(sk|key|token|secret|bearer)[-_ :=]*[A-Za-z0-9._\-]{8,}/gi, "$1=[redacted]").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]");
  }
  function report(e, ctx) { // -> {cls, user, dev}. Never includes stacks or raw user content.
    var cls = classify(e);
    return { cls: cls, user: USER_MESSAGE[cls], dev: { cls: cls, where: ctx && ctx.where ? String(ctx.where) : "", detail: safeDetail(e), brain: BRAIN_VERSION } };
  }

  // ---------------------------------------------------------------- feature flags / kill switches
  // Core never depends on an optional feature being on. Each flag has a defined safe fallback so turning it off
  // degrades gracefully instead of breaking Today.
  var FLAG_DEFAULTS = {
    nura_now_advanced: true,   // off -> simple rules: next task by priority, no capacity sizing
    pattern_engine: true,      // off -> no learned beliefs / routine hints
    cloud_ai: false,           // off (and the default): deterministic only
    islamic_ai: false,
    focus_guard: false,
    agents: false,
    experimental: false
  };
  var FALLBACK = { nura_now_advanced: "simple_rules", pattern_engine: "no_learned_patterns", cloud_ai: "deterministic_only", islamic_ai: "stored_sources_only", focus_guard: "none", agents: "single_function", experimental: "off" };
  function makeFlags(overrides) {
    var state = {}; Object.keys(FLAG_DEFAULTS).forEach(function (k) { state[k] = FLAG_DEFAULTS[k]; });
    Object.keys(overrides || {}).forEach(function (k) { if (k in FLAG_DEFAULTS) state[k] = !!overrides[k]; }); // unknown flags are ignored, never trusted
    return {
      isOn: function (k) { return !!state[k]; },
      set: function (k, v) { if (k in FLAG_DEFAULTS) state[k] = !!v; },
      fallbackFor: function (k) { return FALLBACK[k] || "off"; },
      snapshot: function () { var o = {}; Object.keys(state).forEach(function (k) { o[k] = state[k]; }); return o; }
    };
  }

  // ---------------------------------------------------------------- analytics (kept apart from personal raw data)
  // Only event names from this list, and only coarse metadata. Titles, notes and any free text are rejected.
  var EVENTS = ["nura_now_shown", "nura_now_started", "nura_now_changed", "nura_now_dismissed", "why_this_opened", "capacity_corrected",
    "task_started", "task_completed", "task_abandoned", "salah_transition_triggered", "salah_resume_started", "intervention_suppressed",
    "plan_created", "plan_skipped", "temporary_context_started", "temporary_context_ended", "intervention_sent", "recommendation_accepted", "replan_auto", "replan_proposed", "replan_applied"];
  var META_KEYS = { state: 1, decision: 1, area: 1, mode: 1, units: 1, minutes: 1, predicted_min: 1, actual_min: 1, amount: 1, confidence: 1, reason: 1, prayer: 1, kind: 1, count: 1, alt_count: 1, flag: 1, cls: 1, outcome: 1, brain: 1, source: 1, scope: 1 };
  function cleanMeta(meta) {
    var out = {};
    Object.keys(meta || {}).forEach(function (k) {
      var v = meta[k];
      if (!META_KEYS[k]) return;                       // anything not allowlisted never leaves the caller
      if (typeof v === "number" && isFinite(v)) out[k] = v;
      else if (typeof v === "boolean") out[k] = v;
      else if (typeof v === "string" && /^[a-z0-9_\-:.]{1,32}$/i.test(v)) out[k] = v; // short codes only: free text is rejected
    });
    return out;
  }
  function makeAnalytics(store, now) {
    // store: {read():[], write([])}. Local only; nothing is uploaded.
    return {
      track: function (name, meta) {
        if (EVENTS.indexOf(name) === -1) return false;
        var list = store.read(); if (!Array.isArray(list)) list = [];
        list.push({ e: name, t: (now ? now() : new Date()).toISOString(), v: BRAIN_VERSION, m: cleanMeta(meta) });
        if (list.length > 800) list = list.slice(list.length - 800);
        store.write(list);
        return true;
      },
      list: function () { var l = store.read(); return Array.isArray(l) ? l : []; }
    };
  }

  // ---------------------------------------------------------------- traces (future agents; minimal now)
  // REQUEST -> ROUTER -> AGENT -> CONTEXT -> TOOL -> RESULT -> HANDOFF -> FINAL. Only ids, names and sizes - never raw content.
  function makeTrace(id) {
    var steps = [], t0 = Date.now();
    return {
      id: id || "tr-" + Date.now().toString(36),
      step: function (stage, info) {
        steps.push({ stage: stage, ms: Date.now() - t0, ok: !(info && info.ok === false), who: info && info.who ? String(info.who).slice(0, 40) : "",
          ctx: info && info.ctxFields ? info.ctxFields.slice(0, 12) : undefined, size: info && info.size !== undefined ? info.size : undefined, err: info && info.err ? String(info.err).slice(0, 40) : undefined });
        return this;
      },
      done: function () { return { id: this.id, steps: steps.slice(), failedAt: (steps.filter(function (s) { return !s.ok; })[0] || {}).stage || null }; }
    };
  }

  var api = { BRAIN_VERSION: BRAIN_VERSION, ENV: ENV, detectEnv: detectEnv, ERR: ERR, classify: classify, makeError: makeError, report: report, safeDetail: safeDetail,
    USER_MESSAGE: USER_MESSAGE, FLAG_DEFAULTS: FLAG_DEFAULTS, makeFlags: makeFlags, EVENTS: EVENTS, cleanMeta: cleanMeta, makeAnalytics: makeAnalytics, makeTrace: makeTrace };
  root.NuraPlatform = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
