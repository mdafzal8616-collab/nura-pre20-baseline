# NURA Sprint 1 (Brain V0, build 0.1.0) — architecture, decisions, deviations

One running document. Everything below describes what is actually in this repo, not the plan.

## What Sprint 1 proves

CONTEXT → ONE realistic next action → ACTION → RESULT → LEARNING, and the loop is also traceable, testable, safe to fail and ready to evolve.

Runs entirely on this device. No model, no backend, no account. `cloud_ai` is off and there is no provider behind it.

## Layout

```
js/core/        pure logic: no DOM, no storage, no network, no clock reads (tested in lab.html)
  salah.js        Salah Trust Layer (astronomical calculation, methods, Asr school, offsets, high-latitude rule, explain())
  capacity.js     Personal Capacity Model (median/outlier-trimmed pace, confidence, conservative sizing, corrections)
  brain.js        Decision engine, learned beliefs, replan permission model, day load, compact status
  interruption.js INTERVENE / WAIT / DO_NOTHING (push vs pull rules)
  session.js      timestamp-based sessions + WORK → WRAP → PREPARE → SALAH → RESUME state
  guard.js        untrusted-data boundary, tool allowlist + authorization + approval, context minimisation, task validation
  platform.js     Brain version, error classes, feature flags/kill switches, environment, analytics (allowlisted), traces
  ai.js           layer routing, tier budgets (FREE/GOLD/PLATINUM), timeout + fallback gateway
  sources.js      Islamic source registry (provenance → review → approval → active; instant disable)
  i18n.js         every UI sentence is a key; en complete; hi/ur/ar partial; RTL
js/data/repo.js   repository over a tiny storage interface, versioned migrations, checksummed backup/restore
js/features/      service layer + screens (bridge.js has no DOM; ui/today/plan/progress/boot are presentation)
js/tests/         evalkit.js (runner + run-to-run diff) and scenarios.js
lab.html          Scenario Lab: run everything, see inputs/expected/actual/PASS-FAIL/reason/version, download JSON
js/app.js         legacy app, now reaching the new code only through `window.NuraApp` (one doorway)
```

## Navigation

Today · Hamdard · Progress · Plan. No More tab. Quran/Sunnah, Duniya tools, Daily Flow, Plan My Day, settings are supporting screens reached from the profile button on Today (More). The old Home cards (Salah hero, priority card, ring, tiles) are gone from Today; the priority card element is parked hidden only because the Duniya tools still mount it.

## The decision

`NuraBrain.decide(input)` returns one of: RECOMMEND, DO_NOTHING, IN_SESSION, WRAP, PREPARE, SALAH, RESUME, with a state (normal, study, work, salah_approaching, calibration, disrupted, no_useful, no_plan, active_task, resume_after_salah), `messages` and `why` as `{k, p}` i18n keys, `alternatives`, a `routineHint` (no-plan mode), `interruption`, `meta` and the Brain version.

Hierarchy implemented: hard constraint → Salah transition / fixed commitment → urgent deadline → priority → fits capacity → optional → silence. Score = deadline urgency + priority + "you chose it for today" + context boosts + office-hours container + learned patterns (user-correctable) − recent repeat.

Sizing example (Scenario S01): Asr in 38 min, lead 8 → usable 30, pace 10 min/question → at most 3 fit; 25–30% of the window is left unplanned → **2 questions, ~20 min**; never 5.

### Personal capacity
- < 2 usable sessions → calibration ("I'm still learning your pace. Try a 20-minute session?"), no number.
- 2–3 sessions → an early range, confidence Low. 4+ consistent → Medium; 7+ and tight → Higher. Displayed as whole minutes / a range, never decimals.
- Median + outlier trimming (one odd session barely moves it). Abandoned/tiny sessions never teach pace. Wrapped-for-Salah sessions do.
- Sessions tagged with a temporary context are kept out of the baseline; while the context is active they are used if there are ≥ 2.
- Corrections: "harder today / low energy" (today only, +30%), "estimate wrong" (lasting +25%, halves with every newer real session), "priority changed", "unusual day" (→ disrupted mode), "other".

### Salah Trust Layer
Calculated on the device from latitude/longitude (PrayTimes algorithm) with explicit settings: method (Karachi, MWL, ISNA, Umm al-Qura, Egyptian, Singapore), Asr school (standard / Hanafi), manual per-prayer offsets (±30), high-latitude night-portion rule, device time zone. Verified against Aladhan: 9 cases within 1 minute (Delhi std + Hanafi, London June, Makkah, New York, Cairo, Singapore, Oslo June, Chennai). Aladhan is only used once to turn a typed city into coordinates, and as a last-resort cache. `explain()` answers "why is this time different?". If the saved city's zone differs from the device's, it says so.

Existing-behaviour note: the old method list labelled Karachi "(Hanafi)" but requested standard Asr from the API. Asr is now an explicit setting; the default stays *standard* so no one's times changed silently. India users who follow Hanafi should switch it (Asr moves ~50 min later).

### Salah transition
Wrap prompt `lead` minutes before the prayer (5/10/15/custom, default 10) → Wrap up banks the minutes and the exact unit → PREPARE → SALAH (Prayed) → "Continue Physics — Chapter 5 from Q3? [Resume] [Change plan]". A running session that is still running when a prayer time passes stops counting at that moment and enters the transition automatically (also after the app was closed). A session nobody touched for hours is marked abandoned and teaches nothing.

### Replanning permission model
Small reversible shifts (flexible block ≤ 30 min) apply automatically and show as ↷ Moved in Today Flow. Moves > 30 min, items that no longer fit, or sleep pushed later by > 15 min are shown as a proposal ("I can move … Apply?") and nothing changes until approved. The user's own events (e.g. "Doctor 7 PM") are always added; only the rearranging of flexible items needs approval.

## Data (`nc_br_*`, namespaced per build by the app's `p20_` shim)

| key | content |
|---|---|
| `nc_br_schema` | migration version (currently 4) |
| `nc_br_tasks` | Task {id,key,area,title,sub,unitType,target,done,deadline,priority,status} — validated before it can exist |
| `nc_br_sessions` | one entry per ended session: key, area, unitType, amount, minutes, hour/dow/date/tod, outcome, difficulty, ctx, predicted min/units, **brain version** |
| `nc_br_active`, `nc_br_transition` | the running/wrapped session and the Salah transition |
| `nc_br_corrections`, `nc_br_belief_state`, `nc_br_reset` | user corrections, per-learning status, evidence cut-offs ("delete this learning") |
| `nc_br_contexts` | temporary modes (exam, travel, Ramadan, special schedule, busy work week) |
| `nc_br_day_<date>` | plan confirmed, focus tasks + today targets, moved/removed, dismissals, snooze, last shown/pushed |
| `nc_br_settings` | language, Salah lead/duration/Asr/offsets, quiet hours, day end |
| `nc_br_events` | local analytics (see below) · `nc_br_flags` kill switches · `nc_br_location` resolved coordinates |

Task model: Area (study/work/personal) → Title → Sub (chapter/part) → unit type (questions/pages/sections/items/minutes/finish) → target → deadline → priority → status. Study (Physics → Chapter 5 → 20 questions) and Work (Client Report → Pricing section → finish) use the same structure and engine.

### Migrations
Versioned, ordered, recorded, idempotent (`NuraRepo.MIGRATIONS`). Never edit a shipped one; add a new one. Schema is identical in development, staging and production; `NuraPlatform.detectEnv(hostname)` marks the environment and production disables dev tools.

### Backup / restore
`repo.backup()` → checksummed bundle. `repo.restore(bundle)` rejects a bad checksum or a bundle from a newer schema, then migrates. **A backup counts as proven only when `restore()` into a clean store succeeds and `verifyAgainst()` is clean** — Scenario F06 does exactly that. There is no cloud backup yet, so there is nothing production to restore-test; do that before any cloud launch.

## Safety and security
- External/retrieved text is data (`NuraGuard.untrusted`): never executed, can't authorize, can't change rules.
- A model/tool request must parse into a strict schema, name an allowlisted tool, pass argument validation and authorization (other users' data, admin-only), and sensitive tools need explicit user approval. `read_vault` / `read_all_history` are never exposed.
- Context minimisation: a purpose lists the only fields a model may see; vault, recovery, conversations, raw location and full history are never available.
- Analytics: an allowlist of event names and of metadata keys, short codes/numbers only, Brain version attached. No titles, notes or free text.
- Errors are classified (NETWORK, AI_TIMEOUT, DATABASE, PERMISSION, SALAH_CONFIG, INVALID_TASK_DATA, AUTH, MODEL, UNKNOWN); users get one simple sentence; developer detail redacts keys/emails and carries no stack.
- Islamic sources: submit anything, approve only a trusted-origin source with a named reviewer, disable instantly, evidence is tagged as non-instruction. The existing Tanzil Quran text is honestly *not eligible* for any new retrieval feature yet (rule B5: no named reviewer).
- Kill switches (`nc_br_flags`): `nura_now_advanced` off → plain focus block; `pattern_engine` off → no learned beliefs/hints; `cloud_ai` (default off), `islamic_ai`, `focus_guard`, `agents`, `experimental`. Unknown flags are ignored.

## Analytics events (local only)
nura_now_shown, nura_now_started, nura_now_changed, nura_now_dismissed, why_this_opened, capacity_corrected, task_started, task_completed, task_abandoned, salah_transition_triggered, salah_resume_started, intervention_sent, intervention_suppressed, plan_created, plan_skipped, temporary_context_started/ended, replan_auto/proposed/applied.

## Scenario Lab
Open `lab.html`. 70 scenarios across: realism, capacity, Salah, interruption, privacy, routing, offline, correction, context, safety. Each record has id, inputs, expected, actual, PASS/FAIL, reason and Brain version; the last run is kept and the next run reports regressions/fixes. Re-run it after any change to Brain rules, copy, routing or (later) prompts/models/agents.

## Deviations from the brief (and why)
1. **Not React Native / Expo / TypeScript / SQLite.** The repo is a plain HTML/CSS/JS web app (with an Android WebView wrapper); there is no Node, npm or Expo project on this machine, and the project rules say not to install SDKs without asking. Per the brief's own rule (do not rewrite the project; reuse sound architecture) Sprint 1 is built in the existing app. Logic is in pure modules behind a storage interface, so it ports to Expo/SQLite later. No type checker or linter was available; the Scenario Lab is the safety net.
2. The "Hamdard" tab is the existing rule-based companion chat (formerly labelled Bhai). The private Vault, which was also called Hamdard, is now "Private Vault" so there is one Hamdard.
3. The viewport meta no longer forbids pinch-zoom (accessibility / scalable text).
4. No real push notifications: a web page cannot wake itself. Interruption rules are implemented and tested; in the app they gate when the card pulses and are logged. A notification channel belongs in the Android wrapper.

## Known limits / next
- Hindi, Urdu and Arabic cover navigation and primary actions only and have not been reviewed by native speakers; the rest falls back to English.
- Legacy screens (Sunnah, Duniya, Daily Flow) are still English only.
- Capacity pooling across similar tasks is deliberately not done (a new subject always starts in calibration).
- Plan parsing handles "Doctor 7 PM", ranges, "at 5:30 for 30 min" and cancellations of known routines; anything else asks for a time.
- Ramadan: the context separates sessions; Umm al-Qura's longer Ramadan Isha gap is not modelled.
