import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages, logActivity } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import { useRiskMap } from '../../hooks/useRiskMap';
import RiskBadge from '../../components/RiskBadge';

const LYMPH_BENCHMARK = 1;   // <1% target
const OTHER_BENCHMARK = 5;   // <5% target

// Module-scope so React keeps F stable across renders (focus-loss fix).
function F({ label, req, children }) {
  return (
    <div>
      <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:4 }}>
        {label}{req && <span style={{ color:'#DC2626' }}> *</span>}
      </label>
      {children}
    </div>
  );
}

const CAUSE_CATEGORIES = [
  { value: 'lymphedema_related', label: 'Lymphedema-Related', color: '#DC2626', bg: '#FEF2F2' },
  { value: 'other_cause',        label: 'Other Cause',        color: '#D97706', bg: '#FEF3C7' },
  { value: 'unknown',            label: 'Unknown',            color: '#6B7280', bg: '#F3F4F6' },
];

// 2026-06-16: Added "CHF / Fluid retention" and "Fall (lymphedema-attributable)"
// to the lymphedema_related list. Clinical rationale: CHF decompensation in a
// lymphedema patient is directly tied to lymphatic load/fluid handling, and
// falls caused by heavy/swollen limbs are lymphedema-attributable rather than
// random trauma. The generic "Fall/Injury" stays under other_cause for falls
// unrelated to lymphedema (slip, syncope, mechanical fall).
const SUBCATEGORIES = {
  lymphedema_related: ['Cellulitis', 'Wound infection', 'Lymphedema crisis', 'CHF / Fluid retention', 'Fall (lymphedema-attributable)', 'DVT/PE', 'Sepsis (lymphedema source)', 'Other lymphedema'],
  other_cause: ['Cardiac', 'Fall/Injury', 'Respiratory', 'Stroke/Neuro', 'GI', 'UTI/Sepsis', 'Surgical', 'Mental health', 'Other'],
  unknown: ['Under investigation'],
};

const FREQUENCIES = ['4w4', '3w4', '2w4', '1w4', '1ew2', '1x/month', '1x/month (2)', 'Maintenance', 'Unknown'];

// 2026-06-16: Stay type — separates true inpatient admissions from
// observation (<24h) and ED-only visits. The Lymphedema Rate uses only
// inpatient stays so ED-bounces don't pollute the quality metric.
const STAY_TYPES = [
  { value: 'inpatient',   label: 'Inpatient (true admission)',         color: '#7C2D12', bg: '#FEF2F2' },
  { value: 'observation', label: 'Observation (<24h / formal obs)',    color: '#9C5700', bg: '#FFFBEB' },
  { value: 'ed_only',     label: 'ED only (treated + released)',       color: '#1E40AF', bg: '#EFF6FF' },
  { value: 'unknown',     label: 'Unknown (pending confirmation)',     color: '#6B7280', bg: '#F3F4F6' },
];
const STAY_TYPE_MAP = Object.fromEntries(STAY_TYPES.map(s => [s.value, s]));

const OUTCOMES = [
  { value: 'discharged_home',  label: 'Discharged Home' },
  { value: 'discharged_snf',   label: 'Discharged to SNF' },
  { value: 'discharged_rehab', label: 'Discharged to Rehab' },
  { value: 'deceased',         label: 'Deceased' },
  { value: 'still_admitted',   label: 'Still Admitted' },
  { value: 'unknown',          label: 'Unknown' },
];

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

// 2026-06-30 — canonical census-status options for the Edit Hospitalization
// dropdown. Keep in sync with the Medicare Tracker's PATIENT_STATUS_OPTIONS
// and with the STATUS_STYLE keys below.
const PATIENT_STATUS_OPTIONS = [
  'Active', 'Active - Auth Pending', 'SOC Pending', 'On Hold',
  'Hospitalized', 'Discharge', 'Non-Admit', 'Waitlist',
];

// 2026-06-30 — Census-status pill colors. Same palette family as the Medicare
// Tracker so the status chips feel consistent across pages. Anything not in
// this map falls back to a neutral gray "unknown" chip.
const STATUS_STYLE = {
  'Active':                    { color:'#065F46', bg:'#ECFDF5' },
  'Active - Auth Pending':     { color:'#1E40AF', bg:'#EFF6FF' },
  'Active - Auth Pendin':      { color:'#1E40AF', bg:'#EFF6FF' }, // known Pariox truncation
  'Hospitalized':              { color:'#7F1D1D', bg:'#FEF2F2' },
  'On Hold':                   { color:'#9C5700', bg:'#FEF3C7' },
  'SOC Pending':               { color:'#78350F', bg:'#FEF3C7' },
  'Waitlist':                  { color:'#6B21A8', bg:'#F3E8FF' },
  'Discharge':                 { color:'#374151', bg:'#F3F4F6' },
  'Discharge - Change Insurance':{ color:'#374151', bg:'#F3F4F6' },
  'Non-Admit':                 { color:'#4B5563', bg:'#F3F4F6' },
  _unknown:                    { color:'#6B7280', bg:'#F3F4F6' },
};

function rateColor(rate, benchmark) {
  if (rate <= benchmark * 0.7) return '#065F46';
  if (rate <= benchmark) return '#10B981';
  if (rate <= benchmark * 1.5) return '#D97706';
  return '#DC2626';
}

function rateBg(rate, benchmark) {
  if (rate <= benchmark) return '#ECFDF5';
  if (rate <= benchmark * 1.5) return '#FEF3C7';
  return '#FEF2F2';
}

function Badge({ label, color, bg }) {
  return <span style={{ fontSize:10, fontWeight:700, color, background:bg, padding:'2px 8px', borderRadius:999 }}>{label}</span>;
}

function StatCard({ label, value, sub, color='var(--black)', bg='var(--card-bg)', icon, alert }) {
  return (
    <div style={{ background:bg, border:`1px solid ${alert?'#FECACA':'var(--border)'}`, borderRadius:10, padding:'14px 16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{label}</div>
        {icon && <span style={{ fontSize:16 }}>{icon}</span>}
      </div>
      <div style={{ fontSize:24, fontWeight:800, fontFamily:'DM Mono, monospace', color, marginTop:6 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'var(--gray)', marginTop:3 }}>{sub}</div>}
    </div>
  );
}

const emptyForm = {
  patient_name:'', region:'', insurance:'', clinician_name:'',
  admission_date:'', discharge_date:'', hospital_name:'',
  // 2026-06-16: default to inpatient — back-compat with rows logged before
  // the stay_type distinction existed (those rows were all treated as
  // inpatient admissions).
  stay_type:'inpatient',
  admitting_diagnosis:'', cause_category:'lymphedema_related', cause_subcategory:'',
  potentially_preventable: false, preventability_notes:'',
  outcome:'still_admitted', returned_to_service: false, return_date:'',
  visit_frequency_at_admission:'', days_since_last_visit:'', last_visit_date:'',
  reported_by:'', review_notes:'',
  // 2026-06-30: underlying care state at the moment of admission — separate
  // from census_data.status which reflects the current state. Distinguishes
  // a hospitalized-Active patient from a hospitalized-Waitlist patient.
  care_status_at_admission: '',
};

// Options for the care_status_at_admission dropdown. Same set as
// PATIENT_STATUS_OPTIONS minus 'Hospitalized' (which is redundant — the
// patient is already on the hospitalization tracker).
const CARE_STATUS_OPTIONS = [
  'Active', 'Active - Auth Pending', 'SOC Pending', 'On Hold',
  'Discharge', 'Non-Admit', 'Waitlist',
];

function HospForm({ initial, onClose, onSaved, onDeleted, profile, censusNames, statusByPatient }) {
  const [form, setForm] = useState(initial ? { ...emptyForm, ...initial,
    admission_date: initial.admission_date||'',
    discharge_date: initial.discharge_date||'',
    return_date: initial.return_date||'',
    last_visit_date: initial.last_visit_date||'',
    reported_by: initial.reported_by || profile?.full_name || '',
  } : { ...emptyForm, reported_by: profile?.full_name || '' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');
  const isEdit = !!initial?.id;
  const canDelete = ['super_admin','ceo','admin','pod_leader','assoc_director','director'].includes(profile?.role);

  // Census status is stored on census_data, not on the hospitalization row.
  // Pre-fill it by looking up the current patient in the parent's status Map,
  // and re-lookup whenever patient_name changes (typing a new name in Log
  // New mode). initialStatus is the baseline — save() only writes to
  // census_data if patient_status differs from it.
  const lookupStatus = (name) => (name ? (statusByPatient?.get((name || '').toLowerCase().trim()) || '') : '');
  const [patientStatus, setPatientStatus] = useState(() => lookupStatus(form.patient_name));
  const [initialStatus, setInitialStatus] = useState(() => lookupStatus(form.patient_name));
  useEffect(() => {
    const s = lookupStatus(form.patient_name);
    setPatientStatus(s);
    setInitialStatus(s);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.patient_name, statusByPatient]);

  function set(k, v) { setForm(p => ({...p, [k]: v})); }

  async function save() {
    if (!form.patient_name || !form.admission_date || !form.admitting_diagnosis) {
      setErr('Patient name, admission date, and admitting diagnosis are required.'); return;
    }
    setSaving(true); setErr('');
    const payload = { ...form,
      discharge_date: form.discharge_date || null,
      return_date: form.return_date || null,
      last_visit_date: form.last_visit_date || null,
      days_since_last_visit: form.days_since_last_visit ? parseInt(form.days_since_last_visit) : null,
      updated_at: new Date().toISOString(),
    };
    delete payload.id; delete payload.created_at;
    let error;
    if (isEdit) ({ error } = await supabase.from('hospitalizations').update(payload).eq('id', initial.id));
    else ({ error } = await supabase.from('hospitalizations').insert(payload));
    if (error) { setSaving(false); setErr(error.message); return; }

    // Patient census status — only write if the user changed it. Writes to
    // census_data by patient_name (the same key the rest of the app joins
    // on). Non-fatal: if this fails we still consider the hospitalization
    // save a success and surface the status write separately.
    if (patientStatus && patientStatus !== initialStatus) {
      const actor = profile?.full_name || profile?.email || 'Unknown';
      const { error: statusErr } = await supabase
        .from('census_data')
        .update({
          status: patientStatus,
          updated_by: actor,
          status_changed_at: new Date().toISOString(),
        })
        .eq('patient_name', form.patient_name);
      if (statusErr) {
        setSaving(false);
        setErr(`Hospitalization saved, but status update failed: ${statusErr.message}`);
        return;
      }
      logActivity({
        coordinatorId: profile?.id,
        coordinatorName: profile?.full_name,
        coordinatorRole: profile?.role,
        actionType: 'census_status_manual_update',
        actionDetail: `Changed ${form.patient_name} from ${initialStatus || '(unknown)'} to ${patientStatus} via Hospitalization Tracker`,
        patientName: form.patient_name,
        tableName: 'census_data',
        metadata: { source: 'hospitalization_tracker_edit_form', prev: initialStatus || null, next: patientStatus },
      });
    }

    setSaving(false);
    onSaved();
  }

  async function del() {
    if (!isEdit || !canDelete) return;
    const label = `${initial.patient_name || 'this record'} (admitted ${initial.admission_date || 'unknown'})`;
    if (!window.confirm(`Permanently delete the hospitalization record for ${label}? This removes it from reporting numbers and cannot be undone.`)) return;
    setDeleting(true); setErr('');
    const { error } = await supabase.from('hospitalizations').delete().eq('id', initial.id);
    if (error) { setDeleting(false); setErr(`Delete failed: ${error.message}`); return; }
    logActivity({
      coordinatorId: profile?.id,
      coordinatorName: profile?.full_name,
      coordinatorRole: profile?.role,
      actionType: 'hospitalization_delete',
      actionDetail: `Deleted hospitalization for ${initial.patient_name} (admitted ${initial.admission_date})`,
      patientName: initial.patient_name,
      tableName: 'hospitalizations',
      metadata: { record: initial },
    });
    setDeleting(false);
    (onDeleted || onSaved)();
  }

  const input = (k, type='text', placeholder='') => (
    <input type={type} value={form[k]} placeholder={placeholder}
      onChange={e => set(k, e.target.value)}
      style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', background:'var(--card-bg)' }} />
  );

  const sel = (k, opts) => (
    <select value={form[k]} onChange={e => set(k, e.target.value)}
      style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
      {opts.map(o => <option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
    </select>
  );

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:720, maxHeight:'92vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>

        {/* Header */}
        <div style={{ padding:'16px 22px', background:'#0F1117', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>{isEdit ? 'Edit' : 'Log New'} Hospitalization</div>
            <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>All entries are auditable and timestamped</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#9CA3AF' }}>×</button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:22 }}>
          {err && <div style={{ background:'#FEF2F2', border:'1px solid #FCA5A5', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:12, color:'#DC2626' }}>{err}</div>}

          {/* Patient */}
          <div style={{ fontSize:12, fontWeight:700, color:'var(--black)', marginBottom:12, paddingBottom:6, borderBottom:'1px solid var(--border)' }}>🧑 Patient Information</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:16 }}>
            <F label="Patient Name" req>
              <input type="text" value={form.patient_name} list="patient-list" placeholder="Last, First"
                onChange={e => set('patient_name', e.target.value)}
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', background:'var(--card-bg)' }} />
              <datalist id="patient-list">
                {censusNames.map(n => <option key={n} value={n} />)}
              </datalist>
            </F>
            <F label="Region">{sel('region', [{value:'',label:'Select…'},...REGIONS.map(r=>({value:r,label:`Region ${r}`}))])}</F>
            <F label="Insurance">{input('insurance','text','e.g. Humana, CarePlus')}</F>
            <F label="Clinician">{input('clinician_name','text','Clinician name')}</F>
            <F label="Visit Frequency at Admission">{sel('visit_frequency_at_admission', [{value:'',label:'Select…'},...FREQUENCIES.map(f=>({value:f,label:f}))])}</F>
            <F label="Last Visit Date">{input('last_visit_date','date')}</F>
            {/* Care Status at Admission (2026-06-30) — captures the
                UNDERLYING care state at the moment of admission (Active vs
                Waitlist vs SOC Pending). Separate from census status
                because the patient IS hospitalized — we already know that;
                what we're capturing here is what they WERE care-wise. */}
            <F label="Care Status at Admission">
              {sel('care_status_at_admission', [
                { value:'', label:'- select -' },
                ...CARE_STATUS_OPTIONS.map(s => ({ value:s, label:s })),
              ])}
            </F>
            {/* Patient Status (census) — writes to census_data on save.
                Use this to correct a mislabeled census status (e.g., a
                Waitlist patient showing as Active). Next Pariox import may
                overwrite unless the upstream chart is also corrected. */}
            <F label="Patient Status (census)">
              <select value={patientStatus}
                onChange={e => setPatientStatus(e.target.value)}
                style={{ width:'100%', padding:'8px 10px', border:`1px solid ${patientStatus !== initialStatus ? '#F59E0B' : 'var(--border)'}`, borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                <option value="">- select status -</option>
                {PATIENT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {patientStatus && patientStatus !== initialStatus && (
                <div style={{ fontSize:10, color:'#B45309', marginTop:4 }}>
                  Will update census: {initialStatus || '(none)'} {String.fromCharCode(8594)} {patientStatus}
                </div>
              )}
            </F>
          </div>

          {/* Admission */}
          <div style={{ fontSize:12, fontWeight:700, color:'var(--black)', marginBottom:12, paddingBottom:6, borderBottom:'1px solid var(--border)' }}>🏥 Admission Details</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
            <F label="Admission Date" req>{input('admission_date','date')}</F>
            <F label="Discharge Date (leave blank if still admitted)">{input('discharge_date','date')}</F>
            <F label="Stay Type" req>{sel('stay_type', STAY_TYPES.map(s => ({ value: s.value, label: s.label })))}</F>
            <F label="Hospital Name">{input('hospital_name','text','Hospital or facility name')}</F>
            <F label="Admitting Diagnosis" req>{input('admitting_diagnosis','text','Primary reason for admission')}</F>
          </div>

          {/* Classification */}
          <div style={{ fontSize:12, fontWeight:700, color:'var(--black)', marginBottom:12, paddingBottom:6, borderBottom:'1px solid var(--border)' }}>📊 Clinical Classification</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <F label="Cause Category" req>
              <select value={form.cause_category} onChange={e => { set('cause_category', e.target.value); set('cause_subcategory',''); }}
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                {CAUSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </F>
            <F label="Subcategory">
              <select value={form.cause_subcategory} onChange={e => set('cause_subcategory', e.target.value)}
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                <option value="">Select…</option>
                {(SUBCATEGORIES[form.cause_category]||[]).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </F>
          </div>
          <div style={{ display:'flex', gap:16, alignItems:'center', marginBottom:16, padding:'10px 14px', background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:8 }}>
            <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:600 }}>
              <input type="checkbox" checked={form.potentially_preventable} onChange={e => set('potentially_preventable', e.target.checked)} style={{ width:16, height:16 }} />
              Flag as Potentially Preventable
            </label>
            <span style={{ fontSize:11, color:'#92400E' }}>Check if this admission may have been avoidable with earlier intervention</span>
          </div>
          {form.potentially_preventable && (
            <F label="Preventability Notes">
              <textarea value={form.preventability_notes} onChange={e => set('preventability_notes', e.target.value)}
                placeholder="What could have been done differently? Missed visit? Delayed intervention?"
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:60, background:'var(--card-bg)' }} />
            </F>
          )}

          {/* Outcome */}
          <div style={{ fontSize:12, fontWeight:700, color:'var(--black)', marginBottom:12, marginTop:16, paddingBottom:6, borderBottom:'1px solid var(--border)' }}>📋 Outcome & Return to Care</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
            <F label="Outcome">{sel('outcome', OUTCOMES)}</F>
            <F label="Returned to EdemaCare Service">
              <select value={form.returned_to_service ? 'yes' : 'no'} onChange={e => set('returned_to_service', e.target.value === 'yes')}
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </F>
            {form.returned_to_service && <F label="Return to Service Date">{input('return_date','date')}</F>}
          </div>

          {/* Notes */}
          <div style={{ marginTop:16 }}>
            <F label="Clinical Notes / Review">
              <textarea value={form.review_notes} onChange={e => set('review_notes', e.target.value)}
                placeholder="Any additional clinical context, care plan adjustments, or follow-up actions…"
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:64, background:'var(--card-bg)' }} />
            </F>
          </div>
        </div>

        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, background:'var(--bg)' }}>
          <div>
            {isEdit && canDelete && (
              <button onClick={del} disabled={deleting || saving}
                title="Admin only — permanently remove this record from reporting"
                style={{ padding:'8px 16px', background:'var(--card-bg)', color:'#B91C1C', border:'1px solid #FCA5A5', borderRadius:7, fontSize:13, fontWeight:600, cursor: (deleting || saving) ? 'not-allowed' : 'pointer' }}>
                {deleting ? 'Deleting…' : 'Delete Record'}
              </button>
            )}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
            <button onClick={save} disabled={saving || deleting}
              style={{ padding:'8px 22px', background:'#DC2626', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor: (saving || deleting) ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Log Hospitalization'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HospitalizationTrackerPage() {
  const { profile } = useAuth();
  const risk = useRiskMap();
  const [records, setRecords] = useState([]);
  const [census, setCensus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterPeriod, setFilterPeriod] = useState('ytd'); // ytd | quarter | month | all
  const [searchQ, setSearchQ] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard'); // dashboard | log | preventable
  const [sortKey, setSortKey] = useState('admission_date'); // sortable in Log tab
  const [sortDir, setSortDir] = useState('desc');

  // 2026-06-30: Added assoc_director (Lia, Samantha, Ariel, Earl) and director
  // per Liam — ADs need to update hospitalization records for any patient
  // across all their acting territories, matching the all-region visibility
  // shipped in useAssignedRegions. The 'director' role maps to super_admin
  // permissions per CLAUDE.md; added here for consistency.
  const canEdit = ['super_admin','ceo','admin','pod_leader','assoc_director','director'].includes(profile?.role);
  const canDelete = ['super_admin','ceo','admin','pod_leader','assoc_director','director'].includes(profile?.role);

  const regionScope = useAssignedRegions();

  async function deleteRecord(r) {
    if (!canDelete) return;
    const label = `${r.patient_name || 'this record'} (admitted ${r.admission_date || 'unknown'})`;
    if (!window.confirm(`Permanently delete the hospitalization record for ${label}? This removes it from reporting numbers and cannot be undone.`)) return;
    const { error } = await supabase.from('hospitalizations').delete().eq('id', r.id);
    if (error) { window.alert(`Delete failed: ${error.message}`); return; }
    logActivity({
      coordinatorId: profile?.id,
      coordinatorName: profile?.full_name,
      coordinatorRole: profile?.role,
      actionType: 'hospitalization_delete',
      actionDetail: `Deleted hospitalization for ${r.patient_name} (admitted ${r.admission_date})`,
      patientName: r.patient_name,
      tableName: 'hospitalizations',
      metadata: { record: r, source: 'inline_row_delete' },
    });
    load();
  }

  async function load() {
    if (regionScope.loading) return;
    if (!regionScope.isAllAccess && (!regionScope.regions || regionScope.regions.length === 0)) {
      setRecords([]); setCensus([]); setLoading(false); return;
    }
    const [h, c] = await Promise.all([
      fetchAllPages(regionScope.applyToQuery(supabase.from('hospitalizations').select('*').order('admission_date', { ascending: false }))),
      fetchAllPages(regionScope.applyToQuery(supabase.from('census_data').select('patient_name, status, region, insurance'))),
    ]);
    setRecords(h); setCensus(c); setLoading(false);
  }

  useEffect(() => { load(); }, [regionScope.loading, regionScope.isAllAccess, JSON.stringify(regionScope.regions)]);
  useRealtimeTable(['census_data', 'hospitalizations'], load);

  const censusNames = useMemo(() => [...new Set((census||[]).map(c => c.patient_name).filter(Boolean))], [census]);

  // Period filter
  const now = new Date();
  const periodStart = useMemo(() => {
    if (filterPeriod === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
    if (filterPeriod === 'quarter') return new Date(now.getFullYear(), Math.floor(now.getMonth()/3)*3, 1).toISOString().slice(0,10);
    if (filterPeriod === 'ytd') return `${now.getFullYear()}-01-01`;
    return '2000-01-01';
  }, [filterPeriod]);

  // 2026-06-30: Enrich each hospitalization record with the patient's census
  // status (Active / Waitlist / On Hold / SOC Pending / Hospitalized /
  // Discharge / Non-Admit). Some patients on this list have never actually
  // started care — the status makes that visible so Ariel can triage them.
  const statusByPatient = useMemo(() => {
    const m = new Map();
    for (const c of (census || [])) {
      if (c.patient_name) m.set(c.patient_name.toLowerCase().trim(), c.status || null);
    }
    return m;
  }, [census]);
  const statusOf = (patientName) =>
    patientName ? (statusByPatient.get(patientName.toLowerCase().trim()) || null) : null;

  // Distinct census-status values across everyone in the loaded hospitalization
  // records, used to populate the status filter dropdown. Fall back to a stable
  // baseline list so the dropdown never appears empty on a slow first load.
  const distinctStatuses = useMemo(() => {
    const s = new Set();
    for (const r of records) {
      const v = statusOf(r.patient_name);
      if (v) s.add(v);
    }
    if (s.size === 0) {
      ['Active', 'SOC Pending', 'On Hold', 'Hospitalized', 'Discharge', 'Non-Admit', 'Waitlist']
        .forEach(v => s.add(v));
    }
    return Array.from(s).sort();
  }, [records, statusByPatient]);

  const filtered = useMemo(() => {
    const list = records.filter(r => {
      if (filterRegion !== 'ALL' && r.region !== filterRegion) return false;
      if (filterCategory !== 'ALL' && r.cause_category !== filterCategory) return false;
      if (filterStatus !== 'ALL') {
        const st = statusOf(r.patient_name);
        if (filterStatus === 'UNKNOWN') { if (st) return false; }
        else if (st !== filterStatus) return false;
      }
      if (r.admission_date < periodStart) return false;
      if (searchQ && !`${r.patient_name} ${r.admitting_diagnosis} ${r.hospital_name}`.toLowerCase().includes(searchQ.toLowerCase())) return false;
      return true;
    });
    // Sort by chosen key. patient_status sorts by the census-derived value;
    // everything else pulls straight off the row. Nulls sink to the bottom.
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = sortKey === 'patient_status' ? statusOf(a.patient_name) : a[sortKey];
      const bv = sortKey === 'patient_status' ? statusOf(b.patient_name) : b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [records, filterRegion, filterCategory, filterStatus, periodStart, searchQ, sortKey, sortDir, statusByPatient]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  // Rate calculations
  // Denominator = active census patients
  const activeCensus = useMemo(() => census.filter(c => c.status === 'Active' || c.status === 'Active - Auth Pendin').length || 543, [census]);
  const currentlyHospitalized = useMemo(() => census.filter(c => c.status === 'Hospitalized'), [census]);

  // 2026-06-16: Quality metrics use INPATIENT stays only. Observation
  // (<24h) and ED-only visits stay visible in the secondary stat card
  // below so they're not invisible, but they don't inflate the Lymph Rate.
  // Rows logged before stay_type existed default to 'inpatient' (back-compat).
  const inpatientOnly = filtered.filter(r => (r.stay_type || 'inpatient') === 'inpatient');
  const observationStays = filtered.filter(r => r.stay_type === 'observation');
  const edOnlyVisits = filtered.filter(r => r.stay_type === 'ed_only');

  const lymphHosps   = inpatientOnly.filter(r => r.cause_category === 'lymphedema_related');
  const otherHosps   = inpatientOnly.filter(r => r.cause_category === 'other_cause');
  const unknownHosps = inpatientOnly.filter(r => r.cause_category === 'unknown');
  const stillAdmitted = inpatientOnly.filter(r => !r.discharge_date || r.outcome === 'still_admitted');
  const preventable   = inpatientOnly.filter(r => r.potentially_preventable);
  const returnedPts   = inpatientOnly.filter(r => r.returned_to_service);

  const lymphRate = activeCensus > 0 ? (lymphHosps.length / activeCensus * 100) : 0;
  const otherRate = activeCensus > 0 ? (otherHosps.length / activeCensus * 100) : 0;
  const totalRate = activeCensus > 0 ? (inpatientOnly.length / activeCensus * 100) : 0;

  const periodLabel = { month:'This Month', quarter:'This Quarter', ytd:'Year to Date', all:'All Time' }[filterPeriod];

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Hospitalization Tracker" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Hospitalization Tracker" subtitle={`Clinical quality metric · ${periodLabel} · ${activeCensus} active patients`} />
      <div style={{ flex:1, overflow:'auto' }}>

        {/* Controls */}
        <div style={{ display:'flex', gap:10, padding:'12px 20px', borderBottom:'1px solid var(--border)', background:'var(--card-bg)', flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:7, overflow:'hidden' }}>
            {[['month','Month'],['quarter','Quarter'],['ytd','YTD'],['all','All Time']].map(([k,l]) => (
              <button key={k} onClick={() => setFilterPeriod(k)}
                style={{ padding:'6px 12px', border:'none', background:filterPeriod===k?'#0F1117':'var(--card-bg)', color:filterPeriod===k?'#fff':'var(--gray)', fontSize:11, fontWeight:filterPeriod===k?700:400, cursor:'pointer' }}>
                {l}
              </button>
            ))}
          </div>
          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Regions</option>
            {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
          </select>
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Categories</option>
            {CAUSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          {/* Patient census status — Active / Waitlist / On Hold / SOC Pending
              / Hospitalized / Discharge / Non-Admit. Surfaces patients who
              never started care but are still on the hospitalization list. */}
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Statuses</option>
            {distinctStatuses.map(s => <option key={s} value={s}>{s}</option>)}
            <option value="UNKNOWN">(no status)</option>
          </select>
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search patient, diagnosis…"
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)', width:200 }} />
          <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
            {/* Tab switcher */}
            {[['dashboard','📊 Dashboard'],['log','📋 Log'],['preventable','⚠ Preventable']].map(([k,l]) => (
              <button key={k} onClick={() => setActiveTab(k)}
                style={{ padding:'6px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, fontWeight:activeTab===k?700:400, background:activeTab===k?'#0F1117':'var(--card-bg)', color:activeTab===k?'#fff':'var(--gray)', cursor:'pointer' }}>
                {l}
              </button>
            ))}
            {canEdit && (
              <button onClick={() => { setEditRecord(null); setShowForm(true); }}
                style={{ padding:'6px 14px', background:'#DC2626', color:'#fff', border:'none', borderRadius:6, fontSize:12, fontWeight:700, cursor:'pointer' }}>
                + Log Hospitalization
              </button>
            )}
          </div>
        </div>

        <div style={{ padding:20 }}>

          {/* RATE BENCHMARK CARDS — always visible.
              2026-06-16: grew from 5 → 6 columns to fit the new
              Observation / ED-only card alongside the rate benchmarks. */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(6, minmax(0, 1fr))', gap:14, marginBottom:20 }}>

            {/* Lymphedema Rate — the critical one */}
            <div style={{ background:rateBg(lymphRate, LYMPH_BENCHMARK), border:`2px solid ${lymphRate <= LYMPH_BENCHMARK ? '#A7F3D0' : '#FECACA'}`, borderRadius:12, padding:16, gridColumn:'span 1' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>🎯 Lymphedema Rate</div>
              <div style={{ fontSize:28, fontWeight:900, fontFamily:'DM Mono, monospace', color:rateColor(lymphRate, LYMPH_BENCHMARK) }}>
                {lymphRate.toFixed(2)}%
              </div>
              <div style={{ fontSize:11, marginTop:4 }}>
                <span style={{ fontWeight:700, color:lymphRate <= LYMPH_BENCHMARK ? '#065F46' : '#DC2626' }}>
                  {lymphRate <= LYMPH_BENCHMARK ? '✅ Within' : '❌ Exceeds'} benchmark
                </span>
              </div>
              <div style={{ fontSize:10, color:'var(--gray)', marginTop:3 }}>Target: &lt;{LYMPH_BENCHMARK}% · {lymphHosps.length} classified admissions</div>
              {unknownHosps.length > 0 && (
                <div style={{ fontSize:10, color:'#D97706', fontWeight:600, marginTop:3 }}>
                  ⚠ {unknownHosps.length} unclassified — rate may be higher
                </div>
              )}
              {/* Rate bar */}
              <div style={{ marginTop:8, height:6, background:'rgba(0,0,0,0.08)', borderRadius:999 }}>
                <div style={{ height:'100%', width:Math.min(lymphRate/LYMPH_BENCHMARK*100,100)+'%', background:rateColor(lymphRate, LYMPH_BENCHMARK), borderRadius:999 }} />
              </div>
              <div style={{ fontSize:9, color:'var(--gray)', marginTop:3, textAlign:'right' }}>
                {Math.round(lymphRate/LYMPH_BENCHMARK*100)}% of {LYMPH_BENCHMARK}% limit
              </div>
            </div>

            {/* Other causes rate */}
            <div style={{ background:rateBg(otherRate, OTHER_BENCHMARK), border:`2px solid ${otherRate <= OTHER_BENCHMARK ? '#A7F3D0' : '#FECACA'}`, borderRadius:12, padding:16 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>All Other Causes</div>
              <div style={{ fontSize:28, fontWeight:900, fontFamily:'DM Mono, monospace', color:rateColor(otherRate, OTHER_BENCHMARK) }}>
                {otherRate.toFixed(2)}%
              </div>
              <div style={{ fontSize:11, marginTop:4 }}>
                <span style={{ fontWeight:700, color:otherRate <= OTHER_BENCHMARK ? '#065F46' : '#DC2626' }}> 
                  {otherRate <= OTHER_BENCHMARK ? '✅ Within' : '❌ Exceeds'} benchmark
                </span>
              </div>
              <div style={{ fontSize:10, color:'var(--gray)', marginTop:3 }}>Target: &lt;{OTHER_BENCHMARK}% · {otherHosps.length} classified admissions</div>
              {unknownHosps.length > 0 && (
                <div style={{ fontSize:10, color:'#D97706', fontWeight:600, marginTop:3 }}>
                  ⚠ {unknownHosps.length} pending classification
                </div>
              )}
              <div style={{ marginTop:8, height:6, background:'rgba(0,0,0,0.08)', borderRadius:999 }}>
                <div style={{ height:'100%', width:Math.min(otherRate/OTHER_BENCHMARK*100,100)+'%', background:rateColor(otherRate, OTHER_BENCHMARK), borderRadius:999 }} />
              </div>
              <div style={{ fontSize:9, color:'var(--gray)', marginTop:3, textAlign:'right' }}>
                {Math.round(otherRate/OTHER_BENCHMARK*100)}% of {OTHER_BENCHMARK}% limit
              </div>
            </div>

            <StatCard label="Inpatient Admissions" value={inpatientOnly.length} icon="🏥"
              sub={`${totalRate.toFixed(2)}% of ${activeCensus} active · ${observationStays.length + edOnlyVisits.length} obs/ED excluded from rate`}
              color={unknownHosps.length > 0 ? '#D97706' : 'var(--black)'}
              bg={unknownHosps.length > 0 ? '#FEF3C7' : 'var(--card-bg)'}
              alert={unknownHosps.length > 0} />

            {/* 2026-06-16: Observation + ED-only stays — visible but excluded
                from the Lymph Rate denominator. ED visits aren't admissions
                and observation status carries different billing/quality
                weight, so they live in their own card. */}
            <StatCard label="Observation / ED Only" value={observationStays.length + edOnlyVisits.length} icon="🚑"
              sub={`${observationStays.length} obs (<24h) · ${edOnlyVisits.length} ED only`}
              color={'#9C5700'} bg={'#FFFBEB'} />
            <StatCard label="Currently Admitted" value={stillAdmitted.length} icon="🛏"
              sub={stillAdmitted.length > 0 ? stillAdmitted.slice(0,2).map(r=>r.patient_name.split(',')[0]).join(', ')+(stillAdmitted.length>2?'…':'') : 'None currently admitted'}
              color={stillAdmitted.length > 0 ? '#DC2626' : '#065F46'}
              bg={stillAdmitted.length > 0 ? '#FEF2F2' : '#ECFDF5'}
              alert={stillAdmitted.length > 0} />
            <StatCard label="Potentially Preventable" value={preventable.length} icon="⚠"
              sub={`${filtered.length > 0 ? Math.round(preventable.length/filtered.length*100) : 0}% of admissions flagged`}
              color={preventable.length > 0 ? '#D97706' : '#065F46'}
              bg={preventable.length > 0 ? '#FEF3C7' : '#ECFDF5'} />
          </div>

          {/* DASHBOARD TAB */}
          {activeTab === 'dashboard' && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              {/* By cause breakdown */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                {/* Subcategory breakdown */}
                <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:18 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--black)', marginBottom:14 }}>Admissions by Cause</div>
                  {[...new Map(filtered.map(r => [r.cause_subcategory||r.cause_category, r])).values()].length === 0
                    ? <div style={{ color:'var(--gray)', fontSize:13 }}>No admissions recorded for this period.</div>
                    : (()=>{
                        const grouped = {};
                        filtered.forEach(r => {
                          const key = r.cause_subcategory || '(unspecified)';
                          if (!grouped[key]) grouped[key] = { count:0, cat: r.cause_category };
                          grouped[key].count++;
                        });
                        const sorted = Object.entries(grouped).sort((a,b)=>b[1].count-a[1].count);
                        const max = sorted[0]?.[1].count || 1;
                        return sorted.map(([label, {count, cat}]) => {
                          const cfg = CAUSE_CATEGORIES.find(c=>c.value===cat)||CAUSE_CATEGORIES[2];
                          return (
                            <div key={label} style={{ marginBottom:10 }}>
                              <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:3 }}>
                                <span><Badge label={cfg.label} color={cfg.color} bg={cfg.bg} /> {label}</span>
                                <span style={{ fontWeight:700, fontFamily:'DM Mono, monospace' }}>{count}</span>
                              </div>
                              <div style={{ height:6, background:'var(--border)', borderRadius:999 }}>
                                <div style={{ height:'100%', width:(count/max*100)+'%', background:cfg.color, borderRadius:999, opacity:0.8 }} />
                              </div>
                            </div>
                          );
                        });
                      })()
                  }
                </div>

                {/* By region */}
                <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:18 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--black)', marginBottom:14 }}>Admissions by Region</div>
                  {REGIONS.map(r => {
                    const recs = filtered.filter(h => h.region === r);
                    if (recs.length === 0) return null;
                    const lymph = recs.filter(h=>h.cause_category==='lymphedema_related').length;
                    const other = recs.filter(h=>h.cause_category==='other_cause').length;
                    return (
                      <div key={r} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px solid var(--border)' }}>
                        <span style={{ fontSize:13, fontWeight:700 }}>Region {r}</span>
                        <div style={{ display:'flex', gap:8, fontSize:12 }}>
                          {lymph > 0 && <Badge label={`${lymph} lymph`} color="#DC2626" bg="#FEF2F2" />}
                          {other > 0 && <Badge label={`${other} other`} color="#D97706" bg="#FEF3C7" />}
                          <span style={{ fontFamily:'DM Mono, monospace', fontWeight:700 }}>{recs.length} total</span>
                        </div>
                      </div>
                    );
                  })}
                  {REGIONS.every(r => filtered.filter(h=>h.region===r).length===0) && (
                    <div style={{ color:'var(--gray)', fontSize:13 }}>No admissions recorded for this period.</div>
                  )}
                </div>
              </div>

              {/* Visit frequency at admission */}
              {filtered.some(r => r.visit_frequency_at_admission) && (
                <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:18 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--black)', marginBottom:4 }}>Frequency at Time of Admission</div>
                  <div style={{ fontSize:11, color:'var(--gray)', marginBottom:14 }}>Clinical insight: are patients being hospitalized while on high-frequency or reduced-frequency care?</div>
                  <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                    {Object.entries(filtered.reduce((acc,r)=>{
                      if(r.visit_frequency_at_admission){acc[r.visit_frequency_at_admission]=(acc[r.visit_frequency_at_admission]||0)+1;}
                      return acc;
                    },{})).sort((a,b)=>b[1]-a[1]).map(([freq,cnt])=>(
                      <div key={freq} style={{ textAlign:'center', padding:'10px 16px', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8 }}>
                        <div style={{ fontSize:20, fontWeight:800, fontFamily:'DM Mono, monospace' }}>{cnt}</div>
                        <div style={{ fontSize:11, fontWeight:700, color:'var(--gray)', marginTop:2 }}>{freq}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Currently admitted alert */}
              {stillAdmitted.length > 0 && (
                <div style={{ background:'#FEF2F2', border:'2px solid #FECACA', borderRadius:12, padding:16 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'#DC2626', marginBottom:10 }}>🛏 Currently Admitted — Logged Records ({stillAdmitted.length})</div>
                  {stillAdmitted.map(r => (
                    <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 12px', background:'white', borderRadius:7, marginBottom:6, border:'1px solid #FECACA' }}>
                      <div>
                        <span style={{ fontWeight:700, fontSize:13 }}>
                          {r.patient_name}
                          <RiskBadge name={r.patient_name} region={r.region} risk={risk} />
                        </span>
                        <span style={{ fontSize:11, color:'var(--gray)', marginLeft:10 }}>Admitted {r.admission_date}</span>
                        <span style={{ fontSize:11, color:'var(--gray)', marginLeft:10 }}>{r.admitting_diagnosis}</span>
                      </div>
                      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                        <Badge label={CAUSE_CATEGORIES.find(c=>c.value===r.cause_category)?.label||r.cause_category}
                          color={CAUSE_CATEGORIES.find(c=>c.value===r.cause_category)?.color||'#6B7280'}
                          bg={CAUSE_CATEGORIES.find(c=>c.value===r.cause_category)?.bg||'#F3F4F6'} />
                        {canEdit && <button onClick={() => { setEditRecord(r); setShowForm(true); }}
                          style={{ padding:'4px 10px', border:'1px solid #FECACA', borderRadius:5, fontSize:11, cursor:'pointer', background:'white' }}>Update</button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Live census feed — patients showing Hospitalized status in current census upload */}
              {currentlyHospitalized.length > 0 && (
                <div style={{ background:'#FFF7ED', border:'2px solid #FCD34D', borderRadius:12, padding:16 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                    <div>
                      <div style={{ fontSize:14, fontWeight:700, color:'#92400E' }}>📋 Census: Patients Currently Marked Hospitalized ({currentlyHospitalized.length})</div>
                      <div style={{ fontSize:11, color:'#B45309', marginTop:2 }}>Live from latest Pariox census upload — these patients have status = "Hospitalized"</div>
                    </div>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px,1fr))', gap:8 }}>
                    {currentlyHospitalized.map(p => {
                      const hasLog = records.some(r => r.patient_name === p.patient_name && !r.discharge_date);
                      return (
                        <div key={p.patient_name} style={{ background:'white', border:'1px solid #FCD34D', borderRadius:8, padding:'10px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <div>
                            <div style={{ fontSize:12, fontWeight:700 }}>{p.patient_name}</div>
                            <div style={{ fontSize:10, color:'var(--gray)' }}>Region {p.region||'?'}</div>
                          </div>
                          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                            {hasLog
                              ? <span style={{ fontSize:10, color:'#065F46', fontWeight:700, background:'#ECFDF5', padding:'2px 7px', borderRadius:999 }}>✅ Logged</span>
                              : canEdit && <button onClick={() => { setEditRecord({ patient_name: p.patient_name, region: p.region, insurance: p.insurance, outcome:'still_admitted', cause_category:'unknown' }); setShowForm(true); setActiveTab('log'); }}
                                  style={{ fontSize:10, fontWeight:600, color:'#DC2626', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:5, padding:'3px 8px', cursor:'pointer' }}>
                                  + Log Details
                                </button>
                            }
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* LOG TAB */}
          {activeTab === 'log' && (
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ fontSize:14, fontWeight:700 }}>All Hospitalization Records</div>
                <div style={{ fontSize:12, color:'var(--gray)' }}>{filtered.length} records · {periodLabel}</div>
              </div>
              {filtered.length === 0 ? (
                <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>
                  <div style={{ fontSize:32, marginBottom:12 }}>🏥</div>
                  <div style={{ fontSize:15, fontWeight:600, marginBottom:6 }}>No hospitalizations recorded for this period</div>
                  {canEdit && <button onClick={() => { setEditRecord(null); setShowForm(true); }}
                    style={{ padding:'8px 20px', background:'#DC2626', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer', marginTop:8 }}>
                    + Log First Entry
                  </button>}
                </div>
              ) : (
                <>
                  {/* 10 columns now (added Status after Region). Header cells
                      are click-to-sort; ^/v arrow marks the active key/dir. */}
                  <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.55fr 0.9fr 0.75fr 0.7fr 1fr 0.9fr 0.7fr 0.7fr auto', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em' }}>
                    {[
                      ['patient_name',     'Patient'],
                      ['region',           'Region'],
                      ['patient_status',   'Status'],
                      ['admission_date',   'Admitted'],
                      ['stay_type',        'Stay'],
                      ['admitting_diagnosis','Diagnosis'],
                      ['cause_category',   'Category'],
                      ['outcome',          'Outcome'],
                      ['returned_to_service','Returned'],
                    ].map(([k, l]) => (
                      <span key={k} onClick={() => toggleSort(k)}
                        style={{ cursor:'pointer', userSelect:'none' }}>
                        {l}
                        {sortKey === k && <span style={{ marginLeft:4, opacity:0.7 }}>{sortDir === 'asc' ? '^' : 'v'}</span>}
                      </span>
                    ))}
                    <span></span>
                  </div>
                  <div style={{ maxHeight:500, overflowY:'auto' }}>
                    {filtered.map((r,i) => {
                      const catCfg = CAUSE_CATEGORIES.find(c=>c.value===r.cause_category)||CAUSE_CATEGORIES[2];
                      const outCfg = OUTCOMES.find(o=>o.value===r.outcome);
                      const stCfg  = STAY_TYPE_MAP[r.stay_type || 'inpatient'] || STAY_TYPE_MAP.inpatient;
                      const stShort = { inpatient: 'Inpatient', observation: 'Obs (<24h)', ed_only: 'ED only', unknown: '?' }[r.stay_type || 'inpatient'];
                      const status = statusOf(r.patient_name);
                      const statusCfg = STATUS_STYLE[status] || STATUS_STYLE._unknown;
                      return (
                        <div key={r.id} style={{ display:'grid', gridTemplateColumns:'1.5fr 0.55fr 0.9fr 0.75fr 0.7fr 1fr 0.9fr 0.7fr 0.7fr auto', padding:'10px 20px', borderBottom:'1px solid var(--border)', background:i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'center', fontSize:12 }}>
                          <div>
                            <div style={{ fontWeight:700 }}>{r.patient_name}</div>
                            {r.potentially_preventable && <span style={{ fontSize:9, color:'#D97706', fontWeight:700 }}>⚠ PREVENTABLE</span>}
                          </div>
                          <span>{r.region||'—'}</span>
                          <div style={{ display:'flex', flexDirection:'column', gap:3, alignItems:'flex-start' }}>
                            <Badge label={status || 'unknown'} color={statusCfg.color} bg={statusCfg.bg} />
                            {r.care_status_at_admission && r.care_status_at_admission !== status && (
                              <span style={{ fontSize:9, color:'var(--gray)' }}>
                                was {String.fromCharCode(183)}
                                <span style={{
                                  fontWeight:700,
                                  color:(STATUS_STYLE[r.care_status_at_admission]||STATUS_STYLE._unknown).color,
                                  marginLeft:3,
                                }}>{r.care_status_at_admission}</span>
                              </span>
                            )}
                          </div>
                          <span style={{ fontFamily:'DM Mono, monospace', fontSize:11 }}>{r.admission_date}</span>
                          <Badge label={stShort} color={stCfg.color} bg={stCfg.bg} />
                          <span style={{ color:'var(--gray)' }}>{r.admitting_diagnosis?.slice(0,35)}{r.admitting_diagnosis?.length>35?'…':''}</span>
                          <Badge label={catCfg.label} color={catCfg.color} bg={catCfg.bg} />
                          <span style={{ fontSize:11 }}>{outCfg?.label||r.outcome||'—'}</span>
                          <span style={{ fontSize:11, color:r.returned_to_service?'#065F46':'var(--gray)' }}>{r.returned_to_service?`✅ ${r.return_date||'Yes'}`:'—'}</span>
                          <div style={{ display:'flex', gap:4, justifyContent:'flex-end' }}>
                            {canEdit && (
                              <button onClick={() => { setEditRecord(r); setShowForm(true); }}
                                style={{ padding:'3px 8px', border:'1px solid var(--border)', borderRadius:5, fontSize:11, cursor:'pointer', background:'var(--bg)', color:'var(--gray)' }}>
                                Edit
                              </button>
                            )}
                            {canDelete && (
                              <button onClick={() => deleteRecord(r)}
                                title="Permanently delete this record (removes from reporting)"
                                style={{ padding:'3px 8px', border:'1px solid #FCA5A5', borderRadius:5, fontSize:11, cursor:'pointer', background:'var(--card-bg)', color:'#B91C1C', fontWeight:600 }}>
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* PREVENTABLE TAB */}
          {activeTab === 'preventable' && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div style={{ background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:10, padding:'12px 16px', fontSize:13 }}>
                <strong>⚠ Potentially Preventable Admissions</strong> — These are cases flagged during logging as admissions that may have been avoidable. Review these during QA meetings to identify care plan improvements.
              </div>
              {preventable.length === 0 ? (
                <div style={{ textAlign:'center', padding:40, background:'var(--card-bg)', borderRadius:12, border:'1px solid var(--border)', color:'var(--gray)' }}>
                  No preventable admissions flagged for this period.
                </div>
              ) : preventable.map(r => {
                const catCfg = CAUSE_CATEGORIES.find(c=>c.value===r.cause_category)||CAUSE_CATEGORIES[2];
                return (
                  <div key={r.id} style={{ background:'var(--card-bg)', border:'1px solid #FCD34D', borderRadius:10, padding:16 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
                      <div>
                        <span style={{ fontSize:15, fontWeight:700 }}>
                          {r.patient_name}
                          <RiskBadge name={r.patient_name} region={r.region} risk={risk} />
                        </span>
                        <span style={{ fontSize:11, color:'var(--gray)', marginLeft:10 }}>Region {r.region||'?'} · Admitted {r.admission_date}</span>
                      </div>
                      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                        <Badge label={catCfg.label} color={catCfg.color} bg={catCfg.bg} />
                        {canEdit && <button onClick={() => { setEditRecord(r); setShowForm(true); }}
                          style={{ padding:'4px 10px', border:'1px solid var(--border)', borderRadius:5, fontSize:11, cursor:'pointer' }}>Edit</button>}
                      </div>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, fontSize:12 }}>
                      <div><strong>Diagnosis:</strong> {r.admitting_diagnosis}</div>
                      <div><strong>Frequency:</strong> {r.visit_frequency_at_admission||'Unknown'}</div>
                      <div><strong>Last visit:</strong> {r.last_visit_date||'Unknown'} {r.days_since_last_visit?`(${r.days_since_last_visit}d ago)`:''}</div>
                    </div>
                    {r.preventability_notes && (
                      <div style={{ marginTop:10, padding:'8px 12px', background:'#FEF3C7', borderRadius:6, fontSize:12 }}>
                        <strong>Notes:</strong> {r.preventability_notes}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </div>

      {showForm && (
        <HospForm
          initial={editRecord}
          onClose={() => { setShowForm(false); setEditRecord(null); }}
          onSaved={() => { setShowForm(false); setEditRecord(null); load(); }}
          onDeleted={() => { setShowForm(false); setEditRecord(null); load(); }}
          profile={profile}
          censusNames={censusNames}
          statusByPatient={statusByPatient}
        />
      )}
    </div>
  );
}
