-- 20260714120300_visit_duration_assumptions_pariox_patterns.sql
--
-- Expand visit_duration_assumptions with the Pariox event_type shapes we
-- actually see in visit_schedule_data. Patterns use ILIKE-friendly wildcards
-- so the reconciliation engine can match longest-pattern-first, falling back
-- to 'default'.
--
-- Original seed had only Attempted / Cancelled / default. That missed Missed,
-- eval/assessment/discharge, wound-care, treatment, and maintenance variants.
--
-- 60-min minimum locked per Liam 2026-06-02.
--
-- Applied to production via Supabase MCP apply_migration on 2026-07-14.

INSERT INTO public.visit_duration_assumptions
  (event_pattern, minutes, notes, is_active)
VALUES
  ('%Cancelled%',           0, 'Any cancellation variant. Includes "Cancelled Treatment", cancelled evals, etc.', true),
  ('%Attempted%',           0, 'Attempted but not completed.', true),
  ('%Missed%',              0, 'Missed visits - patient or staff no-show.', true),

  ('%Evaluation%',          60, 'Initial evaluations. 60-min minimum locked per Liam 2026-06-02.', true),
  ('%Assessment%',          60, 'Reassessments / assessment visits.', true),
  ('%Discharge%',           60, 'Discharge visits.', true),
  ('%Wound%',               60, 'Wound-care visits. Time same as normal; $ bump handled by settings/woundCareBump.', true),
  ('%Treatment%',           60, 'Standard treatment visits (Maintenance, Level 1-5 treatments).', true),
  ('%Maintenance%',         60, 'Maintenance program visits.', true),

  ('default',               60, 'Fallback minimum. Matches when no other pattern hits. Q3 locked at 60-min per Liam 2026-06-02.', true)

ON CONFLICT (event_pattern) DO UPDATE
SET minutes = EXCLUDED.minutes,
    notes = EXCLUDED.notes,
    is_active = EXCLUDED.is_active,
    updated_at = now();
