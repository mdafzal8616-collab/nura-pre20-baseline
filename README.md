# NURA — Pre-20 September Baseline

A **separate, historical build** of NURA for side-by-side comparison with the current app. It is not the current NURA and shares no code path or data with it.

- **Source snapshot:** commit `a6e47e0` of the `nura-claude` repo — "Add User Understanding & Memory Engine", 2026-09-19 20:46 IST. This is the last commit before the first 20 September commit (`c6e1762`, 10:54 IST).
- **Not included (all post-19-Sep):** the Fajr-to-Fajr Home, manual prayer times and Salah flow, the shared ProgressStore, the versioned onboarding/backup layer, the 5-tab Today/Deen/Dunya/Progress/Hamdard shell, the Next Step Engine, the Life/Library/Hamdard nav, and every Home redesign.

## Changes on top of the snapshot

1. **Separate storage.** Every key goes through a `p20_` prefix (`js/app.js`, top of file). GitHub Pages projects share one origin, so without this the two apps would read and overwrite each other's data.
2. **Bhai (AI Chat tab) reads real NURA data.** A read-only `NuraContext` builds a small, per-topic snapshot (Salah status, plan, priority, study, sleep, fitness, habits, progress; recovery counts only when the conversation is about a habit or urge). Bhai turns it into one realistic next step. It is **rule-based, not a live language model** — there is no backend or API key, and nothing typed leaves the device. Vault content is never read. Actions that change data (e.g. marking a prayer) ask for confirmation first. Religious rulings and Qur'an/hadith text fail closed. A self-harm message gets fixed crisis wording (needs owner review before real use).
3. **Bhai-started sessions are now recorded.** Confirming "I actually finished" on a session started from Bhai saves it to the same priority history the graph and weekly numbers read. Before, it was silently dropped.
4. **Removed the "Reset My Day" button** on Duniya. It only showed a toast and re-opened the same screen (a no-op), and Reset had been dropped as a product concept.
5. Page title, an "About this build" card in More, and the Feature Status line for Bhai.

Everything else — Home, Salah, Study, Fitness, Sleep, Plan My Day, Recovery, Money, Sunnah/Quran/Hadith, Vault ("Hamdard" in this era is the private reflection space; the chat companion is "Bhai") — is the original code.

## Home rebuild — 2026-09-25

Only the Home screen was rebuilt (Sunnah, Duniya, AI Chat and More are unchanged; the bottom navigation order is unchanged). The previous deployment is preserved as the git tag `frozen-comparison-v1`.

- **Right Now hero:** the current Salah (large), with a "Mark as prayed" action, then the next Salah as a lighter strip with a live countdown. Uses the app's existing prayer settings and cached times; unmarked earlier prayers appear as small chips. Setup, loading and failure states are handled inside the hero.
- **Hamdard note:** appears only when the data supports a real suggestion (free time before the next Salah, a pending priority, most of the day done). One button at most.
- **Today's Priority:** the same data and logic as before (one priority per day, timer, check-in), presented as an actionable card with an inviting empty state; the choices are tiles with a description.
- **Today's Progress:** completed / applicable actions — prayers whose time has arrived, today's priority, Plan My Day items, habits and Top 3 — with a per-group breakdown. The old 7-day graph was removed from Home; the report sheet is one tap away.
- **Useful right now:** 3–4 tiles chosen by time of day and current state.
- No new storage keys; existing saved data (name, prayer settings, priority, plan, habits) is read as before.

## Daily Flow + Life Grid — 2026-09-26

New screen, opened from Home's progress card (not a tab; the bottom nav is unchanged). Sunnah, Duniya, More, AI Chat and the Home layout are otherwise unchanged; Study Mission is not built.

- **Today:** the user's own planned actions in time order (Morning / Afternoon / Evening / Night / Anytime), with NOW and NEXT markers, a checkbox per action, and a summary ("7 of 10 planned actions completed"). Simple ticks, counts (3 / 5 pages), time (32 / 45 min), quantity (18 / 30) and values (sleep 7h 10m) are all supported; measured actions contribute value/target to the percentage.
- **Week (Life Grid):** task rows × Mon–Sun, one cell per day: done ✓, partial ◐, not yet ○, not completed ·, skipped ⊘, moved ↷, planned (dotted), not planned —. Past days can be corrected by tapping the cell. Summary lines only appear when enough planned days exist; the end-of-week reflection is optional.
- **Plan control:** add (name, kind, tracking type, time, repeat: today / every day / weekdays / chosen days), edit, skip today, move to tomorrow or a date, stop repeating (history kept). Suggestions ("Five daily prayers", adhkar routines, existing habits) are one tap and never added automatically.
- **Linked actions** read and write NURA's existing Salah completions, Sunnah log and habit log instead of copying them, so ticking Fajr here and on Home is one fact.
- **Storage:** `nc_flow_actions`, `nc_flow_log_YYYY-MM` (one shard per month), `nc_flow_miles`, `nc_flow_reflect`. Nothing existing was migrated.
- **Home progress** now counts the Flow; automatic counting of elapsed prayers is only a fallback when there is no Flow plan for today.

## Daily Flow — five fixes — 2026-09-26

Only these five items were changed; Study Mission is still not built.

1. **Past dates stay honest.** An action exists from its `startDate`; earlier days are "not planned" (—), never missed. Editing a schedule (days, time, target, type) now adds a *version* effective from today (tomorrow if today already has an outcome), so past days keep the schedule they were planned under instead of being rewritten.
2. **Consistency, not streaks.** Counted over *planned* days only (a Mon/Wed/Fri action has no Tuesday to break), skipped/moved days are set aside, today only counts once it has an outcome. Shown as "3 planned days in a row" or "Done 4 of the last 5 planned days". Salah shows nothing; worship routines show only the neutral ratio.
3. **Hamdard reads real Flow history.** `NC_SECTIONS.flow` → `flowContext()`: per-action planned/done/partial/missed/skipped/moved, times, schedule, recent outcomes and patterns, each pattern a FACT plus a separate optional SUGGESTION. A claim needs ≥ 3 planned days behind it; otherwise Hamdard says there isn't enough history. Salah/Deen items are only counted, never analysed. New chat option "How is my plan going?".
4. **Reschedule duplicate fixed at the data level.** A move is one exception on the template (`ex[originDate] = {to}`), never a copied one-off. Moving again updates that same exception (Mon → Tue → Wed = one occurrence). Moving onto a day the action already occupies is refused. Undo on the original day restores it. The first Daily Flow build's copy-based moves are folded into exceptions once on load (`nc_flow_schema` = 2).
5. **"Create your own goal".** No longer becomes a Study Focus/timer. It opens a short setup (name, when/how often, optional time, how it's tracked), and Finish saves it into Daily Flow, shows it as today's priority with a checkbox/stepper (no timer), and counts it once in Today/Home/Life Grid. NURA files the goal (kind + tag such as "Routine · Education") and reads measures from the name ("20 pages", "30 minutes") only as visible, editable suggestions. One optional idea may follow (e.g. repeat Mon–Fri) and is never applied unasked.

Not done, on purpose: reminders (this is a web build with no notification permission, so no reminder control is shown).
