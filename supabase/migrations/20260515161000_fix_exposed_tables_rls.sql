-- =====================================================================
-- Migration: 20260515161000_fix_exposed_tables_rls.sql
-- Purpose : Plug anon-key data exposure on two tables flagged by
--           Supabase's security advisor as having Row-Level Security
--           disabled.
-- Author  : Liam O'Brien (Director of Operations) via foundation rebuild
-- Created : 2026-05-15
--
-- BACKGROUND
-- ----------
-- Supabase advisor flagged these two tables as critical:
--
--   public.daily_ops_reports          (27 rows, Admin-readable ops data)
--   public.coordinator_overload_alerts (0 rows, Admin-readable view)
--
-- With RLS disabled, both tables were readable AND writable by anyone
-- holding the public anon key — which is shipped in the frontend
-- JavaScript bundle and is therefore effectively public. Anyone who
-- knows the Supabase URL (visible in any network request from the live
-- dashboard) could query or modify these tables from a browser console.
--
-- POLICY APPROACH (TEMPORARY)
-- ---------------------------
-- This migration follows the EXISTING pattern used elsewhere in the
-- schema: an is_active_coordinator() gate that allows access to any
-- user with an active row in public.coordinators. This is intentionally
-- BROADER than the long-term intent (these tables should ultimately be
-- restricted to Admin role only), but it has two advantages today:
--
--   1. It matches the pattern every other protected table uses, so the
--      live app's existing data-fetching code continues to work without
--      modification.
--   2. It plugs the public-anon-key hole immediately. Anyone NOT in the
--      coordinators table loses all access — which is the actual fix
--      the advisor was demanding.
--
-- The "(temp - tighten to admin only)" suffix on the policy name is a
-- deliberate breadcrumb for the next maintainer (probably us in a
-- couple of weeks). When the is_admin() helper function is built as
-- part of the AD/TM dashboard rollout, a follow-up migration should
-- DROP these policies and replace them with admin-only ones.
--
-- ROLLBACK PLAN
-- -------------
-- If this migration causes the live Admin view to break (it shouldn't,
-- because Admin users are coordinators with is_active=true), the
-- rollback SQL is at the bottom of this file in a comment block.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- daily_ops_reports
-- ---------------------------------------------------------------------
ALTER TABLE public.daily_ops_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active coordinators full access (temp - tighten to admin only)"
  ON public.daily_ops_reports
  FOR ALL
  TO authenticated
  USING (is_active_coordinator())
  WITH CHECK (is_active_coordinator());

COMMENT ON POLICY "Active coordinators full access (temp - tighten to admin only)"
  ON public.daily_ops_reports
  IS 'Temporary access gate matching existing schema pattern. Per business rules, this table is intended to be Admin-only. Replace with is_admin() check when that helper function is built. Tracked: feature/foundation-rls-fix branch, May 2026.';

-- ---------------------------------------------------------------------
-- coordinator_overload_alerts
-- ---------------------------------------------------------------------
ALTER TABLE public.coordinator_overload_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active coordinators full access (temp - tighten to admin only)"
  ON public.coordinator_overload_alerts
  FOR ALL
  TO authenticated
  USING (is_active_coordinator())
  WITH CHECK (is_active_coordinator());

COMMENT ON POLICY "Active coordinators full access (temp - tighten to admin only)"
  ON public.coordinator_overload_alerts
  IS 'Temporary access gate matching existing schema pattern. Per business rules, this table is intended to be Admin-only. Replace with is_admin() check when that helper function is built. Tracked: feature/foundation-rls-fix branch, May 2026.';

COMMIT;

-- =====================================================================
-- ROLLBACK (do not run unless intentional)
-- =====================================================================
-- BEGIN;
--   DROP POLICY IF EXISTS "Active coordinators full access (temp - tighten to admin only)"
--     ON public.daily_ops_reports;
--   ALTER TABLE public.daily_ops_reports DISABLE ROW LEVEL SECURITY;
--
--   DROP POLICY IF EXISTS "Active coordinators full access (temp - tighten to admin only)"
--     ON public.coordinator_overload_alerts;
--   ALTER TABLE public.coordinator_overload_alerts DISABLE ROW LEVEL SECURITY;
-- COMMIT;
-- =====================================================================
