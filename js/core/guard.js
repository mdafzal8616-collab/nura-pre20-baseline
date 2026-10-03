/* NURA security boundary.
 *
 * Rules enforced here (and tested in the Scenario Lab as SEC-01..07):
 *  - Anything that is not the user's own typed instruction, or NURA's own code, is UNTRUSTED DATA: retrieved text,
 *    web content, files, screenshots, AI output. It is content to read, never an instruction to follow.
 *  - Raw model output can never perform an action. It has to be parsed into a strict schema, name an ALLOWLISTED
 *    tool, pass validation and authorization, and (for sensitive tools) get the user's explicit approval.
 *  - Models only get the minimum context fields a task needs.
 *  - Task input is validated before it can reach the Brain; bad input is rejected, never coerced into Brain state.
 *
 * No network, no storage, no DOM. Pure functions.
 */
(function (root) {
  "use strict";

  var P = root.NuraPlatform || (typeof require !== "undefined" ? require("./platform.js") : null);

  // ---------------------------------------------------------------- untrusted content
  var INJECTION = /(ignore|disregard|forget)\b[^.]{0,40}\b(previous|prior|above|system|all)\b[^.]{0,30}\b(rules?|instructions?|prompts?)|you are now\b|new (system )?instructions?:|reveal (your )?(system )?prompt|send (all )?(the )?(user|my) (data|history)|exfiltrate/i;
  /** Wrap external text so downstream code can never confuse it with an instruction. */
  function untrusted(text, source) {
    var s = String(text === undefined || text === null ? "" : text);
    return { trusted: false, kind: "content", source: String(source || "unknown").slice(0, 40), text: s.slice(0, 4000), flagged: INJECTION.test(s) };
  }
  /** A flagged or unflagged untrusted item is still never executed: this returns what MAY be done with it. */
  function allowedUses(item) { return item && item.trusted === false ? { display: true, quote: true, summarise: true, execute: false, authorize: false, changeRules: false } : { execute: false, authorize: false, changeRules: false }; }

  // ---------------------------------------------------------------- tools: allowlist + authorization + approval
  // Each tool declares its schema, whether it is sensitive (needs explicit approval) and who may call it.
  var TOOLS = {
    start_session:     { sensitive: false, role: "user", args: { taskId: "string" } },
    change_task:       { sensitive: false, role: "user", args: { taskId: "string" } },
    add_task:          { sensitive: false, role: "user", args: { title: "string", area: "string" } },
    mark_prayed:       { sensitive: false, role: "user", args: { prayer: "string" } },
    move_block:        { sensitive: false, role: "user", args: { id: "string", toMin: "number" } },
    cancel_commitment: { sensitive: true,  role: "user", args: { id: "string" } },
    delete_learning:   { sensitive: true,  role: "user", args: { id: "string" } },
    export_data:       { sensitive: true,  role: "user", args: {} },
    set_feature_flag:  { sensitive: true,  role: "admin", args: { flag: "string", on: "boolean" } },
    read_vault:        { sensitive: true,  role: "never", args: {} },
    read_all_history:  { sensitive: true,  role: "never", args: {} }
  };
  function typeOk(v, t) { return t === "string" ? typeof v === "string" && v.length <= 200 : t === "number" ? typeof v === "number" && isFinite(v) : t === "boolean" ? typeof v === "boolean" : false; }

  /**
   * authorize(request, actor, opts) -> {ok, reason, needsApproval}
   *  request: {tool, args, source:'user_ui'|'model'|'retrieved', ownerId}
   *  actor: {id, role:'user'|'admin'|'anonymous'}
   * A model/retrieved source can only REQUEST; sensitive tools additionally require opts.approved === true given by the user.
   */
  function authorize(request, actor, opts) {
    opts = opts || {};
    var def = request && TOOLS.hasOwnProperty(request.tool) ? TOOLS[request.tool] : null;
    if (!def) return { ok: false, reason: "tool_not_allowlisted" };
    if (def.role === "never") return { ok: false, reason: "never_exposed" };
    if (request.source === "retrieved") return { ok: false, reason: "untrusted_source_cannot_act" };
    if (!actor || !actor.id || actor.role === "anonymous") return { ok: false, reason: "not_authenticated" };
    if (request.ownerId && request.ownerId !== actor.id) return { ok: false, reason: "other_users_data" }; // never act on someone else's data
    if (def.role === "admin" && actor.role !== "admin") return { ok: false, reason: "admin_only" };
    var args = request.args || {}, keys = Object.keys(def.args);
    for (var i = 0; i < keys.length; i++) if (!typeOk(args[keys[i]], def.args[keys[i]])) return { ok: false, reason: "invalid_args:" + keys[i] };
    if (Object.keys(args).some(function (k) { return !def.args.hasOwnProperty(k); })) return { ok: false, reason: "unexpected_args" };
    if (def.sensitive && opts.approved !== true) return { ok: false, reason: "approval_required", needsApproval: true };
    return { ok: true, reason: "authorized" };
  }

  /** Parse model text into a tool request; anything that is not strictly the expected JSON becomes plain text. */
  function parseToolRequest(modelText) {
    try {
      var o = JSON.parse(String(modelText));
      if (o && typeof o === "object" && typeof o.tool === "string" && (o.args === undefined || typeof o.args === "object")) return { tool: o.tool, args: o.args || {}, source: "model" };
    } catch (e) { /* not a structured request */ }
    return null;
  }

  // ---------------------------------------------------------------- context minimisation
  // A purpose lists the only fields it may see. Everything else is dropped, including anything the caller asked for.
  var PURPOSES = {
    next_action: ["now", "salah", "tasks", "capacity", "commitments", "contexts"],
    plan_help: ["now", "salah", "tasks", "commitments"],
    explain: ["decision", "why"]
  };
  var NEVER = ["vault", "recovery", "conversations", "reflections", "journal", "contacts", "location_raw", "full_history", "email", "name_free_text"];
  function minimize(context, purpose, requested) {
    var allowed = PURPOSES[purpose] || [], out = {}, omitted = [];
    var want = requested && requested.length ? requested : allowed;
    want.forEach(function (f) {
      if (NEVER.indexOf(f) !== -1 || allowed.indexOf(f) === -1) { omitted.push(f); return; }
      if (context && f in context) out[f] = context[f];
    });
    return { context: out, omitted: omitted };
  }

  // ---------------------------------------------------------------- task validation
  var AREAS = { study: 1, work: 1, personal: 1 };
  var UNITS = { questions: 1, pages: 1, sections: 1, items: 1, minutes: 1, finish: 1 };
  function validateTask(raw) {
    var errors = [], t = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["not_an_object"] };
    var title = typeof raw.title === "string" ? raw.title.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim() : "";
    if (!title || title.length > 80) errors.push("title"); else t.title = title;
    if (!AREAS[raw.area]) errors.push("area"); else t.area = raw.area;
    var sub = raw.sub === undefined || raw.sub === null ? "" : String(raw.sub).replace(/[\u0000-\u001f]/g, " ").trim();
    if (sub.length > 80) errors.push("sub"); else t.sub = sub;
    if (!UNITS[raw.unitType]) errors.push("unitType"); else t.unitType = raw.unitType;
    var needsTarget = raw.unitType === "questions" || raw.unitType === "pages" || raw.unitType === "sections" || raw.unitType === "items";
    if (raw.target === undefined || raw.target === null || raw.target === "") { if (needsTarget) errors.push("target"); t.target = null; }
    else { var n = Number(raw.target); if (!isFinite(n) || n <= 0 || n > 10000 || Math.floor(n) !== n) errors.push("target"); else t.target = n; }
    if (raw.deadline === undefined || raw.deadline === null || raw.deadline === "") t.deadline = null;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw.deadline)) && !isNaN(new Date(raw.deadline + "T12:00:00").getTime())) t.deadline = String(raw.deadline); else errors.push("deadline");
    var pr = raw.priority === undefined ? 2 : Number(raw.priority);
    if (pr !== 1 && pr !== 2 && pr !== 3) errors.push("priority"); else t.priority = pr;
    return errors.length ? { ok: false, errors: errors } : { ok: true, task: t };
  }

  var api = { untrusted: untrusted, allowedUses: allowedUses, INJECTION: INJECTION, TOOLS: TOOLS, authorize: authorize, parseToolRequest: parseToolRequest,
    minimize: minimize, PURPOSES: PURPOSES, NEVER: NEVER, validateTask: validateTask, AREAS: AREAS, UNITS: UNITS };
  root.NuraGuard = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
