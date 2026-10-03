/* PROGRESS screen: honest, minimal. Today's status, this week from real sessions, and "What NURA has learned" -
 * every learning is a hypothesis the user can Correct, soften ("Sometimes"), mark Wrong, or Delete. */
(function (root) {
  "use strict";

  var U = root.NuraUI, Cap = root.NuraCapacity, Ses = root.NuraSession;
  function A() { return root.NuraApp; }
  function Br() { return root.NuraBridge; }
  var t = U.t, h = U.h, btn = U.btn;

  function viewEl() { return document.getElementById("view-progress"); }
  function visible() { var v = viewEl(); return !!v && !v.classList.contains("hidden"); }
  function render() { if (visible()) draw(); }

  function sec(titleKey) { var s = h("section", "pl-sec"); s.appendChild(h("h2", "pl-h", t(titleKey))); return s; }

  function todaySection() {
    var s = sec("progress.today"), d = Br().decide(), rows = Br().todayFlow(d), p = Br().todayProgress(rows, d);
    s.appendChild(h("p", "td-prog-main", t("today.summary", p)));
    s.appendChild(h("span", "td-pill " + (p.status === "on_track" ? "is-ok" : "is-adjust"), (p.status === "on_track" ? "✓ " : "◐ ") + t(p.status === "on_track" ? "today.status.on" : "today.status.adjust")));
    s.appendChild(btn(t("progress.openFlow"), "td-link", function () { A().openFlow("week"); }));
    return s;
  }

  function weekSection() {
    var s = sec("progress.week"), n = Br().now(), cutoff = Date.now() - 7 * 86400000, list = A().repo.sessions().filter(function (x) { return new Date(x.ts).getTime() >= cutoff && x.outcome !== "abandoned"; });
    if (!list.length) { s.appendChild(h("p", "pl-empty", t("progress.noSessions"))); return s; }
    var mins = list.reduce(function (a, x) { return a + (x.minutes || 0); }, 0), days = {};
    list.forEach(function (x) { days[x.date] = 1; });
    s.appendChild(h("p", "td-prog-main", t("progress.weekLine", { sessions: list.length, mins: mins, days: Object.keys(days).length })));
    return s;
  }

  function beliefText(b) {
    return b.kind === "pace" ? t("learn.pace", { title: b.title, lo: b.lo, hi: b.hi, exact: b.exact, unitType: b.unitType }) : b.kind === "tod" ? t("learn.tod", { area: b.area, bucket: b.bucket }) : t("learn.routine", { area: b.area, bucket: b.bucket, dow: b.dow });
  }
  function learnedSection() {
    var s = sec("learn.title"), beliefs = Br().beliefs().filter(function (b) { return b.status !== "wrong"; });
    var sessions = A().repo.sessions(), reset = A().repo.read("nc_br_reset", {});
    var learning = Br().tasks().filter(function (x) { return x.status === "active" && !Cap.TIME_BASED[x.unitType]; }).map(function (x) {
      var e = Cap.estimate(sessions, x.key, { nowMs: Date.now(), resetAt: reset }); return e.confidence === "none" ? { task: x, n: Cap.usable(sessions, x.key, { nowMs: Date.now(), resetAt: reset }).length } : null;
    }).filter(Boolean);
    if (!beliefs.length && !learning.length) s.appendChild(h("p", "pl-empty", t("learn.empty")));
    learning.forEach(function (l) { s.appendChild(h("p", "pl-learning", t("learn.calibrating", { title: l.task.title, n: l.n }))); });
    var ul = h("ul", "pl-list pl-learn");
    beliefs.forEach(function (b) {
      var li = h("li", "pl-learn-item");
      li.appendChild(h("p", "pl-learn-text", beliefText(b)));
      var meta = h("p", "pl-hint", b.kind === "pace" ? t("learn.conf." + b.confidence) + " · " + t("learn.sessions", { n: b.n }) : t("learn.evidence", { n: b.n }));
      if (b.status === "correct" || b.status === "sometimes") meta.textContent += " · " + t("learn.youSaid", { what: t(b.status === "correct" ? "act.correct" : "act.sometimes") });
      li.appendChild(meta);
      var row = h("div", "pl-learn-actions");
      [["correct", "act.correct"], ["sometimes", "act.sometimes"], ["wrong", "act.wrong"], ["deleted", "act.delete"]].forEach(function (a) {
        var on = b.status === a[0];
        var bt = btn(t(a[1]), "pl-mini" + (on ? " is-on" : ""), function () { Br().setBeliefStatus(b, a[0]); A().renderHome(); U.announce(t("correct.thanks")); draw(); }, t(a[1]) + ": " + beliefText(b));
        if (a[0] !== "deleted") bt.setAttribute("aria-pressed", on ? "true" : "false");
        row.appendChild(bt);
      });
      li.appendChild(row); ul.appendChild(li);
    });
    s.appendChild(ul);
    s.appendChild(h("p", "pl-hint", t("learn.note")));
    return s;
  }

  function logSection() {
    var s = h("details", "pl-sec pl-log"), sm = h("summary", "pl-h", t("progress.log"));
    s.appendChild(sm);
    s.appendChild(h("p", "pl-hint", t("progress.logNote")));
    var ev = (A().repo.read("nc_br_events", []) || []).slice(-12).reverse(), ul = h("ul", "pl-list");
    ev.forEach(function (e) {
      var li = h("li", "pl-log-item"), m = e.m || {};
      li.textContent = new Date(e.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + " · " + e.e + " · v" + e.v + (m.state ? " · " + m.state : "") + (m.decision ? " · " + m.decision : "") + (m.reason ? " · " + m.reason : "");
      ul.appendChild(li);
    });
    if (!ev.length) ul.appendChild(h("li", "pl-hint", t("progress.logEmpty")));
    s.appendChild(ul);
    return s;
  }

  function draw() {
    var rootEl = document.getElementById("progress-root"); if (!rootEl) return;
    U.empty(rootEl);
    var hd = h("header", "pl-head"); hd.appendChild(h("p", "td-eyebrow", t("nav.progress"))); hd.appendChild(h("h1", "pl-title", t("progress.title"))); rootEl.appendChild(hd);
    rootEl.appendChild(todaySection()); rootEl.appendChild(weekSection()); rootEl.appendChild(learnedSection()); rootEl.appendChild(logSection());
  }

  root.NuraProgress = { render: render };
})(window);
