/* NURA service layer (no DOM).
 *
 * Sits between the pure Brain (js/core) and the screens (today/plan/progress). It gathers the Brain's inputs from
 * the app's real data, runs session / Salah-transition / correction / replan operations, and persists results through
 * the repository. Business logic lives here and in core/, never inside screen code.
 */
(function (root) {
  "use strict";

  var B = root.NuraBrain, Ses = root.NuraSession, Cap = root.NuraCapacity, Sal = root.NuraSalah, Int = root.NuraInterruption, I18 = root.NuraI18n, Plat = root.NuraPlatform;
  function A() { return root.NuraApp; }
  function repo() { return A().repo; }
  var K = root.NuraRepo.K;

  // ------------------------------------------------------------ clock + day state
  function now() { var d = new Date(); return { date: A().todayKey(d), min: d.getHours() * 60 + d.getMinutes(), dow: d.getDay(), ms: d.getTime() }; }
  function tomorrowKey() { var d = new Date(); d.setDate(d.getDate() + 1); return A().todayKey(d); }
  function dayStartMs() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function day() { var d = repo().day(now().date); if (!Array.isArray(d.focusIds)) d.focusIds = []; return d; }
  function saveDay(d) { repo().saveDay(now().date, d); }
  function toMin(hhmm) { return A().plan.toMin(hhmm); }
  function hhmm(min) { return Sal.hhmm(min); }

  // ------------------------------------------------------------ inputs for the Brain
  function salahInput() {
    var s = repo().settings().salah, t = A().salah.timings();
    var out = { timings: null, leadMin: s.leadMin, salahMin: s.salahMin, source: null, nextFajrMin: undefined, prayed: A().salah.prayed() };
    if (t) {
      out.timings = t.minutes; out.source = t.source;
      var tm = A().salah.timingsFor(tomorrowKey());
      out.nextFajrMin = (tm && tm.minutes.Fajr !== undefined ? tm.minutes.Fajr : t.minutes.Fajr) + 1440;
    }
    return out;
  }

  function containerOf(label, category) {
    var s = (String(category || "") + " " + String(label || "")).toLowerCase();
    return /\b(office|work|job|shift|duty|career)\b/.test(s) ? { container: "work", area: "work" } : null;
  }
  // Fixed commitments for today: today's Plan My Day fixed items + the user's confident routines (the memory engine).
  // A low-confidence guess never blocks time. Things the user cancelled or removed today are left out.
  function commitments(includeRemoved) {
    var out = [], seen = {}, d = day(), n = now();
    A().plan.activities().forEach(function (a) {
      if (a.mode !== "fixed" || !a.startTime) return;
      var removed = a.status === "skipped" || d.removed.indexOf(a.id) !== -1;
      seen[A().mem.key(a.name)] = 1;
      if (removed && !includeRemoved) return;
      var s = toMin(a.startTime), e = a.endTime ? toMin(a.endTime) : s + (Number(a.durationMinutes) || 60), c = containerOf(a.name, a.category);
      out.push({ id: a.id, title: a.name, startMin: s, endMin: e, blocking: !c, container: c ? c.container : null, area: c ? c.area : null, removed: removed, source: "plan" });
    });
    A().mem.suggestionsFor(n.date).forEach(function (it) {
      if (seen[it.key] || it.low) return;
      var id = "mem-" + it.key, cancelled = it.exc && it.exc.type === "cancelled" || d.removed.indexOf(id) !== -1;
      if (cancelled && !includeRemoved) return;
      var st = it.exc && it.exc.type === "changed" ? it.exc.start : it.eff.start, en = it.exc && it.exc.type === "changed" ? (it.exc.end || it.eff.end) : it.eff.end;
      var s = toMin(st), e = en ? toMin(en) : s + 60, c = containerOf(it.label, "");
      out.push({ id: id, title: it.label, startMin: s, endMin: e, blocking: !c, container: c ? c.container : null, area: c ? c.area : null, removed: !!cancelled, source: "routine", key: it.key, confirmed: !!(it.eff && it.eff.confirmed) });
    });
    out.sort(function (a, b) { return a.startMin - b.startMin; });
    return out;
  }

  function dayEndMin() { return repo().settings().dayEndMin; } // one source of truth: Plan > "Day ends at"

  function contexts() {
    var t = now().date;
    return (repo().read(K.contexts, []) || []).filter(function (c) { return !c.endedAt && c.start <= t && (!c.end || c.end >= t); });
  }
  function allContexts() { return repo().read(K.contexts, []) || []; }

  function tasks() {
    var d = day();
    return repo().tasks().map(function (t) {
      var o = Object.assign({}, t);
      o.planToday = d.focusIds.indexOf(t.id) !== -1;
      var amt = d.todayTargets[t.id];
      o.todayTarget = amt && !Cap.TIME_BASED[t.unitType] ? amt : null;
      return o;
    });
  }

  function beliefs() {
    if (!A().flags.isOn("pattern_engine")) return [];
    return B.beliefs(repo().sessions(), { resetAt: repo().read(K.reset, {}), stateById: repo().read(K.beliefState, {}), nowMs: now().ms }).filter(function (b) { return b.status !== "deleted"; });
  }

  function activeSessionRaw() { var s = repo().read(K.active, null); return s && s.id ? s : null; }
  function transition() { var t = repo().read(K.transition, null); return t && t.id ? t : null; }

  function dismissalsLastHour(d, n) { return (d.dismissals || []).filter(function (m) { return n.min - m >= 0 && n.min - m < 60; }).length; }

  function input(extra) {
    var n = now(), d = day(), s = activeSessionRaw(), tr = transition();
    var inp = {
      now: n, salah: salahInput(), commitments: commitments(false), dayEndMin: dayEndMin(), tasks: tasks(), sessions: repo().sessions(),
      corrections: repo().read(K.corrections, []), resetAt: repo().read(K.reset, {}),
      session: s && s.status !== "wrapped" ? s : null, transition: tr, contexts: contexts(),
      plan: { confirmed: !!d.confirmed, unusual: !!d.unusual }, beliefs: beliefs(),
      interruption: { snoozedUntilMin: d.snoozedUntilMin, dismissalsLastHour: dismissalsLastHour(d, n) },
      dismissedTaskIds: d.dismissedTaskIds || [], flags: A().flags.snapshot()
    };
    if (extra) Object.keys(extra).forEach(function (k) { inp[k] = extra[k]; });
    return inp;
  }

  // ------------------------------------------------------------ sessions
  function endSession(outcome, opts) {
    opts = opts || {};
    var s = activeSessionRaw(); if (!s) return null;
    var n = now();
    if (opts.amount !== undefined) Ses.setUnits(s, opts.amount);
    var entry = Ses.finish(s, n.ms, outcome, { difficulty: opts.difficulty });
    repo().logSession(entry);
    var t = repo().tasks().filter(function (x) { return x.id === s.taskId; })[0];
    if (t) {
      var done = (t.done || 0) + (entry.amount || 0), patch = { done: done };
      if (opts.taskDone || (t.target && done >= t.target)) patch.status = "done";
      repo().updateTask(t.id, patch);
    }
    repo().remove(K.active); repo().remove(K.transition);
    A().track(outcome === "abandoned" ? "task_abandoned" : "task_completed", { area: s.area, mode: s.mode, predicted_min: s.predictedMin || 0, actual_min: entry.minutes, amount: entry.amount, outcome: outcome });
    return entry;
  }

  // Keeps sessions honest across app kills, reloads and Salah: stale sessions don't teach pace; a session still
  // running when a prayer time passes stops counting at that moment and enters the Salah transition.
  function maintain() {
    var n = now(), s = activeSessionRaw(), tr = transition();
    if (tr && tr.date !== n.date) { if (s && s.status === "wrapped") endSession("wrapped"); else repo().remove(K.transition); s = activeSessionRaw(); }
    if (s && s.status === "wrapped" && !transition()) { endSession("wrapped"); s = null; }
    if (s && s.status !== "wrapped" && Ses.isStale(s, n.ms)) { endSession("abandoned"); s = null; }
    if (s && s.running && s.status === "active") {
      var t = salahInput();
      if (t.timings) {
        for (var i = 0; i < Sal.PRAYERS.length; i++) {
          var p = Sal.PRAYERS[i], m = t.timings[p];
          if (m === undefined) continue;
          var pMs = dayStartMs() + m * 60000;
          if (s.runStartMs < pMs && pMs <= n.ms) { Ses.wrap(s, n.ms, pMs); repo().write(K.active, s); repo().write(K.transition, Ses.makeTransition(s, p, m, n.date)); A().track("salah_transition_triggered", { prayer: p, mode: "auto", amount: s.unitsDone || 0 }); break; }
        }
      }
    }
  }

  function ctxIdNow() { var c = contexts()[0]; return c ? c.id : null; }

  function accept(primary, state) {
    var t = repo().tasks().filter(function (x) { return x.id === primary.taskId; })[0];
    if (!t) return { ok: false };
    var n = now();
    var s = Ses.start(t, { mode: primary.mode, units: primary.units, minutes: primary.minutes, startUnit: primary.startUnit }, n.ms, ctxIdNow());
    repo().write(K.active, s);
    A().track("nura_now_started", { state: state || "normal", area: t.area, mode: primary.mode, units: primary.units || 0, minutes: primary.minutes || 0 });
    A().track("task_started", { area: t.area, mode: primary.mode, units: primary.units || 0, minutes: primary.minutes || 0 });
    return { ok: true, session: s };
  }
  function setUnits(n) { var s = activeSessionRaw(); if (!s) return null; Ses.setUnits(s, n); repo().write(K.active, s); return s; }
  function pause() { var s = activeSessionRaw(); if (!s) return null; Ses.pause(s, now().ms); repo().write(K.active, s); return s; }
  function resume() { var s = activeSessionRaw(); if (!s) return null; Ses.resume(s, now().ms); repo().write(K.active, s); return s; }

  // Wrap for Salah (kind 'salah') keeps a transition so the work can resume exactly where it stopped;
  // wrap for a fixed commitment just pauses.
  function wrap(kind) {
    var s = activeSessionRaw(); if (!s) return null;
    var n = now(), sal = salahInput();
    if (kind === "salah" && sal.timings) {
      var info = Sal.windowInfo(sal.timings, n.min, sal.leadMin, sal.salahMin, sal.nextFajrMin), next = info.next && !info.next.tomorrow ? info.next : null;
      Ses.wrap(s, n.ms);
      var tr = Ses.makeTransition(s, next ? next.name : "Salah", next ? next.at : n.min, n.date);
      repo().write(K.active, s); repo().write(K.transition, tr);
      A().track("salah_transition_triggered", { prayer: tr.prayer, mode: "user", amount: s.unitsDone || 0 });
      return tr;
    }
    Ses.pause(s, n.ms); repo().write(K.active, s);
    return null;
  }
  function resumeAfterSalah(sizing) {
    var s = activeSessionRaw(), tr = transition(); if (!s) { repo().remove(K.transition); return null; }
    Ses.resume(s, now().ms); s.status = "active";
    // plans are totals for the whole session: what was already done and banked, plus what is being offered now
    if (sizing) { s.plannedUnits = sizing.units ? (s.unitsDone || 0) + sizing.units : null; s.plannedMin = Math.round(s.accMs / 60000) + (sizing.minutes || 0); s.predictedUnits = s.plannedUnits; s.predictedMin = s.plannedMin; }
    repo().write(K.active, s); repo().remove(K.transition);
    A().track("salah_resume_started", { prayer: tr ? tr.prayer : "", amount: tr ? tr.doneUnits : 0 });
    return s;
  }
  function changePlanAfterSalah() { endSession("wrapped"); }
  function finish(outcome, opts) { return endSession(outcome, opts); }

  function markPrayed(name, on) {
    A().salah.setPrayed(name, on !== false);
    var tr = transition();
    if (tr && tr.prayer === name && on !== false && (tr.prayedAtMin === null || tr.prayedAtMin === undefined)) { tr.prayedAtMin = now().min; repo().write(K.transition, tr); }
  }

  // ------------------------------------------------------------ decide + interruption bookkeeping
  function decide(extra) {
    maintain();
    var inp = input(extra), d = B.decide(inp);
    d._input = { nowMin: inp.now.min };
    return d;
  }
  function decisionKey(d) { return d.state + "|" + d.decision + "|" + (d.primary ? d.primary.taskId + ":" + (d.primary.units || d.primary.minutes) : ""); }
  function noteShown(d) {
    var n = now(), key = decisionKey(d), dd = day();
    // remembered per day (not in memory) so reopening the app doesn't log the same thing again
    if (key === dd.lastShownKey && n.min >= dd.lastShownMin && n.min - dd.lastShownMin < 15) return;
    dd.lastShownKey = key; dd.lastShownMin = n.min; saveDay(dd);
    A().track("nura_now_shown", { state: d.state, decision: d.decision, mode: d.primary ? d.primary.mode : "none", units: d.primary ? (d.primary.units || 0) : 0, minutes: d.primary ? (d.primary.minutes || 0) : 0, confidence: (d.meta && d.meta.confidence) || "none", brain: Plat.BRAIN_VERSION });
  }
  // Unprompted surfacing (the card changing while the app is open). Hard constraints always pass; anything else is rate limited.
  function pushCheck(d) {
    var key = decisionKey(d), n = now(), dd = day(), st = repo().settings();
    if (key === dd.lastPushKey) return null;
    dd.lastPushKey = key; saveDay(dd); dd = day();
    var hard = d.decision === "WRAP" || d.decision === "PREPARE" || d.decision === "SALAH";
    var recent = (dd.interventions || []).filter(function (m) { return n.min - m < 180 && n.min - m >= 0; });
    var res = Int.evaluate({ urgency: hard ? "hard" : d.decision === "RESUME" ? "high" : "normal", mode: "push", nowMin: n.min, activeSession: d.decision === "IN_SESSION" ? { running: true } : null,
      inFixedCommitment: d.state === "no_useful" && d.decision === "DO_NOTHING" && /busy/.test((d.messages[0] || {}).k || ""), quiet: st.quiet, salahInMin: d.meta && d.meta.hardStop && d.meta.hardStop.kind === "salah" ? d.meta.hardStop.inMin : null,
      lastInterventionMin: recent.length ? recent[recent.length - 1] : null, interventionsLast3h: recent.length, dismissalsLastHour: dismissalsLastHour(dd, n), snoozedUntilMin: dd.snoozedUntilMin,
      hasSomethingToSay: d.decision !== "DO_NOTHING" && d.decision !== "IN_SESSION" });
    if (res.decision === "INTERVENE") { dd.interventions = (dd.interventions || []).concat([n.min]).slice(-12); saveDay(dd); A().track("intervention_sent", { state: d.state, decision: d.decision, reason: res.reasons[0] }); }
    else if (d.decision !== "DO_NOTHING" || res.reasons[0] !== "nothing_to_say") A().track("intervention_suppressed", { state: d.state, decision: d.decision, reason: res.reasons[0] });
    return res;
  }

  function changeTask(taskId) { var d = day(); if (d.dismissedTaskIds.indexOf(taskId) === -1) d.dismissedTaskIds.push(taskId); saveDay(d); A().track("nura_now_changed", { area: "", reason: "change" }); }
  function resetChanges() { var d = day(); d.dismissedTaskIds = []; d.snoozedUntilMin = null; saveDay(d); }
  function notNow() { var d = day(), n = now(); d.dismissals = (d.dismissals || []).concat([n.min]).slice(-10); d.snoozedUntilMin = n.min + 30; saveDay(d); A().track("nura_now_dismissed", { reason: "not_now" }); }
  function showAgain() { var d = day(); d.snoozedUntilMin = null; d.dismissals = []; saveDay(d); }

  // ------------------------------------------------------------ user corrections (high priority) and learned beliefs
  var REASONS = {
    harder_today: { scope: "today", factor: 1.3 }, low_energy: { scope: "today", factor: 1.3 }, estimate_wrong: { scope: "persist", factor: 1.25 },
    other: { scope: "today", factor: 1.15 }, priority_changed: { scope: "none" }, unusual_day: { scope: "none" }
  };
  function correct(task, reason) {
    var r = REASONS[reason] || REASONS.other, k = task.key || Cap.key(task), d = day(), n = now();
    if (r.scope === "today" || r.scope === "persist") {
      var list = repo().read(K.corrections, []);
      var usableN = Cap.usable(repo().sessions(), k, { nowMs: n.ms, resetAt: repo().read(K.reset, {}) }).length;
      list.push({ id: "cr-" + n.ms.toString(36), key: k, scope: r.scope, factor: r.factor, date: n.date, nAtCreate: usableN, reason: reason });
      repo().write(K.corrections, list.slice(-40));
    }
    if (reason === "priority_changed" && task.id) { if (d.dismissedTaskIds.indexOf(task.id) === -1) d.dismissedTaskIds.push(task.id); }
    if (reason === "unusual_day") d.unusual = true;
    saveDay(d);
    A().track("capacity_corrected", { reason: reason, scope: r.scope });
  }
  function setBeliefStatus(b, status) {
    var states = repo().read(K.beliefState, {}), reset = repo().read(K.reset, {}), iso = new Date().toISOString();
    var resetKey = b.kind === "pace" ? b.key : b.kind + "|" + b.area;
    if (status === "correct" || status === "sometimes") states[b.id] = { status: status, at: iso };
    else if (status === "wrong") { reset[resetKey] = iso; if (b.kind === "pace") delete states[b.id]; else states[b.id] = { status: "wrong", at: iso }; }
    else if (status === "deleted") { reset[resetKey] = iso; delete states[b.id]; } // forget the evidence; it only returns if NEW evidence forms it again
    repo().write(K.beliefState, states); repo().write(K.reset, reset);
  }

  // ------------------------------------------------------------ temporary contexts (never rewrite the baseline)
  function startContext(kind, label, endDate) {
    var list = allContexts(), n = now();
    var c = { id: "ctx-" + n.ms.toString(36), kind: kind, label: label, start: n.date, end: endDate || null, endedAt: null };
    list.push(c); repo().write(K.contexts, list);
    A().track("temporary_context_started", { kind: kind });
    return c;
  }
  function endContext(id) {
    var list = allContexts(); list.forEach(function (c) { if (c.id === id) c.endedAt = now().date; }); repo().write(K.contexts, list);
    A().track("temporary_context_ended", { kind: "context" });
  }

  // ------------------------------------------------------------ plan operations
  function addTask(raw) {
    var r = repo().addTask(raw);
    if (!r.ok) return r;
    return r;
  }
  function setFocus(taskId, on, amount) {
    var d = day(), i = d.focusIds.indexOf(taskId);
    if (on && i === -1) d.focusIds.push(taskId); if (!on && i !== -1) d.focusIds.splice(i, 1);
    if (on && amount > 0) d.todayTargets[taskId] = amount; if (!on) delete d.todayTargets[taskId];
    saveDay(d);
  }
  function confirmPlan() { var d = day(); d.confirmed = true; saveDay(d); A().track("plan_created", { count: d.focusIds.length }); }
  function skipPlan() { A().track("plan_skipped", {}); }
  function setLead(minutes) {
    var m = Math.round(Number(minutes)); if (!(m >= 1 && m <= 45)) return false;
    var s = repo().settings(); s.salah.leadMin = m; repo().saveSettings(s); return true;
  }
  function setSalahPrefs(p) {
    var s = repo().settings();
    if (p.asr === "standard" || p.asr === "hanafi") s.salah.asr = p.asr;
    if (p.offsets) { var o = {}; Sal.PRAYERS.forEach(function (n) { var v = Math.round(Number(p.offsets[n])); if (isFinite(v) && v !== 0 && Math.abs(v) <= 30) o[n] = v; }); s.salah.offsets = o; }
    if (p.lang) s.lang = p.lang;
    repo().saveSettings(s);
  }

  function removeCommitmentToday(c) {
    var d = day();
    if (c.source === "routine") { A().mem.addException(c.key, "cancelled"); }
    else { var acts = A().plan.activities(); acts.forEach(function (a) { if (a.id === c.id) a.status = "skipped"; }); A().plan.saveActivities(acts); }
    if (d.removed.indexOf(c.id) === -1) d.removed.push(c.id);
    saveDay(d);
  }
  function restoreCommitmentToday(c) {
    var d = day();
    if (c.source === "routine") { A().writeJSON("nc_mem_exceptions", (A().readJSON("nc_mem_exceptions", []) || []).filter(function (e) { return !(e.date === now().date && e.key === c.key); })); }
    else { var acts = A().plan.activities(); acts.forEach(function (a) { if (a.id === c.id) a.status = "pending"; }); A().plan.saveActivities(acts); }
    d.removed = d.removed.filter(function (x) { return x !== c.id; }); saveDay(d);
  }
  function addRoutine(name, days, startHH, endHH) {
    var nm = String(name || "").trim().slice(0, 40); if (!nm || !days.length || !startHH) return { ok: false };
    A().mem.correct(A().mem.key(nm), nm, days, startHH, endHH || null);
    return { ok: true };
  }

  // "Doctor 7 PM", "gym 6-7pm", "dentist at 5:30 for 30 min": plain patterns, not AI. The result is only ever a proposal for the user to confirm.
  function guessMin(h, m, ap, afterMin) {
    if (ap) return ((h % 12) + (ap === "pm" ? 12 : 0)) * 60 + m;
    if (h >= 13) return h * 60 + m;
    var c = h === 12 ? [12 * 60 + m, m] : [h * 60 + m, ((h % 12) + 12) * 60 + m];
    var later = c.filter(function (x) { return x > afterMin; }).sort(function (a, b) { return a - b; });
    return later.length ? later[0] : c.sort(function (a, b) { return b - a; })[0];
  }
  function parseUnusual(text, nowMin) {
    var raw = String(text || "").replace(/\s+/g, " ").trim();
    if (!raw) return { ok: false, reason: "empty" };
    var s = null, e = null, chunk = null, m;
    if ((m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(raw))) {
      chunk = m[0]; s = guessMin(+m[1], +(m[2] || 0), (m[3] || m[6] || "").toLowerCase() || null, nowMin); e = guessMin(+m[4], +(m[5] || 0), (m[6] || m[3] || "").toLowerCase() || null, s);
    } else if ((m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(raw)) || (m = /\bat\s+(\d{1,2})(?::(\d{2}))?\b/i.exec(raw)) || (m = /\b(\d{1,2}):(\d{2})\b/.exec(raw))) {
      chunk = m[0]; s = guessMin(+m[1], +(m[2] || 0), (m[3] || "").toLowerCase() || null, nowMin);
    }
    if (s === null || s < 0 || s >= 1440) return { ok: false, reason: "no_time" };
    var dur = 60, dm = /\bfor\s+(\d+(?:\.\d+)?)\s*(min|mins|minutes|hour|hours|hr|hrs|h)\b/i.exec(raw);
    if (dm) { dur = /^h/i.test(dm[2]) ? Math.round(+dm[1] * 60) : Math.round(+dm[1]); raw = raw.replace(dm[0], " "); }
    if (e === null || e <= s) e = s + Math.max(15, Math.min(dur, 600));
    var name = raw.replace(chunk, " ").replace(/\b(at|from|around|by|today|tonight|i have|i've got|got a|my)\b/gi, " ").replace(/[^\p{L}\p{N}' &-]/gu, " ").replace(/\s+/g, " ").trim();
    name = name ? name.charAt(0).toUpperCase() + name.slice(1, 40) : "Appointment";
    return { ok: true, name: name, startMin: s, endMin: Math.min(e, 1439) };
  }

  function recordMoved(list) {
    var d = day();
    list.forEach(function (m) { d.moved = d.moved.filter(function (x) { return x.id !== m.id; }); d.moved.push({ id: m.id, label: m.label, fromMin: m.fromMin, toMin: m.toMin, reason: m.reason }); });
    saveDay(d);
  }
  // Add an unusual event for today, then re-run Plan My Day's scheduler. Small reversible shifts apply automatically
  // (and are shown as "moved"); anything major is returned as a proposal that needs the user's approval.
  function addUnusual(text) {
    var n = now(), cmd = /cancel|called off|not (going|happening)|skipping|holiday|is off|off today/i.test(text);
    if (cmd) {
      var pc = A().mem.parseCorrection(text);
      if (pc && pc.ok) { var msg = A().mem.applyCorrection(pc, pc.action === "ask" ? "today" : null); return { ok: true, kind: "routine", message: msg }; }
    }
    var p = parseUnusual(text, n.min);
    if (!p.ok) return { ok: false, reason: p.reason };
    var prevBuilt = A().plan.built();
    var acts = A().plan.activities();
    var act = { id: A().uid("pa"), name: p.name, mode: "fixed", startTime: hhmm(p.startMin), endTime: hhmm(p.endMin), durationMinutes: p.endMin - p.startMin, category: "Other", priority: "high", status: "pending", createdVia: "unusual" };
    acts.push(act); A().plan.saveActivities(acts);
    A().mem.observe(p.name, n.date, act.startTime, act.endTime, true); // "today only": never teaches a routine
    var res = { ok: true, kind: "event", event: { name: p.name, startMin: p.startMin, endMin: p.endMin }, activityId: act.id, applied: false, overlaps: [] };
    commitments(false).forEach(function (c) { if (c.id !== act.id && c.blocking && c.startMin < p.endMin && p.startMin < c.endMin) res.overlaps.push(c.title); });
    if (!prevBuilt) return res;
    var T = A().salah.timings(), draft = A().plan.compute(acts, A().plan.settings(), T ? T.hhmm : null, n.min);
    draft.timeline = prevBuilt.timeline.filter(function (e) { return e.endMin <= n.min; }).concat(draft.timeline);
    var change = B.classifyChange(prevBuilt.timeline, draft.timeline, { unfit: draft.unfit || [] });
    res.change = change;
    if (change.noChange) { A().plan.saveBuilt(draft); res.applied = true; }
    else if (!change.needsApproval) { A().plan.saveBuilt(draft); recordMoved(change.minor); res.applied = true; res.auto = true; A().track("replan_auto", { count: change.minor.length }); }
    else { res.needsApproval = true; res.draft = draft; A().track("replan_proposed", { count: change.major.length }); }
    return res;
  }
  function applyProposal(draft, change) {
    A().plan.saveBuilt(draft); recordMoved((change.minor || []).concat(change.major || []));
    A().track("replan_applied", { count: (change.major || []).length });
  }

  // ------------------------------------------------------------ Today Flow + compact progress
  function unitText(t, n) { return n + " " + I18.unit(t, n); }
  function todayFlow(d) {
    var n = now(), rows = [], dd = day(), comps = A().salah.prayed(), sal = salahInput();
    var info = sal.timings ? Sal.windowInfo(sal.timings, n.min, sal.leadMin, sal.salahMin, sal.nextFajrMin) : null;
    if (sal.timings) Sal.PRAYERS.forEach(function (p) {
      var m = sal.timings[p], prayed = !!comps[p], cur = info && ((info.current && info.current.name === p) || (info.inPrep && info.next && info.next.name === p));
      rows.push({ id: "salah-" + p, kind: "salah", label: p, startMin: m, status: prayed ? "completed" : cur ? "current" : "upcoming", overdue: !prayed && m + sal.salahMin <= n.min, prayer: p });
    });
    commitments(true).forEach(function (c) {
      var st = c.removed ? "removed" : c.endMin <= n.min ? "completed" : c.startMin <= n.min ? "current" : "upcoming";
      rows.push({ id: "c-" + c.id, kind: "commitment", label: c.title, startMin: c.startMin, endMin: c.endMin, status: st, commitment: c });
    });
    var built = A().plan.built(), acts = A().plan.activities();
    if (built && built.timeline) built.timeline.forEach(function (e) {
      if (!e.refId || (e.kind !== "flexible" && e.kind !== "sunnah")) return;
      var a = acts.filter(function (x) { return x.id === e.refId; })[0], mv = dd.moved.filter(function (x) { return x.id === e.refId; })[0];
      var st = a && a.status === "done" ? "completed" : a && a.status === "skipped" ? "removed" : mv ? "moved" : e.startMin <= n.min && n.min < e.endMin ? "current" : "upcoming";
      rows.push({ id: "p-" + e.refId, kind: "plan", label: e.label, startMin: e.startMin, endMin: e.endMin, status: st, movedFrom: mv ? mv.fromMin : null });
    });
    var fd = A().flow.day(n.date);
    fd.items.forEach(function (it) {
      if (it.a.link && it.a.link.kind === "salah") return; // Salah has its own, real rows above
      var t = A().flow.timeFor(it.a, n.date, true), m = t ? toMin(t) : null;
      var st = it.st.kind === "done" ? "completed" : it.st.kind === "skip" ? "removed" : it.st.kind === "rs" ? "moved" : "upcoming";
      rows.push({ id: "f-" + it.a.id, kind: "flow", label: it.a.name, startMin: m, status: st, flow: it });
    });
    repo().sessions().forEach(function (s) {
      if (s.date !== n.date || s.outcome === "abandoned") return;
      var t = new Date(s.ts), ru = s.amount > 0 ? unitText(s.unitType, s.amount) + " · " : "";
      rows.push({ id: "s-" + s.id, kind: "session", label: s.title + (s.sub ? " — " + s.sub : ""), startMin: t.getHours() * 60 + t.getMinutes() - (s.minutes || 0), status: "completed", note: ru + s.minutes + " min" });
    });
    var ses = activeSessionRaw();
    if (ses && ses.status !== "wrapped") rows.push({ id: "now-session", kind: "task", label: ses.title + (ses.sub ? " — " + ses.sub : ""), startMin: n.min, status: "current", now: true });
    else if (d && (d.decision === "RECOMMEND" || d.decision === "RESUME") && d.primary) rows.push({ id: "now-rec", kind: "task", label: d.primary.title + (d.primary.sub ? " — " + d.primary.sub : ""), startMin: n.min, status: "current", now: true, suggested: true });
    rows.sort(function (a, b) {
      var x = a.startMin === null || a.startMin === undefined ? 5000 : a.startMin, y = b.startMin === null || b.startMin === undefined ? 5000 : b.startMin;
      return x - y || (a.kind === "salah" ? -1 : 1);
    });
    return rows;
  }

  function todayProgress(rows, d) {
    var completed = 0, moved = 0, remaining = 0;
    rows.forEach(function (r) {
      if (r.kind === "commitment" || r.kind === "task") return; // commitments just happen; the suggestion isn't an action yet
      if (r.status === "completed") completed++;
      else if (r.status === "moved") moved++;
      else if ((r.status === "upcoming" || r.status === "current") && !r.overdue) remaining++;
    });
    var inp = input(), load = B.dayLoad(inp);
    var st = B.todayStatus({ completed: completed, moved: moved, remaining: remaining, neededMin: load.needed, freeMin: load.free, unusual: false });
    st.neededMin = load.needed; st.freeMin = load.free;
    return st;
  }

  // ------------------------------------------------------------ Salah explanation (Why is this prayer time different?)
  function salahExplain() {
    var t = A().salah.timings(), s = A().salah.settings(), bs = repo().settings().salah;
    if (!s) return [];
    var loc = A().salah.location(), n = new Date();
    return Sal.explain({ method: s.method || 1, asr: bs.asr, offsets: bs.offsets, lat: loc ? loc.lat : undefined, lon: loc ? loc.lon : undefined, source: t ? t.source : "cache",
      tzOffsetMin: t ? (t.locTzOffsetMin !== null && t.locTzOffsetMin !== undefined ? t.locTzOffsetMin : t.tzOffsetMin) : undefined, deviceTzOffsetMin: -n.getTimezoneOffset() }, t ? t.result : null);
  }

  root.NuraBridge = { now: now, input: input, decide: decide, noteShown: noteShown, pushCheck: pushCheck, maintain: maintain, tasks: tasks, commitments: commitments, contexts: contexts, allContexts: allContexts,
    beliefs: beliefs, session: activeSessionRaw, transition: transition, accept: accept, setUnits: setUnits, pause: pause, resume: resume, wrap: wrap, resumeAfterSalah: resumeAfterSalah,
    changePlanAfterSalah: changePlanAfterSalah, finish: finish, markPrayed: markPrayed, changeTask: changeTask, resetChanges: resetChanges, notNow: notNow, showAgain: showAgain,
    correct: correct, setBeliefStatus: setBeliefStatus, startContext: startContext, endContext: endContext, addTask: addTask, setFocus: setFocus, confirmPlan: confirmPlan, skipPlan: skipPlan,
    setLead: setLead, setSalahPrefs: setSalahPrefs, removeCommitmentToday: removeCommitmentToday, restoreCommitmentToday: restoreCommitmentToday, addRoutine: addRoutine,
    parseUnusual: parseUnusual, addUnusual: addUnusual, applyProposal: applyProposal, todayFlow: todayFlow, todayProgress: todayProgress, salahExplain: salahExplain, day: day, salahInput: salahInput,
    REASONS: REASONS, dismissalsLastHour: dismissalsLastHour };
})(window);
