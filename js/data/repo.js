/* NURA data layer (local-first).
 *
 * Repositories over a tiny storage interface {getItem,setItem,removeItem,key,length}. On the web build that is
 * localStorage (through the app's namespacing shim); in tests it is an in-memory store; a native build can swap in
 * SQLite behind the same repository methods without touching the Brain or the screens.
 *
 * Schema changes only happen through versioned MIGRATIONS (run in order, recorded, idempotent). Backups are
 * checksummed bundles and are only considered proven once restoreAndVerify() has succeeded into a CLEAN store.
 */
(function (root) {
  "use strict";

  var Guard = root.NuraGuard || (typeof require !== "undefined" ? require("../core/guard.js") : null);
  var Plat = root.NuraPlatform || (typeof require !== "undefined" ? require("../core/platform.js") : null);
  var Cap = root.NuraCapacity || (typeof require !== "undefined" ? require("../core/capacity.js") : null);

  var K = {
    schema: "nc_br_schema", tasks: "nc_br_tasks", sessions: "nc_br_sessions", active: "nc_br_active", transition: "nc_br_transition",
    corrections: "nc_br_corrections", beliefState: "nc_br_belief_state", reset: "nc_br_reset", contexts: "nc_br_contexts", settings: "nc_br_settings",
    events: "nc_br_events", usage: "nc_br_ai_usage", dayPrefix: "nc_br_day_", flags: "nc_br_flags"
  };

  var DEFAULT_SETTINGS = { lang: "en", salah: { leadMin: 10, salahMin: 15, asr: "standard", offsets: {} }, quiet: { startMin: 23 * 60 + 30, endMin: 5 * 60 }, dayEndMin: 23 * 60 };

  // ---------------------------------------------------------------- migrations
  // Never edit a shipped migration; add a new one. Each takes the repo and upgrades stored data.
  var MIGRATIONS = [
    { v: 1, name: "create-brain-collections", up: function (r) {
      if (!Array.isArray(r.read(K.tasks, null))) r.write(K.tasks, []);
      if (!Array.isArray(r.read(K.sessions, null))) r.write(K.sessions, []);
      if (!Array.isArray(r.read(K.corrections, null))) r.write(K.corrections, []);
      if (!Array.isArray(r.read(K.contexts, null))) r.write(K.contexts, []);
    } },
    { v: 2, name: "settings-salah-and-quiet-defaults", up: function (r) {
      var s = r.read(K.settings, null) || {};
      s.salah = Object.assign({}, DEFAULT_SETTINGS.salah, s.salah || {});
      s.quiet = s.quiet || DEFAULT_SETTINGS.quiet; s.dayEndMin = s.dayEndMin || DEFAULT_SETTINGS.dayEndMin;
      r.write(K.settings, s);
    } },
    { v: 3, name: "settings-language", up: function (r) { var s = r.read(K.settings, null) || {}; s.lang = s.lang || "en"; r.write(K.settings, s); } },
    { v: 4, name: "sessions-record-brain-version", up: function (r) {
      var list = r.read(K.sessions, []); list.forEach(function (s) { if (!s.brain) s.brain = "pre-0.1.0"; }); r.write(K.sessions, list);
    } }
  ];

  function fnv(str) { var h = 0x811c9dc5; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return ("0000000" + h.toString(16)).slice(-8); }

  function makeMemoryStorage() {
    var m = {};
    return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; }, key: function (i) { return Object.keys(m)[i] || null; }, get length() { return Object.keys(m).length; } };
  }

  function create(storage, opts) {
    opts = opts || {};
    var lastError = null;
    var repo = {
      K: K,
      lastError: function () { return lastError; },
      read: function (key, fb) { try { var raw = storage.getItem(key); return raw === null || raw === undefined || raw === "" ? fb : JSON.parse(raw); } catch (e) { lastError = Plat.report(e, { where: "read" }); return fb; } },
      write: function (key, val) {
        try { storage.setItem(key, JSON.stringify(val)); return true; }
        catch (e) { var rep = Plat.report(e, { where: "write" }); lastError = rep.cls === Plat.ERR.UNKNOWN ? Plat.report(Plat.makeError(Plat.ERR.DATABASE, "write failed"), { where: "write" }) : rep; return false; }
      },
      remove: function (key) { try { storage.removeItem(key); } catch (e) { /* nothing to remove */ } },

      // ------- migrations
      schemaVersion: function () { return Number(repo.read(K.schema, 0)) || 0; },
      latestSchema: function () { return MIGRATIONS[MIGRATIONS.length - 1].v; },
      migrate: function () {
        var from = repo.schemaVersion(), applied = [];
        MIGRATIONS.forEach(function (m) { if (m.v > from) { m.up(repo); repo.write(K.schema, m.v); applied.push(m.name); } });
        return { from: from, to: repo.schemaVersion(), applied: applied };
      },

      // ------- settings
      settings: function () { var s = repo.read(K.settings, null); return Object.assign({}, DEFAULT_SETTINGS, s || {}, { salah: Object.assign({}, DEFAULT_SETTINGS.salah, (s && s.salah) || {}) }); },
      saveSettings: function (s) { return repo.write(K.settings, s); },

      // ------- tasks (validated before they can exist)
      tasks: function () { var l = repo.read(K.tasks, []); return Array.isArray(l) ? l : []; },
      addTask: function (raw) {
        var v = Guard.validateTask(raw);
        if (!v.ok) return { ok: false, errors: v.errors, cls: Plat.ERR.TASK };
        var t = v.task;
        t.id = "tk-" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
        t.key = Cap.key(t); t.done = 0; t.status = "active"; t.createdAt = new Date().toISOString();
        var list = repo.tasks(); list.push(t);
        return repo.write(K.tasks, list) ? { ok: true, task: t } : { ok: false, errors: ["storage"], cls: Plat.ERR.DATABASE };
      },
      updateTask: function (id, patch) {
        var list = repo.tasks(), hit = null;
        list.forEach(function (t) { if (t.id === id) { Object.keys(patch).forEach(function (k) { t[k] = patch[k]; }); hit = t; } });
        if (hit) repo.write(K.tasks, list);
        return hit;
      },
      removeTask: function (id) { repo.write(K.tasks, repo.tasks().filter(function (t) { return t.id !== id; })); },

      // ------- sessions (the capacity model's evidence)
      sessions: function () { var l = repo.read(K.sessions, []); return Array.isArray(l) ? l : []; },
      logSession: function (entry) {
        var l = repo.sessions(); entry.brain = Plat.BRAIN_VERSION; l.push(entry);
        if (l.length > 600) l = l.slice(l.length - 600);
        return repo.write(K.sessions, l);
      },

      // ------- per-day state (plan confirmed, moved items, dismissals...)
      day: function (dateKey) { return Object.assign({ confirmed: false, unusual: false, moved: [], removed: [], todayTargets: {}, dismissals: [], snoozedUntilMin: null, dismissedTaskIds: [], interventions: [] }, repo.read(K.dayPrefix + dateKey, null) || {}); },
      saveDay: function (dateKey, d) { return repo.write(K.dayPrefix + dateKey, d); },
      patchDay: function (dateKey, patch) { var d = repo.day(dateKey); Object.keys(patch).forEach(function (k) { d[k] = patch[k]; }); repo.saveDay(dateKey, d); return d; },

      // ------- backup / restore
      backup: function () {
        var keys = {}, i;
        for (i = 0; i < storage.length; i++) { var k = storage.key(i); if (k && k.indexOf("nc_") === 0) keys[k] = storage.getItem(k); }
        var names = Object.keys(keys).sort(), sum = fnv(names.map(function (n) { return n + "=" + keys[n]; }).join("\n"));
        return { format: "nura-backup", schema: repo.schemaVersion(), brain: Plat.BRAIN_VERSION, createdAt: new Date().toISOString(), env: opts.env || "unknown",
          manifest: { keys: names.length, tasks: (repo.read(K.tasks, []) || []).length, sessions: (repo.read(K.sessions, []) || []).length }, checksum: sum, data: keys };
      },
      /** Restore into THIS storage (callers pass a clean one for a restore test). */
      restore: function (bundle) {
        if (!bundle || bundle.format !== "nura-backup" || !bundle.data) return { ok: false, reason: "not_a_backup" };
        var names = Object.keys(bundle.data).sort();
        if (fnv(names.map(function (n) { return n + "=" + bundle.data[n]; }).join("\n")) !== bundle.checksum) return { ok: false, reason: "checksum_mismatch" };
        if (bundle.schema > repo.latestSchema()) return { ok: false, reason: "backup_from_newer_version" };
        names.forEach(function (n) { storage.setItem(n, bundle.data[n]); });
        var mig = repo.migrate();
        return { ok: true, restored: names.length, migrated: mig.applied };
      },
      /** Proof that a restore really worked: counts match, data parses, schema is current. */
      verifyAgainst: function (bundle) {
        var problems = [];
        var tasks = repo.tasks(), sessions = repo.sessions();
        if (tasks.length !== bundle.manifest.tasks) problems.push("task_count");
        if (sessions.length !== bundle.manifest.sessions) problems.push("session_count");
        if (repo.schemaVersion() !== repo.latestSchema()) problems.push("schema_not_current");
        tasks.forEach(function (t) { if (!Guard.validateTask({ title: t.title, area: t.area, sub: t.sub, unitType: t.unitType, target: t.target, deadline: t.deadline, priority: t.priority }).ok) problems.push("invalid_task:" + t.id); });
        return { ok: problems.length === 0, problems: problems };
      }
    };
    return repo;
  }

  var api = { create: create, makeMemoryStorage: makeMemoryStorage, K: K, MIGRATIONS: MIGRATIONS, DEFAULT_SETTINGS: DEFAULT_SETTINGS };
  root.NuraRepo = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
