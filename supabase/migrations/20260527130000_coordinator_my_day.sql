-- 2026-05-27 — My Day page for auth coordinators
--
-- Adds a daily-zero metric system: each coordinator's open tasks are snapshotted
-- on first page load of the day, and the page shows "X of Y cleared today" so the
-- team has a concrete daily target.
--
-- Task sources (combined virtually in the frontend, not joined here):
--   1. auth_renewal_tasks WHERE assigned_to=me AND task_status IN ('open','in_progress')
--   2. auth_tracker       WHERE assigned_to=me AND auth_status   IN ('pending','submitted')
--   3. auth_tracker       WHERE assigned_to=me AND auth_health   IN ('over_limit','low_visits')
--   4. auth_tracker       WHERE assigned_to=me AND auth_expiry_date <= today+7 AND auth_health != 'exhausted'
--
-- Snapshot stores the EXACT task key set open at start-of-day, not just a count.
-- This lets the frontend compute precise set-based diffs:
--   cleared_today          = |start_task_keys \ current_keys|     (started open, now closed)
--   remaining_from_morning = |start_task_keys ∩ current_keys|     (started open, still open)
--   new_today              = |current_keys \ start_task_keys|     (arrived after first load)
--
-- Approximate "start_count - current_count" math was rejected by Liam: when new
-- tasks arrive mid-day the simple subtraction undercounts what was actually
-- worked. Exact set diff is auditable and gameable-resistant.
--
-- Task key format (composite, stable across reloads):
--   'rt:<auth_renewal_tasks.id>'   for renewal tasks
--   'at:<auth_tracker.id>'         for auth_tracker rows

-- ── Snapshot table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coordinator_daily_metrics (
  id                  BIGSERIAL PRIMARY KEY,
  coordinator_name    TEXT      NOT NULL,
  snapshot_date       DATE      NOT NULL DEFAULT CURRENT_DATE,
  -- Authoritative source for the daily-zero metric:
  start_task_keys     TEXT[]    NOT NULL DEFAULT '{}',
  -- Denormalized counts for fast trend queries without unnesting the array:
  start_count         INTEGER   NOT NULL DEFAULT 0,
  start_critical      INTEGER   NOT NULL DEFAULT 0,
  start_high          INTEGER   NOT NULL DEFAULT 0,
  start_normal        INTEGER   NOT NULL DEFAULT 0,
  snapshot_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_at     TIMESTAMPTZ,
  -- one snapshot per coordinator per day
  UNIQUE (coordinator_name, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_coordinator_daily_metrics_lookup
  ON coordinator_daily_metrics(coordinator_name, snapshot_date DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Coordinators can read/write their own row only; super_admin/admin/director
-- can read all rows (for trend/management view, not implemented yet but the
-- policy permits it). Match the assigned_to text against the profile name.

ALTER TABLE coordinator_daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY coordinator_daily_metrics_select ON coordinator_daily_metrics
  FOR SELECT
  USING (
    -- privileged roles see everything
    EXISTS (
      SELECT 1 FROM coordinators p
      WHERE p.user_id = auth.uid()
        AND p.role IN ('super_admin','director','admin','ceo','assoc_director','regional_manager','pod_leader')
    )
    -- or the coordinator sees their own
    OR EXISTS (
      SELECT 1 FROM coordinators p
      WHERE p.user_id = auth.uid()
        AND (p.full_name = coordinator_daily_metrics.coordinator_name
             OR p.email   = coordinator_daily_metrics.coordinator_name)
    )
  );

CREATE POLICY coordinator_daily_metrics_insert ON coordinator_daily_metrics
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM coordinators p
      WHERE p.user_id = auth.uid()
        AND (p.full_name = coordinator_daily_metrics.coordinator_name
             OR p.email   = coordinator_daily_metrics.coordinator_name)
    )
  );

CREATE POLICY coordinator_daily_metrics_update ON coordinator_daily_metrics
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM coordinators p
      WHERE p.user_id = auth.uid()
        AND (p.full_name = coordinator_daily_metrics.coordinator_name
             OR p.email   = coordinator_daily_metrics.coordinator_name)
    )
  );

-- ── Page permissions ────────────────────────────────────────────────────────
-- Insert 'my-day' as the FIRST entry in the AUTHORIZATION section so it lands
-- at the top of the sidebar for auth coordinators. Sort order picks a value
-- below the existing auth-coordinator entry to slot above it.

-- Find current min sort_order in AUTHORIZATION and slot 1 below it.
-- Note: there is no `ceo` column on page_permissions; the CEO role maps to
-- super_admin permissions at runtime via useAuth.jsx, so we don't grant it
-- separately here.
INSERT INTO page_permissions (
  page_key, page_label, page_section, sort_order,
  super_admin, admin, regional_manager, pod_leader,
  auth_coordinator, intake_coordinator, care_coordinator, clinician, team_member, assoc_director, telehealth
)
SELECT
  'my-day',
  'My Day',
  'AUTHORIZATION',
  COALESCE((SELECT MIN(sort_order) FROM page_permissions WHERE page_section = 'AUTHORIZATION'), 100) - 1,
  TRUE,  -- super_admin (also covers CEO at runtime)
  TRUE,  -- admin (Carla — Operations Manager)
  FALSE, -- regional_manager
  FALSE, -- pod_leader
  TRUE,  -- auth_coordinator (the primary audience)
  FALSE, FALSE, FALSE, FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM page_permissions WHERE page_key = 'my-day'
);

-- ── Verification ────────────────────────────────────────────────────────────
-- After applying:
--   SELECT page_key, page_label, page_section, sort_order, auth_coordinator
--     FROM page_permissions WHERE page_section='AUTHORIZATION' ORDER BY sort_order;
--
-- Should show 'my-day' at the top with auth_coordinator=TRUE.
