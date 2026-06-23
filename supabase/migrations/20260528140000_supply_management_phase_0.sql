-- ============================================================================
-- 2026-05-28 Supply Management section + Supply Manager KPI dashboard
-- ============================================================================
-- Phase 0: data model additions. Captures live state from Supabase apply.
--
-- Sources we keep using:
--   garment_orders   already has vendor, costs, ETA/delivery, order_type,
--                    auth fields. Add two columns (catalog flag + category).
--   census_data      active patient count for PPPM denominator.
--
-- New tables:
--   supply_monthly_plan      Earl's monthly budget plan.
--   supply_care_delays       counter-balance KPI source.
--   supply_critical_number   the quarterly priority.
-- New view:
--   v_supply_kpis_monthly    one row per month with all 6 core KPIs.
-- Page-permission moves:
--   garment-tracker          CLINICAL DEPARTMENT -> SUPPLY MANAGEMENT
--   supply-manager           new row in SUPPLY MANAGEMENT

ALTER TABLE garment_orders
  ADD COLUMN IF NOT EXISTS is_standardized_catalog BOOLEAN,
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'garment';

COMMENT ON COLUMN garment_orders.is_standardized_catalog IS
  'Whether this order item comes from the preferred/standardized catalog. NULL = not yet categorized. Drives the catalog-% KPI.';
COMMENT ON COLUMN garment_orders.category IS
  'Supply category. Defaults to garment for back-compat. Future categories: bandaging, foam, padding, accessories.';

CREATE TABLE IF NOT EXISTS supply_monthly_plan (
  year_month                 DATE PRIMARY KEY,
  planned_spend_usd          NUMERIC(12,2),
  planned_active_patients    INTEGER,
  planned_pppm               NUMERIC(8,2)
    GENERATED ALWAYS AS (
      CASE WHEN COALESCE(planned_active_patients,0) > 0
        THEN planned_spend_usd / planned_active_patients
        ELSE NULL END
    ) STORED,
  notes                      TEXT,
  set_by                     TEXT,
  set_at                     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE supply_monthly_plan ENABLE ROW LEVEL SECURITY;
CREATE POLICY supply_monthly_plan_read ON supply_monthly_plan
  FOR SELECT TO authenticated USING (true);
CREATE POLICY supply_monthly_plan_write ON supply_monthly_plan
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM coordinators c WHERE c.user_id = auth.uid()
              AND c.role IN ('super_admin','admin','director','ceo','assoc_director'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM coordinators c WHERE c.user_id = auth.uid()
              AND c.role IN ('super_admin','admin','director','ceo','assoc_director'))
  );
GRANT ALL ON supply_monthly_plan TO authenticated;

CREATE TABLE IF NOT EXISTS supply_care_delays (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delay_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  patient_name      TEXT,
  region            TEXT,
  clinician_name    TEXT,
  missing_item      TEXT NOT NULL,
  severity          TEXT NOT NULL CHECK (severity IN ('rescheduled','workaround','partial')),
  caused_visit_skip BOOLEAN DEFAULT FALSE,
  reported_by       TEXT,
  notes             TEXT,
  resolved_at       TIMESTAMPTZ,
  resolved_by       TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supply_care_delays_date ON supply_care_delays (delay_date DESC);
ALTER TABLE supply_care_delays ENABLE ROW LEVEL SECURITY;
CREATE POLICY supply_care_delays_read ON supply_care_delays
  FOR SELECT TO authenticated USING (true);
CREATE POLICY supply_care_delays_write ON supply_care_delays
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON supply_care_delays TO authenticated;

CREATE TABLE IF NOT EXISTS supply_critical_number (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter_start   DATE NOT NULL UNIQUE,
  quarter_label   TEXT NOT NULL,
  title           TEXT NOT NULL,
  baseline_value  TEXT,
  target_value    TEXT,
  measure_unit    TEXT,
  status          TEXT DEFAULT 'in_progress',
  set_by          TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE supply_critical_number ENABLE ROW LEVEL SECURITY;
CREATE POLICY supply_critical_number_read ON supply_critical_number
  FOR SELECT TO authenticated USING (true);
CREATE POLICY supply_critical_number_write ON supply_critical_number
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM coordinators c WHERE c.user_id = auth.uid()
              AND c.role IN ('super_admin','admin','director','ceo','assoc_director'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM coordinators c WHERE c.user_id = auth.uid()
              AND c.role IN ('super_admin','admin','director','ceo','assoc_director'))
  );
GRANT ALL ON supply_critical_number TO authenticated;

INSERT INTO supply_critical_number (quarter_start, quarter_label, title, baseline_value, target_value, measure_unit, set_by)
VALUES ('2026-07-01', 'Q3 2026',
        'Move standardized-catalog spend to 85% with zero supply-caused care delays',
        'unknown - start measuring', '85% standardized + 0 care delays',
        '% standardized', 'Liam OBrien')
ON CONFLICT (quarter_start) DO NOTHING;

DROP VIEW IF EXISTS v_supply_kpis_monthly CASCADE;
CREATE VIEW v_supply_kpis_monthly AS
WITH months AS (
  SELECT generate_series(
    date_trunc('month', NOW() - INTERVAL '11 months')::date,
    date_trunc('month', NOW())::date,
    INTERVAL '1 month'
  )::date AS month_start
),
orders AS (
  SELECT
    date_trunc('month', COALESCE(order_placed_date::timestamptz, created_at))::date AS month_start,
    *
  FROM garment_orders
  WHERE COALESCE(order_placed_date, created_at::date) >= (NOW() - INTERVAL '12 months')::date
),
delays AS (
  SELECT date_trunc('month', delay_date)::date AS month_start, *
  FROM supply_care_delays
  WHERE delay_date >= (NOW() - INTERVAL '12 months')::date
),
active_patients AS (
  SELECT COUNT(*)::int AS cnt
  FROM census_data
  WHERE status ILIKE '%active%'
),
visit_counts AS (
  SELECT date_trunc('month', visit_date)::date AS month_start,
         COUNT(*) AS scheduled
  FROM visit_schedule_data
  WHERE visit_date >= (NOW() - INTERVAL '12 months')::date
  GROUP BY 1
)
SELECT
  m.month_start,
  TO_CHAR(m.month_start, 'Mon YYYY')                                  AS month_label,
  COALESCE(SUM(o.garment_cost), 0)::numeric(12,2)                     AS total_spend_usd,
  COUNT(o.id)                                                         AS order_count,
  ap.cnt                                                              AS active_patients_snapshot,
  CASE WHEN ap.cnt > 0
       THEN (COALESCE(SUM(o.garment_cost), 0) / ap.cnt)::numeric(10,2)
       ELSE NULL END                                                  AS pppm_usd,
  COUNT(o.id) FILTER (WHERE o.vendor_eta_date IS NOT NULL AND o.delivery_date IS NOT NULL) AS otif_denom,
  COUNT(o.id) FILTER (WHERE o.vendor_eta_date IS NOT NULL AND o.delivery_date IS NOT NULL AND o.delivery_date <= o.vendor_eta_date) AS otif_numer,
  CASE WHEN COUNT(o.id) FILTER (WHERE o.vendor_eta_date IS NOT NULL AND o.delivery_date IS NOT NULL) > 0
       THEN (100.0 * COUNT(o.id) FILTER (WHERE o.vendor_eta_date IS NOT NULL AND o.delivery_date IS NOT NULL AND o.delivery_date <= o.vendor_eta_date)
             / NULLIF(COUNT(o.id) FILTER (WHERE o.vendor_eta_date IS NOT NULL AND o.delivery_date IS NOT NULL), 0))::numeric(5,1)
       ELSE NULL END                                                  AS otif_pct,
  COUNT(o.id) FILTER (WHERE LOWER(o.order_type) = 'initial garment') AS accurate_count,
  CASE WHEN COUNT(o.id) > 0
       THEN (100.0 * COUNT(o.id) FILTER (WHERE LOWER(o.order_type) = 'initial garment') / COUNT(o.id))::numeric(5,1)
       ELSE NULL END                                                  AS accuracy_pct,
  COUNT(o.id) FILTER (WHERE o.auth_needed = TRUE) AS auth_required_count,
  CASE WHEN COUNT(o.id) FILTER (WHERE o.auth_needed = TRUE) > 0
       THEN (100.0 * COUNT(o.id) FILTER (WHERE o.auth_needed = TRUE AND o.auth_number IS NOT NULL AND length(o.auth_number) > 0)
             / NULLIF(COUNT(o.id) FILTER (WHERE o.auth_needed = TRUE), 0))::numeric(5,1)
       ELSE NULL END                                                  AS doc_compliance_pct,
  COUNT(o.id) FILTER (WHERE o.is_standardized_catalog IS NOT NULL) AS categorized_count,
  CASE WHEN COUNT(o.id) FILTER (WHERE o.is_standardized_catalog IS NOT NULL) > 0
       THEN (100.0 * COUNT(o.id) FILTER (WHERE o.is_standardized_catalog = TRUE)
             / NULLIF(COUNT(o.id) FILTER (WHERE o.is_standardized_catalog IS NOT NULL), 0))::numeric(5,1)
       ELSE NULL END                                                  AS standardized_catalog_pct,
  pl.planned_spend_usd,
  CASE WHEN pl.planned_spend_usd IS NOT NULL AND pl.planned_spend_usd > 0
       THEN (100.0 * (COALESCE(SUM(o.garment_cost), 0) - pl.planned_spend_usd) / pl.planned_spend_usd)::numeric(5,1)
       ELSE NULL END                                                  AS budget_variance_pct,
  COALESCE((SELECT COUNT(*) FROM delays d WHERE d.month_start = m.month_start), 0) AS care_delays_count,
  COALESCE(vc.scheduled, 0) AS scheduled_visits,
  CASE WHEN COALESCE(vc.scheduled, 0) > 0
       THEN (100.0 * COALESCE((SELECT COUNT(*) FROM delays d WHERE d.month_start = m.month_start), 0) / vc.scheduled)::numeric(5,2)
       ELSE NULL END                                                  AS care_delay_rate_pct
FROM months m
CROSS JOIN active_patients ap
LEFT JOIN orders o ON o.month_start = m.month_start
LEFT JOIN supply_monthly_plan pl ON pl.year_month = m.month_start
LEFT JOIN visit_counts vc ON vc.month_start = m.month_start
GROUP BY m.month_start, ap.cnt, pl.planned_spend_usd, vc.scheduled
ORDER BY m.month_start;

GRANT SELECT ON v_supply_kpis_monthly TO authenticated;

UPDATE page_permissions
SET page_section = 'SUPPLY MANAGEMENT'
WHERE page_key = 'garment-tracker';

INSERT INTO page_permissions
  (page_key, page_label, page_section,
   super_admin, admin, regional_manager, assoc_director, sort_order)
VALUES
  ('supply-manager', 'Supply Manager',  'SUPPLY MANAGEMENT', TRUE, TRUE, TRUE, TRUE, 10)
ON CONFLICT (page_key) DO UPDATE
  SET page_label   = EXCLUDED.page_label,
      page_section = EXCLUDED.page_section,
      super_admin  = EXCLUDED.super_admin,
      admin        = EXCLUDED.admin,
      regional_manager = EXCLUDED.regional_manager,
      assoc_director   = EXCLUDED.assoc_director,
      sort_order   = EXCLUDED.sort_order;
