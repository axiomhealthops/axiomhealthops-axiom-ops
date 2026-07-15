-- 20260714120100_payroll_public_tables_rls.sql
--
-- Close the RLS gap on the 5 public.payroll_* tables. Supabase advisory
-- flagged them fully exposed to the anon key (no policies, RLS off).
--
-- Superseded later this same day by 20260714120400 which tightens the gate
-- from is_admin_or_above() to is_super_admin(). This file is the historical
-- record of the intermediate posture.
--
-- Applied to production via Supabase MCP apply_migration on 2026-07-14.

ALTER TABLE public.payroll_periods              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_reviews              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_flag_rules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_duration_assumptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinician_payroll_map        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_or_above all" ON public.payroll_periods
  FOR ALL TO authenticated
  USING (public.is_admin_or_above())
  WITH CHECK (public.is_admin_or_above());

CREATE POLICY "admin_or_above all" ON public.payroll_reviews
  FOR ALL TO authenticated
  USING (public.is_admin_or_above())
  WITH CHECK (public.is_admin_or_above());

CREATE POLICY "admin_or_above all" ON public.payroll_flag_rules
  FOR ALL TO authenticated
  USING (public.is_admin_or_above())
  WITH CHECK (public.is_admin_or_above());

CREATE POLICY "admin_or_above all" ON public.visit_duration_assumptions
  FOR ALL TO authenticated
  USING (public.is_admin_or_above())
  WITH CHECK (public.is_admin_or_above());

CREATE POLICY "admin_or_above all" ON public.clinician_payroll_map
  FOR ALL TO authenticated
  USING (public.is_admin_or_above())
  WITH CHECK (public.is_admin_or_above());
