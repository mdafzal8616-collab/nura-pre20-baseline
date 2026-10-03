/* PLAN screen: morning setup / occasional replanning. Designed as CONFIRMATION, not paperwork:
 * known commitments are prefilled and just need a glance; "Anything unusual today?" is one line; [Use this plan] is the one action.
 * Planning is never required: Today works without it. */
(function (root) {
  "use strict";

  var U = root.NuraUI, Sal = root.NuraSalah, Cap = root.NuraCapacity, Guard = root.NuraGuard;
  function A() { return root.NuraApp; }
  function Br() { return root.NuraBridge; }
  var t = U.t, h = U.h, btn = U.btn;

  var proposal = null, notice = "", openForm = null;
  var AREAS = [["study", "area.study"], ["work", "area.work"], ["personal", "area.personal"]];
  var UNITS = [["questions", "unit.questions"], ["pages", "unit.pages"], ["sections", "unit.sections"], ["items", "unit.items"], ["minutes", "unit.minutes"], ["finish", "unit.finish"]];
  var DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function viewEl() { return document.getElementById("view-plan"); }
  function visible() { var v = viewEl(); return !!v && !v.classList.contains("hidden"); }
  function render() { if (visible()) draw(); }

  function section(titleKey, hintKey) {
    var s = h("section", "pl-sec"); s.appendChild(h("h2", "pl-h", t(titleKey)));
    if (hintKey) s.appendChild(h("p", "pl-hint", t(hintKey)));
    return s;
  }

  // ------------------------------------------------------------ routine / commitments
  function routineSection() {
    var s = section("plan.routine"), list = Br().commitments(true);
    if (!list.length) s.appendChild(h("p", "pl-empty", t("plan.noRoutine")));
    var ul = h("ul", "pl-list");
    list.forEach(function (c) {
      var li = h("li", "pl-item" + (c.removed ? " is-off" : ""));
      var main = h("div", "pl-item-main");
      main.appendChild(h("span", "pl-item-title", c.title));
      main.appendChild(h("span", "pl-item-sub", U.clock(c.startMin) + " – " + U.clock(c.endMin) + (c.source === "routine" ? " · " + t("plan.usual") : " · " + t("plan.today"))));
      li.appendChild(main);
      li.appendChild(btn(c.removed ? t("plan.restore") : t("plan.notToday"), "pl-mini", function () { if (c.removed) Br().restoreCommitmentToday(c); else Br().removeCommitmentToday(c); draw(); }, (c.removed ? t("plan.restore") : t("plan.notToday")) + ": " + c.title));
      ul.appendChild(li);
    });
    s.appendChild(ul);
    s.appendChild(btn("+ " + t("plan.addRoutine"), "pl-add", routineSheet));
    var de = h("div", "pl-inline"), lab = h("label", "pl-inline-label", t("plan.dayEnds")), inp = h("input", "text-input pl-time"); inp.type = "time"; inp.value = Sal.hhmm(A().repo.settings().dayEndMin);
    inp.addEventListener("change", function () { var m = A().plan.toMin(inp.value || "23:00"); var st = A().repo.settings(); st.dayEndMin = m; A().repo.saveSettings(st); A().renderHome(); });
    lab.appendChild(inp); de.appendChild(lab); s.appendChild(de);
    return s;
  }

  function routineSheet() {
    var days = [], name = "";
    U.sheet(t("plan.addRoutine"), function (sh, close) {
      var nm = h("input", "text-input"); nm.type = "text"; nm.maxLength = 40; nm.placeholder = t("plan.routinePh"); sh.appendChild(nm);
      sh.appendChild(h("p", "s1-label", t("plan.days")));
      var row = h("div", "s1-chips");
      DOWS.forEach(function (d, i) { var c = btn(d, "s1-chip", function () { var ix = days.indexOf(i); if (ix === -1) days.push(i); else days.splice(ix, 1); c.classList.toggle("is-on"); c.setAttribute("aria-pressed", days.indexOf(i) !== -1 ? "true" : "false"); }); c.setAttribute("aria-pressed", "false"); row.appendChild(c); });
      sh.appendChild(row);
      var a = h("input", "text-input"); a.type = "time"; a.setAttribute("aria-label", t("plan.from")); var b = h("input", "text-input"); b.type = "time"; b.setAttribute("aria-label", t("plan.to"));
      sh.appendChild(h("p", "s1-label", t("plan.from"))); sh.appendChild(a); sh.appendChild(h("p", "s1-label", t("plan.to"))); sh.appendChild(b);
      var msg = h("p", "day-note", ""); sh.appendChild(msg);
      sh.appendChild(btn(t("act.save"), "td-btn td-btn-primary td-btn-block", function () {
        if (!nm.value.trim() || !days.length || !a.value) { msg.textContent = t("plan.routineNeeds"); return; }
        Br().addRoutine(nm.value, days.slice().sort(), a.value, b.value || null); close(); A().renderHome(); draw();
      }));
    });
  }

  // ------------------------------------------------------------ tasks
  function taskLine(tk) {
    var bits = [];
    if (tk.sub) bits.push(tk.sub);
    if (tk.target) bits.push(t("plan.remaining", { n: Math.max(0, tk.target - (tk.done || 0)), unitType: tk.unitType, units: Math.max(0, tk.target - (tk.done || 0)) }));
    if (tk.deadline) bits.push(t("plan.due", { date: new Date(tk.deadline + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }) }));
    return bits.join(" · ");
  }
  function tasksSection() {
    var s = section("plan.tasks", "plan.tasksHint"), list = Br().tasks().filter(function (x) { return x.status === "active"; }), d = Br().day();
    if (!list.length) s.appendChild(h("p", "pl-empty", t("plan.noTasks")));
    var ul = h("ul", "pl-list");
    list.forEach(function (tk) {
      var li = h("li", "pl-item"), on = tk.planToday;
      var cb = h("input", "pl-check"); cb.type = "checkbox"; cb.checked = on; cb.id = "pl-t-" + tk.id; cb.setAttribute("aria-label", t("plan.focusToday") + ": " + tk.title);
      cb.addEventListener("change", function () { var def = !Cap.TIME_BASED[tk.unitType] && tk.target ? Math.min(Math.max(1, tk.target - (tk.done || 0)), 5) : null; Br().setFocus(tk.id, cb.checked, def); A().renderHome(); draw(); });
      li.appendChild(cb);
      var main = h("label", "pl-item-main"); main.htmlFor = cb.id;
      main.appendChild(h("span", "pl-item-title", tk.title)); main.appendChild(h("span", "pl-item-sub", taskLine(tk))); li.appendChild(main);
      li.appendChild(btn("⋯", "pl-mini", function () { taskMenu(tk); }, t("plan.options") + ": " + tk.title));
      if (on && !Cap.TIME_BASED[tk.unitType] && tk.target) {
        var amt = d.todayTargets[tk.id] || 1, st = h("div", "pl-step");
        var m = btn("−", "td-step", function () { Br().setFocus(tk.id, true, Math.max(1, amt - 1)); A().renderHome(); draw(); }, "−1"), p = btn("+", "td-step", function () { Br().setFocus(tk.id, true, Math.min(tk.target - (tk.done || 0), amt + 1)); A().renderHome(); draw(); }, "+1");
        st.appendChild(m); st.appendChild(h("span", "pl-step-n", t("plan.todayAmount", { n: amt, unitType: tk.unitType, units: amt }))); st.appendChild(p); li.appendChild(st);
      }
      ul.appendChild(li);
    });
    s.appendChild(ul);
    s.appendChild(btn("+ " + t("plan.addTask"), "pl-add", taskSheet));
    return s;
  }

  function taskMenu(tk) {
    U.sheet(tk.title, function (sh, close) {
      sh.appendChild(h("p", "modal-sub", taskLine(tk)));
      sh.appendChild(btn(t("plan.markDone"), "td-btn td-btn-outline td-btn-block", function () { A().repo.updateTask(tk.id, { status: "done" }); close(); A().renderHome(); draw(); }));
      sh.appendChild(btn(t("plan.remove"), "td-btn td-btn-outline td-btn-block td-btn-danger", function () { A().repo.removeTask(tk.id); close(); A().renderHome(); draw(); }));
    });
  }

  var ERRKEY = { title: "err.title", area: "err.area", unitType: "err.unitType", target: "err.target", deadline: "err.deadline", priority: "err.priority", sub: "err.sub", not_an_object: "err.generic" };
  function taskSheet() {
    var f = { area: "study", unitType: "questions", priority: 2 };
    U.sheet(t("plan.addTask"), function (sh, close) {
      var areaBox = h("div", ""), unitSel = h("select", "text-input"), tgt = h("input", "text-input"), dl = h("input", "text-input"), prBox = h("div", "");
      var title = h("input", "text-input"); title.type = "text"; title.maxLength = 80; title.placeholder = t("plan.taskPh");
      var sub = h("input", "text-input"); sub.type = "text"; sub.maxLength = 80; sub.placeholder = t("plan.subPh");
      function drawChips() {
        U.empty(areaBox); areaBox.appendChild(U.chips(AREAS.map(function (a) { return { v: a[0], label: t(a[1]) }; }), f.area, function (v) { f.area = v; drawChips(); }, t("plan.area")));
        U.empty(prBox); prBox.appendChild(U.chips([{ v: 3, label: t("plan.prHigh") }, { v: 2, label: t("plan.prNormal") }, { v: 1, label: t("plan.prLow") }], f.priority, function (v) { f.priority = v; drawChips(); }, t("plan.priority")));
      }
      UNITS.forEach(function (u) { var o = h("option", "", t(u[1])); o.value = u[0]; unitSel.appendChild(o); });
      unitSel.setAttribute("aria-label", t("plan.unitType"));
      unitSel.addEventListener("change", function () { f.unitType = unitSel.value; tgt.classList.toggle("hidden", !!Cap.TIME_BASED[f.unitType]); });
      tgt.type = "number"; tgt.min = "1"; tgt.step = "1"; tgt.inputMode = "numeric"; tgt.placeholder = t("plan.targetPh"); tgt.setAttribute("aria-label", t("plan.target"));
      dl.type = "date"; dl.setAttribute("aria-label", t("plan.deadline"));
      sh.appendChild(areaBox); sh.appendChild(title); sh.appendChild(sub); sh.appendChild(h("p", "s1-label", t("plan.unitType"))); sh.appendChild(unitSel); sh.appendChild(tgt);
      sh.appendChild(h("p", "s1-label", t("plan.deadlineOpt"))); sh.appendChild(dl); sh.appendChild(prBox);
      drawChips();
      var msg = h("p", "day-note", ""); sh.appendChild(msg);
      sh.appendChild(btn(t("act.add"), "td-btn td-btn-primary td-btn-block", function () {
        var res = Br().addTask({ title: title.value, sub: sub.value, area: f.area, unitType: f.unitType, target: Cap.TIME_BASED[f.unitType] ? null : tgt.value, deadline: dl.value || null, priority: f.priority });
        if (!res.ok) { msg.textContent = (res.errors || []).map(function (e) { return t(ERRKEY[e] || "err.generic"); }).join(" "); return; }
        close(); A().renderHome(); draw();
      }));
    });
  }

  // ------------------------------------------------------------ anything unusual today?
  function unusualSection() {
    var s = section("plan.unusual"), row = h("div", "pl-row");
    var inp = h("input", "text-input"); inp.type = "text"; inp.maxLength = 80; inp.placeholder = t("plan.unusualPh"); inp.setAttribute("aria-label", t("plan.unusual"));
    var go = function () {
      var v = inp.value.trim(); if (!v) return;
      var r = Br().addUnusual(v);
      if (!r.ok) { notice = t("plan.parseFail"); proposal = null; draw(); return; }
      inp.value = "";
      if (r.kind === "routine") notice = r.message;
      else if (r.needsApproval) { proposal = r; notice = t("plan.addedEvent", { name: r.event.name, time: r.event.startMin }); }
      else if (r.auto) notice = t("plan.auto", { label: r.change.minor[0].label, time: r.change.minor[0].toMin }) + " " + t("plan.addedEvent", { name: r.event.name, time: r.event.startMin });
      else notice = t("plan.addedEvent", { name: r.event.name, time: r.event.startMin });
      if (r.overlaps && r.overlaps.length) notice = (notice + " " + t("plan.overlap", { a: r.event.name, b: r.overlaps.join(", ") })).trim();
      U.announce(notice || t("plan.proposalAnnounce")); A().renderHome(); draw();
    };
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    row.appendChild(inp); row.appendChild(btn(t("act.add"), "td-btn td-btn-soft", go)); s.appendChild(row);
    if (notice) { var n = h("p", "pl-notice"); n.setAttribute("role", "status"); n.textContent = notice; s.appendChild(n); }
    if (proposal) {
      var box = h("div", "pl-proposal"); box.setAttribute("role", "alert");
      box.appendChild(h("p", "pl-proposal-text", t("plan.proposal", { labels: proposal.change.major.map(function (m) { return m.label; }).join(", ") })));
      var ul = h("ul", "pl-proposal-list");
      proposal.change.major.concat(proposal.change.minor).forEach(function (m) { ul.appendChild(h("li", "", m.toMin === null ? t("plan.cantFit", { label: m.label }) : t("plan.moveLine", { label: m.label, from: m.fromMin, to: m.toMin }))); });
      box.appendChild(ul);
      var r2 = h("div", "td-row");
      r2.appendChild(btn(t("act.apply"), "td-btn td-btn-primary", function () { Br().applyProposal(proposal.draft, proposal.change); proposal = null; notice = t("plan.applied2"); A().renderHome(); draw(); }));
      r2.appendChild(btn(t("act.keep"), "td-btn td-btn-outline", function () { proposal = null; notice = t("plan.kept"); draw(); }));
      box.appendChild(r2); s.appendChild(box);
    }
    return s;
  }

  // ------------------------------------------------------------ Salah lead + temporary mode
  function leadSection() {
    var s = section("plan.salahLead", "plan.salahLeadHint"), cur = A().repo.settings().salah.leadMin, preset = [5, 10, 15].indexOf(cur) !== -1;
    var box = h("div", ""); s.appendChild(box);
    function draw2() {
      U.empty(box);
      box.appendChild(U.chips([{ v: 5, label: t("plan.min", { n: 5 }) }, { v: 10, label: t("plan.min", { n: 10 }) }, { v: 15, label: t("plan.min", { n: 15 }) }, { v: "custom", label: t("plan.custom") }],
        [5, 10, 15].indexOf(A().repo.settings().salah.leadMin) !== -1 ? A().repo.settings().salah.leadMin : "custom", function (v) {
          if (v === "custom") { var x = Number(window.prompt(t("plan.customPrompt"), String(A().repo.settings().salah.leadMin))); if (!Br().setLead(x)) return; } else Br().setLead(v);
          A().renderHome(); draw2();
        }, t("plan.salahLead")));
    }
    draw2(); return s;
  }

  var MODES = [["exam", "mode.exam"], ["travel", "mode.travel"], ["ramadan", "mode.ramadan"], ["temp_schedule", "mode.temp"], ["work_week", "mode.workweek"]];
  function modeSection() {
    var s = section("plan.mode", "plan.modeHint"), act = Br().allContexts().filter(function (c) { return !c.endedAt; });
    var ul = h("ul", "pl-list");
    act.forEach(function (c) {
      var li = h("li", "pl-item"), m = h("div", "pl-item-main"); m.appendChild(h("span", "pl-item-title", c.label)); m.appendChild(h("span", "pl-item-sub", c.end ? t("plan.until", { date: new Date(c.end + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }) }) : t("plan.noEnd")));
      li.appendChild(m); li.appendChild(btn(t("plan.endMode"), "pl-mini", function () { Br().endContext(c.id); A().renderHome(); draw(); }, t("plan.endMode") + ": " + c.label)); ul.appendChild(li);
    });
    s.appendChild(ul);
    var chips = h("div", "s1-chips");
    MODES.forEach(function (m) {
      if (act.some(function (c) { return c.kind === m[0]; })) return;
      chips.appendChild(btn(t(m[1]), "s1-chip", function () { modeSheet(m[0], t(m[1])); }));
    });
    s.appendChild(chips);
    return s;
  }
  function modeSheet(kind, label) {
    U.sheet(label, function (sh, close) {
      sh.appendChild(h("p", "modal-sub", t("plan.modeNote")));
      [7, 14, 30, 0].forEach(function (days) {
        sh.appendChild(btn(days ? t("plan.forDays", { n: days }) : t("plan.noEnd"), "td-btn td-btn-outline td-btn-block", function () {
          var end = null; if (days) { var d = new Date(); d.setDate(d.getDate() + days); end = A().todayKey(d); }
          Br().startContext(kind, label, end); close(); A().renderHome(); draw();
        }));
      });
    });
  }

  // ------------------------------------------------------------ the one action
  function confirmBar() {
    var bar = h("div", "pl-confirm");
    bar.appendChild(btn(t("act.usePlan"), "td-btn td-btn-primary td-btn-block", function () {
      Br().confirmPlan(); notice = t("plan.applied"); A().showToast(t("plan.applied")); U.announce(t("plan.applied")); A().setActiveView("home");
    }));
    bar.appendChild(btn(t("plan.timeline"), "td-link", function () { A().setActiveView("duniya-plan"); }));
    return bar;
  }

  function draw() {
    var rootEl = document.getElementById("plan-root"); if (!rootEl) return;
    U.empty(rootEl);
    var hd = h("header", "pl-head"); hd.appendChild(h("p", "td-eyebrow", t("nav.plan"))); hd.appendChild(h("h1", "pl-title", t("plan.confirm")));
    hd.appendChild(h("p", "pl-hint", new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })));
    rootEl.appendChild(hd);
    if (Br().day().confirmed) rootEl.appendChild(h("p", "pl-done", "✓ " + t("plan.applied")));
    rootEl.appendChild(routineSection()); rootEl.appendChild(tasksSection()); rootEl.appendChild(unusualSection());
    rootEl.appendChild(leadSection()); rootEl.appendChild(modeSection()); rootEl.appendChild(confirmBar());
  }

  // ------------------------------------------------------------ Salah settings (method, Asr, offsets, location)
  function openSalahSettings() {
    U.sheet(t("salah.settings"), function (sh, close) {
      var S = A().salah, cur = S.settings(), bs = A().repo.settings().salah;
      if (!cur) { sh.appendChild(h("p", "modal-sub", t("salah.setup"))); sh.appendChild(btn(t("salah.enterCity"), "td-btn td-btn-primary td-btn-block", function () { close(); root.NuraToday.citySheet(); })); sh.appendChild(btn(t("salah.allow"), "td-btn td-btn-outline td-btn-block", function () { close(); S.requestGPS(); })); return; }
      var loc = S.location();
      sh.appendChild(h("p", "modal-sub", loc ? t("salah.locUsed", { lat: loc.lat.toFixed(2), lon: loc.lon.toFixed(2) }) : t("salah.noCoords")));
      sh.appendChild(h("p", "s1-label", t("salah.method")));
      var ms = h("select", "text-input"); S.methods.forEach(function (m) { var o = h("option", "", m.label); o.value = m.id; if (m.id === (cur.method || 1)) o.selected = true; ms.appendChild(o); }); sh.appendChild(ms);
      sh.appendChild(h("p", "s1-label", t("salah.asrMethod")));
      var asr = bs.asr, abox = h("div", ""); sh.appendChild(abox);
      function drawAsr() { U.empty(abox); abox.appendChild(U.chips([{ v: "standard", label: t("salah.asr.standard") }, { v: "hanafi", label: t("salah.asr.hanafi") }], asr, function (v) { asr = v; drawAsr(); }, t("salah.asrMethod"))); }
      drawAsr();
      sh.appendChild(h("p", "pl-hint", t("salah.asrNote")));
      sh.appendChild(h("p", "s1-label", t("salah.offsets")));
      var offs = {}, grid = h("div", "pl-offsets");
      Sal.PRAYERS.forEach(function (p) {
        var l = h("label", "pl-off"), i = h("input", "text-input"); i.type = "number"; i.min = "-30"; i.max = "30"; i.step = "1"; i.inputMode = "numeric"; i.value = bs.offsets[p] || 0; offs[p] = i;
        l.appendChild(h("span", "", p)); l.appendChild(i); grid.appendChild(l);
      });
      sh.appendChild(grid); sh.appendChild(h("p", "pl-hint", t("salah.offsetNote")));
      sh.appendChild(h("p", "s1-label", t("language.title")));
      var ls = h("select", "text-input"); ls.setAttribute("aria-label", t("language.title"));
      [["en", "English"], ["hi", "हिन्दी"], ["ur", "اردو"], ["ar", "العربية"]].forEach(function (l) { var o = h("option", "", l[1]); o.value = l[0]; if (l[0] === A().repo.settings().lang) o.selected = true; ls.appendChild(o); });
      sh.appendChild(ls); sh.appendChild(h("p", "pl-hint", t("language.note")));
      sh.appendChild(btn(t("act.save"), "td-btn td-btn-primary td-btn-block", function () {
        var s2 = S.settings(); s2.method = Number(ms.value); S.save(s2);
        var o = {}; Sal.PRAYERS.forEach(function (p) { o[p] = offs[p].value; });
        Br().setSalahPrefs({ asr: asr, offsets: o, lang: ls.value });
        root.NuraI18n.setLang(ls.value);
        close(); if (root.NuraFeatures) root.NuraFeatures.applyLang(); A().renderHome(); render();
      }));
    });
  }

  root.NuraPlan = { render: render, openSalahSettings: openSalahSettings };
})(window);
