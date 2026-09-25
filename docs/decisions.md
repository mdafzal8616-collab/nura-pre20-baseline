# Decisions Log

Record decisions here as they're made, newest first.

## 2026-09-19 — User Understanding & Memory Engine (local-first, rule-based)

Built a persistent memory layer so NURA stops re-asking for the same routine. Observe → remember → find patterns → confidence → personalise → ask only when unsure → learn from corrections. **No LLM and no network** (none exists in the project); everything is structured data + plain rules. It learns only from activity inside NURA — never messages, photos, browsing, mic, camera, contacts or other apps.

**Storage (localStorage, `nc_mem_*`, covered by export / "delete all data")**: `nc_mem_events` (event log: type, module, small metadata, capped at 3,000 / 180 days; types include plan_created, plan_changed, task_completed/skipped, study_started/completed, personal_growth_completed, sleep_started, wake_recorded, goal_created, money_saved_recorded, habit_completed, sunnah_completed, hadith_read, routine_confirmed, routine_corrected), `nc_mem_patterns` (remembered commitments: observations + what the user confirmed/corrected/forgot), `nc_mem_exceptions` ("today only" changes), `nc_mem_meta` (learning state, question pacing, forgotten patterns), `nc_mem_profile` (cached UserUnderstandingProfile: identity/preferences, routine patterns, goals, personal growth, behaviour patterns, preferences, metadata). On first run it backfills from existing saved Plan My Day activities.

**Three memory levels**: Level 1 today (exceptions, never become routine), Level 2 pattern memory (evidence + confidence), Level 3 stable memory (user-confirmed or corrected schedules). A single event never becomes a routine. "Today only" changes are logged but excluded from evidence.

**Confidence** is deliberately coarse, from recency-weighted matching days (last 4 weeks ×1, weeks 5–8 ×½, older ×¼), agreement among sightings, and staleness: LOW <3, MEDIUM 3–4, HIGH 5+ with ≥70% agreement, VERY HIGH 12+ with ≥85%; disagreement caps it at LOW/MEDIUM, going stale drops a level, user confirmation raises it to at least HIGH. Wording matches certainty ("You've had… once/twice/a few times" → "This seems to be becoming a pattern" → "You usually…" → "Your usual…").

**Weekday-aware**: evidence is analysed per weekday and merged, so Gym Mon/Wed 6 PM and Gym Fri 8 PM coexist. **Decay**: if the last three sightings on a weekday agree on a new time, that replaces the old routine (gradually earned). **Drift**: a confirmed schedule is never changed silently — if the last 3 sightings after confirmation agree on something different, NURA asks "Your X times seem to have changed to …. Update?".

**Asking**: at most one confirmation question per day, only for HIGH+ patterns; answers: Yes (stored as confirmed), Not always (snoozed 14 days, capped at MEDIUM), No (rejected for 60 days, evidence cleared).

**Corrections (the user always wins)**: plain-language box ("college cancelled today" → today only; "college at 8 pm today" → today only; "my college is now 10–3" / "permanently changed" → permanent; ambiguous → asks Today only / Always). Permanent corrections replace the schedule for those weekdays from today and ignore older evidence for them. Manual Edit (days + times), Forget (clears an item, leaves a marker so old evidence can't return), Forget a learned pattern, and Forget everything (does not relearn from old plans; other NURA data is untouched).

**Personalisation**: Plan My Day shows "Your usual day" (usual items pre-checked, Low-confidence ones offered as "Use today?", each with Keep / Change today / Not today, plus "Anything different today?"), builds the plan in one tap, and sets the day window from learned wake/sleep. Study picker shows a data-backed suggested length with the reason. Personal Growth adds "Today you have College … a natural place to try this" only when the schedule is confirmed/HIGH. Weekly report (Progress Details) gets "NURA noticed" rows only when data supports them. Review screen: More → What NURA Knows About Me.

**Tested**: 35 days of seeded plans → College VERY HIGH, Gym per-weekday groups with different confidence, one-offs LOW; the confirmation question; restart; Plan My Day pre-fill; "college cancelled today" (plan without college, routine intact, expired tomorrow); permanent "10–3" (AM/PM inferred); decay; drift → update; Not always / No; manual edit; Forget; Forget everything; low-confidence suggestion; today-only change excluded from evidence; study preference + hint; wake-time learning; Personal Growth context; weekly row; corrupted-data-safe reads; no console errors; other screens unaffected. Days were simulated by seeding/shifting stored dates.

**Limits**: learns only what NURA itself sees; flexible tasks and Qur'an/dua activity are not yet pattern-mined (Sunnah/Hadith/habit events are logged but not analysed); some wording rules are simple patterns, not language understanding; the Android APK was rebuilt to include this but only the website was exercised in tests.

## 2026-09-19 — Personal Growth rebuilt as a complete, persisted growth system

Replaced the old "pick an area, get one generic task" screen. Flow: 14-question assessment (first time only) → rule-based recommendation → 7-day mission → one real-world action a day → 1–3 question reflection → saved → adaptive next step → weekly progress. No AI anywhere; scoring, selection and reports are plain code, so it works with Bhai AI off.

**Storage (localStorage, all `nc_pg_*`, so the existing export/"delete all data" cover it)**: `nc_pg_profile` (assessmentCompleted/Date, answers, per-track scores, strongest/improvement areas, primary/secondary focus, currentFocus, startLevel/trackLevels, obstacle, dailyMinutes, goalText, activeMissionId, totalGrowthDays, completedChallenges, skippedChallenges, lastActiveDate, assessmentHistory of earlier retakes), `nc_pg_draft` (unfinished assessment, so it resumes), `nc_pg_missions` (each mission: track, weekNo, days with actionId/frozen text/level/status/date), `nc_pg_history` (one entry per interaction: date, area, planDay, challenge, status, difficulty, feeling, obstacle, reflection, smaller-version flag, completedAt), `nc_pg_today` (started / couldn't / missed-note dismissed). The old `nc_duniya_growth_log` is left alone. Counters are recomputed from history so they can't drift.

**Assessment → recommendation**: each answer adds "needs work" points to tracks (choices via option weights; 1–5 scales via low/high). Primary = highest score (tie → the area the user said matters most), secondary = next. The sentence "Based on your answers, …" comes from whichever answer weighed most for the primary track. Result shows primary, secondary, biggest obstacle, daily time, and strongest areas.

**Content**: 12 tracks (Confidence, Communication, Social, Discipline, Consistency, Focus & Procrastination, Decision Making, Emotional Control, Time Management, Resilience, Self-Awareness, Courage), 7 actions each, each with a smaller / normal / stretch version and a one-sentence "why". Week 1 uses the actions in a progressive order; weeks 2–4 of the 30-day journey re-order them (consistency, slightly uncomfortable at +1 level, then "your choice of 3").

**Daily selection / adaptation**: the day's action comes from the plan; its wording is chosen from the track's current level when first shown, then frozen (a reload never changes today's challenge). Two easy completions in a row raise the level; "Couldn't do it" drops to the smaller version (offer "Try a smaller version" the same day; after two failures on the same day the day is skipped kindly and the plan moves on); "Too easy / Too difficult" adjust immediately; "Change today's challenge" swaps with a later day so nothing is lost. One challenge per calendar day per mission; the next day unlocks the next date. Missed days never reset anything ("You missed yesterday. Continue from one small action today.").

**Weekly report**: computed only from `nc_pg_history` over the last 7 days — actions completed x/7, partly done, per-track completed counts, hardest skill (hard or couldn't-do), skill completed easily, missed days, recovery ("Returned after missing a day"), a 7-day ✓/½/— graph, a rule-based summary that only states counts and week-on-week comparison, and the latest reflection. With no entries: "Not enough data yet". Same numbers appear as neutral rows in the existing Progress Details view. It intentionally makes no claims like "confidence improved by N%".

**Switching / retake**: switching area pauses the current mission (never deletes) and resumes an existing mission for that area; history stays. Retake starts a fresh draft, keeps the old profile until completion, archives the previous answers, and leaves history/missions untouched.

**Tested** (browser, fresh storage; days simulated by shifting saved dates): assessment progress, validation and Back/Next; resume after refresh mid-assessment; result; Day 1 (uses the requested wording) → Start → Completed → reflection → saved; Home → back → refresh → still done and Day 2 locked; next date unlocks Day 2; Couldn't do it → smaller version → completed; adaptive level up after two easy days (Day 7 used the stretch version); swap; Too difficult; week completion → Week 2 mission; missed days banner; switch to Communication and back (Confidence kept, "Resume"); weekly report equals an independent count of the raw history (4/7, Confidence 3, Communication 1, 3 missed days, recovery); Progress Details rows; retake (recommendation changed, history untouched, old assessment archived); corrupted/wrong-shape saved data does not crash; two failures skip a day; partly-done counts separately; other Duniya areas, Home/Sunnah/AI Chat/More unaffected; no console errors.

**Limits**: "days" in testing were simulated by shifting saved dates, not by waiting real days. Content is my own wording, not reviewed by a specialist; emotional-control and resilience items are practice prompts, not treatment. No reminders/notifications. Week-4 "your choice" and the 30-day journey are lightly tested. The old generic-exercise data is not migrated (nothing valuable in it).

## 2026-09-19 — Money Habits: "+ Add Saving" in 2–3 taps

Simplified the everyday saving entry without redesigning Money Habits. **+ Add Saving** (on every goal card, the goal screen and Quick Actions) → "How much did you save?" → "Did you actually keep/move this ₹X for your goal?" → **Yes, I saved it** or **I only avoided spending it**. The goal is preselected (the last-used goal; goal chips appear only when there are several), so a normal save is: tap Add Saving → type amount → Yes → Done. The old source list (Salary, Gift, …) was removed from this flow; contributions from it are labelled "Saved".

- **Yes** adds the amount to the goal immediately and shows one small screen: goal progress, an optional "Where did you keep it? Bank / UPI / Cash / Other / Skip" (stored on that contribution, shown in Recent activity, never blocking), **Move Money Now**, and Done.
- **Only avoided** records "Avoided Spending: +₹X" separately (`avoidedOnly` avoided-purchase record tied to the goal); it does not touch saved money or the progress bar. One optional button, "Move ₹X to my goal", converts it into a real contribution. The goal screen also offers to move all of a goal's outstanding avoided spending.
- **Dashboard** goal cards now show the four clear numbers: Actually Saved, Avoided Spending (not yet moved), Remaining, Progress (one decimal, e.g. 16.8%). Only Actually Saved moves the bar.
- **Move Money Now** opens an installed payment app. In the Android app: native `listPaymentApps` / `launchApp` with a fixed allow-list (Google Pay, PhonePe, Paytm, BHIM); it only opens the app. In Android Chrome: `intent://` links ("opens the app if it's installed"). On desktop: plain text. NURA never asks for or stores PINs, passwords, OTPs or card details; the panel says so.

**Tested**: your example (Phone ₹50,000: saved ₹8,400, avoided ₹2,300 → Remaining ₹41,600, Progress 16.8%, bar 16.8%), the 3-tap flow, optional UPI tag and skip, both "Move to goal" paths (progress only rises on move), amount validation, second goal with last-used default, weekly report (avoided ₹2,700 vs saved ₹12,300 kept apart), the older avoided-purchase/"what happened to this money" flow still works, reload persistence, no console errors. Payment-app opening was tested against a stand-in bridge only, not on a phone.

**Not done**: no edit/delete of a saving entry; "Move Money Now" can't pre-fill an amount or payee (deliberately, no payment details are handled).

## 2026-09-19 — Money Habits: savings goals only grow when the user confirms money was saved

**Problem**: goals could be created but there was no honest way to grow them — avoided purchases either auto-counted or went to a vague "general" bucket, and there was only one goal.

**Fix**: four things are now tracked separately and never mixed — (A) money avoided, (B) money actually saved (added to a goal, or kept as unallocated savings), (C) money added to savings goals, (D) money spent (logged expenses plus avoided money the user says was spent elsewhere). A goal's saved amount is always the sum of its contribution ledger (`nc_money_contribs`), so it can't drift; unallocated savings (`nc_money_unalloc`) and expenses (`nc_money_expenses`) are their own ledgers.

Every "avoided money" event (I avoided a purchase / Should I buy this? → Don't buy it / habit check-in reduction) now ends at one shared screen: "You avoided spending ₹X. What happened to this ₹X?" → (1) add to a savings goal (pick which goal), (2) I spent it somewhere else (goal stays unchanged), (3) I kept it but don't want to add it to a goal yet (unallocated, movable later). Options 1 and 3 accept a smaller amount; the remainder is recorded as spent elsewhere (so avoiding ₹1,000 and adding ₹400 shows avoided ₹1,000 / allocated ₹400 / spent ₹600). Avoided money the user hasn't decided on is shown on the dashboard as "what happened to this money?" and is never counted as saved.

Added: multiple goals; a goal screen (target, actually saved, remaining, %, bar, recent contributions like "+ ₹800 — Avoided shoes purchase"); "+ Add Money" with an optional source (Salary/income, Avoided purchase, Smoking reduction, Other bad habit reduction, Gift, Cash saved, Other); "Log an expense"; "Move unallocated to a goal"; the four Quick Actions. "Should I buy this?" is now item → price → Need/Want → a decision check (afford without touching essential money? delays a goal? — shows the real % of what's left on each goal — still want it?) → Buy it (offers to log the expense) / Don't buy it (→ the allocation question) / Decide later / Wait 24 hours (non-needs only). Decisions to revisit show on the dashboard. Editing a habit check-in removes its earlier allocation before re-recording. Weekly report shows Money avoided / actually saved / spent / added to goals separately, plus goal progress; the 7-day graph now plots actually-saved, not avoided.

**Migration**: data from the earlier version (goal running totals, "general savings") is converted once (`nc_money_v2`): a goal's old total becomes an "Earlier savings" contribution, "general" savings become unallocated savings. Old date-based totals for goal money will show at the goal's creation date.

**Tested** (fresh storage, in a browser): the exact scenario requested — Phone ₹50,000; avoid ₹800 → "spent elsewhere" → goal stays ₹0; avoid ₹1,000 → add to Phone → ₹1,000; manually add ₹500 → ₹1,500. Also: partial split, keep → unallocated → move (and over-move rejected), every Should-I-Buy outcome, expenses, weekly report numbers vs. hand calculation (avoided ₹5,099 / saved ₹4,199 / spent ₹2,150 / to goals ₹4,199), reload persistence, habit reduction + edit reversal, migration of old-format data (idempotent), two goals with a goal chooser, goal completion, no console errors, Recovery / Plan My Day / Phone Control unaffected.

**Not done**: no editing or deleting a goal or an individual contribution/expense (mistakes need a new entry); the 24-hour wait is a reminder on the Money screen, not a notification; the Android APK still contains the older website until rebuilt.

## 2026-09-19 — Habits & Discipline → Recovery (bad-habit recovery system)

Added a private "Recovery" section reached from Habits & Discipline (existing habit list untouched). Choose Pornography / Masturbation / Smoking / Cannabis / Excessive social media / Gaming / Junk food / Other (custom name), with an optional private nickname that replaces the habit name everywhere. Start wizard: habit → start date (today/tomorrow/pick) → why → triggers → optional goal → (smoking only) cigarettes/day, cost per cigarette or per pack, optional saving goal.

**Streak rules (decided, please review)**: a day counts as successful only if the user checks in "clean" for it. A missed check-in is neither a success nor a slip, but it does break the streak (we never assume clean, in line with "never fake data"). To make that fair, yesterday can be checked in late ("Add yesterday's check-in"), and today's answer can be changed. Current streak = consecutive clean days ending today (or yesterday if today isn't checked in yet). A slip resets only the current streak; best streak, total successful days and all history are computed from the untouched log, so they never drop. Best streak is computed, not stored.

**Slip flow**: "You slipped today, but your previous progress still counts. Understand what triggered it and restart." plus the real best-streak/total numbers, then a trigger chip (Stress, Boredom, Being alone, Social media, Late night, Anger, Other) saved privately. Trigger patterns (this week + overall) show on the dashboard. No red, no shame wording; slips are gold on the graph.

**Urge screen** ("I'm having an urge", on Recovery and on each dashboard): tick-able small actions (leave the room, phone away, walk, water, wudu, cold water, push-ups), a real 10-minute countdown (based on an end time, so it stays accurate), a link to duas, an optional trusted contact stored only on the device with a tap-to-call link, and "I got through this urge" (logged). "Something useful" deliberately does not reuse the workout picker, because that flow replaces Home's daily priority — bad to trigger mid-urge.

**Smoking money**: only from clean check-ins: cigarettes avoided = clean days × cigarettes/day; money = that × cost per cigarette; this-week and total, with a saving-goal progress bar. Example checked: 6/day at ₹10 → ₹60/day → 7 days = ₹420.

**Weekly report**: per-journey "This week" block (successful days and slips vs last week, current/best streak, change vs last week, urges got through, money saved for smoking, trigger patterns). Progress Details (the existing weekly view) gets neutral "Recovery —" rows with totals only and no habit names or trigger text, added after the existing rows, which are unchanged.

**Privacy**: local-only (`nc_recovery_*`). Nothing on Home. No notifications are sent by this feature (the web app has none), so the neutral-wording rule ("Your NURA check-in is ready") is not needed yet; if reminders are added later they must use that wording. Included in the existing data export and "delete all data" (both cover every `nc_` key), plus a per-journey delete. Not encrypted — same as the rest of ordinary NURA data (only Vault is); the export file is plain JSON and contains this data.

**Tested** (browser, fresh storage): creating journeys (smoking and custom-with-nickname), validation, future start ("start today instead"), streak maths on a seeded 12-day history against hand-computed values (current 5, best 6, total 11, week 5/7, prior week 6, money ₹660/₹300), clean check-in → streak 6, slip → current 0 with best 6 and total 11 intact, trigger save and patterns, backfill of yesterday, persistence across reload, urge screen actions/timer countdown/contact call link/"got through" log, Home and Progress Details leak no habit names, delete journey, regression on Habits list/Money/Plan My Day, no console errors.

**Not done / placeholder**: no reminders or notifications; no editing of a journey's details after creation (delete and restart instead); no lock or encryption for this section; trigger patterns are simple counts, not analysis; the Android APK does not yet contain this feature (rebuild needed).

## 2026-09-19 — Phone Control → Intentional Open: first native Android build (debug APK, NOT yet tested on a phone)

**Why native**: the site is plain HTML/JS on GitHub Pages; a web page cannot see which app is open, list installed apps, or draw over other apps (CLAUDE.md §8 already says so). Rather than fake it, added an `android/` project: a small Kotlin app that hosts the unchanged website from local assets (copied from the repo root at build time, works offline, same localStorage) plus a JS bridge `window.NuraNative`. The GitHub Pages site is unchanged and simply shows "needs the NURA Android app" for this feature.

**Least-invasive Android APIs, no Accessibility Service**: `UsageStatsManager` (Usage Access, granted by hand in Settings) to see which package is in front; `SYSTEM_ALERT_WINDOW` ("display over other apps") to draw the pause on top of the app being opened — Android 10+ blocks a background app from launching its own screen, and a full-screen notification is weaker; a foreground service (`specialUse`) to poll; installed-app picker via a `<queries>` launcher intent (no `QUERY_ALL_PACKAGES`). Play Store note: Usage Access and overlay are sensitive; a declaration/justification will be needed before any Play release. `allowBackup=false` plus `dataExtractionRules` excludes all stored usage data from cloud backup and device transfer.

**Behaviour**: OFF by default; turning it on shows what each permission is for *before* opening Android Settings. The user picks the watched apps (nothing hard-coded). Pause on a fresh open (not while inside a "grace" window after Continue, default 10 min), and again if opened 3× in 15 min (adjustable), or when the user's own open limit is exceeded. Overlay flow: reason → message (goes straight in) / specific (what + limit) / entertainment (limit) / just checking (5 s countdown → "Do you still want to open X?"). Continue is always available. Back key = Go back. Optional per-app daily target, opening limit and session timer, each a single neutral reminder. Data stored on the phone only: package, opens, milliseconds, pauses, went back, continued, chosen reason. Dashboard (Today) and weekly comparison (this week vs last, avg/day, ↓/↑) read only that stored data; Progress Details shows a 7-day Phone Control line only when data exists. Failure states (usage revoked, overlay revoked, monitor stopped, notifications off with limits set, app uninstalled, battery optimisation) each show a plain message plus a fix button. Boot receiver restarts monitoring only if the user had it on.

**Design decisions to revisit**: "impulsive openings avoided" is defined as the number of times the user chose Go Back (or left the pause screen) — an honest proxy, not proof of intent. Time is counted only while the app is in front and no pause is waiting. The overlay does not pause audio/video already playing in the app underneath (Android doesn't allow that without more invasive access).

**Tested**: website logic with a stand-in bridge — web-without-app honest message, OFF default, permission-first flow with the turn-on button disabled until requirements met, app picker persistence, per-app limits, all failure states with fix buttons, turning off stops the monitor, and stats maths against hand-computed numbers (1h 22m today; week 2h 22m vs 5h 0m, ↓ 2h 38m, 20m/day); regression on Money Habits, Plan My Day, Home. Native: compiles, Android lint has no errors, APK contains the latest site and only the intended permissions.

**NOT tested**: any of the native runtime on a real phone or emulator (this PC has no emulator acceleration and USB debugging was declined). Foreground detection, the overlay, the 5-second flow, notifications, boot restart and Vivo Funtouch battery behaviour are unverified until the APK is installed and tried by hand.

## 2026-09-18 — Dunya → Money Habits rebuilt as a real action/tracking system, not a Yes/No question

Replaced the old "Did you avoid an unnecessary purchase today? Yes/No" screen (one question, no numbers, no memory) with a full practical system inside the same `#duniya-money-content` mount point — no other screen, nav item, or route was touched. Core loop end to end: QUESTION → ACTION → MONEY SAVED → TRACK IT → SEE PROGRESS.

Built: a Saving Goal (pick a preset like Emergency fund/Phone/Laptop or name your own, set a target, real progress bar); a Money Habits tracker (category chips — Smoking/Tobacco/Alcohol/Junk food/Food delivery/Shopping/Subscriptions/etc., or Other/Custom — plus usual quantity/day and cost/unit, which computes and displays the real daily/weekly/30-day/yearly cost, e.g. 8×₹20 → ₹160/day ≈ ₹58,400/year); a daily check-in (optional "reduce by 1/2/3" target, then "how many today" stepper, computing `avoided = max(0, normal-actual) × cost` — never a fabricated number, and explicitly "No saving recorded today. You can try again tomorrow." with no lecture when nothing was avoided); a one-tap "+ I avoided a purchase" button; a "Should I buy this?" decision tool (Need/Want/Not Sure, with a 24h/3-day/7-day wait option that re-asks "Do you still want it?" once the wait elapses — checked live against the clock on every dashboard render, no fake push notification); a weekly report (money avoided vs. transferred to savings, this-week-vs-last-week habit spending with a clearly-labeled *estimate* projection, a real 7-day bar graph); and a goal-completion celebration screen with real stats (total saved, days taken, avoided-purchases total, reduced-habit total).

Every logged action lets the user choose the money's destination — **Saving Goal** (moves the progress bar) or **General Savings** (still counts in the Today/Week/Month/all-time totals, just doesn't move the goal bar) — matching the spec's distinction between "money I avoided" and "money transferred toward a goal."

Privacy: habits can be given a private custom name (e.g. "Habit A") and a "keep private" flag; the dashboard always shows the custom name over the category once set, and nothing about a money habit surfaces anywhere outside this section.

**Real bug found and fixed during testing**: editing a check-in *after* its saved amount had already been added to a Saving Goal silently orphaned that money — the goal kept the ₹60 it had already received, but overwriting the day's log entry (to reflect the new, lower or zero avoided amount) reset that day's/week's/month's/all-time totals back down, so the dashboard undercounted real money that was still sitting in the goal. Caught by testing exactly this: check in at 5 (saved ₹60, added to goal), then re-open the same check-in and change it back to 8 (no saving) — the goal stayed at ₹60 but every other total dropped to ₹0, a real accounting mismatch. Fixed with `reverseFromGoal()`, which un-does the previous commit (subtracting it back out of the goal, and un-completing the goal if that drops it back under target) before the new check-in amount is recorded — re-tested the identical sequence and confirmed the goal now correctly reflects only what the current, truthful log actually supports.

**Tested**: full happy path against the spec's own worked example (8/day habit at ₹20, reduced to 5 → exactly ₹60 saved, exactly matching the spec's cost breakdown ₹160/day, ₹1,120/week, ₹4,800/30 days, ₹58,400/year); the no-fake-savings path (actual = usual → "No saving recorded today", no goal movement); Saving Goal vs. General Savings destination split (confirmed General Savings counts in totals but never moves the goal bar); "I avoided a purchase" one-tap flow; "Should I buy this?" for Need (no wait, no saving), Want with a simulated elapsed wait period (re-ask banner appears, Yes/No both handled), and "Decide now instead"; goal completion at 100% (celebration screen, correct stats, "Continue Saving" vs. reload persistence, no repeat celebration once acknowledged); habit Edit (correctly pre-fills existing values) and the private-name display; and a regression pass across Home, Career Skills, Habits & Discipline, and Plan My Day, confirming nothing else was touched. Zero console errors throughout.

## 2026-09-17 — Plan My Day rebuilt as a guided 10-question wizard, no hard-coded examples

Replaced last turn's single-page activity form with the full 10-question guided flow: day start ("Starting now" supported) → day end → fixed activities (name/start/end, unlimited, examples shown only as input placeholders, never auto-added) → prep/travel-before/travel-after per fixed activity → flexible activities (name/duration) → up to 3 priorities plus one "don't want to miss" item, both selected only from the user's own entered activities → protected life/meal blocks (quick-add chips for Breakfast/Lunch/Dinner/etc. or custom) → breathing-room style (Very tight/Normal/Relaxed) → optional before/after ordering rules → optional freeform note, interpreted by a few explicit, literal pattern rules ("nothing after 9 PM" caps the day-end time; "tired" nudges buffer style toward Relaxed; "N hours free in the evening" reserves a protected block) — never AI, never guessed intent beyond those exact matches.

Engine extensions to support all of this: travel-after (return-trip) blocks in addition to the existing travel-before; personal/life blocks get first claim on free time (placed before ranked flexible items); a real priority ranking (must-not-miss > top-3 in order > declared high/medium/low); ordering rules enforced via a dependency-respecting multi-pass placement loop (an item with a "must come after X" rule is genuinely never placed before X, not just usually); buffer/breathing-room size now actually varies the gap length between placed items (5/15/30 min) instead of a fixed 10.

**Real bug found and fixed during testing**: `savePlanSettings()` was still writing to the old static key `nc_plan_settings` from before this rebuild, while `getPlanSettings()` (already updated) read from the new per-day key `nc_plan_settings_<date>` — so every wizard answer (priorities, order rules, buffer style, Sunnah toggles, day window) was silently being discarded and the engine was always running on defaults. Caught by testing the exact ordering-rule scenario end to end: set "Guitar practice before Lunch," rebuilt, and Lunch came out scheduled *before* Guitar practice — a clear sign the rule never reached the engine. Fixed by pointing both functions at the same key; re-tested the identical scenario and confirmed Guitar practice now correctly precedes Lunch, with the chosen "Relaxed" buffer (30-minute gaps) also now correctly applied — one key mismatch had silently broken most of the new wizard's actual effect on the schedule.

Also added: Next-Salah line and automatic NOW-tagging of the current timeline entry; a "running a little behind" prompt (Continue as planned / Adjust remaining day) shown when the current activity is >15 minutes past its start and still pending; Edit Plan / Rebuild Plan / Start a completely new plan options on the entry screen when a plan already exists today, matching Screen 1's spec.

**Scope note**: implemented reordering via explicit Remove/rebuild controls rather than literal touch drag-and-drop, which would be a much larger, more fragile piece of custom UI engineering in vanilla JS for materially the same user capability (change what's scheduled and rebuild). Flagging this rather than silently pretending drag gestures exist.

Tested: full 10-question flow end to end with a genuinely non-example activity ("Shift at work", "Guitar practice") to confirm nothing is hard-coded to College/Gym/Study; priorities/must-not-miss chips correctly populated only from user-entered activities; fixed activity stayed locked with correct prep/travel-before/travel-after blocks; order rule and buffer style verified broken-then-fixed as above; full regression across Home/Sunnah/Career Skills (still 20 lessons intact) — zero breakage; zero console errors on a fresh tab.

## 2026-09-17 — Real Plan My Day: a non-AI scheduling engine

Replaced the placeholder "Plan My Day" button (which just opened the unrelated Top-3-tasks Productivity screen — exactly the wrong, generic behavior the brief called out) with a real, self-contained day-scheduling feature. USER DECIDES → NURA ORGANIZES → USER FOLLOWS — no AI, no chat, no generated advice anywhere in this flow; it's a deterministic algorithm over user-entered data.

**Activity input**: name, category (Dunya or Deen, with the exact sub-categories listed in the brief, or custom), Fixed (start+end time) or Flexible (duration+priority), optional prep/travel minutes.

**Scheduling engine** (`computePlanSchedule`, pure function, no network/AI calls): locks all fixed activities plus real prayer times (reusing the existing Salah/Aladhan integration already built — never invents times), computes free gaps across the day, places flexible activities and any enabled Sunnah habits into those gaps (Sunnah habits get an anchor rule — e.g. Morning Adhkar placed in the first gap after Fajr — everything else placed by priority), detects and clearly reports overlaps between fixed commitments and/or prayer times without silently moving anything, and reports anything that couldn't fit rather than pretending it was scheduled.

**Today Timeline**: Start/Done/Skip/Delay/Edit per activity, not a single one-size-fits-all 25-minute timer — only Study-category activities get a Start-a-focus-session option, matching the brief's "only use a timer when it makes sense" rule.

**Adjust Remaining Day**: tapping Delay (or the dedicated button) re-runs the same scheduling function with a `now` lower bound, only replacing pending flexible activities after the current time — fixed activities and anything already completed stay exactly where they were.

**Progress**: a real percentage plus a Deen/Dunya split, computed from actual activity completion, not fabricated.

Tested the brief's exact acceptance scenario end to end: College (9–2) and Tuition (4–6) entered as fixed, Gym/Study/Lunch as flexible — the engine correctly kept both fixed blocks untouched and placed all three flexible activities into the real morning gap before College, with correctly labeled Free Time for the rest; confirmed zero AI/chat messaging anywhere in the flow; Done/Skip actions update status and the Deen/Dunya progress tiles correctly (verified 1/5 Dunya, 0/0 Deen with a Dunya-only test set); full plan (including completion state) confirmed surviving a page reload; full regression across Home/Sunnah — zero breakage; zero console errors on a fresh tab.

## 2026-09-17 — Fixed Dunya-opens-in-Home navigation bug; built real Career Skills lesson library

**Root cause of the navigation bug**: last turn, Dunya's Study/Phone/Sleep/Fitness cards were wired to literally call `setActiveView("home")` after setting up the picker state — a deliberate reuse of Home's already-built "Today's Priority" UI rather than duplicating it, but it meant those tools visibly opened Home's screen, breaking the expectation that Dunya tools stay inside Dunya.

**Fix**: rather than duplicating all the picker/timer/salah/sleep rendering logic a second time, the single shared `.priority-card` DOM element (with all its working logic untouched) now gets physically re-parented between two fixed anchor slots — `#priority-card-home-slot` inside Home, and a new `#priority-card-duniya-slot` inside a new `view-duniya-tool` screen — depending on which section the user entered from. `setActiveView()` does the re-parenting automatically whenever "home" or "duniya-tool" is shown. The new Duniya-tool screen has its own back button that returns to the Dunya hub, never to Home. Zero duplicated logic, zero risk of the two copies drifting out of sync, since it's the same node either way.

**Career Skills**: replaced the placeholder-only goal tracker with a real 4-category, 20-lesson library (Communication, Professional Skills, Job Skills, Learning Skills), each following the reusable LEARN → PRACTICE → DO → REFLECT template (why it matters, explanation, 3-5 practical steps, mini practice, today's challenge, Start Challenge → I Did It → mood → optional reflection, all saved with completion date). "How to Talk to People" got the full flagship treatment matching the brief's detailed example (Ask→Listen→Follow-up method, bad-vs-good interview-style comparison, body language checklist, F.O.R.D. method, real-life challenge). The prior simple "My Skill Goal" tracker was kept, not deleted — it now sits below the lesson library as a complementary option, since removing working functionality wasn't asked for.

Tested against every acceptance test in the brief: Fitness and Study confirmed staying inside `view-duniya-tool` (not Home); "How to Talk to People" opens with real content (why/explanation/5 steps/practice/challenge, not a placeholder); full challenge → completion → mood → reflection flow tested end to end and confirmed surviving a full page reload; back-button chain confirmed going Lesson → Career Skills → Dunya, never jumping to Home; full regression pass across Home/Sunnah/More (Hamdard link still intact) — zero breakage; zero console errors on a fresh tab. (Two apparent bugs during testing — an empty "why" field, chat-option count mismatches in earlier turns — turned out to be unscoped test queries matching same-named CSS classes elsewhere in the DOM, not real defects; confirmed correct once properly scoped.)

## 2026-09-17 — Vault's nav slot repurposed into Duniya (everyday self-improvement hub)

The owner's "Duniya Self-Improvement Section" prompt asked to replace the Vault tab with a new practical/everyday self-improvement hub, distinct from Sunnah's Deen (spiritual) content. This directly touches CLAUDE.md's "Exactly these five [nav items], always" rule and the real, tested, AES-GCM-encrypted Hamdard journal built earlier this session — a high-stakes, largely irreversible-if-wrong change, so it got extra care before any code was touched.

**Decision made without asking** (safe-default reasoning, not a guess): repurpose the nav slot, but never delete real encrypted user data on a guess. Relocated Hamdard's entry point to More (“Hamdard → Open Hamdard”) instead of removing it — the screen, its encryption, and any existing entries are completely untouched, just reached differently. Updated `CLAUDE.md` Section 3 to reflect this is now the authoritative nav (Home/Sunnah/AI Chat/Duniya/More), rather than letting the docs drift from what's actually live.

**Duniya hub**: Today (mirrors whatever priority is active from Home — one shared source of truth, not a duplicate tracker), Quick Actions (Focus Now / Phone-Free Session / Quick Workout / Better Sleep / Plan My Day / Reset My Day), and a 10-card Life Areas grid.

Four of the ten areas (Study & Focus, Phone Control, Sleep, Fitness) **reuse the exact picker flows already built into Home** over the last two turns — tapping the card archives any current priority honestly (logged, not deleted) and jumps straight into the same prep-checklist/duration/etc. flow already tested. No duplicate logic.

The other six are new, and deliberately scoped small per the prompt's own repeated instruction not to over-build each one:
- **Habits & Discipline** — create a habit, mark completed/missed/restarted per day. No streaks, explicitly no shame language.
- **Productivity** — top 3 tasks (editable, checkable), "Start One Task" (starts the first unfinished one as a 25-min ad-hoc focus session), a one-line end-of-day note.
- **Mental Wellbeing** — 5 states (stressed/overwhelmed/wasted day/can't focus/angry), each with a short practical grounding step and a link into the real AI Chat, with an explicit non-diagnostic disclaimer up top.
- **Career & Skills** — pick an area (or type your own) → one small goal → daily "mark today's action done" tracking.
- **Money Habits** — a daily Yes/No "avoided an unnecessary purchase" check plus a simple saving-goal note. Explicitly not a banking app.
- **Personal Growth** — pick a growth area, get one concrete daily exercise (e.g. Confidence → "start one conversation yourself today"), mark done. Practical exercise, not generic advice, matching the prompt's own bad/good example.

Tested: nav relabeled correctly everywhere: bottom nav, active-state highlighting (including on Duniya's sub-pages, which aren't separate nav items), Study routing confirmed jumping straight into Home's real prep checklist, Habits add + all 3 status buttons, Productivity's 3-task list, Career's 6 preset areas, Money's question, Growth's 7 areas, Wellbeing's 5 options — all matching the prompt's content exactly. Hamdard confirmed fully reachable and intact from More. Full regression pass across Sunnah/AI Chat/Home — zero breakage (one apparent "10 chat options" discrepancy during testing turned out to be an unscoped query matching both AI Chat's and Duniya Wellbeing's shared `.chat-option-btn` class, not a real duplication — confirmed correct when scoped to the visible view). Zero console errors on a fresh tab.

## 2026-09-17 — Practical Action + Real Data Fix: 7-day graph, Phone-Free sessions, Sleep tracking, honest checklists

The owner's "Practical Action + Real Data Fix" prompt flagged several perceived bugs and asked for two brand-new priority kinds (Phone Use, Better Sleep) plus a real 7-day graph. Investigated the two "bug" claims before touching anything:

- **"Day 4 is static/fake"** — re-tested `getJourneyDay()` fresh (grepped for every write to `nc_journey_start`: exactly one, guarded to only fire if unset). Backdated the stored start date by 4 real days and reloaded: correctly showed "DAY 5." The math was already correct; the report was very likely from checking it within a single day, where a stable number is the *correct* behavior, not a bug. No code change needed here — verified and left alone rather than "fixing" something that wasn't broken.
- **"The graph is decorative/fake"** — this one was real, but not in the way implied: there was no multi-day graph at all yet, only the single-value Today's Progress ring from two turns ago. Built the actual missing feature rather than patching something.

**7-day progress graph + Progress Details sheet.** Real data only, sourced from `nc_priority_log` (yesterday and earlier) and the live current-priority state (today, via the same `computeProgressPercent` the ring already used). Days with no priority chosen show "No activity," never a fabricated value. Verified with a genuinely empty account: shows "Complete your first action to start your progress graph," not fake bars. Tapping the graph opens a bottom sheet with today's completed/pending/overall breakdown and the real last-7-days list side by side.

**Phone Use → real "Phone-Free Session."** New `phone` priority kind: distraction picker (Instagram/Reels, YouTube, Gaming, Messaging, Browsing, General scrolling, Other) → Focus Mode step (honest "Open Focus / DND Settings" — opens nothing automatically, just tells the user where to go, since no web API can toggle system DND) → "close the app" confirmation → duration (10/15/30/45/60) → replacement activity (Study/Walk/Exercise/Read Quran/Read a book/Complete a task/Rest/Custom) → reuses the existing timer as a live phone-free countdown. Tested end to end exactly matching the prompt's own 4-step example.

**Better Sleep → real bedtime + wake tracking.** New `sleep` priority kind, deliberately *not* a countdown timer (per the request — no fragile overnight countdown): pick a target bedtime → a 30-minutes-before-bed checklist (phone on charge, dim lights, wudu/wash, stop scrolling, prepare room, set alarm) → "I'M GOING TO SLEEP" saves a timestamp only. Next time Home opens, if unresolved, shows "Good Morning — Are you awake?" → "I'M AWAKE" saves the wake timestamp and computes `wake - sleepStart`. Tested with a backdated 7h55m gap: displayed exactly "7h 55m / 8h target," matching the prompt's own worked example verbatim, always labeled "Estimated sleep duration" / "Sleep window" with an explicit disclaimer that NURA cannot confirm the person was actually asleep the whole time (no wearable/sensor data exists) — never claims certainty. Verified the timestamp survives a full page reload (persistence, since it's just localStorage — same guarantee as everything else in this app).

**Study Focus prep restructured.** Removed the modal-on-Start-click approach from two turns ago (now redundant) in favor of a proper checklist step *during selection*, before the duration picker — matching the prompt's exact flow order: prep checklist → duration → timer. Checkboxes are non-blocking reminders, never gate the Continue button.

**Today's Progress connection.** The ring, the graph, and the details sheet all read from the same underlying state (`nc_priority_current`, `nc_priority_log`, `nc_salah_completions`) — completing any action updates all three immediately, verified live (ring jumped 0→100%, today's graph bar filled, details sheet reflected it, all without a reload).

Tested: full regression across Sunnah/Quran/AI Chat/Vault/More — zero breakage; zero console errors on a fresh tab; every acceptance test from the prompt's own list exercised directly (empty-state graph, live update on completion, tap-to-open details, Study prep checklist, Phone Use step-by-step intervention, Sleep timestamp persistence across reload, wake-time duration math).

## 2026-09-17 — Home Screen Implementation Update: functional progress ring, Study/Salah/Fitness made real

The owner's follow-up prompt assumed a "3 permanent priority cards" Home layout that doesn't match what's actually built (single priority at a time, chosen from 6 presets). Confirmed with the owner before building: **keep the single-priority picker**, and give Study Focus / Salah Consistency / Fitness Basics this full rich behavior specifically when one of those three is the active priority, rather than restructuring Home around 3 always-visible cards.

**Today's Progress ring** — replaced the plain text-only progress line with a real circular SVG ring (`stroke-dasharray`/`stroke-dashoffset`), functional not decorative: 0% not started, live-updating percentage (elapsed/total) while a timed session runs, jumps to 100% on completion. For Salah specifically, the ring reflects prayers-marked-complete / 5 today (tested: marking 1 of 5 shows exactly 20%). Entirely independent of the Change Journey Day counter, as required.

**Shield prompt removed from Home** — deleted the "Need a pause? Open Shield" button and its now-dead JS listener. Verified Shield itself stays reachable (AI Chat's "I'm getting an urge" → "Open Shield now" button still exists) before removing the only other entry point.

**Study Focus** — no more fixed 25 minutes. Picking the preset now opens a duration step (15/25/30/45/60/Custom) before creating today's priority; the card then shows the chosen duration in its title (e.g. "Study Focus — 45 minutes") and the timer starts at that length. Tested end-to-end with a real 45-minute selection.

**Focus Preparation modal** — shows once per Study Focus session, before the timer actually starts: "Ready to focus?" with Continue / Open Settings. Implemented Open Settings honestly rather than faking a working deep link — no web API can reliably jump to a phone's Do Not Disturb settings across browsers/platforms, so it shows clear instructions instead ("Open your phone's Settings app → Sound / Focus → turn on Do Not Disturb"). Continue always proceeds; nothing is blocked if DND isn't enabled.

**Salah Consistency — real Next Salah system.** Prayer times come from Aladhan (api.aladhan.com), a free, keyless, widely-used API — same pattern already used for Quran translations/ruku data: no hard-coded city, no secret keys in client code. First use asks "NURA uses your location only to calculate local prayer times," with Allow Location (browser geolocation) or manual city/country + calculation-method entry (6 common methods offered) as a fallback if permission is denied. Verified live against real coordinates (Delhi): correctly identified Asr as the next prayer with an accurate live countdown (updates every second, tested a real ~40 second countdown) and "Mark Dhuhr Complete" for the prayer whose window is currently open — exactly matching the spec's own worked example. Tapping Mark Complete updates a 5-prayer day strip immediately. Times re-fetch (and re-cache) per local calendar day and per location signature, never hard-coded to one place.

**Fitness Basics — user-controlled.** Picking the preset now asks "What are you training today?" (9 body-part options including Stretching) then "How much time do you have?" Each body part has its own original, beginner-friendly warm-up and workout list (verified Chest and generic body parts show genuinely different content — not a copy-pasted routine) with a skip option on the warm-up. The shared timer only appears once warm-up is done or skipped.

**Progress ring / Today's Progress persistence** — backed by the same `nc_priority_current`/`nc_salah_completions` localStorage records already used elsewhere in Home, so it survives navigating away and correctly resets at local-day boundaries (a new day means a new priority pick, and salah completions are stored per calendar date).

Tested: full regression pass across Sunnah/Quran/AI Chat/Vault/More — zero breakage; zero console errors confirmed on a fresh tab.

## 2026-09-17 — Home Screen + Self-Improvement Master Update: light green/gold theme, single "Today's Priority", Change Journey Day

The owner sent a full "Home Screen + Self-Improvement Master Update" prompt describing a different, more curated Home experience than what was built the previous turn. Two real conflicts were flagged and resolved with the owner before building: (1) the new light/white/deep-green/gold visual identity vs. the app's existing dark midnight/mint theme — owner chose **whole app**, not just Home; (2) the new single "Today's Priority" vs. the 2-action CHOOSE/DO/TRACK/RESET system built last turn — owner chose **replace**, not layer on top.

**Theme (app-wide):** Re-themed via the existing CSS custom-property tokens rather than renaming them everywhere (`--mint`/`--mint-soft` now hold deep green values, e.g. `#1B5E3F`; new `--gold`/`--gold-soft` tokens added for the sparing accent use the spec calls for — journey badge, subtle SVG illustration). New light values: `--bg #F8F6F1`, `--surface #FFFFFF`, `--surface-2 #F1EEE6`, `--border #E4E0D4`, `--text #1F2620`, `--muted #6B7568`, `--danger #C0392B` (darkened for contrast on white). Found and fixed every hardcoded non-variable color in the stylesheet (6x `color: #06251A` dark-on-mint text → new `--on-accent: #FFFFFF`, since mint is now dark itself; several hardcoded `rgba(52,211,153,...)` referencing the old mint RGB directly, updated to match the new green; the amber status-tag color, which was too low-contrast on white). This was a deliberate small-diff approach — reusing existing variable plumbing across every screen (Sunnah, Vault, Hadith, Quran, Chat, More) rather than a global rewrite, per the prompt's own "smallest safe update" instruction.

**Home rebuild**, following the prompt's exact hierarchy: greeting → one motivational line (deterministic per day, not re-randomized every render) → Change Journey Day badge → a small original abstract SVG (a path rising toward a small sun/light motif — not a background, not a stock illustration) → Today's Priority → Today progress line → Shield shortcut.

**Change Journey Day**: `nc_journey_start` is set once, ever, and never rewritten. Day number = calendar days elapsed (local date) + 1. Explicitly NOT a streak — verified a 3-day gap correctly jumps straight to "Day 4" (never re-showing "Day 3"), matching the prompt's own worked example exactly.

**Today's Priority** replaces the multi-action system: one active priority at a time, from 6 preset plans (Study Focus, Better Sleep, Reduce Phone Use, Salah Consistency, Fitness Basics, Morning Routine) or a custom goal, each with a "Why this?" line and a specific action. Reuses the existing, already-tested focus timer rather than rebuilding it. Honest-completion check (unchanged mechanism) marks the priority "completed" — shown as "Completed today ✓" for the rest of the day, with a "Choose a different priority" escape hatch if the user wants a new one same-day.

**Accountability**: if a priority is still "pending" on a later calendar day, Home shows "Yesterday you planned: '<title>'. What happened?" with Completed / Partly / Not yet. Partly auto-generates a new priority at **half** the original minutes (verified: 30 min → 15 min, matching the prompt's own example exactly); Not yet at ~70% of the original, framed non-punitively; both are logged to `nc_priority_log` (history never deleted) before the adjusted one is created. No reset-mode, no streaks, no guilt language anywhere in this flow, per the prompt's explicit "No Reset Mode" section.

**Removed** (superseded by this rebuild, not from last turn's spec but conflicting with this one's explicit anti-clutter hierarchy): the 2-action list UI, the 3-question nightly reflection modal, and the weekly review card. Their old data (`nc_actions`, `nc_reflections`) is simply no longer read — nothing was deleted from existing users' storage.

**Bug found and fixed during testing**: Bhai AI's "Start Now" action button called `setActiveView("home")` (which renders immediately) *before* `startAdhocFocus()` set the ad-hoc session label — so the just-started timer was invisible until the next re-render. Fixed by reordering: set ad-hoc state first, then navigate.

Tested: full CHOOSE→DO→TRACK→RESET→REVIEW→REPEAT loop end-to-end including a genuine 60-second real-time timer completion (not simulated) confirming the honest-check modal populates correctly from the real code path; accountability check-in with the exact 30→15 min adjustment; "Choose a different priority" logging correctly as "not-yet"; journey-day gap math; Bhai AI quick-start bug found and fixed; full visual + functional regression across Sunnah/Vault/AI Chat/More under the new theme; zero real console errors (confirmed via a fresh tab, after ruling out a stale cached error in a long-lived test tab).

## 2026-09-17 — Practical self-improvement loop built into Home: CHOOSE → DO → TRACK → REVIEW → RESET → REPEAT

Rebuilt Home's Tasks + Focus Timer into a real daily-action loop, replacing the old unlimited to-do list. Scope decision: built the smallest complete version of the *entire* loop first (per CLAUDE.md Section 15's Golden Rule and the request itself: "build the simplest working version first... only then expand"), rather than polishing one piece. Deliberately left out: weekly graphs/charts (request explicitly said avoid these), points/badges/streaks (against CLAUDE.md Section 2/4 — no guilt-heavy streaks, no guessed stats), and a broader Bhai AI rebuild beyond adding action buttons to its existing scripted responses (Bhai is still labeled "scripted guided support, not a live AI model" — unchanged, honest).

**CHOOSE** — "Today's Actions" card, hard-capped at 2 (`todaysMainActions().length >= 2` blocks a 3rd, input row hides, a plain note explains why). Replaces the old unlimited task list entirely — a capped, deliberate choice mattered more than keeping an open-ended list, per "don't add extra features just because they sound impressive."

**DO** — every action gets a real "Start Now" button, not just a plan. It reuses the existing (already-tested) Focus Timer: if the action's title has a parsed "N min(utes)" in it, the timer duration is set to that number automatically; otherwise it uses whatever duration is already set. Clicking it jumps straight into a running countdown, scrolled into view.

**TRACK** — status is one of `pending / done / partial / skipped` (not a boolean). The existing honest-completion modal ("did you actually finish, or just the timer?") now maps "No, still working on it" to `partial` instead of leaving it ambiguous.

**RESET** — a "Reset → smaller step" button appears on any `partial`/`skipped` action with no existing recovery child. It parses a "N min" from the title and creates a nested recovery action at a flat 5 minutes (matching the request's own example: "Couldn't study for 30 minutes? Do 5 minutes now" — tested and confirmed this exact output). No minutes in the title → generic "A small part of it, right now: <title>" fallback (for things like "Pray the next Salah on time"). Only one recovery step per action — not an infinite chain. Original skipped/partial status is never overwritten or deleted; the recovery is a new, separate record, so history stays honest (per CLAUDE.md Section 3: "must never erase missed work or pretend a tap completed it").

**REVIEW (daily)** — a "Reflect on today" card appears once at least one action exists for today. Exactly the 3 questions asked, nothing more: what you completed, what stopped you, what you'll change tomorrow. Stored per date in `nc_reflections`, editable same-day.

**REVIEW (weekly) / REPEAT** — a "This Week" card aggregates the last 7 days' main actions: one factual completion-count sentence, plus one deterministic (not invented/AI-guessed) suggestion — either "X was missed N times this week, use Reset sooner" if a title repeats as skipped/partial 2+ times, or a completion-rate nudge, or plain encouragement. No charts, no points — text only, per the request and CLAUDE.md's "never a guessed... stat" rule.

**Bhai AI tie-in** — the two chat responses that already told the user to "start a focus session" now end with a real button ("Start a 20-minute study session" etc.) instead of just a sentence. Tapping it jumps to Home, creates the action if a slot is free (else starts an untracked ad-hoc session so it's never blocked by the 2-action cap), and starts the timer immediately.

Data model: new `nc_actions` (replaces `nc_tasks` entirely — verified zero remaining references anywhere in the codebase) and `nc_reflections`.

Tested end-to-end: add 2 actions, 3rd blocked with correct UI state; Start Now sets duration from parsed minutes and links correctly; Done/Partial/Skip all update state and badge correctly; Reset produces the exact "N min → 5 min" recovery the request specified; honest-check "No" correctly marks partial; reflection modal saves/reloads/persists correctly; weekly review computes and displays correctly with real data; Bhai AI action button navigates + creates + starts a session in one tap; full regression pass across Sunnah/Vault/More — zero breakage; zero console errors.

## 2026-09-17 — Tasbih counters now only appear where the real repeat count is 32+

New rule going forward: a tasbih counter only belongs on a dhikr with a real, hadith-specified repeat count of 32 or more — not on every dhikr just because it has Arabic text. Removed the "free" tap counter from every single-recitation item it had been added to: Allahumma antas-salam, both Ayat al-Kursi citations (after-salah and before-sleep), morning dhikr, evening dhikr, the last two ayat of Al-Baqarah, and the Jumu'ah salawat item. Kept the two counters with a genuine 32+ count: the after-salah tasbih (33/33/33) and the before-sleep Fatimah tasbih (33/33/34) — those are unchanged.

Tested: exactly those two phase-mode counters remain across Routine, everything else shows citation with no counter, zero regressions, zero console errors.

## 2026-09-17 — Jumu'ah (Friday) added as its own Routine section

Read "jumman special thing" as Jumu'ah (Friday) — the app had no Friday-specific content at all, and Friday genuinely has a distinct set of sunnahs beyond a normal Dhuhr. Added a new "Jumu'ah (Friday)" section (id `jumuah`) between Dhuhr and Asr, with 7 actions, each hadith verified live on sunnah.com before being added:
- Take ghusl before Jumu'ah — Sahih al-Bukhari 877
- Go early to the masjid — Sahih al-Bukhari 881
- Recite Surah Al-Kahf — Mustadrak al-Hakim, graded Sahih in Sahih at-Targhib wa at-Tarhib 736 (also links straight to Surah 18 in the new full-Quran reader via `action.link.surah`, extending the existing link mechanism)
- Send extra salawat on the Prophet ﷺ — Sunan Abi Dawud 1047, graded Sahih (Al-Albani) — has a free tasbih counter
- Pray Jumu'ah (plain toggle, no citation needed)
- Stay silent during the khutbah — Sahih al-Bukhari 934
- Make dua in the hour of acceptance — Sahih al-Bukhari 935

Tested: section renders between Dhuhr/Asr with correct item count, all citations expand correctly, Al-Kahf link opens the Quran tab directly on Surah 18, salawat counter works, completion badge updates correctly, zero regressions across Akhlaq/Quran/Hadith, zero console errors. (Caught and fixed one self-introduced typo — a stray non-Arabic glyph where ﷺ should have been in one item's name — before shipping.)

## 2026-09-17 — Full Quran (114 surahs) with English + Urdu translation, and Witr's Dua Qunoot added

**Full Quran browsing.** The Quran tab was a single daily-verse proof of concept; it now also has a full surah list (searchable) → surah detail view with every ayah. Data sourcing, kept consistent with how the rest of this app sources Islamic content:
- **Arabic**: the same already-verified local Tanzil Uthmani text used everywhere else in the app (`assets/quran/quran-uthmani.txt`) — no new source, no network needed for Arabic.
- **Surah names/counts**: fetched once from the Quran Foundation's chapters API and saved as a small verified static file (`js/quran-meta.js`, 114 entries) — just bibliographic facts (names, ayah counts, Makki/Madani), not translated text.
- **English** (Saheeh International, resource 20) and **Urdu** (Maulana Muhammad Junagarhi, resource 54): fetched live per-surah from the same keyless Quran Foundation API (api.quran.com) already used and verified earlier for ruku numbers and the Al-Baqarah 285–286 translation. Deliberately **not bundled into the repo** — full translated text is a copyrighted literary work in its own right, so it's fetched fresh on demand each time a surah is opened (same intended use as any Quran app built on this public API) rather than stored/redistributed statically. Trade-off: reading the full Quran needs an internet connection; this is stated directly in the UI.

Junagarhi was picked as the Urdu translation because it's the same one used as the default Urdu translation on Quran.com itself — a reasonable, widely-recognized default rather than an arbitrary pick.

**Witr dua.** "Pray Witr" had no citation at all. Added the actual Dua al-Qunoot — verified by reading the live sunnah.com page directly (browser tool, since WebFetch to sunnah.com 403s): Jami' at-Tirmidhi 464, graded Sahih (Darussalam), narrated by Al-Hasan ibn Ali.

Tested: 114 surahs load, search filtering works, opening a small surah (Al-Ikhlas, 4 ayat) and a large one (Al-Baqarah, 286 ayat) both render Arabic + both translations correctly, footnote markup from the API is stripped cleanly, back button and re-navigation work, Witr dua displays with its counter and citation, zero regressions across Akhlaq/Hadith/Home, zero console errors.

## 2026-09-17 — "Read a portion of Qur'an" now links directly to the Quran tab

That Morning Adhkar item ("ma-quran") was a bare toggle with no way to actually go read anything. Added a generic `action.link = { subtab, label }` config (`buildSunnahItem` in `js/app.js`) that renders an "Open Quran" button next to it; tapping it switches Sunnah to the Quran subtab via a new shared `switchSunnahSubtab()` function (factored out of the existing subtab click handler, so both paths stay in sync) and scrolls it into view. Generic by design — any future Routine/Akhlaq item can link to any subtab the same way.

Tested: button switches to the Quran panel and back correctly, normal subtab bar clicks still work unaffected, no console errors.

## 2026-09-17 — Real tap-to-count tasbih counter added under every dhikr item

Added a reusable tasbih counter component (`buildTasbihCounter` in `js/app.js`, new `.tasbih-counter` styles in `css/style.css`) that renders directly under any Routine dhikr entry that has a `tasbih` config. Two modes:
- **Phases** — for dhikr with a real fixed repeat count (e.g. SubhanAllah/Alhamdulillah/Allahu Akbar x33 after salah, and the Fatimah tasbih 33/33/34 before sleep). Tapping the circle advances the count with a filling progress ring; on hitting the target it auto-advances to the next phrase, and shows "✓ Completed" with a "Start again" option once all phases are done.
- **Free** — for dhikr recited once but which people often repeat personally (Allahumma antas-salam, Ayat al-Kursi, morning/evening dhikr, the last two ayat of Al-Baqarah). Just taps up with a reset link, no fixed target.

Also gave "Tasbih before sleep" (previously just a bare toggle with no content) its actual citation: Sahih al-Bukhari 5362, narrated by Ali ibn Abi Talib — the Prophet ﷺ taught Fatimah to say SubhanAllah 33x, Alhamdulillah 33x, Allahu Akbar 34x before sleeping instead of asking for a servant. Verified the exact Arabic, translation, and count split by reading the live sunnah.com page directly (WebFetch to sunnah.com is blocked/403, so used the in-app browser tool instead) rather than trusting a search snippet.

Storage: `nc_tasbih_counts` in localStorage, keyed by `<actionId>-<entryIndex>` so the same shared `AFTER_SALAH_DHIKR_ITEMS` array used by all 5 prayers gets an independent counter per prayer (Fajr's tally doesn't affect Dhuhr's). Counters reset automatically each new day, same pattern as the rest of the daily logs. Added `navigator.vibrate()` on tap (feature-detected, wrapped in try/catch, silently no-ops where unsupported) as a small "real counter" touch.

Tested: full 33/33/33 and 33/33/34 phase-advance and completion flow, reset, reload persistence, per-prayer key isolation (Fajr vs Dhuhr independent), freeform mode, zero regressions across Akhlaq/Home/Hadith/Duas, zero real console errors (only a benign "vibrate blocked" warning from synthetic test clicks lacking a real user gesture — not present on actual taps).

## 2026-09-16 — Ruku badge moved onto the Arabic text itself

Follow-up to the ruku feature: the ruku number was initially only mentioned inside the English "meaning" caption below the Arabic, which wasn't prominent enough. Moved it to its own small badge ("Ruku N") directly above the Arabic block, right-aligned to match the RTL flow — same visual treatment across all three Ayat al-Kursi instances (Ruku 35) and Al-Baqarah 285–286 (Ruku 41). The daily Quran verse already showed ruku next to its Surah:Ayah reference directly above the Arabic, so that one was already correct.

Tested: badge renders correctly positioned for all citations, reload persistence, no regressions, zero console errors.

## 2026-09-16 — Ruku numbers added to every ayah shown in the app

Ruku (ركوع) is the standard 558-section division marked in the margin of virtually every printed Mushaf. Built a verified boundary table (new `js/ruku-data.js`, 558 [surah, ayah] entries) by fetching `ruku_number` per verse from Quran Foundation's API for all 114 chapters and extracting exactly where each ruku begins — not estimated or invented. Sanity-checked: exactly 558 boundaries came out (the correct standard count), 1:1 → ruku 1, 114:6 → ruku 558, and several mid-Quran spot checks landed exactly where expected.

Wired into every place an ayah reference is shown: the daily Quran verse (now shows "Surah X:Y · Ruku N"), all three Ayat al-Kursi citations (Before Sleep, Morning Adhkar, after-salah dhikr — all pointing at the same shared data, one source of truth), and the Al-Baqarah 285–286 citation.

Tested: daily verse shows correct ruku (Surah 7:36 → Ruku 125, checked against the boundary table by hand — correctly falls between ruku 125's start at 7:32 and ruku 126's start at 7:40), all three Ayat al-Kursi instances consistently show Ruku 35, Al-Baqarah 285–286 shows Ruku 41, everything persists across a real reload, no regressions, zero console errors.

## 2026-09-16 — First real Quran translation added (Al-Baqarah 2:285–286)

The "last two verses of Al-Baqarah" item now shows an actual English translation alongside the Arabic, not a placeholder. Pulled directly from Quran Foundation's public API (api.quran.com, no key needed, confirmed CORS-open, confirmed same 6,236-verse count as Tanzil) — Saheeh International translation, a widely used and respected English rendering. Fetched via curl and hardcoded into this one item (not yet a live API integration for the whole app); clearly attributed to both the Arabic source (Tanzil) and the translation source (Saheeh International / api.quran.com) separately, so it's clear which part comes from where.

This is the first real translation anywhere in the app — the Ayat al-Kursi items (Before Sleep, Morning/Evening Adhkar, after-salah dhikr) still say "translation not yet added" and are natural next candidates using the same process.

Tested: translation displays correctly under the Arabic and transliteration, correct attribution shown, no regressions to any other Sunnah tab or nav destination, zero console errors.

## 2026-09-16 — Source and hadith added to "Recite the last two verses of Al-Baqarah" (Before Sleep)

Added an expandable "Source" panel to this Routine item, same pattern as the other dhikr items: (1) the hadith on its virtue — "Whoever recites the last two verses of Surat al-Baqarah on a night, they will be sufficient for him" (Sahih al-Bukhari 5009, Sahih Muslim 807, narrated by Abu Mas'ud), and (2) the actual verse text, Al-Baqarah 2:285–286, pulled directly from the already-verified Tanzil file (not re-typed) since the item is specifically about reciting them.

Tested: expands correctly showing both the hadith and the verse text with correct sources, checkbox still works independently, no regressions elsewhere, zero console errors.

## 2026-09-16 — Customizable focus timer duration

Home's focus timer was fixed at 20 minutes. Added a duration picker (chips for 5/10/15/20/25/30/45/60 min, plus a custom number input for 1-180 min) shown above the clock. Choice persists (`nc_focus_duration`) and is used for every future session until changed. Locked (chips and custom input disabled, with a toast if someone tries anyway) while a session is running or paused, to avoid corrupting an in-progress timer — only changeable when the timer is at Ready/full duration.

Tested: default 20 min correct on first load, preset selection updates clock/button/storage together, custom input works and correctly shows no preset as falsely active, both are disabled mid-session and stay at the chosen duration through pause/resume/stop, the chosen duration persists across a real reload, no regressions to any other screen, zero console errors.

## 2026-09-16 — Hadith & Quiz: continuous "Next lesson" flow + 4 more lessons (8 total)

Per feedback: after answering a quiz, a "Next lesson →" button now appears below the feedback so lessons chain together instead of requiring Back → pick next item each time. On the last lesson it shows "Back to lessons" instead of looping or dead-ending.

Added 4 more verified lessons: "Wanting for Others What You Want for Yourself" (Bukhari 13, Muslim 45), "Small and Steady Beats Big and Occasional" (Bukhari 6464), "Gentleness Is Not Optional" (Sahih Muslim 2592), "What Real Richness Is" (Bukhari 6446, Muslim 1051) — 8 lessons total now, each independently verified, none overlapping with hadith already used in Akhlaq/Duas citations.

Tested: full chain-through of all 8 lessons via Next, correct/wrong answers both handled properly (confirmed by testing a case where the same click sequence produced one wrong answer — no coins awarded for that lesson, checkmark still shown as completed), "Back to lessons" on the last one returns to the list, checkmarks and coin total (70, matching 7 correct × 10) persist across a real reload, no regressions, zero console errors.

## 2026-09-16 — Hadith & Quiz expanded to 4 lessons

Converted the single hardcoded hadith into a browsable list (Sunnah → Hadith now shows a list of lessons, tap one for the full lesson + quiz, back button returns to the list; completed lessons show a checkmark). Added 3 new lessons, each verified before use: "The Believer's Affair Is All Good" (Sahih Muslim 2999 — gratitude in ease, patience in hardship), "The Company You Keep" (Bukhari 2101/5534, Muslim 2628 — the musk-seller/blacksmith comparison), "Faith Includes the Small Things" (Sahih Muslim 35 — faith's branches, from the declaration of belief down to clearing harm off a road).

Tested: all 4 lessons list and open correctly, each shows correct Arabic/text/explanation/quiz, answering awards coins once only (re-clicking an answered quiz does not re-award — confirmed directly), back navigation works, completed-lesson checkmarks and coin total both persist across a real reload, no regressions to Routine/Akhlaq/Duas/Quran/Vault/Home, zero console errors.

## 2026-09-16 — Daily-life dua batch (8 new, verified)

Md Afzal asked for "24 hours life duas" / "a2z duas" — a full Hisnul Muslim-style compilation (~268 duas). Flagged honestly that verifying every one properly (the same process used throughout) isn't realistic in one pass, and did a solid batch of the most common daily situations instead: entering/leaving the bathroom (Bukhari 142/Muslim 375; Abu Dawud 30), wearing new clothes (Abu Dawud/Tirmidhi, hasan), entering home (Abu Dawud 5096), calming anger (Bukhari/Muslim, agreed upon), the sneezing exchange (sneezer/listener/reply, Sahih al-Bukhari), seeing something pleasing (Ibn Majah, Hisn al-Muslim 218), and a second Stress/Anxiety entry for general distress (Bukhari/Muslim, narrated by Ibn ‘Abbas). Daily Life category went from 1 dua to 8; Stress/Anxiety from 1 to 2.

This is still not the full ~268-dua compilation — more can be added the same way (bathroom-adjacent etiquette, weather duas, illness/visiting the sick, marketplace, marriage, etc.) whenever wanted. Tested: all 8 render and expand correctly in the Daily Life category, sneezing's 3-part exchange displays correctly, everything persists across reload, no regressions, zero console errors.

## 2026-09-16 — All remaining Duas categories filled

The 6 categories that were "structure ready, pending verified content" now each have a real, cited dua: Morning (Asbahna..., Sahih Muslim 2723 — same content already used in Routine's Morning Adhkar, cross-referenced not duplicated effort), Evening (Amsayna..., same hadith), Salah (dua after hearing the adhan, Sahih al-Bukhari 614), Protection (seeking refuge in Allah's perfect words, Sahih Muslim 2708a), Travel (the setting-out dua, Sahih Muslim 1342, itself echoing Qur'an 43:13-14), Daily Life (leaving home, Sunan Abi Dawud 5095 / Tirmidhi 3426, graded hasan by at-Tirmidhi — noted as such). All 11 Duas categories now show real content; none read "Pending" anymore.

Tested: category grid shows correct counts for all 11, each new category's detail view renders Arabic/transliteration/meaning/source correctly, search finds the new content, everything persists across a real reload, no regressions to Routine/Akhlaq/Quran/Hadith/Vault/AI Chat/Home, zero console errors.

## 2026-09-16 — Hadith citations added to Akhlaq, plus 3 new self-improvement items

Same expandable "Source" pattern as the Routine dhikr work: all 8 existing Akhlaq items now have a real citation (Arabic, transliteration, meaning, hadith reference) instead of being a bare label. Added 3 new items for self-improvement, each also cited: "Seek a little knowledge today" and "Help someone today" (both from the same hadith, Sahih Muslim 2699a — noted honestly as the same source rather than presented as two separate ahadith), "Aim for good character, not just correct actions" (Bukhari 3559), "Make sure your neighbor is safe from your harm" (Sahih Muslim 46). 11 items total now.

Citations verified via web search against sunnah.com/named hadith numbers before use: Bukhari 6136/6475 & Muslim 47 (speak good or silent), Bukhari 6540 & Muslim 1016 (charity even half a date), Muslim 2699a (helping others / seeking knowledge), Bukhari 6114 & Muslim 2609 (anger), Tirmidhi 1956 (smiling is charity, graded hasan gharib by at-Tirmidhi — noted as such, not claimed sahih), Abu Dawud 4811 (gratitude), Bukhari 6474 (guarding the tongue), Abu Dawud 2149 (lowering the gaze — cited without an authenticity-grading claim, since one wasn't independently confirmed), Bukhari 3559 (character), Muslim 46 (neighbor's safety).

Tested: all 11 render, citations expand/collapse correctly with real content, checkbox works independently of expand state, state and completion persist across a real reload, no regressions to Routine/Duas/Quran/Hadith/Vault/Home, zero console errors.

## 2026-09-16 — Hadith citations added to after-salah, morning, and evening dhikr in Routine

Enriched Routine items with real, cited dhikr content (expandable "Source" panel under each item, Arabic + transliteration + meaning + citation) rather than just a bare label:
- "Dhikr after salah" added to all 5 prayer sections (Fajr, Dhuhr, Asr, Maghrib, Isha) — a 3-part set: "Allahumma antas-salam..." (Sahih Muslim 592), the 33/33/33 tasbih + completion phrase (Sahih Muslim 597a), and reciting Ayat al-Kursi after each prayer (An-Nasa'i, Al-Kubra 9848, graded sahih by An-Nasa'i and Ibn Hibban).
- Morning Adhkar's "Morning dhikr" enriched with "Asbahna wa asbahal mulku lillah..." (Sahih Muslim 2723); Evening Adhkar's "Evening dhikr" with its "Amsayna..." counterpart (same hadith, evening wording — not a separately-verified citation, noted honestly as such rather than invented).
- Ayat al-Kursi items (Before Sleep, Morning Adhkar, Evening Adhkar, and inside the after-salah set) use the verse text pulled directly from the already-verified Tanzil file (2:255), not re-typed from memory. No translation of the full verse is included yet — same known gap as the Quran module generally.

All content cross-checked via web search against named hadith numbers before use, same process as the earlier Duas/Hadith verification. Tested: expand/collapse per item, checkbox still works independently of the expand state, state persists across re-render and a real page reload, all 5 prayer sections show the new item, no regressions to Akhlaq/Duas/Quran/Hadith/Home, zero console errors.

Not yet done (next, per the user's own ordering): hadith under each Akhlaq item + more self-improvement items; remaining Duas categories; more Hadith & Quiz lessons; fuller Quran section.

## 2026-09-15 — Vault module built (real encryption)

Full feature: 4 sections (Hamdard/Private Reflection, Trigger & Struggle Notes, Career Audit, My Personal Code/Principles), create/open/edit/delete entries, search across decrypted entries, entry previews with date/time, proper empty states, working back navigation, lock/unlock, change passphrase, clear vault, forgot-passphrase (erase-and-restart, since recovery is genuinely impossible by design).

Encryption is real, not simulated: AES-GCM 256 via the browser's native Web Crypto SubtleCrypto API, key derived from the passphrase with PBKDF2 (150,000 iterations, SHA-256). The passphrase is never stored; the derived key lives only in memory for the unlocked session and is gone on lock or reload — verified directly (confirmed Vault re-locks itself on every page reload and correctly rejects a wrong passphrase). Verified entries are genuinely encrypted at rest by inspecting raw localStorage content directly (no plaintext present). Vault settings screen states plainly this has not been independently security-audited — no "military-grade" or "100% secure" language anywhere.

Two real bugs were found during testing and fixed before shipping:
1. Changing the passphrase re-encrypted entries as brand-new records instead of replacing the originals, leaving the old entries (still encrypted under the old key) orphaned in storage.
2. That orphaned data then caused the *next* unlock attempt to fail and misreport "Incorrect passphrase" even when the passphrase was correct, because one entry's decryption failure was short-circuiting the whole unlock. Fixed by isolating the passphrase-check failure from individual entry-decrypt failures, and by clearing old ciphertext (sequentially, not in parallel, to avoid a read-modify-write race) before re-encrypting under the new key.

Tested end-to-end: setup, wrong-passphrase rejection, correct unlock, create/edit/delete entries, decrypted data survives a real page reload requiring the passphrase again, search, change-passphrase (old passphrase correctly stops working, new one correctly works, data intact, no duplication), forgot-passphrase erase flow, and no regressions to Home/Sunnah/Duas/AI Chat/More.

## 2026-09-15 — Duas module built (Sunnah → Duas)

Full feature: 11 categories, search, favorites (persisted), category → list → detail navigation, large-Arabic detail view, copy/share. Content: 6 duas verified against named citations before use (cross-checked via search against sunnah.com/standard hadith numbering, not generated from memory) — Sayyidul Istighfar (Bukhari 6306), anxiety/sorrow dua (Bukhari 6369), waking-up and before-sleep duas (Hisnul Muslim), before/after eating (Abu Dawud/Tirmidhi). Remaining 7 categories (Morning, Evening, Salah, Protection, Travel, Daily Life) intentionally left empty with an honest "pending verified content" state — structure is ready, content was not rushed. Tested: category grid, list, detail, Arabic rendering, favorite toggle + persistence, search (text and favorites-only), copy button (no crash; real clipboard write untestable headless but error-handled), no regressions to Home/Sunnah other tabs/More.

## 2026-09-15 — Project started: independent Claude build, separate from Codex's NURA

Md Afzal gave a full master prompt establishing this as an independent build of NURA, separate from an existing, more advanced Codex-built version (elsewhere on this machine, not read or copied from). Full original prompt text preserved below verbatim for exact wording (CLAUDE.md summarizes it but defers to this on any conflict).

First build scope agreed: nav shell (Home/Sunnah/AI Chat/Vault/More), Home task list + focus timer with honest completion check, Sunnah routine sections + one Hadith lesson/quiz, AI Chat and Vault as clearly-labeled prototype placeholders, Shield as a manual in-app pause demo only.

Hadith sourcing decision: no reviewer is named and no hadith database exists in this project, so rather than invent or guess at less-common hadith, the first lesson uses exactly one hadith so universally known that misquoting risk is effectively zero — "Actions are judged by intentions" (Sahih al-Bukhari 1 / Sahih Muslim 1907), standard published translation, clearly sourced. Expanding the hadith library beyond this stays blocked on naming a reviewer, same open question as the sibling `nura-app` project.

---

### Full original master prompt (verbatim, as given 2026-09-15)

> NURA — Claude Code master prompt
>
> Copy everything below into Claude Code. This is the owner's product brief, not a claim that the requested features are already implemented.
>
> ---
>
> You are building YOUR OWN INDEPENDENT VERSION of NURA for me. Act as a practical product developer and an honest thinking partner. Explain things in simple English. Do not promise perfection or spend hours pursuing an unproven dependency without showing me the blocker.
>
> ## 1. Two separate builds — important
>
> Codex is continuing one NURA app. You, Claude Code, must build a separate NURA app from the same product vision. These are independent versions, not two agents working on one repository.
>
> - Use a new folder, repository, deployment and app-data namespace, such as `nura-claude` and `nura-claude-v1-*`.
> - Do not edit, replace, connect to, deploy over or automatically merge the Codex version. Do not use its hosting credentials or project identity.
> - Do not assume you can read Codex's conversation, files, tools or current app. Use this prompt and whatever I explicitly provide. If I provide reference code, copy it into your own project before modifying it; do not alter the original.
> - Do not set up shared databases, automatic synchronization or communication between the two builds. I may compare them later. Integration requires a later explicit request.
> - You may improve the implementation and design, but do not silently remove confirmed product requirements. Separate "first release" from "planned later."
>
> ## 2. The product
>
> Name: **NURA**. Tagline: **Your Daily Companion & Habit Space.**
>
> NURA is a **Deen + Dunya daily companion** for young Muslims. Islam is its foundation, but it must not become only a Quran, Salah or religious-content library. The user has one connected life: faith, studies, work, health, habits, family, emotions and purpose affect each other.
>
> The audience is mainly Gen Z, both boys and girls. Initial testing is in India, with a worldwide Muslim audience as the longer-term vision. Do not assume everyone has an expensive phone, fast internet or the same religious practice. The app interface must be in English; authentic Arabic religious text can appear with English meaning and optional transliteration.
>
> Support areas include prayer and connection with Allah, unwanted pornography use and masturbation, smoking/vaping, excessive phone/social-media use, gaming, procrastination, studying, career, sleep, fitness, eating habits, anger, stress, confidence, discipline, loneliness, relationships, time management and lack of purpose. These are connected goals, not an instruction to claim the app can medically treat every problem.
>
> ## 3. How NURA helps
>
> Use this pattern: **understand what happened → offer a realistic next action → give relevant Islamic support when useful → help the user act → follow up with permission.** Do not force a religious lecture into every response.
>
> Example: "I wasted my day." Ask what still matters today, help choose one task, start a 20-minute focus session, and ask afterwards whether it was actually completed. Do not mark work done merely because a timer ended.
>
> Example: "I feel like smoking." Offer a short delay, changing location and an alternative action; let the person record the trigger and check whether the urge changed. Explain when professional cessation support would help. Do not pretend a breathing timer is a complete cessation programme.
>
> Example: "I am getting an urge to watch pornography." Offer immediate practical choices such as putting down the phone, leaving the triggering situation, starting the optional pause, opening a chosen goal or contacting a trusted support person. Do not shame or diagnose the person. Never claim NURA secretly knows what they watched.
>
> Be calm, respectful, direct and useful. No guilt machine, fake "truth score," humiliation, invented diagnosis, religious threats or emotional dependency on the AI. Support users' chosen values without making unsupported claims about sexual health. Do not label every sexual feeling or behaviour an addiction. Provide age-appropriate safeguards and routes to qualified help when needed.
>
> ## 4. Navigation and design
>
> Use five main navigation destinations: **Home / Sunnah / AI Chat / Vault / More.**
>
> - Profile must be easy to find through a header avatar and/or More.
> - Do not restore the rejected Home/Habits/large-plus/Bhai/Profile navigation.
> - Do not duplicate Hamdard in several places. Hamdard is the private-reflection idea within Vault, not several repeated tabs.
> - Do not make "Reset" a main tab or constantly show a Reset button. A useful recovery flow may help someone resume or reschedule; it must not erase missed work or pretend a tap completes it.
> - No creator feed, reels feed, public social network or endless scrolling. NURA should help users leave the app and do real things.
> - Make it comfortable for Gen-Z boys AND girls, without gender stereotypes. Use clean typography, generous touch targets, clear icons with labels, strong contrast and accessible text sizes.
> - A calm midnight/dark background with mint or green accents and a light evergreen alternative are reference directions, not proven preferences. Do not slavishly copy old orange Aethel screenshots, gold-heavy posters or generated image mistakes.
> - Keep screens understandable on budget Android phones and desktop. Show loading, empty, error, offline and permission-denied states. Avoid clutter, repeated cards, decorative dashboards and excessive animations.
>
> ## 5. Home — practical daily action
>
> Show the next useful action, today's real tasks, relevant prayer information and a small progress summary. Include creating/editing tasks, dates and optional times, realistic daily habits, study/career/health goals, a focus timer, pause/stop and an honest completion check. Allow rescheduling without destroying history. Make unfinished work easy to find again.
>
> Progress should reflect recorded actions, not guessed behaviour or a score of someone's faith. Useful weekly summaries should explain one pattern and one next step, not create impressive-looking but unsupported statistics.
>
> ## 6. Sunnah — a usable day, not a giant checklist
>
> Inside Sunnah, provide clear sections for **Routine / Akhlaq / Duas / Quran**, with Hadith learning and Quiz visibly accessible from Sunnah and a Home shortcut.
>
> Routine should support waking, Fajr and relevant remembrance, morning adhkar, Ishraq/Duha when applicable, Dhuhr, Asr, evening remembrance, Maghrib, Isha, bedtime and Friday practices. Organize by time/context, let users select manageable practices, and distinguish obligatory worship, Sunnah, optional practices and personal goals. Do not make every user complete sixty items per day.
>
> Each religious practice needs a reliable source and appropriate wording. Do not copy fixed dhikr counts, promised benefits or rulings from mockups without verification. Allow legitimate differences in practice, including prayer calculation method and Asr convention. Do not issue unsupported rulings about exemptions; practice-aware options should be private and reviewed.
>
> Prayer times should support manual city/location entry, time zone, calculation method and adjustments. Explain that users should compare with their local mosque. Location must not be requested unnecessarily. No promise of accurate background prayer alarms until actual device testing.
>
> Akhlaq covers practical character actions: kindness, honesty, respect, service, cleanliness, family responsibilities and helping others. Do not turn these into public piety rankings.
>
> Duas need Arabic text, English meaning, source, clear context, optional transliteration and useful bookmarks. Quran's goal includes all 114 surahs, search, readable Arabic, licensed translations, bookmarks, reading progress and eventual offline text/audio. Prove content access, accuracy and licensing before building a huge integration. An external Quran link is not an offline Quran reader.
>
> ## 7. Hadith learning, quizzes and rewards
>
> Provide short sourced Hadith lessons, an understandable explanation, a multiple-choice question, feedback explaining the answer, and a practical action. This is an important feature, not something to omit.
>
> Award learning coins/points transparently; prevent repeat-answer farming. Coin redemption, monetary value and partnerships are UNDECIDED. Do not invent cash rewards, spiritual reward amounts, purchases or guaranteed earnings. Prefer meaningful learning over pressure, gambling-like mechanics or addictive loops.
>
> ## 8. AI Chat — Bhai
>
> Bhai is the approachable companion inside AI Chat, with an optional avatar. It should help with Deen AND Dunya, remember only what the user permits, offer small action plans and connect useful suggestions to app actions.
>
> The intended direction is **on-device/local AI for sensitive personal interactions**. Cloud AI must not silently receive journal entries, chats, urges, photos or other private data. Do not confuse local storage with local inference. If a device cannot run an adequate model, provide clearly labelled guided support rather than secretly switching to cloud processing.
>
> Test a small model on the actual budget phone. Measure download size, compatibility, response time, memory, heat, battery, English answer quality, offline operation and failure recovery. Never claim ChatGPT-level performance from a tiny model. Curated replies are not an LLM. Model choice and successful device support remain undecided.
>
> Religious quotations must come from reviewed sources, not generated memory. Bhai is not a mufti, doctor or therapist. Voice input/output is a retained future option; do not add microphone access or cloud transcription without disclosure and consent.
>
> ## 9. Shield — a feature, not the entire app
>
> Shield supports unwanted habits and distraction. Its design may include a voluntary 30-second pause, a personal reason to stop, a short grounding action, a route back to a goal, and access to support.
>
> The optional reminder photo must be genuinely optional, easy to remove and stored privately. Do not default to a family photo or use it to humiliate the user. Words or a neutral image must work too. Never automatically tell family or friends about a user's behaviour.
>
> Separate these technically different things:
>
> 1. A manual pause INSIDE NURA, which a website can demonstrate.
> 2. Detecting a selected Android app/session with explicit permission.
> 3. Estimating reel transitions using an app-specific, tested method. A scroll event is not proof of a watched reel.
> 4. A permitted screen overlay or system restriction. An overlay may not pause underlying audio/video.
> 5. Blocking known adult domains, which does not identify every post inside encrypted social feeds.
>
> A normal web link cannot monitor and control Instagram or YouTube across the phone. Never market universal porn detection, exact reel counts or unbreakable blocking without evidence. Android and iOS require separate native implementations and policy review.
>
> For the first Android proof: one selected app, one explicit user-selected rule, one intervention, visible stop controls, clear permission disclosure, cleanup on exit/lock/revocation and no interference with emergency calls. Keep AI out of accessibility control. Avoid raw screen text/screenshots, hidden surveillance and unnecessary permissions.
>
> Evaluate real reliability before expanding. If counting fails, offer an honest session timer rather than a fake counter. If local AI fails, keep labelled guided support. Do not ask users to root, unlock bootloaders or disable security protections.
>
> ## 10. Vault / Hamdard and privacy
>
> Retain private reflection, trigger/struggle notes, career audit and a personal code/principles. Users need clear storage explanations, lock/unlock, export, deletion and recovery limitations. Encryption must actually be implemented and tested; a padlock or "AES active" label proves nothing.
>
> Separate encrypted Vault content from ordinary planner records. Do not claim all data is encrypted when only journals are. Explain what happens if a passphrase is lost, browser storage is cleared or a phone is replaced. Consider optional biometric access later; do not fake it.
>
> No ads or third-party tracking inside private conversations, urges or journals. Avoid exporting intimate fields into analytics or crash logs. Do not promise "100% private" or "nothing ever leaves the device" without auditing hosting, backups, transfers, model calls and SDKs. HTTPS protects transport; it does not automatically create cross-device sync or complete privacy.
>
> ## 11. More, profile and notifications
>
> More includes profile, appearance, prayer settings, reminders, privacy, data export/delete, reports/history, clear feature status, support and future subscription/book access. Keep navigation simple.
>
> Notifications are optional and category-controlled, with quiet hours, restrained frequency and neutral lock-screen wording. No private behaviour exposed on a lock screen. No shame, deceptive urgency or nagging. Scheduled phone notifications need platform-specific implementation and real background/reboot/time-zone tests. An open-browser notification demo is not a reliable native alarm.
>
> ## 12. Owner needs and business model
>
> I want NURA to help users AND become a sustainable business.
>
> - Limited ads are the intended main revenue source, not an already working or guaranteed income stream.
> - Subscriptions are an additional idea. Prices, exact premium benefits and usage limits are not finalized.
> - Licensed books from Islamic authors/influencers may be sold for an agreed commission or included under a negotiated subscription licence. Promotion partnerships are possible. Get explicit rights; never upload someone's book without permission.
> - A creator/social-content feed is specifically excluded even though book partnerships remain possible.
> - A proposed tiny ad shown for 2-3 seconds is NOT a settled, policy-approved ad format. Verify network/store policies and unit economics. Do not interrupt prayer, Quran reading, private support, Vault or an urgent-help flow. No ads disguised as notifications or app buttons.
> - Coin spending/redemption, prices, commission rates, ad provider and legal/commercial agreements remain pending. Do not fabricate them or implement billing without agreement.
>
> Owner controls should eventually support authenticated, bounded remote configuration: enabling approved features, content versions, announcements, ad limits, subscription offers, rollout and emergency disabling of broken features. Include validation, audit history and rollback. Separate admin access from the user app. No hardcoded admin passwords or client-side API secrets. Owner controls must not read journals, silently enable tracking, override user consent or remotely command phones.
>
> ## 13. Research — use evidence honestly
>
> A first survey produced 31 submissions, not 31 verified unique people. Some submissions contain identifiers and repeated identifiers disagree on age/gender. It is not fully anonymous. Small subgroup results do not establish what all boys or girls need. Ask girls/women directly instead of inventing their needs.
>
> Corrected directional findings: small daily plans were selected in 16/31 submissions. Too many ads were selected in 14/28 answers to the question about reasons to quit; three did not answer that question. These support testing simple planning and restrained ads, not claims of product-market fit. Do not infer rates of pornography, smoking or other sensitive problems from this survey. If I provide the corrected report, preserve each question's denominator and missing answers. Do not publish raw responses.
>
> Validate usability with actual people: can they find the next action, start and finish a real task, find Sunnah/Bhai, and return voluntarily? Measure useful actions and voluntary return, not just time spent in the app. Do not assume an attractive screenshot proves a useful product.
>
> ## 14. Reference status of Codex's separate version
>
> This is context only, NOT work completed by your Claude version:
>
> - A plain HTML/CSS/JavaScript prototype currently has tasks/habits, a focus timer, honest completion/rescheduling, seven-day summaries, profile and themes.
> - Sunnah includes starter routines, counters, six sourced lesson/quizzes, five starter dua/remembrance summaries and 114 external Quran links. Full reviewed offline Quran/audio is unfinished.
> - Local prayer calculations use the bundled Adhan library, with manual alternatives and settings.
> - Bhai is written/keyword-routed guided support, not a real local or cloud LLM.
> - Shield is a manual in-app pause, not native monitoring or blocking.
> - Vault uses passphrase-based AES-GCM with encrypted export/import; ordinary planner data is not encrypted. No independent security audit, biometric unlock or cloud sync.
> - Planner backup/restore and reminders exist, but reminders are best-effort while open.
> - Eighteen core/regression automated checks and two LAN-preview server checks passed. That is NOT phone testing or proof of native AI/Shield.
> - No completed native APK, successful on-device AI benchmark, live payments, ad integration or owner dashboard has been established.
> - The LAN preview worked on the PC but phone access was blocked by explicit Windows Firewall rules for the serving runtime. Repeating local-IP links is not the desired long-term workflow. The owner requested stable hosted HTTPS access. Do not claim a hosted version is live unless you verify its deployment result.
>
> ## 15. Current hardware and practical limits
>
> First test phone: Vivo Y19e, Android 15 / Funtouch OS 15, 4 GB physical RAM plus 4 GB extended memory, 64 GB total storage. The owner chose this phone for testing. A Vivo Y31 5G is also available: Snapdragon 4 Gen 2, 6 GB physical plus 6 GB extended memory, 128 GB storage. Extended memory is NOT additional physical RAM.
>
> The PC has an Intel i5-6500T and 8 GB RAM, Windows 10 Pro 22H2. Keep development lightweight; do not assume a heavy emulator will run well or that Windows security updates are current. Do not recommend buying hardware before testing a small proof.
>
> ## 16. Your first deliverable and workflow
>
> My immediate requirement is a normal HTTPS link that opens your independent version on both phone and PC, without the developer PC staying on, matching Wi-Fi, USB debugging, firewall changes or an expiring local tunnel. Do not promise that hosting includes unlimited usage or costs nothing; verify the chosen provider. Ask before paid plans, subscriptions, purchases or changing public/private access. If hosting requires my account or login, tell me the exact short step, not hours of speculative setup.
>
> Begin with a responsive, useful web prototype with working navigation, one real daily-task/focus flow, a small reviewed learning flow and honestly labelled guided support/Shield demo. Keep every other confirmed feature visible in the backlog, not disguised as complete. Native cross-app Shield and on-device AI require later separate proofs; a website deployment does not implement them.
>
> Before each substantial feature, briefly tell me: what you will build, what it needs from me, likely costs/permissions, its real limitations and how you will prove it works. Ask only questions that genuinely block progress. Do not make me answer five questions before every small action.
>
> Use the simplest maintainable implementation that fits the need. Preserve user data and working features. Use dummy data for testing. Never publish secrets, survey answers, journal exports or personal screenshots in the repository or deployment. Verify source/API access and licence before spending hours building an integration. Set a short proof-of-concept time limit and stop or change approach when the prerequisite fails.
>
> For each delivery, distinguish **implemented / tested / not tested / blocked / planned**. Provide the actual working URL when deployment succeeds; never invent a URL. A phone screenshot is useful visual feedback, not proof of native permissions or model performance. Check mobile layout, navigation, error handling, data persistence, accessibility and unsupported feature messages.
>
> Start by stating what you understand, where your separate project will live, the smallest first build and any genuinely blocking requirement. Then build YOUR NURA version without modifying or connecting to Codex's NURA.
