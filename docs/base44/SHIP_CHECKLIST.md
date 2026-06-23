# ahmops.com (base44) Order Mirror — Ship Checklist

Built 2026-06-23. Read-only mirror of ahmops.com orders into the ops dashboard so directors and ADs can see what clinicians are doing in supplies without dual-writing.

**Source of truth:** ahmops.com (base44) — clinicians create and progress orders there.
**Mirror destination:** ops dashboard `base44_orders` + `base44_order_items`.
**Direction:** one-way pull, every 30 minutes. Nothing in ops ever writes back.

---

## What's already done (no action needed)

1. Migration `20260623120000_base44_orders_mirror.sql` — applied. Creates `base44_orders`, `base44_order_items`, `base44_sync_runs`. RLS read-only for the supply roles.
2. Migration `20260623121000_base44_kpi_views.sql` — applied. Creates the five KPI views.
3. Edge function `sync-base44-orders` — deployed (version 1). Runs with `verify_jwt=true`.
4. UI:
   - New page `Stuck Orders` (page key `stuck-orders`) in SUPPLY MANAGEMENT section
   - `SupplyManagerPage` now shows a sync-status strip with the "stuck N - review" CTA
   - Dashboard router + Sidebar registered

---

## What Liam needs to do (the four manual steps)

### 1. Paste the backend function into ahmops.com (~10 min)

Open ahmops.com (base44 admin) → Backend Functions → New Function.
Paste the contents of `docs/base44/sync-orders-function.js`.

Two things to adjust before saving:

- **Entity names.** The function references `app.entities.Order` and `app.entities.OrderItem`. If your actual base44 entity is named differently (e.g. `SupplyOrder`), rename it.
- **Field names.** The MAP_ORDER / MAP_ITEM helpers read `o.order_type`, `o.status`, `o.submitted_by_name`, etc. If a field name differs (e.g. `o.submitter` instead of `o.submitted_by_name`), rename it. The function comments call out what each field maps to.

### 2. Generate and store the shared HMAC secret (~2 min)

On your Mac:
```bash
openssl rand -hex 32
```
Copy the output. Set it in two places:

**base44 env vars:**
```
BASE44_SYNC_SECRET=<that hex string>
```

**Supabase Edge Function secrets** (Supabase Dashboard → Project Settings → Edge Functions → Secrets):
```
BASE44_SYNC_SECRET=<same hex string>
BASE44_BASE_URL=https://ahmops.com
```

### 3. Verify the base44 endpoint manually (~3 min)

```bash
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SECRET="<the same hex string>"
PATH="/sync/orders?since=1970-01-01T00:00:00Z&limit=10"
SIG=$(printf "%s:%s" "$TS" "$PATH" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
curl "https://ahmops.com$PATH" \
  -H "Authorization: Bearer $SIG" \
  -H "X-Sync-Timestamp: $TS"
```

You should see JSON with `orders: [...]`, `items: [...]`, `cursor: <iso>`, `has_more: bool`.
If you get 401, the secret doesn't match; if you get 500, the entity/field names need adjustment.

### 4. Schedule the cron + run the backfill (~5 min)

Run `docs/base44/setup-cron.sql` in Supabase SQL Editor. Specifically:
- Paste your service-role key into the `vault.create_secret(...)` call before running it.
- Then run the cron schedule block.

Kick off a one-time backfill so historical orders flow in:
```bash
SERVICE_KEY="<service role key>"
curl -X POST "https://kndiyailsqrialgbozac.supabase.co/functions/v1/sync-base44-orders?backfill=1" \
  -H "Authorization: Bearer $SERVICE_KEY"
```

Open the Supply Manager dashboard. The sync strip should now show "synced Nm ago" and the order count. Open Stuck Orders to confirm rows appear.

---

## Files to ship to Vercel (one `ship` command)

From your Mac, in `~/Documents/GitHub/edemacare-ops`:

```bash
ship "feat(supply): mirror ahmops.com orders + Stuck Orders intervention page"
```

Files touched:
- `supabase/migrations/20260623120000_base44_orders_mirror.sql` (new, already applied to DB)
- `supabase/migrations/20260623121000_base44_kpi_views.sql` (new, already applied to DB)
- `supabase/functions/sync-base44-orders/index.ts` (new, already deployed)
- `src/pages/dashboard/StuckOrdersPage.jsx` (new)
- `src/pages/Dashboard.jsx` (1-line import + 1-line route registration)
- `src/components/Sidebar.jsx` (1-line icon add, 1-line duplicate removed)
- `src/pages/dashboard/SupplyManagerPage.jsx` (sync strip + load extension)
- `docs/base44/sync-orders-function.js` (reference; not bundled)
- `docs/base44/setup-cron.sql` (reference; not bundled)
- `docs/base44/SHIP_CHECKLIST.md` (this file)

Build verified clean: 576 modules transformed.

---

## Rollback if something goes wrong

The mirror is decoupled from existing pages, so rollback is low-blast-radius:

```sql
-- Stop the cron (instant)
SELECT cron.unschedule('sync-base44-orders-30min');

-- Optional: drop the mirror tables (data only -- ahmops.com is untouched)
DROP TABLE IF EXISTS public.base44_order_items CASCADE;
DROP TABLE IF EXISTS public.base44_orders CASCADE;
DROP TABLE IF EXISTS public.base44_sync_runs CASCADE;
DROP VIEW IF EXISTS public.v_base44_order_spend;
DROP VIEW IF EXISTS public.v_base44_pppm_monthly;
DROP VIEW IF EXISTS public.v_base44_stuck_orders;
DROP VIEW IF EXISTS public.v_base44_vendor_otif;
DROP VIEW IF EXISTS public.v_base44_sync_status;
```

To rollback the page: revert the 3 small `src/` edits. The Stuck Orders page just throws a 404 if the views aren't there.

---

## Known limitations (flag to Earl up front)

1. **No patient-level PPPM.** ahmops.com doesn't expose patient FK on orders yet. PPPM uses regional active-patient denominator from `census_data` — same as Earl's current method. We can decompose by patient the moment base44 adds that field; schema reserves `patient_external_id` for it.
2. **Vendor OTIF is best-effort.** Lead-time math assumes the `Ordered -> Delivered` interval. If base44 doesn't expose `status_history` with timestamps, the view falls back to `created_at_base44 -> last_status_change_at`, which approximates but isn't exact.
3. **Inventory pulls are subtracted from vendor spend.** This is the right number for "new procurement cost per patient" but it means PPPM will read lower than the gross spend Earl might see in base44's own dashboard. The mirror exposes both: `vendor_spend_usd` (for PPPM) and `gross_spend_usd` (for cross-checking).
4. **Cron runs every 30 min.** First-cut cadence. If Earl wants near-real-time, we can drop to 5 min by editing the cron schedule. Anything tighter than that and we should switch to webhooks.
5. **Field name drift risk.** If anyone renames a field in base44's Order entity, the sync will start producing rows with NULLs for that column. Watch the `base44_sync_runs` table for sudden drops in `orders_upserted` or for `status='error'` rows.

---

## Strategic note for Earl's accountability

PPPM as a primary KPI with no patient-level decomposition is a half-loaded gun. Earl can be told "PPPM went up 8% this month" with no way to drill into "which patients drove it." The denominator approach (region active count) is a stable proxy, but the moment two regions diverge sharply, Earl has no story to tell except "ask the clinicians."

Push base44 to add patient FK to the Order entity as the next priority. It is the single highest-leverage data-model change available right now for supply analytics.
