# NURA (Claude build) — Project Context for Claude Code

**Read this whole file before writing or changing any code.** This is an independent build of NURA — not connected to, not synced with, and not reading from the Codex version (which lives elsewhere on this machine, e.g. `Documents/Codex` — do not open, read, or copy from it). Section 14 of the original owner master prompt (kept in full at the bottom of this file) describes that other version for context only; nothing there is "already done" here.

## 0. The Two-Builds Rule (non-negotiable)

- This is `nura-claude`, a separate folder, separate git repo, separate deployment, separate app-data namespace from Codex's NURA.
- Never edit, replace, connect to, deploy over, or auto-merge with the Codex version. Never use its hosting credentials or project identity.
- Never assume access to Codex's conversation, files, tools, or running app.
- No shared databases, automatic sync, or cross-communication between the two builds. Integration only on explicit future request.
- Improve implementation/design freely, but never silently drop a confirmed requirement below. Separate "first release" from "planned later" explicitly in any status report.

## 1. What NURA Is

Name: **NURA**. Tagline: **Your Daily Companion & Habit Space.**

A **Deen + Dunya** daily companion for young Muslims — not just a Quran/Salah/religious-content app. One connected life: faith, studies, work, health, habits, family, emotions, purpose all affect each other.

Audience: mainly Gen Z, both boys and girls. Testing starts in India; worldwide Muslim audience is the long-term vision. Assume budget Android phones and slow internet, not premium devices. UI language: English. Arabic religious text may appear with English meaning and optional transliteration.

Support areas (connected goals, not medical claims): prayer/connection with Allah, unwanted pornography/masturbation, smoking/vaping, excessive phone/social media, gaming, procrastination, studying, career, sleep, fitness, eating habits, anger, stress, confidence, discipline, loneliness, relationships, time management, purpose.

## 2. How NURA Helps — the pattern

**Understand what happened → offer a realistic next action → give relevant Islamic support when useful → help the user act → follow up with permission.** Never force a religious lecture into every response.

No guilt machine, fake "truth score," humiliation, invented diagnosis, religious threats, or emotional dependency on the AI. Never diagnose or shame. Never claim NURA secretly knows what a user watched/did. Age-appropriate safeguards and routes to qualified help when needed. Don't label every sexual feeling/behavior an addiction.

## 3. Navigation

**Home / Sunnah / AI Chat / Duniya / More.** Exactly these five, always. (Changed 2026-09-17: Vault's nav slot was repurposed into **Duniya** — NURA's everyday/practical self-improvement hub (study, phone control, sleep, fitness, habits, productivity, mental wellbeing, career, money habits, personal growth), distinct from Sunnah's Deen content. Hamdard's real, encrypted-journal Vault screen was not deleted — it's still fully intact, just relocated to an entry point inside More instead of the bottom nav.)

- Profile: reachable via header avatar and/or More — not its own tab.
- Do not restore the old Home/Habits/+/Bhai/Profile structure.
- "Hamdard" = the private-reflection idea, now reached via More → Hamdard, not a bottom-nav tab.
- Duniya and Sunnah (Deen) should feel connected but distinct — a user should always know which part of life they're improving.
- No standalone "Reset" tab and no constantly-visible Reset button. A recovery flow may help resume/reschedule; it must never erase missed work or pretend a tap completed it.
- No creator feed, reels feed, public social network, or endless scroll. NURA should help users leave the app and do real things.
- Design: clean typography, generous touch targets, labeled icons, strong contrast, accessible sizes. Calm midnight/dark with mint-green accents (and a light evergreen alt) are reference directions, not locked-in. No gender stereotyping. Show loading/empty/error/offline/permission-denied states. Avoid clutter and decorative dashboards.

## 4. Home

Next useful action, today's real tasks, relevant prayer info, small progress summary. Task create/edit with dates/times, realistic daily habits, study/career/health goals, a focus timer with pause/stop, an honest completion check (timer ending ≠ task done), reschedule without destroying history, unfinished work easy to find again.

Progress reflects recorded actions only — never a guessed "faith score." Weekly summaries explain one pattern + one next step, not impressive-looking unsupported stats.

## 5. Sunnah

Sections: **Routine / Akhlaq / Duas / Quran**, with Hadith lessons + Quiz visible from Sunnah and a Home shortcut.

Routine: waking, Fajr + remembrance, morning adhkar, Ishraq/Duha, Dhuhr, Asr, evening remembrance, Maghrib, Isha, bedtime, Friday practices — organized by time/context, user selects what's manageable, obligatory/Sunnah/optional/personal clearly distinguished. Not a 60-item forced checklist.

**Every religious practice needs a reliable source and correct wording.** Never copy fixed dhikr counts, promised benefits, or rulings without verification. Respect legitimate differences (prayer calculation method, Asr convention). No unsupported rulings about exemptions.

Prayer times: manual city/location entry, time zone, calculation method, adjustments; tell users to compare with their local mosque. Never request location unnecessarily. No promised background alarm accuracy without real device testing.

Akhlaq: practical character (kindness, honesty, respect, service, cleanliness, family, helping others) — never a public piety ranking.

Duas: Arabic + English meaning + source + context + optional transliteration + bookmarks.

Quran (long-term goal): all 114 surahs, search, readable Arabic, licensed translations, bookmarks, reading progress, eventual offline text/audio. **Prove content access, accuracy, and licensing before building the full integration.** An external link is not an offline reader.

## 6. Hadith Learning & Quiz

Short sourced Hadith lesson → plain explanation → multiple-choice question → feedback explaining the answer → a practical action. This is a real feature to build, not to skip.

Coins/points for learning, transparent, anti-farming (no repeat-answer grinding). **Redemption, monetary value, and partnerships are UNDECIDED — never invent cash rewards, spiritual reward amounts, purchases, or guaranteed earnings.** Prefer meaningful learning over pressure/gambling-like loops.

## 7. AI Chat — "Bhai"

Approachable companion, optional avatar, helps with Deen AND Dunya, remembers only what's permitted, offers small action plans, links suggestions to app actions.

Direction: **on-device/local AI for sensitive personal interactions.** Cloud AI must never silently receive journals, chats, urges, photos, or other private data. Local *storage* ≠ local *inference* — don't confuse them. If a device can't run an adequate model, show clearly-labeled guided support — never silently fall back to cloud.

Before claiming local AI works: test a small model on the actual target phone (Section 12) — download size, compatibility, response time, memory, heat, battery, English quality, offline operation, failure recovery. Never claim ChatGPT-level output from a tiny model. **Curated/scripted replies are not an LLM — label them honestly.** Religious quotations: reviewed sources only, never generated from memory. Bhai is not a mufti/doctor/therapist. Voice I/O is a future option — no mic access or cloud transcription without explicit disclosure/consent.

## 8. Shield

Supports unwanted habits/distraction. Possible design: voluntary 30-second pause, a personal reason to stop, a short grounding action, a route back to a goal, access to support.

Optional reminder photo: genuinely optional, easy to remove, stored privately. Never default to a family photo or use it to humiliate. Words/neutral image must work too. Never auto-notify family/friends about a user's behavior.

**These are technically different things — do not blur them:**
1. A manual in-app pause (a website *can* demonstrate this)
2. Detecting a selected Android app/session, with explicit permission
3. Estimating reel transitions with an app-specific, tested method (a scroll event is not proof of a watched reel)
4. A permitted screen overlay / system restriction (an overlay may not pause underlying audio/video)
5. Blocking known adult domains (doesn't identify every post inside encrypted social feeds)

A web link cannot monitor/control Instagram or YouTube across the phone. Never market universal porn detection, exact reel counts, or unbreakable blocking without evidence. Android and iOS need separate native implementations + policy review.

First Android proof (later, not now): one selected app, one explicit user-set rule, one intervention, visible stop controls, clear permission disclosure, cleanup on exit/lock/revocation, no interference with emergency calls. No AI in accessibility control. No raw screen text/screenshots, no hidden surveillance, no unnecessary permissions. If counting fails, an honest session timer beats a fake counter. No asking users to root or unlock bootloaders.

## 9. Vault / Hamdard

Private reflection, trigger/struggle notes, career audit, personal code/principles. Clear storage explanation, lock/unlock, export, deletion, recovery limitations spelled out. **Encryption must be actually implemented and tested — a padlock icon or "AES active" label proves nothing.**

Separate encrypted Vault content from ordinary planner records explicitly — never claim "all data encrypted" when only journals are. Explain what happens if a passphrase is lost, storage is cleared, or the phone is replaced. Biometric access: optional, later, never faked.

No ads/third-party tracking inside private conversations, urges, or journals. Never export intimate fields into analytics/crash logs. Never claim "100% private" / "nothing ever leaves the device" without actually auditing hosting, backups, transfers, model calls, SDKs. HTTPS protects transport only — it doesn't create privacy or sync by itself.

## 10. More / Profile / Notifications

More: profile, appearance, prayer settings, reminders, privacy, data export/delete, reports/history, clear feature-status list, support, future subscription/book access.

Notifications: optional, category-controlled, quiet hours, restrained frequency, neutral lock-screen wording. No private behavior shown on a lock screen. No shame, deceptive urgency, or nagging. Scheduled native notifications need platform-specific work and real background/reboot/timezone testing — a browser demo isn't a reliable native alarm.

## 11. Business Model (owner needs a sustainable business, not just a good app)

- Limited ads: intended main revenue, **not yet working or guaranteed.**
- Subscriptions: an idea. Prices/benefits/limits **not finalized.**
- Licensed books from Islamic authors/influencers: possible commission/licensed-subscription sale — **get explicit rights first, never upload a book without permission.**
- No creator/social-content feed, even though book partnerships are possible.
- A "tiny 2-3 second ad" is **not yet a settled, policy-approved format** — verify network/store policy and unit economics first. Never interrupt prayer, Quran reading, private support, Vault, or an urgent-help flow with an ad. No ads disguised as notifications or buttons.
- Coin redemption, prices, commission rates, ad provider, legal/commercial terms: **all pending — never fabricate or implement billing without explicit agreement.**

Future owner dashboard: authenticated, bounded remote config (feature enablement, content versions, announcements, ad limits, subscription offers, rollout, emergency disable) with validation, audit history, rollback. Admin access separate from the user app. No hardcoded admin passwords or client-side API secrets. Owner tools must never read journals, silently enable tracking, override user consent, or remotely command phones.

## 12. Hardware Reality (design and test against this, not a flagship)

- Test phone 1: **Vivo Y19e** — Android 15 / Funtouch OS 15, 4 GB RAM + 4 GB extended (virtual, not real RAM), 64 GB storage.
- Test phone 2: **Vivo Y31 5G** — Snapdragon 4 Gen 2, 6 GB RAM + 6 GB extended, 128 GB storage.
- Dev PC: Intel i5-6500T, 8 GB RAM, Windows 10 Pro 22H2. Don't assume a heavy emulator runs well.
- Don't recommend buying hardware before a small proof is tested.

## 13. Research Data — use honestly

Survey: 31 submissions, **not 31 verified unique people** — some carry identifiers, some repeated identifiers disagree on age/gender, not fully anonymous. Small subgroup results don't establish what "all boys" or "all girls" need — ask girls/women directly instead of inferring.

**Corrected directional findings** (supersedes any earlier survey numbers from a prior draft): small daily plan selected in **16/31**; "too many ads" selected in **14/28** answers to the quit-reasons question (3 people didn't answer it). These support testing simple planning and restrained ads — they do **not** establish product-market fit. Never infer rates of pornography, smoking, or other sensitive problems from this survey. If a corrected report is provided later, preserve each question's denominator and missing-answer count. Never publish raw responses.

Usability validation (when real people test it): can they find the next action, start and finish a real task, find Sunnah/Bhai, return voluntarily? Measure useful actions and voluntary return — not time-in-app. A good screenshot doesn't prove a useful product.

## 14. Reference: Codex's Separate Version (context only — NOT built here)

- Plain HTML/CSS/JS prototype: tasks/habits, focus timer, honest completion/rescheduling, 7-day summaries, profile, themes.
- Sunnah: starter routines, counters, 6 sourced lesson/quizzes, 5 starter dua/remembrance summaries, 114 external Quran links (full reviewed offline Quran/audio unfinished).
- Prayer times: bundled Adhan library + manual alternatives/settings.
- Bhai: written/keyword-routed guided support — **not** a real local or cloud LLM.
- Shield: manual in-app pause — **not** native monitoring or blocking.
- Vault: passphrase-based AES-GCM with encrypted export/import; ordinary planner data **not** encrypted; no independent security audit, no biometric unlock, no cloud sync.
- Planner backup/restore + reminders exist; reminders are best-effort while the app is open.
- 18 core/regression automated checks + 2 LAN-preview server checks passed — **not** phone testing, **not** proof of native AI/Shield.
- No completed native APK, on-device AI benchmark, live payments, ad integration, or owner dashboard.
- LAN preview worked on PC; phone access was blocked by Windows Firewall rules. Owner wants stable hosted HTTPS access instead of repeating local-IP links. Never claim a hosted version is live without verifying the actual deployment result.

## 15. Golden Rule (carried over from the sibling project, still applies here)

Build the smallest real thing, prove it works, then expand. Don't build five features at once. Before a substantial new feature: state what you'll build, what you need from the owner, likely costs/permissions, real limitations, and how you'll prove it works — but only ask questions that are genuinely blocking, not a checklist.

Never invent Quran verses, hadith, dua text, sources, translations, or Islamic rulings. Real religious content needs a verified source; broad hadith/dua libraries additionally need a named reviewer before shipping widely (same open question as the sibling project — nobody has been named yet).

Never claim a feature works, is secure, is private, or is "live" without actually verifying it. Distinguish **implemented / tested / not tested / blocked / planned** in every status report. Never invent a deployment URL.

## 16. Current Build State

See `docs/project-status.md` for the living, up-to-date status (what's implemented/tested/planned). This section is not duplicated here to avoid drift between two files saying different things.

---

*Full original owner master prompt preserved for exact wording — consult if anything above seems ambiguous, this file's summary always defers to the exact wording below on any conflict.*

(Full text of the 2026-09-15 "NURA — Claude Code master prompt" is kept in `docs/decisions.md` under the entry that started this build, rather than duplicated a second time here.)
