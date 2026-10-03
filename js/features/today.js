/* TODAY screen: NURA Now (one dominant recommendation) > Salah context > Today Flow > compact progress.
 * Pure presentation: every decision comes from NuraBridge/NuraBrain, every sentence from NuraI18n. */
(function (root) {
  "use strict";

  var U = root.NuraUI, Ses = root.NuraSession, Cap = root.NuraCapacity, Sal = root.NuraSalah;
  function A() { return root.NuraApp; }
  function Br() { return root.NuraBridge; }
  var t = U.t, h = U.h, btn = U.btn;

  var whyOpen = false, correctOpen = false, wrapIgnored = null, drawnKey = null, ticker = null, tickN = 0, flowOpen = false, earlierOpen = false, salahLoadFail = false;

  function viewEl() { return document.getElementById("view-home"); }
  function visible() { var v = viewEl(); return !!v && !v.classList.contains("hidden"); }
  function dkey(d) { return d.state + "|" + d.decision + "|" + (d.primary ? d.primary.taskId + ":" + (d.primary.units || d.primary.minutes) : "") + "|" + (d.session ? d.session.id + d.session.status : ""); }
  function render() { if (!visible()) return; draw(); }

  // ------------------------------------------------------------ header
  function header() {
    var n = new Date(), name = A().userName(), hd = h("header", "td-head");
    var left = h("div", "td-head-text");
    left.appendChild(h("p", "td-date", n.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })));
    left.appendChild(h("h1", "td-greet", t("td.greet") + (name ? ", " + name : "")));
    var sub = h("p", "td-sub"); sub.appendChild(h("span", "td-day", t("td.day", { n: A().journeyDay() })));
    Br().contexts().forEach(function (c) { sub.appendChild(h("span", "td-ctx", c.label)); });
    left.appendChild(sub); hd.appendChild(left);
    var right = h("div", "td-head-actions");
    var book = btn("", "td-icon", function () { A().setActiveView("sunnah"); }, t("td.sunnah"));
    book.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 4h14v16l-7-4-7 4z"/></svg>';
    var av = btn(name ? name.charAt(0).toUpperCase() : "N", "td-avatar", function () { A().setActiveView("more"); }, t("td.more"));
    right.appendChild(book); right.appendChild(av); hd.appendChild(right);
    return hd;
  }

  // ------------------------------------------------------------ NURA Now
  var LABEL = { calibration: "now.label.calibrating", disrupted: "now.label.disrupted", salah_approaching: "now.label.salah", resume_after_salah: "now.label.resume", active_task: "now.label.session", no_useful: "now.label.quiet", no_plan: "now.label.noplan" };
  function labelOf(d) { return t(LABEL[d.state] || "now.label.right"); }
  function lines(card, list) { list.forEach(function (m) { card.appendChild(h("p", "td-now-line", U.msgText(m))); }); }

  function nowCard(d) {
    var card = h("section", "td-now td-now-" + d.state + " td-dec-" + d.decision.toLowerCase());
    card.setAttribute("aria-label", t("now.label.right"));
    if (d.decision === "WRAP" && wrapIgnored && wrapIgnored === d.meta.hardStop.name) return sessionCard(card, { session: d.session, state: "active_task", decision: "IN_SESSION", messages: [] }, true);
    if (d.decision === "IN_SESSION") return sessionCard(card, d, false);
    if (d.decision === "WRAP") return wrapCard(card, d);
    if (d.decision === "PREPARE" || d.decision === "SALAH") return salahCard(card, d);
    if (d.decision === "RESUME") return resumeCard(card, d);
    if (d.decision === "RECOMMEND") return d.interruption && d.interruption.decision === "WAIT" ? quietCard(card, d) : recCard(card, d);
    return idleCard(card, d);
  }

  function metaChips(P) {
    var meta = h("div", "td-now-meta");
    if (P.mode === "units" && P.units) { meta.appendChild(h("span", "td-chip td-chip-strong", t("now.target.units", { units: P.units, unitType: P.unitType }))); meta.appendChild(h("span", "td-chip", t("now.about", { mins: P.minutes }))); }
    else meta.appendChild(h("span", "td-chip td-chip-strong", t("now.target.time", { mins: P.minutes })));
    if (P.resume && P.startUnit) meta.appendChild(h("span", "td-chip", t("now.fromPoint", { point: root.NuraI18n.point(P.unitType, P.startUnit) })));
    return meta;
  }

  function routineHint(card, d) {
    if (!d.routineHint) return;
    var box = h("div", "td-hint"), hint = d.routineHint;
    box.appendChild(h("p", "td-hint-text", t("hint.routine", { area: hint.area, bucket: hint.bucket, dow: hint.dow })));
    var row = h("div", "td-row");
    row.appendChild(btn(t("act.yes"), "td-btn td-btn-soft", function () { Br().setBeliefStatus({ id: hint.beliefId, kind: "routine", area: hint.area }, "correct"); U.announce(t("act.yes")); draw(); }));
    row.appendChild(btn(t("act.change"), "td-btn td-btn-ghost", function () { A().setActiveView("plan"); }));
    box.appendChild(row); card.appendChild(box);
  }

  function whyPanel(card, d) {
    var tog = btn(t("act.why"), "td-link", function () { whyOpen = !whyOpen; correctOpen = false; if (whyOpen) A().track("why_this_opened", { state: d.state }); draw(); });
    tog.setAttribute("aria-expanded", whyOpen ? "true" : "false"); card.appendChild(tog);
    if (!whyOpen) return;
    var box = h("div", "td-why"); box.appendChild(h("p", "td-why-title", t("why.title")));
    var ul = h("ul", "td-why-list"); d.why.forEach(function (m) { ul.appendChild(h("li", "", U.msgText(m))); }); box.appendChild(ul);
    var task = d.primary ? Br().tasks().filter(function (x) { return x.id === d.primary.taskId; })[0] : null;
    if (task) {
      box.appendChild(btn(t("why.wrong"), "td-link", function () { correctOpen = !correctOpen; draw(); }));
      if (correctOpen) {
        box.appendChild(h("p", "td-why-title", t("correct.title")));
        var c = h("div", "s1-chips");
        [["harder_today", "correct.harder"], ["estimate_wrong", "correct.estimate"], ["low_energy", "correct.energy"], ["priority_changed", "correct.priority"], ["unusual_day", "correct.unusual"], ["other", "correct.other"]].forEach(function (r) {
          c.appendChild(btn(t(r[1]), "s1-chip", function () { Br().correct(task, r[0]); correctOpen = false; whyOpen = false; A().showToast(t("correct.thanks")); U.announce(t("correct.thanks")); draw(); }));
        });
        box.appendChild(c);
      }
    }
    card.appendChild(box);
  }

  function recCard(card, d) {
    var P = d.primary;
    card.appendChild(h("p", "td-now-label", labelOf(d)));
    card.appendChild(h("h2", "td-now-title", P.title));
    if (P.sub) card.appendChild(h("p", "td-now-sub", P.sub));
    card.appendChild(metaChips(P));
    lines(card, d.messages);
    var row = h("div", "td-row");
    row.appendChild(btn(t("act.start"), "td-btn td-btn-primary", function () {
      var r = Br().accept(P, d.state); if (r.ok) { whyOpen = false; correctOpen = false; U.announce(P.title); draw(); }
    }));
    if (d.alternatives && d.alternatives.length) row.appendChild(btn(t("act.change"), "td-btn td-btn-outline", function () { Br().changeTask(P.taskId); whyOpen = false; draw(); }));
    row.appendChild(btn(t("act.notNow"), "td-btn td-btn-ghost", function () { Br().notNow(); whyOpen = false; draw(); }));
    card.appendChild(row);
    routineHint(card, d);
    if (d.noPlan) { var np = h("p", "td-noplan"); np.appendChild(document.createTextNode(t("now.noPlan") + " ")); np.appendChild(btn(t("now.makePlan"), "td-link td-link-inline", function () { A().setActiveView("plan"); })); card.appendChild(np); }
    whyPanel(card, d);
    return card;
  }

  function quietCard(card, d) {
    card.className += " td-quiet";
    card.appendChild(h("p", "td-now-label", t("now.label.quiet")));
    card.appendChild(h("p", "td-now-quiet", t("now.snoozed")));
    card.appendChild(btn(t("act.show"), "td-btn td-btn-soft", function () { Br().showAgain(); draw(); }));
    return card;
  }

  function idleCard(card, d) {
    card.className += " td-quiet";
    card.appendChild(h("p", "td-now-label", labelOf(d)));
    d.messages.forEach(function (m) { card.appendChild(h("p", "td-now-quiet", U.msgText(m))); });
    if (d.state === "no_plan") {
      var row = h("div", "td-row"); row.appendChild(btn(t("now.addTask"), "td-btn td-btn-primary", function () { A().setActiveView("plan"); })); card.appendChild(row);
    } else if ((Br().day().dismissedTaskIds || []).length) {
      card.appendChild(btn(t("act.show"), "td-btn td-btn-soft", function () { Br().resetChanges(); draw(); }));
    }
    routineHint(card, d);
    return card;
  }

  function salahCard(card, d) {
    card.appendChild(h("p", "td-now-label", t("now.label.salah")));
    var first = true;
    d.messages.forEach(function (m) { card.appendChild(h(first ? "h2" : "p", first ? "td-now-title" : "td-now-line", U.msgText(m))); first = false; });
    if (d.decision === "SALAH") {
      var p = d.messages[0].p.prayer, row = h("div", "td-row");
      row.appendChild(btn(t("act.prayed"), "td-btn td-btn-primary", function () { Br().markPrayed(p, true); U.announce(t("act.prayed")); draw(); }));
      card.appendChild(row);
    }
    return card;
  }

  function wrapCard(card, d) {
    card.appendChild(h("p", "td-now-label", t("now.label.salah")));
    d.messages.forEach(function (m, i) { card.appendChild(h(i === 0 ? "h2" : "p", i === 0 ? "td-now-title" : "td-now-line", U.msgText(m))); });
    var kind = d.meta.hardStop.kind, row = h("div", "td-row");
    row.appendChild(btn(t("act.wrap"), "td-btn td-btn-primary", function () { Br().wrap(kind === "salah" ? "salah" : "commitment"); U.announce(t("act.wrap")); draw(); }));
    card.appendChild(row);
    card.appendChild(btn(t("now.keepGoing"), "td-link", function () { wrapIgnored = d.meta.hardStop.name; draw(); }));
    return card;
  }

  function resumeCard(card, d) {
    var P = d.primary;
    card.appendChild(h("p", "td-now-label", t("now.label.resume")));
    card.appendChild(h("h2", "td-now-title", U.msgText(d.messages[0])));
    card.appendChild(metaChips(P));
    var row = h("div", "td-row");
    row.appendChild(btn(t("act.resume"), "td-btn td-btn-primary", function () { Br().resumeAfterSalah({ units: P.units, minutes: P.minutes }); U.announce(P.title); draw(); }));
    row.appendChild(btn(t("act.changePlan"), "td-btn td-btn-outline", function () { Br().changePlanAfterSalah(); draw(); }));
    card.appendChild(row);
    whyPanel(card, d);
    return card;
  }

  // ------------------------------------------------------------ active session
  function mmss(ms) { var s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  function sessionCard(card, d, ignoredWrap) {
    var s = d.session;
    card.appendChild(h("p", "td-now-label", t("now.label.session")));
    card.appendChild(h("h2", "td-now-title", s.title));
    if (s.sub) card.appendChild(h("p", "td-now-sub", s.sub));
    var tm = h("p", "td-timer"); tm.id = "td-timer"; tm.setAttribute("role", "timer"); card.appendChild(tm);
    var meta = h("p", "td-now-line", ""); meta.id = "td-timer-meta"; card.appendChild(meta);
    if (ignoredWrap) card.appendChild(h("p", "td-now-line", t("now.willPause")));
    if (s.mode === "units" && !Cap.TIME_BASED[s.unitType]) {
      var st = h("div", "td-stepper"); st.setAttribute("role", "group"); st.setAttribute("aria-label", t("session.howMany"));
      var cnt = h("span", "td-step-count", ""); cnt.id = "td-step-count";
      var minus = btn("−", "td-step", function () { var c = Br().session(); Br().setUnits(Math.max(0, (c.unitsDone || 0) - 1)); updateTimer(Br().session()); }, "−1");
      var plus = btn("+", "td-step", function () { var c = Br().session(); Br().setUnits((c.unitsDone || 0) + 1); updateTimer(Br().session()); }, t("session.logUnit", { unitType: s.unitType, units: 1 }));
      st.appendChild(minus); st.appendChild(cnt); st.appendChild(plus); card.appendChild(st);
    }
    var row = h("div", "td-row");
    row.appendChild(btn(s.running ? t("act.pause") : t("act.continue"), "td-btn td-btn-outline", function () { if (s.running) Br().pause(); else Br().resume(); draw(); }));
    row.appendChild(btn(t("act.finish"), "td-btn td-btn-primary", function () { finishSheet(); }));
    card.appendChild(row);
    updateTimerSoon(card);
    return card;
  }
  function updateTimerSoon(card) { setTimeout(function () { updateTimer(Br().session()); }, 0); }
  function updateTimer(s) {
    var el = document.getElementById("td-timer"); if (!el || !s) return;
    var ms = Ses.elapsedMs(s, Date.now());
    el.textContent = mmss(ms);
    var meta = document.getElementById("td-timer-meta");
    if (meta) {
      var planned = s.plannedMin, over = planned && ms / 60000 > planned * 1.25;
      meta.textContent = (s.running ? "" : t("now.paused") + " · ") + (planned ? (over ? t("now.timeUp") : t("now.planned", { mins: planned })) : "");
    }
    var cnt = document.getElementById("td-step-count");
    if (cnt) cnt.textContent = s.plannedUnits ? t("session.progress", { n: s.unitsDone || 0, total: s.plannedUnits, unitType: s.unitType, units: s.plannedUnits }) : t("session.progressOpen", { n: s.unitsDone || 0, unitType: s.unitType, units: s.unitsDone || 0 });
  }

  function finishSheet() {
    var s = Br().session(); if (!s) return;
    var isUnits = !Cap.TIME_BASED[s.unitType], diff = null, taskDone = false, amount = s.unitsDone || 0;
    U.sheet(t("sess.finishTitle"), function (sh, close) {
      sh.appendChild(h("p", "modal-sub", s.title + (s.sub ? " — " + s.sub : "")));
      var inp = null;
      if (isUnits) {
        sh.appendChild(h("label", "s1-label", t("session.howMany")));
        inp = h("input", "text-input"); inp.type = "number"; inp.min = "0"; inp.step = "1"; inp.inputMode = "numeric"; inp.value = String(amount); sh.appendChild(inp);
      }
      sh.appendChild(h("p", "s1-label", t("session.difficulty")));
      var dwrap = h("div", ""); sh.appendChild(dwrap);
      function drawDiff() { U.empty(dwrap); dwrap.appendChild(U.chips([{ v: "easy", label: t("diff.easy") }, { v: "ok", label: t("diff.ok") }, { v: "hard", label: t("diff.hard") }], diff, function (v) { diff = diff === v ? null : v; drawDiff(); }, t("session.difficulty"))); }
      drawDiff();
      var cl = h("label", "s1-check"), cb = h("input", ""); cb.type = "checkbox"; cb.addEventListener("change", function () { taskDone = cb.checked; });
      cl.appendChild(cb); cl.appendChild(document.createTextNode(" " + t("sess.markTaskDone"))); sh.appendChild(cl);
      var msg = h("p", "day-note", ""); sh.appendChild(msg);
      sh.appendChild(btn(t("act.save"), "td-btn td-btn-primary td-btn-block", function () {
        var n = inp ? Math.floor(Number(inp.value)) : 0;
        if (inp && (!isFinite(n) || n < 0 || n > 10000)) { msg.textContent = t("err.number"); return; }
        var outcome = inp && n === 0 ? "abandoned" : "completed";
        Br().finish(outcome, { amount: inp ? n : 0, difficulty: diff, taskDone: taskDone });
        close(); A().showToast(t("session.saved")); U.announce(t("session.saved")); draw();
      }));
      sh.appendChild(btn(t("sess.didntGetTo"), "td-btn td-btn-ghost td-btn-block", function () { Br().finish("abandoned", { amount: 0 }); close(); draw(); }));
      sh.appendChild(btn(t("act.cancel"), "td-btn td-btn-outline td-btn-block", close));
    });
  }

  // ------------------------------------------------------------ Salah context strip
  function citySheet() {
    U.sheet(t("salah.setupTitle"), function (sh, close) {
      sh.appendChild(h("p", "modal-sub", t("salah.privacy")));
      var city = h("input", "text-input"); city.type = "text"; city.placeholder = t("salah.city"); city.autocomplete = "address-level2";
      var country = h("input", "text-input"); country.type = "text"; country.placeholder = t("salah.country"); country.autocomplete = "country-name";
      var method = h("select", "text-input"); A().salah.methods.forEach(function (m) { var o = h("option", "", m.label); o.value = m.id; method.appendChild(o); });
      var msg = h("p", "day-note", "");
      sh.appendChild(city); sh.appendChild(country); sh.appendChild(method);
      sh.appendChild(btn(t("act.save"), "td-btn td-btn-primary td-btn-block", function () {
        var c1 = city.value.trim(), c2 = country.value.trim();
        if (!c1 || !c2) { msg.textContent = t("salah.needBoth"); return; }
        A().salah.save({ mode: "manual", city: c1, country: c2, method: Number(method.value) });
        close(); salahLoadFail = false;
        A().salah.ensure().then(function () { render(); }).catch(function () { salahLoadFail = true; render(); });
        render();
      }));
      sh.appendChild(msg);
    });
  }

  function explainSheet() {
    U.sheet(t("salah.explain.title"), function (sh, close) {
      var T = A().salah.timings();
      if (T) { var tb = h("ul", "td-times"); A().salah.order.forEach(function (p) { var li = h("li", ""); li.appendChild(h("span", "", p)); li.appendChild(h("span", "", U.clock(T.minutes[p]))); tb.appendChild(li); }); sh.appendChild(tb); }
      Br().salahExplain().forEach(function (l) { sh.appendChild(h("p", "td-explain-line", t(l.k, l.p))); });
      if (root.NuraPlan) sh.appendChild(btn(t("salah.adjust"), "td-btn td-btn-outline td-btn-block", function () { close(); root.NuraPlan.openSalahSettings(); }));
    });
  }

  function salahStrip() {
    var sec = h("section", "td-salah"), S = A().salah;
    if (!S.hasSettings()) {
      sec.appendChild(h("p", "td-salah-line", t("salah.setup")));
      var row = h("div", "td-row");
      row.appendChild(btn(t("salah.allow"), "td-btn td-btn-soft", function () { S.requestGPS(); }));
      row.appendChild(btn(t("salah.enterCity"), "td-btn td-btn-ghost", citySheet));
      sec.appendChild(row); return sec;
    }
    var T = S.timings();
    if (!T) {
      sec.appendChild(h("p", "td-salah-line", salahLoadFail ? t("salah.loadFail") : t("salah.loading")));
      var r2 = h("div", "td-row");
      r2.appendChild(btn(t("act.retry"), "td-btn td-btn-soft", function () { salahLoadFail = false; S.ensure().then(render).catch(function () { salahLoadFail = true; render(); }); render(); }));
      r2.appendChild(btn(t("salah.enterCity"), "td-btn td-btn-ghost", citySheet));
      sec.appendChild(r2);
      if (!salahLoadFail && !salahLoadFail) S.ensure().then(function () { salahLoadFail = false; render(); }).catch(function () { salahLoadFail = true; render(); });
      return sec;
    }
    var si = Br().salahInput(), n = Br().now(), info = Sal.windowInfo(si.timings, n.min, si.leadMin, si.salahMin, si.nextFajrMin), comps = S.prayed();
    var line = h("div", "td-salah-main");
    var nx = info.next;
    line.appendChild(h("span", "td-salah-text", nx.tomorrow ? t("salah.nextTomorrow", { prayer: nx.name, time: nx.at % 1440 }) : t("salah.next", { prayer: nx.name, time: nx.at, mins: nx.inMin })));
    var cur = info.current && !comps[info.current.name] ? info.current.name : (info.inPrep && !comps[nx.name] ? null : null);
    if (cur) line.appendChild(btn(t("act.prayed"), "td-btn td-btn-soft td-btn-sm", function () { Br().markPrayed(cur, true); draw(); }));
    sec.appendChild(line);
    var foot = h("div", "td-salah-foot");
    foot.appendChild(btn(t("salah.why"), "td-link", explainSheet));
    if (T.source === "cache") foot.appendChild(h("span", "td-salah-note", t("salah.onlineNote")));
    sec.appendChild(foot);
    return sec;
  }

  // ------------------------------------------------------------ Today Flow
  var ICON = { completed: "✓", current: "●", upcoming: "○", moved: "↷", removed: "⊘" };
  function flowRow(r) {
    var li = h("li", "td-fr td-fr-" + r.status + (r.now ? " is-now" : "") + (r.next ? " is-next" : ""));
    li.setAttribute("aria-label", r.label + ", " + t("flow.status." + r.status) + (r.overdue ? ", " + t("flow.notMarked") : ""));
    var ic = h("span", "td-fr-icon", ICON[r.status] || "○"); ic.setAttribute("aria-hidden", "true"); li.appendChild(ic);
    var time = h("span", "td-fr-time", r.startMin !== null && r.startMin !== undefined && r.kind !== "task" ? U.clock(r.startMin) : (r.now ? t("flow.now") : ""));
    li.appendChild(time);
    var body = h("div", "td-fr-body"), name = h("span", "td-fr-name", r.label);
    if (r.now) name.appendChild(h("span", "td-fr-tag", r.suggested ? t("flow.now") : t("now.label.session")));
    body.appendChild(name);
    var note = r.note || (r.overdue ? t("flow.notMarked") : r.movedFrom !== null && r.movedFrom !== undefined && r.status === "moved" ? t("flow.movedFrom", { time: r.movedFrom }) : r.status === "moved" && r.flow ? t("flow.movedTo", { time: new Date(r.flow.st.to + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }) }) : "");
    if (note) body.appendChild(h("span", "td-fr-note", note));
    li.appendChild(body);
    var st = h("span", "sr-only", t("flow.status." + r.status)); li.appendChild(st);
    if (r.kind === "salah" || (r.kind === "flow" && r.flow && (r.status === "completed" || r.status === "upcoming" || r.status === "current"))) {
      var on = r.status === "completed";
      var cb = btn("", "td-check" + (on ? " is-on" : ""), function () {
        if (r.kind === "salah") { Br().markPrayed(r.prayer, !on); draw(); }
        else A().flow.toggle(r.flow.a, A().todayKey());
      }, (on ? t("flow.markNot") : t("flow.markDone")) + ": " + r.label);
      var dot = h("span", "td-dot", on ? "✓" : ""); dot.setAttribute("aria-hidden", "true"); cb.appendChild(dot);
      cb.setAttribute("role", "checkbox"); cb.setAttribute("aria-checked", on ? "true" : "false"); li.appendChild(cb);
    }
    return li;
  }

  function flowSection(d, rows) {
    var sec = h("section", "td-flow"), head = h("div", "td-flow-head");
    head.appendChild(h("h2", "td-h", t("today.flow")));
    head.appendChild(btn(t("td.flowLink"), "td-link", function () { A().openFlow("today"); }));
    sec.appendChild(head);
    if (!rows.length) { sec.appendChild(h("p", "td-empty", t("flow.empty"))); return sec; }
    var firstActive = -1;
    for (var i = 0; i < rows.length; i++) { if (rows[i].status === "current" || rows[i].status === "upcoming" || rows[i].status === "moved") { firstActive = i; break; } }
    var nextMarked = false;
    rows.forEach(function (r) { if (!nextMarked && r.status === "upcoming" && !r.overdue && !r.now) { r.next = true; nextMarked = true; } });
    var earlier = firstActive > 0 ? rows.slice(0, firstActive).filter(function (r) { return r.status === "completed"; }) : [];
    var ul = h("ul", "td-flow-list"); ul.setAttribute("role", "list");
    var skip = {};
    if (earlier.length >= 3 && !earlierOpen) {
      earlier.forEach(function (r) { skip[r.id] = 1; });
      var sum = h("li", "td-fr td-fr-collapsed"); sum.appendChild(btn("✓ " + t("td.earlier", { n: earlier.length }), "td-link", function () { earlierOpen = true; draw(); })); ul.appendChild(sum);
    }
    rows.forEach(function (r) { if (!skip[r.id]) ul.appendChild(flowRow(r)); });
    sec.appendChild(ul);
    return sec;
  }

  function progressLine(rows, d) {
    var p = Br().todayProgress(rows, d), sec = h("section", "td-progress");
    sec.appendChild(h("p", "td-eyebrow", t("today.progress")));
    sec.appendChild(h("p", "td-prog-main", t("today.summary", p)));
    sec.appendChild(h("span", "td-pill " + (p.status === "on_track" ? "is-ok" : "is-adjust"), (p.status === "on_track" ? "✓ " : "◐ ") + t(p.status === "on_track" ? "today.status.on" : "today.status.adjust")));
    return sec;
  }

  // ------------------------------------------------------------ draw
  function draw() {
    var rootEl = document.getElementById("today-root"); if (!rootEl) return;
    var d;
    try { d = Br().decide(); } catch (e) {
      var rep = root.NuraPlatform.report(e, { where: "today.decide" });
      U.empty(rootEl); rootEl.appendChild(header()); var box = h("section", "td-now td-quiet"); box.appendChild(h("p", "td-now-quiet", rep.user)); rootEl.appendChild(box);
      try { console.warn("[NURA]", JSON.stringify(rep.dev)); } catch (x) { /* ignore */ }
      return;
    }
    drawnKey = dkey(d) + "|" + (d.decision === "IN_SESSION" ? "" : Br().now().min);
    Br().noteShown(d);
    var push = Br().pushCheck(d);
    U.empty(rootEl);
    rootEl.appendChild(header());
    var card = nowCard(d);
    if (push && push.decision === "INTERVENE" && (d.decision === "WRAP" || d.decision === "PREPARE" || d.decision === "RESUME" || d.decision === "SALAH")) card.className += " td-pulse";
    rootEl.appendChild(card);
    rootEl.appendChild(salahStrip());
    var rows = Br().todayFlow(d);
    rootEl.appendChild(flowSection(d, rows));
    rootEl.appendChild(progressLine(rows, d));
  }

  function tick() {
    if (!visible() || U.sheetOpen()) return;
    tickN++;
    var s = Br().session();
    if (s && s.status !== "wrapped") updateTimer(s);
    if (tickN % 10 === 0) {
      Br().maintain();
      var d = Br().decide(), k = dkey(d) + "|" + (d.decision === "IN_SESSION" ? "" : Br().now().min);
      if (k !== drawnKey) draw();
    }
  }
  function init() {
    if (ticker) return;
    ticker = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) { Br().maintain(); render(); } });
  }

  root.NuraToday = { render: render, init: init, draw: draw, citySheet: citySheet, explainSheet: explainSheet };
})(window);
