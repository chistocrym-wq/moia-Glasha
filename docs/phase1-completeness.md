# LIFE OS Phase 1 — completeness audit

Controller gate: **not live-ready until isolated Preview DB + live E2E**.

The implementation is intentionally not marked IMPLEMENTED merely because code exists. Per Issue #3, interactive functions remain **BLOCKED** until Controller verifies real Preview behavior and database effects. Production must not be used as the test database.

| # | Function | Status | Code / migration evidence | Verification available now / missing live proof |
|---:|---|---|---|---|
| 1 | Projects / parent tasks | PARTIAL | `004_projects_move_phone_hub.sql`, `007_phase1_projects_achievements.sql`, task UI | DB rollback acceptance PASS on existing Supabase; Preview UI E2E pending |
| 2 | Subtasks nested only inside parent | PARTIAL | `glasha_list_root_tasks()`, lazy child loading in `page.tsx` | DB root-list acceptance PASS; Preview UI nesting E2E pending |
| 3 | Parent progress percentage | PARTIAL | `glasha_list_root_tasks()`, task/project progress UI | live DB rollback acceptance PASS at 25% and 50%; UI rendering E2E pending |
| 4 | Parent completion at 100% | PARTIAL | `sync_glasha_parent_completion()` from `006_task_achievements_lifecycle.sql` | live DB rollback acceptance PASS at 100%; UI E2E pending |
| 5 | Move Personal ↔ Work preserving id/data | PARTIAL | `glasha_move_task_area()`, deterministic move route | DB rollback acceptance PASS after qualified-column hotfix; UI route E2E pending |
| 6 | “Мои достижения” 14 days | BLOCKED | achievements section in `page.tsx` | build PASS; live data window behavior pending |
| 7 | completed_at | IMPLEMENTED | `006_task_achievements_lifecycle.sql`, `stamp_glasha_task_completion()` | live DB rollback acceptance PASS for stamp + restore clear |
| 8 | Restore completed task | BLOCKED | `/api/life/tasks`, achievements restore UI | build PASS; live row/id proof pending |
| 9 | Achievements exclude child tasks as root cards | BLOCKED | achievements root filtering + nested children | build PASS; live hierarchy proof pending |
| 10 | Entity relationships | PARTIAL | `entity_links`, ownership validators, `/api/life/links` | live DB/RLS rollback acceptance PASS; UI/API live E2E pending |
| 11 | Global search | PARTIAL | `glasha_global_search`, `/api/life/search`, `LifeOsHome` | live DB owner/cross-user search acceptance PASS; Preview search UI E2E pending |
| 12 | Smart one-time reminders | BLOCKED | `reminders`, `/api/life/reminders`, UI | helper tests PASS; live persistence pending |
| 13 | Recurring routines daily/weekly/monthly | BLOCKED | recurrence fields + timezone-aware next occurrence | helper tests PASS; live recurrence pending |
| 14 | Snooze / skip / done | BLOCKED | `/api/life/notifications`, notification UI | build PASS; live state transitions pending |
| 15 | Quiet hours | BLOCKED | profile quiet-hours fields, preferences API/UI | helper tests PASS; delivery re-materialization live test pending |
| 16 | Notification center | BLOCKED | notifications table + Urgent/Today/Later UI | build PASS; live rows/actions pending |
| 17 | Now dashboard | BLOCKED | `getNow()`, `/api/life/now`, `LifeOsHome` | build PASS; live prioritization pending |
| 18 | Morning review | BLOCKED | `getReview("morning")`, conflict + overload UI | build PASS; live schedule dataset pending |
| 19 | Evening review | BLOCKED | completed/unfinished + tomorrow/cancel/split actions | build PASS; live mutation proof pending |
| 20 | Weekly review | BLOCKED | inbox cleanup, overdue, stale projects, goals, old tasks | build PASS; live dataset pending |
| 21 | Deterministic routes / 0 OpenAI | BLOCKED | `deterministic-router.ts`, router tests | unit tests PASS; telemetry proof on Preview pending |
| 22 | Economy telemetry | BLOCKED | `request_telemetry`, assistant/voice/local logging | code/build PASS; Preview measurements pending |
| 23 | PWA regression | BLOCKED | manifest/PWA client, `sw.js`, architecture test | static CI PASS; installed-PWA Controller test pending |
| 24 | Document upload regression | BLOCKED | direct Storage/TUS upload, private signed GET | architecture CI PASS; Preview object/metadata/signed URL live test pending |
| 25 | Voice input | BLOCKED | MediaRecorder → transcribe → deterministic route | code/build PASS; device/PWA mic E2E pending |
| 26 | Voice output | BLOCKED | browser SpeechSynthesis | unit safety/build PASS; device/PWA speech test pending |
| 27 | Voice reply ON/OFF | BLOCKED | opt-in local preference in `page.tsx` | build PASS; device behavior pending |
| 28 | Stop speaking | BLOCKED | visible Stop + local stop command | build PASS; device behavior pending |
| 29 | New command interrupts speech | BLOCKED | `processCommand()` calls `stopSpeaking()` first | code inspection/CI PASS; device behavior pending |
| 30 | Sensitive data not spoken automatically | BLOCKED | `voice-output.ts` sensitive guard | unit tests PASS; live voice check pending |
| 31 | Contacts phonebook DB extension | IMPLEMENTED | `008_phase1_phonebook_contacts.sql` | migration applied to existing Supabase; phonebook/RLS rollback acceptance PASS |
| 32 | VCF import | BLOCKED | `contacts.ts`, `PhonebookImport.tsx` | VCF unit tests PASS; real >=5-contact VCF import pending |
| 33 | Contact dedupe | PARTIAL | source UID + phone/email merge + unique index | DB source_uid dedupe acceptance PASS; duplicate VCF UI import pending |
| 34 | Contact aliases | BLOCKED | contacts aliases + deterministic resolver | unit tests PASS; live alias resolution pending |
| 35 | Позвони/Набери deterministic resolver | BLOCKED | deterministic contact routes + server resolver | router unit tests PASS; telemetry 0-AI proof pending |
| 36 | tel: dialer opening | BLOCKED | contact action returns `tel:` confirmation | code/build PASS; phone device test pending |
| 37 | Multiple phone clarification | BLOCKED | contact resolver returns numbered choices | code/build PASS; live imported contact test pending |
| 38 | Duplicate-name clarification | BLOCKED | scored resolver detects tied top matches | code/build PASS; live duplicate-name dataset pending |
| 39 | Telegram/email contact actions | BLOCKED | deterministic contact action + confirmation links | code/build PASS; device/browser E2E pending |
| 40 | Contact Picker graceful detection | BLOCKED | feature-detected `navigator.contacts.select` | build PASS; supported/unsupported device check pending |
| 41 | Contacts excluded from PWA cache | BLOCKED | static-only service worker policy | architecture CI PASS; Cache Storage live audit pending |
| 42 | Logout clears private contacts/client state | BLOCKED | auth reset clears contacts; PhonebookImport resets when `liveData=false` | code/build PASS; logout/cache live audit pending |

## CI suites

`npm test` covers deterministic routing, Life OS date/recurrence/quiet-hour helpers, voice-output privacy, VCF/phone normalization/dedupe and Phase 1 architecture guards.

Rollback-only database suites:
- `supabase/tests/phase1_acceptance.sql`
- `supabase/tests/phase1_phonebook_acceptance.sql`

## Preview database requirement

The current Supabase account is on Free, where database branching is unavailable. The safe fallback is a separate preview/test Supabase project. Until that exists, Netlify deploy-preview must **not** point to the production Supabase database.

## Promotion rule

Only after Controller live E2E supplies evidence for the relevant rows above can their status be changed from BLOCKED to IMPLEMENTED. Production promotion is a separate explicit action.
