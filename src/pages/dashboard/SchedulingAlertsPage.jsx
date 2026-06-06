// =====================================================================
// SchedulingAlertsPage.jsx — Reassessments & Evaluations Monitor
//
// Renamed/repurposed 2026-06-05 per docs/Reassess_Eval_Telehealth_Design.md.
// URL slug stays 'scheduling-alerts' so the four internal links to this
// page (AlertsBell, ExceptionFeed, ManagerScorecards, Dashboard.jsx)
// keep working. Sidebar label moved to "Reassessments & Evals" and the
// section moved from CARE COORDINATION -> CLINICAL DEPARTMENT.
//
// TWO TABS:
//   - Reassessments  (existing patient_clinical_settings engine)
//   - Evaluations    (NEW — census_data 'Eval Pending' patients with
//                     48h SLA tracking, joined to visit_schedule_data
//                     eval rows using per-(patient,date) latest-
//                     uploaded_at Pariox dedup — see CLAUDE.md #10).
//
// 48-hour SLA: census_data status change -> Eval Pending starts the
// clock (trigger stamps status_first_seen). Hourly pg_cron job
// fire_eval_pending_sla_breach_alerts() inserts a high-priority
// alert when wall-clock hours > 48 and no eval is on the schedule.
//
// JSX-unicode rule: per CLAUDE.md #4 we wrap any non-ASCII glyphs in
// JS expressions like {'⚠'} so the build tooling doesn't store
// them as broken escape sequences.
// =====================================================================

import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages, safeUpdate, logActivity } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import { isEval, isCompleted, isCancelled, isMissed } from '../../lib/visitMath';

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

const FREQ_OPTIONS = [
  { k: '4x_week',     l: '4x / Week',   days: 2 },
  { k: '3x_week',     l: '3x / Week',   days: 2 },
  { k: '2x_week',     l: '2x / Week',   days: 4 },
  { k: '1x_week',     l: '1x / Week',   days: 7 },
  { k: '2x_month',    l: '2x / Month',  days: 14 },
  { k: '1x_month',    l: '1x / Month',  days: 30 },
  { k: 'maintenance', l: 'Maintenance', days: 30 },
  { k: 'prn',         l: 'PRN',         days: null },
];

// Reassessment status config (existing 30/45-day engine)
const REASSESS_STATUS = {
  overdue:    { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', label: 'OVERDUE' },
  critical:   { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', label: 'Critical (<=7d)' },
  urgent:     { color: '#D97706', bg: '#FEF3C7', border: '#FCD34D', label: 'Urgent (<=14d)' },
  approaching:{ color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE', label: 'Approaching' },
  ok:         { color: '#059669', bg: '#ECFDF5', border: '#A7F3D0', label: 'OK (>14d)' },
  scheduled:  { color: '#1565C0', bg: '#EFF6FF', border: '#BFDBFE', label: 'Scheduled' },
  no_data:    { color: '#6B7280', bg: '#F3F4F6', border: '#E5E7EB', label: 'No Data' },
  unknown:    { color: '#6B7280', bg: '#F3F4F6', border: '#E5E7EB', label: 'Unknown' },
};

// Eval SLA buckets — 48h wall-clock hard deadline
const EVAL_STATUS = {
  breach:      { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', label: 'SLA Breach (>48h)' },
  warn:        { color: '#D97706', bg: '#FEF3C7', border: '#FCD34D', label: 'Warning (24-48h)' },
  scheduled:   { color: '#059669', bg: '#ECFDF5', border: '#A7F3D0', label: 'Eval Scheduled' },
  on_track:    { color: '#1565C0', bg: '#EFF6FF', border: '#BFDBFE', label: 'On Track (<24h)' },
  completed:   { color: '#0D9488', bg: '#F0FDFA', border: '#99F6E4', label: 'Eval Completed' },
  unknown:     { color: '#6B7280', bg: '#F3F4F6', border: '#E5E7EB', label: 'Unknown' },
};

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d + 'T00:00:00') - new Date()) / 86400000);
}
function hoursSince(ts) {
  if (!ts) return null;
  return (Date.now() - new Date(ts).getTime()) / 3600000;
}

// Per-(patient, visit_date) latest-uploaded_at dedup — CLAUDE.md #10
function dedupLatestPerSlot(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = (r.patient_name || '') + '||' + (r.visit_date || '');
    const prev = map.get(key);
    if (!prev || new Date(r.uploaded_at) > new Date(prev.uploaded_at)) {
      map.set(key, r);
    }
  }
  return Array.from(map.values());
}

// ── Frequency Edit Modal (reassessment side) ─────────────────────────
function FrequencyModal({ patient, onClose, onSaved, profileName }) {
  const [freq, setFreq] = useState(patient.visit_frequency || patient.inferred_frequency || '');
  const [clinician, setClinician] = useState(patient.reassessment_clinician || '');
  const [notes, setNotes] = useState(patient.clinical_notes || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await supabase.from('patient_clinical_settings').update({
      visit_frequency: freq || null,
      reassessment_clinician: clinician || null,
      clinical_notes: notes || null,
      frequency_set_by: profileName,
      frequency_set_date: new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    }).eq('patient_name', patient.patient_name);
    setSaving(false);
    onSaved();
  }

  const sc = REASSESS_STATUS[patient.reassessment_status] || REASSESS_STATUS.unknown;
  const daysLeft = daysUntil(patient.next_reassessment_deadline);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--card-bg)', borderRadius: 14, width: '100%', maxWidth: 520, boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ padding: '16px 22px', background: '#0F1117', borderRadius: '14px 14px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{patient.patient_name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
              Region {patient.region} {'·'} {patient.insurance}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}>{'×'}</button>
        </div>

        <div style={{ padding: '10px 22px', background: sc.bg, borderBottom: '2px solid ' + sc.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: sc.color }}>Reassessment {sc.label}</div>
            <div style={{ fontSize: 11, color: sc.color, marginTop: 2 }}>
              Last: {fmtDate(patient.last_reassessment_date)} {'·'} Target: {fmtDate(patient.next_reassessment_target)} {'·'} Deadline: {fmtDate(patient.next_reassessment_deadline)}
            </div>
          </div>
          {daysLeft !== null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: sc.color }}>{daysLeft}d</div>
              <div style={{ fontSize: 9, color: sc.color }}>until deadline</div>
            </div>
          )}
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {patient.inferred_frequency && !patient.visit_frequency && (
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#1565C0' }}>
              System inferred <strong>{FREQ_OPTIONS.find(f => f.k === patient.inferred_frequency)?.l || patient.inferred_frequency}</strong> from {patient.inferred_from_visits} visits in the last 60 days. Confirm or override below.
            </div>
          )}
          {patient.visit_frequency && (
            <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#065F46' }}>
              Frequency manually set to <strong>{FREQ_OPTIONS.find(f => f.k === patient.visit_frequency)?.l || patient.visit_frequency}</strong> by {patient.frequency_set_by || 'unknown'}
            </div>
          )}

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 8 }}>Visit Frequency</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
              {FREQ_OPTIONS.map(f => (
                <button key={f.k} onClick={() => setFreq(f.k)}
                  style={{ padding: '8px 4px', borderRadius: 7, border: '2px solid ' + (freq === f.k ? '#1565C0' : 'var(--border)'), background: freq === f.k ? '#EFF6FF' : 'var(--card-bg)', fontSize: 11, fontWeight: 700, color: freq === f.k ? '#1565C0' : 'var(--gray)', cursor: 'pointer' }}>
                  {f.l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Assigned Reassessment Clinician (PT/OT)</label>
            <input value={clinician} onChange={e => setClinician(e.target.value)}
              placeholder="e.g. Brian Espinola, PT"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, outline: 'none', background: 'var(--bg)', boxSizing: 'border-box' }} />
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Clinical Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Scheduling considerations, clinician availability notes, patient preferences..."
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, outline: 'none', background: 'var(--bg)', boxSizing: 'border-box', resize: 'vertical', minHeight: 70 }} />
          </div>
        </div>

        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--bg)' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--card-bg)' }}>Cancel</button>
          <button onClick={save} disabled={saving}
            style={{ padding: '8px 22px', background: '#1565C0', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {saving ? 'Saving...' : 'Save Frequency'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Eval Schedule Modal — for the new Evaluations tab ────────────────
function EvalScheduleModal({ row, telehealthRoster, profile, onClose, onSaved }) {
  const [date, setDate] = useState('');
  const [clinician, setClinician] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const sc = EVAL_STATUS[row.eval_status] || EVAL_STATUS.unknown;
  const hrs = hoursSince(row.status_first_seen);

  async function markScheduled() {
    if (!date || !clinician) {
      alert('Pick a date and clinician.');
      return;
    }
    setSaving(true);
    // Insert care_coord_notes entry so the action is auditable
    await supabase.from('care_coord_notes').insert({
      patient_name: row.patient_name,
      note_type: 'eval_scheduled',
      note_text: 'Eval scheduled for ' + date + ' with ' + clinician + (note ? '. ' + note : ''),
      created_by: profile?.full_name || profile?.email,
      created_by_role: profile?.role,
    });
    // Log activity
    logActivity({
      coordinatorId: profile?.id,
      coordinatorName: profile?.full_name || profile?.email,
      coordinatorRole: profile?.role,
      actionType: 'eval_marked_scheduled',
      actionDetail: 'Eval scheduled ' + date + ' with ' + clinician,
      patientName: row.patient_name,
      tableName: 'care_coord_notes',
      metadata: { eval_date: date, clinician, hours_in_eval_pending: hrs },
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--card-bg)', borderRadius: 14, width: '100%', maxWidth: 560, boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ padding: '16px 22px', background: '#0F1117', borderRadius: '14px 14px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{row.patient_name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
              Region {row.region} {'·'} {row.insurance || 'No insurance on file'} {'·'} Eval Pending
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}>{'×'}</button>
        </div>

        <div style={{ padding: '10px 22px', background: sc.bg, borderBottom: '2px solid ' + sc.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: sc.color }}>{sc.label}</div>
            <div style={{ fontSize: 11, color: sc.color, marginTop: 2 }}>
              Eval Pending since {fmtDateTime(row.status_first_seen)} {'·'} 48h SLA
            </div>
          </div>
          {hrs !== null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: sc.color }}>
                {hrs.toFixed(0)}h
              </div>
              <div style={{ fontSize: 9, color: sc.color }}>elapsed</div>
            </div>
          )}
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {row.scheduled_eval_date && (
            <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#065F46' }}>
              Eval already on Pariox: <strong>{fmtDate(row.scheduled_eval_date)}</strong> with <strong>{row.scheduled_eval_clinician || 'unknown clinician'}</strong> {row.scheduled_eval_status ? '(' + row.scheduled_eval_status + ')' : ''}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Eval Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, outline: 'none', background: 'var(--bg)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Telehealth Clinician</label>
              <select value={clinician} onChange={e => setClinician(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, outline: 'none', background: 'var(--bg)', boxSizing: 'border-box' }}>
                <option value="">Select...</option>
                {telehealthRoster.map(c => (
                  <option key={c.id} value={c.full_name}>{c.full_name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Note (optional)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="Patient availability, special considerations..."
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, outline: 'none', background: 'var(--bg)', boxSizing: 'border-box', resize: 'vertical', minHeight: 60 }} />
          </div>

          <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 7, padding: '8px 12px', fontSize: 10, color: '#92400E' }}>
            Logging the schedule here marks intent and writes to <code>care_coord_notes</code>. The actual Pariox booking still needs to happen in Pariox - this record is the audit trail.
          </div>
        </div>

        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--bg)' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--card-bg)' }}>Cancel</button>
          <button onClick={markScheduled} disabled={saving}
            style={{ padding: '8px 22px', background: '#1565C0', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {saving ? 'Saving...' : 'Mark Eval Scheduled'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Classify eval SLA bucket ─────────────────────────────────────────
function classifyEvalRow(row) {
  // row has: status_first_seen, scheduled_eval_date, scheduled_eval_status
  if (row.scheduled_eval_status && /completed/i.test(row.scheduled_eval_status)) return 'completed';
  if (row.scheduled_eval_date) return 'scheduled';
  const hrs = hoursSince(row.status_first_seen);
  if (hrs === null) return 'unknown';
  if (hrs > 48) return 'breach';
  if (hrs >= 24) return 'warn';
  return 'on_track';
}

// ── Main Page ────────────────────────────────────────────────────────
export default function SchedulingAlertsPage() {
  const { profile } = useAuth();
  const [patients, setPatients] = useState([]);
  const [evalRows, setEvalRows] = useState([]);
  const [telehealthRoster, setTelehealthRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('reassessment');
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterEvalStatus, setFilterEvalStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [editPatient, setEditPatient] = useState(null);
  const [editEval, setEditEval] = useState(null);

  const myRegions = useMemo(() => {
    const r = profile?.role;
    if (['super_admin','admin','assoc_director','pod_leader','telehealth','director','ceo'].includes(r)) return null;
    return profile?.regions || null;
  }, [profile]);

  const load = useCallback(async () => {
    // 1. Reassessment patients (existing patient_clinical_settings engine)
    let pcsQ = supabase.from('patient_clinical_settings').select('*').order('next_reassessment_deadline', { ascending: true, nullsFirst: false });
    if (myRegions?.length) pcsQ = pcsQ.in('region', myRegions);
    const { data: pcs } = await pcsQ;

    // 2. Eval Pending patients
    let cdQ = supabase.from('census_data')
      .select('patient_name, region, insurance, status, status_first_seen, last_seen_date')
      .ilike('status', 'Eval Pending%')
      .not('patient_name', 'ilike', 'TEST%');
    if (myRegions?.length) cdQ = cdQ.in('region', myRegions);
    const cdRows = await fetchAllPages(cdQ);

    // 3. Eval-type visits in the last 90d (covers SLA window + any
    //    completed evals we want to suppress)
    const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    let vsdQ = supabase.from('visit_schedule_data')
      .select('patient_name, region, visit_date, staff_name, event_type, status, uploaded_at')
      .or('event_type.ilike.%Evaluation%,event_type.ilike.%Initial Assessment%')
      .gte('visit_date', ninetyAgo);
    const vsdRows = await fetchAllPages(vsdQ);
    const dedupedVisits = dedupLatestPerSlot(vsdRows);

    // Build patient -> earliest future-or-recent eval visit map
    const evalByPatient = new Map();
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const v of dedupedVisits) {
      const k = v.patient_name;
      const prev = evalByPatient.get(k);
      // Prefer future or today's eval; fall back to most recent past eval
      const isFuture = v.visit_date >= todayStr;
      if (!prev) {
        evalByPatient.set(k, v);
      } else {
        const prevFuture = prev.visit_date >= todayStr;
        if (isFuture && !prevFuture) evalByPatient.set(k, v);
        else if (isFuture && prevFuture && v.visit_date < prev.visit_date) evalByPatient.set(k, v);
        else if (!isFuture && !prevFuture && v.visit_date > prev.visit_date) evalByPatient.set(k, v);
      }
    }

    // 4. Telehealth roster (live from coordinators)
    const { data: roster } = await supabase
      .from('coordinators')
      .select('id, full_name, email, weekly_visit_target, is_active')
      .eq('role', 'telehealth')
      .eq('is_active', true)
      .order('full_name');

    // Build eval rows
    const evals = cdRows.map(p => {
      const v = evalByPatient.get(p.patient_name);
      const row = {
        patient_name: p.patient_name,
        region: p.region,
        insurance: p.insurance,
        census_status: p.status,
        status_first_seen: p.status_first_seen,
        last_seen_date: p.last_seen_date,
        scheduled_eval_date: v?.visit_date || null,
        scheduled_eval_clinician: v?.staff_name || null,
        scheduled_eval_status: v?.status || null,
        scheduled_eval_event_type: v?.event_type || null,
      };
      row.eval_status = classifyEvalRow(row);
      row.hours_in_eval_pending = hoursSince(p.status_first_seen);
      return row;
    });

    setPatients(pcs || []);
    setEvalRows(evals);
    setTelehealthRoster(roster || []);
    setLoading(false);
  }, [myRegions]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable(['patient_clinical_settings', 'census_data', 'visit_schedule_data'], load);

  const stats = useMemo(() => {
    const active = patients;
    const evalStats = {
      total: evalRows.length,
      breach: evalRows.filter(e => e.eval_status === 'breach').length,
      warn: evalRows.filter(e => e.eval_status === 'warn').length,
      scheduled: evalRows.filter(e => e.eval_status === 'scheduled').length,
      completed: evalRows.filter(e => e.eval_status === 'completed').length,
      on_track: evalRows.filter(e => e.eval_status === 'on_track').length,
      unscheduled: evalRows.filter(e => !e.scheduled_eval_date).length,
    };
    return {
      total: active.length,
      overdue: active.filter(p => p.reassessment_status === 'overdue').length,
      critical: active.filter(p => p.reassessment_status === 'critical').length,
      urgent: active.filter(p => p.reassessment_status === 'urgent').length,
      approaching: active.filter(p => p.reassessment_status === 'approaching').length,
      scheduled: active.filter(p => p.reassessment_status === 'scheduled').length,
      noVisitsFuture: active.filter(p => p.alert_no_visits_scheduled).length,
      noFrequency: active.filter(p => !p.visit_frequency).length,
      unscheduledReassessment: active.filter(p => p.alert_reassessment_unscheduled).length,
      eval: evalStats,
    };
  }, [patients, evalRows]);

  // ── Reassessment tab list ─────────────────────────────────────────
  const reassessFiltered = useMemo(() => {
    let list = patients;
    list = list.filter(p => p.last_reassessment_date && p.reassessment_status !== 'scheduled');
    if (filterRegion !== 'ALL') list = list.filter(p => p.region === filterRegion);
    if (filterStatus !== 'ALL') list = list.filter(p => p.reassessment_status === filterStatus);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => `${p.patient_name} ${p.region} ${p.insurance} ${p.reassessment_clinician || ''}`.toLowerCase().includes(q));
    }
    const order = { overdue: 0, critical: 1, urgent: 2, approaching: 3, ok: 4, scheduled: 5, no_data: 6, unknown: 7 };
    return [...list].sort((a, b) => {
      const ao = order[a.reassessment_status] ?? 9, bo = order[b.reassessment_status] ?? 9;
      if (ao !== bo) return ao - bo;
      return (daysUntil(a.next_reassessment_deadline) ?? 999) - (daysUntil(b.next_reassessment_deadline) ?? 999);
    });
  }, [patients, filterRegion, filterStatus, search]);

  // ── Evaluation tab list ───────────────────────────────────────────
  const evalFiltered = useMemo(() => {
    let list = evalRows;
    if (filterRegion !== 'ALL') list = list.filter(e => e.region === filterRegion);
    if (filterEvalStatus !== 'ALL') list = list.filter(e => e.eval_status === filterEvalStatus);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e => `${e.patient_name} ${e.region} ${e.insurance || ''}`.toLowerCase().includes(q));
    }
    const order = { breach: 0, warn: 1, on_track: 2, scheduled: 3, completed: 4, unknown: 5 };
    return [...list].sort((a, b) => {
      const ao = order[a.eval_status] ?? 9, bo = order[b.eval_status] ?? 9;
      if (ao !== bo) return ao - bo;
      return (b.hours_in_eval_pending ?? 0) - (a.hours_in_eval_pending ?? 0);
    });
  }, [evalRows, filterRegion, filterEvalStatus, search]);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Reassessments & Evaluations Monitor" subtitle="Loading..." />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading clinical scheduling data...</div>
    </div>
  );

  const subtitle =
    `${stats.unscheduledReassessment} reassessments unscheduled `
    + `· ${stats.eval.breach} evals SLA breach (>48h) `
    + `· ${stats.eval.unscheduled} evals not on schedule`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <TopBar
        title="Reassessments & Evaluations Monitor"
        subtitle={subtitle}
        actions={<button onClick={load} style={{ padding: '6px 12px', background: 'none', border: '1px solid var(--border)', color: 'var(--black)', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Refresh</button>}
      />

      {/* Alert banners */}
      {stats.eval.breach > 0 && (
        <div style={{ background: '#FEF2F2', borderBottom: '2px solid #DC2626', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#DC2626' }}>
            {stats.eval.breach} patient{stats.eval.breach > 1 ? 's' : ''} past the 48-hour eval SLA - schedule with telehealth now.
          </span>
        </div>
      )}
      {stats.overdue > 0 && (
        <div style={{ background: '#FEF2F2', borderBottom: '2px solid #DC2626', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#DC2626' }}>
            {stats.overdue} patient{stats.overdue > 1 ? 's' : ''} OVERDUE for reassessment - past the 45-day deadline.
          </span>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* KPI Strip — 8 cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {[
              { label: 'Reassess Overdue',     val: stats.overdue,             color: '#DC2626', bg: '#FEF2F2' },
              { label: 'Reassess <=7d',         val: stats.critical,            color: '#DC2626', bg: '#FEF2F2' },
              { label: 'Reassess <=14d',        val: stats.urgent,              color: '#D97706', bg: '#FEF3C7' },
              { label: 'No Frequency Set',     val: stats.noFrequency,         color: '#6B7280', bg: '#F3F4F6' },
              { label: 'Evals Total Pending',  val: stats.eval.total,          color: '#1565C0', bg: '#EFF6FF' },
              { label: 'Evals SLA Breach',     val: stats.eval.breach,         color: '#DC2626', bg: '#FEF2F2' },
              { label: 'Evals Not Scheduled',  val: stats.eval.unscheduled,    color: '#D97706', bg: '#FEF3C7' },
              { label: 'Evals Booked',         val: stats.eval.scheduled,      color: '#059669', bg: '#ECFDF5' },
            ].map(c => (
              <div key={c.label} style={{ background: c.bg, border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: c.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</div>
                <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: c.color, marginTop: 2 }}>{c.val}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', alignSelf: 'flex-start' }}>
            {[
              { k: 'reassessment', l: `Reassessments (${stats.unscheduledReassessment} unscheduled)` },
              { k: 'evaluation',   l: `Evaluations (${stats.eval.breach} SLA breach)` },
              { k: 'no_frequency', l: `Frequency Not Set (${stats.noFrequency})` },
            ].map(t => (
              <button key={t.k} onClick={() => setActiveTab(t.k)}
                style={{ padding: '7px 14px', border: 'none', fontSize: 11, fontWeight: activeTab === t.k ? 700 : 400, cursor: 'pointer', background: activeTab === t.k ? '#0F1117' : 'var(--card-bg)', color: activeTab === t.k ? '#fff' : 'var(--gray)', borderRight: '1px solid var(--border)' }}>
                {t.l}
              </button>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient, clinician..."
              style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)', width: 200 }} />
            <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
              style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)' }}>
              <option value="ALL">All Regions</option>
              {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
            </select>
            {activeTab === 'reassessment' && (
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)' }}>
                <option value="ALL">All Reassess Statuses</option>
                {Object.entries(REASSESS_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            )}
            {activeTab === 'evaluation' && (
              <select value={filterEvalStatus} onChange={e => setFilterEvalStatus(e.target.value)}
                style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)' }}>
                <option value="ALL">All Eval Statuses</option>
                {Object.entries(EVAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            )}
            {(filterRegion !== 'ALL' || filterStatus !== 'ALL' || filterEvalStatus !== 'ALL' || search) && (
              <button onClick={() => { setFilterRegion('ALL'); setFilterStatus('ALL'); setFilterEvalStatus('ALL'); setSearch(''); }}
                style={{ fontSize: 10, color: 'var(--gray)', background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer' }}>Clear</button>
            )}
            <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gray)' }}>
              {activeTab === 'reassessment' ? reassessFiltered.length : activeTab === 'evaluation' ? evalFiltered.length : 0} {activeTab === 'reassessment' ? 'patients - click row to set frequency' : activeTab === 'evaluation' ? 'eval-pending patients - click row to schedule' : 'patients'}
            </div>
          </div>

          {/* Explainers */}
          {activeTab === 'reassessment' && (
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '10px 14px', fontSize: 11, color: '#1565C0' }}>
              <strong>Reassessment Window:</strong> All active patients require a 30-Day Reassessment by their assigned PT or OT.
              Target date is <strong>30 days</strong> from last reassessment. Hard deadline is <strong>45 days</strong> - clinical compliance risk if exceeded.
            </div>
          )}
          {activeTab === 'evaluation' && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', fontSize: 11, color: '#991B1B' }}>
              <strong>Eval SLA:</strong> Patient enters "Eval Pending" census status after Auth Pending clears. Hard SLA is <strong>48 hours wall-clock</strong> from that transition until an eval is booked with a telehealth clinician.
              Past 48h with no eval booked = SLA breach = high-priority alert fires automatically via <code>fire_eval_pending_sla_breach_alerts()</code> hourly. Resolved when status moves to Active.
            </div>
          )}

          {/* TABLE: REASSESSMENT TAB */}
          {activeTab === 'reassessment' && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 0.4fr 0.8fr 0.9fr 0.8fr 0.8fr 0.7fr 1fr 0.9fr', padding: '8px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 9, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.04em', gap: 8 }}>
                <span>Patient</span><span>Rgn</span><span>Frequency</span><span>Last Reassess</span><span>30d Target</span><span>45d Deadline</span><span>Days Left</span><span>Status</span><span>Clinician</span>
              </div>
              {reassessFiltered.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)' }}>All reassessments are on schedule.</div>
              ) : reassessFiltered.map((p, i) => {
                const sc = REASSESS_STATUS[p.reassessment_status] || REASSESS_STATUS.unknown;
                const daysLeft = daysUntil(p.next_reassessment_deadline);
                const effFreq = p.visit_frequency || p.inferred_frequency;
                const freqLabel = FREQ_OPTIONS.find(f => f.k === effFreq)?.l || effFreq || '-';
                const rowBg = ['overdue','critical'].includes(p.reassessment_status) ? '#FFF5F5'
                  : p.reassessment_status === 'urgent' ? '#FFFBEB'
                  : i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)';
                return (
                  <div key={p.patient_name + i} onClick={() => setEditPatient(p)}
                    style={{ display: 'grid', gridTemplateColumns: '1.8fr 0.4fr 0.8fr 0.9fr 0.8fr 0.8fr 0.7fr 1fr 0.9fr', padding: '9px 16px', borderBottom: '1px solid var(--border)', background: rowBg, alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{p.patient_name}</div>
                      {p.alert_no_visits_scheduled && <div style={{ fontSize: 9, color: '#DC2626', fontWeight: 700 }}>No future visits in Pariox</div>}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)' }}>{p.region}</span>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: p.visit_frequency ? 700 : 400, color: p.visit_frequency ? '#059669' : '#6B7280' }}>{freqLabel}</div>
                      {!p.visit_frequency && <div style={{ fontSize: 8, color: '#D97706' }}>inferred</div>}
                    </div>
                    <span style={{ fontSize: 11 }}>{fmtDate(p.last_reassessment_date)}</span>
                    <span style={{ fontSize: 11 }}>{fmtDate(p.next_reassessment_target)}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: daysLeft !== null && daysLeft <= 14 ? '#DC2626' : 'var(--black)' }}>
                      {fmtDate(p.next_reassessment_deadline)}
                    </span>
                    <div style={{ fontSize: 16, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: sc.color }}>
                      {daysLeft === null ? '-' : daysLeft <= 0 ? 'EXP' : `${daysLeft}d`}
                    </div>
                    <div>
                      <span style={{ fontSize: 9, fontWeight: 700, color: sc.color, background: sc.bg, padding: '2px 8px', borderRadius: 999 }}>{sc.label}</span>
                    </div>
                    <span style={{ fontSize: 10, color: p.reassessment_clinician ? '#1565C0' : '#9CA3AF' }}>
                      {p.reassessment_clinician || 'Not assigned'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* TABLE: EVALUATION TAB */}
          {activeTab === 'evaluation' && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 0.4fr 0.9fr 0.8fr 0.7fr 0.9fr 1fr 1.1fr', padding: '8px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 9, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.04em', gap: 8 }}>
                <span>Patient</span><span>Rgn</span><span>Census Status</span><span>Pending Since</span><span>Hours</span><span>Eval Date</span><span>Status</span><span>Clinician</span>
              </div>
              {evalFiltered.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)' }}>No Eval Pending patients match current filters.</div>
              ) : evalFiltered.map((r, i) => {
                const sc = EVAL_STATUS[r.eval_status] || EVAL_STATUS.unknown;
                const rowBg = r.eval_status === 'breach' ? '#FFF5F5'
                  : r.eval_status === 'warn' ? '#FFFBEB'
                  : i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)';
                return (
                  <div key={r.patient_name + i} onClick={() => setEditEval(r)}
                    style={{ display: 'grid', gridTemplateColumns: '1.8fr 0.4fr 0.9fr 0.8fr 0.7fr 0.9fr 1fr 1.1fr', padding: '9px 16px', borderBottom: '1px solid var(--border)', background: rowBg, alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{r.patient_name}</div>
                      {!r.scheduled_eval_date && <div style={{ fontSize: 9, color: '#DC2626', fontWeight: 700 }}>No eval on schedule</div>}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)' }}>{r.region}</span>
                    <span style={{ fontSize: 11 }}>{r.census_status}</span>
                    <span style={{ fontSize: 10 }}>{r.status_first_seen ? fmtDateTime(r.status_first_seen) : '-'}</span>
                    <div style={{ fontSize: 14, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: sc.color }}>
                      {r.hours_in_eval_pending !== null ? r.hours_in_eval_pending.toFixed(0) + 'h' : '-'}
                    </div>
                    <span style={{ fontSize: 11, color: r.scheduled_eval_date ? '#059669' : '#9CA3AF', fontWeight: r.scheduled_eval_date ? 700 : 400 }}>
                      {r.scheduled_eval_date ? fmtDate(r.scheduled_eval_date) : 'Not scheduled'}
                    </span>
                    <div>
                      <span style={{ fontSize: 9, fontWeight: 700, color: sc.color, background: sc.bg, padding: '2px 8px', borderRadius: 999 }}>{sc.label}</span>
                    </div>
                    <span style={{ fontSize: 10, color: r.scheduled_eval_clinician ? '#1565C0' : '#9CA3AF' }}>
                      {r.scheduled_eval_clinician || 'Unassigned'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* TABLE: NO FREQUENCY TAB */}
          {activeTab === 'no_frequency' && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.4fr 1fr 1fr 1.4fr', padding: '8px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 9, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.04em', gap: 8 }}>
                <span>Patient</span><span>Rgn</span><span>Inferred</span><span>Last Reassess</span><span>Action</span>
              </div>
              {patients.filter(p => !p.visit_frequency).map((p, i) => (
                <div key={p.patient_name + i} onClick={() => setEditPatient(p)}
                  style={{ display: 'grid', gridTemplateColumns: '2fr 0.4fr 1fr 1fr 1.4fr', padding: '9px 16px', borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{p.patient_name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>{p.region}</span>
                  <span style={{ fontSize: 11, color: '#D97706' }}>{FREQ_OPTIONS.find(f => f.k === p.inferred_frequency)?.l || p.inferred_frequency || '-'}</span>
                  <span style={{ fontSize: 11 }}>{fmtDate(p.last_reassessment_date)}</span>
                  <span style={{ fontSize: 11, color: '#1565C0', fontWeight: 600 }}>Click to set frequency</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editPatient && (
        <FrequencyModal
          patient={editPatient}
          profileName={profile?.full_name || profile?.email}
          onClose={() => setEditPatient(null)}
          onSaved={() => { setEditPatient(null); load(); }}
        />
      )}
      {editEval && (
        <EvalScheduleModal
          row={editEval}
          telehealthRoster={telehealthRoster}
          profile={profile}
          onClose={() => setEditEval(null)}
          onSaved={() => { setEditEval(null); load(); }}
        />
      )}
    </div>
  );
}
