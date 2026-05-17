// =====================================================================
// AuthAuditImportPage.jsx
//
// Admin-only page for importing the Authorization Audit XLSX (the one
// the Auth + Care Coord teams fill out weekly). Workflow is deliberately
// 4 distinct phases to prevent any "oops I just nuked production":
//
//   1. UPLOAD    — admin picks .xlsx file, parsed client-side via SheetJS
//   2. NORMALIZE — apply known typo/truncation fixes; bulk insert to
//                  auth_audit_staging via supabase-js (chunks of 100)
//   3. PREVIEW   — for each staging row, compute diff vs current census +
//                  auth_tracker. Show side-by-side colored diff. Filter
//                  by region/status/audit_complete. Select rows to apply.
//   4. APPLY     — call apply_audit_row(staging_id, applied_by) for each
//                  selected row. Server-side function writes to
//                  data_audit_log so every change is reversible.
//
// Per Liam (2026-05-16): audit always wins (overwrite policy), status
// names get normalized to canonical forms ("Pendin" → "Pending", etc.),
// CC notes always APPENDED (never overwriting existing notes).
// =====================================================================

import { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

// ─── Status normalization rules (matches Phase 2 Python rules) ──────────
const STATUS_FIX = {
  'Active - Auth Pendin': 'Active - Auth Pending',
  'Discharge - Change I': 'Discharge - Change Insurance',
  'Eval Pernding':        'Eval Pending',
  'On Hold ':             'On Hold',
  'Non-admit':            'Non-Admit',
  'Discharged':           'Discharge',
};

// ─── Helpers ────────────────────────────────────────────────────────────
function normStatus(s) {
  if (s === null || s === undefined || s === '') return null;
  var v = String(s).trim();
  return STATUS_FIX[v] || v;
}
function toInt(v) {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  if (typeof v === 'number' && !isNaN(v)) {
    var i = Math.floor(v);
    return i >= 0 ? i : null;
  }
  // SheetJS with raw:false returns formatted strings — accept "1", "1.0",
  // " 1 ", but reject "Medicare", "1 OT & PT", etc.
  if (typeof v === 'string') {
    var trimmed = v.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      var n = Number(trimmed);
      if (!isNaN(n) && n >= 0) return Math.floor(n);
    }
  }
  return null;
}
// audit_complete needs a SEPARATE parser because the original strict
// equality check missed "1" coming through as a formatted string from
// SheetJS. Lesson learned: never trust SheetJS string types — coerce.
function toAuditComplete(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  if (!isNaN(n)) {
    if (n === 1) return 1;
    if (n === 0) return 0;
  }
  // Accept "Yes"/"No" in case someone re-types it
  var s = String(v).trim().toUpperCase();
  if (s === 'YES' || s === 'TRUE' || s === 'Y') return 1;
  if (s === 'NO'  || s === 'FALSE' || s === 'N') return 0;
  return null;
}
function toDate(v) {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    var y = v.getFullYear();
    var m = String(v.getMonth() + 1).padStart(2, '0');
    var d = String(v.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  if (typeof v === 'string') {
    // already in YYYY-MM-DD or convertible?
    var dt = new Date(v);
    if (!isNaN(dt.getTime())) {
      return toDate(dt);
    }
  }
  return null;
}
function toBoolYN(v) {
  if (v === null || v === undefined || v === '') return null;
  var s = String(v).trim().toUpperCase();
  if (s === 'YES') return true;
  if (s === 'NO')  return false;
  return null;
}
function toTs(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString();
  return null;
}
function clean(v) {
  if (v === null || v === undefined) return null;
  var s = String(v).trim();
  return s.length > 0 ? s : null;
}

// ─── Diff computation ───────────────────────────────────────────────────
// Compare a staging row against the matched census + auth rows, returning
// a list of {field, current, audit, willChange, surface}.
function computeDiff(stagingRow, censusRow, authRow) {
  var diffs = [];
  function push(field, current, audit, surface) {
    if (audit === null || audit === undefined || audit === '') return;
    var changed = String(current === null || current === undefined ? '' : current) !== String(audit);
    diffs.push({ field: field, current: current, audit: audit, willChange: changed, surface: surface });
  }
  // census-side fields
  push('status', censusRow && censusRow.status, stagingRow.status_normalized, 'census');
  push('address', censusRow && censusRow.address, stagingRow.address, 'census');
  push('discipline', censusRow && censusRow.discipline, stagingRow.discipline, 'census');
  push('ref_source', censusRow && censusRow.ref_source, stagingRow.ref_source, 'census');
  push('insurance', censusRow && censusRow.insurance, stagingRow.insurance_clean, 'census');
  push('frequency', censusRow && censusRow.inferred_frequency, stagingRow.frequency, 'census');
  // auth-side fields
  push('soc_date', authRow && authRow.soc_date, stagingRow.soc_date, 'auth');
  push('auth_start_date', authRow && authRow.auth_start_date, stagingRow.auth_start_date, 'auth');
  push('auth_expiry_date', authRow && authRow.auth_expiry_date, stagingRow.auth_end_date, 'auth');
  push('visits_authorized', authRow && authRow.visits_authorized, stagingRow.visits_authorized, 'auth');
  push('evals_authorized', authRow && authRow.evals_authorized, stagingRow.evals_authorized, 'auth');
  push('reassessments_authorized', authRow && authRow.reassessments_authorized, stagingRow.ras_authorized, 'auth');
  push('is_ppo', authRow && authRow.is_ppo, stagingRow.is_ppo, 'auth');
  push('is_scheduled', authRow && authRow.is_scheduled, stagingRow.is_scheduled, 'auth');
  push('notes', authRow && authRow.notes, stagingRow.notes, 'auth');
  // CC notes are always appended (never overwriting)
  if (stagingRow.cc_notes) {
    diffs.push({ field: 'cc_notes', current: '(will append)', audit: stagingRow.cc_notes, willChange: true, surface: 'note_append' });
  }
  return diffs;
}

// ─── Main page ──────────────────────────────────────────────────────────
export default function AuthAuditImportPage() {
  const { profile } = useAuth();
  const [phase, setPhase] = useState('upload'); // upload | normalize | preview | applying | done
  const [file, setFile] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);
  const [parseErrors, setParseErrors] = useState([]);
  const [stagingProgress, setStagingProgress] = useState({ done: 0, total: 0 });
  const [stagingError, setStagingError] = useState(null);
  const [stagingBatch, setStagingBatch] = useState(null);
  const [stagingRows, setStagingRows] = useState([]);
  const [census, setCensus] = useState([]);
  const [auths, setAuths] = useState([]);
  const [selected, setSelected] = useState({}); // {staging_id: true}
  // auditedOnly default — if no rows are marked audit_complete=1, default to
  // false so the preview isn't empty. Computed once after staging completes.
  const [filters, setFilters] = useState({ region: 'ALL', auditedOnly: true, statusFilter: 'ALL' });
  const [expandedRow, setExpandedRow] = useState(null);
  const [applyProgress, setApplyProgress] = useState({ done: 0, total: 0, errors: [] });

  // ────────────────────────────────────────────────────────────────────
  // PHASE 1 → 2: Parse XLSX and stage to Supabase
  // ────────────────────────────────────────────────────────────────────
  async function handleFile(e) {
    var f = e.target.files[0];
    if (!f) return;
    setFile(f);
    var buf = await f.arrayBuffer();
    var wb = XLSX.read(buf, { type: 'array', cellDates: true, raw: false });
    var ws = wb.Sheets['PARIOX DATA'] || wb.Sheets[wb.SheetNames[0]];
    if (!ws) { setParseErrors(['No PARIOX DATA sheet found']); return; }
    // sheet_to_json with header detection
    var raw = XLSX.utils.sheet_to_json(ws, { defval: null });
    var errors = [];
    var rows = raw.map(function(r, i) {
      var patient = clean(r['Patient']);
      var region = clean(r['Region']);
      if (!patient || !region) {
        errors.push('Row ' + (i+2) + ': missing patient or region');
        return null;
      }
      return {
        audit_complete:    toAuditComplete(r['Audit Complete']),
        patient_name:      patient,
        region:            region,
        address:           clean(r['Address']),
        discipline:        clean(r['Disc']),
        ref_source:        clean(r['Ref Source']),
        insurance_pariox:  clean(r['Insurance']),
        insurance_clean:   clean(r['Insurance.1']) || clean(r['Insurance']),
        changed_at:        toTs(r['Changed']),
        soc_date:          toDate(r['SOC']),
        is_ppo:            toBoolYN(r['PPO?']),
        auth_start_date:   toDate(r['AUTH START DATE']),
        auth_end_date:     toDate(r['AUTH END DATE']),
        visits_authorized: toInt(r['APPROVED # VISITS']),
        evals_authorized:  toInt(r['APPROVED # EVALS']),
        ras_authorized:    toInt(r['APPROVED # RAs']),
        notes:             clean(r['NOTES']),
        status_raw:        clean(r['Status']),
        status_normalized: normStatus(r['Status']),
        is_scheduled:      toBoolYN(r['SCHEDULED?']),
        frequency:         clean(r['FREQUENCY']),
        cc_notes:          clean(r['CC NOTES']),
        imported_batch:    'auth_audit_' + new Date().toISOString().slice(0, 10).replace(/-/g, '_'),
      };
    }).filter(function(r) { return r !== null; });
    setParsedRows(rows);
    setParseErrors(errors);
    setPhase('normalize');
  }

  async function stageRows() {
    setPhase('staging');
    setStagingError(null);
    var batchId = parsedRows[0].imported_batch;
    setStagingBatch(batchId);
    setStagingProgress({ done: 0, total: parsedRows.length });
    // Insert in chunks of 100
    var CHUNK = 100;
    for (var i = 0; i < parsedRows.length; i += CHUNK) {
      var slice = parsedRows.slice(i, i + CHUNK);
      try {
        var resp = await supabase.from('auth_audit_staging').insert(slice).select('id');
        if (resp.error) {
          // Surface error directly in staging UI — not in parseErrors which only
          // renders in the normalize phase.
          var msg = 'Chunk ' + Math.floor(i/CHUNK) + ' (rows ' + i + '–' + Math.min(i + CHUNK, parsedRows.length) + '): ' + resp.error.message;
          if (resp.error.code) msg += ' [code: ' + resp.error.code + ']';
          if (resp.error.hint) msg += ' — hint: ' + resp.error.hint;
          console.error('[AuditImport] stage chunk failed:', resp.error);
          setStagingError(msg);
          return;
        }
        // PostgREST quirk: RLS WITH CHECK violation returns 200 with empty data.
        // Detect that case by checking how many rows actually inserted.
        if (!resp.data || resp.data.length === 0) {
          setStagingError('Chunk ' + Math.floor(i/CHUNK) + ': insert returned 0 rows. This usually means RLS rejected the insert. Confirm you are signed in as admin / super_admin / ceo / director.');
          return;
        }
      } catch (e) {
        console.error('[AuditImport] stage chunk threw:', e);
        setStagingError('Chunk ' + Math.floor(i/CHUNK) + ' threw: ' + (e.message || String(e)));
        return;
      }
      setStagingProgress({ done: Math.min(i + CHUNK, parsedRows.length), total: parsedRows.length });
    }
    await loadPreviewData(batchId);
    setPhase('preview');
  }

  function resetImport() {
    setPhase('upload');
    setFile(null);
    setParsedRows([]);
    setParseErrors([]);
    setStagingError(null);
    setStagingBatch(null);
    setStagingProgress({ done: 0, total: 0 });
    setStagingRows([]);
    setSelected({});
  }

  // ────────────────────────────────────────────────────────────────────
  // PHASE 3: Load staging + current production data for diff preview
  // ────────────────────────────────────────────────────────────────────
  async function loadPreviewData(batchId) {
    var [stagingRes, censusRes, authsRes] = await Promise.all([
      fetchAllPages(supabase.from('auth_audit_staging').select('*').eq('imported_batch', batchId).is('applied_at', null)),
      fetchAllPages(supabase.from('census_data').select('id,patient_name,region,status,address,discipline,ref_source,insurance,inferred_frequency')),
      fetchAllPages(supabase.from('auth_tracker').select('id,patient_name,region,soc_date,auth_start_date,auth_expiry_date,visits_authorized,evals_authorized,reassessments_authorized,is_ppo,is_scheduled,notes,is_currently_active').eq('is_currently_active', true)),
    ]);
    setStagingRows(stagingRes);
    setCensus(censusRes);
    setAuths(authsRes);
    // If no rows are flagged audit_complete=1, auto-disable that filter so the
    // user isn't staring at an empty preview wondering what's wrong.
    var anyAudited = stagingRes.some(function(r) { return r.audit_complete === 1; });
    if (!anyAudited) {
      setFilters(function(prev) { return Object.assign({}, prev, { auditedOnly: false }); });
    }
  }

  // Build a lookup map: "name|region" → census row, auth row
  const matchMap = useMemo(function() {
    var m = {};
    function key(name, region) { return (name || '').toLowerCase().trim() + '|' + (region || ''); }
    census.forEach(function(c) {
      var k = key(c.patient_name, c.region);
      if (!m[k]) m[k] = {};
      if (!m[k].census) m[k].census = c;
    });
    auths.forEach(function(a) {
      var k = key(a.patient_name, a.region);
      if (!m[k]) m[k] = {};
      if (!m[k].auth) m[k].auth = a;
    });
    return m;
  }, [census, auths]);

  // For each staging row, compute the diff
  const stagingWithDiff = useMemo(function() {
    return stagingRows.map(function(s) {
      var k = (s.patient_name || '').toLowerCase().trim() + '|' + (s.region || '');
      var match = matchMap[k] || {};
      var diffs = computeDiff(s, match.census, match.auth);
      var changeCount = diffs.filter(function(d) { return d.willChange; }).length;
      return {
        row: s,
        censusMatch: match.census,
        authMatch: match.auth,
        diffs: diffs,
        changeCount: changeCount,
        matchStatus: match.census ? 'matched' : 'no_census_match',
      };
    });
  }, [stagingRows, matchMap]);

  // Apply filters
  const filteredRows = useMemo(function() {
    return stagingWithDiff.filter(function(item) {
      var r = item.row;
      if (filters.region !== 'ALL' && r.region !== filters.region) return false;
      if (filters.auditedOnly && r.audit_complete !== 1) return false;
      if (filters.statusFilter !== 'ALL' && r.status_normalized !== filters.statusFilter) return false;
      return true;
    });
  }, [stagingWithDiff, filters]);

  // Counts for the summary bar
  const counts = useMemo(function() {
    var total = filteredRows.length;
    var withChanges = filteredRows.filter(function(r) { return r.changeCount > 0; }).length;
    var noMatch = filteredRows.filter(function(r) { return r.matchStatus === 'no_census_match'; }).length;
    var selectedCount = Object.keys(selected).filter(function(k) { return selected[k]; }).length;
    return { total: total, withChanges: withChanges, noMatch: noMatch, selectedCount: selectedCount };
  }, [filteredRows, selected]);

  // ────────────────────────────────────────────────────────────────────
  // PHASE 4: APPLY selected rows
  // ────────────────────────────────────────────────────────────────────
  async function applySelected() {
    if (!window.confirm('Apply ' + counts.selectedCount + ' rows to production? This will write to census_data and auth_tracker. Changes are logged and reversible.')) return;
    setPhase('applying');
    var ids = Object.keys(selected).filter(function(k) { return selected[k]; });
    setApplyProgress({ done: 0, total: ids.length, errors: [] });
    var errors = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var { data, error } = await supabase.rpc('apply_audit_row', {
        staging_id: id,
        applied_by_name: profile?.full_name || 'unknown',
      });
      if (error || (data && data.error)) {
        errors.push({ id: id, msg: error ? error.message : data.error });
      }
      setApplyProgress({ done: i + 1, total: ids.length, errors: errors });
    }
    // Reload to refresh state
    await loadPreviewData(stagingBatch);
    setSelected({});
    setPhase('done');
  }

  // ────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'admin' && profile.role !== 'ceo' && profile.role !== 'director')) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Admin only</div>
        <div style={{ fontSize: 13, color: '#6B7280', marginTop: 8 }}>This page is restricted to super admin / admin / CEO / director roles.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--bg)' }}>
      <TopBar
        title="Authorization Audit Import"
        subtitle={'Phase: ' + phase + (stagingBatch ? ' · ' + stagingBatch : '')}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

        {/* Phase indicator */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {['upload', 'normalize', 'preview', 'apply'].map(function(p, i) {
            var phaseMap = { upload: 0, normalize: 1, staging: 1, preview: 2, applying: 3, done: 3 };
            var current = phaseMap[phase];
            var status = i < current ? 'done' : i === current ? 'active' : 'pending';
            var labels = ['1. Upload', '2. Stage', '3. Preview', '4. Apply'];
            return (
              <div key={p} style={{
                flex: 1, padding: '8px 12px', borderRadius: 6,
                background: status === 'done' ? '#D1FAE5' : status === 'active' ? '#FEF3C7' : '#F3F4F6',
                border: '1px solid ' + (status === 'active' ? '#FCD34D' : status === 'done' ? '#A7F3D0' : '#E5E7EB'),
                fontSize: 11, fontWeight: 700,
                color: status === 'done' ? '#059669' : status === 'active' ? '#92400E' : '#6B7280',
              }}>
                {status === 'done' ? '✓ ' : status === 'active' ? '→ ' : ''}{labels[i]}
              </div>
            );
          })}
        </div>

        {/* ─── PHASE 1: UPLOAD ─────────────────────────────────────── */}
        {phase === 'upload' && (
          <div style={{ background: 'white', border: '1px dashed #D1D5DB', borderRadius: 10, padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📤</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Upload the Authorization Audit XLSX</div>
            <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 16 }}>
              Looking for sheet named "PARIOX DATA" · expected columns: Patient, Region, Status, AUTH START DATE, etc.
            </div>
            <input type="file" accept=".xlsx,.xls" onChange={handleFile}
              style={{ padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12 }} />
          </div>
        )}

        {/* ─── PHASE 2: NORMALIZE / STAGE ──────────────────────────── */}
        {phase === 'normalize' && (
          <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 10, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Parsed {parsedRows.length} rows from {file?.name}</div>
            {parseErrors.length > 0 && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', padding: 10, borderRadius: 6, marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#991B1B', marginBottom: 4 }}>{parseErrors.length} parse warnings:</div>
                {parseErrors.slice(0, 5).map(function(e, i) { return <div key={i} style={{ fontSize: 10, color: '#7F1D1D' }}>{e}</div>; })}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
              <div><div style={{ fontSize: 9, color: '#6B7280', fontWeight: 700, textTransform: 'uppercase' }}>Total</div><div style={{ fontSize: 22, fontWeight: 900, fontFamily: 'DM Mono, monospace' }}>{parsedRows.length}</div></div>
              <div><div style={{ fontSize: 9, color: '#6B7280', fontWeight: 700, textTransform: 'uppercase' }}>Audit Complete</div><div style={{ fontSize: 22, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: '#059669' }}>{parsedRows.filter(function(r) { return r.audit_complete === 1; }).length}</div></div>
              <div><div style={{ fontSize: 9, color: '#6B7280', fontWeight: 700, textTransform: 'uppercase' }}>Status Normalized</div><div style={{ fontSize: 22, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: '#D97706' }}>{parsedRows.filter(function(r) { return r.status_raw !== r.status_normalized && r.status_raw !== null; }).length}</div></div>
              <div><div style={{ fontSize: 9, color: '#6B7280', fontWeight: 700, textTransform: 'uppercase' }}>CC Notes</div><div style={{ fontSize: 22, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: '#1565C0' }}>{parsedRows.filter(function(r) { return r.cc_notes; }).length}</div></div>
            </div>
            <button onClick={stageRows}
              style={{ padding: '10px 20px', background: '#111827', color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Stage all {parsedRows.length} rows to auth_audit_staging →
            </button>
            <div style={{ fontSize: 10, color: '#6B7280', marginTop: 8 }}>This is reversible — staging only. No production data is touched yet.</div>
          </div>
        )}

        {phase === 'staging' && (
          <div style={{ background: 'white', padding: 30, textAlign: 'center', borderRadius: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
              {stagingError ? '✗ Staging halted' : 'Staging rows...'}
            </div>
            <div style={{ fontSize: 24, fontFamily: 'DM Mono, monospace', fontWeight: 900, color: stagingError ? '#DC2626' : '#111827' }}>
              {stagingProgress.done} / {stagingProgress.total}
            </div>
            <div style={{ background: '#E5E7EB', borderRadius: 999, height: 8, marginTop: 12 }}>
              <div style={{ width: ((stagingProgress.done / stagingProgress.total) * 100) + '%', height: '100%', background: stagingError ? '#DC2626' : '#10B981', borderRadius: 999, transition: 'width 0.3s' }} />
            </div>
            {stagingError && (
              <div style={{
                marginTop: 16, padding: 14, background: '#FEF2F2', border: '1px solid #FECACA',
                borderRadius: 8, textAlign: 'left',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#991B1B', marginBottom: 6 }}>
                  Insert failed before completion
                </div>
                <div style={{ fontSize: 11, color: '#7F1D1D', fontFamily: 'DM Mono, monospace', wordBreak: 'break-word' }}>
                  {stagingError}
                </div>
                <div style={{ fontSize: 10, color: '#6B7280', marginTop: 10, lineHeight: 1.5 }}>
                  Partial rows from completed chunks may exist in <code>auth_audit_staging</code>. You can either
                  <strong> delete the batch </strong> (DELETE FROM auth_audit_staging WHERE imported_batch = '{stagingBatch}')
                  via the Supabase SQL editor and retry, or just retry — duplicates within a batch are tolerated by the preview.
                </div>
                <button onClick={resetImport}
                  style={{ marginTop: 12, padding: '6px 14px', background: '#DC2626', color: 'white', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  ← Reset to Upload
                </button>
              </div>
            )}
          </div>
        )}

        {/* ─── PHASE 3: PREVIEW ────────────────────────────────────── */}
        {(phase === 'preview' || phase === 'done') && (
          <>
            {/* Summary + filters */}
            <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                <div><div style={{ fontSize: 9, color: '#6B7280', fontWeight: 700, textTransform: 'uppercase' }}>In preview</div><div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'DM Mono, monospace' }}>{counts.total}</div></div>
                <div><div style={{ fontSize: 9, color: '#6B7280', fontWeight: 700, textTransform: 'uppercase' }}>With changes</div><div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: '#D97706' }}>{counts.withChanges}</div></div>
                <div><div style={{ fontSize: 9, color: '#6B7280', fontWeight: 700, textTransform: 'uppercase' }}>No census match</div><div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: '#DC2626' }}>{counts.noMatch}</div></div>
                <div><div style={{ fontSize: 9, color: '#6B7280', fontWeight: 700, textTransform: 'uppercase' }}>Selected</div><div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: '#059669' }}>{counts.selectedCount}</div></div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ fontSize: 11, color: '#6B7280' }}>Region:</label>
                <select value={filters.region} onChange={function(e) { setFilters(Object.assign({}, filters, { region: e.target.value })); }}
                  style={{ padding: '4px 8px', fontSize: 11, border: '1px solid #D1D5DB', borderRadius: 4 }}>
                  <option>ALL</option>
                  {['A','B','C','G','H','J','M','N','T','V'].map(function(r) { return <option key={r}>{r}</option>; })}
                </select>
                <label style={{ fontSize: 11, color: '#6B7280', marginLeft: 8 }}>
                  <input type="checkbox" checked={filters.auditedOnly} onChange={function(e) { setFilters(Object.assign({}, filters, { auditedOnly: e.target.checked })); }} />
                  {' '}Audit Complete = 1 only
                </label>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button
                    onClick={function() {
                      var s = {};
                      filteredRows.filter(function(r) { return r.changeCount > 0; }).forEach(function(r) { s[r.row.id] = true; });
                      setSelected(s);
                    }}
                    style={{ padding: '5px 12px', background: '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
                    Select all with changes
                  </button>
                  <button onClick={function() { setSelected({}); }}
                    style={{ padding: '5px 12px', background: '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
                    Clear selection
                  </button>
                  <button
                    onClick={applySelected}
                    disabled={counts.selectedCount === 0}
                    style={{
                      padding: '5px 14px', background: counts.selectedCount > 0 ? '#DC2626' : '#9CA3AF',
                      color: 'white', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 700,
                      cursor: counts.selectedCount > 0 ? 'pointer' : 'not-allowed',
                    }}>
                    Apply {counts.selectedCount} →
                  </button>
                </div>
              </div>
            </div>

            {/* Preview list */}
            <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '32px 40px 1.4fr 60px 110px 80px 80px', padding: '8px 14px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', fontSize: 9, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', gap: 8 }}>
                <span></span><span></span><span>Patient</span><span>Region</span><span>Status</span><span>Match</span><span style={{ textAlign: 'right' }}>Changes</span>
              </div>
              <div style={{ maxHeight: 600, overflowY: 'auto' }}>
                {filteredRows.slice(0, 200).map(function(item) {
                  var r = item.row;
                  var checked = !!selected[r.id];
                  var expanded = expandedRow === r.id;
                  return (
                    <div key={r.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '32px 40px 1.4fr 60px 110px 80px 80px', padding: '8px 14px', gap: 8, alignItems: 'center', cursor: 'pointer', background: expanded ? '#F9FAFB' : 'white' }}>
                        <input type="checkbox" checked={checked} onChange={function(e) {
                          var n = Object.assign({}, selected);
                          if (e.target.checked) n[r.id] = true; else delete n[r.id];
                          setSelected(n);
                        }} />
                        <span onClick={function() { setExpandedRow(expanded ? null : r.id); }} style={{ fontSize: 14, color: '#6B7280', cursor: 'pointer' }}>{expanded ? '▾' : '▸'}</span>
                        <span onClick={function() { setExpandedRow(expanded ? null : r.id); }} style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{r.patient_name}{r.audit_complete === 1 && <span style={{ marginLeft: 6, fontSize: 9, color: '#059669', fontWeight: 700 }}>✓audit</span>}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', fontFamily: 'DM Mono, monospace' }}>{r.region}</span>
                        <span style={{ fontSize: 10, color: '#6B7280' }}>{r.status_normalized}</span>
                        <span style={{ fontSize: 10, color: item.matchStatus === 'matched' ? '#059669' : '#DC2626', fontWeight: 600 }}>{item.matchStatus === 'matched' ? '✓ matched' : '✗ no match'}</span>
                        <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: item.changeCount > 0 ? '#D97706' : '#10B981' }}>{item.changeCount}</span>
                      </div>
                      {expanded && (
                        <div style={{ padding: '8px 14px 14px 80px', background: '#FAFAFA', borderTop: '1px solid #F3F4F6' }}>
                          {item.diffs.length === 0 ? (
                            <div style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic' }}>No fields to compare</div>
                          ) : (
                            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                              <thead><tr style={{ background: '#F3F4F6' }}>
                                <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: 9, color: '#6B7280', textTransform: 'uppercase' }}>Field</th>
                                <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: 9, color: '#6B7280', textTransform: 'uppercase' }}>Current</th>
                                <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: 9, color: '#6B7280', textTransform: 'uppercase' }}>Audit Value</th>
                                <th style={{ padding: '4px 8px', textAlign: 'right', fontSize: 9, color: '#6B7280', textTransform: 'uppercase' }}>Diff?</th>
                              </tr></thead>
                              <tbody>{item.diffs.map(function(d, i) {
                                return (
                                  <tr key={i} style={{ background: d.willChange ? '#FFFBEB' : 'transparent' }}>
                                    <td style={{ padding: '4px 8px', fontWeight: 600 }}>{d.field}</td>
                                    <td style={{ padding: '4px 8px', color: '#6B7280', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(d.current === null || d.current === undefined ? '—' : d.current)}</td>
                                    <td style={{ padding: '4px 8px', color: '#111827', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(d.audit)}</td>
                                    <td style={{ padding: '4px 8px', textAlign: 'right', color: d.willChange ? '#D97706' : '#10B981', fontWeight: 700, fontSize: 10 }}>{d.willChange ? 'CHANGE' : 'same'}</td>
                                  </tr>
                                );
                              })}</tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {filteredRows.length > 200 && (
                  <div style={{ padding: 12, textAlign: 'center', fontSize: 10, color: '#9CA3AF', background: '#F9FAFB' }}>
                    Showing 200 of {filteredRows.length} · refine filters to see more
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ─── PHASE 4: APPLYING ───────────────────────────────────── */}
        {phase === 'applying' && (
          <div style={{ background: 'white', padding: 30, textAlign: 'center', borderRadius: 10, marginTop: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Applying to production...</div>
            <div style={{ fontSize: 24, fontFamily: 'DM Mono, monospace', fontWeight: 900 }}>{applyProgress.done} / {applyProgress.total}</div>
            <div style={{ background: '#E5E7EB', borderRadius: 999, height: 8, marginTop: 12 }}>
              <div style={{ width: ((applyProgress.done / applyProgress.total) * 100) + '%', height: '100%', background: '#DC2626', borderRadius: 999, transition: 'width 0.3s' }} />
            </div>
            {applyProgress.errors.length > 0 && (
              <div style={{ marginTop: 12, fontSize: 10, color: '#DC2626' }}>
                {applyProgress.errors.length} error(s): {applyProgress.errors.slice(0,3).map(function(e) { return e.msg; }).join(' · ')}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
