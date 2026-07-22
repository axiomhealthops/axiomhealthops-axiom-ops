// =====================================================================
// ingest-garment-submission
//
// Receives one garment-order submission from the Google Sheet's Apps
// Script and upserts it into garment_orders. This is the live link that
// replaces the manual xlsx re-import: before it existed, the app ran on
// a single snapshot from 2026-06-16 while the sheet grew to 297 orders
// and 35 unseen pending approvals.
//
// TRUST MODEL
// -----------
// Called from Apps Script, which cannot hold a Supabase user session, so
// this is NOT a JWT-authenticated endpoint. It is protected by a shared
// secret in the X-Garment-Ingest-Secret header, compared in constant
// time. Deploy with --no-verify-jwt. The secret is set independently in
// Supabase and in the Apps Script properties; nobody needs to email it
// around and it never appears in this repo.
//
// The function runs with the service role so it can write regardless of
// RLS, exactly like notify-garment-handoff.
//
// WHAT IT WILL AND WILL NOT WRITE
// -------------------------------
// The sheet is the source of truth for the SUBMISSION and the CLINICAL
// approval only. Final approval, vendor, tracking, carrier and delivery
// confirmation are captured in the app and have no column in the
// workbook. Writing the full row on every webhook would null those and
// silently erase Earl's decisions, so the update list is explicit and
// sheet-owned only — the same rule the upload card follows.
//
// Idempotent on source_row_key ("<patient> | MM-DD-YYYY"), so a form
// EDIT re-fires the trigger and updates the existing order rather than
// creating a second one. Resubmissions are the normal case here, not an
// edge case.
// =====================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const INGEST_SECRET = Deno.env.get('GARMENT_INGEST_SECRET') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-garment-ingest-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Length-safe constant-time compare, so a wrong secret leaks no timing. */
function secretsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  // Compare a fixed number of bytes regardless of length.
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** YYYY-MM-DD or null. Apps Script sends ISO or M/D/YYYY. Never throws. */
function toDate(v: unknown): string | null {
  const s = norm(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    let [, mo, da, yr] = m;
    if (yr.length === 2) yr = '20' + yr;
    const mm = mo.padStart(2, '0');
    const dd = da.padStart(2, '0');
    if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return null;
    return `${yr}-${mm}-${dd}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toTimestamp(v: unknown): string | null {
  const s = norm(v);
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function toMoney(v: unknown): number | null {
  const s = norm(v).replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function toBool(v: unknown): boolean | null {
  const s = norm(v).toLowerCase();
  if (!s) return null;
  if (/^(yes|true|y)$/.test(s) || s === '1') return true;
  if (/^(no|false|n)$/.test(s) || s === '0') return false;
  return null;
}

/**
 * Free text typed by clinicians. Anything unrecognised becomes 'pending'
 * so a garbled status still reaches a human instead of vanishing.
 * Mirrors toApproval() in src/lib/garmentSheet.js — if you change one,
 * change both.
 */
function toApproval(v: unknown): string {
  const s = norm(v).toLowerCase();
  if (!s) return 'pending';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('den') || s.includes('reject')) return 'denied';
  if (s.includes('approv')) return 'approved';
  return 'pending';
}

function keyDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}-${d}-${y}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  if (!INGEST_SECRET) {
    // Fail closed. An unset secret must never mean "allow everyone".
    console.error('GARMENT_INGEST_SECRET is not set - refusing all requests');
    return json({ error: 'ingest not configured' }, 503);
  }
  if (!secretsMatch(req.headers.get('x-garment-ingest-secret') || '', INGEST_SECRET)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  const patient = norm(body.patient_name);
  if (!patient) {
    // Without a patient name there is no key and no way for a human to
    // find the order later. Reject loudly rather than store an orphan.
    return json({ error: 'patient_name is required' }, 400);
  }

  const limb = norm(body.limb_type).toUpperCase().startsWith('UE') ? 'UE' : 'LE';
  const requestDate = toDate(body.field_request_date);
  const submitted = toTimestamp(body.submitted_at);
  const keyBasis = requestDate || (submitted ? submitted.slice(0, 10) : null);
  const deliveryRaw = norm(body.delivery_raw);
  const deliveryDate = toDate(deliveryRaw);

  const row = {
    source_row_key: `${patient} | ${keyDate(keyBasis)}`,
    limb_type: limb,
    patient_name: patient,
    region: norm(body.region) || null,
    insurance: norm(body.insurance) || null,
    patient_address: norm(body.patient_address) || null,
    clinician_name: norm(body.clinician_name) || null,
    clinician_email: norm(body.clinician_email) || null,
    approver_email: norm(body.approver_email) || null,
    approver_name: norm(body.approver_name) || null,
    current_loc: norm(body.current_loc) || null,
    current_frequency: norm(body.current_frequency) || null,
    phase_of_care: norm(body.phase_of_care) || null,
    order_type: norm(body.order_type) || null,
    dosage: norm(body.dosage) || null,
    etiology: norm(body.etiology) || null,
    order_form_url: norm(body.order_form_url) || null,
    additional_items: norm(body.additional_items) || null,
    field_request_date: requestDate,
    clinical_approval_status: toApproval(body.approval_status),
    clinical_approval_comments: norm(body.approval_comments) || null,
    status_change_date: toTimestamp(body.status_change_date),
    auth_number: norm(body.auth_number) || null,
    auth_date: toDate(body.auth_date),
    auth_needed: toBool(body.auth_needed),
    order_number: norm(body.order_number) || null,
    order_placed_date: toDate(body.order_placed_date),
    garment_code: norm(body.garment_code) || null,
    garment_cost: toMoney(body.garment_cost),
    delivery_date: deliveryDate,
    // The sheet's delivery column holds POD filenames, not dates.
    // Preserve whatever is there; never invent a delivery date.
    delivery_proof_url: deliveryRaw && !deliveryDate ? deliveryRaw : null,
    notes: norm(body.notes) || null,
  };

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data, error } = await supabase
    .from('garment_orders')
    .upsert(row, { onConflict: 'source_row_key', ignoreDuplicates: false })
    .select('id')
    .single();

  if (error) {
    console.error('upsert failed', { key: row.source_row_key, message: error.message });
    return json({ error: error.message, source_row_key: row.source_row_key }, 500);
  }

  return json({ ok: true, id: data?.id, source_row_key: row.source_row_key });
});
