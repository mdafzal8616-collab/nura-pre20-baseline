/* NURA work sessions + Salah transition.
 *
 * A session never stores "seconds left"; it stores timestamps (runStartMs + accumulated ms). That is what
 * makes it survive the app being closed, killed or the phone restarting: elapsed time is always recomputed
 * from the clock. Wrapping for Salah pauses the session and remembers exactly where the work stopped, so
 * "Continue Physics from Q3?" is a fact, not a guess.
 *
 *   WORK -> WRAP -> PREPARE -> SALAH -> RESUME
 *
 * Pure functions on plain objects (JSON-serialisable).
 */
(function (root) {
  "use strict";

  var HOUR = 3600000;

  function uid(prefix) { return prefix + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 46656).toString(36); }

  /** start(task, plan:{mode,units,minutes,startUnit}, nowMs, ctxId) */
  function start(task, plan, nowMs, ctxId, extra) {
    var s = {
      id: uid("ses"), taskId: task.id, key: task.key, area: task.area, title: task.title, sub: task.sub || "", unitType: task.unitType,
      startUnit: plan.startUnit || 1, plannedUnits: plan.units || null, plannedMin: plan.minutes || null, mode: plan.mode || "timebox",
      unitsDone: 0, accMs: 0, runStartMs: nowMs, running: true, status: "active", ctx: ctxId || null,
      predictedMin: plan.minutes || null, predictedUnits: plan.units || null, startedAt: new Date(nowMs).toISOString()
    };
    if (extra) Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
    return s;
  }
  function elapsedMs(s, nowMs) { return s.accMs + (s.running && s.runStartMs ? Math.max(0, nowMs - s.runStartMs) : 0); }
  function elapsedMin(s, nowMs) { return elapsedMs(s, nowMs) / 60000; }

  function pause(s, nowMs) {
    if (!s.running) return s;
    s.accMs = elapsedMs(s, nowMs); s.runStartMs = null; s.running = false; s.status = "paused";
    return s;
  }
  function resume(s, nowMs) {
    if (s.running) return s;
    s.runStartMs = nowMs; s.running = true; s.status = "active";
    return s;
  }
  function setUnits(s, n) { s.unitsDone = Math.max(0, Math.floor(Number(n) || 0)); return s; }
  function nextUnit(s) { return (s.startUnit || 1) + (s.unitsDone || 0); }

  /**
   * wrap(s, nowMs, atMs): pause for Salah. atMs (optional) = the moment time should stop counting, e.g. the prayer time
   * when the app was closed through it.
   */
  function wrap(s, nowMs, atMs) {
    var stopAt = atMs !== undefined && atMs !== null ? Math.min(nowMs, atMs) : nowMs;
    pause(s, stopAt);
    s.status = "wrapped";
    return s;
  }

  /** Session needs to be wrapped now because the prayer time has arrived while it was still running. */
  function needsAutoWrap(s, prayerAtMs, nowMs) { return !!(s && s.running && prayerAtMs !== null && nowMs >= prayerAtMs); }

  /** A "running" session nobody touched for many hours: the time can't be trusted, so it must not teach pace. */
  function isStale(s, nowMs) {
    if (!s || !s.running || !s.runStartMs) return false;
    var limit = Math.max(3 * HOUR, (s.plannedMin || 30) * 60000 * 3);
    return nowMs - s.runStartMs > limit;
  }

  /**
   * finish(s, nowMs, outcome, opts) -> a log entry for the capacity model.
   * outcome: 'completed' | 'wrapped' | 'abandoned'. Only real, plausible sessions teach pace (amount>0, minutes>=3).
   */
  function finish(s, nowMs, outcome, opts) {
    opts = opts || {};
    var minutes = Math.round(elapsedMs(s, nowMs) / 60000);
    var d = new Date(nowMs);
    var hour = d.getHours();
    return {
      id: s.id, taskId: s.taskId, key: s.key, area: s.area, title: s.title, sub: s.sub, unitType: s.unitType,
      amount: s.unitsDone || 0, minutes: minutes, hour: hour, dow: d.getDay(), date: dateKey(d), tod: bucket(hour),
      outcome: outcome, difficulty: opts.difficulty || null, ctx: s.ctx || null,
      predictedMin: s.predictedMin, predictedUnits: s.predictedUnits, startUnit: s.startUnit, ts: d.toISOString()
    };
  }

  function dateKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function bucket(h) { return h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : h >= 17 && h < 21 ? "evening" : "night"; }

  /**
   * Transition (stored beside the session): {id, prayer, prayerAtMin, date, taskId, sessionId, resumeUnit, doneUnits, title, sub, prayedAtMin|null}
   * phase is derived from the clock, never stored, so it can't go stale.
   */
  function makeTransition(s, prayer, prayerAtMin, dateKeyStr) {
    return { id: uid("trn"), prayer: prayer, prayerAtMin: prayerAtMin, date: dateKeyStr, taskId: s.taskId, sessionId: s.id,
      resumeUnit: nextUnit(s), doneUnits: s.unitsDone || 0, title: s.title, sub: s.sub || "", unitType: s.unitType, prayedAtMin: null };
  }
  function transitionPhase(tr, nowMin, salahMin) {
    if (!tr) return null;
    if (tr.prayedAtMin !== null && tr.prayedAtMin !== undefined) return "resume";
    if (nowMin < tr.prayerAtMin) return "prepare";
    if (nowMin < tr.prayerAtMin + (salahMin === undefined ? 15 : salahMin)) return "salah";
    return "resume";
  }

  var api = { start: start, elapsedMs: elapsedMs, elapsedMin: elapsedMin, pause: pause, resume: resume, setUnits: setUnits, nextUnit: nextUnit,
    wrap: wrap, needsAutoWrap: needsAutoWrap, isStale: isStale, finish: finish, makeTransition: makeTransition, transitionPhase: transitionPhase, bucket: bucket, dateKey: dateKey };
  root.NuraSession = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
