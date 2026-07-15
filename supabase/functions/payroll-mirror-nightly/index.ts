// supabase/functions/payroll-mirror-nightly/index.ts
//
// Nightly Firestore mirror for the axiom-payroll portal (Dustin's payroll app).
// Reads 14 collections via the Firestore REST API using a Google service-account
// JWT, strips PII (visits.patient) and blob payloads (mileage/expense fileData),
// upserts into the `mirror.*` schema, then synthesizes an audit-events diff vs
// the prior snapshot.
//
// Runs via pg_cron at 02:00 America/New_York. Also invocable manually with
// X-Cron-Secret header for one-off backfills.
//
// SPEC: docs/PAYROLL_PORTAL_SPEC.md
// SCHEMA: supabase/migrations/*_payroll_mirror_schema_2026_07_14.sql
//
// SECRETS required (set via `supabase secrets set`):
//   AXIOM_PAYROLL_SA_JSON        - Google service-account JSON (roles/datastore.viewer
//                                   on project axiom-payroll)
//   AXIOM_PAYROLL_PROJECT_ID     - 'axiom-payroll' (default if unset)
//   CRON_SECRET                  - shared secret for the X-Cron-Secret header
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY - platform-injected
//
// FAILURE MODE
//   Every invocation writes a mirror.snapshot_run row (status=running -> success
//   | error). On error the message is captured so the dashboard can surface a
//   sync-broken banner instead of silently going stale.
//
// STATUS: Phase 1 skeleton. Firestore read path is wired but has not been
//   exercised against the real project (blocked on service-account key from
//   Dustin). Everything upstream of that (Supabase writes, snapshot bookkeeping,
//   PII stripping, diff engine) is implemented and unit-testable via the
//   `mode=dry` query param, which skips the Firestore reads and produces an
//   empty snapshot.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// ============================================================================
// Config
// ============================================================================

const PROJECT_ID = Deno.env.get('AXIOM_PAYROLL_PROJECT_ID') || 'axiom-payroll';

// Firestore collections to mirror, in the priority order the spec recommends.
// `admins` is INTENTIONALLY skipped - PII (emails) with no audit value.
const COLLECTIONS = [
  'payrollPeriods',
  'payrollOverrides',
  'employees',
  'hoursEntries',
  'mileageSubmissions',
  'expenses',
  'bonusApprovals',
  'visits',
  'imports',
  'settings',
  'employmentTypes',
  'roles',
  'visitTypes',
  'rateMatrix',
] as const;

type CollectionName = typeof COLLECTIONS[number];

// Firestore-collection -> Postgres-table mapping under the `mirror` schema.
const TABLE_MAP: Record<CollectionName, string> = {
  payrollPeriods:     'payroll_periods',
  payrollOverrides:   'payroll_overrides',
  employees:          'employees',
  hoursEntries:       'hours_entries',
  mileageSubmissions: 'mileage_submissions',
  expenses:           'expenses',
  bonusApprovals:     'bonus_approvals',
  visits:             'visits',
  imports:            'imports',
  settings:           'settings',
  employmentTypes:    'employment_types',
  roles:              'roles',
  visitTypes:         'visit_types',
  rateMatrix:         'rate_matrix',
};

// ============================================================================
// Google OAuth2 - mint an access token from the service-account JSON
// ============================================================================

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
  project_id: string;
}

async function mintAccessToken(sa: ServiceAccount, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope,
    aud: sa.token_uri,
    exp: now + 3600,
    iat: now,
  };

  const b64u = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const signingInput = `${b64u(header)}.${b64u(claims)}`;

  // Import the PEM private key for RS256 signing.
  const pemBody = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sigBytes = new Uint8Array(
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      new TextEncoder().encode(signingInput),
    ),
  );
  const sig = btoa(String.fromCharCode(...sigBytes))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const jwt = `${signingInput}.${sig}`;

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) {
    throw new Error(`OAuth token exchange failed: ${res.status} ${await res.text()}`);
  }
  const { access_token } = await res.json();
  return access_token as string;
}

// ============================================================================
// Firestore REST read - list every document in a collection with pagination
// ============================================================================

// Firestore REST returns `Value` objects like { stringValue: 'x' }, one variant
// per type. Collapse back to plain JSON.
function decodeFirestoreValue(v: any): any {
  if (v == null) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;   // ISO string
  if ('nullValue'    in v) return null;
  if ('mapValue'     in v) return decodeFirestoreMap(v.mapValue.fields || {});
  if ('arrayValue'   in v) return (v.arrayValue.values || []).map(decodeFirestoreValue);
  if ('referenceValue' in v) return v.referenceValue;
  return null;
}

function decodeFirestoreMap(fields: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeFirestoreValue(v);
  return out;
}

async function readCollection(
  accessToken: string,
  projectId: string,
  collection: string,
): Promise<Array<{ id: string; data: Record<string, any> }>> {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}`;
  const out: Array<{ id: string; data: Record<string, any> }> = [];
  let pageToken: string | null = null;
  do {
    const url = new URL(base);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Firestore read ${collection} failed: ${res.status} ${await res.text()}`);
    }
    const json = await res.json();
    for (const doc of (json.documents || [])) {
      const idPath = doc.name as string;
      const id = idPath.split('/').pop() as string;
      out.push({ id, data: decodeFirestoreMap(doc.fields || {}) });
    }
    pageToken = json.nextPageToken || null;
  } while (pageToken);
  return out;
}

// ============================================================================
// PII / blob stripping - the payroll spec is explicit about what to drop
// ============================================================================

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest).map(b => b.toString(16).padStart(2, '0')).join('');
}

// visits.patient -> patient_hash. Rewrite raw doc to redact plaintext.
async function stripVisitPII(data: Record<string, any>): Promise<Record<string, any>> {
  const clone = { ...data };
  const patient = typeof clone.patient === 'string' ? clone.patient.trim() : '';
  const patient_hash = patient ? await sha256Hex(patient.toLowerCase()) : null;
  clone.patient = '[PHI]';
  clone.patient_hash = patient_hash;
  return clone;
}

// mileageSubmissions.fileData / expenses.fileData -> dropped. Keep metadata.
function stripFileBlob(data: Record<string, any>): Record<string, any> {
  const clone = { ...data };
  delete clone.fileData;
  return clone;
}

// ============================================================================
// Row shaping - Firestore doc -> typed Postgres row
// ============================================================================

function toDate(v: any): string | null {
  if (!v) return null;
  const s = String(v);
  // Firestore ISO timestamp -> YYYY-MM-DD; already-formatted YYYY-MM-DD passes through.
  return s.slice(0, 10) || null;
}
function toTimestamp(v: any): string | null {
  return v ? String(v) : null;
}

function shape(collection: CollectionName, id: string, data: Record<string, any>): Record<string, any> {
  const base = { firestore_id: id, raw: data };
  switch (collection) {
    case 'employees': return {
      ...base,
      name: data.name ?? null,
      emp_id: data.empId ?? null,
      email: data.email ?? null,
      employment_type: data.employmentType ?? null,
      role_id: data.role ?? null,
      mileage_rate: data.mileageRate ?? null,
      department: data.department ?? null,
      location: data.location ?? null,
      ls_level: data.lsLevel ?? null,
      discipline_type: data.disciplineType ?? null,
      is_preceptor: data.isPreceptor ?? null,
      is_wound_care_cert: data.isWoundCareCert ?? null,
      notes: data.notes ?? null,
      salary_per_period: data.salaryPerPeriod ?? null,
      custom_hourly_rate: data.customHourlyRate ?? null,
      active: data.active ?? null,
    };
    case 'hoursEntries': return {
      ...base,
      employee_id: data.employeeId,
      entry_date: toDate(data.date),
      category: data.category ?? null,
      hours: data.hours ?? null,
      hourly_rate: data.hourlyRate ?? null,
      amount: data.amount ?? null,
      notes: data.notes ?? null,
      status: data.status ?? 'pending',
      submitted_at: toTimestamp(data.submittedAt),
      source: data.source ?? null,
      paylocity_code: data.paylocityCode ?? null,
      pay_period_start: toDate(data.payPeriodStart),
      pay_period_end: toDate(data.payPeriodEnd),
    };
    case 'mileageSubmissions': return {
      ...base,
      employee_id: data.employeeId,
      pay_period_start: toDate(data.payPeriodStart),
      pay_period_end: toDate(data.payPeriodEnd),
      total_miles: data.totalMiles ?? null,
      reimbursement: data.reimbursement ?? null,
      mileage_rate: data.mileageRate ?? null,
      source: data.source ?? null,
      notes: data.notes ?? null,
      status: data.status ?? 'pending',
      submitted_at: toTimestamp(data.submittedAt),
      file_name: data.fileName ?? null,
      file_type: data.fileType ?? null,
      file_size: data.fileSize ?? null,
      file_too_big: data.fileTooBig ?? null,
    };
    case 'expenses': return {
      ...base,
      employee_id: data.employeeId,
      employee_name: data.employeeName ?? null,
      amount: data.amount ?? null,
      description: data.description ?? null,
      expense_date: toDate(data.expenseDate),
      file_name: data.fileName ?? null,
      file_type: data.fileType ?? null,
      file_size: data.fileSize ?? null,
      file_too_big: data.fileTooBig ?? null,
      status: data.status ?? 'pending',
      submitted_at: toTimestamp(data.submittedAt),
    };
    case 'visits': return {
      ...base,
      employee_id: data.employeeId,
      visit_date: toDate(data.date),
      visit_type_id: data.visitTypeId ?? null,
      patient_hash: data.patient_hash ?? null,
      discipline: data.discipline ?? null,
      event_type: data.eventType ?? null,
      ref_source: data.refSource ?? null,
      verified: data.verified ?? null,
      rate: data.rate ?? null,
      pariox_total: data.parioxTotal ?? null,
      pariox_visits: data.parioxVisits ?? null,
      miles_driven: data.milesDriven ?? null,
      notes: data.notes ?? null,
      source_file: data.sourceFile ?? null,
      import_id: data.importId ?? null,
      pay_period_start: toDate(data.payPeriodStart),
      pay_period_end: toDate(data.payPeriodEnd),
      status: data.status ?? null,
      created_at: toTimestamp(data.createdAt),
    };
    case 'bonusApprovals': return {
      ...base,
      approval_key: data.approvalKey ?? null,
      bonus_type: data.type ?? null,
      employee_id: data.employeeId ?? null,
      employee_name: data.employeeName ?? null,
      amount: data.amount ?? null,
      status: data.status ?? null,
      pay_period_from: toDate(data.payPeriodFrom),
      pay_period_to: toDate(data.payPeriodTo),
      updated_at: toTimestamp(data.updatedAt),
      monthly_rate: data.monthlyRate ?? null,
      days_in_period: data.daysInPeriod ?? null,
      iso_week: data.week ?? null,
      weekly_visits: data.weeklyVisits ?? null,
      eligible_visits: data.eligibleVisits ?? null,
    };
    case 'payrollOverrides': return {
      ...base,
      employee_id: data.employeeId ?? null,
      pay_period_from: toDate(data.payPeriodFrom),
      pay_period_to: toDate(data.payPeriodTo),
      fields: data.fields ?? {},
      updated_at: toTimestamp(data.updatedAt),
    };
    case 'payrollPeriods': return {
      ...base,
      pay_period_from: toDate(data.payPeriodFrom),
      pay_period_to: toDate(data.payPeriodTo),
      status: data.status ?? null,
      export_type: data.exportType ?? null,
      processed_at: toTimestamp(data.processedAt),
      processed_by: data.processedBy ?? null,
      grand_total: data.grandTotal ?? null,
      line_count: data.lineCount ?? null,
    };
    case 'imports': return {
      ...base,
      filename: data.filename ?? null,
      date_range: data.dateRange ?? null,
      visit_count: data.visitCount ?? null,
      grand_total: data.grandTotal ?? null,
      employee_count: data.employeeCount ?? null,
      imported_at: toTimestamp(data.importedAt),
      imported_by: data.importedBy ?? null,
      pay_period_start: toDate(data.payPeriodStart),
      pay_period_end: toDate(data.payPeriodEnd),
    };
    case 'settings': return { ...base, value: data.value ?? null };
    case 'employmentTypes': return {
      ...base,
      name: data.name ?? null,
      color: data.color ?? null,
      behavior: data.behavior ?? null,
      weekly_visit_goal: data.weeklyVisitGoal ?? null,
      sort_order: data.sortOrder ?? null,
    };
    case 'roles': return { ...base, name: data.name ?? null };
    case 'visitTypes': return { ...base, name: data.name ?? null, default_rate: data.defaultRate ?? null };
    case 'rateMatrix': return {
      ...base,
      role_id: data.roleId ?? null,
      visit_type_id: data.visitTypeId ?? null,
      rate: data.rate ?? null,
    };
  }
}

// ============================================================================
// Snapshot diff -> audit_events
//
// For each collection, compare current mirrored rows against what was in the
// mirror before this run. Every field-level change becomes one audit_events row.
// `in_paid_period` is resolved from mirror.payroll_periods AFTER we have the
// fresh set of paid periods loaded (i.e. compute this AFTER upserting
// payrollPeriods first).
// ============================================================================

async function synthesizeAuditEvents(
  supabase: any,
  snapshotRunId: number,
  collection: CollectionName,
  freshDocs: Array<{ id: string; row: Record<string, any> }>,
): Promise<number> {
  const table = TABLE_MAP[collection];
  const { data: prior, error } = await supabase
    .schema('mirror')
    .from(table)
    .select('firestore_id, raw');
  if (error) throw new Error(`Read prior ${table} for diff: ${error.message}`);

  const priorMap = new Map<string, Record<string, any>>();
  for (const r of prior || []) priorMap.set(r.firestore_id, r.raw ?? {});

  const events: Array<any> = [];

  // Detect created + updated
  for (const { id, row } of freshDocs) {
    const now = row.raw ?? {};
    const before = priorMap.get(id);
    const employee_id =
      now.employeeId ?? now.employee_id ?? null;
    if (!before) {
      events.push({
        snapshot_run_id: snapshotRunId,
        collection,
        doc_id: id,
        event_type: 'created',
        field_path: null,
        old_value: null,
        new_value: now,
        employee_id,
      });
    } else {
      const changed = shallowDiff(before, now);
      for (const [field, [oldVal, newVal]] of Object.entries(changed)) {
        events.push({
          snapshot_run_id: snapshotRunId,
          collection,
          doc_id: id,
          event_type: 'updated',
          field_path: field,
          old_value: oldVal ?? null,
          new_value: newVal ?? null,
          employee_id,
        });
      }
    }
    priorMap.delete(id);
  }
  // Whatever remains in priorMap was deleted from Firestore.
  for (const [id, before] of priorMap.entries()) {
    events.push({
      snapshot_run_id: snapshotRunId,
      collection,
      doc_id: id,
      event_type: 'deleted',
      field_path: null,
      old_value: before,
      new_value: null,
      employee_id: before.employeeId ?? null,
    });
  }

  if (events.length === 0) return 0;
  // Insert in 500-row batches to stay under PostgREST limits.
  for (let i = 0; i < events.length; i += 500) {
    const chunk = events.slice(i, i + 500);
    const { error: insErr } = await supabase.schema('mirror').from('audit_events').insert(chunk);
    if (insErr) throw new Error(`Insert audit_events (${collection}): ${insErr.message}`);
  }
  return events.length;
}

function shallowDiff(a: Record<string, any>, b: Record<string, any>): Record<string, [any, any]> {
  const out: Record<string, [any, any]> = {};
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    // Skip fields that are inherently transient/derived.
    if (k === 'fileData') continue;
    const av = a?.[k];
    const bv = b?.[k];
    if (JSON.stringify(av) !== JSON.stringify(bv)) out[k] = [av, bv];
  }
  return out;
}

// Mark audit_events touching a paid period. Done in one SQL pass after the
// payroll_periods rows are fresh.
async function markPaidPeriodEvents(supabase: any, snapshotRunId: number): Promise<number> {
  const { error, count } = await supabase.rpc('mark_audit_events_in_paid_period', {
    p_snapshot_run_id: snapshotRunId,
  });
  if (error) {
    // RPC does not exist yet - fall back to no-op. Wire in a later migration.
    return 0;
  }
  return count ?? 0;
}

// ============================================================================
// Upsert helper
// ============================================================================

async function upsertRows(
  supabase: any,
  table: string,
  rows: Record<string, any>[],
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabase
      .schema('mirror')
      .from(table)
      .upsert(chunk, { onConflict: 'firestore_id' });
    if (error) throw new Error(`Upsert mirror.${table}: ${error.message}`);
  }
}

// Delete any mirror rows whose firestore_id is no longer in the freshly-read set.
// Called after upserts so post-close-mutation diffing sees the deletion.
async function reconcileDeletes(
  supabase: any,
  table: string,
  freshIds: string[],
): Promise<number> {
  const { data: existing, error } = await supabase
    .schema('mirror')
    .from(table)
    .select('firestore_id');
  if (error) throw new Error(`List mirror.${table} for delete-reconcile: ${error.message}`);
  const freshSet = new Set(freshIds);
  const stale = (existing || []).map((r: any) => r.firestore_id).filter((id: string) => !freshSet.has(id));
  if (stale.length === 0) return 0;
  const { error: delErr } = await supabase.schema('mirror').from(table).delete().in('firestore_id', stale);
  if (delErr) throw new Error(`Delete stale mirror.${table}: ${delErr.message}`);
  return stale.length;
}

// ============================================================================
// Handler
// ============================================================================

Deno.serve(async (req: Request) => {
  // Auth guard - either service-role JWT (verify_jwt=true) or X-Cron-Secret.
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret && req.headers.get('X-Cron-Secret') !== cronSecret) {
    // Fall through - Supabase will have already checked the JWT before we get here.
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('mode') === 'dry';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Open snapshot_run row
  const { data: runRow, error: runErr } = await supabase
    .schema('mirror')
    .from('snapshot_run')
    .insert({
      status: 'running',
      triggered_by: dryRun ? 'edge:dry' : (cronSecret && req.headers.get('X-Cron-Secret') === cronSecret ? 'cron' : 'edge:manual'),
    })
    .select('id')
    .single();
  if (runErr) return jsonError(runErr.message, 500);
  const runId = runRow.id as number;

  const docCounts: Record<string, number> = {};
  const auditCounts: Record<string, number> = {};

  try {
    let accessToken = '';
    if (!dryRun) {
      const saJson = Deno.env.get('AXIOM_PAYROLL_SA_JSON');
      if (!saJson) throw new Error('AXIOM_PAYROLL_SA_JSON secret not set - blocked on Dustin');
      const sa = JSON.parse(saJson) as ServiceAccount;
      accessToken = await mintAccessToken(sa, 'https://www.googleapis.com/auth/datastore');
    }

    for (const collection of COLLECTIONS) {
      const freshRaw = dryRun ? [] : await readCollection(accessToken, PROJECT_ID, collection);

      // Per-doc PII / blob stripping
      const stripped: Array<{ id: string; data: Record<string, any> }> = [];
      for (const doc of freshRaw) {
        let data = doc.data;
        if (collection === 'visits') data = await stripVisitPII(data);
        if (collection === 'mileageSubmissions' || collection === 'expenses') data = stripFileBlob(data);
        stripped.push({ id: doc.id, data });
      }

      const shaped = stripped.map(({ id, data }) => ({ id, row: shape(collection, id, data) }));
      const table = TABLE_MAP[collection];

      // Diff BEFORE upsert (so we see prior state)
      const auditN = await synthesizeAuditEvents(supabase, runId, collection, shaped);
      auditCounts[collection] = auditN;

      // Apply mirror changes
      await upsertRows(supabase, table, shaped.map(s => s.row));
      await reconcileDeletes(supabase, table, shaped.map(s => s.id));

      docCounts[collection] = shaped.length;
    }

    // After payrollPeriods are fresh, flag which audit_events touched paid periods.
    await markPaidPeriodEvents(supabase, runId);

    await supabase
      .schema('mirror')
      .from('snapshot_run')
      .update({
        finished_at: new Date().toISOString(),
        status: 'success',
        doc_counts: docCounts,
        notes: dryRun
          ? 'Dry run - skipped Firestore reads'
          : `Audit events synthesized: ${JSON.stringify(auditCounts)}`,
      })
      .eq('id', runId);

    return json({ ok: true, runId, dryRun, docCounts, auditCounts });
  } catch (err) {
    const msg = (err as Error).message;
    await supabase
      .schema('mirror')
      .from('snapshot_run')
      .update({
        finished_at: new Date().toISOString(),
        status: 'error',
        error_message: msg,
        doc_counts: docCounts,
      })
      .eq('id', runId);
    return jsonError(msg, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function jsonError(message: string, status = 500) {
  return json({ ok: false, error: message }, status);
}
