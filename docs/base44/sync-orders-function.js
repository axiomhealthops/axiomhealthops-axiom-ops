// base44 backend function: sync-orders
// ====================================================================
// Paste this into ahmops.com -> base44 backend function editor.
//
// Endpoint:   GET /sync/orders?since=<iso8601>&limit=<int>
// Auth:       HMAC-signed bearer token in `Authorization: Bearer <jwt>`
//             validated against BASE44_SYNC_SECRET (set in base44 env vars).
// Response:   { orders: [...], items: [...], cursor: <iso8601>, has_more: bool }
//
// This function exposes a minimal read-only API for the ops dashboard
// edge function to pull order data on a polling schedule. Nothing here
// writes back into base44.
//
// SECURITY MODEL
// --------------
// We use a shared HMAC secret instead of OAuth because:
//   1. Both endpoints are server-to-server. No human in the loop.
//   2. base44's backend function platform doesn't speak OAuth natively.
//   3. The secret never leaves Liam's two Vercel/Supabase env vars.
//
// Token format: HMAC-SHA256(timestamp + ":" + path, secret)
// The edge function sends both the token and the timestamp; we reject
// timestamps more than 5 minutes old to prevent replay.
//
// FIELD NAME ASSUMPTIONS
// ----------------------
// Adjust the entity name + field names below to match your base44 model.
// The screenshot you shared (Jun 18 2026, order 6a3412cdf1698c5787c6235e)
// implies the following base44 entity shape:
//
//   Order:
//     id                       (UUID string)
//     order_type               ('REGIONAL' | 'PATIENT' | 'INVENTORY')
//     status                   ('New' | 'In Progress' | 'Ordered' |
//                               'Ready for Pickup' | 'Delivered')
//     submitted_by_name        (string)
//     submitted_by_email       (string)
//     region                   ('A'..'V' or 'GA')
//     fulfillment_hub          (string, e.g. 'PICKUP HUB_H')
//     created_at               (ISO timestamp)
//     last_status_change_at    (ISO timestamp, if available)
//     status_history           (optional array of {status, at, by})
//     patient_name             (nullable -- not yet exposed per Liam, 6/23)
//     patient_id               (nullable -- ditto)
//     items                    (array; see OrderItem below)
//
//   OrderItem (nested or separate entity):
//     id                       (UUID string)
//     order_id                 (FK to Order.id)
//     item_name                (string)
//     item_code                (string, e.g. 'AHM212')
//     quantity                 (number)
//     unit_of_measure          (string)
//     unit_cost                (number, nullable)
//     extended_cost            (number, nullable)
//     qty_from_inventory       (number, default 0)
//     status                   (string, line-level)
//
// If your actual field names differ, rename the MAP_ORDER and MAP_ITEM
// helpers below. Everything else can stay.
// ====================================================================

import crypto from 'node:crypto';

// ============================================================
// Auth check
// ============================================================
function verifySignature(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const ts = req.headers.get('x-sync-timestamp') || '';
  const path = new URL(req.url).pathname + new URL(req.url).search;

  if (!token || !ts) return { ok: false, reason: 'missing_auth' };

  // Reject timestamps older than 5 minutes
  const tsMs = Date.parse(ts);
  if (isNaN(tsMs) || Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
    return { ok: false, reason: 'stale_or_invalid_timestamp' };
  }

  const expected = crypto
    .createHmac('sha256', process.env.BASE44_SYNC_SECRET || '')
    .update(`${ts}:${path}`)
    .digest('hex');

  if (token !== expected) return { ok: false, reason: 'bad_signature' };
  return { ok: true };
}

// ============================================================
// Field mapping
// ============================================================
// Pluck the fields the ops mirror needs out of base44's Order entity.
// If base44 returns extra fields, they're preserved in raw_payload upstream.

function MAP_ORDER(o) {
  return {
    external_id:           o.id,
    order_type:            o.order_type ?? null,
    status:                o.status,
    submitted_by_name:     o.submitted_by_name ?? null,
    submitted_by_email:    o.submitted_by_email ?? null,
    region:                o.region ?? null,
    fulfillment_hub:       o.fulfillment_hub ?? null,
    patient_name:          o.patient_name ?? null,
    patient_external_id:   o.patient_id ?? null,
    created_at_base44:     o.created_at,
    last_status_change_at: o.last_status_change_at ?? null,
    status_history:        o.status_history ?? null,
    raw_payload:           o,
  };
}

function MAP_ITEM(it, orderId) {
  return {
    external_id:        it.id,
    order_external_id:  orderId,
    item_name:          it.item_name ?? null,
    item_code:          it.item_code ?? null,
    quantity:           it.quantity ?? null,
    unit_of_measure:    it.unit_of_measure ?? null,
    unit_cost_usd:      it.unit_cost ?? null,
    extended_cost_usd:  it.extended_cost ?? null,
    qty_from_inventory: it.qty_from_inventory ?? 0,
    line_status:        it.status ?? null,
    raw_payload:        it,
  };
}

// ============================================================
// Handler
// ============================================================
export default async function handler(req) {
  // Step 1 -- auth
  const auth = verifySignature(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.reason }), {
      status: 401, headers: { 'content-type': 'application/json' },
    });
  }

  // Step 2 -- parse args
  const url = new URL(req.url);
  const since = url.searchParams.get('since');  // ISO8601 string
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '500', 10), 1000);

  // Step 3 -- fetch orders updated since cursor
  // Replace `app.entities.Order` with your actual base44 entity name.
  // `last_status_change_at` falls back to `created_at` for orders that
  // haven't transitioned yet -- index whichever you have.
  let orders;
  try {
    orders = await app.entities.Order.find({
      filter: since ? {
        $or: [
          { last_status_change_at: { $gt: since } },
          { created_at:            { $gt: since } },
        ],
      } : {},
      sort: { created_at: 'asc' },
      limit,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'base44_query_failed', detail: String(e) }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }

  // Step 4 -- fetch items per order
  // If base44 returns items inline on the Order entity, just use o.items.
  // Otherwise query OrderItem with $in on order_id.
  const orderIds = orders.map(o => o.id);
  let items = [];
  if (orderIds.length > 0) {
    if (orders[0] && Array.isArray(orders[0].items)) {
      // Items are inline
      for (const o of orders) {
        for (const it of o.items || []) {
          items.push(MAP_ITEM(it, o.id));
        }
      }
    } else {
      // Items are a separate entity
      try {
        const rawItems = await app.entities.OrderItem.find({
          filter: { order_id: { $in: orderIds } },
          limit: limit * 20,
        });
        items = rawItems.map(it => MAP_ITEM(it, it.order_id));
      } catch (e) {
        return new Response(JSON.stringify({ error: 'base44_items_query_failed', detail: String(e) }), {
          status: 500, headers: { 'content-type': 'application/json' },
        });
      }
    }
  }

  // Step 5 -- shape response
  const mappedOrders = orders.map(MAP_ORDER);
  const cursor = orders.length > 0
    ? orders[orders.length - 1].last_status_change_at || orders[orders.length - 1].created_at
    : since;

  return new Response(JSON.stringify({
    orders:    mappedOrders,
    items,
    cursor,
    has_more:  orders.length === limit,
    count:     orders.length,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// ====================================================================
// Setup checklist (do this in base44 before deploying to ops)
// ====================================================================
// 1. In base44 project settings, add an environment variable:
//        BASE44_SYNC_SECRET=<long random string, save securely>
//    Liam should generate this with: `openssl rand -hex 32`
//
// 2. Add this function to base44's backend function editor.
//    Route: GET /sync/orders
//    Function name: sync-orders
//
// 3. Verify by curling locally with a known timestamp:
//        TS="2026-06-23T12:00:00Z"
//        SECRET="<the value you set>"
//        SIG=$(echo -n "${TS}:/sync/orders?since=2026-06-01T00:00:00Z" | \
//              openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
//        curl https://ahmops.com/sync/orders?since=2026-06-01T00:00:00Z \
//          -H "Authorization: Bearer $SIG" \
//          -H "X-Sync-Timestamp: $TS"
//
// 4. Once you see JSON come back with orders[] populated, set the same
//    BASE44_SYNC_SECRET as a Supabase Edge Function secret:
//        supabase secrets set BASE44_SYNC_SECRET="<value>"
//
//    AND set the base URL:
//        supabase secrets set BASE44_BASE_URL="https://ahmops.com"
//
// 5. The sync-base44-orders edge function will start picking up orders
//    on its next cron tick (every 30 minutes).
// ====================================================================
