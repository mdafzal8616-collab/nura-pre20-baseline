/* NURA Interruption Budget.
 *
 * Before NURA shows anything the user didn't ask for, this answers INTERVENE, WAIT or DO_NOTHING.
 * Silence is a valid and often correct answer: no "Great work!", no "Stay focused!", no filler.
 *
 *   INTERVENE   a hard constraint (Salah, a fixed commitment) or a justified, rate-limited suggestion
 *   WAIT        something is worth saying but not yet (recently dismissed / recently spoke / snoozed)
 *   DO_NOTHING  nothing to say (user is in focus, in a commitment, quiet hours, or it is simply not needed)
 *
 * Pure function of the facts passed in. Reasons are stable keys the UI can show and tests can assert.
 */
(function (root) {
  "use strict";

  var DEFAULTS = {
    minGapMin: 20,            // minimum gap between proactive messages
    maxPer3h: 3,              // never more than this many proactive messages in 3 hours
    maxDismissals1h: 2,       // after this many "Not now" in an hour, stay quiet until something hard happens
    salahQuietMin: 15         // close to Salah, suggestions yield to preparation
  };

  /**
   * evaluate({
   *   urgency: 'hard'|'high'|'normal'|'low',
   *   nowMin, activeSession:{running}|null, inFixedCommitment:boolean, quiet:{startMin,endMin}|null,
   *   salahInMin:number|null, lastInterventionMin:number|null, interventionsLast3h:number,
   *   dismissalsLastHour:number, snoozedUntilMin:number|null, hasSomethingToSay:boolean
   * }, overrides) -> {decision, reasons:[key]}
   */
  function evaluate(f, overrides) {
    var cfg = {}; Object.keys(DEFAULTS).forEach(function (k) { cfg[k] = (overrides && overrides[k] !== undefined) ? overrides[k] : DEFAULTS[k]; });
    var r = [];
    if (f.urgency === "hard") return { decision: "INTERVENE", reasons: ["hard_constraint"] };
    if (f.hasSomethingToSay === false) return { decision: "DO_NOTHING", reasons: ["nothing_to_say"] };
    if (f.activeSession && f.activeSession.running) return { decision: "DO_NOTHING", reasons: ["in_focus"] };
    if (f.inFixedCommitment) return { decision: "DO_NOTHING", reasons: ["in_commitment"] };
    if (f.mode === "pull") {
      // The person opened the app and is looking: rate limits and quiet hours don't apply, but what they told us does.
      if (f.snoozedUntilMin !== null && f.snoozedUntilMin !== undefined && f.nowMin < f.snoozedUntilMin) return { decision: "WAIT", reasons: ["snoozed"] };
      if ((f.dismissalsLastHour || 0) >= cfg.maxDismissals1h && f.urgency !== "high") return { decision: "WAIT", reasons: ["recent_dismissals"] };
      return { decision: "INTERVENE", reasons: ["asked_by_opening"] };
    }
    if (inQuiet(f.nowMin, f.quiet)) return { decision: "DO_NOTHING", reasons: ["quiet_hours"] };
    if (f.salahInMin !== null && f.salahInMin !== undefined && f.salahInMin >= 0 && f.salahInMin <= cfg.salahQuietMin) return { decision: "DO_NOTHING", reasons: ["salah_near"] };
    if (f.snoozedUntilMin !== null && f.snoozedUntilMin !== undefined && f.nowMin < f.snoozedUntilMin) return { decision: "WAIT", reasons: ["snoozed"] };
    if ((f.dismissalsLastHour || 0) >= cfg.maxDismissals1h && f.urgency !== "high") return { decision: "WAIT", reasons: ["recent_dismissals"] };
    if ((f.interventionsLast3h || 0) >= cfg.maxPer3h && f.urgency !== "high") return { decision: "WAIT", reasons: ["budget_spent"] };
    if (f.lastInterventionMin !== null && f.lastInterventionMin !== undefined && f.nowMin - f.lastInterventionMin < cfg.minGapMin && f.urgency !== "high") return { decision: "WAIT", reasons: ["spoke_recently"] };
    r.push("budget_ok");
    return { decision: "INTERVENE", reasons: r };
  }

  function inQuiet(nowMin, q) {
    if (!q || q.startMin === undefined || q.endMin === undefined) return false;
    return q.startMin <= q.endMin ? (nowMin >= q.startMin && nowMin < q.endMin) : (nowMin >= q.startMin || nowMin < q.endMin);
  }

  var api = { evaluate: evaluate, DEFAULTS: DEFAULTS, inQuiet: inQuiet };
  root.NuraInterruption = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
