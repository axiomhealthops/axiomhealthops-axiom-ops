-- 20260623120000_base44_orders_mirror.sql
--
-- Read-only mirror of ahmops.com (base44) orders into the ops dashboard.
--
-- Direction of truth:
--   ahmops.com (clinician-facing, base44)   ->  ops dashboard (director-facing)
--
-- ahmops.com is the system of record for ORDERS. Clinicians place orders
-- there; nothing in ops writes back. This migration creates three tables:
--
--   base44_orders         one row per order              (UUID stable PK from base44)
--   base44_order_items    one row per line item          (UUID stable PK from base44)
--   base44_sync_runs      one row per sync invocation    (observability)
--
-- Intentionally NOT extending public.garment_orders. That table's source is
-- Pariox/manual entry; mixing a second source would re-introduce exactly the
-- ghost-row / replace-mode chaos cleaned up on 2026-06-02 and 2026-06-06.
-- Keeping the mirror in its own namespace lets us evolve the base44 schema
-- without touching legacy Pariox data and lets us reason about each source's
-- KPIs independently.
--
-- RLS: SELECT for anyone with the supply dashboard page permission. Writes
-- restricted to the service_role only (the edge function runs with the
-- service key). Nothing in the UI writes to these tables.
--
-- Patient-level granularity is NOT YET present in ahmops.com. Schema reserves
-- patient_name / patient_external_id columns NULLable so we can backfill the
-- moment base44 exposes that linkage. Earl's PPPM is still computed using the
-- regional active-patient denominator until then.

-- ============================================================
-- base44_orders: order header
-- ============================================================
CREATE TABLE IF NOT EXISTS public.base44_orders (
  external_id              text PRIMARY KEY,                 -- base44 UUID, never changes
  order_type               text,                             -- 'REGIONAL' | 'PATIENT' | 'INVENTORY' | other
  status                   text NOT NULL,                    -- 'New' | 'In Progress' | 'Ordered' | 'Ready for Pickup' | 'Delivered'
  submitted_by_name        text,
  submitted_by_email       text,
  region                   text,                             -- 'A'..'V' or 'GA' / 'GA-*'
  fulfillment_hub          text,                             -- e.g. 'PICKUP HUB_H'
  patient_name             text,                             -- nullable until base44 adds patient FK
  patient_external_id      text,                             -- nullable, base44 patient UUID when available
  created_at_base44        timestamptz NOT NULL,             -- base44's createdAt
  last_status_change_at    timestamptz,                      -- base44's last_status_change (if exposed)
  status_history           jsonb,                            -- [{status, at, by}] if base44 exposes it
  raw_payload              jsonb NOT NULL,                   -- full base44 row, forensic fallback
  synced_at                timestamptz NOT NULL DEFAULT now(),

  CHECK (status IN ('New','In Progress','Ordered','Ready for Pickup','Delivered','Cancelled'))
);

COMMENT ON TABLE  public.base44_orders IS
  'Read-only mirror of ahmops.com (base44) orders. Source of truth is base44; nothing in ops writes here except the sync-base44-orders edge function running with service_role. UI is forbidden from writing.';
COMMENT ON COLUMN public.base44_orders.external_id IS
  'Stable UUID from base44. Used as upsert conflict key.';
COMMENT ON COLUMN public.base44_orders.status IS
  'base44 5-stage workflow. Cancelled tolerated for future-proofing even if not currently in the base44 UI.';
COMMENT ON COLUMN public.base44_orders.patient_name IS
  'Nullable until ahmops.com adds patient FK to orders. Earl PPPM uses regional active-patient denominator while this is null.';
COMMENT ON COLUMN public.base44_orders.raw_payload IS
  'Full base44 row mirrored as JSONB. Forensic backup if the structured columns ever miss a field.';

CREATE INDEX IF NOT EXISTS idx_base44_orders_status            ON public.base44_orders (status);
CREATE INDEX IF NOT EXISTS idx_base44_orders_region            ON public.base44_orders (region);
CREATE INDEX IF NOT EXISTS idx_base44_orders_created_at        ON public.base44_orders (created_at_base44 DESC);
CREATE INDEX IF NOT EXISTS idx_base44_orders_status_change     ON public.base44_orders (last_status_change_at DESC);
CREATE INDEX IF NOT EXISTS idx_base44_orders_submitted_by      ON public.base44_orders (submitted_by_email);
CREATE INDEX IF NOT EXISTS idx_base44_orders_patient_ext       ON public.base44_orders (patient_external_id) WHERE patient_external_id IS NOT NULL;

-- ============================================================
-- base44_order_items: order line items
-- ============================================================
CREATE TABLE IF NOT EXISTS public.base44_order_items (
  external_id              text PRIMARY KEY,
  order_external_id        text NOT NULL REFERENCES public.base44_orders(external_id) ON DELETE CASCADE,
  item_name                text,
  item_code                text,                             -- e.g. 'AHM212', 'NON21450'
  quantity                 numeric(10,2),
  unit_of_measure          text,                             -- 'each' | 'box' | 'pair' | etc
  unit_cost_usd            numeric(10,2),                    -- nullable; base44 sometimes shows '-'
  extended_cost_usd        numeric(12,2),                    -- nullable; base44 sometimes shows '-'
  qty_from_inventory       numeric(10,2) NOT NULL DEFAULT 0, -- portion fulfilled from on-hand stock
  line_status              text,                             -- 'Pending' | 'Picked' | 'Shipped' | etc
  raw_payload              jsonb NOT NULL,
  synced_at                timestamptz NOT NULL DEFAULT now(),

  CHECK (qty_from_inventory >= 0)
);

COMMENT ON TABLE  public.base44_order_items IS
  'Line items inside base44 orders. qty_from_inventory is critical: PPPM math should subtract the inventory-pull portion from vendor spend to avoid double counting on-hand stock as new procurement spend.';
COMMENT ON COLUMN public.base44_order_items.qty_from_inventory IS
  'Quantity fulfilled by pulling from on-hand stock (not a new vendor purchase). For PPPM math: vendor_spend = (quantity - qty_from_inventory) * unit_cost.';

CREATE INDEX IF NOT EXISTS idx_base44_order_items_order   ON public.base44_order_items (order_external_id);
CREATE INDEX IF NOT EXISTS idx_base44_order_items_code    ON public.base44_order_items (item_code);

-- ============================================================
-- base44_sync_runs: observability for the sync edge function
-- ============================================================
CREATE TABLE IF NOT EXISTS public.base44_sync_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at               timestamptz NOT NULL DEFAULT now(),
  finished_at              timestamptz,
  trigger_source           text NOT NULL,                    -- 'cron' | 'manual' | 'backfill'
  cursor_since             timestamptz,                      -- 'since' arg passed to base44
  cursor_until             timestamptz,                      -- max created_at observed in this run
  orders_upserted          int NOT NULL DEFAULT 0,
  items_upserted           int NOT NULL DEFAULT 0,
  pages_fetched            int NOT NULL DEFAULT 0,
  status                   text NOT NULL DEFAULT 'running',  -- 'running' | 'ok' | 'error'
  error_message            text,
  raw_response_sample      jsonb                             -- first page sample if error, for debugging
);

COMMENT ON TABLE  public.base44_sync_runs IS
  'One row per invocation of sync-base44-orders edge function. Surfaces "Last sync: 12m ago" + last error on the Supply Manager dashboard.';

CREATE INDEX IF NOT EXISTS idx_base44_sync_runs_started ON public.base44_sync_runs (started_at DESC);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.base44_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.base44_order_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.base44_sync_runs     ENABLE ROW LEVEL SECURITY;

-- READ: anyone with the supply-manager page permission can SELECT.
-- We piggyback on existing page_permissions infra: if a coordinator has any
-- role that grants supply-manager access, they can read all three tables.
-- (Region-level scoping happens in the React layer, same pattern as garment_orders.)

DROP POLICY IF EXISTS base44_orders_select_supply_viewers ON public.base44_orders;
CREATE POLICY base44_orders_select_supply_viewers ON public.base44_orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.coordinators c
      WHERE c.user_id = auth.uid()
        AND c.is_active = true
        AND c.role IN (
          'super_admin','admin','assoc_director','regional_manager',
          'pod_leader','team_member','director_payer_marketing'
        )
    )
  );

DROP POLICY IF EXISTS base44_order_items_select_supply_viewers ON public.base44_order_items;
CREATE POLICY base44_order_items_select_supply_viewers ON public.base44_order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.coordinators c
      WHERE c.user_id = auth.uid()
        AND c.is_active = true
        AND c.role IN (
          'super_admin','admin','assoc_director','regional_manager',
          'pod_leader','team_member','director_payer_marketing'
        )
    )
  );

DROP POLICY IF EXISTS base44_sync_runs_select_supply_viewers ON public.base44_sync_runs;
CREATE POLICY base44_sync_runs_select_supply_viewers ON public.base44_sync_runs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.coordinators c
      WHERE c.user_id = auth.uid()
        AND c.is_active = true
        AND c.role IN (
          'super_admin','admin','assoc_director','regional_manager',
          'pod_leader','team_member','director_payer_marketing'
        )
    )
  );

-- WRITE: no UI write policy. The edge function runs with the service_role
-- key which bypasses RLS, so we deliberately do NOT add INSERT/UPDATE/DELETE
-- policies for authenticated. Any attempt by the UI to write will be denied
-- by Postgres, which is the desired guard rail.

-- ============================================================
-- Page permissions: register the new page and grant by role
-- ============================================================
-- The Worklist page becomes the "Stuck Orders" intervention surface, fed by
-- the mirror. We keep the same page key 'supply-worklist' to avoid breaking
-- existing user_page_overrides; only the implementation changes.

INSERT INTO public.page_permissions (
  page_key, page_label, page_section,
  super_admin, admin, assoc_director, regional_manager, pod_leader, team_member,
  auth_coordinator, intake_coordinator, care_coordinator, clinician, telehealth
) VALUES
  ('stuck-orders', 'Stuck Orders (ahmops.com)', 'SUPPLY MANAGEMENT',
    true, true, true, true, true, false,
    false, false, false, false, false)
ON CONFLICT (page_key) DO UPDATE SET
  page_label   = EXCLUDED.page_label,
  page_section = EXCLUDED.page_section;
