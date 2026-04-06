import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

const FREQ_OPTIONS = [
  { k: '4x_week',   l: '4× / Week',   days: 2 },
  { k: '3x_week',   l: '3× / Week',   days: 2 },
  { k: '2x_week',   l: '2× / Week',   days: 4 },
  { k: '1x_week',   l: '1× / Week',   days: 7 },
  { k: '2x_month',  l: '2× / Month',  days: 14 },
  { k: '1x_month',  l: '1× / Month',  days: 30 },
  { k: 'maintenance', l: 'Maintenance', days: 30 },
  { k: 'prn',       l: 'PRN',         days: null },
];

const STATUS_CFG = {
  overdue:    { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', icon: '🚨', label: 'OVERDUE' },
  critical:   { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', icon: '🔴', label: 'Critical (≤7d)' },
  urgent:     { color: '#D97706', bg: '#FEF3C7', border: '#FCD34D', icon: '🟠', label: 'Urgent (≤14d)' },
  approaching:{ color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE', icon: '🟣', label: 'Approaching (30d target)' },
  ok:         { color: '#059669', bg: '#ECFDF5', border: '#A7F3D0', icon: '⚪', label: 'OK (>14d)' },
  scheduled:  { color: '#1565C0', bg: '#EFF6FF', border: '#BFDBFE', icon: '✅', label: 'Scheduled' },
  no_data:    { color: '#6B7280', bg: '#F3F4F6', border: '#E5E7EB', icon: '—',  label: 'No Data' },
  unknown:    { color: '#6B7280', bg: '#F3F4F6', border: '#E5E7EB', icon: '—',  label: 'Unknown' },
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d + 'T00:00:00') - new Date()) / 86400000);
}

// ── Frequency Edit Modal ──────────────────────────────────────────────────────
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

  const sc = STATUS_CFG[patient.reassessment_status] || STATUS_CFG.unknown;
  const daysLeft = daysUntil(patient.next_reassessment_deadline);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--card-bg)', borderRadius: 14, width: '100%', maxWidth: 520, boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
        {/* Header */}
        <div style={{ padding: '16px 22px', background: '#0F1117', borderRadius: '14px 14px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{patient.patient_name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
              Region {patient.region} · {patient.insurance}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}>×</button>
        </div>

        {/* Reassessment status banner */}
        <div style={{ padding: '10px 22px', background: sc.bg, borderBottom: `2px solid ${sc.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: sc.color }}>{sc.icon} Reassessment {sc.label}</div>
            <div style={{ fontSize: 11, color: sc.color, marginTop: 2 }}>
              Last: {fmtDate(patient.last_reassessment_date)} · Target: {fmtDate(patient.next_reassessment_target)} · Deadline: {fmtDate(patient.next_reassessment_deadline)}
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
          {/* Inferred frequency note */}
          {patient.inferred_frequency && !patient.visit_frequency && (
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#1565C0' }}>
              💡 System inferred <strong>{FREQ_OPTIONS.find(f => f.k === patient.inferred_frequency)?.l || patient.inferred_frequency}</strong> from {patient.inferred_from_visits} visits in the last 60 days. Confirm or override below.
            </div>
          )}
          {patient.visit_frequency && (
            <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#065F46' }}>
              ✓ Frequency manually set to <strong>{FREQ_OPTIONS.find(f => f.k === patient.visit_frequency)?.l || patient.visit_frequency}</strong> by {patient.frequency_set_by || 'unknown'}
            </div>
          )}

          {/* Frequency selector */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 8 }}>Visit Frequency</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
              {FREQ_OPTIONS.map(f => (
                <button key={f.k} onClick={() => setFreq(f.k)}
                  style={{ padding: '8px 4px', borderRadius: 7, border: `2px solid ${freq === f.k ? '#1565C0' : 'var(--border)'}`, background: freq === f.k ? '#EFF6FF' : 'var(--card-bg)', fontSize: 11, fontWeight: 700, color: freq === f.k ? '#1565C0' : 'var(--gray)', cursor: 'pointer' }}>
                  {f.l}
                </button>
              ))}
            </div>
          </div>

          {/* Reassessment clinician */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Assigned Reassessment Clinician (PT/OT)</label>
            <input value={clinician} onChange={e => setClinician(e.target.value)}
              placeholder="e.g. Brian Espinola, PT"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, outline: 'none', background: 'var(--bg)', boxSizing: 'border-box' }} />
          </div>

          {/* Clinical notes */}
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
            {saving ? 'Saving…' : 'Save Frequency'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SchedulingAlertsPage() {
  const { profile } = useAuth();
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('reassessment');
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterFreq, setFilterFreq] = useState('ALL');
  const [search, setSearch] = useState('');
  const [editPatient, setEditPatient] = useState(null);

  // Scope to coordinator's regions if applicable
  const myRegions = useMemo(() => {
    const r = profile?.role;
    if (['super_admin','admin','assoc_director','pod_leader','telehealth'].includes(r)) return null; // sees all regions
    return profile?.regions || null;
  }, [profile]);

  const load = useCallback(async () => {
    let q = supabase.from('patient_clinical_settings').select('*').order('next_reassessment_deadline', { ascending: true, nullsFirst: false });
    if (myRegions?.length) q = q.in('region', myRegions);
    const { data } = await q;
    setPatients(data || []);
    setLoading(false);
  }, [myRegions]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const active = patients;
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
    };
  }, [patients]);

  const filtered = useMemo(() => {
    let list = patients;

    if (activeTab === 'reassessment') {
      list = list.filter(p => p.last_reassessment_date && p.reassessment_status !== 'scheduled');
    } else if (activeTab === 'no_visits') {
      list = list.filter(p => p.alert_no_visits_scheduled);
    } else if (activeTab === 'no_frequency') {
      list = list.filter(p => !p.visit_frequency);
    }

    if (filterRegion !== 'ALL') list = list.filter(p => p.region === filterRegion);
    if (filterStatus !== 'ALL') list = list.filter(p => p.reassessment_status === filterStatus);
    if (filterFreq !== 'ALL') {
      if (filterFreq === 'manual') list = list.filter(p => p.visit_frequency);
      else if (filterFreq === 'inferred') list = list.filter(p => !p.visit_frequency && p.inferred_frequency);
      else list = list.filter(p => (p.visit_frequency || p.inferred_frequency) === filterFreq);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => `${p.patient_name} ${p.region} ${p.insurance} ${p.reassessment_clinician || ''}`.toLowerCase().includes(q));
    }

    // Sort: overdue → critical → urgent → approaching → ok → no_data
    const order = { overdue: 0, critical: 1, urgent: 2, approaching: 3, ok: 4, scheduled: 5, no_data: 6, unknown: 7 };
    return [...list].sort((a, b) => {
      const ao = order[a.reassessment_status] ?? 9, bo = order[b.reassessment_status] ?? 9;
      if (ao !== bo) return ao - bo;
      return (daysUntil(a.next_reassessment_deadline) ?? 999) - (daysUntil(b.next_reassessment_deadline) ?? 999);
    });
  }, [patients, activeTab, filterRegion, filterStatus, filterFreq, search]);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Scheduling Alerts" subtitle="Loading..." />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading scheduling data...</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <TopBar
        title="📅 Scheduling Alerts"
        subtitle={`${stats.unscheduledReassessment} reassessments unscheduled · ${stats.noVisitsFuture} patients with no future visits · ${stats.noFrequency} no frequency set`}
        actions={<button onClick={load} style={{ padding: '6px 12px', background: 'none', border: '1px solid var(--border)', color: 'var(--black)', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>↻ Refresh</button>}
      />

      {/* Alert banners */}
      {stats.overdue > 0 && (
        <div style={{ background: '#FEF2F2', borderBottom: '2px solid #DC2626', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>🚨</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#DC2626' }}>
            {stats.overdue} patient{stats.overdue > 1 ? 's' : ''} OVERDUE for reassessment — past the 45-day deadline. Contact clinician immediately.
          </span>
        </div>
      )}
      {stats.critical > 0 && (
        <div style={{ background: '#FEF2F2', borderBottom: '1px solid #FECACA', padding: '7px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>🔴</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#DC2626' }}>
            {stats.critical} patient{stats.critical > 1 ? 's' : ''} reach their 45-day deadline within 7 days — schedule now
          </span>
        </div>
      )}
      {stats.urgent > 0 && (
        <div style={{ background: '#FFFBEB', borderBottom: '1px solid #FCD34D', padding: '7px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>🟠</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#92400E' }}>
            {stats.urgent} patient{stats.urgent > 1 ? 's' : ''} reach their deadline within 14 days — action this week
          </span>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* KPI Strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
            {[
              { label: '🚨 Overdue',          val: stats.overdue,                color: '#DC2626', bg: '#FEF2F2' },
              { label: '🔴 Critical ≤7d',     val: stats.critical,               color: '#DC2626', bg: '#FEF2F2' },
              { label: '🟠 Urgent ≤14d',      val: stats.urgent,                 color: '#D97706', bg: '#FEF3C7' },
              { label: '🟣 Approaching 30d',  val: stats.approaching,            color: '#7C3AED', bg: '#F5F3FF' },
              { label: '❌ No Future Visits',  val: stats.noVisitsFuture,         color: '#DC2626', bg: '#FEF2F2' },
              { label: '📝 Frequency Not Set', val: stats.noFrequency,            color: '#6B7280', bg: '#F3F4F6' },
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
              { k: 'reassessment', l: `📋 Reassessment Tracking (${stats.unscheduledReassessment} unscheduled)` },
              { k: 'no_visits',    l: `❌ No Future Visits (${stats.noVisitsFuture})` },
              { k: 'no_frequency', l: `📝 Frequency Not Set (${stats.noFrequency})` },
              { k: 'all',          l: 'All Patients' },
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
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)' }}>
              <option value="ALL">All Statuses</option>
              {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
            {(filterRegion !== 'ALL' || filterStatus !== 'ALL' || search) && (
              <button onClick={() => { setFilterRegion('ALL'); setFilterStatus('ALL'); setSearch(''); }}
                style={{ fontSize: 10, color: 'var(--gray)', background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer' }}>Clear</button>
            )}
            <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gray)' }}>{filtered.length} patients · click row to set frequency</div>
          </div>

          {/* 30/45 day explainer */}
          {activeTab === 'reassessment' && (
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '10px 14px', fontSize: 11, color: '#1565C0' }}>
              <strong>Reassessment Window:</strong> All active patients require a 30-Day Reassessment by their assigned PT or OT.
              Target date is <strong>30 days</strong> from last reassessment. Hard deadline is <strong>45 days</strong> — clinical compliance risk if exceeded.
              Schedule between days 30–45 depending on clinician availability.
            </div>
          )}

          {/* Patient Table */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 0.4fr 0.8fr 0.9fr 0.8fr 0.8fr 0.7fr 1fr 0.9fr', padding: '8px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 9, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.04em', gap: 8 }}>
              <span>Patient</span><span>Rgn</span><span>Frequency</span><span>Last Reassessment</span><span>30d Target</span><span>45d Deadline</span><span>Days Left</span><span>Status</span><span>Clinician</span>
            </div>

            {filtered.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)' }}>
                {activeTab === 'reassessment' ? '✅ All patients with reassessments on file have them scheduled!' : 'No patients match current filters.'}
              </div>
            ) : filtered.map((p, i) => {
              const sc = STATUS_CFG[p.reassessment_status] || STATUS_CFG.unknown;
              const daysLeft = daysUntil(p.next_reassessment_deadline);
              const effFreq = p.visit_frequency || p.inferred_frequency;
              const freqLabel = FREQ_OPTIONS.find(f => f.k === effFreq)?.l || effFreq || '—';
              const rowBg = ['overdue','critical'].includes(p.reassessment_status) ? '#FFF5F5'
                : p.reassessment_status === 'urgent' ? '#FFFBEB'
                : p.alert_no_visits_scheduled ? '#FFF8F0'
                : i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)';
              return (
                <div key={p.patient_name + i} onClick={() => setEditPatient(p)}
                  style={{ display: 'grid', gridTemplateColumns: '1.8fr 0.4fr 0.8fr 0.9fr 0.8fr 0.8fr 0.7fr 1fr 0.9fr', padding: '9px 16px', borderBottom: '1px solid var(--border)', background: rowBg, alignItems: 'center', gap: 8, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#EFF6FF'}
                  onMouseLeave={e => e.currentTarget.style.background = rowBg}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{p.patient_name}</div>
                    {p.alert_no_visits_scheduled && <div style={{ fontSize: 9, color: '#DC2626', fontWeight: 700 }}>⚠ No future visits in Pariox</div>}
                    {!p.visit_frequency && p.inferred_frequency && <div style={{ fontSize: 9, color: '#1565C0' }}>💡 Inferred · confirm needed</div>}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)' }}>{p.region}</span>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: p.visit_frequency ? 700 : 400, color: p.visit_frequency ? '#059669' : '#6B7280' }}>{freqLabel}</div>
                    {!p.visit_frequency && <div style={{ fontSize: 8, color: '#D97706' }}>inferred</div>}
                    {p.visit_frequency && <div style={{ fontSize: 8, color: '#059669' }}>confirmed</div>}
                  </div>
                  <span style={{ fontSize: 11 }}>{fmtDate(p.last_reassessment_date)}</span>
                  <span style={{ fontSize: 11, color: daysUntil(p.next_reassessment_target) !== null && daysUntil(p.next_reassessment_target) <= 7 ? '#D97706' : 'var(--black)', fontWeight: daysUntil(p.next_reassessment_target) !== null && daysUntil(p.next_reassessment_target) <= 7 ? 700 : 400 }}>
                    {fmtDate(p.next_reassessment_target)}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: daysLeft !== null && daysLeft <= 14 ? '#DC2626' : 'var(--black)' }}>
                    {fmtDate(p.next_reassessment_deadline)}
                  </span>
                  <div style={{ fontSize: 16, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: sc.color }}>
                    {daysLeft === null ? '—' : daysLeft <= 0 ? 'EXP' : `${daysLeft}d`}
                  </div>
                  <div>
                    <span style={{ fontSize: 9, fontWeight: 700, color: sc.color, background: sc.bg, padding: '2px 8px', borderRadius: 999 }}>
                      {sc.icon} {sc.label}
                    </span>
                  </div>
                  <span style={{ fontSize: 10, color: p.reassessment_clinician ? '#1565C0' : '#9CA3AF', fontStyle: p.reassessment_clinician ? 'normal' : 'italic' }}>
                    {p.reassessment_clinician || 'Not assigned'}
                  </span>
                </div>
              );
            })}
          </div>
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
    </div>
  );
}
