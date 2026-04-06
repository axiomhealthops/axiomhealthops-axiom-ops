import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';

function isCancelled(e,s) { return /cancel/i.test(e||'')||/cancel/i.test(s||''); }
function isEval(e) { return /eval/i.test(e||''); }
function isRA(e) { return /reassess|re-assess|30.day/i.test(e||''); }
function fmtDate(d) { return d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'; }
function daysUntil(d) {
  if (!d) return null;
  return Math.round((new Date(d) - new Date()) / 86400000);
}

function PatientProfile({ patient, visits, authData, intakeData, onClose, onUpdate }) {
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Find the intake record to edit
  const patIntakeRecord = intakeData.find(i =>
    i.patient_name?.toLowerCase().trim() === patient.patient_name?.toLowerCase().trim()
  );

  const latestAuthRecord = authData.filter(a =>
    a.patient_name?.toLowerCase().trim() === patient.patient_name?.toLowerCase().trim()
  ).sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''))[0];

  const [editForm, setEditForm] = useState({
    patient_name: patient.patient_name || '',
    region: patient.region || '',
    insurance: patient.insurance || '',
    status: patient.status || 'active',
    // Intake fields
    phone: patIntakeRecord?.phone || patIntakeRecord?.contact_number || '',
    dob: patIntakeRecord?.dob || '',
    location: patIntakeRecord?.location || '',
    city: patIntakeRecord?.city || '',
    zip_code: patIntakeRecord?.zip_code || '',
    county: patIntakeRecord?.county || '',
    diagnosis: patIntakeRecord?.diagnosis || '',
    pcp_name: patIntakeRecord?.pcp_name || latestAuthRecord?.pcp_name || '',
    pcp_phone: patIntakeRecord?.pcp_phone || latestAuthRecord?.pcp_phone || '',
    pcp_fax: patIntakeRecord?.pcp_fax || latestAuthRecord?.pcp_fax || '',
    pcp_facility: latestAuthRecord?.pcp_facility || '',
    referral_source: patIntakeRecord?.referral_source || '',
    referral_status: patIntakeRecord?.referral_status || '',
    chart_status: patIntakeRecord?.chart_status || '',
    notes: patIntakeRecord?.notes || '',
    // Auth fields (from latest auth record)
    member_id: latestAuthRecord?.member_id || '',
    auth_number: latestAuthRecord?.auth_number || '',
    auth_status: latestAuthRecord?.auth_status || '',
    insurance_type: latestAuthRecord?.insurance_type || '',
    therapy_type: latestAuthRecord?.therapy_type || 'Lymphedema',
    request_type: latestAuthRecord?.request_type || 'Initial',
    frequency: latestAuthRecord?.frequency || '',
    visits_authorized: latestAuthRecord?.visits_authorized || '',
    visits_used: latestAuthRecord?.visits_used || '',
    evals_authorized: latestAuthRecord?.evals_authorized || '',
    evals_used: latestAuthRecord?.evals_used || '',
    reassessments_authorized: latestAuthRecord?.reassessments_authorized || '',
    reassessments_used: latestAuthRecord?.reassessments_used || '',
    soc_date: latestAuthRecord?.soc_date || '',
    auth_submitted_date: latestAuthRecord?.auth_submitted_date || '',
    auth_needed_by: latestAuthRecord?.auth_needed_by || '',
    auth_approved_date: latestAuthRecord?.auth_approved_date || '',
    auth_expiry_date: latestAuthRecord?.auth_expiry_date || '',
    denial_reason: latestAuthRecord?.denial_reason || '',
    auth_notes: latestAuthRecord?.notes || '',
  });

  async function handleSave() {
    setSaving(true);
    setSaveMsg('');
    try {
      // Update census_data
      await supabase.from('census_data').update({
        patient_name: editForm.patient_name,
        region: editForm.region,
        insurance: editForm.insurance,
        status: editForm.status,
      }).eq('id', patient.id);

      // Update intake_referrals if record exists
      if (patIntakeRecord?.id) {
        await supabase.from('intake_referrals').update({
          patient_name: editForm.patient_name,
          region: editForm.region,
          insurance: editForm.insurance,
          phone: editForm.phone,
          contact_number: editForm.phone,
          dob: editForm.dob || null,
          location: editForm.location,
          city: editForm.city,
          zip_code: editForm.zip_code,
          county: editForm.county,
          diagnosis: editForm.diagnosis,
          diagnosis_clean: editForm.diagnosis?.split('(')[0]?.trim(),
          pcp_name: editForm.pcp_name,
          pcp_phone: editForm.pcp_phone,
          pcp_fax: editForm.pcp_fax,
          referral_source: editForm.referral_source,
          referral_status: editForm.referral_status,
          chart_status: editForm.chart_status,
          notes: editForm.notes,
        }).eq('id', patIntakeRecord.id);
      }

      // Update or create auth record
      if (latestAuthRecord?.id) {
        const { error: authError } = await supabase.from('auth_tracker').update({
          member_id: editForm.member_id || null,
          auth_number: editForm.auth_number || null,
          auth_status: editForm.auth_status || null,
          insurance: editForm.insurance,
          insurance_type: editForm.insurance_type || null,
          therapy_type: editForm.therapy_type || null,
          request_type: editForm.request_type || null,
          frequency: editForm.frequency || null,
          visits_authorized: editForm.visits_authorized ? parseInt(editForm.visits_authorized) : null,
          visits_used: editForm.visits_used ? parseInt(editForm.visits_used) : null,
          evals_authorized: editForm.evals_authorized ? parseInt(editForm.evals_authorized) : null,
          evals_used: editForm.evals_used ? parseInt(editForm.evals_used) : null,
          reassessments_authorized: editForm.reassessments_authorized ? parseInt(editForm.reassessments_authorized) : null,
          reassessments_used: editForm.reassessments_used ? parseInt(editForm.reassessments_used) : null,
          soc_date: editForm.soc_date || null,
          auth_submitted_date: editForm.auth_submitted_date || null,
          auth_needed_by: editForm.auth_needed_by || null,
          auth_approved_date: editForm.auth_approved_date || null,
          auth_expiry_date: editForm.auth_expiry_date || null,
          pcp_name: editForm.pcp_name || null,
          pcp_phone: editForm.pcp_phone || null,
          pcp_fax: editForm.pcp_fax || null,
          pcp_facility: editForm.pcp_facility || null,
          denial_reason: editForm.denial_reason || null,
          notes: editForm.auth_notes || null,
          region: editForm.region,
          updated_at: new Date().toISOString(),
        }).eq('id', latestAuthRecord.id);
        if (authError) throw authError;
      } else if (editForm.auth_status || editForm.auth_number || editForm.member_id) {
        // Create a new auth record if key fields are filled
        const { error: authError } = await supabase.from('auth_tracker').insert({
          patient_name: editForm.patient_name,
          region: editForm.region,
          insurance: editForm.insurance,
          member_id: editForm.member_id || null,
          auth_number: editForm.auth_number || null,
          auth_status: editForm.auth_status || 'pending',
          insurance_type: editForm.insurance_type || null,
          therapy_type: editForm.therapy_type || 'Lymphedema',
          request_type: editForm.request_type || 'Initial',
          frequency: editForm.frequency || null,
          visits_authorized: editForm.visits_authorized ? parseInt(editForm.visits_authorized) : null,
          visits_used: editForm.visits_used ? parseInt(editForm.visits_used) : 0,
          evals_authorized: editForm.evals_authorized ? parseInt(editForm.evals_authorized) : null,
          evals_used: editForm.evals_used ? parseInt(editForm.evals_used) : 0,
          reassessments_authorized: editForm.reassessments_authorized ? parseInt(editForm.reassessments_authorized) : null,
          reassessments_used: editForm.reassessments_used ? parseInt(editForm.reassessments_used) : 0,
          soc_date: editForm.soc_date || null,
          auth_submitted_date: editForm.auth_submitted_date || null,
          auth_needed_by: editForm.auth_needed_by || null,
          auth_approved_date: editForm.auth_approved_date || null,
          auth_expiry_date: editForm.auth_expiry_date || null,
          pcp_name: editForm.pcp_name || null,
          pcp_phone: editForm.pcp_phone || null,
          pcp_fax: editForm.pcp_fax || null,
          pcp_facility: editForm.pcp_facility || null,
          denial_reason: editForm.denial_reason || null,
          notes: editForm.auth_notes || null,
          dob: editForm.dob || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        if (authError) throw authError;
      }

      setSaveMsg('✓ Saved successfully');
      setEditing(false);
      onUpdate?.(); // refresh parent
    } catch (err) {
      setSaveMsg('Error: ' + err.message);
    }
    setSaving(false);
  }

  const INSURANCES = ['Humana','CarePlus','FHCP','Devoted','Health First','Aetna','Medicare','Simply','Cigna','United Healthcare','Other'];
  const REGIONS = ['A','B','C','G','H','I','J','M','N','T','V'];
  const E = ({ label, name, type='text', opts }) => (
    <div>
      <div style={{ fontSize:10, fontWeight:600, color:'var(--gray)', marginBottom:3 }}>{label}</div>
      {opts ? (
        <select value={editForm[name]||''} onChange={e => setEditForm(p=>({...p,[name]:e.target.value}))}
          style={{ width:'100%', padding:'6px 8px', border:'1px solid var(--border)', borderRadius:5, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
          <option value="">—</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} value={editForm[name]||''} onChange={e => setEditForm(p=>({...p,[name]:e.target.value}))}
          style={{ width:'100%', padding:'6px 8px', border:'1px solid var(--border)', borderRadius:5, fontSize:12, outline:'none', boxSizing:'border-box', background:'var(--card-bg)' }} />
      )}
    </div>
  );

  // All visits for this patient
  const patVisits = visits.filter(v =>
    v.patient_name?.toLowerCase().trim() === patient.patient_name?.toLowerCase().trim()
  ).sort((a,b) => (b.visit_date||'').localeCompare(a.visit_date||''));

  // Auth records for this patient
  const patAuth = authData.filter(a =>
    a.patient_name?.toLowerCase().trim() === patient.patient_name?.toLowerCase().trim()
  );

  // Intake record
  const patIntake = intakeData.find(i =>
    i.patient_name?.toLowerCase().trim() === patient.patient_name?.toLowerCase().trim()
  );

  // Visit stats (lifetime)
  const evalSeen = new Set();
  let completed=0, cancelled=0, missed=0;
  patVisits.forEach(v => {
    if (isCancelled(v.event_type,v.status)) { cancelled++; return; }
    const dedup = isEval(v.event_type)||isRA(v.event_type);
    if (dedup) {
      const key = `${v.patient_name}||${v.visit_date}`;
      if (evalSeen.has(key)) return;
      evalSeen.add(key);
    }
    if (/completed/i.test(v.status||'')) completed++;
    else if (/missed/i.test(v.status||'')) missed++;
  });

  const latestAuth = patAuth.sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''))[0];
  const visitsRemaining = latestAuth ? (latestAuth.visits_authorized||24) - (latestAuth.visits_used||0) : null;
  const daysToExpiry = latestAuth ? daysUntil(latestAuth.auth_expiry_date) : null;

  const TAB = (t,l) => (
    <button onClick={() => setTab(t)} style={{ padding:'8px 16px', border:'none', background:'none', fontSize:12, fontWeight:tab===t?700:400, color:tab===t?'var(--black)':'var(--gray)', borderBottom:tab===t?'2px solid var(--red)':'2px solid transparent', cursor:'pointer', whiteSpace:'nowrap' }}>
      {l}
    </button>
  );

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'var(--card-bg)', borderRadius:16, width:'100%', maxWidth:780, maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
        {/* Header */}
        <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#0F1117', borderRadius:'16px 16px 0 0' }}>
          <div>
            <div style={{ fontSize:18, fontWeight:700, color:'#fff' }}>{editing ? editForm.patient_name : patient.patient_name}</div>
            <div style={{ fontSize:12, color:'#9CA3AF', marginTop:2 }}>
              Region {patient.region || '—'} · {patient.insurance || '—'} · {patient.status || 'Active'}
            </div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {saveMsg && <span style={{ fontSize:12, color:saveMsg.startsWith('✓')?'#10B981':'#FCA5A5', fontWeight:600 }}>{saveMsg}</span>}
            <button onClick={() => { setEditing(v=>!v); setSaveMsg(''); }}
              style={{ padding:'6px 14px', background:editing?'rgba(255,255,255,0.1)':'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:6, color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer' }}>
              {editing ? 'Cancel' : '✏ Edit Profile'}
            </button>
            <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#9CA3AF' }}>×</button>
          </div>
        </div>

        {/* Edit Panel */}
        {editing && (
          <div style={{ padding:20, background:'#F0F7FF', borderBottom:'1px solid var(--border)' }}>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--black)', marginBottom:12 }}>Edit Patient Information</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:12 }}>
              <E label="Patient Name" name="patient_name" />
              <E label="Region" name="region" opts={REGIONS} />
              <E label="Insurance" name="insurance" opts={INSURANCES} />
              <E label="Status" name="status" opts={['active','inactive','discharged','on_hold']} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:12 }}>
              <E label="Phone" name="phone" />
              <E label="Date of Birth" name="dob" type="date" />
              <E label="City" name="city" />
              <E label="Zip Code" name="zip_code" />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
              <E label="Full Address" name="location" />
              <E label="County" name="county" />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:12 }}>
              <E label="Diagnosis" name="diagnosis" />
              <E label="Referral Status" name="referral_status" opts={['Pending','Accepted','Denied','On Hold']} />
              <E label="Chart Status" name="chart_status" opts={['Chart Pending','Chart Received','Chart Incomplete','Ready for Auth']} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:12 }}>
              <E label="PCP Name" name="pcp_name" />
              <E label="PCP Phone" name="pcp_phone" />
              <E label="PCP Fax" name="pcp_fax" />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
              <E label="Referral Source" name="referral_source" />
              <div>
                <div style={{ fontSize:10, fontWeight:600, color:'var(--gray)', marginBottom:3 }}>Notes</div>
                <textarea value={editForm.notes} onChange={e => setEditForm(p=>({...p,notes:e.target.value}))}
                  style={{ width:'100%', padding:'6px 8px', border:'1px solid var(--border)', borderRadius:5, fontSize:12, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:50, background:'var(--card-bg)' }} />
              </div>
            </div>

            {/* ── AUTHORIZATION SECTION ── */}
            <div style={{ borderTop:'2px solid #1565C0', paddingTop:14, marginBottom:10 }}>
              <div style={{ fontSize:12, fontWeight:800, color:'#1565C0', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                🔐 Authorization
                {!latestAuthRecord && <span style={{ fontSize:10, fontWeight:400, color:'var(--gray)', marginLeft:8, textTransform:'none', letterSpacing:0 }}>No existing auth — fill in fields to create a new record</span>}
                {latestAuthRecord && <span style={{ fontSize:10, fontWeight:400, color:'var(--gray)', marginLeft:8, textTransform:'none', letterSpacing:0 }}>Editing most recent auth record</span>}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:10 }}>
                <E label="Member ID" name="member_id" />
                <E label="Auth Number" name="auth_number" />
                <E label="Auth Status" name="auth_status" opts={['active','pending','approved','denied','expired','cancelled']} />
                <E label="Insurance Type" name="insurance_type" opts={['Standard (24 visits)','HMO','PPO','Medicare Advantage','Medicare Part B','Other']} />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:10 }}>
                <E label="Therapy Type" name="therapy_type" opts={['Lymphedema','Physical Therapy','Occupational Therapy','Speech Therapy','Cardiac','Other']} />
                <E label="Request Type" name="request_type" opts={['Initial','Renewal','Concurrent Review','Retrospective']} />
                <E label="Frequency" name="frequency" />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:10 }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color:'var(--gray)', marginBottom:3 }}>VISIT TRACKING</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                    <E label="Visits Auth." name="visits_authorized" type="number" />
                    <E label="Visits Used" name="visits_used" type="number" />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color:'var(--gray)', marginBottom:3 }}>EVALS</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                    <E label="Auth." name="evals_authorized" type="number" />
                    <E label="Used" name="evals_used" type="number" />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color:'var(--gray)', marginBottom:3 }}>REASSESSMENTS</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                    <E label="Auth." name="reassessments_authorized" type="number" />
                    <E label="Used" name="reassessments_used" type="number" />
                  </div>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, marginBottom:10 }}>
                <E label="SOC Date" name="soc_date" type="date" />
                <E label="Auth Submitted" name="auth_submitted_date" type="date" />
                <E label="Needed By" name="auth_needed_by" type="date" />
                <E label="Auth Approved" name="auth_approved_date" type="date" />
                <E label="Auth Expiry" name="auth_expiry_date" type="date" />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:10 }}>
                <E label="PCP Name" name="pcp_name" />
                <E label="PCP Facility" name="pcp_facility" />
                <E label="PCP Phone" name="pcp_phone" />
                <E label="PCP Fax" name="pcp_fax" />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:4 }}>
                <E label="Denial Reason (if denied)" name="denial_reason" />
                <div>
                  <div style={{ fontSize:10, fontWeight:600, color:'var(--gray)', marginBottom:3 }}>Auth Notes</div>
                  <textarea value={editForm.auth_notes||''} onChange={e => setEditForm(p=>({...p,auth_notes:e.target.value}))}
                    style={{ width:'100%', padding:'6px 8px', border:'1px solid var(--border)', borderRadius:5, fontSize:12, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:44, background:'var(--card-bg)' }} />
                </div>
              </div>
            </div>

            <div style={{ display:'flex', gap:8 }}>
              <button onClick={handleSave} disabled={saving}
                style={{ padding:'8px 20px', background:'var(--red)', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                {saving ? 'Saving…' : '✓ Save Changes'}
              </button>
              <button onClick={() => setEditing(false)} style={{ padding:'8px 14px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Visit stat strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', borderBottom:'1px solid var(--border)' }}>
          {[
            { label:'Completed', val:completed, color:'#065F46', bg:'#ECFDF5' },
            { label:'Cancelled', val:cancelled, color:'#DC2626', bg:'#FEF2F2' },
            { label:'Missed', val:missed, color:'#D97706', bg:'#FEF3C7' },
            { label:'Visits Remaining', val:visitsRemaining !== null ? visitsRemaining : '—', color:visitsRemaining<=5?'#DC2626':visitsRemaining<=10?'#D97706':'#065F46', bg:visitsRemaining<=5?'#FEF2F2':visitsRemaining<=10?'#FEF3C7':'#ECFDF5' },
          ].map(s => (
            <div key={s.label} style={{ padding:'12px 16px', background:s.bg, borderRight:'1px solid var(--border)', textAlign:'center' }}>
              <div style={{ fontSize:24, fontWeight:800, fontFamily:'DM Mono, monospace', color:s.color }}>{s.val}</div>
              <div style={{ fontSize:10, fontWeight:600, color:'var(--gray)', marginTop:2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--border)', padding:'0 24px', overflowX:'auto' }}>
          {TAB('overview','Overview')}
          {TAB('referral','Referral')}
          {TAB('auth','Authorization')}
          {TAB('history','Visit History')}
        </div>

        {/* Tab content */}
        <div style={{ flex:1, overflowY:'auto', padding:24 }}>

          {/* OVERVIEW */}
          {tab === 'overview' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
              <div style={{ background:'var(--bg)', borderRadius:10, padding:16 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--gray)', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.05em' }}>Contact Information</div>
                {[
                  ['Patient Name', patient.patient_name],
                  ['Date of Birth', fmtDate(intakeData.find(i=>i.patient_name===patient.patient_name)?.dob)],
                  ['Phone', patIntake?.contact_number || patIntake?.phone || patient.phone || '—'],
                  ['Address', patIntake?.location || patient.address || '—'],
                  ['City', patIntake?.city || '—'],
                  ['Zip', patIntake?.zip_code || patient.zip || '—'],
                  ['County', patIntake?.county || '—'],
                ].map(([k,v]) => v && v !== '—' ? (
                  <div key={k} style={{ display:'flex', gap:8, marginBottom:6, fontSize:12 }}>
                    <span style={{ color:'var(--gray)', fontWeight:600, minWidth:100, flexShrink:0 }}>{k}:</span>
                    <span style={{ color:'var(--black)' }}>{v}</span>
                  </div>
                ) : null)}
              </div>
              <div style={{ background:'var(--bg)', borderRadius:10, padding:16 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--gray)', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.05em' }}>Current Auth Status</div>
                {latestAuth ? (
                  <>
                    {[
                      ['Auth Number', latestAuth.auth_number || '—'],
                      ['Status', latestAuth.auth_status],
                      ['Insurance', latestAuth.insurance],
                      ['Visits Authorized', latestAuth.visits_authorized],
                      ['Visits Used', latestAuth.visits_used],
                      ['Visits Remaining', visitsRemaining],
                      ['Auth Start', fmtDate(latestAuth.auth_start_date || latestAuth.soc_date)],
                      ['Auth Expiry', fmtDate(latestAuth.auth_expiry_date)],
                    ].map(([k,v]) => (
                      <div key={k} style={{ display:'flex', gap:8, marginBottom:6, fontSize:12 }}>
                        <span style={{ color:'var(--gray)', fontWeight:600, minWidth:110, flexShrink:0 }}>{k}:</span>
                        <span style={{ color:k==='Visits Remaining'&&visitsRemaining<=5?'#DC2626':k==='Auth Expiry'&&daysToExpiry<=7?'#DC2626':'var(--black)', fontWeight:k==='Visits Remaining'||k==='Auth Expiry'?600:400 }}>{v}</span>
                      </div>
                    ))}
                    {daysToExpiry !== null && (
                      <div style={{ marginTop:8, padding:'6px 10px', background:daysToExpiry<=7?'#FEF2F2':daysToExpiry<=14?'#FEF3C7':'#ECFDF5', borderRadius:6, fontSize:11, fontWeight:700, color:daysToExpiry<=7?'#DC2626':daysToExpiry<=14?'#D97706':'#065F46' }}>
                        {daysToExpiry <= 0 ? 'Auth EXPIRED' : `Auth expires in ${daysToExpiry} day${daysToExpiry===1?'':'s'}`}
                      </div>
                    )}
                  </>
                ) : <div style={{ fontSize:12, color:'var(--gray)' }}>No authorization records found.</div>}
              </div>
            </div>
          )}

          {/* REFERRAL */}
          {tab === 'referral' && patIntake && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
              {[
                { title:'Referral Details', fields:[
                  ['Date Received', fmtDate(patIntake.date_received)],
                  ['Status', patIntake.referral_status],
                  ['Referral Type', patIntake.referral_type],
                  ['Region', patIntake.region],
                  ['Denial Reason', patIntake.denial_reason || '—'],
                  ['Chart Status', patIntake.chart_status || '—'],
                ]},
                { title:'Diagnosis & Insurance', fields:[
                  ['Diagnosis', patIntake.diagnosis || '—'],
                  ['Primary Insurance', patIntake.insurance],
                  ['Policy Number', patIntake.policy_number || '—'],
                  ['Medicare Type', patIntake.medicare_type || '—'],
                  ['Secondary Insurance', patIntake.secondary_insurance || '—'],
                ]},
                { title:'Referral Source', fields:[
                  ['Source Name', patIntake.referral_source || '—'],
                  ['Source Phone', patIntake.referral_source_phone || '—'],
                  ['Source Fax', patIntake.referral_source_fax || '—'],
                ]},
                { title:'Primary Care Physician', fields:[
                  ['PCP Name', patIntake.pcp_name || '—'],
                  ['PCP Phone', patIntake.pcp_phone || '—'],
                  ['PCP Fax', patIntake.pcp_fax || '—'],
                ]},
              ].map(section => (
                <div key={section.title} style={{ background:'var(--bg)', borderRadius:10, padding:16 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'var(--gray)', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.05em' }}>{section.title}</div>
                  {section.fields.map(([k,v]) => (
                    <div key={k} style={{ display:'flex', gap:8, marginBottom:6, fontSize:12 }}>
                      <span style={{ color:'var(--gray)', fontWeight:600, minWidth:120, flexShrink:0 }}>{k}:</span>
                      <span style={{ color:'var(--black)' }}>{v}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {tab === 'referral' && !patIntake && (
            <div style={{ color:'var(--gray)', fontSize:13 }}>No referral record found for this patient.</div>
          )}

          {/* AUTHORIZATION */}
          {tab === 'auth' && (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {patAuth.length === 0 ? (
                <div style={{ color:'var(--gray)', fontSize:13 }}>No authorization records found.</div>
              ) : patAuth.map((a, i) => (
                <div key={a.id || i} style={{ background:'var(--bg)', borderRadius:10, padding:16, border:'1px solid var(--border)' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'var(--black)' }}>Auth #{a.auth_number || 'Pending'}</div>
                    <span style={{ fontSize:11, fontWeight:700, color:/active|approved/i.test(a.auth_status||'')?'#065F46':/#pending/i.test(a.auth_status||'')?'#D97706':'#DC2626', background:/active|approved/i.test(a.auth_status||'')?'#ECFDF5':'#FEF3C7', padding:'2px 8px', borderRadius:999 }}>
                      {a.auth_status}
                    </span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                    {[
                      ['Insurance', a.insurance],
                      ['Visits Auth.', a.visits_authorized],
                      ['Visits Used', a.visits_used],
                      ['Remaining', (a.visits_authorized||24)-(a.visits_used||0)],
                      ['Auth Start', fmtDate(a.soc_date || a.auth_start_date)],
                      ['Auth Expiry', fmtDate(a.auth_expiry_date)],
                      ['PCP', a.pcp_name || '—'],
                      ['PCP Phone', a.pcp_phone || '—'],
                      ['Request Type', a.request_type || '—'],
                    ].map(([k,v]) => (
                      <div key={k} style={{ fontSize:12 }}>
                        <div style={{ color:'var(--gray)', fontWeight:600, fontSize:10, marginBottom:2 }}>{k}</div>
                        <div style={{ color:'var(--black)', fontWeight:500 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {/* Utilization bar */}
                  <div style={{ marginTop:12 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--gray)', marginBottom:3 }}>
                      <span>Visit Utilization</span>
                      <span>{a.visits_used||0} / {a.visits_authorized||24}</span>
                    </div>
                    <div style={{ height:6, background:'var(--border)', borderRadius:999 }}>
                      <div style={{ height:'100%', width:Math.min(((a.visits_used||0)/(a.visits_authorized||24))*100,100)+'%', background:'#10B981', borderRadius:999 }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* VISIT HISTORY */}
          {tab === 'history' && (
            <div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr', padding:'8px 12px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', borderRadius:'8px 8px 0 0' }}>
                <span>Date</span><span>Clinician</span><span>Event</span><span>Status</span><span>Discipline</span>
              </div>
              {patVisits.length === 0 ? (
                <div style={{ padding:20, color:'var(--gray)', fontSize:13 }}>No visit history found.</div>
              ) : patVisits.map((v, i) => {
                const isCan = isCancelled(v.event_type,v.status);
                const isComp = /completed/i.test(v.status||'');
                const isMiss = /missed/i.test(v.status||'') && !isCan;
                const statusColor = isComp?'#065F46':isCan?'#DC2626':isMiss?'#D97706':'#1565C0';
                const statusBg = isComp?'#ECFDF5':isCan?'#FEF2F2':isMiss?'#FEF3C7':'#EFF6FF';
                return (
                  <div key={v.id||i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr', padding:'8px 12px', borderBottom:'1px solid var(--border)', background:i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'center' }}>
                    <span style={{ fontSize:12, fontFamily:'DM Mono, monospace' }}>{v.visit_date||'—'}</span>
                    <span style={{ fontSize:12, color:'var(--black)' }}>{v.staff_name||'—'}</span>
                    <span style={{ fontSize:11, color:'var(--gray)' }}>{(v.event_type||'—').replace(/\s*\*e\*\s*/g,'').replace(/\s*\(PDF\)/g,'').trim()}</span>
                    <span style={{ fontSize:10, fontWeight:700, color:statusColor, background:statusBg, padding:'2px 7px', borderRadius:999, display:'inline-block' }}>
                      {isCan?'Cancelled':isComp?'Completed':isMiss?'Missed':v.status||'—'}
                    </span>
                    <span style={{ fontSize:11, color:'var(--gray)' }}>{v.discipline||'—'}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PatientCensusPage() {
  const [census, setCensus] = useState([]);
  const [visits, setVisits] = useState([]);
  const [authData, setAuthData] = useState([]);
  const [intakeData, setIntakeData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('ALL');
  const [insFilter, setInsFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    Promise.all([
      supabase.from('census_data').select('*'),
      supabase.from('visit_schedule_data').select('patient_name,visit_date,status,event_type,staff_name,region,discipline,insurance'),
      supabase.from('auth_tracker').select('*'),
      supabase.from('intake_referrals').select('*').not('date_received','is',null).order('date_received',{ascending:false}),
    ]).then(([c,v,a,i]) => {
      setCensus(c.data||[]); setVisits(v.data||[]);
      setAuthData(a.data||[]); setIntakeData(i.data||[]);
      setLoading(false);
    });
  }, []);

  const regions = useMemo(() => ['ALL',...new Set(census.map(c=>c.region).filter(Boolean)).values()].sort(), [census]);
  const insurances = useMemo(() => ['ALL',...new Set(census.map(c=>c.insurance).filter(Boolean)).values()].sort(), [census]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return census.filter(c =>
      (regionFilter==='ALL'||c.region===regionFilter) &&
      (insFilter==='ALL'||c.insurance===insFilter) &&
      (statusFilter==='ALL'||c.status===statusFilter) &&
      (!q||(c.patient_name||'').toLowerCase().includes(q)||(c.insurance||'').toLowerCase().includes(q))
    );
  }, [census, search, regionFilter, insFilter, statusFilter]);

  const paged = filtered.slice(page*PAGE_SIZE, (page+1)*PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  // Pre-compute visit stats per patient for the table
  const visitStatsMap = useMemo(() => {
    const map = {};
    visits.forEach(v => {
      const k = (v.patient_name||'').toLowerCase().trim();
      if (!map[k]) map[k] = { completed:0, cancelled:0, missed:0 };
      if (isCancelled(v.event_type,v.status)) map[k].cancelled++;
      else if (/completed/i.test(v.status||'')) map[k].completed++;
      else if (/missed/i.test(v.status||'')) map[k].missed++;
    });
    return map;
  }, [visits]);

  const authMap = useMemo(() => {
    const map = {};
    authData.forEach(a => {
      const k = (a.patient_name||'').toLowerCase().trim();
      if (!map[k] || (a.created_at > (map[k].created_at||''))) map[k] = a;
    });
    return map;
  }, [authData]);

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Patient Census" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Patient Census" subtitle={`${census.length} patients · ${filtered.length} shown`} />
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        {/* Filters */}
        <div style={{ display:'flex', gap:10, padding:'12px 20px', borderBottom:'1px solid var(--border)', background:'var(--card-bg)', flexWrap:'wrap' }}>
          <input placeholder="Search patient or insurance…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
            style={{ padding:'7px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', width:220, background:'var(--bg)' }} />
          {[['regionFilter',setRegionFilter,regions,'Region'],['insFilter',setInsFilter,insurances,'Insurance'],].map(([key,setter,opts,label]) => (
            <select key={key} value={key==='regionFilter'?regionFilter:insFilter} onChange={e => { setter(e.target.value); setPage(0); }}
              style={{ padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)', maxWidth:160 }}>
              {opts.map(o => <option key={o} value={o}>{o==='ALL'?`All ${label}s`:o}</option>)}
            </select>
          ))}
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
            style={{ padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)' }}>
            {['ALL','active','inactive','discharged'].map(s => <option key={s} value={s}>{s==='ALL'?'All Statuses':s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
          </select>
          <select onChange={e => { /* last seen filter */ }} 
            style={{ padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)' }}
            id="lastSeenFilter">
            <option value="ALL">All Last Seen</option>
            <option value="today">Seen Today</option>
            <option value="week">Within 7 Days</option>
            <option value="overdue">14+ Days (Overdue)</option>
            <option value="none">No Visit Record</option>
          </select>
          <div style={{ marginLeft:'auto', fontSize:12, color:'var(--gray)', alignSelf:'center' }}>
            Click any patient to view full profile · <span style={{ color:'#D97706' }}>🟠 = 7-14d</span> · <span style={{ color:'#DC2626' }}>🔴 = 14d+</span>
          </div>
        </div>

        {/* Table */}
        <div style={{ flex:1, overflow:'auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1.8fr 0.5fr 1.2fr 0.7fr 0.6fr 0.6fr 0.6fr 0.8fr', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', position:'sticky', top:0, fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', zIndex:1 }}>
            <span>Patient</span><span>Rgn</span><span>Insurance</span><span>Last Seen</span><span>Completed</span><span>Cancelled</span><span>Missed</span><span>Auth Remaining</span>
          </div>
          {paged.map((patient, i) => {
            const k = (patient.patient_name||'').toLowerCase().trim();
            const vs = visitStatsMap[k] || { completed:0, cancelled:0, missed:0 };
            const auth = authMap[k];
            const remaining = auth ? (auth.visits_authorized||24)-(auth.visits_used||0) : null;
            return (
              <div key={patient.id||i} onClick={() => setSelected(patient)}
                style={{ display:'grid', gridTemplateColumns:'1.8fr 0.5fr 1.2fr 0.7fr 0.6fr 0.6fr 0.6fr 0.8fr', padding:'10px 20px', borderBottom:'1px solid var(--border)', background: patient.last_visit_date && (new Date() - new Date(patient.last_visit_date+'T00:00:00'))/86400000 > 14 && patient.status?.toLowerCase().includes('active') ? '#FFF8F0' : i%2===0?'var(--card-bg)':'var(--bg)', cursor:'pointer', alignItems:'center' }}
                onMouseEnter={e => e.currentTarget.style.background='#F0F7FF'}
                onMouseLeave={e => e.currentTarget.style.background=i%2===0?'var(--card-bg)':'var(--bg)'}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--black)' }}>{patient.patient_name}</div>
                  <div style={{ fontSize:10, color:'var(--gray)', marginTop:1 }}>{patient.discipline||''}</div>
                </div>
                <span style={{ fontSize:13, fontWeight:700, color:'var(--gray)' }}>{patient.region||'—'}</span>
                <span style={{ fontSize:12 }}>{patient.insurance||'—'}</span>
                <div>
                  {patient.last_visit_date ? (() => {
                    const days = Math.floor((new Date() - new Date(patient.last_visit_date+'T00:00:00')) / 86400000);
                    const color = days > 14 ? '#DC2626' : days > 7 ? '#D97706' : '#065F46';
                    return (
                      <div>
                        <div style={{ fontSize:11, fontWeight:700, color }}>{days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days}d ago`}</div>
                        <div style={{ fontSize:9, color:'var(--gray)', marginTop:1 }}>{new Date(patient.last_visit_date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>
                      </div>
                    );
                  })() : <span style={{ fontSize:11, color:'#9CA3AF', fontStyle:'italic' }}>No visits</span>}
                </div>
                <span style={{ fontSize:13, fontWeight:700, color:'#065F46' }}>{vs.completed}</span>
                <span style={{ fontSize:13, fontWeight:vs.cancelled>0?700:400, color:vs.cancelled>0?'#DC2626':'var(--gray)' }}>{vs.cancelled}</span>
                <span style={{ fontSize:13, fontWeight:vs.missed>0?700:400, color:vs.missed>0?'#D97706':'var(--gray)' }}>{vs.missed}</span>
                <span style={{ fontSize:12, fontWeight:600, color:remaining<=5?'#DC2626':remaining<=10?'#D97706':'#065F46' }}>
                  {remaining !== null ? remaining + ' visits' : '—'}
                </span>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display:'flex', justifyContent:'center', gap:8, padding:'12px 20px', borderTop:'1px solid var(--border)', background:'var(--card-bg)' }}>
            <button onClick={() => setPage(p=>Math.max(0,p-1))} disabled={page===0} style={{ padding:'5px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, cursor:'pointer', background:'var(--bg)', opacity:page===0?0.4:1 }}>← Prev</button>
            <span style={{ fontSize:12, color:'var(--gray)', alignSelf:'center' }}>Page {page+1} of {totalPages} · {filtered.length} patients</span>
            <button onClick={() => setPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1} style={{ padding:'5px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, cursor:'pointer', background:'var(--bg)', opacity:page>=totalPages-1?0.4:1 }}>Next →</button>
          </div>
        )}
      </div>

      {selected && (
        <PatientProfile
          patient={selected}
          visits={visits}
          authData={authData}
          intakeData={intakeData}
          onClose={() => setSelected(null)}
          onUpdate={async () => {
            // Reload census and intake data after edit
            const [c, i] = await Promise.all([
              supabase.from('census_data').select('*'),
              supabase.from('intake_referrals').select('*').not('date_received','is',null).order('date_received',{ascending:false}),
            ]);
            if (c.data) setCensus(c.data);
            if (i.data) setIntakeData(i.data);
          }}
        />
      )}
    </div>
  );
}
