/* NURA localisation foundation.
 *
 * No component hard-codes English: every sentence is a key here. The Brain returns keys + params, the UI
 * calls t(). English is complete. Hindi, Urdu and Arabic currently cover the primary navigation and the core
 * actions only - they are NOT reviewed by a native speaker and missing keys fall back to English, never to blank.
 * Urdu and Arabic switch the document to RTL. Quran Arabic text is stored content and is never translated here.
 */
(function (root) {
  "use strict";

  var UNITS = {
    en: { questions: ["question", "questions"], pages: ["page", "pages"], sections: ["section", "sections"], items: ["item", "items"], minutes: ["minute", "minutes"], finish: ["task", "tasks"] }
  };
  var POINT = { questions: function (n) { return "Q" + n; }, pages: function (n) { return "page " + n; }, sections: function (n) { return "section " + n; }, items: function (n) { return "item " + n; } };

  var EN = {
    // ---- navigation / shell
    "nav.today": "Today", "nav.hamdard": "Hamdard", "nav.progress": "Progress", "nav.plan": "Plan",
    "act.start": "Start", "act.change": "Change", "act.notNow": "Not now", "act.why": "Why this?", "act.resume": "Resume", "act.changePlan": "Change plan",
    "act.wrap": "Wrap up", "act.finish": "Finish", "act.pause": "Pause", "act.continue": "Continue", "act.save": "Save", "act.cancel": "Cancel", "act.add": "Add", "act.done": "Done",
    "act.apply": "Apply", "act.keep": "Keep as is", "act.yes": "Yes", "act.show": "Show suggestion", "act.close": "Close", "act.prayed": "Prayed", "act.usePlan": "Use this plan",
    "act.correct": "Correct", "act.sometimes": "Sometimes", "act.wrong": "Wrong", "act.delete": "Delete this learning", "act.edit": "Edit",
    // ---- NURA Now
    "now.label.right": "RIGHT NOW", "now.label.resume": "WHEN YOU'RE READY", "now.label.salah": "SALAH", "now.label.calibrating": "LEARNING YOUR PACE", "now.label.session": "IN PROGRESS",
    "now.label.quiet": "ALL CLEAR", "now.label.noplan": "TODAY", "now.label.disrupted": "KEEPING IT REALISTIC",
    "now.salahIn": "{prayer} is in {mins} min.", "now.commitIn": "{title} starts in {mins} min.",
    "now.quiet": "Nothing needs you right now.", "now.snoozed": "Okay, I'll stay quiet for a while.",
    "now.target.units": "{units} {unit}", "now.target.time": "{mins} min focus block", "now.about": "~{mins} min", "now.fromPoint": "from {point}",
    "calibration.learning": "I'm still learning your pace.", "calibration.try": "Try a {mins}-minute session?",
    "tight.salah": "{prayer} is in {mins} min — a good moment to get ready.", "tight.commit": "{title} starts in {mins} min.", "tight.dayEnd": "The day is nearly done. Rest well.",
    "nothing.now": "Nothing needs you right now.", "noplan.empty": "No tasks yet. Add one in Plan and I'll size it to your day.",
    "busy.until": function (p, c) { return "You're busy until " + c.clock(p.endMin) + "."; },
    "disrupted.simplify": "Today got busier than planned. Let's keep it to one realistic thing.",
    "hint.routine": function (p, c) { return "No plan today. You usually " + (p.area === "study" ? "study" : p.area === "work" ? "work" : "do " + p.area) + " in the " + p.bucket + " on " + c.dow(p.dow) + "s. Keep that?"; },
    // ---- Salah transition
    "salah.prepare": "{prayer} is in {mins} min. Let's get ready.", "salah.now": "It's time for {prayer}.",
    "wrap.salah": "{prayer} is in {mins} min. Let's wrap {task} here.", "wrap.commitment": "{title} starts in {mins} min. Let's wrap {task} here.",
    "wrap.done": function (p, c) { return p.n > 0 ? "You completed " + p.n + " " + c.unit(p.unitType, p.n) + "." : "Your time is saved."; },
    "wrap.saved": function (p, c) { return p.n > 0 ? "Saved: " + p.n + " " + c.unit(p.unitType, p.n) + " done." : "Your progress is saved."; },
    "wrap.resumeFrom": function (p, c) { return POINT[p.unitType] ? "We'll resume from " + c.point(p.unitType, p.n) + "." : "We'll pick up where you left off."; },
    "resume.continue": function (p, c) { return "Continue " + p.title + (p.sub ? " — " + p.sub : "") + (POINT[p.unitType] ? " from " + c.point(p.unitType, p.n) : "") + "?"; },
    // ---- Why this?
    "why.title": "WHY THIS?",
    "why.deadline": function (p) { return p.when === "today" ? "Deadline: today." : p.when === "tomorrow" ? "Deadline: tomorrow." : p.when === "overdue" ? "It's past its deadline." : "Deadline in " + p.days + " days."; },
    "why.priority.high": "You marked this high priority.", "why.planned": "You chose it for today.", "why.inContainer": "You're in {name} hours.",
    "why.pace": function (p, c) { return "Your recent pace is " + (p.exact ? "about " + p.lo : "roughly " + p.lo + "–" + p.hi) + " min/" + c.unit1(p.unitType) + "." + (p.early ? " (Early estimate — " + p.n + " sessions so far.)" : p.confidence === "medium" ? " (Medium confidence.)" : " (Fairly steady.)"); },
    "why.calibrating": function (p) { return p.n >= 1 ? "Only " + p.n + " session so far — not enough to estimate your pace. I'll learn from this one." : "I haven't seen your pace on this yet. I'll learn from this session."; },
    "why.corrected": "Adjusted +{pct}% because you told me the estimate was off.",
    "why.usable": function (p) { return p.until ? "Usable time before " + p.until + ": " + p.usable + " min." : "Usable time left: " + p.usable + " min."; },
    "why.buffer": "{prayer} preparation protected: {buf} min.",
    "why.fit": function (p, c) { return "At that pace up to " + p.max + " " + c.unit(p.unitType, p.max) + " could fit; I suggested " + p.units + " and kept about " + p.marginPct + "% spare."; },
    "why.context": "{label} is active.", "why.disrupted": "Your day changed, so I'm keeping this to the one thing that fits.",
    "why.noPlan": "No plan was made today, so this comes from your tasks and routine.",
    "why.resume": function (p, c) { return "You wrapped for " + p.prayer + (POINT[p.unitType] ? "; this picks up at " + c.point(p.unitType, p.n) : "") + "."; },
    "why.pattern.tod": "You tend to do {area} better in the {bucket} (a pattern, not a fact).", "why.pattern.routine": "You often do {area} around this time (a pattern, not a fact).",
    "why.noMore": "That's everything I used.", "why.simpleMode": "Advanced sizing is off, so this is a plain focus block.",
    "why.wrong": "This isn't realistic",
    "correct.title": "What's off?", "correct.harder": "The task is harder today", "correct.estimate": "My pace estimate is wrong", "correct.energy": "Low energy today",
    "correct.priority": "My priority changed", "correct.unusual": "Unusual day", "correct.other": "Something else", "correct.thanks": "Thanks — I'll plan around that.",
    // ---- Today
    "today.flow": "Today Flow", "today.progress": "TODAY", "today.status.on": "On track", "today.status.adjust": "Plan needs adjustment",
    "today.summary": function (p) { return p.completed + " meaningful " + (p.completed === 1 ? "action" : "actions") + " completed" + (p.moved ? " · " + p.moved + " moved" : "") + " · " + p.remaining + " remaining"; },
    "flow.status.completed": "Completed", "flow.status.current": "Current", "flow.status.upcoming": "Upcoming", "flow.status.moved": "Moved", "flow.status.removed": "Removed",
    "flow.notMarked": "not marked yet", "flow.movedTo": "moved to {time}", "flow.now": "NOW", "flow.empty": "Nothing planned yet.", "flow.anytime": "Anytime today",
    "salah.next": "Next: {prayer} {time} · in {mins} min", "salah.setup": "Set your location for prayer times", "salah.markPrayed": "Mark as prayed",
    // ---- session
    "session.running": "In progress", "session.units": "{n} / {total} done", "session.progress": "{n} of {total} {unit} done", "session.progressOpen": "{n} {unit} done", "session.logUnit": "+1 {unit}", "session.howMany": "How much did you get done?",
    "session.difficulty": "How did it feel?", "diff.easy": "Easier than expected", "diff.ok": "About right", "diff.hard": "Harder than expected", "session.saved": "Saved. This helps me learn your pace.",
    // ---- Plan
    "plan.title": "Plan", "plan.confirm": "Confirm today", "plan.unusual": "Anything unusual today?", "plan.unusualPh": "e.g. Doctor 7 PM", "plan.routine": "Your usual day",
    "plan.tasks": "What matters today", "plan.addTask": "Add a task", "plan.salahLead": "Get ready before Salah", "plan.mode": "Temporary mode", "plan.addRoutine": "Add a routine",
    "plan.noRoutine": "No routines yet. Add work, gym, sleep and I'll prefill your days.", "plan.noTasks": "No tasks yet.",
    "plan.applied": "Plan confirmed.", "plan.auto": "Moved {label} to {time} to make room.", "plan.proposal": "Your schedule changed. I can move {labels} and keep the rest. Apply?",
    "plan.parseFail": "I couldn't find a time in that. Add one like “Doctor 7 PM”.",
    // ---- Progress / learning
    "progress.title": "How it's going", "learn.title": "What NURA has learned", "learn.empty": "Nothing learned yet. After a few real sessions, patterns appear here — and you can correct any of them.",
    "learn.pace": function (p, c) { return "Your recent pace on " + p.title + " is " + (p.exact ? "about " + p.lo : "roughly " + p.lo + "–" + p.hi) + " min/" + c.unit1(p.unitType) + "."; },
    "learn.tod": function (p) { return "You seem to do " + p.area + " better in the " + p.bucket + "."; },
    "learn.routine": function (p, c) { return "You often do " + p.area + " in the " + p.bucket + " on " + c.dow(p.dow) + "s."; },
    "learn.conf.low": "Early estimate", "learn.conf.medium": "Medium confidence", "learn.conf.higher": "Fairly steady",
    // ---- Salah explain
    "salah.explain.title": "Why this prayer time?",
    "salah.explain.method": "Method: {name} (Fajr {fajr}°, {isha}).", "salah.explain.asr.standard": "Asr: standard (shadow = object length).", "salah.explain.asr.hanafi": "Asr: Hanafi (shadow = twice the object length) — later than standard.",
    "salah.explain.offsets": "Your manual adjustments: {list}.", "salah.explain.noOffsets": "No manual adjustments.", "salah.explain.location": "Location used: {lat}, {lon}.",
    "salah.explain.tzMismatch": "The saved location's time zone differs from this device's — times follow the device clock.", "salah.explain.highLat": "At this latitude Fajr/Isha don't occur normally; a night-portion rule is used.",
    "salah.explain.source.device": "Calculated on this device, no internet needed.", "salah.explain.source.cache": "Taken from the last online lookup.",
    "salah.explain.differences": "Local mosques may use a different method or fixed timetable, so a few minutes' difference is normal. You can add an offset.",
    // ---- Today screen
    "td.greet": "Assalamu Alaikum", "td.day": "DAY {n}", "td.sunnah": "Quran & Sunnah", "td.more": "Profile and more", "td.flowLink": "Daily Flow ›", "td.earlier": "{n} done earlier",
    "now.noPlan": "No plan today.", "now.makePlan": "Make a plan", "now.addTask": "Add a task", "now.keepGoing": "Keep going for now", "now.willPause": "I'll pause it automatically at prayer time.",
    "now.paused": "Paused", "now.timeUp": "That's your planned time — finish when you're ready.", "now.planned": "planned ~{mins} min",
    "now.unitName": function (p, c) { return c.unit(p.unitType, p.n); },
    "sess.finishTitle": "Finish session", "sess.markTaskDone": "This task is completely done", "sess.didntGetTo": "I didn't get to it", "err.number": "Enter a whole number, 0 or more.",
    "salah.setupTitle": "Prayer times", "salah.privacy": "Your location is used only to calculate prayer times on this device.", "salah.city": "City", "salah.country": "Country",
    "salah.needBoth": "Enter both city and country.", "salah.adjust": "Adjust prayer settings", "salah.allow": "Allow location", "salah.enterCity": "Enter city", "salah.loading": "Looking up prayer times…",
    "salah.loadFail": "Couldn't look up your city's prayer times (this needs internet once).", "act.retry": "Try again", "salah.nextTomorrow": "Next: {prayer} {time} tomorrow", "salah.why": "Why this time?", "salah.onlineNote": "online times",
    "flow.markDone": "Mark done", "flow.markNot": "Mark not done", "flow.movedFrom": "moved from {time}",
    // ---- Plan screen
    "plan.usual": "usual", "plan.today": "today only", "plan.restore": "Restore", "plan.notToday": "Not today", "plan.dayEnds": "Day ends at", "plan.routinePh": "e.g. Office, Gym, College", "plan.days": "Days",
    "plan.from": "From", "plan.to": "To", "plan.routineNeeds": "Add a name, at least one day and a start time.", "plan.remaining": "{n} {unit} left", "plan.due": "due {date}",
    "plan.tasksHint": "Tick what you want to focus on today. NURA sizes it to your time.", "plan.focusToday": "Focus today", "plan.todayAmount": "Today: {n} {unit}", "plan.options": "Options",
    "plan.markDone": "Mark task done", "plan.remove": "Remove task", "area.study": "Study", "area.work": "Work", "area.personal": "Personal",
    "unit.questions": "Questions", "unit.pages": "Pages", "unit.sections": "Sections", "unit.items": "Items", "unit.minutes": "Minutes (time only)", "unit.finish": "Just finish it",
    "err.title": "Give it a name (up to 80 characters).", "err.area": "Choose an area.", "err.unitType": "Choose how you'll count it.", "err.target": "Set a whole-number target.", "err.deadline": "Use a valid date.",
    "err.priority": "Pick a priority.", "err.sub": "Keep the chapter / part short.", "plan.taskPh": "e.g. Physics", "plan.subPh": "Chapter / part (optional), e.g. Chapter 5", "plan.area": "Area",
    "plan.unitType": "How do you count it?", "plan.targetPh": "Total target (e.g. 20)", "plan.target": "Target", "plan.deadline": "Deadline", "plan.deadlineOpt": "Deadline (optional)", "plan.priority": "Priority",
    "plan.prHigh": "High", "plan.prNormal": "Normal", "plan.prLow": "Low", "plan.addedEvent": "Added {name} at {time}.", "plan.proposalAnnounce": "Your schedule changed. Review the suggestion.",
    "plan.cantFit": "{label} doesn't fit today", "plan.overlap": "{a} overlaps {b}. Tap “Not today” on whichever won't happen.", "plan.moveLine": function (p, c) { return p.label + ": " + c.clock(p.from) + " → " + c.clock(p.to); }, "plan.applied2": "Done — your day is updated.",
    "plan.kept": "Okay, I left the rest as it was.", "plan.salahLeadHint": "How long before Salah should I start helping you wrap up?", "plan.min": "{n} min", "plan.custom": "Custom", "plan.customPrompt": "Minutes before Salah (1–45):",
    "mode.exam": "Exam week", "mode.travel": "Travel", "mode.ramadan": "Ramadan", "mode.temp": "Special schedule", "mode.workweek": "Busy work week",
    "plan.modeHint": "A temporary mode shapes today's suggestions without changing what NURA has learned about your normal days.", "plan.until": "until {date}", "plan.noEnd": "No end date", "plan.endMode": "End",
    "plan.modeNote": "NURA will treat this period separately from your normal pattern.", "plan.forDays": "For {n} days", "plan.timeline": "Full day timeline ›", "plan.tasksTitle": "What matters today",
    "salah.settings": "Prayer time settings", "salah.locUsed": "Location: {lat}, {lon}", "salah.noCoords": "No coordinates saved yet — using the last online lookup.", "salah.method": "Calculation method",
    "salah.asrMethod": "Asr method", "salah.asr.standard": "Standard", "salah.asr.hanafi": "Hanafi", "salah.asrNote": "Hanafi Asr is later (shadow twice the object). Choose what you or your local mosque follows.",
    "salah.offsets": "Adjust by minutes (to match your mosque)", "salah.offsetNote": "Between −30 and +30 minutes per prayer. Leave 0 to use the calculation as is.",
    "language.title": "Language", "language.note": "Translations are partial and not yet reviewed by native speakers.",
    // ---- Progress screen
    "progress.title": "How it's going", "progress.today": "Today", "progress.week": "This week", "progress.openFlow": "Open the weekly grid ›", "progress.noSessions": "No focus sessions yet this week.",
    "progress.weekLine": "{sessions} focus sessions · {mins} min · {days} days", "learn.calibrating": "Still learning your pace for {title} ({n} sessions so far — I need a couple more).",
    "learn.sessions": "{n} sessions", "learn.evidence": "seen on {n} occasions", "learn.youSaid": "You said: {what}",
    "learn.note": "These are guesses from your own sessions, never facts. Correct them, soften them, or delete them any time. Temporary modes like exam week are kept out of them.",
    "progress.log": "What NURA decided (log)", "progress.logNote": "Local only. Shows the Brain version and the decision, never your text.", "progress.logEmpty": "Nothing logged yet.",
    // ---- More
    "more.explore": "Explore", "more.sunnah": "Quran & Sunnah", "more.duniya": "Duniya tools", "more.flow": "Daily Flow", "more.timeline": "Plan My Day timeline", "more.memory": "What NURA knows about my routine",
    "more.privacy": "Privacy", "more.privacyNote": "Everything stays on this device. Nothing is uploaded, and NURA's recommendations are calculated here without any AI service.",
    // ---- generic
    "err.generic": "Something didn't work. Your data is safe.", "ai.unavailable": "Advanced reasoning is temporarily unavailable."
  };

  var HI = { "nav.today": "आज", "nav.hamdard": "हमदर्द", "nav.progress": "प्रगति", "nav.plan": "योजना", "act.start": "शुरू करें", "act.change": "बदलें", "act.notNow": "अभी नहीं", "act.why": "यह क्यों?", "act.resume": "फिर शुरू करें", "act.save": "सहेजें", "act.cancel": "रद्द करें", "act.done": "हो गया", "act.yes": "हाँ" };
  var UR = { "nav.today": "آج", "nav.hamdard": "ہمدرد", "nav.progress": "پیش رفت", "nav.plan": "منصوبہ", "act.start": "شروع کریں", "act.change": "تبدیل کریں", "act.notNow": "ابھی نہیں", "act.why": "یہ کیوں؟", "act.resume": "دوبارہ شروع کریں", "act.save": "محفوظ کریں", "act.cancel": "منسوخ کریں", "act.done": "ہو گیا", "act.yes": "ہاں" };
  var AR = { "nav.today": "اليوم", "nav.hamdard": "همدرد", "nav.progress": "التقدم", "nav.plan": "الخطة", "act.start": "ابدأ", "act.change": "غيّر", "act.notNow": "ليس الآن", "act.why": "لماذا هذا؟", "act.resume": "استئناف", "act.save": "حفظ", "act.cancel": "إلغاء", "act.done": "تم", "act.yes": "نعم" };
  var DICTS = { en: EN, hi: HI, ur: UR, ar: AR };
  var RTL = { ur: 1, ar: 1 };
  var DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var lang = "en";

  function unit(type, n) { var u = UNITS.en[type]; return u ? (n === 1 ? u[0] : u[1]) : "items"; }
  function unit1(type) { var u = UNITS.en[type]; return u ? u[0] : "item"; }
  function clock(min) { min = ((Math.round(min) % 1440) + 1440) % 1440; var h = Math.floor(min / 60), m = min % 60, ap = h >= 12 ? "PM" : "AM", h12 = h % 12 || 12; return h12 + ":" + String(m).padStart(2, "0") + " " + ap; }
  var CTX = { unit: unit, unit1: unit1, clock: clock, point: function (type, n) { return POINT[type] ? POINT[type](n) : String(n); }, dow: function (d) { return DOW[d] || ""; } };

  function t(key, p) {
    p = p || {};
    var d = DICTS[lang] || EN, v = d[key] !== undefined ? d[key] : EN[key];
    if (v === undefined) return key; // a missing key is visible in testing and never throws
    if (typeof v === "function") return v(p, CTX);
    return v.replace(/\{(\w+)\}/g, function (m, name) {
      if (name === "unit") return p.unitType ? unit(p.unitType, p.units !== undefined ? p.units : p.n) : "";
      if (name === "time" && typeof p.time === "number") return clock(p.time);
      return p[name] !== undefined ? String(p[name]) : m;
    });
  }
  function setLang(l) {
    lang = DICTS[l] ? l : "en";
    if (typeof document !== "undefined") { document.documentElement.lang = lang; document.documentElement.dir = RTL[lang] ? "rtl" : "ltr"; }
    return lang;
  }

  var api = { t: t, setLang: setLang, getLang: function () { return lang; }, isRTL: function () { return !!RTL[lang]; }, clock: clock, unit: unit, point: CTX.point, LANGS: ["en", "hi", "ur", "ar"], keys: function () { return Object.keys(EN); } };
  root.NuraI18n = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
