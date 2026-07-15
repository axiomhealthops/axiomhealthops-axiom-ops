-- 20260714120400_payroll_lockdown_super_admin_only.sql
--
-- Lock all payroll surface area (5 public.payroll_* tables + 16 mirror.*
-- tables + 2 page_permissions rows) to super_admin only per Liam 2026-07-14.
--
-- Rationale: Dustin (CEO), Carla, Ashley, and Randi carry the 'admin' role
-- in coordinators. The variance/audit layer inspects Dustin's own payroll
-- portal - he shouldn't have read access to the tool auditing him, and
-- Ops mgmt doesn't need it until Liam explicitly opens access via User
-- Management.
--
-- Applied to production via Supabase MCP apply_migration on 2026-07-14.

-- (1) Public payroll tables
DROP POLICY IF EXISTS "admin_or_above all" ON public.payroll_periods;
DROP POLICY IF EXISTS "admin_or_above all" ON public.payroll_reviews;
DROP POLICY IF EXISTS "admin_or_above all" ON public.payroll_flag_rules;
DROP POLICY IF EXISTS "admin_or_above all" ON public.visit_duration_assumptions;
DROP POLICY IF EXISTS "admin_or_above all" ON public.clinician_payroll_map;

CREATE POLICY "super_admin all" ON public.payroll_periods
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY "super_admin all" ON public.payroll_reviews
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY "super_admin all" ON public.payroll_flag_rules
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY "super_admin all" ON public.visit_duration_assumptions
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY "super_admin all" ON public.clinician_payroll_map
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- (2) Mirror tables
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employees','employment_types','roles','visit_types','rate_matrix','settings',
    'hours_entries','mileage_submissions','expenses','visits','bonus_approvals',
    'payroll_overrides','payroll_periods','imports','snapshot_run','audit_events'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "admin_or_above read" ON mirror.%I', t);
    EXECUTE format(
      'CREATE POLICY "super_admin read" ON mirror.%I FOR SELECT TO authenticated USING (public.is_super_admin())',
      t
    );
  END LOOP;
END $$;

-- (3) page_permissions - flip all non-super_admin flags to FALSE for both pages
UPDATE public.page_permissions
   SET admin = FALSE,
       assoc_director = FALSE,
       regional_manager = FALSE,
       pod_leader = FALSE,
       team_member = FALSE,
       auth_coordinator = FALSE,
       intake_coordinator = FALSE,
       care_coordinator = FALSE,
       clinician = FALSE,
       telehealth = FALSE
 WHERE page_key IN ('payroll-review','payroll-settings');

-- (4) Remove any per-user overrides for non-super_admins
DELETE FROM public.user_page_overrides o
 USING public.coordinators c
 WHERE o.coordinator_id = c.id
   AND o.page_key IN ('payroll-review','payroll-settings')
   AND c.role <> 'super_admin';
