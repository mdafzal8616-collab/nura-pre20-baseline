# NURA (Claude build) — Status

Last updated: 2026-09-16. Independent build, separate from Codex's NURA (see `CLAUDE.md` Section 0 and 14).

**Live:** https://mdafzal8616-collab.github.io/nura-claude/

## Implemented (built and tested this session)

- Nav shell: Home / Sunnah / AI Chat / Vault / More
- Home: add/complete/reschedule/delete tasks, 20-minute focus timer with pause/stop, honest completion check on timer end (asks yes/no, doesn't auto-mark done)
- Sunnah → Routine: 11 time-of-day sections, collapsible, tap-to-complete. Dhikr items (after-salah dhikr on all 5 prayers, morning/evening adhkar, Ayat al-Kursi) expand to show verified Arabic, transliteration, meaning, and a named hadith source.
- Sunnah → Akhlaq: 11 character actions (8 original + 3 added for self-improvement), each expandable to a verified hadith citation.
- Sunnah → Duas: **all 11 categories now have real, cited content** (Morning, Evening, Sleep, Waking Up, Salah, Protection, Stress/Anxiety, Forgiveness, Travel, Food, Daily Life). Search, favorites (persisted), category → list → detail navigation, copy/share.
- Sunnah → Quran: daily Arabic verse, fetched from Tanzil Project (verified, CC BY 3.0, attributed)
- Sunnah → Hadith & Quiz: one verified hadith (Bukhari 1 / Muslim 1907 / Nawawi40 1), multiple-choice quiz, one-time coin award (anti-farming: coins only awarded on first correct answer)
- AI Chat: scripted guided-support flow (5 situations), clearly labeled as not real AI
- Shield: manual 30-second in-app pause, reason capture, grounding text, route back to tasks — clearly labeled as prototype, no device-level anything
- **Vault: real AES-GCM 256 encryption (Web Crypto, PBKDF2 150k iterations)** — 4 sections (Hamdard/Private Reflection, Trigger & Struggle Notes, Career Audit, Personal Code/Principles), full entry CRUD, search, lock/unlock, change passphrase, forgot-passphrase erase flow. Verified genuinely encrypted at rest, session-only key. Currently a plain notebook by design (owner's choice) — no mood/trigger tags yet, that idea is parked, not forgotten.
- More: profile name, coins display, JSON data export, delete-all-data, feature status list

## Not tested yet

- Real Android phone (Vivo Y19e / Y31 5G) — only tested in desktop/mobile-emulated browser so far

## Not built (planned, not disguised as done)

- Full Quran (114 surahs, search, translation, audio, offline) — only a daily-verse proof of concept exists
- Hadith & Quiz: only 1 lesson exists, more requested
- Prayer time calculation (manual location/method/adjustments)
- Real on-device or cloud AI for Bhai
- Native Shield (app detection, overlays, blocking) — Android/iOS native work, not a website
- Vault biometric unlock, independent security audit, optional mood/trigger tags (discussed, parked)
- Notifications
- Ads, subscriptions, coin redemption, owner dashboard — business terms undecided

## Blocking / needs owner input

- Hadith/Duas library expansion beyond what's already verified needs a named content reviewer (same open question as the sibling `nura-app` project) — not blocking day-to-day work, since each new item added so far has been individually cross-checked against a named source first.
