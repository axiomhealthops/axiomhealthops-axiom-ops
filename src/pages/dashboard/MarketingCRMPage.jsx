// Marketing CRM — Outreach Tracker
//
// 2026-05-29 refactor: replaces the v1 contact+encounter form with a proper
// outreach taxonomy (in-person visit, in-service, lunch-n-learn, phone call,
// event, job fair, follow-up, referral received, email, other), 4-level
// outcome rating, lookup-driven special projects, multi-contact-person per
// provider, rep attribution via coordinators.rep_id, and a Reports tab.
//
// Schema/RLS lives in supabase migrations:
//   - add_marketing_rep_role_and_secondary_roles
//   - extend_marketing_schema_and_add_lookups
//   - marketing_rls_role_and_region_scoped
//
// Region scoping uses useAssignedRegions().applyToQuery — same pattern as
// every other region-scoped page. RLS in the DB enforces the same rule at
// the API layer (no more open `is_active_coordinator()` policy).
//
// Activity log: every outreach insert calls logActivity() so RMPs show up
// in the engagement signal.

import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages, logActivity } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import { getWeekStart, getWeekEnd, toDateStr } from '../../lib/dateUtils';

// ── Constants ───────────────────────────────────────────────────────────────
const PROVIDER_TYPES = ['PCP','Clinic','Podiatrist','Hospital','School','Job Fair','Specialist','Wound Care','Orthopedic','Vascular','Cardiology','Neurology','Assisted Living','SNF','Home Health Agency','Other'];

const TYPE_COLORS = {
  'PCP':'#1565C0','Clinic':'#0E7490','Podiatrist':'#7C3AED','Hospital':'#DC2626',
  'School':'#9333EA','Job Fair':'#B91C1C','Specialist':'#065F46','Wound Care':'#D97706',
  'Orthopedic':'#0E7490','Vascular':'#9D174D','Cardiology':'#C2410C','Neurology':'#4338CA',
  'Assisted Living':'#166534','SNF':'#92400E','Home Health Agency':'#374151','Other':'#6B7280'
};

// Region letters available for picking on NEW entries. I, O, R intentionally
// excluded per 2026-05-29 Director call (former-employee cleanup + non-region
// pruning). Historical rows with those values are NOT modified — RLS still
// permits read where the user's regions array includes the legacy value.
const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

const OUTREACH_TYPES = [
  { key: 'in_person_visit',   label: 'In-Person Visit',  color: '#1565C0' },
  { key: 'in_service',        label: 'In-Service',       color: '#065F46' },
  { key: 'lunch_and_learn',   label: 'Lunch & Learn',    color: '#D97706' },
  { key: 'phone_call',        label: 'Phone Call',       color: '#7C3AED' },
  { key: 'email',             label: 'Email',            color: '#0E7490' },
  { key: 'event',             label: 'Event',            color: '#DC2626' },
  { key: 'job_fair',          label: 'Job Fair',         color: '#B91C1C' },
  { key: 'follow_up',         label: 'Follow-Up',        color: '#4338CA' },
  { key: 'referral_received', label: 'Referral Received',color: '#166534' },
  { key: 'other',             label: 'Other',            color: '#6B7280' },
];
const OUTREACH_LABEL = Object.fromEntries(OUTREACH_TYPES.map(o => [o.key, o.label]));
const OUTREACH_COLOR = Object.fromEntries(OUTREACH_TYPES.map(o => [o.key, o.color]));

const OUTCOME_RATINGS = [
  { key: 'successful',       label: 'Successful',       color:'#065F46', bg:'#ECFDF5' },
  { key: 'neutral',          label: 'Neutral',          color:'#374151', bg:'#F3F4F6' },
  { key: 'unsuccessful',     label: 'Unsuccessful',     color:'#DC2626', bg:'#FEF2F2' },
  { key: 'follow_up_needed', label: 'Follow-Up Needed', color:'#D97706', bg:'#FEF3C7' },
];

const PURPOSES = ['In-Service','Lunch & Learn','Introduction','Check-In','Event Support','Other'];

// Outreach types where the provider/contact picker is optional (events,
// job fairs and cold-call introductions can fly without one).
const OUTREACH_TYPES_NO_PROVIDER = new Set(['event','job_fair']);
// Outreach types that surface visit-only fields (purpose, discussion,
// payer, scheduled next event). Phone/email hide these.
const OUTREACH_TYPES_VISIT_FIELDS = new Set(['in_person_visit','in_service','lunch_and_learn','event','job_fair','follow_up']);

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Module-scope so the <input> isn't remounted on every keystroke (focus loss bug).
function MktField({ label, field, type='text', required=false, half=false, value, onChange, placeholder }) {
  return (
    <div style={{ gridColumn: half ? 'span 1' : 'span 2' }}>
      <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>{label}{required && ' *'}</label>
      <input type={type} value={value||''} onChange={e => onChange(f => ({...f,[field]:e.target.value}))} placeholder={placeholder}
        style={{ width:'100%', padding:'7px 10px', border:`1px solid ${required && !value?'#FECACA':'var(--border)'}`, borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Modal — formerly "ContactModal" in v1. Renamed semantically since
// marketing_contacts is the PROVIDER (practice/facility) table.
// ─────────────────────────────────────────────────────────────────────────────
function ProviderModal({ provider, onClose, onSaved, profile, repsForAssignment }) {
  const empty = {
    contact_type:'PCP', practice_name:'', address:'', city:'', state:'FL', zip:'',
    region: profile?.regions?.[0] || '', npi:'', referral_potential:'medium',
    active_referral_source:false, notes:'', primary_insurance:'',
    assigned_rep_id: profile?.id || '', is_active: true,
  };
  const [form, setForm] = useState(provider ? { ...empty, ...provider } : { ...empty });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.practice_name?.trim()) return;
    setSaving(true);
    const payload = { ...form, updated_at: new Date().toISOString() };
    let recordId = provider?.id;
    if (provider) {
      await supabase.from('marketing_contacts').update(payload).eq('id', provider.id);
    } else {
      const { data } = await supabase.from('marketing_contacts').insert({
        ...payload,
        created_by: profile?.full_name || profile?.email,
      }).select().single();
      recordId = data?.id;
    }
    logActivity({
      coordinatorId: profile?.id, coordinatorName: profile?.full_name, coordinatorRole: profile?.role,
      actionType: provider ? 'marketing_provider_updated' : 'marketing_provider_created',
      actionDetail: `${form.practice_name} (${form.contact_type}) - Region ${form.region || 'n/a'}`,
      tableName: 'marketing_contacts', recordId,
      metadata: { region: form.region, provider_type: form.contact_type },
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:24, overflowY:'auto' }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:640, maxHeight:'90vh', overflow:'auto', boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding:'16px 22px', background:'#0F1117', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, zIndex:1 }}>
          <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>{provider ? 'Edit Provider' : 'Add New Provider'}</div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#9CA3AF' }}>{'×'}</button>
        </div>
        <div style={{ padding:22, display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Provider Type *</label>
            <select value={form.contact_type} onChange={e => setForm(f=>({...f,contact_type:e.target.value}))}
              style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
              {PROVIDER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Region</label>
            <select value={form.region||''} onChange={e => setForm(f=>({...f,region:e.target.value}))}
              style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
              <option value="">Multi / Unassigned</option>
              {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
            </select>
          </div>
          <MktField label="Practice / Facility Name" field="practice_name" required value={form.practice_name} onChange={setForm} />
          <MktField label="NPI Number" field="npi" half value={form.npi} onChange={setForm} />
          <MktField label="Primary Insurance / Payer" field="primary_insurance" half value={form.primary_insurance} onChange={setForm} placeholder="Humana, BCBS, MA..." />
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Referral Potential</label>
            <select value={form.referral_potential} onChange={e => setForm(f=>({...f,referral_potential:e.target.value}))}
              style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Assigned Rep</label>
            <select value={form.assigned_rep_id||''} onChange={e => setForm(f=>({...f,assigned_rep_id:e.target.value}))}
              style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
              <option value="">Unassigned</option>
              {(repsForAssignment || []).map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
            </select>
          </div>
          <MktField label="Address" field="address" value={form.address} onChange={setForm} />
          <MktField label="City" field="city" half value={form.city} onChange={setForm} />
          <MktField label="ZIP" field="zip" half value={form.zip} onChange={setForm} />
          <div style={{ gridColumn:'span 2' }}>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Notes</label>
            <textarea value={form.notes||''} onChange={e => setForm(f=>({...f,notes:e.target.value}))}
              placeholder="Specialties, patient demographics served, best time to visit, relationship notes..."
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:72, background:'var(--card-bg)' }} />
          </div>
          <div style={{ gridColumn:'span 2', display:'flex', alignItems:'center', gap:8 }}>
            <input type="checkbox" id="active_ref" checked={!!form.active_referral_source} onChange={e => setForm(f=>({...f,active_referral_source:e.target.checked}))} />
            <label htmlFor="active_ref" style={{ fontSize:13, color:'var(--black)' }}>Active referral source (currently sending patients)</label>
          </div>
        </div>
        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
          <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving || !form.practice_name?.trim()}
            style={{ padding:'8px 22px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor:'pointer', opacity:!form.practice_name?.trim()?0.5:1 }}>
            {saving ? 'Saving...' : provider ? 'Save Changes' : 'Add Provider'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Contact-Person Modal — multi-contact-per-provider
// ─────────────────────────────────────────────────────────────────────────────
function ContactPersonModal({ provider, person, onClose, onSaved, profile }) {
  const empty = { name:'', title:'', phone:'', email:'', is_primary:false, notes:'' };
  const [form, setForm] = useState(person ? { ...empty, ...person } : empty);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.name?.trim()) return;
    setSaving(true);
    const payload = { ...form, provider_id: provider.id, updated_at: new Date().toISOString() };
    let recordId = person?.id;
    if (person) {
      await supabase.from('marketing_contact_people').update(payload).eq('id', person.id);
    } else {
      const { data } = await supabase.from('marketing_contact_people').insert({ ...payload, created_by: profile?.id }).select().single();
      recordId = data?.id;
    }
    logActivity({
      coordinatorId: profile?.id, coordinatorName: profile?.full_name, coordinatorRole: profile?.role,
      actionType: person ? 'marketing_contact_updated' : 'marketing_contact_created',
      actionDetail: `${form.name} at ${provider.practice_name}`,
      tableName: 'marketing_contact_people', recordId,
      metadata: { provider_id: provider.id, region: provider.region },
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:2100, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:520, boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding:'16px 22px', background:'#1565C0', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>{person ? 'Edit Contact Person' : 'Add Contact Person'}</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.7)', marginTop:2 }}>{provider.practice_name}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'rgba(255,255,255,0.7)' }}>{'×'}</button>
        </div>
        <div style={{ padding:22, display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <MktField label="Contact Name" field="name" required value={form.name} onChange={setForm} />
          <MktField label="Title (MD, DO, NP, Office Mgr, Referral Lead, etc.)" field="title" value={form.title} onChange={setForm} />
          <MktField label="Phone" field="phone" half value={form.phone} onChange={setForm} />
          <MktField label="Email" field="email" type="email" half value={form.email} onChange={setForm} />
          <div style={{ gridColumn:'span 2' }}>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Notes</label>
            <textarea value={form.notes||''} onChange={e => setForm(f=>({...f,notes:e.target.value}))}
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:60, background:'var(--card-bg)' }} />
          </div>
          <div style={{ gridColumn:'span 2', display:'flex', alignItems:'center', gap:8 }}>
            <input type="checkbox" id="is_primary" checked={!!form.is_primary} onChange={e => setForm(f=>({...f,is_primary:e.target.checked}))} />
            <label htmlFor="is_primary" style={{ fontSize:13, color:'var(--black)' }}>Primary contact for this provider</label>
          </div>
        </div>
        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
          <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving || !form.name?.trim()}
            style={{ padding:'8px 22px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor:'pointer', opacity:!form.name?.trim()?0.5:1 }}>
            {saving ? 'Saving...' : person ? 'Save Changes' : 'Add Contact'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Outreach Modal — the heart of the new CRM. Conditional fields by type.
// ─────────────────────────────────────────────────────────────────────────────
function OutreachModal({ provider, encounter, contactPeopleAll, specialProjects, onClose, onSaved, profile }) {
  // Edit mode if `encounter` is supplied; otherwise create mode.
  // Untargeted (no provider selected before opening the modal) defaults to
  // 'event' so the user isn't immediately blocked by the "needs a provider"
  // save guard. They can switch types after.
  const isEdit = !!encounter;
  const defaultType = encounter?.outreach_type || (provider ? 'in_person_visit' : 'event');
  const defaultLabel = OUTREACH_LABEL[defaultType] || (provider ? 'In-Person Visit' : 'Event');
  const [form, setForm] = useState({
    outreach_type: defaultType,
    encounter_type: defaultLabel,
    encounter_date: encounter?.encounter_date || new Date().toISOString().slice(0,10),
    region: encounter?.region || provider?.region || profile?.regions?.[0] || '',
    contact_person_id: encounter?.contact_person_id || '',
    purpose: encounter?.purpose || '',
    discussion_points: encounter?.discussion_points || '',
    follow_up_actions: encounter?.follow_up_actions || '',
    summary: encounter?.summary || '',
    outcome_rating: encounter?.outcome_rating || '',
    outcome: encounter?.outcome || '',
    payer: encounter?.payer || '',
    scheduled_next_event_date: encounter?.scheduled_next_event_date || '',
    phone_call_reason: encounter?.phone_call_reason || '',
    target_clinic_or_school: encounter?.target_clinic_or_school || '',
    special_project_id: encounter?.special_project_id || '',
    referrals_received: encounter?.referrals_received ?? 0,
    follow_up_date: encounter?.follow_up_date || '',
    follow_up_notes: encounter?.follow_up_notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // Ref so we can scroll the error banner into view when it appears — critical for
  // iPad/mobile users who click "Log Outreach" at the bottom of a long modal and
  // would otherwise miss the error that pops above the footer.
  const errorRef = useRef(null);
  useEffect(() => {
    if (saveError && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [saveError]);

  const peopleForProvider = useMemo(() =>
    (contactPeopleAll || []).filter(p => p.provider_id === provider?.id && p.is_active !== false),
    [contactPeopleAll, provider]
  );

  // Reset contact_person if it doesn't belong to the current provider
  useEffect(() => {
    if (form.contact_person_id && !peopleForProvider.find(p => p.id === form.contact_person_id)) {
      setForm(f => ({ ...f, contact_person_id: '' }));
    }
  }, [provider?.id, peopleForProvider, form.contact_person_id]);

  function setType(t) {
    const label = OUTREACH_LABEL[t] || 'Other';
    setForm(f => ({ ...f, outreach_type: t, encounter_type: label }));
  }

  const showVisitFields = OUTREACH_TYPES_VISIT_FIELDS.has(form.outreach_type);
  const isPhoneCall = form.outreach_type === 'phone_call';
  const isEventLike = OUTREACH_TYPES_NO_PROVIDER.has(form.outreach_type);

  async function save() {
    // Validation — give the user a clear error instead of silently no-op'ing,
    // which is what was confusing Brian Roffe (iPad, opened the modal from the
    // top "Log Outreach" button without first picking a provider).
    if (!form.outreach_type) {
      setSaveError('Pick an outreach type first (In-Person Visit, Phone Call, etc.).');
      return;
    }
    if (!isEventLike && !provider) {
      setSaveError('This outreach type requires a provider. Close this modal, find the provider in the CRM list, and click "Log Outreach" from that provider\'s card. OR switch to outreach type "Event" / "Job Fair" if this is a non-provider activity.');
      return;
    }
    if (isEventLike && !form.target_clinic_or_school?.trim()) {
      setSaveError('Please enter the clinic, school, or venue name in the "Target Clinic / School" field.');
      return;
    }
    if (isPhoneCall && !form.phone_call_reason?.trim()) {
      setSaveError('Please enter a reason for the phone call before saving.');
      return;
    }
    setSaving(true);
    setSaveError('');
    const outcomeLabel = OUTCOME_RATINGS.find(o => o.key === form.outcome_rating)?.label || form.outcome || '';
    const payload = {
      contact_id: provider?.id || null,
      rep_id: profile?.id || null,
      conducted_by: profile?.full_name || profile?.email || 'Unknown',
      outreach_type: form.outreach_type,
      encounter_type: form.encounter_type,
      encounter_date: form.encounter_date,
      region: form.region || provider?.region || null,
      contact_person_id: form.contact_person_id || null,
      purpose: form.purpose || null,
      discussion_points: form.discussion_points || null,
      follow_up_actions: form.follow_up_actions || null,
      summary: form.summary || null,
      outcome_rating: form.outcome_rating || null,
      outcome: outcomeLabel,
      payer: form.payer || null,
      scheduled_next_event_date: form.scheduled_next_event_date || null,
      phone_call_reason: isPhoneCall ? (form.phone_call_reason || null) : null,
      target_clinic_or_school: isEventLike ? (form.target_clinic_or_school || null) : null,
      special_project_id: form.special_project_id || null,
      referrals_received: parseInt(form.referrals_received) || 0,
      follow_up_date: form.follow_up_date || null,
      follow_up_notes: form.follow_up_notes || null,
    };
    let recordId = encounter?.id;
    let saveError = null;
    if (isEdit) {
      const res = await supabase.from('marketing_encounters').update(payload).eq('id', encounter.id);
      saveError = res.error;
    } else {
      const res = await supabase.from('marketing_encounters').insert(payload).select().single();
      saveError = res.error;
      recordId = res.data?.id;
    }
    if (saveError) {
      // Surface the actual reason instead of silently closing the modal.
      // RLS denials look like "new row violates row-level security policy" — give the
      // user a clear, actionable message about what they need from the admin.
      const msg = saveError.message || JSON.stringify(saveError);
      const isRls = /row-level security|policy/i.test(msg);
      setSaveError(isRls
        ? `Save blocked: you do not currently have permission to log outreach in this region (${payload.region || 'no region'}). Ask an admin to add this region to your coordinator profile.`
        : `Save failed: ${msg}`);
      setSaving(false);
      return;
    }
    const specialName = (specialProjects || []).find(s => s.id === form.special_project_id)?.name;
    logActivity({
      coordinatorId: profile?.id, coordinatorName: profile?.full_name, coordinatorRole: profile?.role,
      actionType: isEdit ? 'marketing_outreach_updated' : 'marketing_outreach_logged',
      actionDetail: `${OUTREACH_LABEL[form.outreach_type]}${provider?` - ${provider.practice_name}`:''}${form.target_clinic_or_school?` - ${form.target_clinic_or_school}`:''}${specialName?` [${specialName}]`:''}`,
      tableName: 'marketing_encounters', recordId,
      metadata: { outreach_type: form.outreach_type, outcome_rating: form.outcome_rating, region: payload.region },
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:24, overflowY:'auto' }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:680, maxHeight:'92vh', overflow:'auto', boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding:'16px 22px', background:'#065F46', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, zIndex:1 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>{isEdit ? 'Edit Outreach' : 'Log Outreach'}</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.85)', marginTop:2 }}>
              Logged as <strong>{profile?.full_name || profile?.email || 'Unknown rep'}</strong>
              {profile?.email ? <> {'·'} {profile.email}</> : null}
              {provider ? <> {'·'} {provider.practice_name}</> : null}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'rgba(255,255,255,0.7)' }}>{'×'}</button>
        </div>

        <div style={{ padding:'18px 22px', display:'flex', flexDirection:'column', gap:14 }}>
          {/* Outreach type selector */}
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:'var(--gray)', display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.04em' }}>Outreach Type *</label>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:6 }}>
              {OUTREACH_TYPES.map(t => {
                const sel = form.outreach_type === t.key;
                return (
                  <button key={t.key} type="button" onClick={() => setType(t.key)}
                    style={{
                      padding:'8px 6px', border:`1px solid ${sel ? t.color : 'var(--border)'}`,
                      background: sel ? t.color : 'var(--card-bg)', color: sel ? '#fff' : 'var(--black)',
                      borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer'
                    }}>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Common: date, region, special project */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Date *</label>
              <input type="date" value={form.encounter_date} onChange={e => setForm(f=>({...f,encounter_date:e.target.value}))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Region</label>
              <select value={form.region||''} onChange={e => setForm(f=>({...f,region:e.target.value}))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                <option value="">Multi / Unassigned</option>
                {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Special Project</label>
              <select value={form.special_project_id||''} onChange={e => setForm(f=>({...f,special_project_id:e.target.value}))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                <option value="">None</option>
                {(specialProjects || []).filter(s => s.is_active !== false).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          {/* Contact person picker — provider-bound */}
          {!isEventLike && provider && (
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Contact Person</label>
              <select value={form.contact_person_id||''} onChange={e => setForm(f=>({...f,contact_person_id:e.target.value}))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                <option value="">No specific contact</option>
                {peopleForProvider.map(p => <option key={p.id} value={p.id}>{p.name}{p.title?` - ${p.title}`:''}</option>)}
              </select>
              <div style={{ fontSize:10, color:'var(--gray)', marginTop:3 }}>
                {peopleForProvider.length === 0
                  ? 'No contacts on this provider yet. Add one from the provider expandable.'
                  : `${peopleForProvider.length} contact${peopleForProvider.length===1?'':'s'} known for this provider.`}
              </div>
            </div>
          )}

          {/* Event/job-fair: target clinic or school */}
          {isEventLike && (
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Target Clinic / School / Venue *</label>
              <input value={form.target_clinic_or_school} onChange={e => setForm(f=>({...f,target_clinic_or_school:e.target.value}))}
                placeholder="Name of the clinic or school you're supporting"
                style={{ width:'100%', padding:'7px 10px', border:`1px solid ${!form.target_clinic_or_school?'#FECACA':'var(--border)'}`, borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
            </div>
          )}

          {/* Phone call: reason */}
          {isPhoneCall && (
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Reason / Purpose of Call *</label>
              <textarea value={form.phone_call_reason} onChange={e => setForm(f=>({...f,phone_call_reason:e.target.value}))}
                placeholder="Why you called - intro, follow-up, scheduling, etc."
                style={{ width:'100%', padding:'8px 10px', border:`1px solid ${!form.phone_call_reason?'#FECACA':'var(--border)'}`, borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:54, background:'var(--card-bg)' }} />
            </div>
          )}

          {/* Visit fields — purpose, payer, scheduled next */}
          {showVisitFields && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Purpose</label>
                <select value={form.purpose||''} onChange={e => setForm(f=>({...f,purpose:e.target.value}))}
                  style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                  <option value="">--</option>
                  {PURPOSES.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <MktField label="Insurance / Payer Discussed" field="payer" half value={form.payer} onChange={setForm} placeholder="Humana, BCBS..." />
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Next Event Date</label>
                <input type="date" value={form.scheduled_next_event_date||''} onChange={e => setForm(f=>({...f,scheduled_next_event_date:e.target.value}))}
                  style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
              </div>
            </div>
          )}

          {/* Discussion + follow-up actions */}
          {showVisitFields && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Discussion Points</label>
                <textarea value={form.discussion_points} onChange={e => setForm(f=>({...f,discussion_points:e.target.value}))}
                  placeholder="Topics covered, materials shared, decisions reached..."
                  style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:64, background:'var(--card-bg)' }} />
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Follow-Up Action Steps</label>
                <textarea value={form.follow_up_actions} onChange={e => setForm(f=>({...f,follow_up_actions:e.target.value}))}
                  placeholder="What you committed to do next - send materials, schedule lunch, etc."
                  style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:64, background:'var(--card-bg)' }} />
              </div>
            </div>
          )}

          {/* Summary + outcome rating */}
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Notes / Summary</label>
            <textarea value={form.summary} onChange={e => setForm(f=>({...f,summary:e.target.value}))}
              placeholder="Anything else worth remembering..."
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:54, background:'var(--card-bg)' }} />
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:'var(--gray)', display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.04em' }}>Outcome</label>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:6 }}>
              {OUTCOME_RATINGS.map(o => {
                const sel = form.outcome_rating === o.key;
                return (
                  <button key={o.key} type="button" onClick={() => setForm(f => ({ ...f, outcome_rating: o.key }))}
                    style={{
                      padding:'10px 6px', border:`1px solid ${sel ? o.color : 'var(--border)'}`,
                      background: sel ? o.bg : 'var(--card-bg)', color: sel ? o.color : 'var(--black)',
                      borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer'
                    }}>
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Follow-up due + notes + referrals received */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Follow-Up Due Date</label>
              <input type="date" value={form.follow_up_date} onChange={e => setForm(f=>({...f,follow_up_date:e.target.value}))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
            </div>
            <MktField label="Follow-Up Notes" field="follow_up_notes" value={form.follow_up_notes} onChange={setForm} placeholder="What to do next visit" />
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Referrals Received</label>
              <input type="number" min="0" value={form.referrals_received} onChange={e => setForm(f=>({...f,referrals_received:e.target.value}))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
            </div>
          </div>
        </div>

        {saveError && (
          <div ref={errorRef} style={{
            margin: '0 22px 14px',
            padding: '14px 18px',
            background: '#FEF2F2',
            border: '2px solid #DC2626',
            borderRadius: 10,
            color: '#7F1D1D',
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.5,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}>
            <div style={{
              flexShrink: 0,
              width: 28, height: 28, borderRadius: '50%',
              background: '#DC2626', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 18, lineHeight: 1,
            }}>{'!'}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#991B1B', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Save failed</div>
              <div>{saveError}</div>
            </div>
          </div>
        )}
        {/* Pre-save validation banner — shows which fields are still required.
            Tapping the Save button will now ALSO show the error in the red
            banner above, so iPad users can't get stuck without knowing why. */}
        {(!provider && !isEventLike) && !saveError && (
          <div style={{ margin:'0 22px 10px', padding:'10px 14px', background:'#FFFBEB', border:'1px solid #F59E0B', borderRadius:8, color:'#92400E', fontSize:12, fontWeight:500, lineHeight:1.5 }}>
            <strong>Heads up:</strong> this outreach type needs a provider attached. Close this and click <em>"Log Outreach"</em> from a provider's card, OR switch the type to <em>Event</em> / <em>Job Fair</em> if this is a non-provider activity.
          </div>
        )}
        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
          <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
          {/* Only disable while actively saving — let the user CLICK to see the
              validation error in the red banner instead of being stuck on a
              greyed-out button with no explanation. */}
          <button onClick={save} disabled={saving}
            style={{ padding:'8px 22px', background:'#065F46', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor:saving?'wait':'pointer' }}>
            {saving ? 'Saving...' : 'Log Outreach'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Special Project lookup admin modal — admin-only via RLS
// ─────────────────────────────────────────────────────────────────────────────
function SpecialProjectModal({ project, onClose, onSaved, profile }) {
  const empty = { name:'', description:'', color:'#1565C0', is_active:true, started_at:'', ended_at:'' };
  const [form, setForm] = useState(project ? { ...empty, ...project } : empty);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.name?.trim()) return;
    setSaving(true);
    const payload = { ...form, started_at: form.started_at || null, ended_at: form.ended_at || null, updated_at: new Date().toISOString() };
    if (project) {
      await supabase.from('marketing_special_projects').update(payload).eq('id', project.id);
    } else {
      await supabase.from('marketing_special_projects').insert({ ...payload, created_by: profile?.id });
    }
    setSaving(false);
    onSaved();
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:2050, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:480, boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding:'14px 22px', background:'#1565C0', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:14, fontWeight:700, color:'#fff' }}>{project ? 'Edit Project' : 'New Special Project'}</div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'rgba(255,255,255,0.7)' }}>{'×'}</button>
        </div>
        <div style={{ padding:22, display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <MktField label="Name" field="name" required value={form.name} onChange={setForm} />
          <MktField label="Description" field="description" value={form.description} onChange={setForm} />
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Started</label>
            <input type="date" value={form.started_at||''} onChange={e => setForm(f=>({...f,started_at:e.target.value}))}
              style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--card-bg)', boxSizing:'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Ended</label>
            <input type="date" value={form.ended_at||''} onChange={e => setForm(f=>({...f,ended_at:e.target.value}))}
              style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--card-bg)', boxSizing:'border-box' }} />
          </div>
          <div style={{ gridColumn:'span 2', display:'flex', alignItems:'center', gap:8 }}>
            <input type="checkbox" id="proj_active" checked={!!form.is_active} onChange={e => setForm(f=>({...f,is_active:e.target.checked}))} />
            <label htmlFor="proj_active" style={{ fontSize:13, color:'var(--black)' }}>Active (visible in dropdown for new outreach)</label>
          </div>
        </div>
        <div style={{ padding:'12px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
          <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving || !form.name?.trim()}
            style={{ padding:'8px 22px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor:'pointer', opacity:!form.name?.trim()?0.5:1 }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirm-delete modal — small reusable confirmation prompt.
// ─────────────────────────────────────────────────────────────────────────────
function ConfirmDeleteModal({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { await onConfirm(); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:2200, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:440, boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding:'18px 22px', borderBottom:'1px solid var(--border)' }}>
          <div style={{ fontSize:15, fontWeight:700, color:'var(--black)' }}>{title}</div>
        </div>
        <div style={{ padding:'18px 22px', fontSize:13, color:'var(--black)', lineHeight:1.5 }}>
          {message}
        </div>
        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
          <button onClick={onCancel} disabled={busy} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
          <button onClick={go} disabled={busy} style={{ padding:'8px 22px', background:'#DC2626', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor:'pointer', opacity:busy?0.6:1 }}>
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Contact Quick-Add Modal — primary entry from main header "+ New Contact".
// Provider typeahead from existing providers + inline "create new provider"
// for when the contact's organization isn't yet in the system.
// ─────────────────────────────────────────────────────────────────────────────
function ContactQuickAddModal({ providers, onClose, onSaved, profile }) {
  const [step, setStep] = useState('pick');  // 'pick' | 'newprovider'
  const [providerSearch, setProviderSearch] = useState('');
  const [selectedProvider, setSelectedProvider] = useState(null);
  // Inline new-provider sub-form (minimum fields; full edit available afterward)
  const [newProv, setNewProv] = useState({
    practice_name:'', contact_type:'PCP', region: profile?.regions?.[0] || '',
    primary_insurance:'', referral_potential:'medium', active_referral_source:false,
  });
  const [contact, setContact] = useState({ name:'', title:'', phone:'', email:'', notes:'', is_primary:false });
  const [saving, setSaving] = useState(false);

  const activeProviders = useMemo(
    () => (providers || []).filter(p => p.is_active !== false),
    [providers]
  );
  const filteredProviders = useMemo(() => {
    const q = providerSearch.trim().toLowerCase();
    if (!q) return activeProviders.slice(0, 50);
    return activeProviders.filter(p =>
      (p.practice_name||'').toLowerCase().includes(q)
      || (p.contact_type||'').toLowerCase().includes(q)
      || (p.region||'').toLowerCase().includes(q)
      || (p.city||'').toLowerCase().includes(q)
    ).slice(0, 50);
  }, [activeProviders, providerSearch]);

  async function save() {
    if (!contact.name?.trim()) return;
    if (step === 'pick' && !selectedProvider) return;
    if (step === 'newprovider' && !newProv.practice_name?.trim()) return;
    setSaving(true);

    let providerId = selectedProvider?.id;
    let providerForLog = selectedProvider;

    // Inline create new provider
    if (step === 'newprovider') {
      const { data: pd } = await supabase.from('marketing_contacts').insert({
        ...newProv,
        is_active: true,
        assigned_rep_id: profile?.id || null,
        created_by: profile?.full_name || profile?.email,
        updated_at: new Date().toISOString(),
      }).select().single();
      providerId = pd?.id;
      providerForLog = pd;
      logActivity({
        coordinatorId: profile?.id, coordinatorName: profile?.full_name, coordinatorRole: profile?.role,
        actionType: 'marketing_provider_created',
        actionDetail: `${newProv.practice_name} (${newProv.contact_type}) - Region ${newProv.region || 'n/a'} [inline from quick contact]`,
        tableName: 'marketing_contacts', recordId: providerId,
        metadata: { region: newProv.region, provider_type: newProv.contact_type, inline_from_quick_contact: true },
      });
    }

    // Insert the contact
    if (providerId) {
      const { data: cd } = await supabase.from('marketing_contact_people').insert({
        provider_id: providerId,
        name: contact.name,
        title: contact.title || null,
        phone: contact.phone || null,
        email: contact.email || null,
        notes: contact.notes || null,
        is_primary: !!contact.is_primary,
        is_active: true,
        region: providerForLog?.region || null,
        created_by: profile?.id || null,
        updated_at: new Date().toISOString(),
      }).select().single();
      logActivity({
        coordinatorId: profile?.id, coordinatorName: profile?.full_name, coordinatorRole: profile?.role,
        actionType: 'marketing_contact_created',
        actionDetail: `${contact.name} at ${providerForLog?.practice_name || 'unknown provider'}`,
        tableName: 'marketing_contact_people', recordId: cd?.id,
        metadata: { provider_id: providerId, region: providerForLog?.region },
      });
    }

    setSaving(false);
    onSaved();
  }

  const canSubmit = !!contact.name?.trim() && (
    (step === 'pick' && selectedProvider) ||
    (step === 'newprovider' && newProv.practice_name?.trim())
  );

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:2100, display:'flex', alignItems:'center', justifyContent:'center', padding:24, overflowY:'auto' }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:620, maxHeight:'92vh', overflow:'auto', boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding:'16px 22px', background:'#1565C0', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, zIndex:1 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>New Contact</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.85)', marginTop:2 }}>
              Step 1: choose or create the provider · Step 2: contact details
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'rgba(255,255,255,0.7)' }}>{'×'}</button>
        </div>

        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14 }}>

          {/* Provider section */}
          <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <div style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.04em', color:'var(--gray)' }}>
                Provider
              </div>
              <button
                onClick={() => { setStep(step === 'newprovider' ? 'pick' : 'newprovider'); setSelectedProvider(null); }}
                style={{ fontSize:11, fontWeight:600, color:'#1565C0', background:'none', border:'none', cursor:'pointer', padding:0 }}>
                {step === 'newprovider' ? '← Pick existing provider' : '+ Create new provider inline'}
              </button>
            </div>

            {step === 'pick' && (
              <>
                <input value={providerSearch} onChange={e => setProviderSearch(e.target.value)}
                  placeholder="Search providers by name, type, region, city..."
                  style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box', marginBottom:8 }} />
                <div style={{ maxHeight:200, overflowY:'auto', border:'1px solid var(--border)', borderRadius:6, background:'var(--card-bg)' }}>
                  {filteredProviders.length === 0 ? (
                    <div style={{ padding:12, fontSize:12, color:'var(--gray)', textAlign:'center', fontStyle:'italic' }}>
                      No providers match. Try "+ Create new provider inline" above.
                    </div>
                  ) : filteredProviders.map(p => {
                    const sel = selectedProvider?.id === p.id;
                    return (
                      <div key={p.id} onClick={() => setSelectedProvider(p)}
                        style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', cursor:'pointer', background: sel ? '#EFF6FF' : 'transparent', display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                        <div style={{ minWidth:0, flex:1 }}>
                          <div style={{ fontSize:12, fontWeight:600, color:'var(--black)' }}>{p.practice_name}</div>
                          <div style={{ fontSize:10, color:'var(--gray)' }}>{p.contact_type} · Region {p.region || '—'} {p.city ? `· ${p.city}` : ''}</div>
                        </div>
                        {sel && <span style={{ fontSize:10, fontWeight:700, color:'#1E40AF' }}>Selected</span>}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {step === 'newprovider' && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <div style={{ gridColumn:'span 2' }}>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Practice Name *</label>
                  <input value={newProv.practice_name} onChange={e => setNewProv(p=>({...p,practice_name:e.target.value}))}
                    style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Provider Type</label>
                  <select value={newProv.contact_type} onChange={e => setNewProv(p=>({...p,contact_type:e.target.value}))}
                    style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                    {PROVIDER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Region</label>
                  <select value={newProv.region} onChange={e => setNewProv(p=>({...p,region:e.target.value}))}
                    style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                    <option value="">Unassigned</option>
                    {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn:'span 2', fontSize:11, color:'var(--gray)', fontStyle:'italic' }}>
                  You can fill in address, NPI, insurance, etc. afterward from the Providers tab.
                </div>
              </div>
            )}
          </div>

          {/* Contact section */}
          <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.04em', color:'var(--gray)', marginBottom:10 }}>
              Contact
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              <div style={{ gridColumn:'span 2' }}>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Contact Name *</label>
                <input value={contact.name} onChange={e => setContact(c=>({...c,name:e.target.value}))}
                  style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
              </div>
              <div style={{ gridColumn:'span 2' }}>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Title (MD, DO, NP, Office Manager, Referral Lead, etc.)</label>
                <input value={contact.title} onChange={e => setContact(c=>({...c,title:e.target.value}))}
                  style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Phone</label>
                <input value={contact.phone} onChange={e => setContact(c=>({...c,phone:e.target.value}))}
                  style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Email</label>
                <input value={contact.email} onChange={e => setContact(c=>({...c,email:e.target.value}))} type="email"
                  style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
              </div>
              <div style={{ gridColumn:'span 2' }}>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:3 }}>Notes</label>
                <textarea value={contact.notes} onChange={e => setContact(c=>({...c,notes:e.target.value}))}
                  placeholder="Best time to reach, referral preferences, decision-maker context, etc."
                  style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:60, background:'var(--card-bg)' }} />
              </div>
              <div style={{ gridColumn:'span 2', display:'flex', alignItems:'center', gap:8 }}>
                <input type="checkbox" id="qc_primary" checked={!!contact.is_primary} onChange={e => setContact(c=>({...c,is_primary:e.target.checked}))} />
                <label htmlFor="qc_primary" style={{ fontSize:13, color:'var(--black)' }}>Primary contact for this provider</label>
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
          <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving || !canSubmit}
            style={{ padding:'8px 22px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor:'pointer', opacity:!canSubmit?0.5:1 }}>
            {saving ? 'Saving...' : (step === 'newprovider' ? 'Create Provider & Contact' : 'Add Contact')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function MarketingCRMPage() {
  const { profile } = useAuth();
  const regionScope = useAssignedRegions();

  const [providers, setProviders] = useState([]);
  const [encounters, setEncounters] = useState([]);
  const [people, setPeople] = useState([]);
  const [specialProjects, setSpecialProjects] = useState([]);
  const [reps, setReps] = useState([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState('activity');
  const [filterType, setFilterType]         = useState('ALL');
  const [filterRegion, setFilterRegion]     = useState('ALL');
  const [filterPotential, setFilterPotential]= useState('ALL');
  const [filterRep, setFilterRep]           = useState('ALL');
  const [filterOutreach, setFilterOutreach] = useState('ALL');
  const [filterOutcome, setFilterOutcome]   = useState('ALL');
  const [filterProject, setFilterProject]   = useState('ALL');
  const [filterPayer, setFilterPayer]       = useState('ALL');
  const [searchQ, setSearchQ]               = useState('');
  const [myPipeline, setMyPipeline]         = useState(false);

  const [showProviderModal, setShowProviderModal] = useState(false);
  const [editProvider, setEditProvider]           = useState(null);
  const [personProvider, setPersonProvider]       = useState(null);
  const [editPerson, setEditPerson]               = useState(null);
  const [outreachProvider, setOutreachProvider]   = useState(null);
  const [outreachUntargeted, setOutreachUntargeted] = useState(false); // events/job-fairs without provider
  const [editEncounter, setEditEncounter]         = useState(null);    // 2026-05-30: outreach edit
  const [editProject, setEditProject]             = useState(null);
  const [showProjectModal, setShowProjectModal]   = useState(false);
  const [expandedProvider, setExpandedProvider]   = useState(null);

  // 2026-05-30 Phase 2c — CRUD enhancements
  const [showQuickContactModal, setShowQuickContactModal] = useState(false);
  const [showInactive, setShowInactive]           = useState(false);
  const [expandedContact, setExpandedContact]     = useState(null);
  // pendingDelete shape: { type: 'provider'|'contact'|'outreach', record: {...} } | null
  const [pendingDelete, setPendingDelete]         = useState(null);
  const [contactSearchQ, setContactSearchQ]       = useState('');
  const [contactSortKey, setContactSortKey]       = useState('name');
  const [contactSortDir, setContactSortDir]       = useState('asc');

  const isAdminTier = profile && (
    ['super_admin','admin','director','ceo'].includes(profile.role)
    || (profile.secondary_roles || []).includes('marketing_manager')
  );

  // Marketing-primary roles roam across all regions to mirror the DB-side
  // can_access_marketing_region() whitelist (see CLAUDE.md #15). Without
  // this, useAssignedRegions scopes HAEs to their `coordinators.regions`
  // array — Brian Roffe only saw Region T providers and Walter Holston
  // (regions = []) saw nothing at all, forcing them into the Untargeted
  // flow where the Save button silently disables for non-event outreach
  // types. Keep this LOCAL to Marketing CRM — useAssignedRegions is shared
  // with clinical/ops pages where HAEs must NOT see cross-region data.
  const isMarketingAllAccess = profile && (
    ['super_admin','admin','director','ceo','director_payer_marketing',
     'healthcare_account_executive','marketing_rep'].includes(profile.role)
    || (profile.secondary_roles || []).includes('marketing_manager')
    || (profile.secondary_roles || []).includes('marketing_rep')
  );
  const scopeQuery = (q) => isMarketingAllAccess ? q : regionScope.applyToQuery(q);

  async function load() {
    if (regionScope.loading) return;
    if (!isMarketingAllAccess && !regionScope.isAllAccess && (!regionScope.regions || regionScope.regions.length === 0)) {
      setProviders([]); setEncounters([]); setPeople([]); setSpecialProjects([]); setReps([]); setLoading(false); return;
    }
    const [c, e, p, s, r] = await Promise.all([
      fetchAllPages(scopeQuery(supabase.from('marketing_contacts').select('*').order('practice_name'))),
      fetchAllPages(scopeQuery(supabase.from('marketing_encounters').select('*').order('encounter_date', { ascending: false }))),
      fetchAllPages(scopeQuery(supabase.from('marketing_contact_people').select('*').order('name'))),
      fetchAllPages(supabase.from('marketing_special_projects').select('*').order('name')),
      fetchAllPages(supabase.from('coordinators')
        .select('id, full_name, role, secondary_roles, regions, is_active')
        .eq('is_active', true)
        .order('full_name')),
    ]);
    setProviders(c || []);
    setEncounters(e || []);
    setPeople(p || []);
    setSpecialProjects(s || []);
    setReps((r || []).filter(x =>
      ['regional_manager','assoc_director','marketing_rep'].includes(x.role)
      || (x.secondary_roles || []).includes('marketing_rep')
      || (x.secondary_roles || []).includes('marketing_manager')
    ));
    setLoading(false);
  }

  useEffect(() => { load(); }, [regionScope.loading, regionScope.isAllAccess, JSON.stringify(regionScope.regions)]);
  useRealtimeTable(['marketing_contacts', 'marketing_encounters', 'marketing_contact_people', 'marketing_special_projects'], load);

  // ── Delete handlers (Phase 2c, 2026-05-30) ───────────────────────────────
  // Soft delete for providers + contacts (preserves attribution + history).
  // Hard delete for outreach events (discrete, recoverable from activity log).
  async function softDeleteProvider(p) {
    await supabase.from('marketing_contacts')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', p.id);
    logActivity({
      coordinatorId: profile?.id, coordinatorName: profile?.full_name, coordinatorRole: profile?.role,
      actionType: 'marketing_provider_deactivated',
      actionDetail: `${p.practice_name} (${p.contact_type || 'unknown'})`,
      tableName: 'marketing_contacts', recordId: p.id,
      metadata: { region: p.region, soft_delete: true },
    });
    setPendingDelete(null);
    load();
  }
  async function softDeleteContact(pp) {
    const prov = providers.find(x => x.id === pp.provider_id);
    await supabase.from('marketing_contact_people')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', pp.id);
    logActivity({
      coordinatorId: profile?.id, coordinatorName: profile?.full_name, coordinatorRole: profile?.role,
      actionType: 'marketing_contact_deactivated',
      actionDetail: `${pp.name}${prov?` at ${prov.practice_name}`:''}`,
      tableName: 'marketing_contact_people', recordId: pp.id,
      metadata: { provider_id: pp.provider_id, region: pp.region || prov?.region, soft_delete: true },
    });
    setPendingDelete(null);
    load();
  }
  async function hardDeleteOutreach(e) {
    const prov = providers.find(x => x.id === e.contact_id);
    await supabase.from('marketing_encounters').delete().eq('id', e.id);
    logActivity({
      coordinatorId: profile?.id, coordinatorName: profile?.full_name, coordinatorRole: profile?.role,
      actionType: 'marketing_outreach_deleted',
      actionDetail: `${OUTREACH_LABEL[e.outreach_type] || e.encounter_type || 'outreach'} on ${e.encounter_date}${prov?` - ${prov.practice_name}`:''}${e.target_clinic_or_school?` - ${e.target_clinic_or_school}`:''}`,
      tableName: 'marketing_encounters', recordId: e.id,
      metadata: { outreach_type: e.outreach_type, region: e.region, hard_delete: true },
    });
    setPendingDelete(null);
    load();
  }
  // Permission helper. Admin tier OR the original logger can delete an outreach.
  function canDeleteOutreach(e) {
    if (!profile) return false;
    if (isAdminTier) return true;
    return e.rep_id === profile.id;
  }
  function canDeleteContactOrProvider() {
    return isAdminTier;
  }

  // ── Derived filtering ─────────────────────────────────────────────────────
  const filteredProviders = useMemo(() => providers.filter(p => {
    if (!showInactive && p.is_active === false) return false;
    if (filterType !== 'ALL' && p.contact_type !== filterType) return false;
    if (filterRegion !== 'ALL' && p.region !== filterRegion) return false;
    if (filterPotential !== 'ALL' && p.referral_potential !== filterPotential) return false;
    if (filterPayer !== 'ALL' && (p.primary_insurance || '') !== filterPayer) return false;
    if (myPipeline && profile?.id && p.assigned_rep_id !== profile.id) return false;
    if (searchQ) {
      const q = searchQ.toLowerCase();
      if (!`${p.practice_name} ${p.city||''} ${p.npi||''} ${p.primary_insurance||''}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [providers, showInactive, filterType, filterRegion, filterPotential, filterPayer, myPipeline, profile?.id, searchQ]);

  // ── All-Contacts tab data + sort ─────────────────────────────────────────
  const filteredContactPeople = useMemo(() => {
    const lowerQ = (contactSearchQ || '').trim().toLowerCase();
    const rows = (people || []).map(pp => {
      const prov = providers.find(p => p.id === pp.provider_id);
      const lastEnc = encounters
        .filter(e => e.contact_person_id === pp.id || e.contact_id === pp.provider_id)
        .sort((a,b) => (b.encounter_date||'').localeCompare(a.encounter_date||''))[0];
      return { ...pp, _provider: prov || null, _lastEncounter: lastEnc || null };
    }).filter(pp => {
      if (!showInactive && pp.is_active === false) return false;
      if (filterRegion !== 'ALL' && (pp.region || pp._provider?.region) !== filterRegion) return false;
      if (filterRep !== 'ALL' && pp._provider?.assigned_rep_id !== filterRep) return false;
      if (lowerQ) {
        const hay = `${pp.name||''} ${pp.title||''} ${pp.phone||''} ${pp.email||''} ${pp._provider?.practice_name||''} ${pp.notes||''}`.toLowerCase();
        if (!hay.includes(lowerQ)) return false;
      }
      return true;
    });

    const dir = contactSortDir === 'asc' ? 1 : -1;
    const keyFn = {
      name:     pp => (pp.name || '').toLowerCase(),
      title:    pp => (pp.title || '').toLowerCase(),
      provider: pp => (pp._provider?.practice_name || '').toLowerCase(),
      region:   pp => (pp.region || pp._provider?.region || '').toLowerCase(),
      last:     pp => pp._lastEncounter?.encounter_date || '',
    }[contactSortKey] || (pp => (pp.name || '').toLowerCase());

    return rows.sort((a, b) => {
      const av = keyFn(a), bv = keyFn(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    });
  }, [people, providers, encounters, showInactive, filterRegion, filterRep, contactSearchQ, contactSortKey, contactSortDir]);

  const filteredEncounters = useMemo(() => encounters.filter(e => {
    if (filterRegion !== 'ALL' && e.region !== filterRegion) return false;
    if (filterOutreach !== 'ALL' && e.outreach_type !== filterOutreach) return false;
    if (filterOutcome !== 'ALL' && e.outcome_rating !== filterOutcome) return false;
    if (filterProject !== 'ALL' && e.special_project_id !== filterProject) return false;
    if (filterRep !== 'ALL' && e.rep_id !== filterRep) return false;
    if (myPipeline && profile?.id && e.rep_id !== profile.id) return false;
    if (filterPayer !== 'ALL' && (e.payer || '') !== filterPayer) return false;
    if (searchQ) {
      const provider = providers.find(p => p.id === e.contact_id);
      const q = searchQ.toLowerCase();
      const hay = `${provider?.practice_name||''} ${e.summary||''} ${e.discussion_points||''} ${e.target_clinic_or_school||''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [encounters, providers, filterRegion, filterOutreach, filterOutcome, filterProject, filterRep, filterPayer, myPipeline, profile?.id, searchQ]);

  // KPI computations — use Sun-Sat week math
  const todayStr = new Date().toISOString().slice(0,10);
  const weekStartStr = toDateStr(getWeekStart(new Date()));
  const weekEndStr   = toDateStr(getWeekEnd(new Date()));
  const monthStart   = new Date().toISOString().slice(0,7);

  const wkEncounters = filteredEncounters.filter(e => e.encounter_date >= weekStartStr && e.encounter_date <= weekEndStr);
  const moEncounters = filteredEncounters.filter(e => (e.encounter_date||'').startsWith(monthStart));
  const successful   = filteredEncounters.filter(e => e.outcome_rating === 'successful').length;
  const ratedCount   = filteredEncounters.filter(e => e.outcome_rating).length;
  const successRate  = ratedCount > 0 ? Math.round(100 * successful / ratedCount) : null;
  const followUpsOverdue = filteredEncounters.filter(e => e.follow_up_date && e.follow_up_date < todayStr && !e.follow_up_completed);
  const followUpsToday   = filteredEncounters.filter(e => e.follow_up_date === todayStr && !e.follow_up_completed);
  const inServiceMonth   = moEncounters.filter(e => e.outreach_type === 'in_service' || e.outreach_type === 'lunch_and_learn').length;
  const activeProjects   = specialProjects.filter(s => s.is_active).length;

  // Reports — provider relationship depth
  const providerDepth = useMemo(() => filteredProviders.map(p => {
    const enc = encounters.filter(e => e.contact_id === p.id);
    const successful = enc.filter(e => e.outcome_rating === 'successful').length;
    const lastContact = enc[0]?.encounter_date || null;
    const nextFollowUp = enc.filter(e => e.follow_up_date && !e.follow_up_completed).map(e => e.follow_up_date).sort()[0] || null;
    const refCount = enc.reduce((s,e) => s + (e.referrals_received || 0), 0);
    return { provider: p, touchpoints: enc.length, successful, lastContact, nextFollowUp, refCount };
  }).sort((a,b) => b.touchpoints - a.touchpoints).slice(0, 50),
  [filteredProviders, encounters]);

  // Reports — weekly trend, last 8 weeks
  const trendByWeek = useMemo(() => {
    const buckets = {};
    for (let w = 7; w >= 0; w--) {
      const wkStart = toDateStr(getWeekStart(new Date(), w));
      buckets[wkStart] = { week: wkStart, total: 0, successful: 0 };
    }
    filteredEncounters.forEach(e => {
      if (!e.encounter_date) return;
      // Find which bucket this falls into
      for (let w = 7; w >= 0; w--) {
        const wkS = toDateStr(getWeekStart(new Date(), w));
        const wkE = toDateStr(getWeekEnd(new Date(), w));
        if (e.encounter_date >= wkS && e.encounter_date <= wkE) {
          buckets[wkS].total += 1;
          if (e.outcome_rating === 'successful') buckets[wkS].successful += 1;
          break;
        }
      }
    });
    return Object.values(buckets);
  }, [filteredEncounters]);

  // Project rollups
  const projectRollups = useMemo(() => specialProjects.map(s => {
    const enc = filteredEncounters.filter(e => e.special_project_id === s.id);
    return {
      project: s,
      total: enc.length,
      successful: enc.filter(e => e.outcome_rating === 'successful').length,
      followUpsOpen: enc.filter(e => e.follow_up_date && !e.follow_up_completed).length,
    };
  }).filter(r => r.total > 0 || (r.project && r.project.is_active)),
  [specialProjects, filteredEncounters]);

  // Distinct payers for the filter dropdown
  const payersList = useMemo(() => {
    const set = new Set();
    providers.forEach(p => { if (p.primary_insurance) set.add(p.primary_insurance); });
    encounters.forEach(e => { if (e.payer) set.add(e.payer); });
    return Array.from(set).sort();
  }, [providers, encounters]);

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Marketing CRM" subtitle="Loading..." />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading...</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%' }}>
      <TopBar
        title="Marketing CRM"
        subtitle={`${providers.length} providers · ${people.length} contacts · ${encounters.length} outreach events`}
      />

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, borderBottom:'1px solid var(--border)', background:'var(--card-bg)', padding:'0 20px', position:'sticky', top:0, zIndex:10 }}>
        {[
          ['activity','Activity Log'],
          ['providers','Providers'],
          ['contacts','Contacts'],
          ['followups','Follow-Ups'],
          ['reports','Reports'],
          ...(isAdminTier ? [['admin','Projects Admin']] : []),
        ].map(([k,l]) => (
          <button key={k} onClick={() => setActiveTab(k)}
            style={{ padding:'12px 16px', border:'none', borderBottom:`2px solid ${activeTab===k?'#DC2626':'transparent'}`, background:'none', fontSize:12, fontWeight:activeTab===k?700:400, color:activeTab===k?'#DC2626':'var(--gray)', cursor:'pointer' }}>
            {l}
            {k==='followups' && followUpsOverdue.length>0 && (
              <span style={{ background:'#DC2626', color:'#fff', borderRadius:999, fontSize:9, fontWeight:700, padding:'1px 5px', marginLeft:6 }}>
                {followUpsOverdue.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>
        {/* KPI strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:12 }}>
          {[
            { label:'This Week (Sun-Sat)', val:wkEncounters.length, color:'var(--black)' },
            { label:'This Month', val:moEncounters.length, color:'var(--black)' },
            { label:'In-Service + L&L MTD', val:inServiceMonth, color:'#065F46', bg:'#ECFDF5' },
            { label:'Success Rate', val: successRate === null ? '—' : `${successRate}%`, color: successRate === null ? 'var(--gray)' : '#065F46', bg: successRate === null ? 'var(--card-bg)' : '#ECFDF5' },
            { label:'Follow-Ups Overdue', val:followUpsOverdue.length, color:followUpsOverdue.length>0?'#DC2626':'#065F46', bg:followUpsOverdue.length>0?'#FEF2F2':'var(--card-bg)' },
            { label:'Follow-Ups Today', val:followUpsToday.length, color:followUpsToday.length>0?'#D97706':'var(--gray)', bg:followUpsToday.length>0?'#FEF3C7':'var(--card-bg)' },
            { label:'Active Projects', val:activeProjects, color:'#1565C0', bg:'#EFF6FF' },
          ].map(c => (
            <div key={c.label} style={{ background:c.bg||'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 14px' }}>
              <div style={{ fontSize:10, fontWeight:600, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em' }}>{c.label}</div>
              <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', color:c.color, marginTop:4 }}>{c.val}</div>
            </div>
          ))}
        </div>

        {/* Filter bar — applies to Activity Log + Providers + Follow-Ups + Reports */}
        {activeTab !== 'admin' && (
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'10px 14px', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search practice, NPI, summary..."
              style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)', width:200 }} />
            <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
              style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)' }}>
              <option value="ALL">All Regions</option>
              {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
            </select>
            <select value={filterRep} onChange={e => setFilterRep(e.target.value)}
              style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)' }}>
              <option value="ALL">All Reps</option>
              {reps.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)' }}>
              <option value="ALL">All Provider Types</option>
              {PROVIDER_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={filterOutreach} onChange={e => setFilterOutreach(e.target.value)}
              style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)' }}>
              <option value="ALL">All Outreach Types</option>
              {OUTREACH_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <select value={filterOutcome} onChange={e => setFilterOutcome(e.target.value)}
              style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)' }}>
              <option value="ALL">All Outcomes</option>
              {OUTCOME_RATINGS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
              style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)' }}>
              <option value="ALL">All Projects</option>
              {specialProjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={filterPayer} onChange={e => setFilterPayer(e.target.value)}
              style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)' }}>
              <option value="ALL">All Payers</option>
              {payersList.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <label style={{ fontSize:11, color:'var(--gray)', display:'flex', alignItems:'center', gap:5, marginLeft:6 }}>
              <input type="checkbox" checked={myPipeline} onChange={e => setMyPipeline(e.target.checked)} /> My pipeline
            </label>
            <label style={{ fontSize:11, color:'var(--gray)', display:'flex', alignItems:'center', gap:5 }}>
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive
            </label>
            <span style={{ marginLeft:'auto', display:'flex', gap:6 }}>
              <button onClick={() => { setOutreachUntargeted(true); setOutreachProvider(null); }}
                style={{ padding:'7px 14px', background:'#065F46', color:'#fff', border:'none', borderRadius:6, fontSize:12, fontWeight:700, cursor:'pointer' }}>
                + Log Outreach
              </button>
              <button onClick={() => setShowQuickContactModal(true)}
                style={{ padding:'7px 14px', background:'#1565C0', color:'#fff', border:'none', borderRadius:6, fontSize:12, fontWeight:700, cursor:'pointer' }}>
                + New Contact
              </button>
            </span>
          </div>
        )}

        {/* ── ACTIVITY LOG ── */}
        {activeTab === 'activity' && (
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 18px', borderBottom:'1px solid var(--border)', fontSize:13, fontWeight:700 }}>
              Outreach Activity {'·'} {filteredEncounters.length} shown
            </div>
            {filteredEncounters.length === 0 ? (
              <div style={{ padding:40, textAlign:'center', color:'var(--gray)', fontSize:13 }}>No outreach matches your filters.</div>
            ) : filteredEncounters.slice(0, 200).map((e, i) => {
              const prov = providers.find(p => p.id === e.contact_id);
              const person = people.find(pp => pp.id === e.contact_person_id);
              const rep = reps.find(r => r.id === e.rep_id);
              const outc = OUTCOME_RATINGS.find(o => o.key === e.outcome_rating);
              const proj = specialProjects.find(s => s.id === e.special_project_id);
              const otColor = OUTREACH_COLOR[e.outreach_type] || '#6B7280';
              return (
                <div key={e.id} style={{ display:'flex', gap:14, padding:'12px 18px', borderBottom:'1px solid var(--border)', background:i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'flex-start' }}>
                  <div style={{ fontSize:11, fontFamily:'DM Mono, monospace', color:'var(--gray)', flexShrink:0, marginTop:2, minWidth:80 }}>{fmtDate(e.encounter_date)}</div>
                  <span style={{ fontSize:10, fontWeight:700, color:otColor, background:otColor+'15', padding:'2px 8px', borderRadius:999, flexShrink:0, marginTop:1, whiteSpace:'nowrap' }}>{OUTREACH_LABEL[e.outreach_type] || e.encounter_type || 'Other'}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600 }}>
                      {prov?.practice_name || e.target_clinic_or_school || 'Untargeted outreach'}
                      {person ? <span style={{ color:'var(--gray)', fontWeight:400 }}> {'·'} {person.name}</span> : null}
                    </div>
                    <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>
                      by {rep?.full_name || e.conducted_by || 'unknown'}{e.region?` · Region ${e.region}`:''}{proj?` · ${proj.name}`:''}{e.payer?` · Payer: ${e.payer}`:''}
                    </div>
                    {e.summary && <div style={{ fontSize:12, color:'var(--black)', marginTop:4 }}>{e.summary}</div>}
                    {e.discussion_points && <div style={{ fontSize:12, color:'var(--gray)', marginTop:2 }}>Discussion: {e.discussion_points}</div>}
                    {e.phone_call_reason && <div style={{ fontSize:12, color:'var(--gray)', marginTop:2 }}>Reason: {e.phone_call_reason}</div>}
                    {e.follow_up_actions && <div style={{ fontSize:11, color:'#1565C0', marginTop:2 }}>Next steps: {e.follow_up_actions}</div>}
                    {e.follow_up_date && <div style={{ fontSize:11, color:'#D97706', marginTop:2 }}>Follow-up: {fmtDate(e.follow_up_date)} {e.follow_up_notes ? `— ${e.follow_up_notes}` : ''}</div>}
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 }}>
                    {outc && <span style={{ fontSize:10, fontWeight:700, color:outc.color, background:outc.bg, padding:'2px 8px', borderRadius:999 }}>{outc.label}</span>}
                    {e.referrals_received > 0 && (
                      <span style={{ fontSize:10, fontWeight:700, color:'#065F46', background:'#ECFDF5', padding:'2px 8px', borderRadius:999 }}>
                        +{e.referrals_received} ref{e.referrals_received>1?'s':''}
                      </span>
                    )}
                    <div style={{ display:'flex', gap:4, marginTop:2 }}>
                      <button onClick={() => setEditEncounter(e)}
                        style={{ fontSize:10, color:'var(--gray)', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:5, padding:'2px 7px', cursor:'pointer' }}>Edit</button>
                      {canDeleteOutreach(e) && (
                        <button onClick={() => setPendingDelete({ type:'outreach', record: e })}
                          style={{ fontSize:10, color:'#DC2626', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:5, padding:'2px 7px', cursor:'pointer' }}>Delete</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredEncounters.length > 200 && (
              <div style={{ padding:10, textAlign:'center', fontSize:11, color:'var(--gray)' }}>Showing first 200 of {filteredEncounters.length}. Tighten filters to drill in.</div>
            )}
          </div>
        )}

        {/* ── PROVIDERS ── */}
        {activeTab === 'providers' && (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {/* Providers tab header — "+ Add Provider" button (the main page
                header "+ New Contact" is for adding a contact under a provider) */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontSize:12, color:'var(--gray)' }}>
                {filteredProviders.length} provider{filteredProviders.length === 1 ? '' : 's'} shown
              </div>
              <button onClick={() => { setEditProvider(null); setShowProviderModal(true); }}
                style={{ fontSize:12, fontWeight:700, color:'#fff', background:'#1565C0', border:'none', borderRadius:6, padding:'6px 12px', cursor:'pointer' }}>
                + Add Provider
              </button>
            </div>
            {filteredProviders.length === 0 ? (
              <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:36, textAlign:'center' }}>
                <div style={{ fontSize:14, fontWeight:600 }}>No providers match your filters</div>
                <div style={{ fontSize:12, color:'var(--gray)', marginTop:6 }}>Click "+ Add Provider" to create one.</div>
              </div>
            ) : filteredProviders.map(p => {
              const pEnc = encounters.filter(e => e.contact_id === p.id);
              const pPeople = people.filter(pp => pp.provider_id === p.id);
              const isExpanded = expandedProvider === p.id;
              const typeColor = TYPE_COLORS[p.contact_type] || '#6B7280';
              const refCount = pEnc.reduce((s,e) => s+(e.referrals_received||0), 0);
              const assignedRep = reps.find(r => r.id === p.assigned_rep_id);
              return (
                <div key={p.id} style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 18px', cursor:'pointer' }} onClick={() => setExpandedProvider(isExpanded ? null : p.id)}>
                    <div style={{ width:42, height:42, borderRadius:10, background:typeColor+'20', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <span style={{ fontSize:10, fontWeight:800, color:typeColor }}>{p.contact_type.slice(0,3).toUpperCase()}</span>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                        <div style={{ fontSize:14, fontWeight:700 }}>{p.practice_name}</div>
                        <span style={{ fontSize:10, fontWeight:700, color:typeColor, background:typeColor+'15', padding:'2px 8px', borderRadius:999 }}>{p.contact_type}</span>
                        {p.active_referral_source && <span style={{ fontSize:10, fontWeight:700, color:'#065F46', background:'#ECFDF5', padding:'2px 8px', borderRadius:999 }}>Active Source</span>}
                        {p.region && <span style={{ fontSize:10, color:'var(--gray)', background:'var(--border)', padding:'2px 7px', borderRadius:999 }}>Rgn {p.region}</span>}
                        {p.primary_insurance && <span style={{ fontSize:10, color:'#1565C0', background:'#EFF6FF', padding:'2px 7px', borderRadius:999 }}>{p.primary_insurance}</span>}
                      </div>
                      <div style={{ fontSize:11, color:'var(--gray)', marginTop:3 }}>
                        {pPeople.length} contact{pPeople.length===1?'':'s'} {'·'} {assignedRep ? `Assigned: ${assignedRep.full_name}` : 'Unassigned'} {p.city ? `· ${p.city}, ${p.state}` : ''}
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:16, alignItems:'center', flexShrink:0 }}>
                      <div style={{ textAlign:'center' }}>
                        <div style={{ fontSize:16, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#1565C0' }}>{pEnc.length}</div>
                        <div style={{ fontSize:9, color:'var(--gray)' }}>touchpoints</div>
                      </div>
                      <div style={{ textAlign:'center' }}>
                        <div style={{ fontSize:16, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#065F46' }}>{refCount}</div>
                        <div style={{ fontSize:9, color:'var(--gray)' }}>referrals</div>
                      </div>
                      <div style={{ display:'flex', gap:6 }}>
                        <button onClick={ev => { ev.stopPropagation(); setOutreachProvider(p); setOutreachUntargeted(false); }}
                          style={{ fontSize:11, fontWeight:600, color:'#065F46', background:'#ECFDF5', border:'1px solid #A7F3D0', borderRadius:6, padding:'4px 10px', cursor:'pointer' }}>
                          + Log Outreach
                        </button>
                        <button onClick={ev => { ev.stopPropagation(); setEditProvider(p); setShowProviderModal(true); }}
                          style={{ fontSize:11, color:'var(--gray)', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:6, padding:'4px 10px', cursor:'pointer' }}>
                          Edit
                        </button>
                        {canDeleteContactOrProvider() && p.is_active !== false && (
                          <button onClick={ev => { ev.stopPropagation(); setPendingDelete({ type:'provider', record: p }); }}
                            style={{ fontSize:11, color:'#DC2626', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:6, padding:'4px 10px', cursor:'pointer' }}>
                            Delete
                          </button>
                        )}
                      </div>
                      <span style={{ fontSize:14, color:'var(--gray)' }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ borderTop:'1px solid var(--border)', background:'var(--bg)', padding:'14px 18px' }}>
                      {p.notes && <div style={{ fontSize:12, color:'var(--gray)', marginBottom:12, fontStyle:'italic' }}>{p.notes}</div>}

                      {/* Contacts at this provider */}
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                        <div style={{ fontSize:12, fontWeight:700 }}>Contacts ({pPeople.length})</div>
                        <button onClick={() => { setEditPerson(null); setPersonProvider(p); }}
                          style={{ fontSize:11, fontWeight:600, color:'#1565C0', background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:6, padding:'3px 8px', cursor:'pointer' }}>
                          + Add Contact
                        </button>
                      </div>
                      {pPeople.length === 0 ? (
                        <div style={{ fontSize:11, color:'var(--gray)', fontStyle:'italic', marginBottom:10 }}>No contacts on file yet.</div>
                      ) : pPeople.map(pp => (
                        <div key={pp.id} style={{ display:'flex', gap:10, padding:'8px 10px', background:'var(--card-bg)', borderRadius:6, border:'1px solid var(--border)', marginBottom:5, alignItems:'flex-start', opacity: pp.is_active === false ? 0.55 : 1 }}>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:12, fontWeight:600 }}>
                              {pp.name}{pp.title?` · ${pp.title}`:''}
                              {pp.is_primary?<span style={{ marginLeft:6, fontSize:9, fontWeight:700, color:'#065F46', background:'#ECFDF5', padding:'1px 6px', borderRadius:999 }}>Primary</span>:null}
                              {pp.is_active === false ? <span style={{ marginLeft:6, fontSize:9, fontWeight:700, color:'#92400E', background:'#FEF3C7', padding:'1px 6px', borderRadius:999 }}>Inactive</span> : null}
                            </div>
                            <div style={{ fontSize:11, color:'var(--gray)' }}>{pp.phone || ''} {pp.email ? `· ${pp.email}` : ''}</div>
                            {pp.notes && (
                              <div style={{ fontSize:11, color:'var(--gray)', fontStyle:'italic', marginTop:4, lineHeight:1.4, whiteSpace:'pre-wrap' }}>
                                {pp.notes}
                              </div>
                            )}
                          </div>
                          <div style={{ display:'flex', flexDirection:'column', gap:4, flexShrink:0 }}>
                            <button onClick={() => { setEditPerson(pp); setPersonProvider(p); }}
                              style={{ fontSize:10, color:'var(--gray)', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:5, padding:'3px 8px', cursor:'pointer' }}>Edit</button>
                            {canDeleteContactOrProvider() && pp.is_active !== false && (
                              <button onClick={() => setPendingDelete({ type:'contact', record: pp })}
                                style={{ fontSize:10, color:'#DC2626', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:5, padding:'3px 8px', cursor:'pointer' }}>Delete</button>
                            )}
                          </div>
                        </div>
                      ))}

                      {/* Outreach history */}
                      <div style={{ fontSize:12, fontWeight:700, marginTop:12, marginBottom:6 }}>Outreach History ({pEnc.length})</div>
                      {pEnc.length === 0 ? (
                        <div style={{ fontSize:11, color:'var(--gray)', fontStyle:'italic' }}>No outreach logged yet. Click "+ Log Outreach" above.</div>
                      ) : pEnc.slice(0, 10).map(enc => {
                        const outc = OUTCOME_RATINGS.find(o => o.key === enc.outcome_rating);
                        return (
                          <div key={enc.id} style={{ display:'flex', gap:10, padding:'7px 10px', background:'var(--card-bg)', borderRadius:6, border:'1px solid var(--border)', marginBottom:5, alignItems:'flex-start' }}>
                            <div style={{ fontSize:10, fontFamily:'DM Mono, monospace', color:'var(--gray)', flexShrink:0, marginTop:1, minWidth:74 }}>{fmtDate(enc.encounter_date)}</div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:11, fontWeight:600 }}>{OUTREACH_LABEL[enc.outreach_type] || enc.encounter_type} {'·'} <span style={{ color:'var(--gray)', fontWeight:400 }}>by {enc.conducted_by}</span></div>
                              {enc.summary && <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>{enc.summary}</div>}
                              {enc.follow_up_date && <div style={{ fontSize:10, color:'#D97706', marginTop:2 }}>Follow-up: {fmtDate(enc.follow_up_date)}</div>}
                            </div>
                            {outc && <span style={{ fontSize:9, fontWeight:700, color:outc.color, background:outc.bg, padding:'2px 7px', borderRadius:999, flexShrink:0 }}>{outc.label}</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── ALL CONTACTS ── (Phase 2c — 2026-05-30) */}
        {activeTab === 'contacts' && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <input value={contactSearchQ} onChange={e => setContactSearchQ(e.target.value)}
                placeholder="Search name, title, phone, email, provider, notes..."
                style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)', width:300 }} />
              <span style={{ marginLeft:'auto', fontSize:11, color:'var(--gray)' }}>
                {filteredContactPeople.length} contact{filteredContactPeople.length === 1 ? '' : 's'} shown
              </span>
              <button onClick={() => setShowQuickContactModal(true)}
                style={{ fontSize:12, fontWeight:700, color:'#fff', background:'#1565C0', border:'none', borderRadius:6, padding:'6px 12px', cursor:'pointer' }}>
                + Add Contact
              </button>
            </div>

            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
              {filteredContactPeople.length === 0 ? (
                <div style={{ padding:40, textAlign:'center', color:'var(--gray)', fontSize:13 }}>
                  No contacts match your filters.
                </div>
              ) : (
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr style={{ background:'var(--bg)' }}>
                      {[
                        ['name',     'Contact'],
                        ['title',    'Title'],
                        ['provider', 'Provider'],
                        ['region',   'Region'],
                        ['last',     'Last Outreach'],
                      ].map(([k, label]) => {
                        const active = contactSortKey === k;
                        return (
                          <th key={k} onClick={() => {
                            if (contactSortKey === k) setContactSortDir(d => d === 'asc' ? 'desc' : 'asc');
                            else { setContactSortKey(k); setContactSortDir('asc'); }
                          }}
                            style={{ textAlign:'left', fontSize:10, fontWeight:700, color:active?'var(--black)':'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', padding:'10px 14px', borderBottom:'1px solid var(--border)', cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' }}>
                            {label} {active ? (contactSortDir === 'asc' ? '▲' : '▼') : ''}
                          </th>
                        );
                      })}
                      <th style={{ textAlign:'right', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContactPeople.map((pp, i) => {
                      const isOpen = expandedContact === pp.id;
                      const prov = pp._provider;
                      const lastEnc = pp._lastEncounter;
                      return (
                        <Fragment key={pp.id}>
                          <tr onClick={() => setExpandedContact(isOpen ? null : pp.id)}
                            style={{ background: pp.is_active === false ? '#FEF9F0' : (i%2===0 ? 'var(--card-bg)' : 'var(--bg)'), cursor:'pointer', borderTop:'1px solid var(--border)', opacity: pp.is_active === false ? 0.7 : 1 }}>
                            <td style={{ padding:'10px 14px', verticalAlign:'top' }}>
                              <div style={{ fontSize:12, fontWeight:600, color:'var(--black)' }}>
                                {pp.name}
                                {pp.is_primary ? <span style={{ marginLeft:6, fontSize:9, fontWeight:700, color:'#065F46', background:'#ECFDF5', padding:'1px 6px', borderRadius:999 }}>Primary</span> : null}
                                {pp.is_active === false ? <span style={{ marginLeft:6, fontSize:9, fontWeight:700, color:'#92400E', background:'#FEF3C7', padding:'1px 6px', borderRadius:999 }}>Inactive</span> : null}
                              </div>
                              <div style={{ fontSize:10, color:'var(--gray)', marginTop:2 }}>
                                {pp.phone || ''}{pp.phone && pp.email ? ' · ' : ''}{pp.email || ''}
                              </div>
                            </td>
                            <td style={{ padding:'10px 14px', fontSize:11, color:'var(--black)', verticalAlign:'top' }}>{pp.title || <span style={{ color:'var(--gray)' }}>—</span>}</td>
                            <td style={{ padding:'10px 14px', fontSize:11, color:'var(--black)', verticalAlign:'top' }}>{prov?.practice_name || <span style={{ color:'var(--gray)' }}>—</span>}</td>
                            <td style={{ padding:'10px 14px', fontSize:11, color:'var(--gray)', verticalAlign:'top' }}>{pp.region || prov?.region || '—'}</td>
                            <td style={{ padding:'10px 14px', fontSize:11, color:'var(--gray)', verticalAlign:'top' }}>{lastEnc ? fmtDate(lastEnc.encounter_date) : <span style={{ fontStyle:'italic' }}>None</span>}</td>
                            <td onClick={ev => ev.stopPropagation()} style={{ padding:'10px 14px', textAlign:'right', verticalAlign:'top' }}>
                              <div style={{ display:'inline-flex', gap:4 }}>
                                <button onClick={() => { setEditPerson(pp); setPersonProvider(prov || { id: pp.provider_id, practice_name: '—', region: pp.region }); }}
                                  style={{ fontSize:10, color:'var(--gray)', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:5, padding:'3px 8px', cursor:'pointer' }}>Edit</button>
                                {canDeleteContactOrProvider() && pp.is_active !== false && (
                                  <button onClick={() => setPendingDelete({ type:'contact', record: pp })}
                                    style={{ fontSize:10, color:'#DC2626', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:5, padding:'3px 8px', cursor:'pointer' }}>Delete</button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr style={{ background: pp.is_active === false ? '#FEF9F0' : 'var(--bg)' }}>
                              <td colSpan={6} style={{ padding:'14px 18px', borderTop:'1px dashed var(--border)' }}>
                                <div style={{ display:'grid', gridTemplateColumns:'minmax(0, 2fr) minmax(0, 1fr)', gap:18 }}>
                                  <div>
                                    <div style={{ fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>Notes</div>
                                    <div style={{ fontSize:12, color:'var(--black)', lineHeight:1.5, whiteSpace:'pre-wrap', fontStyle: pp.notes ? 'normal' : 'italic' }}>
                                      {pp.notes || 'No notes on file. Click Edit to add.'}
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>Recent outreach (last 5)</div>
                                    {(() => {
                                      const recent = encounters
                                        .filter(e => e.contact_person_id === pp.id || e.contact_id === pp.provider_id)
                                        .sort((a,b) => (b.encounter_date||'').localeCompare(a.encounter_date||''))
                                        .slice(0, 5);
                                      if (recent.length === 0) {
                                        return <div style={{ fontSize:11, color:'var(--gray)', fontStyle:'italic' }}>No outreach logged.</div>;
                                      }
                                      return recent.map(enc => {
                                        const outc = OUTCOME_RATINGS.find(o => o.key === enc.outcome_rating);
                                        return (
                                          <div key={enc.id} style={{ display:'flex', gap:8, alignItems:'flex-start', padding:'4px 0', borderBottom:'1px dotted var(--border)' }}>
                                            <div style={{ fontSize:10, fontFamily:'DM Mono, monospace', color:'var(--gray)', minWidth:70 }}>{fmtDate(enc.encounter_date)}</div>
                                            <div style={{ flex:1, fontSize:11 }}>
                                              <span style={{ fontWeight:600 }}>{OUTREACH_LABEL[enc.outreach_type] || enc.encounter_type}</span>
                                              {enc.summary && <span style={{ color:'var(--gray)' }}> · {enc.summary}</span>}
                                            </div>
                                            {outc && <span style={{ fontSize:9, fontWeight:700, color:outc.color, background:outc.bg, padding:'1px 6px', borderRadius:999, flexShrink:0 }}>{outc.label}</span>}
                                          </div>
                                        );
                                      });
                                    })()}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── FOLLOW-UPS ── */}
        {activeTab === 'followups' && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {followUpsOverdue.length > 0 && (
              <div style={{ background:'#FEF2F2', border:'2px solid #FECACA', borderRadius:10, padding:'12px 16px' }}>
                <div style={{ fontSize:13, fontWeight:700, color:'#DC2626' }}>
                  {followUpsOverdue.length} follow-up{followUpsOverdue.length>1?'s':''} overdue
                </div>
              </div>
            )}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'12px 18px', borderBottom:'1px solid var(--border)', fontSize:13, fontWeight:700 }}>Pending Follow-Ups</div>
              {filteredEncounters.filter(e => e.follow_up_date && !e.follow_up_completed).length === 0 ? (
                <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>No pending follow-ups in your filtered scope.</div>
              ) : filteredEncounters.filter(e => e.follow_up_date && !e.follow_up_completed)
                  .sort((a,b) => (a.follow_up_date||'').localeCompare(b.follow_up_date||''))
                  .map((e, i) => {
                const prov = providers.find(p => p.id === e.contact_id);
                const overdue = e.follow_up_date < todayStr;
                const rep = reps.find(r => r.id === e.rep_id);
                return (
                  <div key={e.id} style={{ display:'flex', gap:14, padding:'12px 18px', borderBottom:'1px solid var(--border)', background: overdue ? '#FFF5F5' : i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'flex-start' }}>
                    <div style={{ fontSize:11, fontFamily:'DM Mono, monospace', color: overdue?'#DC2626':'var(--gray)', fontWeight:overdue?700:400, flexShrink:0, marginTop:2, minWidth:80 }}>
                      {overdue ? '* ' : ''}{fmtDate(e.follow_up_date)}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:600 }}>{prov?.practice_name || e.target_clinic_or_school || 'Untargeted'}</div>
                      <div style={{ fontSize:11, color:'var(--gray)' }}>
                        {OUTREACH_LABEL[e.outreach_type] || e.encounter_type} on {fmtDate(e.encounter_date)} {'·'} by {rep?.full_name || e.conducted_by}
                      </div>
                      {e.follow_up_notes && <div style={{ fontSize:12, color:'var(--black)', marginTop:3 }}>{e.follow_up_notes}</div>}
                      {e.follow_up_actions && <div style={{ fontSize:11, color:'#1565C0', marginTop:2 }}>Action: {e.follow_up_actions}</div>}
                    </div>
                    <button onClick={async () => {
                        await supabase.from('marketing_encounters').update({ follow_up_completed: true }).eq('id', e.id);
                        logActivity({
                          coordinatorId: profile?.id, coordinatorName: profile?.full_name, coordinatorRole: profile?.role,
                          actionType: 'marketing_follow_up_completed',
                          actionDetail: `${prov?.practice_name || 'Untargeted'} - ${e.follow_up_notes || OUTREACH_LABEL[e.outreach_type]}`,
                          tableName: 'marketing_encounters', recordId: e.id,
                          metadata: { region: e.region },
                        });
                        load();
                      }}
                      style={{ fontSize:11, fontWeight:600, color:'#065F46', background:'#ECFDF5', border:'1px solid #A7F3D0', borderRadius:6, padding:'4px 10px', cursor:'pointer', flexShrink:0 }}>
                      Mark Done
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── REPORTS ── */}
        {activeTab === 'reports' && (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {/* Weekly trend, last 8 Sun-Sat weeks */}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:'14px 18px' }}>
              <div style={{ fontSize:13, fontWeight:700, marginBottom:10 }}>Weekly Activity (last 8 weeks, Sun-Sat)</div>
              <div style={{ display:'flex', alignItems:'flex-end', gap:6, height:140 }}>
                {trendByWeek.map(b => {
                  const max = Math.max(1, ...trendByWeek.map(x => x.total));
                  const h = Math.round(100 * b.total / max);
                  const sh = b.total ? Math.round(100 * b.successful / max) : 0;
                  return (
                    <div key={b.week} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                      <div style={{ width:'100%', display:'flex', flexDirection:'column-reverse', height:100, background:'var(--bg)', borderRadius:5, position:'relative' }}>
                        <div style={{ width:'100%', height:`${h}%`, background:'#1565C0', borderRadius:'0 0 5px 5px' }} />
                        <div style={{ position:'absolute', bottom:0, left:0, right:0, height:`${sh}%`, background:'#065F46', borderRadius:'0 0 5px 5px' }} />
                      </div>
                      <div style={{ fontSize:10, color:'var(--gray)' }}>{b.week.slice(5)}</div>
                      <div style={{ fontSize:11, fontFamily:'DM Mono, monospace', fontWeight:700 }}>{b.total}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display:'flex', gap:14, marginTop:8, fontSize:11, color:'var(--gray)' }}>
                <span><span style={{ display:'inline-block', width:10, height:10, background:'#1565C0', marginRight:4, verticalAlign:'middle' }} /> Total</span>
                <span><span style={{ display:'inline-block', width:10, height:10, background:'#065F46', marginRight:4, verticalAlign:'middle' }} /> Successful</span>
              </div>
            </div>

            {/* Provider relationship depth (top 50 by touchpoints) */}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'12px 18px', borderBottom:'1px solid var(--border)', fontSize:13, fontWeight:700 }}>Provider Relationship Depth (top 50)</div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'var(--bg)' }}>
                      {['Provider','Type','Region','Payer','Touchpoints','Successful','Referrals','Last Contact','Next Follow-Up'].map(h => (
                        <th key={h} style={{ textAlign:'left', padding:'8px 12px', fontSize:11, color:'var(--gray)', fontWeight:600, borderBottom:'1px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {providerDepth.map(d => (
                      <tr key={d.provider.id} style={{ borderBottom:'1px solid var(--border)' }}>
                        <td style={{ padding:'8px 12px', fontWeight:600 }}>{d.provider.practice_name}</td>
                        <td style={{ padding:'8px 12px' }}>{d.provider.contact_type}</td>
                        <td style={{ padding:'8px 12px' }}>{d.provider.region || '—'}</td>
                        <td style={{ padding:'8px 12px' }}>{d.provider.primary_insurance || '—'}</td>
                        <td style={{ padding:'8px 12px', fontFamily:'DM Mono, monospace', fontWeight:700 }}>{d.touchpoints}</td>
                        <td style={{ padding:'8px 12px', fontFamily:'DM Mono, monospace', color:'#065F46' }}>{d.successful}</td>
                        <td style={{ padding:'8px 12px', fontFamily:'DM Mono, monospace' }}>{d.refCount}</td>
                        <td style={{ padding:'8px 12px', color:'var(--gray)' }}>{d.lastContact ? fmtDate(d.lastContact) : '—'}</td>
                        <td style={{ padding:'8px 12px', color:'#D97706' }}>{d.nextFollowUp ? fmtDate(d.nextFollowUp) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Project rollups */}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'12px 18px', borderBottom:'1px solid var(--border)', fontSize:13, fontWeight:700 }}>Special Project Rollups</div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:'var(--bg)' }}>
                    {['Project','Total Outreach','Successful','Follow-Ups Open','Status'].map(h => (
                      <th key={h} style={{ textAlign:'left', padding:'8px 12px', fontSize:11, color:'var(--gray)', fontWeight:600, borderBottom:'1px solid var(--border)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {projectRollups.map(r => (
                    <tr key={r.project.id} style={{ borderBottom:'1px solid var(--border)' }}>
                      <td style={{ padding:'8px 12px', fontWeight:600 }}>{r.project.name}</td>
                      <td style={{ padding:'8px 12px', fontFamily:'DM Mono, monospace' }}>{r.total}</td>
                      <td style={{ padding:'8px 12px', fontFamily:'DM Mono, monospace', color:'#065F46' }}>{r.successful}</td>
                      <td style={{ padding:'8px 12px', fontFamily:'DM Mono, monospace', color:r.followUpsOpen>0?'#D97706':'var(--gray)' }}>{r.followUpsOpen}</td>
                      <td style={{ padding:'8px 12px' }}>
                        <span style={{ fontSize:10, fontWeight:700, color:r.project.is_active?'#065F46':'var(--gray)', background:r.project.is_active?'#ECFDF5':'var(--bg)', padding:'2px 8px', borderRadius:999 }}>
                          {r.project.is_active ? 'Active' : 'Archived'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── PROJECTS ADMIN ── */}
        {activeTab === 'admin' && isAdminTier && (
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 18px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontSize:13, fontWeight:700 }}>Special Projects {'·'} {specialProjects.length}</div>
              <button onClick={() => { setEditProject(null); setShowProjectModal(true); }}
                style={{ padding:'6px 12px', background:'#1565C0', color:'#fff', border:'none', borderRadius:6, fontSize:12, fontWeight:700, cursor:'pointer' }}>
                + New Project
              </button>
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'var(--bg)' }}>
                  {['Name','Description','Started','Ended','Active','Outreach Count',''].map(h => (
                    <th key={h} style={{ textAlign:'left', padding:'8px 12px', fontSize:11, color:'var(--gray)', fontWeight:600, borderBottom:'1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {specialProjects.map(s => {
                  const cnt = encounters.filter(e => e.special_project_id === s.id).length;
                  return (
                    <tr key={s.id} style={{ borderBottom:'1px solid var(--border)' }}>
                      <td style={{ padding:'8px 12px', fontWeight:600 }}>{s.name}</td>
                      <td style={{ padding:'8px 12px', color:'var(--gray)' }}>{s.description || '—'}</td>
                      <td style={{ padding:'8px 12px' }}>{s.started_at ? fmtDate(s.started_at) : '—'}</td>
                      <td style={{ padding:'8px 12px' }}>{s.ended_at ? fmtDate(s.ended_at) : '—'}</td>
                      <td style={{ padding:'8px 12px' }}>{s.is_active ? 'Yes' : 'No'}</td>
                      <td style={{ padding:'8px 12px', fontFamily:'DM Mono, monospace' }}>{cnt}</td>
                      <td style={{ padding:'8px 12px' }}>
                        <button onClick={() => { setEditProject(s); setShowProjectModal(true); }}
                          style={{ fontSize:11, color:'var(--gray)', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:5, padding:'3px 10px', cursor:'pointer' }}>Edit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {showProviderModal && (
        <ProviderModal provider={editProvider}
          onClose={() => { setShowProviderModal(false); setEditProvider(null); }}
          onSaved={() => { setShowProviderModal(false); setEditProvider(null); load(); }}
          profile={profile} repsForAssignment={reps} />
      )}
      {personProvider && (
        <ContactPersonModal provider={personProvider} person={editPerson}
          onClose={() => { setPersonProvider(null); setEditPerson(null); }}
          onSaved={() => { setPersonProvider(null); setEditPerson(null); load(); }}
          profile={profile} />
      )}
      {(outreachProvider || outreachUntargeted) && (
        <OutreachModal provider={outreachProvider}
          contactPeopleAll={people} specialProjects={specialProjects}
          onClose={() => { setOutreachProvider(null); setOutreachUntargeted(false); }}
          onSaved={() => { setOutreachProvider(null); setOutreachUntargeted(false); load(); }}
          profile={profile} />
      )}
      {editEncounter && (
        <OutreachModal provider={providers.find(p => p.id === editEncounter.contact_id) || null}
          encounter={editEncounter}
          contactPeopleAll={people} specialProjects={specialProjects}
          onClose={() => setEditEncounter(null)}
          onSaved={() => { setEditEncounter(null); load(); }}
          profile={profile} />
      )}
      {showQuickContactModal && (
        <ContactQuickAddModal providers={providers}
          onClose={() => setShowQuickContactModal(false)}
          onSaved={() => { setShowQuickContactModal(false); load(); }}
          profile={profile} />
      )}
      {showProjectModal && (
        <SpecialProjectModal project={editProject}
          onClose={() => { setShowProjectModal(false); setEditProject(null); }}
          onSaved={() => { setShowProjectModal(false); setEditProject(null); load(); }}
          profile={profile} />
      )}
      {pendingDelete && (
        <ConfirmDeleteModal
          title={
            pendingDelete.type === 'provider' ? 'Deactivate Provider?' :
            pendingDelete.type === 'contact'  ? 'Deactivate Contact?'  :
                                                'Delete Outreach Event?'
          }
          message={(() => {
            const r = pendingDelete.record;
            if (pendingDelete.type === 'provider') {
              const cnt = people.filter(pp => pp.provider_id === r.id && pp.is_active !== false).length;
              const eCnt = encounters.filter(e => e.contact_id === r.id).length;
              return `"${r.practice_name}" will be marked inactive (soft delete). ${cnt} contact${cnt===1?'':'s'} and ${eCnt} outreach event${eCnt===1?'':'s'} stay on file for attribution and historical reporting. You can restore by toggling "Show inactive" and editing.`;
            }
            if (pendingDelete.type === 'contact') {
              const prov = providers.find(p => p.id === r.provider_id);
              return `"${r.name}"${prov?` at ${prov.practice_name}`:''} will be marked inactive (soft delete). Historical outreach attribution stays intact.`;
            }
            const prov = providers.find(p => p.id === r.contact_id);
            return `Permanently delete the ${OUTREACH_LABEL[r.outreach_type] || 'outreach'} event from ${fmtDate(r.encounter_date)}${prov?` at ${prov.practice_name}`:''}? This cannot be undone, but the audit record stays in the coordinator activity log.`;
          })()}
          confirmLabel={pendingDelete.type === 'outreach' ? 'Delete' : 'Deactivate'}
          onCancel={() => setPendingDelete(null)}
          onConfirm={async () => {
            if (pendingDelete.type === 'provider') await softDeleteProvider(pendingDelete.record);
            else if (pendingDelete.type === 'contact') await softDeleteContact(pendingDelete.record);
            else await hardDeleteOutreach(pendingDelete.record);
          }}
        />
      )}
    </div>
  );
}
