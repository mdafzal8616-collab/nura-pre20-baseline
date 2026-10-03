/* NURA Islamic source registry (architecture only - Sprint 1 ships no Islamic AI).
 *
 *   SOURCE -> VERSION -> PROVENANCE -> REVIEW STATUS -> APPROVAL STATUS -> ACTIVE / DISABLED
 *
 * Only an approved, reviewed (by a NAMED reviewer), active source from a trusted origin can ever be used.
 * Retrieved Islamic text is EVIDENCE with its source attached; it is never an instruction to the system.
 * Unknown web pages, user uploads and AI-generated "Quran/Hadith" can be submitted but are forced to
 * pending + inactive and can never silently enter the trusted corpus. Any source can be switched off at once.
 *
 * The existing Quran module is untouched; this registry is what a future retrieval layer must consult.
 */
(function (root) {
  "use strict";

  var TRUSTED_ORIGINS = { curated_import: 1 };           // set by a person through an import process, never by a client/model
  var UNTRUSTED_ORIGINS = { web: 1, user_upload: 1, ai_generated: 1, unknown: 1 };

  function makeRegistry(initial) {
    var sources = {}, log = [];
    (initial || []).forEach(function (s) { sources[s.id] = s; });
    function note(id, what, why) { log.push({ id: id, what: what, why: why || "", at: new Date().toISOString() }); }
    return {
      /** Anything may be SUBMITTED; nothing becomes usable by being submitted. */
      submit: function (s) {
        var origin = UNTRUSTED_ORIGINS[s.origin] || TRUSTED_ORIGINS[s.origin] ? s.origin : "unknown";
        var rec = { id: s.id, kind: s.kind || "unknown", version: s.version || "0", origin: origin, provenance: s.provenance || {}, reviewer: null, reviewStatus: "unreviewed",
          approval: "pending", active: false };
        // A client cannot self-approve: these fields are ignored on submit.
        sources[rec.id] = rec; note(rec.id, "submitted", origin);
        return rec;
      },
      review: function (id, reviewerName) {
        var s = sources[id]; if (!s || !reviewerName || !String(reviewerName).trim()) return false;
        s.reviewer = String(reviewerName).trim(); s.reviewStatus = "reviewed"; note(id, "reviewed", s.reviewer); return true;
      },
      approve: function (id, byRole) {
        var s = sources[id];
        if (!s || byRole !== "admin") return { ok: false, reason: "admin_only" };
        if (!TRUSTED_ORIGINS[s.origin]) return { ok: false, reason: "untrusted_origin" };   // web / uploads / AI text can never be approved
        if (s.reviewStatus !== "reviewed" || !s.reviewer) return { ok: false, reason: "no_named_reviewer" };
        s.approval = "approved"; s.active = true; note(id, "approved", s.reviewer); return { ok: true };
      },
      disable: function (id, reason) { var s = sources[id]; if (!s) return false; s.active = false; note(id, "disabled", reason); return true; },   // takes effect immediately
      eligible: function (id) { var s = sources[id]; return !!(s && s.active && s.approval === "approved" && s.reviewStatus === "reviewed" && s.reviewer && TRUSTED_ORIGINS[s.origin]); },
      /** Filter retrieved passages to eligible sources and tag them as evidence-not-instruction. */
      evidence: function (passages) {
        var self = this;
        return (passages || []).filter(function (p) { return self.eligible(p.sourceId); })
          .map(function (p) { return { sourceId: p.sourceId, version: sources[p.sourceId].version, text: String(p.text), role: "evidence", instruction: false }; });
      },
      get: function (id) { return sources[id] || null; },
      all: function () { return Object.keys(sources).map(function (k) { return sources[k]; }); },
      log: function () { return log.slice(); }
    };
  }

  // The Quran text already in the app: real provenance, but CLAUDE.md rule B5 says it still has no named reviewer,
  // so it is honestly NOT eligible for any new retrieval feature until someone is named.
  function seed() {
    return makeRegistry([{ id: "quran-tanzil-uthmani", kind: "quran", version: "1.1", origin: "curated_import",
      provenance: { name: "Tanzil Project", license: "CC BY 3.0", url: "tanzil.net" }, reviewer: null, reviewStatus: "unreviewed", approval: "pending", active: false }]);
  }

  var api = { makeRegistry: makeRegistry, seed: seed };
  root.NuraSources = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
