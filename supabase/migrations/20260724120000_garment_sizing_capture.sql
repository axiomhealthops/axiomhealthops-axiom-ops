-- =====================================================================
-- Garment sizing capture
--
-- The Sigvaris size finders (8 published artifacts, index at
-- claude.ai/public/artifacts/3452d6b5-...) take limb circumferences in
-- cm and return a recommended size plus a Sigvaris item number. Today
-- that result dies on the clinician's screen: nothing carries it into
-- the order, so the size and SKU are re-typed into a free-text
-- `garment_code` field, or not recorded at all.
--
-- Measured on 2026-07-24: of 138 orders in 'order_placed',
-- `garment_code` is populated on 11. The other 127 orders were placed
-- with a vendor without this system recording WHAT was ordered. There
-- is no way to answer "what size did we send this patient last time?"
-- on a re-order, which is the single most common question a re-order
-- has to answer.
--
-- These columns are additive and nullable. Existing readers are
-- unaffected; `garment_code` is deliberately left in place as the
-- free-text field it has always been, and `garment_sku` becomes the
-- structured one alongside it. Nothing is migrated between them —
-- guessing which of the 11 existing codes is a real Sigvaris SKU would
-- invent data.
--
-- `size_measurements` stores the raw circumferences as jsonb keyed by
-- the measuring point the size finder uses (C = fullest calf,
-- A = fullest ankle, G = length, D = below knee, F/E = thigh, I/J/K =
-- foot, etc). Raw measurements are kept rather than only the answer so
-- that a vendor sizing dispute, or a change to Sigvaris' charts, can be
-- re-evaluated against what was actually measured.
-- =====================================================================

alter table public.garment_orders
  add column if not exists garment_size       text,
  add column if not exists garment_sku        text,
  add column if not exists size_measurements  jsonb,
  add column if not exists size_tool          text,
  add column if not exists sized_at           timestamptz,
  add column if not exists sized_by           uuid references public.coordinators(id),
  add column if not exists sized_by_name      text;

comment on column public.garment_orders.garment_size is
  'Recommended size from the Sigvaris size finder, e.g. "Medium Regular".';
comment on column public.garment_orders.garment_sku is
  'Sigvaris item number produced by the size finder. Structured counterpart to the free-text garment_code.';
comment on column public.garment_orders.size_measurements is
  'Raw limb circumferences in cm, keyed by the size finder measuring point (C, A, G, D, F, E, I, J, K...). Kept so a sizing dispute can be re-evaluated.';
comment on column public.garment_orders.size_tool is
  'Which of the 8 size finders produced the result, e.g. "compreflex-calf".';

-- Recreate the stage view to expose the new columns. The stage CASE is
-- unchanged — copied verbatim from the existing definition so this
-- migration cannot alter which stage any order lands in.
--
-- CREATE OR REPLACE VIEW can only APPEND columns; it cannot insert them
-- ahead of an existing one (Postgres 42P16, "cannot change name of view
-- column"). `stage` therefore stays in position and the seven sizing
-- columns follow it. Column ORDER in this view is not meaningful to any
-- reader — every consumer selects * and reads by name — so this is a
-- Postgres constraint, not a design choice.
create or replace view public.v_garment_orders_with_stage as
 select id, patient_name, patient_id, region, patient_address, field_request_date,
        limb_type, order_type, current_loc, current_frequency, phase_of_care,
        insurance, dosage, etiology, clinician_name, clinician_email, clinician_id,
        approver_name, approver_email, approver_id, order_form_url, additional_items,
        vendor, garment_code, garment_cost, approval_status, approval_comments,
        approval_date, status_change_date, auth_needed, auth_number, auth_date,
        order_number, order_placed_date, vendor_eta_date, delivery_date,
        delivery_proof_url, tracking_number, carrier, notes, clinical_details,
        source_row_key, created_at, updated_at, created_by, is_standardized_catalog,
        category, clinical_approval_status, clinical_approver_id, clinical_approver_name,
        clinical_approver_email, clinical_approval_date, clinical_approval_comments,
        final_approval_status, final_approver_id, final_approver_name,
        final_approver_email, final_approval_date, final_approval_comments,
        case
            when final_approval_status = 'cancelled'::text then 'cancelled'::text
            when clinical_approval_status = 'denied'::text or final_approval_status = 'denied'::text then 'denied'::text
            when delivery_date is not null and (delivery_date + '14 days'::interval) < current_date then 'archived'::text
            when delivery_date is not null then 'delivered'::text
            when order_placed_date is not null then 'order_placed'::text
            when final_approval_status = 'approved'::text then 'ready_to_order'::text
            when clinical_approval_status = 'approved'::text then 'auth_pending'::text
            else 'submitted'::text
        end as stage,
        garment_size, garment_sku, size_measurements, size_tool, sized_at,
        sized_by, sized_by_name
   from public.garment_orders g;

-- One production row carries order_placed_date = 1936-05-30 ("Taylor,
-- Wanda", order 1508355.0) — an Excel serial that was never a date and
-- that garmentSheet.toDate() converted faithfully. It is NOT corrected
-- here: the true placement date is unknown, and writing a plausible one
-- would fabricate it. `garmentSla.MIN_PLAUSIBLE_DATE` treats it as
-- absent so it stops anchoring every "oldest order" sort, and it stays
-- visible in the data for whoever can look up the real date.
