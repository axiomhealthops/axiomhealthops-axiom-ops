import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

const REGIONS = ['A','B','C','G','H','I','J','M','N','T','V'];
const INSURANCES = ['Humana','CarePlus','FHCP','Devoted','Health First','Aetna','Medicare','Simply','Cigna','United Healthcare','Other'];
const REFERRAL_TYPES = ['New Referral','Re-Referral','Continuation'];
const STATUSES = ['Pending','Accepted','Denied','On Hold'];
const CHART_STATUSES = ['Chart Pending','Chart Received','Chart Incomplete','Ready for Auth'];

export default function ManualIntakeEntry({ onClose, onSaved }) {
  const { profile } = useAuth();
  const today = new Date().toISOString().slice(0,10);

  const [form, setForm] = useState({
    date_received: today,
    referral_status: 'Pending',
    referral_type: 'New Referral',
    region: '',
    // Patient
    patient_name: '',
    dob: '',
    contact_number: '',
    phone: '',
    location: '',
    city: '',
    zip_code: '',
    county: '',
    // Insurance
    insurance: '',
    policy_number: '',
    medicare_type: '',
    secondary_insurance: '',
    secondary_id: '',
    // Clinical
    diagnosis: '',
    denial_reason: '',
    // Referral Source
    referral_source: '',
    referral_source_phone: '',
    referral_source_fax: '',
    // PCP
    pcp_name: '',
    pcp_phone: '',
    pcp_fax: '',
    // Status
    chart_status: 'Chart Pending',
    census_status: '',
    welcome_call: '',
    first_appt: '',
    notes: '',
  });

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [step, setStep] = useState(1); // 1=Patient, 2=Insurance, 3=Clinical, 4=Source/PCP

  function set(key, val) { setForm(p => ({ ...p, [key]: val })); }

  function validate() {
    const e = {};
    if (!form.patient_name.trim()) e.patient_name = 'Required';
    if (!form.region) e.region = 'Required';
    if (!form.insurance) e.insurance = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) { setStep(1); return; }
    setSaving(true);
    const payload = { ...form, diagnosis_clean: form.diagnosis?.split('(')[0]?.trim() };
    const { error } = await supabase.from('intake_referrals').insert(payload);
    setSaving(false);
    if (error) { setErrors({ submit: error.message }); return; }
    onSaved?.();
    onClose?.();
  }

  const F = ({ label, children, err }) => (
    <div>
      <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>
        {label}{err && <span style={{ color:'#DC2626', marginLeft:4 }}>— {err}</span>}
      </div>
      {children}
    </div>
  );
  const I = (props) => (
    <input {...props} style={{ width:'100%', padding:'8px 10px', border:`1px solid ${errors[props.name]?'#DC2626':'var(--border)'}`, borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', background:'var(--card-bg)', ...props.style }} />
  );
  const S = ({ name, opts, ...props }) => (
    <select name={name} value={form[name]} onChange={e => set(name, e.target.value)} {...props}
      style={{ width:'100%', padding:'8px 10px', border:`1px solid ${errors[name]?'#DC2626':'var(--border)'}`, borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', ...props.style }}>
      <option value="">— Select —</option>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  const stepTitles = ['Patient Info','Insurance','Clinical','Referral Source & PCP'];
  const totalSteps = 4;

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'var(--card-bg)', borderRadius:16, width:'100%', maxWidth:700, maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
        {/* Header */}
        <div style={{ padding:'20px 24px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:17, fontWeight:700, color:'var(--black)' }}>New Referral Entry</div>
            <div style={{ fontSize:12, color:'var(--gray)', marginTop:2 }}>Step {step} of {totalSteps} — {stepTitles[step-1]}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'var(--gray)', lineHeight:1 }}>×</button>
        </div>

        {/* Progress */}
        <div style={{ display:'flex', padding:'0 24px', borderBottom:'1px solid var(--border)' }}>
          {stepTitles.map((t,i) => (
            <button key={i} onClick={() => setStep(i+1)}
              style={{ flex:1, padding:'10px 4px', border:'none', background:'none', fontSize:11, fontWeight:step===i+1?700:400, color:step===i+1?'var(--red)':step>i+1?'#065F46':'var(--gray)', borderBottom:step===i+1?'2px solid var(--red)':step>i+1?'2px solid #10B981':'2px solid transparent', cursor:'pointer' }}>
              {step > i+1 ? '✓ ' : ''}{t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:'auto', padding:24 }}>
          {errors.submit && <div style={{ background:'#FEF2F2', border:'1px solid #FCA5A5', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:12, color:'#DC2626' }}>{errors.submit}</div>}

          {/* STEP 1: Patient */}
          {step === 1 && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <div style={{ gridColumn:'span 2' }}>
                <F label="Patient Name *" err={errors.patient_name}>
                  <I name="patient_name" value={form.patient_name} onChange={e => set('patient_name', e.target.value)} placeholder="Last, First" />
                </F>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, gridColumn:'span 2' }}>
                <F label="Date Received *"><I type="date" name="date_received" value={form.date_received} onChange={e => set('date_received', e.target.value)} /></F>
                <F label="Status"><S name="referral_status" opts={STATUSES} /></F>
                <F label="Referral Type"><S name="referral_type" opts={REFERRAL_TYPES} /></F>
              </div>
              <F label="Date of Birth"><I type="date" name="dob" value={form.dob} onChange={e => set('dob', e.target.value)} /></F>
              <F label="Phone Number"><I name="phone" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(555) 000-0000" /></F>
              <F label="Region *" err={errors.region}>
                <select value={form.region} onChange={e => set('region', e.target.value)}
                  style={{ width:'100%', padding:'8px 10px', border:`1px solid ${errors.region?'#DC2626':'var(--border)'}`, borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                  <option value="">— Select Region —</option>
                  {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
                </select>
              </F>
              <F label="County"><I name="county" value={form.county} onChange={e => set('county', e.target.value)} /></F>
              <F label="City"><I name="city" value={form.city} onChange={e => set('city', e.target.value)} /></F>
              <F label="Zip Code"><I name="zip_code" value={form.zip_code} onChange={e => set('zip_code', e.target.value)} /></F>
              <div style={{ gridColumn:'span 2' }}>
                <F label="Full Address"><I name="location" value={form.location} onChange={e => set('location', e.target.value)} placeholder="Street address" /></F>
              </div>
            </div>
          )}

          {/* STEP 2: Insurance */}
          {step === 2 && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <F label="Primary Insurance *" err={errors.insurance}>
                <S name="insurance" opts={INSURANCES} />
              </F>
              <F label="Policy / Member ID"><I name="policy_number" value={form.policy_number} onChange={e => set('policy_number', e.target.value)} /></F>
              <F label="Medicare Type (if applicable)">
                <select value={form.medicare_type} onChange={e => set('medicare_type', e.target.value)}
                  style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                  <option value="">— None / N/A —</option>
                  {['Part A','Part B','Part C (Medicare Advantage)','Part D','Medicare + Medicaid'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </F>
              <F label="Secondary Insurance"><I name="secondary_insurance" value={form.secondary_insurance} onChange={e => set('secondary_insurance', e.target.value)} /></F>
              <div style={{ gridColumn:'span 2' }}>
                <F label="Secondary Insurance ID"><I name="secondary_id" value={form.secondary_id} onChange={e => set('secondary_id', e.target.value)} /></F>
              </div>
              <F label="Chart Status"><S name="chart_status" opts={CHART_STATUSES} /></F>
              <F label="Census Status"><I name="census_status" value={form.census_status} onChange={e => set('census_status', e.target.value)} /></F>
              <F label="Welcome Call Completed"><I name="welcome_call" value={form.welcome_call} onChange={e => set('welcome_call', e.target.value)} placeholder="Date or 'No'" /></F>
              <F label="First Appointment"><I name="first_appt" value={form.first_appt} onChange={e => set('first_appt', e.target.value)} placeholder="Date or 'Pending'" /></F>
            </div>
          )}

          {/* STEP 3: Clinical */}
          {step === 3 && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:14 }}>
              <F label="Diagnosis / ICD Code">
                <textarea value={form.diagnosis} onChange={e => set('diagnosis', e.target.value)}
                  placeholder="e.g. Lymphedema of lower extremity (I89.0)"
                  style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:80, background:'var(--card-bg)' }} />
              </F>
              <F label="Denial Reason (if applicable)">
                <textarea value={form.denial_reason} onChange={e => set('denial_reason', e.target.value)}
                  placeholder="Leave blank if not denied"
                  style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:60, background:'var(--card-bg)' }} />
              </F>
              <F label="Internal Notes">
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                  placeholder="Any additional intake notes…"
                  style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:80, background:'var(--card-bg)' }} />
              </F>
            </div>
          )}

          {/* STEP 4: Source & PCP */}
          {step === 4 && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <div style={{ gridColumn:'span 2', fontSize:13, fontWeight:700, color:'var(--black)', paddingBottom:4, borderBottom:'1px solid var(--border)', marginBottom:4 }}>Referral Source</div>
              <F label="Referral Source Name"><I name="referral_source" value={form.referral_source} onChange={e => set('referral_source', e.target.value)} placeholder="Hospital, clinic, physician…" /></F>
              <F label="Referral Source Phone"><I name="referral_source_phone" value={form.referral_source_phone} onChange={e => set('referral_source_phone', e.target.value)} /></F>
              <F label="Referral Source Fax"><I name="referral_source_fax" value={form.referral_source_fax} onChange={e => set('referral_source_fax', e.target.value)} /></F>
              <div />

              <div style={{ gridColumn:'span 2', fontSize:13, fontWeight:700, color:'var(--black)', paddingBottom:4, borderBottom:'1px solid var(--border)', marginTop:8, marginBottom:4 }}>Primary Care Physician</div>
              <F label="PCP Name"><I name="pcp_name" value={form.pcp_name} onChange={e => set('pcp_name', e.target.value)} /></F>
              <F label="PCP Phone"><I name="pcp_phone" value={form.pcp_phone} onChange={e => set('pcp_phone', e.target.value)} /></F>
              <F label="PCP Fax"><I name="pcp_fax" value={form.pcp_fax} onChange={e => set('pcp_fax', e.target.value)} /></F>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'16px 24px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'var(--bg)' }}>
          <button onClick={() => setStep(s => Math.max(1, s-1))} disabled={step===1}
            style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:step===1?'not-allowed':'pointer', opacity:step===1?0.4:1 }}>
            ← Previous
          </button>
          <div style={{ display:'flex', gap:8 }}>
            {step < totalSteps ? (
              <button onClick={() => setStep(s => Math.min(totalSteps, s+1))}
                style={{ padding:'8px 20px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                Next →
              </button>
            ) : (
              <button onClick={handleSave} disabled={saving}
                style={{ padding:'8px 24px', background:'var(--red)', color:'#fff', border:'none', borderRadius:7, fontSize:14, fontWeight:700, cursor:saving?'wait':'pointer' }}>
                {saving ? 'Saving…' : '✓ Submit Referral'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
