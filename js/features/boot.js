/* Feature registry + startup. app.js calls NuraFeatures.init() once the DOM is ready, and NuraFeatures.render(name)
 * whenever a screen should repaint. Also builds the "More" cards (supporting screens that left the primary nav). */
(function (root) {
  "use strict";

  var U = root.NuraUI, I18 = root.NuraI18n;
  function A() { return root.NuraApp; }
  var t = U.t, h = U.h, btn = U.btn;

  function applyLang() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    document.querySelectorAll(".nav-btn[data-nav]").forEach(function (b) {
      var span = b.querySelector("[data-i18n]"); if (span) b.setAttribute("aria-label", span.textContent);
    });
    var more = document.getElementById("s1-more-cards"); if (more) buildMore();
  }

  function buildMore() {
    var host = document.getElementById("s1-more-cards"); if (!host) return;
    U.empty(host);
    var card = h("section", "card"); card.appendChild(h("h2", "", t("more.explore")));
    [["more.sunnah", "sunnah"], ["more.duniya", "duniya"], ["more.flow", "flow"], ["more.timeline", "duniya-plan"], ["more.memory", "memory"]].forEach(function (x) {
      card.appendChild(btn(t(x[0]), "btn btn-outline btn-full", function () { if (x[1] === "flow") A().openFlow("today"); else A().setActiveView(x[1]); }));
    });
    host.appendChild(card);
    var salah = h("section", "card"); salah.appendChild(h("h2", "", t("salah.settings")));
    salah.appendChild(btn(t("salah.settings"), "btn btn-outline btn-full", function () { root.NuraPlan.openSalahSettings(); }));
    salah.appendChild(btn(t("salah.why"), "btn btn-outline btn-full", function () { root.NuraToday.explainSheet(); }));
    host.appendChild(salah);
    var priv = h("section", "card"); priv.appendChild(h("h2", "", t("more.privacy")));
    priv.appendChild(h("p", "muted-line", t("more.privacyNote")));
    host.appendChild(priv);
  }

  function injectMore() {
    var more = document.getElementById("view-more"); if (!more || document.getElementById("s1-more-cards")) return;
    var host = h("div", ""); host.id = "s1-more-cards";
    var profile = more.querySelector("section.card"); if (profile && profile.nextSibling) more.insertBefore(host, profile.nextSibling); else more.appendChild(host);
    buildMore();
  }

  var started = false;
  function init() {
    if (started) return; started = true;
    I18.setLang(A().repo.settings().lang || "en");
    injectMore(); applyLang();
    if (root.NuraToday) root.NuraToday.init();
    try { A().repo.migrate(); } catch (e) { /* already current */ }
  }
  function render(name) {
    if (!started) return;
    try {
      if (name === "today" && root.NuraToday) root.NuraToday.render();
      else if (name === "plan" && root.NuraPlan) root.NuraPlan.render();
      else if (name === "progress" && root.NuraProgress) root.NuraProgress.render();
    } catch (e) {
      var rep = root.NuraPlatform.report(e, { where: "render." + name });
      try { console.warn("[NURA]", JSON.stringify(rep.dev)); } catch (x) { /* ignore */ }
    }
  }

  root.NuraFeatures = { init: init, render: render, applyLang: applyLang };
})(window);
