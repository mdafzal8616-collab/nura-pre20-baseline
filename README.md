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
