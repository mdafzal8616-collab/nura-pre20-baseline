/* NURA Brain V0 - the decision engine.
 *
 * Answers one question: "what is the most realistic useful thing to do right now?" and answers it with ONE
 * recommendation, or deliberately with nothing (DO_NOTHING).
 *
 * Lowest reliable intelligence layer, always:
 *   L0 deterministic code (clock, Salah windows, arithmetic)   L1 rules (the decision hierarchy below)
 *   L2 personal statistics (capacity model)                   L3 pattern learning (beliefs, user-correctable)
 * Nothing here calls a language model; nothing here touches the DOM, storage or the network.
 *
 * Decision hierarchy:
 *   1 immediate hard constraint  2 Salah transition / fixed commitment  3 urgent deadline
 *   4 important priority         5 task that fits available capacity   6 optional   7 no intervention
 *
 * The result carries machine-readable messages {k, p} (i18n keys + params) and a `why` list in which every
 * line is traceable to an input that was actually used.
 */
(function (root) {
  "use strict";

  var Cap = root.NuraCapacity || (typeof require !== "undefined" ? require("./capacity.js") : null);
  var Sal = root.NuraSalah || (typeof require !== "undefined" ? require("./salah.js") : null);
  var Int = root.NuraInterruption || (typeof require !== "undefined" ? require("./interruption.js") : null);
  var Ses = root.NuraSession || (typeof require !== "undefined" ? require("./session.js") : null);
  var Plat = root.NuraPlatform || (typeof require !== "undefined" ? require("./platform.js") : null);
  var VERSION = Plat ? Plat.BRAIN_VERSION : "0.1.0";

  var COMMIT_RESERVE = 5; // minutes kept clear before a fixed commitment

  function daysBetween(a, b) { // whole days from date key a to date key b
    var pa = a.split("-"), pb = b.split("-");
    return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 86400000);
  }
  function bucketOf(min) { var h = Math.floor(min / 60); return h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : h >= 17 && h < 21 ? "evening" : "night"; }
  function msg(k, p) { return { k: k, p: p || {} }; }
  function taskKey(t) { return t.key || Cap.key(t); }

  // ---------------------------------------------------------------- temporary contexts
  // A temporary context (exam week, travel, Ramadan, ...) shapes TODAY's recommendations. It never rewrites the
  // long-term baseline: sessions are tagged with its id and kept out of baseline statistics (see capacity.js).
  var CONTEXT_FX = {
    exam: { studyBoost: 20, scale: 1, extraMargin: 0 },
    travel: { scale: 0.7, extraMargin: 0.10 },
    ramadan: { scale: 1, extraMargin: 0 },
    temp_schedule: { scale: 1, extraMargin: 0 },
    work_week: { workBoost: 15, scale: 1, extraMargin: 0 }
  };
  function contextEffects(contexts) {
    var fx = { studyBoost: 0, workBoost: 0, scale: 1, extraMargin: 0, labels: [], ids: [], kinds: [] };
    (contexts || []).forEach(function (c) {
      var e = CONTEXT_FX[c.kind] || {};
      fx.studyBoost += e.studyBoost || 0; fx.workBoost += e.workBoost || 0;
      fx.scale *= e.scale || 1; fx.extraMargin += e.extraMargin || 0;
      fx.labels.push(c.label || c.kind); fx.ids.push(c.id); fx.kinds.push(c.kind);
    });
    return fx;
  }

  // ---------------------------------------------------------------- free time
  // Minutes actually free between now and the end of the day after fixed commitments and Salah (with lead + prayer).
  function freeMinutes(nowMin, dayEndMin, commitments, timings, lead, salahMin) {
    var blocks = [];
    (commitments || []).forEach(function (c) { if (c.blocking !== false && c.endMin > nowMin) blocks.push([Math.max(c.startMin, nowMin), Math.min(c.endMin, dayEndMin)]); });
    if (timings) Sal.PRAYERS.forEach(function (n) {
      var a = timings[n]; if (a === undefined || a === null) return;
      var s = a - lead, e = a + salahMin;
      if (e > nowMin && s < dayEndMin) blocks.push([Math.max(s, nowMin), Math.min(e, dayEndMin)]);
    });
    blocks = blocks.filter(function (b) { return b[1] > b[0]; }).sort(function (x, y) { return x[0] - y[0]; });
    var free = 0, cur = nowMin;
    blocks.forEach(function (b) { if (b[0] > cur) free += Math.min(b[0], dayEndMin) - cur; cur = Math.max(cur, b[1]); });
    if (cur < dayEndMin) free += dayEndMin - cur;
    return Math.max(0, free);
  }

  // What is left of the day vs what today's chosen tasks still need (same numbers the engine and the Today status use).
  function dayLoad(inp) {
    var now = inp.now, lead = inp.salah.leadMin === undefined ? 10 : inp.salah.leadMin, salahMin = inp.salah.salahMin === undefined ? 15 : inp.salah.salahMin;
    var free = freeMinutes(now.min, inp.dayEndMin === undefined ? 1380 : inp.dayEndMin, inp.commitments, inp.salah.timings, lead, salahMin), needed = 0;
    (inp.tasks || []).forEach(function (t) {
      if (!t || t.status !== "active" || !t.planToday) return;
      var k = taskKey(t);
      if (Cap.TIME_BASED[t.unitType]) {
        var didToday = (inp.sessions || []).some(function (s) { return s.taskId === t.id && s.date === now.date && s.minutes >= 10; });
        if (!didToday) needed += 30;
        return;
      }
      var est = Cap.estimate(inp.sessions, k, { nowMs: now.ms, resetAt: inp.resetAt });
      var left = t.todayTarget ? Math.max(0, t.todayTarget - doneTodayFor(inp, t)) : (t.target ? Math.max(0, t.target - (t.done || 0)) : 0);
      needed += left * (est.central || 15);
    });
    return { free: free, needed: Math.round(needed) };
  }

  // ---------------------------------------------------------------- the nearest hard stop
  function hardStop(inp, sal) {
    var now = inp.now.min, lead = inp.salah.leadMin, best = null;
    function offer(kind, name, atMin, reserve) {
      var usable = atMin - now - reserve;
      if (!best || usable < best.usable) best = { kind: kind, name: name, atMin: atMin, inMin: atMin - now, reserve: reserve, usable: usable };
    }
    if (sal && sal.next && !sal.next.tomorrow) offer("salah", sal.next.name, sal.next.at, lead);
    (inp.commitments || []).forEach(function (c) { if (c.blocking !== false && c.startMin > now) offer("commitment", c.title, c.startMin, COMMIT_RESERVE); });
    offer("dayEnd", "", inp.dayEndMin === undefined ? 1380 : inp.dayEndMin, 10);
    return best;
  }

  // ---------------------------------------------------------------- scoring
  function whenDeadline(days) { return days < 0 ? "overdue" : days === 0 ? "today" : days === 1 ? "tomorrow" : "days"; }

  function doneTodayFor(inp, t) {
    var n = 0; (inp.sessions || []).forEach(function (s) { if (s.taskId === t.id && s.date === inp.now.date && s.amount > 0) n += s.amount; });
    return n;
  }
  function lastSessionEndedMinAgo(inp, t) {
    var best = null;
    (inp.sessions || []).forEach(function (s) {
      if (s.taskId !== t.id || s.date !== inp.now.date) return;
      var ageMin = (inp.now.ms - new Date(s.ts).getTime()) / 60000;
      if (best === null || ageMin < best) best = ageMin;
    });
    return best;
  }
  // Kill switches (inp.flags): a switched-off optional feature must degrade to simpler rules, never break Today.
  function patternsOn(inp) { return !(inp.flags && inp.flags.pattern_engine === false); }
  function advancedOn(inp) { return !(inp.flags && inp.flags.nura_now_advanced === false); }
  function beliefList(inp) { return patternsOn(inp) ? (inp.beliefs || []).filter(function (b) { return b.status !== "wrong" && b.status !== "deleted"; }) : []; }

  function scoreTask(inp, t, ctx, ambient) {
    var s = 0, why = [];
    if (t.deadline) {
      var d = daysBetween(inp.now.date, t.deadline);
      var dsc = d < 0 ? 110 : d === 0 ? 100 : d === 1 ? 80 : d <= 3 ? 55 : d <= 7 ? 30 : 10;
      s += dsc; why.push(msg("why.deadline", { when: whenDeadline(d), days: Math.abs(d) }));
    }
    var pr = t.priority || 2;
    if (pr === 3) { s += 30; why.push(msg("why.priority.high")); } else if (pr === 2) s += 15;
    if (t.planToday) { s += 25; why.push(msg("why.planned")); }
    if (t.area === "study" && ctx.studyBoost) { s += ctx.studyBoost; }
    if (t.area === "work" && ctx.workBoost) { s += ctx.workBoost; }
    if (ambient) { if (t.area === ambient.area) { s += 25; why.push(msg("why.inContainer", { name: ambient.title })); } else s -= 25; }
    var ago = lastSessionEndedMinAgo(inp, t);
    if (ago !== null && ago < 60) s -= 20;
    var bk = bucketOf(inp.now.min);
    beliefList(inp).forEach(function (b) {
      var w = b.status === "correct" ? 1 : b.status === "sometimes" ? 0.5 : 0.75;
      if (b.kind === "tod" && b.area === t.area && b.bucket === bk) { s += 8 * w; why.push(msg("why.pattern.tod", { area: t.area, bucket: bk, status: b.status || "new" })); }
      if (b.kind === "routine" && b.area === t.area && b.dow === inp.now.dow && b.bucket === bk) { s += 10 * w; why.push(msg("why.pattern.routine", { area: t.area, bucket: bk, status: b.status || "new" })); }
    });
    return { score: s, why: why };
  }

  // ---------------------------------------------------------------- sizing one candidate
  function sizeFor(inp, t, usable, ctx, extra) {
    var k = taskKey(t);
    if (!advancedOn(inp)) { // simple rules: a plain focus block that fits the window; no personal estimates
      var m = Math.floor(Math.min(25, usable * 0.75) / 5) * 5;
      return { est: { confidence: "none", n: 0 }, factor: 1, remaining: Infinity, done: 0, simple: true,
        sizing: m >= 10 ? { mode: "timebox", units: null, minutes: m, theoreticalMax: null, margin: 0.25, calibrating: false, pace: null } : { mode: "none", units: null, minutes: 0 } };
    }
    var est = Cap.estimate(inp.sessions, k, { ctxId: ctx.ids[0] || null, nowMs: inp.now.ms, resetAt: inp.resetAt });
    var usableN = Cap.usable(inp.sessions, k, { nowMs: inp.now.ms, resetAt: inp.resetAt }).length;
    var factor = Cap.correctionFactor(inp.corrections, k, inp.now.date, usableN);
    // a wrapped (paused for Salah) session hasn't been logged yet, but its work is already done
    var already = (extra && extra.alreadyDone) || 0;
    var done = doneTodayFor(inp, t) + already;
    var remaining = t.target ? Math.max(0, t.target - (t.done || 0) - already) : Infinity;
    var cap = t.todayTarget ? Math.max(0, t.todayTarget - done) : undefined;
    var typical = null;
    if (Cap.TIME_BASED[t.unitType]) {
      var mins = (inp.sessions || []).filter(function (s) { return s.key === k && s.outcome !== "abandoned" && s.minutes >= 10; }).slice(-5).map(function (s) { return s.minutes; });
      if (mins.length >= 2) typical = Math.round(mins.reduce(function (a, b) { return a + b; }, 0) / mins.length);
    }
    var sizing = Cap.size(est, { usableMin: usable, remainingUnits: remaining, todayCap: cap, unitType: t.unitType, factor: factor,
      typicalBlockMin: typical, extraMargin: ((extra && extra.extraMargin) || 0) + ctx.extraMargin + sometimesPaceMargin(inp, k), scale: (extra && extra.scale ? extra.scale : 1) * ctx.scale });
    return { est: est, factor: factor, sizing: sizing, remaining: remaining, done: done };
  }
  function sometimesPaceMargin(inp, k) {
    var extra = 0;
    beliefList(inp).forEach(function (b) { if (b.kind === "pace" && b.key === k && b.status === "sometimes") extra += 0.10; });
    return extra;
  }

  // ---------------------------------------------------------------- the decision
  function decide(inp) {
    var now = inp.now, nowMin = now.min;
    var lead = inp.salah.leadMin === undefined ? 10 : inp.salah.leadMin, salahMin = inp.salah.salahMin === undefined ? 15 : inp.salah.salahMin;
    inp.salah.leadMin = lead; inp.salah.salahMin = salahMin;
    var sal = inp.salah.timings ? Sal.windowInfo(inp.salah.timings, nowMin, lead, salahMin, inp.salah.nextFajrMin) : null;
    var ctx = contextEffects(inp.contexts);
    var base = { noPlan: !(inp.plan && inp.plan.confirmed), contexts: ctx.labels.slice(), why: [], alternatives: [], messages: [], primary: null, routineHint: null, calibration: false, meta: {} };
    function out(o) { var r = { brain: VERSION }; Object.keys(base).forEach(function (k) { r[k] = base[k]; }); Object.keys(o).forEach(function (k) { r[k] = o[k]; }); return r; }
    var itn = inp.interruption || {};
    var ambient = (inp.commitments || []).filter(function (c) { return c.blocking === false && c.container && c.startMin <= nowMin && nowMin < c.endMin; })[0] || null;
    var inBlock = (inp.commitments || []).filter(function (c) { return c.blocking !== false && c.startMin <= nowMin && nowMin < c.endMin; })[0] || null;
    var nextSal = sal && sal.next && !sal.next.tomorrow ? sal.next : null;

    // ---- 1. a wrapped session waiting on Salah (WRAP -> PREPARE -> SALAH -> RESUME)
    var tr = inp.transition && inp.transition.date === now.date ? inp.transition : null;
    if (tr) {
      var phase = Ses.transitionPhase(tr, nowMin, salahMin);
      var unitCt = { unitType: tr.unitType, n: tr.doneUnits };
      if (phase === "prepare") return out({ state: "salah_approaching", decision: "PREPARE", phase: phase, interruption: Int.evaluate({ urgency: "hard" }),
        messages: [msg("salah.prepare", { prayer: tr.prayer, mins: Math.max(0, tr.prayerAtMin - nowMin) }), msg("wrap.saved", unitCt), msg("wrap.resumeFrom", { unitType: tr.unitType, n: tr.resumeUnit })],
        transition: tr, meta: { hardStop: { kind: "salah", name: tr.prayer, inMin: tr.prayerAtMin - nowMin } } });
      if (phase === "salah") return out({ state: "salah_approaching", decision: "SALAH", phase: phase, interruption: Int.evaluate({ urgency: "hard" }),
        messages: [msg("salah.now", { prayer: tr.prayer }), msg("wrap.resumeFrom", { unitType: tr.unitType, n: tr.resumeUnit })], transition: tr, meta: {} });
      // resume
      var rt = (inp.tasks || []).filter(function (t) { return t.id === tr.taskId && t.status === "active"; })[0];
      var hs0 = hardStop(inp, sal), usable0 = hs0.usable;
      if (rt && usable0 >= 10) {
        var sz = sizeFor(inp, rt, usable0, ctx, { alreadyDone: tr.doneUnits || 0 });
        var prim = { taskId: rt.id, area: rt.area, title: rt.title, sub: rt.sub, unitType: rt.unitType, mode: sz.sizing.mode === "none" ? "timebox" : sz.sizing.mode, units: sz.sizing.units, minutes: sz.sizing.minutes || 20, startUnit: tr.resumeUnit, resume: true, calibrating: sz.sizing.calibrating };
        return out({ state: "resume_after_salah", decision: "RESUME", phase: phase, primary: prim, transition: tr, interruption: Int.evaluate({ urgency: "high" }),
          messages: [msg("resume.continue", { title: rt.title, sub: rt.sub, unitType: tr.unitType, n: tr.resumeUnit })],
          why: [msg("why.resume", { prayer: tr.prayer, unitType: tr.unitType, n: tr.resumeUnit }), msg("why.usable", { usable: usable0, until: hs0.kind === "salah" ? hs0.name : "", kind: hs0.kind })],
          meta: { usableMin: usable0, hardStop: hs0 } });
      }
      // nothing sensible to resume into: fall through to a fresh decision
    }

    // ---- 2. a session is running
    if (inp.session) {
      var ses = inp.session;
      var hardNow = nextSal && nextSal.inMin <= lead ? { kind: "salah", name: nextSal.name, inMin: nextSal.inMin } : null;
      if (!hardNow) (inp.commitments || []).forEach(function (c) { if (!hardNow && c.blocking !== false && c.startMin > nowMin && c.startMin - nowMin <= COMMIT_RESERVE) hardNow = { kind: "commitment", name: c.title, inMin: c.startMin - nowMin }; });
      if (hardNow) return out({ state: "salah_approaching", decision: "WRAP", interruption: Int.evaluate({ urgency: "hard" }),
        messages: [msg(hardNow.kind === "salah" ? "wrap.salah" : "wrap.commitment", { prayer: hardNow.name, title: hardNow.name, mins: hardNow.inMin, task: ses.title }),
          msg("wrap.done", { unitType: ses.unitType, n: ses.unitsDone || 0 }), msg("wrap.resumeFrom", { unitType: ses.unitType, n: Ses.nextUnit(ses) })],
        meta: { hardStop: hardNow }, session: ses });
      var ev = Int.evaluate({ urgency: "normal", activeSession: { running: ses.running }, mode: "pull" });
      return out({ state: "active_task", decision: "IN_SESSION", interruption: ev, messages: [], session: ses, meta: { hardStop: null } });
    }

    // ---- 3. Salah itself
    var prayedMap = inp.salah.prayed || {};
    if (sal && sal.inSalah && !prayedMap[sal.current.name]) return out({ state: "salah_approaching", decision: "SALAH", interruption: Int.evaluate({ urgency: "hard" }), messages: [msg("salah.now", { prayer: sal.current.name })], meta: {} });
    if (sal && sal.inPrep && nextSal) return out({ state: "salah_approaching", decision: "PREPARE", interruption: Int.evaluate({ urgency: "hard" }),
      messages: [msg("salah.prepare", { prayer: nextSal.name, mins: nextSal.inMin })], meta: { hardStop: { kind: "salah", name: nextSal.name, inMin: nextSal.inMin } } });

    // ---- 4. inside a fixed commitment
    if (inBlock) return out({ state: "no_useful", decision: "DO_NOTHING", interruption: Int.evaluate({ urgency: "normal", inFixedCommitment: true, mode: "pull" }),
      messages: [msg("busy.until", { title: inBlock.title, endMin: inBlock.endMin })], meta: { hardStop: { kind: "commitment", name: inBlock.title, inMin: 0 } } });

    // ---- 5. how much room is there?
    var hs = hardStop(inp, sal), usable = hs.usable;
    var disrupted = false;
    var routineHint = findRoutineHint(inp);
    // corrupted entries are skipped here (and rejected at write time by the repository); they can't break Brain state
    var tasks = (inp.tasks || []).filter(function (t) { return t && typeof t.id === "string" && typeof t.title === "string" && t.title && t.status === "active" && (t.target === null || t.target === undefined || (isFinite(t.target) && t.target > 0)); });
    var dismissed = inp.dismissedTaskIds || [];

    function ctxMsgs() { return ctx.labels.map(function (l) { return msg("why.context", { label: l }); }); }
    var salahLine = hs.kind === "salah" ? msg("now.salahIn", { prayer: hs.name, mins: hs.inMin }) : hs.kind === "commitment" ? msg("now.commitIn", { title: hs.name, mins: hs.inMin }) : null;

    if (usable < 10) {
      return out({ state: hs.kind === "salah" && hs.inMin <= lead + 12 ? "salah_approaching" : "no_useful", decision: "DO_NOTHING",
        interruption: Int.evaluate({ urgency: "normal", hasSomethingToSay: false, mode: "pull" }),
        messages: [hs.kind === "salah" ? msg("tight.salah", { prayer: hs.name, mins: hs.inMin }) : hs.kind === "commitment" ? msg("tight.commit", { title: hs.name, mins: hs.inMin }) : msg("tight.dayEnd")],
        routineHint: routineHint, meta: { usableMin: usable, hardStop: hs } });
    }

    // disrupted day: the user said it was unusual, or what's planned can't fit in what's left (no guilt: simplify)
    var load = dayLoad(inp), free = load.free, needed = load.needed;
    if ((inp.plan && inp.plan.unusual) || (base.noPlan === false && needed > 0 && needed > free)) disrupted = true;

    // ---- 6. candidates
    var scored = tasks.filter(function (t) {
      if (dismissed.indexOf(t.id) !== -1) return false;
      var left = t.target ? (t.target - (t.done || 0)) : Infinity;
      if (left <= 0) return false;
      if (t.todayTarget && doneTodayFor(inp, t) >= t.todayTarget) return false;
      return true;
    }).map(function (t) { var sc = scoreTask(inp, t, ctx, ambient); return { t: t, score: sc.score, why: sc.why }; })
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        var da = a.t.deadline || "9999", db = b.t.deadline || "9999";
        if (da !== db) return da < db ? -1 : 1;
        return a.t.id < b.t.id ? -1 : 1;
      });

    var options = [];
    scored.forEach(function (c) {
      var sz = sizeFor(inp, c.t, usable, ctx, disrupted ? { scale: 0.7 } : null);
      if (sz.sizing.mode === "none") return;
      options.push({ c: c, sz: sz });
    });

    if (!options.length) {
      var anyTask = tasks.length > 0;
      return out({ state: anyTask ? "no_useful" : "no_plan", decision: "DO_NOTHING", interruption: Int.evaluate({ urgency: "normal", hasSomethingToSay: false, mode: "pull" }),
        messages: [anyTask ? msg("nothing.now") : msg("noplan.empty")], routineHint: routineHint, meta: { usableMin: usable, hardStop: hs, free: free, needed: needed } });
    }

    function primaryOf(o) {
      var sz = o.sz.sizing, t = o.c.t;
      return { taskId: t.id, area: t.area, title: t.title, sub: t.sub, unitType: t.unitType, mode: sz.mode, units: sz.units, minutes: sz.minutes,
        startUnit: (t.done || 0) + 1, calibrating: sz.calibrating, resume: false };
    }
    var top = options[0], P = primaryOf(top), sz0 = top.sz.sizing, est0 = top.sz.est;
    var why = top.c.why.slice();
    if (top.sz.simple) why.push(msg("why.simpleMode"));
    else if (sz0.calibrating) why.push(msg("why.calibrating", { n: est0.n }));
    else if (est0.confidence !== "none") {
      var disp = Cap.display(est0, top.sz.factor);
      why.push(msg("why.pace", { lo: disp.lo, hi: disp.hi, exact: disp.exact, unitType: top.c.t.unitType, confidence: est0.confidence, n: est0.n, early: est0.n <= 3 }));
      if (top.sz.factor !== 1) why.push(msg("why.corrected", { pct: Math.round((top.sz.factor - 1) * 100) }));
    }
    why.push(msg("why.usable", { usable: usable, until: hs.kind === "salah" ? hs.name : hs.kind === "commitment" ? hs.name : "", kind: hs.kind }));
    if (hs.kind === "salah") why.push(msg("why.buffer", { buf: hs.reserve, prayer: hs.name }));
    if (sz0.mode === "units" && sz0.theoreticalMax !== null) why.push(msg("why.fit", { max: sz0.theoreticalMax, units: sz0.units, unitType: top.c.t.unitType, marginPct: Math.round(sz0.margin * 100) }));
    why = why.concat(ctxMsgs());
    if (disrupted) why.push(msg("why.disrupted"));
    if (base.noPlan) why.push(msg("why.noPlan"));

    var area = top.c.t.area;
    var state = disrupted ? "disrupted" : sz0.calibrating ? "calibration" : area === "study" ? "study" : area === "work" ? "work" : "normal";
    var messages = [];
    if (salahLine) messages.push(salahLine);
    if (sz0.calibrating) { messages.push(msg("calibration.learning")); messages.push(msg("calibration.try", { mins: sz0.minutes })); }
    if (disrupted) messages.unshift(msg("disrupted.simplify"));

    var interruption = Int.evaluate({ urgency: "normal", nowMin: nowMin, mode: "pull", snoozedUntilMin: itn.snoozedUntilMin, dismissalsLastHour: itn.dismissalsLastHour,
      salahInMin: nextSal ? nextSal.inMin : null, activeSession: null, hasSomethingToSay: true });
    var alternatives = options.slice(1, 4).map(primaryOf);
    return out({ state: state, decision: "RECOMMEND", primary: P, why: why, messages: messages, alternatives: disrupted ? [] : alternatives, routineHint: routineHint,
      calibration: !!sz0.calibrating, interruption: interruption, disrupted: disrupted,
      meta: { usableMin: usable, hardStop: hs, estimate: est0, theoreticalMax: sz0.theoreticalMax, margin: sz0.margin, confidence: est0.confidence, free: free, needed: needed, factor: top.sz.factor, contextIds: ctx.ids } });
  }

  // No plan today: if the person reliably studies/works at this hour on this weekday, offer to keep that pattern.
  function findRoutineHint(inp) {
    if (inp.plan && inp.plan.confirmed) return null;
    var bk = bucketOf(inp.now.min), hint = null;
    beliefList(inp).forEach(function (b) {
      if (b.kind !== "routine" || b.dow !== inp.now.dow || b.bucket !== bk) return;
      if (!hint || b.n > hint.n) hint = b;
    });
    return hint ? { beliefId: hint.id, area: hint.area, dow: hint.dow, bucket: hint.bucket, hour: hint.hour, n: hint.n, status: hint.status || "new" } : null;
  }

  // ---------------------------------------------------------------- learned beliefs (hypotheses, never truth)
  /**
   * beliefs(sessions, {resetAt, stateById, nowMs}) -> [{id, kind, ...}] each with status new|correct|sometimes|wrong|deleted.
   * Baseline sessions only (no temporary context). The user can correct, soften or delete any of them.
   */
  function beliefs(sessions, o) {
    o = o || {};
    var out = [], base = (sessions || []).filter(function (s) { return !s.ctx && s.outcome !== undefined; });
    var reset = o.resetAt || {};
    var stateOf = function (id) { return (o.stateById && o.stateById[id] && o.stateById[id].status) || "new"; };

    // pace
    var keys = {}; base.forEach(function (s) { keys[s.key] = s; });
    Object.keys(keys).forEach(function (k) {
      var est = Cap.estimate(sessions, k, { nowMs: o.nowMs, resetAt: reset });
      if (est.confidence === "none") return;
      var d = Cap.display(est, 1), s0 = keys[k], id = "pace|" + k;
      out.push({ id: id, kind: "pace", key: k, area: s0.area, title: s0.title, unitType: s0.unitType, lo: d.lo, hi: d.hi, exact: d.exact, confidence: est.confidence, n: est.n, status: stateOf(id) });
    });

    // time of day (needs real evidence on both sides)
    var byArea = {};
    base.forEach(function (s) { if (s.outcome === "abandoned" || s.outcome === "completed" || s.outcome === "wrapped") (byArea[s.area] = byArea[s.area] || []).push(s); });
    Object.keys(byArea).forEach(function (area) {
      var rk = reset["tod|" + area] ? new Date(reset["tod|" + area]).getTime() : 0;
      var list = byArea[area].filter(function (s) { return !rk || new Date(s.ts).getTime() > rk; });
      if (list.length < 6) return;
      var bs = {}; list.forEach(function (s) { var b = s.tod || bucketOf((s.hour || 0) * 60); var x = bs[b] || (bs[b] = { n: 0, ok: 0 }); x.n++; if (s.outcome !== "abandoned") x.ok++; });
      var rated = Object.keys(bs).filter(function (b) { return bs[b].n >= 3; });
      if (rated.length < 2) return;
      rated.sort(function (a, b) { return bs[b].ok / bs[b].n - bs[a].ok / bs[a].n; });
      var best = rated[0], worst = rated[rated.length - 1];
      if (bs[best].ok / bs[best].n - bs[worst].ok / bs[worst].n < 0.25) return;
      var id = "tod|" + area + "|" + best;
      out.push({ id: id, kind: "tod", area: area, bucket: best, n: bs[best].n, vs: worst, status: stateOf(id) });
    });

    // routine: same weekday + part of day, on 3+ different dates
    var rg = {};
    base.forEach(function (s) {
      if (s.outcome === "abandoned" || !(s.amount > 0 || s.minutes >= 10)) return;
      var b = s.tod || bucketOf((s.hour || 0) * 60), g = s.area + "|" + s.dow + "|" + b, e = rg[g] || (rg[g] = { area: s.area, dow: s.dow, bucket: b, dates: {}, hours: [] });
      var rk = reset["routine|" + s.area] ? new Date(reset["routine|" + s.area]).getTime() : 0;
      if (rk && new Date(s.ts).getTime() <= rk) return;
      if (!e.dates[s.date]) { e.dates[s.date] = 1; e.hours.push(s.hour); }
    });
    Object.keys(rg).forEach(function (g) {
      var e = rg[g], n = Object.keys(e.dates).length;
      if (n < 3) return;
      e.hours.sort(function (a, b) { return a - b; });
      var id = "routine|" + e.area + "|" + e.dow + "|" + e.bucket;
      out.push({ id: id, kind: "routine", area: e.area, dow: e.dow, bucket: e.bucket, hour: e.hours[Math.floor(e.hours.length / 2)], n: n, status: stateOf(id) });
    });
    return out;
  }

  // ---------------------------------------------------------------- replanning permission model
  /**
   * classifyChange(oldTimeline, newTimeline, {unfit, sleepShiftMin}) splits a replan into small reversible changes
   * (applied automatically, shown as "moved") and major ones (need the user's approval).
   *   minor: a flexible block moved by <= 30 min
   *   major: moved further, dropped, could not be placed, or sleep pushed later by > 15 min
   */
  function classifyChange(oldTL, newTL, o) {
    o = o || {};
    var minor = [], major = [];
    function flex(e) { return e.refId && (e.kind === "flexible" || e.kind === "sunnah"); }
    var byId = {}; (newTL || []).forEach(function (e) { if (flex(e)) byId[e.refId] = e; });
    (oldTL || []).forEach(function (e) {
      if (!flex(e) || (e.status === "done" || e.status === "skipped")) return;
      var n = byId[e.refId];
      if (!n) { major.push({ id: e.refId, label: e.label, fromMin: e.startMin, toMin: null, reason: "dropped" }); return; }
      var d = n.startMin - e.startMin;
      if (d === 0) return;
      (Math.abs(d) <= 30 ? minor : major).push({ id: e.refId, label: e.label, fromMin: e.startMin, toMin: n.startMin, reason: Math.abs(d) <= 30 ? "shifted" : "moved_far" });
    });
    (o.unfit || []).forEach(function (u) { major.push({ id: u.id, label: u.label, fromMin: null, toMin: null, reason: "no_room" }); });
    if (o.sleepShiftMin && o.sleepShiftMin > 15) major.push({ id: "sleep", label: "sleep", fromMin: null, toMin: null, reason: "sleep_later", shiftMin: o.sleepShiftMin });
    return { minor: minor, major: major, noChange: !minor.length && !major.length, needsApproval: major.length > 0 };
  }

  // ---------------------------------------------------------------- compact "today" status
  function todayStatus(f) {
    var completed = f.completed || 0, moved = f.moved || 0, remaining = f.remaining || 0;
    var adjust = (f.neededMin || 0) > (f.freeMin === undefined ? Infinity : f.freeMin) || !!f.unusual;
    return { completed: completed, moved: moved, remaining: remaining, status: adjust ? "needs_adjustment" : "on_track" };
  }

  var api = { decide: decide, dayLoad: dayLoad, beliefs: beliefs, classifyChange: classifyChange, contextEffects: contextEffects, freeMinutes: freeMinutes, todayStatus: todayStatus, daysBetween: daysBetween, bucketOf: bucketOf, VERSION: VERSION };
  root.NuraBrain = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
