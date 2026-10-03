/* NURA Scenario Lab - evaluation kit.
 *
 * A scenario is a fixed input, an explicit expectation and a verdict. Every run records, per scenario:
 *   id, category, title, inputs (summary), expected, actual, PASS/FAIL, reason, version tested.
 * Any change to Brain rules, recommendation logic, prompts, models, agents or tool routing is re-run against the
 * SAME scenario set, and results are compared with the previous run so a regression is visible, not subjective.
 *
 * Categories (V1.1 section C): realism, capacity, salah, interruption, privacy, routing, offline, correction, context, safety.
 */
(function (root) {
  "use strict";

  var CATEGORIES = [
    ["realism", "Recommendation realism"], ["capacity", "Personal Capacity use"], ["salah", "Salah handling"], ["interruption", "Interruption decision"],
    ["privacy", "Privacy / minimum context"], ["routing", "Task routing"], ["offline", "Offline fallback"], ["correction", "User correction handling"],
    ["context", "Temporary-context handling"], ["safety", "Unsafe / unwanted action prevention"]
  ];
  var list = [];

  /**
   * add({id, cat, title, inputs: string, expected: string, run: () => any | Promise, check: (actual) => true | string(reason of failure)})
   * `describe` (optional) turns the raw result into a short readable string for the record.
   */
  function add(s) { list.push(s); return s; }

  function short(v) { try { var s = typeof v === "string" ? v : JSON.stringify(v); return s.length > 260 ? s.slice(0, 257) + "..." : s; } catch (e) { return String(v); } }

  function runOne(s, version) {
    var rec = { id: s.id, cat: s.cat, title: s.title, inputs: s.inputs, expected: s.expected, version: version, actual: "", pass: false, reason: "" };
    function judge(actual) {
      var r; try { r = s.check(actual); } catch (e) { r = "check threw: " + (e && e.message); }
      rec.actual = short(s.describe ? s.describe(actual) : actual);
      rec.pass = r === true; rec.reason = r === true ? "meets expectation" : String(r);
      return rec;
    }
    try {
      var out = s.run();
      if (out && typeof out.then === "function") return out.then(judge, function (e) { rec.actual = "threw: " + (e && e.message); rec.reason = "scenario threw"; return rec; });
      return Promise.resolve(judge(out));
    } catch (e) { rec.actual = "threw: " + (e && e.message); rec.reason = "scenario threw"; return Promise.resolve(rec); }
  }

  function runAll(version, filter) {
    var chain = Promise.resolve([]);
    list.forEach(function (s) { if (filter && s.cat !== filter) return; chain = chain.then(function (acc) { return runOne(s, version).then(function (r) { acc.push(r); return acc; }); }); });
    return chain.then(function (results) {
      var pass = results.filter(function (r) { return r.pass; }).length;
      return { version: version, at: new Date().toISOString(), total: results.length, pass: pass, fail: results.length - pass, results: results };
    });
  }

  /** Compare two runs: which scenarios regressed (PASS -> FAIL) or were fixed. Same ids only. */
  function diff(prev, cur) {
    var p = {}; (prev ? prev.results : []).forEach(function (r) { p[r.id] = r.pass; });
    var regressed = [], fixed = [], added = [];
    cur.results.forEach(function (r) { if (!(r.id in p)) added.push(r.id); else if (p[r.id] && !r.pass) regressed.push(r.id); else if (!p[r.id] && r.pass) fixed.push(r.id); });
    return { regressed: regressed, fixed: fixed, added: added };
  }

  var api = { CATEGORIES: CATEGORIES, add: add, all: function () { return list.slice(); }, runAll: runAll, runOne: runOne, diff: diff };
  root.NuraEval = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
