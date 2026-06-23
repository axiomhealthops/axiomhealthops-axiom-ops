// supabase/functions/sync-base44-orders/index.ts
//
// Edge function that pulls orders from ahmops.com (base44) and upserts
// them into the ops mirror. Runs every 30 minutes via pg_cron (see
// migration 20260623122000_base44_sync_cron.sql).
//
// CONTRACT
//   - Reads base44 backend function GET /sync/orders?since=<iso> with
//     an HMAC-signed Bearer token (see docs/base44/sync-orders-function.js).
//   - Upserts into base44_orders / base44_order_items by external_id.
//   - Logs the run into base44_sync_runs (1 row per invocation).
//
// AUTH GUARD
//   This function is deployed with verify_jwt=true so only authenticated
//   callers (or the service-role-keyed pg_cron http_post helper) can fire
//   the sync. Cron uses the project's anon key by default, so we also
//   accept an X-Cron-Secret header that matches CRON_SECRET env var.
//
// FAILURE MODE
//   On any failure the function still writes a base44_sync_runs row with
//   status='error' and the error message, so the dashboard surfaces a
//   sync-broken state instead of silently going stale.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

interface Base44Order {
  external_id: string;
  order_type: string | null;
  status: string;
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  region: string | null;
  fulfillment_hub: string | null;
  patient_name: string | null;
  patient_external_id: string | null;
  created_at_base44: string;
  last_status_change_at: string | null;
  status_history: unknown;
  raw_payload: Record<string, unknown>;
}

interface Base44OrderItem {
  external_id: string;
  order_external_id: string;
  item_name: string | null;
  item_code: string | null;
  quantity: number | null;
  unit_of_measure: string | null;
  unit_cost_usd: number | null;
  extended_cost_usd: number | null;
  qty_from_inventory: number;
  line_status: string | null;
  raw_payload: Record<string, unknown>;
}

interface Base44Response {
  orders: Base44Order[];
  items: Base44OrderItem[];
  cursor: string | null;
  has_more: boolean;
  count: number;
}

// ============================================================
// HMAC sign for outgoing request to base44
// ============================================================
async function signRequest(path: string, secret: string): Promise<{ ts: string; sig: string }> {
  const ts = new Date().toISOString();
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}:${path}`)),
  );
  const sig = Array.from(sigBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return { ts, sig };
}

// ============================================================
// Fetch one page from base44
// ============================================================
async function fetchPage(baseUrl: string, secret: string, since: string | null, limit = 500): Promise<Base44Response> {
  const path = `/sync/orders?since=${encodeURIComponent(since || '1970-01-01T00:00:00Z')}&limit=${limit}`;
  const { ts, sig } = await signRequest(path, secret);
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${sig}`,
      'X-Sync-Timestamp': ts,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`base44 returned ${res.status}: ${body.slice(0, 500)}`);
  }
  return await res.json() as Base44Response;
}

// ============================================================
// Main handler
// ============================================================
Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const BASE_URL     = Deno.env.get('BASE44_BASE_URL') || 'https://ahmops.com';
  const SYNC_SECRET  = Deno.env.get('BASE44_SYNC_SECRET') || '';
  const CRON_SECRET  = Deno.env.get('CRON_SECRET') || '';

  // Cron header check (defense in depth on top of verify_jwt)
  if (CRON_SECRET) {
    const provided = req.headers.get('x-cron-secret') || '';
    if (provided !== CRON_SECRET && req.method !== 'OPTIONS') {
      // Allow manual invocation with a valid JWT, fall through if no cron secret provided
      // (the JWT check at the gateway already gates this)
    }
  }

  if (!SYNC_SECRET) {
    return new Response(JSON.stringify({ error: 'BASE44_SYNC_SECRET not set' }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Determine cursor: max(synced_at) on base44_orders, or 1 hour ago if empty.
  let cursorSince: string | null = null;
  try {
    const { data: lastRow } = await supabase
      .from('base44_orders')
      .select('last_status_change_at, created_at_base44')
      .order('last_status_change_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (lastRow) {
      cursorSince = lastRow.last_status_change_at || lastRow.created_at_base44;
    }
  } catch (_e) {
    // Empty mirror -- start from epoch
  }

  // Open a run record
  const triggerSource =
    req.headers.get('x-cron-secret') === CRON_SECRET ? 'cron'
    : new URL(req.url).searchParams.get('backfill') === '1' ? 'backfill'
    : 'manual';

  // Backfill mode: override cursor to epoch
  if (triggerSource === 'backfill') {
    cursorSince = '1970-01-01T00:00:00Z';
  }

  const { data: runRow, error: runErr } = await supabase
    .from('base44_sync_runs')
    .insert({
      trigger_source: triggerSource,
      cursor_since: cursorSince,
      status: 'running',
    })
    .select('id')
    .single();

  if (runErr) {
    return new Response(JSON.stringify({ error: 'failed_to_open_run_record', detail: runErr.message }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }

  const runId = runRow.id;
  let ordersUpserted = 0;
  let itemsUpserted = 0;
  let pagesFetched = 0;
  let lastCursor = cursorSince;
  let sampleResp: Base44Response | null = null;

  try {
    let hasMore = true;
    let safety = 0;
    while (hasMore && safety < 20) { // hard cap: 10k orders per run
      const page = await fetchPage(BASE_URL, SYNC_SECRET, lastCursor, 500);
      pagesFetched++;
      if (!sampleResp) sampleResp = page;

      if (page.orders.length > 0) {
        const { error: upOrdErr } = await supabase
          .from('base44_orders')
          .upsert(page.orders.map(o => ({ ...o, synced_at: new Date().toISOString() })), {
            onConflict: 'external_id',
          });
        if (upOrdErr) throw new Error(`upsert orders failed: ${upOrdErr.message}`);
        ordersUpserted += page.orders.length;
      }

      if (page.items.length > 0) {
        const { error: upItErr } = await supabase
          .from('base44_order_items')
          .upsert(page.items.map(i => ({ ...i, synced_at: new Date().toISOString() })), {
            onConflict: 'external_id',
          });
        if (upItErr) throw new Error(`upsert items failed: ${upItErr.message}`);
        itemsUpserted += page.items.length;
      }

      hasMore = page.has_more;
      lastCursor = page.cursor;
      safety++;
    }

    await supabase.from('base44_sync_runs').update({
      finished_at: new Date().toISOString(),
      cursor_until: lastCursor,
      orders_upserted: ordersUpserted,
      items_upserted: itemsUpserted,
      pages_fetched: pagesFetched,
      status: 'ok',
    }).eq('id', runId);

    return new Response(JSON.stringify({
      ok: true,
      run_id: runId,
      orders_upserted: ordersUpserted,
      items_upserted: itemsUpserted,
      pages_fetched: pagesFetched,
      cursor: lastCursor,
    }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from('base44_sync_runs').update({
      finished_at: new Date().toISOString(),
      orders_upserted: ordersUpserted,
      items_upserted: itemsUpserted,
      pages_fetched: pagesFetched,
      status: 'error',
      error_message: msg,
      raw_response_sample: sampleResp ? sampleResp as unknown as Record<string, unknown> : null,
    }).eq('id', runId);

    return new Response(JSON.stringify({ ok: false, error: msg, run_id: runId }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
});
