// MedicareRosterUploadCard.jsx
//
// Card for the Data Uploads page that handles Liam's manual Medicare roster
// XLSX (the "Medicare List - All Regions" file). Mirrors the visual + size
// of the other upload cards (Visit Schedule, Patient Census, High Risk) so
// the page stays consistent.
//
// Flow:
//   1. Operator picks the file. Card parses it locally.
//   2. A modal slides in with a field-level diff vs current
//      medicare_visit_flags rows + new/updated/unchanged counts.
//   3. Apply button does:
//        - in_active_roster=false on all current Medicare rows
//        - upsert the 62-ish rows from the file (manual_visit_count,
//          manual_eval_date, manual_pta_cota, etc.) with in_active_roster=true
//        - one data_audit_log row per changed field (reversible)
//      The DB triggers handle episode rollover + ready_for_discharge.
//
// CRITICAL GUARDRAIL: this card never touches total_completed_visits or
// current_episode_visit_count. Pariox owns those numbers. Manual numbers
// land in manual_visit_count so drift stays visible.
//
// Admin / super_admin only — the card renders a disabled state for others
// so the page layout doesn't shift.

import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

const ADMIN_ROLES = new Set(['super_admin', 'admin', 'director', 'ceo']);

// Header alias map — tolerates the typos in Liam's source file (" Number of
// Visits Consume" w/ leading space + missing 'd') so future uploads work
// even if column headers drift slightly.
const HEADER_MAP = {
  'patient name': 'patient_name',
  'address': 'address',
  'disc': 'discipline', 'discipline': 'discipline',
  'ref source': 'ref_source', 'ref src': 'ref_source',
  'status': 'patient_status',
  'region': 'region',
  'evaluation date': 'manual_eval_date', 'eval date': 'manual_eval_date',
  'pt/ot': 'manual_lead_therapist', 'pt / ot': 'manual_lead_therapist',
  'pta/cota': 'manual_pta_cota', 'pta / cota': 'manual_pta_cota',
  '10th visit progress note date': 'manual_tenth_visit_date',
  '10th visit date': 'manual_tenth_visit_date',
  'number of visits allowed': 'ignored__visits_allowed',
  'number of visits consume': 'manual_visit_count',
  'number of visits consumed': 'manual_visit_count',
  'visits consumed': 'manual_visit_count',
  'visit remaining': 'ignored__remaining',
  'visits remaining': 'ignored__remaining',
  '20th visit note discharge summary': 'manual_twentieth_visit_date',
  '20th visit discharge note date': 'manual_twentieth_visit_date',
  '20th visit date': 'manual_twentieth_visit_date',
  'notes': 'roster_notes',
};

const DIFF_FIELDS = [
  ['region', 'Region'],
  ['address', 'Address'],
  ['discipline', 'Disc'],
  ['ref_source', 'Ref'],
  ['patient_status', 'Status'],
  ['manual_eval_date', 'Eval Date'],
  ['manual_lead_therapist', 'PT/OT'],
  ['manual_pta_cota', 'PTA/COTA'],
  ['manual_tenth_visit_date', '10th Visit'],
  ['manual_visit_count', 'Manual Count'],
  ['manual_twentieth_visit_date', '20th Visit'],
  ['roster_notes', 'Notes'],
];

function normHeader(h) { return (h || '').toString().toLowerCase().trim(); }
function s(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}
function n(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.floor(v);
  const t = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Math.floor(Number(t));
  return null;
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

function parseSheet(buffer) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  return rows.map(row => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      const canonical = HEADER_MAP[normHeader(k)];
      if (!canonical || canonical.startsWith('ignored__')) continue;
      if (canonical === 'manual_visit_count') out[canonical] = n(v);
      else out[canonical] = s(v);
    }
    return out;
  }).filter(r => r.patient_name);
}

function diffField(oldV, newV) {
  const a = oldV == null ? '' : String(oldV).trim();
  const b = newV == null ? '' : String(newV).trim();
  if (a === b) return { kind: 'same', a, b };
  if (a === '') return { kind: 'new', a, b };
  return { kind: 'changed', a, b };
}

export default function MedicareRosterUploadCard({ profile }) {
  const isAdmin = profile && ADMIN_ROLES.has(profile.role);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState([]);
  const [existing, setExisting] = useState({});
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | parsing | preview | applying | done
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setFileName(file.name);
    setPhase('parsing');
    try {
      const buf = await file.arrayBuffer();
      const rows = parseSheet(buf);
      if (rows.length === 0) {
        setError('No patient rows found. Check the header row matches the spec.');
        setPhase('idle');
        return;
      }
      const names = rows.map(r => r.patient_name);
      const { data: dbRows } = await supabase.from('medicare_visit_flags')
        .select('*').in('patient_name', names);
      const byName = {};
      for (const r of (dbRows || [])) byName[r.patient_name] = r;
      setExisting(byName);
      setParsed(rows);
      setPhase('preview');
      setShowModal(true);
    } catch (err) {
      console.error(err);
      setError('Parse failed: ' + err.message);
      setPhase('idle');
    }
    e.target.value = ''; // reset so same filename can be re-picked
  }

  const stats = useMemo(() => {
    if (!parsed.length) return null;
    let news = 0, changed = 0, unchanged = 0;
    for (const r of parsed) {
      const ex = existing[r.patient_name];
      if (!ex) { news++; continue; }
      let hasChange = false;
      for (const [k] of DIFF_FIELDS) {
        if (diffField(ex[k], r[k]).kind !== 'same') hasChange = true;
      }
      if (hasChange) changed++; else unchanged++;
    }
    return { news, changed, unchanged };
  }, [parsed, existing]);

  async function applyImport() {
    setPhase('applying');
    setProgress(0);
    const source = fileName + ' (' + todayISO() + ')';
    const profileName = profile?.full_name || profile?.email || 'unknown';

    await supabase.from('medicare_visit_flags')
      .update({ in_active_roster: false }).eq('in_active_roster', true);

    const upsertRows = parsed.map(r => ({
      patient_name: r.patient_name,
      region: r.region, address: r.address, discipline: r.discipline,
      ref_source: r.ref_source, patient_status: r.patient_status,
      manual_eval_date: r.manual_eval_date || null,
      manual_lead_therapist: r.manual_lead_therapist,
      manual_pta_cota: r.manual_pta_cota,
      manual_tenth_visit_date: r.manual_tenth_visit_date || null,
      manual_visit_count: r.manual_visit_count,
      manual_twentieth_visit_date: r.manual_twentieth_visit_date || null,
      roster_notes: r.roster_notes,
      manual_visit_count_source: source,
      manual_visit_count_imported_at: new Date().toISOString(),
      last_seen_in_import_at: new Date().toISOString(),
      last_import_source: source,
      in_active_roster: true, is_active: true,
      updated_at: new Date().toISOString(),
    }));
    const chunk = 25;
    for (let i = 0; i < upsertRows.length; i += chunk) {
      const slice = upsertRows.slice(i, i + chunk);
      const { error: upErr } = await supabase.from('medicare_visit_flags')
        .upsert(slice, { onConflict: 'patient_name' });
      if (upErr) { setError('Upsert failed: ' + upErr.message); setPhase('preview'); return; }
      setProgress(Math.round((i + slice.length) / upsertRows.length * 100));
    }

    const names = parsed.map(r => r.patient_name);
    const { data: refreshed } = await supabase.from('medicare_visit_flags')
      .select('id, patient_name, region').in('patient_name', names);
    const idByName = {};
    for (const r of (refreshed || [])) idByName[r.patient_name] = r;
    const auditRows = [];
    for (const r of parsed) {
      const ex = existing[r.patient_name];
      const idRow = idByName[r.patient_name];
      if (!idRow) continue;
      for (const [k] of DIFF_FIELDS) {
        const d = diffField(ex?.[k], r[k]);
        if (d.kind === 'same') continue;
        auditRows.push({
          source, table_name: 'medicare_visit_flags',
          row_id: idRow.id, patient_name: r.patient_name, region: idRow.region,
          field_name: k, old_value: d.a || null, new_value: d.b || null,
          changed_by: 'import:' + profileName, applied_at: new Date().toISOString(),
        });
      }
    }
    for (let i = 0; i < auditRows.length; i += 50) {
      await supabase.from('data_audit_log').insert(auditRows.slice(i, i + 50));
    }

    setResult({ upserted: parsed.length, audit_rows: auditRows.length, source });
    setPhase('done');
  }

  function closeModal() {
    setShowModal(false);
    setPhase('idle');
    setParsed([]); setExisting({}); setResult(null); setProgress(0);
    setFileName('');
  }

  return (
    <>
      {/* CARD — matches the other upload cards visually */}
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ fontSize: 24 }}>{'🏥'}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--black)' }}>
              Medicare Roster
            </div>
            <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 4, lineHeight: 1.5 }}>
              Liam's manual Medicare list (.xlsx). 15-column spec: Patient,
              Address, Disc, Ref, Status, Region, Eval Date, PT/OT, PTA/COTA,
              10th Visit, Visits Allowed, Visits Consumed, Visits Remaining,
              20th Visit, Notes. Updates manual columns; never overwrites Pariox visit counts.
            </div>
          </div>
        </div>

        {error && (
          <div style={{
            padding: '8px 12px', background: '#FEF2F2', color: '#991B1B',
            border: '1px solid #FCA5A5', borderRadius: 6, fontSize: 12,
          }}>{error}</div>
        )}

        {!isAdmin && (
          <div style={{ padding: 10, background: 'var(--bg)', borderRadius: 6,
            fontSize: 11, color: 'var(--gray)' }}>
            Admin or super_admin role required.
          </div>
        )}

        <label style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '10px 14px', background: isAdmin ? '#1565C0' : 'var(--gray)',
          color: '#fff', borderRadius: 7, fontSize: 13, fontWeight: 700,
          cursor: isAdmin ? 'pointer' : 'not-allowed', opacity: isAdmin ? 1 : 0.5,
        }}>
          {phase === 'parsing' ? 'Parsing...' : 'Choose XLSX'}
          <input type="file" accept=".xlsx,.xls" onChange={onFile}
            disabled={!isAdmin || phase === 'parsing'}
            style={{ display: 'none' }} />
        </label>
        <div style={{ fontSize: 10, color: 'var(--gray)', textAlign: 'center' }}>
          {fileName ? fileName : 'Stages changes for preview before any DB write'}
        </div>
      </div>

      {/* MODAL — diff preview + apply */}
      {showModal && (
        <div onClick={closeModal}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--card-bg)', borderRadius: 14,
            width: '100%', maxWidth: 1100, maxHeight: '88vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
          }}>
            <div style={{
              padding: '14px 20px', borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: '#0F1117', color: '#fff', borderRadius: '14px 14px 0 0',
            }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>Medicare Roster Import</div>
                <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{fileName}</div>
              </div>
              <button onClick={closeModal} disabled={phase === 'applying'}
                style={{
                  background: 'transparent', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: 6, padding: '4px 12px', fontSize: 13,
                  cursor: phase === 'applying' ? 'wait' : 'pointer',
                }}>{'✕'}</button>
            </div>

            {phase === 'preview' && (
              <>
                <div style={{
                  padding: '14px 20px', borderBottom: '1px solid var(--border)',
                  display: 'flex', gap: 12, alignItems: 'center',
                }}>
                  <Stat label="New" value={stats?.news || 0} color="#065F46" />
                  <Stat label="Updated" value={stats?.changed || 0} color="#1E40AF" />
                  <Stat label="Unchanged" value={stats?.unchanged || 0} color="var(--gray)" />
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <button onClick={closeModal} style={btnSecondary}>Cancel</button>
                    <button onClick={applyImport} style={btnPrimary}>
                      Apply Import ({parsed.length} rows)
                    </button>
                  </div>
                </div>
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
                      <tr>
                        <th style={thS}>Patient</th>
                        {DIFF_FIELDS.map(([k, l]) => <th key={k} style={thS}>{l}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.map((r, i) => {
                        const ex = existing[r.patient_name];
                        const isNew = !ex;
                        return (
                          <tr key={i} style={{
                            borderBottom: '1px solid var(--border)',
                            background: isNew ? '#ECFDF5' : 'transparent',
                          }}>
                            <td style={tdS}>
                              <div style={{ fontWeight: 700 }}>{r.patient_name}</div>
                              {isNew && <div style={{ fontSize: 9, color: '#065F46' }}>+ new</div>}
                            </td>
                            {DIFF_FIELDS.map(([k]) => {
                              const d = diffField(ex?.[k], r[k]);
                              const bg = d.kind === 'changed' ? '#FEF3C7'
                                       : d.kind === 'new' ? '#ECFDF5'
                                       : 'transparent';
                              return (
                                <td key={k} style={{ ...tdS, background: bg }}>
                                  {d.kind === 'changed' && (
                                    <div style={{
                                      fontSize: 9, opacity: 0.6,
                                      textDecoration: 'line-through',
                                    }}>{d.a || '-'}</div>
                                  )}
                                  <div>{d.b || '-'}</div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {phase === 'applying' && (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                  Applying import...
                </div>
                <div style={{
                  width: '100%', background: 'var(--border)', borderRadius: 6,
                  height: 8, overflow: 'hidden',
                }}>
                  <div style={{
                    width: progress + '%', background: '#1565C0', height: '100%',
                    transition: 'width 0.3s',
                  }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 6 }}>
                  {progress}%
                </div>
              </div>
            )}

            {phase === 'done' && result && (
              <div style={{ padding: 30, textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>{'✓'}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#065F46' }}>
                  Import complete
                </div>
                <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 6 }}>
                  {result.upserted} patient rows upserted - {result.audit_rows} audit log entries written.
                </div>
                <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 8 }}>
                  Source: {result.source}
                </div>
                <button onClick={closeModal} style={{ ...btnPrimary, marginTop: 18 }}>
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{
      background: 'var(--bg)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '8px 12px',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase',
      }}>{label}</div>
      <div style={{
        fontSize: 20, fontWeight: 900, color, fontFamily: 'DM Mono, monospace',
      }}>{value}</div>
    </div>
  );
}

const btnPrimary = {
  padding: '7px 14px', background: '#1565C0', color: '#fff', border: 'none',
  borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
};
const btnSecondary = {
  padding: '7px 14px', background: 'var(--card-bg)', color: 'var(--black)',
  border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, fontWeight: 600,
  cursor: 'pointer',
};
const thS = {
  padding: '8px 10px', fontSize: 10, fontWeight: 700, color: 'var(--gray)',
  textTransform: 'uppercase', textAlign: 'left',
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
};
const tdS = { padding: '7px 10px', verticalAlign: 'top' };
