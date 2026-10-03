/* NURA Salah Trust Layer (deterministic).
 *
 * Prayer times are computed on the device from astronomy (the well-known PrayTimes.org algorithm), never by
 * a language model and never from a guess. The same inputs always give the same times, with no network.
 * Everything that can legitimately change a time is an explicit, visible setting:
 *   - calculation method (Fajr/Isha angles)
 *   - Asr juristic method (standard = Shafi'i/Maliki/Hanbali shadow x1, Hanafi = shadow x2)
 *   - manual per-prayer offsets (e.g. the local mosque's own timetable)
 *   - location + time zone
 *   - high-latitude rule when Fajr/Isha do not occur astronomically
 * explain() turns those into plain sentences so the user can answer "why is this time different?".
 *
 * Minutes are minutes since local midnight. Pure functions: no DOM, no storage, no clock.
 */
(function (root) {
  "use strict";

  var PRAYERS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

  // ids match the Aladhan ids the app already stores in nc_prayer_settings.method
  var METHODS = {
    1: { id: 1, name: "Karachi (University of Islamic Sciences)", fajr: 18, isha: 18 },
    2: { id: 2, name: "ISNA (North America)", fajr: 15, isha: 15 },
    3: { id: 3, name: "Muslim World League", fajr: 18, isha: 17 },
    4: { id: 4, name: "Umm al-Qura (Makkah)", fajr: 18.5, ishaAfterMaghribMin: 90 },
    5: { id: 5, name: "Egyptian General Authority", fajr: 19.5, isha: 17.5 },
    11: { id: 11, name: "Singapore (MUIS)", fajr: 20, isha: 18 }
  };

  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  function sin(d) { return Math.sin(d * D2R); }
  function cos(d) { return Math.cos(d * D2R); }
  function tan(d) { return Math.tan(d * D2R); }
  function arcsin(x) { return Math.asin(x) * R2D; }
  function arccos(x) { return Math.acos(x) * R2D; }
  function arctan2(y, x) { return Math.atan2(y, x) * R2D; }
  function arccot(x) { return Math.atan(1 / x) * R2D; }
  function fixAngle(a) { return fix(a, 360); }
  function fixHour(a) { return fix(a, 24); }
  function fix(a, m) { a = a - m * Math.floor(a / m); return a < 0 ? a + m : a; }

  function julian(y, m, d) {
    if (m <= 2) { y -= 1; m += 12; }
    var A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
  }

  function sunPosition(jd) {
    var D = jd - 2451545.0;
    var g = fixAngle(357.529 + 0.98560028 * D);
    var q = fixAngle(280.459 + 0.98564736 * D);
    var L = fixAngle(q + 1.915 * sin(g) + 0.020 * sin(2 * g));
    var e = 23.439 - 0.00000036 * D;
    var RA = arctan2(cos(e) * sin(L), cos(L)) / 15;
    return { declination: arcsin(sin(e) * sin(L)), equation: q / 15 - fixHour(RA) };
  }

  function parseDate(dateKey) {
    var p = String(dateKey).split("-");
    return { y: Number(p[0]), m: Number(p[1]), d: Number(p[2]) };
  }
  function toMin(hours) { return isFinite(hours) ? Math.round(hours * 60) : null; }
  function hhmm(min) {
    if (min === null || min === undefined || !isFinite(min)) return null;
    min = ((Math.round(min) % 1440) + 1440) % 1440;
    return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
  }
  function fromHHMM(s) {
    if (!s) return null;
    var p = String(s).split(":");
    var h = Number(p[0]), m = Number(p[1]);
    return isFinite(h) && isFinite(m) ? h * 60 + m : null;
  }

  /**
   * compute({dateKey, lat, lon, tzOffsetMin, method, asr, offsets, elevation})
   *   tzOffsetMin: minutes EAST of UTC (India = 330). asr: "standard" | "hanafi".
   * returns {ok, times:{Fajr,Sunrise,Dhuhr,Asr,Maghrib,Isha} in minutes, hhmm:{...}, notes:[...], adjustedHighLat, params}
   */
  function compute(o) {
    var method = METHODS[o.method] || METHODS[3];
    var asrFactor = o.asr === "hanafi" ? 2 : 1;
    var lat = Number(o.lat), lon = Number(o.lon);
    var out = { ok: false, times: {}, hhmm: {}, notes: [], adjustedHighLat: false, params: { method: method.id, asr: o.asr === "hanafi" ? "hanafi" : "standard", fajrAngle: method.fajr, ishaAngle: method.isha || null } };
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { out.notes.push("no-location"); return out; }
    var tz = (o.tzOffsetMin === undefined || o.tzOffsetMin === null) ? Math.round(lon / 15) * 60 : o.tzOffsetMin;
    var dt = parseDate(o.dateKey);
    var jd = julian(dt.y, dt.m, dt.d) - lon / (15 * 24);

    function midDay(t) { return fixHour(12 - sunPosition(jd + t).equation); }
    function sunAngleTime(angle, t, ccw) {
      var decl = sunPosition(jd + t).declination, noon = midDay(t);
      var x = (-sin(angle) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat));
      if (x < -1 || x > 1) return NaN; // the sun never reaches this angle that day at this latitude
      var h = 1 / 15 * arccos(x);
      return noon + (ccw ? -h : h);
    }
    function asrTime(factor, t) {
      var decl = sunPosition(jd + t).declination;
      var angle = -arccot(factor + tan(Math.abs(lat - decl)));
      return sunAngleTime(angle, t, false);
    }
    var riseSet = 0.0347 * Math.sqrt(Math.max(0, o.elevation || 0)) + 0.833;
    var d24 = function (h) { return h / 24; };
    var T = { fajr: d24(5), sunrise: d24(6), dhuhr: d24(12), asr: d24(13), sunset: d24(18), maghrib: d24(18), isha: d24(18) };

    var fajr = sunAngleTime(method.fajr, T.fajr, true);
    var sunrise = sunAngleTime(riseSet, T.sunrise, true);
    var dhuhr = midDay(T.dhuhr);
    var asr = asrTime(asrFactor, T.asr);
    var sunset = sunAngleTime(riseSet, T.sunset, false);
    var maghrib = sunset;
    var isha = method.isha ? sunAngleTime(method.isha, T.isha, false) : NaN;

    // shift from "solar" hours to the local clock
    var adj = tz / 60 - lon / 15;
    fajr += adj; sunrise += adj; dhuhr += adj; asr += adj; sunset += adj; maghrib += adj; isha += adj;
    if (method.ishaAfterMaghribMin) isha = maghrib + method.ishaAfterMaghribMin / 60;

    // high latitudes: when Fajr/Isha don't occur, or fall too far from sunrise/sunset, use the night-portion rule
    if (isFinite(sunrise) && isFinite(sunset)) {
      var night = fixHour(sunrise - sunset);
      var portion = function (angle) { return angle / 60 * night; };
      if (!isFinite(fajr) || fixHour(sunrise - fajr) > portion(method.fajr)) { fajr = sunrise - portion(method.fajr); out.adjustedHighLat = true; }
      if (method.isha && (!isFinite(isha) || fixHour(isha - sunset) > portion(method.isha))) { isha = sunset + portion(method.isha); out.adjustedHighLat = true; }
    }
    if (!isFinite(sunrise) || !isFinite(sunset)) { out.notes.push("polar-day-or-night"); return out; }
    if (out.adjustedHighLat) out.notes.push("high-latitude-rule");

    var raw = { Fajr: fajr, Sunrise: sunrise, Dhuhr: dhuhr, Asr: asr, Maghrib: maghrib, Isha: isha };
    var offs = o.offsets || {};
    Object.keys(raw).forEach(function (k) {
      var m = toMin(raw[k]);
      if (m === null) return;
      m += Number(offs[k]) || 0;
      out.times[k] = m;
      out.hhmm[k] = hhmm(m);
    });
    out.ok = PRAYERS.every(function (p) { return out.times[p] !== undefined; });
    return out;
  }

  /**
   * Where are we relative to the prayers? Everything the Brain needs, in minutes.
   *   timings: {Fajr,Dhuhr,Asr,Maghrib,Isha} minutes. nextFajrMin: tomorrow's Fajr (minutes from today's midnight), optional.
   *   leadMin: how long before a prayer NURA begins transition support. salahMin: how long a prayer takes.
   */
  function windowInfo(timings, nowMin, leadMin, salahMin, nextFajrMin) {
    var lead = leadMin === undefined ? 10 : leadMin, dur = salahMin === undefined ? 15 : salahMin;
    var seq = PRAYERS.map(function (n) { return { name: n, at: timings[n] }; }).filter(function (p) { return p.at !== undefined && p.at !== null; });
    var res = { next: null, current: null, previous: null, inPrep: false, inSalah: false };
    if (!seq.length) return res;
    var fajrTomorrow = nextFajrMin !== undefined && nextFajrMin !== null ? nextFajrMin : seq[0].at + 1440;
    for (var i = 0; i < seq.length; i++) {
      var p = seq[i];
      if (nowMin >= p.at && nowMin < p.at + dur) { res.current = { name: p.name, at: p.at, endsAt: p.at + dur, sinceMin: nowMin - p.at }; res.inSalah = true; }
      if (p.at <= nowMin) res.previous = { name: p.name, at: p.at };
    }
    for (var j = 0; j < seq.length; j++) {
      if (seq[j].at > nowMin) { res.next = { name: seq[j].name, at: seq[j].at, inMin: seq[j].at - nowMin, tomorrow: false }; break; }
    }
    if (!res.next) res.next = { name: "Fajr", at: fajrTomorrow, inMin: fajrTomorrow - nowMin, tomorrow: true };
    res.inPrep = !!res.next && !res.next.tomorrow && res.next.inMin <= lead;
    res.leadMin = lead; res.salahMin = dur;
    return res;
  }

  /** Plain-language reasons behind the times. settings = {method, asr, offsets, city, lat, lon, source, tzOffsetMin, deviceTzOffsetMin}. */
  function explain(s, result) {
    var m = METHODS[s.method] || METHODS[3], lines = [];
    var isha = m.ishaAfterMaghribMin ? "Isha is " + m.ishaAfterMaghribMin + " minutes after Maghrib" : "Isha at " + m.isha + "° below the horizon";
    lines.push({ k: "salah.explain.method", p: { name: m.name, fajr: m.fajr, isha: isha } });
    lines.push({ k: s.asr === "hanafi" ? "salah.explain.asr.hanafi" : "salah.explain.asr.standard", p: {} });
    var offs = s.offsets || {}, parts = [];
    PRAYERS.forEach(function (p) { if (Number(offs[p])) parts.push(p + " " + (offs[p] > 0 ? "+" : "") + offs[p] + " min"); });
    lines.push(parts.length ? { k: "salah.explain.offsets", p: { list: parts.join(", ") } } : { k: "salah.explain.noOffsets", p: {} });
    if (s.lat !== undefined && s.lat !== null) lines.push({ k: "salah.explain.location", p: { lat: Number(s.lat).toFixed(2), lon: Number(s.lon).toFixed(2) } });
    if (s.tzOffsetMin !== undefined && s.deviceTzOffsetMin !== undefined && s.tzOffsetMin !== s.deviceTzOffsetMin) lines.push({ k: "salah.explain.tzMismatch", p: {} });
    if (result && result.adjustedHighLat) lines.push({ k: "salah.explain.highLat", p: {} });
    lines.push({ k: s.source === "device" ? "salah.explain.source.device" : "salah.explain.source.cache", p: {} });
    lines.push({ k: "salah.explain.differences", p: {} });
    return lines;
  }

  var api = { PRAYERS: PRAYERS, METHODS: METHODS, compute: compute, windowInfo: windowInfo, explain: explain, hhmm: hhmm, fromHHMM: fromHHMM };
  root.NuraSalah = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
