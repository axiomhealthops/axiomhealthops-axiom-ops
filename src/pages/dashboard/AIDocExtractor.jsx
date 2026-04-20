import { useState, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

const EXTRACTION_MODES = {
  intake: {
    label: 'Referral / Intake',
    icon: '📥',
    color: '#1565C0',
    bg: '#EFF6FF',
    description: 'Extract patient demographics, insurance, diagnosis, PCP, and referral source from a referral document.',
    systemPrompt: `You are a medical document data extraction specialist for a home health LYMPHEDEMA therapy company.
Extract ALL of the following fields from the referral/intake document provided. Return ONLY valid JSON with these exact keys.
If a field is not found, use null. Do not invent data.

DIAGNOSIS EXTRACTION — CRITICAL FOR TRIAGE:
  The intake team needs ICD-10 codes identified explicitly. Look carefully for:
  - I89.0 (Lymphedema, not elsewhere classified) — PRIMARY ACCEPT-CRITERIA CODE
  - I97.2 (Postmastectomy lymphedema syndrome)
  - Q82.0 (Hereditary lymphedema)
  - R60.0 / R60.1 / R60.9 (Localized / generalized / unspecified edema)
  - L97.x (Non-pressure chronic ulcer — wound care, flag SWIFT team)
  - L89.x (Pressure ulcer — wound care, flag SWIFT team)
  - E11.621 / E11.622 (Diabetic foot ulcer — wound care, flag SWIFT team)
  Preserve the exact ICD code in the diagnosis string so downstream triage can parse it.

INSURANCE — CRITICAL FOR ACCEPTANCE AND PAYOR TRACKING:
  The following payors are commonly accepted: Humana, CarePlus, Cigna, Aetna, FHCP, Devoted, Simply, Medicare, BlueCross/BlueShield, United Healthcare. Normalize the carrier name to one of these canonical forms when possible (e.g. "Humana Gold" → "Humana", "Cigna HealthSpring" → "Cigna").
  IMPORTANT: If the insurance does NOT match any of the above, preserve the ACTUAL insurance carrier name exactly as written on the document. Do NOT use "Other" — we need the real carrier name for payor opportunity analysis (e.g. "Molina", "WellCare", "Bright Health", "Oscar", etc.).

{
  "patient_name": "Last, First format if possible",
  "dob": "YYYY-MM-DD format",
  "phone": "phone number",
  "address": "street address",
  "city": "city",
  "zip_code": "zip",
  "county": "county if present",
  "insurance": "insurance carrier name (canonical form — Humana, CarePlus, Aetna, etc.)",
  "policy_number": "member/policy ID number",
  "secondary_insurance": "secondary insurance if present",
  "diagnosis": "ALL diagnoses found with ICD-10 code(s), separated by semicolons. CRITICAL: If the referral mentions lymphedema (I89.0, I97.2, Q82.0) ANYWHERE in the document — even if other diagnoses like CHF, Hypertension, Diabetes etc. are also present — lymphedema MUST be listed FIRST. Example: 'I89.0 Lymphedema; I50.9 Congestive Heart Failure; I10 Hypertension'. Never omit lymphedema in favor of secondary diagnoses.",
  "icd_codes": "array of ICD-10 codes found, e.g. [\\"I89.0\\", \\"L97.509\\"]",
  "has_lymphedema_dx": "true if any lymphedema code (I89.0, I97.2, Q82.0) is present, else false",
  "has_wound_dx": "true if any wound/ulcer code (L97.x, L89.x, E11.621/622) is present — triggers SWIFT team flag",
  "referral_source": "name of referring hospital/facility/physician",
  "referral_source_phone": "referral source phone",
  "referral_source_fax": "referral source fax",
  "pcp_name": "primary care physician name",
  "pcp_phone": "PCP phone number",
  "pcp_fax": "PCP fax number",
  "referral_type": "New Referral, Continuation, or Resumption of Care. Use 'New Referral' for first-time patients. Use 'Continuation' for existing active patients getting a new referral. Use 'Resumption of Care' for patients previously discharged or on hold 30+ days who are returning.",
  "notes": "any other clinically relevant notes"
}

Return ONLY the JSON object, no markdown, no explanation.`,
  },
  auth: {
    label: 'Authorization Form',
    icon: '🔐',
    color: '#7C3AED',
    bg: '#F5F3FF',
    description: 'Extract auth number, dates, visit counts, and payer details from an authorization letter or form.',
    systemPrompt: `You are a medical authorization document extraction specialist for a home health therapy company.
Extract ALL of the following fields from the authorization document provided. Return ONLY valid JSON with these exact keys.
If a field is not found, use null. Do not invent data.

{
  "patient_name": "patient full name, Last First format if possible",
  "dob": "YYYY-MM-DD",
  "member_id": "insurance member/policy ID",
  "insurance": "insurance carrier name (Humana, CarePlus, Aetna, FHCP, Medicare, etc.)",
  "insurance_type": "IMPORTANT — Classify the insurance plan type. Look at the FULL plan name, product description, and any mentions of PPO, HMO, Medicare, Medicaid on the document. Use one of: 'ppo' (any PPO/Preferred Provider Organization plan — e.g. Aetna PPO, Cigna PPO, BCBS PPO), 'hmo' (HMO plans), 'medicare' (original Medicare Part A/B, Medicare Advantage, or any plan with 'Medicare' in name), 'medicaid' (Medicaid/state plans), 'standard' (commercial plans that require auth and are NOT PPO). If unsure, use 'standard'.",
  "auth_number": "authorization number",
  "auth_status": "Approved or Denied or Pending",
  "visits_authorized": "number of visits authorized (integer)",
  "auth_start_date": "YYYY-MM-DD",
  "auth_expiry_date": "YYYY-MM-DD",
  "therapy_type": "type of therapy authorized",
  "frequency": "visit frequency (e.g. 2x/week)",
  "pcp_name": "primary care physician name",
  "pcp_phone": "PCP phone",
  "pcp_fax": "PCP fax",
  "denial_reason": "denial reason if denied",
  "notes": "any other relevant authorization details"
}

Return ONLY the JSON object, no markdown, no explanation.`,
  },
};

function FieldRow({ label, value, editable, onChange }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'140px 1fr', gap:8, marginBottom:6, alignItems:'center' }}>
      <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', textAlign:'right', paddingRight:8 }}>{label}</div>
      {editable ? (
        <input value={value||''} onChange={e => onChange(e.target.value)}
          style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:5, fontSize:12, outline:'none', background:'var(--card-bg)', width:'100%', boxSizing:'border-box' }} />
      ) : (
        <div style={{ fontSize:12, color: value ? 'var(--black)' : 'var(--gray)', fontStyle: value ? 'normal' : 'italic' }}>
          {value || '— not found —'}
        </div>
      )}
    </div>
  );
}

export default function AIDocExtractor({ mode = 'intake', onExtracted, onClose }) {
  const cfg = EXTRACTION_MODES[mode];
  const fileRef = useRef();
  const [file, setFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState(null);
  const [editedData, setEditedData] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadPath, setUploadPath] = useState(null);

  // Defensive escape — if a save error or network hang leaves the modal
  // showing an unrecoverable state, users can always Esc out instead of
  // being trapped looking for the × button. Disabled while extracting
  // or saving so an in-flight request isn't silently abandoned.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !extracting && !saving) onClose?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, extracting, saving]);

  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 52428800) { setError('File too large — max 50MB'); return; }
    setFile(f);
    setExtracted(null);
    setEditedData(null);
    setError('');
    setSaved(false);
  }

  async function handleExtract() {
    if (!file) return;
    setExtracting(true);
    setError('');
    setExtracted(null);
    setEditedData(null);

    try {
      // Convert file to base64
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result.split(',')[1]);
        reader.onerror = () => rej(new Error('File read failed'));
        reader.readAsDataURL(file);
      });

      const isImage = file.type.startsWith('image/');
      const isPDF = file.type === 'application/pdf';

      const contentBlocks = [];

      if (isPDF) {
        contentBlocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        });
      } else if (isImage) {
        contentBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: file.type, data: base64 },
        });
      } else {
        // Try as text
        const text = await file.text();
        contentBlocks.push({ type: 'text', text });
      }

      contentBlocks.push({ type: 'text', text: 'Extract the data from this document and return ONLY the JSON object.' });

      // Call the Supabase Edge Function that proxies Anthropic.
      // Direct browser calls to api.anthropic.com fail (CORS + API key
      // exposure). The function lives at supabase/functions/extract-document
      // and requires ANTHROPIC_API_KEY set as a project secret.
      const { data, error: fnError } = await supabase.functions.invoke('extract-document', {
        body: {
          systemPrompt: cfg.systemPrompt,
          contentBlocks,
          max_tokens: 2048,
        },
      });

      if (fnError) {
        // supabase.functions.invoke wraps non-2xx as error with a message
        throw new Error(fnError.message || 'Extraction service unreachable');
      }
      if (data?.error) throw new Error(data.error);

      const text = data?.content?.find(b => b.type === 'text')?.text || '';

      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Could not parse extraction result. The document may not be readable.');

      const parsed = JSON.parse(jsonMatch[0]);
      setExtracted(parsed);
      setEditedData({ ...parsed });
    } catch (err) {
      setError(err.message || 'Extraction failed. Please try again.');
    }
    setExtracting(false);
  }

  async function handleSaveToSupabase() {
    if (!editedData) return;
    setSaving(true);

    try {
      // Upload file to storage first
      let filePath = uploadPath;
      if (file && !filePath) {
        const today = new Date().toISOString().slice(0,10);
        const safeName = (editedData.patient_name||'unknown').replace(/[^a-zA-Z0-9]/g,'_');
        const ext = file.name.split('.').pop();
        const bucket = mode === 'intake' ? 'referral-documents' : 'auth-documents';
        const path = `${mode}/${today}/${safeName}_${Date.now()}.${ext}`;
        const { data: up } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
        if (up?.path) filePath = up.path;
        setUploadPath(filePath);
      }

      if (mode === 'intake') {
        const payload = {
          date_received: new Date().toISOString().slice(0,10),
          patient_name: editedData.patient_name || null,
          dob: editedData.dob || null,
          phone: editedData.phone || null,
          contact_number: editedData.phone || null,
          location: editedData.address || null,
          city: editedData.city || null,
          zip_code: editedData.zip_code || null,
          county: editedData.county || null,
          insurance: editedData.insurance || null,
          policy_number: editedData.policy_number || null,
          secondary_insurance: editedData.secondary_insurance || null,
          diagnosis: editedData.diagnosis || null,
          diagnosis_clean: editedData.diagnosis?.split('(')[0]?.trim() || null,
          referral_source: editedData.referral_source || null,
          referral_source_phone: editedData.referral_source_phone || null,
          referral_source_fax: editedData.referral_source_fax || null,
          pcp_name: editedData.pcp_name || null,
          pcp_phone: editedData.pcp_phone || null,
          pcp_fax: editedData.pcp_fax || null,
          referral_type: editedData.referral_type || 'New Referral',
          referral_status: 'Pending',
          notes: editedData.notes || null,
          referral_document_path: filePath || null,
          referral_document_name: file?.name || null,
        };
        const { error: dbErr } = await supabase.from('intake_referrals').upsert(payload, { onConflict: 'patient_name,date_received' });
        if (dbErr) throw new Error(dbErr.message);
      } else {
        // Auth mode — save to auth_tracker
        const patientName = editedData.patient_name || null;

        // Detect whether this is a renewal: does this patient already have an active auth?
        var isRenewal = false;
        if (patientName) {
          const { data: existingAuths } = await supabase.from('auth_tracker')
            .select('id, auth_number')
            .ilike('patient_name', patientName.trim())
            .in('auth_status', ['active', 'pending', 'submitted', 'renewal_needed'])
            .limit(1);
          isRenewal = existingAuths && existingAuths.length > 0;
        }

        // --- Insurance-type heuristic fallback ---
        // If the AI didn't extract insurance_type (or defaulted to null),
        // infer from the carrier name + any plan keywords in the extracted fields.
        let inferredInsType = editedData.insurance_type;
        if (!inferredInsType || inferredInsType === 'standard') {
          const haystack = `${editedData.insurance || ''} ${editedData.notes || ''} ${editedData.therapy_type || ''}`.toLowerCase();
          if (/\bppo\b|preferred\s*provider/i.test(haystack))   inferredInsType = 'ppo';
          else if (/\bmedicare\b|medicare\s*advantage/i.test(haystack)) inferredInsType = 'medicare';
          else if (/\bmedicaid\b/i.test(haystack))              inferredInsType = 'medicaid';
          else if (/\bhmo\b/i.test(haystack))                   inferredInsType = 'hmo';
          else inferredInsType = editedData.insurance_type || 'standard';
        }

        const payload = {
          patient_name: patientName,
          dob: editedData.dob || null,
          member_id: editedData.member_id || null,
          insurance: editedData.insurance || 'Unknown',
          insurance_type: inferredInsType,
          auth_number: editedData.auth_number || null,
          auth_status: editedData.auth_status || 'pending',
          visits_authorized: parseInt(editedData.visits_authorized) || 24,
          visits_used: 0,
          soc_date: editedData.auth_start_date || null,
          auth_expiry_date: editedData.auth_expiry_date || null,
          auth_approved_date: editedData.auth_approved_date || null,
          therapy_type: editedData.therapy_type || 'LYMPHEDEMA',
          frequency: editedData.frequency || null,
          pcp_name: editedData.pcp_name || null,
          pcp_phone: editedData.pcp_phone || null,
          pcp_fax: editedData.pcp_fax || null,
          denial_reason: editedData.denial_reason || null,
          notes: editedData.notes || null,
          request_type: isRenewal ? 'renewal' : 'initial',
          request_category: isRenewal ? 'renewal' : 'initial',
        };
        const { data: authRow, error: dbErr } = await supabase.from('auth_tracker').insert(payload).select('id').single();
        if (dbErr) throw new Error(dbErr.message);

        // Save document to auth_documents if file uploaded
        if (filePath && authRow?.id) {
          await supabase.from('auth_documents').insert({
            auth_tracker_id: authRow.id,
            file_name: file.name,
            file_path: filePath,
            file_size: file.size,
            doc_type: 'auth',
            uploaded_by: 'AI Extractor',
          });
        }

        // Recompute auth sequence for this patient — chains predecessor → successor,
        // locks visits on the renewal until predecessor is exhausted, and updates
        // is_currently_active + effective_visits_remaining across all auths.
        if (patientName) {
          await supabase.rpc('recompute_auth_sequence', { p_patient_name: patientName });
        }
      }

      setSaved(true);
      onExtracted?.(editedData);
    } catch (err) {
      setError('Save failed: ' + err.message);
    }
    setSaving(false);
  }

  function setField(key, val) {
    setEditedData(p => ({ ...p, [key]: val }));
  }

  const intakeFields = [
    ['patient_name','Patient Name'],['dob','Date of Birth'],['phone','Phone'],
    ['address','Address'],['city','City'],['zip_code','Zip'],['county','County'],
    ['insurance','Insurance'],['policy_number','Policy Number'],['secondary_insurance','Secondary Insurance'],
    ['diagnosis','Diagnosis'],['referral_type','Referral Type'],
    ['referral_source','Referral Source'],['referral_source_phone','Source Phone'],['referral_source_fax','Source Fax'],
    ['pcp_name','PCP Name'],['pcp_phone','PCP Phone'],['pcp_fax','PCP Fax'],
    ['notes','Notes'],
  ];

  const authFields = [
    ['patient_name','Patient Name'],['dob','Date of Birth'],['member_id','Member ID'],
    ['insurance','Insurance'],['auth_number','Auth Number'],['auth_status','Auth Status'],
    ['visits_authorized','Visits Authorized'],['auth_start_date','Auth Start Date'],
    ['auth_expiry_date','Auth Expiry Date'],['therapy_type','Therapy Type'],
    ['frequency','Frequency'],['pcp_name','PCP Name'],['pcp_phone','PCP Phone'],['pcp_fax','PCP Fax'],
    ['denial_reason','Denial Reason'],['notes','Notes'],
  ];

  const fields = mode === 'intake' ? intakeFields : authFields;
  const filledCount = editedData ? fields.filter(([k]) => editedData[k]).length : 0;

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget && !extracting && !saving) onClose?.(); }}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ background:'var(--card-bg)', borderRadius:16, width:'100%', maxWidth:760, maxHeight:'92vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 60px rgba(0,0,0,0.35)' }}>

        {/* Header */}
        <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', background:cfg.bg, borderRadius:'16px 16px 0 0' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ fontSize:28 }}>{cfg.icon}</div>
            <div>
              <div style={{ fontSize:16, fontWeight:700, color:cfg.color }}>AI Document Extractor — {cfg.label}</div>
              <div style={{ fontSize:12, color:'var(--gray)', marginTop:2 }}>{cfg.description}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'var(--gray)' }}>×</button>
        </div>

        <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:0 }}>
          {/* Upload section */}
          <div style={{ padding:20, borderBottom:'1px solid var(--border)' }}>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor=cfg.color; }}
              onDragLeave={e => { e.currentTarget.style.borderColor='var(--border)'; }}
              onDrop={e => {
                e.preventDefault(); e.currentTarget.style.borderColor='var(--border)';
                const f = e.dataTransfer.files[0];
                if (f) handleFileChange({ target: { files: [f] } });
              }}
              style={{ border:'2px dashed var(--border)', borderRadius:10, padding:'20px 24px', textAlign:'center', cursor:'pointer', background:'var(--bg)', transition:'border-color 0.15s' }}>
              {file ? (
                <div>
                  <div style={{ fontSize:24, marginBottom:6 }}>📎</div>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--black)' }}>{file.name}</div>
                  <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>{(file.size/1024/1024).toFixed(2)} MB · Click to replace</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize:24, marginBottom:6 }}>📄</div>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--black)' }}>Upload document to extract data</div>
                  <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>PDF, JPG, PNG, TIFF · max 50MB · Drag & drop or click</div>
                </div>
              )}
              <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.tiff" onChange={handleFileChange} style={{ display:'none' }} />
            </div>

            {file && !extracted && (
              <button onClick={handleExtract} disabled={extracting}
                style={{ marginTop:12, width:'100%', padding:'11px 0', background:cfg.color, color:'#fff', border:'none', borderRadius:8, fontSize:14, fontWeight:700, cursor:extracting?'wait':'pointer', opacity:extracting?0.8:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                {extracting ? (
                  <><span style={{ display:'inline-block', width:14, height:14, border:'2px solid rgba(255,255,255,0.4)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} /> Extracting data with AI…</>
                ) : (
                  <>{cfg.icon} Extract Data with AI</>
                )}
              </button>
            )}

            {error && (
              <div style={{ marginTop:10, padding:'10px 14px', background:'#FEF2F2', border:'1px solid #FCA5A5', borderRadius:8, fontSize:12, color:'#DC2626' }}>{error}</div>
            )}
          </div>

          {/* Extracted results */}
          {editedData && (
            <div style={{ padding:20 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--black)' }}>Extracted Data — Review & Edit</div>
                  <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>
                    {filledCount} of {fields.length} fields extracted · Edit any field before saving
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {/* Confidence bar */}
                  <div style={{ fontSize:11, color:'var(--gray)' }}>Confidence</div>
                  <div style={{ width:80, height:6, background:'var(--border)', borderRadius:999 }}>
                    <div style={{ height:'100%', width:`${Math.round(filledCount/fields.length*100)}%`, background:filledCount/fields.length>=0.7?'#10B981':'#D97706', borderRadius:999 }} />
                  </div>
                  <div style={{ fontSize:11, fontWeight:700, color:filledCount/fields.length>=0.7?'#065F46':'#D97706' }}>{Math.round(filledCount/fields.length*100)}%</div>
                </div>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 20px' }}>
                {fields.map(([key, label]) => (
                  <FieldRow key={key} label={label} value={editedData[key]} editable onChange={v => setField(key, v)} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {editedData && (
          <div style={{ padding:'14px 24px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'var(--bg)' }}>
            <div style={{ fontSize:12, color:'var(--gray)' }}>
              {saved ? <span style={{ color:'#065F46', fontWeight:700 }}>✓ Saved to Supabase successfully</span> : 'Review extracted fields, edit as needed, then save to database'}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              {!saved && (
                <>
                  <button onClick={() => { setFile(null); setExtracted(null); setEditedData(null); setError(''); }}
                    style={{ padding:'8px 14px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>
                    Re-upload
                  </button>
                  <button onClick={handleSaveToSupabase} disabled={saving}
                    style={{ padding:'8px 20px', background:cfg.color, color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:saving?'wait':'pointer' }}>
                    {saving ? 'Saving…' : `✓ Save to ${mode === 'intake' ? 'Intake' : 'Auth Tracker'}`}
                  </button>
                </>
              )}
              {saved && (
                <button onClick={onClose}
                  style={{ padding:'8px 20px', background:'#065F46', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  Done ✓
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
