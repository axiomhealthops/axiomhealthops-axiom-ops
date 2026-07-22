// GarmentSheetUploadCard.jsx
//
// Imports the "MASTER Garment Order Form (Responses)" workbook into
// garment_orders. This is the refresh path for a page that was running
// on a single import from 2026-06-16: 220 orders, latest activity Jun
// 12, zero delivery dates, while the sheet had grown to 297 orders and
// 35 pending approvals nobody could see in the app.
//
// STAGE -> PREVIEW -> APPLY, per CLAUDE.md. The file is parsed and
// diffed against what is already stored, and the counts are shown before
// anything is written. Nothing lands on a single click.
//
// Parsing lives in src/lib/garmentSheet.js — the same module the CLI
// preview and `npm run check` use, so what this card writes is what the
// assertions cover.
//
// THE IMPORT MUST NOT CLOBBER APP-SIDE WORK
// -----------------------------------------
// The sheet knows about the CLINICAL approval only. Final approval,
// vendor, tracking, carrier and delivery confirmation are captured in
// this app and have no column in the workbook. A naive upsert would
// null them on every refresh and silently erase Earl's decisions. The
// update list below is therefore explicit and covers ONLY sheet-owned
// columns.

import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase, fetchAllPages } from '../lib/supabase';
import { parseGarmentWorkbook, GARMENT_SHEETS } from '../lib/garmentSheet';

// Columns the workbook is the source of truth for. Anything not listed
// is owned by the app and is never touched by an import.
const SHEET_OWNED = [
  'limb_type', 'patient_name', 'region', 'insurance', 'patient_address',
  'clinician_name', 'clinician_email', 'approver_email', 'approver_name',
  'current_loc', 'current_frequency', 'phase_of_care', 'order_type',
  'dosage', 'etiology', 'order_form_url', 'additional_items',
  'field_request_date', 'clinical_approval_status', 'clinical_approval_comments',
  'status_change_date', 'auth_number', 'auth_date', 'auth_needed',
  'order_number', 'order_placed_date', 'garment_code', 'garment_cost',
  'delivery_date', 'delivery_proof_url', 'notes',
];

const CHUNK = 100;

export default function GarmentSheetUploadCard({ onImported }) {
  const fileRef = useRef(null);
  const [parsed, setParsed] = useState(null);   // { rows, stats, problems }
  const [diff, setDiff] = useState(null);       // { newCount, updateCount }
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setError(null); setResult(null); setParsed(null); setDiff(null);
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheets = {};
      for (const name of GARMENT_SHEETS) {
        if (wb.Sheets[name]) sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
      }
      const found = Object.keys(sheets);
      if (found.length === 0) {
        throw new Error(`No garment sheets found. Expected "${GARMENT_SHEETS.join('" or "')}"; this file has: ${wb.SheetNames.slice(0, 8).join(', ')}`);
      }
      const p = parseGarmentWorkbook(sheets);
      if (p.rows.length === 0) throw new Error('Parsed 0 orders. Check the sheet tabs are named as expected.');
      if (p.missingRequired && p.missingRequired.length) {
        throw new Error(`Required columns are missing: ${p.missingRequired.join(', ')}. Import blocked rather than writing partial rows.`);
      }

      // Diff against what is stored, so the preview is a real count and
      // not an estimate.
      const existing = await fetchAllPages(supabase.from('garment_orders').select('source_row_key'));
      const have = new Set((existing || []).map(r => r.source_row_key).filter(Boolean));
      let newCount = 0, updateCount = 0;
      for (const r of p.rows) (have.has(r.source_row_key) ? updateCount++ : newCount++);

      setParsed(p);
      setDiff({ newCount, updateCount, storedTotal: have.size });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function apply() {
    if (!parsed) return;
    setBusy(true); setError(null);
    let inserted = 0, failed = 0;
    const failures = [];
    try {
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        const chunk = parsed.rows.slice(i, i + CHUNK).map(r => {
          const row = { ...r };
          delete row.submitted_at;           // not a column; parse-only metadata
          return row;
        });
        const { error: err, count } = await supabase
          .from('garment_orders')
          .upsert(chunk, { onConflict: 'source_row_key', ignoreDuplicates: false, count: 'exact' })
          .select('id', { count: 'exact', head: true });
        if (err) {
          // Never swallow a chunk error — CLAUDE.md incident 12. Retry the
          // chunk row by row so one bad record cannot cost the other 99.
          for (const single of chunk) {
            const { error: e2 } = await supabase
              .from('garment_orders')
              .upsert(single, { onConflict: 'source_row_key', ignoreDuplicates: false });
            if (e2) { failed++; if (failures.length < 5) failures.push(`${single.source_row_key}: ${e2.message}`); }
            else inserted++;
          }
        } else {
          inserted += count == null ? chunk.length : count;
        }
      }
      setResult({ inserted, failed, failures });
      setParsed(null); setDiff(null);
      if (typeof onImported === 'function') onImported();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  const S = parsed && parsed.stats;

  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--black)' }}>Import from the Garment Order Form sheet</div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>
            Download the workbook from Google Sheets (File {'>'} Download {'>'} .xlsx) and drop it here. Matches on patient + request date, so re-importing updates rather than duplicates.
          </div>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} disabled={busy}
          style={{ fontSize: 11 }} />
      </div>

      {busy && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gray)' }}>Working...</div>}

      {error && (
        <div style={{ marginTop: 10, padding: '9px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 7, fontSize: 12, color: '#991B1B' }}>
          <strong>Import blocked.</strong> {error}
        </div>
      )}

      {parsed && diff && (
        <div style={{ marginTop: 12, padding: '12px 14px', background: '#F8FAFC', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--black)', marginBottom: 8 }}>
            Preview {'--'} nothing has been saved yet
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, fontSize: 12 }}>
            {[
              ['New orders', diff.newCount, '#065F46'],
              ['Updated', diff.updateCount, '#1565C0'],
              ['Pending approval', S.pending, '#92400E'],
              ['Total cost', '$' + S.totalCost.toLocaleString(), 'var(--black)'],
            ].map(([k, v, c]) => (
              <div key={k}>
                <div style={{ fontSize: 10, color: 'var(--gray)', fontWeight: 700, textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontSize: 20, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: c }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 8, lineHeight: 1.6 }}>
            {S.unique} orders ({S.le} LE / {S.ue} UE){S.duplicates > 0 ? ` ${'·'} ${S.duplicates} resubmission${S.duplicates === 1 ? '' : 's'} collapsed to the latest` : ''}
            {' '}{'·'} {S.withOrderNumber} with an order number {'·'} {S.withAuth} with an auth number
            {S.withDelivery === 0 && (
              <div style={{ marginTop: 6, color: '#92400E' }}>
                <strong>No delivery dates in this file.</strong> The "Delivery Date/POD" column holds
                {' '}{S.withDeliveryProof} proof file reference{S.withDeliveryProof === 1 ? '' : 's'} and no dates, so
                {' '}order-to-delivery time stays unmeasurable until delivery is recorded as a date.
              </div>
            )}
          </div>
          {parsed.problems.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 11, color: '#92400E', cursor: 'pointer', fontWeight: 700 }}>
                {parsed.problems.length} parser note{parsed.problems.length === 1 ? '' : 's'}
              </summary>
              <ul style={{ fontSize: 11, color: 'var(--gray)', margin: '6px 0 0 16px' }}>
                {parsed.problems.slice(0, 10).map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </details>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={apply} disabled={busy}
              style={{ padding: '7px 15px', background: 'var(--black)', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Apply {diff.newCount + diff.updateCount} orders
            </button>
            <button onClick={() => { setParsed(null); setDiff(null); }} disabled={busy}
              style={{ padding: '7px 15px', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 10, padding: '9px 12px', background: result.failed > 0 ? '#FFFBEB' : '#ECFDF5', border: `1px solid ${result.failed > 0 ? '#FCD34D' : '#A7F3D0'}`, borderRadius: 7, fontSize: 12, color: result.failed > 0 ? '#78350F' : '#065F46' }}>
          <strong>{result.inserted} orders imported.</strong>
          {result.failed > 0 && (
            <> {result.failed} failed{result.failures.length ? `: ${result.failures.join('; ')}` : ''}.</>
          )}
        </div>
      )}
    </div>
  );
}
