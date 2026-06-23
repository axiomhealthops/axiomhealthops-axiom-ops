-- 20260623121000_base44_kpi_views.sql
--
-- KPI views over the ahmops.com (base44) order mirror. These power Earl's
-- Supply Manager dashboard and the new Stuck Orders intervention page.
--
-- All views are read-only and computed at query time. Materialized views
-- aren't needed yet given the volume (15-50 orders/day, multi-month
-- aggregations under 10k rows).

-- ============================================================
-- v_base44_order_spend  -- per-order vendor spend with inventory split
-- ============================================================
-- Critical math: vendor_spend_usd EXCLUDES portions fulfilled from on-hand
-- stock. That's the right number for PPPM because inventory pulls are not
-- new procurement spend.
--
-- Edge case: when unit_cost is NULL (catalog item without a recorded price),
-- the line contributes 0 to vendor_spend. extended_cost is kept separately
-- as a "gross" reference number.

CREATE OR REPLACE VIEW public.v_base44_order_spend AS
SELECT
  o.external_id                                                AS order_external_id,
  o.created_at_base44,
  o.status,
  o.order_type,
  o.region,
  o.submitted_by_name,
  o.submitted_by_email,
  o.fulfillment_hub,
  o.patient_name,
  o.patient_external_id,
  COALESCE(SUM(i.extended_cost_usd), 0)                        AS gross_spend_usd,
  COALESCE(
    SUM(GREATEST(COALESCE(i.quantity,0) - COALESCE(i.qty_from_inventory,0), 0) * COALESCE(i.unit_cost_usd,0)),
    0
  )                                                            AS vendor_spend_usd,
  COALESCE(
    SUM(COALESCE(i.qty_from_inventory,0) * COALESCE(i.unit_cost_usd,0)),
    0
  )                                                            AS inventory_pull_value_usd,
  COUNT(i.external_id)                                         AS line_count
FROM public.base44_orders o
LEFT JOIN public.base44_order_items i
  ON i.order_external_id = o.external_id
GROUP BY o.external_id;

COMMENT ON VIEW public.v_base44_order_spend IS
  'Per-order spend rollup. vendor_spend_usd is the right number for PPPM (excludes inventory pulls). gross_spend_usd is the visible total for cross-checking against the base44 UI.';

-- ============================================================
-- v_base44_pppm_monthly  -- monthly PPPM driven by base44 mirror
-- ============================================================
-- Active patient denominator comes from public.census_data: count of distinct
-- patients with status in 'Active' / 'Active - Auth Pending' / 'Active -
-- Auth Renewal' as of the last day of the month. (We use the latest census
-- snapshot that falls within or just before month-end.)
--
-- Months with no base44 data show NULL pppm; the React layer renders that
-- as "Awaiting first sync" instead of "$0".

CREATE OR REPLACE VIEW public.v_base44_pppm_monthly AS
WITH spend AS (
  SELECT
    date_trunc('month', created_at_base44)::date AS month_start,
    SUM(vendor_spend_usd)                        AS vendor_spend_usd,
    SUM(gross_spend_usd)                         AS gross_spend_usd,
    SUM(inventory_pull_value_usd)                AS inventory_pull_value_usd,
    COUNT(*)                                     AS order_count
  FROM public.v_base44_order_spend
  GROUP BY 1
),
patients AS (
  -- census_data is a rolling table; last_seen_date is the most recent upload
  -- that included the patient. Active patient count for a month = distinct
  -- patients whose last_seen_date fell in that month with Active-like status.
  -- This is approximate but stable -- exact mid-month census doesn't exist
  -- as a stored field, only the rolling last-seen view.
  SELECT
    date_trunc('month', last_seen_date)::date                AS month_start,
    COUNT(DISTINCT patient_name) FILTER (WHERE status ILIKE 'Active%')
                                                             AS active_patient_count
  FROM public.census_data
  WHERE last_seen_date IS NOT NULL
  GROUP BY 1
)
SELECT
  COALESCE(s.month_start, p.month_start)                       AS month_start,
  s.vendor_spend_usd,
  s.gross_spend_usd,
  s.inventory_pull_value_usd,
  s.order_count,
  p.active_patient_count,
  CASE WHEN p.active_patient_count > 0
       THEN ROUND(s.vendor_spend_usd / p.active_patient_count, 2)
       ELSE NULL END                                           AS pppm_usd
FROM spend s
FULL OUTER JOIN patients p USING (month_start)
ORDER BY month_start DESC;

COMMENT ON VIEW public.v_base44_pppm_monthly IS
  'Monthly PPPM from the base44 mirror. Active patient denominator is the latest census snapshot per month. pppm_usd is NULL when census or spend is missing -- never coerce to 0 in the UI.';

-- ============================================================
-- v_base44_stuck_orders  -- intervention surface
-- ============================================================
-- Per base44 status, surface orders that have been sitting past the SLA:
--   New             : > 1 day        (clinician submitted, no one picked up)
--   In Progress     : > 3 days       (started but not sent to vendor)
--   Ordered         : > 7 days       (sent to vendor, no Ready for Pickup)
--   Ready for Pickup: > 2 days       (at hub, not delivered to patient)
--
-- These thresholds are first-cut. They live in a CASE expression here so we
-- can tune them with a one-line ALTER VIEW.

CREATE OR REPLACE VIEW public.v_base44_stuck_orders AS
WITH base AS (
  SELECT
    o.*,
    COALESCE(o.last_status_change_at, o.created_at_base44) AS reference_at
  FROM public.base44_orders o
  WHERE o.status IN ('New','In Progress','Ordered','Ready for Pickup')
),
sla AS (
  SELECT
    b.*,
    EXTRACT(EPOCH FROM (now() - b.reference_at)) / 86400.0 AS days_in_status,
    CASE b.status
      WHEN 'New'              THEN 1
      WHEN 'In Progress'      THEN 3
      WHEN 'Ordered'          THEN 7
      WHEN 'Ready for Pickup' THEN 2
    END                                                   AS sla_days
  FROM base b
)
SELECT
  external_id,
  status,
  order_type,
  region,
  submitted_by_name,
  submitted_by_email,
  fulfillment_hub,
  patient_name,
  created_at_base44,
  last_status_change_at,
  reference_at,
  ROUND(days_in_status::numeric, 1) AS days_in_status,
  sla_days,
  ROUND((days_in_status - sla_days)::numeric, 1) AS days_overdue
FROM sla
WHERE days_in_status > sla_days
ORDER BY (days_in_status - sla_days) DESC;

COMMENT ON VIEW public.v_base44_stuck_orders IS
  'Orders past their per-stage SLA. Powers the Stuck Orders intervention page. SLA thresholds: New 1d, In Progress 3d, Ordered 7d, Ready for Pickup 2d.';

-- ============================================================
-- v_base44_vendor_otif  -- vendor on-time-in-full latency view
-- ============================================================
-- Latency from "Ordered" -> "Delivered". We approximate the "Ordered at"
-- timestamp from status_history if present; otherwise from last_status_change_at
-- on orders currently Delivered. This is a best-effort metric until base44
-- exposes per-status timestamps consistently.
--
-- Coverage caveat: only Delivered orders contribute. In-flight orders have
-- no terminal latency yet and are excluded.

CREATE OR REPLACE VIEW public.v_base44_vendor_otif AS
WITH ordered_at AS (
  SELECT
    o.external_id,
    o.region,
    o.order_type,
    o.created_at_base44,
    o.last_status_change_at,
    -- Try status_history first; fall back to created_at_base44 if absent
    COALESCE(
      (
        SELECT (entry->>'at')::timestamptz
        FROM jsonb_array_elements(o.status_history) entry
        WHERE entry->>'status' = 'Ordered'
        ORDER BY (entry->>'at')::timestamptz ASC
        LIMIT 1
      ),
      o.created_at_base44
    ) AS ordered_at,
    COALESCE(
      (
        SELECT (entry->>'at')::timestamptz
        FROM jsonb_array_elements(o.status_history) entry
        WHERE entry->>'status' = 'Delivered'
        ORDER BY (entry->>'at')::timestamptz DESC
        LIMIT 1
      ),
      o.last_status_change_at
    ) AS delivered_at
  FROM public.base44_orders o
  WHERE o.status = 'Delivered'
)
SELECT
  external_id,
  region,
  order_type,
  ordered_at,
  delivered_at,
  EXTRACT(EPOCH FROM (delivered_at - ordered_at)) / 86400.0 AS lead_time_days,
  CASE WHEN EXTRACT(EPOCH FROM (delivered_at - ordered_at)) / 86400.0 <= 7
       THEN true ELSE false END                              AS on_time_7d,
  CASE WHEN EXTRACT(EPOCH FROM (delivered_at - ordered_at)) / 86400.0 <= 14
       THEN true ELSE false END                              AS on_time_14d
FROM ordered_at
WHERE delivered_at IS NOT NULL AND ordered_at IS NOT NULL;

COMMENT ON VIEW public.v_base44_vendor_otif IS
  'Delivered-order latency. on_time_7d boolean lets OTIF rate be computed as AVG over a window. Best-effort until base44 exposes per-status timestamps consistently.';

-- ============================================================
-- v_base44_sync_status  -- header strip on Supply Manager dashboard
-- ============================================================
CREATE OR REPLACE VIEW public.v_base44_sync_status AS
SELECT
  (SELECT MAX(finished_at) FROM public.base44_sync_runs WHERE status = 'ok')      AS last_successful_sync_at,
  (SELECT MAX(started_at)  FROM public.base44_sync_runs WHERE status = 'error')   AS last_failed_sync_at,
  (SELECT error_message FROM public.base44_sync_runs
   WHERE status = 'error' ORDER BY started_at DESC LIMIT 1)                       AS last_error_message,
  (SELECT COUNT(*) FROM public.base44_orders WHERE created_at_base44 >= now() - interval '24 hours')
                                                                                  AS orders_last_24h,
  (SELECT COUNT(*) FROM public.base44_orders)                                     AS total_mirrored_orders,
  (SELECT COUNT(*) FROM public.base44_orders WHERE status IN ('New','In Progress','Ordered','Ready for Pickup'))
                                                                                  AS open_orders,
  (SELECT COUNT(*) FROM public.v_base44_stuck_orders)                             AS stuck_orders_count;

COMMENT ON VIEW public.v_base44_sync_status IS
  'One-row header: last sync time, last error, recent volume, stuck count. Powers the Supply Manager sync strip.';

-- Grant SELECT on the views (RLS on underlying tables is what controls visibility).
GRANT SELECT ON public.v_base44_order_spend     TO authenticated;
GRANT SELECT ON public.v_base44_pppm_monthly    TO authenticated;
GRANT SELECT ON public.v_base44_stuck_orders    TO authenticated;
GRANT SELECT ON public.v_base44_vendor_otif     TO authenticated;
GRANT SELECT ON public.v_base44_sync_status     TO authenticated;
