-- 2026-05-27 — Auth Team Audit
-- Relabel the four AUTHORIZATION sidebar entries from noun-oriented names
-- ("Auth Dashboard", "Auth Tracker") to job-task-oriented names that tell
-- a coordinator WHEN to use each page. See supabase/migrations/README_auth_team_audit_2026_05_27.md
-- for context.

-- ── Sidebar label updates ────────────────────────────────────────────────
UPDATE page_permissions SET page_label = 'My Auth Queue'
  WHERE page_key = 'auth-coordinator';

UPDATE page_permissions SET page_label = 'All Authorizations'
  WHERE page_key = 'auth';

UPDATE page_permissions SET page_label = 'Compliance: Over Limit'
  WHERE page_key = 'auth-over-limit';

UPDATE page_permissions SET page_label = 'Renewal Tasks'
  WHERE page_key = 'auth-renewals';

-- ── Verification ─────────────────────────────────────────────────────────
-- After applying, the AUTHORIZATION sidebar section should display:
--   👩‍💼  My Auth Queue
--   🔐  All Authorizations
--   🚨  Compliance: Over Limit
--   🔄  Renewal Tasks
-- in that order (depends on existing sort_order — not changed by this migration).
