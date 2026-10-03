/* Small shared UI helpers for the Sprint 1 screens. All user-visible text goes through NuraI18n.t(). */
(function (root) {
  "use strict";

  var I18 = root.NuraI18n;
  function t(k, p) { return I18.t(k, p); }
  function msgText(m) { return I18.t(m.k, m.p); }

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) { e.textContent = text; if (text && /^(p|h1|h2|h3|span|li|label)$/.test(tag)) e.setAttribute("dir", "auto"); } // mixed-language text keeps its own direction
    return e;
  }
  function btn(label, cls, fn, aria) {
    var b = h("button", cls, label); b.type = "button";
    if (aria) b.setAttribute("aria-label", aria);
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function clock(min) { return I18.clock(min); }
  function empty(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  // ---- one reusable bottom sheet (focus-managed, Escape closes) ----
  var overlay = null, sheetEl = null, lastFocus = null;
  function ensureSheet() {
    if (overlay) return;
    overlay = h("div", "modal-overlay s1-overlay hidden"); overlay.id = "s1-overlay";
    sheetEl = h("div", "modal-sheet s1-sheet"); sheetEl.setAttribute("role", "dialog"); sheetEl.setAttribute("aria-modal", "true");
    overlay.appendChild(sheetEl); document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeSheet(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeSheet(); });
  }
  function sheet(title, build) {
    ensureSheet();
    lastFocus = document.activeElement;
    empty(sheetEl);
    var head = h("div", "s1-sheet-head"), hd = h("h2", "", title); hd.id = "s1-sheet-title";
    sheetEl.setAttribute("aria-labelledby", "s1-sheet-title");
    var x = btn("✕", "icon-btn", closeSheet, t("act.close")); head.appendChild(hd); head.appendChild(x); sheetEl.appendChild(head);
    build(sheetEl, closeSheet);
    overlay.classList.remove("hidden");
    var f = sheetEl.querySelector("input,select,textarea,button:not(.icon-btn)"); if (f) setTimeout(function () { f.focus(); }, 40);
    return closeSheet;
  }
  function closeSheet() {
    if (!overlay) return;
    overlay.classList.add("hidden");
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) { /* element gone */ }
  }
  function sheetOpen() { return !!overlay && !overlay.classList.contains("hidden"); }

  // polite screen-reader announcements for state changes
  var live = null;
  function announce(text) {
    if (!live) { live = h("div", "sr-only"); live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite"); document.body.appendChild(live); }
    live.textContent = ""; setTimeout(function () { live.textContent = text; }, 30);
  }

  function chips(options, selected, onPick, label) {
    var row = h("div", "s1-chips"); row.setAttribute("role", "radiogroup"); if (label) row.setAttribute("aria-label", label);
    options.forEach(function (o) {
      var c = h("button", "s1-chip" + (selected === o.v ? " is-on" : ""), o.label); c.type = "button"; c.setAttribute("role", "radio"); c.setAttribute("aria-checked", selected === o.v ? "true" : "false");
      c.addEventListener("click", function () { onPick(o.v); }); row.appendChild(c);
    });
    return row;
  }

  root.NuraUI = { t: t, msgText: msgText, h: h, btn: btn, clock: clock, empty: empty, sheet: sheet, closeSheet: closeSheet, sheetOpen: sheetOpen, announce: announce, chips: chips };
})(window);
