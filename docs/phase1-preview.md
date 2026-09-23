# LIFE OS Phase 1 — Preview Gate

This branch is preview-only.

- Source branch: `feature/glasha-life-os`
- Production branch must not be changed before Controller live E2E.
- Netlify deploy-preview is intentionally isolated from the production Supabase project.
- Apply `supabase/migrations/006_life_os_phase1.sql` only to the preview/test database first.
- Run `supabase/tests/phase1_acceptance.sql` against preview/test before Controller UI E2E.
- After Controller PASS, promotion to production remains a separate explicit action.
