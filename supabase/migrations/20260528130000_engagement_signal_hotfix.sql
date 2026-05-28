-- ============================================================================
-- 2026-05-28 HOTFIX: engagement signal was wrong
-- ============================================================================
-- Phase 1 of the Carla Ops Manager build picked auth.users.last_sign_in_at
-- as "last_active." That field only updates on a fresh sign-in event;
-- Supabase's refresh-token model silently extends sessions for weeks.
-- Result: 8 coordinators flagged as 5-40 days stale while actively working
-- every day. Liam caught it before ship.
--
-- This migration:
--   1. Adds a home_timezone column to coordinators with PH/ET defaults.
--   2. Replaces v_coordinator_engagement with a multi-source last_active_utc
--      derived from real activity:
--         a. coordinator_activity_log    (primary, 25K+ row truth)
--         b. coordinator_daily_metrics   (My Day snapshots)
--         c. auth_tracker.updated_by     (auth edits)
--         d. patient_notes               (chart notes — uuid-keyed)
--         e. care_coord_notes            (care coord contact notes)
--         f. auth.users.last_sign_in_at  (legacy fallback only)
--   3. Computes days_inactive_local in coordinator's home_timezone instead
--      of UTC, so a Manila coordinator's "today" is counted from local
--      midnight, not UTC midnight.
--
-- Verification table at the bottom of this file shows the 8 named
-- coordinators going from old_signal=6-40 days to new_signal=0 days
-- inactive.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. home_timezone column
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE coordinators
  ADD COLUMN IF NOT EXISTS home_timezone TEXT;

UPDATE coordinators
SET home_timezone = CASE
  WHEN role IN ('care_coordinator','auth_coordinator','intake_coordinator') THEN 'Asia/Manila'
  WHEN role IN ('admin','super_admin','director','ceo') THEN 'America/New_York'
  ELSE 'America/New_York'
END
WHERE home_timezone IS NULL;

COMMENT ON COLUMN coordinators.home_timezone IS
  'IANA timezone for staleness math + display. Defaults set 2026-05-28: care/auth/intake coords = Asia/Manila, US admin = America/New_York. Editable.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. v_coordinator_engagement — multi-source last_active + TZ-aware staleness
-- ────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS v_coordinator_engagement CASCADE;

CREATE VIEW v_coordinator_engagement
WITH (security_invoker = false)
AS
WITH activity_signals AS (
  SELECT
    c.id AS coordinator_id,
    GREATEST(
      (SELECT MAX(al.created_at) FROM coordinator_activity_log al
         WHERE al.coordinator_id = c.id
            OR LOWER(TRIM(al.coordinator_name)) = LOWER(TRIM(c.full_name))),
      (SELECT MAX(m.last_updated_at) FROM coordinator_daily_metrics m
         WHERE LOWER(TRIM(m.coordinator_name)) = LOWER(TRIM(c.full_name))),
      (SELECT MAX(at.updated_at) FROM auth_tracker at
         WHERE LOWER(TRIM(at.updated_by)) = LOWER(TRIM(c.full_name))),
      (SELECT MAX(pn.created_at) FROM patient_notes pn
         WHERE pn.author_id = c.id
            OR LOWER(TRIM(pn.author_name)) = LOWER(TRIM(c.full_name))),
      (SELECT MAX(cn.updated_at) FROM care_coord_notes cn
         WHERE cn.coordinator_id = c.id
            OR LOWER(TRIM(cn.updated_by)) = LOWER(TRIM(c.full_name))),
      (SELECT u.last_sign_in_at FROM auth.users u WHERE u.id = c.user_id)
    ) AS last_active_utc,
    (SELECT u.last_sign_in_at FROM auth.users u WHERE u.id = c.user_id) AS last_sign_in_at,
    (SELECT u.email_confirmed_at FROM auth.users u WHERE u.id = c.user_id) AS email_confirmed_at
  FROM coordinators c
  WHERE c.is_active = TRUE
)
SELECT
  c.id                                            AS coordinator_id,
  c.user_id,
  c.full_name,
  c.email,
  c.role,
  c.regions,
  c.is_active,
  COALESCE(c.home_timezone, 'America/New_York')   AS home_timezone,
  s.last_active_utc,
  s.last_sign_in_at,
  s.email_confirmed_at,
  -- TZ-aware calendar-day staleness (the field EngagementAlertBanner reads)
  CASE
    WHEN s.last_active_utc IS NULL THEN NULL
    ELSE (
      ( (NOW() AT TIME ZONE COALESCE(c.home_timezone,'America/New_York'))::date )
      -
      ( (s.last_active_utc AT TIME ZONE COALESCE(c.home_timezone,'America/New_York'))::date )
    )
  END                                             AS days_inactive_local,
  -- Fractional UTC days (sortable fallback)
  CASE
    WHEN s.last_active_utc IS NULL THEN NULL
    ELSE EXTRACT(epoch FROM (NOW() - s.last_active_utc)) / 86400.0
  END                                             AS days_inactive,
  -- Legacy field; populated from sign-in only (kept for back-compat with
  -- callers that haven't moved off the old signal).
  CASE
    WHEN s.last_sign_in_at IS NULL THEN NULL
    ELSE EXTRACT(epoch FROM (NOW() - s.last_sign_in_at))::int / 86400
  END                                             AS days_since_last_login
FROM coordinators c
JOIN activity_signals s ON s.coordinator_id = c.id
WHERE c.is_active = TRUE;

REVOKE ALL ON v_coordinator_engagement FROM PUBLIC;
GRANT SELECT ON v_coordinator_engagement TO authenticated;

COMMENT ON VIEW v_coordinator_engagement IS
  '2026-05-28 hotfix: replaced auth.users.last_sign_in_at with multi-source last_active_utc derived from coordinator_activity_log (primary) + coordinator_daily_metrics + auth_tracker + patient_notes + care_coord_notes + sign-in fallback. days_inactive_local uses coordinator home_timezone for calendar-day math.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RPC unchanged in body; redeclared for clarity
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_coordinator_engagement()
RETURNS SETOF v_coordinator_engagement
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_role text;
BEGIN
  SELECT role INTO caller_role FROM coordinators WHERE user_id = auth.uid();
  IF caller_role NOT IN ('super_admin','admin','director','ceo','assoc_director') THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM v_coordinator_engagement;
END $$;

GRANT EXECUTE ON FUNCTION get_coordinator_engagement() TO authenticated;

-- ============================================================================
-- Verification (informational — captured 2026-05-28 ~13:30 UTC after apply)
-- ============================================================================
-- The 8 coordinators Liam flagged went from old_signal saying 6-40 days stale
-- to new_signal saying 0 days inactive. All confirmed active TODAY in Manila
-- local time via real coordinator_activity_log entries:
--
--   Mary Imperio (care_coordinator)     40d -> 0d   last May 28 20:48 Manila
--   Kiarra Arabejo (intake_coordinator) 40d -> 0d   last May 28 05:33 Manila
--   Gypsy Renos (care_coordinator)      36d -> 0d   last May 28 19:33 Manila
--   Gerilyn Bayson (auth_coordinator)   16d -> 0d   last May 28 20:47 Manila
--   April Manalo (care_coordinator)     14d -> 0d   last May 28 21:02 Manila
--   Jhon Padit (auth_coordinator)       14d -> 0d   last May 28 20:03 Manila
--   Ethel Camposano (auth_coordinator)   7d -> 0d   last May 28 20:23 Manila
--   Audrey Sarmiento (care_coordinator)  6d -> 0d   last May 28 21:04 Manila
--
-- Kiarra timezone-math verification:
--   last_active_utc       = 2026-05-27 21:33:18 UTC
--   in Manila TZ          = 2026-05-28 05:33  (Manila = UTC+8)
--   in ET                 = 2026-05-27 17:33  (ET = UTC-4)
--   today in Manila TZ    = 2026-05-28
--   days_inactive_local   = (2026-05-28) - (2026-05-28) = 0  CORRECT
--
-- Banner stale-coordinator list AFTER the fix: empty. Zero false positives.
