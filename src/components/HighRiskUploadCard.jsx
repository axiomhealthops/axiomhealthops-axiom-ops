// HighRiskUploadCard.jsx
//
// Monthly high-risk reassessment XLSX upload. The clinical team maintains
// the master list in Liam's Excel sheet (the "LIAM COPY" tab from
// "High Risk Patient Identification.xlsx") and re-uploads each cycle.
//
// Parsing strategy:
//   - Read the XLSX. Prefer a sheet named "LIAM COPY" (case-insensitive,
//     also accepts "High Risk", "Risk", "Master"). Fallback: first sheet.
//   - Detect header row by scanning rows 0-9 for the column "Patient"
//     (or "Patient Name" / "Name"). Header row index becomes the data start.
//   - Map column headers to canonical fields by fuzzy match:
//       Patient, Region, Health Plan / Insurance, CareMap, Wounds,
//       3+ Comorbidities, Falls, Compliance Score, Environmental Score,
//       Comments.
//
// Match key: (lower(patient_name), region). Matches the unique index
//   uniq_risk_factors_patient created in the 20260519_patient_risk_factors
//   migration. ON CONFLICT updates the row (so we keep the same id).
//
// Replace Mode: when ON, every row currently in patient_risk_factors that
// does NOT appear in the new upload is DELETED. This is the typical
// behaviour for monthly reassessment — patients who improve drop off the
// watchlist. Off by default; user must opt in via checkbox.
//
// Risk flags are recomputed from the raw scores at upload time:
//   high_compliance_risk    = compliance_score > 8
//   high_environmental_risk = environmental_score > 12
// LOC level is derived by the BEFORE trigger on the table from caremap_score.
//
// CLAUDE.md compliance: no inline unicode in JSX text. ASCII or expression-
// wrapped only.

import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase, fetchAllPages } from '../lib/supabase';

const PREFERRED_SHEET_NAMES = ['liam copy', 'high risk', 'risk', 'master'];

function normHeader(s) {
  return (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}

const COLUMN_PATTERNS = {
  patient_name:        ['patient', 'patientname', 'name'],
  region:              ['region', 'rgn'],
  health_plan:         ['healthplan', 'insurance', 'payer', 'plan'],
  caremap_score:       ['caremap', 'caremapscore', 'cmscore', 'cm'],
  has_wounds:          ['wound', 'wounds', 'haswound', 'haswounds'],
  comorbidities_3plus: ['comorbidities', '3comorbidities', 'comorbid', 'comorbidities3plus'],
  falls_6mo:           ['falls', 'fall', 'fallin6months', 'falls6mo'],
  compliance_score:    ['compliance', 'compliancescore'],
  environmental_score: ['environmental', 'environment', 'environmentalscore'],
  comments:            ['comments', 'comment', 'notes'],
};

function buildHeaderMap(headerRow) {
  const map = {}; // field -> column index
  for (let i = 0; i < headerRow.length; i++) {
    const h = normHeader(headerRow[i]);
    if (!h) continue;
    for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
      if (map[field] !== undefined) continue;
      if (patterns.some(p => h === p || h.startsWith(p))) {
        map[field] = i;
      }
    }
  }
  return map;
}

function parseYesNo(v) {
  if (v === true || v === false) return v;
  if (v === null || v === undefined) return false;
  const s = v.toString().trim().toLowerCase();
  return s === 'yes' || s === 'y' || s === 'true' || s === '1' || s === 'x';
}

function parseInteger(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v.toString().replace(/[^\d-]/g, ''));
  return isNaN(n) ? null : n;
}

function pickSheet(workbook) {
  for (const name of PREFERRED_SHEET_NAMES) {
    const match = workbook.SheetNames.find(s => s.toLowerCase().includes(name));
    if (match) return match;
  }
  return workbook.SheetNames[0];
}

function findHeaderRowIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const norm = rows[i].map(normHeader);
    if (norm.some(c => c === 'patient' || c === 'patientname' || c === 'name')) {
      return i;
    }
  }
  return 0;
}

function parseWorkbookBuffer(buf) {
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = pickSheet(wb);
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows.length) throw new Error(`Sheet "${sheetName}" is empty.`);

  const headerRowIdx = findHeaderRowIndex(rows);
  const headers = rows[headerRowIdx];
  const colMap = buildHeaderMap(headers);

  if (colMap.patient_name === undefined) {
    throw new Error(`Could not find a "Patient" column in sheet "${sheetName}". Found: ${headers.join(' | ')}`);
  }

  const out = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const name = r[colMap.patient_name];
    if (!name || !name.toString().trim()) continue;
    const compScore = colMap.compliance_score !== undefined ? parseInteger(r[colMap.compliance_score]) : null;
    const envScore  = colMap.environmental_score !== undefined ? parseInteger(r[colMap.environmental_score]) : null;
    out.push({
      patient_name:           name.toString().trim(),
      region:                 colMap.region !== undefined ? (r[colMap.region] || '').toString().trim().toUpperCase() : null,
      health_plan:            colMap.health_plan !== undefined ? (r[colMap.health_plan] || '').toString().trim() || null : null,
      caremap_score:          colMap.caremap_score !== undefined ? parseInteger(r[colMap.caremap_score]) : null,
      has_wounds:             colMap.has_wounds !== undefined ? parseYesNo(r[colMap.has_wounds]) : false,
      comorbidities_3plus:    colMap.comorbidities_3plus !== undefined ? parseYesNo(r[colMap.comorbidities_3plus]) : false,
      falls_6mo:              colMap.falls_6mo !== undefined ? parseYesNo(r[colMap.falls_6mo]) : false,
      compliance_score:       compScore,
      environmental_score:    envScore,
      high_compliance_risk:   compScore !== null && compScore > 8,
      high_environmental_risk: envScore !== null && envScore > 12,
      comments:               colMap.comments !== undefined ? (r[colMap.comments] || '').toString().trim() || null : null,
    });
  }
  return { rows: out, sheetName, headers, colMap };
}

function key(name, region) {
  return `${(name || '').trim().toLowerCase()}::${(region || '').trim().toUpperCase()}`;
}

export default function HighRiskUploadCard({ profile, onSuccess }) {
  const [status, setStatus] = useState('idle'); // idle | parsed | applying | success | error
  const [message, setMessage] = useState('');
  const [parsed, setParsed] = useState(null);   // { rows, sheetName, ... }
  const [preview, setPreview] = useState(null); // { newRows, updatedRows, unchangedRows, droppedRows }
  const [replaceMode, setReplaceMode] = useState(false);
  const [lastUpload, setLastUpload] = useState(null);
  const inputRef = useRef();

  useEffect(() => {
    supabase.from('upload_batches')
      .select('*')
      .eq('batch_type', 'high_risk_reassessment')
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .then(res => {
        if (res.data && res.data.length > 0) setLastUpload(res.data[0]);
      });
  }, []);

  function reset() {
    setStatus('idle');
    setMessage('');
    setParsed(null);
    setPreview(null);
  }

  async function diffAgainstDb(rowsFromFile) {
    setMessage('Comparing against current high-risk roster...');
    const existing = await fetchAllPages(supabase.from('patient_risk_factors').select('*'));
    const exMap = new Map();
    for (const r of existing) exMap.set(key(r.patient_name, r.region), r);

    const newRows = [];
    const updatedRows = [];
    const unchangedRows = [];

    const seen = new Set();
    for (const r of rowsFromFile) {
      const k = key(r.patient_name, r.region);
      seen.add(k);
      const ex = exMap.get(k);
      if (!ex) {
        newRows.push(r);
        continue;
      }
      // Compare semantic fields
      const changed = (
        (ex.caremap_score ?? null) !== r.caremap_score ||
        !!ex.has_wounds !== r.has_wounds ||
        !!ex.comorbidities_3plus !== r.comorbidities_3plus ||
        !!ex.falls_6mo !== r.falls_6mo ||
        (ex.compliance_score ?? null) !== r.compliance_score ||
        (ex.environmental_score ?? null) !== r.environmental_score ||
        (ex.health_plan || null) !== r.health_plan ||
        (ex.comments || null) !== r.comments
      );
      if (changed) updatedRows.push({ before: ex, after: r });
      else unchangedRows.push(r);
    }
    const droppedRows = existing.filter(r => !seen.has(key(r.patient_name, r.region)));
    return { newRows, updatedRows, unchangedRows, droppedRows };
  }

  async function handleFile(file) {
    if (!file) return;
    setStatus('idle');
    setMessage('Parsing ' + file.name + '...');
    try {
      const buf = await file.arrayBuffer();
      const result = parseWorkbookBuffer(buf);
      const diff = await diffAgainstDb(result.rows);
      setParsed({ ...result, file });
      setPreview(diff);
      setStatus('parsed');
      setMessage('');
    } catch (err) {
      setStatus('error');
      setMessage('Parse error: ' + err.message);
    }
  }

  async function applyUpload() {
    if (!parsed || !preview) return;
    if (replaceMode && preview.droppedRows.length > 0) {
      const ok = window.confirm(
        'REPLACE MODE: This will DELETE ' + preview.droppedRows.length +
        ' patient(s) currently in the watchlist who do NOT appear in this upload.\n\n' +
        'Patients to be removed:\n' +
        preview.droppedRows.slice(0, 8).map(r => `- ${r.patient_name} (${r.region})`).join('\n') +
        (preview.droppedRows.length > 8 ? `\n+ ${preview.droppedRows.length - 8} more...` : '') +
        '\n\nProceed?'
      );
      if (!ok) return;
    }
    setStatus('applying');
    setMessage('Inserting / updating rows...');
    try {
      const now = new Date().toISOString();
      const today = now.slice(0, 10);
      const uploader = profile?.full_name || profile?.email || 'Unknown';

      // Audit batch record
      const batchRes = await supabase.from('upload_batches').insert([{
        batch_type: 'high_risk_reassessment',
        file_name: parsed.file.name,
        record_count: parsed.rows.length,
        uploaded_by: uploader,
      }]).select('id').single();
      const batchId = batchRes.data ? batchRes.data.id : null;

      // Upsert in chunks of 100 (PostgREST is fine, but keep under URL limits)
      const payload = parsed.rows.map(r => ({
        patient_name: r.patient_name,
        region: r.region,
        health_plan: r.health_plan,
        caremap_score: r.caremap_score,
        has_wounds: r.has_wounds,
        comorbidities_3plus: r.comorbidities_3plus,
        falls_6mo: r.falls_6mo,
        compliance_score: r.compliance_score,
        environmental_score: r.environmental_score,
        high_compliance_risk: r.high_compliance_risk,
        high_environmental_risk: r.high_environmental_risk,
        comments: r.comments,
        last_reassessment_date: today,
        updated_at: now,
        updated_by: uploader,
      }));

      // The unique index is on (lower(patient_name), region). PostgREST upsert
      // needs an actual on-conflict target — we can't reference a partial /
      // expression index directly. Strategy: fetch existing rows, split into
      // updates (by id) and inserts, then bulk-apply.
      const existing = await fetchAllPages(
        supabase.from('patient_risk_factors').select('id,patient_name,region')
      );
      const idByKey = new Map(existing.map(r => [key(r.patient_name, r.region), r.id]));

      const toInsert = [];
      const toUpdate = [];
      for (const r of payload) {
        const id = idByKey.get(key(r.patient_name, r.region));
        if (id) toUpdate.push({ id, ...r });
        else toInsert.push(r);
      }

      let inserted = 0, updated = 0;
      if (toInsert.length) {
        const { error } = await supabase.from('patient_risk_factors').insert(toInsert);
        if (error) throw new Error('Insert failed: ' + error.message);
        inserted = toInsert.length;
      }
      for (let i = 0; i < toUpdate.length; i += 50) {
        const slice = toUpdate.slice(i, i + 50);
        for (const row of slice) {
          const { id, ...rest } = row;
          const { error } = await supabase.from('patient_risk_factors').update(rest).eq('id', id);
          if (error) throw new Error('Update failed for ' + row.patient_name + ': ' + error.message);
          updated++;
        }
        setMessage('Updating... ' + Math.min(i + 50, toUpdate.length) + ' / ' + toUpdate.length);
      }

      let dropped = 0;
      if (replaceMode && preview.droppedRows.length > 0) {
        setMessage('Removing ' + preview.droppedRows.length + ' patients no longer on watchlist...');
        for (const r of preview.droppedRows) {
          const { error } = await supabase.from('patient_risk_factors').delete().eq('id', r.id);
          if (!error) dropped++;
        }
      }

      setStatus('success');
      setMessage(
        'Upload complete. ' + inserted + ' added, ' + updated + ' updated' +
        (replaceMode ? ', ' + dropped + ' removed' : ', ' + preview.droppedRows.length + ' kept (replace mode off)') +
        '. Batch id: ' + (batchId ? batchId.slice(0, 8) : 'n/a')
      );
      setLastUpload({ file_name: parsed.file.name, record_count: parsed.rows.length, uploaded_at: now });
      setParsed(null);
      setPreview(null);
      if (onSuccess) onSuccess();
    } catch (err) {
      setStatus('error');
      setMessage('Apply error: ' + err.message);
    }
  }

  function onDrop(e) { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }
  function onChange(e) { handleFile(e.target.files[0]); }

  const borderColor =
    status === 'applying' ? '#1565C0' :
    status === 'success'  ? '#059669' :
    status === 'error'    ? '#DC2626' :
    status === 'parsed'   ? '#D97706' : 'var(--border)';

  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--black)', marginBottom: 4 }}>
            High Risk Reassessment (monthly)
          </div>
          <div style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.5, maxWidth: 360 }}>
            Upload the LIAM COPY tab from "High Risk Patient Identification.xlsx".
            Columns: Patient, Region, Health Plan, CareMap, Wounds, 3+ Comorbidities,
            Falls, Compliance Score, Environmental Score, Comments.
          </div>
        </div>
        {lastUpload && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
              {lastUpload.record_count} patients in last upload
            </div>
            <div style={{ fontSize: 10, color: 'var(--gray)' }}>
              {lastUpload.file_name} {'·'} {new Date(lastUpload.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
          </div>
        )}
      </div>

      {/* Replace mode toggle */}
      <div style={{
        background: replaceMode ? '#FEF3C7' : '#F9FAFB',
        border: '1px solid ' + (replaceMode ? '#FCD34D' : 'var(--border)'),
        borderRadius: 8, padding: '10px 14px', marginBottom: 12,
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <input type="checkbox" id="hr-replace-mode" checked={replaceMode}
          onChange={e => setReplaceMode(e.target.checked)} style={{ marginTop: 2, cursor: 'pointer' }} />
        <label htmlFor="hr-replace-mode" style={{ flex: 1, cursor: 'pointer' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: replaceMode ? '#92400E' : 'var(--black)' }}>
            {replaceMode ? 'Replace Mode ON - patients not in file will be removed' : 'Replace Mode (drop patients no longer on watchlist)'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 3, lineHeight: 1.4 }}>
            When ON, any patient currently in the high-risk roster who does NOT appear
            in this upload will be DELETED. Use for normal monthly reassessment cycles
            where patients drop off as they improve. Off by default.
          </div>
        </label>
      </div>

      {/* Drop zone */}
      <div style={{ border: '2px dashed ' + borderColor, borderRadius: 10, padding: 32, textAlign: 'center', cursor: 'pointer', background: 'var(--bg)' }}
        onDrop={onDrop} onDragOver={e => e.preventDefault()}
        onClick={() => { if (inputRef.current && status !== 'applying') inputRef.current.click(); }}>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={onChange} style={{ display: 'none' }} />
        {status === 'applying' ? (
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--black)', marginBottom: 4 }}>Applying...</div>
            <div style={{ fontSize: 12, color: 'var(--gray)' }}>{message}</div>
          </div>
        ) : status === 'success' ? (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#059669', marginBottom: 4 }}>Upload complete</div>
            <div style={{ fontSize: 12, color: 'var(--gray)' }}>{message}</div>
            <button onClick={(e) => { e.stopPropagation(); reset(); }}
              style={{ marginTop: 12, padding: '6px 14px', border: '1px solid var(--border)', background: '#fff', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
              Upload another
            </button>
          </div>
        ) : status === 'error' ? (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#DC2626', marginBottom: 4 }}>Something went wrong</div>
            <div style={{ fontSize: 12, color: 'var(--gray)' }}>{message}</div>
            <button onClick={(e) => { e.stopPropagation(); reset(); }}
              style={{ marginTop: 12, padding: '6px 14px', border: '1px solid var(--border)', background: '#fff', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
              Try again
            </button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--black)', marginBottom: 4 }}>
              Drop XLSX file here or click to browse
            </div>
            <div style={{ fontSize: 12, color: 'var(--gray)' }}>
              {message || '.xlsx export of the LIAM COPY tab'}
            </div>
          </div>
        )}
      </div>

      {/* Preview */}
      {status === 'parsed' && preview && (
        <div style={{ marginTop: 14, background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E', marginBottom: 6 }}>
            Preview - confirm before applying
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
            <Counter label="To add" value={preview.newRows.length} color="#059669" bg="#ECFDF5" />
            <Counter label="To update" value={preview.updatedRows.length} color="#1565C0" bg="#EFF6FF" />
            <Counter label="Unchanged" value={preview.unchangedRows.length} color="#6B7280" bg="#F3F4F6" />
            <Counter label="Not in file" value={preview.droppedRows.length} color={replaceMode ? '#DC2626' : '#9CA3AF'} bg={replaceMode ? '#FEF2F2' : '#F9FAFB'} />
          </div>
          {preview.droppedRows.length > 0 && !replaceMode && (
            <div style={{ fontSize: 11, color: '#92400E', marginBottom: 10 }}>
              {preview.droppedRows.length} existing watchlist patient(s) are NOT in this upload.
              Turn on Replace Mode above to remove them, or leave off to preserve them.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={reset}
              style={{ padding: '8px 14px', border: '1px solid var(--border)', background: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={applyUpload}
              style={{ padding: '8px 16px', border: 'none', background: '#0F1117', color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Apply {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Counter({ label, value, color, bg }) {
  return (
    <div style={{ background: bg, borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: 'DM Mono, monospace', marginTop: 2 }}>{value}</div>
    </div>
  );
}
