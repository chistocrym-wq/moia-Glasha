# LIFE OS Phase 1 — Preview Gate

This branch is preview-only.

- Source branch: `feature/glasha-life-os`.
- Production branch must not be changed before Controller live E2E. The existing `moia-glasha` Supabase is approved for this Preview acceptance run.
- Draft PR: #4.
- Netlify deploy-preview uses the existing `moia-glasha` Supabase by Controller decision for this run.
- Apply the inherited task lifecycle first, then Phase 1 additions on preview/test: `006_task_achievements_lifecycle.sql` → `006_life_os_phase1.sql` → `007_phase1_projects_achievements.sql` → `008_phase1_phonebook_contacts.sql` → `009_phase1_projects_achievements_hotfix.sql`.
- Run rollback-only DB suites `supabase/tests/phase1_acceptance.sql` and `supabase/tests/phase1_phonebook_acceptance.sql`.
- Controller then checks UI/E2E in the deploy preview.
- Only after explicit Controller PASS can promotion to production be a separate action.

## Existing Supabase test decision

Controller approved using the existing `moia-glasha` Supabase project for Phase 1 acceptance and Preview E2E. Rollback-only acceptance suites must remain transactional; no separate preview Supabase project is required for this run.

## Isolation note

Supabase database branching is unavailable on the current Free plan. For this run, Controller explicitly approved the existing `moia-glasha` project instead of creating a second project. Rollback-only acceptance suites must remain transactional and production code promotion remains a separate decision.

## Privacy gates

- VCF is parsed in the browser; raw phonebook files are never stored or sent to AI.
- Contacts are protected by Supabase RLS and are not cached by the service worker.
- Known contact commands are deterministic/Supabase-only.
- Browser speech synthesis is opt-in and blocks sensitive text such as credentials, payment/card data, passport data and full phone numbers.
