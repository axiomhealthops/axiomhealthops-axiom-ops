-- 20260714120200_payroll_flag_rules_correct_categories.sql
--
-- Rewrite the 7 original flag rules with descriptions that reference the
-- ACTUAL Firestore category enum from Dustin's spec (PAYROLL_PORTAL_SPEC.md §2.2):
--   Regular | Overtime | Vacation/PTO | Training | Meaningful Work |
--   Meetings | Documentation | Level Pay | Bonus | Other
-- The original seed wrote "PTO" / "OT" which don't match anything in the
-- portal and would cause silent match misses in the variance engine.
--
-- Also add 7 NEW rules unlocked by having the full spec:
--   - expense_no_receipt          (>800KB receipt dropped by portal)
--   - mileage_reimbursement_drift (snapshot vs recomputed pay divergence)
--   - post_close_mutation         (edits inside a paid period; audit_events driven)
--   - override_present            (payrollOverrides row exists for period)
--   - paid_period_unmarked        (audit_events: payrollPeriods deletion)
--   - bonus_period_mismatch       (bonus period doesn't match a payrollPeriod)
--   - hours_source_register_only  (day-level variance unreliable for register-only)
--
-- Applied to production via Supabase MCP apply_migration on 2026-07-14.

INSERT INTO public.payroll_flag_rules
  (rule_key, name, description, threshold, severity, is_active)
VALUES
  ('hours_variance_high',
   'High hours variance',
   'Approved Regular + Overtime hoursEntries exceed (approved non-MileagePortal visits x 60min) by >= variance_pct. Non-clinical categories (Vacation/PTO, Training, Meaningful Work, Meetings, Documentation, Level Pay, Bonus, Other) are subtracted from expected before comparison.',
   '{"variance_pct": 20}'::jsonb,
   'hard', true),

  ('pto_with_visits_same_day',
   'Vacation/PTO + completed visits same day',
   'A Vacation/PTO hoursEntry on a day where the clinician has at least one approved visit. Only reliable when the Vacation/PTO entry came from a Time Card import (register imports collapse all lines to the pay-period-end date).',
   '{}'::jsonb,
   'hard', true),

  ('mileage_no_visits',
   'Mileage without visits',
   'Approved mileageSubmission for a week where the clinician has zero approved non-MileagePortal visits.',
   '{}'::jsonb,
   'hard', true),

  ('ot_no_volume',
   'Overtime without volume',
   'Any Overtime hoursEntry AND week-over-week approved-visit change <= wow_change_pct.',
   '{"wow_change_pct": 0}'::jsonb,
   'hard', true),

  ('zero_visits_no_leave',
   'Zero visits, no leave, no training',
   'Zero approved visits AND zero Vacation/PTO, Training, Meaningful Work, or Meetings hours in the pay period.',
   '{}'::jsonb,
   'hard', true),

  ('mileage_outlier',
   'Mileage outlier',
   'Approved mileageSubmission totalMiles > multiplier x the clinicians rolling_weeks median.',
   '{"multiplier": 2, "rolling_weeks": 8}'::jsonb,
   'soft', true),

  ('unverified_visits',
   'Unverified visits',
   'Approved visits with verified <> ''Verified'' contribute to revenue calc.',
   '{}'::jsonb,
   'soft', true),

  -- New audit-trail-driven rules
  ('expense_no_receipt',
   'Approved expense with lost receipt',
   'expense.status = approved AND fileTooBig = true (portal drops the >800KB base64; receipt image not recoverable).',
   '{}'::jsonb,
   'hard', true),

  ('mileage_reimbursement_drift',
   'Mileage reimbursement drift',
   'Portal-recomputed mileage pay (totalMiles x employee.mileageRate or default) differs from mileageSubmissions.reimbursement (submit-time snapshot) by >= drift_dollars.',
   '{"drift_dollars": 5}'::jsonb,
   'soft', true),

  ('post_close_mutation',
   'Mutation inside a paid period',
   'Any audit_events row with in_paid_period = true. Dustins app does NOT lock paid periods; nightly diff is the only way to detect edits after close.',
   '{}'::jsonb,
   'hard', true),

  ('override_present',
   'Payroll override recorded',
   'A payrollOverrides row exists for (employee, period). Not always a red flag but always audit-worthy - a human hand-set a computed cell.',
   '{}'::jsonb,
   'soft', true),

  ('paid_period_unmarked',
   'Paid-period marker deleted',
   'audit_events with collection=payrollPeriods AND event_type=deleted. Someone unmarked a period; the paid-history audit trail is gone unless we have the prior snapshot.',
   '{}'::jsonb,
   'hard', true),

  ('bonus_period_mismatch',
   'Bonus period does not match payroll period',
   'bonusApproval.payPeriodFrom/To does not exactly match any payrollPeriods doc ID. Portal will silently skip payout on approved bonuses when the tuple doesnt match.',
   '{}'::jsonb,
   'hard', true),

  ('hours_source_register_only',
   'Hours from Paylocity register only',
   'All hoursEntries for the period have source=paylocity (register import). Register imports stamp every line with the pay-period END date, so day-level variance checks are unreliable. Informational.',
   '{}'::jsonb,
   'soft', true)

ON CONFLICT (rule_key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    threshold = EXCLUDED.threshold,
    severity = EXCLUDED.severity,
    is_active = EXCLUDED.is_active,
    updated_at = now();
