(function () {
  "use strict";

  // ---------- BASELINE STORAGE NAMESPACE ----------
  // This build is served from the same github.io origin as the current NURA, and browsers
  // share localStorage per origin (not per path). Every key this app reads or writes goes
  // through this view, which prefixes it with "p20_" — so the two apps can never read,
  // overwrite or delete each other's data. Inside this file the keys still look like
  // "nc_..." exactly as they did in the original code.
  var localStorage = (function () {
    var real = window.localStorage, P = "p20_";
    function mine() {
      var out = [];
      for (var i = 0; i < real.length; i++) {
        var k = real.key(i);
        if (k && k.indexOf(P) === 0) out.push(k.slice(P.length));
      }
      return out;
    }
    return {
      getItem: function (k) { return real.getItem(P + k); },
      setItem: function (k, v) { real.setItem(P + k, v); },
      removeItem: function (k) { real.removeItem(P + k); },
      key: function (i) { var m = mine(); return i < m.length ? m[i] : null; },
      get length() { return mine().length; },
      clear: function () { mine().forEach(function (k) { real.removeItem(P + k); }); }
    };
  })();

  // ---------- UTIL ----------

  function todayKey(d) {
    d = d || new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function tomorrowKey() {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    return todayKey(d);
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // storage unavailable — fail silently, nothing to persist
    }
  }

  function showToast(msg) {
    var toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.classList.remove("hidden");
    setTimeout(function () {
      toast.classList.add("hidden");
    }, 1800);
  }

  // ---------- SPRINT 1: repository, feature flags, analytics ----------
  // The Brain, Salah layer, capacity model etc. live in js/core/* (pure, tested in lab.html). Everything below
  // only wires them to this app's storage. All Brain data is namespaced nc_br_* and goes through migrations.
  var BR = window.NuraRepo.create(localStorage, { env: window.NuraPlatform.detectEnv(location.hostname).name });
  BR.migrate();
  var BR_FLAGS = window.NuraPlatform.makeFlags(BR.read("nc_br_flags", {}));
  var BR_ANALYTICS = window.NuraPlatform.makeAnalytics({ read: function () { return BR.read("nc_br_events", []); }, write: function (l) { BR.write("nc_br_events", l); } }, function () { return new Date(); });
  function track(name, meta) { try { BR_ANALYTICS.track(name, meta); } catch (e) { /* analytics must never break a feature */ } }
  window.NuraI18n.setLang(BR.settings().lang || "en");

  var uidSeq = 0;
  function uid(prefix) {
    // the counter keeps ids unique even when several are made in the same millisecond
    return prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 1000) + "-" + (uidSeq++);
  }

  // ---------- CHANGE JOURNEY DAY ----------
  // Calendar days since the user's first day, +1. Never a streak: never
  // reset by a missed day, never dependent on habit completion.

  function ensureJourneyStarted() {
    if (!localStorage.getItem("nc_journey_start")) {
      localStorage.setItem("nc_journey_start", todayKey());
    }
  }

  function getJourneyDay() {
    var startKey = localStorage.getItem("nc_journey_start") || todayKey();
    var start = new Date(startKey + "T00:00:00");
    var now = new Date(todayKey() + "T00:00:00");
    var diffDays = Math.round((now - start) / 86400000);
    return Math.max(1, diffDays + 1);
  }

  function getLastNDateKeys(n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      out.push(todayKey(d));
    }
    return out;
  }

  // ---------- PRAYER TIMES ----------
  // Powers the Salah Consistency priority. Times come from Aladhan
  // (api.aladhan.com), a free, keyless, widely-used prayer-times API —
  // same "legitimate public API, no secret keys in client code" pattern
  // already used for Quran translations and ruku numbers. Never hard-coded
  // to one city: either the user's coordinates (with consent) or a
  // manually entered city/country, both re-fetched per local day.

  var PRAYER_ORDER = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
  var PRAYER_METHODS = [
    { id: 1, label: "Karachi (Hanafi)" },
    { id: 3, label: "Muslim World League" },
    { id: 2, label: "ISNA" },
    { id: 4, label: "Umm al-Qura" },
    { id: 5, label: "Egyptian" },
    { id: 11, label: "Singapore" }
  ];

  function getPrayerSettings() {
    return readJSON("nc_prayer_settings", null);
  }

  function savePrayerSettings(s) {
    writeJSON("nc_prayer_settings", s);
  }

  function cleanTimeStr(t) {
    return (t || "").split(" ")[0];
  }

  // ---- Salah Trust Layer wiring ----
  // Times are calculated ON THE DEVICE (js/core/salah.js) whenever coordinates are known: deterministic, offline,
  // and explainable. Aladhan is only used once to turn a typed city into coordinates (and as a last-resort cache).
  // Explicit settings: calculation method (above), Asr method + per-prayer offsets (nc_br_settings.salah).
  function salahLocation(s) {
    s = s || getPrayerSettings();
    if (!s) return null;
    if (s.mode === "auto" && isFinite(s.lat) && isFinite(s.lon)) return { lat: s.lat, lon: s.lon, src: "gps" };
    var r = readJSON("nc_br_location", null);
    if (s.mode === "manual" && r && r.sig === s.city + "," + s.country && isFinite(r.lat)) return { lat: r.lat, lon: r.lon, src: "city", tz: r.tz };
    return null;
  }
  function pick5(map) { var o = {}; PRAYER_ORDER.forEach(function (n) { o[n] = map[n]; }); return o; }
  function minToHHMM(m) { return window.NuraSalah.hhmm(m); }
  // UTC offset (minutes) of an IANA zone on a date; null when the zone can't be resolved on this device.
  function ianaOffsetMin(tz, dateKey) {
    try {
      var parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date(dateKey + "T12:00:00Z"));
      var name = parts.filter(function (p) { return p.type === "timeZoneName"; })[0].value, m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name);
      return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
    } catch (e) { return null; }
  }
  // -> {hhmm, minutes, source:'device'|'cache', result, loc, tzOffsetMin} or null when no times can be known
  function salahTimingsFor(dateKey) {
    var s = getPrayerSettings();
    if (!s) return null;
    var bs = BR.settings().salah, loc = salahLocation(s);
    var d = dateKey.split("-"), tz = -new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2]), 12).getTimezoneOffset();
    if (loc) {
      var r = window.NuraSalah.compute({ dateKey: dateKey, lat: loc.lat, lon: loc.lon, tzOffsetMin: tz, method: s.method || 1, asr: bs.asr, offsets: bs.offsets });
      if (r.ok) return { hhmm: pick5(r.hhmm), minutes: pick5(r.times), source: "device", result: r, loc: loc, tzOffsetMin: tz, locTzOffsetMin: loc.tz ? ianaOffsetMin(loc.tz, dateKey) : null };
    }
    var c = readJSON("nc_prayer_times_cache", null);
    if (c && c.date === dateKey && c.timings) {
      var mins = {}, hh = {};
      PRAYER_ORDER.forEach(function (n) { var m = window.NuraSalah.fromHHMM(c.timings[n]); if (m !== null) { m += Number(bs.offsets[n]) || 0; mins[n] = m; hh[n] = minToHHMM(m); } });
      return { hhmm: hh, minutes: mins, source: "cache", result: null, loc: loc, tzOffsetMin: tz };
    }
    return null;
  }

  function fetchPrayerTimesForToday(forceRefresh) {
    var settings = getPrayerSettings();
    if (!settings) return Promise.reject(new Error("no prayer settings"));
    var local = salahTimingsFor(todayKey());
    if (local && local.source === "device") return Promise.resolve(local.hhmm); // calculated here: no network, nothing to fetch
    var sig = settings.mode === "auto"
      ? (settings.lat.toFixed(2) + "," + settings.lon.toFixed(2) + ",m" + settings.method)
      : (settings.city + "," + settings.country + ",m" + settings.method);
    var cache = readJSON("nc_prayer_times_cache", null);
    if (!forceRefresh && cache && cache.date === todayKey() && cache.signature === sig) {
      return Promise.resolve(local ? local.hhmm : cache.timings);
    }
    var school = BR.settings().salah.asr === "hanafi" ? "&school=1" : "";
    var url = settings.mode === "auto"
      ? "https://api.aladhan.com/v1/timings?latitude=" + settings.lat + "&longitude=" + settings.lon + "&method=" + settings.method + school
      : "https://api.aladhan.com/v1/timingsByCity?city=" + encodeURIComponent(settings.city) + "&country=" + encodeURIComponent(settings.country) + "&method=" + settings.method + school;
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("prayer times fetch failed");
      return res.json();
    }).then(function (data) {
      var t = data.data.timings;
      var timings = {
        Fajr: cleanTimeStr(t.Fajr), Dhuhr: cleanTimeStr(t.Dhuhr), Asr: cleanTimeStr(t.Asr),
        Maghrib: cleanTimeStr(t.Maghrib), Isha: cleanTimeStr(t.Isha)
      };
      writeJSON("nc_prayer_times_cache", { date: todayKey(), signature: sig, timings: timings });
      var meta = data.data.meta;
      if (settings.mode === "manual" && meta && isFinite(meta.latitude) && isFinite(meta.longitude)) {
        // remember where the city is: from now on times are calculated on this device, with or without internet
        writeJSON("nc_br_location", { sig: sig.split(",m")[0], lat: Number(meta.latitude), lon: Number(meta.longitude), tz: meta.timezone || null });
      }
      var after = salahTimingsFor(todayKey());
      return after ? after.hhmm : timings;
    });
  }

  function parseTimeToday(hhmm, dayOffset) {
    var parts = hhmm.split(":");
    var d = new Date();
    if (dayOffset) d.setDate(d.getDate() + dayOffset);
    d.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
    return d;
  }

  function getNextPrayer(timings) {
    var now = new Date();
    for (var i = 0; i < PRAYER_ORDER.length; i++) {
      var name = PRAYER_ORDER[i];
      var t = parseTimeToday(timings[name]);
      if (t > now) return { name: name, time: t };
    }
    return { name: "Fajr", time: parseTimeToday(timings.Fajr, 1), tomorrow: true };
  }

  function getSalahCompletions() {
    var all = readJSON("nc_salah_completions", {});
    return all[todayKey()] || {};
  }

  function setSalahComplete(name) {
    var all = readJSON("nc_salah_completions", {});
    var today = todayKey();
    all[today] = all[today] || {};
    all[today][name] = true;
    writeJSON("nc_salah_completions", all);
  }

  function requestLocationForPrayerTimes() {
    if (!navigator.geolocation) {
      showToast("Location isn't available on this device — use manual setup instead");
      return;
    }
    showToast("Getting your location…");
    navigator.geolocation.getCurrentPosition(function (pos) {
      savePrayerSettings({ mode: "auto", lat: pos.coords.latitude, lon: pos.coords.longitude, method: 1 });
      renderHome();
    }, function () {
      showToast("Location permission denied — use manual setup instead");
    }, { timeout: 10000 });
  }

  // ---------- FITNESS CONTENT ----------
  // Original, beginner-friendly warm-up + workout suggestions per body
  // part — generic exercise names, not copied from any specific program.

  var FITNESS_BODY_PARTS = [
    { key: "full", label: "Full Body", warmup: ["Arm circles", "Bodyweight squats x10", "Torso twists", "Jumping jacks x15"], workout: ["Squats", "Push-ups", "Plank hold", "Lunges", "Mountain climbers"] },
    { key: "chest", label: "Chest", warmup: ["Arm circles", "Shoulder rotations", "Wall chest stretch", "Light push-ups x5"], workout: ["Push-ups", "Incline push-ups", "Chest squeeze hold", "Wide push-ups"] },
    { key: "back", label: "Back", warmup: ["Cat-cow stretch", "Shoulder rolls", "Standing back extension", "Arm swings"], workout: ["Superman hold", "Reverse snow angels", "Door-frame rows", "Bird-dog"] },
    { key: "legs", label: "Legs", warmup: ["Leg swings", "Bodyweight squats x10", "Ankle circles", "Hip circles"], workout: ["Squats", "Lunges", "Calf raises", "Wall sit"] },
    { key: "shoulders", label: "Shoulders", warmup: ["Arm circles", "Shoulder rolls", "Cross-body arm stretch", "Neck tilts"], workout: ["Pike push-ups", "Arm raises", "Shoulder taps", "Plank shoulder circles"] },
    { key: "arms", label: "Arms", warmup: ["Arm circles", "Wrist rotations", "Triceps stretch", "Light push-ups x5"], workout: ["Push-ups", "Triceps dips (chair)", "Diamond push-ups", "Arm pulses"] },
    { key: "core", label: "Core", warmup: ["Torso twists", "Cat-cow stretch", "Standing side bends", "Hip circles"], workout: ["Plank hold", "Bicycle crunches", "Leg raises", "Side plank"] },
    { key: "mobility", label: "Mobility", warmup: ["Neck tilts", "Shoulder rolls", "Hip circles", "Ankle circles"], workout: ["Deep squat hold", "World's greatest stretch", "Cat-cow flow", "Standing forward fold"] },
    { key: "stretch", label: "Stretching", warmup: [], workout: ["Standing forward fold", "Quad stretch", "Hamstring stretch", "Child's pose", "Chest opener stretch"] }
  ];

  // ---------- TODAY'S PRIORITY ----------
  // Core loop: CHOOSE (one priority) -> DO (Start Now) -> TRACK -> REVIEW
  // (next-day accountability, realistic adjustment) -> REPEAT. No streaks,
  // no reset-mode, no multi-item checklist.

  var PRESET_PLANS = [
    { key: "study", label: "Study Focus", kind: "study", why: "You chose Study Focus as what matters most today.", actionTitle: null, minutes: null },
    { key: "sleep", label: "Better Sleep", kind: "sleep", why: "You chose Better Sleep as what matters most today.", actionTitle: null, minutes: null },
    { key: "phone", label: "Reduce Phone Use", kind: "phone", why: "You chose Reduce Phone Use as what matters most today.", actionTitle: null, minutes: null },
    { key: "salah", label: "Salah Consistency", kind: "salah", why: "You chose Salah Consistency as what matters most today.", actionTitle: "Stay on top of today's prayers", minutes: null },
    { key: "fitness", label: "Fitness Basics", kind: "fitness", why: "You chose Fitness Basics as what matters most today.", actionTitle: null, minutes: null },
    { key: "morning", label: "Morning Routine", kind: null, why: "You chose Morning Routine as what matters most today.", actionTitle: "Do your full morning routine", minutes: 15 }
  ];

  var PHONE_DISTRACTIONS = ["Instagram / Reels", "YouTube", "Gaming", "Messaging", "Browsing", "General scrolling", "Other"];
  var PHONE_REPLACEMENTS = ["Study", "Walk", "Exercise", "Read Quran", "Read a book", "Complete a task", "Rest"];
  var STUDY_PREP_ITEMS = ["Turn on Do Not Disturb / Focus Mode", "Put distracting apps away", "Keep only your study material ready", "Choose what you are studying"];
  var SLEEP_PREP_ITEMS = ["Put phone on charge away from bed", "Dim the lights", "Brush / wash / make wudu", "Stop scrolling", "Prepare the room", "Set morning alarm"];

  var pendingAdjustmentNote = null;
  var focusPrepShownForPriorityId = null;
  var focusPrepPendingStart = false;

  function parseMinutesFromTitle(title) {
    var m = title.match(/(\d+)\s*min/i);
    return m ? Number(m[1]) : null;
  }

  function getCurrentPriority() {
    return readJSON("nc_priority_current", null);
  }

  function savePriority(p) {
    writeJSON("nc_priority_current", p);
  }

  function appendPriorityLog(entry) {
    var log = readJSON("nc_priority_log", []);
    log.push(entry);
    writeJSON("nc_priority_log", log);
    if (entry && entry.planKey === "study") {
      memLog(entry.status === "not-yet" ? "task_skipped" : "study_completed", "study", { minutes: entry.minutes, result: entry.status, forDate: entry.date });
    }
  }

  function setTodaysPriority(planKey, customTitle) {
    var plan = planKey ? PRESET_PLANS.find(function (pl) { return pl.key === planKey; }) : null;
    var p;
    if (plan) {
      p = { id: uid("pri"), planKey: plan.key, kind: plan.kind, title: plan.actionTitle, why: plan.why, minutes: plan.minutes, date: todayKey(), status: "pending" };
    } else {
      var title = customTitle.trim();
      p = { id: uid("pri"), planKey: null, kind: null, title: title, why: "You chose this as what matters most today.", minutes: parseMinutesFromTitle(title), date: todayKey(), status: "pending" };
    }
    savePriority(p);
    focusState.linkedPriorityId = null;
    focusPrepShownForPriorityId = null;
    return p;
  }

  function setTodaysStudyPriority(minutes) {
    var plan = PRESET_PLANS.find(function (pl) { return pl.key === "study"; });
    var p = { id: uid("pri"), planKey: "study", kind: "study", title: "Study Focus — " + minutes + " minutes", why: plan.why, minutes: minutes, date: todayKey(), status: "pending" };
    savePriority(p);
    focusState.linkedPriorityId = null;
    focusPrepShownForPriorityId = null;
    return p;
  }

  function setTodaysFitnessPriority(bodyPartKey, minutes) {
    var bp = FITNESS_BODY_PARTS.find(function (b) { return b.key === bodyPartKey; });
    var plan = PRESET_PLANS.find(function (pl) { return pl.key === "fitness"; });
    var p = { id: uid("pri"), planKey: "fitness", kind: "fitness", title: "Fitness Basics — " + bp.label, why: plan.why, minutes: minutes, bodyPart: bodyPartKey, warmupDone: false, date: todayKey(), status: "pending" };
    savePriority(p);
    focusState.linkedPriorityId = null;
    focusPrepShownForPriorityId = null;
    return p;
  }

  function setTodaysPhonePriority(distraction, minutes, replacement) {
    var plan = PRESET_PLANS.find(function (pl) { return pl.key === "phone"; });
    var p = { id: uid("pri"), planKey: "phone", kind: "phone", title: "Phone-Free Session — " + replacement, why: plan.why, minutes: minutes, distraction: distraction, replacement: replacement, date: todayKey(), status: "pending" };
    savePriority(p);
    focusState.linkedPriorityId = null;
    focusPrepShownForPriorityId = null;
    return p;
  }

  function setTodaysSleepPriority(bedtime) {
    var plan = PRESET_PLANS.find(function (pl) { return pl.key === "sleep"; });
    var p = {
      id: uid("pri"), planKey: "sleep", kind: "sleep", title: "Better Sleep — target " + bedtime, why: plan.why,
      minutes: null, targetBedtime: bedtime, sleepStart: new Date().toISOString(), wakeTime: null,
      date: todayKey(), status: "pending"
    };
    savePriority(p);
    memLog("sleep_started", "sleep", { min: new Date().getHours() * 60 + new Date().getMinutes() });
    focusState.linkedPriorityId = null;
    focusPrepShownForPriorityId = null;
    return p;
  }

  function setTodaysSalahPriority() {
    var plan = PRESET_PLANS.find(function (pl) { return pl.key === "salah"; });
    var p = { id: uid("pri"), planKey: "salah", kind: "salah", title: "Salah Consistency", why: plan.why, minutes: null, date: todayKey(), status: "pending" };
    savePriority(p);
    focusState.linkedPriorityId = null;
    focusPrepShownForPriorityId = null;
    return p;
  }

  function markPriorityStatusToday(status) {
    var p = getCurrentPriority();
    if (!p) return;
    p.status = status;
    savePriority(p);
  }

  function submitAccountability(status) {
    var p = getCurrentPriority();
    if (!p) return;
    appendPriorityLog({ date: p.date, planKey: p.planKey, title: p.title, minutes: p.minutes, status: status });

    if (status === "partial" && p.minutes) {
      var half = Math.max(5, Math.round(p.minutes / 2));
      var newTitle = p.title.replace(/\d+\s*min(ute)?s?/i, half + " min");
      savePriority({ id: uid("pri"), planKey: p.planKey, title: newTitle, why: "Adjusted from yesterday — a smaller target, same goal.", minutes: half, date: todayKey(), status: "pending" });
      showToast("Yesterday's target was " + p.minutes + " min. Today's: " + half + " min.");
    } else if (status === "not-yet" && p.minutes) {
      var smaller = Math.max(5, Math.round(p.minutes * 0.7));
      var newTitle2 = p.title.replace(/\d+\s*min(ute)?s?/i, smaller + " min");
      savePriority({ id: uid("pri"), planKey: p.planKey, title: newTitle2, why: "Let's try again with a smaller, doable target.", minutes: smaller, date: todayKey(), status: "pending" });
      showToast("No worries — today's target: " + smaller + " min.");
    } else {
      savePriority(null);
      pendingAdjustmentNote = status === "completed" ? "Nice — you finished it. Pick today's priority." : "Pick today's priority.";
    }
    focusState.linkedPriorityId = null;
    pickerStep = { view: "main", bodyPart: null };
    priorityPickerOpen = true;
    renderHome();
  }

  function chooseDifferentPriority() {
    var p = getCurrentPriority();
    if (p) {
      appendPriorityLog({ date: p.date, planKey: p.planKey, title: p.title, minutes: p.minutes, status: p.status === "pending" ? "not-yet" : p.status });
      savePriority(null);
    }
    focusState.linkedPriorityId = null;
    pickerStep = { view: "main", bodyPart: null };
    priorityPickerOpen = true;
    stopFocus();
    renderHome();
  }

  // ---------- PICKER STEPS (multi-step selection for Study/Fitness/Salah) ----------

  var pickerStep = { view: "main", bodyPart: null };

  function buildChecklist(items) {
    var list = document.createElement("div");
    list.className = "checklist";
    items.forEach(function (text, idx) {
      var label = document.createElement("label");
      label.className = "checklist-item";
      var input = document.createElement("input");
      input.type = "checkbox";
      var span = document.createElement("span");
      span.textContent = text;
      label.appendChild(input);
      label.appendChild(span);
      list.appendChild(label);
    });
    return list;
  }

  function buildDurationChipPicker(options, onPick) {
    var wrap = document.createElement("div");
    wrap.className = "focus-duration-row";
    options.forEach(function (mins) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "duration-chip";
      chip.textContent = mins;
      chip.addEventListener("click", function () { onPick(mins); });
      wrap.appendChild(chip);
    });
    var input = document.createElement("input");
    input.type = "number";
    input.className = "duration-custom-input";
    input.placeholder = "Custom";
    input.min = "1";
    input.max = "180";
    wrap.appendChild(input);
    var setBtn = document.createElement("button");
    setBtn.type = "button";
    setBtn.className = "duration-chip";
    setBtn.textContent = "Set";
    setBtn.addEventListener("click", function () {
      var val = Math.round(Number(input.value));
      if (val > 0 && val <= 180) onPick(val);
      else showToast("Enter a number of minutes between 1 and 180");
    });
    wrap.appendChild(setBtn);
    return wrap;
  }

  function addStepBack(stepEl) {
    var back = document.createElement("button");
    back.type = "button";
    back.className = "picker-step-back";
    back.textContent = "← Back";
    back.addEventListener("click", function () { pickerStep = { view: "main", bodyPart: null }; renderPickerStep(); });
    stepEl.appendChild(back);
  }

  function renderPickerStep() {
    var mainEl = document.getElementById("priority-picker-main");
    var stepEl = document.getElementById("priority-picker-step");
    stepEl.innerHTML = "";

    if (pickerStep.view === "main") {
      mainEl.classList.remove("hidden");
      stepEl.classList.add("hidden");
      return;
    }
    mainEl.classList.add("hidden");
    stepEl.classList.remove("hidden");
    addStepBack(stepEl);

    if (pickerStep.view === "study-prep") {
      var pt = document.createElement("p");
      pt.className = "picker-step-title";
      pt.textContent = "Prepare to study";
      stepEl.appendChild(pt);
      stepEl.appendChild(buildChecklist(STUDY_PREP_ITEMS));
      var contBtn = document.createElement("button");
      contBtn.type = "button";
      contBtn.className = "btn btn-primary btn-full";
      contBtn.textContent = "Continue";
      contBtn.addEventListener("click", function () {
        pickerStep = { view: "study-duration", bodyPart: null };
        renderPickerStep();
      });
      stepEl.appendChild(contBtn);
    } else if (pickerStep.view === "study-duration") {
      var t1 = document.createElement("p");
      t1.className = "picker-step-title";
      t1.textContent = "How long do you want to study?";
      stepEl.appendChild(t1);
      stepEl.appendChild(buildDurationChipPicker([15, 25, 30, 45, 60], function (mins) {
        setTodaysStudyPriority(mins);
        pendingAdjustmentNote = null;
        pickerStep = { view: "main", bodyPart: null };
        renderHome();
      }));
      var studyHint = memStudyHint();
      if (studyHint) {
        var hintEl = document.createElement("p");
        hintEl.className = "muted-line";
        hintEl.style.marginTop = "8px";
        hintEl.textContent = studyHint;
        stepEl.appendChild(hintEl);
      }
    } else if (pickerStep.view === "phone-distraction") {
      var pd = document.createElement("p");
      pd.className = "picker-step-title";
      pd.textContent = "What is distracting you right now?";
      stepEl.appendChild(pd);
      var pdGrid = document.createElement("div");
      pdGrid.className = "preset-plan-grid";
      PHONE_DISTRACTIONS.forEach(function (d) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "preset-plan-chip";
        btn.textContent = d;
        btn.addEventListener("click", function () {
          pickerStep = { view: "phone-steps", bodyPart: null, distraction: d };
          renderPickerStep();
        });
        pdGrid.appendChild(btn);
      });
      stepEl.appendChild(pdGrid);
      var pgEntry = document.createElement("button");
      pgEntry.type = "button";
      pgEntry.className = "btn btn-outline btn-full";
      pgEntry.style.marginTop = "14px";
      pgEntry.textContent = "Intentional Open — pause before distracting apps pull you in";
      pgEntry.addEventListener("click", function () { pgView = { screen: "main" }; setActiveView("duniya-phone-guard"); });
      stepEl.appendChild(pgEntry);
    } else if (pickerStep.view === "phone-steps") {
      var ps1 = document.createElement("p");
      ps1.className = "picker-step-title";
      ps1.textContent = "STEP 1 — Turn on Focus Mode / Do Not Disturb";
      stepEl.appendChild(ps1);
      var settingsBtn = document.createElement("button");
      settingsBtn.type = "button";
      settingsBtn.className = "btn btn-outline btn-full";
      settingsBtn.textContent = "Open Focus / Do Not Disturb Settings";
      settingsBtn.addEventListener("click", function () {
        showToast("Open your phone's Settings app → Sound / Focus → turn on Do Not Disturb");
      });
      stepEl.appendChild(settingsBtn);
      var ps2 = document.createElement("p");
      ps2.className = "picker-step-title";
      ps2.textContent = "STEP 2 — Close " + pickerStep.distraction;
      stepEl.appendChild(ps2);
      var contBtn2 = document.createElement("button");
      contBtn2.type = "button";
      contBtn2.className = "btn btn-primary btn-full";
      contBtn2.textContent = "Done — continue";
      contBtn2.addEventListener("click", function () {
        pickerStep = { view: "phone-duration", bodyPart: null, distraction: pickerStep.distraction };
        renderPickerStep();
      });
      stepEl.appendChild(contBtn2);
    } else if (pickerStep.view === "phone-duration") {
      var pdt = document.createElement("p");
      pdt.className = "picker-step-title";
      pdt.textContent = "STEP 3 — How long do you want to stay away?";
      stepEl.appendChild(pdt);
      var distraction = pickerStep.distraction;
      stepEl.appendChild(buildDurationChipPicker([10, 15, 30, 45, 60], function (mins) {
        pickerStep = { view: "phone-replacement", bodyPart: null, distraction: distraction, minutes: mins };
        renderPickerStep();
      }));
    } else if (pickerStep.view === "phone-replacement") {
      var prt = document.createElement("p");
      prt.className = "picker-step-title";
      prt.textContent = "STEP 4 — What will you do instead?";
      stepEl.appendChild(prt);
      var prGrid = document.createElement("div");
      prGrid.className = "preset-plan-grid";
      var stepMinutes = pickerStep.minutes;
      var stepDistraction = pickerStep.distraction;
      PHONE_REPLACEMENTS.forEach(function (r) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "preset-plan-chip";
        btn.textContent = r;
        btn.addEventListener("click", function () {
          setTodaysPhonePriority(stepDistraction, stepMinutes, r);
          pendingAdjustmentNote = null;
          pickerStep = { view: "main", bodyPart: null };
          renderHome();
        });
        prGrid.appendChild(btn);
      });
      stepEl.appendChild(prGrid);
      var customRow = document.createElement("div");
      customRow.className = "priority-custom-row";
      var customInput = document.createElement("input");
      customInput.type = "text";
      customInput.className = "text-input";
      customInput.placeholder = "Custom activity...";
      var customBtn = document.createElement("button");
      customBtn.type = "button";
      customBtn.className = "btn btn-primary";
      customBtn.textContent = "Set";
      customBtn.addEventListener("click", function () {
        var val = customInput.value.trim();
        if (!val) return;
        setTodaysPhonePriority(stepDistraction, stepMinutes, val);
        pendingAdjustmentNote = null;
        pickerStep = { view: "main", bodyPart: null };
        renderHome();
      });
      customRow.appendChild(customInput);
      customRow.appendChild(customBtn);
      stepEl.appendChild(customRow);
    } else if (pickerStep.view === "sleep-bedtime") {
      var sbt = document.createElement("p");
      sbt.className = "picker-step-title";
      sbt.textContent = "What time do you want to sleep?";
      stepEl.appendChild(sbt);
      var timeInput = document.createElement("input");
      timeInput.type = "time";
      timeInput.className = "text-input";
      timeInput.id = "sleep-bedtime-input";
      stepEl.appendChild(timeInput);
      var nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "btn btn-primary btn-full";
      nextBtn.textContent = "Continue";
      nextBtn.addEventListener("click", function () {
        var val = timeInput.value;
        if (!val) { showToast("Pick a bedtime first"); return; }
        pickerStep = { view: "sleep-prep", bodyPart: null, bedtime: val };
        renderPickerStep();
      });
      stepEl.appendChild(nextBtn);
    } else if (pickerStep.view === "sleep-prep") {
      var spt = document.createElement("p");
      spt.className = "picker-step-title";
      spt.textContent = "30 minutes before bed";
      stepEl.appendChild(spt);
      stepEl.appendChild(buildChecklist(SLEEP_PREP_ITEMS));
      var bedtime = pickerStep.bedtime;
      var sleepBtn = document.createElement("button");
      sleepBtn.type = "button";
      sleepBtn.className = "btn btn-primary btn-full";
      sleepBtn.textContent = "I'M GOING TO SLEEP";
      sleepBtn.addEventListener("click", function () {
        setTodaysSleepPriority(bedtime);
        pendingAdjustmentNote = null;
        pickerStep = { view: "main", bodyPart: null };
        renderHome();
      });
      stepEl.appendChild(sleepBtn);
    } else if (pickerStep.view === "fitness-bodypart") {
      var t2 = document.createElement("p");
      t2.className = "picker-step-title";
      t2.textContent = "What are you training today?";
      stepEl.appendChild(t2);
      var grid = document.createElement("div");
      grid.className = "preset-plan-grid";
      FITNESS_BODY_PARTS.forEach(function (bp) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "preset-plan-chip";
        btn.textContent = bp.label;
        btn.addEventListener("click", function () {
          pickerStep = { view: "fitness-duration", bodyPart: bp.key };
          renderPickerStep();
        });
        grid.appendChild(btn);
      });
      stepEl.appendChild(grid);
    } else if (pickerStep.view === "fitness-duration") {
      var t3 = document.createElement("p");
      t3.className = "picker-step-title";
      t3.textContent = "How much time do you have?";
      stepEl.appendChild(t3);
      stepEl.appendChild(buildDurationChipPicker([5, 10, 20, 30, 45], function (mins) {
        setTodaysFitnessPriority(pickerStep.bodyPart, mins);
        pendingAdjustmentNote = null;
        pickerStep = { view: "main", bodyPart: null };
        renderHome();
      }));
    } else if (pickerStep.view === "salah-setup") {
      var text = document.createElement("p");
      text.className = "salah-setup-text";
      text.textContent = "NURA uses your location only to calculate local prayer times.";
      stepEl.appendChild(text);
      var allowBtn = document.createElement("button");
      allowBtn.type = "button";
      allowBtn.className = "btn btn-primary btn-full";
      allowBtn.textContent = "Allow Location";
      allowBtn.addEventListener("click", function () {
        if (!navigator.geolocation) { showToast("Location isn't available on this device — use manual setup instead"); return; }
        showToast("Getting your location…");
        navigator.geolocation.getCurrentPosition(function (pos) {
          savePrayerSettings({ mode: "auto", lat: pos.coords.latitude, lon: pos.coords.longitude, method: 1 });
          setTodaysSalahPriority();
          pendingAdjustmentNote = null;
          pickerStep = { view: "main", bodyPart: null };
          renderHome();
        }, function () {
          showToast("Location permission denied — use manual setup instead");
        }, { timeout: 10000 });
      });
      stepEl.appendChild(allowBtn);
      var manualBtn = document.createElement("button");
      manualBtn.type = "button";
      manualBtn.className = "btn btn-outline btn-full";
      manualBtn.textContent = "Enter city manually";
      manualBtn.addEventListener("click", function () {
        pickerStep = { view: "salah-manual", bodyPart: null };
        renderPickerStep();
      });
      stepEl.appendChild(manualBtn);
    } else if (pickerStep.view === "salah-manual") {
      var cityInput = document.createElement("input");
      cityInput.type = "text";
      cityInput.className = "text-input";
      cityInput.placeholder = "City";
      var countryInput = document.createElement("input");
      countryInput.type = "text";
      countryInput.className = "text-input";
      countryInput.placeholder = "Country";
      var methodSelect = document.createElement("select");
      methodSelect.className = "text-input";
      PRAYER_METHODS.forEach(function (m) {
        var opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.label;
        methodSelect.appendChild(opt);
      });
      var saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn btn-primary btn-full";
      saveBtn.textContent = "Save and continue";
      saveBtn.addEventListener("click", function () {
        var city = cityInput.value.trim();
        var country = countryInput.value.trim();
        if (!city || !country) { showToast("Enter both city and country"); return; }
        savePrayerSettings({ mode: "manual", city: city, country: country, method: Number(methodSelect.value) });
        setTodaysSalahPriority();
        pendingAdjustmentNote = null;
        pickerStep = { view: "main", bodyPart: null };
        renderHome();
      });
      stepEl.appendChild(cityInput);
      stepEl.appendChild(countryInput);
      stepEl.appendChild(methodSelect);
      stepEl.appendChild(saveBtn);
    }
  }

  var PRESET_TILES = {
    study: ["📚", "Pick a length, then focus"],
    sleep: ["🌙", "Set a bedtime, track your rest"],
    phone: ["📵", "A break from a distraction"],
    salah: ["🕌", "Stay on top of today's prayers"],
    fitness: ["🏋️", "A short guided workout"],
    morning: ["☀️", "Your full morning routine"]
  };

  function renderPresetPicker() {
    var grid = document.getElementById("preset-plan-grid");
    grid.innerHTML = "";
    PRESET_PLANS.forEach(function (plan) {
      var btn = document.createElement("button");
      btn.className = "preset-plan-chip preset-tile";
      var tile = PRESET_TILES[plan.key] || ["⭐", ""];
      var tIcon = document.createElement("span"); tIcon.className = "pt-icon"; tIcon.textContent = tile[0];
      var tText = document.createElement("span"); tText.className = "pt-text";
      var tLabel = document.createElement("span"); tLabel.className = "pt-label"; tLabel.textContent = plan.label;
      var tSub = document.createElement("span"); tSub.className = "pt-sub"; tSub.textContent = tile[1];
      tText.appendChild(tLabel); tText.appendChild(tSub);
      btn.appendChild(tIcon); btn.appendChild(tText);
      btn.addEventListener("click", function () {
        if (plan.key === "study") {
          pickerStep = { view: "study-prep", bodyPart: null };
          renderPickerStep();
        } else if (plan.key === "phone") {
          pickerStep = { view: "phone-distraction", bodyPart: null };
          renderPickerStep();
        } else if (plan.key === "sleep") {
          pickerStep = { view: "sleep-bedtime", bodyPart: null };
          renderPickerStep();
        } else if (plan.key === "fitness") {
          pickerStep = { view: "fitness-bodypart", bodyPart: null };
          renderPickerStep();
        } else if (plan.key === "salah") {
          if (getPrayerSettings()) {
            setTodaysSalahPriority();
            pendingAdjustmentNote = null;
            renderHome();
          } else {
            pickerStep = { view: "salah-setup", bodyPart: null };
            renderPickerStep();
          }
        } else {
          setTodaysPriority(plan.key, null);
          pendingAdjustmentNote = null;
          renderHome();
        }
      });
      grid.appendChild(btn);
    });
    var note = document.getElementById("priority-adjustment-note");
    if (pendingAdjustmentNote) {
      note.textContent = pendingAdjustmentNote;
      note.classList.remove("hidden");
    } else {
      note.classList.add("hidden");
    }
    renderPickerStep();
  }

  // ---------- TODAY'S PROGRESS RING ----------

  function computeProgressPercent(p) {
    if (!p || p.status !== "pending") return p ? 100 : 0;
    if (p.kind === "salah") {
      var completions = getSalahCompletions();
      var doneCount = PRAYER_ORDER.filter(function (n) { return completions[n]; }).length;
      return Math.round((doneCount / PRAYER_ORDER.length) * 100);
    }
    if (p.kind === "sleep") {
      if (!p.sleepStart) return 0;
      var elapsedHrs = (new Date() - new Date(p.sleepStart)) / 3600000;
      return Math.min(100, Math.max(0, Math.round((elapsedHrs / 8) * 100)));
    }
    if (focusState.linkedPriorityId === p.id && p.minutes && (p.kind !== "fitness" || p.warmupDone)) {
      var total = focusSecondsTotal();
      var elapsed = total - focusState.remaining;
      return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
    }
    return 0;
  }

  // ---------- 7-DAY PROGRESS GRAPH (real data only) ----------

  function getDayProgressPercent(dateKey) {
    if (dateKey === todayKey()) {
      var hp = homeProgress(); return hp.total ? hp.percent : 0;
    }
    // a day with planned Daily Flow actions is measured by them (same numbers as the Life Grid)
    if (dateKey < todayKey()) { var fdp = flowDay(dateKey); if (fdp.pct !== null) return fdp.pct; }
    var log = readJSON("nc_priority_log", []);
    var entries = log.filter(function (e) { return e.date === dateKey; });
    if (!entries.length) return null;
    var last = entries[entries.length - 1];
    if (last.status === "completed") return 100;
    if (last.status === "partial") return 50;
    return 0;
  }

  function openProgressDetails() {
    var todayEl = document.getElementById("progress-details-today");
    var p = getCurrentPriority();
    todayEl.innerHTML = "";
    var rows = [
      { label: "Completed actions", value: String(homeProgress().done) },
      { label: "Pending actions", value: String(homeProgress().total - homeProgress().done) },
      { label: "Overall progress", value: homeProgress().total ? homeProgress().percent + "%" : "No actions yet" }
    ];
    rows.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "progress-detail-row";
      row.innerHTML = '<span class="progress-detail-label">' + r.label + '</span><span class="progress-detail-value">' + r.value + '</span>';
      todayEl.appendChild(row);
    });

    var weekEl = document.getElementById("progress-details-week");
    weekEl.innerHTML = "";
    var dates = getLastNDateKeys(7).slice().reverse();
    dates.forEach(function (dateKey) {
      var pct = getDayProgressPercent(dateKey);
      var row = document.createElement("div");
      row.className = "progress-detail-row";
      var label = new Date(dateKey + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      var value = pct === null ? "No activity" : pct + "%";
      row.innerHTML = '<span class="progress-detail-label">' + label + '</span><span class="progress-detail-value">' + value + '</span>';
      weekEl.appendChild(row);
    });

    memWeeklyInsights().forEach(function (s) {
      var row = document.createElement("div");
      row.className = "progress-detail-row";
      var l = document.createElement("span"); l.className = "progress-detail-label"; l.textContent = "NURA noticed";
      var v = document.createElement("span"); v.className = "progress-detail-value"; v.textContent = s;
      row.appendChild(l); row.appendChild(v);
      weekEl.appendChild(row);
    });

    gwProgressRows().forEach(function (r) {
      var row = document.createElement("div");
      row.className = "progress-detail-row";
      var l = document.createElement("span"); l.className = "progress-detail-label"; l.textContent = r.label;
      var v = document.createElement("span"); v.className = "progress-detail-value"; v.textContent = r.value;
      row.appendChild(l); row.appendChild(v);
      weekEl.appendChild(row);
    });

    rcProgressRows().forEach(function (r) {
      var row = document.createElement("div");
      row.className = "progress-detail-row";
      var l = document.createElement("span"); l.className = "progress-detail-label"; l.textContent = r.label;
      var v = document.createElement("span"); v.className = "progress-detail-value"; v.textContent = r.value;
      row.appendChild(l); row.appendChild(v);
      weekEl.appendChild(row);
    });

    if (pgNative()) {
      var pgStatsAll = pgStats();
      var pgWeek = pgSummarize(pgStatsAll, getLastNDateKeys(7));
      var pgPrev = pgSummarize(pgStatsAll, getLastNDateKeys(14).slice(7));
      if (pgWeek.hasData) {
        var pgRows = [
          { label: "Phone Control — watched apps (7 days)", value: pgFmtDur(pgWeek.ms) },
          { label: "Pauses / went back", value: pgWeek.pauses + " / " + pgWeek.wentBack }
        ];
        if (pgPrev.hasData) {
          var pgDiff = pgWeek.ms - pgPrev.ms;
          pgRows.push({ label: "vs. previous week", value: pgDiff === 0 ? "No change" : (pgDiff < 0 ? "↓ " : "↑ ") + pgFmtDur(Math.abs(pgDiff)) });
        }
        pgRows.forEach(function (r) {
          var row = document.createElement("div");
          row.className = "progress-detail-row";
          var l = document.createElement("span"); l.className = "progress-detail-label"; l.textContent = r.label;
          var v = document.createElement("span"); v.className = "progress-detail-value"; v.textContent = r.value;
          row.appendChild(l); row.appendChild(v);
          weekEl.appendChild(row);
        });
      }
    }

    document.getElementById("modal-progress-details").classList.remove("hidden");
  }

  // ===================================================================
  // HOME — rebuilt 2026-09-25. Reads only what the app already saves
  // (prayer settings + cached times, Salah completions, today's priority,
  // Plan My Day, habits, Top 3, Sunnah log). No new storage, no fake numbers.
  // ===================================================================

  var homeToken = 0, heroTimerId = null, heroDay = null, heroSetupMode = null;
  var justPrayed = null, heroPainted = false, hamdardShownKey = null, priorityPickerOpen = false;

  function hEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function fmtRemaining(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h > 0 ? h + "h " + String(m).padStart(2, "0") + "m " : m + "m ") + String(sec).padStart(2, "0") + "s";
  }
  function homeTimings() {
    if (!getPrayerSettings()) return null;
    var t = salahTimingsFor(todayKey()); // device calculation first; cached online times only as a fallback
    return t ? t.hhmm : null;
  }
  function homeGreetingWord() {
    var h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 20 ? "Good evening" : "Good night";
  }
  function scrollToPriorityCard() {
    var c = document.getElementById("priority-card-el");
    if (c) c.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ---- today's progress: completed / applicable actions, equal weight, real data only ----
  // The user's Daily Flow is the primary source: every action they planned for today counts once
  // (a measured action contributes value/target). Beyond that, NURA's own items still count unless
  // the Flow already covers them: prayers whose time has arrived (only as a fallback when the Flow has
  // nothing planned for today - the user decides what counts once they plan), today's priority, Plan My Day items, habits not already in the Flow,
  // and Top 3 tasks. Skipped or rescheduled items are set aside, never counted against the user.
  function homeProgress() {
    flowLinkCache = {};
    var items = [], now = new Date();
    var fd = flowDay(todayKey());
    var flowSalah = fd.items.some(function (it) { return it.a.link && it.a.link.kind === "salah"; });
    var flowHabit = {};
    fd.items.forEach(function (it) { if (it.a.link && it.a.link.kind === "habit") flowHabit[it.a.link.key] = true; });

    var T = homeTimings(), comps = getSalahCompletions();
    if (T && !flowSalah && !fd.items.length) PRAYER_ORDER.forEach(function (n) { if (parseTimeToday(T[n]) <= now) items.push({ g: "Salah", done: !!comps[n] }); });
    var p = getCurrentPriority();
    // a goal created in Daily Flow is already counted through the Flow; counting its priority too would double it
    if (p && p.date === todayKey() && p.kind !== "salah" && !p.flowId) items.push({ g: p.kind === "sleep" ? "Personal" : "Focus", done: p.status === "completed" });
    getPlanActivities().forEach(function (a) { if (a.status !== "skipped") items.push({ g: "Focus", done: a.status === "done" }); });
    var hl = getHabitLogToday();
    getHabits().forEach(function (h) { if (!flowHabit[h.id]) items.push({ g: "Personal", done: hl[h.id] === "done" }); });
    var t3 = getTop3(), d3 = getTop3Done();
    t3.forEach(function (t, i) { if (t && String(t).trim()) items.push({ g: "Focus", done: !!d3[i] }); });
    fd.counted.forEach(function (it) { items.push({ g: flowGroup(it.a), done: it.st.kind === "done", frac: it.st.frac }); });

    var out = { done: 0, total: items.length, percent: null, groups: {}, partial: false };
    var sum = 0;
    items.forEach(function (it) {
      var g = out.groups[it.g] || (out.groups[it.g] = { done: 0, total: 0 });
      g.total++;
      var f = it.frac !== undefined ? it.frac : (it.done ? 1 : 0);
      sum += f;
      if (it.done) { g.done++; out.done++; } else if (f > 0) out.partial = true;
    });
    if (out.total) {
      var pct = Math.round((sum / out.total) * 100);
      if (out.done < out.total && pct >= 100) pct = 99;
      if (sum > 0 && pct < 1) pct = 1;
      out.percent = pct;
    }
    return out;
  }

  var HP_CIRC = 226.2; // 2 * PI * 36
  function ensureProgressDom(host) {
    if (host.firstChild) return;
    host.innerHTML =
      '<div class="hp-body">' +
        '<div class="hp-ring"><svg viewBox="0 0 88 88" class="hp-ring-svg" aria-hidden="true">' +
          '<defs><linearGradient id="hp-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2F7A5E"/><stop offset="1" stop-color="#C99A3D"/></linearGradient></defs>' +
          '<circle cx="44" cy="44" r="36" class="hp-ring-track"/><circle cx="44" cy="44" r="36" class="hp-ring-fill" id="hp-ring-fill"/></svg>' +
          '<span class="hp-pct" id="hp-pct">0%</span></div>' +
        '<div class="hp-text"><p class="hh-eyebrow">Today</p><p class="hp-main" id="hp-main"></p><p class="hp-sub" id="hp-sub"></p><div class="hp-chips" id="hp-chips"></div></div>' +
      '</div>' +
      '<div class="hp-week hidden" id="hp-week" role="group" aria-label="This week"></div>' +
      '<div class="hp-links"><button type="button" class="hp-link" id="hp-link">View today’s plan ›</button>' +
      '<button type="button" class="hp-link hp-link-quiet" id="hp-report">Report</button></div>';
    document.getElementById("hp-ring-fill").style.strokeDasharray = HP_CIRC;
    document.getElementById("hp-ring-fill").style.strokeDashoffset = HP_CIRC;
    document.getElementById("hp-link").addEventListener("click", function () { openFlow("today"); });
    document.getElementById("hp-report").addEventListener("click", function () { openProgressDetails(); });
  }
  function startFirstAction() {
    var p = getCurrentPriority();
    if (!p || p.date !== todayKey()) { priorityPickerOpen = true; renderTodaysPriority(); }
    scrollToPriorityCard();
  }
  function renderHomeProgress() {
    var host = document.getElementById("home-progress");
    if (!host) return;
    ensureProgressDom(host);
    var pr = homeProgress();
    var has = pr.total > 0;
    var hasFlow = flowActions().some(function (a) { return !a.archivedAt; });
    host.classList.toggle("is-empty", !has);
    var pct = has ? pr.percent : 0;
    document.getElementById("hp-pct").textContent = has ? pct + "%" : "—";
    requestAnimationFrame(function () {
      var f = document.getElementById("hp-ring-fill");
      if (f) f.style.strokeDashoffset = HP_CIRC * (1 - pct / 100);
    });
    document.getElementById("hp-main").textContent = has ? pr.done + " of " + pr.total + " planned actions completed" : "Your day has just started.";
    document.getElementById("hp-sub").textContent = has
      ? (pr.done === pr.total ? "Everything planned so far is done." : (pr.total - pr.done) + " remaining" + (pr.partial ? " · partial progress counts in proportion" : ""))
      : "Nothing planned to count yet.";
    var chips = document.getElementById("hp-chips");
    chips.innerHTML = "";
    ["Salah", "Deen", "Focus", "Personal"].forEach(function (g) {
      var gg = pr.groups[g];
      if (!gg) return;
      var c = hEl("span", "hp-chip" + (gg.done === gg.total ? " is-full" : ""));
      c.appendChild(hEl("span", "hp-chip-name", g));
      c.appendChild(hEl("span", "hp-chip-count", gg.done + "/" + gg.total));
      chips.appendChild(c);
    });
    document.getElementById("hp-link").textContent = hasFlow ? "View today’s plan ›" : "Build today’s plan ›";

    // a tiny look at the week, only once there's something planned
    var wk = document.getElementById("hp-week");
    wk.innerHTML = "";
    wk.classList.toggle("hidden", !hasFlow);
    if (hasFlow) {
      flowWeekStrip().forEach(function (d) {
        var lv = d.pct === null ? "lv-none" : d.pct >= 100 ? "lv-4" : d.pct >= 60 ? "lv-3" : d.pct >= 30 ? "lv-2" : d.pct > 0 ? "lv-1" : "lv-0";
        var b = hEl("button", "hp-day " + lv + (d.isToday ? " is-today" : "") + (d.future ? " is-future" : "")); b.type = "button";
        b.setAttribute("aria-label", fdLong(d.dk) + (d.pct === null ? ": nothing planned yet" : ": " + d.pct + "% of planned actions done"));
        b.appendChild(hEl("span", "hp-day-dot", ""));
        b.appendChild(hEl("span", "hp-day-l", d.letter));
        b.addEventListener("click", function () { openFlow("week"); });
        wk.appendChild(b);
      });
    }
  }
  // The timer calls this once a second; the calculation is cheap and reads saved data only.
  function renderProgressLine() { renderHomeProgress(); }

  // ---- RIGHT NOW: the current Salah, then what's next ----
  function stopHeroTimer() { if (heroTimerId) { clearInterval(heroTimerId); heroTimerId = null; } }
  function startHeroTimer(target, curTime) {
    stopHeroTimer();
    heroDay = todayKey();
    function tick() {
      var cd = document.getElementById("hero-countdown");
      if (!cd) { stopHeroTimer(); return; }
      var now = new Date(), diff = target - now;
      if (diff <= 0 || todayKey() !== heroDay) {
        stopHeroTimer();
        var v = document.getElementById("view-home");
        if (v && !v.classList.contains("hidden")) renderHome();
        return;
      }
      cd.textContent = fmtRemaining(diff) + " remaining";
      var bar = document.getElementById("hero-bar-fill");
      if (bar && curTime) bar.style.width = Math.min(100, Math.max(0, ((now - curTime) / (target - curTime)) * 100)) + "%";
    }
    tick();
    heroTimerId = setInterval(tick, 1000);
  }

  function heroButton(label, cls, fn) {
    var b = hEl("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function paintHeroSetup(el) {
    el.className = "hero hero-setup";
    el.innerHTML = "";
    el.appendChild(hEl("p", "hero-label", "Prayer times"));
    el.appendChild(hEl("h2", "hero-setup-title", "Let NURA follow your day around Salah"));
    el.appendChild(hEl("p", "hero-setup-text", "Your location is used only to calculate local prayer times. It isn't stored anywhere but on this device."));
    if (heroSetupMode === "manual") {
      var city = hEl("input", "text-input hero-input"); city.type = "text"; city.placeholder = "City";
      var country = hEl("input", "text-input hero-input"); country.type = "text"; country.placeholder = "Country";
      var method = hEl("select", "text-input hero-input");
      PRAYER_METHODS.forEach(function (m) { var o = hEl("option", "", m.label); o.value = m.id; method.appendChild(o); });
      el.appendChild(city); el.appendChild(country); el.appendChild(method);
      el.appendChild(heroButton("Save and continue", "btn hero-cta", function () {
        var c1 = city.value.trim(), c2 = country.value.trim();
        if (!c1 || !c2) { showToast("Enter both city and country"); return; }
        savePrayerSettings({ mode: "manual", city: c1, country: c2, method: Number(method.value) });
        heroSetupMode = null;
        renderHome();
      }));
      el.appendChild(heroButton("← Back", "hero-link", function () { heroSetupMode = null; renderHome(); }));
    } else {
      el.appendChild(heroButton("Allow location", "btn hero-cta", function () {
        if (!navigator.geolocation) { showToast("Location isn't available here — enter your city instead"); return; }
        showToast("Getting your location…");
        navigator.geolocation.getCurrentPosition(function (pos) {
          savePrayerSettings({ mode: "auto", lat: pos.coords.latitude, lon: pos.coords.longitude, method: 1 });
          renderHome();
        }, function () { showToast("Location permission denied — enter your city instead"); }, { timeout: 10000 });
      }));
      el.appendChild(heroButton("Enter city manually", "btn hero-cta-ghost", function () { heroSetupMode = "manual"; renderHome(); }));
    }
  }

  function paintHeroLoading(el) {
    el.className = "hero hero-loading";
    el.innerHTML = '<p class="hero-label">Right now</p><div class="sk sk-title"></div><div class="sk sk-line"></div><div class="sk sk-strip"></div>';
  }

  function paintHeroError(el) {
    el.className = "hero hero-setup";
    el.innerHTML = "";
    el.appendChild(hEl("p", "hero-label", "Prayer times"));
    el.appendChild(hEl("h2", "hero-setup-title", "Couldn't load today's times"));
    el.appendChild(hEl("p", "hero-setup-text", "Check your internet connection and try again."));
    el.appendChild(heroButton("Try again", "btn hero-cta", function () {
      paintHeroLoading(el);
      fetchPrayerTimesForToday(true).then(function () { renderHome(); }).catch(function () { paintHeroError(el); });
    }));
  }

  function paintHero(el, T) {
    var now = new Date(), comps = getSalahCompletions();
    var passed = PRAYER_ORDER.filter(function (n) { return parseTimeToday(T[n]) <= now; });
    var cur = passed.length ? passed[passed.length - 1] : null;
    var next = getNextPrayer(T);
    var curTime = cur ? parseTimeToday(T[cur]) : null;

    el.className = "hero" + (cur ? "" : " hero-pre") + (heroPainted ? "" : " hero-enter");
    heroPainted = true;
    el.innerHTML = "";
    var ctxEl = document.getElementById("home-context");
    if (ctxEl) ctxEl.textContent = homeGreetingWord() + (cur ? " · " + cur + " time" : " · before Fajr");

    var top = hEl("div", "hero-top");
    top.appendChild(hEl("p", "hero-label", cur ? "Right now" : "Coming up"));
    el.appendChild(top);

    if (cur) {
      var done = !!comps[cur];
      top.appendChild(hEl("span", "hero-pill" + (done ? " is-done" + (justPrayed === cur ? " pop" : "") : ""), done ? "✓ Prayed" : "Not marked yet"));
      el.appendChild(hEl("h2", "hero-name", cur));
      el.appendChild(hEl("p", "hero-time", ncFmtTime(curTime) + " · until " + next.name + " " + ncFmtTime(next.time)));
      if (!done) {
        el.appendChild(heroButton("Mark as prayed", "btn hero-cta", function () {
          setSalahComplete(cur);
          justPrayed = cur;
          renderHome();
        }));
      }
    } else {
      el.appendChild(hEl("h2", "hero-name", next.name));
      el.appendChild(hEl("p", "hero-time", ncFmtTime(next.time) + " · the day begins at Fajr"));
    }
    justPrayed = null;

    var strip = hEl("div", "hero-next");
    var row = hEl("div", "hero-next-row");
    row.appendChild(hEl("span", "hero-next-label", cur ? "Next" : "In"));
    row.appendChild(hEl("span", "hero-next-name", cur ? next.name + (next.tomorrow ? " · tomorrow" : "") + " · " + ncFmtTime(next.time) : next.name));
    strip.appendChild(row);
    var cd = hEl("p", "hero-countdown", ""); cd.id = "hero-countdown";
    strip.appendChild(cd);
    if (cur) {
      var bar = hEl("div", "hero-bar"); var fill = hEl("div", "hero-bar-fill"); fill.id = "hero-bar-fill";
      bar.appendChild(fill); strip.appendChild(bar);
    }
    el.appendChild(strip);

    var earlier = passed.filter(function (n) { return n !== cur && !comps[n]; });
    if (earlier.length) {
      var er = hEl("div", "hero-earlier");
      er.appendChild(hEl("span", "hero-earlier-label", "Not marked:"));
      earlier.forEach(function (n) {
        er.appendChild(heroButton(n, "hero-chip", function () { setSalahComplete(n); justPrayed = null; renderHome(); }));
      });
      el.appendChild(er);
    }
    startHeroTimer(next.time, curTime);
  }

  function renderHomeHero() {
    var el = document.getElementById("salah-hero");
    if (!el) return;
    var token = ++homeToken;
    stopHeroTimer();
    if (!getPrayerSettings()) { paintHeroSetup(el); paintHomeExtras(); return; }
    var cached = homeTimings();
    if (cached) paintHero(el, cached); else paintHeroLoading(el);
    // A stalled mobile connection must never leave the hero on a skeleton forever.
    Promise.race([
      fetchPrayerTimesForToday(),
      new Promise(function (_, reject) { setTimeout(function () { reject(new Error("timeout")); }, 12000); })
    ]).then(function (T) {
      if (token !== homeToken) return;
      paintHero(el, T);
      paintHomeExtras();
    }).catch(function () {
      if (token !== homeToken) return;
      if (!cached) paintHeroError(el);
      paintHomeExtras();
    });
    paintHomeExtras();
  }

  // ---- the companion note (Hamdard): only when the data supports a real suggestion ----
  function startHomeSession(label, minutes, planKey) {
    startAdhocFocus(label, minutes, planKey);
    renderHome();
    scrollToPriorityCard();
  }
  function homeHamdardMessage() {
    if (focusState.running || focusState.adhocLabel) return null;
    var ctx = buildNuraContext("day"), s = ctx.salah, pri = ctx.priority, plan = ctx.plan;
    var next = s.next && !s.next.tomorrow ? s.next : null;
    if (next && next.inMinutes <= 15) return { text: next.name + " is in " + next.inMinutes + " min. A good moment to get ready.", cta: null };
    var priFocus = pri.set && pri.status === "pending" && pri.kind !== "salah" && pri.kind !== "sleep" && !pri.custom;
    var flex = plan.flexiblePending;
    var label = priFocus ? pri.title : (flex ? flex.name : null);
    var planKey = priFocus && pri.kind === "study" ? "study" : (flex && /study|revis|exam|homework|assignment/i.test(flex.name) ? "study" : null);
    if (label && next) {
      var m = Math.min(25, Math.floor((next.inMinutes - 10) / 5) * 5);
      if (m >= 10) return {
        text: "You have " + ncFmtMin(next.inMinutes) + " before " + next.name + ". Want to finish one " + m + "-minute focus session?",
        cta: { label: "Start " + m + " min", fn: function () { startHomeSession(label + " — " + m + " min", m, planKey); } }
      };
    }
    if (priFocus && !next) return {
      text: "Your main task is still pending. 10 minutes is enough to restart.",
      cta: { label: "Start 10 min", fn: function () { startHomeSession(pri.title + " — 10 min", 10, planKey); } }
    };
    if (!pri.set && !flex && next && next.inMinutes >= 30) return {
      text: "You have " + ncFmtMin(next.inMinutes) + " before " + next.name + ". Want to choose one thing to move forward?",
      cta: { label: "Choose priority", fn: startFirstAction }
    };
    var pr = homeProgress();
    if (pr.total >= 3 && pr.done < pr.total && pr.done / pr.total >= 0.7) return {
      text: "Most of today is done. Want to quickly review what remains?",
      cta: { label: "Review", fn: function () { openProgressDetails(); } }
    };
    return null;
  }
  function renderHomeHamdard() {
    var el = document.getElementById("hamdard-now");
    if (!el) return;
    var msg = homeHamdardMessage();
    if (!msg) { el.classList.add("hidden"); el.innerHTML = ""; hamdardShownKey = null; return; }
    var key = msg.text + "|" + (msg.cta ? msg.cta.label : "");
    el.classList.remove("hidden");
    if (key === hamdardShownKey && el.firstChild) return;
    hamdardShownKey = key;
    el.innerHTML = "";
    var av = hEl("span", "hn-avatar", "H"); av.setAttribute("aria-hidden", "true");
    var body = hEl("div", "hn-body");
    body.appendChild(hEl("p", "hn-label", "Hamdard"));
    body.appendChild(hEl("p", "hn-text", msg.text));
    if (msg.cta) body.appendChild(heroButton(msg.cta.label, "btn hn-cta", msg.cta.fn));
    el.appendChild(av); el.appendChild(body);
    el.classList.remove("hn-in"); void el.offsetWidth; el.classList.add("hn-in");
  }

  // ---- quick actions: 3–4, chosen by the time of day and by what's already true ----
  function routineDone(sectionId) {
    var sec = ROUTINE_SECTIONS.filter(function (s) { return s.id === sectionId; })[0];
    if (!sec) return { done: 0, total: 0 };
    var log = getDaySunnahLog(todayKey());
    return { done: sec.actions.filter(function (a) { return log[a.id]; }).length, total: sec.actions.length };
  }
  function homeActionTiles() {
    var h = new Date().getHours();
    var part = h < 12 ? "morning" : h < 17 ? "afternoon" : h < 20 ? "evening" : "night";
    var p = getCurrentPriority(), today = todayKey();
    var priStudy = p && p.date === today && p.kind === "study" && p.status === "pending";
    var tiles = {};

    var mins = getFocusDurationMinutes(), doneMin = NC_SECTIONS.study().completedMinutesToday;
    var running = focusState.running || !!focusState.adhocLabel;
    tiles.study = { icon: "📚", tint: "amber", title: "Study Focus",
      sub: running ? "Session in progress" : (doneMin ? doneMin + " min done today" : mins + " min ready"),
      cta: running ? "Resume" : "Start",
      fn: function () { if (running) scrollToPriorityCard(); else startHomeSession("Study — " + mins + " min", mins, "study"); } };

    tiles.quran = { icon: "📖", tint: "sage", title: "Qur'an", sub: "Read today's verse", cta: "Read",
      fn: function () { setActiveView("sunnah"); switchSunnahSubtab("quran"); } };

    var secId = (h >= 4 && h < 12) ? "morning-adhkar" : (h >= 15 && h < 21) ? "evening-adhkar" : "before-sleep";
    var secTitle = secId === "morning-adhkar" ? "Morning adhkar" : secId === "evening-adhkar" ? "Evening adhkar" : "Before sleep";
    var rd = routineDone(secId);
    tiles.adhkar = { icon: secId === "before-sleep" ? "🌙" : "🤲", tint: "forest", title: secTitle,
      sub: rd.total && rd.done === rd.total ? "All done today" : rd.done + " of " + rd.total + " done", cta: rd.total && rd.done === rd.total ? "Open" : "Start",
      done: rd.total && rd.done === rd.total,
      fn: function () { setActiveView("sunnah"); switchSunnahSubtab("routine"); } };

    var asleep = p && p.date === today && p.kind === "sleep" && p.sleepStart && !p.wakeTime;
    var sleepSub = asleep ? "Asleep since " + ncFmtTime(new Date(p.sleepStart)) : (p && p.date === today && p.kind === "sleep" && p.targetBedtime ? "Target · " + p.targetBedtime : "Set a bedtime for tonight");
    tiles.sleep = { icon: "😴", tint: "sand", title: "Sleep", sub: sleepSub, cta: asleep || (p && p.kind === "sleep" && p.date === today) ? "View" : "Set",
      fn: function () { if (p && p.date === today && p.kind === "sleep") scrollToPriorityCard(); else startDuniyaQuickAction("sleep-bedtime"); } };

    var pl = NC_SECTIONS.plan();
    tiles.plan = { icon: "🗓️", tint: "sand", title: "Plan my day",
      sub: pl.total ? pl.pending + " left" + (pl.upcoming ? " · next " + ncFmtTime(parseTimeToday(pl.upcoming.startTime)) : "") : "Organise the rest of today",
      cta: pl.total ? "Open" : "Plan", fn: function () { setActiveView("duniya-plan"); } };

    var order = {
      morning: ["quran", "adhkar", "study", "plan", "sleep"],
      afternoon: ["study", "quran", "plan", "adhkar", "sleep"],
      evening: ["adhkar", "study", "plan", "quran", "sleep"],
      night: ["sleep", "adhkar", "quran", "plan", "study"]
    }[part];
    var picked = order.filter(function (k) { return !(k === "study" && priStudy); });
    return picked.slice(0, 4).map(function (k) { return tiles[k]; });
  }
  function renderHomeActions() {
    var host = document.getElementById("home-actions");
    if (!host) return;
    host.innerHTML = "";
    host.appendChild(hEl("p", "hh-eyebrow", "Useful right now"));
    var grid = hEl("div", "ha-grid");
    homeActionTiles().forEach(function (t) {
      var b = hEl("button", "ha-tile tint-" + t.tint + (t.done ? " is-done" : ""));
      b.type = "button";
      b.appendChild(hEl("span", "ha-icon", t.icon));
      var txt = hEl("span", "ha-text");
      txt.appendChild(hEl("span", "ha-title", t.title));
      txt.appendChild(hEl("span", "ha-sub", t.sub));
      b.appendChild(txt);
      b.appendChild(hEl("span", "ha-cta", t.done ? "✓ " + t.cta : t.cta));
      b.addEventListener("click", t.fn);
      grid.appendChild(b);
    });
    host.appendChild(grid);
  }

  // A session starting/pausing/stopping changes what's worth suggesting; refresh just those two blocks.
  function refreshHomeCompanion() {
    if (document.getElementById("home-actions")) { renderHomeHamdard(); renderHomeActions(); }
  }

  function paintHomeExtras() {
    renderHomeHamdard();
    renderHomeActions();
    renderHomeProgress();
  }

  // The Home screen is now TODAY (js/features/today.js). renderHome() keeps its name because dozens of older
  // flows call it after saving something; it re-renders Today and, only if the old priority card is currently
  // mounted in a Duniya tool screen, refreshes that card too.
  function renderHome() {
    ensureJourneyStarted();
    if (window.NuraFeatures) window.NuraFeatures.render("today");
    var tool = document.getElementById("view-duniya-tool");
    if (tool && !tool.classList.contains("hidden")) renderTodaysPriority();
  }

  // ---------- FITNESS VIEW ----------

  function renderPhoneExtra(p, container) {
    container.innerHTML = "";
    var meta = document.createElement("p");
    meta.className = "fitness-meta-line";
    meta.textContent = "Away from " + p.distraction + " • Instead: " + p.replacement;
    container.appendChild(meta);
  }

  function renderSleepView(p, container) {
    container.innerHTML = "";
    if (!p.wakeTime) {
      var label = document.createElement("p");
      label.className = "salah-next-label";
      label.textContent = "Sleep started";
      container.appendChild(label);
      var timeP = document.createElement("p");
      timeP.className = "salah-next-name";
      timeP.textContent = new Date(p.sleepStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      container.appendChild(timeP);
      var note = document.createElement("p");
      note.className = "muted-line";
      note.style.marginBottom = "16px";
      note.textContent = "Come back in the morning and tap “I'm Awake.”";
      container.appendChild(note);

      var awakeCard = document.createElement("div");
      awakeCard.style.textAlign = "center";
      var goodMorning = document.createElement("p");
      goodMorning.className = "priority-title";
      goodMorning.textContent = "Good Morning";
      awakeCard.appendChild(goodMorning);
      var areYouAwake = document.createElement("p");
      areYouAwake.className = "priority-why";
      areYouAwake.textContent = "Are you awake?";
      awakeCard.appendChild(areYouAwake);
      container.appendChild(awakeCard);

      var awakeBtn = document.createElement("button");
      awakeBtn.className = "btn btn-primary btn-full";
      awakeBtn.textContent = "I'M AWAKE";
      awakeBtn.addEventListener("click", function () {
        p.wakeTime = new Date().toISOString();
        p.status = "completed";
        savePriority(p);
        memLog("wake_recorded", "sleep", { min: new Date().getHours() * 60 + new Date().getMinutes() });
        renderHome();
      });
      container.appendChild(awakeBtn);

      var editLink = document.createElement("button");
      editLink.className = "priority-change-link";
      editLink.textContent = "Edit sleep time";
      editLink.addEventListener("click", function () {
        var input = prompt("Enter sleep start time (HH:MM, 24h)", new Date(p.sleepStart).toTimeString().slice(0, 5));
        if (!input) return;
        var parts = input.split(":");
        if (parts.length !== 2) { showToast("Enter time as HH:MM"); return; }
        var d = new Date(p.sleepStart);
        d.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
        p.sleepStart = d.toISOString();
        savePriority(p);
        renderHome();
      });
      container.appendChild(editLink);
      return;
    }

    var start = new Date(p.sleepStart);
    var wake = new Date(p.wakeTime);
    var diffMs = wake - start;
    var hours = Math.floor(diffMs / 3600000);
    var mins = Math.round((diffMs % 3600000) / 60000);

    var windowLabel = document.createElement("p");
    windowLabel.className = "salah-next-label";
    windowLabel.textContent = "Sleep window";
    container.appendChild(windowLabel);
    var windowLine = document.createElement("p");
    windowLine.className = "salah-next-name";
    windowLine.style.fontSize = "17px";
    windowLine.textContent = start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " → " + wake.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    container.appendChild(windowLine);

    var estLabel = document.createElement("p");
    estLabel.className = "salah-next-label";
    estLabel.style.marginTop = "12px";
    estLabel.textContent = "Estimated sleep duration";
    container.appendChild(estLabel);
    var estValue = document.createElement("p");
    estValue.className = "salah-countdown";
    estValue.textContent = hours + "h " + mins + "m / 8h target";
    container.appendChild(estValue);

    var disclaimer = document.createElement("p");
    disclaimer.className = "salah-recovery-note";
    disclaimer.textContent = "Estimated from the time between your two taps — NURA can't confirm you were asleep the whole time.";
    container.appendChild(disclaimer);
  }

  function renderFitnessExtra(p, container) {
    container.innerHTML = "";
    var bp = FITNESS_BODY_PARTS.find(function (b) { return b.key === p.bodyPart; }) || FITNESS_BODY_PARTS[0];

    var meta = document.createElement("p");
    meta.className = "fitness-meta-line";
    meta.textContent = bp.label + " • " + p.minutes + " min";
    container.appendChild(meta);

    if (!p.warmupDone && bp.warmup.length) {
      var wTitle = document.createElement("p");
      wTitle.className = "picker-step-title";
      wTitle.textContent = "Warm-up first:";
      container.appendChild(wTitle);
      var list = document.createElement("ul");
      list.className = "fitness-warmup-list";
      bp.warmup.forEach(function (w) {
        var li = document.createElement("li");
        li.textContent = w;
        list.appendChild(li);
      });
      container.appendChild(list);

      var doneBtn = document.createElement("button");
      doneBtn.className = "btn btn-primary btn-full";
      doneBtn.textContent = "Warm-up done — start workout";
      doneBtn.addEventListener("click", function () {
        p.warmupDone = true;
        savePriority(p);
        renderHome();
      });
      container.appendChild(doneBtn);

      var skipBtn = document.createElement("button");
      skipBtn.className = "priority-change-link";
      skipBtn.textContent = "Skip warm-up";
      skipBtn.addEventListener("click", function () {
        p.warmupDone = true;
        savePriority(p);
        renderHome();
      });
      container.appendChild(skipBtn);

      document.getElementById("priority-timer-wrap").classList.add("hidden");
      return;
    }

    var wTitle2 = document.createElement("p");
    wTitle2.className = "picker-step-title";
    wTitle2.textContent = "Workout:";
    container.appendChild(wTitle2);
    var list2 = document.createElement("ul");
    list2.className = "fitness-warmup-list";
    bp.workout.forEach(function (w) {
      var li = document.createElement("li");
      li.textContent = w;
      list2.appendChild(li);
    });
    container.appendChild(list2);
  }

  var PRIORITY_ICONS = { study: "📚", fitness: "🏋️", phone: "📵", sleep: "🌙", salah: "🕌", morning: "☀️" };

  // One honest line under the title, built only from what was actually chosen.
  function priorityMeta(p) {
    if (p.kind === "study") return p.minutes ? p.minutes + " min focus session" : "Focus session";
    if (p.kind === "fitness") { var bp = FITNESS_BODY_PARTS.find(function (b) { return b.key === p.bodyPart; }); return (bp ? bp.label + " · " : "") + (p.minutes ? p.minutes + " min" : "workout"); }
    if (p.kind === "phone") return "Away from " + (p.distraction || "your phone") + (p.minutes ? " · " + p.minutes + " min" : "");
    if (p.kind === "sleep") return p.targetBedtime ? "Target · " + p.targetBedtime : "Rest well";
    if (p.kind === "salah") { var c = getSalahCompletions(); return PRAYER_ORDER.filter(function (n) { return c[n]; }).length + " of 5 prayers marked"; }
    if (p.flowId) { var ga = flowActionById(p.flowId); if (ga && flowApplies(ga, todayKey())) return goalMeta(ga); }
    return p.minutes ? p.minutes + " min" : "Your own goal";
  }

  // ---- a custom goal ("Create your own goal") is a Daily Flow action; the priority card only shows it ----
  // It gets a checkbox / progress control, never a timer: NURA does not decide what the goal means.
  function isGoalPriority(p) { return !!(p && (p.flowId || (!p.planKey && !p.kind))); }
  function goalMeta(a) {
    var today = todayKey(), st = flowState(a, today), V = flowVer(a, today), bits = [];
    var t = flowTimeFor(a, today, true); if (t) bits.push(flowClock(t));
    bits.push(V.type === "simple" ? (a.tag || "Simple tick") : flowProgressText(V, st.v));
    return bits.join(" · ");
  }
  function setGoalPriority(a) {
    var p = { id: uid("pri"), planKey: null, kind: null, flowId: a.id, title: a.name, why: "You chose this as what matters most today.", minutes: null, date: todayKey(), status: "pending" };
    savePriority(p);
    focusState.linkedPriorityId = null;
    focusPrepShownForPriorityId = null;
    return p;
  }
  // keep the priority in step with the Flow action it points at (one source of truth for "done")
  function syncGoalPriority() {
    var p = getCurrentPriority(), today = todayKey();
    if (!p || !p.flowId || p.date !== today) return;
    var a = flowActionById(p.flowId), st = a && flowApplies(a, today) ? flowState(a, today) : null;
    if (!st || st.kind === "skip" || st.kind === "rs") { savePriority(null); return; } // removed, skipped or moved: nothing left to track today
    var want = st.kind === "done" ? "completed" : "pending";
    if (p.status !== want || p.title !== a.name) { p.status = want; p.title = a.name; savePriority(p); }
  }
  // the next day: record how it went from the Flow itself instead of asking again
  function resolveGoalPriority(p) {
    var a = flowActionById(p.flowId), st = a && flowApplies(a, p.date) ? flowState(a, p.date) : null;
    if (st && st.kind !== "skip" && st.kind !== "rs") {
      appendPriorityLog({ date: p.date, planKey: null, title: p.title, minutes: null, status: st.kind === "done" ? "completed" : st.kind === "partial" ? "partial" : "not-yet", source: "flow" });
    }
    savePriority(null);
  }
  function renderGoalPriority(p, el) {
    el.innerHTML = ""; el.classList.remove("hidden");
    var today = todayKey(), a = p.flowId ? flowActionById(p.flowId) : null;
    var done = p.status === "completed";
    if (a) {
      var st = flowState(a, today), V = flowVer(a, today);
      done = st.kind === "done";
      if (V.type !== "simple") {
        var mb = hEl("div", "fl-mbar"); var mf = hEl("span", "fl-mbar-fill"); mf.style.width = Math.round(st.frac * 100) + "%"; mb.appendChild(mf);
        el.appendChild(mb);
        if (V.type !== "value") {
          var row = hEl("div", "fl-stepper");
          var minus = hEl("button", "fl-step", "−"); minus.type = "button"; minus.setAttribute("aria-label", "Less");
          minus.addEventListener("click", function () { flowSetValue(a, today, Math.max(0, st.v - flowStep(V))); });
          var set = hEl("button", "fl-step fl-step-wide", "Set"); set.type = "button";
          set.addEventListener("click", function () { openFlowValueSheet(a, today); });
          var plus = hEl("button", "fl-step", "+"); plus.type = "button"; plus.setAttribute("aria-label", "More");
          plus.addEventListener("click", function () { flowSetValue(a, today, st.v + flowStep(V)); });
          row.appendChild(minus); row.appendChild(set); row.appendChild(plus);
          el.appendChild(row);
        } else {
          var lg = hEl("button", "fl-step fl-step-wide", st.v ? "Edit" : "Log"); lg.type = "button";
          lg.addEventListener("click", function () { openFlowValueSheet(a, today); });
          el.appendChild(lg);
        }
      }
    }
    var toggle = function () {
      if (a) { flowToggle(a, today); return; }
      p.status = p.status === "completed" ? "pending" : "completed"; savePriority(p);
      renderTodaysPriority();
    };
    if (done) {
      el.appendChild(hEl("p", "priority-done-text", "Completed today ✓"));
      var undo = hEl("button", "priority-change-link", "Undo"); undo.type = "button"; undo.addEventListener("click", toggle);
      el.appendChild(undo);
    } else {
      var b = hEl("button", "btn btn-primary btn-full pc-cta", a && flowVer(a, today).type !== "simple" ? "Mark complete" : "Mark done"); b.type = "button";
      b.addEventListener("click", toggle);
      el.appendChild(b);
    }
    if (a) {
      var open = hEl("button", "priority-change-link", "Open in Daily Flow ›"); open.type = "button";
      open.addEventListener("click", function () { openFlow("today"); });
      el.appendChild(open);
    }
  }

  function renderSalahSummary(container) {
    container.innerHTML = "";
    container.appendChild(hEl("p", "pc-note", "Your current prayer is in Right Now, above."));
  }

  function renderTodaysPriority() {
    var checkinEl = document.getElementById("priority-checkin");
    var pickerEl = document.getElementById("priority-picker");
    var emptyEl = document.getElementById("priority-empty");
    var activeEl = document.getElementById("priority-active");
    var genericEl = document.getElementById("priority-view-generic");
    var salahEl = document.getElementById("priority-view-salah");
    var sleepEl = document.getElementById("priority-view-sleep");
    var goalEl = document.getElementById("priority-view-goal");
    [checkinEl, pickerEl, emptyEl, activeEl, genericEl, salahEl, sleepEl, goalEl].forEach(function (e) { e.classList.add("hidden"); });
    var pg = getCurrentPriority();
    if (pg && pg.flowId && pg.date !== todayKey()) resolveGoalPriority(pg);
    document.getElementById("priority-extra-content").innerHTML = "";
    document.getElementById("focus-duration-row").classList.add("hidden");

    if (focusState.adhocLabel) {
      document.getElementById("priority-icon").textContent = "⏱️";
      document.getElementById("priority-title").textContent = focusState.adhocLabel;
      document.getElementById("priority-meta").textContent = "Quick session";
      document.getElementById("priority-why").textContent = "A quick session — separate from today's chosen priority.";
      activeEl.classList.remove("hidden");
      genericEl.classList.remove("hidden");
      document.getElementById("priority-timer-wrap").classList.remove("hidden");
      document.getElementById("priority-done-text").classList.add("hidden");
      document.getElementById("priority-change-btn").classList.add("hidden");
      updateFocusUI();
      return;
    }
    document.getElementById("priority-change-btn").classList.remove("hidden");

    var p = getCurrentPriority();
    var today = todayKey();

    if (p && p.date !== today && p.status === "pending") {
      var checkinText = p.kind === "salah"
        ? "Yesterday's Salah Consistency — " + PRAYER_ORDER.filter(function (n) { return (readJSON("nc_salah_completions", {})[p.date] || {})[n]; }).length + " of 5 prayers marked complete. What happened overall?"
        : "Yesterday you planned: “" + p.title + "”. What happened?";
      document.getElementById("priority-checkin-text").textContent = checkinText;
      checkinEl.classList.remove("hidden");
      renderProgressLine();
      return;
    }

    if (!p || p.date !== today) {
      // Nothing chosen yet: an invitation first; the picker only opens on purpose (or when a
      // Duniya tool has already started a multi-step choice).
      if (pickerStep.view !== "main" || priorityPickerOpen) {
        renderPresetPicker();
        pickerEl.classList.remove("hidden");
      } else {
        emptyEl.classList.remove("hidden");
      }
      renderProgressLine();
      return;
    }

    priorityPickerOpen = false;
    document.getElementById("priority-icon").textContent = PRIORITY_ICONS[p.planKey] || "⭐";
    document.getElementById("priority-title").textContent = p.title;
    document.getElementById("priority-meta").textContent = priorityMeta(p);
    document.getElementById("priority-why").textContent = "Why this? " + p.why;
    activeEl.classList.remove("hidden");

    if (isGoalPriority(p)) { renderGoalPriority(p, goalEl); renderProgressLine(); return; }

    if (p.kind === "salah") {
      salahEl.classList.remove("hidden");
      renderSalahSummary(salahEl);
      renderProgressLine();
      return;
    }

    if (p.kind === "sleep") {
      sleepEl.classList.remove("hidden");
      renderSleepView(p, sleepEl);
      renderProgressLine();
      return;
    }

    genericEl.classList.remove("hidden");

    if (focusState.linkedPriorityId !== p.id) {
      focusState.linkedPriorityId = p.id;
      if (!focusState.running) {
        if (p.minutes) setFocusDurationMinutes(p.minutes);
        focusState.remaining = focusSecondsTotal();
      }
    }

    if (p.kind === "fitness") {
      renderFitnessExtra(p, document.getElementById("priority-extra-content"));
    } else if (p.kind === "phone") {
      renderPhoneExtra(p, document.getElementById("priority-extra-content"));
    }

    var timerWrap = document.getElementById("priority-timer-wrap");
    var doneText = document.getElementById("priority-done-text");
    var isPending = p.status === "pending";
    var showTimer = isPending && (p.kind !== "fitness" || p.warmupDone);
    timerWrap.classList.toggle("hidden", !showTimer);
    doneText.classList.toggle("hidden", isPending);
    if (showTimer) document.getElementById("focus-duration-row").classList.toggle("hidden", !!p.minutes);

    updateFocusUI();
    renderProgressLine();
  }

  function initPriorityUI() {
    document.getElementById("duniya-tool-back").addEventListener("click", function () { setActiveView("duniya"); });
    document.getElementById("checkin-completed-btn").addEventListener("click", function () { submitAccountability("completed"); });
    document.getElementById("checkin-partly-btn").addEventListener("click", function () { submitAccountability("partial"); });
    document.getElementById("checkin-notyet-btn").addEventListener("click", function () { submitAccountability("not-yet"); });

    // "Create your own goal": nothing is decided from the words. The goal opens a short setup (when, how
    // often, how it's tracked); Finish saves it into Daily Flow and shows it here as today's priority.
    function saveCustom() {
      var input = document.getElementById("priority-custom-input");
      var val = input.value.trim();
      if (!val) return;
      openFlowAddSheet(null, { goal: true, name: val, onCreated: function (a) {
        input.value = "";
        pendingAdjustmentNote = null;
        if (flowApplies(a, todayKey())) { setGoalPriority(a); priorityPickerOpen = false; }
      } });
    }
    document.getElementById("priority-custom-btn").addEventListener("click", saveCustom);
    document.getElementById("priority-custom-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") saveCustom();
    });

    document.getElementById("priority-change-btn").addEventListener("click", chooseDifferentPriority);
    document.getElementById("priority-open-picker").addEventListener("click", function () {
      priorityPickerOpen = true;
      renderTodaysPriority();
    });

    document.getElementById("progress-details-close").addEventListener("click", function () {
      document.getElementById("modal-progress-details").classList.add("hidden");
    });

  }

  // ---------- FOCUS TIMER ----------

  var DURATION_PRESETS = [5, 10, 15, 20, 25, 30, 45, 60];

  function getFocusDurationMinutes() {
    var stored = Number(localStorage.getItem("nc_focus_duration"));
    return stored > 0 ? stored : 20;
  }

  function setFocusDurationMinutes(mins) {
    localStorage.setItem("nc_focus_duration", String(mins));
  }

  function focusSecondsTotal() {
    return getFocusDurationMinutes() * 60;
  }

  var focusState = { remaining: focusSecondsTotal(), running: false, intervalId: null, linkedPriorityId: null, adhocLabel: null };

  function formatClock(seconds) {
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  function updateFocusUI() {
    var total = focusSecondsTotal();
    var clock = document.getElementById("focus-clock");
    if (clock) clock.textContent = formatClock(focusState.remaining);
    var startBtn = document.getElementById("focus-start-btn");
    var pauseBtn = document.getElementById("focus-pause-btn");
    var stopBtn = document.getElementById("focus-stop-btn");
    if (!startBtn) return;
    startBtn.classList.toggle("hidden", focusState.running);
    pauseBtn.classList.toggle("hidden", !focusState.running);
    stopBtn.classList.toggle("hidden", focusState.remaining === total && !focusState.running);
    var resumeShown = !focusState.running && focusState.remaining > 0 && focusState.remaining < total;
    startBtn.textContent = resumeShown ? "Continue" : "Start";
    renderFocusDurationUI();
    if (getCurrentPriority()) renderProgressLine(getCurrentPriority());
  }

  function renderFocusDurationUI() {
    var total = focusSecondsTotal();
    var lockedIn = focusState.running || focusState.remaining !== total;
    var mins = getFocusDurationMinutes();
    document.querySelectorAll(".duration-chip").forEach(function (chip) {
      var chipMins = Number(chip.dataset.minutes);
      chip.classList.toggle("active", chipMins === mins);
      chip.disabled = lockedIn;
    });
    var customInput = document.getElementById("focus-duration-custom");
    if (!customInput) return;
    customInput.disabled = lockedIn;
    if (document.activeElement !== customInput) {
      customInput.value = DURATION_PRESETS.indexOf(mins) === -1 ? mins : "";
    }
  }

  function tickFocus() {
    focusState.remaining -= 1;
    if (focusState.remaining <= 0) {
      focusState.remaining = 0;
      stopFocusInterval();
      focusState.running = false;
      updateFocusUI();
      openFocusCheckModal();
      return;
    }
    updateFocusUI();
  }

  function stopFocusInterval() {
    if (focusState.intervalId) {
      clearInterval(focusState.intervalId);
      focusState.intervalId = null;
    }
  }

  function beginFocusInterval() {
    focusState.running = true;
    stopFocusInterval();
    focusState.intervalId = setInterval(tickFocus, 1000);
    updateFocusUI();
    refreshHomeCompanion();
  }

  function startFocusForPriority() {
    var p = getCurrentPriority();
    if (!p) return;
    if (p.minutes) setFocusDurationMinutes(p.minutes);
    focusState.remaining = focusSecondsTotal();
    focusState.linkedPriorityId = p.id;
    focusState.adhocLabel = null;
    if (p.planKey === "study") memLog("study_started", "study", { minutes: p.minutes });
    beginFocusInterval();
    var clock = document.getElementById("focus-clock");
    if (clock) clock.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function startAdhocFocus(label, minutes, planKey) {
    if (minutes) setFocusDurationMinutes(minutes);
    focusState.remaining = focusSecondsTotal();
    focusState.linkedPriorityId = null;
    focusState.adhocLabel = label;
    focusState.adhocMinutes = getFocusDurationMinutes();
    focusState.adhocPlanKey = planKey || null;
    beginFocusInterval();
  }

  function pauseFocus() {
    focusState.running = false;
    stopFocusInterval();
    updateFocusUI();
    refreshHomeCompanion();
  }

  function stopFocus() {
    focusState.running = false;
    stopFocusInterval();
    focusState.remaining = focusSecondsTotal();
    focusState.adhocLabel = null;
    updateFocusUI();
    refreshHomeCompanion();
  }

  function openFocusCheckModal() {
    var p = focusState.linkedPriorityId ? getCurrentPriority() : null;
    var label = (p && p.id === focusState.linkedPriorityId) ? p.title : focusState.adhocLabel;
    document.getElementById("focus-check-text").textContent = label
      ? ("Did you actually finish “" + label + "”, or just the timer?")
      : "Did you actually finish what you were working on, or just the timer?";
    document.getElementById("modal-focus-check").classList.remove("hidden");
  }

  function selectFocusDuration(mins) {
    var total = focusSecondsTotal();
    if (focusState.running || focusState.remaining !== total) {
      showToast("Finish or stop the current session before changing the length");
      return;
    }
    setFocusDurationMinutes(mins);
    focusState.remaining = focusSecondsTotal();
    updateFocusUI();
  }

  function initFocusTimer() {
    document.getElementById("focus-start-btn").addEventListener("click", function () {
      if (getCurrentPriority()) startFocusForPriority();
    });
    document.getElementById("focus-pause-btn").addEventListener("click", pauseFocus);
    document.getElementById("focus-stop-btn").addEventListener("click", function () { stopFocus(); renderHome(); });

    document.querySelectorAll(".duration-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        selectFocusDuration(Number(chip.dataset.minutes));
      });
    });

    var customInput = document.getElementById("focus-duration-custom");
    customInput.addEventListener("change", function () {
      var val = Math.round(Number(customInput.value));
      if (val > 0 && val <= 180) {
        selectFocusDuration(val);
      } else {
        showToast("Enter a number of minutes between 1 and 180");
        renderFocusDurationUI();
      }
    });

    document.getElementById("focus-check-done").addEventListener("click", function () {
      if (focusState.linkedPriorityId) {
        markPriorityStatusToday("completed");
      } else if (focusState.adhocLabel) {
        // A session started from Bhai isn't today's chosen priority, but a confirmed
        // finish is still real history — it goes in the same log the graph and weekly
        // numbers already read, never as a guess.
        appendPriorityLog({ id: uid("ses"), date: todayKey(), planKey: focusState.adhocPlanKey || "adhoc", kind: focusState.adhocPlanKey || null, title: focusState.adhocLabel, minutes: focusState.adhocMinutes || null, status: "completed", source: "bhai" });
        showToast("Session saved");
      }
      document.getElementById("modal-focus-check").classList.add("hidden");
      stopFocus();
      renderHome();
    });

    document.getElementById("focus-check-notdone").addEventListener("click", function () {
      document.getElementById("modal-focus-check").classList.add("hidden");
      stopFocus();
      renderHome();
    });

    updateFocusUI();
  }

  // ---------- SUNNAH: ROUTINE ----------

  // Dhikr citations below were cross-checked against sunnah.com/named
  // hadith numbering before use (see docs/decisions.md), not generated
  // from memory. Ayat al-Kursi's Arabic is pulled directly from the
  // already-verified Tanzil Quran file (Surah 2:255), not re-typed.
  var AFTER_SALAH_DHIKR_ITEMS = [
    {
      arabic: "اللَّهُمَّ أَنْتَ السَّلَامُ وَمِنْكَ السَّلَامُ، تَبَارَكْتَ يَا ذَا الْجَلَالِ وَالْإِكْرَامِ",
      transliteration: "Allahumma antas-salamu wa minkas-salam, tabarakta ya dhal-jalali wal-ikram",
      meaning: "O Allah, You are Peace and from You comes peace. Blessed are You, Owner of majesty and honor.",
      source: "Sahih Muslim 592, narrated by A’ishah"
    },
    {
      arabic: "سُبْحَانَ اللَّهِ (٣٣) الْحَمْدُ لِلَّهِ (٣٣) اللَّهُ أَكْبَرُ (٣٣) لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ",
      transliteration: "SubhanAllah (x33), Alhamdulillah (x33), Allahu Akbar (x33), then: La ilaha illallah, wahdahu la sharika lah, lahul-mulku wa lahul-hamd, wa huwa 'ala kulli shay'in qadir",
      meaning: "Glory be to Allah (33x), praise be to Allah (33x), Allah is Greatest (33x), then: There is no god but Allah, alone, without partner; His is the dominion and His is the praise, and He is capable of all things.",
      source: "Sahih Muslim 597a, narrated by Abu Hurairah",
      tasbih: { mode: "phases", phases: [
        { label: "SubhanAllah", arabic: "سُبْحَانَ اللَّهِ", target: 33 },
        { label: "Alhamdulillah", arabic: "الْحَمْدُ لِلَّهِ", target: 33 },
        { label: "Allahu Akbar", arabic: "اللَّهُ أَكْبَرُ", target: 33 }
      ] }
    },
    {
      arabic: "ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ ٱلْحَىُّ ٱلْقَيُّومُ لَا تَأْخُذُهُۥ سِنَةٌ وَلَا نَوْمٌ لَّهُۥ مَا فِى ٱلسَّمَٰوَٰتِ وَمَا فِى ٱلْأَرْضِ مَن ذَا ٱلَّذِى يَشْفَعُ عِندَهُۥٓ إِلَّا بِإِذْنِهِۦ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ وَلَا يُحِيطُونَ بِشَىْءٍ مِّنْ عِلْمِهِۦٓ إِلَّا بِمَا شَآءَ وَسِعَ كُرْسِيُّهُ ٱلسَّمَٰوَٰتِ وَٱلْأَرْضَ وَلَا يَـُٔودُهُۥ حِفْظُهُمَا وَهُوَ ٱلْعَلِىُّ ٱلْعَظِيمُ",
      ruku: 35,
      transliteration: null,
      meaning: "Ayat al-Kursi (Surah Al-Baqarah 2:255). Translation not yet added — see Sunnah → Quran for the verified Arabic source.",
      source: "Reciting it after each prescribed prayer: An-Nasa’i, Al-Kubra 9848, graded sahih by An-Nasa’i and Ibn Hibban, narrated by Abu Umamah. Verse text: Tanzil Project (Qur’an 2:255). Ruku number from Quran Foundation (api.quran.com)."
    }
  ];

  var MORNING_DHIKR_ITEMS = [{
    arabic: "أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَٰهَ إِلَّا اللهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ",
    transliteration: "Asbahna wa asbahal mulku lillah, wal-hamdu lillah, la ilaha illallahu wahdahu la sharika lah, lahul-mulku wa lahul-hamd, wa huwa 'ala kulli shay'in qadir",
    meaning: "We have entered the morning, and with it all dominion belongs to Allah, and praise is for Allah. There is no god but Allah, alone, without partner. His is the dominion and His is the praise, and He is capable of all things.",
    source: "Sahih Muslim 2723"
  }];

  var EVENING_DHIKR_ITEMS = [{
    arabic: "أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَٰهَ إِلَّا اللهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ",
    transliteration: "Amsayna wa amsal mulku lillah, wal-hamdu lillah, la ilaha illallahu wahdahu la sharika lah, lahul-mulku wa lahul-hamd, wa huwa 'ala kulli shay'in qadir",
    meaning: "We have entered the evening, and with it all dominion belongs to Allah, and praise is for Allah. There is no god but Allah, alone, without partner. His is the dominion and His is the praise, and He is capable of all things.",
    source: "Sahih Muslim 2723 (evening form — recited with ‘Amsayna’ in place of ‘Asbahna’)"
  }];

  var AYATKURSI_ITEMS = [{
    arabic: "ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ ٱلْحَىُّ ٱلْقَيُّومُ لَا تَأْخُذُهُۥ سِنَةٌ وَلَا نَوْمٌ لَّهُۥ مَا فِى ٱلسَّمَٰوَٰتِ وَمَا فِى ٱلْأَرْضِ مَن ذَا ٱلَّذِى يَشْفَعُ عِندَهُۥٓ إِلَّا بِإِذْنِهِۦ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ وَلَا يُحِيطُونَ بِشَىْءٍ مِّنْ عِلْمِهِۦٓ إِلَّا بِمَا شَآءَ وَسِعَ كُرْسِيُّهُ ٱلسَّمَٰوَٰتِ وَٱلْأَرْضَ وَلَا يَـُٔودُهُۥ حِفْظُهُمَا وَهُوَ ٱلْعَلِىُّ ٱلْعَظِيمُ",
    ruku: 35,
    transliteration: null,
    meaning: "Ayat al-Kursi (Surah Al-Baqarah 2:255). Translation not yet added — see Sunnah → Quran for the verified Arabic source.",
    source: "Tanzil Project (Qur’an 2:255). Ruku number from Quran Foundation (api.quran.com)."
  }];

  var ROUTINE_SECTIONS = [
    { id: "before-sleep", title: "Before Sleep", actions: [
      { id: "bs-wudu", name: "Make wudu before sleeping" },
      { id: "bs-ayatkursi", name: "Recite Ayat al-Kursi", items: AYATKURSI_ITEMS },
      { id: "bs-lasttwo", name: "Recite the last two verses of Al-Baqarah", items: [
        {
          arabic: "مَنْ قَرَأَ بِالآيَتَيْنِ مِنْ آخِرِ سُورَةِ الْبَقَرَةِ فِي لَيْلَةٍ كَفَتَاهُ",
          transliteration: "Man qara'a bil-ayatayni min akhiri surat al-Baqarah fi laylatin kafatah",
          meaning: "Whoever recites the last two verses of Surat al-Baqarah on a night, they will be sufficient for him.",
          source: "Sahih al-Bukhari 5009, Sahih Muslim 807, narrated by Abu Mas'ud"
        },
        {
          arabic: "ءَامَنَ ٱلرَّسُولُ بِمَآ أُنزِلَ إِلَيْهِ مِن رَّبِّهِۦ وَٱلْمُؤْمِنُونَ كُلٌّ ءَامَنَ بِٱللَّهِ وَمَلَٰٓئِكَتِهِۦ وَكُتُبِهِۦ وَرُسُلِهِۦ لَا نُفَرِّقُ بَيْنَ أَحَدٍ مِّن رُّسُلِهِۦ وَقَالُوا۟ سَمِعْنَا وَأَطَعْنَا غُفْرَانَكَ رَبَّنَا وَإِلَيْكَ ٱلْمَصِيرُ لَا يُكَلِّفُ ٱللَّهُ نَفْسًا إِلَّا وُسْعَهَا لَهَا مَا كَسَبَتْ وَعَلَيْهَا مَا ٱكْتَسَبَتْ رَبَّنَا لَا تُؤَاخِذْنَآ إِن نَّسِينَآ أَوْ أَخْطَأْنَا رَبَّنَا وَلَا تَحْمِلْ عَلَيْنَآ إِصْرًا كَمَا حَمَلْتَهُۥ عَلَى ٱلَّذِينَ مِن قَبْلِنَا رَبَّنَا وَلَا تُحَمِّلْنَا مَا لَا طَاقَةَ لَنَا بِهِۦ وَٱعْفُ عَنَّا وَٱغْفِرْ لَنَا وَٱرْحَمْنَآ أَنتَ مَوْلَىٰنَا فَٱنصُرْنَا عَلَى ٱلْقَوْمِ ٱلْكَٰفِرِينَ",
          ruku: 41,
          transliteration: null,
          meaning: "(2:285) The Messenger has believed in what was revealed to him from his Lord, and [so have] the believers. All of them have believed in Allah and His angels and His books and His messengers, “We make no distinction between any of His messengers.” And they say, “We hear and we obey. [We seek] Your forgiveness, our Lord, and to You is the [final] destination.” (2:286) Allah does not charge a soul except with that within its capacity. It will have the consequence of what good it has gained, and it will bear the consequence of what evil it has earned. “Our Lord, do not impose blame upon us if we have forgotten or erred. Our Lord, do not lay upon us a burden like that which You laid upon those before us. Our Lord, do not burden us with that which we have no ability to bear. And pardon us, and forgive us, and have mercy upon us. You are our protector, so give us victory over the disbelieving people.”",
          source: "Surah Al-Baqarah 2:285–286. Arabic: Tanzil Project. Translation: Saheeh International, via the Quran Foundation API (api.quran.com). Ruku number from Quran Foundation."
        }
      ] },
      { id: "bs-tasbih", name: "Tasbih before sleep", items: [
        {
          arabic: "تُسَبِّحِينَ اللَّهَ عِنْدَ مَنَامِكِ ثَلَاثًا وَثَلَاثِينَ، وَتَحْمَدِينَ اللَّهَ ثَلَاثًا وَثَلَاثِينَ، وَتُكَبِّرِينَ اللَّهَ أَرْبَعًا وَثَلَاثِينَ",
          transliteration: "Tusabbihina Allaha 'inda manamiki thalathan wa thalathin, wa tahmadina Allaha thalathan wa thalathin, wa tukabbirina Allaha arba'an wa thalathin",
          meaning: "When you go to bed, recite 'Subhan Allah' thirty-three times, 'Alhamdulillah' thirty-three times, and 'Allahu Akbar' thirty-four times.",
          source: "Sahih al-Bukhari 5362, narrated by Ali ibn Abi Talib — the Prophet ﷺ taught this to Fatimah instead of a servant",
          tasbih: { mode: "phases", phases: [
            { label: "SubhanAllah", arabic: "سُبْحَانَ اللَّهِ", target: 33 },
            { label: "Alhamdulillah", arabic: "الْحَمْدُ لِلَّهِ", target: 33 },
            { label: "Allahu Akbar", arabic: "اللَّهُ أَكْبَرُ", target: 34 }
          ] }
        }
      ] },
      { id: "bs-dua", name: "Make a short dua before sleeping" }
    ]},
    { id: "tahajjud", title: "Tahajjud", actions: [
      { id: "th-intention", name: "Set an intention or alarm for Tahajjud" },
      { id: "th-pray", name: "Pray Tahajjud" }
    ]},
    { id: "fajr", title: "Fajr", actions: [
      { id: "fj-sunnah-before", name: "Pray Sunnah before Fajr (2 rakah)" },
      { id: "fj-pray", name: "Pray Fajr on time" },
      { id: "fj-dhikr", name: "Dhikr after salah", items: AFTER_SALAH_DHIKR_ITEMS }
    ]},
    { id: "morning-adhkar", title: "Morning Adhkar", actions: [
      { id: "ma-ayatkursi", name: "Ayat al-Kursi", items: AYATKURSI_ITEMS },
      { id: "ma-dhikr", name: "Morning dhikr (Asbahna...)", items: MORNING_DHIKR_ITEMS },
      { id: "ma-quran", name: "Read a portion of Qur'an", link: { subtab: "quran", label: "Open Quran" } }
    ]},
    { id: "ishraq-duha", title: "Ishraq / Duha", actions: [
      { id: "id-ishraq", name: "Pray Ishraq after sunrise" },
      { id: "id-duha", name: "Pray Duha" }
    ]},
    { id: "dhuhr", title: "Dhuhr", actions: [
      { id: "dh-before", name: "Sunnah before Dhuhr" },
      { id: "dh-pray", name: "Pray Dhuhr on time" },
      { id: "dh-dhikr", name: "Dhikr after salah", items: AFTER_SALAH_DHIKR_ITEMS },
      { id: "dh-after", name: "Sunnah after Dhuhr" }
    ]},
    { id: "jumuah", title: "Jumu'ah (Friday)", actions: [
      { id: "jm-ghusl", name: "Take ghusl before Jumu'ah", items: [
        {
          arabic: "إِذَا جَاءَ أَحَدُكُمُ الْجُمُعَةَ فَلْيَغْتَسِلْ",
          transliteration: "Idha ja'a ahadukumul-Jumu'ata falyaghtasil",
          meaning: "Anyone of you attending the Friday (prayer) should take a bath.",
          source: "Sahih al-Bukhari 877, narrated by Abdullah ibn Umar"
        }
      ] },
      { id: "jm-early", name: "Go early to the masjid", items: [
        {
          arabic: "مَنِ اغْتَسَلَ يَوْمَ الْجُمُعَةِ غُسْلَ الْجَنَابَةِ ثُمَّ رَاحَ فَكَأَنَّمَا قَرَّبَ بَدَنَةً",
          transliteration: "Man ightasala yawmal-Jumu'ati ghusla-l-janabati thumma rah, fa ka'annama qarraba badanah...",
          meaning: "Whoever takes a bath on Friday like the bath for major ritual impurity and then goes early (in the first hour), it is as if he sacrificed a camel; going later each hour is likened to a smaller sacrifice, down to just an egg in the last hour before the khutbah begins.",
          source: "Sahih al-Bukhari 881, narrated by Abu Hurairah"
        }
      ] },
      { id: "jm-kahf", name: "Recite Surah Al-Kahf", link: { subtab: "quran", label: "Open Al-Kahf", surah: 18 }, items: [
        {
          arabic: "مَنْ قَرَأَ سُورَةَ الْكَهْفِ فِي يَوْمِ الْجُمُعَةِ أَضَاءَ لَهُ النُّورُ مَا بَيْنَ الْجُمُعَتَيْنِ",
          transliteration: "Man qara'a Surata-l-Kahfi fi yawmi-l-Jumu'ati adaa'a lahun-nuru ma baynal-Jumu'atayn",
          meaning: "Whoever reads Surah al-Kahf on the day of Jumu'ah, a light will shine for him between the two Fridays.",
          source: "Mustadrak al-Hakim; graded Sahih in Sahih at-Targhib wa at-Tarhib 736, narrated by Abu Sa'id al-Khudri"
        }
      ] },
      { id: "jm-salawat", name: "Send extra salawat on the Prophet ﷺ", items: [
        {
          arabic: "إِنَّ مِنْ أَفْضَلِ أَيَّامِكُمْ يَوْمَ الْجُمُعَةِ ... فَأَكْثِرُوا عَلَىَّ مِنَ الصَّلاَةِ فِيهِ",
          transliteration: "Inna min afdali ayyamikum yawmal-Jumu'ah ... fa akthiru 'alayya minas-salati fih",
          meaning: "Among the most excellent of your days is Friday, so send more blessings (salawat) upon me on that day, for your blessings are presented to me.",
          source: "Sunan Abi Dawud 1047, graded Sahih (Al-Albani), narrated by Aws ibn Aws"
        }
      ] },
      { id: "jm-pray", name: "Pray Jumu'ah" },
      { id: "jm-quiet", name: "Stay silent and listen during the khutbah", items: [
        {
          arabic: "إِذَا قُلْتَ لِصَاحِبِكَ يَوْمَ الْجُمُعَةِ أَنْصِتْ وَالإِمَامُ يَخْطُبُ فَقَدْ لَغَوْتَ",
          transliteration: "Idha qulta li-sahibika yawmal-Jumu'ati ansit wal-imamu yakhtubu faqad laghawt",
          meaning: "If you even tell your companion to 'be quiet' while the Imam is delivering the khutbah, you have spoken needlessly (and reduced your reward).",
          source: "Sahih al-Bukhari 934, narrated by Abu Hurairah"
        }
      ] },
      { id: "jm-dua-hour", name: "Make dua — there's an hour of acceptance", items: [
        {
          arabic: "فِيهِ سَاعَةٌ لاَ يُوَافِقُهَا عَبْدٌ مُسْلِمٌ وَهْوَ قَائِمٌ يُصَلِّي يَسْأَلُ اللَّهَ تَعَالَى شَيْئًا إِلاَّ أَعْطَاهُ إِيَّاهُ",
          transliteration: "Fihi sa'atun la yuwafiquha 'abdun Muslimun wa huwa qa'imun yusalli yas'alu-llaha ta'ala shay'an illa a'tahu iyyah",
          meaning: "There is an hour on Friday in which, if a Muslim prays and asks Allah for something, He will give it to him. The Prophet ﷺ indicated it is a short time (commonly held to be in the last hour before Maghrib).",
          source: "Sahih al-Bukhari 935, narrated by Abu Hurairah"
        }
      ] }
    ]},
    { id: "asr", title: "Asr", actions: [
      { id: "as-pray", name: "Pray Asr on time" },
      { id: "as-dhikr", name: "Dhikr after salah", items: AFTER_SALAH_DHIKR_ITEMS }
    ]},
    { id: "maghrib", title: "Maghrib", actions: [
      { id: "mg-pray", name: "Pray Maghrib on time" },
      { id: "mg-dhikr", name: "Dhikr after salah", items: AFTER_SALAH_DHIKR_ITEMS },
      { id: "mg-evening", name: "Begin evening adhkar" }
    ]},
    { id: "evening-adhkar", title: "Evening Adhkar", actions: [
      { id: "ea-ayatkursi", name: "Ayat al-Kursi", items: AYATKURSI_ITEMS },
      { id: "ea-dhikr", name: "Evening dhikr (Amsayna...)", items: EVENING_DHIKR_ITEMS }
    ]},
    { id: "isha", title: "Isha", actions: [
      { id: "is-pray", name: "Pray Isha on time" },
      { id: "is-dhikr", name: "Dhikr after salah", items: AFTER_SALAH_DHIKR_ITEMS }
    ]},
    { id: "witr", title: "Witr", actions: [
      { id: "wt-pray", name: "Pray Witr", items: [
        {
          arabic: "اللَّهُمَّ اهْدِنِي فِيمَنْ هَدَيْتَ، وَعَافِنِي فِيمَنْ عَافَيْتَ، وَتَوَلَّنِي فِيمَنْ تَوَلَّيْتَ، وَبَارِكْ لِي فِيمَا أَعْطَيْتَ، وَقِنِي شَرَّ مَا قَضَيْتَ، فَإِنَّكَ تَقْضِي وَلَا يُقْضَى عَلَيْكَ، وَإِنَّهُ لَا يَذِلُّ مَنْ وَالَيْتَ، تَبَارَكْتَ رَبَّنَا وَتَعَالَيْتَ",
          transliteration: "Allahummahdini fiman hadayt, wa 'afini fiman 'afayt, wa tawallani fiman tawallayt, wa barik li fima a'tayt, wa qini sharra ma qadayt, fa innaka taqdi wa la yuqda 'alayk, wa innahu la yadhillu man walayt, tabarakta Rabbana wa ta'alayt",
          meaning: "O Allah, guide me among those You have guided, pardon me among those You have pardoned, befriend me among those You have befriended, bless me in what You have granted, and save me from the evil that You have decreed. Indeed You decree, and none can pass decree upon You. He is not humiliated whom You have befriended. Blessed are You, our Lord, and Exalted.",
          source: "Jami' at-Tirmidhi 464, graded Sahih (Darussalam), narrated by Al-Hasan ibn Ali — Dua al-Qunoot, taught to him by the Prophet ﷺ to recite in Witr"
        }
      ] }
    ]}
  ];

  // Citations cross-checked against sunnah.com / named hadith numbers
  // before use (see docs/decisions.md). Where a hadith's authenticity
  // grading wasn't independently confirmed, only the source (collection +
  // number) is given, not a grading claim.
  var AKHLAQ_ITEMS = [
    { id: "ch-gaze", name: "Lower your gaze", items: [{
      arabic: "يَا عَلِيُّ لاَ تُتْبِعِ النَّظْرَةَ النَّظْرَةَ فَإِنَّ لَكَ الأُولَى وَلَيْسَتْ لَكَ الآخِرَةُ",
      transliteration: "Ya Ali, la tutbi'in-nazrata an-nazrah, fa inna laka al-ula wa laysat laka al-akhirah",
      meaning: "O Ali, do not follow one glance with another — the first is forgiven, but not the second.",
      source: "Sunan Abi Dawud 2149, the Prophet speaking to Ali"
    }]},
    { id: "ch-speech", name: "Speak kindly, avoid backbiting", items: [{
      arabic: "مَنْ كَانَ يُؤْمِنُ بِاللَّهِ وَالْيَوْمِ الآخِرِ فَلْيَقُلْ خَيْرًا أَوْ لِيَصْمُتْ",
      transliteration: "Man kana yu'minu billahi wal-yawmil-akhiri falyaqul khayran aw liyasmut",
      meaning: "Whoever believes in Allah and the Last Day should speak what is good or remain silent.",
      source: "Sahih al-Bukhari 6136 / 6475, Sahih Muslim 47, narrated by Abu Hurairah"
    }]},
    { id: "ch-charity", name: "Give charity, even something small", items: [{
      arabic: "اتَّقُوا النَّارَ وَلَوْ بِشِقِّ تَمْرَةٍ",
      transliteration: "Ittaqun-nara wa law bi-shiqqi tamrah",
      meaning: "Protect yourself from the Fire, even with half a date given in charity.",
      source: "Sahih al-Bukhari 6540, Sahih Muslim 1016, narrated by ‘Adi ibn Hatim"
    }]},
    { id: "ch-help", name: "Help someone today", items: [{
      arabic: "وَاللَّهُ فِي عَوْنِ الْعَبْدِ مَا كَانَ الْعَبْدُ فِي عَوْنِ أَخِيهِ",
      transliteration: "Wallahu fi 'awnil-'abdi ma kanal-'abdu fi 'awni akhih",
      meaning: "Allah helps His servant for as long as the servant helps his brother.",
      source: "Sahih Muslim 2699a, narrated by Abu Hurairah"
    }]},
    { id: "ch-anger", name: "Keep your anger in check", items: [{
      arabic: "لَيْسَ الشَّدِيدُ بِالصُّرَعَةِ، إِنَّمَا الشَّدِيدُ الَّذِي يَمْلِكُ نَفْسَهُ عِنْدَ الْغَضَبِ",
      transliteration: "Laysash-shadidu bis-su'rah, innamash-shadidul-ladhi yamliku nafsahu 'indal-ghadab",
      meaning: "The strong one is not the one who overpowers others; the strong one is the one who controls himself when angry.",
      source: "Sahih al-Bukhari 6114, Sahih Muslim 2609, narrated by Abu Hurairah"
    }]},
    { id: "ch-salam", name: "Smile and give salam", items: [{
      arabic: "تَبَسُّمُكَ فِي وَجْهِ أَخِيكَ لَكَ صَدَقَةٌ",
      transliteration: "Tabassumuka fi wajhi akhika laka sadaqah",
      meaning: "Your smiling in the face of your brother is charity.",
      source: "Jami’ at-Tirmidhi 1956, narrated by Abu Dharr (graded hasan gharib by at-Tirmidhi)"
    }]},
    { id: "ch-gratitude", name: "Take one moment of gratitude", items: [{
      arabic: "لاَ يَشْكُرُ اللَّهَ مَنْ لاَ يَشْكُرُ النَّاسَ",
      transliteration: "La yashkurullaha man la yashkurun-nas",
      meaning: "Whoever does not thank people has not thanked Allah.",
      source: "Sunan Abi Dawud 4811, narrated by Abu Hurairah (graded sahih by Al-Albani)"
    }]},
    { id: "ch-tongue", name: "Guard your tongue", items: [{
      arabic: "مَنْ يَضْمَنْ لِي مَا بَيْنَ لَحْيَيْهِ وَمَا بَيْنَ رِجْلَيْهِ أَضْمَنْ لَهُ الْجَنَّةَ",
      transliteration: "Man yadman li ma bayna lahyayhi wa ma bayna rijlayhi adman lahul-jannah",
      meaning: "Whoever guarantees me what is between his jaws (his tongue) and what is between his legs, I guarantee him Paradise.",
      source: "Sahih al-Bukhari 6474, narrated by Sahl ibn Sa’d"
    }]},
    { id: "ch-knowledge", name: "Seek a little knowledge today", items: [{
      arabic: "مَنْ سَلَكَ طَرِيقًا يَلْتَمِسُ فِيهِ عِلْمًا سَهَّلَ اللَّهُ لَهُ بِهِ طَرِيقًا إِلَى الْجَنَّةِ",
      transliteration: "Man salaka tariqan yaltamisu fihi 'ilman sahhalallahu lahu bihi tariqan ilal-jannah",
      meaning: "Whoever takes a path seeking knowledge, Allah makes easy for him a path to Paradise.",
      source: "Sahih Muslim 2699a — the same hadith as “Help someone today” above, narrated by Abu Hurairah"
    }]},
    { id: "ch-character", name: "Aim for good character, not just correct actions", items: [{
      arabic: "إِنَّ مِنْ خِيَارِكُمْ أَحْسَنَكُمْ أَخْلاَقًا",
      transliteration: "Inna min khiyarikum ahsanakum akhlaqan",
      meaning: "Indeed, among the best of you are those with the best character.",
      source: "Sahih al-Bukhari 3559, narrated by ‘Abdullah ibn ‘Amr"
    }]},
    { id: "ch-neighbor", name: "Make sure your neighbor is safe from your harm", items: [{
      arabic: "لَا يَدْخُلُ الْجَنَّةَ مَنْ لَا يَأْمَنُ جَارُهُ بَوَائِقَهُ",
      transliteration: "La yadkhulul-jannata man la ya'manu jaruhu bawa'iqah",
      meaning: "He will not enter Paradise whose neighbor is not safe from his harm.",
      source: "Sahih Muslim 46, narrated by Abu Hurairah"
    }]}
  ];

  var sunnahSectionOpenState = {};

  function getSunnahLogs() {
    return readJSON("nc_sunnah_log", {});
  }

  function getDaySunnahLog(dateKey) {
    var all = getSunnahLogs();
    return all[dateKey] || {};
  }

  function setDaySunnahLog(dateKey, log) {
    var all = getSunnahLogs();
    all[dateKey] = log;
    writeJSON("nc_sunnah_log", all);
  }

  function toggleSunnahAction(actionId) {
    var key = todayKey();
    var log = getDaySunnahLog(key);
    log[actionId] = !log[actionId];
    setDaySunnahLog(key, log);
    if (log[actionId]) memLog("sunnah_completed", "sunnah", { id: actionId });
  }

  var sunnahItemExpandState = {};

  function loadTasbihState(key) {
    var all = {};
    try { all = JSON.parse(localStorage.getItem("nc_tasbih_counts") || "{}"); } catch (e) { all = {}; }
    var state = all[key];
    var today = todayKey();
    if (!state || state.date !== today) {
      state = { date: today, phaseIndex: 0, count: 0 };
    }
    return state;
  }

  function saveTasbihState(key, state) {
    var all = {};
    try { all = JSON.parse(localStorage.getItem("nc_tasbih_counts") || "{}"); } catch (e) { all = {}; }
    all[key] = state;
    localStorage.setItem("nc_tasbih_counts", JSON.stringify(all));
  }

  function vibrateSafe(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* no-op */ }
  }

  function pulseCircle(circle) {
    circle.classList.remove("tasbih-pulse");
    void circle.offsetWidth;
    circle.classList.add("tasbih-pulse");
  }

  function buildTasbihCounter(key, config) {
    var state = loadTasbihState(key);
    var wrap = document.createElement("div");
    wrap.className = "tasbih-counter";

    function resetState() {
      state = { date: todayKey(), phaseIndex: 0, count: 0 };
      saveTasbihState(key, state);
      render();
    }

    function render() {
      wrap.innerHTML = "";

      if (config.mode === "phases" && state.phaseIndex >= config.phases.length) {
        var doneText = document.createElement("p");
        doneText.className = "tasbih-done-text";
        doneText.textContent = "✓ Completed";
        wrap.appendChild(doneText);
        var startOver = document.createElement("button");
        startOver.type = "button";
        startOver.className = "tasbih-reset-link";
        startOver.textContent = "Start again";
        startOver.addEventListener("click", resetState);
        wrap.appendChild(startOver);
        return;
      }

      var phase = config.mode === "phases" ? config.phases[state.phaseIndex] : null;
      var target = phase ? phase.target : null;

      if (phase) {
        var label = document.createElement("div");
        label.className = "tasbih-phase-label";
        label.textContent = phase.label + " (" + (state.phaseIndex + 1) + "/" + config.phases.length + ")";
        wrap.appendChild(label);
      }

      var circle = document.createElement("button");
      circle.type = "button";
      circle.className = "tasbih-tap-circle" + (target ? "" : " tasbih-tap-circle-free");
      if (target) {
        var pct = Math.min(100, Math.round((state.count / target) * 100));
        circle.style.background = "conic-gradient(var(--mint) " + pct + "%, var(--surface-2) " + pct + "%)";
      }
      var num = document.createElement("span");
      num.className = "tasbih-count-num";
      num.textContent = state.count;
      circle.appendChild(num);
      if (target) {
        var targetSpan = document.createElement("span");
        targetSpan.className = "tasbih-count-target";
        targetSpan.textContent = "/" + target;
        circle.appendChild(targetSpan);
      }
      circle.addEventListener("click", function () {
        state.count++;
        pulseCircle(circle);
        if (target && state.count >= target) {
          vibrateSafe([15, 40, 15]);
          state.phaseIndex++;
          state.count = 0;
        } else {
          vibrateSafe(10);
        }
        saveTasbihState(key, state);
        render();
      });
      wrap.appendChild(circle);

      var controls = document.createElement("div");
      controls.className = "tasbih-controls";
      var reset = document.createElement("button");
      reset.type = "button";
      reset.className = "tasbih-reset-link";
      reset.textContent = "Reset";
      reset.addEventListener("click", function (e) {
        e.stopPropagation();
        resetState();
      });
      controls.appendChild(reset);
      wrap.appendChild(controls);
    }

    render();
    return wrap;
  }

  function buildSunnahItemDetail(items, actionId) {
    var detail = document.createElement("div");
    detail.className = "sunnah-item-detail hidden";
    items.forEach(function (entry, idx) {
      if (idx > 0) {
        var divider = document.createElement("div");
        divider.className = "sunnah-item-divider";
        detail.appendChild(divider);
      }
      if (entry.ruku) {
        var rukuBadge = document.createElement("p");
        rukuBadge.className = "sunnah-item-ruku";
        rukuBadge.textContent = "Ruku " + entry.ruku;
        detail.appendChild(rukuBadge);
      }

      var arabic = document.createElement("p");
      arabic.className = "sunnah-item-arabic";
      arabic.dir = "rtl";
      arabic.lang = "ar";
      arabic.textContent = entry.arabic;
      detail.appendChild(arabic);

      if (entry.transliteration) {
        var translit = document.createElement("p");
        translit.className = "dua-translit";
        translit.textContent = entry.transliteration;
        detail.appendChild(translit);
      }
      var meaning = document.createElement("p");
      meaning.className = "dua-meaning";
      meaning.textContent = entry.meaning;
      detail.appendChild(meaning);

      var source = document.createElement("p");
      source.className = "hadith-source";
      source.textContent = "Source: " + entry.source;
      detail.appendChild(source);

      if (entry.tasbih) {
        detail.appendChild(buildTasbihCounter(actionId + "-" + idx, entry.tasbih));
      }
    });
    return detail;
  }

  function buildSunnahItem(action, log) {
    var wrap = document.createElement("div");
    wrap.className = "sunnah-item-wrap";

    var item = document.createElement("div");
    item.className = "habit-item";
    var name = document.createElement("span");
    name.className = "name";
    name.textContent = action.name;
    var done = !!log[action.id];
    var toggle = document.createElement("button");
    toggle.className = "habit-toggle" + (done ? " done" : "");
    toggle.textContent = done ? "Done" : "Mark done";
    toggle.addEventListener("click", function () {
      toggleSunnahAction(action.id);
      renderRoutine();
      renderAkhlaq();
    });
    item.appendChild(name);

    if (action.items && action.items.length) {
      var expandBtn = document.createElement("button");
      expandBtn.className = "sunnah-item-expand-btn";
      var isOpen = !!sunnahItemExpandState[action.id];
      expandBtn.textContent = isOpen ? "Hide" : "Source";
      expandBtn.addEventListener("click", function () {
        sunnahItemExpandState[action.id] = !sunnahItemExpandState[action.id];
        renderRoutine();
        renderAkhlaq();
      });
      item.appendChild(expandBtn);
    }

    if (action.link && action.link.subtab) {
      var linkBtn = document.createElement("button");
      linkBtn.className = "sunnah-item-expand-btn";
      linkBtn.textContent = action.link.label || "Open";
      linkBtn.addEventListener("click", function () {
        switchSunnahSubtab(action.link.subtab);
        if (action.link.surah) openQuranSurah(action.link.surah);
      });
      item.appendChild(linkBtn);
    }

    item.appendChild(toggle);
    wrap.appendChild(item);

    if (action.items && action.items.length) {
      var detail = buildSunnahItemDetail(action.items, action.id);
      if (sunnahItemExpandState[action.id]) detail.classList.remove("hidden");
      wrap.appendChild(detail);
    }

    return wrap;
  }

  function buildRoutineSection(section, log) {
    var wrap = document.createElement("div");
    var isOpen = !!sunnahSectionOpenState[section.id];
    wrap.className = "sunnah-section" + (isOpen ? " open" : "");

    var doneCount = section.actions.reduce(function (sum, a) {
      return sum + (log[a.id] ? 1 : 0);
    }, 0);

    var header = document.createElement("button");
    header.className = "sunnah-section-header";
    header.type = "button";

    var titleWrap = document.createElement("div");
    titleWrap.className = "sunnah-section-title";
    var h3 = document.createElement("h3");
    h3.textContent = section.title;
    var badge = document.createElement("span");
    badge.className = "count-badge";
    badge.textContent = doneCount + " of " + section.actions.length;
    titleWrap.appendChild(h3);
    titleWrap.appendChild(badge);

    var chevron = document.createElement("span");
    chevron.className = "sunnah-section-chevron";
    chevron.textContent = "›";
    chevron.setAttribute("aria-hidden", "true");

    header.appendChild(titleWrap);
    header.appendChild(chevron);
    header.addEventListener("click", function () {
      sunnahSectionOpenState[section.id] = !sunnahSectionOpenState[section.id];
      renderRoutine();
    });

    var body = document.createElement("div");
    body.className = "sunnah-section-body" + (isOpen ? "" : " hidden");
    section.actions.forEach(function (action) {
      body.appendChild(buildSunnahItem(action, log));
    });

    wrap.appendChild(header);
    wrap.appendChild(body);
    return wrap;
  }

  function renderRoutine() {
    document.getElementById("sunnah-date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    var log = getDaySunnahLog(todayKey());
    var wrap = document.getElementById("routine-sections");
    wrap.innerHTML = "";
    ROUTINE_SECTIONS.forEach(function (section) {
      wrap.appendChild(buildRoutineSection(section, log));
    });
  }

  function renderAkhlaq() {
    var log = getDaySunnahLog(todayKey());
    var list = document.getElementById("akhlaq-list");
    list.innerHTML = "";
    AKHLAQ_ITEMS.forEach(function (a) {
      list.appendChild(buildSunnahItem(a, log));
    });
  }

  function switchSunnahSubtab(subtabId) {
    var buttons = document.querySelectorAll("#sunnah-subtabs .subtab");
    var targetPanel = document.getElementById("sunnah-panel-" + subtabId);
    if (!targetPanel) return;
    buttons.forEach(function (b) {
      b.classList.toggle("active", b.dataset.subtab === subtabId);
    });
    document.querySelectorAll(".sunnah-panel").forEach(function (p) { p.classList.add("hidden"); });
    targetPanel.classList.remove("hidden");
    targetPanel.scrollIntoView({ block: "start" });
  }

  function initSunnahSubtabs() {
    var buttons = document.querySelectorAll("#sunnah-subtabs .subtab");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchSunnahSubtab(btn.dataset.subtab);
      });
    });
  }

  // ---------- DUAS ----------

  var duasState = { view: "categories", categoryId: null, duaId: null };

  function getDuaFavorites() {
    return readJSON("nc_dua_favorites", []);
  }

  function toggleDuaFavorite(duaId) {
    var favs = getDuaFavorites();
    var idx = favs.indexOf(duaId);
    if (idx === -1) favs.push(duaId); else favs.splice(idx, 1);
    writeJSON("nc_dua_favorites", favs);
  }

  function duasByCategory(categoryId) {
    return window.NURA_DUAS.duas.filter(function (d) { return d.categoryId === categoryId; });
  }

  function setDuasView(view) {
    duasState.view = view;
    ["categories", "list", "detail"].forEach(function (v) {
      document.getElementById("duas-" + v + "-view").classList.toggle("hidden", v !== view);
    });
    document.getElementById("duas-search-results-view").classList.add("hidden");
    document.getElementById("duas-back-row").classList.toggle("hidden", view === "categories");
  }

  function renderDuaCategories() {
    var grid = document.getElementById("dua-category-grid");
    grid.innerHTML = "";
    window.NURA_DUAS.categories.forEach(function (cat) {
      var count = duasByCategory(cat.id).length;
      var card = document.createElement("button");
      card.className = "dua-category-card" + (count === 0 ? " empty" : "");
      card.innerHTML = '<span class="cat-name">' + cat.name + '</span><span class="cat-count">' + (count === 0 ? "Pending verified content" : (count + (count === 1 ? " dua" : " duas"))) + '</span>';
      card.addEventListener("click", function () {
        duasState.categoryId = cat.id;
        renderDuaList(cat.id);
        setDuasView("list");
      });
      grid.appendChild(card);
    });
  }

  function buildDuaListItem(dua) {
    var favs = getDuaFavorites();
    var item = document.createElement("button");
    item.className = "dua-list-item";
    var textWrap = document.createElement("span");
    var title = document.createElement("span");
    title.className = "dua-list-title";
    title.textContent = dua.title;
    var catName = (window.NURA_DUAS.categories.find(function (c) { return c.id === dua.categoryId; }) || {}).name || "";
    var catLine = document.createElement("span");
    catLine.className = "dua-list-cat";
    catLine.textContent = catName;
    textWrap.appendChild(title);
    textWrap.appendChild(catLine);
    var fav = document.createElement("span");
    fav.className = "dua-list-fav";
    fav.textContent = favs.indexOf(dua.id) !== -1 ? "★" : "☆";
    item.appendChild(textWrap);
    item.appendChild(fav);
    item.addEventListener("click", function () {
      duasState.duaId = dua.id;
      renderDuaDetail(dua.id);
      setDuasView("detail");
    });
    return item;
  }

  function renderDuaList(categoryId) {
    var cat = window.NURA_DUAS.categories.find(function (c) { return c.id === categoryId; });
    document.getElementById("duas-list-title").textContent = cat ? cat.name : "";
    var list = document.getElementById("dua-list");
    list.innerHTML = "";
    var duas = duasByCategory(categoryId);
    if (!duas.length) {
      var empty = document.createElement("p");
      empty.className = "dua-empty-state";
      empty.textContent = "No verified duas in this category yet. The structure is ready — content will be added once a reliable source is verified.";
      list.appendChild(empty);
      return;
    }
    duas.forEach(function (d) { list.appendChild(buildDuaListItem(d)); });
  }

  function renderDuaDetail(duaId) {
    var dua = window.NURA_DUAS.duas.find(function (d) { return d.id === duaId; });
    if (!dua) return;
    document.getElementById("dua-detail-source").textContent = dua.source;
    document.getElementById("dua-detail-title").textContent = dua.title;
    document.getElementById("dua-detail-arabic").textContent = dua.arabic;
    document.getElementById("dua-detail-translit").textContent = dua.transliteration;
    document.getElementById("dua-detail-meaning").textContent = dua.meaning;
    var favBtn = document.getElementById("dua-detail-fav");
    var isFav = getDuaFavorites().indexOf(dua.id) !== -1;
    favBtn.classList.toggle("active", isFav);
    favBtn.onclick = function () {
      toggleDuaFavorite(dua.id);
      renderDuaDetail(dua.id);
    };
    document.getElementById("dua-copy-btn").onclick = function () {
      var text = dua.title + "\n\n" + dua.arabic + "\n\n" + dua.transliteration + "\n\n" + dua.meaning + "\n\nSource: " + dua.source;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          showToast("Copied");
        }).catch(function () {
          showToast("Couldn't copy on this device");
        });
      } else {
        showToast("Copy not supported on this device");
      }
    };
    document.getElementById("dua-share-btn").onclick = function () {
      var text = dua.title + "\n\n" + dua.arabic + "\n\n" + dua.transliteration + "\n\n" + dua.meaning + "\n\nSource: " + dua.source;
      if (navigator.share) {
        navigator.share({ title: dua.title, text: text }).catch(function () {});
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { showToast("Sharing not available — copied instead"); });
      } else {
        showToast("Sharing not available on this device");
      }
    };
  }

  function renderDuaSearch(query) {
    var favOnly = document.getElementById("duas-favorites-toggle").getAttribute("aria-pressed") === "true";
    var favs = getDuaFavorites();
    var q = query.trim().toLowerCase();
    var results = window.NURA_DUAS.duas.filter(function (d) {
      if (favOnly && favs.indexOf(d.id) === -1) return false;
      if (!q) return favOnly;
      var cat = window.NURA_DUAS.categories.find(function (c) { return c.id === d.categoryId; });
      var hay = (d.title + " " + d.meaning + " " + d.transliteration + " " + (cat ? cat.name : "")).toLowerCase();
      return hay.indexOf(q) !== -1;
    });

    document.getElementById("duas-categories-view").classList.add("hidden");
    document.getElementById("duas-list-view").classList.add("hidden");
    document.getElementById("duas-detail-view").classList.add("hidden");
    document.getElementById("duas-back-row").classList.add("hidden");
    document.getElementById("duas-search-results-view").classList.remove("hidden");

    var wrap = document.getElementById("dua-search-results");
    wrap.innerHTML = "";
    if (!results.length) {
      var empty = document.createElement("p");
      empty.className = "dua-empty-state";
      empty.textContent = favOnly && !q ? "No favorites yet — tap the star on any dua to save it here." : "No duas match your search.";
      wrap.appendChild(empty);
      return;
    }
    results.forEach(function (d) { wrap.appendChild(buildDuaListItem(d)); });
  }

  function initDuasUI() {
    document.getElementById("duas-back-btn").addEventListener("click", function () {
      var input = document.getElementById("duas-search-input");
      input.value = "";
      document.getElementById("duas-favorites-toggle").setAttribute("aria-pressed", "false");
      if (duasState.view === "detail") {
        renderDuaList(duasState.categoryId);
        setDuasView("list");
      } else {
        renderDuaCategories();
        setDuasView("categories");
      }
    });

    var searchInput = document.getElementById("duas-search-input");
    var favToggle = document.getElementById("duas-favorites-toggle");

    function updateFromSearch() {
      var q = searchInput.value;
      var favOn = favToggle.getAttribute("aria-pressed") === "true";
      if (q.trim() || favOn) {
        renderDuaSearch(q);
      } else {
        renderDuaCategories();
        setDuasView("categories");
      }
    }

    searchInput.addEventListener("input", updateFromSearch);
    favToggle.addEventListener("click", function () {
      var pressed = favToggle.getAttribute("aria-pressed") === "true";
      favToggle.setAttribute("aria-pressed", pressed ? "false" : "true");
      updateFromSearch();
    });

    renderDuaCategories();
  }

  // ---------- VAULT ----------
  // Real encryption: AES-GCM 256 via Web Crypto SubtleCrypto, key derived
  // from the user's passphrase with PBKDF2 (150,000 iterations, SHA-256).
  // The passphrase itself is never stored; the derived key lives only in
  // memory for the current unlocked session (module-level var below), never
  // in localStorage. Not independently security-audited — labeled as such
  // in the Vault settings screen. See CLAUDE.md Section 9 / docs/decisions.md.

  var VAULT_SECTIONS = [
    { id: "hamdard", name: "Hamdard / Private Reflection" },
    { id: "triggers", name: "Trigger & Struggle Notes" },
    { id: "career", name: "Career Audit" },
    { id: "principles", name: "My Personal Code / Principles" }
  ];

  var vaultKey = null;              // CryptoKey, memory-only
  var vaultDecrypted = null;        // [{id, section, title, body, createdAt, updatedAt}], memory-only
  var vaultState = { view: "checking", sectionId: null, entryId: null, editingId: null };

  function hasWebCrypto() {
    return !!(window.crypto && window.crypto.subtle);
  }

  function bufToBase64(buf) {
    var bytes = new Uint8Array(buf);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function base64ToBuf(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function getVaultMeta() {
    return readJSON("nc_vault_meta", null);
  }

  function getVaultEntriesRaw() {
    return readJSON("nc_vault_entries", []);
  }

  function saveVaultEntriesRaw(entries) {
    writeJSON("nc_vault_entries", entries);
  }

  function deriveVaultKey(passphrase, saltB64) {
    var enc = new TextEncoder();
    var salt = base64ToBuf(saltB64);
    return window.crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"])
      .then(function (keyMaterial) {
        return window.crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: salt, iterations: 150000, hash: "SHA-256" },
          keyMaterial,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        );
      });
  }

  function vaultEncrypt(key, plaintext) {
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    var enc = new TextEncoder();
    return window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, enc.encode(plaintext))
      .then(function (cipherBuf) {
        return { iv: bufToBase64(iv), data: bufToBase64(cipherBuf) };
      });
  }

  function vaultDecrypt(key, ivB64, dataB64) {
    var iv = base64ToBuf(ivB64);
    var data = base64ToBuf(dataB64);
    return window.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, data)
      .then(function (plainBuf) {
        return new TextDecoder().decode(plainBuf);
      });
  }

  function createVault(passphrase) {
    var salt = window.crypto.getRandomValues(new Uint8Array(16));
    var saltB64 = bufToBase64(salt);
    return deriveVaultKey(passphrase, saltB64).then(function (key) {
      return vaultEncrypt(key, "nura-vault-ok").then(function (check) {
        writeJSON("nc_vault_meta", { salt: saltB64, checkIv: check.iv, checkData: check.data, createdAt: Date.now() });
        vaultKey = key;
        vaultDecrypted = [];
        return true;
      });
    });
  }

  function unlockVault(passphrase) {
    var meta = getVaultMeta();
    if (!meta) return Promise.reject(new Error("no-vault"));
    var derivedKey;
    return deriveVaultKey(passphrase, meta.salt)
      .then(function (key) {
        derivedKey = key;
        return vaultDecrypt(key, meta.checkIv, meta.checkData);
      })
      .catch(function () {
        // Wrong passphrase produces an AES-GCM auth failure here — that's
        // the only place a bad passphrase should be reported from. A later
        // failure decrypting an individual entry is a different problem
        // (e.g. leftover data from a different key) and must not be
        // reported as "wrong passphrase" — see per-entry catch below.
        throw new Error("wrong-passphrase");
      })
      .then(function (plain) {
        if (plain !== "nura-vault-ok") throw new Error("wrong-passphrase");
        vaultKey = derivedKey;
        var raw = getVaultEntriesRaw();
        return Promise.all(raw.map(function (e) {
          return Promise.all([
            vaultDecrypt(derivedKey, e.titleIv, e.titleData),
            vaultDecrypt(derivedKey, e.bodyIv, e.bodyData)
          ]).then(function (parts) {
            return { id: e.id, section: e.section, title: parts[0], body: parts[1], createdAt: e.createdAt, updatedAt: e.updatedAt };
          }).catch(function () {
            return null; // skip an entry that can't be decrypted rather than failing the whole unlock
          });
        })).then(function (entries) {
          vaultDecrypted = entries.filter(function (e) { return e !== null; });
          return true;
        });
      });
  }

  function lockVault() {
    vaultKey = null;
    vaultDecrypted = null;
  }

  function saveVaultEntry(section, title, body, editingId) {
    return Promise.all([vaultEncrypt(vaultKey, title || "Untitled"), vaultEncrypt(vaultKey, body)]).then(function (parts) {
      var raw = getVaultEntriesRaw();
      var now = Date.now();
      if (editingId) {
        raw = raw.map(function (e) {
          if (e.id !== editingId) return e;
          return { id: e.id, section: section, titleIv: parts[0].iv, titleData: parts[0].data, bodyIv: parts[1].iv, bodyData: parts[1].data, createdAt: e.createdAt, updatedAt: now };
        });
        vaultDecrypted = vaultDecrypted.map(function (e) {
          if (e.id !== editingId) return e;
          return { id: e.id, section: section, title: title || "Untitled", body: body, createdAt: e.createdAt, updatedAt: now };
        });
      } else {
        var id = uid("v");
        raw.push({ id: id, section: section, titleIv: parts[0].iv, titleData: parts[0].data, bodyIv: parts[1].iv, bodyData: parts[1].data, createdAt: now, updatedAt: now });
        vaultDecrypted.push({ id: id, section: section, title: title || "Untitled", body: body, createdAt: now, updatedAt: now });
      }
      saveVaultEntriesRaw(raw);
    });
  }

  function deleteVaultEntry(id) {
    saveVaultEntriesRaw(getVaultEntriesRaw().filter(function (e) { return e.id !== id; }));
    vaultDecrypted = vaultDecrypted.filter(function (e) { return e.id !== id; });
  }

  function clearVaultCompletely() {
    localStorage.removeItem("nc_vault_meta");
    localStorage.removeItem("nc_vault_entries");
    vaultKey = null;
    vaultDecrypted = null;
  }

  function vaultEntriesBySection(sectionId) {
    return (vaultDecrypted || []).filter(function (e) { return e.section === sectionId; })
      .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }

  function showVaultScreen(screenId) {
    document.querySelectorAll(".vault-screen").forEach(function (el) { el.classList.add("hidden"); });
    document.getElementById(screenId).classList.remove("hidden");
  }

  function renderVaultRoot() {
    if (!hasWebCrypto()) {
      showVaultScreen("vault-locked");
      document.getElementById("vault-locked").innerHTML = '<section class="card"><p class="pending-note">This browser does not support the Web Crypto API needed for real encryption, so Vault cannot safely open here. Try a modern browser (recent Chrome, Firefox, Safari, or Edge).</p></section>';
      return;
    }
    var meta = getVaultMeta();
    if (!meta) {
      vaultState.view = "setup";
      showVaultScreen("vault-setup");
    } else if (!vaultKey) {
      vaultState.view = "locked";
      showVaultScreen("vault-locked");
      document.getElementById("vault-unlock-pass").value = "";
      document.getElementById("vault-unlock-error").classList.add("hidden");
    } else {
      vaultState.view = "home";
      renderVaultHome();
      showVaultScreen("vault-home");
    }
  }

  function renderVaultHome() {
    document.getElementById("vault-search-input").value = "";
    document.getElementById("vault-search-results-wrap").classList.add("hidden");
    document.getElementById("vault-section-grid-wrap").classList.remove("hidden");
    var grid = document.getElementById("vault-section-grid");
    grid.innerHTML = "";
    VAULT_SECTIONS.forEach(function (sec) {
      var count = vaultEntriesBySection(sec.id).length;
      var card = document.createElement("button");
      card.className = "dua-category-card";
      card.innerHTML = '<span class="cat-name">' + sec.name + '</span><span class="cat-count">' + count + (count === 1 ? " entry" : " entries") + '</span>';
      card.addEventListener("click", function () {
        vaultState.sectionId = sec.id;
        renderVaultSection(sec.id);
        showVaultScreen("vault-section-view");
      });
      grid.appendChild(card);
    });
  }

  function buildVaultEntryItem(entry) {
    var sec = VAULT_SECTIONS.find(function (s) { return s.id === entry.section; });
    var item = document.createElement("button");
    item.className = "dua-list-item";
    var textWrap = document.createElement("span");
    var title = document.createElement("span");
    title.className = "dua-list-title";
    title.textContent = entry.title;
    var preview = document.createElement("span");
    preview.className = "vault-entry-preview";
    preview.textContent = (entry.body || "").slice(0, 60) + (entry.body && entry.body.length > 60 ? "…" : "");
    var dateLine = document.createElement("span");
    dateLine.className = "vault-entry-date";
    dateLine.textContent = new Date(entry.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + (sec && vaultState.view !== "section" ? " · " + sec.name : "");
    textWrap.appendChild(title);
    textWrap.appendChild(preview);
    textWrap.appendChild(document.createElement("br"));
    textWrap.appendChild(dateLine);
    item.appendChild(textWrap);
    item.addEventListener("click", function () {
      vaultState.entryId = entry.id;
      renderVaultDetail(entry.id);
      showVaultScreen("vault-entry-detail");
    });
    return item;
  }

  function renderVaultSection(sectionId) {
    var sec = VAULT_SECTIONS.find(function (s) { return s.id === sectionId; });
    document.getElementById("vault-section-title").textContent = sec ? sec.name : "";
    var list = document.getElementById("vault-entry-list");
    list.innerHTML = "";
    var entries = vaultEntriesBySection(sectionId);
    if (!entries.length) {
      var empty = document.createElement("p");
      empty.className = "dua-empty-state";
      empty.textContent = "No entries yet. Tap “+ New” to write your first one.";
      list.appendChild(empty);
      return;
    }
    entries.forEach(function (e) { list.appendChild(buildVaultEntryItem(e)); });
  }

  function renderVaultDetail(entryId) {
    var entry = (vaultDecrypted || []).find(function (e) { return e.id === entryId; });
    if (!entry) return;
    document.getElementById("vault-detail-title").textContent = entry.title;
    document.getElementById("vault-detail-body").textContent = entry.body;
    var updated = new Date(entry.updatedAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    document.getElementById("vault-detail-date").textContent = "Last updated " + updated;
  }

  function openVaultEntryForm(sectionId, editingEntry) {
    vaultState.editingId = editingEntry ? editingEntry.id : null;
    document.getElementById("vault-entry-title-input").value = editingEntry ? editingEntry.title : "";
    document.getElementById("vault-entry-body-input").value = editingEntry ? editingEntry.body : "";
    vaultState.sectionId = sectionId;
    showVaultScreen("vault-entry-form");
  }

  function initVault() {
    document.getElementById("vault-setup-create").addEventListener("click", function () {
      var pass = document.getElementById("vault-setup-pass").value;
      var confirm = document.getElementById("vault-setup-confirm").value;
      var errEl = document.getElementById("vault-setup-error");
      errEl.classList.add("hidden");
      if (!pass || pass.length < 4) {
        errEl.textContent = "Passphrase must be at least 4 characters.";
        errEl.classList.remove("hidden");
        return;
      }
      if (pass !== confirm) {
        errEl.textContent = "Passphrases don't match.";
        errEl.classList.remove("hidden");
        return;
      }
      createVault(pass).then(function () {
        document.getElementById("vault-setup-pass").value = "";
        document.getElementById("vault-setup-confirm").value = "";
        renderVaultRoot();
        showToast("Vault created");
      });
    });

    document.getElementById("vault-unlock-btn").addEventListener("click", function () {
      var pass = document.getElementById("vault-unlock-pass").value;
      var errEl = document.getElementById("vault-unlock-error");
      errEl.classList.add("hidden");
      unlockVault(pass).then(function () {
        renderVaultRoot();
      }).catch(function () {
        errEl.textContent = "Incorrect passphrase.";
        errEl.classList.remove("hidden");
      });
    });

    document.getElementById("vault-forgot-btn").addEventListener("click", function () {
      showVaultScreen("vault-forgot");
    });
    document.getElementById("vault-forgot-back-btn").addEventListener("click", function () {
      showVaultScreen("vault-locked");
    });
    document.getElementById("vault-forgot-erase-btn").addEventListener("click", function () {
      var confirmed = window.confirm("This permanently erases your Vault and every entry inside it. This cannot be undone. Continue?");
      if (!confirmed) return;
      clearVaultCompletely();
      renderVaultRoot();
      showToast("Vault erased");
    });

    document.getElementById("vault-lock-btn").addEventListener("click", function () {
      lockVault();
      renderVaultRoot();
    });

    document.getElementById("vault-section-back").addEventListener("click", function () {
      renderVaultHome();
      showVaultScreen("vault-home");
    });

    document.getElementById("vault-new-entry-btn").addEventListener("click", function () {
      openVaultEntryForm(vaultState.sectionId, null);
    });

    document.getElementById("vault-form-back").addEventListener("click", function () {
      if (vaultState.sectionId) {
        renderVaultSection(vaultState.sectionId);
        showVaultScreen("vault-section-view");
      } else {
        renderVaultHome();
        showVaultScreen("vault-home");
      }
    });

    document.getElementById("vault-entry-save-btn").addEventListener("click", function () {
      var title = document.getElementById("vault-entry-title-input").value.trim();
      var body = document.getElementById("vault-entry-body-input").value;
      if (!body.trim()) {
        showToast("Write something before saving");
        return;
      }
      saveVaultEntry(vaultState.sectionId, title, body, vaultState.editingId).then(function () {
        vaultState.editingId = null;
        renderVaultSection(vaultState.sectionId);
        showVaultScreen("vault-section-view");
        showToast("Saved");
      });
    });

    document.getElementById("vault-detail-back").addEventListener("click", function () {
      renderVaultSection(vaultState.sectionId);
      showVaultScreen("vault-section-view");
    });

    document.getElementById("vault-detail-edit").addEventListener("click", function () {
      var entry = (vaultDecrypted || []).find(function (e) { return e.id === vaultState.entryId; });
      if (entry) openVaultEntryForm(entry.section, entry);
    });

    document.getElementById("vault-detail-delete").addEventListener("click", function () {
      var confirmed = window.confirm("Delete this entry? This cannot be undone.");
      if (!confirmed) return;
      deleteVaultEntry(vaultState.entryId);
      renderVaultSection(vaultState.sectionId);
      showVaultScreen("vault-section-view");
      showToast("Entry deleted");
    });

    document.getElementById("vault-settings-open-btn").addEventListener("click", function () {
      document.getElementById("vault-change-current").value = "";
      document.getElementById("vault-change-new").value = "";
      document.getElementById("vault-change-confirm").value = "";
      document.getElementById("vault-change-error").classList.add("hidden");
      showVaultScreen("vault-settings-view");
    });
    document.getElementById("vault-settings-back").addEventListener("click", function () {
      renderVaultHome();
      showVaultScreen("vault-home");
    });

    document.getElementById("vault-change-btn").addEventListener("click", function () {
      var current = document.getElementById("vault-change-current").value;
      var next = document.getElementById("vault-change-new").value;
      var confirmNew = document.getElementById("vault-change-confirm").value;
      var errEl = document.getElementById("vault-change-error");
      errEl.classList.add("hidden");

      unlockVault(current).then(function () {
        if (!next || next.length < 4) {
          errEl.textContent = "New passphrase must be at least 4 characters.";
          errEl.classList.remove("hidden");
          return;
        }
        if (next !== confirmNew) {
          errEl.textContent = "New passphrases don't match.";
          errEl.classList.remove("hidden");
          return;
        }
        var entriesToReencrypt = vaultDecrypted.slice();
        return createVault(next).then(function () {
          // Old ciphertext was encrypted under the old key/salt and can
          // never be decrypted with the new key — clear it before writing
          // fresh entries, and do so one at a time (not Promise.all) since
          // saveVaultEntry does a read-modify-write on localStorage that
          // would race and drop entries if run in parallel.
          saveVaultEntriesRaw([]);
          var chain = Promise.resolve();
          entriesToReencrypt.forEach(function (e) {
            chain = chain.then(function () {
              return saveVaultEntry(e.section, e.title, e.body, null);
            });
          });
          return chain;
        }).then(function () {
          showToast("Passphrase changed");
          renderVaultRoot();
        });
      }).catch(function () {
        errEl.textContent = "Current passphrase is incorrect.";
        errEl.classList.remove("hidden");
      });
    });

    document.getElementById("vault-clear-btn").addEventListener("click", function () {
      var confirmed = window.confirm("This permanently deletes your passphrase and every Vault entry on this device. This cannot be undone. Continue?");
      if (!confirmed) return;
      clearVaultCompletely();
      renderVaultRoot();
      showToast("Vault cleared");
    });

    var vaultSearchInput = document.getElementById("vault-search-input");
    vaultSearchInput.addEventListener("input", function () {
      var q = vaultSearchInput.value.trim().toLowerCase();
      var resultsWrap = document.getElementById("vault-search-results-wrap");
      var gridWrap = document.getElementById("vault-section-grid-wrap");
      if (!q) {
        resultsWrap.classList.add("hidden");
        gridWrap.classList.remove("hidden");
        return;
      }
      gridWrap.classList.add("hidden");
      resultsWrap.classList.remove("hidden");
      var results = (vaultDecrypted || []).filter(function (e) {
        return (e.title + " " + e.body).toLowerCase().indexOf(q) !== -1;
      }).sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      var list = document.getElementById("vault-search-results");
      list.innerHTML = "";
      if (!results.length) {
        var empty = document.createElement("p");
        empty.className = "dua-empty-state";
        empty.textContent = "No entries match your search.";
        list.appendChild(empty);
        return;
      }
      results.forEach(function (e) { list.appendChild(buildVaultEntryItem(e)); });
    });
  }

  // ---------- QURAN VERSE OF THE DAY ----------
  // Arabic text: verbatim from the Tanzil Project (tanzil.net), CC BY 3.0 —
  // attribution required, text must not be altered. No translation shown yet.

  var QURAN_DATA_URL = "assets/quran/quran-uthmani.txt";
  var quranVersesCache = null;
  var quranLoadPromise = null;

  function loadQuranVerses() {
    if (quranVersesCache) return Promise.resolve(quranVersesCache);
    if (quranLoadPromise) return quranLoadPromise;
    quranLoadPromise = fetch(QURAN_DATA_URL)
      .then(function (res) { return res.text(); })
      .then(function (text) {
        var verses = [];
        text.split("\n").forEach(function (line) {
          var m = line.match(/^(\d+)\|(\d+)\|(.+)$/);
          if (m) verses.push({ surah: Number(m[1]), ayah: Number(m[2]), text: m[3].trim() });
        });
        quranVersesCache = verses;
        return verses;
      });
    return quranLoadPromise;
  }

  function getTodayVerseIndex(total) {
    var epoch = Date.UTC(2024, 0, 1);
    var daysSince = Math.floor((Date.now() - epoch) / 86400000);
    return ((daysSince % total) + total) % total;
  }

  function renderVerseOfDay() {
    var box = document.getElementById("verse-box");
    loadQuranVerses().then(function (verses) {
      if (!verses.length) return;
      var verse = verses[getTodayVerseIndex(verses.length)];
      var rukuText = (window.NURA_RUKU && window.NURA_RUKU.getRukuNumber)
        ? " · Ruku " + window.NURA_RUKU.getRukuNumber(verse.surah, verse.ayah)
        : "";
      document.getElementById("verse-ref").textContent = "Surah " + verse.surah + ":" + verse.ayah + rukuText;
      document.getElementById("verse-arabic").textContent = verse.text;
      box.classList.remove("hidden");
    }).catch(function () {
      box.classList.add("hidden");
    });
  }

  // ---------- FULL QURAN (surah browsing) ----------
  // Arabic: local, already-verified Tanzil file (loadQuranVerses above).
  // English (Saheeh International, resource 20) and Urdu (Maulana Muhammad
  // Junagarhi, resource 54) are fetched live per-surah from the Quran
  // Foundation's public, keyless legacy API (api.quran.com) — the same
  // source already verified and used for the Al-Baqarah 285-286 translation
  // and for ruku numbers. Translations are not bundled/stored in this repo;
  // they're fetched on demand each time a surah is opened, and need internet.

  var QURAN_TRANSLATION_RESOURCES = { en: 20, ur: 54 };
  var quranTranslationCache = {}; // "resourceId-surahNumber" -> array of strings
  var quranState = { view: "list", surahNumber: null };

  function stripTranslationMarkup(text) {
    return text.replace(/<sup[^>]*>.*?<\/sup>/gi, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  }

  function fetchQuranTranslation(resourceId, surahNumber) {
    var key = resourceId + "-" + surahNumber;
    if (quranTranslationCache[key]) return Promise.resolve(quranTranslationCache[key]);
    return fetch("https://api.quran.com/api/v4/quran/translations/" + resourceId + "?chapter_number=" + surahNumber)
      .then(function (res) {
        if (!res.ok) throw new Error("translation fetch failed");
        return res.json();
      })
      .then(function (data) {
        var texts = (data.translations || []).map(function (t) { return stripTranslationMarkup(t.text); });
        quranTranslationCache[key] = texts;
        return texts;
      });
  }

  function renderQuranSurahList(filterText) {
    var list = document.getElementById("quran-surah-list");
    list.innerHTML = "";
    var filter = (filterText || "").trim().toLowerCase();
    var surahs = window.NURA_QURAN_SURAHS || [];
    surahs.filter(function (s) {
      if (!filter) return true;
      return s.nameSimple.toLowerCase().indexOf(filter) !== -1 ||
        s.nameTranslated.toLowerCase().indexOf(filter) !== -1 ||
        String(s.number) === filter;
    }).forEach(function (s) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "dua-list-item";
      row.innerHTML =
        '<span class="quran-surah-row">' +
          '<span class="quran-surah-num">' + s.number + '</span>' +
          '<span class="quran-surah-names">' +
            '<span class="dua-list-title">' + s.nameSimple + '</span>' +
            '<span class="dua-list-cat">' + s.nameTranslated + ' &middot; ' + s.versesCount + ' ayahs</span>' +
          '</span>' +
        '</span>' +
        '<span class="quran-surah-arabic-name">' + s.nameArabic + '</span>';
      row.addEventListener("click", function () { openQuranSurah(s.number); });
      list.appendChild(row);
    });
  }

  function openQuranSurah(number) {
    quranState.view = "detail";
    quranState.surahNumber = number;
    document.getElementById("quran-surah-list-view").classList.add("hidden");
    document.getElementById("quran-surah-detail-view").classList.remove("hidden");
    renderQuranSurahDetail();
    document.getElementById("quran-surah-detail-view").scrollIntoView({ block: "start" });
  }

  function closeQuranSurah() {
    quranState.view = "list";
    quranState.surahNumber = null;
    document.getElementById("quran-surah-detail-view").classList.add("hidden");
    document.getElementById("quran-surah-list-view").classList.remove("hidden");
  }

  function renderQuranSurahDetail() {
    var number = quranState.surahNumber;
    var meta = (window.NURA_QURAN_SURAHS || []).find(function (s) { return s.number === number; });
    var header = document.getElementById("quran-surah-header");
    var ayahList = document.getElementById("quran-ayah-list");
    if (!meta) return;

    header.innerHTML =
      '<div class="quran-surah-header-inner">' +
        '<div class="quran-surah-header-arabic">' + meta.nameArabic + '</div>' +
        '<h2 style="margin:2px 0;">' + meta.nameSimple + ' — ' + meta.nameTranslated + '</h2>' +
        '<div class="quran-surah-header-meta">Surah ' + meta.number + ' &middot; ' + meta.versesCount + ' ayahs &middot; ' + (meta.revelationPlace === "makkah" ? "Makki" : "Madani") + '</div>' +
      '</div>';

    ayahList.innerHTML = '<p class="quran-loading-note">Loading ayat and translations…</p>';

    Promise.all([
      loadQuranVerses(),
      fetchQuranTranslation(QURAN_TRANSLATION_RESOURCES.en, number),
      fetchQuranTranslation(QURAN_TRANSLATION_RESOURCES.ur, number)
    ]).then(function (results) {
      if (quranState.surahNumber !== number) return; // user navigated away before this resolved
      var allVerses = results[0];
      var enTexts = results[1];
      var urTexts = results[2];
      var surahVerses = allVerses.filter(function (v) { return v.surah === number; });

      ayahList.innerHTML = "";
      surahVerses.forEach(function (v, idx) {
        var rukuText = (window.NURA_RUKU && window.NURA_RUKU.getRukuNumber)
          ? "Ruku " + window.NURA_RUKU.getRukuNumber(v.surah, v.ayah)
          : "";
        var card = document.createElement("div");
        card.className = "quran-ayah-card";
        card.innerHTML =
          '<div class="quran-ayah-top">' +
            '<span class="quran-ayah-num">Ayah ' + v.ayah + '</span>' +
            '<span class="quran-ayah-ruku">' + rukuText + '</span>' +
          '</div>' +
          '<p class="quran-ayah-arabic">' + v.text + '</p>' +
          (enTexts[idx] ? '<p class="quran-ayah-translation"><span class="quran-ayah-translation-label">EN</span>' + enTexts[idx] + '</p>' : '') +
          (urTexts[idx] ? '<p class="quran-ayah-translation quran-ayah-urdu"><span class="quran-ayah-translation-label" style="direction:ltr;display:inline-block;">UR</span> ' + urTexts[idx] + '</p>' : '');
        ayahList.appendChild(card);
      });
    }).catch(function () {
      if (quranState.surahNumber !== number) return;
      ayahList.innerHTML = '<p class="quran-error-note">Could not load this surah. Check your internet connection and try again.</p>';
    });
  }

  function initQuranUI() {
    renderQuranSurahList("");
    document.getElementById("quran-surah-search").addEventListener("input", function (e) {
      renderQuranSurahList(e.target.value);
    });
    document.getElementById("quran-surah-back-btn").addEventListener("click", closeQuranSurah);
  }

  // ---------- HADITH & QUIZ ----------
  // Every hadith below was cross-checked against sunnah.com / named hadith
  // numbers before use (see docs/decisions.md) — none generated from memory.
  // Expanding this library further still needs a named content reviewer
  // before it ships widely (see CLAUDE.md Section 15).

  var HADITH_LIST = [
    {
    id: "hadith-1",
    title: "Actions Are Judged by Intentions",
    source: "Sahih al-Bukhari 1 · Sahih Muslim 1907 · 40 Hadith Nawawi 1 · narrated by Umar ibn al-Khattab",
    arabic: "إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ",
    text: "Actions are judged by intentions, and every person will get what they intended.",
    explain: "This hadith is often placed first in hadith collections because it applies to everything a person does. Two people can do the same visible action for very different reasons — the intention behind it is what gives it its real weight.",
    quiz: {
      question: "According to this hadith, what determines the value of an action?",
      options: [
        "How large or visible the action is",
        "The intention behind it",
        "Whether other people noticed it"
      ],
      correctIndex: 1,
      feedback: "Right — the hadith says actions are judged by intentions, not by size or visibility."
    }
    },
    {
      id: "hadith-2",
      title: "The Believer's Affair Is All Good",
      source: "Sahih Muslim 2999, narrated by Suhayb",
      arabic: "عَجَبًا لأَمْرِ الْمُؤْمِنِ إِنَّ أَمْرَهُ كُلَّهُ خَيْرٌ وَلَيْسَ ذَاكَ لأَحَدٍ إِلاَّ لِلْمُؤْمِنِ إِنْ أَصَابَتْهُ سَرَّاءُ شَكَرَ فَكَانَ خَيْرًا لَهُ وَإِنْ أَصَابَتْهُ ضَرَّاءُ صَبَرَ فَكَانَ خَيْرًا لَهُ",
      text: "How wonderful is the affair of the believer — all of it is good, and this is for no one except the believer. If something good happens to him, he is grateful, and that is good for him. If something bad happens to him, he is patient, and that is good for him.",
      explain: "This hadith describes a mindset, not a magic escape from hardship. The believer still feels the good and the bad — the difference is what they do with each one: gratitude when things go well, patience when they don't. Both responses are framed as genuinely good for the person, not just a consolation.",
      quiz: {
        question: "According to this hadith, what makes a believer's affairs 'all good'?",
        options: [
          "Nothing bad ever happens to them",
          "They respond with gratitude in ease and patience in hardship",
          "They never feel sad or upset"
        ],
        correctIndex: 1,
        feedback: "Right — it's not the absence of hardship, it's the response: gratitude when things go well, patience when they don't."
      }
    },
    {
      id: "hadith-3",
      title: "The Company You Keep",
      source: "Sahih al-Bukhari 2101 / 5534, Sahih Muslim 2628, narrated by Abu Musa",
      arabic: "مَثَلُ الْجَلِيسِ الصَّالِحِ وَالْجَلِيسِ السَّوْءِ كَمَثَلِ صَاحِبِ الْمِسْكِ، وَكِيرِ الْحَدَّادِ، لاَ يَعْدَمُكَ مِنْ صَاحِبِ الْمِسْكِ إِمَّا تَشْتَرِيهِ، أَوْ تَجِدُ رِيحَهُ، وَكِيرُ الْحَدَّادِ يُحْرِقُ بَدَنَكَ أَوْ ثَوْبَكَ أَوْ تَجِدُ مِنْهُ رِيحًا خَبِيثَةً",
      text: "The example of a good companion and a bad companion is like a musk seller and a blacksmith's bellows: from the musk seller, you either buy some or at least catch its good scent; from the blacksmith's bellows, you either burn your clothes or at least catch a foul smell.",
      explain: "This is a practical, non-judgmental way to think about who you spend time with — not that bad people are worthless, but that closeness rubs off on you either way, for better or worse, even without meaning to.",
      quiz: {
        question: "In this hadith, what does a good companion get compared to?",
        options: [
          "A teacher",
          "A musk seller",
          "A blacksmith's bellows"
        ],
        correctIndex: 1,
        feedback: "Right — a good companion is compared to a musk seller, who leaves you better off just by being near them."
      }
    },
    {
      id: "hadith-4",
      title: "Faith Includes the Small Things",
      source: "Sahih Muslim 35, narrated by Abu Hurairah",
      arabic: "الْإِيمَانُ بِضْعٌ وَسَبْعُونَ أَوْ بِضْعٌ وَسِتُّونَ شُعْبَةً فَأَفْضَلُهَا قَوْلُ لَا إِلَهَ إِلَّا اللَّهُ وَأَدْنَاهَا إِمَاطَةُ الْأَذَى عَنِ الطَّرِيقِ",
      text: "Faith has sixty-some or seventy-some branches. The best of them is saying 'there is no god but Allah,' and the least of them is removing something harmful from the road.",
      explain: "This hadith places the biggest statement of belief and a small act of everyday courtesy on the same scale — both count as faith. It pushes back on the idea that only big, visible acts of worship matter; small, practical good is part of the same thing.",
      quiz: {
        question: "According to this hadith, what is given as an example of the least (smallest) branch of faith?",
        options: [
          "Fasting extra days",
          "Removing something harmful from the road",
          "Praying extra prayers at night"
        ],
        correctIndex: 1,
        feedback: "Right — even a small, practical act like clearing something harmful off a path counts as a branch of faith."
      }
    },
    {
      id: "hadith-5",
      title: "Wanting for Others What You Want for Yourself",
      source: "Sahih al-Bukhari 13, Sahih Muslim 45",
      arabic: "لَا يُؤْمِنُ أَحَدُكُمْ حَتَّى يُحِبَّ لِأَخِيهِ مَا يُحِبُّ لِنَفْسِهِ",
      text: "None of you truly believes until he loves for his brother what he loves for himself.",
      explain: "This hadith sets a personal, practical test rather than an abstract rule: before acting, ask whether you'd want the same treatment if the roles were reversed. It's simple to say and genuinely hard to live by consistently.",
      quiz: {
        question: "According to this hadith, what does complete faith require toward other people?",
        options: [
          "Agreeing with them on everything",
          "Wanting for them what you want for yourself",
          "Giving them money regularly"
        ],
        correctIndex: 1,
        feedback: "Right — it's about wanting the same good for others that you want for yourself, not agreement or charity specifically."
      }
    },
    {
      id: "hadith-6",
      title: "Small and Steady Beats Big and Occasional",
      source: "Sahih al-Bukhari 6464, narrated by 'Aishah",
      arabic: "سَدِّدُوا وَقَارِبُوا، وَاعْلَمُوا أَنْ لَنْ يُدْخِلَ أَحَدَكُمْ عَمَلُهُ الْجَنَّةَ، وَأَنَّ أَحَبَّ الأَعْمَالِ أَدْوَمُهَا إِلَى اللَّهِ، وَإِنْ قَلَّ",
      text: "Aim straight, and stay close to what is right. Know that none of you will enter Paradise by his deeds alone, and the most beloved of deeds to Allah are those done most consistently, even if small.",
      explain: "This directly pushes back on the idea that a good habit only counts if it's big or impressive. A small action repeated steadily is described as more beloved than an intense burst that doesn't last — useful to remember when a task on Home or a Sunnah item feels too small to bother with.",
      quiz: {
        question: "According to this hadith, which kind of deed does Allah love most?",
        options: [
          "The biggest, most impressive one",
          "One done consistently, even if small",
          "One done only once, done perfectly"
        ],
        correctIndex: 1,
        feedback: "Right — consistency is valued over size or intensity."
      }
    },
    {
      id: "hadith-7",
      title: "Gentleness Is Not Optional",
      source: "Sahih Muslim 2592, narrated by Jarir",
      arabic: "مَنْ يُحْرَمِ الرِّفْقَ يُحْرَمِ الْخَيْرَ",
      text: "Whoever is deprived of gentleness is deprived of goodness.",
      explain: "Gentleness here isn't framed as a nice extra — it's tied directly to goodness itself. Someone who never approaches things gently, with people or with themselves, is missing something real, not just being 'a bit harsh.'",
      quiz: {
        question: "According to this hadith, what happens to someone who lacks gentleness?",
        options: [
          "They become more respected",
          "They are deprived of goodness",
          "Nothing — gentleness doesn't matter much"
        ],
        correctIndex: 1,
        feedback: "Right — the hadith ties gentleness directly to goodness, not as a minor virtue."
      }
    },
    {
      id: "hadith-8",
      title: "What Real Richness Is",
      source: "Sahih al-Bukhari 6446, Sahih Muslim 1051, narrated by Abu Hurairah",
      arabic: "لَيْسَ الْغِنَى عَنْ كَثْرَةِ الْعَرَضِ، وَلَكِنَّ الْغِنَى غِنَى النَّفْسِ",
      text: "Richness is not about having many possessions; real richness is the richness of the soul.",
      explain: "This separates two things people often mix up: how much someone owns, and whether they're actually content. It doesn't say money is bad — it says money alone doesn't make someone rich in any way that matters if the person inside is never satisfied.",
      quiz: {
        question: "According to this hadith, what is true richness?",
        options: [
          "Having a lot of possessions",
          "Being well known",
          "Contentment of the soul"
        ],
        correctIndex: 2,
        feedback: "Right — the hadith defines real richness as contentment, not the amount you own."
      }
    }
  ];

  var hadithState = { currentId: null };

  function getHadithProgress() {
    return readJSON("nc_hadith_progress", {});
  }

  function saveHadithProgress(p) {
    writeJSON("nc_hadith_progress", p);
  }

  function getCoins() {
    return readJSON("nc_coins", 0);
  }

  function addCoins(n) {
    writeJSON("nc_coins", getCoins() + n);
  }

  function currentHadith() {
    return HADITH_LIST.find(function (h) { return h.id === hadithState.currentId; });
  }

  function buildHadithListItem(h) {
    var progress = getHadithProgress();
    var done = progress[h.id] && progress[h.id].answered;
    var item = document.createElement("button");
    item.className = "dua-list-item";
    var textWrap = document.createElement("span");
    var title = document.createElement("span");
    title.className = "dua-list-title";
    title.textContent = h.title;
    var srcLine = document.createElement("span");
    srcLine.className = "dua-list-cat";
    srcLine.textContent = h.source;
    textWrap.appendChild(title);
    textWrap.appendChild(srcLine);
    item.appendChild(textWrap);
    if (done) {
      var check = document.createElement("span");
      check.className = "dua-list-fav";
      check.textContent = "✓";
      item.appendChild(check);
    }
    item.addEventListener("click", function () {
      hadithState.currentId = h.id;
      renderHadithDetail();
      document.getElementById("hadith-list-view").classList.add("hidden");
      document.getElementById("hadith-detail-view").classList.remove("hidden");
    });
    return item;
  }

  function renderHadithList() {
    var list = document.getElementById("hadith-list");
    list.innerHTML = "";
    HADITH_LIST.forEach(function (h) {
      list.appendChild(buildHadithListItem(h));
    });
    document.getElementById("hadith-list-view").classList.remove("hidden");
    document.getElementById("hadith-detail-view").classList.add("hidden");
  }

  function renderHadithDetail() {
    var h = currentHadith();
    if (!h) return;
    document.getElementById("hadith-source").textContent = h.source;
    document.getElementById("hadith-arabic").textContent = h.arabic;
    document.getElementById("hadith-text").textContent = h.text;
    document.getElementById("hadith-explain").textContent = h.explain;

    var progress = getHadithProgress();
    var state = progress[h.id];
    var quizArea = document.getElementById("quiz-area");
    quizArea.innerHTML = "";

    var qTitle = document.createElement("p");
    qTitle.className = "hadith-text";
    qTitle.style.fontWeight = "600";
    qTitle.textContent = h.quiz.question;
    quizArea.appendChild(qTitle);

    h.quiz.options.forEach(function (opt, idx) {
      var btn = document.createElement("button");
      btn.className = "quiz-option";
      btn.textContent = opt;
      if (state && state.answered) {
        btn.disabled = true;
        if (idx === h.quiz.correctIndex) btn.classList.add("correct");
        else if (idx === state.pickedIndex) btn.classList.add("wrong");
      } else {
        btn.addEventListener("click", function () {
          answerQuiz(idx);
        });
      }
      quizArea.appendChild(btn);
    });

    var feedback = document.createElement("p");
    feedback.className = "quiz-feedback";
    if (state && state.answered) {
      feedback.textContent = h.quiz.feedback + (state.coinsAwarded ? (" +" + state.coinsAwarded + " coins.") : " (Coins only awarded once per lesson.)");
    }
    quizArea.appendChild(feedback);

    if (state && state.answered) {
      var currentIndex = HADITH_LIST.findIndex(function (item) { return item.id === h.id; });
      var nextHadith = HADITH_LIST[currentIndex + 1];
      var nextBtn = document.createElement("button");
      nextBtn.className = "btn btn-primary btn-full";
      if (nextHadith) {
        nextBtn.textContent = "Next lesson →";
        nextBtn.addEventListener("click", function () {
          hadithState.currentId = nextHadith.id;
          renderHadithDetail();
        });
      } else {
        nextBtn.textContent = "Back to lessons";
        nextBtn.addEventListener("click", function () {
          renderHadithList();
        });
      }
      nextBtn.style.marginTop = "12px";
      quizArea.appendChild(nextBtn);
    }
  }

  function answerQuiz(idx) {
    var h = currentHadith();
    if (!h) return;
    var progress = getHadithProgress();
    var already = progress[h.id] && progress[h.id].answered;
    var correct = idx === h.quiz.correctIndex;
    var coinsAwarded = 0;
    if (!already && correct) {
      coinsAwarded = 10;
      addCoins(coinsAwarded);
    }
    progress[h.id] = { answered: true, pickedIndex: idx, correct: correct, coinsAwarded: already ? 0 : coinsAwarded };
    saveHadithProgress(progress);
    if (!already) memLog("hadith_read", "hadith", { correct: correct });
    renderHadithDetail();
    renderMore();
    if (!already && correct) showToast("Correct! +" + coinsAwarded + " coins");
    else if (!already) showToast("Not quite — see the highlighted answer");
  }

  function initHadithUI() {
    document.getElementById("hadith-back-btn").addEventListener("click", function () {
      renderHadithList();
    });
  }

  // ---------- AI CHAT (Bhai: context-aware guided support) ----------

  // ===================================================================
  // BHAI — THE COMPANION LAYER (AI Chat tab)
  //
  //   NURA features keep their own real data  ->  NuraContext reads a small,
  //   read-only slice of it  ->  Bhai turns that slice into ONE realistic next
  //   step  ->  the user taps a button and the action happens inside NURA.
  //
  // What this is NOT: prayer times, timers, progress, Plan My Day and the
  // Qur'an/Hadith content are all still deterministic and work with or without
  // this screen. Bhai only advises and points. There is no live language model
  // behind it (no backend, no API key, nothing is sent anywhere): the replies
  // are rule-based over the context below, and the context object is the ONLY
  // thing a future model would be allowed to see.
  //
  // Privacy: the context is built per topic, never the whole database. Vault
  // entries are never read. Recovery data is only read when the conversation is
  // itself about a habit/urge, and then only aggregate counts.
  // ===================================================================

  function ncFmtTime(d) { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function ncMinutesUntil(d) { return Math.round((d - new Date()) / 60000); }
  function ncLog(planKey) {
    return readJSON("nc_priority_log", []).filter(function (e) { return e && e.planKey === planKey; });
  }

  var NC_SECTIONS = {
    profile: function () {
      var name = localStorage.getItem("nc_user_name");
      return { firstName: name || null, journeyDay: getJourneyDay() };
    },
    now: function () {
      var d = new Date(), h = d.getHours();
      return { date: todayKey(), time: ncFmtTime(d), partOfDay: h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 20 ? "evening" : "night" };
    },
    salah: function () {
      var comps = getSalahCompletions();
      var out = { done: PRAYER_ORDER.filter(function (n) { return comps[n]; }), timesKnown: false };
      var T = homeTimings();
      if (T) {
        var now = new Date();
        out.timesKnown = true;
        var np = getNextPrayer(T);
        out.next = { name: np.name, at: ncFmtTime(np.time), inMinutes: ncMinutesUntil(np.time), tomorrow: !!np.tomorrow };
        var passed = PRAYER_ORDER.filter(function (n) { return parseTimeToday(T[n]) <= now; });
        out.notMarked = passed.filter(function (n) { return !comps[n]; });
        out.latestNotMarked = out.notMarked.length && passed[passed.length - 1] === out.notMarked[out.notMarked.length - 1] ? passed[passed.length - 1] : null;
      }
      return out;
    },
    plan: function () {
      var acts = getPlanActivities(), built = getPlanBuilt(), now = new Date();
      var items = acts.map(function (a) {
        var start = a.startTime || null;
        if (!start && built && built.timeline) {
          var slot = built.timeline.filter(function (e) { return e.refId === a.id; })[0];
          if (slot && typeof slot.startMin === "number") start = String(Math.floor(slot.startMin / 60) % 24).padStart(2, "0") + ":" + String(slot.startMin % 60).padStart(2, "0");
        }
        return { id: a.id, name: a.name, mode: a.mode, status: a.status, startTime: start, durationMinutes: a.durationMinutes || null, startsInMin: start ? ncMinutesUntil(parseTimeToday(start)) : null, endsInMin: a.endTime ? ncMinutesUntil(parseTimeToday(a.endTime)) : null };
      });
      var pending = items.filter(function (i) { return i.status === "pending"; });
      var pastEnd = function (i) { return i.endsInMin !== null && i.endsInMin < 0; };
      var timed = pending.filter(function (i) { return i.startsInMin !== null && !pastEnd(i); }).sort(function (a, b) { return a.startsInMin - b.startsInMin; });
      return {
        total: items.length,
        done: items.filter(function (i) { return i.status === "done"; }).length,
        pending: pending.length,
        items: items.slice(0, 8),
        current: timed.filter(function (i) { return i.startsInMin <= 0; }).slice(-1)[0] || null,
        upcoming: timed.filter(function (i) { return i.startsInMin > 0; })[0] || null,
        overdue: pending.filter(pastEnd)[0] || null,
        flexiblePending: pending.filter(function (i) { return i.mode !== "fixed" && !pastEnd(i); })[0] || null
      };
    },
    priority: function () {
      var p = getCurrentPriority();
      if (!p || p.date !== todayKey()) return { set: false };
      return { set: true, title: p.title, kind: p.kind, custom: isGoalPriority(p), minutes: p.minutes || null, status: p.status, running: focusState.linkedPriorityId === p.id && focusState.running };
    },
    study: function () {
      var today = todayKey(), week = getLastNDateKeys(7);
      var log = ncLog("study");
      var mins = 0;
      log.forEach(function (e) { if (e.date === today && e.status === "completed") mins += e.minutes || 0; });
      return {
        completedMinutesToday: mins,
        completedLast7Days: log.filter(function (e) { return e.status === "completed" && week.indexOf(e.date) !== -1; }).length
      };
    },
    sleep: function () {
      var p = getCurrentPriority(), today = todayKey();
      var asleep = !!(p && p.kind === "sleep" && p.date === today && p.sleepStart && !p.wakeTime);
      var last = ncLog("sleep").slice(-1)[0];
      return {
        asleepNow: asleep,
        since: asleep ? ncFmtTime(new Date(p.sleepStart)) : null,
        targetBedtime: p && p.kind === "sleep" && p.date === today ? p.targetBedtime || null : null,
        lastLogged: last ? { date: last.date, status: last.status } : null
      };
    },
    fitness: function () {
      var week = getLastNDateKeys(7), log = ncLog("fitness");
      return {
        doneToday: log.some(function (e) { return e.date === todayKey() && e.status === "completed"; }),
        completedLast7Days: log.filter(function (e) { return e.status === "completed" && week.indexOf(e.date) !== -1; }).length
      };
    },
    habits: function () {
      var hs = getHabits(), log = getHabitLogToday();
      var open = hs.filter(function (h) { return log[h.id] !== "done"; });
      return { total: hs.length, doneToday: hs.length - open.length, openNames: open.slice(0, 3).map(function (h) { return h.name; }) };
    },
    progress: function () {
      var p = getCurrentPriority();
      var last7 = getLastNDateKeys(7).reverse().map(function (k) { return { date: k, percent: getDayProgressPercent(k) }; });
      return {
        todayPercent: homeProgress().percent || 0,
        last7: last7,
        daysCompletedLast7: last7.filter(function (d) { return d.percent === 100; }).length
      };
    },
    recovery: function () {
      return rcJourneys().map(function (j) {
        var s = rcCompute(j);
        return { habit: j.habit, name: rcName(j), currentStreak: s.current, bestStreak: s.best, weekClean: s.week.clean, weekSlips: s.week.slips, loggedToday: !!s.logs[todayKey()] };
      });
    },
    phone: function () { return { nativeAvailable: !!window.NuraNative }; },
    // The user's own Daily Flow history, read-only: what was planned, done, missed, skipped, moved, and at what
    // time, with the evidence behind every pattern. Rule-based replies (and any future model) may only say
    // what is in here; see flowContext() for how facts and suggestions are kept apart.
    flow: function () {
      var c = flowContext(), wk = flowWeekData(fdWeekStart(todayKey()));
      c.thisWeek = { done: wk.totalD, planned: wk.totalP };
      return c;
    }
  };

  var NC_TOPICS = {
    day: ["profile", "now", "salah", "plan", "priority", "progress", "habits", "flow"],
    routine: ["profile", "now", "salah", "plan", "priority", "habits"],
    study: ["profile", "now", "salah", "plan", "priority", "study", "flow"],
    pattern: ["profile", "now", "flow"],
    sleep: ["profile", "now", "salah", "sleep"],
    fitness: ["profile", "now", "priority", "fitness"],
    progress: ["profile", "now", "progress", "study", "fitness", "habits", "flow"],
    recovery: ["profile", "now", "recovery"],
    phone: ["profile", "now", "phone"],
    general: ["profile", "now", "salah", "priority"]
  };
  var NC_LABELS = { salah: "today's Salah", plan: "your plan for today", priority: "today's priority", study: "study history", sleep: "sleep", fitness: "fitness", habits: "habits", progress: "your progress", recovery: "your recovery counts (numbers only)", phone: "phone control availability", flow: "your Daily Flow history (planned, done, missed; worship items only counted)" };

  function buildNuraContext(topic) {
    var names = NC_TOPICS[topic] || NC_TOPICS.general;
    var ctx = { topic: topic, sections: names.slice() };
    names.forEach(function (n) { ctx[n] = NC_SECTIONS[n](); });
    return ctx;
  }

  // ---- recommending ONE realistic next step from the context ----
  function bhSession(label, minutes, planKey) {
    return { label: "Start " + minutes + " min", fn: function () { quickStartFocusFromChat(label, minutes, planKey); } };
  }
  function bhMarkPrayer(name) {
    return {
      label: "Mark " + name + " as prayed",
      confirm: "Mark " + name + " as prayed for today?",
      fn: function () { setSalahComplete(name); showToast(name + " marked"); }
    };
  }
  function ncFmtMin(m) { return m >= 60 ? Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : "") : m + " min"; }
  function bhRecommend(ctx) {
    var s = ctx.salah || {}, plan = ctx.plan || {}, pri = ctx.priority || {}, hab = ctx.habits || {};
    var next = s.next && !s.next.tomorrow ? s.next : null;
    var fixed = [plan.current, plan.upcoming].filter(function (i) { return i && i.mode === "fixed"; })[0] || null;

    if (next && next.inMinutes <= 15) return { line: next.name + " is in " + next.inMinutes + " min. Get ready for it first — everything else can wait until after.", action: null };
    if (s.latestNotMarked) return { line: s.latestNotMarked + " isn't marked yet today. If you haven't prayed it, that's the one thing to do now.", action: bhMarkPrayer(s.latestNotMarked) };
    if (plan.overdue) return { line: "“" + plan.overdue.name + "” has passed its time and is still open on your plan. Mark it done or skip it in Plan My Day so the rest of the day stays accurate.", action: { label: "Open Plan My Day", nav: true, fn: function () { setActiveView("duniya-plan"); } } };
    if (fixed && fixed.startsInMin <= 0) return { line: "“" + fixed.name + "” was due to start at " + ncFmtTime(parseTimeToday(fixed.startTime)) + ". If you're already there, carry on — that's your one thing right now.", action: null };
    if (fixed && fixed.startsInMin <= 15) return { line: "“" + fixed.name + "” starts in " + fixed.startsInMin + " min. Get ready for it first.", action: null };

    // How much clear time is there before the next hard stop (Salah or a fixed commitment)?
    var room = null, until = "";
    if (next) { room = next.inMinutes; until = next.name; }
    if (fixed && (room === null || fixed.startsInMin < room)) { room = fixed.startsInMin; until = "“" + fixed.name + "”"; }
    var fit = function (want) { var m = room === null ? want : Math.min(want, room - 10); return m >= 5 ? m : 0; };
    var clear = until ? " That still leaves you clear before " + until + " (in " + ncFmtMin(room) + ")." : "";

    var flex = plan.flexiblePending;
    if (flex) {
      var m = fit(Math.min(flex.durationMinutes || 10, 10));
      if (m) return { line: "Next on your plan: “" + flex.name + "”. Start small — " + m + " minutes." + clear, action: bhSession(flex.name + " — first " + m + " min", m, /study|revis|exam|homework|assignment/i.test(flex.name) ? "study" : null) };
      return { line: "Next on your plan: “" + flex.name + "”, but " + until + " is close. Do the tiny first step now, then pick it up after.", action: null };
    }
    if (pri.set && pri.custom && pri.status === "pending") {
      // the user's own goal: NURA doesn't know what it means, so it never turns it into a timer
      return { line: "Your own goal for today, “" + pri.title + "”, is still open. Tick it in Daily Flow when it's done." + clear, action: { label: "Open Daily Flow", nav: true, fn: function () { openFlow("today"); } } };
    }
    if (pri.set && pri.status === "pending" && pri.kind !== "salah" && pri.kind !== "sleep") {
      var m2 = fit(Math.min(pri.minutes || 10, 10));
      if (m2) return { line: "Today's priority is “" + pri.title + "”. Give it " + m2 + " minutes." + clear, action: bhSession(pri.title + " — first " + m2 + " min", m2, pri.kind === "study" ? "study" : null) };
    }
    if (hab.openNames && hab.openNames.length) return { line: "One small thing still open: your habit “" + hab.openNames[0] + "”. Do it now — it's quick.", action: null };
    var m3 = fit(10);
    var lead = fixed ? "“" + fixed.name + "” is at " + ncFmtTime(parseTimeToday(fixed.startTime)) + " (in " + ncFmtMin(fixed.startsInMin) + "). Until then: " : "";
    var body = pri.set ? "nothing urgent is waiting — pick one small thing and give it 10 focused minutes." : "you haven't set today's priority yet — set one on Home, or start with 10 focused minutes on anything that matters.";
    return { line: lead ? lead + body : body.charAt(0).toUpperCase() + body.slice(1), action: m3 ? bhSession("One thing that matters", m3) : null };
  }
  function bhRecap(ctx) {
    var bits = [];
    var s = ctx.salah;
    if (s && s.done.length) bits.push(s.done.length + " of 5 prayers marked");
    var p = ctx.plan;
    if (p && p.total) bits.push(p.done + " of " + p.total + " planned things done");
    return bits.length ? "So far today: " + bits.join(", ") + "." : "";
  }

  // ---- replies: {lines, actions, shield, topic} ----
  var BH_REPLIES = {
    "wasted-day": function () {
      var ctx = buildNuraContext("day"), rec = bhRecommend(ctx), lines = [];
      var recap = bhRecap(ctx);
      lines.push(recap ? "That happens — and it isn't a blank day. " + recap : "That happens — the day isn't over yet.");
      if (ctx.salah.next && !ctx.salah.next.tomorrow) lines.push("About " + ctx.salah.next.inMinutes + " min until " + ctx.salah.next.name + " (" + ctx.salah.next.at + ").");
      lines.push(rec.line);
      lines.push("When the timer ends I'll ask if it's actually done — not just if the timer finished.");
      return { ctx: ctx, lines: lines, actions: rec.action ? [rec.action] : [] };
    },
    "what-next": function () {
      var ctx = buildNuraContext("day"), rec = bhRecommend(ctx);
      return { ctx: ctx, lines: [rec.line], actions: rec.action ? [rec.action] : [] };
    },
    "study-help": function (text) {
      var ctx = buildNuraContext("study"), lines = [], actions = [];
      var low = /(don'?t feel|do not feel|no motivation|not in the mood|can'?t be bothered|lazy|cba|tired of)/i.test(text || "");
      var pri = ctx.priority, plan = ctx.plan;
      var planned = pri.set && pri.kind === "study" && pri.status === "pending" ? { name: pri.title, minutes: pri.minutes } : null;
      if (!planned) {
        var pi = [plan.current, plan.upcoming, plan.flexiblePending].filter(function (i) { return i && /study|revis|exam|homework|assignment|read|notes|class/i.test(i.name); })[0];
        if (pi) planned = { name: pi.name, minutes: pi.durationMinutes };
      }
      var room = ctx.salah.next && !ctx.salah.next.tomorrow ? ctx.salah.next.inMinutes : null;
      var chunk = function (want) { var m = room === null ? want : Math.min(want, room - 10); return m >= 5 ? m : 0; };
      if (planned) {
        var big = planned.minutes && planned.minutes > 15;
        var dur = planned.minutes && !/\d+\s*min/i.test(planned.name) ? " (" + planned.minutes + " min)" : "";
        lines.push(low
          ? "Your plan has “" + planned.name + "”" + dur + ". When you don't feel like it, that whole block is the problem — shrink it."
          : "You've planned “" + planned.name + "”" + dur + ".");
        var m = chunk(big || low ? 10 : (planned.minutes || 20));
        if (m) { lines.push("Do just " + m + " minutes on it. After that, you're allowed to stop — most people keep going."); actions.push(bhSession("Study — first " + m + " min", m, "study")); }
        else lines.push("Your next Salah is close, so make it a tiny setup step now (open the material) and start after.");
      } else {
        lines.push(low ? "Not feeling it is normal. Make the first step so small it's almost silly." : "Pick the one subject that matters most right now — not everything, just one.");
        var m2 = chunk(low ? 10 : 20);
        if (m2) { lines.push(m2 + " minutes on one subject beats a long plan you don't start."); actions.push(bhSession("Study — " + m2 + " min", m2, "study")); }
      }
      if (ctx.study.completedMinutesToday) lines.push("You've already finished " + ctx.study.completedMinutesToday + " min of study today.");
      // what the user's own Daily Flow history shows about study — a fact first, then an idea kept separate
      var sp = ctx.flow.patterns.filter(function (p) { return p.category === "study"; })[0];
      if (sp) { lines.push("From your records: " + sp.fact); if (sp.suggestion) lines.push("An idea, not a fact: " + sp.suggestion); }
      if (room !== null && room <= 30) lines.push(ctx.salah.next.name + " is in " + room + " min, so I kept it short.");
      return { ctx: ctx, lines: lines, actions: actions };
    },
    // Pattern talk: only what the Daily Flow records show. FACT lines and IDEA lines are kept apart, and with
    // too little history the honest answer is that there isn't enough yet.
    "flow-pattern": function (text) {
      var ctx = buildNuraContext("pattern"), f = ctx.flow, lines = [], actions = [];
      var scope = /(study|revis|homework|exam)/i.test(text || "") ? "study" : /(gym|workout|exercise|fitness|run)/i.test(text || "") ? "fitness" : null;
      var nonWorship = f.actions.filter(function (a) { return !a.worship; });
      if (!f.actions.length) {
        lines.push("You haven't planned anything in Daily Flow yet, so there's no history for me to look at.");
        return { ctx: ctx, lines: lines, actions: [{ label: "Open Daily Flow", nav: true, fn: function () { openFlow("today"); } }] };
      }
      var pats = f.patterns.filter(function (p) { return !scope || p.category === scope; });
      if (f.week.planned >= 3) lines.push("Last 7 days: " + f.week.done + " of " + f.week.planned + " planned actions completed" + (f.week.skipped || f.week.moved ? " (" + [f.week.skipped ? f.week.skipped + " skipped" : "", f.week.moved ? f.week.moved + " moved" : ""].filter(Boolean).join(", ") + " set aside)" : "") + ".");
      if (!pats.length) {
        var scoped = scope ? nonWorship.filter(function (a) { return a.category === scope; }) : nonWorship;
        var judged = scoped.reduce(function (n, a) { return n + a.window.planned; }, 0);
        if (scope && !scoped.length) lines.push("You don't have a " + scope + " action in Daily Flow, so I have nothing to base anything on.");
        else if (judged < FLOW_PAT_MIN) lines.push("There isn't enough history yet to identify a pattern" + (judged ? " — only " + judged + " planned day" + (judged === 1 ? "" : "s") + " recorded so far." : "."));
        else {
          lines.push("I don't see a clear pattern in your records right now. That's a fact about the data, not a verdict on you.");
          scoped.filter(function (a) { return a.scheduleChanged; }).slice(0, 2).forEach(function (a) {
            lines.push("“" + a.name + "” was rescheduled recently, so its earlier days don't count as evidence for the new schedule yet.");
          });
        }
      } else {
        pats.slice(0, 3).forEach(function (p) {
          lines.push("From your records: " + p.fact);
          if (p.suggestion) lines.push("An idea, not a fact: " + p.suggestion);
        });
        var edit = pats.filter(function (p) { return p.canEdit; })[0];
        if (edit) actions.push({ label: "Adjust “" + (flowActionById(edit.actionId) || { name: "it" }).name + "”", nav: true, fn: function () {
          var a = flowActionById(edit.actionId);
          openFlow("today"); if (a) openFlowAddSheet(a);
        } });
      }
      lines.push("This comes only from what you've planned and ticked in Daily Flow. Nothing is inferred beyond that.");
      return { ctx: ctx, lines: lines, actions: actions };
    },
    "missed-routine": function () {
      var ctx = buildNuraContext("routine"), lines = [], rec = bhRecommend(ctx);
      lines.push("Missing part of the routine doesn't erase what you did do.");
      if (ctx.salah.timesKnown && ctx.salah.notMarked.length) lines.push("Not marked yet today: " + ctx.salah.notMarked.join(", ") + ". (Marked means tapped in NURA — you may have prayed without tapping.)");
      var recap = bhRecap(ctx); if (recap) lines.push(recap);
      lines.push(rec.line);
      return { ctx: ctx, lines: lines, actions: rec.action ? [rec.action] : [] };
    },
    "sleep": function () {
      var ctx = buildNuraContext("sleep"), lines = [], actions = [], sl = ctx.sleep, s = ctx.salah;
      if (sl.asleepNow) lines.push("NURA has you logged as asleep since " + sl.since + ". Tap I'm awake on Home when you wake.");
      else if (sl.lastLogged) lines.push("Your last sleep entry was on " + sl.lastLogged.date + " (" + sl.lastLogged.status + ").");
      else lines.push("You haven't logged sleep with NURA yet, so I can't say how it's been going.");
      if (s.next && s.next.tomorrow) {
        var fajr = new Date(); var parts = (homeTimings() || { Fajr: "05:00" }).Fajr.split(":");
        fajr.setDate(fajr.getDate() + 1); fajr.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
        var bed = new Date(fajr.getTime() - 7.5 * 3600000);
        lines.push("Fajr is at " + s.next.at + ". For about 7½ hours of sleep before it, aim to be asleep by " + ncFmtTime(bed) + ".");
      }
      lines.push("Wind-down that actually helps: phone out of reach, lights low, no new tasks. One thing, not a list.");
      actions.push({ label: "Open Better Sleep", nav: true, fn: function () { setActiveView("duniya"); } });
      return { ctx: ctx, lines: lines, actions: actions };
    },
    "fitness": function () {
      var ctx = buildNuraContext("fitness"), lines = [];
      lines.push(ctx.fitness.doneToday ? "You've already finished a fitness session today." : "No fitness session finished yet today.");
      if (ctx.fitness.completedLast7Days) lines.push("You've completed " + ctx.fitness.completedLast7Days + " in the last 7 days.");
      lines.push("Keep it small: pick a body area and a short duration in Duniya, and NURA gives you a routine with a warm-up.");
      return { ctx: ctx, lines: lines, actions: [{ label: "Open Duniya", nav: true, fn: function () { setActiveView("duniya"); } }] };
    },
    "progress": function () {
      var ctx = buildNuraContext("progress"), lines = [], p = ctx.progress;
      var logged = p.last7.filter(function (d) { return d.percent !== null; }).length;
      lines.push(logged
        ? "In the last 7 days you finished everything you'd planned on " + p.daysCompletedLast7 + " of " + logged + " day" + (logged === 1 ? "" : "s") + " with a record."
        : "There isn't a week of history yet, so any \"trend\" from me would be a guess.");
      if (ctx.flow.week.planned >= 3) lines.push("Daily Flow, last 7 days: " + ctx.flow.week.done + " of " + ctx.flow.week.planned + " planned actions completed.");
      if (ctx.flow.patterns.length) lines.push("From your records: " + ctx.flow.patterns[0].fact);
      if (ctx.study.completedLast7Days) lines.push(ctx.study.completedLast7Days + " study session" + (ctx.study.completedLast7Days === 1 ? "" : "s") + " completed this week.");
      lines.push("Today's ring is at " + p.todayPercent + "%.");
      lines.push("One thing to improve next week: set a priority every morning — that's what all of this is built from.");
      return { ctx: ctx, lines: lines, actions: [{ label: "Go to Home", nav: true, fn: function () { setActiveView("home"); } }] };
    },
    "want-smoke": function () {
      var ctx = buildNuraContext("recovery");
      var lines = [
        "Try a short delay before deciding — a few minutes, on purpose.",
        "If you can, change location right now, even just to another room or outside.",
        "Do one alternative action instead — water, a short walk, a call to someone."
      ];
      var j = ctx.recovery.filter(function (x) { return x.habit === "smoking"; })[0];
      if (j) lines.push("You're on " + j.currentStreak + " day" + (j.currentStreak === 1 ? "" : "s") + " in a row (best " + j.bestStreak + "). One urge doesn't erase that.");
      lines.push("Afterward, it can help to note what triggered it and whether the urge changed.");
      lines.push("If this keeps being hard to manage alone, real cessation support (a doctor, a quitline, a support group) can help far more than willpower alone — this isn't a full program, just a first step.");
      return { ctx: ctx, lines: lines, shield: true, actions: [{ label: "Open Recovery", nav: true, fn: function () { rcView = { screen: "main" }; setActiveView("duniya-recovery"); } }] };
    },
    "urge-porn": function () {
      var ctx = buildNuraContext("recovery");
      var lines = [
        "A few real options right now: put the phone down, leave the room or situation you're in, or open Shield for a short pause.",
        "You could also jump to today's actions and start a focus session on something else."
      ];
      var j = ctx.recovery.filter(function (x) { return x.habit !== "smoking"; })[0];
      if (j) lines.push("You're on " + j.currentStreak + " day" + (j.currentStreak === 1 ? "" : "s") + " in a row (best " + j.bestStreak + "). If you slip, the next step is logging it and restarting — not giving up.");
      lines.push("No judgment here, and nothing here tracks or reports what you do — this is just a moment to choose your next step.");
      return { ctx: ctx, lines: lines, shield: true, actions: [{ label: "Open Recovery", nav: true, fn: function () { rcView = { screen: "main" }; setActiveView("duniya-recovery"); } }] };
    },
    "phone": function () {
      var ctx = buildNuraContext("phone");
      return { ctx: ctx, lines: [ctx.phone.nativeAvailable
        ? "Phone Control is available in this app. Open it from Duniya to choose which apps to be reminded about."
        : "Phone Control needs the NURA Android app and its permission — this web version can't see or block other apps. What it can do: a phone-free focus session.", "Try a phone-free session in Duniya: put the phone away for a set time and NURA times it."],
        actions: [{ label: "Open Duniya", nav: true, fn: function () { setActiveView("duniya"); } }] };
    },
    "ruling": function () {
      return { ctx: buildNuraContext("general"), lines: ["I can't give religious rulings, and I won't guess at one.", "For halal/haram or \"is this allowed\" questions, please ask a qualified scholar or a trusted local imam."], actions: [], plain: true };
    },
    "quran": function () {
      return { ctx: buildNuraContext("general"), lines: ["I don't write or explain Qur'an verses, hadith or duas — I could get them wrong.", "The Sunnah tab has verified text with sources shown. Use that, and ask a scholar if you want it explained."], actions: [{ label: "Open Sunnah", nav: true, fn: function () { setActiveView("sunnah"); } }], plain: true };
    },
    "crisis": function () {
      return { ctx: buildNuraContext("general"), plain: true, lines: [
        "I'm really sorry you're feeling this much pain. You matter, and you don't have to carry this alone.",
        "I'm not a doctor or therapist and can't help with this the way a person can. Please reach out to someone right now — a family member, a friend, or a doctor.",
        "If you might act on these thoughts, call your local emergency number now (112 in India) or go to the nearest hospital. In India you can also call Tele-MANAS, a free mental-health helpline, at 14416."
      ], actions: [] };
    },
    "fallback": function () {
      return { ctx: buildNuraContext("general"), plain: true, lines: ["I'm not sure I understood. I can help with: your day (\"what should I do next?\"), studying, a missed routine, sleep, fitness, progress, or an urge.", "You can tap one of the options above, or say it in your own words."], actions: [] };
    }
  };

  var BH_INTENTS = [
    { id: "crisis", re: /(suicid|kill myself|end my life|want to die|self[- ]?harm|hurt myself|no reason to live|don'?t want to live)/i },
    { id: "ruling", re: /(halal|haram|fatwa|permissible|is it (allowed|a sin)|sinful|makruh)/i },
    { id: "quran", re: /(quran|qur'an|\bayah\b|\bverse\b|surah|hadith|\bduas?\b|tafsir)/i },
    { id: "want-smoke", re: /(smok|cigarette|vape|nicotine)/i },
    { id: "urge-porn", re: /(porn|masturbat|relaps|\burges?\b|\bcravings?\b)/i },
    { id: "flow-pattern", re: /(pattern|consisten|daily flow|life grid|my plan\b|keep missing|(always|never|usually|often) (struggle|miss|fail|finish|complete|do)|how('?s| is) my plan)/i },
    { id: "study-help", re: /(study|studying|exam|homework|revision|revise|assignment|concentrat|focus)/i },
    { id: "sleep", re: /(sleep|insomnia|bedtime|can'?t sleep|wake up)/i },
    { id: "fitness", re: /(workout|gym|exercise|fitness|run\b|running)/i },
    { id: "phone", re: /(phone|screen ?time|scroll|instagram|tiktok|youtube|reels)/i },
    { id: "progress", re: /(progress|this week|how am i doing|how'?s my|improve)/i },
    { id: "missed-routine", re: /(missed|routine|sunnah|salah|namaz|prayer|\bfajr\b|\bdhuhr\b|\basr\b|\bmaghrib\b|\bisha\b)/i },
    { id: "wasted-day", re: /(wasted|waste|lazy|behind|nothing done|unproductive|overwhelm|stress|bored)/i },
    { id: "what-next", re: /(what (should|do) i|what now|what next|where (do i|should i) start|help me)/i }
  ];
  function bhClassify(text) {
    for (var i = 0; i < BH_INTENTS.length; i++) { if (BH_INTENTS[i].re.test(text)) return BH_INTENTS[i].id; }
    return "fallback";
  }

  var CHAT_OPTIONS = [
    { id: "wasted-day", label: "I wasted my day" },
    { id: "what-next", label: "What should I do next?" },
    { id: "want-smoke", label: "I feel like smoking" },
    { id: "urge-porn", label: "I'm getting an urge" },
    { id: "study-help", label: "Help me study" },
    { id: "missed-routine", label: "I missed my routine" },
    { id: "flow-pattern", label: "How is my plan going?" }
  ];

  function renderChatOptions() {
    var wrap = document.getElementById("chat-options");
    wrap.innerHTML = "";
    CHAT_OPTIONS.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.className = "chat-option-btn";
      btn.textContent = opt.label;
      btn.addEventListener("click", function () { bhRespond(opt.id, ""); });
      wrap.appendChild(btn);
    });
  }

  function bhRespond(intentId, userText) {
    var reply = (BH_REPLIES[intentId] || BH_REPLIES.fallback)(userText || "");
    var card = document.getElementById("chat-response-card");
    var area = document.getElementById("chat-response");
    area.innerHTML = "";
    if (userText) {
      var you = document.createElement("p");
      you.className = "chat-user-line";
      you.textContent = "You: " + userText;
      area.appendChild(you);
    }
    reply.lines.forEach(function (line) {
      var p = document.createElement("p");
      p.className = "chat-response-line";
      p.textContent = line;
      area.appendChild(p);
    });
    if (reply.shield) {
      var shieldBtn = document.createElement("button");
      shieldBtn.className = "btn btn-primary btn-full";
      shieldBtn.textContent = "Open Shield now";
      shieldBtn.addEventListener("click", openShield);
      area.appendChild(shieldBtn);
    }
    (reply.actions || []).forEach(function (act) {
      var b = document.createElement("button");
      b.className = "chat-action-btn";
      b.textContent = act.label;
      b.addEventListener("click", function () {
        if (!act.confirm) { act.fn(); return; }
        var row = document.createElement("div");
        row.className = "chat-confirm-row";
        var q = document.createElement("p");
        q.className = "chat-response-line";
        q.textContent = act.confirm;
        var yes = document.createElement("button");
        yes.className = "btn btn-primary";
        yes.textContent = "Yes, do it";
        yes.addEventListener("click", function () { act.fn(); row.remove(); b.remove(); });
        var no = document.createElement("button");
        no.className = "btn btn-outline";
        no.textContent = "Cancel";
        no.addEventListener("click", function () { row.remove(); b.classList.remove("hidden"); });
        row.appendChild(q); row.appendChild(yes); row.appendChild(no);
        b.classList.add("hidden");
        area.insertBefore(row, b.nextSibling);
      });
      area.appendChild(b);
    });
    var used = (reply.ctx.sections || []).filter(function (n) { return NC_LABELS[n]; }).map(function (n) { return NC_LABELS[n]; });
    if (used.length) {
      var src = document.createElement("p");
      src.className = "chat-context-line";
      src.textContent = "Looked at: " + used.join(", ") + ". Stays on this device.";
      area.appendChild(src);
    }
    card.classList.remove("hidden");
  }

  function initChatInput() {
    var input = document.getElementById("chat-input");
    var send = document.getElementById("chat-send-btn");
    if (!input || !send) return;
    function go() {
      var text = input.value.replace(/\s+/g, " ").trim();
      if (!text) return;
      input.value = "";
      bhRespond(bhClassify(text), text);
    }
    send.addEventListener("click", go);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  }

  // Read-only handle so the context and replies can be inspected/tested; it can't change anything.
  window.NuraCompanion = { buildContext: buildNuraContext, classify: bhClassify, previewReply: function (id, text) { var r = (BH_REPLIES[id] || BH_REPLIES.fallback)(text || ""); return { lines: r.lines, actions: (r.actions || []).map(function (a) { return a.label; }), sections: r.ctx.sections }; } };

  function quickStartFocusFromChat(title, minutes, planKey) {
    startAdhocFocus(title, minutes, planKey);
    setActiveView("home");
  }

  // ---------- SHIELD ----------

  var shieldTimerId = null;

  function openShield() {
    document.getElementById("modal-shield").classList.remove("hidden");
    document.getElementById("shield-step-start").classList.remove("hidden");
    document.getElementById("shield-step-reason").classList.add("hidden");
    document.getElementById("shield-clock").textContent = "0:30";
  }

  function closeShield() {
    if (shieldTimerId) { clearInterval(shieldTimerId); shieldTimerId = null; }
    document.getElementById("modal-shield").classList.add("hidden");
  }

  function beginShieldPause() {
    var remaining = 30;
    document.getElementById("shield-begin-btn").disabled = true;
    shieldTimerId = setInterval(function () {
      remaining -= 1;
      document.getElementById("shield-clock").textContent = "0:" + String(Math.max(remaining, 0)).padStart(2, "0");
      if (remaining <= 0) {
        clearInterval(shieldTimerId);
        shieldTimerId = null;
        document.getElementById("shield-step-start").classList.add("hidden");
        document.getElementById("shield-step-reason").classList.remove("hidden");
      }
    }, 1000);
  }

  function logShieldUse(reason) {
    var log = readJSON("nc_shield_log", []);
    log.push({ date: todayKey(), reason: reason || "" });
    writeJSON("nc_shield_log", log);
  }

  function initShield() {
    document.getElementById("shield-close").addEventListener("click", closeShield);
    document.getElementById("shield-begin-btn").addEventListener("click", beginShieldPause);
    document.getElementById("shield-done-btn").addEventListener("click", function () {
      logShieldUse(document.getElementById("shield-reason-input").value.trim());
      document.getElementById("shield-reason-input").value = "";
      document.getElementById("shield-begin-btn").disabled = false;
      closeShield();
      showToast("Good. One small step counts.");
    });
    document.getElementById("shield-goal-btn").addEventListener("click", function () {
      logShieldUse(document.getElementById("shield-reason-input").value.trim());
      document.getElementById("shield-reason-input").value = "";
      document.getElementById("shield-begin-btn").disabled = false;
      closeShield();
      setActiveView("home");
    });
  }

  // ---------- MORE ----------

  var FEATURE_STATUS = [
    { name: "Home tasks + focus timer", status: "implemented" },
    { name: "Sunnah routine + Akhlaq tracking", status: "implemented" },
    { name: "Quran daily verse (Tanzil, Arabic only)", status: "implemented" },
    { name: "Hadith lesson + quiz (1 lesson)", status: "partial" },
    { name: "Hamdard chat", status: "partial", note: "rule-based, reads your real NURA data on this device; not a live AI model" },
    { name: "Shield pause", status: "partial", note: "manual in-app only, no device-level blocking" },
    { name: "Vault / Hamdard", status: "planned", note: "no real encryption yet" },
    { name: "Duas library", status: "planned", note: "no reviewed source yet" },
    { name: "Full Quran + translation", status: "planned" },
    { name: "Prayer times / calculation method", status: "planned" },
    { name: "Notifications", status: "planned" },
    { name: "Ads / subscriptions / coin redemption", status: "planned", note: "business terms undecided" },
    { name: "Owner dashboard", status: "planned" }
  ];

  function renderFeatureStatus() {
    var list = document.getElementById("feature-status-list");
    list.innerHTML = "";
    FEATURE_STATUS.forEach(function (f) {
      var li = document.createElement("li");
      var label = document.createElement("span");
      label.textContent = f.name + (f.note ? " — " + f.note : "");
      var tag = document.createElement("span");
      tag.className = "status-tag " + f.status;
      tag.textContent = f.status;
      li.appendChild(label);
      li.appendChild(tag);
      list.appendChild(li);
    });
  }

  function renderMore() {
    var name = localStorage.getItem("nc_user_name");
    document.getElementById("more-name-display").textContent = name ? name : "No name set yet.";
    document.getElementById("coins-count").textContent = getCoins();
    renderFeatureStatus();
  }

  function initMore() {
    document.getElementById("edit-name-btn").addEventListener("click", function () {
      document.getElementById("modal-name").classList.remove("hidden");
    });

    document.getElementById("open-hamdard-btn").addEventListener("click", function () {
      setActiveView("vault");
    });

    document.getElementById("export-data-btn").addEventListener("click", function () {
      var data = {};
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k.indexOf("nc_") === 0) data[k] = readJSON(k, null);
      }
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "nura-data-export.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("Export downloaded");
    });

    document.getElementById("clear-data-btn").addEventListener("click", function () {
      var confirmed = window.confirm("Delete all your NURA data on this device? This cannot be undone.");
      if (!confirmed) return;
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k.indexOf("nc_") === 0) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
      showToast("All data deleted");
      location.reload();
    });
  }

  // ---------- NAV ----------

  function setActiveView(name) {
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("hidden", v.dataset.view !== name);
    });
    document.documentElement.classList.toggle("on-home", name === "home" || name === "flow" || name === "plan" || name === "progress");
    // Four primary tabs: Today, Hamdard, Progress, Plan. Everything else is a supporting screen (nothing highlighted).
    var navHighlight = name === "chat" ? "chat" : name === "progress" ? "progress" : (name === "plan" || name === "duniya-plan") ? "plan" : (name === "home" || name === "flow") ? "home" : null;
    document.querySelectorAll(".nav-btn[data-nav]").forEach(function (btn) {
      var on = btn.dataset.nav === navHighlight;
      btn.classList.toggle("active", on);
      if (on) btn.setAttribute("aria-current", "page"); else btn.removeAttribute("aria-current");
    });
    if (name === "home") renderHome();
    if (name === "plan" && window.NuraFeatures) window.NuraFeatures.render("plan");
    if (name === "progress" && window.NuraFeatures) window.NuraFeatures.render("progress");
    if (name === "flow") { renderFlow(); window.scrollTo(0, 0); }
    if (name === "duniya-tool") { mountPriorityCard("priority-card-duniya-slot"); renderTodaysPriority(); }
    if (name === "sunnah") { renderRoutine(); renderAkhlaq(); renderVerseOfDay(); renderHadithList(); renderDuaCategories(); }
    if (name === "chat") renderChatOptions();
    if (name === "vault") renderVaultRoot();
    if (name === "more") renderMore();
    if (name === "memory") renderMemory();
    if (name === "duniya") renderDuniya();
    if (name === "duniya-habits") renderDuniyaHabits();
    if (name === "duniya-productivity") renderDuniyaProductivity();
    if (name === "duniya-career") renderDuniyaCareer();
    if (name === "duniya-money") renderDuniyaMoney();
    if (name === "duniya-growth") {
      if (["progress", "focus", "reflect", "reflect-done"].indexOf(gwView.screen) !== -1) gwView = { screen: "home" };
      renderDuniyaGrowth();
    }
    if (name === "duniya-plan") renderDuniyaPlan();
    if (name === "duniya-phone-guard") renderPhoneGuard();
    if (name === "duniya-recovery") renderRecovery();
    if (name !== "duniya-recovery") rcStopTimer();
  }

  function initNav() {
    document.querySelectorAll(".nav-btn[data-nav]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setActiveView(btn.dataset.nav);
      });
    });
  }

  // ---------- NAME MODAL ----------

  function initNameModal() {
    var existing = localStorage.getItem("nc_user_name");
    var modal = document.getElementById("modal-name");
    if (existing) {
      modal.classList.add("hidden");
    } else {
      modal.classList.remove("hidden");
    }
    var input = document.getElementById("name-input");
    var saveBtn = document.getElementById("name-save");

    function save() {
      var val = input.value.trim();
      if (val) {
        localStorage.setItem("nc_user_name", val);
      }
      modal.classList.add("hidden");
      renderHome();
      renderMore();
    }

    saveBtn.addEventListener("click", save);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") save();
    });
  }

  // ---------- DUNIYA (everyday self-improvement hub) ----------
  // Deen (Sunnah/Quran/Duas) stays separate from Duniya (study, phone,
  // sleep, fitness, habits, productivity, wellbeing, career, money,
  // growth) so users know which part of life they're working on, per
  // the two-worlds distinction in the brief. Study/Phone/Sleep/Fitness
  // reuse the exact same picker flow already built into Home rather
  // than duplicating that logic — Duniya just routes into it.

  var DUNIYA_AREAS = [
    { id: "study", icon: "📚", title: "Study & Focus", sub: "Pick a subject, start a timer.", route: "picker", step: "study-prep" },
    { id: "phone", icon: "📵", title: "Phone Control", sub: "Name the distraction, take a break from it.", route: "picker", step: "phone-distraction" },
    { id: "sleep", icon: "🌙", title: "Sleep", sub: "Set a bedtime, track when you wake.", route: "picker", step: "sleep-bedtime" },
    { id: "fitness", icon: "🏋️", title: "Fitness", sub: "Pick a body part and get moving.", route: "picker", step: "fitness-bodypart" },
    { id: "habits", icon: "✅", title: "Habits & Discipline", sub: "Build habits without streak pressure.", route: "view", view: "duniya-habits" },
    { id: "productivity", icon: "📋", title: "Productivity", sub: "Top 3 tasks, one at a time.", route: "view", view: "duniya-productivity" },
    { id: "wellbeing", icon: "🧘", title: "Mental Wellbeing", sub: "A grounding step when things feel heavy.", route: "view", view: "duniya-wellbeing" },
    { id: "career", icon: "🎯", title: "Career & Skills", sub: "One small goal, one daily action.", route: "view", view: "duniya-career" },
    { id: "money", icon: "💰", title: "Money Habits", sub: "A little daily awareness.", route: "view", view: "duniya-money" },
    { id: "growth", icon: "🌱", title: "Personal Growth", sub: "One practical exercise, not advice.", route: "view", view: "duniya-growth" }
  ];

  function mountPriorityCard(slotId) {
    var card = document.getElementById("priority-card-el");
    var slot = document.getElementById(slotId);
    if (!card || !slot) return;
    if (card.parentElement !== slot) {
      if (slotId === "priority-card-home-slot") {
        slot.parentNode.insertBefore(card, slot.nextSibling);
      } else {
        slot.appendChild(card);
      }
    }
  }

  function startDuniyaQuickAction(stepView) {
    var current = getCurrentPriority();
    if (current) {
      appendPriorityLog({ date: current.date, planKey: current.planKey, title: current.title, minutes: current.minutes, status: current.status === "pending" ? "not-yet" : current.status });
      savePriority(null);
      focusState.linkedPriorityId = null;
    }
    pickerStep = { view: stepView, bodyPart: null };
    setActiveView("duniya-tool");
  }

  function renderDuniyaToday() {
    var content = document.getElementById("duniya-today-content");
    var p = getCurrentPriority();
    content.innerHTML = "";
    if (!p) {
      var q = document.createElement("p");
      q.className = "muted-line";
      q.textContent = "What do you want to improve today?";
      content.appendChild(q);
      return;
    }
    var focusLabel = document.createElement("p");
    focusLabel.className = "salah-next-label";
    focusLabel.textContent = "Today's focus";
    content.appendChild(focusLabel);
    var title = document.createElement("p");
    title.className = "priority-title";
    title.style.margin = "0 0 8px";
    title.textContent = p.title;
    content.appendChild(title);
    var pct = computeProgressPercent(p);
    var progress = document.createElement("p");
    progress.className = "muted-line";
    progress.textContent = pct + "% today.";
    content.appendChild(progress);
    var contBtn = document.createElement("button");
    contBtn.className = "btn btn-primary btn-full";
    contBtn.textContent = "CONTINUE";
    contBtn.addEventListener("click", function () { setActiveView("home"); });
    content.appendChild(contBtn);
  }

  function renderDuniyaQuickActions() {
    var grid = document.getElementById("duniya-quick-actions");
    grid.innerHTML = "";
    var actions = [
      { label: "Focus Now", step: "study-prep" },
      { label: "Phone-Free Session", step: "phone-distraction" },
      { label: "Quick Workout", step: "fitness-bodypart" },
      { label: "Better Sleep", step: "sleep-bedtime" }
    ];
    actions.forEach(function (a) {
      var btn = document.createElement("button");
      btn.className = "preset-plan-chip";
      btn.textContent = a.label;
      btn.addEventListener("click", function () { startDuniyaQuickAction(a.step); });
      grid.appendChild(btn);
    });
    var planBtn = document.createElement("button");
    planBtn.className = "preset-plan-chip";
    planBtn.textContent = "Plan My Day";
    planBtn.addEventListener("click", function () { setActiveView("duniya-plan"); });
    grid.appendChild(planBtn);
  }

  function renderDuniyaAreaGrid() {
    var grid = document.getElementById("duniya-area-grid");
    grid.innerHTML = "";
    DUNIYA_AREAS.forEach(function (area) {
      var btn = document.createElement("button");
      btn.className = "duniya-area-card";
      btn.innerHTML =
        '<span class="duniya-area-icon">' + area.icon + '</span>' +
        '<span class="duniya-area-title">' + area.title + '</span>' +
        '<span class="duniya-area-sub">' + area.sub + '</span>';
      btn.addEventListener("click", function () {
        if (area.route === "picker") startDuniyaQuickAction(area.step);
        else setActiveView(area.view);
      });
      grid.appendChild(btn);
    });
  }

  function renderDuniya() {
    renderDuniyaToday();
    renderDuniyaQuickActions();
    renderDuniyaAreaGrid();
  }

  // ---- Habits & Discipline ----

  function getHabits() { return readJSON("nc_duniya_habits", []); }
  function saveHabits(h) { writeJSON("nc_duniya_habits", h); }
  function getHabitLogToday() {
    var all = readJSON("nc_duniya_habit_log", {});
    return all[todayKey()] || {};
  }
  function setHabitStatus(habitId, status) {
    var all = readJSON("nc_duniya_habit_log", {});
    var today = todayKey();
    all[today] = all[today] || {};
    all[today][habitId] = status;
    writeJSON("nc_duniya_habit_log", all);
    if (status === "done") memLog("habit_completed", "habits", { habitId: habitId });
  }

  function renderDuniyaHabits() {
    var list = document.getElementById("duniya-habit-list");
    list.innerHTML = "";
    var habits = getHabits();
    var log = getHabitLogToday();
    if (!habits.length) {
      var empty = document.createElement("p");
      empty.className = "muted-line";
      empty.textContent = "No habits yet — add one below.";
      list.appendChild(empty);
    }
    habits.forEach(function (h) {
      var item = document.createElement("div");
      item.className = "habit-item";
      var name = document.createElement("span");
      name.className = "name";
      name.textContent = h.name;
      item.appendChild(name);
      var status = log[h.id];
      var actions = document.createElement("div");
      actions.className = "action-buttons";
      ["done", "missed", "restarted"].forEach(function (s) {
        var btn = document.createElement("button");
        btn.className = "action-btn" + (status === s ? " primary" : "");
        btn.textContent = s.charAt(0).toUpperCase() + s.slice(1);
        btn.addEventListener("click", function () { setHabitStatus(h.id, s); renderDuniyaHabits(); });
        actions.appendChild(btn);
      });
      item.appendChild(actions);
      list.appendChild(item);
    });
  }

  function initDuniyaHabits() {
    document.getElementById("duniya-habits-back").addEventListener("click", function () { setActiveView("duniya"); });
    document.getElementById("duniya-habit-add-btn").addEventListener("click", function () {
      var input = document.getElementById("duniya-habit-input");
      var val = input.value.trim();
      if (!val) return;
      var habits = getHabits();
      habits.push({ id: uid("hab"), name: val });
      saveHabits(habits);
      input.value = "";
      renderDuniyaHabits();
    });
  }

  // ---- Productivity ----

  function getTop3() { return readJSON("nc_duniya_top3_" + todayKey(), ["", "", ""]); }
  function saveTop3(arr) { writeJSON("nc_duniya_top3_" + todayKey(), arr); }
  function getTop3Done() { return readJSON("nc_duniya_top3_done_" + todayKey(), [false, false, false]); }
  function saveTop3Done(arr) { writeJSON("nc_duniya_top3_done_" + todayKey(), arr); }

  function renderDuniyaProductivity() {
    var list = document.getElementById("duniya-top3-list");
    list.innerHTML = "";
    var tasks = getTop3();
    var done = getTop3Done();
    for (var i = 0; i < 3; i++) {
      (function (idx) {
        var row = document.createElement("div");
        row.className = "duniya-goal-item";
        var input = document.createElement("input");
        input.type = "text";
        input.className = "text-input";
        input.style.marginBottom = "0";
        input.placeholder = "Task " + (idx + 1);
        input.value = tasks[idx] || "";
        input.addEventListener("change", function () {
          var t = getTop3();
          t[idx] = input.value.trim();
          saveTop3(t);
        });
        var check = document.createElement("button");
        check.className = "action-btn" + (done[idx] ? " primary" : "");
        check.textContent = done[idx] ? "Done" : "Mark done";
        check.style.marginLeft = "8px";
        check.addEventListener("click", function () {
          var d = getTop3Done();
          d[idx] = !d[idx];
          saveTop3Done(d);
          renderDuniyaProductivity();
        });
        row.appendChild(input);
        row.appendChild(check);
        list.appendChild(row);
      })(i);
    }
    var startBtn = document.createElement("button");
    startBtn.className = "btn btn-outline btn-full";
    startBtn.textContent = "Start One Task";
    startBtn.addEventListener("click", function () {
      var t = getTop3();
      var firstUnfinished = t.findIndex(function (v, idx) { return v && !done[idx]; });
      if (firstUnfinished === -1) { showToast("Add or finish a task first"); return; }
      startAdhocFocus(t[firstUnfinished], 25);
      setActiveView("home");
    });
    list.appendChild(startBtn);
  }

  function initDuniyaProductivity() {
    document.getElementById("duniya-productivity-back").addEventListener("click", function () { setActiveView("duniya"); });
    document.getElementById("duniya-eod-save-btn").addEventListener("click", function () {
      var val = document.getElementById("duniya-eod-note").value.trim();
      writeJSON("nc_duniya_eod_" + todayKey(), val);
      showToast("Saved");
    });
  }

  // ---- Mental Wellbeing ----

  var DUNIYA_WELLBEING_OPTIONS = [
    { id: "stressed", label: "I feel stressed", lines: ["Take three slow breaths right now — in for 4, out for 6.", "Name one thing causing it. You don't have to fix it this second, just name it.", "Pick one small next step, even a 5-minute one."] },
    { id: "overwhelmed", label: "I feel overwhelmed", lines: ["Everything feeling like too much at once is a sign to shrink the list, not push harder.", "Pick just one thing from everything on your mind and do only that.", "The rest can wait until this one is done."] },
    { id: "wasted-day", label: "I wasted my day", lines: ["The day isn't over yet. What still matters today, even something small?", "One small action now counts more than regret about the rest of the day."] },
    { id: "cannot-focus", label: "I cannot focus", lines: ["Try a very short session first — 5 minutes, not 25.", "Remove one distraction (phone in another room) before trying again."] },
    { id: "angry", label: "I am angry", lines: ["Step away from the situation for a moment before responding.", "Slow, deliberate breaths for 30 seconds can lower the intensity.", "Write down what happened before deciding what to do about it."] }
  ];

  function renderDuniyaWellbeingOptions() {
    var wrap = document.getElementById("duniya-wellbeing-options");
    wrap.innerHTML = "";
    DUNIYA_WELLBEING_OPTIONS.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.className = "chat-option-btn";
      btn.textContent = opt.label;
      btn.addEventListener("click", function () {
        var card = document.getElementById("duniya-wellbeing-response-card");
        var area = document.getElementById("duniya-wellbeing-response");
        area.innerHTML = "";
        opt.lines.forEach(function (line) {
          var p = document.createElement("p");
          p.className = "chat-response-line";
          p.textContent = line;
          area.appendChild(p);
        });
        var chatBtn = document.createElement("button");
        chatBtn.className = "btn btn-outline btn-full";
        chatBtn.textContent = "Talk to Hamdard";
        chatBtn.addEventListener("click", function () { setActiveView("chat"); });
        area.appendChild(chatBtn);
        card.classList.remove("hidden");
      });
      wrap.appendChild(btn);
    });
  }

  function initDuniyaWellbeing() {
    document.getElementById("duniya-wellbeing-back").addEventListener("click", function () { setActiveView("duniya"); });
    renderDuniyaWellbeingOptions();
  }

  // ---- Career & Skills ----

  var DUNIYA_SKILL_AREAS = ["Communication", "English", "Coding", "Business", "Study", "Job preparation"];

  function getSkillGoal() { return readJSON("nc_duniya_skill_goal", null); }
  function saveSkillGoal(g) { writeJSON("nc_duniya_skill_goal", g); }

  // ---- Career Skills lesson library ----
  // LEARN -> PRACTICE -> DO -> REFLECT, not READ -> READ -> READ.
  // "How to Talk to People" gets the full rich treatment as the flagship
  // lesson; every other lesson uses the same reusable template (why /
  // explanation / steps / practice / challenge / reflection) so nothing
  // is a dead "OK"-only screen, without padding every lesson to the same
  // length. More lessons can be added to any category later.

  var CAREER_SKILLS = [
    { key: "communication", label: "Communication", lessons: [
      {
        key: "talk-to-people", title: "How to Talk to People",
        why: "Good communication is not about talking more. It's about starting clearly, listening, asking good questions, and making the other person comfortable.",
        explanation: "Most people overthink starting a conversation. A short, simple opener is almost always enough — the real skill is in what you do after that.",
        steps: [
          "Start simple: “Hi, how are you?” / “How do you know everyone here?” / “What are you working on?” / “How was your day?” — avoid complicated or personal openers.",
          "Use Ask → Listen → Follow-up: build your next question from their answer. (“What are you studying?” → “Computer science.” → “Oh nice, what made you choose that?”)",
          "Don't turn it into an interview. BAD: “Where are you from? What do you study? How old are you? What do you do?” one after another. GOOD: one question, really listen, then one natural follow-up from their actual answer.",
          "Body language: look at the person naturally, keep shoulders relaxed, don't check your phone, don't interrupt, speak clearly, smile when it fits.",
          "Stuck for what to ask? Use F.O.R.D. — Family, Occupation/Studies, Recreation/Interests, Dreams/Goals — but let it feel like curiosity, not a checklist."
        ],
        practice: "Next time someone answers a question, resist the urge to ask your next prepared question — ask something that reacts to what they just said instead.",
        challenge: "Start one 2-minute conversation with someone — a classmate, coworker, shopkeeper, friend, relative, or gym member."
      },
      { key: "active-listening", title: "Active Listening",
        why: "People can tell within seconds whether you're actually listening or just waiting to talk.",
        explanation: "Active listening means your next sentence is built from what the other person just said, not from what you'd already planned to say.",
        steps: ["Don't plan your reply while they're still talking.", "Repeat back the key point in your own words before responding.", "Ask one genuine follow-up question about what they said.", "Notice tone and body language, not just words."],
        practice: "In your next conversation, before replying, silently repeat their last sentence in your head first.",
        challenge: "In one conversation today, respond to at least two things by repeating them back in your own words first." },
      { key: "speaking-clearly", title: "Speaking Clearly",
        why: "Being understood the first time saves everyone's time and makes you sound more confident.",
        explanation: "Clear speech is usually about slowing down and cutting filler, not about a bigger vocabulary.",
        steps: ["Slow down — most people speak faster than they think when nervous.", "Cut filler words like ‘um’ and ‘like’ by pausing instead.", "Say one idea per sentence.", "End sentences clearly instead of trailing off."],
        practice: "Record 30 seconds of yourself explaining something simple, then listen back once.",
        challenge: "In your next conversation, deliberately pause instead of saying ‘um’ at least three times." },
      { key: "better-questions", title: "Asking Better Questions",
        why: "The quality of a conversation usually comes down to the quality of the questions, not the answers.",
        explanation: "Closed questions (yes/no) end conversations. Open questions keep them going.",
        steps: ["Prefer ‘What’ and ‘How’ questions over yes/no ones.", "Ask about specifics, not generalities (‘What part of it?’ not just ‘How was it?’).", "Follow up on the most interesting part of their answer, not the first thing you thought of.", "Leave space — don't fill every pause yourself."],
        practice: "Turn one yes/no question you'd normally ask into an open one before asking it.",
        challenge: "In one conversation today, ask at least two open-ended follow-up questions." },
      { key: "public-speaking", title: "Public Speaking Basics",
        why: "Most fear around public speaking comes from not having a simple structure to rely on.",
        explanation: "You don't need to memorize a script — you need 3 clear points and a calm pace.",
        steps: ["Open with why this matters to the audience, not a long introduction.", "Stick to 3 main points, no more.", "Pause after key points instead of rushing on.", "Look at a few friendly faces in the room, not the floor or ceiling.", "Close by repeating your main point in one sentence."],
        practice: "Explain one topic out loud for 60 seconds using exactly 3 points, timed.",
        challenge: "Speak up with one clear point in a group setting today — a class, meeting, or group chat voice note." },
      { key: "difficult-conversations", title: "Difficult Conversations",
        why: "Avoiding a hard conversation usually makes the problem bigger, not smaller.",
        explanation: "Difficult conversations go better when you separate the person from the problem and stay specific.",
        steps: ["State the specific issue, not a general complaint (‘This deadline was missed’ not ‘You're always late’).", "Say how it affected you or the situation, briefly.", "Ask their side before concluding anything.", "Agree on one concrete next step before ending."],
        practice: "Write down the one specific sentence you'd open a hard conversation with — before you actually have it.",
        challenge: "If something is bothering you, say the first honest sentence of that conversation to the person today — even if the rest waits." }
    ]},
    { key: "professional", label: "Professional Skills", lessons: [
      { key: "time-management", title: "Time Management",
        why: "Most time problems are planning problems, not effort problems.",
        explanation: "Deciding what NOT to do today matters more than trying to fit everything in.",
        steps: ["Pick your top 1-3 priorities before the day starts, not during it.", "Do the hardest task first, while your energy is highest.", "Block time for a task instead of leaving it 'somewhere today'.", "Say no to, or postpone, anything that isn't a priority."],
        practice: "Before you start work today, write your top priority on paper first.",
        challenge: "Do your single hardest task today before you check your phone." },
      { key: "problem-solving", title: "Problem Solving",
        why: "Most 'stuck' moments are really just an undefined problem, not an unsolvable one.",
        explanation: "Clearly naming the actual problem usually reveals the next step.",
        steps: ["Write the problem down in one specific sentence.", "List what's actually in your control right now.", "Pick the smallest next action, not the whole solution.", "Do that one action before reconsidering the whole problem."],
        practice: "Take something vaguely bothering you and write it as one specific sentence.",
        challenge: "Pick one real problem you're avoiding and do the smallest next step on it today." },
      { key: "teamwork", title: "Teamwork",
        why: "Most team friction comes from unclear expectations, not personality clashes.",
        explanation: "Good teammates make their own work visible and ask before assuming.",
        steps: ["State clearly what you're working on and by when.", "Ask instead of assuming when something's unclear.", "Give credit specifically, not generically.", "Flag a blocker early, not after it's already a problem."],
        practice: "Tell one teammate exactly what you're doing today, unprompted.",
        challenge: "Proactively update someone on your progress today, before they have to ask." },
      { key: "leadership-basics", title: "Leadership Basics",
        why: "Leadership isn't a title — it's taking responsibility before you're asked to.",
        explanation: "The simplest form of leadership is doing the unglamorous thing that needs doing.",
        steps: ["Notice what needs doing that no one's claimed.", "Take ownership of one small thing without being asked.", "Give one specific, useful piece of feedback.", "Follow through on what you said you'd do."],
        practice: "Notice one small task today that's nobody's job and just do it.",
        challenge: "Take ownership of one thing today that wasn't officially assigned to you." },
      { key: "decision-making", title: "Decision Making",
        why: "Indecision often costs more than picking an imperfect option.",
        explanation: "Most everyday decisions don't need to be perfect — they need to be made.",
        steps: ["Set a time limit for the decision.", "List only the 2-3 options that actually matter.", "Ask: what's the real cost of being wrong here?", "Decide, then stop reopening it."],
        practice: "Pick one small decision you've been putting off and set yourself 5 minutes to decide.",
        challenge: "Make one pending decision today instead of leaving it open." }
    ]},
    { key: "job", label: "Job Skills", lessons: [
      { key: "resume-basics", title: "Resume Basics",
        why: "A resume's job is to get you an interview, not to list everything you've ever done.",
        explanation: "Specific, measurable lines beat vague descriptions every time.",
        steps: ["Lead each line with what you did, using an action verb.", "Add a number or result where possible.", "Cut anything irrelevant to the role you want.", "Keep it to one page if you're early in your career."],
        practice: "Rewrite one line of your resume to include a specific number or result.",
        challenge: "Rewrite three bullet points on your resume to be more specific today." },
      { key: "interview-basics", title: "Interview Basics",
        why: "Most interviews are lost to vague answers, not to a lack of qualification.",
        explanation: "Specific stories beat general claims — interviewers remember examples, not adjectives.",
        steps: ["Prepare 2-3 real stories using: Situation, Task, Action, Result.", "Answer the actual question asked, not a rehearsed speech.", "Prepare 2 genuine questions to ask them.", "Practice saying your stories out loud, not just in your head."],
        practice: "Turn one line from your resume into a 30-second Situation-Task-Action-Result story.",
        challenge: "Say one of your interview stories out loud, from start to finish, today." },
      { key: "networking", title: "Networking",
        why: "Networking is just staying in genuine touch with people — not asking strangers for favors.",
        explanation: "The best networking looks like helping first and reconnecting naturally.",
        steps: ["Reach out with a specific, genuine reason, not just 'let's connect'.", "Offer something before asking for something, if you can.", "Follow up after a helpful conversation with a short thank-you.", "Keep in touch occasionally, not only when you need something."],
        practice: "Think of one person you haven't spoken to in a while and draft a short message to them.",
        challenge: "Send that message to one real contact today." },
      { key: "professional-email", title: "Professional Email",
        why: "A clear email gets a faster, better response than a long one.",
        explanation: "State the ask in the first two lines — don't bury it in a big story.",
        steps: ["Use a specific subject line, not 'Hi' or 'Question'.", "State your ask or point in the first two sentences.", "Keep paragraphs short.", "End with a clear, specific next step."],
        practice: "Rewrite the subject line of your next email to be specific.",
        challenge: "Send one email today that states your ask in the first two sentences." },
      { key: "workplace-communication", title: "Workplace Communication",
        why: "Most workplace confusion comes from assuming instead of confirming.",
        explanation: "Confirming understanding out loud prevents most misunderstandings before they start.",
        steps: ["Repeat back instructions in your own words to confirm.", "Communicate delays as soon as you know, not at the deadline.", "Put important decisions in writing, briefly.", "Match your tone to the channel — chat isn't email isn't a meeting."],
        practice: "Next time you get an instruction, repeat it back in your own words before starting.",
        challenge: "Confirm one instruction or task today by repeating it back before you begin." }
    ]},
    { key: "learning", label: "Learning Skills", lessons: [
      { key: "learn-faster", title: "Learn Faster",
        why: "How you study matters more than how long you study.",
        explanation: "Actively recalling information beats re-reading it almost every time.",
        steps: ["After reading a section, close it and try to explain it from memory.", "Space repetition out over days instead of cramming once.", "Teach the idea to someone else, even out loud to yourself.", "Test yourself before you feel ready."],
        practice: "Pick something you studied recently and try to explain it out loud without looking.",
        challenge: "Study one topic today using recall (close the book, explain it) instead of just re-reading." },
      { key: "better-notes", title: "Take Better Notes",
        why: "Notes you never review are just typing practice.",
        explanation: "Good notes are built to be reviewed later, not just written once.",
        steps: ["Write in your own words, not verbatim.", "Summarize each section in one line at the top.", "Leave space to add questions or connections later.", "Review notes within 24 hours, briefly."],
        practice: "Take your last set of notes and add a one-line summary to the top.",
        challenge: "Review one page of old notes today and add anything you now understand better." },
      { key: "deep-work", title: "Deep Work",
        why: "A distracted hour produces far less than 25 minutes of real focus.",
        explanation: "Deep work needs a clear task, a time limit, and removed distractions — all three, not just one.",
        steps: ["Pick one specific task, not 'work on project'.", "Set a timer for a fixed block.", "Remove your phone from the room, not just silence it.", "Take a real break when the timer ends."],
        practice: "Pick your next task and write the one specific outcome you want from this session.",
        challenge: "Do one real 25-minute deep work block today, phone out of the room." },
      { key: "remember", title: "Remember What You Learn",
        why: "Most forgetting happens because information is never revisited, not because it was too hard.",
        explanation: "A few short reviews over time beat one long review.",
        steps: ["Review new information within a day of learning it.", "Review again after a few days, then a week.", "Connect new information to something you already know.", "Write a one-line summary in your own words."],
        practice: "Pick one thing you learned this week and write a one-line summary from memory.",
        challenge: "Review one thing you learned earlier this week today, without looking it up first." }
    ]}
  ];

  function findCareerLesson(catKey, lessonKey) {
    var cat = CAREER_SKILLS.find(function (c) { return c.key === catKey; });
    if (!cat) return null;
    var lesson = cat.lessons.find(function (l) { return l.key === lessonKey; });
    return lesson ? { cat: cat, lesson: lesson } : null;
  }

  function getCareerProgress() { return readJSON("nc_duniya_career_progress", {}); }
  function saveCareerProgress(p) { writeJSON("nc_duniya_career_progress", p); }

  function renderDuniyaCareer() {
    var content = document.getElementById("duniya-career-content");
    content.innerHTML = "";

    var h2 = document.createElement("h2");
    h2.textContent = "Career Skills";
    content.appendChild(h2);
    var sub = document.createElement("p");
    sub.className = "muted-line";
    sub.style.marginBottom = "14px";
    sub.textContent = "Short, practical lessons — learn, practice, do.";
    content.appendChild(sub);

    var progress = getCareerProgress();
    CAREER_SKILLS.forEach(function (cat) {
      var catTitle = document.createElement("p");
      catTitle.className = "picker-step-title";
      catTitle.textContent = cat.label;
      content.appendChild(catTitle);
      var list = document.createElement("div");
      list.className = "dua-list";
      list.style.marginBottom = "16px";
      cat.lessons.forEach(function (lesson) {
        var row = document.createElement("button");
        row.className = "dua-list-item";
        var done = progress[cat.key + ":" + lesson.key];
        row.innerHTML = '<span class="dua-list-title">' + lesson.title + '</span>' + (done ? '<span class="dua-list-fav">✓</span>' : '');
        row.addEventListener("click", function () { openCareerLesson(cat.key, lesson.key); });
        list.appendChild(row);
      });
      content.appendChild(list);
    });

    var divider = document.createElement("div");
    divider.className = "sunnah-item-divider";
    content.appendChild(divider);

    var goalTitle = document.createElement("p");
    goalTitle.className = "picker-step-title";
    goalTitle.textContent = "My Skill Goal";
    content.appendChild(goalTitle);
    renderSkillGoalArea(content);
  }

  function renderSkillGoalArea(content) {
    var goal = getSkillGoal();
    if (!goal) {
      var label = document.createElement("p");
      label.className = "muted-line";
      label.textContent = "Track daily action on one skill area of your own.";
      content.appendChild(label);
      var grid = document.createElement("div");
      grid.className = "preset-plan-grid";
      DUNIYA_SKILL_AREAS.forEach(function (area) {
        var btn = document.createElement("button");
        btn.className = "preset-plan-chip";
        btn.textContent = area;
        btn.addEventListener("click", function () { renderSkillGoalForm(area); });
        grid.appendChild(btn);
      });
      content.appendChild(grid);
      return;
    }
    var goalLine = document.createElement("p");
    goalLine.className = "muted-line";
    goalLine.textContent = goal.area + ": " + goal.goal;
    content.appendChild(goalLine);
    var todayDone = (goal.log || {})[todayKey()];
    var actionBtn = document.createElement("button");
    actionBtn.className = "btn btn-primary btn-full";
    actionBtn.textContent = todayDone ? "Today's action done ✓" : "Mark today's action done";
    actionBtn.disabled = !!todayDone;
    actionBtn.addEventListener("click", function () {
      goal.log = goal.log || {};
      goal.log[todayKey()] = true;
      saveSkillGoal(goal);
      renderDuniyaCareer();
    });
    content.appendChild(actionBtn);
    var changeBtn = document.createElement("button");
    changeBtn.className = "priority-change-link";
    changeBtn.textContent = "Choose a different goal";
    changeBtn.addEventListener("click", function () { saveSkillGoal(null); renderDuniyaCareer(); });
    content.appendChild(changeBtn);
  }

  function renderSkillGoalForm(area) {
    var content = document.getElementById("duniya-career-content");
    content.innerHTML = "";
    var h2 = document.createElement("h2");
    h2.textContent = area;
    content.appendChild(h2);
    var label = document.createElement("p");
    label.className = "muted-line";
    label.textContent = "What's one small goal here?";
    content.appendChild(label);
    var input = document.createElement("input");
    input.type = "text";
    input.className = "text-input";
    input.placeholder = "e.g. Practice speaking 10 minutes daily";
    content.appendChild(input);
    var saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary btn-full";
    saveBtn.textContent = "Set goal";
    saveBtn.addEventListener("click", function () {
      var val = input.value.trim();
      if (!val) return;
      saveSkillGoal({ area: area, goal: val, log: {} });
      renderDuniyaCareer();
    });
    content.appendChild(saveBtn);
    var backBtn = document.createElement("button");
    backBtn.className = "priority-change-link";
    backBtn.textContent = "← Back";
    backBtn.addEventListener("click", renderDuniyaCareer);
    content.appendChild(backBtn);
  }

  function openCareerLesson(catKey, lessonKey) {
    var found = findCareerLesson(catKey, lessonKey);
    if (!found) return;
    var lesson = found.lesson, cat = found.cat;
    var content = document.getElementById("duniya-career-content");
    content.innerHTML = "";

    var backBtn = document.createElement("button");
    backBtn.className = "picker-step-back";
    backBtn.textContent = "← Career Skills";
    backBtn.addEventListener("click", renderDuniyaCareer);
    content.appendChild(backBtn);

    var title = document.createElement("h2");
    title.textContent = lesson.title;
    content.appendChild(title);

    var why = document.createElement("p");
    why.className = "priority-why";
    why.textContent = lesson.why;
    content.appendChild(why);

    var expl = document.createElement("p");
    expl.className = "hadith-text";
    expl.textContent = lesson.explanation;
    content.appendChild(expl);

    var stepsTitle = document.createElement("p");
    stepsTitle.className = "picker-step-title";
    stepsTitle.textContent = "Practical steps";
    content.appendChild(stepsTitle);
    var stepsList = document.createElement("ul");
    stepsList.className = "fitness-warmup-list";
    lesson.steps.forEach(function (s) {
      var li = document.createElement("li");
      li.textContent = s;
      stepsList.appendChild(li);
    });
    content.appendChild(stepsList);

    var practiceTitle = document.createElement("p");
    practiceTitle.className = "picker-step-title";
    practiceTitle.textContent = "Mini practice";
    content.appendChild(practiceTitle);
    var practiceP = document.createElement("p");
    practiceP.className = "hadith-explain";
    practiceP.textContent = lesson.practice;
    content.appendChild(practiceP);

    var progress = getCareerProgress();
    var key = catKey + ":" + lessonKey;
    var entry = progress[key];

    var challengeTitle = document.createElement("p");
    challengeTitle.className = "picker-step-title";
    challengeTitle.textContent = "TODAY'S CHALLENGE";
    content.appendChild(challengeTitle);
    var challengeP = document.createElement("p");
    challengeP.className = "hadith-text";
    challengeP.textContent = lesson.challenge;
    content.appendChild(challengeP);

    if (!entry || !entry.started) {
      var startBtn = document.createElement("button");
      startBtn.className = "btn btn-primary btn-full";
      startBtn.textContent = "Start Challenge";
      startBtn.addEventListener("click", function () {
        progress[key] = { started: true, done: false };
        saveCareerProgress(progress);
        openCareerLesson(catKey, lessonKey);
      });
      content.appendChild(startBtn);
    } else if (!entry.done) {
      var doneBtn = document.createElement("button");
      doneBtn.className = "btn btn-primary btn-full";
      doneBtn.textContent = "I Did It";
      doneBtn.addEventListener("click", function () {
        entry.done = true;
        entry.completedDate = todayKey();
        saveCareerProgress(progress);
        openCareerLesson(catKey, lessonKey);
      });
      content.appendChild(doneBtn);
    } else if (!entry.difficulty) {
      var howLabel = document.createElement("p");
      howLabel.className = "muted-line";
      howLabel.textContent = "How did it go?";
      content.appendChild(howLabel);
      var moodRow = document.createElement("div");
      moodRow.className = "priority-checkin-buttons";
      [["Easy", "🙂"], ["Okay", "😐"], ["Difficult", "😬"]].forEach(function (m) {
        var btn = document.createElement("button");
        btn.className = "action-btn";
        btn.textContent = m[1] + " " + m[0];
        btn.addEventListener("click", function () {
          entry.difficulty = m[0];
          saveCareerProgress(progress);
          openCareerLesson(catKey, lessonKey);
        });
        moodRow.appendChild(btn);
      });
      content.appendChild(moodRow);
    } else {
      var doneText = document.createElement("p");
      doneText.className = "priority-done-text";
      doneText.textContent = "Completed ✓ (" + entry.difficulty + ")";
      content.appendChild(doneText);
      if (!entry.reflection) {
        var reflLabel = document.createElement("p");
        reflLabel.className = "muted-line";
        reflLabel.textContent = "What was difficult? (optional)";
        content.appendChild(reflLabel);
        var reflInput = document.createElement("input");
        reflInput.type = "text";
        reflInput.className = "text-input";
        content.appendChild(reflInput);
        var saveReflBtn = document.createElement("button");
        saveReflBtn.className = "btn btn-outline btn-full";
        saveReflBtn.textContent = "Save reflection";
        saveReflBtn.addEventListener("click", function () {
          entry.reflection = reflInput.value.trim();
          saveCareerProgress(progress);
          openCareerLesson(catKey, lessonKey);
        });
        content.appendChild(saveReflBtn);
      } else {
        var reflShown = document.createElement("p");
        reflShown.className = "muted-line";
        reflShown.textContent = "Reflection: " + entry.reflection;
        content.appendChild(reflShown);
      }
      var restartBtn = document.createElement("button");
      restartBtn.className = "priority-change-link";
      restartBtn.textContent = "Do this challenge again";
      restartBtn.addEventListener("click", function () {
        progress[key] = { started: true, done: false };
        saveCareerProgress(progress);
        openCareerLesson(catKey, lessonKey);
      });
      content.appendChild(restartBtn);
    }
  }

  function initDuniyaCareer() {
    document.getElementById("duniya-career-back").addEventListener("click", function () { setActiveView("duniya"); });
  }

  // ---- Money Habits ----
  // Four different things are tracked separately and never mixed:
  //   A. money AVOIDED (something you didn't buy / a habit you reduced)
  //   B. money ACTUALLY SAVED (added to a goal, or kept as unallocated savings)
  //   C. money ADDED TO SAVINGS GOALS (the contributions ledger)
  //   D. money SPENT (logged expenses + avoided money the user says went elsewhere)
  // A goal only grows when the user confirms money went into it.

  var MONEY_HABIT_CATEGORIES = [
    "Smoking", "Tobacco", "Alcohol", "Recreational drugs", "Junk food",
    "Soft drinks", "Tea/Coffee", "Food delivery", "Gaming purchases",
    "Shopping", "Subscriptions", "Online impulse purchases",
    "Transport waste", "Betting/gambling expenses tracking only", "Other / Custom"
  ];
  var MONEY_GOAL_PRESETS = [
    "Emergency fund", "Phone", "Laptop", "Course", "Gym membership", "Travel", "Family", "Business"
  ];
  var MONEY_SOURCES = [
    { key: "income", label: "Salary / income" },
    { key: "avoided-purchase", label: "Avoided purchase" },
    { key: "smoking", label: "Smoking reduction" },
    { key: "habit", label: "Other bad habit reduction" },
    { key: "gift", label: "Gift" },
    { key: "cash", label: "Cash saved" },
    { key: "other", label: "Other" }
  ];
  function moneySourceLabel(key) {
    if (key === "unallocated") return "Moved from unallocated savings";
    if (key === "legacy") return "Earlier savings";
    if (key === "manual") return "Saved";
    var s = MONEY_SOURCES.filter(function (x) { return x.key === key; })[0];
    return s ? s.label : "Added manually";
  }

  var moneyView = { screen: "dashboard" };

  function goMoneyScreen(screen, extra) {
    var e = extra || {};
    e.screen = screen;
    moneyView = e;
    renderDuniyaMoney();
  }

  function fmtRupee(n) {
    n = Math.round(n || 0);
    return "₹" + n.toLocaleString("en-IN");
  }

  function mEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function mBtn(label, cls, fn) {
    var b = mEl("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function mRows(rows) {
    var box = mEl("div", "money-cost-breakdown");
    rows.forEach(function (r) {
      var row = mEl("div", "row" + (r[2] ? " highlight" : ""));
      row.appendChild(mEl("span", "", r[0]));
      row.appendChild(mEl("span", "", r[1]));
      box.appendChild(row);
    });
    return box;
  }
  function mNumInput(placeholder, value, onInput) {
    var i = mEl("input", "text-input");
    i.type = "number";
    i.min = "0";
    i.placeholder = placeholder;
    i.value = value || "";
    i.addEventListener("input", function () { onInput(i.value); });
    return i;
  }

  // -- data accessors (all local, all persisted) --
  function getMoneyGoals() { return readJSON("nc_money_goals", []); }
  function saveMoneyGoals(arr) { writeJSON("nc_money_goals", arr); }
  function getContribs() { return readJSON("nc_money_contribs", []); }
  function saveContribs(a) { writeJSON("nc_money_contribs", a); }
  function getUnalloc() { return readJSON("nc_money_unalloc", []); }
  function saveUnalloc(a) { writeJSON("nc_money_unalloc", a); }
  function getExpenses() { return readJSON("nc_money_expenses", []); }
  function saveExpenses(a) { writeJSON("nc_money_expenses", a); }
  function getMoneyHabits() { return readJSON("nc_money_habits", []); }
  function saveMoneyHabits(arr) { writeJSON("nc_money_habits", arr); }
  function getMoneyDailyLogs() { return readJSON("nc_money_daily_logs", {}); }
  function saveMoneyDailyLogs(obj) { writeJSON("nc_money_daily_logs", obj); }
  function getDailyLogEntry(habitId, dateKey) {
    var logs = getMoneyDailyLogs();
    return (logs[dateKey] && logs[dateKey][habitId]) || null;
  }
  function saveDailyLogEntry(habitId, dateKey, entry) {
    var logs = getMoneyDailyLogs();
    if (!logs[dateKey]) logs[dateKey] = {};
    logs[dateKey][habitId] = entry;
    saveMoneyDailyLogs(logs);
  }
  function getAvoidedPurchases() { return readJSON("nc_money_avoided_purchases", []); }
  function saveAvoidedPurchases(arr) { writeJSON("nc_money_avoided_purchases", arr); }
  function getPurchaseDecisions() { return readJSON("nc_money_purchase_decisions", []); }
  function savePurchaseDecisions(arr) { writeJSON("nc_money_purchase_decisions", arr); }

  function moneyHabitCosts(habit) {
    var daily = habit.normalDailyQuantity * habit.costPerUnit;
    return { daily: daily, weekly: daily * 7, monthly: daily * 30, yearly: daily * 365 };
  }

  // Older builds stored a running total on each goal and a "general savings"
  // destination. Convert once so nothing the user already logged is lost.
  function moneyMigrateV2() {
    if (localStorage.getItem("nc_money_v2")) return;
    var contribs = getContribs(), unalloc = getUnalloc();
    getMoneyGoals().forEach(function (g) {
      var has = contribs.some(function (c) { return c.goalId === g.id; });
      if (!has && g.currentSavedAmount > 0) {
        contribs.push({ id: uid("contrib"), goalId: g.id, amount: g.currentSavedAmount, source: "legacy", sourceLabel: "Earlier savings", note: "Earlier savings", date: (g.createdAt || new Date().toISOString()).slice(0, 10), at: g.createdAt || new Date().toISOString(), refId: null });
      }
    });
    var purchases = getAvoidedPurchases();
    purchases.forEach(function (p) {
      if (p.resolved !== undefined) return;
      p.resolved = !!p.destination;
      p.goalAmount = p.destination && p.destination !== "general" ? p.amount : 0;
      p.goalId = p.destination && p.destination !== "general" ? p.destination : null;
      p.unallocAmount = p.destination === "general" ? p.amount : 0;
      p.spentAmount = 0;
      if (p.destination === "general") unalloc.push({ id: uid("keep"), amount: p.amount, movedAmount: 0, note: "Avoided " + p.itemName, source: "avoided-purchase", date: p.date, at: p.createdAt || new Date().toISOString(), refId: p.id });
    });
    var decisions = getPurchaseDecisions();
    decisions.forEach(function (d) {
      if (d.status !== undefined) return;
      d.status = d.decision === "waiting" ? "waiting" : d.decision === "avoided" ? "avoided" : "bought";
      d.resolved = d.status === "avoided" ? !!d.destination : true;
      d.goalAmount = d.destination && d.destination !== "general" ? d.moneyAvoided : 0;
      d.goalId = d.destination && d.destination !== "general" ? d.destination : null;
      d.unallocAmount = d.destination === "general" ? d.moneyAvoided : 0;
      d.spentAmount = 0;
      if (d.status === "avoided" && d.destination === "general") unalloc.push({ id: uid("keep"), amount: d.moneyAvoided, movedAmount: 0, note: "Didn't buy " + d.itemName, source: "avoided-purchase", date: d.decidedAt ? d.decidedAt.slice(0, 10) : todayKey(), at: d.decidedAt || new Date().toISOString(), refId: d.id });
    });
    var logs = getMoneyDailyLogs();
    Object.keys(logs).forEach(function (dateKey) {
      Object.keys(logs[dateKey]).forEach(function (hid) {
        var e = logs[dateKey][hid];
        if (e.resolved !== undefined || !e.amountAvoided) return;
        e.resolved = !!e.destination;
        e.goalAmount = e.destination && e.destination !== "general" ? e.amountAvoided : 0;
        e.goalId = e.destination && e.destination !== "general" ? e.destination : null;
        e.unallocAmount = e.destination === "general" ? e.amountAvoided : 0;
        e.spentAmount = 0;
        if (e.destination === "general") unalloc.push({ id: uid("keep"), amount: e.amountAvoided, movedAmount: 0, note: "Habit reduction", source: "habit", date: dateKey, at: e.createdAt || new Date().toISOString(), refId: "log:" + hid + ":" + dateKey });
      });
    });
    saveContribs(contribs);
    saveUnalloc(unalloc);
    saveAvoidedPurchases(purchases);
    savePurchaseDecisions(decisions);
    saveMoneyDailyLogs(logs);
    localStorage.setItem("nc_money_v2", "1");
  }

  // A goal's saved amount is always the sum of its contributions.
  function syncGoals() {
    var goals = getMoneyGoals(), contribs = getContribs(), changed = false;
    goals.forEach(function (g) {
      var s = 0;
      contribs.forEach(function (c) { if (c.goalId === g.id) s += c.amount; });
      if (g.currentSavedAmount !== s) { g.currentSavedAmount = s; changed = true; }
      if (s >= g.targetAmount && !g.completedAt) { g.completedAt = new Date().toISOString(); g.celebrationSeen = false; changed = true; }
      else if (s < g.targetAmount && g.completedAt) { g.completedAt = null; g.celebrationSeen = false; changed = true; }
    });
    if (changed) saveMoneyGoals(goals);
    return goals;
  }
  function getGoal(id) { return getMoneyGoals().filter(function (g) { return g.id === id; })[0] || null; }
  function getActiveGoal() {
    var goals = getMoneyGoals();
    return goals.filter(function (g) { return !g.completedAt; })[0] || null;
  }
  function markGoalCelebrationSeen(goalId) {
    var goals = getMoneyGoals();
    goals.forEach(function (g) { if (g.id === goalId) g.celebrationSeen = true; });
    saveMoneyGoals(goals);
  }
  function createMoneyGoal(name, targetAmount) {
    var goals = getMoneyGoals();
    var goal = { id: uid("goal"), name: name, targetAmount: targetAmount, currentSavedAmount: 0, createdAt: new Date().toISOString(), completedAt: null, celebrationSeen: false };
    goals.push(goal);
    saveMoneyGoals(goals);
    memLog("goal_created", "money", { target: targetAmount });
    return goal;
  }
  function goalPct(g) { return g.targetAmount ? Math.min(100, Math.round((g.currentSavedAmount / g.targetAmount) * 1000) / 10) : 0; }

  // Money avoided under "I only avoided spending it" that hasn't been moved
  // into a goal. Never counted in the goal's saved amount or progress bar.
  function avoidedForGoal(goalId) {
    var t = 0;
    getAvoidedPurchases().forEach(function (p) {
      if (p.avoidedOnly && p.forGoalId === goalId) t += p.amount - (p.movedAmount || 0);
    });
    return t;
  }
  function goalNumberRows(g) {
    return [
      ["Actually Saved", fmtRupee(g.currentSavedAmount), true],
      ["Avoided Spending", fmtRupee(avoidedForGoal(g.id))],
      ["Remaining", fmtRupee(Math.max(0, g.targetAmount - g.currentSavedAmount))],
      ["Progress", goalPct(g) + "%"]
    ];
  }

  function addContribution(goalId, amount, sourceKey, note, refId) {
    var list = getContribs();
    var rec = { id: uid("contrib"), goalId: goalId, amount: amount, source: sourceKey, sourceLabel: moneySourceLabel(sourceKey), note: note || "", date: todayKey(), at: new Date().toISOString(), refId: refId || null };
    list.push(rec);
    saveContribs(list);
    syncGoals();
    memLog("money_saved_recorded", "money", { amount: amount, source: sourceKey });
    return rec.id;
  }

  // Turns "avoided, not saved" money into real savings. Only called when the
  // user taps a Move button. recId null = everything avoided for that goal.
  function moveAvoidedToGoal(goalId, recId) {
    var ps = getAvoidedPurchases(), total = 0;
    ps.forEach(function (p) {
      if (!p.avoidedOnly || p.forGoalId !== goalId) return;
      if (recId && p.id !== recId) return;
      var left = p.amount - (p.movedAmount || 0);
      if (left > 0) { total += left; p.movedAmount = p.amount; }
    });
    if (total <= 0) return null;
    saveAvoidedPurchases(ps);
    return addContribution(goalId, total, "avoided-purchase", "Avoided spending", null);
  }
  function unallocatedTotal() {
    var t = 0;
    getUnalloc().forEach(function (e) { t += e.amount - (e.movedAmount || 0); });
    return t;
  }

  // Removes whatever was previously allocated from one avoided-money event
  // (used when that event is re-decided or a check-in is edited).
  function moneyUnallocateRef(refId) {
    saveContribs(getContribs().filter(function (c) { return c.refId !== refId; }));
    saveUnalloc(getUnalloc().filter(function (e) { return e.refId !== refId; }));
    syncGoals();
  }

  // choice: "goal" | "spent" | "keep". requested = how much goes to the goal /
  // is kept; whatever is left of the avoided amount is recorded as spent elsewhere.
  function moneyAllocate(ctx, choice, goalId, requested) {
    moneyUnallocateRef(ctx.refId);
    var goalAmt = 0, keepAmt = 0;
    var req = Math.max(0, Math.min(ctx.amount, requested));
    if (choice === "goal") goalAmt = req;
    else if (choice === "keep") keepAmt = req;
    var spent = ctx.amount - goalAmt - keepAmt;
    if (goalAmt > 0) addContribution(goalId, goalAmt, ctx.sourceKey, ctx.label, ctx.refId);
    if (keepAmt > 0) {
      var u = getUnalloc();
      u.push({ id: uid("keep"), amount: keepAmt, movedAmount: 0, note: ctx.label, source: ctx.sourceKey, date: todayKey(), at: new Date().toISOString(), refId: ctx.refId });
      saveUnalloc(u);
    }
    var res = { goalAmount: goalAmt, goalId: goalAmt > 0 ? goalId : null, unallocAmount: keepAmt, spentAmount: spent, resolved: true };
    if (ctx.kind === "purchase") {
      var ps = getAvoidedPurchases();
      ps.forEach(function (p) { if (p.id === ctx.id) { for (var k in res) p[k] = res[k]; } });
      saveAvoidedPurchases(ps);
    } else if (ctx.kind === "decision") {
      var ds = getPurchaseDecisions();
      ds.forEach(function (d) { if (d.id === ctx.id) { for (var k in res) d[k] = res[k]; } });
      savePurchaseDecisions(ds);
    } else if (ctx.kind === "habit") {
      var e = getDailyLogEntry(ctx.habitId, ctx.dateKey);
      if (e) { for (var k in res) e[k] = res[k]; saveDailyLogEntry(ctx.habitId, ctx.dateKey, e); }
    }
    return res;
  }

  // Avoided money the user hasn't yet said what happened to.
  function pendingAvoided() {
    var out = [];
    getAvoidedPurchases().forEach(function (p) {
      if (!p.resolved && p.amount > 0) out.push({ label: "Avoided " + p.itemName, ctx: { kind: "purchase", id: p.id, refId: p.id, amount: p.amount, label: "Avoided " + p.itemName + " purchase", sourceKey: "avoided-purchase" } });
    });
    getPurchaseDecisions().forEach(function (d) {
      if (d.status === "avoided" && !d.resolved && d.moneyAvoided > 0) out.push({ label: "Didn't buy " + d.itemName, ctx: { kind: "decision", id: d.id, refId: d.id, amount: d.moneyAvoided, label: "Didn't buy " + d.itemName, sourceKey: "avoided-purchase" } });
    });
    var habits = getMoneyHabits();
    var logs = getMoneyDailyLogs();
    Object.keys(logs).forEach(function (dateKey) {
      Object.keys(logs[dateKey]).forEach(function (hid) {
        var e = logs[dateKey][hid];
        if (e.resolved || !e.amountAvoided) return;
        var h = habits.filter(function (x) { return x.id === hid; })[0];
        if (!h) return;
        out.push({ label: "Reduced " + (h.customName || h.category), ctx: moneyHabitCtx(h, dateKey, e.amountAvoided) });
      });
    });
    return out;
  }
  function moneyHabitCtx(habit, dateKey, amount) {
    var smoke = habit.category === "Smoking" || habit.category === "Tobacco";
    return { kind: "habit", habitId: habit.id, dateKey: dateKey, refId: "log:" + habit.id + ":" + dateKey, amount: amount, label: smoke ? "Smoking reduction" : (habit.customName || habit.category) + " reduction", sourceKey: smoke ? "smoking" : "habit" };
  }

  // The single place money totals are computed for a date range (either bound
  // may be null). Keeps avoided / saved / spent / added-to-goals apart.
  function moneyStats(from, to) {
    function inR(k) { return !(from && k < from) && !(to && k > to); }
    var r = { avoided: 0, saved: 0, toGoals: 0, expenses: 0, spentElsewhere: 0, kept: 0 };
    var logs = getMoneyDailyLogs();
    Object.keys(logs).forEach(function (dateKey) {
      if (!inR(dateKey)) return;
      Object.keys(logs[dateKey]).forEach(function (hid) {
        var e = logs[dateKey][hid];
        r.avoided += e.amountAvoided || 0;
        r.spentElsewhere += e.spentAmount || 0;
      });
    });
    getAvoidedPurchases().forEach(function (p) {
      if (!inR(p.date)) return;
      r.avoided += p.amount || 0;
      r.spentElsewhere += p.spentAmount || 0;
    });
    getPurchaseDecisions().forEach(function (d) {
      if (d.status !== "avoided") return;
      var dk = d.decidedAt ? todayKey(new Date(d.decidedAt)) : null;
      if (!dk || !inR(dk)) return;
      r.avoided += d.moneyAvoided || 0;
      r.spentElsewhere += d.spentAmount || 0;
    });
    getContribs().forEach(function (c) {
      if (!inR(c.date)) return;
      r.toGoals += c.amount;
      if (c.source !== "unallocated") r.saved += c.amount;
    });
    getUnalloc().forEach(function (e) {
      if (!inR(e.date)) return;
      r.saved += e.amount;
      r.kept += e.amount;
    });
    getExpenses().forEach(function (x) { if (inR(x.date)) r.expenses += x.amount; });
    r.spent = r.expenses + r.spentElsewhere;
    return r;
  }

  function buildMoneyBack(content, onBack) {
    var backBtn = document.createElement("button");
    backBtn.className = "picker-step-back";
    backBtn.textContent = "← Back";
    backBtn.addEventListener("click", onBack);
    content.appendChild(backBtn);
  }

  function buildMoneyStepper(value, onChange, min, max) {
    var wrap = document.createElement("div");
    wrap.className = "money-quantity-stepper";
    var minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.textContent = "−";
    minusBtn.addEventListener("click", function () { onChange(Math.max(min, value - 1)); });
    var valEl = document.createElement("span");
    valEl.className = "value";
    valEl.textContent = value;
    var plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.textContent = "+";
    plusBtn.addEventListener("click", function () { onChange(Math.min(max, value + 1)); });
    wrap.appendChild(minusBtn);
    wrap.appendChild(valEl);
    wrap.appendChild(plusBtn);
    return wrap;
  }

  function renderMoneyWeekGraph() {
    var wrap = document.createElement("div");
    var today = todayKey();
    var dayTotals = getLastNDateKeys(7).slice().reverse().map(function (dateKey) {
      return { dateKey: dateKey, amount: moneyStats(dateKey, dateKey).saved };
    });
    var anyData = dayTotals.some(function (d) { return d.amount > 0; });
    if (!anyData) {
      wrap.appendChild(mEl("p", "progress-graph-empty", "Money you actually save will show here."));
      return wrap;
    }
    var row = document.createElement("div");
    row.className = "progress-graph-row";
    var maxAmount = Math.max.apply(null, dayTotals.map(function (d) { return d.amount; }).concat([1]));
    dayTotals.forEach(function (d) {
      var barWrap = document.createElement("div");
      barWrap.className = "progress-graph-bar-wrap";
      var bar = document.createElement("div");
      bar.className = "progress-graph-bar" + (d.amount > 0 ? " has-data" : "") + (d.dateKey === today ? " is-today" : "");
      bar.style.height = Math.max(4, (d.amount / maxAmount) * 70) + "px";
      var label = document.createElement("span");
      label.className = "progress-graph-label";
      label.textContent = new Date(d.dateKey + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3);
      barWrap.appendChild(bar);
      barWrap.appendChild(label);
      row.appendChild(barWrap);
    });
    wrap.appendChild(row);
    return wrap;
  }

  // -- Dashboard --

  function renderMoneyHabitCard(habit) {
    var card = mEl("div", "money-habit-card");
    card.appendChild(mEl("p", "name", (habit.customName || habit.category) + (habit.privacyEnabled ? " 🔒" : "")));
    var costs = moneyHabitCosts(habit);
    card.appendChild(mEl("p", "cost-line", fmtRupee(costs.daily) + "/day if unchanged · usual " + habit.normalDailyQuantity + "/day"));
    var todayEntry = getDailyLogEntry(habit.id, todayKey());
    var statusLine = mEl("p", "cost-line");
    if (todayEntry) {
      statusLine.textContent = todayEntry.amountAvoided > 0 ? "Today: avoided " + fmtRupee(todayEntry.amountAvoided) : "Today: no reduction recorded";
      statusLine.style.color = todayEntry.amountAvoided > 0 ? "var(--mint)" : "var(--muted)";
    } else statusLine.textContent = "Not checked in today";
    card.appendChild(statusLine);
    var row = mEl("div", "money-quick-actions");
    row.appendChild(mBtn(todayEntry ? "Update Check-in" : "Check In", "action-btn primary", function () {
      var existing = getDailyLogEntry(habit.id, todayKey());
      goMoneyScreen("habit-checkin", {
        habitId: habit.id,
        reduceBy: existing && existing.targetQuantity !== null && existing.targetQuantity !== undefined ? (existing.normalQuantity - existing.targetQuantity) : null,
        actualQuantity: existing ? existing.actualQuantity : null,
        phase: "input"
      });
    }));
    row.appendChild(mBtn("Edit", "action-btn", function () {
      goMoneyScreen("habit-setup", { step: 1, editHabitId: habit.id, data: { category: habit.category, customName: habit.customName, privacyEnabled: habit.privacyEnabled, normalDailyQuantity: habit.normalDailyQuantity, costPerUnit: habit.costPerUnit } });
    }));
    card.appendChild(row);
    return card;
  }

  function renderMoneyGoalCard(g) {
    var card = mEl("div", "money-habit-card");
    card.appendChild(mEl("p", "name", g.name + " Goal — " + fmtRupee(g.targetAmount) + (g.completedAt ? " ✓" : "")));
    var track = mEl("div", "plan-progress-track");
    var fill = mEl("div", "plan-progress-fill");
    fill.style.width = goalPct(g) + "%";
    track.appendChild(fill);
    card.appendChild(track);
    card.appendChild(mRows(goalNumberRows(g)));
    var row = mEl("div", "money-quick-actions");
    row.appendChild(mBtn("+ Add Saving", "action-btn primary", function () { goMoneyScreen("add-money", { goalId: g.id }); }));
    row.appendChild(mBtn("Open", "action-btn", function () { goMoneyScreen("goal", { goalId: g.id }); }));
    card.appendChild(row);
    return card;
  }

  function renderMoneyDashboard(content) {
    // things waiting on the user
    pendingAvoided().forEach(function (p) {
      var b = mEl("div", "money-wait-banner");
      var q = mEl("p", "", fmtRupee(p.ctx.amount) + " avoided (" + p.label + ") — what happened to this money?");
      q.style.margin = "0 0 8px";
      b.appendChild(q);
      b.appendChild(mBtn("Decide", "action-btn primary", function () { goMoneyScreen("allocate", { ctx: p.ctx, choice: null }); }));
      content.appendChild(b);
    });
    getPurchaseDecisions().filter(function (d) { return d.status === "later" || d.status === "waiting"; }).forEach(function (d) {
      var b = mEl("div", "money-wait-banner");
      var ready = d.status === "later" || (d.decideAfter && Date.now() >= d.decideAfter);
      var hrs = d.decideAfter ? Math.max(1, Math.ceil((d.decideAfter - Date.now()) / 3600000)) : 0;
      var q = mEl("p", "", (ready ? "Decide: " : "Waiting: ") + d.itemName + " (" + fmtRupee(d.amount) + ")" + (ready ? "" : " — ready in about " + hrs + "h"));
      q.style.margin = "0 0 8px";
      b.appendChild(q);
      b.appendChild(mBtn(ready ? "Review" : "Review anyway", "action-btn primary", function () { goMoneyScreen("should-i-buy", { phase: "check", decisionId: d.id }); }));
      content.appendChild(b);
    });

    // Savings goals
    content.appendChild(mEl("h2", "", "Savings Goals"));
    var goals = getMoneyGoals();
    if (!goals.length) {
      content.appendChild(mEl("p", "muted-line", "You haven't set a savings goal yet."));
    } else {
      goals.forEach(function (g) { content.appendChild(renderMoneyGoalCard(g)); });
    }
    content.appendChild(mBtn(goals.length ? "+ New goal" : "Create a Savings Goal", goals.length ? "btn btn-outline btn-full" : "btn btn-primary btn-full", function () { goMoneyScreen("new-goal"); }));

    var pool = unallocatedTotal();
    if (pool > 0) {
      var ub = mEl("div", "money-avoided-total");
      ub.style.marginTop = "12px";
      ub.appendChild(document.createTextNode("Unallocated savings: "));
      var us = mEl("strong", "", fmtRupee(pool));
      ub.appendChild(us);
      if (goals.length) {
        var mv = mBtn("Move to a goal", "priority-change-link", function () { goMoneyScreen("move-unalloc", {}); });
        ub.appendChild(document.createElement("br"));
        ub.appendChild(mv);
      }
      content.appendChild(ub);
    }

    // Actually saved vs avoided — kept apart
    var today = todayKey();
    var weekStart = getLastNDateKeys(7).slice(-1)[0];
    var monthStart = getLastNDateKeys(30).slice(-1)[0];
    var h = mEl("h2", "", "Actually saved");
    h.style.marginTop = "18px";
    content.appendChild(h);
    var grid = mEl("div", "money-stat-grid");
    [["Today", moneyStats(today, null).saved], ["This Week", moneyStats(weekStart, null).saved], ["This Month", moneyStats(monthStart, null).saved]].forEach(function (pair) {
      var tile = mEl("div", "money-stat-tile");
      tile.appendChild(mEl("span", "big", fmtRupee(pair[1])));
      tile.appendChild(mEl("span", "lbl", pair[0]));
      grid.appendChild(tile);
    });
    content.appendChild(grid);
    var all = moneyStats(null, null);
    var av = mEl("p", "money-avoided-total");
    av.appendChild(document.createTextNode("Avoided spending, all time: "));
    av.appendChild(mEl("strong", "", fmtRupee(all.avoided)));
    av.appendChild(document.createElement("br"));
    av.appendChild(mEl("span", "muted-line", "Avoided is not the same as saved. Only money you add to a goal or keep counts as saved."));
    content.appendChild(av);

    // habits
    var hh = mEl("h2", "", "My Money Habits");
    hh.style.marginTop = "18px";
    content.appendChild(hh);
    var habits = getMoneyHabits().filter(function (x) { return !x.archived; });
    if (!habits.length) content.appendChild(mEl("p", "muted-line", "Track a spending habit to see its real cost and reduce it."));
    else habits.forEach(function (habit) { content.appendChild(renderMoneyHabitCard(habit)); });
    content.appendChild(mBtn("+ Track a money habit", "btn btn-outline btn-full", function () {
      goMoneyScreen("habit-setup", { step: 1, data: { category: null, customName: "", privacyEnabled: false, normalDailyQuantity: null, costPerUnit: null } });
    }));

    // weekly
    var wh = mEl("h2", "", "Weekly Progress");
    wh.style.marginTop = "18px";
    content.appendChild(wh);
    content.appendChild(renderMoneyWeekGraph());
    content.appendChild(mBtn("View full weekly report", "priority-change-link", function () { goMoneyScreen("weekly-report"); }));

    // quick actions
    var qh = mEl("h2", "", "Quick Actions");
    qh.style.marginTop = "18px";
    content.appendChild(qh);
    var q = mEl("div", "money-quick-actions");
    q.appendChild(mBtn("+ I avoided a purchase", "preset-plan-chip", function () { goMoneyScreen("avoided-purchase", { itemName: "", amount: "" }); }));
    q.appendChild(mBtn("Should I buy this?", "preset-plan-chip", function () { goMoneyScreen("should-i-buy", { phase: "entry" }); }));
    q.appendChild(mBtn("+ Add Saving", "preset-plan-chip", function () {
      if (!getMoneyGoals().length) { showToast("Create a savings goal first"); goMoneyScreen("new-goal", { returnTo: { screen: "add-money" } }); return; }
      goMoneyScreen("add-money", {});
    }));
    q.appendChild(mBtn("Log an expense", "preset-plan-chip", function () { goMoneyScreen("expense", {}); }));
    content.appendChild(q);
  }

  // -- New goal --

  function renderMoneyNewGoal(content) {
    var back = moneyView.returnTo;
    buildMoneyBack(content, function () { goMoneyScreen("dashboard"); });
    content.appendChild(mEl("h2", "", "What are you saving for?"));
    var chipsWrap = mEl("div", "money-quick-actions");
    var chosenName = moneyView.goalName || "";
    MONEY_GOAL_PRESETS.forEach(function (preset) {
      chipsWrap.appendChild(mBtn(preset, "preset-plan-chip" + (chosenName === preset ? " active-chip" : ""), function () { moneyView.goalName = preset; renderDuniyaMoney(); }));
    });
    content.appendChild(chipsWrap);
    var cl = mEl("p", "muted-line", "Or name your own goal");
    cl.style.marginTop = "12px";
    content.appendChild(cl);
    var nameInput = mEl("input", "text-input");
    nameInput.type = "text";
    nameInput.placeholder = "e.g. New phone";
    nameInput.value = MONEY_GOAL_PRESETS.indexOf(chosenName) === -1 ? chosenName : "";
    nameInput.addEventListener("input", function () { moneyView.goalName = nameInput.value; });
    content.appendChild(nameInput);
    var al = mEl("p", "muted-line", "Target amount");
    al.style.marginTop = "12px";
    content.appendChild(al);
    content.appendChild(mNumInput("₹50000", moneyView.goalAmount, function (v) { moneyView.goalAmount = v; }));
    var save = mBtn("Save Goal", "btn btn-primary btn-full", function () {
      var name = (moneyView.goalName || "").trim();
      var amount = parseFloat(moneyView.goalAmount);
      if (!name) { showToast("Give your goal a name"); return; }
      if (!amount || amount <= 0) { showToast("Enter a target amount"); return; }
      var g = createMoneyGoal(name, amount);
      showToast("Savings goal created");
      if (back) goMoneyScreen(back.screen, back.extra || { goalId: g.id });
      else goMoneyScreen("goal", { goalId: g.id });
    });
    save.style.marginTop = "14px";
    content.appendChild(save);
  }

  // -- Goal screen --

  function renderMoneyGoal(content) {
    var g = getGoal(moneyView.goalId);
    if (!g) { goMoneyScreen("dashboard"); return; }
    buildMoneyBack(content, function () { goMoneyScreen("dashboard"); });
    content.appendChild(mEl("h2", "", g.name));
    var amt = mEl("p", "money-goal-amount", fmtRupee(g.currentSavedAmount) + " saved");
    content.appendChild(amt);
    var track = mEl("div", "plan-progress-track");
    var fill = mEl("div", "plan-progress-fill");
    fill.style.width = goalPct(g) + "%";
    track.appendChild(fill);
    content.appendChild(track);
    var goalRows = goalNumberRows(g);
    goalRows.splice(0, 0, ["Target", fmtRupee(g.targetAmount)]);
    content.appendChild(mRows(goalRows));
    if (g.completedAt) content.appendChild(mEl("p", "rec-note", "🎉 You reached this goal."));
    var add = mBtn("+ Add Saving", "btn btn-primary btn-full", function () { goMoneyScreen("add-money", { goalId: g.id, fromGoal: true }); });
    content.appendChild(add);
    var avoidedLeft = avoidedForGoal(g.id);
    if (avoidedLeft > 0) {
      content.appendChild(mBtn("Move " + fmtRupee(avoidedLeft) + " avoided spending to this goal", "btn btn-outline btn-full", function () {
        var cid = moveAvoidedToGoal(g.id, null);
        goMoneyScreen("saved-done", { goalId: g.id, amount: avoidedLeft, contribId: cid });
      }));
    }
    if (unallocatedTotal() > 0) {
      content.appendChild(mBtn("Move unallocated savings here (" + fmtRupee(unallocatedTotal()) + ")", "btn btn-outline btn-full", function () { goMoneyScreen("move-unalloc", { goalId: g.id }); }));
    }
    var rh = mEl("h2", "", "Recent activity");
    rh.style.marginTop = "16px";
    content.appendChild(rh);
    var recent = getContribs().filter(function (c) { return c.goalId === g.id; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 10);
    if (!recent.length) content.appendChild(mEl("p", "muted-line", "Nothing added yet. This only grows when you confirm money went in."));
    recent.forEach(function (c) {
      var d = new Date(c.date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
      var line = mEl("p", "muted-line", "+ " + fmtRupee(c.amount) + " — " + (c.note || c.sourceLabel) + (c.keptIn ? " · " + c.keptIn : "") + " · " + d);
      line.style.marginBottom = "4px";
      content.appendChild(line);
    });
  }

  // -- Add money manually --

  function renderMoneyAddMoney(content) {
    var goals = getMoneyGoals();
    if (!goals.length) { goMoneyScreen("new-goal", { returnTo: { screen: "add-money" } }); return; }
    if (!moneyView.goalId) moneyView.goalId = goals[0].id;
    if (!moneyView.goalId) {
      var last = localStorage.getItem("nc_money_last_goal");
      moneyView.goalId = goals.some(function (g) { return g.id === last; }) ? last : goals[0].id;
    }
    buildMoneyBack(content, function () { goMoneyScreen(moneyView.fromGoal ? "goal" : "dashboard", { goalId: moneyView.goalId }); });
    content.appendChild(mEl("h2", "", "How much did you save?"));
    var input = mNumInput("₹800", moneyView.amount, function (v) { moneyView.amount = v; updateQ(); });
    content.appendChild(input);
    if (goals.length > 1) {
      var chips = mEl("div", "money-quick-actions");
      goals.forEach(function (g) {
        chips.appendChild(mBtn(g.name, "preset-plan-chip" + (moneyView.goalId === g.id ? " active-chip" : ""), function () { moneyView.goalId = g.id; renderDuniyaMoney(); }));
      });
      content.appendChild(chips);
    }
    var q = mEl("p", "");
    q.style.fontWeight = "600";
    q.style.margin = "14px 0 8px";
    function updateQ() {
      var a = parseFloat(moneyView.amount);
      q.textContent = "Did you actually keep/move this " + (a > 0 ? fmtRupee(a) : "money") + " for your goal?";
    }
    updateQ();
    content.appendChild(q);
    function amountOrToast() {
      var a = parseFloat(moneyView.amount);
      if (!a || a <= 0) { showToast("Enter how much"); return 0; }
      return a;
    }
    content.appendChild(mBtn("Yes, I saved it", "btn btn-primary btn-full", function () {
      var a = amountOrToast();
      if (!a) return;
      localStorage.setItem("nc_money_last_goal", moneyView.goalId);
      var cid = addContribution(moneyView.goalId, a, "manual", "", null);
      goMoneyScreen("saved-done", { goalId: moneyView.goalId, amount: a, contribId: cid });
    }));
    content.appendChild(mBtn("I only avoided spending it", "btn btn-outline btn-full", function () {
      var a = amountOrToast();
      if (!a) return;
      localStorage.setItem("nc_money_last_goal", moneyView.goalId);
      var rec = { id: uid("avoid"), itemName: "Avoided spending", amount: a, date: todayKey(), at: new Date().toISOString(), resolved: true, avoidedOnly: true, forGoalId: moneyView.goalId, movedAmount: 0, goalAmount: 0, goalId: null, unallocAmount: 0, spentAmount: 0 };
      var list = getAvoidedPurchases();
      list.push(rec);
      saveAvoidedPurchases(list);
      goMoneyScreen("avoided-done", { goalId: moneyView.goalId, amount: a, recId: rec.id });
    }));
    setTimeout(function () { if (document.body.contains(input) && !moneyView.amount) input.focus(); }, 60);
  }

  // Result of "Yes, I saved it": small, nothing here blocks the user.
  function renderMoneySavedDone(content) {
    var g = getGoal(moneyView.goalId);
    if (!g) { goMoneyScreen("dashboard"); return; }
    content.appendChild(mEl("h2", "", fmtRupee(moneyView.amount) + " added to your " + g.name + " goal."));
    content.appendChild(mRows([
      [g.name + " Goal", fmtRupee(g.currentSavedAmount) + " / " + fmtRupee(g.targetAmount), true],
      ["Progress", goalPct(g) + "%"]
    ]));
    var kl = mEl("p", "muted-line", "Where did you keep it? (optional)");
    kl.style.marginTop = "6px";
    content.appendChild(kl);
    var row = mEl("div", "money-quick-actions");
    ["Bank", "UPI", "Cash", "Other"].forEach(function (place) {
      row.appendChild(mBtn(place, "preset-plan-chip" + (moneyView.kept === place ? " active-chip" : ""), function () {
        moneyView.kept = place;
        var list = getContribs();
        list.forEach(function (c) { if (c.id === moneyView.contribId) c.keptIn = place; });
        saveContribs(list);
        renderDuniyaMoney();
      }));
    });
    row.appendChild(mBtn("Skip", "preset-plan-chip", function () { goMoneyScreen("dashboard"); }));
    content.appendChild(row);
    content.appendChild(mBtn(moneyView.showPay ? "Hide payment apps" : "Move Money Now", "btn btn-outline btn-full", function () { moneyView.showPay = !moneyView.showPay; renderDuniyaMoney(); }));
    if (moneyView.showPay) renderPayApps(content);
    var done = mBtn("Done", "btn btn-primary btn-full", function () { goMoneyScreen("dashboard"); });
    done.style.marginTop = "6px";
    content.appendChild(done);
  }

  // Result of "I only avoided spending it": recorded apart from real savings.
  function renderMoneyAvoidedDone(content) {
    var g = getGoal(moneyView.goalId);
    content.appendChild(mEl("h2", "", "Avoided Spending: +" + fmtRupee(moneyView.amount)));
    content.appendChild(mEl("p", "muted-line", "Recorded separately. It isn't added to your savings or your goal progress."));
    var mv = mBtn("Move " + fmtRupee(moneyView.amount) + " to my goal", "btn btn-primary btn-full", function () {
      var cid = moveAvoidedToGoal(moneyView.goalId, moneyView.recId);
      goMoneyScreen("saved-done", { goalId: moneyView.goalId, amount: moneyView.amount, contribId: cid });
    });
    mv.style.marginTop = "12px";
    if (g) content.appendChild(mv);
    content.appendChild(mBtn("Done", "btn btn-outline btn-full", function () { goMoneyScreen("dashboard"); }));
  }

  // Opens an installed payment/banking app. NURA never handles credentials.
  var PAY_APPS = [
    { pkg: "com.google.android.apps.nbu.paisa.user", label: "Google Pay" },
    { pkg: "com.phonepe.app", label: "PhonePe" },
    { pkg: "net.one97.paytm", label: "Paytm" },
    { pkg: "in.org.npci.upiapp", label: "BHIM" }
  ];
  function renderPayApps(content) {
    var box = mEl("div", "money-cost-breakdown");
    var native = window.NuraNative;
    var row = mEl("div", "money-quick-actions");
    row.style.margin = "0";
    if (native && native.listPaymentApps) {
      var apps = [];
      try { apps = JSON.parse(native.listPaymentApps()); } catch (e) { apps = []; }
      if (!apps.length) box.appendChild(mEl("p", "muted-line", "No payment app found on this phone. Open your banking app yourself."));
      apps.forEach(function (a) {
        row.appendChild(mBtn(a.label, "action-btn primary", function () { native.launchApp(a.pkg); }));
      });
    } else if (/Android/i.test(navigator.userAgent)) {
      PAY_APPS.forEach(function (a) {
        var link = mEl("a", "action-btn primary", a.label);
        link.href = "intent://#Intent;package=" + a.pkg + ";end";
        link.style.textDecoration = "none";
        row.appendChild(link);
      });
      box.appendChild(mEl("p", "muted-line", "Opens the app if it's installed."));
    } else {
      box.appendChild(mEl("p", "muted-line", "Open your banking or payment app on your phone to move the money."));
    }
    box.appendChild(row);
    var note = mEl("p", "muted-line", "NURA never asks for or stores PINs, passwords, OTPs or card details.");
    note.style.marginTop = "8px";
    box.appendChild(note);
    content.appendChild(box);
  }

  // -- Log an expense --

  function renderMoneyExpense(content) {
    buildMoneyBack(content, function () { goMoneyScreen("dashboard"); });
    content.appendChild(mEl("h2", "", "Log an expense"));
    content.appendChild(mNumInput("₹ amount", moneyView.amount, function (v) { moneyView.amount = v; }));
    var l = mEl("input", "text-input");
    l.type = "text";
    l.placeholder = "What was it for? (optional)";
    l.value = moneyView.label || "";
    l.addEventListener("input", function () { moneyView.label = l.value; });
    content.appendChild(l);
    var save = mBtn("Save expense", "btn btn-primary btn-full", function () {
      var amount = parseFloat(moneyView.amount);
      if (!amount || amount <= 0) { showToast("Enter an amount"); return; }
      var list = getExpenses();
      list.push({ id: uid("exp"), amount: amount, label: (moneyView.label || "").trim().slice(0, 60), date: todayKey(), at: new Date().toISOString(), refId: null });
      saveExpenses(list);
      showToast(fmtRupee(amount) + " logged");
      goMoneyScreen("expense", {});
    });
    save.style.marginTop = "6px";
    content.appendChild(save);
    var recent = getExpenses().slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 5);
    if (recent.length) {
      var rh = mEl("h2", "", "Recent expenses");
      rh.style.marginTop = "18px";
      content.appendChild(rh);
      recent.forEach(function (x) {
        var line = mEl("p", "muted-line", fmtRupee(x.amount) + (x.label ? " — " + x.label : "") + " · " + new Date(x.date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }));
        line.style.marginBottom = "4px";
        content.appendChild(line);
      });
    }
  }

  // -- "What happened to this money?" (used by every avoided-money flow) --

  function renderMoneyAllocate(content) {
    var ctx = moneyView.ctx;
    if (!ctx) { goMoneyScreen("dashboard"); return; }
    var goals = getMoneyGoals();
    buildMoneyBack(content, function () { goMoneyScreen("dashboard"); });
    content.appendChild(mEl("h2", "", "You avoided spending " + fmtRupee(ctx.amount) + "."));
    if (ctx.note) content.appendChild(mEl("p", "muted-line", ctx.note));
    content.appendChild(mEl("p", "muted-line", "This isn't counted as saved yet."));
    var q = mEl("p", "", "What happened to this " + fmtRupee(ctx.amount) + "?");
    q.style.fontWeight = "600";
    q.style.margin = "12px 0 8px";
    content.appendChild(q);

    function opt(key, label) {
      var b = mBtn(label, "rec-action" + (moneyView.choice === key ? " done" : ""), function () { moneyView.choice = key; renderDuniyaMoney(); });
      content.appendChild(b);
    }
    opt("goal", "Add " + fmtRupee(ctx.amount) + " to my savings goal");
    opt("spent", "I spent this money somewhere else");
    opt("keep", "I kept the money, but don't want to add it to a goal yet");

    var choice = moneyView.choice;
    if (choice === "goal") {
      if (!goals.length) {
        content.appendChild(mEl("p", "muted-line", "You need a savings goal first."));
        content.appendChild(mBtn("Create a savings goal", "btn btn-outline btn-full", function () { goMoneyScreen("new-goal", { returnTo: { screen: "allocate", extra: { ctx: ctx, choice: "goal" } } }); }));
        return;
      }
      if (!moneyView.goalId) moneyView.goalId = goals[0].id;
      content.appendChild(mEl("p", "muted-line", "Which savings goal?"));
      goals.forEach(function (g) {
        content.appendChild(mBtn((moneyView.goalId === g.id ? "● " : "○ ") + g.name + " — " + fmtRupee(g.currentSavedAmount) + " / " + fmtRupee(g.targetAmount), "rec-action" + (moneyView.goalId === g.id ? " done" : ""), function () { moneyView.goalId = g.id; renderDuniyaMoney(); }));
      });
    }
    if (choice === "goal" || choice === "keep") {
      var lbl = mEl("p", "muted-line", "How much of it? (the rest is recorded as spent elsewhere)");
      lbl.style.marginTop = "8px";
      content.appendChild(lbl);
      if (moneyView.amountStr === undefined) moneyView.amountStr = String(ctx.amount);
      content.appendChild(mNumInput(fmtRupee(ctx.amount), moneyView.amountStr, function (v) { moneyView.amountStr = v; }));
    }
    if (choice) {
      var confirm = mBtn(choice === "goal" ? "Add to goal" : choice === "keep" ? "Keep as unallocated savings" : "Record", "btn btn-primary btn-full", function () {
        var amt = choice === "spent" ? 0 : parseFloat(moneyView.amountStr);
        if (choice !== "spent" && (!amt || amt <= 0)) { showToast("Enter an amount"); return; }
        if (choice !== "spent" && amt > ctx.amount) { showToast("That's more than " + fmtRupee(ctx.amount)); return; }
        var res = moneyAllocate(ctx, choice, moneyView.goalId, amt);
        goMoneyScreen("alloc-done", { kind: choice, ctx: ctx, res: res, goalId: res.goalId });
      });
      confirm.style.marginTop = "12px";
      content.appendChild(confirm);
    }
  }

  function renderMoneyAllocDone(content) {
    var v = moneyView;
    var g = v.goalId ? getGoal(v.goalId) : null;
    if (v.kind === "goal" && !v.ctx) {
      content.appendChild(mEl("h2", "", fmtRupee(v.amount) + " added to your " + (g ? g.name : "savings") + " goal."));
    } else if (v.kind === "goal") {
      content.appendChild(mEl("h2", "", fmtRupee(v.res.goalAmount) + " added to your " + (g ? g.name : "savings") + " goal."));
      if (v.res.spentAmount > 0) content.appendChild(mEl("p", "muted-line", "The other " + fmtRupee(v.res.spentAmount) + " is recorded as spent elsewhere."));
    } else if (v.kind === "keep") {
      content.appendChild(mEl("h2", "", fmtRupee(v.res.unallocAmount) + " kept as unallocated savings."));
      content.appendChild(mEl("p", "muted-line", "You can move it into a goal any time." + (v.res.spentAmount > 0 ? " The other " + fmtRupee(v.res.spentAmount) + " is recorded as spent elsewhere." : "")));
    } else if (v.kind === "moved") {
      content.appendChild(mEl("h2", "", fmtRupee(v.amount) + " moved to your " + (g ? g.name : "savings") + " goal."));
    } else {
      content.appendChild(mEl("h2", "", "Recorded."));
      content.appendChild(mEl("p", "muted-line", "Avoided purchase: " + fmtRupee(v.ctx.amount) + ". Saved toward a goal: ₹0."));
    }
    if (g) {
      content.appendChild(mRows([
        [g.name, fmtRupee(g.currentSavedAmount) + " / " + fmtRupee(g.targetAmount), true],
        ["Remaining", fmtRupee(Math.max(0, g.targetAmount - g.currentSavedAmount))]
      ]));
    }
    var done = mBtn("Done", "btn btn-primary btn-full", function () { goMoneyScreen("dashboard"); });
    done.style.marginTop = "12px";
    content.appendChild(done);
    if (g) content.appendChild(mBtn("View " + g.name + " goal", "btn btn-outline btn-full", function () { goMoneyScreen("goal", { goalId: g.id }); }));
  }

  // -- Move unallocated savings into a goal --

  function renderMoneyMoveUnalloc(content) {
    var goals = getMoneyGoals();
    var pool = unallocatedTotal();
    if (!goals.length || pool <= 0) { goMoneyScreen("dashboard"); return; }
    if (!moneyView.goalId) moneyView.goalId = goals[0].id;
    buildMoneyBack(content, function () { goMoneyScreen("dashboard"); });
    content.appendChild(mEl("h2", "", "Move unallocated savings"));
    content.appendChild(mEl("p", "muted-line", "Available: " + fmtRupee(pool)));
    goals.forEach(function (g) {
      content.appendChild(mBtn((moneyView.goalId === g.id ? "● " : "○ ") + g.name + " — " + fmtRupee(g.currentSavedAmount) + " / " + fmtRupee(g.targetAmount), "rec-action" + (moneyView.goalId === g.id ? " done" : ""), function () { moneyView.goalId = g.id; renderDuniyaMoney(); }));
    });
    if (moneyView.amountStr === undefined) moneyView.amountStr = String(pool);
    content.appendChild(mNumInput("How much?", moneyView.amountStr, function (v) { moneyView.amountStr = v; }));
    var go = mBtn("Move to goal", "btn btn-primary btn-full", function () {
      var amt = parseFloat(moneyView.amountStr);
      if (!amt || amt <= 0) { showToast("Enter an amount"); return; }
      if (amt > pool) { showToast("You only have " + fmtRupee(pool) + " unallocated"); return; }
      var left = amt;
      var list = getUnalloc();
      list.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
      list.forEach(function (e) {
        var avail = e.amount - (e.movedAmount || 0);
        if (left <= 0 || avail <= 0) return;
        var take = Math.min(avail, left);
        e.movedAmount = (e.movedAmount || 0) + take;
        left -= take;
      });
      saveUnalloc(list);
      addContribution(moneyView.goalId, amt, "unallocated", "Moved from unallocated savings", null);
      goMoneyScreen("alloc-done", { kind: "moved", amount: amt, goalId: moneyView.goalId });
    });
    go.style.marginTop = "12px";
    content.appendChild(go);
  }

  // -- Habit setup (4-step) --

  function renderMoneyHabitSetup(content) {
    var step = moneyView.step || 1;
    var d = moneyView.data;

    buildMoneyBack(content, function () {
      if (step > 1) { moneyView.step = step - 1; renderDuniyaMoney(); }
      else goMoneyScreen("dashboard");
    });
    var stepLine = document.createElement("p");
    stepLine.className = "muted-line";
    stepLine.textContent = "Step " + step + " of 4";
    content.appendChild(stepLine);

    if (step === 1) {
      var h2 = document.createElement("h2");
      h2.textContent = "What habit do you want to reduce?";
      content.appendChild(h2);
      var chipsWrap = document.createElement("div");
      chipsWrap.className = "money-quick-actions";
      MONEY_HABIT_CATEGORIES.forEach(function (cat) {
        var chip = document.createElement("button");
        chip.className = "preset-plan-chip" + (d.category === cat ? " active-chip" : "");
        chip.textContent = cat;
        chip.addEventListener("click", function () { d.category = cat; renderDuniyaMoney(); });
        chipsWrap.appendChild(chip);
      });
      content.appendChild(chipsWrap);

      var nameLabel = document.createElement("p");
      nameLabel.className = "muted-line";
      nameLabel.style.marginTop = "12px";
      nameLabel.textContent = "Give it a private name (optional)";
      content.appendChild(nameLabel);
      var nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "text-input";
      nameInput.placeholder = "e.g. Habit A";
      nameInput.value = d.customName || "";
      nameInput.addEventListener("input", function () { d.customName = nameInput.value; });
      content.appendChild(nameInput);

      var privacyRow = document.createElement("label");
      privacyRow.className = "money-checkbox-row";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!d.privacyEnabled;
      cb.addEventListener("change", function () { d.privacyEnabled = cb.checked; });
      privacyRow.appendChild(cb);
      var cbLabel = document.createElement("span");
      cbLabel.textContent = "Keep this private (show only the name above)";
      privacyRow.appendChild(cbLabel);
      content.appendChild(privacyRow);

      var nextBtn = document.createElement("button");
      nextBtn.className = "btn btn-primary btn-full";
      nextBtn.style.marginTop = "14px";
      nextBtn.textContent = "Next";
      nextBtn.addEventListener("click", function () {
        if (!d.category) { showToast("Choose a category"); return; }
        if (d.category === "Other / Custom" && !(d.customName || "").trim()) { showToast("Give this habit a name"); return; }
        moneyView.step = 2; renderDuniyaMoney();
      });
      content.appendChild(nextBtn);
    } else if (step === 2) {
      var h2b = document.createElement("h2");
      h2b.textContent = "How many times/items per day?";
      content.appendChild(h2b);
      content.appendChild(buildMoneyStepper(d.normalDailyQuantity || 1, function (v) { d.normalDailyQuantity = v; renderDuniyaMoney(); }, 1, 100));
      var nextBtn2 = document.createElement("button");
      nextBtn2.className = "btn btn-primary btn-full";
      nextBtn2.style.marginTop = "14px";
      nextBtn2.textContent = "Next";
      nextBtn2.addEventListener("click", function () {
        if (!d.normalDailyQuantity) d.normalDailyQuantity = 1;
        moneyView.step = 3; renderDuniyaMoney();
      });
      content.appendChild(nextBtn2);
    } else if (step === 3) {
      var h2c = document.createElement("h2");
      h2c.textContent = "Average cost each time?";
      content.appendChild(h2c);
      var costInput = document.createElement("input");
      costInput.type = "number";
      costInput.min = "0";
      costInput.className = "text-input";
      costInput.placeholder = "₹20";
      costInput.value = d.costPerUnit || "";
      var previewHolder = document.createElement("div");
      function renderMoneyCostPreview() {
        previewHolder.innerHTML = "";
        if (!d.normalDailyQuantity || !d.costPerUnit) return;
        var costs = moneyHabitCosts({ normalDailyQuantity: d.normalDailyQuantity, costPerUnit: d.costPerUnit });
        var box = document.createElement("div");
        box.className = "money-cost-breakdown";
        box.innerHTML =
          '<div class="row highlight"><span>' + d.normalDailyQuantity + ' × ₹' + d.costPerUnit + '</span><span>' + fmtRupee(costs.daily) + '/day</span></div>' +
          '<div class="row"><span>Per week</span><span>≈ ' + fmtRupee(costs.weekly) + '</span></div>' +
          '<div class="row"><span>Per 30 days</span><span>≈ ' + fmtRupee(costs.monthly) + '</span></div>' +
          '<div class="row"><span>Per year</span><span>≈ ' + fmtRupee(costs.yearly) + '</span></div>';
        previewHolder.appendChild(box);
      }
      costInput.addEventListener("input", function () { d.costPerUnit = parseFloat(costInput.value) || 0; renderMoneyCostPreview(); });
      content.appendChild(costInput);
      content.appendChild(previewHolder);
      renderMoneyCostPreview();

      var nextBtn3 = document.createElement("button");
      nextBtn3.className = "btn btn-primary btn-full";
      nextBtn3.style.marginTop = "14px";
      nextBtn3.textContent = "Next";
      nextBtn3.addEventListener("click", function () {
        if (!d.costPerUnit || d.costPerUnit <= 0) { showToast("Enter a cost"); return; }
        moneyView.step = 4; renderDuniyaMoney();
      });
      content.appendChild(nextBtn3);
    } else if (step === 4) {
      var h2d = document.createElement("h2");
      h2d.textContent = "What would you rather do with some of this money?";
      content.appendChild(h2d);
      var goal = getActiveGoal();
      if (goal && !goal.completedAt) {
        var goalP = document.createElement("p");
        goalP.className = "muted-line";
        goalP.textContent = "Money you save from this habit can go toward:";
        content.appendChild(goalP);
        var goalName = document.createElement("p");
        goalName.className = "money-goal-name";
        goalName.textContent = goal.name + " (" + fmtRupee(goal.currentSavedAmount) + " / " + fmtRupee(goal.targetAmount) + ")";
        content.appendChild(goalName);
      } else {
        var noGoalP2 = document.createElement("p");
        noGoalP2.className = "muted-line";
        noGoalP2.textContent = "You don't have a saving goal yet — you can still track this habit, and create a goal any time from the dashboard.";
        content.appendChild(noGoalP2);
      }
      var saveHabitBtn = document.createElement("button");
      saveHabitBtn.className = "btn btn-primary btn-full";
      saveHabitBtn.style.marginTop = "14px";
      saveHabitBtn.textContent = moneyView.editHabitId ? "Save Changes" : "Start Tracking";
      saveHabitBtn.addEventListener("click", function () {
        var habits = getMoneyHabits();
        if (moneyView.editHabitId) {
          var existing = habits.find(function (h) { return h.id === moneyView.editHabitId; });
          if (existing) {
            existing.category = d.category;
            existing.customName = (d.customName || "").trim();
            existing.privacyEnabled = !!d.privacyEnabled;
            existing.normalDailyQuantity = d.normalDailyQuantity;
            existing.costPerUnit = d.costPerUnit;
          }
        } else {
          habits.push({
            id: uid("habit"), category: d.category, customName: (d.customName || "").trim(),
            privacyEnabled: !!d.privacyEnabled, normalDailyQuantity: d.normalDailyQuantity,
            costPerUnit: d.costPerUnit, targetDailyQuantity: null, createdAt: new Date().toISOString(), archived: false
          });
        }
        saveMoneyHabits(habits);
        showToast(moneyView.editHabitId ? "Habit updated" : "Now tracking this habit");
        goMoneyScreen("dashboard");
      });
      content.appendChild(saveHabitBtn);
    }
  }

  // -- Daily check-in --

  function renderMoneyHabitCheckin(content) {
    var habit = getMoneyHabits().find(function (h) { return h.id === moneyView.habitId; });
    if (!habit) { goMoneyScreen("dashboard"); return; }
    buildMoneyBack(content, function () { goMoneyScreen("dashboard"); });
    content.appendChild(mEl("h2", "", (habit.customName || habit.category) + " — Check In"));

    if (moneyView.phase === "none") {
      var b = mEl("div", "money-result-banner neutral");
      b.appendChild(mEl("p", "", "No reduction recorded today. You can try again tomorrow."));
      content.appendChild(b);
      content.appendChild(mBtn("Done", "btn btn-primary btn-full", function () { goMoneyScreen("dashboard"); }));
      return;
    }

    content.appendChild(mEl("p", "muted-line", "Usual amount: " + habit.normalDailyQuantity + "/day"));
    var tl = mEl("p", "muted-line", "Today I want to reduce by (optional)");
    tl.style.marginTop = "12px";
    content.appendChild(tl);
    var chips = mEl("div", "money-quick-actions");
    [1, 2, 3].forEach(function (n) {
      chips.appendChild(mBtn("-" + n, "preset-plan-chip" + (moneyView.reduceBy === n ? " active-chip" : ""), function () {
        moneyView.reduceBy = n;
        moneyView.actualQuantity = Math.max(0, habit.normalDailyQuantity - n);
        renderDuniyaMoney();
      }));
    });
    chips.appendChild(mBtn("No target", "preset-plan-chip" + (!moneyView.reduceBy ? " active-chip" : ""), function () { moneyView.reduceBy = null; renderDuniyaMoney(); }));
    content.appendChild(chips);
    var ql = mEl("p", "muted-line", "How many did you use/buy today?");
    ql.style.marginTop = "14px";
    content.appendChild(ql);
    var actualQ = (moneyView.actualQuantity !== null && moneyView.actualQuantity !== undefined) ? moneyView.actualQuantity : habit.normalDailyQuantity;
    content.appendChild(buildMoneyStepper(actualQ, function (v) { moneyView.actualQuantity = v; renderDuniyaMoney(); }, 0, 200));

    var save = mBtn("Save Check-in", "btn btn-primary btn-full", function () {
      var normal = habit.normalDailyQuantity;
      var avoided = Math.max(0, (normal - actualQ) * habit.costPerUnit);
      var targetBeaten = moneyView.reduceBy ? (normal - actualQ) > moneyView.reduceBy : false;
      var dateKey = todayKey();
      var ctx = moneyHabitCtx(habit, dateKey, avoided);
      moneyUnallocateRef(ctx.refId);
      saveDailyLogEntry(habit.id, dateKey, {
        habitId: habit.id, date: dateKey, normalQuantity: normal, actualQuantity: actualQ,
        targetQuantity: moneyView.reduceBy ? Math.max(0, normal - moneyView.reduceBy) : null,
        amountAvoided: avoided, resolved: avoided === 0, goalAmount: 0, goalId: null, unallocAmount: 0, spentAmount: 0,
        createdAt: new Date().toISOString()
      });
      if (avoided > 0) {
        ctx.note = targetBeaten ? "Target beaten 🎯" : null;
        goMoneyScreen("allocate", { ctx: ctx, choice: null });
      } else {
        moneyView.phase = "none";
        renderDuniyaMoney();
      }
    });
    save.style.marginTop = "14px";
    content.appendChild(save);
  }

  // -- "I avoided a purchase" --

  function renderMoneyAvoidedPurchase(content) {
    buildMoneyBack(content, function () { goMoneyScreen("dashboard"); });
    content.appendChild(mEl("h2", "", "What did you avoid buying?"));
    var name = mEl("input", "text-input");
    name.type = "text";
    name.placeholder = "e.g. Shoes";
    name.value = moneyView.itemName || "";
    name.addEventListener("input", function () { moneyView.itemName = name.value; });
    content.appendChild(name);
    var al = mEl("p", "muted-line", "How much would it have cost?");
    al.style.marginTop = "12px";
    content.appendChild(al);
    content.appendChild(mNumInput("₹800", moneyView.amount, function (v) { moneyView.amount = v; }));
    var go = mBtn("Continue", "btn btn-primary btn-full", function () {
      var item = (moneyView.itemName || "").trim();
      var amount = parseFloat(moneyView.amount);
      if (!item) { showToast("What did you avoid buying?"); return; }
      if (!amount || amount <= 0) { showToast("Enter an amount"); return; }
      var rec = { id: uid("avoid"), itemName: item, amount: amount, date: todayKey(), at: new Date().toISOString(), resolved: false, goalAmount: 0, goalId: null, unallocAmount: 0, spentAmount: 0 };
      var list = getAvoidedPurchases();
      list.push(rec);
      saveAvoidedPurchases(list);
      goMoneyScreen("allocate", { ctx: { kind: "purchase", id: rec.id, refId: rec.id, amount: amount, label: "Avoided " + item + " purchase", sourceKey: "avoided-purchase" }, choice: null });
    });
    go.style.marginTop = "14px";
    content.appendChild(go);
  }

  // -- "Should I buy this?" --

  function saveDecision(status, extra) {
    var list = getPurchaseDecisions();
    var rec = moneyView.decisionId ? list.filter(function (d) { return d.id === moneyView.decisionId; })[0] : null;
    if (!rec) {
      rec = { id: uid("decision"), itemName: moneyView.itemNameFinal, amount: moneyView.priceNum, needOrWant: moneyView.needOrWant, createdAt: new Date().toISOString(), moneyAvoided: 0, resolved: true, goalAmount: 0, goalId: null, unallocAmount: 0, spentAmount: 0 };
      list.push(rec);
    }
    rec.needOrWant = moneyView.needOrWant;
    rec.checks = moneyView.checks || {};
    rec.status = status;
    rec.decideAfter = null;
    for (var k in (extra || {})) rec[k] = extra[k];
    savePurchaseDecisions(list);
    return rec;
  }

  function renderMoneyShouldIBuy(content) {
    if (moneyView.decisionId && !moneyView.itemNameFinal) {
      var loaded = getPurchaseDecisions().filter(function (d) { return d.id === moneyView.decisionId; })[0];
      if (!loaded) { goMoneyScreen("dashboard"); return; }
      moneyView.itemNameFinal = loaded.itemName;
      moneyView.priceNum = loaded.amount;
      moneyView.needOrWant = loaded.needOrWant;
      moneyView.checks = loaded.checks || {};
    }
    buildMoneyBack(content, function () { goMoneyScreen("dashboard"); });

    if (moneyView.phase === "done") {
      content.appendChild(mEl("h2", "", "Saved"));
      content.appendChild(mEl("p", "muted-line", moneyView.doneMessage || "Noted."));
      var d1 = mBtn("Back to Money Habits", "btn btn-primary btn-full", function () { goMoneyScreen("dashboard"); });
      d1.style.marginTop = "12px";
      content.appendChild(d1);
      return;
    }

    if (moneyView.phase === "bought") {
      content.appendChild(mEl("h2", "", "You bought " + moneyView.itemNameFinal + "."));
      content.appendChild(mEl("p", "muted-line", "Want to record the " + fmtRupee(moneyView.priceNum) + " as an expense so your weekly report stays accurate?"));
      var ex = mBtn("Log " + fmtRupee(moneyView.priceNum) + " as an expense", "btn btn-primary btn-full", function () {
        var list = getExpenses();
        list.push({ id: uid("exp"), amount: moneyView.priceNum, label: moneyView.itemNameFinal, date: todayKey(), at: new Date().toISOString(), refId: "decision:" + moneyView.boughtId });
        saveExpenses(list);
        showToast("Expense logged");
        goMoneyScreen("dashboard");
      });
      ex.style.marginTop = "12px";
      content.appendChild(ex);
      content.appendChild(mBtn("Not now", "btn btn-outline btn-full", function () { goMoneyScreen("dashboard"); }));
      return;
    }

    if (moneyView.phase === "check") {
      var isNeed = moneyView.needOrWant === "Need";
      content.appendChild(mEl("h2", "", moneyView.itemNameFinal + " — " + fmtRupee(moneyView.priceNum)));
      content.appendChild(mEl("p", "muted-line", moneyView.needOrWant + ". A quick check before you decide:"));
      moneyView.checks = moneyView.checks || {};
      function question(key, text, info) {
        var qp = mEl("p", "", text);
        qp.style.fontWeight = "600";
        qp.style.margin = "14px 0 4px";
        content.appendChild(qp);
        if (info) content.appendChild(mEl("p", "muted-line", info));
        var row = mEl("div", "money-quick-actions");
        ["Yes", "No", "Not sure"].forEach(function (a) {
          row.appendChild(mBtn(a, "preset-plan-chip" + (moneyView.checks[key] === a ? " active-chip" : ""), function () { moneyView.checks[key] = a; renderDuniyaMoney(); }));
        });
        content.appendChild(row);
      }
      question("afford", "Can you afford it without touching essential money?", null);
      var goals = getMoneyGoals().filter(function (g) { return !g.completedAt; });
      var info = goals.length ? goals.map(function (g) {
        var left = Math.max(0, g.targetAmount - g.currentSavedAmount);
        return g.name + ": " + fmtRupee(left) + " still to save. This costs " + (left ? Math.round((moneyView.priceNum / left) * 100) + "% of that." : "more than what's left.");
      }).join(" ") : "You have no savings goals yet.";
      question("delay", "Does buying it delay one of your savings goals?", info);
      question("stillWant", "Do you still want it after thinking about it?", null);

      var buy = mBtn("Buy it", "btn btn-primary btn-full", function () {
        var rec = saveDecision("bought", { decidedAt: new Date().toISOString(), moneyAvoided: 0, resolved: true });
        goMoneyScreen("should-i-buy", { phase: "bought", itemNameFinal: rec.itemName, priceNum: rec.amount, boughtId: rec.id });
      });
      buy.style.marginTop = "16px";
      content.appendChild(buy);
      content.appendChild(mBtn("Don't buy it", "btn btn-outline btn-full", function () {
        var rec = saveDecision("avoided", { decidedAt: new Date().toISOString(), moneyAvoided: moneyView.priceNum, resolved: false });
        goMoneyScreen("allocate", { ctx: { kind: "decision", id: rec.id, refId: rec.id, amount: rec.amount, label: "Didn't buy " + rec.itemName, sourceKey: "avoided-purchase" }, choice: null });
      }));
      content.appendChild(mBtn("Decide later", "btn btn-outline btn-full", function () {
        saveDecision("later", {});
        goMoneyScreen("should-i-buy", { phase: "done", doneMessage: "It's saved under Money Habits. Come back to it when you're ready." });
      }));
      if (!isNeed) {
        content.appendChild(mBtn("Wait 24 hours before deciding", "priority-change-link", function () {
          saveDecision("waiting", { decideAfter: Date.now() + 24 * 3600000 });
          goMoneyScreen("should-i-buy", { phase: "done", doneMessage: "We'll show it on your Money Habits home once 24 hours have passed." });
        }));
      }
      return;
    }

    // entry
    content.appendChild(mEl("h2", "", "What do you want to buy?"));
    var item = mEl("input", "text-input");
    item.type = "text";
    item.placeholder = "e.g. Wireless earbuds";
    item.value = moneyView.itemName || "";
    item.addEventListener("input", function () { moneyView.itemName = item.value; });
    content.appendChild(item);
    var pl = mEl("p", "muted-line", "Price?");
    pl.style.marginTop = "10px";
    content.appendChild(pl);
    content.appendChild(mNumInput("₹1999", moneyView.price, function (v) { moneyView.price = v; }));
    var nl = mEl("p", "muted-line", "Is it a Need or a Want?");
    nl.style.marginTop = "10px";
    content.appendChild(nl);
    var row = mEl("div", "money-quick-actions");
    ["Need", "Want", "Not Sure"].forEach(function (label) {
      row.appendChild(mBtn(label, "preset-plan-chip" + (moneyView.needOrWant === label ? " active-chip" : ""), function () { moneyView.needOrWant = label; renderDuniyaMoney(); }));
    });
    content.appendChild(row);
    var next = mBtn("Continue", "btn btn-primary btn-full", function () {
      var name = (moneyView.itemName || "").trim();
      var price = parseFloat(moneyView.price);
      if (!name) { showToast("Enter what you want to buy"); return; }
      if (!price || price <= 0) { showToast("Enter the price"); return; }
      if (!moneyView.needOrWant) { showToast("Is it a Need or a Want?"); return; }
      goMoneyScreen("should-i-buy", { phase: "check", itemNameFinal: name, priceNum: price, needOrWant: moneyView.needOrWant, checks: {} });
    });
    next.style.marginTop = "14px";
    content.appendChild(next);
  }

  // -- Weekly report --

  function renderMoneyWeeklyReport(content) {
    buildMoneyBack(content, function () { goMoneyScreen("dashboard"); });
    content.appendChild(mEl("h2", "", "This Week"));
    var last7 = getLastNDateKeys(7);
    var weekStart = last7[last7.length - 1];
    var prev7 = getLastNDateKeys(14).slice(7);
    var s = moneyStats(weekStart, null);
    content.appendChild(mRows([
      ["Money avoided", fmtRupee(s.avoided)],
      ["Money actually saved", fmtRupee(s.saved), true],
      ["Money spent", fmtRupee(s.spent)],
      ["Added to savings goals", fmtRupee(s.toGoals)]
    ]));
    content.appendChild(mEl("p", "muted-line", "Avoided isn't saved. Saved = added to a goal + kept unallocated. Spent = logged expenses + avoided money you spent elsewhere."));

    var goals = getMoneyGoals();
    if (goals.length) {
      var gh = mEl("h2", "", "Savings goals");
      gh.style.marginTop = "16px";
      content.appendChild(gh);
      goals.forEach(function (g) {
        content.appendChild(mEl("p", "", g.name + ": " + fmtRupee(g.currentSavedAmount) + " / " + fmtRupee(g.targetAmount) + " · " + goalPct(g) + "%"));
      });
    }
    var pool = unallocatedTotal();
    if (pool > 0) content.appendChild(mEl("p", "muted-line", "Unallocated savings: " + fmtRupee(pool)));

    var habits = getMoneyHabits().filter(function (h) { return !h.archived; });
    if (habits.length) {
      var logs = getMoneyDailyLogs();
      var thisSpend = 0, lastSpend = 0;
      habits.forEach(function (habit) {
        last7.forEach(function (k) { var e = logs[k] && logs[k][habit.id]; if (e) thisSpend += e.actualQuantity * habit.costPerUnit; });
        prev7.forEach(function (k) { var e = logs[k] && logs[k][habit.id]; if (e) lastSpend += e.actualQuantity * habit.costPerUnit; });
      });
      var hh = mEl("p", "muted-line", "Habit spending");
      hh.style.marginTop = "14px";
      content.appendChild(hh);
      var less = thisSpend <= lastSpend;
      var diff = less ? lastSpend - thisSpend : thisSpend - lastSpend;
      content.appendChild(mRows([
        ["Last week", fmtRupee(lastSpend)],
        ["This week", fmtRupee(thisSpend)],
        ["Difference", fmtRupee(diff) + (less ? " less spent" : " more spent"), true]
      ]));
      if (less && diff > 0) content.appendChild(mEl("p", "muted-line", "If this continued for 4 weeks: ≈ " + fmtRupee(diff * 4) + " (estimate, not guaranteed)."));
    }
    var gh2 = mEl("p", "muted-line", "Actually saved each day");
    gh2.style.marginTop = "14px";
    content.appendChild(gh2);
    content.appendChild(renderMoneyWeekGraph());
  }

  // -- Goal completed --

  function renderMoneyGoalCompleted(content) {
    var goal = getGoal(moneyView.goalId);
    if (!goal) { goMoneyScreen("dashboard"); return; }
    var box = mEl("div", "");
    box.style.textAlign = "center";
    box.appendChild(mEl("h2", "", "🎉 " + fmtRupee(goal.targetAmount) + " SAVINGS GOAL COMPLETED"));
    box.appendChild(mEl("p", "muted-line", "You reached your target for “" + goal.name + "”."));
    content.appendChild(box);
    var days = Math.max(1, Math.round((new Date(goal.completedAt) - new Date(goal.createdAt)) / 86400000));
    var fromAvoided = 0, fromHabits = 0, other = 0;
    getContribs().forEach(function (c) {
      if (c.goalId !== goal.id) return;
      if (c.source === "avoided-purchase") fromAvoided += c.amount;
      else if (c.source === "smoking" || c.source === "habit") fromHabits += c.amount;
      else other += c.amount;
    });
    var stats = mRows([
      ["Total saved", fmtRupee(goal.currentSavedAmount), true],
      ["Days taken", String(days)],
      ["From avoided purchases", fmtRupee(fromAvoided)],
      ["From reduced habits", fmtRupee(fromHabits)],
      ["Added other ways", fmtRupee(other)]
    ]);
    stats.style.marginTop = "16px";
    content.appendChild(stats);
    var nb = mBtn("Create New Goal", "btn btn-primary btn-full", function () { markGoalCelebrationSeen(goal.id); goMoneyScreen("new-goal"); });
    nb.style.marginTop = "16px";
    content.appendChild(nb);
    content.appendChild(mBtn("Continue Saving", "btn btn-outline btn-full", function () { markGoalCelebrationSeen(goal.id); goMoneyScreen("dashboard"); }));
  }

  // -- Router --

  function renderDuniyaMoney() {
    var content = document.getElementById("duniya-money-content");
    moneyMigrateV2();
    syncGoals();
    if (!moneyView) moneyView = { screen: "dashboard" };
    if (moneyView.screen === "dashboard") {
      var done = getMoneyGoals().filter(function (g) { return g.completedAt && !g.celebrationSeen; })[0];
      if (done) moneyView = { screen: "goal-completed", goalId: done.id };
    }
    content.innerHTML = "";
    var s = moneyView.screen;
    if (s === "new-goal") renderMoneyNewGoal(content);
    else if (s === "goal") renderMoneyGoal(content);
    else if (s === "add-money") renderMoneyAddMoney(content);
    else if (s === "saved-done") renderMoneySavedDone(content);
    else if (s === "avoided-done") renderMoneyAvoidedDone(content);
    else if (s === "expense") renderMoneyExpense(content);
    else if (s === "allocate") renderMoneyAllocate(content);
    else if (s === "alloc-done") renderMoneyAllocDone(content);
    else if (s === "move-unalloc") renderMoneyMoveUnalloc(content);
    else if (s === "habit-setup") renderMoneyHabitSetup(content);
    else if (s === "habit-checkin") renderMoneyHabitCheckin(content);
    else if (s === "avoided-purchase") renderMoneyAvoidedPurchase(content);
    else if (s === "should-i-buy") renderMoneyShouldIBuy(content);
    else if (s === "weekly-report") renderMoneyWeeklyReport(content);
    else if (s === "goal-completed") renderMoneyGoalCompleted(content);
    else renderMoneyDashboard(content);
  }

  function initDuniyaMoney() {
    document.getElementById("duniya-money-back").addEventListener("click", function () {
      moneyView = { screen: "dashboard" };
      setActiveView("duniya");
    });
  }

  // ---- Phone Control → Intentional Open (Android app only) ----
  // The website cannot see other apps. Everything real here is done by the
  // native NURA Android app through window.NuraNative; without it this screen
  // says so plainly instead of pretending. All numbers shown come from data the
  // phone stored locally — nothing is estimated or invented.

  var pgView = { screen: "main" };
  var pgAppsCache = null;
  var pgAppFilter = "";

  function pgNative() { return window.NuraNative || null; }
  function pgParse(fn, fallback) {
    try { return JSON.parse(fn()); } catch (e) { return fallback; }
  }
  function pgStatus() { var n = pgNative(); return n ? pgParse(function () { return n.getStatus(); }, null) : null; }
  function pgConfig() {
    var n = pgNative();
    var c = n ? pgParse(function () { return n.getConfig(); }, null) : null;
    if (!c) c = { enabled: false, repeatCount: 3, repeatWindowMin: 15, graceMin: 10, pauseFreshOpen: true, apps: {} };
    if (!c.apps) c.apps = {};
    return c;
  }
  function pgSave(cfg) { var n = pgNative(); return n ? !!n.setConfig(JSON.stringify(cfg)) : false; }
  function pgStats() { var n = pgNative(); return n ? pgParse(function () { return n.getAllStats(); }, {}) : {}; }

  function pgFmtDur(ms) {
    var m = Math.round(ms / 60000);
    if (ms > 0 && m < 1) return "<1m";
    var h = Math.floor(m / 60);
    return h > 0 ? h + "h " + (m % 60) + "m" : m + "m";
  }

  function pgEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function pgBtn(label, cls, fn) {
    var b = pgEl("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function pgStepper(value, min, max, step, fmt, onChange) {
    var wrap = pgEl("div", "money-quantity-stepper");
    var minus = pgBtn("−", "", function () { onChange(Math.max(min, value - step)); });
    var val = pgEl("span", "value", fmt(value));
    val.style.minWidth = "90px";
    var plus = pgBtn("+", "", function () { onChange(Math.min(max, value + step)); });
    wrap.appendChild(minus); wrap.appendChild(val); wrap.appendChild(plus);
    return wrap;
  }
  function pgBack(content, fn) { content.appendChild(pgBtn("← Back", "picker-step-back", fn)); }

  function pgSummarize(stats, keys) {
    var out = { ms: 0, opens: 0, pauses: 0, wentBack: 0, continued: 0, appOpens: {}, hasData: false };
    keys.forEach(function (k) {
      var d = stats[k];
      if (!d) return;
      out.hasData = true;
      out.pauses += d.pauses || 0;
      out.wentBack += d.wentBack || 0;
      out.continued += d.continued || 0;
      var apps = d.apps || {};
      Object.keys(apps).forEach(function (pkg) {
        out.ms += apps[pkg].ms || 0;
        out.opens += apps[pkg].opens || 0;
        out.appOpens[pkg] = (out.appOpens[pkg] || 0) + (apps[pkg].opens || 0);
      });
    });
    return out;
  }

  function renderPhoneGuard() {
    var content = document.getElementById("duniya-phone-guard-content");
    if (!content) return;
    content.innerHTML = "";
    if (pgView.screen === "perms") return renderPgPerms(content);
    if (pgView.screen === "apps") return renderPgApps(content);
    if (pgView.screen === "appedit") return renderPgAppEdit(content);
    if (pgView.screen === "rules") return renderPgRules(content);
    renderPgMain(content);
  }

  function renderPgMain(content) {
    content.appendChild(pgEl("p", "muted-line", "Pause before distracting apps pull you in."));

    if (!pgNative()) {
      var box = pgEl("div", "money-wait-banner");
      box.style.marginTop = "14px";
      box.appendChild(pgEl("p", "", "Intentional Open needs the NURA Android app."));
      box.lastChild.style.margin = "0 0 6px";
      box.appendChild(pgEl("p", "muted-line", "A web page can't see which apps you open, so nothing here can work in a browser. The manual pause steps under Phone Control still work everywhere."));
      content.appendChild(box);
      return;
    }

    var st = pgStatus() || {};
    var cfg = pgConfig();
    var pkgs = Object.keys(cfg.apps);

    // ---- problems, never silent ----
    function problem(msg, btnLabel, fn) {
      var b = pgEl("div", "plan-conflict-banner", msg);
      b.style.marginTop = "12px";
      if (btnLabel) {
        var row = pgEl("div", "");
        row.style.marginTop = "8px";
        row.appendChild(pgBtn(btnLabel, "action-btn primary", fn));
        b.appendChild(row);
      }
      content.appendChild(b);
    }
    if (cfg.enabled) {
      if (!st.usageAccess) problem("Usage Access was turned off, so NURA can't see your selected apps. Monitoring is stopped.", "Open Usage Access settings", function () { pgNative().openUsageAccessSettings(); });
      else if (!st.overlay) problem("“Display over other apps” is off, so the pause screen can't appear.", "Open the setting", function () { pgNative().openOverlaySettings(); });
      else if (!st.serviceRunning) problem("Monitoring isn't running right now. Android may have stopped it.", "Restart monitoring", function () { pgNative().restartMonitor(); setTimeout(renderPhoneGuard, 1500); });
      (st.missing || []).forEach(function (pkg) {
        var label = cfg.apps[pkg] ? cfg.apps[pkg].label : pkg;
        problem(label + " is no longer installed.", "Remove from list", function () { delete cfg.apps[pkg]; pgSave(cfg); renderPhoneGuard(); });
      });
      if (st.usageAccess && st.overlay && !st.batteryUnrestricted) {
        var hint = pgEl("div", "money-wait-banner");
        hint.style.marginTop = "12px";
        hint.appendChild(pgEl("p", "", "Battery saving may stop monitoring on some phones."));
        hint.lastChild.style.margin = "0 0 8px";
        hint.appendChild(pgBtn("Open battery settings", "action-btn", function () { pgNative().openBatterySettings(); }));
        content.appendChild(hint);
      }
      if (!st.notifications && pkgs.some(function (p) { return cfg.apps[p].dailyTargetMin > 0 || cfg.apps[p].sessionMin > 0; })) {
        problem("Notifications are off, so you won't get reminders when a limit you set is reached.", "Allow notifications", function () { pgNative().requestNotifications(); });
      }
    }

    // ---- on / off ----
    var head = pgEl("div", "");
    head.style.margin = "16px 0";
    head.appendChild(pgEl("h2", "", cfg.enabled ? "Intentional Open is ON" : "Intentional Open is OFF"));
    if (!cfg.enabled) {
      head.appendChild(pgEl("p", "muted-line", "NURA can detect when selected apps are opened so it can give you a short pause before you continue."));
    } else {
      head.appendChild(pgEl("p", "muted-line", "Only the " + pkgs.length + " app" + (pkgs.length === 1 ? "" : "s") + " you selected are watched. Turning this off stops everything."));
    }
    var toggle = pgBtn(cfg.enabled ? "Turn off" : "Turn on", cfg.enabled ? "btn btn-outline btn-full" : "btn btn-primary btn-full", function () {
      if (cfg.enabled) { cfg.enabled = false; pgSave(cfg); renderPhoneGuard(); return; }
      var s = pgStatus() || {};
      if (!s.usageAccess || !s.overlay || !pkgs.length) { pgView = { screen: "perms" }; renderPhoneGuard(); return; }
      cfg.enabled = true;
      if (!pgSave(cfg)) showToast("Couldn't start monitoring");
      setTimeout(renderPhoneGuard, 800);
    });
    toggle.style.marginTop = "10px";
    head.appendChild(toggle);
    content.appendChild(head);

    // ---- today ----
    var stats = pgStats();
    var today = pgSummarize(stats, [todayKey()]);
    content.appendChild(pgEl("h2", "", "Today"));
    var mostPkg = null;
    Object.keys(today.appOpens).forEach(function (p) { if (today.appOpens[p] > 0 && (!mostPkg || today.appOpens[p] > today.appOpens[mostPkg])) mostPkg = p; });
    var mostLabel = mostPkg ? ((cfg.apps[mostPkg] && cfg.apps[mostPkg].label) || mostPkg) + " (" + today.appOpens[mostPkg] + ")" : "—";
    function tiles(rows) {
      var g = pgEl("div", "money-stat-grid");
      rows.forEach(function (r) {
        var t = pgEl("div", "money-stat-tile");
        t.appendChild(pgEl("span", "big", r[1]));
        t.appendChild(pgEl("span", "lbl", r[0]));
        g.appendChild(t);
      });
      content.appendChild(g);
    }
    tiles([["Social media time", pgFmtDur(today.ms)], ["Intentional pauses", String(today.pauses)], ["Went back", String(today.wentBack)]]);
    tiles([["Chose Continue", String(today.continued)], ["Openings", String(today.opens)], ["Most opened", mostLabel]]);

    // ---- apps ----
    content.appendChild(pgEl("h2", "", "Apps NURA watches"));
    if (!pkgs.length) content.appendChild(pgEl("p", "muted-line", "No apps chosen yet."));
    pkgs.forEach(function (pkg) {
      var a = cfg.apps[pkg];
      var card = pgEl("div", "money-habit-card");
      card.appendChild(pgEl("p", "name", a.label));
      var bits = [];
      bits.push(a.dailyTargetMin > 0 ? "Daily target " + a.dailyTargetMin + " min" : "No daily target");
      if (a.openLimit > 0) bits.push("max " + a.openLimit + " opens");
      if (a.sessionMin > 0) bits.push(a.sessionMin + " min sessions");
      card.appendChild(pgEl("p", "cost-line", bits.join(" · ")));
      var row = pgEl("div", "money-quick-actions");
      row.appendChild(pgBtn("Limits", "action-btn", function () { pgView = { screen: "appedit", pkg: pkg }; renderPhoneGuard(); }));
      row.appendChild(pgBtn("Remove", "action-btn", function () { delete cfg.apps[pkg]; pgSave(cfg); renderPhoneGuard(); }));
      card.appendChild(row);
      content.appendChild(card);
    });
    content.appendChild(pgBtn(pkgs.length ? "Change apps" : "Choose apps to watch", "btn btn-outline btn-full", function () { pgView = { screen: "apps" }; renderPhoneGuard(); }));

    // ---- rules ----
    content.appendChild(pgEl("h2", "", "Pause rules")).style.marginTop = "18px";
    content.appendChild(pgEl("p", "muted-line", (cfg.pauseFreshOpen ? "Pause on a fresh open. " : "Pause only on repeated opens. ") + "Pause again if an app is opened " + cfg.repeatCount + " times in " + cfg.repeatWindowMin + " min. After you continue, it won't ask again for " + cfg.graceMin + " min."));
    var rulesBtn = pgBtn("Adjust rules", "priority-change-link", function () { pgView = { screen: "rules" }; renderPhoneGuard(); });
    content.appendChild(rulesBtn);

    // ---- this week vs last ----
    content.appendChild(pgEl("h2", "", "This week")).style.marginTop = "18px";
    var wk = pgSummarize(stats, getLastNDateKeys(7));
    var prev = pgSummarize(stats, getLastNDateKeys(14).slice(7));
    if (!wk.hasData && !prev.hasData) {
      content.appendChild(pgEl("p", "muted-line", "No data yet. It appears here after Intentional Open has been on for a day."));
    } else {
      var box2 = pgEl("div", "money-cost-breakdown");
      function line(label, value, hl) {
        var r = pgEl("div", "row" + (hl ? " highlight" : ""));
        r.appendChild(pgEl("span", "", label));
        r.appendChild(pgEl("span", "", value));
        box2.appendChild(r);
      }
      line("Last week", prev.hasData ? pgFmtDur(prev.ms) : "no data");
      line("This week", pgFmtDur(wk.ms));
      if (prev.hasData) {
        var diff = wk.ms - prev.ms;
        line("Change", diff === 0 ? "No change" : (diff < 0 ? "↓ " : "↑ ") + pgFmtDur(Math.abs(diff)), true);
      }
      line("Average per day", pgFmtDur(wk.ms / 7));
      line("Openings", String(wk.opens));
      line("Intentional pauses", String(wk.pauses));
      line("Went back", String(wk.wentBack));
      content.appendChild(box2);
    }

    var done = pgEl("p", "muted-line", "You're done for now. Put the phone away.");
    done.style.marginTop = "22px";
    done.style.textAlign = "center";
    content.appendChild(done);
  }

  function renderPgPerms(content) {
    pgBack(content, function () { pgView = { screen: "main" }; renderPhoneGuard(); });
    content.appendChild(pgEl("h2", "", "Before you turn this on"));
    content.appendChild(pgEl("p", "muted-line", "NURA can detect when selected apps are opened so it can give you a short pause before you continue. It only sees which app is in front — never what is inside it. Everything stays on this phone."));

    var st = pgStatus() || {};
    var cfg = pgConfig();
    var n = pgNative();

    function item(title, status, why, btnLabel, fn, required) {
      var card = pgEl("div", "money-habit-card");
      card.style.marginTop = "12px";
      card.appendChild(pgEl("p", "name", (status ? "✓ " : "") + title + (required ? "" : " (optional)")));
      card.appendChild(pgEl("p", "cost-line", why));
      if (!status) {
        var row = pgEl("div", "money-quick-actions");
        row.appendChild(pgBtn(btnLabel, "action-btn primary", fn));
        card.appendChild(row);
      }
      content.appendChild(card);
    }
    item("Usage Access", st.usageAccess,
      "Needed so NURA can tell when one of your chosen apps comes to the front. Android will open a Settings list: find NURA, switch it on, then come back.",
      "Enable Required Permission", function () { n.openUsageAccessSettings(); }, true);
    item("Display over other apps", st.overlay,
      "Needed so the short pause screen can appear on top of the app you're opening. Android will open Settings: switch it on for NURA, then come back.",
      "Enable Required Permission", function () { n.openOverlaySettings(); }, true);
    item("Notifications", st.notifications,
      "Only used to tell you when a time limit you set is reached, and to show that monitoring is on. Never “come back” messages.",
      "Allow notifications", function () { n.requestNotifications(); }, false);
    item("Run in the background", st.batteryUnrestricted,
      "Some phones, including Vivo, stop background apps to save battery. Allowing NURA keeps the pause reliable.",
      "Open battery settings", function () { n.openBatterySettings(); }, false);

    var pkgs = Object.keys(cfg.apps);
    var appsCard = pgEl("div", "money-habit-card");
    appsCard.style.marginTop = "12px";
    appsCard.appendChild(pgEl("p", "name", (pkgs.length ? "✓ " : "") + "Apps to watch"));
    appsCard.appendChild(pgEl("p", "cost-line", pkgs.length ? pkgs.length + " selected. NURA watches only these." : "Choose the apps you want a pause for. You decide the list."));
    var arow = pgEl("div", "money-quick-actions");
    arow.appendChild(pgBtn(pkgs.length ? "Change apps" : "Choose apps", "action-btn primary", function () { pgView = { screen: "apps" }; renderPhoneGuard(); }));
    appsCard.appendChild(arow);
    content.appendChild(appsCard);

    var ready = st.usageAccess && st.overlay && pkgs.length > 0;
    var go = pgBtn("Turn on Intentional Open", "btn btn-primary btn-full", function () {
      if (!ready) return;
      cfg.enabled = true;
      if (!pgSave(cfg)) { showToast("Couldn't start monitoring"); return; }
      pgView = { screen: "main" };
      setTimeout(renderPhoneGuard, 800);
    });
    go.style.marginTop = "16px";
    if (!ready) { go.disabled = true; go.style.opacity = "0.5"; }
    content.appendChild(go);
    if (!ready) content.appendChild(pgEl("p", "muted-line", "Turn on the two required permissions and choose at least one app.")).style.marginTop = "8px";
  }

  function renderPgApps(content) {
    pgBack(content, function () { pgView = { screen: "main" }; renderPhoneGuard(); });
    content.appendChild(pgEl("h2", "", "Choose apps to watch"));
    var cfg = pgConfig();
    if (!pgAppsCache) pgAppsCache = pgParse(function () { return pgNative().listApps(); }, []);
    var search = pgEl("input", "text-input");
    search.type = "text";
    search.placeholder = "Search apps";
    search.value = pgAppFilter;
    content.appendChild(search);
    var list = pgEl("div", "");
    content.appendChild(list);

    function drawList() {
      list.innerHTML = "";
      var q = pgAppFilter.trim().toLowerCase();
      var rows = pgAppsCache.filter(function (a) { return !q || a.label.toLowerCase().indexOf(q) !== -1; });
      rows.sort(function (a, b) {
        var sa = cfg.apps[a.pkg] ? 0 : 1, sb = cfg.apps[b.pkg] ? 0 : 1;
        return sa - sb || a.label.toLowerCase().localeCompare(b.label.toLowerCase());
      });
      if (!rows.length) list.appendChild(pgEl("p", "muted-line", "No apps found."));
      rows.forEach(function (a) {
        var label = pgEl("label", "money-checkbox-row");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!cfg.apps[a.pkg];
        cb.addEventListener("change", function () {
          if (cb.checked) cfg.apps[a.pkg] = { label: a.label, dailyTargetMin: 0, openLimit: 0, sessionMin: 0 };
          else delete cfg.apps[a.pkg];
          pgSave(cfg);
        });
        label.appendChild(cb);
        label.appendChild(pgEl("span", "", a.label));
        list.appendChild(label);
      });
    }
    search.addEventListener("input", function () { pgAppFilter = search.value; drawList(); });
    drawList();
    var done = pgBtn("Done", "btn btn-primary btn-full", function () { pgView = { screen: "main" }; renderPhoneGuard(); });
    done.style.marginTop = "14px";
    content.appendChild(done);
  }

  function renderPgAppEdit(content) {
    var cfg = pgConfig();
    var a = cfg.apps[pgView.pkg];
    if (!a) { pgView = { screen: "main" }; return renderPhoneGuard(); }
    pgBack(content, function () { pgView = { screen: "main" }; renderPhoneGuard(); });
    content.appendChild(pgEl("h2", "", a.label));
    function setField(k, v) { a[k] = v; pgSave(cfg); renderPhoneGuard(); }
    content.appendChild(pgEl("p", "muted-line", "Daily target (minutes a day)"));
    content.appendChild(pgStepper(a.dailyTargetMin, 0, 600, 5, function (v) { return v === 0 ? "None" : v + " min"; }, function (v) { setField("dailyTargetMin", v); }));
    content.appendChild(pgEl("p", "muted-line", "Opening limit (opens a day)"));
    content.appendChild(pgStepper(a.openLimit, 0, 100, 1, function (v) { return v === 0 ? "None" : String(v); }, function (v) { setField("openLimit", v); }));
    content.appendChild(pgEl("p", "muted-line", "Session timer (minutes each visit)"));
    content.appendChild(pgStepper(a.sessionMin, 0, 120, 5, function (v) { return v === 0 ? "None" : v + " min"; }, function (v) { setField("sessionMin", v); }));
    content.appendChild(pgEl("p", "muted-line", "These are your own limits — NURA doesn't set any for you. Reaching one sends a single reminder.")).style.marginTop = "8px";
  }

  function renderPgRules(content) {
    var cfg = pgConfig();
    pgBack(content, function () { pgView = { screen: "main" }; renderPhoneGuard(); });
    content.appendChild(pgEl("h2", "", "Pause rules"));
    function setField(k, v) { cfg[k] = v; pgSave(cfg); renderPhoneGuard(); }
    content.appendChild(pgEl("p", "muted-line", "Pause again after this many opens…"));
    content.appendChild(pgStepper(cfg.repeatCount, 2, 10, 1, function (v) { return v + " opens"; }, function (v) { setField("repeatCount", v); }));
    content.appendChild(pgEl("p", "muted-line", "…within this many minutes"));
    content.appendChild(pgStepper(cfg.repeatWindowMin, 5, 120, 5, function (v) { return v + " min"; }, function (v) { setField("repeatWindowMin", v); }));
    content.appendChild(pgEl("p", "muted-line", "After I continue, don't ask again for"));
    content.appendChild(pgStepper(cfg.graceMin, 5, 120, 5, function (v) { return v + " min"; }, function (v) { setField("graceMin", v); }));
    var row = pgEl("div", "money-quick-actions");
    row.appendChild(pgBtn("Pause on every fresh open", "preset-plan-chip" + (cfg.pauseFreshOpen ? " active-chip" : ""), function () { setField("pauseFreshOpen", true); }));
    row.appendChild(pgBtn("Only on repeated opens", "preset-plan-chip" + (!cfg.pauseFreshOpen ? " active-chip" : ""), function () { setField("pauseFreshOpen", false); }));
    content.appendChild(row);
  }

  function initPhoneGuard() {
    document.getElementById("duniya-phone-guard-back").addEventListener("click", function () {
      pgView = { screen: "main" };
      pickerStep = { view: "phone-distraction", bodyPart: null };
      setActiveView("duniya-tool");
    });
    window.nuraNativeResumed = function () {
      var v = document.getElementById("view-duniya-phone-guard");
      if (v && !v.classList.contains("hidden")) renderPhoneGuard();
    };
    window.nuraAndroidBack = function () {
      var vis = document.querySelector(".view:not(.hidden)");
      var name = vis ? vis.dataset.view : "home";
      if (name === "duniya-phone-guard" && pgView.screen !== "main") { pgView = { screen: "main" }; renderPhoneGuard(); return true; }
      if (name === "memory") { setActiveView("more"); return true; }
      if (name === "duniya-growth" && gwView.screen !== "home") { gwView = { screen: "home" }; renderDuniyaGrowth(); return true; }
      if (name === "duniya-recovery" && rcView.screen !== "main") { rcStopTimer(); rcView = { screen: "main" }; renderRecovery(); return true; }
      if (name === "home") return false;
      setActiveView(name === "duniya-phone-guard" ? "duniya" : name === "duniya-recovery" ? "duniya-habits" : "home");
      return true;
    };
  }

  // ---- Recovery (Habits & Discipline → Recovery) ----
  // Private, local-only. A day counts as successful only when the user checks in
  // "clean" for it; a missed check-in is neither a success nor a slip. A slip ends
  // the current streak but never touches best streak, total days or history.
  // No notifications are sent by this module. Nothing here appears on Home
  // except neutral totals (no habit names) in Progress Details.

  var RC_HABITS = [
    { key: "porn", label: "Pornography" },
    { key: "masturbation", label: "Masturbation" },
    { key: "smoking", label: "Smoking" },
    { key: "cannabis", label: "Cannabis" },
    { key: "social", label: "Excessive social media" },
    { key: "gaming", label: "Gaming" },
    { key: "junkfood", label: "Junk food" },
    { key: "other", label: "Other — custom habit" }
  ];
  var RC_TRIGGERS = ["Stress", "Boredom", "Being alone", "Social media", "Late night", "Anger", "Other"];
  var RC_URGE_ACTIONS = [
    "Leave the room you're in",
    "Put your phone away, out of reach",
    "Take a short walk",
    "Drink a glass of water",
    "Make wudu, if that suits you",
    "Splash cold water on your face",
    "Do 20 push-ups or a short stretch"
  ];

  var rcView = { screen: "main" };
  var rcTimerId = null;

  function rcEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function rcBtn(label, cls, fn) {
    var b = rcEl("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function rcAddDays(key, n) {
    var d = new Date(key + "T12:00:00");
    d.setDate(d.getDate() + n);
    return todayKey(d);
  }
  function rcFmtDate(key) {
    return new Date(key + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function rcHabitLabel(key) {
    var h = RC_HABITS.filter(function (x) { return x.key === key; })[0];
    return h ? h.label : key;
  }
  function rcName(j) {
    return j.nickname || (j.habit === "other" ? (j.customHabit || "Custom habit") : rcHabitLabel(j.habit));
  }

  function rcJourneys() { return readJSON("nc_recovery_journeys", []); }
  function rcSaveJourneys(a) { writeJSON("nc_recovery_journeys", a); }
  function rcLogsAll() { return readJSON("nc_recovery_logs", {}); }
  function rcSetLog(journeyId, dateKey, entry) {
    var all = rcLogsAll();
    if (!all[journeyId]) all[journeyId] = {};
    all[journeyId][dateKey] = entry;
    writeJSON("nc_recovery_logs", all);
  }
  function rcUrges() { return readJSON("nc_recovery_urges", []); }
  function rcContact() { return readJSON("nc_recovery_contact", null); }

  function rcSpan(logs, keys, startDate) {
    var c = 0, s = 0;
    keys.forEach(function (k) {
      if (k < startDate) return;
      var e = logs[k];
      if (e && e.status === "clean") c++;
      else if (e && e.status === "slip") s++;
    });
    return { clean: c, slips: s };
  }

  function rcCompute(j) {
    var logs = rcLogsAll()[j.id] || {};
    var today = todayKey();
    var out = { clean: 0, slips: 0, best: 0, current: 0, started: j.startDate <= today, logs: logs };
    if (out.started) {
      var run = 0, d = j.startDate, guard = 0;
      while (d <= today && guard < 5000) {
        var e = logs[d];
        if (e && e.status === "clean") { out.clean++; run++; if (run > out.best) out.best = run; }
        else { if (e && e.status === "slip") out.slips++; run = 0; }
        d = rcAddDays(d, 1);
        guard++;
      }
      var k = today;
      if (!logs[k]) k = rcAddDays(k, -1);
      while (k >= j.startDate && logs[k] && logs[k].status === "clean") { out.current++; k = rcAddDays(k, -1); }
    }
    var last7 = getLastNDateKeys(7);
    out.weekDays = last7.slice().reverse().map(function (key) {
      return { key: key, status: key >= j.startDate && logs[key] ? logs[key].status : null };
    });
    out.week = rcSpan(logs, last7, j.startDate);
    out.prev = rcSpan(logs, getLastNDateKeys(14).slice(7), j.startDate);
    return out;
  }

  function rcMoney(j, stats) {
    if (j.habit !== "smoking" || !j.cigsPerDay || !j.costPerCig) return null;
    var perDay = j.cigsPerDay * j.costPerCig;
    return {
      perDay: perDay,
      cigsAvoided: stats.clean * j.cigsPerDay,
      total: stats.clean * perDay,
      week: stats.week.clean * perDay
    };
  }

  function rcTriggerCounts(logs, fromKey) {
    var counts = {}, slips = 0;
    Object.keys(logs).forEach(function (k) {
      var e = logs[k];
      if (e.status !== "slip" || (fromKey && k < fromKey)) return;
      slips++;
      var t = e.trigger || "Not recorded";
      counts[t] = (counts[t] || 0) + 1;
    });
    return { counts: counts, slips: slips };
  }
  function rcTopTrigger(tc) {
    var top = null;
    Object.keys(tc.counts).forEach(function (t) {
      if (t !== "Not recorded" && (!top || tc.counts[t] > tc.counts[top])) top = t;
    });
    return top ? top + " (" + tc.counts[top] + " of " + tc.slips + " slips)" : null;
  }

  function rcStopTimer() { if (rcTimerId) { clearInterval(rcTimerId); rcTimerId = null; } }
  function rcGo(screen, extra) {
    var v = extra || {};
    v.screen = screen;
    rcView = v;
    renderRecovery();
  }

  function renderRecovery() {
    var content = document.getElementById("duniya-recovery-content");
    if (!content) return;
    if (rcView.screen !== "urge") rcStopTimer();
    content.innerHTML = "";
    if (rcView.screen === "start") return renderRcStart(content);
    if (rcView.screen === "dash") return renderRcDash(content);
    if (rcView.screen === "slip") return renderRcSlip(content);
    if (rcView.screen === "urge") return renderRcUrge(content);
    renderRcMain(content);
  }

  function rcBack(content, fn) { content.appendChild(rcBtn("← Back", "picker-step-back", fn)); }

  function renderRcMain(content) {
    var privacy = rcEl("p", "muted-line", "Private to this device. Nothing here shows on your Home screen.");
    content.appendChild(privacy);

    var urge = rcBtn("I'm having an urge", "btn btn-primary btn-full", function () { startRcUrge(null); });
    urge.style.marginTop = "14px";
    content.appendChild(urge);

    var journeys = rcJourneys();
    if (!journeys.length) {
      content.appendChild(rcEl("h2", "", "Quit or control a habit")).style.marginTop = "16px";
      content.appendChild(rcEl("p", "muted-line", "Choose what you want to change. NURA keeps your progress, remembers what triggers you, and helps you restart without shame."));
    } else {
      content.appendChild(rcEl("h2", "", "Your recovery")).style.marginTop = "16px";
      var today = todayKey();
      journeys.forEach(function (j) {
        var s = rcCompute(j);
        var card = rcEl("div", "money-habit-card");
        card.appendChild(rcEl("p", "name", rcName(j) + " Recovery"));
        var e = s.logs[today];
        var line = !s.started ? "Starts " + rcFmtDate(j.startDate)
          : "Current streak: " + s.current + " day" + (s.current === 1 ? "" : "s") + " · Today: " + (e ? (e.status === "clean" ? "clean" : "slipped") : "not checked in");
        card.appendChild(rcEl("p", "cost-line", line));
        var row = rcEl("div", "money-quick-actions");
        row.appendChild(rcBtn("Open", "action-btn primary", function () { rcGo("dash", { id: j.id }); }));
        card.appendChild(row);
        content.appendChild(card);
      });
    }
    var startBtn = rcBtn(journeys.length ? "+ Start another recovery" : "Start Recovery", journeys.length ? "btn btn-outline btn-full" : "btn btn-primary btn-full", function () {
      rcGo("start", { step: 1, data: { habit: null, customHabit: "", nickname: "", startChoice: "today", startDate: todayKey(), why: "", triggers: [], triggerNote: "", goal: "", cigsPerDay: 10, costMode: "cig", cost: "", packSize: 20, savingGoal: "" } });
    });
    startBtn.style.marginTop = "12px";
    content.appendChild(startBtn);
  }

  // ---- Start Recovery wizard ----

  function renderRcStart(content) {
    var d = rcView.data, step = rcView.step;
    var isSmoking = d.habit === "smoking";
    var total = isSmoking ? 6 : 5;
    rcBack(content, function () { if (step > 1) { rcView.step = step - 1; renderRecovery(); } else rcGo("main"); });
    content.appendChild(rcEl("p", "muted-line", "Step " + step + " of " + total));
    function next() { rcView.step = step + 1; renderRecovery(); }
    function nextBtn(label, fn) {
      var b = rcBtn(label || "Next", "btn btn-primary btn-full", fn || next);
      b.style.marginTop = "14px";
      content.appendChild(b);
    }

    if (step === 1) {
      content.appendChild(rcEl("h2", "", "What do you want to quit or control?"));
      var chips = rcEl("div", "money-quick-actions");
      RC_HABITS.forEach(function (h) {
        chips.appendChild(rcBtn(h.label, "preset-plan-chip" + (d.habit === h.key ? " active-chip" : ""), function () { d.habit = h.key; renderRecovery(); }));
      });
      content.appendChild(chips);
      if (d.habit === "other") {
        var custom = rcEl("input", "text-input");
        custom.type = "text"; custom.placeholder = "Name this habit"; custom.value = d.customHabit;
        custom.addEventListener("input", function () { d.customHabit = custom.value; });
        content.appendChild(custom);
      }
      content.appendChild(rcEl("p", "muted-line", "Private name (optional) — shown instead of the habit name")).style.marginTop = "12px";
      var nick = rcEl("input", "text-input");
      nick.type = "text"; nick.placeholder = "e.g. My challenge"; nick.value = d.nickname;
      nick.addEventListener("input", function () { d.nickname = nick.value; });
      content.appendChild(nick);
      nextBtn("Next", function () {
        if (!d.habit) { showToast("Choose one to continue"); return; }
        if (d.habit === "other" && !d.customHabit.trim()) { showToast("Name this habit"); return; }
        next();
      });
    } else if (step === 2) {
      content.appendChild(rcEl("h2", "", "When do you want to start?"));
      var row = rcEl("div", "money-quick-actions");
      row.appendChild(rcBtn("Today", "preset-plan-chip" + (d.startChoice === "today" ? " active-chip" : ""), function () { d.startChoice = "today"; d.startDate = todayKey(); renderRecovery(); }));
      row.appendChild(rcBtn("Tomorrow", "preset-plan-chip" + (d.startChoice === "tomorrow" ? " active-chip" : ""), function () { d.startChoice = "tomorrow"; d.startDate = rcAddDays(todayKey(), 1); renderRecovery(); }));
      row.appendChild(rcBtn("Pick a date", "preset-plan-chip" + (d.startChoice === "date" ? " active-chip" : ""), function () { d.startChoice = "date"; renderRecovery(); }));
      content.appendChild(row);
      if (d.startChoice === "date") {
        var di = rcEl("input", "text-input");
        di.type = "date"; di.min = todayKey(); di.value = d.startDate;
        di.addEventListener("change", function () { if (di.value) d.startDate = di.value; });
        content.appendChild(di);
      }
      content.appendChild(rcEl("p", "muted-line", "Starts " + rcFmtDate(d.startDate) + ".")).style.marginTop = "8px";
      nextBtn();
    } else if (step === 3) {
      content.appendChild(rcEl("h2", "", "Why do you want to quit?"));
      var why = rcEl("textarea", "text-input rec-textarea");
      why.placeholder = "In your own words. Only you will see this."; why.value = d.why;
      why.addEventListener("input", function () { d.why = why.value; });
      content.appendChild(why);
      nextBtn();
    } else if (step === 4) {
      content.appendChild(rcEl("h2", "", "What normally triggers you?"));
      var tchips = rcEl("div", "money-quick-actions");
      RC_TRIGGERS.forEach(function (t) {
        var on = d.triggers.indexOf(t) !== -1;
        tchips.appendChild(rcBtn(t, "preset-plan-chip" + (on ? " active-chip" : ""), function () {
          if (on) d.triggers.splice(d.triggers.indexOf(t), 1); else d.triggers.push(t);
          renderRecovery();
        }));
      });
      content.appendChild(tchips);
      var tn = rcEl("input", "text-input");
      tn.type = "text"; tn.placeholder = "Anything else? (optional)"; tn.value = d.triggerNote;
      tn.addEventListener("input", function () { d.triggerNote = tn.value; });
      content.appendChild(tn);
      nextBtn();
    } else if (step === 5) {
      content.appendChild(rcEl("h2", "", "A personal goal (optional)"));
      var goal = rcEl("input", "text-input");
      goal.type = "text"; goal.placeholder = "e.g. Feel calmer, be present with family"; goal.value = d.goal;
      goal.addEventListener("input", function () { d.goal = goal.value; });
      content.appendChild(goal);
      nextBtn(isSmoking ? "Next" : "Start my recovery", isSmoking ? next : function () { finishRcStart(); });
    } else if (step === 6) {
      content.appendChild(rcEl("h2", "", "About your smoking"));
      content.appendChild(rcEl("p", "muted-line", "Cigarettes per day"));
      content.appendChild(buildMoneyStepper(d.cigsPerDay, function (v) { d.cigsPerDay = v; renderRecovery(); }, 1, 100));
      var mode = rcEl("div", "money-quick-actions");
      mode.appendChild(rcBtn("Cost per cigarette", "preset-plan-chip" + (d.costMode === "cig" ? " active-chip" : ""), function () { d.costMode = "cig"; renderRecovery(); }));
      mode.appendChild(rcBtn("Cost per pack", "preset-plan-chip" + (d.costMode === "pack" ? " active-chip" : ""), function () { d.costMode = "pack"; renderRecovery(); }));
      content.appendChild(mode);
      var preview = rcEl("div", "");
      function drawPreview() {
        preview.innerHTML = "";
        var c = rcResolveCost(d);
        if (c) preview.appendChild(rcEl("p", "muted-line", "≈ " + fmtRupee(c * d.cigsPerDay) + " a day · " + fmtRupee(c * d.cigsPerDay * 7) + " a week"));
      }
      var cost = rcEl("input", "text-input");
      cost.type = "number"; cost.min = "0"; cost.placeholder = d.costMode === "cig" ? "₹ per cigarette" : "₹ per pack"; cost.value = d.cost;
      cost.addEventListener("input", function () { d.cost = cost.value; drawPreview(); });
      content.appendChild(cost);
      if (d.costMode === "pack") {
        content.appendChild(rcEl("p", "muted-line", "Cigarettes in a pack"));
        content.appendChild(buildMoneyStepper(d.packSize, function (v) { d.packSize = v; renderRecovery(); }, 1, 50));
      }
      content.appendChild(preview);
      drawPreview();
      content.appendChild(rcEl("p", "muted-line", "Saving goal (optional)")).style.marginTop = "12px";
      var sg = rcEl("input", "text-input");
      sg.type = "number"; sg.min = "0"; sg.placeholder = "₹5000"; sg.value = d.savingGoal;
      sg.addEventListener("input", function () { d.savingGoal = sg.value; });
      content.appendChild(sg);
      nextBtn("Start my recovery", function () {
        if (!rcResolveCost(d)) { showToast("Enter what a cigarette or pack costs"); return; }
        finishRcStart();
      });
    }
  }

  function rcResolveCost(d) {
    var c = parseFloat(d.cost);
    if (!c || c <= 0) return 0;
    return d.costMode === "pack" ? c / Math.max(1, d.packSize) : c;
  }

  function finishRcStart() {
    var d = rcView.data;
    var j = {
      id: uid("rec"), habit: d.habit, customHabit: d.customHabit.trim(), nickname: d.nickname.trim(),
      startDate: d.startDate, why: d.why.trim(), triggers: d.triggers.slice(), triggerNote: d.triggerNote.trim(),
      goal: d.goal.trim(), createdAt: new Date().toISOString()
    };
    if (d.habit === "smoking") {
      j.cigsPerDay = d.cigsPerDay;
      j.costPerCig = rcResolveCost(d);
      j.savingGoal = parseFloat(d.savingGoal) > 0 ? parseFloat(d.savingGoal) : 0;
    }
    var list = rcJourneys();
    list.push(j);
    rcSaveJourneys(list);
    showToast("Your recovery has started");
    rcGo("dash", { id: j.id });
  }

  // ---- Dashboard ----

  function rcCheckinBlock(content, j, dateKey, heading) {
    var s = rcCompute(j);
    var e = s.logs[dateKey];
    var wrap = rcEl("div", "");
    wrap.appendChild(rcEl("p", "muted-line", heading));
    function record(status) {
      rcSetLog(j.id, dateKey, { status: status, trigger: null, at: new Date().toISOString() });
      if (status === "slip") rcGo("slip", { id: j.id, dateKey: dateKey });
      else { showToast("Saved"); rcGo("dash", { id: j.id }); }
    }
    if (e && !rcView.changing) {
      var t = rcEl("p", "", e.status === "clean" ? "✅ You stayed clean." : "⚠️ You slipped" + (e.trigger ? " — trigger: " + e.trigger : "") + ".");
      t.style.fontWeight = "600";
      wrap.appendChild(t);
      var ch = rcBtn("Change this answer", "priority-change-link", function () { rcGo("dash", { id: j.id, changing: dateKey }); });
      wrap.appendChild(ch);
    } else {
      var row = rcEl("div", "rec-check-row");
      row.appendChild(rcBtn("✅ I stayed clean today", "btn btn-primary", function () { record("clean"); }));
      row.appendChild(rcBtn("⚠️ I slipped today", "btn btn-outline", function () { record("slip"); }));
      if (dateKey !== todayKey()) {
        row.childNodes[0].textContent = "✅ I stayed clean";
        row.childNodes[1].textContent = "⚠️ I slipped";
      }
      wrap.appendChild(row);
    }
    content.appendChild(wrap);
  }

  function renderRcDash(content) {
    var j = rcJourneys().filter(function (x) { return x.id === rcView.id; })[0];
    if (!j) { rcGo("main"); return; }
    var s = rcCompute(j);
    var today = todayKey();
    rcBack(content, function () { rcGo("main"); });
    content.appendChild(rcEl("h2", "", rcName(j) + " Recovery"));
    content.appendChild(rcEl("p", "muted-line", "Started " + rcFmtDate(j.startDate) + (s.started ? "" : " (not yet)")));

    var urge = rcBtn("I'm having an urge", "btn btn-primary btn-full", function () { startRcUrge(j.id); });
    urge.style.margin = "14px 0";
    content.appendChild(urge);

    if (!s.started) {
      content.appendChild(rcEl("p", "muted-line", "Your recovery starts on " + rcFmtDate(j.startDate) + ". Check-ins open that day."));
      content.appendChild(rcBtn("Start today instead", "action-btn primary", function () {
        var list = rcJourneys();
        list.forEach(function (x) { if (x.id === j.id) x.startDate = today; });
        rcSaveJourneys(list);
        renderRecovery();
      }));
    } else {
      var changing = rcView.changing;
      if (changing) rcCheckinBlock(content, j, changing, changing === today ? "Change today's answer" : "Check-in for " + rcFmtDate(changing));
      else {
        rcCheckinBlock(content, j, today, "Today's check-in");
        var y = rcAddDays(today, -1);
        if (y >= j.startDate && !s.logs[y]) {
          content.appendChild(rcBtn("Add yesterday's check-in", "priority-change-link", function () { rcGo("dash", { id: j.id, changing: y }); }));
        }
      }
    }

    // stats
    var tiles = rcEl("div", "money-stat-grid");
    tiles.style.marginTop = "16px";
    [["Current streak", s.current + (s.current === 1 ? " day" : " days")], ["Best streak", s.best + (s.best === 1 ? " day" : " days")], ["Successful days", String(s.clean)]].forEach(function (r) {
      var t = rcEl("div", "money-stat-tile");
      t.appendChild(rcEl("span", "big", r[1]));
      t.appendChild(rcEl("span", "lbl", r[0]));
      tiles.appendChild(t);
    });
    content.appendChild(tiles);

    var weekDays = s.weekDays.filter(function (d) { return d.status === "clean"; }).length;
    content.appendChild(rcEl("p", "", "This week: " + weekDays + "/7 days")).style.fontWeight = "600";
    var graph = rcEl("div", "rec-week-row");
    s.weekDays.forEach(function (d) {
      var w = rcEl("div", "rec-bar-wrap");
      w.appendChild(rcEl("div", "rec-bar" + (d.status ? " " + d.status : "")));
      w.appendChild(rcEl("span", "rec-label", new Date(d.key + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3)));
      graph.appendChild(w);
    });
    content.appendChild(graph);
    content.appendChild(rcEl("p", "muted-line", "Green = stayed clean · Gold = slipped · Empty = no check-in"));

    // smoking money
    var m = rcMoney(j, s);
    if (m) {
      content.appendChild(rcEl("h2", "", "Money saved")).style.marginTop = "18px";
      var box = rcEl("div", "money-cost-breakdown");
      function line(label, value, hl) {
        var r = rcEl("div", "row" + (hl ? " highlight" : ""));
        r.appendChild(rcEl("span", "", label));
        r.appendChild(rcEl("span", "", value));
        box.appendChild(r);
      }
      line(s.clean + " smoke-free day" + (s.clean === 1 ? "" : "s"), fmtRupee(m.total) + " saved", true);
      line("Cigarettes avoided", String(m.cigsAvoided));
      line("Saved this week", fmtRupee(m.week));
      line("Total saved", fmtRupee(m.total));
      content.appendChild(box);
      if (j.savingGoal > 0) {
        var pct = Math.min(100, Math.round((m.total / j.savingGoal) * 100));
        content.appendChild(rcEl("p", "muted-line", "Goal: " + fmtRupee(m.total) + " / " + fmtRupee(j.savingGoal) + " · " + pct + "%"));
        var track = rcEl("div", "plan-progress-track");
        var fill = rcEl("div", "plan-progress-fill");
        fill.style.width = pct + "%";
        track.appendChild(fill);
        content.appendChild(track);
        if (m.total >= j.savingGoal) content.appendChild(rcEl("p", "rec-note", "🎉 You reached your " + fmtRupee(j.savingGoal) + " goal."));
      }
      content.appendChild(rcEl("p", "muted-line", "Counted only from days you checked in clean."));
    }

    // weekly report
    content.appendChild(rcEl("h2", "", "This week")).style.marginTop = "18px";
    var report = rcEl("div", "money-cost-breakdown");
    function rline(label, value, hl) {
      var r = rcEl("div", "row" + (hl ? " highlight" : ""));
      r.appendChild(rcEl("span", "", label));
      r.appendChild(rcEl("span", "", value));
      report.appendChild(r);
    }
    rline("Successful days", s.week.clean + " (last week " + s.prev.clean + ")");
    rline("Slips", s.week.slips + " (last week " + s.prev.slips + ")");
    rline("Current streak", s.current + " days");
    rline("Best streak", s.best + " days");
    var diff = s.week.clean - s.prev.clean;
    rline("Compared with last week", diff === 0 ? "Same" : (diff > 0 ? "↑ " : "↓ ") + Math.abs(diff) + " clean day" + (Math.abs(diff) === 1 ? "" : "s"), true);
    if (m) rline("Money saved this week", fmtRupee(m.week));
    var passed = rcUrges().filter(function (u) { return (u.journeyId === j.id) && u.passed && u.date >= getLastNDateKeys(7)[6]; }).length;
    if (passed) rline("Urges you got through", String(passed));
    content.appendChild(report);
    var tcWeek = rcTriggerCounts(s.logs, getLastNDateKeys(7)[6]);
    var tcAll = rcTriggerCounts(s.logs, null);
    var topWeek = rcTopTrigger(tcWeek), topAll = rcTopTrigger(tcAll);
    if (topAll) content.appendChild(rcEl("p", "muted-line", "Trigger pattern: " + (topWeek ? "this week " + topWeek + "; " : "") + "overall " + topAll + "."));
    else content.appendChild(rcEl("p", "muted-line", "Trigger patterns appear here once you've recorded a trigger."));
    content.appendChild(rcEl("p", "rec-note", "The goal is long-term improvement, not a perfect streak."));

    if (j.why) {
      content.appendChild(rcEl("h2", "", "Why I'm doing this")).style.marginTop = "16px";
      content.appendChild(rcEl("p", "muted-line", j.why));
    }
    if (j.goal) content.appendChild(rcEl("p", "muted-line", "Goal: " + j.goal));

    var del = rcBtn("Delete this recovery and its data", "priority-change-link", function () {
      if (!window.confirm("Delete this recovery journey and all its check-ins from this device? This can't be undone.")) return;
      rcSaveJourneys(rcJourneys().filter(function (x) { return x.id !== j.id; }));
      var logs = rcLogsAll();
      delete logs[j.id];
      writeJSON("nc_recovery_logs", logs);
      writeJSON("nc_recovery_urges", rcUrges().filter(function (u) { return u.journeyId !== j.id; }));
      showToast("Deleted");
      rcGo("main");
    });
    del.style.marginTop = "18px";
    content.appendChild(del);
  }

  // ---- After a slip ----

  function renderRcSlip(content) {
    var j = rcJourneys().filter(function (x) { return x.id === rcView.id; })[0];
    if (!j) { rcGo("main"); return; }
    var s = rcCompute(j);
    content.appendChild(rcEl("p", "rec-note", "You slipped today, but your previous progress still counts. Understand what triggered it and restart."));
    content.appendChild(rcEl("p", "muted-line", "Your best streak (" + s.best + " day" + (s.best === 1 ? "" : "s") + ") and your " + s.clean + " successful day" + (s.clean === 1 ? "" : "s") + " are still yours. One day doesn't erase them."));
    content.appendChild(rcEl("h2", "", "What triggered you?")).style.marginTop = "14px";
    var chips = rcEl("div", "money-quick-actions");
    RC_TRIGGERS.forEach(function (t) {
      chips.appendChild(rcBtn(t, "preset-plan-chip", function () {
        var e = (rcLogsAll()[j.id] || {})[rcView.dateKey] || { status: "slip", at: new Date().toISOString() };
        e.trigger = t;
        rcSetLog(j.id, rcView.dateKey, e);
        showToast("Saved privately");
        rcGo("dash", { id: j.id });
      }));
    });
    content.appendChild(chips);
    content.appendChild(rcBtn("Skip for now", "priority-change-link", function () { rcGo("dash", { id: j.id }); }));
  }

  // ---- Urge ----

  function startRcUrge(journeyId) {
    var list = rcUrges();
    var rec = { id: uid("urge"), journeyId: journeyId, date: todayKey(), at: new Date().toISOString(), passed: false };
    list.push(rec);
    writeJSON("nc_recovery_urges", list);
    rcGo("urge", { journeyId: journeyId, urgeId: rec.id, done: {}, timerEnd: null });
  }

  function renderRcUrge(content) {
    rcBack(content, function () { rcGo(rcView.journeyId ? "dash" : "main", rcView.journeyId ? { id: rcView.journeyId } : {}); });
    content.appendChild(rcEl("h2", "", "Take a breath."));
    content.appendChild(rcEl("p", "muted-line", "You don't have to act on this. Pick one small thing and do it now."));
    var list = rcEl("div", "");
    list.style.marginTop = "12px";
    RC_URGE_ACTIONS.forEach(function (a, i) {
      var b = rcBtn((rcView.done[i] ? "✓ " : "") + a, "rec-action" + (rcView.done[i] ? " done" : ""), function () {
        rcView.done[i] = !rcView.done[i];
        var keepEnd = rcView.timerEnd;
        renderRecovery();
        rcView.timerEnd = keepEnd;
      });
      list.appendChild(b);
    });
    content.appendChild(list);

    // 10-minute distraction timer
    var timerBox = rcEl("div", "money-cost-breakdown");
    timerBox.style.textAlign = "center";
    var time = rcEl("div", "rec-timer", "10:00");
    var msg = rcEl("p", "muted-line", "Start a 10-minute distraction timer. Do anything else until it ends.");
    var startT = rcBtn("Start 10-minute timer", "btn btn-primary btn-full", function () {
      rcView.timerEnd = Date.now() + 600000;
      startT.style.display = "none";
      runTimer();
    });
    function runTimer() {
      rcStopTimer();
      function tick() {
        if (!document.body.contains(time)) { rcStopTimer(); return; }
        var left = Math.max(0, rcView.timerEnd - Date.now());
        var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
        time.textContent = m + ":" + (s < 10 ? "0" : "") + s;
        if (left <= 0) { rcStopTimer(); msg.textContent = "10 minutes done. Urges usually ease with time. How do you feel?"; }
        else msg.textContent = "Keep going. Do anything except the habit.";
      }
      tick();
      rcTimerId = setInterval(tick, 500);
    }
    timerBox.appendChild(time);
    timerBox.appendChild(msg);
    timerBox.appendChild(startT);
    content.appendChild(timerBox);
    if (rcView.timerEnd) { startT.style.display = "none"; runTimer(); }

    content.appendChild(rcEl("h2", "", "Something useful")).style.marginTop = "14px";
    content.appendChild(rcBtn("Open duas (Sunnah)", "btn btn-outline btn-full", function () { rcStopTimer(); setActiveView("sunnah"); }));

    // trusted contact
    var contact = rcContact();
    content.appendChild(rcEl("h2", "", "Someone you trust")).style.marginTop = "14px";
    if (contact && contact.phone && !rcView.editContact) {
      var call = rcEl("a", "btn btn-primary btn-full", "Call " + (contact.name || "them"));
      call.href = "tel:" + contact.phone;
      call.style.display = "block";
      call.style.textAlign = "center";
      call.style.textDecoration = "none";
      content.appendChild(call);
      content.appendChild(rcBtn("Change contact", "priority-change-link", function () { rcView.editContact = true; var k = rcView.timerEnd; renderRecovery(); rcView.timerEnd = k; }));
    } else {
      content.appendChild(rcEl("p", "muted-line", "Optional. Stored only on this device."));
      var nm = rcEl("input", "text-input");
      nm.type = "text"; nm.placeholder = "Name"; nm.value = contact ? contact.name || "" : "";
      var ph = rcEl("input", "text-input");
      ph.type = "tel"; ph.placeholder = "Phone number"; ph.value = contact ? contact.phone || "" : "";
      content.appendChild(nm);
      content.appendChild(ph);
      content.appendChild(rcBtn("Save contact", "btn btn-outline btn-full", function () {
        var phone = ph.value.replace(/[^0-9+]/g, "");
        if (!phone) { showToast("Enter a phone number"); return; }
        writeJSON("nc_recovery_contact", { name: nm.value.trim().slice(0, 40), phone: phone });
        rcView.editContact = false;
        var k = rcView.timerEnd; renderRecovery(); rcView.timerEnd = k;
      }));
    }

    var got = rcBtn("I got through this urge", "btn btn-primary btn-full", function () {
      var list2 = rcUrges();
      list2.forEach(function (u) { if (u.id === rcView.urgeId) u.passed = true; });
      writeJSON("nc_recovery_urges", list2);
      showToast("Well done for pausing");
      rcGo(rcView.journeyId ? "dash" : "main", rcView.journeyId ? { id: rcView.journeyId } : {});
    });
    got.style.marginTop = "18px";
    content.appendChild(got);
  }

  function initRecovery() {
    document.getElementById("open-recovery-btn").addEventListener("click", function () { rcView = { screen: "main" }; setActiveView("duniya-recovery"); });
    document.getElementById("duniya-recovery-back").addEventListener("click", function () { rcStopTimer(); rcView = { screen: "main" }; setActiveView("duniya-habits"); });
  }

  // Neutral totals only (no habit names) for the Home-adjacent Progress Details.
  function rcProgressRows() {
    var journeys = rcJourneys();
    if (!journeys.length) return [];
    var clean = 0, slips = 0, prevClean = 0, current = 0, money = 0, anyMoney = false;
    journeys.forEach(function (j) {
      var s = rcCompute(j);
      clean += s.week.clean; slips += s.week.slips; prevClean += s.prev.clean;
      if (s.current > current) current = s.current;
      var m = rcMoney(j, s);
      if (m) { money += m.week; anyMoney = true; }
    });
    var rows = [
      { label: "Recovery — successful days (7 days)", value: String(clean) },
      { label: "Recovery — slips", value: String(slips) },
      { label: "Recovery — current streak", value: current + (current === 1 ? " day" : " days") }
    ];
    var diff = clean - prevClean;
    rows.push({ label: "Recovery — vs. previous week", value: diff === 0 ? "Same" : (diff > 0 ? "↑ " : "↓ ") + Math.abs(diff) + " day" + (Math.abs(diff) === 1 ? "" : "s") });
    if (anyMoney) rows.push({ label: "Recovery — money saved (7 days)", value: fmtRupee(money) });
    return rows;
  }

  // ---- Personal Growth ----
  // UNDERSTAND -> CHOOSE FOCUS -> 7-DAY MISSION -> REAL ACTION -> SHORT REFLECTION
  // -> SAVE -> ADAPT -> WEEKLY PROGRESS. Rule-based only (no AI). Everything is
  // saved in localStorage under nc_pg_*: profile, draft, missions, history, today.
  // Nothing shown as progress is invented: it is all computed from saved history.

  var GW_TRACKS = [
    { key: "confidence", label: "Confidence", approach: "small social actions rather than more theory" },
    { key: "communication", label: "Communication", approach: "listening and asking before speaking" },
    { key: "social", label: "Social Skills", approach: "simple, low-pressure moments with real people" },
    { key: "discipline", label: "Discipline", approach: "starting small, before motivation shows up" },
    { key: "consistency", label: "Consistency", approach: "one tiny behaviour done the same way every day" },
    { key: "focus", label: "Focus & Procrastination", approach: "one clear next action and a 5-minute start" },
    { key: "decisions", label: "Decision Making", approach: "turning one open decision into small, reversible steps" },
    { key: "emotional", label: "Emotional Control", approach: "a pause between the feeling and the reaction" },
    { key: "time", label: "Time Management", approach: "choosing a few priorities and testing your time estimates" },
    { key: "resilience", label: "Resilience", approach: "recovering with the next smallest step after a setback" },
    { key: "awareness", label: "Self-Awareness", approach: "short daily noticing of what helps and what drains you" },
    { key: "courage", label: "Courage / Facing Discomfort", approach: "gradual, safe discomfort that grows step by step" }
  ];
  var GW_WEEKS = [
    "Small awareness + easy actions",
    "Consistency",
    "Slightly uncomfortable real-world actions",
    "Independent application"
  ];

  function gwA(id, skill, min, tiny, base, stretch, why) {
    return { id: id, skill: skill, min: min, t: [tiny, base, stretch], why: why };
  }

  // Each action has three versions: 0 = smaller, 1 = normal, 2 = stretch.
  var GW_LIB = {
    confidence: [
      gwA("conf1", "Eye contact & greeting", 3, "Look one person in the eye and give a small smile or nod.", "Make eye contact and say salam/hello to one person.", "Make eye contact and say salam/hello to three different people today.", "Confidence grows from small actions repeated, not from thinking about them."),
      gwA("conf2", "Asking questions", 3, "Ask one person the time or a simple yes/no question.", "Ask someone one simple question.", "Ask three different people one simple question each.", "Asking is the lowest-risk way to practise starting an interaction."),
      gwA("conf3", "Starting conversations", 5, "Say hello, then add one comment about the place or the weather.", "Start one short conversation yourself instead of waiting for the other person.", "Start a 3-minute conversation with someone you don't know well.", "Starting first is the skill; the rest gets easier once you have begun."),
      gwA("conf4", "Speaking up", 3, "Give a one-sentence opinion to someone you're comfortable with.", "Give your opinion once instead of staying silent.", "Share your opinion in a group and give one reason for it.", "Your view only counts in the conversation if it is said out loud."),
      gwA("conf5", "Follow-up questions", 5, "After someone answers, ask one more \"why\" or \"how\".", "Ask a follow-up question during a conversation.", "Ask two follow-up questions in one conversation.", "Follow-ups keep a conversation going without needing clever things to say."),
      gwA("conf6", "Facing avoidance", 5, "Do one very small thing you usually avoid, like ordering for yourself.", "Do one small thing you normally avoid because of nervousness.", "Do the thing you've been avoiding for a week because of nerves.", "Each avoided thing done once makes the next one smaller."),
      gwA("conf7", "Real conversation", 10, "Have a 1-minute conversation and notice how you felt afterwards.", "Have a 3–5 minute conversation and note what felt easier than before.", "Have a 5–10 minute conversation and bring up a topic yourself.", "Looking back at what got easier shows you the progress that is really there.")
    ],
    communication: [
      gwA("comm1", "Open questions", 5, "Ask one question that can't be answered with yes or no.", "Ask one open-ended question (what / how / why) and wait for the full answer.", "Ask open questions all through one conversation.", "Open questions make people say more, so you learn more."),
      gwA("comm2", "Listening", 5, "Listen to one person for one minute without interrupting.", "Listen to one person without interrupting until they finish.", "Do that in a disagreement, and let them finish before you answer.", "Most misunderstandings start with talking before the other person is done."),
      gwA("comm3", "Summarising", 5, "Repeat one thing someone said back to them: \"So you mean...\"", "Summarise what someone just told you in one sentence before replying.", "Summarise, then ask \"Did I get that right?\"", "Summarising shows you listened and catches mistakes early."),
      gwA("comm4", "Speaking slower", 5, "Pause for one breath before your next answer.", "Speak a little slower in one conversation and pause before key points.", "Do that in a longer conversation or a small group.", "Slower speech is clearer and sounds calmer."),
      gwA("comm5", "Short story", 5, "Tell someone one thing that happened today in two sentences.", "Tell one short story clearly: what happened, how you felt, what changed.", "Tell a story to a small group without rushing.", "A clear structure makes you easier to follow."),
      gwA("comm6", "Follow-up first", 5, "Ask one follow-up question in any conversation.", "In your next conversation, ask one follow-up question before talking about yourself.", "Ask two follow-ups before you share anything about yourself.", "People remember how interested you were in them."),
      gwA("comm7", "Explaining in 60 seconds", 10, "Explain a simple idea to someone in two minutes.", "Explain one idea to someone in 60 seconds.", "Explain a harder idea in 60 seconds and check if they understood.", "If you can say it briefly, you understand it better.")
    ],
    social: [
      gwA("soc1", "Greeting first", 3, "Greet one person when they are already looking at you.", "Greet someone first instead of waiting to be greeted.", "Greet three people first today.", "Being first to greet makes the rest of the interaction easier."),
      gwA("soc2", "Using names", 5, "Ask one person's name if you don't know it.", "Learn and use someone's name at least once in conversation.", "Use the names of two people in one day.", "A person's name is the simplest way to show you paid attention."),
      gwA("soc3", "Their interests", 5, "Ask one person what they enjoy doing.", "Ask someone about something they are interested in and listen to the answer.", "Ask about their interest, then ask a follow-up about the answer.", "Interest in another person builds connection faster than talking about yourself."),
      gwA("soc4", "Joining a group", 5, "Stand near a small conversation and listen to it.", "Join a small conversation and add one comment or question.", "Join a conversation and keep it going for a few minutes.", "You only need one sentence to become part of a group."),
      gwA("soc5", "Genuine compliment", 3, "Notice one thing you like about someone.", "Give one genuine, specific compliment.", "Give a genuine compliment and ask a follow-up question.", "Specific praise feels real, and it is easy to give."),
      gwA("soc6", "Ending well", 5, "Say \"nice talking to you\" at the end of a chat.", "End one conversation naturally instead of just walking away.", "End a conversation and say when you'd like to talk again.", "A good ending makes people want to talk to you again."),
      gwA("soc7", "Following up", 5, "Send a short \"how are you?\" to someone you haven't spoken to lately.", "Follow up with someone after a conversation by message or in person.", "Follow up with two people you haven't spoken to for a while.", "Relationships are kept by small contact, not big gestures.")
    ],
    discipline: [
      gwA("disc1", "Task before entertainment", 15, "Do a 5-minute task before you open entertainment.", "Complete one task you've been putting off before entertainment tonight.", "Complete your hardest task first, then entertainment.", "Doing the hard thing first takes away the mental weight for the rest of the day."),
      gwA("disc2", "10-minute start", 10, "Work on it for just 3 minutes, then decide whether to stop.", "Use the 10-minute rule: start the task, and only then decide whether to stop.", "Start, and keep going until the task is completely done.", "Starting is the hard part. Most of the resistance goes once you have begun."),
      gwA("disc3", "Removing a distraction", 5, "Put your phone in another room for 20 minutes.", "Remove one distraction from where you work (phone, tab, notification).", "Work for 45 minutes with that distraction removed.", "It is easier to change your surroundings than to fight temptation."),
      gwA("disc4", "Acting without motivation", 10, "Do one small task even though you don't feel like it.", "Do a task at a moment when your motivation is low.", "Do two tasks while you don't feel like doing either.", "Discipline means acting from a decision, not from a mood."),
      gwA("disc5", "If-then plan", 5, "Write one sentence: \"If it is ___, I will ___.\"", "Write and follow one plan: \"If X happens, I will do Y.\" For example, \"If it is 7 PM, I will study for 20 minutes before I open Instagram.\"", "Make two if-then plans and follow both.", "A ready plan removes the decision that usually loses to laziness."),
      gwA("disc6", "Preparing tonight", 5, "Choose tomorrow's first task before you sleep.", "Prepare tonight what you will do first tomorrow (lay it out, write it down).", "Prepare your morning and evening for tomorrow.", "A prepared start beats relying on morning willpower."),
      gwA("disc7", "Finishing the avoided task", 20, "Do 5 minutes of the task you've been avoiding.", "Finish the task you have been avoiding for at least 10 minutes.", "Finish that task completely today.", "Finishing the thing you avoid is the strongest proof to yourself that you can.")
    ],
    consistency: [
      gwA("cons1", "One tiny behaviour", 5, "Write down one tiny behaviour you could do daily.", "Choose ONE tiny daily behaviour and do it today.", "Do it today and set a time you will do it tomorrow.", "A small behaviour you actually repeat beats a big plan you drop."),
      gwA("cons2", "Minimum version", 5, "Do only the first 2 minutes of the behaviour.", "Do the minimum version of your habit, however busy you are.", "Do the normal version, but only after the minimum is done.", "The minimum version keeps the habit alive on hard days."),
      gwA("cons3", "Anchoring", 5, "Choose something you already do daily to attach it to.", "Attach your habit to something you already do: \"After ___, I will ___.\"", "Do it right after your anchor, both times today.", "Linking it to an existing routine removes the need to remember."),
      gwA("cons4", "Completion check", 3, "Mark today's result in NURA or on paper.", "Tick off your habit at the same time as yesterday.", "Tick it off and note how it went in one line.", "A visible record makes it easier to keep going."),
      gwA("cons5", "Never miss twice", 5, "If you missed yesterday, do just 1 minute today.", "If you missed yesterday, do the minimum today. Never miss twice.", "Catch up by doing the minimum and the normal version.", "One miss is normal. Two in a row is how a habit stops."),
      gwA("cons6", "Making it easier", 10, "Change one thing so that starting the habit takes fewer steps.", "Prepare your surroundings so the habit is easier (kit ready, app open, space cleared).", "Prepare for the next 3 days at once.", "Less friction means more repetitions."),
      gwA("cons7", "Weekly review", 10, "Count how many days you did the habit this week.", "Review your week: how many days did you do it, and what got in the way?", "Review, and change one thing for next week.", "Reviewing your actual record shows what to adjust.")
    ],
    focus: [
      gwA("foc1", "One next action", 5, "Write down one task you want to move forward.", "Define ONE next action for your main task, small enough to start in 2 minutes.", "Define the next action for your top 3 tasks.", "A vague task feels heavy; a clear next action does not."),
      gwA("foc2", "5-minute start", 5, "Set a 2-minute timer and begin the task.", "Start the task for just 5 minutes, with a timer.", "Start for 5 minutes, then decide whether to continue for 25.", "Five minutes is small enough to start and often enough to keep going."),
      gwA("foc3", "Focus session", 25, "Focus on one task for 10 minutes without switching.", "Do one distraction-free 25-minute focus session.", "Do two 25-minute sessions with a 5-minute break in between.", "Uninterrupted time gives you more than long, scattered hours."),
      gwA("foc4", "Phone away", 20, "Keep your phone face down and out of reach for 15 minutes.", "Work for 25 minutes with your phone in another room.", "Keep your phone away for your whole study or work block.", "The phone only distracts you when it is within reach."),
      gwA("foc5", "Breaking it down", 10, "Split one task into two parts.", "Break one large task into small steps and do only the first one.", "Break it into steps, do the first, and schedule the second.", "You can only act on the next step, not on the whole project."),
      gwA("foc6", "Your top distraction", 10, "Write down what distracts you most.", "Name your biggest distraction and block it (app timer, closed tab, other room).", "Block it for the whole day.", "You can only remove a distraction once you have named it."),
      gwA("foc7", "Finishing one thing", 20, "Finish one small task completely before starting anything else.", "Finish one task fully before opening anything new.", "Finish two tasks one after the other, with nothing in between.", "Finishing builds trust in yourself; half-done tasks drain attention.")
    ],
    decisions: [
      gwA("dec1", "Naming the decision", 5, "Think of one decision you have been putting off.", "Write down the actual decision in one sentence, e.g. \"Should I ___ or ___?\"", "Write down two pending decisions.", "Half the stress of a decision is not knowing exactly what it is."),
      gwA("dec2", "Listing options", 5, "Write two possible options.", "List all your real options, including doing nothing.", "List options and rank them.", "You can only choose well between options you can see."),
      gwA("dec3", "Facts you control", 10, "Write one thing about it that you control.", "Split it into what you can control and what you can't; act only on the first.", "Do that for a decision that is also worrying you.", "Time spent on what you can't control is wasted."),
      gwA("dec4", "Trade-offs", 10, "Write one advantage and one cost of an option.", "Write the main trade-off of each option: what you gain and what you give up.", "Ask one person who has faced the same choice.", "Every option costs something; knowing what makes choosing easier."),
      gwA("dec5", "Deadline", 5, "Pick a day for when you will decide.", "Set a decision deadline and write it where you'll see it.", "Set the deadline and tell one person.", "A decision without a deadline can stay open forever."),
      gwA("dec6", "Smallest reversible step", 10, "Find one small step that would teach you something.", "Choose the smallest reversible next step and do it today.", "Do that step and decide based on what you learn.", "A small step gives you information without locking you in."),
      gwA("dec7", "Deciding quickly", 5, "Decide one tiny matter (what to eat) within 30 seconds.", "Make one small decision in under two minutes, and don't revisit it.", "Make three small decisions quickly and stick to all of them.", "Practising fast decisions on small things builds trust in your judgement.")
    ],
    emotional: [
      gwA("emo1", "Pause before reacting", 3, "Take one slow breath before you answer someone today.", "When you feel irritated, pause for five slow breaths before you reply.", "Pause every time you feel irritated today.", "The pause is where you get a choice back."),
      gwA("emo2", "Naming the emotion", 3, "Name what you feel once today (for example \"annoyed\").", "Name your emotion in one word each time it gets strong.", "Name it, and rate it from 1 to 10.", "Naming a feeling makes it less overwhelming."),
      gwA("emo3", "Finding the trigger", 5, "Note one moment today when your mood changed.", "Identify what triggered your last strong feeling.", "Write down the trigger and what you told yourself.", "You can only change a pattern you can see."),
      gwA("emo4", "Choosing a response", 5, "Before responding, think of one calmer way to reply.", "Choose a response instead of an impulse: decide what you want before you speak.", "Do this in a real disagreement.", "Reacting is automatic; responding is a decision."),
      gwA("emo5", "Recording what happened", 5, "Write one line about a difficult moment today.", "After a strong feeling, note what happened and how you handled it.", "Note what you'd do differently next time.", "A short record shows your real patterns, not just how it felt."),
      gwA("emo6", "Cooling down", 10, "Step away for two minutes when you feel heated.", "When you feel heated, walk or make wudu for 10 minutes before continuing.", "Use a cooling-down step before every difficult conversation.", "Physical movement or water helps the body settle."),
      gwA("emo7", "What went well", 5, "Note one moment you stayed calm.", "Write down one moment this week when you handled a feeling well.", "Write down what helped you do it.", "Noticing what worked lets you repeat it.")
    ],
    time: [
      gwA("time1", "Top 3 tasks", 5, "Write down one thing that must be done today.", "Choose your Top 3 tasks for today and write them down.", "Choose your Top 3 and do the first before anything else.", "If everything is a priority, nothing gets done."),
      gwA("time2", "Estimating time", 5, "Guess how long one task will take and write it down.", "Estimate how long each of your tasks will take, then time the first.", "Estimate and time all three.", "Your estimates only improve when you compare them with what really happened."),
      gwA("time3", "A focus block", 25, "Book 15 minutes for one task at a specific time.", "Schedule one 25–45 minute focus block at a fixed time and keep it.", "Schedule two focus blocks and keep both.", "A task with a set time gets done more often than one with none."),
      gwA("time4", "Where time goes", 10, "Note what you did in one hour today.", "Note where your time went for a few hours of the day. Find one time-waster.", "Track a full day and pick the biggest one.", "You can't fix a leak you haven't found."),
      gwA("time5", "Planned vs actual", 10, "Compare one planned task with how long it really took.", "Compare your plan with what actually happened today.", "Compare and adjust tomorrow's plan.", "The gap between plan and reality is where you learn."),
      gwA("time6", "Planning tomorrow", 5, "Write one task for tomorrow before you sleep.", "Plan tomorrow tonight: Top 3 and when you'll do them.", "Plan tomorrow, and prepare the first task.", "Starting the day with a plan saves the first hour."),
      gwA("time7", "Protecting a block", 25, "Tell one person you're unavailable for 20 minutes.", "Protect one block of time from interruptions.", "Protect two blocks today.", "Your time is only protected if you say it is.")
    ],
    resilience: [
      gwA("res1", "What happened?", 5, "Think of one recent setback and describe it in one sentence.", "Write down what actually happened in a recent setback, facts only.", "Do that for two setbacks.", "Facts come first, before the story you tell yourself about it."),
      gwA("res2", "What I control", 5, "Write one part of it that was under your control.", "Write what was under your control and what wasn't.", "Do that and note what you'd do the same next time.", "You can only improve the part you control."),
      gwA("res3", "Smallest recovery action", 5, "Write one tiny step to recover.", "Choose the next smallest recovery action.", "Choose it and set a time for it.", "Recovery starts with one small step, not a full restart."),
      gwA("res4", "Doing the recovery step", 10, "Do the first minute of your recovery step.", "Do your smallest recovery action today.", "Do it, then take one more step.", "Doing it once beats planning it perfectly."),
      gwA("res5", "Talking to yourself kindly", 5, "Write one sentence you'd say to a friend in your place.", "Write what you'd say to a friend in this situation, then apply it to yourself.", "Say it out loud to yourself.", "You are usually fairer to others than to yourself."),
      gwA("res6", "Restarting small", 10, "Restart something you dropped, for two minutes only.", "Restart something you dropped, using its minimum version.", "Restart it and plan the next three days.", "A small restart works better than waiting to feel ready."),
      gwA("res7", "Setbacks you survived", 10, "Write down one difficult thing you got through.", "List three setbacks you have already got through and what helped.", "Add what each one taught you.", "Your record of recoveries is real evidence you can do it again.")
    ],
    awareness: [
      gwA("awa1", "What gave me energy?", 5, "Note one thing that gave you energy today.", "Write down what gave you energy today.", "Write what gave you energy and how you can get more of it.", "Knowing what helps you lets you plan for it."),
      gwA("awa2", "What drained me?", 5, "Note one thing that drained you today.", "Write down what drained you today.", "Write what drained you and one way to reduce it.", "What drains you is often changeable once it is visible."),
      gwA("awa3", "What did I avoid?", 5, "Note one thing you put off today.", "Write down what you avoided today and why.", "Write what you avoided and the smallest step towards it.", "Avoidance is usually the clearest sign of what matters."),
      gwA("awa4", "What I handled well", 5, "Note one thing you did well today.", "Write down what you handled well today.", "Write what you did that made it work.", "Noticing your strengths makes you use them on purpose."),
      gwA("awa5", "A pattern", 5, "Look at your last few days: is anything repeating?", "Write down one pattern you noticed this week.", "Write the pattern and what usually comes before it.", "Patterns you can see are patterns you can change."),
      gwA("awa6", "An honest view", 10, "Think of one person whose honest opinion you'd trust.", "Ask one trusted person for one honest observation about you.", "Ask, listen without defending, and write down what they said.", "Others often see what we can't see about ourselves."),
      gwA("awa7", "What matters most", 10, "Write down one thing that matters to you.", "Write one sentence about what matters most to you right now.", "Compare that to how you spent this week.", "Your priorities only guide you if they are clear and written.")
    ],
    courage: [
      gwA("cou1", "Easy discomfort", 5, "Do one small uncomfortable thing, such as a cold splash on your face.", "Do one safe, slightly uncomfortable thing you'd normally skip.", "Do two safe uncomfortable things.", "Small discomforts teach you that you can handle more than you expect."),
      gwA("cou2", "A small ask", 5, "Ask a shopkeeper a simple question.", "Ask for something small: help, a discount, or a favour.", "Ask for something and accept a possible \"no\".", "Most fear of asking is bigger than what happens when you ask."),
      gwA("cou3", "Speaking first", 3, "Say \"excuse me\" or \"hi\" first to a stranger.", "Speak first to someone in a queue or waiting area.", "Speak first and keep the chat going for a minute.", "Being first stops the waiting."),
      gwA("cou4", "The avoided thing", 10, "Do one minute of something you have avoided for two days.", "Do something you've been avoiding for two days or more.", "Finish it today.", "The first step is what breaks the avoidance."),
      gwA("cou5", "Saying no", 5, "Practise a polite \"no\" out loud once.", "Say a polite \"no\" to one thing that doesn't fit your priorities.", "Say no and don't over-explain.", "Saying no protects your yes."),
      gwA("cou6", "Asking in public", 10, "Write down a question you'd like to ask in class or a group.", "Ask a real question in a class, meeting or group.", "Ask a question and follow up on the answer.", "Someone else is usually thinking the same question."),
      gwA("cou7", "One meaningful step", 15, "Write down one thing you're afraid of and its smallest first step.", "Take one small, safe step towards something that matters to you but scares you.", "Take the step and tell one person about it.", "Courage is acting while still feeling afraid, not being fearless.")
    ]
  };

  // ---- Assessment (14 questions) ----
  // choice option weights add "needs work" points to tracks; scale questions
  // convert low/high answers to points. Nothing here diagnoses anything.

  var GW_QUESTIONS = [
    { id: "priority", type: "choice", text: "Which area would make the biggest difference in your life right now?", options: [
      { label: "Confidence & speaking up", w: { confidence: 3 } },
      { label: "Communication & social skills", w: { communication: 2, social: 2 } },
      { label: "Discipline & consistency", w: { discipline: 2, consistency: 2 } },
      { label: "Focus & procrastination", w: { focus: 3 } },
      { label: "Time management", w: { time: 3 } },
      { label: "Making decisions", w: { decisions: 3 } },
      { label: "Emotional control", w: { emotional: 3 } },
      { label: "Bouncing back after failure", w: { resilience: 3 } },
      { label: "Knowing myself better", w: { awareness: 3 } },
      { label: "Facing things I fear", w: { courage: 3 } }
    ], reason: { _all: "this is the area you said would change the most for you" } },
    { id: "newpeople", type: "scale", text: "How confident are you starting a conversation with someone new?", low: "Not at all", high: "Very", dir: "low", w: { confidence: 1, social: 1 },
      reason: { confidence: "starting conversations with new people feels hard for you", social: "starting conversations with new people feels hard for you" } },
    { id: "complete", type: "scale", text: "When you decide to do something difficult, how often do you actually complete it?", low: "Rarely", high: "Almost always", dir: "low", w: { discipline: 1, consistency: 1 },
      reason: { discipline: "you often don't finish difficult things you decide to do", consistency: "you often don't finish difficult things you decide to do" } },
    { id: "stops", type: "choice", text: "What usually stops you from taking action?", options: [
      { label: "Fear of embarrassment", w: { confidence: 2, courage: 2 }, tag: "Fear of embarrassment" },
      { label: "Low energy or laziness", w: { discipline: 3 }, tag: "Low energy or laziness" },
      { label: "Distractions (phone, apps)", w: { focus: 3 }, tag: "Distractions" },
      { label: "No clear plan", w: { time: 2, decisions: 2 }, tag: "No clear plan" },
      { label: "Overthinking", w: { decisions: 2, confidence: 1, awareness: 1 }, tag: "Overthinking before acting" },
      { label: "Forgetting", w: { consistency: 3 }, tag: "Forgetting" }
    ], reason: { courage: "fear of embarrassment often stops you from acting", confidence: "fear or overthinking often stops you from acting", discipline: "low energy often stops you from acting", focus: "distractions often stop you from acting", time: "not having a clear plan often stops you from acting", decisions: "not having a clear plan or overthinking stops you from acting", consistency: "forgetting is what often stops you", awareness: "overthinking often stops you from acting" } },
    { id: "afterfail", type: "choice", text: "What happens after you fail or miss one day?", options: [
      { label: "I restart quickly", w: {} },
      { label: "I feel bad but continue", w: { resilience: 1 } },
      { label: "I usually drop it for days", w: { resilience: 3, consistency: 2 } },
      { label: "I tend to give up on it", w: { resilience: 3, consistency: 3 } }
    ], reason: { resilience: "one missed day often turns into several", consistency: "one missed day often turns into several" } },
    { id: "embarrass", type: "scale", text: "Do you avoid situations because you're afraid of embarrassment?", low: "Never", high: "Very often", dir: "high", w: { courage: 1, confidence: 1 },
      reason: { courage: "you often avoid situations for fear of embarrassment", confidence: "you often avoid situations for fear of embarrassment" } },
    { id: "procrastinate", type: "scale", text: "How often do you procrastinate even when you know what you need to do?", low: "Rarely", high: "Very often", dir: "high", w: { focus: 1, discipline: 1 },
      reason: { focus: "you often put things off even when you know what to do", discipline: "you often put things off even when you know what to do" } },
    { id: "sayno", type: "choice", text: "Can you clearly say no when something goes against your priorities?", options: [
      { label: "Yes, without much trouble", w: {} },
      { label: "Sometimes", w: { discipline: 1, confidence: 1 } },
      { label: "Rarely", w: { discipline: 2, confidence: 2, courage: 1 } }
    ], reason: { confidence: "saying no is hard for you", discipline: "saying no is hard for you", courage: "saying no is hard for you" } },
    { id: "anger", type: "choice", text: "When you get angry or frustrated, how quickly do you react?", options: [
      { label: "Straight away, before I think", w: { emotional: 3 } },
      { label: "After a short moment", w: { emotional: 1 } },
      { label: "I usually pause first", w: {} }
    ], reason: { emotional: "you tend to react quickly when you're frustrated" } },
    { id: "organized", type: "scale", text: "How organised is your normal day?", low: "Not at all", high: "Very", dir: "low", w: { time: 1, focus: 1 },
      reason: { time: "your days feel unplanned", focus: "your days feel unplanned" } },
    { id: "decide", type: "choice", text: "How do you handle a decision you've been putting off?", options: [
      { label: "I leave it open for a long time", w: { decisions: 3 } },
      { label: "I decide fast, then doubt it", w: { decisions: 2, emotional: 1 } },
      { label: "I break it into steps and decide", w: {} }
    ], reason: { decisions: "decisions tend to stay open or get second-guessed", emotional: "decisions tend to get second-guessed" } },
    { id: "patterns", type: "scale", text: "How well do you notice why you do what you do (your patterns and triggers)?", low: "Not really", high: "Quite well", dir: "low", w: { awareness: 1, emotional: 1 },
      reason: { awareness: "you don't often notice your own patterns and triggers", emotional: "you don't often notice your own patterns and triggers" } },
    { id: "time", type: "choice", text: "How much time can you realistically give to personal growth each day?", options: [
      { label: "5 min", w: {}, minutes: 5 },
      { label: "10 min", w: {}, minutes: 10 },
      { label: "15 min", w: {}, minutes: 15 },
      { label: "30+ min", w: {}, minutes: 30 }
    ], reason: {} },
    { id: "goal", type: "text", text: "What is one thing you want to improve about yourself in the next 30 days?", placeholder: "In your own words (optional)", w: {}, reason: {} }
  ];

  // Analyse saved answers with plain rules. Returns scores per track, the
  // chosen primary/secondary focus and which answer weighed most for the primary.
  function gwAnalyse(answers) {
    var scores = {}, contrib = {};
    GW_TRACKS.forEach(function (t) { scores[t.key] = 0; contrib[t.key] = []; });
    function add(track, pts, qid) {
      if (!pts) return;
      scores[track] += pts;
      contrib[track].push({ q: qid, pts: pts });
    }
    GW_QUESTIONS.forEach(function (q) {
      var a = answers[q.id];
      if (a === undefined || a === null || a === "") return;
      if (q.type === "scale") {
        var pts = q.dir === "low" ? 5 - a : a - 1;
        Object.keys(q.w).forEach(function (t) { add(t, pts * q.w[t], q.id); });
      } else if (q.type === "choice") {
        var opt = q.options[a];
        if (opt) Object.keys(opt.w).forEach(function (t) { add(t, opt.w[t], q.id); });
      }
    });
    var order = GW_TRACKS.map(function (t) { return t.key; });
    var declared = answers.priority !== undefined ? Object.keys(GW_QUESTIONS[0].options[answers.priority].w) : [];
    var ranked = order.slice().sort(function (a, b) {
      if (scores[b] !== scores[a]) return scores[b] - scores[a];
      var da = declared.indexOf(a) !== -1 ? 1 : 0, db = declared.indexOf(b) !== -1 ? 1 : 0;
      if (db !== da) return db - da;
      return order.indexOf(a) - order.indexOf(b);
    });
    var primary = ranked[0];
    var secondary = ranked[1];
    var strongest = order.slice().sort(function (a, b) { return scores[a] - scores[b] || order.indexOf(a) - order.indexOf(b); }).slice(0, 2);
    // the answer that weighed most for the primary track explains why
    var best = contrib[primary].slice().sort(function (a, b) { return b.pts - a.pts; })[0];
    var reason = "";
    if (best) {
      var q = GW_QUESTIONS.filter(function (x) { return x.id === best.q; })[0];
      reason = (q.reason[primary] || q.reason._all || "");
    }
    var stopQ = GW_QUESTIONS[3];
    var obstacle = answers.stops !== undefined && stopQ.options[answers.stops] ? stopQ.options[answers.stops].tag : "";
    var timeOpt = answers.time !== undefined ? GW_QUESTIONS[12].options[answers.time] : null;
    var startLevel = (answers.complete !== undefined && answers.complete >= 5) ? 2 : 1;
    return { scores: scores, primary: primary, secondary: secondary, strongest: strongest, reason: reason, obstacle: obstacle, minutes: timeOpt ? timeOpt.minutes : 10, startLevel: startLevel };
  }

  // ---- storage (all local; every read tolerates missing/corrupted data) ----
  function gwProfile() {
    var p = readJSON("nc_pg_profile", null);
    return p && typeof p === "object" && !Array.isArray(p) ? p : null;
  }
  function gwSaveProfile(p) { writeJSON("nc_pg_profile", p); }
  function gwDraft() {
    var d = readJSON("nc_pg_draft", null);
    return d && typeof d === "object" && d.answers && typeof d.answers === "object" ? d : null;
  }
  function gwMissions() { var m = readJSON("nc_pg_missions", []); return Array.isArray(m) ? m : []; }
  function gwSaveMissions(m) { writeJSON("nc_pg_missions", m); }
  function gwHistory() { var h = readJSON("nc_pg_history", []); return Array.isArray(h) ? h : []; }
  function gwSaveHistory(h) { writeJSON("nc_pg_history", h); }
  function gwToday() {
    var t = readJSON("nc_pg_today", null);
    return t && typeof t === "object" && t.date === todayKey() ? t : { date: todayKey() };
  }
  function gwSaveToday(t) { t.date = todayKey(); writeJSON("nc_pg_today", t); }
  function gwTrack(key) { return GW_TRACKS.filter(function (t) { return t.key === key; })[0] || null; }
  function gwAction(track, id) { return (GW_LIB[track] || []).filter(function (a) { return a.id === id; })[0] || null; }
  function gwActiveMission() {
    var p = gwProfile();
    if (!p || !p.activeMissionId) return null;
    return gwMissions().filter(function (m) { return m.id === p.activeMissionId; })[0] || null;
  }

  // ---- missions ----
  var GW_WEEK_ORDER = [
    [0, 1, 2, 3, 4, 5, 6],
    [2, 3, 4, 0, 1, 5, 6],
    [1, 2, 4, 6, 3, 5, 0],
    [null, null, null, null, null, null, null]
  ];

  function gwNewMission(track, weekNo) {
    var order = GW_WEEK_ORDER[Math.min(3, weekNo - 1)];
    var days = order.map(function (idx, i) {
      var action = idx === null ? null : GW_LIB[track][idx];
      return { n: i + 1, actionId: action ? action.id : null, text: null, level: null, status: null, date: null, couldnt: 0, swaps: 0 };
    });
    return { id: uid("gm"), track: track, weekNo: weekNo, startDate: todayKey(), createdAt: new Date().toISOString(), status: "active", days: days };
  }

  // Start (or resume) a mission for a track. Missions of other tracks are only
  // paused, never deleted, so their history and progress stay.
  function gwStartTrack(track, weekNo) {
    var p = gwProfile() || {};
    var missions = gwMissions();
    missions.forEach(function (m) { if (m.id === p.activeMissionId && m.status === "active") m.status = "paused"; });
    var existing = weekNo ? null : missions.filter(function (m) { return m.track === track && m.status !== "completed"; })[0];
    var m = existing;
    if (m) m.status = "active";
    else { m = gwNewMission(track, weekNo || 1); missions.push(m); }
    gwSaveMissions(missions);
    p.activeMissionId = m.id;
    p.primaryFocus = p.primaryFocus || track;
    p.currentFocus = track;
    gwSaveProfile(p);
    return m;
  }

  function gwLevelFor(track, weekNo) {
    var p = gwProfile() || {};
    var lv = p.trackLevels && p.trackLevels[track] !== undefined ? p.trackLevels[track] : (p.startLevel !== undefined ? p.startLevel : 1);
    if (weekNo === 3) lv = Math.min(2, lv + 1);
    return Math.max(0, Math.min(2, lv));
  }

  // The current day of a mission = first day not yet done/skipped.
  function gwCurrentDay(m) {
    for (var i = 0; i < m.days.length; i++) if (m.days[i].status === null) return m.days[i];
    return null;
  }

  // Fill in the wording for a day the first time it is shown. Once shown it is
  // frozen, so a reload never changes today's challenge.
  function gwRevealDay(m, day) {
    if (day.text || !day.actionId) return;
    var a = gwAction(m.track, day.actionId);
    day.level = gwLevelFor(m.track, m.weekNo);
    day.text = a.t[day.level];
    var ms = gwMissions();
    ms.forEach(function (x) { if (x.id === m.id) x.days = m.days; });
    gwSaveMissions(ms);
  }

  function gwSaveMission(m) {
    var ms = gwMissions();
    ms.forEach(function (x, i) { if (x.id === m.id) ms[i] = m; });
    gwSaveMissions(ms);
  }

  // ---- history ----
  var GW_RANK = { completed: 3, partial: 2, couldnt: 1 };
  function gwDayStatus(hist, date) {
    var best = null;
    hist.forEach(function (e) {
      if (e.date === date && (!best || GW_RANK[e.status] > GW_RANK[best])) best = e.status;
    });
    return best;
  }
  function gwAddEntry(entry) {
    var h = gwHistory().filter(function (e) {
      return !(e.date === entry.date && e.missionId === entry.missionId && e.planDay === entry.planDay && e.status === entry.status && !!e.smaller === !!entry.smaller);
    });
    h.push(entry);
    gwSaveHistory(h);
  }

  // Counters kept on the profile, recomputed from history so they never drift.
  function gwRecount() {
    var p = gwProfile();
    if (!p) return;
    var h = gwHistory();
    var active = {};
    var completed = 0, skipped = 0, last = null;
    h.forEach(function (e) {
      if (e.status === "completed" || e.status === "partial") { active[e.date] = true; }
      if (e.status === "completed") completed++;
      if (e.status === "couldnt") skipped++;
      if (!last || e.date > last) last = e.date;
    });
    p.totalGrowthDays = Object.keys(active).length;
    p.completedChallenges = completed;
    p.skippedChallenges = skipped;
    p.lastActiveDate = last;
    gwSaveProfile(p);
  }

  // Adapt the next challenges (never punish). Levels: 0 smaller, 1 normal, 2 stretch.
  function gwAdapt(track, status, difficulty) {
    var p = gwProfile();
    if (!p) return;
    p.trackLevels = p.trackLevels || {};
    p.easyStreak = p.easyStreak || {};
    var lv = p.trackLevels[track] !== undefined ? p.trackLevels[track] : (p.startLevel !== undefined ? p.startLevel : 1);
    var es = p.easyStreak[track] || 0;
    if (status === "couldnt") { lv = 0; es = 0; }
    else if (status === "completed" && difficulty === "easy") {
      es++;
      if (es >= 2 && lv < 2) { lv++; es = 0; }
      else if (lv === 0) { lv = 1; es = 0; }
    } else if (status === "completed") {
      if (lv === 0) lv = 1;
      es = 0;
    } else { es = 0; }
    p.trackLevels[track] = lv;
    p.easyStreak[track] = es;
    gwSaveProfile(p);
  }

  // Save one result. Returns the updated mission.
  function gwSaveResult(m, day, status, fields) {
    var today = todayKey();
    var entry = {
      id: uid("ge"), date: today, missionId: m.id, area: m.track, planDay: day.n, weekNo: m.weekNo,
      challenge: day.text, actionId: day.actionId, skill: (gwAction(m.track, day.actionId) || {}).skill || "",
      level: day.level, status: status, difficulty: fields.difficulty || null, feeling: fields.feeling || null,
      obstacle: fields.obstacle || null, reflection: (fields.reflection || "").trim().slice(0, 300),
      smaller: !!fields.smaller, completedAt: new Date().toISOString()
    };
    gwAddEntry(entry);
    if (status === "completed" || status === "partial") {
      day.status = status;
      day.date = today;
    } else {
      day.couldnt = (day.couldnt || 0) + 1;
      if (day.couldnt >= 2) { day.status = "skipped"; day.date = today; }
    }
    if (m.days.every(function (d) { return d.status !== null; })) m.status = "completed";
    gwSaveMission(m);
    gwAdapt(m.track, status, fields.difficulty);
    gwRecount();
    memLog("personal_growth_completed", "personalGrowth", { track: m.track, result: status, planDay: day.n });
    return m;
  }

  // ---- weekly report (all values come from saved history) ----
  function gwWeekData(keys) {
    var hist = gwHistory();
    var days = keys.slice().reverse().map(function (k) { return { key: k, status: gwDayStatus(hist, k) }; });
    var set = {};
    keys.forEach(function (k) { set[k] = true; });
    var entries = hist.filter(function (e) { return set[e.date]; });
    var r = { days: days, entries: entries, completed: 0, partial: 0, couldnt: 0, byTrack: {}, missed: 0 };
    days.forEach(function (d) {
      if (d.status === "completed") r.completed++;
      else if (d.status === "partial") r.partial++;
      else if (d.status === "couldnt") r.couldnt++;
    });
    var seen = {};
    entries.forEach(function (e) {
      if (e.status !== "completed") return;
      var k = e.date + "|" + e.area;
      if (seen[k]) return;
      seen[k] = true;
      r.byTrack[e.area] = (r.byTrack[e.area] || 0) + 1;
    });
    // missed = days without any entry, counted from the first day with any history
    var firstDate = null;
    hist.forEach(function (e) { if (!firstDate || e.date < firstDate) firstDate = e.date; });
    days.forEach(function (d) { if (firstDate && d.key >= firstDate && !d.status && d.key <= todayKey()) r.missed++; });
    // skill with most hard/couldn't and the skill completed easily most often
    var hard = {}, easy = {};
    entries.forEach(function (e) {
      if (!e.skill) return;
      if (e.status === "couldnt" || e.difficulty === "hard") hard[e.skill] = (hard[e.skill] || 0) + 1;
      if (e.status === "completed" && e.difficulty === "easy") easy[e.skill] = (easy[e.skill] || 0) + 1;
    });
    function top(o) { var b = null; Object.keys(o).forEach(function (k) { if (!b || o[k] > o[b]) b = k; }); return b; }
    r.hardest = top(hard);
    r.easiest = top(easy);
    // returned after a gap: a day with an entry that follows a day without one, inside the window
    r.recovered = false;
    for (var i = 1; i < days.length; i++) {
      if (days[i].status && !days[i - 1].status && days[i - 1].key >= (firstDate || "9999")) r.recovered = true;
    }
    var reflected = entries.filter(function (e) { return e.reflection; }).sort(function (a, b) { return a.completedAt < b.completedAt ? 1 : -1; })[0];
    r.lastReflection = reflected ? reflected.reflection : null;
    var primaryTrack = null;
    Object.keys(r.byTrack).forEach(function (t) { if (!primaryTrack || r.byTrack[t] > r.byTrack[primaryTrack]) primaryTrack = t; });
    r.mostWorked = primaryTrack;
    r.total = entries.length;
    return r;
  }
  function gwThisWeek() { return gwWeekData(getLastNDateKeys(7)); }
  function gwLastWeek() { return gwWeekData(getLastNDateKeys(14).slice(7)); }

  // Plain-language summary. Only says what the numbers support.
  function gwWeekSummary(w, prev) {
    if (w.total < 2) return null;
    var s = "You completed " + w.completed + " of 7 actions this week" + (w.partial ? " and " + w.partial + " partly" : "") + ".";
    if (w.hardest) s += " " + w.hardest + " was the hardest area, so we'll keep practising it at a manageable level.";
    if (prev.total > 0) {
      s += w.completed > prev.completed ? " That's more completed challenges than last week."
        : w.completed < prev.completed ? " That's fewer completed challenges than last week, and that's fine — you can pick it up again."
        : " That's the same number of completed challenges as last week.";
    }
    return s;
  }

  function gwProgressRows() {
    var h = gwHistory();
    if (!h.length) return [];
    var w = gwThisWeek();
    var rows = [{ label: "Personal Growth — actions completed (7 days)", value: w.completed + " / 7" }];
    var p = gwProfile();
    if (p && p.currentFocus && gwTrack(p.currentFocus)) rows.push({ label: "Personal Growth — current focus", value: gwTrack(p.currentFocus).label });
    if (w.partial) rows.push({ label: "Personal Growth — partly done", value: String(w.partial) });
    return rows;
  }

  // ---- UI ----
  var gwView = { screen: "home" };

  function gwEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function gwBtn(label, cls, fn) {
    var b = gwEl("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function gwGo(screen, extra) {
    var v = extra || {};
    v.screen = screen;
    gwView = v;
    renderDuniyaGrowth();
  }
  function gwAddDays(key, n) {
    var d = new Date(key + "T12:00:00");
    d.setDate(d.getDate() + n);
    return todayKey(d);
  }
  function gwFmtDate(key) {
    return new Date(key + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function gwRows(rows) {
    var box = gwEl("div", "money-cost-breakdown");
    rows.forEach(function (r) {
      var row = gwEl("div", "row" + (r[2] ? " highlight" : ""));
      row.appendChild(gwEl("span", "", r[0]));
      row.appendChild(gwEl("span", "", r[1]));
      box.appendChild(row);
    });
    return box;
  }
  function gwBar(done, total) {
    var track = gwEl("div", "plan-progress-track");
    var fill = gwEl("div", "plan-progress-fill");
    fill.style.width = (total ? Math.round((done / total) * 100) : 0) + "%";
    track.appendChild(fill);
    return track;
  }
  function gwWeekGraph(w) {
    var row = gwEl("div", "rec-week-row");
    w.days.forEach(function (d) {
      var wrap = gwEl("div", "rec-bar-wrap");
      wrap.appendChild(gwEl("div", "rec-bar" + (d.status === "completed" ? " clean" : d.status === "partial" ? " slip" : "")));
      wrap.appendChild(gwEl("span", "rec-label", new Date(d.key + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3) + (d.status === "completed" ? " ✓" : d.status === "partial" ? " ½" : " —")));
      row.appendChild(wrap);
    });
    return row;
  }

  function renderDuniyaGrowth() {
    var content = document.getElementById("duniya-growth-content");
    if (!content) return;
    content.innerHTML = "";
    var p = gwProfile();
    var s = gwView.screen;
    if (s === "assess") return renderGwAssess(content);
    if (s === "result" && p && p.assessmentCompleted) return renderGwResult(content, p);
    if (!p || !p.assessmentCompleted) {
      if (s !== "assess") return renderGwIntro(content, p);
    }
    if (s === "reflect") return renderGwReflect(content);
    if (s === "reflect-done") return renderGwReflectDone(content);
    if (s === "progress") return renderGwProgress(content, p);
    if (s === "focus") return renderGwFocus(content, p);
    renderGwHome(content, p);
  }

  // ---- first-time assessment ----

  function renderGwIntro(content, p) {
    content.appendChild(gwEl("h2", "", "Personal Growth"));
    content.appendChild(gwEl("p", "muted-line", "Let's understand where you are right now so NURA can give you practical challenges that actually fit you."));
    var d = gwDraft();
    var note = gwEl("p", "muted-line", GW_QUESTIONS.length + " quick questions, about 2 minutes. Your answers stay on this device.");
    note.style.margin = "12px 0";
    content.appendChild(note);
    if (d && d.step > 0) {
      content.appendChild(gwBtn("Continue (Question " + (d.step + 1) + " of " + GW_QUESTIONS.length + ")", "btn btn-primary btn-full", function () { gwGo("assess", { step: d.step }); }));
      content.appendChild(gwBtn("Start again", "btn btn-outline btn-full", function () { writeJSON("nc_pg_draft", { step: 0, answers: {} }); gwGo("assess", { step: 0 }); }));
    } else {
      content.appendChild(gwBtn("Start", "btn btn-primary btn-full", function () { gwGo("assess", { step: 0 }); }));
    }
  }

  function renderGwAssess(content) {
    var draft = gwDraft() || { step: 0, answers: {} };
    var step = gwView.step !== undefined ? gwView.step : draft.step || 0;
    step = Math.max(0, Math.min(GW_QUESTIONS.length - 1, step));
    var q = GW_QUESTIONS[step];
    var answers = draft.answers;
    function persist() { writeJSON("nc_pg_draft", { step: step, answers: answers }); }
    persist();

    content.appendChild(gwBtn("← Back", "picker-step-back", function () {
      if (step > 0) gwGo("assess", { step: step - 1 });
      else gwGo("home");
    }));
    content.appendChild(gwEl("p", "muted-line", "Question " + (step + 1) + " of " + GW_QUESTIONS.length));
    content.appendChild(gwBar(step + 1, GW_QUESTIONS.length));
    var h = gwEl("h2", "", q.text);
    h.style.margin = "12px 0";
    content.appendChild(h);

    if (q.type === "choice") {
      q.options.forEach(function (o, i) {
        content.appendChild(gwBtn((answers[q.id] === i ? "● " : "○ ") + o.label, "rec-action" + (answers[q.id] === i ? " done" : ""), function () {
          answers[q.id] = i;
          persist();
          renderDuniyaGrowth();
        }));
      });
    } else if (q.type === "scale") {
      var row = gwEl("div", "money-quick-actions");
      row.style.justifyContent = "space-between";
      [1, 2, 3, 4, 5].forEach(function (n) {
        var b = gwBtn(String(n), "preset-plan-chip" + (answers[q.id] === n ? " active-chip" : ""), function () {
          answers[q.id] = n;
          persist();
          renderDuniyaGrowth();
        });
        b.style.flex = "1";
        b.style.minHeight = "48px";
        row.appendChild(b);
      });
      content.appendChild(row);
      var ends = gwEl("div", "");
      ends.style.display = "flex";
      ends.style.justifyContent = "space-between";
      ends.appendChild(gwEl("span", "muted-line", "1 = " + q.low));
      ends.appendChild(gwEl("span", "muted-line", "5 = " + q.high));
      content.appendChild(ends);
    } else {
      var t = gwEl("textarea", "text-input rec-textarea");
      t.placeholder = q.placeholder || "";
      t.maxLength = 200;
      t.value = answers[q.id] || "";
      t.addEventListener("input", function () { answers[q.id] = t.value; persist(); });
      content.appendChild(t);
    }

    var last = step === GW_QUESTIONS.length - 1;
    var next = gwBtn(last ? "Save & Continue" : "Next", "btn btn-primary btn-full", function () {
      if (q.type !== "text" && answers[q.id] === undefined) { showToast("Choose an answer to continue"); return; }
      if (last) { gwFinishAssessment(answers); return; }
      gwGo("assess", { step: step + 1 });
    });
    next.style.marginTop = "14px";
    content.appendChild(next);
  }

  function gwFinishAssessment(answers) {
    var r = gwAnalyse(answers);
    var old = gwProfile();
    var p = old || {};
    var history = Array.isArray(p.assessmentHistory) ? p.assessmentHistory : [];
    if (old && old.assessmentCompleted) history.push({ date: old.assessmentDate, answers: old.answers, primaryFocus: old.primaryFocus, secondaryFocus: old.secondaryFocus });
    p.assessmentCompleted = true;
    p.assessmentDate = new Date().toISOString();
    p.answers = answers;
    p.scores = r.scores;
    p.strongestAreas = r.strongest;
    p.improvementAreas = [r.primary, r.secondary];
    p.primaryFocus = r.primary;
    p.secondaryFocus = r.secondary;
    p.currentLevel = r.startLevel;
    p.startLevel = r.startLevel;
    p.obstacle = r.obstacle;
    p.reason = r.reason;
    p.dailyMinutes = r.minutes;
    p.goalText = (answers.goal || "").trim();
    p.currentFocus = p.currentFocus && old && old.activeMissionId ? p.currentFocus : r.primary;
    p.trackLevels = p.trackLevels || {};
    p.easyStreak = p.easyStreak || {};
    p.assessmentHistory = history;
    if (p.totalGrowthDays === undefined) { p.totalGrowthDays = 0; p.completedChallenges = 0; p.skippedChallenges = 0; p.lastActiveDate = null; p.activeMissionId = null; }
    gwSaveProfile(p);
    localStorage.removeItem("nc_pg_draft");
    gwGo("result");
  }

  function renderGwResult(content, p) {
    var prim = gwTrack(p.primaryFocus), sec = gwTrack(p.secondaryFocus);
    content.appendChild(gwEl("h2", "", "Your current focus"));
    content.appendChild(gwRows([
      ["Primary focus", prim.label, true],
      ["Secondary focus", sec.label],
      ["Biggest obstacle", p.obstacle || "Not clear yet"],
      ["Available daily time", p.dailyMinutes + " minutes"]
    ]));
    var why = "Based on your answers, " + (p.reason || "this is where small actions will help most") + ". We'll begin with " + prim.approach + ".";
    content.appendChild(gwEl("p", "rec-note", why));
    if (p.goalText) content.appendChild(gwEl("p", "muted-line", "Your 30-day goal: " + p.goalText));
    var strong = (p.strongestAreas || []).map(function (k) { return gwTrack(k).label; }).join(" and ");
    if (strong) content.appendChild(gwEl("p", "muted-line", "Already comparatively strong: " + strong + "."));
    var start = gwBtn("START MY GROWTH PLAN", "btn btn-primary btn-full", function () {
      gwStartTrack(p.primaryFocus);
      gwGo("home");
    });
    start.style.marginTop = "14px";
    content.appendChild(start);
    content.appendChild(gwBtn("Choose another area", "priority-change-link", function () { gwGo("focus"); }));
  }

  // ---- home / today ----

  function renderGwHome(content, p) {
    var m = gwActiveMission();
    content.appendChild(gwEl("h2", "", "Personal Growth"));
    content.appendChild(gwEl("p", "muted-line", "Become a little stronger through action."));
    if (!m) {
      var tr = gwTrack(p.currentFocus || p.primaryFocus);
      content.appendChild(gwEl("p", "", "You haven't started a plan yet.")).style.margin = "14px 0 8px";
      content.appendChild(gwBtn("Start my " + tr.label + " plan", "btn btn-primary btn-full", function () { gwStartTrack(tr.key); gwGo("home"); }));
      gwRenderExplore(content, p, null);
      return;
    }
    var track = gwTrack(m.track);
    var today = todayKey();
    var t = gwToday();
    var hist = gwHistory();
    var doneDay = m.days.filter(function (d) { return d.date === today && (d.status === "completed" || d.status === "partial" || d.status === "skipped"); })[0];
    var day = gwCurrentDay(m);

    // missed-day note (never shaming)
    var yesterday = gwAddDays(today, -1);
    if (!doneDay && hist.length && !gwDayStatus(hist, yesterday) && !t.missedDismissed && p.lastActiveDate && p.lastActiveDate < yesterday) {
      var note = gwEl("div", "money-wait-banner");
      note.appendChild(gwEl("p", "", "You missed yesterday. Continue from one small action today.")).style.margin = "0 0 8px";
      note.appendChild(gwBtn("Continue Plan", "action-btn primary", function () { t.missedDismissed = true; gwSaveToday(t); renderDuniyaGrowth(); }));
      content.appendChild(note);
    }

    var dayNum = doneDay ? doneDay.n : (day ? day.n : 7);
    content.appendChild(gwRows([
      ["Current focus", track.label, true],
      ["Journey", "Week " + m.weekNo + " of 4 · Day " + dayNum + " of 7"],
      ["This week's theme", GW_WEEKS[m.weekNo - 1]]
    ]));

    var card = gwEl("div", "money-habit-card");
    content.appendChild(card);
    if (doneDay) {
      card.appendChild(gwEl("p", "name", doneDay.status === "skipped" ? "Not today, and that's okay" : "Done for today ✓"));
      var e = hist.filter(function (x) { return x.date === today && x.missionId === m.id && x.planDay === doneDay.n; }).sort(function (a, b) { return a.completedAt < b.completedAt ? 1 : -1; })[0];
      if (doneDay.text) card.appendChild(gwEl("p", "cost-line", doneDay.text));
      if (e && e.difficulty) card.appendChild(gwEl("p", "cost-line", "You said it was " + e.difficulty + (e.feeling ? " and you felt " + e.feeling.toLowerCase() + " afterwards" : "") + "."));
      card.appendChild(gwEl("p", "cost-line", m.status === "completed" ? "Week " + m.weekNo + " is complete. The next step is ready tomorrow." : "Day " + (doneDay.n + 1) + " unlocks tomorrow. You're done for now."));
    } else if (m.status === "completed") {
      card.appendChild(gwEl("p", "name", "Week " + m.weekNo + " complete 🎉"));
      if (m.weekNo < 4) {
        card.appendChild(gwEl("p", "cost-line", "Next: Week " + (m.weekNo + 1) + " — " + GW_WEEKS[m.weekNo]));
        var nb = gwBtn("Start Week " + (m.weekNo + 1), "btn btn-primary btn-full", function () { gwStartTrack(m.track, m.weekNo + 1); gwGo("home"); });
        nb.style.marginTop = "8px";
        card.appendChild(nb);
      } else {
        card.appendChild(gwEl("p", "cost-line", "You finished the 4-week journey. Pick what to work on next."));
        var fb = gwBtn("Choose a focus", "btn btn-primary btn-full", function () { gwGo("focus"); });
        fb.style.marginTop = "8px";
        card.appendChild(fb);
      }
    } else {
      renderGwTodayCard(card, m, day, t, p);
    }

    // this week
    var w = gwThisWeek();
    var wh = gwEl("h2", "", "This Week");
    wh.style.marginTop = "18px";
    content.appendChild(wh);
    content.appendChild(gwBar(w.completed, 7));
    content.appendChild(gwEl("p", "", w.completed + " of 7 actions" + (w.partial ? " · " + w.partial + " partly" : "")));
    content.appendChild(gwWeekGraph(w));

    var row = gwEl("div", "money-quick-actions");
    row.appendChild(gwBtn("View Progress", "preset-plan-chip", function () { gwGo("progress"); }));
    row.appendChild(gwBtn("Change My Focus", "preset-plan-chip", function () { gwGo("focus"); }));
    content.appendChild(row);
    gwRenderExplore(content, p, m);
  }

  function renderGwTodayCard(card, m, day, t, p) {
    var track = gwTrack(m.track);
    // week 4: the user chooses; other weeks the plan decides
    if (!day.actionId) {
      card.appendChild(gwEl("p", "name", "Today's mission — your choice"));
      card.appendChild(gwEl("p", "cost-line", "Independent week: pick the challenge you want to do today."));
      var lib = GW_LIB[m.track];
      var used = m.days.map(function (d) { return d.actionId; });
      var opts = [];
      for (var k = 0; k < 7 && opts.length < 3; k++) {
        var a = lib[(day.n * 2 + k) % 7];
        if (used.indexOf(a.id) === -1 && opts.indexOf(a) === -1) opts.push(a);
      }
      opts.forEach(function (a) {
        var b = gwBtn(a.t[gwLevelFor(m.track, m.weekNo)], "rec-action", function () {
          day.actionId = a.id;
          gwSaveMission(m);
          renderDuniyaGrowth();
        });
        card.appendChild(b);
      });
      return;
    }
    gwRevealDay(m, day);
    var action = gwAction(m.track, day.actionId);
    var mine = t.missionId === m.id && t.dayN === day.n;
    var started = mine && t.started;
    var couldnt = mine && t.couldnt;

    card.appendChild(gwEl("p", "cost-line", "TODAY'S MISSION"));
    var ch = gwEl("p", "priority-title", day.text);
    ch.style.margin = "4px 0 8px";
    card.appendChild(ch);
    card.appendChild(gwEl("p", "priority-why", "Why: " + action.why));
    var memCtx = memPgContext(m.track);
    if (memCtx) card.appendChild(gwEl("p", "cost-line", memCtx));
    card.appendChild(gwEl("p", "cost-line", "Estimated time: about " + action.min + " min" + (p.dailyMinutes && action.min > p.dailyMinutes ? " (start with what fits your " + p.dailyMinutes + " min)" : "")));

    function setToday(patch) {
      var nt = gwToday();
      nt.missionId = m.id; nt.dayN = day.n;
      for (var k2 in patch) nt[k2] = patch[k2];
      gwSaveToday(nt);
    }
    function result(status) { gwGo("reflect", { status: status, dayN: day.n, f: {} }); }

    if (couldnt) {
      card.appendChild(gwEl("p", "cost-line", "Not today? That's okay. Try a smaller version, or leave it for tomorrow."));
      var sm = gwBtn("Try a smaller version", "btn btn-primary btn-full", function () {
        var smallText = action.t[0] === day.text ? "Just start: do the first 60 seconds of this, then stop if you want." : action.t[0];
        day.text = smallText; day.level = 0;
        gwSaveMission(m);
        setToday({ started: true, couldnt: false, smaller: true });
        renderDuniyaGrowth();
      });
      sm.style.marginTop = "8px";
      card.appendChild(sm);
      return;
    }
    if (!started) {
      var st = gwBtn("Start Challenge", "btn btn-primary btn-full", function () { setToday({ started: true }); renderDuniyaGrowth(); });
      st.style.marginTop = "8px";
      card.appendChild(st);
      card.appendChild(gwBtn("I already did this", "priority-change-link", function () { setToday({ started: true }); renderDuniyaGrowth(); }));
    } else {
      card.appendChild(gwEl("p", "cost-line", "How did it go?"));
      var rr = gwEl("div", "money-quick-actions");
      rr.appendChild(gwBtn("Completed", "action-btn primary", function () { result("completed"); }));
      rr.appendChild(gwBtn("Partly Done", "action-btn", function () { result("partial"); }));
      rr.appendChild(gwBtn("Couldn't Do It", "action-btn", function () { result("couldnt"); }));
      card.appendChild(rr);
    }
    var links = gwEl("div", "money-quick-actions");
    links.appendChild(gwBtn("Too easy", "priority-change-link", function () {
      var a2 = gwAction(m.track, day.actionId);
      day.text = a2.t[2]; day.level = 2;
      gwSaveMission(m);
      var pp = gwProfile(); pp.trackLevels = pp.trackLevels || {};
      pp.trackLevels[m.track] = Math.min(2, (pp.trackLevels[m.track] !== undefined ? pp.trackLevels[m.track] : (pp.startLevel || 1)) + 1);
      gwSaveProfile(pp);
      showToast("Made it a bit harder");
      renderDuniyaGrowth();
    }));
    links.appendChild(gwBtn("Too difficult", "priority-change-link", function () {
      var a2 = gwAction(m.track, day.actionId);
      day.text = a2.t[0]; day.level = 0;
      gwSaveMission(m);
      var pp = gwProfile(); pp.trackLevels = pp.trackLevels || {};
      pp.trackLevels[m.track] = Math.max(0, (pp.trackLevels[m.track] !== undefined ? pp.trackLevels[m.track] : (pp.startLevel || 1)) - 1);
      gwSaveProfile(pp);
      showToast("Made it smaller");
      renderDuniyaGrowth();
    }));
    links.appendChild(gwBtn("Change today's challenge", "priority-change-link", function () {
      // swap with a later, not-yet-shown day so no challenge is lost from the plan
      var other = m.days.filter(function (d) { return d.n > day.n && d.status === null && d.actionId; })[0];
      if (!other) { showToast("No other challenge left in this plan"); return; }
      var keepId = day.actionId;
      day.actionId = other.actionId;
      other.actionId = keepId;
      other.text = null; other.level = null;
      day.text = gwAction(m.track, day.actionId).t[gwLevelFor(m.track, m.weekNo)];
      day.level = gwLevelFor(m.track, m.weekNo);
      day.swaps = (day.swaps || 0) + 1;
      gwSaveMission(m);
      setToday({ started: false, couldnt: false });
      renderDuniyaGrowth();
    }));
    card.appendChild(links);
  }

  function gwRenderExplore(content, p, m) {
    var h = gwEl("h2", "", "Explore another area");
    h.style.marginTop = "18px";
    content.appendChild(h);
    var hist = gwHistory();
    var missions = gwMissions();
    var grid = gwEl("div", "duniya-area-grid");
    GW_TRACKS.forEach(function (tr) {
      var done = hist.filter(function (e) { return e.area === tr.key && e.status === "completed"; }).length;
      var has = missions.filter(function (x) { return x.track === tr.key && x.status !== "completed"; })[0];
      var isCurrent = m && m.track === tr.key;
      var card = gwEl("button", "duniya-area-card");
      card.type = "button";
      card.appendChild(gwEl("span", "duniya-area-title", tr.label));
      card.appendChild(gwEl("span", "duniya-area-sub", isCurrent ? "Current focus" : has ? "Resume" : "Start"));
      if (done) card.appendChild(gwEl("span", "duniya-area-progress", done + " completed"));
      card.addEventListener("click", function () {
        if (isCurrent) { showToast("This is your current focus"); return; }
        gwStartTrack(tr.key);
        gwGo("home");
      });
      grid.appendChild(card);
    });
    content.appendChild(grid);
  }

  // ---- reflection (1-3 quick questions) ----

  function renderGwReflect(content) {
    var m = gwActiveMission();
    var day = m ? m.days.filter(function (d) { return d.n === gwView.dayN; })[0] : null;
    if (!m || !day) { gwGo("home"); return; }
    var status = gwView.status;
    var f = gwView.f;
    var t = gwToday();
    content.appendChild(gwBtn("← Back", "picker-step-back", function () { gwGo("home"); }));
    content.appendChild(gwEl("h2", "", "How did it go?"));
    content.appendChild(gwEl("p", "muted-line", day.text));

    function chips(label, key, options) {
      var l = gwEl("p", "muted-line", label);
      l.style.marginTop = "12px";
      content.appendChild(l);
      var row = gwEl("div", "money-quick-actions");
      options.forEach(function (o) {
        var v = o.toLowerCase();
        row.appendChild(gwBtn(o, "preset-plan-chip" + (f[key] === v ? " active-chip" : ""), function () { f[key] = v; renderDuniyaGrowth(); }));
      });
      content.appendChild(row);
    }
    if (status === "couldnt") {
      chips("What got in the way?", "obstacle", ["Nerves", "No time", "Forgot", "Felt too hard", "Something else"]);
    } else {
      chips("How difficult was it?", "difficulty", ["Easy", "Medium", "Hard"]);
      chips("How did you feel afterwards?", "feeling", ["Better", "Same", "Worse"]);
    }
    var ll = gwEl("p", "muted-line", status === "couldnt" ? "Anything you noticed? (optional)" : "What did you learn? (optional)");
    ll.style.marginTop = "12px";
    content.appendChild(ll);
    var ta = gwEl("input", "text-input");
    ta.type = "text";
    ta.maxLength = 200;
    ta.value = f.text || "";
    ta.addEventListener("input", function () { f.text = ta.value; });
    content.appendChild(ta);

    var save = gwBtn("Save", "btn btn-primary btn-full", function () {
      var wasSmaller = t.missionId === m.id && t.dayN === day.n && t.smaller;
      gwSaveResult(m, day, status, {
        difficulty: f.difficulty, feeling: f.feeling, obstacle: f.obstacle, reflection: f.text, smaller: wasSmaller
      });
      var nt = gwToday();
      nt.missionId = m.id; nt.dayN = day.n;
      if (status === "couldnt") {
        nt.couldnt = day.status === null; nt.started = false;
        gwSaveToday(nt);
        gwGo("reflect-done", { skipped: day.status === "skipped" });
      } else {
        nt.started = false; nt.couldnt = false; nt.smaller = false;
        gwSaveToday(nt);
        showToast("Saved");
        gwGo("home");
      }
    });
    save.style.marginTop = "14px";
    content.appendChild(save);
  }

  function renderGwReflectDone(content) {
    content.appendChild(gwEl("h2", "", "That's okay."));
    content.appendChild(gwEl("p", "muted-line", "One day doesn't undo your progress. Everything you've completed is still saved."));
    if (gwView.skipped) content.appendChild(gwEl("p", "muted-line", "We'll move on to the next step tomorrow."));
    else content.appendChild(gwEl("p", "muted-line", "Try a smaller version now, or leave it for tomorrow."));
    var b = gwBtn(gwView.skipped ? "Back to Personal Growth" : "Continue", "btn btn-primary btn-full", function () { gwGo("home"); });
    b.style.marginTop = "12px";
    content.appendChild(b);
  }

  // ---- progress, weekly report, history ----

  function gwRenderWeekReport(content, p) {
    var w = gwThisWeek();
    var prev = gwLastWeek();
    content.appendChild(gwEl("h2", "", "Personal Growth — This Week"));
    if (w.total < 1) { content.appendChild(gwEl("p", "muted-line", "Not enough data yet.")); return; }
    content.appendChild(gwBar(w.completed, 7));
    var rows = [["Actions completed", w.completed + " / 7", true]];
    if (w.partial) rows.push(["Partly done", String(w.partial)]);
    var focusLabel = p && p.currentFocus && gwTrack(p.currentFocus) ? gwTrack(p.currentFocus).label : "—";
    rows.push(["Current focus", focusLabel]);
    Object.keys(w.byTrack).sort(function (a, b) { return w.byTrack[b] - w.byTrack[a]; }).forEach(function (k) {
      rows.push([gwTrack(k).label + " challenges", w.byTrack[k] + " completed"]);
    });
    if (w.total >= 2 && w.hardest) rows.push(["Most difficult challenge", w.hardest]);
    if (w.total >= 2 && w.easiest) rows.push(["Completed with ease", w.easiest]);
    rows.push(["Missed days", String(w.missed)]);
    if (w.recovered) rows.push(["Recovery", "Returned after missing a day"]);
    content.appendChild(gwRows(rows));
    content.appendChild(gwWeekGraph(w));
    var sum = gwWeekSummary(w, prev);
    if (sum) content.appendChild(gwEl("p", "rec-note", sum));
    else content.appendChild(gwEl("p", "muted-line", "Not enough data yet for a weekly summary."));
    if (w.lastReflection) content.appendChild(gwEl("p", "muted-line", "Recent reflection: “" + w.lastReflection + "”"));
  }

  function renderGwProgress(content, p) {
    content.appendChild(gwBtn("← Back", "picker-step-back", function () { gwGo("home"); }));
    gwRenderWeekReport(content, p);

    var hist = gwHistory();
    var ph = gwEl("h2", "", "All time");
    ph.style.marginTop = "18px";
    content.appendChild(ph);
    var partial = hist.filter(function (e) { return e.status === "partial"; }).length;
    content.appendChild(gwRows([
      ["Days active", String(p.totalGrowthDays || 0)],
      ["Challenges completed", String(p.completedChallenges || 0)],
      ["Partly done", String(partial)],
      ["Couldn't do it", String(p.skippedChallenges || 0)]
    ]));

    var wh = gwEl("h2", "", "Weekly results");
    wh.style.marginTop = "14px";
    content.appendChild(wh);
    var labels = ["This week", "Last week", "2 weeks ago", "3 weeks ago"];
    var any = false;
    for (var i = 0; i < 4; i++) {
      var keys = getLastNDateKeys(7 * (i + 1)).slice(7 * i);
      var wd = gwWeekData(keys);
      if (wd.total) { any = true; content.appendChild(gwEl("p", "muted-line", labels[i] + ": " + wd.completed + " completed" + (wd.partial ? ", " + wd.partial + " partly" : "") + " (" + gwFmtDate(keys[keys.length - 1]) + " – " + gwFmtDate(keys[0]) + ")")); }
    }
    if (!any) content.appendChild(gwEl("p", "muted-line", "Not enough data yet."));

    var mh = gwEl("h2", "", "Missions");
    mh.style.marginTop = "14px";
    content.appendChild(mh);
    var missions = gwMissions().slice().reverse();
    if (!missions.length) content.appendChild(gwEl("p", "muted-line", "No missions yet."));
    missions.forEach(function (m) {
      var done = m.days.filter(function (d) { return d.status === "completed" || d.status === "partial"; }).length;
      content.appendChild(gwEl("p", "muted-line", gwTrack(m.track).label + " · Week " + m.weekNo + " · " + done + "/7 done · " + (m.status === "active" ? "current" : m.status) + " · started " + gwFmtDate(m.startDate)));
    });

    var rh = gwEl("h2", "", "Reflections");
    rh.style.marginTop = "14px";
    content.appendChild(rh);
    var refl = hist.filter(function (e) { return e.reflection; }).sort(function (a, b) { return a.completedAt < b.completedAt ? 1 : -1; }).slice(0, 10);
    if (!refl.length) content.appendChild(gwEl("p", "muted-line", "Your reflections will appear here."));
    refl.forEach(function (e) {
      content.appendChild(gwEl("p", "muted-line", gwFmtDate(e.date) + " · " + gwTrack(e.area).label + ": “" + e.reflection + "”"));
    });

    var ah = gwEl("h2", "", "Assessment");
    ah.style.marginTop = "14px";
    content.appendChild(ah);
    content.appendChild(gwEl("p", "muted-line", "Taken " + gwFmtDate(p.assessmentDate.slice(0, 10)) + ". Primary: " + gwTrack(p.primaryFocus).label + ". Secondary: " + gwTrack(p.secondaryFocus).label + "."));
    content.appendChild(gwBtn("Retake Assessment", "priority-change-link", gwRetake));
  }

  function gwRetake() {
    if (!window.confirm("Retake the assessment? Your history and missions stay saved. Only your recommendation is updated.")) return;
    writeJSON("nc_pg_draft", { step: 0, answers: {} });
    gwGo("assess", { step: 0 });
  }

  // ---- change focus ----

  function renderGwFocus(content, p) {
    content.appendChild(gwBtn("← Back", "picker-step-back", function () { gwGo("home"); }));
    content.appendChild(gwEl("h2", "", "Change My Focus"));
    content.appendChild(gwEl("p", "muted-line", "Your history stays saved. Nothing is deleted."));
    var m = gwActiveMission();
    var cur = m ? gwTrack(m.track).label : gwTrack(p.currentFocus || p.primaryFocus).label;
    var keep = gwBtn("Keep recommendation (" + gwTrack(p.primaryFocus).label + ")", "btn btn-primary btn-full", function () {
      gwStartTrack(p.primaryFocus);
      gwGo("home");
    });
    keep.style.marginTop = "10px";
    content.appendChild(keep);
    content.appendChild(gwEl("p", "muted-line", "Currently working on: " + cur));
    var h = gwEl("p", "muted-line", "Or choose another area");
    h.style.marginTop = "12px";
    content.appendChild(h);
    var row = gwEl("div", "money-quick-actions");
    GW_TRACKS.forEach(function (tr) {
      row.appendChild(gwBtn(tr.label, "preset-plan-chip" + (m && m.track === tr.key ? " active-chip" : ""), function () {
        gwStartTrack(tr.key);
        gwGo("home");
      }));
    });
    content.appendChild(row);
    content.appendChild(gwBtn("Retake Assessment", "btn btn-outline btn-full", gwRetake));
  }

  function initDuniyaGrowth() {
    document.getElementById("duniya-growth-back").addEventListener("click", function () {
      gwView = { screen: "home" };
      setActiveView("duniya");
    });
  }

  // ---------- USER UNDERSTANDING & MEMORY ENGINE ----------
  // OBSERVE -> REMEMBER -> FIND PATTERNS -> BUILD CONFIDENCE -> PERSONALISE ->
  // CHECK WHEN UNSURE -> LEARN FROM CORRECTIONS. Local-first and rule-based: no
  // LLM, no network. It only learns from activity inside NURA (never messages,
  // photos, browsing, mic, camera, contacts or other apps).
  //
  // Storage (localStorage):
  //   nc_mem_events    event log (type, module, small metadata)
  //   nc_mem_patterns  remembered commitments: observations + what the user confirmed/corrected
  //   nc_mem_exceptions  "today only" changes (Level 1 memory)
  //   nc_mem_meta      learning state (backfill, question pacing, ignored patterns)
  //   nc_mem_profile   cached structured UserUnderstandingProfile
  // Memory levels: 1 = today (exceptions), 2 = pattern memory (evidence, confidence),
  // 3 = stable memory (user-confirmed or corrected schedules).

  var MEM_LEVELS = ["LOW", "MEDIUM", "HIGH", "VERY HIGH"];
  var MEM_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var memRunTimer = null;

  function memObj(k) { var v = readJSON(k, null); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  function memArr(k) { var v = readJSON(k, []); return Array.isArray(v) ? v : []; }
  function memMeta() { return memObj("nc_mem_meta"); }
  function memSaveMeta(m) { writeJSON("nc_mem_meta", m); }
  function memEvents() { return memArr("nc_mem_events"); }
  function memPatterns() { return memObj("nc_mem_patterns"); }
  function memSavePatterns(p) { writeJSON("nc_mem_patterns", p); }
  function memExceptions() { return memArr("nc_mem_exceptions"); }

  function memDaysBetween(a, b) { return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000); }
  function memDow(dateKey) { return new Date(dateKey + "T12:00:00").getDay(); }
  function memTmin(hhmm) { return hhmm ? planTimeToMinutes(hhmm) : null; }
  function memHHMM(min) {
    min = ((Math.round(min) % 1440) + 1440) % 1440;
    return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
  }
  function memClock(hhmm) { return hhmm ? planMinutesToClock(planTimeToMinutes(hhmm)) : ""; }
  function memRange(s, e) { return memClock(s) + (e ? "–" + memClock(e) : ""); }
  function memWeight(dateKey) { var a = memDaysBetween(dateKey, todayKey()); return a <= 28 ? 1 : a <= 56 ? 0.5 : 0.25; }
  function memKey(name) { return String(name || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }
  function memDaysLabel(days) {
    var d = days.slice().sort(function (a, b) { return a - b; });
    var s = d.join(",");
    if (s === "1,2,3,4,5") return "weekdays";
    if (s === "0,6") return "weekends";
    if (d.length === 7) return "every day";
    var parts = [], i = 0;
    while (i < d.length) {
      var j = i;
      while (j + 1 < d.length && d[j + 1] === d[j] + 1) j++;
      if (j - i >= 2) parts.push(MEM_DAYS[d[i]] + "–" + MEM_DAYS[d[j]]);
      else for (var k = i; k <= j; k++) parts.push(MEM_DAYS[d[k]]);
      i = j + 1;
    }
    return parts.join(", ");
  }

  // ---- event log ----
  function memLog(type, module, data) {
    try {
      var ev = memEvents();
      var now = new Date();
      ev.push({ id: uid("me"), ts: now.toISOString(), date: todayKey(now), type: type, module: module, data: data || {} });
      if (ev.length > 3000) ev = ev.slice(ev.length - 3000);
      writeJSON("nc_mem_events", ev);
      var m = memMeta();
      if (!m.firstEvent) { m.firstEvent = now.toISOString(); memSaveMeta(m); }
      memScheduleRun();
    } catch (e) { /* memory must never break the feature it observes */ }
  }
  function memScheduleRun() {
    if (memRunTimer) clearTimeout(memRunTimer);
    memRunTimer = setTimeout(function () { memRunTimer = null; try { memRun(); } catch (e) {} }, 1200);
  }

  // ---- commitments (fixed activities the user tells Plan My Day about) ----
  function memNewRec(key, label) { return { key: key, label: label, kind: "commitment", obs: [], user: null, ignoreBefore: null, ignoreBeforeDow: {}, snoozeUntil: null, rejectedUntil: null, capMedium: false, corrections: 0, firstObservation: null, lastObservation: null, updatedAt: null }; }

  // temp = "today only": logged but never counted as evidence for the routine.
  function memObserve(name, dateKey, start, end, temp) {
    var key = memKey(name);
    if (!key || key.length < 2 || !start) return;
    var pats = memPatterns();
    var rec = pats[key] || (pats[key] = memNewRec(key, String(name).trim()));
    rec.label = String(name).trim() || rec.label;
    rec.obs = rec.obs.filter(function (o) { return o.date !== dateKey; });
    rec.obs.push({ date: dateKey, dow: memDow(dateKey), start: start, end: end || null, temp: !!temp });
    rec.obs.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (rec.obs.length > 120) rec.obs = rec.obs.slice(rec.obs.length - 120);
    var real = rec.obs.filter(function (o) { return !o.temp; });
    rec.firstObservation = real.length ? real[0].date : rec.firstObservation;
    rec.lastObservation = real.length ? real[real.length - 1].date : rec.lastObservation;
    rec.updatedAt = new Date().toISOString();
    memSavePatterns(pats);
  }

  function memBackfill() {
    var m = memMeta();
    if (m.backfilled) return;
    var prefix = "nc_plan_activities_";
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k.indexOf(prefix) !== 0) continue;
      var date = k.slice(prefix.length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      memArr(k).forEach(function (a) {
        if (a && a.mode === "fixed" && a.startTime) memObserve(a.name, date, a.startTime, a.endTime, false);
      });
    }
    m = memMeta();
    m.backfilled = true;
    memSaveMeta(m);
  }

  // Confidence from weighted evidence, agreement, and recency. Deliberately coarse.
  function memConfidence(w, agree, lastDate, confirmed, capMedium) {
    var lvl = 0;
    if (w >= 3) lvl = 1;
    if (w >= 5 && agree >= 0.7) lvl = 2;
    if (w >= 12 && agree >= 0.85) lvl = 3;
    if (agree < 0.6) lvl = 0; else if (agree < 0.7) lvl = Math.min(lvl, 1);
    if (lastDate && memDaysBetween(lastDate, todayKey()) > 28) lvl = Math.max(0, lvl - 1);
    if (capMedium) lvl = Math.min(lvl, 1);
    if (confirmed) lvl = Math.max(lvl, 2);
    return MEM_LEVELS[lvl];
  }
  function memLevelIdx(c) { return MEM_LEVELS.indexOf(c); }

  // Weekday-aware analysis: each weekday's dominant (start,end) wins by recency-
  // weighted votes; weekdays that agree are merged, so "Gym Mon/Wed 6 PM" and
  // "Gym Fri 8 PM" can both exist.
  function memAnalyze(rec) {
    var obs = (rec.obs || []).filter(function (o) {
      if (o.temp) return false;
      if (rec.ignoreBefore && o.date < rec.ignoreBefore) return false;
      var db = rec.ignoreBeforeDow && rec.ignoreBeforeDow[o.dow];
      if (db && o.date < db) return false;
      return true;
    });
    var byDow = {};
    function slotKey(o) { return Math.round(memTmin(o.start) / 15) * 15 + "|" + (o.end ? Math.round(memTmin(o.end) / 15) * 15 : "x"); }
    obs.forEach(function (o) {
      var k = slotKey(o);
      var d = byDow[o.dow] || (byDow[o.dow] = { total: 0, votes: {}, count: 0 });
      var w = memWeight(o.date);
      d.total += w; d.count++;
      var v = d.votes[k] || (d.votes[k] = { w: 0, n: 0, last: "", start: o.start, end: o.end });
      v.w += w; v.n++;
      if (o.date >= v.last) { v.last = o.date; v.start = o.start; v.end = o.end; }
    });
    var groups = {};
    Object.keys(byDow).forEach(function (dow) {
      var d = byDow[dow], best = null;
      Object.keys(d.votes).forEach(function (k) { if (!best || d.votes[k].w > d.votes[best].w) best = k; });
      // Decay: if the last three sightings on this weekday all agree on a different
      // time, the recent behaviour replaces the old routine (earned gradually, never from one event).
      var recent = obs.filter(function (o) { return String(o.dow) === String(dow); }).slice(-3);
      if (recent.length === 3 && d.count >= 4) {
        var rk = slotKey(recent[0]);
        if (recent.every(function (o) { return slotKey(o) === rk; }) && rk !== best) {
          var rw = recent.reduce(function (s, o) { return s + memWeight(o.date); }, 0);
          best = rk;
          d.votes[rk].w = rw;
          d.total = rw;
          d.count = 3;
        }
      }
      var v = d.votes[best];
      var g = groups[best] || (groups[best] = { days: [], w: 0, n: 0, total: 0, last: "", start: v.start, end: v.end });
      g.days.push(Number(dow)); g.w += v.w; g.n += v.n; g.total += d.total;
      if (v.last > g.last) g.last = v.last;
    });
    var out = Object.keys(groups).map(function (k) {
      var g = groups[k];
      g.agreement = g.total ? g.w / g.total : 0;
      g.confidence = memConfidence(g.w, g.agreement, g.last, false, rec.capMedium);
      return g;
    });
    var drift = [];
    ((rec.user && rec.user.schedule) || []).forEach(function (ug) {
      var since = ug.since || ug.confirmedAt || "";
      var after = (rec.obs || []).filter(function (o) { return !o.temp && o.date > since && ug.days.indexOf(o.dow) !== -1; }).slice(-3);
      if (after.length < 3) return;
      var s0 = after[0].start, e0 = after[0].end;
      var same = after.every(function (o) { return o.start === s0 && (o.end || "") === (e0 || ""); });
      var differs = Math.abs(memTmin(s0) - memTmin(ug.start)) > 15 || (e0 && ug.end && Math.abs(memTmin(e0) - memTmin(ug.end)) > 15);
      if (same && differs) drift.push({ days: ug.days, start: s0, end: e0, from: ug });
    });
    return { groups: out, drift: drift, evidenceDays: obs.length };
  }

  // What does this remembered item look like on a given weekday?
  function memEffective(rec, dow) {
    var ug = ((rec.user && rec.user.schedule) || []).filter(function (g) { return g.days.indexOf(dow) !== -1; })[0];
    if (ug) return { start: ug.start, end: ug.end, days: ug.days, source: "you", confirmed: true, confidence: "VERY HIGH", n: 0 };
    var a = memAnalyze(rec);
    var g = a.groups.filter(function (x) { return x.days.indexOf(dow) !== -1; })[0];
    if (!g) return null;
    return { start: g.start, end: g.end, days: g.days, source: "learned", confirmed: false, confidence: g.confidence, n: g.n };
  }

  function memException(dateKey, key) {
    var list = memExceptions().filter(function (e) { return e.date === dateKey && e.key === key; });
    return list.length ? list[list.length - 1] : null;
  }
  function memAddException(key, type, start, end) {
    var prev = memException(todayKey(), key);
    if (prev && prev.type === type && (prev.start || null) === (start || null) && (prev.end || null) === (end || null)) return;
    var list = memExceptions().filter(function (e) { return memDaysBetween(e.date, todayKey()) <= 14 && !(e.date === todayKey() && e.key === key); });
    list.push({ id: uid("mx"), date: todayKey(), key: key, type: type, start: start || null, end: end || null, createdAt: new Date().toISOString() });
    writeJSON("nc_mem_exceptions", list);
    memLog("plan_changed", "memory", { key: key, change: type });
  }
  function memClearException(key) {
    writeJSON("nc_mem_exceptions", memExceptions().filter(function (e) { return !(e.date === todayKey() && e.key === key); }));
  }

  // "What does this user normally do on this date?" Items ready to pre-fill.
  function memSuggestionsFor(dateKey) {
    var dow = memDow(dateKey);
    var pats = memPatterns();
    var items = [];
    Object.keys(pats).forEach(function (key) {
      var rec = pats[key];
      if (rec.rejectedUntil && rec.rejectedUntil > dateKey) return;
      var eff = memEffective(rec, dow);
      if (!eff) return;
      var lvl = memLevelIdx(eff.confidence);
      var exc = memException(dateKey, key);
      items.push({ key: key, label: rec.label, eff: eff, exc: exc, low: !eff.confirmed && lvl < 1 });
    });
    items.sort(function (a, b) { return memTmin(a.eff.start) - memTmin(b.eff.start); });
    return items;
  }

  // Sentences match certainty: never present a guess as a fact.
  function memPhrase(rec, eff) {
    var when = memDaysLabel(eff.days) + ", " + memRange(eff.start, eff.end);
    if (eff.confirmed) return "Your usual " + rec.label + ": " + when + ".";
    var l = memLevelIdx(eff.confidence);
    if (l >= 2) return "You usually have " + rec.label + " " + when + ".";
    if (l === 1) return "This seems to be becoming a pattern: " + rec.label + ", " + when + ".";
    var times = eff.n === 1 ? "once" : eff.n === 2 ? "twice" : "a few times";
    return "You've had " + rec.label + " around " + memClock(eff.start) + " " + times + " (" + memDaysLabel(eff.days) + ").";
  }

  // ---- asking, sparingly ----
  // One confirmation question at most per day, only for HIGH+ patterns the user
  // hasn't confirmed, and never for something they said no to.
  function memNextQuestion() {
    var meta = memMeta(), today = todayKey();
    var pats = memPatterns();
    function candidate(key, g) { return { key: key, label: pats[key].label, days: g.days, start: g.start, end: g.end, n: g.n }; }
    if (meta.askDate === today && meta.askKey) {
      var k = meta.askKey.split("::")[0], rec = pats[k];
      if (!rec) return null;
      var g0 = memAnalyze(rec).groups.filter(function (g) { return g.days.slice().sort().join(",") === meta.askKey.split("::")[1]; })[0];
      var covered = g0 && ((rec.user && rec.user.schedule) || []).some(function (ug) { return g0.days.every(function (d) { return ug.days.indexOf(d) !== -1; }); });
      return g0 && !covered && !(rec.snoozeUntil && rec.snoozeUntil > today) && !(rec.rejectedUntil && rec.rejectedUntil > today) ? candidate(k, g0) : null;
    }
    if (meta.askDate === today) return null;
    var best = null;
    Object.keys(pats).forEach(function (key) {
      var rec2 = pats[key];
      if (rec2.rejectedUntil && rec2.rejectedUntil > today) return;
      if (rec2.snoozeUntil && rec2.snoozeUntil > today) return;
      memAnalyze(rec2).groups.forEach(function (g) {
        if (memLevelIdx(g.confidence) < 2) return;
        var done = ((rec2.user && rec2.user.schedule) || []).some(function (ug) { return g.days.every(function (d) { return ug.days.indexOf(d) !== -1; }); });
        if (done) return;
        if (!best || g.w > best.g.w) best = { key: key, g: g };
      });
    });
    if (!best) return null;
    meta.askDate = today;
    meta.askKey = best.key + "::" + best.g.days.slice().sort().join(",");
    memSaveMeta(meta);
    return candidate(best.key, best.g);
  }
  function memAnswer(q, answer) {
    var pats = memPatterns(), rec = pats[q.key], today = todayKey();
    if (!rec) return;
    var in14 = todayKey(new Date(Date.now() + 14 * 86400000));
    if (answer === "yes") {
      rec.user = rec.user || { schedule: [] };
      rec.user.schedule = rec.user.schedule.filter(function (g) { return !g.days.some(function (d) { return q.days.indexOf(d) !== -1; }); });
      rec.user.schedule.push({ days: q.days.slice(), start: q.start, end: q.end, confirmedAt: today, since: today });
      rec.capMedium = false;
      memLog("routine_confirmed", "memory", { key: q.key, days: q.days });
    } else if (answer === "notalways") {
      rec.snoozeUntil = in14;
      rec.capMedium = true;
    } else {
      rec.rejectedUntil = todayKey(new Date(Date.now() + 60 * 86400000));
      rec.ignoreBefore = today;
      rec.obs = rec.obs.filter(function (o) { return o.date >= today; });
      memLog("routine_corrected", "memory", { key: q.key, action: "rejected" });
    }
    var meta = memMeta(); meta.askKey = null; meta.askDate = today; memSaveMeta(meta);
    rec.updatedAt = new Date().toISOString();
    memSavePatterns(pats);
  }

  // ---- corrections (the user is always the authority) ----
  // Permanent change: replaces the schedule for those days from today on. Older
  // evidence for those days is ignored so the old routine can't win back.
  function memCorrect(key, label, days, start, end) {
    var pats = memPatterns();
    var rec = pats[key] || (pats[key] = memNewRec(key, label || key));
    var today = todayKey();
    rec.user = rec.user || { schedule: [] };
    rec.user.schedule = rec.user.schedule.map(function (g) {
      return { days: g.days.filter(function (d) { return days.indexOf(d) === -1; }), start: g.start, end: g.end, confirmedAt: g.confirmedAt, since: g.since };
    }).filter(function (g) { return g.days.length; });
    rec.user.schedule.push({ days: days.slice(), start: start, end: end || null, confirmedAt: today, since: today });
    rec.ignoreBeforeDow = rec.ignoreBeforeDow || {};
    days.forEach(function (d) { rec.ignoreBeforeDow[d] = today; });
    rec.rejectedUntil = null;
    rec.capMedium = false;
    rec.corrections = (rec.corrections || 0) + 1;
    rec.updatedAt = new Date().toISOString();
    memSavePatterns(pats);
    memLog("routine_corrected", "memory", { key: key, days: days, start: start, end: end });
  }
  function memForget(key) {
    var pats = memPatterns(), rec = pats[key];
    if (!rec) return;
    rec.obs = []; rec.user = null; rec.ignoreBefore = todayKey(); rec.ignoreBeforeDow = {};
    rec.firstObservation = null; rec.lastObservation = null; rec.snoozeUntil = null; rec.capMedium = false;
    memSavePatterns(pats);
    memLog("routine_corrected", "memory", { key: key, action: "forgotten" });
  }
  function memIgnoreDerived(id) {
    var m = memMeta(); m.ignored = m.ignored || {}; m.ignored[id] = todayKey(); memSaveMeta(m);
  }
  function memIgnoredSince(id) { var m = memMeta(); return m.ignored && m.ignored[id] ? m.ignored[id] : ""; }
  function memForgetAll() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf("nc_mem_") === 0) keys.push(k); }
    keys.forEach(function (k) { localStorage.removeItem(k); });
    memSaveMeta({ backfilled: true, resetOn: todayKey() });
  }

  // ---- natural-language corrections (plain patterns, not AI) ----
  function memGuessMin(h, mm, ap, hint, after) {
    if (ap) return ((h % 12) + (ap === "pm" ? 12 : 0)) * 60 + mm;
    var cands = h === 12 ? [12 * 60 + mm, mm] : [h * 60 + mm, ((h % 12) + 12) * 60 + mm];
    if (after !== null && after !== undefined) {
      var later = cands.filter(function (c) { return c > after; }).sort(function (a, b) { return a - b; });
      if (later.length) return later[0];
    }
    if (hint !== null && hint !== undefined) return cands.sort(function (a, b) { return Math.abs(a - hint) - Math.abs(b - hint); })[0];
    if (h >= 7 && h <= 11) return h * 60 + mm;
    return h === 12 ? 12 * 60 + mm : ((h % 12) + 12) * 60 + mm;
  }
  function memParseTimes(t, hint) {
    var m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|–|—|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (m) {
      var s = memGuessMin(+m[1], +(m[2] || 0), m[3], hint, null);
      return { start: s, end: memGuessMin(+m[4], +(m[5] || 0), m[6], null, s) };
    }
    m = t.match(/(?:at|from|around|by|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (m) return { start: memGuessMin(+m[1], +(m[2] || 0), m[3], hint, null), end: null };
    return null;
  }
  function memParseCorrection(text) {
    var t = String(text || "").toLowerCase().trim();
    if (!t) return { ok: false, message: "Type what changed, for example “college cancelled today”." };
    var pats = memPatterns(), found = null;
    Object.keys(pats).forEach(function (k) {
      var lab = (pats[k].label || k).toLowerCase();
      if (t.indexOf(lab) !== -1 || t.indexOf(k) !== -1) { if (!found || lab.length > found.label.length) found = { key: k, label: pats[k].label || k }; }
    });
    var cancel = /(cancel+ed|called off|not (going|happening|today)|\bno [a-z ]+ today|is off|off today|skipping|won'?t (go|be)|holiday)/.test(t);
    var permanent = /(permanent|from now on|always|changed to|now (it'?s|is|runs|starts|from)|new (timing|time|schedule)|timings? changed|time changed|shifted)/.test(t);
    var today = /(today|tonight|this (morning|afternoon|evening))/.test(t);
    var hint = null;
    if (found) { var eff = memEffective(pats[found.key], new Date().getDay()) || (memAnalyze(pats[found.key]).groups[0]); if (eff) hint = memTmin(eff.start); }
    var times = memParseTimes(t, hint);
    if (!found) {
      var nm = t.match(/^(?:my\s+)?([a-z][a-z ]{1,24}?)\s+(?:timing|time|is|now|has|will|starts?|runs?|at|from|permanently)\b/);
      if (nm && times && permanent) found = { key: memKey(nm[1]), label: nm[1].replace(/\b\w/g, function (c) { return c.toUpperCase(); }), isNew: true };
      else return { ok: false, message: "I couldn't tell which item you mean. Use a name NURA already knows, or say “<name> is now 10–3”." };
    }
    var startH = times ? memHHMM(times.start) : null, endH = times && times.end !== null ? memHHMM(times.end) : null;
    if (cancel && !times) return { ok: true, key: found.key, label: found.label, action: "cancel" };
    if (!times) return { ok: false, message: "Tell me the time too, for example “" + found.label + " is now 10–3”." };
    if (permanent) return { ok: true, key: found.key, label: found.label, action: "permanent", start: startH, end: endH };
    if (today) return { ok: true, key: found.key, label: found.label, action: "today", start: startH, end: endH };
    return { ok: true, key: found.key, label: found.label, action: "ask", start: startH, end: endH };
  }
  function memApplyCorrection(res, scope) {
    var action = scope || res.action;
    var pats = memPatterns(), rec = pats[res.key];
    var dow = new Date().getDay();
    if (action === "cancel") { memAddException(res.key, "cancelled"); return res.label + " is off for today. Your normal routine is unchanged."; }
    var eff = rec ? memEffective(rec, dow) : null;
    var end = res.end || (eff ? eff.end : null);
    if (action === "today") { memAddException(res.key, "changed", res.start, end); return res.label + " today: " + memRange(res.start, end) + ". Your normal routine is unchanged."; }
    var days = eff ? eff.days : (dow === 0 || dow === 6 ? [0, 6] : [1, 2, 3, 4, 5]);
    memCorrect(res.key, res.label, days, res.start, end);
    return "Updated. " + res.label + " is now " + memDaysLabel(days) + ", " + memRange(res.start, end) + ".";
  }

  // ---- other patterns, all computed from real saved activity ----
  function memWeightedMode(items, roundTo) {
    var votes = {}, total = 0, dates = {};
    items.forEach(function (it) {
      var k = Math.round(it.min / roundTo) * roundTo;
      var w = memWeight(it.date);
      votes[k] = (votes[k] || 0) + w; total += w; dates[it.date] = true;
    });
    var best = null;
    Object.keys(votes).forEach(function (k) { if (best === null || votes[k] > votes[best]) best = k; });
    if (best === null) return null;
    var last = ""; items.forEach(function (it) { if (it.date > last) last = it.date; });
    return { min: Number(best), w: votes[best], agree: total ? votes[best] / total : 0, days: Object.keys(dates).length, last: last };
  }
  function memWakeSleep() {
    var ev = memEvents();
    var wakeSince = memIgnoredSince("wake"), sleepSince = memIgnoredSince("sleep");
    var wake = [], sleep = [];
    ev.forEach(function (e) {
      if (e.data && typeof e.data.min === "number") {
        if (e.type === "wake_recorded" && e.date >= wakeSince) wake.push({ date: e.date, min: e.data.min });
        if (e.type === "sleep_started" && e.date >= sleepSince) sleep.push({ date: e.date, min: e.data.min < 240 ? e.data.min + 1440 : e.data.min });
      }
    });
    function mk(list) {
      var m = memWeightedMode(list, 30);
      if (!m || m.w < 3) return null;
      m.confidence = memConfidence(m.w, m.agree, m.last, false, false);
      return m;
    }
    return { wake: mk(wake), sleep: mk(sleep) };
  }

  // Study sessions from the existing daily-priority log: completion rate by length.
  function memStudyStats() {
    var since = memIgnoredSince("study");
    var log = memArr("nc_priority_log").filter(function (e) { return e && e.planKey === "study" && e.minutes && (!since || e.date >= since); });
    function bucket(min) { return min <= 25 ? "short" : min <= 45 ? "medium" : "long"; }
    var b = { short: { n: 0, done: 0, full: 0, part: 0, mins: {} }, medium: { n: 0, done: 0, full: 0, part: 0, mins: {} }, long: { n: 0, done: 0, full: 0, part: 0, mins: {} } };
    function fmt(x) { return x.full + " of " + x.n + (x.part ? " (plus " + x.part + " partly)" : ""); }
    log.forEach(function (e) {
      var x = b[bucket(e.minutes)];
      x.n++;
      if (e.status === "completed") x.full++; else if (e.status === "partial") x.part++;
      x.done += e.status === "completed" ? 1 : e.status === "partial" ? 0.5 : 0;
      x.mins[e.minutes] = (x.mins[e.minutes] || 0) + 1;
    });
    var out = { total: log.length, buckets: b, pref: null, insight: null };
    Object.keys(b).forEach(function (k) {
      var x = b[k], rep = null;
      Object.keys(x.mins).forEach(function (m) { if (rep === null || x.mins[m] > x.mins[rep]) rep = m; });
      x.rep = rep ? Number(rep) : null;
      x.rate = x.n ? x.done / x.n : 0;
    });
    var ranked = Object.keys(b).filter(function (k) { return b[k].n >= 3; }).sort(function (a, c) { return b[c].rate - b[a].rate; });
    if (ranked.length >= 2 && b[ranked[0]].rate >= 0.6 && b[ranked[0]].rate - b[ranked[1]].rate >= 0.2) {
      var top = ranked[0], other = ranked[1];
      out.pref = { minutes: b[top].rep, bucket: top };
      out.insight = "You completed " + fmt(b[top]) + " study sessions of about " + b[top].rep + " min, compared with " + fmt(b[other]) + " sessions of about " + b[other].rep + " min.";
    }
    return out;
  }

  function memHourBucket(h) { return h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : h >= 17 && h < 21 ? "evening" : "night"; }
  function memProductiveTime() {
    var since = memIgnoredSince("productive");
    var counts = { morning: 0, afternoon: 0, evening: 0, night: 0 }, total = 0;
    memEvents().forEach(function (e) {
      if (since && e.date < since) return;
      var ok = e.type === "task_completed" || (e.type === "personal_growth_completed" && e.data && e.data.result !== "couldnt");
      if (!ok) return;
      counts[memHourBucket(new Date(e.ts).getHours())]++; total++;
    });
    if (total < 6) return null;
    var best = null;
    Object.keys(counts).forEach(function (k) { if (best === null || counts[k] > counts[best]) best = k; });
    return counts[best] / total >= 0.5 ? { bucket: best, n: counts[best], total: total } : null;
  }
  function memSkipPattern() {
    var since = memIgnoredSince("skips");
    var counts = { morning: 0, afternoon: 0, evening: 0, night: 0 }, total = 0;
    memEvents().forEach(function (e) {
      if (e.type !== "task_skipped" || !e.data || typeof e.data.startMin !== "number" || (since && e.date < since)) return;
      counts[memHourBucket(Math.floor(e.data.startMin / 60))]++; total++;
    });
    if (total < 4) return null;
    var best = null;
    Object.keys(counts).forEach(function (k) { if (best === null || counts[k] > counts[best]) best = k; });
    return counts[best] / total >= 0.6 ? { bucket: best, n: counts[best], total: total } : null;
  }
  function memPgPatterns() {
    var since = memIgnoredSince("growth");
    var h = memArr("nc_pg_history").filter(function (e) { return (e.status === "completed" || e.status === "partial") && (!since || e.date >= since); });
    var days = {}; h.forEach(function (e) { days[e.date] = true; });
    var dates = Object.keys(days).sort();
    var out = { weekdayShare: null, afterMiss: null, total: dates.length };
    if (dates.length >= 6) {
      var wd = dates.filter(function (d) { var x = memDow(d); return x >= 1 && x <= 5; }).length;
      out.weekdayShare = { weekday: wd, total: dates.length };
      var missed = 0, alsoMissed = 0;
      var d0 = dates[0], last = todayKey();
      for (var d = d0; memDaysBetween(d, last) >= 2; d = memAddDaysKey(d, 1)) {
        if (days[d]) continue;
        var nx = memAddDaysKey(d, 1);
        missed++;
        if (!days[nx]) alsoMissed++;
      }
      if (missed >= 4 && alsoMissed / missed >= 0.6) out.afterMiss = { missed: missed, alsoMissed: alsoMissed };
    }
    return out;
  }
  function memAddDaysKey(key, n) { var d = new Date(key + "T12:00:00"); d.setDate(d.getDate() + n); return todayKey(d); }

  function memPlanTiming() {
    var c = { morning: 0, other: 0 };
    memEvents().forEach(function (e) {
      if (e.type !== "plan_created") return;
      var h = new Date(e.ts).getHours();
      if (h >= 4 && h < 12) c.morning++; else c.other++;
    });
    var n = c.morning + c.other;
    return n >= 4 ? { morning: c.morning, total: n } : null;
  }

  // Short, data-backed notes for the weekly report. Empty unless evidence exists.
  function memWeeklyInsights() {
    var out = [];
    var st = memStudyStats();
    if (st.insight) out.push(st.insight);
    var weekKeys = {}; getLastNDateKeys(7).forEach(function (k) { weekKeys[k] = true; });
    var late = { done: 0, skipped: 0 };
    memEvents().forEach(function (e) {
      if (!weekKeys[e.date] || !e.data || typeof e.data.startMin !== "number" || e.data.startMin < 20 * 60) return;
      if (e.type === "task_completed") late.done++;
      if (e.type === "task_skipped") late.skipped++;
    });
    if (late.done + late.skipped >= 3) out.push("You completed " + late.done + " of " + (late.done + late.skipped) + " planned tasks scheduled after 8 PM this week.");
    return out.slice(0, 3);
  }

  function memStudyHint() {
    var st = memStudyStats();
    if (st.pref) return "Suggested: " + st.pref.minutes + " min. " + st.insight;
    var best = null;
    ["short", "medium", "long"].forEach(function (k) { var x = st.buckets[k]; if (x.n >= 3 && x.rate >= 0.6 && (!best || x.rate > st.buckets[best].rate)) best = k; });
    if (best) return "You completed " + st.buckets[best].full + " of " + st.buckets[best].n + " sessions of about " + st.buckets[best].rep + " min.";
    return null;
  }

  // Personal Growth: only when today's context is well known.
  function memPgContext(track) {
    if (["confidence", "social", "communication", "courage"].indexOf(track) === -1) return null;
    var items = memSuggestionsFor(todayKey());
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!/college|school|class|university|work|office|tuition/.test(it.key)) continue;
      if (it.exc && it.exc.type === "cancelled") continue;
      if (!(it.eff.confirmed || memLevelIdx(it.eff.confidence) >= 2)) continue;
      return "Today you have " + it.label + " (" + memRange(it.eff.start, it.eff.end) + "), a natural place to try this.";
    }
    return null;
  }

  // ---- profile + runner ----
  function memLearningDays() {
    var d = {};
    memEvents().forEach(function (e) { d[e.date] = true; });
    var pats = memPatterns();
    Object.keys(pats).forEach(function (k) { pats[k].obs.forEach(function (o) { if (!o.temp) d[o.date] = true; }); });
    return Object.keys(d).length;
  }

  function memBuildProfile() {
    var pats = memPatterns();
    var routine = [];
    Object.keys(pats).forEach(function (k) {
      var rec = pats[k], a = memAnalyze(rec);
      var confirmed = ((rec.user && rec.user.schedule) || []).map(function (g) { return { days: g.days, start: g.start, end: g.end, userConfirmed: true, source: "user", confidence: "VERY HIGH", since: g.since }; });
      var learned = a.groups.filter(function (g) { return !confirmed.some(function (c) { return g.days.every(function (d) { return c.days.indexOf(d) !== -1; }); }); })
        .map(function (g) { return { days: g.days, start: g.start, end: g.end, userConfirmed: false, source: "inferred", confidence: g.confidence, evidenceCount: g.n }; });
      if (!confirmed.length && !learned.length) return;
      routine.push({ key: k, label: rec.label, schedules: confirmed.concat(learned), firstObservation: rec.firstObservation, lastObservation: rec.lastObservation, evidenceCount: a.evidenceDays, corrections: rec.corrections || 0 });
    });
    var ws = memWakeSleep(), study = memStudyStats(), prod = memProductiveTime(), skips = memSkipPattern(), pg = memPgPatterns();
    var prof = readJSON("nc_pg_profile", null);
    var goals = getMoneyGoals().map(function (g) { return { type: "savings", name: g.name, target: g.targetAmount, saved: g.currentSavedAmount }; });
    if (prof && prof.currentFocus) goals.push({ type: "personalGrowth", name: gwTrack(prof.currentFocus) ? gwTrack(prof.currentFocus).label : prof.currentFocus });
    var meta = memMeta();
    var profile = {
      identity: { preferredName: localStorage.getItem("nc_user_name") || null, preferredLanguage: "English", communicationStyle: null },
      routinePatterns: { commitments: routine, wake: ws.wake ? { time: memHHMM(ws.wake.min), confidence: ws.wake.confidence } : null, sleep: ws.sleep ? { time: memHHMM(ws.sleep.min), confidence: ws.sleep.confidence } : null },
      goals: goals,
      personalGrowth: prof ? { currentFocus: prof.currentFocus || null, completedChallenges: prof.completedChallenges || 0, challengeLevel: prof.trackLevels && prof.currentFocus ? prof.trackLevels[prof.currentFocus] : null } : null,
      behaviorPatterns: { productiveTime: prod, skipPeriod: skips, growthWeekdays: pg.weekdayShare, afterMissedDay: pg.afterMiss },
      preferences: { studySession: study.pref, planningTime: memPlanTiming() },
      memoryMetadata: { firstObservation: meta.firstEvent || null, evidenceCount: memEvents().length, learningDays: memLearningDays(), lastUpdated: new Date().toISOString() }
    };
    writeJSON("nc_mem_profile", profile);
    return profile;
  }

  function memRun() {
    memBackfill();
    var ev = memEvents();
    if (ev.length && memDaysBetween(ev[0].date, todayKey()) > 180) writeJSON("nc_mem_events", ev.filter(function (e) { return memDaysBetween(e.date, todayKey()) <= 180; }));
    var pats = memPatterns(), changed = false;
    Object.keys(pats).forEach(function (k) {
      var before = pats[k].obs.length;
      pats[k].obs = pats[k].obs.filter(function (o) { return memDaysBetween(o.date, todayKey()) <= 120; });
      if (pats[k].obs.length !== before) changed = true;
      if (!pats[k].obs.length && !(pats[k].user && pats[k].user.schedule && pats[k].user.schedule.length) && !pats[k].ignoreBefore) { delete pats[k]; changed = true; }
    });
    if (changed) memSavePatterns(pats);
    return memBuildProfile();
  }

  // ---- shared small builders ----
  function meEl(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function meBtn(label, cls, fn) { var b = meEl("button", cls, label); b.type = "button"; b.addEventListener("click", fn); return b; }

  function meQuestionCard(q, onDone) {
    var box = meEl("div", "money-wait-banner");
    box.appendChild(meEl("p", "", "I've noticed you usually have " + q.label + " " + memDaysLabel(q.days) + ", " + memRange(q.start, q.end) + ". Should I remember this as your normal schedule?")).style.margin = "0 0 8px";
    var row = meEl("div", "money-quick-actions");
    row.style.margin = "0";
    row.appendChild(meBtn("Yes, remember", "action-btn primary", function () { memAnswer(q, "yes"); showToast("Remembered"); onDone(); }));
    row.appendChild(meBtn("Not always", "action-btn", function () { memAnswer(q, "notalways"); onDone(); }));
    row.appendChild(meBtn("No", "action-btn", function () { memAnswer(q, "no"); onDone(); }));
    box.appendChild(row);
    return box;
  }

  function meDriftCard(rec, d, onDone) {
    var box = meEl("div", "money-wait-banner");
    box.appendChild(meEl("p", "", "Your " + rec.label + " times seem to have changed to " + memRange(d.start, d.end) + " (" + memDaysLabel(d.days) + "). Update?")).style.margin = "0 0 8px";
    var row = meEl("div", "money-quick-actions");
    row.style.margin = "0";
    row.appendChild(meBtn("Yes, update", "action-btn primary", function () { memCorrect(rec.key, rec.label, d.days, d.start, d.end); onDone(); }));
    row.appendChild(meBtn("No, keep the old one", "action-btn", function () {
      var pats = memPatterns();
      (pats[rec.key].user.schedule || []).forEach(function (g) { if (g.days.join() === d.from.days.join()) g.since = todayKey(); });
      memSavePatterns(pats); onDone();
    }));
    box.appendChild(row);
    return box;
  }

  function meTellBox(onDone) {
    var wrap = meEl("div", "");
    var input = meEl("input", "text-input");
    input.type = "text";
    input.placeholder = "e.g. college cancelled today, or college is now 10–3";
    wrap.appendChild(input);
    var msg = meEl("p", "muted-line");
    msg.style.margin = "4px 0";
    var row = meEl("div", "money-quick-actions");
    var apply = meBtn("Apply", "action-btn primary", function () {
      var res = memParseCorrection(input.value);
      if (!res.ok) { msg.textContent = res.message; return; }
      if (res.action === "ask") {
        msg.textContent = res.label + " " + memRange(res.start, res.end) + " — just today, or always?";
        row.innerHTML = "";
        row.appendChild(meBtn("Today only", "action-btn primary", function () { showToast(memApplyCorrection(res, "today")); onDone(); }));
        row.appendChild(meBtn("Always", "action-btn", function () { showToast(memApplyCorrection(res, "permanent")); onDone(); }));
        return;
      }
      showToast(memApplyCorrection(res));
      onDone();
    });
    row.appendChild(apply);
    wrap.appendChild(input);
    wrap.appendChild(msg);
    wrap.appendChild(row);
    return wrap;
  }

  // ---- Plan My Day: "your usual day" ----
  var planMem = null;

  function planMemInit() {
    var items = memSuggestionsFor(todayKey());
    planMem = { date: todayKey(), rows: items.map(function (it) {
      var mode = it.exc ? (it.exc.type === "cancelled" ? "cancel" : "change") : (it.low ? "off" : "keep");
      return { key: it.key, label: it.label, start: it.eff.start, end: it.eff.end, cs: it.exc && it.exc.start ? it.exc.start : it.eff.start, ce: it.exc && it.exc.end ? it.exc.end : it.eff.end, mode: mode, confirmed: it.eff.confirmed, level: memLevelIdx(it.eff.confidence), low: it.low, editing: false };
    }) };
  }

  function planMemBuildActivities(rows) {
    var acts = [];
    rows.forEach(function (r) {
      if (r.mode === "keep" || r.mode === "change") {
        var s = r.mode === "change" ? r.cs : r.start, e = r.mode === "change" ? r.ce : r.end;
        if (!e) e = memHHMM(memTmin(s) + 60);
        acts.push({ id: uid("plan"), name: r.label, mode: "fixed", status: "pending", category: "dunya", startTime: s, endTime: e, prepMinutes: 0, travelBeforeMinutes: 0, travelAfterMinutes: 0 });
      }
    });
    return acts;
  }

  function planMemRecord(rows) {
    rows.forEach(function (r) {
      if (r.mode === "cancel") memAddException(r.key, "cancelled");
      else if (r.mode === "change") { memAddException(r.key, "changed", r.cs, r.ce); memObserve(r.label, todayKey(), r.cs, r.ce, true); }
      else if (r.mode === "keep") memObserve(r.label, todayKey(), r.start, r.end, false);
    });
  }

  function planMemDayWindow() {
    var ws = memWakeSleep();
    var ds = ws.wake ? memHHMM(ws.wake.min) : "06:00";
    var de = ws.sleep ? memHHMM(Math.min(ws.sleep.min, 1439)) : "23:00";
    if (planTimeToMinutes(de) <= planTimeToMinutes(ds)) de = "23:00";
    return { dayStart: ds, dayEnd: de };
  }

  function renderPlanMemoryCard(content) {
    memRun();
    var q = memNextQuestion();
    if (q) content.appendChild(meQuestionCard(q, renderDuniyaPlan));
    var pats = memPatterns();
    Object.keys(pats).forEach(function (k) {
      memAnalyze(pats[k]).drift.forEach(function (d) { content.appendChild(meDriftCard(pats[k], d, renderDuniyaPlan)); });
    });
    if (!planMem || planMem.date !== todayKey()) planMemInit();
    var rows = planMem.rows;
    if (!rows.length) {
      if (memLearningDays() < 10) {
        var l = meEl("p", "muted-line", "NURA is learning your routine. The more you plan, the less you'll need to type.");
        l.style.marginBottom = "12px";
        content.appendChild(l);
      }
      return false;
    }
    var usual = rows.some(function (r) { return !r.low; });
    content.appendChild(meEl("h2", "", usual ? "Your usual day" : "A suggestion from what NURA has noticed"));
    var list = meEl("div", "");
    rows.forEach(function (r) {
      var card = meEl("div", "money-habit-card");
      var shownS = r.mode === "change" ? r.cs : r.start, shownE = r.mode === "change" ? r.ce : r.end;
      card.appendChild(meEl("p", "name", r.label + " — " + memRange(shownS, shownE)));
      var tag = r.confirmed ? "Usual schedule" : r.level >= 2 ? "Usual, learned from your plans" : r.level === 1 ? "Seems to be a pattern" : "You've had this a few times. Use it today?";
      card.appendChild(meEl("p", "cost-line", r.mode === "cancel" ? "Not today (your normal routine stays)" : tag));
      var row = meEl("div", "money-quick-actions");
      row.appendChild(meBtn(r.low ? "Use today" : "Keep", "action-btn" + (r.mode === "keep" ? " primary" : ""), function () { r.mode = "keep"; r.editing = false; renderDuniyaPlan(); }));
      row.appendChild(meBtn("Change today", "action-btn" + (r.mode === "change" ? " primary" : ""), function () { r.editing = true; renderDuniyaPlan(); }));
      row.appendChild(meBtn(r.low ? "No" : "Not today", "action-btn" + (r.mode === "cancel" || (r.low && r.mode === "off") ? " primary" : ""), function () { r.mode = r.low ? "off" : "cancel"; r.editing = false; renderDuniyaPlan(); }));
      card.appendChild(row);
      if (r.editing) {
        var er = meEl("div", "plan-form-row");
        var si = meEl("input", "text-input"); si.type = "time"; si.value = r.cs || r.start;
        var ei = meEl("input", "text-input"); ei.type = "time"; ei.value = r.ce || r.end || "";
        er.appendChild(si); er.appendChild(ei);
        er.appendChild(meBtn("Set", "action-btn primary", function () {
          if (!si.value) { showToast("Choose a start time"); return; }
          r.cs = si.value; r.ce = ei.value || null; r.mode = "change"; r.editing = false; renderDuniyaPlan();
        }));
        card.appendChild(er);
      }
      list.appendChild(card);
    });
    content.appendChild(list);

    var tell = meEl("div", "");
    tell.appendChild(meEl("p", "muted-line", "Anything different today?"));
    content.appendChild(tell);
    content.appendChild(meTellBox(function () { planMem = null; renderDuniyaPlan(); }));

    var build = meBtn("Build my day", "btn btn-primary btn-full", function () {
      var acts = planMemBuildActivities(rows);
      var win = planMemDayWindow();
      planMemRecord(rows);
      savePlanActivities(acts);
      savePlanSettings({ dayStart: win.dayStart, dayEnd: win.dayEnd, sunnahEnabled: readJSON("nc_plan_sunnah_defaults", {}), bufferStyle: "normal", priorities: { top3: [], mustNotMiss: null }, orderRules: [], note: "" });
      memLog("plan_created", "plan", { source: "memory", fixed: acts.length, cancelled: rows.filter(function (r) { return r.mode === "cancel"; }).length });
      planMem = null;
      runBuildMyDay();
    });
    build.style.marginTop = "10px";
    content.appendChild(build);
    content.appendChild(meBtn("Add something else / plan from scratch", "btn btn-outline btn-full", function () {
      var acts = planMemBuildActivities(rows);
      var win = planMemDayWindow();
      planMemRecord(rows);
      startPlanWizard();
      planWizard.data.fixedActivities = acts;
      planWizard.data.dayStart = win.dayStart;
      planWizard.data.dayEnd = win.dayEnd;
      planWizard.step = 3;
      planMem = null;
      renderDuniyaPlan();
    }));
    var sep = meEl("div", "");
    sep.style.height = "8px";
    content.appendChild(sep);
    return true;
  }

  // ---- What NURA Knows About Me ----
  var meView = { editing: null };

  function meConfLabel(eff) {
    if (eff.confirmed) return "You confirmed this";
    return eff.confidence.charAt(0) + eff.confidence.slice(1).toLowerCase() + " confidence";
  }

  function meSection(content, title) {
    var h = meEl("h2", "", title);
    h.style.marginTop = "18px";
    content.appendChild(h);
  }

  function renderMemory() {
    var content = document.getElementById("memory-content");
    if (!content) return;
    content.innerHTML = "";
    var profile = memRun();
    var days = profile.memoryMetadata.learningDays;
    var pats = memPatterns();
    var keys = Object.keys(pats).filter(function (k) { return memAnalyze(pats[k]).groups.length || (pats[k].user && pats[k].user.schedule && pats[k].user.schedule.length); });

    content.appendChild(meEl("p", "muted-line", days < 10 || !keys.length
      ? "NURA is learning your routine. So far it has seen " + days + " day" + (days === 1 ? "" : "s") + " of activity. Learning speed depends on how much you use NURA."
      : "Based on " + days + " days of your activity inside NURA. Everything here is yours to edit or forget."));

    var q = memNextQuestion();
    if (q) content.appendChild(meQuestionCard(q, renderMemory));
    keys.forEach(function (k) { memAnalyze(pats[k]).drift.forEach(function (d) { content.appendChild(meDriftCard(pats[k], d, renderMemory)); }); });

    meSection(content, "Tell NURA about a change");
    content.appendChild(meTellBox(renderMemory));

    meSection(content, "Routine");
    if (!keys.length) content.appendChild(meEl("p", "muted-line", "Nothing yet. When you tell Plan My Day about fixed activities like college or gym, NURA starts noticing patterns."));
    keys.forEach(function (k) {
      var rec = pats[k], a = memAnalyze(rec);
      var effs = [];
      ((rec.user && rec.user.schedule) || []).forEach(function (g) { effs.push({ days: g.days, start: g.start, end: g.end, confirmed: true, confidence: "VERY HIGH", n: 0 }); });
      a.groups.forEach(function (g) { if (!effs.some(function (e) { return g.days.every(function (d) { return e.days.indexOf(d) !== -1; }); })) effs.push({ days: g.days, start: g.start, end: g.end, confirmed: false, confidence: g.confidence, n: g.n }); });
      var card = meEl("div", "money-habit-card");
      card.appendChild(meEl("p", "name", rec.label));
      effs.forEach(function (e) {
        card.appendChild(meEl("p", "cost-line", memPhrase(rec, e)));
        card.appendChild(meEl("p", "cost-line", meConfLabel(e) + (e.n ? " · based on " + e.n + " matching day" + (e.n === 1 ? "" : "s") : "") + (rec.lastObservation ? " · last seen " + gwFmtDate(rec.lastObservation) : "")));
      });
      var exc = memException(todayKey(), k);
      if (exc) card.appendChild(meEl("p", "cost-line", "Today: " + (exc.type === "cancelled" ? "not happening" : "changed to " + memRange(exc.start, exc.end)) + " (temporary)."));
      var row = meEl("div", "money-quick-actions");
      var unconfirmed = effs.filter(function (e) { return !e.confirmed && memLevelIdx(e.confidence) >= 1; })[0];
      if (unconfirmed) row.appendChild(meBtn("Confirm", "action-btn primary", function () { memAnswer({ key: k, days: unconfirmed.days, start: unconfirmed.start, end: unconfirmed.end }, "yes"); renderMemory(); }));
      row.appendChild(meBtn("Edit", "action-btn", function () { meView.editing = k; renderMemory(); }));
      if (exc) row.appendChild(meBtn("Undo today's change", "action-btn", function () { memClearException(k); renderMemory(); }));
      row.appendChild(meBtn("Forget", "action-btn", function () {
        if (!window.confirm("Forget what NURA has learned about " + rec.label + "?")) return;
        memForget(k); renderMemory();
      }));
      card.appendChild(row);
      if (meView.editing === k) {
        var base = effs[0];
        var sel = base.days.slice();
        var form = meEl("div", "");
        var chips = meEl("div", "money-quick-actions");
        MEM_DAYS.forEach(function (dn, i) {
          var chip = meBtn(dn, "preset-plan-chip" + (sel.indexOf(i) !== -1 ? " active-chip" : ""), function () {
            var at = sel.indexOf(i); if (at === -1) sel.push(i); else sel.splice(at, 1);
            chip.classList.toggle("active-chip");
          });
          chips.appendChild(chip);
        });
        var tr = meEl("div", "plan-form-row");
        var si = meEl("input", "text-input"); si.type = "time"; si.value = base.start;
        var ei = meEl("input", "text-input"); ei.type = "time"; ei.value = base.end || "";
        tr.appendChild(si); tr.appendChild(ei);
        form.appendChild(chips); form.appendChild(tr);
        var saveRow = meEl("div", "money-quick-actions");
        saveRow.appendChild(meBtn("Save correction", "action-btn primary", function () {
          if (!si.value || !sel.length) { showToast("Choose days and a start time"); return; }
          memCorrect(k, rec.label, sel.slice(), si.value, ei.value || null);
          meView.editing = null; renderMemory();
        }));
        saveRow.appendChild(meBtn("Cancel", "action-btn", function () { meView.editing = null; renderMemory(); }));
        form.appendChild(saveRow);
        card.appendChild(form);
      }
      content.appendChild(card);
    });

    // things learned from other activity
    var items = [];
    var ws = profile.routinePatterns;
    if (ws.wake) items.push({ id: "wake", text: "Usual wake time: around " + memClock(ws.wake.time) + ".", conf: ws.wake.confidence });
    if (ws.sleep) items.push({ id: "sleep", text: "Usual sleep time: around " + memClock(ws.sleep.time) + ".", conf: ws.sleep.confidence });
    var st = memStudyStats();
    if (st.pref) items.push({ id: "study", text: "Study sessions of about " + st.pref.minutes + " minutes work best for you.", conf: "MEDIUM", why: st.insight });
    var pt = profile.preferences.planningTime;
    if (pt && (pt.morning / pt.total >= 0.7)) items.push({ id: "plan", text: "You usually plan your day in the morning (" + pt.morning + " of " + pt.total + " times).", conf: "MEDIUM" });
    var prod = profile.behaviorPatterns.productiveTime;
    if (prod) items.push({ id: "productive", text: "You usually complete things in the " + prod.bucket + " (" + prod.n + " of " + prod.total + ").", conf: "MEDIUM" });
    var sk = profile.behaviorPatterns.skipPeriod;
    if (sk) items.push({ id: "skips", text: "Tasks planned in the " + sk.bucket + " get skipped more often (" + sk.n + " of " + sk.total + " skips).", conf: "MEDIUM" });
    var gp = profile.behaviorPatterns.growthWeekdays;
    if (gp && gp.weekday / gp.total >= 0.8) items.push({ id: "growth", text: "You mostly complete Personal Growth actions on weekdays (" + gp.weekday + " of " + gp.total + " days).", conf: "MEDIUM" });
    var am = profile.behaviorPatterns.afterMissedDay;
    if (am) items.push({ id: "growth", text: "After a missed Personal Growth day, the next day is often missed too (" + am.alsoMissed + " of " + am.missed + ").", conf: "MEDIUM" });
    meSection(content, "Habits and patterns");
    if (!items.length) content.appendChild(meEl("p", "muted-line", "No patterns yet. These appear only when there is real evidence, never from a single event."));
    items.forEach(function (it) {
      var card = meEl("div", "money-habit-card");
      card.appendChild(meEl("p", "name", it.text));
      if (it.why) card.appendChild(meEl("p", "cost-line", "Why: " + it.why));
      var row = meEl("div", "money-quick-actions");
      row.appendChild(meBtn("Forget", "action-btn", function () { memIgnoreDerived(it.id); renderMemory(); }));
      card.appendChild(row);
      content.appendChild(card);
    });

    meSection(content, "Goals");
    if (!profile.goals.length) content.appendChild(meEl("p", "muted-line", "No active goals yet."));
    profile.goals.forEach(function (g) {
      content.appendChild(meEl("p", "muted-line", g.type === "savings" ? "Saving for " + g.name + ": " + fmtRupee(g.saved) + " of " + fmtRupee(g.target) : "Personal Growth focus: " + g.name));
    });

    var insights = memWeeklyInsights();
    if (insights.length) {
      meSection(content, "NURA noticed this week");
      insights.forEach(function (s) { content.appendChild(meEl("p", "muted-line", s)); });
    }

    meSection(content, "What NURA does not track");
    content.appendChild(meEl("p", "muted-line", "Only your activity inside NURA. Never your messages, photos, browsing, microphone, camera, contacts or other apps. It all stays on this device and works without internet."));
    var wipe = meBtn("Forget everything NURA has learned", "priority-change-link", function () {
      if (!window.confirm("Forget everything NURA has learned about you? Your plans, goals and other data stay. Only the learned patterns are removed.")) return;
      memForgetAll(); planMem = null; renderMemory(); showToast("Forgotten");
    });
    wipe.style.marginTop = "12px";
    content.appendChild(wipe);
  }

  function initMemory() {
    document.getElementById("open-memory-btn").addEventListener("click", function () { meView = { editing: null }; setActiveView("memory"); });
    document.getElementById("memory-back").addEventListener("click", function () { setActiveView("more"); });
  }

  // ---------- PLAN MY DAY ----------
  // A real, deterministic day-scheduling engine (locked/fixed activities,
  // gap detection, priority-ordered flexible placement, conflict
  // detection) — no AI, no chat, no generated advice anywhere in this
  // flow. USER DECIDES -> NURA ORGANIZES -> USER FOLLOWS.

  var PLAN_DUNYA_CATEGORIES = ["College", "School", "Studies", "Career", "Work", "Tuition", "Fitness", "Gym", "Family", "Personal", "Errands", "Rest", "Meals", "Sleep", "Other"];
  var PLAN_DEEN_CATEGORIES = ["Salah", "Quran", "Dhikr", "Dua", "Islamic learning", "Sunnah habit", "Other deen activity"];
  var PLAN_SUNNAH_ITEMS = [
    { key: "morning-adhkar", label: "Morning Adhkar", minutes: 10, anchor: "after-fajr" },
    { key: "evening-adhkar", label: "Evening Adhkar", minutes: 10, anchor: "after-asr" },
    { key: "quran-reading", label: "Quran reading", minutes: 15, anchor: "after-fajr" },
    { key: "dua-waking", label: "Dua after waking", minutes: 5, anchor: "after-fajr" },
    { key: "dhikr", label: "Dhikr", minutes: 10, anchor: "any" },
    { key: "islamic-learning", label: "Short Islamic learning", minutes: 15, anchor: "any" },
    { key: "before-sleep", label: "Before-sleep routine", minutes: 15, anchor: "end-of-day" }
  ];

  function getPlanActivities() { return readJSON("nc_plan_activities_" + todayKey(), []); }
  function savePlanActivities(list) { writeJSON("nc_plan_activities_" + todayKey(), list); }
  function getPlanSettings() {
    return readJSON("nc_plan_settings_" + todayKey(), {
      dayStart: "06:00", dayEnd: "23:00", sunnahEnabled: readJSON("nc_plan_sunnah_defaults", {}),
      bufferStyle: "normal", priorities: { top3: [], mustNotMiss: null }, orderRules: [], note: ""
    });
  }
  function savePlanSettings(s) { writeJSON("nc_plan_settings_" + todayKey(), s); }
  function getPlanBuilt() { return readJSON("nc_plan_built_" + todayKey(), null); }
  function savePlanBuilt(result) { writeJSON("nc_plan_built_" + todayKey(), result); }

  function planTimeToMinutes(hhmm) {
    var p = hhmm.split(":");
    return Number(p[0]) * 60 + Number(p[1]);
  }
  function planMinutesToClock(mins) {
    mins = ((Math.round(mins) % 1440) + 1440) % 1440;
    var h = Math.floor(mins / 60), m = mins % 60;
    var period = h >= 12 ? "PM" : "AM";
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ":" + String(m).padStart(2, "0") + " " + period;
  }

  var PLAN_BUFFER_MINUTES = { tight: 5, normal: 15, relaxed: 30 };

  function computePlanSchedule(activities, settings, prayerTimings, fromMin) {
    var dayStartMin = planTimeToMinutes(settings.dayStart);
    var dayEndMin = planTimeToMinutes(settings.dayEnd);
    var lowerBound = fromMin != null ? Math.max(fromMin, dayStartMin) : dayStartMin;
    var BREAK_MIN = PLAN_BUFFER_MINUTES[settings.bufferStyle] || 15;
    var priorities = settings.priorities || { top3: [], mustNotMiss: null };
    var orderRules = settings.orderRules || []; // [{firstId, secondId}] firstId must end before secondId starts

    var locked = [];
    activities.filter(function (a) { return a.mode === "fixed" && a.startTime && a.status !== "skipped"; }).forEach(function (a) {
      var s = planTimeToMinutes(a.startTime);
      var e = a.endTime ? planTimeToMinutes(a.endTime) : s + (Number(a.durationMinutes) || 60);
      var prep = Number(a.prepMinutes) || 0;
      var travelBefore = Number(a.travelBeforeMinutes) || 0;
      var travelAfter = Number(a.travelAfterMinutes) || 0;
      if (travelBefore > 0) locked.push({ startMin: s - prep - travelBefore, endMin: s - prep, label: "Leave for " + a.name, kind: "travel", refId: a.id + "-travel" });
      if (prep > 0) locked.push({ startMin: s - prep, endMin: s, label: "Get ready for " + a.name, kind: "prep", refId: a.id + "-prep" });
      locked.push({ startMin: s, endMin: e, label: a.name, kind: "fixed", refId: a.id, activity: a });
      if (travelAfter > 0) locked.push({ startMin: e, endMin: e + travelAfter, label: "Travel back from " + a.name, kind: "travel", refId: a.id + "-travelback" });
    });

    if (prayerTimings) {
      PRAYER_ORDER.forEach(function (name) {
        var t = prayerTimings[name];
        if (!t) return;
        var s = planTimeToMinutes(t);
        locked.push({ startMin: s, endMin: s + 15, label: name, kind: "prayer", refId: "prayer-" + name });
      });
    }

    var conflicts = [];
    for (var i = 0; i < locked.length; i++) {
      for (var j = i + 1; j < locked.length; j++) {
        var A = locked[i], B = locked[j];
        var bothMeaningful = (A.kind === "fixed" || A.kind === "prayer") && (B.kind === "fixed" || B.kind === "prayer");
        if (bothMeaningful && A.startMin < B.endMin && B.startMin < A.endMin) {
          conflicts.push({ labelA: A.label, labelB: B.label, refA: A.refId, refB: B.refId, overlapMinutes: Math.min(A.endMin, B.endMin) - Math.max(A.startMin, B.startMin), isPrayer: A.kind === "prayer" || B.kind === "prayer" });
        }
      }
    }

    var merged = [];
    locked.slice().sort(function (a, b) { return a.startMin - b.startMin; }).forEach(function (b) {
      var start = Math.max(b.startMin, lowerBound), end = Math.min(b.endMin, dayEndMin);
      if (end <= start) return;
      if (!merged.length || start > merged[merged.length - 1].end) merged.push({ start: start, end: end });
      else merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, end);
    });
    var gaps = [];
    var cursor = lowerBound;
    merged.forEach(function (m) {
      if (m.start > cursor) gaps.push({ start: cursor, end: m.start });
      cursor = Math.max(cursor, m.end);
    });
    if (cursor < dayEndMin) gaps.push({ start: cursor, end: dayEndMin });

    // Flexible items: user-entered flexible + protected personal/life items + enabled Sunnah habits
    var flexItems = activities.filter(function (a) { return a.mode === "flexible" && a.status !== "done" && a.status !== "skipped"; }).map(function (a) {
      var rank = 3; // default: ranked by declared priority below
      if (priorities.mustNotMiss === a.id) rank = 0;
      else if (priorities.top3 && priorities.top3.indexOf(a.id) !== -1) rank = 1 + priorities.top3.indexOf(a.id) * 0.1;
      return { id: a.id, label: a.name, minutes: Number(a.durationMinutes) || 30, priority: a.priority || "medium", kind: a.isPersonal ? "personal" : "flexible", activity: a, anchorAfter: null, rank: a.isPersonal ? -1 : rank, dependsOn: a.dependsOnId || null };
    });
    (settings.sunnahEnabled ? Object.keys(settings.sunnahEnabled) : []).forEach(function (key) {
      if (!settings.sunnahEnabled[key]) return;
      var def = PLAN_SUNNAH_ITEMS.find(function (s) { return s.key === key; });
      if (!def) return;
      var anchorMin = null;
      if (def.anchor === "after-fajr" && prayerTimings && prayerTimings.Fajr) anchorMin = planTimeToMinutes(prayerTimings.Fajr) + 15;
      if (def.anchor === "after-asr" && prayerTimings && prayerTimings.Asr) anchorMin = planTimeToMinutes(prayerTimings.Asr) + 15;
      if (def.anchor === "end-of-day") anchorMin = dayEndMin - 60;
      flexItems.push({ id: "sunnah-" + def.key, label: def.label, minutes: def.minutes, priority: "high", kind: "sunnah", anchorAfter: anchorMin, rank: -1, dependsOn: null });
    });

    var priorityRank = { high: 0, medium: 1, low: 2 };
    // Order-rule dependency graph: build placement order via repeated passes so a "before" item
    // is always placed before its "after" item gets a chance (never silently violated).
    var idToItem = {}; flexItems.forEach(function (it) { idToItem[it.id] = it; });
    orderRules.forEach(function (r) {
      var afterItem = idToItem[r.secondId];
      if (afterItem) afterItem.dependsOn = r.firstId;
    });

    function baseSort(a, b) {
      if (a.anchorAfter !== null && b.anchorAfter !== null) return a.anchorAfter - b.anchorAfter;
      if (a.anchorAfter !== null) return -1;
      if (b.anchorAfter !== null) return 1;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return priorityRank[a.priority] - priorityRank[b.priority];
    }

    var placed = [];
    var unfit = [];
    var placedIds = {};
    var pending = flexItems.slice();
    var guardLoops = pending.length + 2;

    function placeOne(item) {
      var effectiveAnchor = item.anchorAfter;
      if (item.dependsOn && placedIds[item.dependsOn] != null) {
        effectiveAnchor = effectiveAnchor === null ? placedIds[item.dependsOn] : Math.max(effectiveAnchor, placedIds[item.dependsOn]);
      }
      var chosenIdx = -1, chosenStart = 0;
      for (var g = 0; g < gaps.length; g++) {
        var usableStart = Math.max(gaps[g].start, effectiveAnchor || gaps[g].start);
        if (gaps[g].end - usableStart >= item.minutes) { chosenIdx = g; chosenStart = usableStart; break; }
      }
      if (chosenIdx === -1) { unfit.push(item); placedIds[item.id] = -1; return; }
      var start = chosenStart, end = start + item.minutes;
      placed.push({ startMin: start, endMin: end, label: item.label, kind: item.kind, refId: item.id, activity: item.activity });
      placedIds[item.id] = end;
      var gap = gaps[chosenIdx];
      var remainderStart = (gap.end - end >= BREAK_MIN) ? end + BREAK_MIN : end;
      var newGaps = [];
      if (start > gap.start) newGaps.push({ start: gap.start, end: start });
      if (remainderStart < gap.end) newGaps.push({ start: remainderStart, end: gap.end });
      gaps.splice.apply(gaps, [chosenIdx, 1].concat(newGaps));
    }

    while (pending.length && guardLoops-- > 0) {
      pending.sort(baseSort);
      var ready = pending.filter(function (it) { return !it.dependsOn || placedIds[it.dependsOn] != null; });
      if (!ready.length) { pending.forEach(function (it) { unfit.push(it); }); break; }
      placeOne(ready[0]);
      pending = pending.filter(function (it) { return it.id !== ready[0].id; });
    }

    var timeline = [];
    locked.forEach(function (b) { if (b.endMin > lowerBound) timeline.push(b); });
    placed.forEach(function (b) { timeline.push(b); });
    gaps.forEach(function (g) { if (g.end - g.start >= 10) timeline.push({ startMin: g.start, endMin: g.end, label: "Free Time", kind: "free" }); });
    timeline.sort(function (a, b) { return a.startMin - b.startMin; });

    return { timeline: timeline, conflicts: conflicts, unfit: unfit };
  }

  function runBuildMyDay() {
    var activities = getPlanActivities();
    var settings = getPlanSettings();
    var prayerSettings = getPrayerSettings();
    var proceed = function (timings) {
      var result = computePlanSchedule(activities, settings, timings, null);
      savePlanBuilt(result);
      renderDuniyaPlan();
    };
    if (prayerSettings) {
      fetchPrayerTimesForToday().then(proceed).catch(function () { proceed(null); });
    } else {
      proceed(null);
    }
  }

  function adjustRemainingDay() {
    var built = getPlanBuilt();
    if (!built) return;
    var activities = getPlanActivities();
    var settings = getPlanSettings();
    var nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    var prayerSettings = getPrayerSettings();
    var proceed = function (timings) {
      var result = computePlanSchedule(activities, settings, timings, nowMin);
      // keep already-past locked/placed entries from the old timeline so the day's history isn't erased
      var past = built.timeline.filter(function (e) { return e.endMin <= nowMin; });
      result.timeline = past.concat(result.timeline);
      savePlanBuilt(result);
      memLog("plan_changed", "plan", { change: "adjusted remaining day" });
      renderDuniyaPlan();
      showToast("Remaining day adjusted");
    };
    if (prayerSettings) {
      fetchPrayerTimesForToday().then(proceed).catch(function () { proceed(null); });
    } else {
      proceed(null);
    }
  }

  function setPlanActivityStatus(activityId, status) {
    var activities = getPlanActivities();
    activities.forEach(function (a) { if (a.id === activityId) a.status = status; });
    savePlanActivities(activities);
    var builtForMem = getPlanBuilt();
    var actForMem = activities.filter(function (a) { return a.id === activityId; })[0];
    var slot = builtForMem ? builtForMem.timeline.filter(function (e) { return e.refId === activityId; })[0] : null;
    if (actForMem && (status === "done" || status === "skipped")) {
      memLog(status === "done" ? "task_completed" : "task_skipped", "plan", { name: actForMem.name, startMin: slot ? slot.startMin : null });
    }
    var built = getPlanBuilt();
    if (built) {
      built.timeline.forEach(function (e) { if (e.refId === activityId) e.status = status; });
      savePlanBuilt(built);
    }
    renderDuniyaPlan();
  }

  function renderPlanProgress(container, timeline) {
    var trackable = timeline.filter(function (e) { return e.kind === "fixed" || e.kind === "flexible" || e.kind === "sunnah" || e.kind === "prayer"; });
    var done = trackable.filter(function (e) {
      if (e.kind === "prayer") return false;
      var a = getPlanActivities().find(function (x) { return x.id === e.refId; });
      return a && a.status === "done";
    });
    var total = trackable.filter(function (e) { return e.kind !== "prayer"; }).length;
    var pct = total ? Math.round((done.length / total) * 100) : 0;

    var deenTotal = 0, deenDone = 0, dunyaTotal = 0, dunyaDone = 0;
    trackable.forEach(function (e) {
      if (e.kind === "prayer") return;
      var isDeen = e.kind === "sunnah" || (e.activity && e.activity.category === "deen");
      var a = getPlanActivities().find(function (x) { return x.id === e.refId; });
      var isDone = a && a.status === "done";
      if (isDeen) { deenTotal++; if (isDone) deenDone++; } else { dunyaTotal++; if (isDone) dunyaDone++; }
    });

    var wrap = document.createElement("div");
    var track = document.createElement("div");
    track.className = "plan-progress-track";
    var fill = document.createElement("div");
    fill.className = "plan-progress-fill";
    fill.style.width = pct + "%";
    track.appendChild(fill);
    wrap.appendChild(track);
    var line = document.createElement("p");
    line.className = "muted-line";
    line.textContent = pct + "% — " + done.length + " of " + total + " activities completed";
    wrap.appendChild(line);

    var tiles = document.createElement("div");
    tiles.className = "plan-progress-summary";
    tiles.innerHTML =
      '<div class="plan-progress-tile"><span class="big">' + deenDone + "/" + deenTotal + '</span><span class="lbl">DEEN</span></div>' +
      '<div class="plan-progress-tile"><span class="big">' + dunyaDone + "/" + dunyaTotal + '</span><span class="lbl">DUNYA</span></div>';
    wrap.appendChild(tiles);
    container.appendChild(wrap);
  }

  function renderPlanTimelineItem(entry) {
    var item = document.createElement("div");
    item.className = "plan-timeline-item";

    var dot = document.createElement("div");
    var isDeen = entry.kind === "prayer" || entry.kind === "sunnah" || (entry.activity && entry.activity.category === "deen");
    dot.className = "plan-timeline-dot" + (isDeen ? " deen" : "") + (entry.kind === "free" ? " free" : "");
    item.appendChild(dot);

    if (entry.kind === "free") {
      var freeBody = document.createElement("div");
      freeBody.className = "plan-timeline-free";
      freeBody.textContent = planMinutesToClock(entry.startMin) + " – " + planMinutesToClock(entry.endMin) + " · Free Time (" + (entry.endMin - entry.startMin) + " min) — study, rest, Quran, walk, or prepare for what's next.";
      item.appendChild(freeBody);
      return item;
    }

    var body = document.createElement("div");
    var activity = entry.refId ? getPlanActivities().find(function (a) { return a.id === entry.refId; }) : null;
    var status = activity ? activity.status : (entry.kind === "prayer" ? null : "pending");
    body.className = "plan-timeline-body" + (status === "done" ? " done" : "");

    var time = document.createElement("p");
    time.className = "plan-timeline-time";
    time.textContent = entry.endMin - entry.startMin > 1 ? (planMinutesToClock(entry.startMin) + " – " + planMinutesToClock(entry.endMin)) : planMinutesToClock(entry.startMin);
    body.appendChild(time);

    var name = document.createElement("p");
    name.className = "plan-timeline-name" + (status === "done" ? " done" : "");
    name.textContent = entry.label;
    body.appendChild(name);

    if (entry.kind === "fixed" || entry.kind === "flexible" || entry.kind === "sunnah") {
      var meta = document.createElement("p");
      meta.className = "plan-timeline-meta";
      meta.textContent = (entry.kind === "sunnah" ? "Sunnah" : (entry.kind === "fixed" ? "Fixed" : "Flexible")) + (status === "skipped" ? " · Skipped" : "") + (status === "delayed" ? " · Delayed" : "");
      body.appendChild(meta);
    }

    if (entry.refId && status !== "done" && status !== "skipped" && (entry.kind === "fixed" || entry.kind === "flexible" || entry.kind === "sunnah")) {
      var actions = document.createElement("div");
      actions.className = "plan-timeline-actions";
      if (entry.activity && entry.activity.category === "Studies" || (entry.activity && entry.activity.type === "study")) {
        var startBtn = document.createElement("button");
        startBtn.className = "action-btn primary";
        startBtn.textContent = "Start";
        startBtn.addEventListener("click", function () {
          startAdhocFocus(entry.label, entry.endMin - entry.startMin);
          setActiveView("home");
        });
        actions.appendChild(startBtn);
      }
      var doneBtn = document.createElement("button");
      doneBtn.className = "action-btn primary";
      doneBtn.textContent = "Done";
      doneBtn.addEventListener("click", function () { setPlanActivityStatus(entry.refId, "done"); });
      actions.appendChild(doneBtn);
      var skipBtn = document.createElement("button");
      skipBtn.className = "action-btn warn";
      skipBtn.textContent = "Skip";
      skipBtn.addEventListener("click", function () { setPlanActivityStatus(entry.refId, "skipped"); });
      actions.appendChild(skipBtn);
      if (entry.kind !== "sunnah") {
        var delayBtn = document.createElement("button");
        delayBtn.className = "action-btn";
        delayBtn.textContent = "Delay";
        delayBtn.addEventListener("click", function () { setPlanActivityStatus(entry.refId, "delayed"); adjustRemainingDay(); });
        actions.appendChild(delayBtn);
      }
      body.appendChild(actions);
    }

    item.appendChild(body);
    return item;
  }

  function renderPlanTimelineView(content, built) {
    var nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    var nextPrayer = null;
    if (getPrayerSettings()) {
      var nextEntry = built.timeline.find(function (e) { return e.kind === "prayer" && e.startMin >= nowMin; });
      if (nextEntry) nextPrayer = nextEntry.label + " — " + planMinutesToClock(nextEntry.startMin);
    }
    if (nextPrayer) {
      var nextP = document.createElement("p");
      nextP.className = "muted-line";
      nextP.style.marginBottom = "10px";
      nextP.textContent = "Next Salah: " + nextPrayer;
      content.appendChild(nextP);
    }

    renderPlanProgress(content, built.timeline);

    var currentEntry = built.timeline.find(function (e) {
      return e.startMin <= nowMin && nowMin < e.endMin && (e.kind === "fixed" || e.kind === "flexible" || e.kind === "sunnah");
    });
    if (currentEntry) {
      var activity = getPlanActivities().find(function (a) { return a.id === currentEntry.refId; });
      var isLate = activity && activity.status === "pending" && nowMin > currentEntry.startMin + 15;
      if (isLate) {
        var lateBanner = document.createElement("div");
        lateBanner.className = "plan-conflict-banner";
        lateBanner.style.color = "var(--gold)";
        lateBanner.style.borderColor = "var(--gold)";
        lateBanner.style.background = "rgba(201, 162, 39, 0.1)";
        lateBanner.textContent = "You're running a little behind on “" + currentEntry.label + "”.";
        content.appendChild(lateBanner);
        var lateBtns = document.createElement("div");
        lateBtns.className = "priority-checkin-buttons";
        lateBtns.style.marginBottom = "14px";
        var continueBtn = document.createElement("button");
        continueBtn.className = "action-btn";
        continueBtn.textContent = "Continue as planned";
        continueBtn.addEventListener("click", function () { renderDuniyaPlan(); });
        var adjustNowBtn = document.createElement("button");
        adjustNowBtn.className = "action-btn primary";
        adjustNowBtn.textContent = "Adjust remaining day";
        adjustNowBtn.addEventListener("click", adjustRemainingDay);
        lateBtns.appendChild(continueBtn);
        lateBtns.appendChild(adjustNowBtn);
        content.appendChild(lateBtns);
      }
    }

    if (built.conflicts && built.conflicts.length) {
      built.conflicts.forEach(function (c) {
        var banner = document.createElement("div");
        banner.className = "plan-conflict-banner";
        banner.textContent = "⚠️ Time conflict detected — " + c.labelA + " and " + c.labelB + " overlap by " + c.overlapMinutes + " minutes.";
        content.appendChild(banner);
      });
    }
    if (built.unfit && built.unfit.length) {
      var unfitBox = document.createElement("div");
      unfitBox.className = "plan-unfit-list";
      unfitBox.innerHTML = "<strong>You have more planned than realistically fits today:</strong><br>" + built.unfit.map(function (u) { return "• " + u.label + " (" + u.minutes + " min) — needs adjustment"; }).join("<br>");
      content.appendChild(unfitBox);
    }

    var timelineWrap = document.createElement("div");
    timelineWrap.className = "plan-timeline";
    built.timeline.forEach(function (entry) {
      var item = renderPlanTimelineItem(entry);
      if (entry === currentEntry) {
        var nowTag = document.createElement("span");
        nowTag.className = "action-status done";
        nowTag.style.marginLeft = "6px";
        nowTag.textContent = "NOW";
        var nameEl = item.querySelector(".plan-timeline-name");
        if (nameEl) nameEl.appendChild(nowTag);
      }
      timelineWrap.appendChild(item);
    });
    content.appendChild(timelineWrap);

    var adjustBtn = document.createElement("button");
    adjustBtn.className = "btn btn-outline btn-full";
    adjustBtn.textContent = "Adjust Remaining Day";
    adjustBtn.addEventListener("click", adjustRemainingDay);
    content.appendChild(adjustBtn);

    var editBtn = document.createElement("button");
    editBtn.className = "priority-change-link";
    editBtn.textContent = "Edit activities / rebuild";
    editBtn.addEventListener("click", function () { savePlanBuilt(null); renderDuniyaPlan(); });
    content.appendChild(editBtn);
  }

  // ---- Plan My Day: 10-question guided wizard ----
  // Screen 1 -> 10 sequential questions -> Create Today's Plan. Every
  // example (College, Gym, Study...) is placeholder text only, never
  // auto-added. USER DECIDES -> NURA ORGANIZES -> USER ADJUSTS -> FOLLOWS.

  var planWizard = null;
  var PLAN_WIZARD_STEPS = 10;

  function startPlanWizard() {
    planWizard = {
      step: 1,
      data: {
        dayStart: null, dayEnd: null,
        fixedActivities: [], flexibleActivities: [], personalActivities: [],
        priorities: { top3: [], mustNotMiss: null },
        bufferStyle: "normal", orderRules: [], note: "",
        sunnahEnabled: readJSON("nc_plan_sunnah_defaults", {})
      }
    };
    renderDuniyaPlan();
  }
  function planWizardGo(step) { planWizard.step = step; renderDuniyaPlan(); }
  function planWizardNext() { planWizardGo(planWizard.step + 1); }
  function planWizardAllActivities() {
    return planWizard.data.fixedActivities.concat(planWizard.data.flexibleActivities, planWizard.data.personalActivities);
  }

  function buildWizardHeader(content, title) {
    var backBtn = document.createElement("button");
    backBtn.className = "picker-step-back";
    backBtn.textContent = "← Back";
    backBtn.addEventListener("click", function () {
      if (planWizard.step > 1) planWizardGo(planWizard.step - 1);
      else { planWizard = null; renderDuniyaPlan(); }
    });
    content.appendChild(backBtn);
    var stepLine = document.createElement("p");
    stepLine.className = "muted-line";
    stepLine.textContent = "Question " + planWizard.step + " of " + PLAN_WIZARD_STEPS;
    content.appendChild(stepLine);
    var h2 = document.createElement("h2");
    h2.textContent = title;
    content.appendChild(h2);
  }

  function buildActivityAddRow(content, targetArray, opts) {
    var nameInput = document.createElement("input");
    nameInput.type = "text"; nameInput.className = "text-input"; nameInput.placeholder = opts.namePlaceholder;
    content.appendChild(nameInput);
    var extraInputs = opts.buildExtra ? opts.buildExtra(content) : null;
    var addBtn = document.createElement("button");
    addBtn.className = "btn btn-outline btn-full";
    addBtn.textContent = opts.addLabel || "Add";
    addBtn.addEventListener("click", function () {
      var name = nameInput.value.trim();
      if (!name) { showToast("Enter a name first"); return; }
      var entry = opts.makeEntry(name, extraInputs);
      if (entry === false) return;
      targetArray.push(entry);
      nameInput.value = "";
      renderDuniyaPlan();
    });
    content.appendChild(addBtn);
  }

  function buildActivityList(content, targetArray, describeFn) {
    if (!targetArray.length) return;
    targetArray.forEach(function (a) {
      var row = document.createElement("div");
      row.className = "duniya-goal-item";
      var info = document.createElement("span");
      info.className = "name";
      info.textContent = a.name + " — " + describeFn(a);
      var del = document.createElement("button");
      del.className = "action-btn warn";
      del.textContent = "Remove";
      del.addEventListener("click", function () {
        var idx = targetArray.indexOf(a);
        if (idx !== -1) targetArray.splice(idx, 1);
        renderDuniyaPlan();
      });
      row.appendChild(info);
      row.appendChild(del);
      content.appendChild(row);
    });
  }

  function renderWizardStep(content) {
    var d = planWizard.data;
    var step = planWizard.step;

    if (step === 1) {
      buildWizardHeader(content, "When does your day start today?");
      var t1 = document.createElement("input"); t1.type = "time"; t1.className = "text-input"; t1.value = d.dayStart || "06:00";
      content.appendChild(t1);
      var nowBtn = document.createElement("button"); nowBtn.className = "btn btn-outline btn-full"; nowBtn.textContent = "Starting now";
      nowBtn.addEventListener("click", function () {
        var now = new Date();
        d.dayStart = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
        planWizardNext();
      });
      content.appendChild(nowBtn);
      var next1 = document.createElement("button"); next1.className = "btn btn-primary btn-full"; next1.textContent = "Next";
      next1.addEventListener("click", function () { d.dayStart = t1.value || "06:00"; planWizardNext(); });
      content.appendChild(next1);

    } else if (step === 2) {
      buildWizardHeader(content, "When do you want your day to finish?");
      var t2 = document.createElement("input"); t2.type = "time"; t2.className = "text-input"; t2.value = d.dayEnd || "23:00";
      content.appendChild(t2);
      var next2 = document.createElement("button"); next2.className = "btn btn-primary btn-full"; next2.textContent = "Next";
      next2.addEventListener("click", function () { d.dayEnd = t2.value || "23:00"; planWizardNext(); });
      content.appendChild(next2);

    } else if (step === 3) {
      buildWizardHeader(content, "What things already have fixed times today?");
      var sub3 = document.createElement("p"); sub3.className = "muted-line"; sub3.textContent = "Add as many as you need — or none at all.";
      content.appendChild(sub3);
      buildActivityList(content, d.fixedActivities, function (a) { return a.startTime + (a.endTime ? " to " + a.endTime : ""); });
      buildActivityAddRow(content, d.fixedActivities, {
        namePlaceholder: "e.g. Class, Work, Appointment...",
        buildExtra: function (c) {
          var row = document.createElement("div"); row.className = "plan-form-row";
          var s = document.createElement("input"); s.type = "time"; s.className = "text-input";
          var e = document.createElement("input"); e.type = "time"; e.className = "text-input";
          row.appendChild(s); row.appendChild(e); c.appendChild(row);
          return { s: s, e: e };
        },
        makeEntry: function (name, ex) {
          if (!ex.s.value) { showToast("Enter a start time"); return false; }
          return { id: uid("plan"), name: name, mode: "fixed", status: "pending", category: "dunya", startTime: ex.s.value, endTime: ex.e.value || null, prepMinutes: 0, travelBeforeMinutes: 0, travelAfterMinutes: 0 };
        },
        addLabel: "Add fixed activity"
      });
      var next3 = document.createElement("button"); next3.className = "btn btn-primary btn-full"; next3.style.marginTop = "10px"; next3.textContent = "Next";
      next3.addEventListener("click", planWizardNext);
      content.appendChild(next3);

    } else if (step === 4) {
      buildWizardHeader(content, "Do any of these need preparation or travel time?");
      if (!d.fixedActivities.length) {
        var noneMsg = document.createElement("p"); noneMsg.className = "muted-line"; noneMsg.textContent = "No fixed activities yet — nothing to add prep/travel time to.";
        content.appendChild(noneMsg);
      }
      d.fixedActivities.forEach(function (a) {
        var box = document.createElement("div"); box.className = "duniya-goal-item"; box.style.flexDirection = "column"; box.style.alignItems = "stretch";
        var name = document.createElement("p"); name.className = "name"; name.style.marginBottom = "6px"; name.textContent = a.name + " (starts " + a.startTime + ")";
        box.appendChild(name);
        var row = document.createElement("div"); row.className = "plan-form-row";
        [["Prep", "prepMinutes"], ["Travel before", "travelBeforeMinutes"], ["Travel after", "travelAfterMinutes"]].forEach(function (f) {
          var wrap = document.createElement("div"); wrap.style.flex = "1";
          wrap.innerHTML = '<p class="plan-form-label">' + f[0] + '</p>';
          var input = document.createElement("input"); input.type = "number"; input.className = "text-input"; input.placeholder = "min"; input.value = a[f[1]] || "";
          input.addEventListener("change", function () { a[f[1]] = Number(input.value) || 0; });
          wrap.appendChild(input);
          row.appendChild(wrap);
        });
        box.appendChild(row);
        content.appendChild(box);
      });
      var next4 = document.createElement("button"); next4.className = "btn btn-primary btn-full"; next4.style.marginTop = "10px"; next4.textContent = "Next";
      next4.addEventListener("click", planWizardNext);
      content.appendChild(next4);

    } else if (step === 5) {
      buildWizardHeader(content, "What else would you like to get done today?");
      var sub5 = document.createElement("p"); sub5.className = "muted-line"; sub5.textContent = "These are flexible — NURA fits them into the gaps in your day.";
      content.appendChild(sub5);
      buildActivityList(content, d.flexibleActivities, function (a) { return a.durationMinutes + " min · " + a.priority + " priority"; });
      buildActivityAddRow(content, d.flexibleActivities, {
        namePlaceholder: "e.g. Study, Workout, Reading...",
        buildExtra: function (c) {
          var row = document.createElement("div"); row.className = "plan-form-row";
          var dur = document.createElement("input"); dur.type = "number"; dur.className = "text-input"; dur.placeholder = "Duration (min)";
          row.appendChild(dur); c.appendChild(row);
          return { dur: dur };
        },
        makeEntry: function (name, ex) {
          return { id: uid("plan"), name: name, mode: "flexible", status: "pending", category: "dunya", durationMinutes: Number(ex.dur.value) || 30, priority: "medium" };
        },
        addLabel: "Add activity"
      });
      var next5 = document.createElement("button"); next5.className = "btn btn-primary btn-full"; next5.style.marginTop = "10px"; next5.textContent = "Next";
      next5.addEventListener("click", planWizardNext);
      content.appendChild(next5);

    } else if (step === 6) {
      buildWizardHeader(content, "What matters most today?");
      var all6 = planWizardAllActivities();
      if (!all6.length) {
        var noAct = document.createElement("p"); noAct.className = "muted-line"; noAct.textContent = "Add some activities in the earlier questions first, or skip this.";
        content.appendChild(noAct);
      } else {
        var sub6 = document.createElement("p"); sub6.className = "muted-line"; sub6.textContent = "Pick up to 3 priorities from what you entered.";
        content.appendChild(sub6);
        var grid6 = document.createElement("div"); grid6.className = "preset-plan-grid";
        all6.forEach(function (a) {
          var chip = document.createElement("button"); chip.type = "button"; chip.className = "preset-plan-chip" + (d.priorities.top3.indexOf(a.id) !== -1 ? " active-chip" : "");
          chip.textContent = a.name;
          chip.addEventListener("click", function () {
            var idx = d.priorities.top3.indexOf(a.id);
            if (idx !== -1) d.priorities.top3.splice(idx, 1);
            else if (d.priorities.top3.length < 3) d.priorities.top3.push(a.id);
            else { showToast("Only 3 priorities — remove one first"); return; }
            renderDuniyaPlan();
          });
          grid6.appendChild(chip);
        });
        content.appendChild(grid6);

        var mustLabel = document.createElement("p"); mustLabel.className = "plan-form-label"; mustLabel.style.marginTop = "14px"; mustLabel.textContent = "The ONE thing you especially don't want to miss:";
        content.appendChild(mustLabel);
        var mustSelect = document.createElement("select"); mustSelect.className = "text-input";
        var noneOpt = document.createElement("option"); noneOpt.value = ""; noneOpt.textContent = "— none —"; mustSelect.appendChild(noneOpt);
        all6.forEach(function (a) { var o = document.createElement("option"); o.value = a.id; o.textContent = a.name; if (d.priorities.mustNotMiss === a.id) o.selected = true; mustSelect.appendChild(o); });
        mustSelect.addEventListener("change", function () { d.priorities.mustNotMiss = mustSelect.value || null; });
        content.appendChild(mustSelect);
      }
      var next6 = document.createElement("button"); next6.className = "btn btn-primary btn-full"; next6.style.marginTop = "14px"; next6.textContent = "Next";
      next6.addEventListener("click", planWizardNext);
      content.appendChild(next6);

    } else if (step === 7) {
      buildWizardHeader(content, "What time do you need for normal life today?");
      var sub7 = document.createElement("p"); sub7.className = "muted-line"; sub7.textContent = "Meals, rest, family time — NURA protects these first.";
      content.appendChild(sub7);
      buildActivityList(content, d.personalActivities, function (a) { return a.durationMinutes + " min"; });
      var quickGrid = document.createElement("div"); quickGrid.className = "preset-plan-grid";
      [["Breakfast", 20], ["Lunch", 30], ["Dinner", 30], ["Shower", 15], ["Rest", 30], ["Family time", 45], ["Personal time", 30]].forEach(function (q) {
        var chip = document.createElement("button"); chip.type = "button"; chip.className = "preset-plan-chip"; chip.textContent = q[0];
        chip.addEventListener("click", function () {
          d.personalActivities.push({ id: uid("plan"), name: q[0], mode: "flexible", status: "pending", category: "dunya", durationMinutes: q[1], priority: "high", isPersonal: true });
          renderDuniyaPlan();
        });
        quickGrid.appendChild(chip);
      });
      content.appendChild(quickGrid);
      buildActivityAddRow(content, d.personalActivities, {
        namePlaceholder: "Something else...",
        buildExtra: function (c) {
          var dur = document.createElement("input"); dur.type = "number"; dur.className = "text-input"; dur.placeholder = "Duration (min)"; c.appendChild(dur);
          return { dur: dur };
        },
        makeEntry: function (name, ex) {
          return { id: uid("plan"), name: name, mode: "flexible", status: "pending", category: "dunya", durationMinutes: Number(ex.dur.value) || 20, priority: "high", isPersonal: true };
        },
        addLabel: "Add"
      });
      var next7 = document.createElement("button"); next7.className = "btn btn-primary btn-full"; next7.style.marginTop = "10px"; next7.textContent = "Next";
      next7.addEventListener("click", planWizardNext);
      content.appendChild(next7);

    } else if (step === 8) {
      buildWizardHeader(content, "How much breathing space do you want in your day?");
      var opts8 = [["tight", "Very tight"], ["normal", "Normal"], ["relaxed", "Relaxed"]];
      opts8.forEach(function (o) {
        var chip = document.createElement("button"); chip.type = "button"; chip.className = "preset-plan-chip" + (d.bufferStyle === o[0] ? " active-chip" : ""); chip.style.display = "block"; chip.style.width = "100%"; chip.style.marginBottom = "8px"; chip.textContent = o[1];
        chip.addEventListener("click", function () { d.bufferStyle = o[0]; renderDuniyaPlan(); });
        content.appendChild(chip);
      });
      var next8 = document.createElement("button"); next8.className = "btn btn-primary btn-full"; next8.style.marginTop = "10px"; next8.textContent = "Next";
      next8.addEventListener("click", planWizardNext);
      content.appendChild(next8);

    } else if (step === 9) {
      buildWizardHeader(content, "Does anything need to happen before or after something else?");
      var sub9 = document.createElement("p"); sub9.className = "muted-line"; sub9.textContent = "Optional — skip if not needed.";
      content.appendChild(sub9);
      var all9 = planWizardAllActivities();
      if (d.orderRules.length) {
        d.orderRules.forEach(function (r, i) {
          var a = all9.find(function (x) { return x.id === r.firstId; });
          var b = all9.find(function (x) { return x.id === r.secondId; });
          var row = document.createElement("div"); row.className = "duniya-goal-item";
          var info = document.createElement("span"); info.className = "name"; info.textContent = (a ? a.name : "?") + " before " + (b ? b.name : "?");
          var del = document.createElement("button"); del.className = "action-btn warn"; del.textContent = "Remove";
          del.addEventListener("click", function () { d.orderRules.splice(i, 1); renderDuniyaPlan(); });
          row.appendChild(info); row.appendChild(del);
          content.appendChild(row);
        });
      }
      if (all9.length >= 2) {
        var ruleRow = document.createElement("div"); ruleRow.className = "plan-form-row";
        var firstSel = document.createElement("select"); firstSel.className = "text-input";
        var secondSel = document.createElement("select"); secondSel.className = "text-input";
        all9.forEach(function (a) {
          var o1 = document.createElement("option"); o1.value = a.id; o1.textContent = a.name; firstSel.appendChild(o1);
          var o2 = document.createElement("option"); o2.value = a.id; o2.textContent = a.name; secondSel.appendChild(o2);
        });
        ruleRow.appendChild(firstSel); ruleRow.appendChild(secondSel);
        content.appendChild(ruleRow);
        var addRuleBtn = document.createElement("button"); addRuleBtn.className = "btn btn-outline btn-full"; addRuleBtn.textContent = "Add: first before second";
        addRuleBtn.addEventListener("click", function () {
          if (firstSel.value === secondSel.value) { showToast("Pick two different activities"); return; }
          d.orderRules.push({ firstId: firstSel.value, secondId: secondSel.value });
          renderDuniyaPlan();
        });
        content.appendChild(addRuleBtn);
      }
      var next9 = document.createElement("button"); next9.className = "btn btn-primary btn-full"; next9.style.marginTop = "10px"; next9.textContent = "Next";
      next9.addEventListener("click", planWizardNext);
      content.appendChild(next9);

    } else if (step === 10) {
      buildWizardHeader(content, "Anything else NURA should know about today?");
      var sub10 = document.createElement("p"); sub10.className = "muted-line"; sub10.textContent = "Optional. E.g. “nothing after 9 PM” or “I'm tired today.”";
      content.appendChild(sub10);
      var noteInput = document.createElement("textarea"); noteInput.className = "text-input reflection-textarea"; noteInput.rows = 3; noteInput.value = d.note;
      content.appendChild(noteInput);

      var sunnahTitle = document.createElement("p"); sunnahTitle.className = "picker-step-title"; sunnahTitle.style.marginTop = "14px"; sunnahTitle.textContent = "Include Sunnah habits";
      content.appendChild(sunnahTitle);
      PLAN_SUNNAH_ITEMS.forEach(function (s) {
        var label = document.createElement("label"); label.className = "checklist-item";
        var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!d.sunnahEnabled[s.key];
        cb.addEventListener("change", function () { d.sunnahEnabled[s.key] = cb.checked; });
        var span = document.createElement("span"); span.textContent = s.label;
        label.appendChild(cb); label.appendChild(span);
        content.appendChild(label);
      });

      var createBtn = document.createElement("button"); createBtn.className = "btn btn-primary btn-full"; createBtn.style.marginTop = "16px"; createBtn.textContent = "Create Today's Plan";
      createBtn.addEventListener("click", function () {
        d.note = noteInput.value.trim();
        finishPlanWizard();
      });
      content.appendChild(createBtn);
    }
  }

  function applyPlanNoteRules(d) {
    var note = (d.note || "").toLowerCase();
    var m = note.match(/nothing (scheduled )?after (\d{1,2})\s*(am|pm)/);
    if (m) {
      var hour = Number(m[2]) % 12 + (m[3] === "pm" ? 12 : 0);
      var proposed = String(hour).padStart(2, "0") + ":00";
      if (planTimeToMinutes(proposed) < planTimeToMinutes(d.dayEnd)) d.dayEnd = proposed;
    }
    if (/tired/.test(note) && d.bufferStyle === "tight") d.bufferStyle = "normal";
    var evening = note.match(/(\d+)\s*hour.*evening|evening.*free/);
    if (evening) {
      var hrs = Number(evening[1]) || 1;
      d.personalActivities.push({ id: uid("plan"), name: "Reserved evening free time", mode: "flexible", status: "pending", category: "dunya", durationMinutes: hrs * 60, priority: "high", isPersonal: true, eveningReserved: true });
    }
  }

  function finishPlanWizard() {
    var d = planWizard.data;
    applyPlanNoteRules(d);
    var activities = planWizardAllActivities();
    savePlanActivities(activities);
    writeJSON("nc_plan_sunnah_defaults", d.sunnahEnabled);
    var settings = {
      dayStart: d.dayStart || "06:00", dayEnd: d.dayEnd || "23:00",
      sunnahEnabled: d.sunnahEnabled, bufferStyle: d.bufferStyle,
      priorities: d.priorities, orderRules: d.orderRules, note: d.note
    };
    savePlanSettings(settings);
    planWizard = null;
    activities.forEach(function (a) { if (a.mode === "fixed" && a.startTime) memObserve(a.name, todayKey(), a.startTime, a.endTime, false); });
    memLog("plan_created", "plan", { source: "wizard", fixed: activities.filter(function (a) { return a.mode === "fixed"; }).length, flexible: activities.filter(function (a) { return a.mode === "flexible"; }).length });
    runBuildMyDay();
  }

  function renderPlanEntryScreen(content) {
    var h2 = document.createElement("h2");
    h2.textContent = "Plan My Day";
    content.appendChild(h2);
    var sub = document.createElement("p");
    sub.className = "muted-line";
    sub.style.marginBottom = "16px";
    sub.textContent = "Tell NURA what your day looks like. We'll help you organize it.";
    content.appendChild(sub);

    var existing = getPlanActivities();
    if (existing.length) {
      var existingNote = document.createElement("p");
      existingNote.className = "muted-line";
      existingNote.style.marginBottom = "12px";
      existingNote.textContent = "You already have " + existing.length + " activit" + (existing.length === 1 ? "y" : "ies") + " planned for today.";
      content.appendChild(existingNote);
      var editBtn = document.createElement("button");
      editBtn.className = "btn btn-outline btn-full";
      editBtn.textContent = "Edit Plan";
      editBtn.addEventListener("click", function () {
        planWizard = { step: 3, data: {
          dayStart: getPlanSettings().dayStart, dayEnd: getPlanSettings().dayEnd,
          fixedActivities: existing.filter(function (a) { return a.mode === "fixed"; }),
          flexibleActivities: existing.filter(function (a) { return a.mode === "flexible" && !a.isPersonal; }),
          personalActivities: existing.filter(function (a) { return a.isPersonal; }),
          priorities: getPlanSettings().priorities, bufferStyle: getPlanSettings().bufferStyle,
          orderRules: getPlanSettings().orderRules, note: getPlanSettings().note,
          sunnahEnabled: getPlanSettings().sunnahEnabled
        } };
        renderDuniyaPlan();
      });
      content.appendChild(editBtn);
      var rebuildBtn = document.createElement("button");
      rebuildBtn.className = "btn btn-outline btn-full";
      rebuildBtn.textContent = "Rebuild Plan";
      rebuildBtn.addEventListener("click", runBuildMyDay);
      content.appendChild(rebuildBtn);
      var startFreshBtn = document.createElement("button");
      startFreshBtn.className = "priority-change-link";
      startFreshBtn.textContent = "Start a completely new plan";
      startFreshBtn.addEventListener("click", function () {
        savePlanActivities([]);
        startPlanWizard();
      });
      content.appendChild(startFreshBtn);
      return;
    }

    var memShown = renderPlanMemoryCard(content);
    var createBtn = document.createElement("button");
    createBtn.className = memShown ? "priority-change-link" : "btn btn-primary btn-full";
    createBtn.textContent = memShown ? "Create today's plan from scratch instead" : "Create Today's Plan";
    createBtn.addEventListener("click", startPlanWizard);
    content.appendChild(createBtn);
  }

  function renderDuniyaPlan() {
    var content = document.getElementById("duniya-plan-content");
    content.innerHTML = "";
    var built = getPlanBuilt();
    if (planWizard) renderWizardStep(content);
    else if (built) renderPlanTimelineView(content, built);
    else renderPlanEntryScreen(content);
  }

  function initDuniyaPlan() {
    document.getElementById("duniya-plan-back").addEventListener("click", function () {
      planWizard = null;
      setActiveView("duniya");
    });
  }

  // ===================================================================
  // DAILY FLOW + LIFE GRID (2026-09-26)
  //
  // The paper method, made durable: the user writes what they plan to do,
  // ticks it as it happens, and the ticks accumulate into a weekly grid.
  //
  //   nc_flow_actions          [DailyAction]  what the user planned (their choice only)
  //   nc_flow_log_YYYY-MM      {date:{actionId:{v}|{s:"skip"}}}  one shard per month,
  //                            so opening a week never reads more than two small blobs
  //   nc_flow_miles            {date:{key:1}}  milestones already shown (never repeated)
  //   nc_flow_reflect          {weekStart:"easy|balanced|difficult"}
  //
  // DailyAction (the recurring TEMPLATE; an "occurrence" is this template on one date)
  //   { id, name, category, tag?, startDate, archivedAt|null, createdAt, link?:{kind:salah|sunnah|habit, key},
  //     type: simple|count|time|quantity|value, target:number|null, unit:string, time:"HH:MM"|null,
  //     repeat:{kind:once|daily|weekdays|days, date?, days?[Mon=0]},     <- the CURRENT schedule
  //     vers?: [{from, type, target, unit, time, repeat}]                <- schedule history, oldest first
  //     ex?:   {originDate:{to:date}} }                                  <- moved occurrences
  //
  // Three rules keep history honest:
  //  1. An action exists from `startDate`. Dates before it are "not planned" (never "missed").
  //  2. Changing the schedule (days, time, target, type) adds a version effective from TODAY, so past days
  //     are still judged against the schedule that was actually in force then.
  //  3. Moving an occurrence never copies the template. It writes one exception (originDate -> newDate),
  //     so the template has exactly one occurrence per origin no matter how often it is moved again.
  //
  // A `link` makes an action read/write the data NURA already keeps (Salah completions, Sunnah log,
  // habit log) instead of duplicating it — ticking Fajr here and on Home are the same fact.
  // Later systems (Study Mission, Recovery, Money…) plug in by creating actions with their own
  // `source`/`link` kinds; nothing here is specific to them.
  //
  // Progress is completion of planned actions and nothing else: each applicable action counts once;
  // a measured action contributes value/target (capped at 1). Skipped or rescheduled actions are set
  // aside, not counted against the user. No score, no moral rating.
  // ===================================================================

  var FLOW_KEY = "nc_flow_actions", FLOW_MILES = "nc_flow_miles", FLOW_REFLECT = "nc_flow_reflect";
  var flowTab = "today", flowWeekStart = null, flowPulseId = null, flowNoteTimer = null;
  var flowLogCache = {}, flowLinkCache = {}, flowPulseKey = null;

  var FLOW_KINDS = [
    { k: "task", label: "Task", icon: "✅" }, { k: "study", label: "Study", icon: "📚" }, { k: "deen", label: "Deen", icon: "🤲" },
    { k: "fitness", label: "Fitness", icon: "🏋️" }, { k: "sleep", label: "Sleep", icon: "😴" }, { k: "personal", label: "Personal", icon: "⭐" },
    { k: "salah", label: "Salah", icon: "🕌" }, { k: "habit", label: "Habit", icon: "🌱" }
  ];
  var FLOW_TYPES = [
    { k: "simple", label: "Simple tick" }, { k: "count", label: "Count (pages, rakah…)" }, { k: "time", label: "Time (minutes)" },
    { k: "quantity", label: "Quantity (litres, questions…)" }, { k: "value", label: "Value (e.g. sleep hours)" }
  ];
  var FLOW_SECTIONS = [["morning", "Morning"], ["afternoon", "Afternoon"], ["evening", "Evening"], ["night", "Night"], ["any", "Anytime today"]];
  var FD_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var FD_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
  var SALAH_DEFAULT_MIN = { Fajr: 330, Dhuhr: 780, Asr: 990, Maghrib: 1110, Isha: 1200 };

  // ---- dates (local, Monday = 0) ----
  function fdParse(k) { var p = k.split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0); }
  function fdAdd(k, n) { var d = fdParse(k); d.setDate(d.getDate() + n); return todayKey(d); }
  function fdDow(k) { return (fdParse(k).getDay() + 6) % 7; }
  function fdWeekStart(k) { return fdAdd(k, -fdDow(k)); }
  function fdShort(k) { return fdParse(k).toLocaleDateString(undefined, { day: "numeric", month: "short" }); }
  function fdLong(k) { return fdParse(k).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }); }
  function fnum(x) { return String(Math.round(x * 100) / 100); }

  // ---- storage ----
  function flowActions() { var a = readJSON(FLOW_KEY, []); return Array.isArray(a) ? a : []; }
  function flowSaveActions(a) { writeJSON(FLOW_KEY, a); }
  function flowMonthKey(dk) { return "nc_flow_log_" + dk.slice(0, 7); }
  function flowMonth(dk) { var k = flowMonthKey(dk); if (!flowLogCache[k]) flowLogCache[k] = readJSON(k, {}); return flowLogCache[k]; }
  function flowEntry(dk, id) { return (flowMonth(dk)[dk] || {})[id] || null; }
  function flowSetEntry(dk, id, entry) {
    var m = flowMonth(dk), d = m[dk] || (m[dk] = {});
    if (entry) d[id] = entry; else delete d[id];
    if (!Object.keys(d).length) delete m[dk];
    writeJSON(flowMonthKey(dk), m);
  }
  function lc(key) { return flowLinkCache[key] || (flowLinkCache[key] = readJSON(key, {})); }
  function flowActionById(id) { return flowActions().filter(function (a) { return a.id === id; })[0] || null; }

  function flowKindInfo(k) { return FLOW_KINDS.filter(function (x) { return x.k === k; })[0] || FLOW_KINDS[0]; }
  function flowGroup(a) {
    return a.category === "salah" ? "Salah" : a.category === "deen" ? "Deen" : (a.category === "study" || a.category === "task" || a.category === "fitness") ? "Focus" : "Personal";
  }

  // ---- when does an action apply? ----
  // The schedule in force on a date (older dates keep the schedule they were planned under).
  function flowVer(a, dk) {
    var v = a.vers;
    if (!v || !v.length) return a;
    var pick = v[0];
    for (var i = 0; i < v.length; i++) { if (v[i].from <= dk) pick = v[i]; }
    return pick;
  }
  // Would the schedule itself put an occurrence on this date (ignoring moves)?
  function flowNativeApplies(a, dk) {
    var r = flowVer(a, dk).repeat || { kind: "once" };
    if (r.kind === "once") return r.date === dk;
    if (r.kind === "daily") return true;
    var dow = fdDow(dk);
    if (r.kind === "weekdays") return dow <= 4;
    if (r.kind === "days") return (r.days || []).indexOf(dow) !== -1;
    return false;
  }
  // Moved occurrences: ex[originDate] = {to}. One origin = one occurrence, however often it is moved.
  function flowMovedInFrom(a, dk) {
    if (!a.ex) return null;
    for (var o in a.ex) { if (a.ex.hasOwnProperty(o) && a.ex[o].to === dk) return o; }
    return null;
  }
  function flowMovedOutTo(a, dk) {
    var e = a.ex && a.ex[dk];
    if (!e) return null;
    if (dk < a.startDate || (a.archivedAt && dk >= a.archivedAt)) return null;
    return flowNativeApplies(a, dk) ? e.to : null;
  }
  // Is there an occurrence on this date? (A moved-out one still counts as "there": it shows as moved.)
  function flowApplies(a, dk) {
    if (a.archivedAt && dk >= a.archivedAt) return false;
    if (flowMovedInFrom(a, dk)) return true;
    if (dk < a.startDate) return false;
    return flowNativeApplies(a, dk);
  }

  // ---- linked data (Salah / Sunnah / habits): read and write the app's own stores ----
  function flowLinkRead(a, dk) {
    var l = a.link;
    if (l.kind === "salah") { var d = !!((lc("nc_salah_completions")[dk] || {})[l.key]); return { v: d ? 1 : 0, frac: d ? 1 : 0 }; }
    if (l.kind === "habit") { var h = ((lc("nc_duniya_habit_log")[dk] || {})[l.key]) === "done"; return { v: h ? 1 : 0, frac: h ? 1 : 0 }; }
    if (l.kind === "sunnah") {
      var sec = ROUTINE_SECTIONS.filter(function (s) { return s.id === l.key; })[0];
      var log = lc("nc_sunnah_log")[dk] || {};
      var n = sec ? sec.actions.filter(function (x) { return log[x.id]; }).length : 0;
      var t = sec ? sec.actions.length : 0;
      return { v: n, frac: t ? n / t : 0 };
    }
    return { v: 0, frac: 0 };
  }
  function flowLinkWrite(a, dk, on) {
    var l = a.link;
    if (l.kind === "salah") {
      var all = readJSON("nc_salah_completions", {});
      all[dk] = all[dk] || {};
      if (on) all[dk][l.key] = true; else delete all[dk][l.key];
      writeJSON("nc_salah_completions", all);
    } else if (l.kind === "habit") {
      var hl = readJSON("nc_duniya_habit_log", {});
      hl[dk] = hl[dk] || {};
      if (on) hl[dk][l.key] = "done"; else delete hl[dk][l.key];
      writeJSON("nc_duniya_habit_log", hl);
    } else if (l.kind === "sunnah") {
      var sec = ROUTINE_SECTIONS.filter(function (s) { return s.id === l.key; })[0];
      if (!sec) return;
      var log = getDaySunnahLog(dk);
      sec.actions.forEach(function (x) { if (on) log[x.id] = true; else delete log[x.id]; });
      setDaySunnahLog(dk, log);
    }
    flowLinkCache = {};
  }

  // ---- state of one action on one date ----
  function flowState(a, dk) {
    var V = flowVer(a, dk);
    if (!flowMovedInFrom(a, dk)) {
      var to = flowMovedOutTo(a, dk);
      if (to) return { kind: "rs", to: to, frac: 0, v: 0 };
    }
    var e = flowEntry(dk, a.id);
    if (e && e.s === "skip") return { kind: "skip", frac: 0, v: 0 };
    var v = 0, frac = 0;
    if (a.link) { var L = flowLinkRead(a, dk); v = L.v; frac = L.frac; }
    else if (V.type === "simple") { v = e && e.v ? 1 : 0; frac = v; }
    else {
      v = e && typeof e.v === "number" ? e.v : 0;
      frac = V.target ? Math.min(1, v / V.target) : (v > 0 ? 1 : 0);
    }
    return { kind: frac >= 1 ? "done" : frac > 0 ? "partial" : "open", v: v, frac: frac };
  }

  function flowTimeFor(a, dk, realOnly) {
    var vt = flowVer(a, dk).time;
    if (vt) return vt;
    if (a.link && a.link.kind === "salah") {
      if (dk === todayKey()) { var T = homeTimings(); if (T && T[a.link.key]) return T[a.link.key]; }
      if (realOnly) return null;
      var m = SALAH_DEFAULT_MIN[a.link.key] || 720;
      return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
    }
    return null;
  }
  function flowMinOf(t) { var p = t.split(":"); return Number(p[0]) * 60 + Number(p[1]); }
  function flowSectionOf(a, dk) {
    var t = flowTimeFor(a, dk, false);
    if (!t) return "any";
    var h = Number(t.split(":")[0]);
    return h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
  }

  // ---- one day: what was planned, what's done ----
  function flowDay(dk) {
    var items = [];
    flowActions().forEach(function (a) { if (flowApplies(a, dk)) items.push({ a: a, st: flowState(a, dk) }); });
    var counted = items.filter(function (it) { return it.st.kind !== "skip" && it.st.kind !== "rs"; });
    var done = 0, sum = 0, partial = false;
    counted.forEach(function (it) { if (it.st.kind === "done") done++; else if (it.st.kind === "partial") partial = true; sum += it.st.frac; });
    var pct = null;
    if (counted.length) {
      pct = Math.round((sum / counted.length) * 100);
      if (done < counted.length && pct >= 100) pct = 99;
      if (sum > 0 && pct < 1) pct = 1;
    }
    return { items: items, counted: counted, done: done, total: counted.length, pct: pct, sum: sum, partial: partial };
  }

  // ---- history and consistency ----
  // Every planned occurrence of one action, oldest first, up to today. Only real planned days appear:
  // nothing before the start date, nothing in the future, and days the schedule skipped over (a Mon/Wed/Fri
  // action has no Tuesday) simply aren't there. k: done | part | miss | open (today, not done yet) | skip | rs.
  function flowHistory(a, days) {
    var today = todayKey(), out = [], limit = days || 90;
    for (var i = 0; i < limit; i++) {
      var dk = fdAdd(today, -i);
      if (dk < a.startDate) break;
      if (!flowApplies(a, dk)) continue;
      var s = flowState(a, dk);
      out.push({ dk: dk, k: s.kind === "done" ? "done" : s.kind === "partial" ? "part" : s.kind === "skip" ? "skip" : s.kind === "rs" ? "rs" : (dk === today ? "open" : "miss") });
    }
    return out.reverse();
  }
  // Consistency counts planned days only. Skipped/moved days are set aside (neither success nor failure),
  // and today only counts once it has an outcome.
  function flowConsistency(a) {
    var judged = flowHistory(a, 90).filter(function (h) { return h.k === "done" || h.k === "part" || h.k === "miss"; });
    var run = 0;
    for (var i = judged.length - 1; i >= 0; i--) { if (judged[i].k === "done") run++; else break; }
    var last = judged.slice(-5), lastDone = last.filter(function (h) { return h.k === "done"; }).length;
    return { judged: judged.length, run: run, last: last.length, lastDone: lastDone };
  }
  // The one-line note on a Today row. Never for Salah; never a "streak" for worship — just the facts.
  function flowConsistencyText(a, full) {
    if (a.link && a.link.kind === "salah") return null;
    var c = flowConsistency(a), worship = a.category === "deen" || a.category === "salah";
    if (!worship && c.run >= 3) return c.run + " planned days in a row";
    if (c.last >= 3 && (full || c.lastDone / c.last >= 0.6)) return "Done " + c.lastDone + " of the last " + c.last + " planned days";
    return null;
  }

  // ---- what Hamdard is allowed to know about the Daily Flow ----
  // Structured, factual, counts and names only, all computed from the records above; nothing is guessed.
  // Every pattern carries a FACT (what the records show, with the number of planned days behind it) and,
  // separately, an optional SUGGESTION (an idea, never stated as fact). A claim needs at least
  // FLOW_PAT_MIN planned days of evidence; below that Hamdard is told there isn't enough history.
  // Worship (Salah, Deen routines) is only ever counted — no patterns, no suggestions, no scoring.
  var FLOW_PAT_DAYS = 14, FLOW_PAT_MIN = 3;
  function flowIsWorship(a) { return a.category === "salah" || a.category === "deen" || !!(a.link && (a.link.kind === "salah" || a.link.kind === "sunnah")); }
  function flowContext() {
    var today = todayKey(), wkStart = fdAdd(today, -6), acts = flowActions();
    var d = flowDay(today), ctx = { today: null, week: { planned: 0, done: 0, partial: 0, missed: 0, skipped: 0, moved: 0 }, actions: [], patterns: [], evidence: null };
    ctx.today = {
      planned: d.total, done: d.done, partial: d.partial,
      skipped: d.items.filter(function (it) { return it.st.kind === "skip"; }).length,
      moved: d.items.filter(function (it) { return it.st.kind === "rs"; }).length,
      items: d.items.slice(0, 12).map(function (it) { var t = flowTimeFor(it.a, today, true); return { name: it.a.name, time: t ? flowClock(t) : null, state: it.st.kind }; })
    };
    var sections = {}, judgedTotal = 0, dayHas = {};
    acts.forEach(function (a) {
      if (a.archivedAt && a.archivedAt <= fdAdd(today, -FLOW_PAT_DAYS)) return;
      var h = flowHistory(a, FLOW_PAT_DAYS);
      if (!h.length) return;
      var judged = h.filter(function (x) { return x.k === "done" || x.k === "part" || x.k === "miss"; });
      var count = function (list, k) { return list.filter(function (x) { return x.k === k; }).length; };
      var worship = flowIsWorship(a);
      var rec = {
        id: a.id, name: a.name, category: a.category, tag: a.tag || null, worship: worship,
        time: a.time || null, timeLabel: a.time ? flowClock(a.time) : null, schedule: a.repeat && a.repeat.kind !== "once" ? flowRepeatText(a.repeat) : "one day",
        tracking: a.type, startedOn: a.startDate, scheduleChanged: !!(a.vers && a.vers.length > 1),
        window: { planned: judged.length, done: count(judged, "done"), partial: count(judged, "part"), missed: count(judged, "miss"), skipped: count(h, "skip"), moved: count(h, "rs") },
        recent: judged.slice(-5).map(function (x) { return x.k === "done" ? "done" : x.k === "part" ? "partial" : "missed"; })
      };
      ctx.actions.push(rec);
      judgedTotal += judged.length;
      judged.forEach(function (x) { dayHas[x.dk] = true; });
      h.forEach(function (x) {
        if (x.dk < wkStart) return;
        if (x.k === "done") { ctx.week.planned++; ctx.week.done++; } else if (x.k === "part") { ctx.week.planned++; ctx.week.partial++; }
        else if (x.k === "miss") { ctx.week.planned++; ctx.week.missed++; } else if (x.k === "skip") ctx.week.skipped++; else if (x.k === "rs") ctx.week.moved++;
      });
      if (worship) return;

      // timed actions feed the time-of-day comparison
      if (a.time) judged.forEach(function (x) {
        var s = flowSectionOf(a, x.dk), b = sections[s] || (sections[s] = { planned: 0, done: 0 });
        b.planned++; if (x.k === "done") b.done++;
      });

      // missed on every one of the most recent planned days, all at the schedule that is in force now
      var same = judged.filter(function (x) { return (flowVer(a, x.dk).time || null) === (a.time || null); }), n = 0;
      for (var i = same.length - 1; i >= 0 && same[i].k === "miss"; i--) n++;
      if (n >= FLOW_PAT_MIN) {
        var late = a.time && flowMinOf(a.time) >= 17 * 60;
        ctx.patterns.push({ kind: "missed-run", actionId: a.id, category: a.category, count: n, timeLabel: rec.timeLabel,
          fact: (rec.timeLabel ? "“" + a.name + "” at " + rec.timeLabel : "“" + a.name + "”") + " has been missed on the last " + n + " planned days.",
          suggestion: rec.timeLabel ? "Would you like to try " + (late ? "an earlier time" : "a different time") + "?" : (a.type !== "simple" && a.target ? "A smaller target might be easier to start with." : "If it isn't realistic right now, it can be moved or adjusted."),
          canEdit: true });
      }
      if (rec.window.moved >= 3) {
        ctx.patterns.push({ kind: "moved-often", actionId: a.id, category: a.category, count: rec.window.moved,
          fact: "You've moved “" + a.name + "” " + rec.window.moved + " times in the last two weeks.", suggestion: "A different day or time might fit it better.", canEdit: true });
      }
      var last = judged.slice(-5), ld = count(last, "done");
      if (last.length >= 4 && ld / last.length >= 0.75 && n < FLOW_PAT_MIN) {
        ctx.patterns.push({ kind: "steady", actionId: a.id, category: a.category, count: ld,
          fact: "You completed " + ld + " of your last " + last.length + " planned days of “" + a.name + "”.",
          suggestion: rec.timeLabel && !rec.scheduleChanged ? "Keeping the same time (" + rec.timeLabel + ") may be working well." : null, canEdit: false });
      }
    });

    // morning vs evening, only when both sides have real weight and the gap is large
    var sk = Object.keys(sections).filter(function (s) { return sections[s].planned >= 6; });
    if (sk.length >= 2) {
      var rate = function (s) { return sections[s].done / sections[s].planned; };
      sk.sort(function (x, y) { return rate(y) - rate(x); });
      var hi = sk[0], lo = sk[sk.length - 1];
      if (rate(hi) - rate(lo) >= 0.3) {
        ctx.patterns.push({ kind: "time-of-day", category: null, count: sections[lo].planned,
          fact: "Over the last two weeks, " + lo + " plans were completed " + sections[lo].done + " of " + sections[lo].planned + " times, and " + hi + " plans " + sections[hi].done + " of " + sections[hi].planned + ".",
          suggestion: "If that keeps up, moving one " + lo + " plan to the " + hi + " could help.", canEdit: false });
      }
    }
    var rank = { "missed-run": 0, "moved-often": 1, "time-of-day": 2, "steady": 3 };
    ctx.patterns.sort(function (x, y) { return rank[x.kind] - rank[y.kind] || y.count - x.count; });
    ctx.patterns = ctx.patterns.slice(0, 4);
    ctx.evidence = { windowDays: FLOW_PAT_DAYS, judgedTotal: judgedTotal, judgedDays: Object.keys(dayHas).length, minimumPerClaim: FLOW_PAT_MIN, enough: judgedTotal >= 6 && Object.keys(dayHas).length >= 3 };
    return ctx;
  }

  // ---- changing things ----
  function flowBuzz() { try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* not supported */ } }
  function flowNote(text) {
    var el = document.getElementById("flow-note");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("hidden");
    el.classList.remove("fl-note-in"); void el.offsetWidth; el.classList.add("fl-note-in");
    clearTimeout(flowNoteTimer);
    flowNoteTimer = setTimeout(function () { el.classList.add("hidden"); }, 3400);
  }

  function flowMilestone(a, dk, day) {
    var miles = readJSON(FLOW_MILES, {}), m = miles[dk] || {};
    var cands = [];
    if (day.total >= 3 && day.done === day.total) cands.push(["all", "Everything you planned today is done."]);
    if (a.type === "time" && a.category === "study" && flowState(a, dk).kind === "done") cands.push(["study-" + a.id, "Study target completed."]);
    var sec = flowSectionOf(a, dk);
    if (sec !== "any") {
      var same = day.counted.filter(function (it) { return flowSectionOf(it.a, dk) === sec; });
      if (same.length >= 2 && same.every(function (it) { return it.st.kind === "done"; })) {
        cands.push(["sec-" + sec, FLOW_SECTIONS.filter(function (s) { return s[0] === sec; })[0][1] + " plan complete."]);
      }
    }
    if (day.done === 5 || day.done === 10) cands.push(["n" + day.done, day.done + " planned actions done."]);
    for (var i = 0; i < cands.length; i++) {
      if (m[cands[i][0]]) continue;
      m[cands[i][0]] = 1; miles[dk] = m;
      var cut = fdAdd(todayKey(), -14);
      Object.keys(miles).forEach(function (k) { if (k < cut) delete miles[k]; });
      writeJSON(FLOW_MILES, miles);
      return cands[i][1];
    }
    return null;
  }

  function flowChanged(a, dk, wasDone) {
    flowLinkCache = {};
    var st = flowState(a, dk);
    if (st.kind === "done" && !wasDone) {
      flowPulseId = a.id; flowPulseKey = a.id + "|" + dk;
      flowBuzz();
      var msg = flowMilestone(a, dk, flowDay(dk));
      if (msg) flowNote(msg);
    }
    flowRender();
    flowPulseId = null; flowPulseKey = null;
  }

  function flowToggle(a, dk) {
    var st = flowState(a, dk), was = st.kind === "done", V = flowVer(a, dk);
    if (a.link) flowLinkWrite(a, dk, !was);
    else if (V.type === "simple") flowSetEntry(dk, a.id, was ? null : { v: 1 });
    else if (V.type === "value" && !V.target && !was) { openFlowValueSheet(a, dk); return; }
    else flowSetEntry(dk, a.id, was ? null : { v: V.target || 1 });
    flowChanged(a, dk, was);
  }
  function flowSetValue(a, dk, v) {
    var was = flowState(a, dk).kind === "done";
    flowSetEntry(dk, a.id, v > 0 ? { v: v } : null);
    flowChanged(a, dk, was);
  }
  function flowStep(a) { return a.type === "time" ? 5 : 1; }

  function flowSetAside(a, dk) {
    flowSetEntry(dk, a.id, { s: "skip" });
    flowLinkCache = {};
    flowRender();
  }
  // "Undo" on a skipped day, or on a day whose occurrence was moved away (which brings it back).
  function flowUndoAside(a, dk) {
    if (flowState(a, dk).kind === "rs") flowUnmove(a, dk);
    else flowSetEntry(dk, a.id, null);
    flowRender();
  }

  // Move ONE occurrence to another day. The template is never copied: the move is a single exception
  // keyed by the occurrence's original date, so moving it again (Mon -> Tue -> Wed) just updates that
  // exception and there is still exactly one occurrence.
  function flowMove(a, dk, toDk) {
    if (toDk <= dk || toDk < todayKey()) return { ok: false, msg: "Pick a later day." };
    if (flowApplies(a, toDk)) return { ok: false, msg: a.name + " is already planned on " + fdShort(toDk) + "." };
    var origin = flowMovedInFrom(a, dk) || dk, acts = flowActions();
    acts.forEach(function (x) { if (x.id === a.id) { x.ex = x.ex || {}; x.ex[origin] = { to: toDk }; } });
    flowSaveActions(acts);
    if (!a.link) flowSetEntry(dk, a.id, null); // whatever was logged on the day it left no longer belongs there
    flowLinkCache = {};
    flowRender();
    return { ok: true };
  }
  function flowUnmove(a, origin) {
    var e = a.ex && a.ex[origin];
    if (!e) return;
    var acts = flowActions(), fresh = null;
    acts.forEach(function (x) { if (x.id === a.id) { delete x.ex[origin]; if (!Object.keys(x.ex).length) delete x.ex; fresh = x; } });
    flowSaveActions(acts);
    if (fresh && !fresh.link && !flowApplies(fresh, e.to)) flowSetEntry(e.to, a.id, null);
    flowLinkCache = {};
  }

  function flowDelete(a) {
    var acts = flowActions();
    acts.forEach(function (x) { if (x.id === a.id) x.archivedAt = todayKey(); });
    flowSaveActions(acts);
    flowRender();
  }
  // fields.start lets a recurring action begin on a later day (e.g. tomorrow) instead of today.
  function flowAdd(fields) {
    var today = todayKey();
    var repeat = fields.repeat || { kind: "once", date: today };
    var a = {
      id: uid("fa"), name: fields.name, type: fields.type || "simple", category: fields.category || "task", time: fields.time || null,
      target: fields.target || null, unit: fields.unit || "", repeat: repeat,
      startDate: repeat.kind === "once" ? repeat.date : (fields.start || today), archivedAt: null, createdAt: new Date().toISOString()
    };
    if (fields.tag) a.tag = fields.tag;
    if (fields.link) a.link = fields.link;
    var acts = flowActions(); acts.push(a); flowSaveActions(acts);
    return a;
  }
  // Editing the name or kind is cosmetic and applies everywhere. Editing the SCHEDULE (days, time, type,
  // target, unit) takes effect from today: the old schedule is kept as a version so earlier days are not
  // rewritten (no invented misses, no vanishing ticks).
  function flowApplyEdit(id, nm, category, next) {
    var acts = flowActions(), today = todayKey();
    acts.forEach(function (x) {
      if (x.id !== id) return;
      if (x.category !== category) delete x.tag; // the filing tag only describes the kind it was made for
      x.name = nm; x.category = category;
      if (!next) return;
      var cur = { type: x.type, target: x.target || null, unit: x.unit || "", time: x.time || null, repeat: x.repeat };
      if (JSON.stringify(cur) === JSON.stringify(next)) return;
      // if today already has an outcome (ticked, partly done, skipped, moved) it stays as it was:
      // the new schedule then starts tomorrow instead of today
      var eff = today;
      if (flowApplies(x, today) && flowState(x, today).kind !== "open") eff = fdAdd(today, 1);
      if (!x.vers) x.vers = [{ from: x.startDate, type: cur.type, target: cur.target, unit: cur.unit, time: cur.time, repeat: cur.repeat }];
      var last = x.vers[x.vers.length - 1];
      if (last.from >= eff) {
        // nothing has happened under this schedule yet, so it can simply be corrected
        x.vers[x.vers.length - 1] = { from: last.from, type: next.type, target: next.target, unit: next.unit, time: next.time, repeat: next.repeat };
        if (x.vers.length === 1 && last.from > today) { // planned for a later day and still untouched: it may be re-dated
          if (next.repeat.kind === "once") x.startDate = next.repeat.date;
          x.vers[0].from = x.startDate;
        }
      } else {
        x.vers.push({ from: eff, type: next.type, target: next.target, unit: next.unit, time: next.time, repeat: next.repeat });
      }
      x.type = next.type; x.target = next.target; x.unit = next.unit; x.time = next.time; x.repeat = next.repeat;
    });
    flowSaveActions(acts);
  }

  // One-time upgrade from the first Daily Flow build, which "moved" a recurring action by copying it into a
  // one-off action and marking the original day with a log entry. That copy is what produced duplicate rows.
  // Each such pair becomes a single exception on the original action; the copy is folded back into it.
  function flowMigrate() {
    if (readJSON("nc_flow_schema", 0) >= 2) return;
    var acts = flowActions(), copies = acts.filter(function (x) { return x.fromId && x.repeat && x.repeat.kind === "once"; });
    var claimed = {}, keys = [], i;
    for (i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && /^nc_flow_log_\d{4}-\d{2}$/.test(k)) keys.push(k); }
    keys.forEach(function (mk) {
      var m = readJSON(mk, {}), dirty = false;
      Object.keys(m).forEach(function (dk) {
        Object.keys(m[dk]).forEach(function (id) {
          var e = m[dk][id];
          if (!e || e.s !== "rs") return;
          var orig = acts.filter(function (x) { return x.id === id; })[0];
          var copy = copies.filter(function (c) { return c.fromId === id && !claimed[c.id] && c.repeat.date === e.to; })[0] ||
            copies.filter(function (c) { return c.fromId === id && !claimed[c.id]; })[0] || null;
          var to = copy ? copy.repeat.date : e.to;
          if (orig && to && to > dk) { orig.ex = orig.ex || {}; orig.ex[dk] = { to: to }; }
          if (copy) {
            claimed[copy.id] = true;
            var same = flowMonthKey(to) === mk, cm = same ? m : readJSON(flowMonthKey(to), {});
            var ce = (cm[to] || {})[copy.id];
            if (ce) { // whatever was ticked on the moved copy belongs to the original occurrence
              cm[to][id] = cm[to][id] || ce; delete cm[to][copy.id];
              if (same) dirty = true; else writeJSON(flowMonthKey(to), cm);
            }
          }
          delete m[dk][id]; dirty = true;
        });
        if (m[dk] && !Object.keys(m[dk]).length) delete m[dk];
      });
      if (dirty) writeJSON(mk, m);
    });
    acts = acts.filter(function (x) { return !claimed[x.id]; });
    flowSaveActions(acts);
    writeJSON("nc_flow_schema", 2);
    flowLogCache = {};
  }

  // ---- rendering: shell ----
  function flowFmtValue(a, v) {
    if (a.unit === "h") { var h = Math.floor(v), m = Math.round((v - h) * 60); if (m === 60) { h++; m = 0; } return h + "h " + String(m).padStart(2, "0") + "m"; }
    return fnum(v) + (a.type === "time" ? " min" : (a.unit ? " " + a.unit : ""));
  }
  function flowProgressText(a, v) {
    if (a.type === "value") return (v ? flowFmtValue(a, v) : "Not logged") + (a.target ? " · target " + flowFmtValue(a, a.target) : "");
    var u = a.type === "time" ? " min" : (a.unit ? " " + a.unit : "");
    return fnum(v) + " / " + fnum(a.target || 0) + u;
  }
  function flowParseNum(s) {
    s = String(s).trim();
    if (s.indexOf(":") !== -1) { var p = s.split(":"); var h = Number(p[0]), m = Number(p[1]); return isNaN(h) || isNaN(m) ? NaN : h + m / 60; }
    return Number(s);
  }
  function flowClock(t) { return ncFmtTime(parseTimeToday(t)); }

  function openFlow(tab) {
    if (tab) flowTab = tab;
    if (!flowWeekStart) flowWeekStart = fdWeekStart(todayKey());
    setActiveView("flow");
  }
  function renderFlow() {
    var body = document.getElementById("flow-body");
    if (!body) return;
    flowLinkCache = {};
    document.querySelectorAll(".fl-tab").forEach(function (b) {
      var on = b.dataset.fltab === flowTab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    body.innerHTML = "";
    if (flowTab === "week") renderFlowWeek(body); else renderFlowToday(body);
  }
  function flowRender() {
    syncGoalPriority();
    var v = document.getElementById("view-flow");
    if (v && !v.classList.contains("hidden")) renderFlow();
    // the priority card and Home's progress both read the same Flow, so they refresh together
    if (window.NuraFeatures) window.NuraFeatures.render("today");
  }

  // ---- TODAY ----
  function flowFirstUse(body) {
    var box = hEl("div", "fl-first");
    box.appendChild(hEl("span", "fl-first-icon", "📝"));
    box.appendChild(hEl("h2", "fl-first-title", "Build today's plan."));
    box.appendChild(hEl("p", "fl-first-sub", "Write down what you want to get done. Tick each one as it happens, and watch the week fill in."));
    var add = hEl("button", "btn fl-cta", "+ Add my first action"); add.type = "button";
    add.addEventListener("click", function () { openFlowAddSheet(); });
    box.appendChild(add);
    var sug = flowSuggestions();
    if (sug.length) {
      box.appendChild(hEl("p", "fl-first-or", "or start from something NURA already tracks"));
      var row = hEl("div", "fl-chips");
      sug.forEach(function (s) {
        var c = hEl("button", "fl-chip", s.label); c.type = "button";
        c.addEventListener("click", function () { s.add(); flowRender(); });
        row.appendChild(c);
      });
      box.appendChild(row);
    }
    body.appendChild(box);
  }

  function flowSuggestions() {
    var acts = flowActions().filter(function (a) { return !a.archivedAt; });
    var has = function (kind, key) { return acts.some(function (a) { return a.link && a.link.kind === kind && a.link.key === key; }); };
    var out = [];
    if (!PRAYER_ORDER.every(function (n) { return has("salah", n); })) {
      out.push({ label: "🕌 Five daily prayers", add: function () {
        PRAYER_ORDER.forEach(function (n) { if (!has("salah", n)) flowAdd({ name: n, category: "salah", repeat: { kind: "daily" }, link: { kind: "salah", key: n } }); });
      } });
    }
    [["morning-adhkar", "🤲 Morning adhkar", "07:00"], ["evening-adhkar", "🤲 Evening adhkar", "17:30"], ["before-sleep", "🌙 Before-sleep routine", "22:00"]].forEach(function (s) {
      if (!has("sunnah", s[0]) && ROUTINE_SECTIONS.some(function (r) { return r.id === s[0]; })) {
        out.push({ label: s[1], add: function () { flowAdd({ name: s[1].replace(/^\S+\s/, ""), category: "deen", repeat: { kind: "daily" }, link: { kind: "sunnah", key: s[0] } }); } });
      }
    });
    getHabits().forEach(function (h) {
      if (!has("habit", h.id)) out.push({ label: "🌱 " + h.name, add: function () { flowAdd({ name: h.name, category: "habit", repeat: { kind: "daily" }, link: { kind: "habit", key: h.id } }); } });
    });
    return out;
  }

  function renderFlowToday(body) {
    var dk = todayKey(), acts = flowActions().filter(function (a) { return !a.archivedAt || a.archivedAt > dk; });
    var day = flowDay(dk);

    var sum = hEl("section", "fl-summary" + (day.total && day.done === day.total ? " is-complete" : ""));
    sum.id = "fl-summary";
    sum.appendChild(hEl("p", "fl-eyebrow", "Today · " + fdParse(dk).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })));
    if (day.total) {
      var line = hEl("div", "fl-sum-line");
      line.appendChild(hEl("span", "fl-sum-big", day.done + " of " + day.total));
      line.appendChild(hEl("span", "fl-sum-text", "planned actions completed"));
      line.appendChild(hEl("span", "fl-sum-pct", day.pct + "%"));
      sum.appendChild(line);
      var bar = hEl("div", "fl-bar"); var fill = hEl("span", "fl-bar-fill"); fill.style.width = "0%"; bar.appendChild(fill); sum.appendChild(bar);
      requestAnimationFrame(function () { fill.style.width = day.pct + "%"; });
      var left = day.total - day.done;
      sum.appendChild(hEl("p", "fl-sum-sub", left ? left + " remaining" + (day.partial ? " · partial progress counts in proportion" : "") : "Everything planned for today is done."));
    } else {
      sum.appendChild(hEl("p", "fl-sum-empty", acts.length ? "Nothing is planned for today." : "Nothing planned yet."));
    }
    body.appendChild(sum);

    if (!acts.length) { flowFirstUse(body); return; }

    // current moment: the latest timed open item already due = NOW, the first later one = NEXT
    var now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    var open = day.counted.filter(function (it) { return it.st.kind !== "done"; });
    var timedOpen = open.filter(function (it) { return flowTimeFor(it.a, dk, true); })
      .sort(function (x, y) { return flowMinOf(flowTimeFor(x.a, dk, true)) - flowMinOf(flowTimeFor(y.a, dk, true)); });
    var nowItem = null, nextItem = null;
    timedOpen.forEach(function (it) {
      var m = flowMinOf(flowTimeFor(it.a, dk, true));
      if (m <= nowMin) nowItem = it; else if (!nextItem) nextItem = it;
    });

    var buckets = {};
    day.items.forEach(function (it) {
      if (it.st.kind === "skip" || it.st.kind === "rs") return;
      var s = flowSectionOf(it.a, dk); (buckets[s] = buckets[s] || []).push(it);
    });
    var curSec = nowMin < 720 ? "morning" : nowMin < 1020 ? "afternoon" : nowMin < 1260 ? "evening" : "night";
    FLOW_SECTIONS.forEach(function (s) {
      var list = buckets[s[0]]; if (!list || !list.length) return;
      list.sort(function (x, y) { return flowMinOf(flowTimeFor(x.a, dk, false) || "23:59") - flowMinOf(flowTimeFor(y.a, dk, false) || "23:59"); });
      var allDone = list.every(function (it) { return it.st.kind === "done"; });
      var sec = hEl("section", "fl-section" + (allDone ? " is-complete" : "") + (s[0] === curSec ? " is-current" : ""));
      var head = hEl("div", "fl-sec-head");
      head.appendChild(hEl("h2", "fl-sec-title", s[1]));
      head.appendChild(hEl("span", "fl-sec-count", list.filter(function (it) { return it.st.kind === "done"; }).length + "/" + list.length));
      sec.appendChild(head);
      var ul = hEl("ul", "fl-list");
      list.forEach(function (it) {
        ul.appendChild(flowRow(it, dk, nowItem && nowItem.a.id === it.a.id ? "NOW" : (nextItem && nextItem.a.id === it.a.id ? "NEXT" : null)));
      });
      sec.appendChild(ul);
      body.appendChild(sec);
    });

    var aside = day.items.filter(function (it) { return it.st.kind === "skip" || it.st.kind === "rs"; });
    if (aside.length) {
      var as = hEl("section", "fl-aside");
      as.appendChild(hEl("h2", "fl-sec-title", "Set aside today"));
      aside.forEach(function (it) {
        var r = hEl("div", "fl-aside-row");
        r.appendChild(hEl("span", "fl-aside-name", it.a.name));
        r.appendChild(hEl("span", "fl-aside-state", it.st.kind === "skip" ? "Skipped" : "Moved to " + fdShort(it.st.to)));
        var u = hEl("button", "fl-link", "Undo"); u.type = "button";
        u.addEventListener("click", function () { flowUndoAside(it.a, dk); });
        r.appendChild(u); as.appendChild(r);
      });
      body.appendChild(as);
    }

    var add = hEl("button", "btn fl-cta", "+ Add to today"); add.type = "button";
    add.addEventListener("click", function () { openFlowAddSheet(); });
    body.appendChild(add);
  }

  function flowRow(it, dk, tag) {
    var a = it.a, st = it.st;
    var li = hEl("li", "fl-row is-" + st.kind + (tag ? " is-" + tag.toLowerCase() : "") + (flowPulseId === a.id ? " pulse" : ""));
    var cb = hEl("button", "fl-check" + (st.kind === "done" ? " is-done" : st.kind === "partial" ? " is-partial" : ""));
    cb.type = "button"; cb.setAttribute("role", "checkbox");
    cb.setAttribute("aria-checked", st.kind === "done" ? "true" : st.kind === "partial" ? "mixed" : "false");
    cb.setAttribute("aria-label", (st.kind === "done" ? "Mark not done: " : "Mark done: ") + a.name);
    var box = hEl("span", "fl-box", st.kind === "done" ? "✓" : ""); cb.appendChild(box);
    cb.addEventListener("click", function () { flowToggle(a, dk); });
    li.appendChild(cb);

    var mid = hEl("div", "fl-mid");
    var nameRow = hEl("div", "fl-name-row");
    nameRow.appendChild(hEl("span", "fl-name", a.name));
    if (tag) nameRow.appendChild(hEl("span", "fl-tag", tag));
    mid.appendChild(nameRow);
    var bits = [];
    var t = flowTimeFor(a, dk, true); if (t) bits.push(flowClock(t));
    bits.push(a.tag || flowKindInfo(a.category).label);
    if (a.type !== "simple" && !a.link) bits.push(flowProgressText(a, st.v));
    else if (a.link && a.link.kind === "sunnah") { var tot = (ROUTINE_SECTIONS.filter(function (s) { return s.id === a.link.key; })[0] || { actions: [] }).actions.length; bits.push(st.v + " of " + tot + " done"); }
    if (st.kind === "done") { var cons = flowConsistencyText(a, false); if (cons) bits.push(cons); } // only after it's ticked: a fact, never pressure
    mid.appendChild(hEl("p", "fl-meta", bits.join(" · ")));

    if (a.type !== "simple" && !a.link) {
      var ctl = hEl("div", "fl-measure");
      if (a.target && a.type !== "value") {
        var mb = hEl("div", "fl-mbar"); var mf = hEl("span", "fl-mbar-fill"); mf.style.width = Math.round(st.frac * 100) + "%"; mb.appendChild(mf); ctl.appendChild(mb);
      }
      var row2 = hEl("div", "fl-stepper");
      if (a.type !== "value") {
        var minus = hEl("button", "fl-step", "−"); minus.type = "button"; minus.setAttribute("aria-label", "Less");
        minus.addEventListener("click", function () { flowSetValue(a, dk, Math.max(0, st.v - flowStep(a))); });
        row2.appendChild(minus);
      }
      var log = hEl("button", "fl-step fl-step-wide", a.type === "value" ? (st.v ? "Edit" : "Log") : "Set"); log.type = "button";
      log.addEventListener("click", function () { openFlowValueSheet(a, dk); });
      row2.appendChild(log);
      if (a.type !== "value") {
        var plus = hEl("button", "fl-step", "+"); plus.type = "button"; plus.setAttribute("aria-label", "More");
        plus.addEventListener("click", function () { flowSetValue(a, dk, st.v + flowStep(a)); });
        row2.appendChild(plus);
      }
      ctl.appendChild(row2); mid.appendChild(ctl);
    }
    li.appendChild(mid);

    var more = hEl("button", "fl-more", "⋯"); more.type = "button"; more.setAttribute("aria-label", "Options for " + a.name);
    more.addEventListener("click", function () { openFlowMenu(a, dk); });
    li.appendChild(more);
    return li;
  }

  // ---- sheets ----
  function flowSheet(build) {
    var sheet = document.getElementById("modal-flow-sheet");
    sheet.innerHTML = "";
    build(sheet);
    document.getElementById("modal-flow").classList.remove("hidden");
  }
  function closeFlowSheet() { document.getElementById("modal-flow").classList.add("hidden"); }
  function flowSheetHead(sheet, title) {
    var h = hEl("div", "modal-header-row");
    h.appendChild(hEl("h2", "", title));
    var x = hEl("button", "icon-btn", "✕"); x.type = "button"; x.setAttribute("aria-label", "Close"); x.addEventListener("click", closeFlowSheet);
    h.appendChild(x); sheet.appendChild(h);
  }
  function flowBtn(label, cls, fn) { var b = hEl("button", cls, label); b.type = "button"; b.addEventListener("click", fn); return b; }

  function openFlowValueSheet(a, dk) {
    var st = flowState(a, dk), V = flowVer(a, dk); // the schedule that was in force on that day
    flowSheet(function (sheet) {
      flowSheetHead(sheet, a.name);
      sheet.appendChild(hEl("p", "modal-sub", fdLong(dk) + (V.target ? " · target " + flowFmtValue(V, V.target) : "")));
      var inp = hEl("input", "text-input"); inp.type = V.unit === "h" ? "text" : "number"; inp.inputMode = "decimal"; inp.step = "any"; inp.min = "0";
      inp.placeholder = V.unit === "h" ? "e.g. 7:10 or 7.5" : (V.type === "time" ? "minutes" : (V.unit || "amount"));
      inp.value = st.v ? (V.unit === "h" ? fnum(st.v) : String(st.v)) : "";
      sheet.appendChild(inp);
      var msg = hEl("p", "day-note", "");
      sheet.appendChild(flowBtn("Save", "btn btn-primary btn-full", function () {
        var n = flowParseNum(inp.value);
        if (isNaN(n) || n < 0) { msg.textContent = "Enter a number."; return; }
        closeFlowSheet(); flowSetValue(a, dk, n);
      }));
      if (st.v) sheet.appendChild(flowBtn("Clear", "btn btn-outline btn-full", function () { closeFlowSheet(); flowSetValue(a, dk, 0); }));
      sheet.appendChild(msg);
      setTimeout(function () { inp.focus(); }, 60);
    });
  }

  function openFlowMenu(a, dk) {
    flowSheet(function (sheet) {
      flowSheetHead(sheet, a.name);
      var recurring = a.repeat && a.repeat.kind !== "once";
      sheet.appendChild(hEl("p", "modal-sub", recurring ? "Repeats " + flowRepeatText(a.repeat) : "Just for " + fdShort(a.repeat.date)));
      var cons = flowConsistencyText(a, true);
      if (cons) sheet.appendChild(hEl("p", "modal-sub", cons + "."));
      var from = flowMovedInFrom(a, dk);
      if (from) sheet.appendChild(hEl("p", "modal-sub", "Moved here from " + fdShort(from) + "."));
      var msg = hEl("p", "day-note", "");
      var tryMove = function (to) {
        var r = flowMove(a, dk, to);
        if (r.ok) closeFlowSheet(); else msg.textContent = r.msg;
      };
      sheet.appendChild(flowBtn("Edit", "btn btn-outline btn-full", function () { openFlowAddSheet(a); }));
      sheet.appendChild(flowBtn("Skip today", "btn btn-outline btn-full", function () { closeFlowSheet(); flowSetAside(a, dk); }));
      if (!(a.link && a.link.kind === "salah")) { // a prayer can't be "moved" to another day
        sheet.appendChild(flowBtn("Move to tomorrow", "btn btn-outline btn-full", function () { tryMove(fdAdd(dk, 1)); }));
        var pick = hEl("input", "text-input"); pick.type = "date"; pick.min = fdAdd(dk, 1);
        var pickRow = hEl("div", "fl-pickrow");
        pickRow.appendChild(pick);
        pickRow.appendChild(flowBtn("Move", "btn btn-outline", function () { if (!pick.value || pick.value <= dk) { msg.textContent = "Pick a later day."; return; } tryMove(pick.value); }));
        sheet.appendChild(pickRow);
      }
      sheet.appendChild(flowBtn(recurring ? "Stop repeating (keep history)" : "Remove", "btn btn-outline btn-full btn-danger", function () { closeFlowSheet(); flowDelete(a); }));
      sheet.appendChild(msg);
    });
  }
  function flowRepeatText(r) {
    if (r.kind === "daily") return "every day";
    if (r.kind === "weekdays") return "Monday to Friday";
    if (r.kind === "days") return (r.days || []).map(function (d) { return FD_DAYS[d].slice(0, 3); }).join(", ");
    return "once";
  }

  // ---- naming a goal ----
  // NURA may FILE a goal (kind + a short tag) and notice a measure in its name ("20 pages", "30 minutes"),
  // but only as visible, editable suggestions. Classification is metadata for organisation: it never
  // launches a tool and never changes what the user asked for. Nothing matched = nothing guessed.
  var FLOW_CLASSIFY = [
    { re: /\b(qur'?an|koran|dua|du'?a|adhkar|azkar|zikr|dhikr|tasbih|tahajjud|nafl|istighfar|durood|salawat|sadaqah?)\b/i, category: "deen", tag: "Deen" },
    { re: /\b(gym|workout|work out|exercise|walk|walking|run|running|jog|jogging|yoga|push-?ups?|swim|swimming|cycling|cardio|stretch|stretching)\b/i, category: "fitness", tag: "Fitness" },
    { re: /\b(sleep|bedtime|go to bed|wake ?up|nap)\b/i, category: "sleep", tag: "Sleep" },
    { re: /\b(study|studying|revise|revision|homework|assignment|exam|chapter|practice questions|mock test|lecture notes|syllabus)\b/i, category: "study", tag: "Study" },
    { re: /\b(school|college|university|class|classes|tuition|coaching|lecture)\b/i, category: "personal", tag: "Routine · Education" },
    { re: /\b(office|job|shift|commute|work)\b/i, category: "personal", tag: "Routine · Work" },
    { re: /\b(water|drink|hydrate|medicine|vitamins?|breakfast|lunch|dinner|meal)\b/i, category: "personal", tag: "Health" },
    { re: /\b(read|reading|book|pages?)\b/i, category: "personal", tag: "Reading" }
  ];
  function flowClassify(name) {
    for (var i = 0; i < FLOW_CLASSIFY.length; i++) { if (FLOW_CLASSIFY[i].re.test(name)) return { category: FLOW_CLASSIFY[i].category, tag: FLOW_CLASSIFY[i].tag }; }
    return { category: null, tag: null };
  }
  var FLOW_UNITS = [
    [/^(minutes?|mins?)$/i, "time", "min", 1], [/^(hours?|hrs?)$/i, "time", "min", 60],
    [/^pages?$/i, "count", "pages", 1], [/^(litres?|liters?|ltrs?|l)$/i, "quantity", "L", 1], [/^glass(es)?$/i, "quantity", "glasses", 1],
    [/^cups?$/i, "quantity", "cups", 1], [/^(km|kilomet(re|er)s?)$/i, "quantity", "km", 1], [/^steps$/i, "count", "steps", 1],
    [/^questions?$/i, "quantity", "questions", 1], [/^(rakah|rakat|rak'?ahs?)$/i, "count", "rakah", 1], [/^chapters?$/i, "count", "chapters", 1],
    [/^(reps?|times)$/i, "count", "reps", 1]
  ];
  function flowGuessMeasure(name) {
    var re = /(\d+(?:\.\d+)?)\s*([a-z']+)/gi, m;
    while ((m = re.exec(String(name)))) {
      for (var i = 0; i < FLOW_UNITS.length; i++) {
        if (FLOW_UNITS[i][0].test(m[2])) return { type: FLOW_UNITS[i][1], unit: FLOW_UNITS[i][2], target: Number(m[1]) * FLOW_UNITS[i][3], text: m[0] };
      }
    }
    return null;
  }

  function openFlowAddSheet(edit, opts) {
    opts = opts || {};
    var goalMode = !!opts.goal && !edit;
    flowSheet(function (sheet) {
      flowSheetHead(sheet, edit ? "Edit action" : goalMode ? "Create your goal" : "Add to today");
      if (goalMode) sheet.appendChild(hEl("p", "modal-sub", "Just what's needed. You can change any of it later."));
      if (!edit && !goalMode) {
        var sug = flowSuggestions();
        if (sug.length) {
          sheet.appendChild(hEl("p", "fl-form-label", "From NURA"));
          var row = hEl("div", "fl-chips");
          sug.forEach(function (s) { row.appendChild(flowBtn(s.label, "fl-chip", function () { s.add(); closeFlowSheet(); flowRender(); })); });
          sheet.appendChild(row);
          sheet.appendChild(hEl("p", "fl-form-label", "Or write your own"));
        }
      }
      var f = { name: edit ? edit.name : (opts.name || ""), category: edit ? edit.category : "task", type: edit ? edit.type : "simple", target: edit ? edit.target : null,
        unit: edit ? edit.unit : "", time: edit ? edit.time : "", rk: edit ? edit.repeat.kind : "once", days: edit && edit.repeat.days ? edit.repeat.days.slice() : [], date: edit && edit.repeat.date ? edit.repeat.date : todayKey(),
        kindTouched: !!edit, typeTouched: !!edit, autoMeasure: false };
      var locked = !!(edit && edit.link);

      var name = hEl("input", "text-input"); name.type = "text"; name.maxLength = 60; name.placeholder = "e.g. Going to school, Read 20 pages, Gym"; name.value = f.name;
      sheet.appendChild(name);
      var hint = hEl("p", "fl-hint hidden", "");
      sheet.appendChild(hint);

      sheet.appendChild(hEl("p", "fl-form-label", "Kind"));
      var kinds = hEl("div", "fl-chips"), kindBtns = {};
      FLOW_KINDS.filter(function (k) { return k.k !== "salah" || f.category === "salah"; }).forEach(function (k) {
        var c = hEl("button", "fl-chip" + (f.category === k.k ? " is-on" : ""), k.icon + " " + k.label); c.type = "button";
        c.addEventListener("click", function () { f.kindTouched = true; setKind(k.k); refreshHint(); });
        kindBtns[k.k] = c; kinds.appendChild(c);
      });
      sheet.appendChild(kinds);
      function setKind(k) {
        f.category = k;
        Object.keys(kindBtns).forEach(function (x) { kindBtns[x].classList.toggle("is-on", x === k); });
      }

      var typeBox = hEl("div", "fl-typebox"), sel = null, tgt = null, unit = null, syncType = function () {};
      if (!locked) {
        sheet.appendChild(hEl("p", "fl-form-label", "How do you track it?"));
        sel = hEl("select", "text-input");
        FLOW_TYPES.forEach(function (t) { var o = hEl("option", "", t.label); o.value = t.k; if (t.k === f.type) o.selected = true; sel.appendChild(o); });
        sheet.appendChild(sel);
        tgt = hEl("input", "text-input"); tgt.type = "number"; tgt.min = "0"; tgt.step = "any"; tgt.inputMode = "decimal"; tgt.value = f.target || "";
        unit = hEl("input", "text-input"); unit.type = "text"; unit.maxLength = 14; unit.value = f.unit || "";
        typeBox.appendChild(tgt); typeBox.appendChild(unit);
        sheet.appendChild(typeBox);
        syncType = function () {
          f.type = sel.value;
          typeBox.classList.toggle("hidden", f.type === "simple");
          tgt.placeholder = f.type === "time" ? "Target minutes (e.g. 45)" : f.type === "value" ? "Target (optional, e.g. 7)" : "Target (e.g. 5)";
          unit.classList.toggle("hidden", f.type === "time");
          unit.placeholder = f.type === "value" ? "Unit (h for hours, or your own)" : "Unit (e.g. pages, litres)";
        };
        sel.addEventListener("change", function () { f.typeTouched = true; f.autoMeasure = false; syncType(); refreshHint(); });
        tgt.addEventListener("input", function () { f.typeTouched = true; f.autoMeasure = false; refreshHint(); });
        unit.addEventListener("input", function () { f.typeTouched = true; f.autoMeasure = false; refreshHint(); });
        syncType();
      }

      // what NURA noticed in the name, said out loud so nothing changes silently
      function refreshHint() {
        var bits = [];
        if (!edit) {
          var c = flowClassify(name.value);
          var kl = flowKindInfo(f.category).label;
          if (c.tag && !f.kindTouched) bits.push("Filed under " + (c.tag === kl ? kl : kl + " · " + c.tag) + ".");
          if (f.autoMeasure && sel) bits.push("Read “" + f.autoMeasure + "” as a target — change it below if that's not what you meant.");
        }
        hint.textContent = bits.join(" ");
        hint.classList.toggle("hidden", !bits.length);
      }
      function onName() {
        if (edit) return;
        var c = flowClassify(name.value);
        if (!f.kindTouched) setKind(c.category && kindBtns[c.category] ? c.category : "task");
        if (sel && !f.typeTouched) {
          var g = flowGuessMeasure(name.value);
          if (g) { sel.value = g.type; tgt.value = String(g.target); unit.value = g.unit; f.autoMeasure = g.text; }
          else { sel.value = "simple"; tgt.value = ""; unit.value = ""; f.autoMeasure = false; }
          syncType();
        }
        refreshHint();
      }
      name.addEventListener("input", onName);

      sheet.appendChild(hEl("p", "fl-form-label", "Time (optional)"));
      var time = hEl("input", "text-input"); time.type = "time"; time.value = f.time || "";
      sheet.appendChild(time);

      var rep = null, dayRow = null, dateIn = null;
      if (!locked || !edit) {
        sheet.appendChild(hEl("p", "fl-form-label", "Repeat"));
        rep = hEl("select", "text-input");
        [["once", "One day (pick the date)"], ["daily", "Every day"], ["weekdays", "Weekdays (Mon–Fri)"], ["days", "Choose days"]].forEach(function (r) { var o = hEl("option", "", r[1]); o.value = r[0]; if (r[0] === f.rk) o.selected = true; rep.appendChild(o); });
        sheet.appendChild(rep);
        dayRow = hEl("div", "fl-chips");
        FD_LETTERS.forEach(function (l, i) {
          var c = hEl("button", "fl-chip fl-day" + (f.days.indexOf(i) !== -1 ? " is-on" : ""), l); c.type = "button"; c.setAttribute("aria-label", FD_DAYS[i]);
          c.addEventListener("click", function () { var ix = f.days.indexOf(i); if (ix === -1) f.days.push(i); else f.days.splice(ix, 1); c.classList.toggle("is-on"); });
          dayRow.appendChild(c);
        });
        sheet.appendChild(dayRow);
        dateIn = hEl("input", "text-input"); dateIn.type = "date"; dateIn.min = todayKey(); dateIn.value = f.date;
        sheet.appendChild(dateIn);
        var repSync = function () { f.rk = rep.value; dayRow.classList.toggle("hidden", f.rk !== "days"); dateIn.classList.toggle("hidden", f.rk !== "once"); };
        rep.addEventListener("change", repSync); repSync();
      }

      var msg = hEl("p", "day-note", "");
      sheet.appendChild(flowBtn(edit ? "Save" : goalMode ? "Finish" : "Add", "btn btn-primary btn-full fl-sticky", function () {
        var nm = name.value.trim();
        if (!nm) { msg.textContent = "Give it a name."; return; }
        var target = null, unitV = "";
        if (!locked && f.type !== "simple") {
          target = Number(tgt.value) || null;
          if (f.type !== "value" && !(target > 0)) { msg.textContent = "Set a target so progress can be measured."; return; }
          unitV = f.type === "time" ? "min" : unit.value.trim();
        }
        var repeat = null;
        if (rep) {
          if (f.rk === "once") { if (dateIn.value < todayKey()) { msg.textContent = "Pick today or a later date."; return; } repeat = { kind: "once", date: dateIn.value || todayKey() }; }
          else if (f.rk === "days") { if (!f.days.length) { msg.textContent = "Choose at least one day."; return; } repeat = { kind: "days", days: f.days.slice().sort() }; }
          else repeat = { kind: f.rk };
        }
        if (edit) {
          flowApplyEdit(edit.id, nm, f.category, {
            type: locked ? edit.type : f.type, target: locked ? (edit.target || null) : target, unit: locked ? (edit.unit || "") : unitV,
            time: time.value || null, repeat: repeat || edit.repeat
          });
          closeFlowSheet(); flowRender();
          return;
        }
        var cls = flowClassify(nm);
        var a = flowAdd({ name: nm, category: f.category, type: f.type, target: target, unit: unitV, time: time.value || null, repeat: repeat, tag: cls.category === f.category ? cls.tag : null });
        if (opts.onCreated) opts.onCreated(a);
        if (goalMode) { flowRender(); flowGoalSaved(a); return; }
        closeFlowSheet(); flowRender();
      }));
      if (edit) sheet.appendChild(flowBtn("Cancel", "btn btn-outline btn-full", closeFlowSheet));
      sheet.appendChild(msg);
      if (!edit) { setTimeout(function () { name.focus(); }, 60); onName(); }
    });
  }

  // ---- after "Finish": say exactly what was saved, offer at most ONE optional next step ----
  function flowFirstDay(a) {
    var today = todayKey();
    for (var i = 0; i < 14; i++) { var dk = fdAdd(today, i); if (flowApplies(a, dk)) return dk; }
    return null;
  }
  function flowGoalWhen(a) {
    var today = todayKey(), first = flowFirstDay(a), at = a.time ? flowClock(a.time) : null;
    var part = a.time ? ({ morning: "morning", afternoon: "afternoon", evening: "evening", night: "night" }[flowSectionOf(a, first || today)] || "") : "";
    if (a.repeat.kind === "once") {
      if (a.repeat.date === today) return "Added to today" + (at ? " · " + at : "") + ".";
      if (a.repeat.date === fdAdd(today, 1)) return "Added to tomorrow" + (part ? " " + part : "") + (at ? " · " + at : "") + ".";
      return "Added for " + fdLong(a.repeat.date) + (at ? " · " + at : "") + ".";
    }
    var s = "Repeats " + flowRepeatText(a.repeat) + (at ? " · " + at : "") + ". ";
    return s + (first === today ? "Today is included." : first ? "First day: " + fdLong(first) + "." : "");
  }
  function flowGoalSaved(a) {
    var sheet = document.getElementById("modal-flow-sheet"), today = todayKey();
    sheet.innerHTML = "";
    flowSheetHead(sheet, "Goal saved");
    sheet.appendChild(hEl("p", "fl-saved-name", a.name));
    sheet.appendChild(hEl("p", "modal-sub", flowGoalWhen(a)));
    sheet.appendChild(hEl("p", "modal-sub", flowApplies(a, today)
      ? "It's in today's Daily Flow. Tick it there or on Home — it counts in today's progress and the Life Grid."
      : "It will appear in Daily Flow on its first day, and count in the Life Grid from then."));
    // one optional idea, only where it plainly makes sense; never applied unless asked
    var idea = null;
    if (a.repeat.kind === "once") {
      if (/^Routine/.test(a.tag || "")) idea = { text: "Would you like this to repeat Monday–Friday?", label: "Repeat Mon–Fri", repeat: { kind: "weekdays" }, done: "Now repeats Monday to Friday." };
      else if (a.category === "deen" || a.category === "sleep") idea = { text: "Would you like this to repeat every day?", label: "Repeat every day", repeat: { kind: "daily" }, done: "Now repeats every day." };
    }
    var ideaBox = hEl("div", "fl-idea");
    if (idea) {
      ideaBox.appendChild(hEl("p", "fl-idea-text", idea.text));
      var row = hEl("div", "fl-idea-row");
      row.appendChild(flowBtn(idea.label, "btn btn-outline", function () {
        flowApplyEdit(a.id, a.name, a.category, { type: a.type, target: a.target || null, unit: a.unit || "", time: a.time || null, repeat: idea.repeat });
        flowRender();
        ideaBox.innerHTML = ""; ideaBox.appendChild(hEl("p", "fl-idea-text", idea.done));
      }));
      row.appendChild(flowBtn("Not now", "btn btn-outline", function () { ideaBox.remove(); }));
      ideaBox.appendChild(row);
    }
    if (idea) sheet.appendChild(ideaBox);
    sheet.appendChild(flowBtn("Done", "btn btn-primary btn-full", closeFlowSheet));
    sheet.appendChild(flowBtn("Open Daily Flow", "btn btn-outline btn-full", function () { closeFlowSheet(); openFlow("today"); }));
  }

  // ---- WEEK: the Life Grid ----
  function flowCell(a, dk, today) {
    if (!flowApplies(a, dk)) return { k: "na" };
    var st = flowState(a, dk);
    if (st.kind === "skip") return { k: "skip", st: st };
    if (st.kind === "rs") return { k: "rs", st: st };
    if (dk > today) return { k: "future", st: st };
    if (st.kind === "done") return { k: "done", st: st };
    if (st.kind === "partial") return { k: "part", st: st };
    return { k: dk === today ? "open" : "miss", st: st };
  }
  function flowWeekData(start) {
    var today = todayKey(), days = [];
    for (var i = 0; i < 7; i++) days.push(fdAdd(start, i));
    var rows = [];
    flowActions().forEach(function (a) {
      if (!days.some(function (dk) { return flowApplies(a, dk); })) return;
      var cells = days.map(function (dk) { return flowCell(a, dk, today); });
      var planned = 0, done = 0;
      cells.forEach(function (c) { if (c.k === "done" || c.k === "part" || c.k === "open" || c.k === "miss") { planned++; if (c.k === "done") done++; } });
      var firstDay = days.filter(function (dk) { return flowApplies(a, dk); })[0], vt = firstDay ? flowVer(a, firstDay).time : a.time;
      rows.push({ a: a, cells: cells, planned: planned, done: done, sort: vt ? flowMinOf(vt) : (a.link && a.link.kind === "salah" ? (SALAH_DEFAULT_MIN[a.link.key] || 720) : 1500) });
    });
    rows.sort(function (x, y) { return x.sort - y.sort || (x.a.name < y.a.name ? -1 : 1); });
    var totalP = 0, totalD = 0, perDay = days.map(function () { return { p: 0, d: 0 }; });
    rows.forEach(function (r) { totalP += r.planned; totalD += r.done; r.cells.forEach(function (c, i) { if (c.k === "done" || c.k === "part" || c.k === "open" || c.k === "miss") { perDay[i].p++; if (c.k === "done") perDay[i].d++; } }); });
    return { start: start, days: days, rows: rows, totalP: totalP, totalD: totalD, perDay: perDay, today: today };
  }

  // Honest summary lines: every claim needs enough planned days behind it.
  function flowWeekLines(data) {
    var lines = [];
    var ended = data.today > data.days[6];
    if (data.totalP < 1) return ["Nothing was planned this week."];
    lines.push("This week: " + data.totalD + " of " + data.totalP + " planned actions completed" + (ended || data.today >= data.days[6] ? "." : " so far."));
    if (data.totalP < 6) { lines.push("Not enough planned days yet to see a pattern."); return lines; }
    var elig = [];
    data.perDay.forEach(function (d, i) { if (data.days[i] <= data.today && d.p >= 2) elig.push({ i: i, rate: d.d / d.p }); });
    if (elig.length >= 3) {
      var mx = Math.max.apply(null, elig.map(function (e) { return e.rate; })), mn = Math.min.apply(null, elig.map(function (e) { return e.rate; }));
      if (mx > 0 && mx - mn >= 0.2) {
        var top = elig.filter(function (e) { return e.rate === mx; }).slice(0, 2).map(function (e) { return FD_DAYS[e.i]; });
        lines.push("Your strongest day" + (top.length > 1 ? "s" : "") + ": " + top.join(" and ") + ".");
      }
    }
    data.rows.filter(function (r) { return r.planned >= 3; }).sort(function (x, y) { return y.planned - x.planned; }).slice(0, 2).forEach(function (r) {
      lines.push(r.a.name + " was completed " + r.done + " of " + r.planned + " planned days.");
    });
    var prev = flowWeekData(fdAdd(data.start, -7));
    var best = null;
    data.rows.forEach(function (r) {
      if (r.planned < 3) return;
      var p = prev.rows.filter(function (x) { return x.a.id === r.a.id; })[0];
      if (!p || p.planned < 3) return;
      var gain = r.done / r.planned - p.done / p.planned;
      if (gain >= 0.15 && r.done > p.done && (!best || gain > best.gain)) best = { r: r, p: p, gain: gain };
    });
    if (best) lines.push(best.r.a.name + " improved: " + best.r.done + " of " + best.r.planned + " days, up from " + best.p.done + " of " + best.p.planned + " last week.");
    return lines.slice(0, 5);
  }

  var FLOW_CELL_TEXT = { done: "✓", part: "◐", open: "○", miss: "·", skip: "⊘", rs: "↷", future: "", na: "—" };
  var FLOW_CELL_LABEL = { done: "completed", part: "partly done", open: "not done yet", miss: "not completed", skip: "skipped", rs: "moved to another day", future: "planned", na: "not planned" };

  function renderFlowWeek(body) {
    var thisWeek = fdWeekStart(todayKey());
    if (!flowWeekStart) flowWeekStart = thisWeek;
    var data = flowWeekData(flowWeekStart);
    var anyActions = flowActions().length > 0;

    var nav = hEl("div", "fl-weeknav");
    var prev = hEl("button", "fl-navbtn", "‹"); prev.type = "button"; prev.setAttribute("aria-label", "Previous week");
    prev.addEventListener("click", function () { flowWeekStart = fdAdd(flowWeekStart, -7); renderFlow(); });
    var next = hEl("button", "fl-navbtn", "›"); next.type = "button"; next.setAttribute("aria-label", "Next week");
    next.disabled = flowWeekStart >= fdAdd(thisWeek, 14);
    next.addEventListener("click", function () { flowWeekStart = fdAdd(flowWeekStart, 7); renderFlow(); });
    var lab = hEl("button", "fl-weeklabel", flowWeekStart === thisWeek ? "This week · " + fdShort(data.days[0]) + " – " + fdShort(data.days[6]) : fdShort(data.days[0]) + " – " + fdShort(data.days[6]));
    lab.type = "button"; lab.addEventListener("click", function () { flowWeekStart = thisWeek; renderFlow(); });
    nav.appendChild(prev); nav.appendChild(lab); nav.appendChild(next);
    body.appendChild(nav);

    if (!anyActions) { flowFirstUse(body); return; }

    var sum = hEl("section", "fl-weeksum");
    flowWeekLines(data).forEach(function (l, i) { sum.appendChild(hEl("p", i === 0 ? "fl-weeksum-main" : "fl-weeksum-line", l)); });
    body.appendChild(sum);

    if (!data.rows.length) {
      body.appendChild(hEl("p", "fl-empty-week", "Nothing planned in this week."));
    } else {
      var wrap = hEl("div", "fl-gridwrap"); wrap.tabIndex = 0;
      var grid = hEl("div", "fl-grid"); grid.setAttribute("role", "grid");
      grid.appendChild(hEl("div", "fl-gh fl-gh-corner", ""));
      data.days.forEach(function (dk, i) {
        var h = hEl("div", "fl-gh" + (dk === data.today ? " is-today" : ""));
        h.appendChild(hEl("span", "fl-gh-l", FD_LETTERS[i])); h.appendChild(hEl("span", "fl-gh-d", String(fdParse(dk).getDate())));
        grid.appendChild(h);
      });
      data.rows.forEach(function (r) {
        var lbl = hEl("div", "fl-rl");
        lbl.appendChild(hEl("span", "fl-rl-name", flowKindInfo(r.a.category).icon + " " + r.a.name));
        lbl.appendChild(hEl("span", "fl-rl-sub", r.planned ? r.done + " of " + r.planned + " days" : "planned ahead"));
        grid.appendChild(lbl);
        r.cells.forEach(function (c, i) {
          var dk = data.days[i];
          var cell = hEl("button", "fl-cell c-" + c.k + (dk === data.today ? " is-today" : "") + (flowPulseKey === r.a.id + "|" + dk ? " just" : ""), FLOW_CELL_TEXT[c.k]); cell.type = "button";
          var mvFrom = c.k !== "rs" && c.k !== "na" ? flowMovedInFrom(r.a, dk) : null;
          cell.setAttribute("aria-label", r.a.name + ", " + FD_DAYS[i] + " " + fdShort(dk) + ": " + FLOW_CELL_LABEL[c.k] + (mvFrom ? " (moved here from " + fdShort(mvFrom) + ")" : "") + (c.k === "rs" ? " to " + fdShort(c.st.to) : ""));
          if (c.k === "na") cell.disabled = true;
          else cell.addEventListener("click", function () { openFlowCellSheet(r.a, dk); });
          grid.appendChild(cell);
        });
      });
      wrap.appendChild(grid); body.appendChild(wrap);
      var legend = hEl("p", "fl-legend", "✓ done   ◐ partly   ○ not yet   · not completed   ⊘ skipped   ↷ moved   — not planned");
      body.appendChild(legend);
    }
    flowReflectionCard(body, data);
  }

  function flowReflectionCard(body, data) {
    if (data.today < data.days[6] || data.totalP < 5) return;
    var rows = data.rows.filter(function (r) { return r.planned >= 3; });
    var card = hEl("section", "fl-reflect");
    card.appendChild(hEl("p", "fl-eyebrow", "Your week"));
    card.appendChild(hEl("p", "fl-ref-main", data.totalD + " / " + data.totalP + " planned actions completed"));
    if (rows.length) {
      var byRate = rows.slice().sort(function (x, y) { return (y.done / y.planned) - (x.done / x.planned); });
      var top = byRate[0];
      if (top.done / top.planned >= 0.6) card.appendChild(hEl("p", "fl-ref-line", "Most consistent: " + top.a.name));
      var low = byRate[byRate.length - 1];
      if (low !== top && low.done / low.planned < 0.5) card.appendChild(hEl("p", "fl-ref-line", "Needs adjustment: " + low.a.name + " (" + low.done + " of " + low.planned + ")"));
    }
    var saved = readJSON(FLOW_REFLECT, {})[data.start] || null;
    card.appendChild(hEl("p", "fl-ref-q", "How did this week feel? (optional)"));
    var row = hEl("div", "fl-chips");
    [["easy", "Easy"], ["balanced", "Balanced"], ["difficult", "Difficult"]].forEach(function (o) {
      var c = hEl("button", "fl-chip" + (saved === o[0] ? " is-on" : ""), o[1]); c.type = "button";
      c.addEventListener("click", function () { var all = readJSON(FLOW_REFLECT, {}); if (all[data.start] === o[0]) delete all[data.start]; else all[data.start] = o[0]; writeJSON(FLOW_REFLECT, all); renderFlow(); });
      row.appendChild(c);
    });
    card.appendChild(row);
    body.appendChild(card);
  }

  function openFlowCellSheet(a, dk) {
    var today = todayKey();
    flowSheet(function (sheet) {
      flowSheetHead(sheet, a.name);
      sheet.appendChild(hEl("p", "modal-sub", fdLong(dk)));
      var st = flowState(a, dk);
      var label = st.kind === "done" ? "Completed" : st.kind === "partial" ? "Partly done" : st.kind === "skip" ? "Skipped" : st.kind === "rs" ? "Moved to " + fdShort(st.to) : dk > today ? "Planned" : "Not completed";
      sheet.appendChild(hEl("p", "fl-cell-state", label));
      var mvFrom = st.kind !== "rs" ? flowMovedInFrom(a, dk) : null;
      if (mvFrom) sheet.appendChild(hEl("p", "modal-sub", "Moved here from " + fdShort(mvFrom) + "."));
      var Vd = flowVer(a, dk);
      if (Vd.type !== "simple" && !a.link && dk <= today && st.kind !== "skip" && st.kind !== "rs") sheet.appendChild(hEl("p", "modal-sub", flowProgressText(Vd, st.v)));
      if (dk > today) { sheet.appendChild(hEl("p", "modal-sub", "This day hasn't happened yet.")); return; }
      if (st.kind === "skip" || st.kind === "rs") { sheet.appendChild(flowBtn("Undo", "btn btn-outline btn-full", function () { closeFlowSheet(); flowUndoAside(a, dk); })); return; }
      if (Vd.type === "simple" || a.link) {
        sheet.appendChild(flowBtn(st.kind === "done" ? "Mark not done" : "Mark done", "btn btn-primary btn-full", function () { closeFlowSheet(); flowToggle(a, dk); }));
      } else {
        sheet.appendChild(flowBtn(Vd.type === "value" ? "Log a value" : "Set progress", "btn btn-primary btn-full", function () { openFlowValueSheet(a, dk); }));
        if (st.kind === "done" || st.kind === "partial") sheet.appendChild(flowBtn("Clear", "btn btn-outline btn-full", function () { closeFlowSheet(); flowSetValue(a, dk, 0); }));
      }
      sheet.appendChild(flowBtn("Skip this day", "btn btn-outline btn-full", function () { closeFlowSheet(); flowSetAside(a, dk, "skip"); }));
    });
  }

  // ---- Home: a compact look, not the whole system ----
  function flowWeekStrip() {
    var start = fdWeekStart(todayKey()), today = todayKey(), out = [];
    for (var i = 0; i < 7; i++) { var dk = fdAdd(start, i); var d = dk <= today ? flowDay(dk) : null; out.push({ dk: dk, letter: FD_LETTERS[i], pct: d ? d.pct : null, isToday: dk === today, future: dk > today }); }
    return out;
  }

  function initFlow() {
    flowMigrate();
    document.getElementById("flow-back").addEventListener("click", function () { setActiveView("home"); });
    document.querySelectorAll(".fl-tab").forEach(function (b) {
      b.addEventListener("click", function () { flowTab = b.dataset.fltab; if (flowTab === "week") flowWeekStart = fdWeekStart(todayKey()); renderFlow(); });
    });
    document.getElementById("modal-flow").addEventListener("click", function (e) { if (e.target === this) closeFlowSheet(); });
  }

  // ---------- SPRINT 1 BRIDGE ----------
  // The one controlled doorway between this legacy file and the new feature layer (js/features/*). Feature code
  // can only use what is listed here; it never reaches into app internals directly.
  function salahSet(name, on) {
    var all = readJSON("nc_salah_completions", {}), d = todayKey();
    all[d] = all[d] || {};
    if (on) all[d][name] = true; else delete all[d][name];
    writeJSON("nc_salah_completions", all);
  }
  window.NuraApp = {
    hEl: hEl, showToast: showToast, todayKey: todayKey, readJSON: readJSON, writeJSON: writeJSON, uid: uid,
    repo: BR, flags: BR_FLAGS, track: track,
    setActiveView: setActiveView, renderHome: renderHome, openFlow: openFlow,
    userName: function () { return localStorage.getItem("nc_user_name"); },
    journeyDay: function () { ensureJourneyStarted(); return getJourneyDay(); },
    salah: {
      order: PRAYER_ORDER, methods: PRAYER_METHODS,
      hasSettings: function () { return !!getPrayerSettings(); },
      settings: getPrayerSettings, save: savePrayerSettings,
      timings: function () { return salahTimingsFor(todayKey()); },
      timingsFor: salahTimingsFor,
      location: function () { return salahLocation(); },
      ensure: function () { return fetchPrayerTimesForToday(); },
      prayed: getSalahCompletions, setPrayed: salahSet,
      paintSetup: paintHeroSetup,
      requestGPS: requestLocationForPrayerTimes
    },
    plan: {
      activities: getPlanActivities, saveActivities: savePlanActivities, settings: getPlanSettings,
      built: getPlanBuilt, saveBuilt: savePlanBuilt, compute: computePlanSchedule,
      toMin: planTimeToMinutes, toClock: planMinutesToClock
    },
    mem: {
      suggestionsFor: memSuggestionsFor, correct: memCorrect, observe: memObserve, key: memKey, log: memLog,
      addException: memAddException, daysLabel: memDaysLabel, parseCorrection: memParseCorrection, applyCorrection: memApplyCorrection
    },
    flow: {
      day: flowDay, toggle: flowToggle, timeFor: flowTimeFor, applies: flowApplies, actions: flowActions,
      long: fdLong, add: flowAdd
    }
  };

  // ---------- INIT ----------

  document.addEventListener("DOMContentLoaded", function () {
    initNav();
    initNameModal();
    initPriorityUI();
    initFocusTimer();
    initSunnahSubtabs();
    initDuasUI();
    initHadithUI();
    initQuranUI();
    initVault();
    initShield();
    initChatInput();
    initFlow();
    initMore();
    initDuniyaHabits();
    initDuniyaProductivity();
    initDuniyaWellbeing();
    initDuniyaCareer();
    initDuniyaMoney();
    initPhoneGuard();
    initRecovery();
    initMemory();
    try { memRun(); } catch (e) {}
    initDuniyaGrowth();
    initDuniyaPlan();
    if (window.NuraFeatures) window.NuraFeatures.init();
    renderHome();
    renderMore();
  });
})();
