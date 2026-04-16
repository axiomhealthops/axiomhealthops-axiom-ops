import { useState, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import AIDocExtractor from './AIDocExtractor';

const REGIONS = ['A','B','C','G','H','I','J','M','N','T','V'];
const INSURANCES = ['Humana','CarePlus','FHCP','Devoted','Health First','Aetna','Medicare','Simply','Cigna','United Healthcare','Other'];
const REFERRAL_TYPES = ['New Referral','Re-Referral','Continuation'];
const STATUSES = ['Pending','Accepted','Denied','On Hold'];
const CHART_STATUSES = ['Chart Pending','Chart Received','Chart Incomplete','Ready for Auth'];

export default // Module-scope field helpers. Previously defined inside the component body,
// which caused React to unmount/remount every <input>/<select> on each keystroke
// (new component reference per render) — resulting in focus loss after every
// character. Critical for Hervylie's intake workflow.
function F({ label, children, err }) {
  return (
    <div>
      <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>
        {label}{err && <span style={{ color:'#DC2626', marginLeft:4 }}>— {err}</span>}
      </div>
      {children}
    </div>
  );
}
function I({ name, value, onChange, err, ...props }) {
  return (
    <input name={name} value={value||''} onChange={e => onChange(name, e.target.value)} {...props}
      style={{ width:'100%', padding:'8px 10px', border:`1px solid ${err?'#DC2626':'var(--border)'}`, borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', background:'var(--card-bg)', ...props.style }} />
  );
}
function S({ name, value, onChange, err, opts, ...props }) {
  return (
    <select name={name} value={value||''} onChange={e => onChange(name, e.target.value)} {...props}
      style={{ width:'100%', padding:'8px 10px', border:`1px solid ${err?'#DC2626':'var(--border)'}`, borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)', ...props.style }}>
      <option value="">— Select —</option>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function ManualIntakeEntry({ onClose, onSaved }) {
  const { profile } = useAuth();
  const today = new Date().toISOString().slice(0,10);
  const fileRef = useRef();

  const [form, setForm] = useState({
    date_received: today, referral_status: 'Pending', referral_type: 'New Referral', region: '',
    patient_name: '', dob: '', contact_number: '', phone: '', location: '', city: '', zip_code: '', county: '',
    insurance: '', policy_number: '', medicare_type: '', secondary_insurance: '', secondary_id: '',
    diagnosis: '', denial_reason: '', referral_source: '', referral_source_phone: '', referral_source_fax: '',
    pcp_name: '', pcp_phone: '', pcp_fax: '', chart_status: 'Chart Pending',
    census_status: '', welcome_call: '', first_appt: '', notes: '',
  });

  const [file, setFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [step, setStep] = useState(1);
  const [showAI, setShowAI] = useState(false);

  // Defensive escape hatch — if anything in the modal ever gets stuck (save
  // error, network hang, stale state), users can always Esc out. Skip the
  // handler while the AI extractor is open so its own Esc doesn't double-fire.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !showAI && !saving) onClose?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showAI, saving]);

  function set(key, val) { setForm(p => ({ ...p, [key]: val })); }

  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 52428800) { setErrors(p => ({ ...p, file: 'File too large (max 50MB)' })); return; }
    setErrors(p => ({ ...p, file: undefined }));
    setFile(f);
  }

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

    let referral_document_path = null;
    let referral_document_name = null;

    // Upload file first if one is attached
    if (file) {
      const safeName = form.patient_name.replace(/[^a-zA-Z0-9]/g, '_');
      const ext = file.name.split('.').pop();
      const path = `referrals/${today}/${safeName}_${Date.now()}.${ext}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('referral-documents')
        .upload(path, file, { cacheControl: '3600', upsert: false });
      if (uploadErr) {
        setErrors({ submit: 'File upload failed: ' + uploadErr.message });
        setSaving(false);
        return;
      }
      referral_document_path = uploadData.path;
      referral_document_name = file.name;
    }

    const payload = {
      ...form,
      diagnosis_clean: form.diagnosis?.split('(')[0]?.trim(),
      referral_document_path,
      referral_document_name,
    };

    const { error } = await supabase.from('intake_referrals').insert(payload);
    setSaving(false);
    if (error) { setErrors({ submit: error.message }); return; }
    onSaved?.();
    onClose?.();
  }


  const stepTitles = ['Patient Info','Insurance','Clinical','Source & PCP','Documents'];
  const totalSteps = 5;

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget && !saving) onClose?.(); }}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ background:'var(--card-bg)', borderRadius:16, width:'100%', maxWidth:700, maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>

        {/* Header */}
        <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:17, fontWeight:700, color:'var(--black)' }}>New Referral Entry</div>
            <div style={{ fontSize:12, color:'var(--gray)', marginTop:2 }}>Step {step} of {totalSteps} — {stepTitles[step-1]}</div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button onClick={() => setShowAI(true)}
              style={{ padding:'7px 14px', background:'#7C3AED', color:'#fff', border:'none', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
              ✨ AI Extract from Doc
            </button>
            <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'var(--gray)' }}>×</button>
          </div>
        </div>

        {showAI && (
          <AIDocExtractor
            mode="intake"
            onClose={() => setShowAI(false)}
            onExtracted={(data) => {
              // Auto-fill the form with extracted data
              setForm(p => ({
                ...p,
                patient_name: data.patient_name || p.patient_name,
                dob: data.dob || p.dob,
                phone: data.phone || p.phone,
                contact_number: data.phone || p.contact_number,
                location: data.address || p.location,
                city: data.city || p.city,
                zip_code: data.zip_code || p.zip_code,
                county: data.county || p.county,
                insurance: data.insurance || p.insurance,
                policy_number: data.policy_number || p.policy_number,
                secondary_insurance: data.secondary_insurance || p.secondary_insurance,
                diagnosis: data.diagnosis || p.diagnosis,
                referral_source: data.referral_source || p.referral_source,
                referral_source_phone: data.referral_source_phone || p.referral_source_phone,
                referral_source_fax: data.referral_source_fax || p.referral_source_fax,
                pcp_name: data.pcp_name || p.pcp_name,
                pcp_phone: data.pcp_phone || p.pcp_phone,
                pcp_fax: data.pcp_fax || p.pcp_fax,
                referral_type: data.referral_type || p.referral_type,
                notes: data.notes || p.notes,
              }));
              setShowAI(false);
            }}
          />
        )}

        {/* Progress tabs */}
        <div style={{ display:'flex', padding:'0 24px', borderBottom:'1px solid var(--border)', overflowX:'auto' }}>
          {stepTitles.map((t,i) => (
            <button key={i} onClick={() => setStep(i+1)}
              style={{ flex:'0 0 auto', padding:'10px 12px', border:'none', background:'none', fontSize:11, fontWeight:step===i+1?700:400, color:step===i+1?'var(--red)':step>i+1?'#065F46':'var(--gray)', borderBottom:step===i+1?'2px solid var(--red)':step>i+1?'2px solid #10B981':'2px solid transparent', cursor:'pointer', whiteSpace:'nowrap' }}>
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
                  <I name="patient_name" value={form.patient_name} onChange={set} err={errors.patient_name} placeholder="Last, First" />
                </F>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, gridColumn:'span 2' }}>
                <F label="Date Received *"><I name="date_received" value={form.date_received} onChange={set} err={errors.date_received} type="date" /></F>
                <F label="Status"><S name="referral_status" value={form.referral_status} onChange={set} err={errors.referral_status} opts={STATUSES} /></F>
                <F label="Referral Type"><S name="referral_type" value={form.referral_type} onChange={set} err={errors.referral_type} opts={REFERRAL_TYPES} /></F>
              </div>
              <F label="Date of Birth"><I name="dob" value={form.dob} onChange={set} err={errors.dob} type="date" /></F>
              <F label="Phone Number"><I name="phone" value={form.phone} onChange={set} err={errors.phone} placeholder="(555) 000-0000" /></F>
              <F label="Region *" err={errors.region}>
                <select value={form.region} onChange={e => set('region', e.target.value)}
                  style={{ width:'100%', padding:'8px 10px', border:`1px solid ${errors.region?'#DC2626':'var(--border)'}`, borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                  <option value="">— Select Region —</option>
                  {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
                </select>
              </F>
              <F label="County"><I name="county" value={form.county} onChange={set} err={errors.county} /></F>
              <F label="City"><I name="city" value={form.city} onChange={set} err={errors.city} /></F>
              <F label="Zip Code"><I name="zip_code" value={form.zip_code} onChange={set} err={errors.zip_code} /></F>
              <div style={{ gridColumn:'span 2' }}>
                <F label="Full Address"><I name="location" value={form.location} onChange={set} err={errors.location} placeholder="Street address" /></F>
              </div>
            </div>
          )}

          {/* STEP 2: Insurance */}
          {step === 2 && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <F label="Primary Insurance *" err={errors.insurance}><S name="insurance" value={form.insurance} onChange={set} err={errors.insurance} opts={INSURANCES} /></F>
              <F label="Policy / Member ID"><I name="policy_number" value={form.policy_number} onChange={set} err={errors.policy_number} /></F>
              <F label="Medicare Type">
                <select value={form.medicare_type} onChange={e => set('medicare_type', e.target.value)}
                  style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                  <option value="">— None / N/A —</option>
                  {['Part A','Part B','Part C (Medicare Advantage)','Part D','Medicare + Medicaid'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </F>
              <F label="Secondary Insurance"><I name="secondary_insurance" value={form.secondary_insurance} onChange={set} err={errors.secondary_insurance} /></F>
              <F label="Secondary ID"><I name="secondary_id" value={form.secondary_id} onChange={set} err={errors.secondary_id} /></F>
              <F label="Chart Status"><S name="chart_status" value={form.chart_status} onChange={set} err={errors.chart_status} opts={CHART_STATUSES} /></F>
              <F label="Census Status"><I name="census_status" value={form.census_status} onChange={set} err={errors.census_status} /></F>
              <F label="Welcome Call"><I name="welcome_call" value={form.welcome_call} onChange={set} err={errors.welcome_call} placeholder="Date or 'No'" /></F>
              <F label="First Appointment"><I name="first_appt" value={form.first_appt} onChange={set} err={errors.first_appt} placeholder="Date or 'Pending'" /></F>
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
              <div style={{ gridColumn:'span 2', fontSize:13, fontWeight:700, color:'var(--black)', paddingBottom:4, borderBottom:'1px solid var(--border)' }}>Referral Source</div>
              <F label="Source Name"><I name="referral_source" value={form.referral_source} onChange={set} err={errors.referral_source} placeholder="Hospital, clinic, physician…" /></F>
              <F label="Source Phone"><I name="referral_source_phone" value={form.referral_source_phone} onChange={set} err={errors.referral_source_phone} /></F>
              <F label="Source Fax"><I name="referral_source_fax" value={form.referral_source_fax} onChange={set} err={errors.referral_source_fax} /></F>
              <div />
              <div style={{ gridColumn:'span 2', fontSize:13, fontWeight:700, color:'var(--black)', paddingBottom:4, borderBottom:'1px solid var(--border)', marginTop:8 }}>Primary Care Physician</div>
              <F label="PCP Name"><I name="pcp_name" value={form.pcp_name} onChange={set} err={errors.pcp_name} /></F>
              <F label="PCP Phone"><I name="pcp_phone" value={form.pcp_phone} onChange={set} err={errors.pcp_phone} /></F>
              <F label="PCP Fax"><I name="pcp_fax" value={form.pcp_fax} onChange={set} err={errors.pcp_fax} /></F>
            </div>
          )}

          {/* STEP 5: Documents */}
          {step === 5 && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div style={{ fontSize:14, fontWeight:600, color:'var(--black)' }}>Attach Referral Document</div>
              <div style={{ fontSize:13, color:'var(--gray)', lineHeight:1.6 }}>
                Upload the original referral from the PCP or hospital. Accepted formats: PDF, JPG, PNG, TIFF, DOC, DOCX (max 50MB).
              </div>

              {/* Drop zone */}
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor='var(--red)'; e.currentTarget.style.background='#FEF2F2'; }}
                onDragLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--bg)'; }}
                onDrop={e => {
                  e.preventDefault();
                  e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--bg)';
                  const f = e.dataTransfer.files[0];
                  if (f) { const fakeEvt = { target: { files: [f] } }; handleFileChange(fakeEvt); }
                }}
                style={{ border:'2px dashed var(--border)', borderRadius:12, padding:'32px 24px', textAlign:'center', cursor:'pointer', background:'var(--bg)', transition:'all 0.15s' }}>
                <div style={{ fontSize:32, marginBottom:12 }}>📄</div>
                {file ? (
                  <>
                    <div style={{ fontSize:14, fontWeight:700, color:'#065F46', marginBottom:4 }}>✓ {file.name}</div>
                    <div style={{ fontSize:12, color:'var(--gray)' }}>{(file.size / 1024 / 1024).toFixed(2)} MB · Click to replace</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize:14, fontWeight:600, color:'var(--black)', marginBottom:4 }}>Click to upload or drag & drop</div>
                    <div style={{ fontSize:12, color:'var(--gray)' }}>PDF, JPG, PNG, TIFF, DOC, DOCX · max 50MB</div>
                  </>
                )}
                <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.tiff,.doc,.docx" onChange={handleFileChange} style={{ display:'none' }} />
              </div>

              {errors.file && (
                <div style={{ fontSize:12, color:'#DC2626', fontWeight:600 }}>⚠ {errors.file}</div>
              )}

              {file && (
                <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', background:'#ECFDF5', border:'1px solid #10B981', borderRadius:8 }}>
                  <span style={{ fontSize:20 }}>📎</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:'#065F46' }}>{file.name}</div>
                    <div style={{ fontSize:11, color:'#065F46' }}>{(file.size / 1024 / 1024).toFixed(2)} MB — will be uploaded on submit</div>
                  </div>
                  <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value=''; }}
                    style={{ background:'none', border:'none', color:'#DC2626', cursor:'pointer', fontSize:16, lineHeight:1 }}>×</button>
                </div>
              )}

              <div style={{ padding:16, background:'#FEF3C7', border:'1px solid #F59E0B', borderRadius:8, fontSize:12, color:'#92400E' }}>
                <strong>Note:</strong> The referral document will be securely stored and linked to this patient's record. You can also upload documents later from the Patient Census profile.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'16px 24px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'var(--bg)' }}>
          <button onClick={() => setStep(s => Math.max(1, s-1))} disabled={step===1}
            style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:step===1?'not-allowed':'pointer', opacity:step===1?0.4:1 }}>
            ← Previous
          </button>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {step === 5 && !file && (
              <span style={{ fontSize:12, color:'var(--gray)' }}>No document attached (optional)</span>
            )}
            {step < totalSteps ? (
              <button onClick={() => setStep(s => s+1)}
                style={{ padding:'8px 20px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                Next →
              </button>
            ) : (
              <button onClick={handleSave} disabled={saving}
                style={{ padding:'8px 24px', background:'var(--red)', color:'#fff', border:'none', borderRadius:7, fontSize:14, fontWeight:700, cursor:saving?'wait':'pointer' }}>
                {saving ? (file ? 'Uploading & Saving…' : 'Saving…') : '✓ Submit Referral'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
