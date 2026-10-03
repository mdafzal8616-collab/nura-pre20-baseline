/* NURA Personal Capacity Model (V0).
 *
 * Learns how long THIS person actually takes per unit of a task (minutes per question / page / section) from
 * real sessions, conservatively:
 *   - fewer than 2 usable sessions  -> "calibrating": no estimate, never a fake number
 *   - 2-3 sessions                  -> an EARLY estimate shown as a range, confidence LOW
 *   - more consistent sessions      -> MEDIUM, then HIGHER
 * One abnormal session does not move the estimate much (median, outlier trimming). Sessions recorded while a
 * temporary context was active (exam week, travel, Ramadan...) never pollute the baseline.
 * User corrections are applied on top and fade as real sessions arrive.
 *
 * Plain statistics only. No model, no network. Pure functions.
 */
(function (root) {
  "use strict";

  var DAY = 86400000;
  var MARGIN = { low: 0.30, medium: 0.25, higher: 0.15 }; // share of the usable window deliberately left unplanned
  var TIME_BASED = { minutes: 1, finish: 1 };

  function key(task) {
    return String(task.area || "task") + "|" + String(task.title || "").toLowerCase().replace(/\s+/g, " ").trim() + "|" + String(task.unitType || "items");
  }
  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function quantile(a, q) {
    var s = a.slice().sort(function (x, y) { return x - y; });
    if (!s.length) return 0;
    var pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  function mean(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }
  function stdev(a) { var m = mean(a); return Math.sqrt(mean(a.map(function (v) { return (v - m) * (v - m); }))); }

  // Sessions that are good evidence about pace for this task key.
  function usable(sessions, k, o) {
    o = o || {};
    var now = o.nowMs || Date.now(), resetAt = o.resetAt && o.resetAt[k] ? new Date(o.resetAt[k]).getTime() : 0;
    return (sessions || []).filter(function (s) {
      if (s.key !== k || s.outcome === "abandoned" || !(s.amount > 0) || !(s.minutes >= 3)) return false;
      var t = s.ts ? new Date(s.ts).getTime() : now;
      if (resetAt && t <= resetAt) return false; // the user said "wrong" / "forget this"
      return now - t <= 90 * DAY;
    }).sort(function (a, b) { return a.ts < b.ts ? -1 : 1; });
  }

  /**
   * estimate(sessions, key, {ctxId, nowMs, resetAt:{key:iso}}) ->
   *  {key, n, confidence:'none'|'low'|'medium'|'higher', central, lo, hi, usedContext, perSession:[...]}
   * central/lo/hi are minutes per unit, whole-number friendly (the UI rounds; never shows decimals as precision).
   */
  function estimate(sessions, k, o) {
    o = o || {};
    var all = usable(sessions, k, o);
    var ctxId = o.ctxId || null;
    var inCtx = ctxId ? all.filter(function (s) { return s.ctx === ctxId; }) : [];
    var base = all.filter(function (s) { return !s.ctx; });
    var useCtx = inCtx.length >= 2;
    var pool = useCtx ? inCtx : base;
    var vals = pool.slice(-10).map(function (s) { return s.minutes / s.amount; });
    var est = { key: k, n: vals.length, confidence: "none", central: null, lo: null, hi: null, usedContext: useCtx, trimmed: 0 };
    if (vals.length < 2) return est;
    if (vals.length >= 4) { // do not overreact to one abnormal session
      var med = median(vals), kept = vals.filter(function (v) { return v <= med * 2.2 && v >= med / 2.2; });
      est.trimmed = vals.length - kept.length;
      if (kept.length >= 3) vals = kept;
    }
    est.n = vals.length;
    est.central = median(vals);
    if (vals.length <= 3) { est.lo = Math.min.apply(null, vals); est.hi = Math.max.apply(null, vals); }
    else { est.lo = quantile(vals, 0.25); est.hi = quantile(vals, 0.75); } // the real spread of the person's own sessions, no invented margin
    var cv = stdev(vals) / mean(vals);
    est.cv = cv;
    est.confidence = vals.length <= 3 ? "low" : vals.length <= 6 ? (cv < 0.5 ? "medium" : "low") : (cv < 0.3 ? "higher" : "medium");
    return est;
  }

  /** Corrections the user made ("this target isn't realistic"). Today-only ones expire; lasting ones fade with real sessions. */
  function correctionFactor(corrections, k, todayKey, usableNow) {
    var f = 1;
    (corrections || []).forEach(function (c) {
      if (c.key !== k) return;
      if (c.scope === "today") { if (c.date === todayKey) f *= c.factor; return; }
      var newer = Math.max(0, (usableNow || 0) - (c.nAtCreate || 0));
      f *= 1 + (c.factor - 1) * Math.pow(0.5, newer);
    });
    return f;
  }

  /**
   * size(est, p) -> what is realistic in the usable window.
   *  p: {usableMin, remainingUnits, todayCap, unitType, factor, typicalBlockMin, extraMargin, scale}
   * Returns {mode:'units'|'timebox'|'none', units, minutes, theoreticalMax, margin, calibrating, pace}
   */
  function size(est, p) {
    var usableMin = Math.max(0, p.usableMin * (p.scale || 1));
    var res = { mode: "none", units: null, minutes: 0, theoreticalMax: null, margin: null, calibrating: false, pace: null };
    if (usableMin < 10) return res;
    var floor5 = function (m) { return Math.floor(m / 5) * 5; };
    var ceil5 = function (m) { return Math.ceil(m / 5) * 5; };

    if (TIME_BASED[p.unitType]) { // no units to count: a focus block sized from the person's usual block
      var m0 = floor5(Math.min(p.typicalBlockMin || 25, usableMin * 0.75));
      if (m0 < 10) return res;
      res.mode = "timebox"; res.minutes = m0; res.margin = 0.25; res.calibrating = false; // nothing to calibrate: there are no units whose pace could be learned
      return res;
    }
    if (!est || est.confidence === "none" || !est.central) { // calibration: ask for a short session and LEARN, no fake estimate
      var m = floor5(Math.min(20, usableMin * 0.75) / Math.max(1, p.factor || 1)); // "harder today / low energy" shortens the first try too
      if (m < 10) m = usableMin >= 10 ? 10 : 0;
      if (m < 10) return res;
      res.mode = "timebox"; res.minutes = m; res.calibrating = true;
      return res;
    }
    var margin = (MARGIN[est.confidence] || 0.30) + (p.extraMargin || 0);
    var pace = est.central * (p.factor || 1);
    res.pace = pace; res.margin = margin;
    res.theoreticalMax = Math.floor(usableMin / pace);
    var units = Math.floor(usableMin * (1 - margin) / pace);
    var cap = Math.min(p.remainingUnits === undefined ? Infinity : p.remainingUnits, p.todayCap === undefined ? Infinity : p.todayCap);
    units = Math.min(units, cap);
    if (units >= 1) { res.mode = "units"; res.units = units; res.minutes = ceil5(units * pace); return res; }
    var budget = floor5(usableMin * (1 - margin)); // not even one unit fits: a time-boxed attempt instead
    if (budget >= 10 && cap >= 1) { res.mode = "timebox"; res.minutes = Math.min(budget, 30); }
    return res;
  }

  /** Human-safe numbers: whole minutes, a range, never false precision. */
  function display(est, factor) {
    if (!est || est.confidence === "none") return null;
    var f = factor || 1, lo = Math.round(est.lo * f), hi = Math.round(est.hi * f);
    if (hi - lo <= 1 && est.cv < 0.12) return { lo: Math.round(est.central * f), hi: Math.round(est.central * f), exact: true };
    return { lo: lo, hi: hi, exact: lo === hi };
  }

  var api = { key: key, estimate: estimate, usable: usable, size: size, correctionFactor: correctionFactor, display: display, MARGIN: MARGIN, TIME_BASED: TIME_BASED };
  root.NuraCapacity = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
