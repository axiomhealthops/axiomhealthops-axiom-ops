import React, { useState, useEffect, useMemo, useRef } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import AIDocExtractor from './AIDocExtractor';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
 
var INSURANCES = ['Aetna','CarePlus','Cigna','Devoted','Fenyx','FHCP','Health First','Humana','Medicare','Simply','United','Other'];
var STATUSES = [
  { value: 'pending',        label: 'Auth Pending',    color: '#92400E', bg: '#FEF3C7' },
  { value: 'submitted',      label: 'Submitted',       color: '#1E40AF', bg: '#EFF6FF' },
  { value: 'active',         label: 'Active',          color: '#065F46', bg: '#ECFDF5' },
  { value: 'renewal_needed', label: 'Renewal Needed',  color: '#991B1B', bg: '#FEF2F2' },
  { value: 'denied',         label: 'Denied',          color: '#991B1B', bg: '#FEF2F2' },
  { value: 'appealing',      label: 'Appealing',       color: '#6D28D9', bg: '#EDE9FE' },
  { value: 'on_hold',        label: 'On Hold',         color: '#374151', bg: '#F3F4F6' },
  { value: 'discharged',     label: 'Discharged',      color: '#374151', bg: '#F3F4F6' },
];
var REGIONS = ['A','B','C','G','H','J','M','N','T','V'];
var COORD_MAP = {
  A: 'Gypsy Renos', B: 'Mary Imperio', C: 'Mary Imperio', G: 'Mary Imperio',
  H: 'Audrey Sarmiento', J: 'Audrey Sarmiento', M: 'Audrey Sarmiento', N: 'Audrey Sarmiento',
  T: 'April Manalo', V: 'April Manalo',
};
var DOC_TYPES = [
  { value: 'auth',     label: 'Authorization Letter' },
  { value: 'denial',   label: 'Denial Letter' },
  { value: 'appeal',   label: 'Appeal Document' },
  { value: 'clinical', label: 'Clinical Notes' },
  { value: 'other',    label: 'Other' },
];
 
function getStatus(s) { return STATUSES.find(function(x) { return x.value === s; }) || STATUSES[0]; }
 
function daysUntil(dateStr) {
  if (!dateStr) return null;
  var now = new Date(); now.setHours(0,0,0,0);
  return Math.round((new Date(dateStr) - now) / (1000*60*60*24));
}
 
function fmtDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}
 
function fmtFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}
 
function visitsRemaining(rec) {
  // If predecessor not exhausted, effective visits = 0 (visits don't count yet)
  if (rec.alert_predecessor_pending) return 0;
  // Use DB-computed effective_visits_remaining if available
  if (rec.effective_visits_remaining !== null && rec.effective_visits_remaining !== undefined) return rec.effective_visits_remaining;
  return Math.max((rec.visits_authorized || 0) - (rec.visits_used || 0), 0);
}

function rawVisitsRemaining(rec) {
  return Math.max((rec.visits_authorized || 0) - (rec.visits_used || 0), 0);
}
 
function isPPO(rec) {
  return (rec.insurance_type || '').toLowerCase() === 'ppo';
}

function getUrgency(rec) {
  // PPO plans don't require authorization — always green
  if (isPPO(rec)) return 'ok';
  var remaining = visitsRemaining(rec);
  var rawRemaining = rawVisitsRemaining(rec);
  var expDays = daysUntil(rec.auth_expiry_date);
  if (rec.auth_status === 'denied') return 'critical';
  if (rec.auth_status === 'renewal_needed') return 'critical';
  // Predecessor not exhausted — flag as medium so it surfaces but doesn't false-alarm as critical
  if (rec.alert_predecessor_pending) return 'medium';
  if (remaining <= 7 && rec.auth_status === 'active') return 'critical';
  if (remaining <= 10 && rec.auth_status === 'active') return 'high';
  if (expDays !== null && expDays <= 14 && expDays >= 0) return 'high';
  if (rec.auth_status === 'pending' || rec.auth_status === 'submitted') return 'medium';
  return 'ok';
}
 
function UrgencyDot(props) {
  var colors = { critical: '#DC2626', high: '#F59E0B', medium: '#3B82F6', ok: '#10B981' };
  return React.createElement('span', {
    style: { width: 8, height: 8, borderRadius: '50%', background: colors[props.urgency] || '#9CA3AF', display: 'inline-block', marginRight: 6, flexShrink: 0 }
  });
}
 
function StatusBadge(props) {
  var s = getStatus(props.status);
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  );
}
 
function VisitsBar(props) {
  var rec = props.rec;
  var auth = rec.visits_authorized || 0;
  var used = rec.visits_used || 0;
  var remaining = Math.max(auth - used, 0);
  var pct = auth > 0 ? Math.min((used / auth) * 100, 100) : 0;
  var color = remaining <= 7 ? '#DC2626' : remaining <= 10 ? '#F59E0B' : '#10B981';

  // Predecessor not exhausted — show locked state
  if (rec.alert_predecessor_pending) {
    return (
      <div style={{ minWidth: 80 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#7C3AED', background: '#F5F3FF', padding: '2px 6px', borderRadius: 4, marginBottom: 2 }}>
          🔒 {auth} visits — predecessor active
        </div>
        <div style={{ height: 5, background: '#DDD6FE', borderRadius: 999 }}>
          <div style={{ height: '100%', width: '0%', background: '#7C3AED', borderRadius: 999 }} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ minWidth: 80 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3 }}>
        <span style={{ fontWeight: 700, color: color }}>{remaining} left</span>
        <span style={{ color: 'var(--gray)' }}>{used}/{auth}</span>
      </div>
      <div style={{ height: 5, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 999 }} />
      </div>
    </div>
  );
}
 
function ExpiryCell(props) {
  var dateStr = props.date;
  if (!dateStr) return <span style={{ fontSize: 11, color: 'var(--gray)' }}>&mdash;</span>;
  var days = daysUntil(dateStr);
  var color = days === null ? 'var(--gray)' : days < 0 ? '#DC2626' : days <= 7 ? '#DC2626' : days <= 14 ? '#F59E0B' : days <= 30 ? '#F59E0B' : 'var(--black)';
  var label = days === null ? '' : days < 0 ? Math.abs(days) + 'd ago' : days === 0 ? 'Today!' : days + 'd';
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: color }}>{fmtDate(dateStr)}</div>
      {days !== null && <div style={{ fontSize: 10, color: color, fontWeight: days <= 14 ? 700 : 400, marginTop: 1 }}>{label}</div>}
    </div>
  );
}
 
// ── Document Panel ────────────────────────────────────────────────────
function DocumentPanel(props) {
  var authId = props.authId;
  var patientName = props.patientName;
  var [docs, setDocs] = useState([]);
  var [uploading, setUploading] = useState(false);
  var [docType, setDocType] = useState('auth');
  var [docNotes, setDocNotes] = useState('');
  var fileRef = useRef();
 
  function loadDocs() {
    supabase.from('auth_documents').select('*').eq('auth_tracker_id', authId)
      .order('created_at', { ascending: false })
      .then(function(res) { setDocs(res.data || []); });
  }
 
  useEffect(function() { if (authId) loadDocs(); }, [authId]);
 
  async function handleUpload(e) {
    var file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    // Path: auth-documents/{auth_id}/{timestamp}_{filename}
    var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    var filePath = authId + '/' + Date.now() + '_' + safeName;
 
    var uploadResult = await supabase.storage.from('auth-documents').upload(filePath, file, {
      contentType: file.type || 'application/pdf',
    });
 
    if (uploadResult.error) {
      alert('Upload failed: ' + uploadResult.error.message);
      setUploading(false);
      return;
    }
 
    await supabase.from('auth_documents').insert([{
      auth_tracker_id: authId,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      doc_type: docType,
      notes: docNotes || null,
    }]);
 
    setDocNotes('');
    if (fileRef.current) fileRef.current.value = '';
    setUploading(false);
    loadDocs();
  }
 
  async function handleDelete(doc) {
    if (!window.confirm('Delete "' + doc.file_name + '"?')) return;
    await supabase.storage.from('auth-documents').remove([doc.file_path]);
    await supabase.from('auth_documents').delete().eq('id', doc.id);
    loadDocs();
  }
 
  async function handleDownload(doc) {
    var result = await supabase.storage.from('auth-documents').createSignedUrl(doc.file_path, 60);
    if (result.data && result.data.signedUrl) {
      window.open(result.data.signedUrl, '_blank');
    } else {
      alert('Could not generate download link.');
    }
  }
 
  var DOC_ICONS = { auth: '📄', denial: '❌', appeal: '⚖️', clinical: '🩺', other: '📎' };
 
  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px dashed var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Documents ({docs.length})
        </div>
      </div>
 
      {/* Upload area */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={docType} onChange={function(e) { setDocType(e.target.value); }}
          style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--bg)', color: 'var(--black)', outline: 'none' }}>
          {DOC_TYPES.map(function(t) { return <option key={t.value} value={t.value}>{t.label}</option>; })}
        </select>
        <input placeholder="Notes (optional)" value={docNotes} onChange={function(e) { setDocNotes(e.target.value); }}
          style={{ padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--bg)', color: 'var(--black)', outline: 'none', flex: 1, minWidth: 140 }} />
        <label style={{ padding: '5px 14px', background: uploading ? '#9CA3AF' : 'var(--red)', color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
          {uploading ? 'Uploading...' : '+ Upload PDF'}
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleUpload} disabled={uploading}
            style={{ display: 'none' }} />
        </label>
      </div>
 
      {/* Document list */}
      {docs.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--gray)', fontStyle: 'italic', padding: '8px 0' }}>
          No documents uploaded yet. Upload auth letters, denial letters, or clinical notes.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {docs.map(function(doc) {
            var dtLabel = DOC_TYPES.find(function(t) { return t.value === doc.doc_type; });
            return (
              <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{DOC_ICONS[doc.doc_type] || '📎'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--black)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.file_name}</div>
                  <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 2 }}>
                    {dtLabel ? dtLabel.label : doc.doc_type}
                    {doc.file_size ? ' &middot; ' + fmtFileSize(doc.file_size) : ''}
                    {' &middot; ' + fmtDate(doc.created_at)}
                    {doc.notes ? ' &middot; ' + doc.notes : ''}
                  </div>
                </div>
                <button onClick={function() { handleDownload(doc); }}
                  style={{ padding: '4px 10px', background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  View
                </button>
                <button onClick={function() { handleDelete(doc); }}
                  style={{ padding: '4px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, color: 'var(--danger)', cursor: 'pointer' }}>
                  Del
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
 
// ── Add/Edit Modal ────────────────────────────────────────────────────
function AddEditModal(props) {
  var rec = props.record;
  var [saving, setSaving] = useState(false);

  // Escape-to-close (disabled while saving)
  useEffect(function() {
    function onKey(e) { if (e.key === 'Escape' && !saving) props.onClose(); }
    window.addEventListener('keydown', onKey);
    return function() { window.removeEventListener('keydown', onKey); };
  }, [props.onClose, saving]);

  var [form, setForm] = useState(rec ? Object.assign({}, rec) : {
    patient_name: '', dob: '', member_id: '', phone: '', region: '',
    insurance: '', insurance_type: 'standard', auth_number: '', request_type: 'initial',
    visits_authorized: 24, visits_used: 0, evals_authorized: 2, evals_used: 0,
    reassessments_authorized: 3, reassessments_used: 0,
    soc_date: '', auth_submitted_date: '', auth_needed_by: '', auth_approved_date: '', auth_expiry_date: '',
    auth_status: 'pending', pcp_name: '', pcp_phone: '', pcp_fax: '', pcp_facility: '',
    therapy_type: 'LYMPHEDEMA', frequency: '', assigned_to: '', notes: '', denial_reason: '',
    request_category: 'initial', cpt_codes: '', diagnosis_code: '', requesting_provider: '', requesting_provider_npi: '',
  });
 
  function set(field, val) {
    var u = Object.assign({}, form);
    u[field] = val;
    if (field === 'insurance_type') {
      if (val === 'ppo') { u.auth_status = 'active'; u.notes = (u.notes ? u.notes + '\n' : '') + 'PPO — No authorization required.'; }
      else if (val === 'medicare') { u.visits_authorized = 20; u.evals_authorized = 1; u.reassessments_authorized = 0; }
      else if (form.insurance_type === 'medicare') { u.visits_authorized = 24; u.evals_authorized = 2; u.reassessments_authorized = 3; }
    }
    setForm(u);
  }
 
  async function handleSave() {
    setSaving(true);
    var data = Object.assign({}, form);
    ['dob','soc_date','auth_submitted_date','auth_needed_by','auth_approved_date','auth_expiry_date'].forEach(function(f) { if (!data[f]) data[f] = null; });
    ['visits_authorized','visits_used','evals_authorized','evals_used','reassessments_authorized','reassessments_used'].forEach(function(f) { data[f] = parseInt(data[f]) || 0; });
    var result = rec && rec.id
      ? await supabase.from('auth_tracker').update(data).eq('id', rec.id)
      : await supabase.from('auth_tracker').insert([data]);
    if (result.error) { alert('Error: ' + result.error.message); setSaving(false); return; }
    // Recompute auth sequence for this patient after any save
    if (data.patient_name) {
      await supabase.rpc('recompute_auth_sequence', { p_patient_name: data.patient_name });
    }
    props.onSave();
  }
 
  var INP = { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--black)', outline: 'none', width: '100%' };
  var LBL = { fontSize: 11, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'block' };
  var SEC = { fontSize: 11, fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12, marginTop: 4 };
 
  return (
    <div onClick={function(e) { if (e.target === e.currentTarget && !saving) props.onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={function(e) { e.stopPropagation(); }}
        style={{ background: 'var(--card-bg)', borderRadius: 14, width: '100%', maxWidth: 780, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: 'var(--card-bg)', zIndex: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--black)' }}>{rec ? 'Edit Auth Record' : 'New Auth Record'}</div>
          <button onClick={props.onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--gray)', cursor: 'pointer' }}>&#10005;</button>
        </div>
        <div style={{ padding: 24 }}>
          <div style={SEC}>Patient Information</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
            <div><label style={LBL}>Patient Name *</label><input style={INP} value={form.patient_name || ''} onChange={function(e){set('patient_name',e.target.value)}} placeholder="Last, First" /></div>
            <div><label style={LBL}>Date of Birth</label><input type="date" style={INP} value={form.dob || ''} onChange={function(e){set('dob',e.target.value)}} /></div>
            <div><label style={LBL}>Member ID</label><input style={INP} value={form.member_id || ''} onChange={function(e){set('member_id',e.target.value)}} /></div>
            <div><label style={LBL}>Phone</label><input style={INP} value={form.phone || ''} onChange={function(e){set('phone',e.target.value)}} /></div>
            <div><label style={LBL}>Region</label>
              <select style={INP} value={form.region || ''} onChange={function(e){set('region',e.target.value)}}>
                <option value="">Select...</option>
                {REGIONS.map(function(r){ return <option key={r} value={r}>Region {r} &mdash; {COORD_MAP[r]||''}</option>; })}
              </select>
            </div>
            <div><label style={LBL}>Therapy Type</label>
              <select style={INP} value={form.therapy_type || 'LYMPHEDEMA'} onChange={function(e){set('therapy_type',e.target.value)}}>
                <option value="LYMPHEDEMA">Lymphedema</option>
                <option value="OT">Occupational Therapy</option>
                <option value="PT">Physical Therapy</option>
              </select>
            </div>
          </div>
 
          <div style={SEC}>Insurance &amp; Authorization</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
            <div><label style={LBL}>Insurance *</label>
              <select style={INP} value={form.insurance || ''} onChange={function(e){set('insurance',e.target.value)}}>
                <option value="">Select...</option>
                {INSURANCES.map(function(ins){ return <option key={ins} value={ins}>{ins}</option>; })}
              </select>
            </div>
            <div><label style={LBL}>Insurance Type</label>
              <select style={INP} value={form.insurance_type || 'standard'} onChange={function(e){set('insurance_type',e.target.value)}}>
                <option value="standard">Standard (24 visits)</option>
                <option value="medicare">Medicare (20 visits)</option>
                <option value="ppo">PPO (No Auth Required)</option>
              </select>
            </div>
            <div><label style={LBL}>Auth Number</label><input style={INP} value={form.auth_number || ''} onChange={function(e){set('auth_number',e.target.value)}} /></div>
            <div><label style={LBL}>Status</label>
              <select style={INP} value={form.auth_status || 'pending'} onChange={function(e){set('auth_status',e.target.value)}}>
                {STATUSES.map(function(s){ return <option key={s.value} value={s.value}>{s.label}</option>; })}
              </select>
            </div>
            <div><label style={LBL}>Request Type</label>
              <select style={INP} value={form.request_type || 'initial'} onChange={function(e){set('request_type',e.target.value)}}>
                <option value="initial">Initial</option>
                <option value="renewal">Renewal</option>
              </select>
            </div>
            <div><label style={LBL}>Frequency</label><input style={INP} value={form.frequency || ''} onChange={function(e){set('frequency',e.target.value)}} placeholder="e.g. 2x/week" /></div>
          </div>
 
          <div style={SEC}>Visit Tracking</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
            {[['visits_authorized','Visits Authorized'],['visits_used','Visits Used'],['evals_authorized','Evals Authorized'],['evals_used','Evals Used'],['reassessments_authorized','Reassessments Auth.'],['reassessments_used','Reassessments Used']].map(function(item){
              return (
                <div key={item[0]}>
                  <label style={LBL}>{item[1]}</label>
                  <input type="number" min="0" style={Object.assign({},INP,{fontFamily:'DM Mono, monospace',fontWeight:700,textAlign:'center'})}
                    value={form[item[0]] !== undefined ? form[item[0]] : 0}
                    onChange={function(e){set(item[0], parseInt(e.target.value)||0)}} />
                </div>
              );
            })}
          </div>
 
          <div style={SEC}>Key Dates</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
            {[['soc_date','Start of Care (SOC)'],['auth_submitted_date','Auth Submitted'],['auth_needed_by','Needed By'],['auth_approved_date','Auth Approved'],['auth_expiry_date','Auth Expires']].map(function(item){
              return (
                <div key={item[0]}>
                  <label style={LBL}>{item[1]}</label>
                  <input type="date" style={INP} value={form[item[0]] || ''} onChange={function(e){set(item[0],e.target.value)}} />
                </div>
              );
            })}
          </div>
 
          <div style={SEC}>PCP / Provider</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 20 }}>
            <div><label style={LBL}>PCP Name</label><input style={INP} value={form.pcp_name || ''} onChange={function(e){set('pcp_name',e.target.value)}} /></div>
            <div><label style={LBL}>PCP Facility</label><input style={INP} value={form.pcp_facility || ''} onChange={function(e){set('pcp_facility',e.target.value)}} /></div>
            <div><label style={LBL}>PCP Phone</label><input style={INP} value={form.pcp_phone || ''} onChange={function(e){set('pcp_phone',e.target.value)}} /></div>
            <div><label style={LBL}>PCP Fax</label><input style={INP} value={form.pcp_fax || ''} onChange={function(e){set('pcp_fax',e.target.value)}} /></div>
          </div>
 
          <div style={SEC}>Notes</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            <div><label style={LBL}>Notes</label>
              <textarea rows={3} style={Object.assign({},INP,{resize:'vertical',fontFamily:'DM Sans, sans-serif'})} value={form.notes || ''} onChange={function(e){set('notes',e.target.value)}} /></div>
            <div><label style={LBL}>Denial Reason (if denied)</label>
              <textarea rows={3} style={Object.assign({},INP,{resize:'vertical',fontFamily:'DM Sans, sans-serif'})} value={form.denial_reason || ''} onChange={function(e){set('denial_reason',e.target.value)}} /></div>
          </div>

          <div style={SEC}>Authorization Sequencing & Clinical Details</div>
          <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#6D28D9', fontWeight: 700, marginBottom: 8 }}>
              🔒 Auth Sequencing — if this is a renewal that overlaps an existing auth, visits will be locked until the predecessor is exhausted
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
              <div><label style={LBL}>Request Category</label>
                <select style={INP} value={form.request_category || 'initial'} onChange={function(e){set('request_category',e.target.value)}}>
                  <option value="initial">Initial</option>
                  <option value="renewal">Renewal (continuation of care)</option>
                  <option value="concurrent_review">Concurrent Review</option>
                  <option value="resumption">Resumption</option>
                  <option value="retrospective">Retrospective</option>
                </select>
              </div>
              <div><label style={LBL}>Diagnosis Code</label>
                <input style={INP} value={form.diagnosis_code || ''} placeholder="e.g. I890 - Lymphedema" onChange={function(e){set('diagnosis_code',e.target.value)}} />
              </div>
              <div><label style={LBL}>CPT Codes Authorized</label>
                <input style={INP} value={form.cpt_codes || ''} placeholder="e.g. 97140 (24), 97164 (6)" onChange={function(e){set('cpt_codes',e.target.value)}} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <div><label style={LBL}>Requesting Provider</label>
                <input style={INP} value={form.requesting_provider || ''} placeholder="e.g. PHCA Medical Group" onChange={function(e){set('requesting_provider',e.target.value)}} />
              </div>
              <div><label style={LBL}>Requesting Provider NPI</label>
                <input style={INP} value={form.requesting_provider_npi || ''} placeholder="10-digit NPI" onChange={function(e){set('requesting_provider_npi',e.target.value)}} />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={props.onClose} disabled={saving} style={{ padding: '10px 20px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--gray)', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1 }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '10px 24px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving...' : 'Save Record'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
 
// ── Main Page ─────────────────────────────────────────────────────────
export default function AuthTrackerPage() {
  var [records, setRecords] = useState([]);
  var [loading, setLoading] = useState(true);
  var [search, setSearch] = useState('');
  var [statusFilter, setStatusFilter] = useState('ALL');
  var [regionFilter, setRegionFilter] = useState('ALL');
  var [insuranceFilter, setInsuranceFilter] = useState('ALL');
  var [sortBy, setSortBy] = useState('urgency');
  var [showModal, setShowModal] = useState(false);
  var [editRecord, setEditRecord] = useState(null);
  var [expandedId, setExpandedId] = useState(null);
  var [activeTab, setActiveTab] = useState('all');
  var [showAIExtractor, setShowAIExtractor] = useState(false);
  var [censusPatients, setCensusPatients] = useState([]);
 
  var regionScope = useAssignedRegions();

  function fetchRecords() {
    if (regionScope.loading) return;
    if (!regionScope.isAllAccess && (!regionScope.regions || regionScope.regions.length === 0)) {
      setRecords([]); setCensusPatients([]); setLoading(false); return;
    }
    setLoading(true);
    // Paginated — auth_tracker at 290 today but will grow; census at 750+
    Promise.all([
      fetchAllPages(regionScope.applyToQuery(supabase.from('auth_tracker').select('*').order('created_at', { ascending: false }))),
      fetchAllPages(regionScope.applyToQuery(supabase.from('census_data').select('patient_name,region,insurance,status').order('patient_name'))),
    ]).then(function(results) {
      setRecords(results[0]);
      setCensusPatients(results[1]);
      setLoading(false);
    });
  }

  useEffect(function() { fetchRecords(); }, [regionScope.loading, regionScope.isAllAccess, JSON.stringify(regionScope.regions)]);
 
  async function deleteRecord(id) {
    if (!window.confirm('Delete this auth record?')) return;
    await supabase.from('auth_tracker').delete().eq('id', id);
    fetchRecords();
  }
 
  var filtered = useMemo(function() {
    var urgencyOrder = { critical: 0, high: 1, medium: 2, ok: 3 };
    var list = records.map(function(r) { return Object.assign({}, r, { _urgency: getUrgency(r) }); });
    if (activeTab === 'critical') list = list.filter(function(r) { return r._urgency === 'critical'; });
    if (activeTab === 'pending') list = list.filter(function(r) { return r.auth_status === 'pending' || r.auth_status === 'submitted'; });
    if (activeTab === 'expiring') list = list.filter(function(r) { var d = daysUntil(r.auth_expiry_date); return d !== null && d <= 30 && d >= 0; });
    if (activeTab === 'denied') list = list.filter(function(r) { return r.auth_status === 'denied' || r.auth_status === 'appealing'; });
    if (activeTab === 'queued') list = list.filter(function(r) { return r.alert_predecessor_pending === true; });
    if (activeTab === 'ppo') list = list.filter(function(r) { return isPPO(r); });
    if (search) {
      var q = search.toLowerCase();
      list = list.filter(function(r) {
        return (r.patient_name && r.patient_name.toLowerCase().includes(q)) ||
               (r.member_id && r.member_id.toLowerCase().includes(q)) ||
               (r.auth_number && r.auth_number.toLowerCase().includes(q)) ||
               (r.insurance && r.insurance.toLowerCase().includes(q));
      });
    }
    if (statusFilter !== 'ALL') list = list.filter(function(r) { return r.auth_status === statusFilter; });
    if (regionFilter !== 'ALL') list = list.filter(function(r) { return r.region === regionFilter; });
    if (insuranceFilter !== 'ALL') list = list.filter(function(r) { return r.insurance === insuranceFilter; });
    list.sort(function(a, b) {
      if (sortBy === 'urgency') return urgencyOrder[a._urgency] - urgencyOrder[b._urgency];
      if (sortBy === 'visits') return visitsRemaining(a) - visitsRemaining(b);
      if (sortBy === 'expiry') {
        var da = a.auth_expiry_date ? new Date(a.auth_expiry_date) : new Date('2099-01-01');
        var db = b.auth_expiry_date ? new Date(b.auth_expiry_date) : new Date('2099-01-01');
        return da - db;
      }
      if (sortBy === 'soc') {
        var sa = a.soc_date ? new Date(a.soc_date) : new Date('2099-01-01');
        var sb = b.soc_date ? new Date(b.soc_date) : new Date('2099-01-01');
        return sa - sb;
      }
      if (sortBy === 'name') return (a.patient_name || '').localeCompare(b.patient_name || '');
      if (sortBy === 'region') return (a.region || '').localeCompare(b.region || '');
      return 0;
    });
    return list;
  }, [records, search, statusFilter, regionFilter, insuranceFilter, sortBy, activeTab]);
 
  // Exclude PPO patients from actionable counts — they don't require auth
  var nonPPO     = records.filter(function(r) { return !isPPO(r); });
  var ppoCount   = records.length - nonPPO.length;
  var critical   = nonPPO.filter(function(r) { return getUrgency(r) === 'critical'; }).length;
  var pending    = nonPPO.filter(function(r) { return r.auth_status === 'pending' || r.auth_status === 'submitted'; }).length;
  var expiring30 = nonPPO.filter(function(r) { var d = daysUntil(r.auth_expiry_date); return d !== null && d <= 30 && d >= 0; }).length;
  var denied     = nonPPO.filter(function(r) { return r.auth_status === 'denied' || r.auth_status === 'appealing'; }).length;
  var active     = records.filter(function(r) { return r.auth_status === 'active'; }).length;
  var queued     = nonPPO.filter(function(r) { return r.alert_predecessor_pending === true; }).length;
 
  var SEL = { padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--card-bg)', color: 'var(--black)', outline: 'none' };
  var tabs = [
    { key: 'all',      label: 'All',                count: records.length },
    { key: 'no_auth',  label: '⚠ No Auth on File',  count: censusPatients.filter(function(c) { return !records.some(function(r) { return r.patient_name?.toLowerCase().trim() === c.patient_name?.toLowerCase().trim(); }); }).length },
    { key: 'critical', label: 'Critical',           count: critical,   color: '#DC2626' },
    { key: 'queued',   label: '🔒 Queued Renewals', count: queued,     color: '#7C3AED' },
    { key: 'pending',  label: 'Pending / Submitted',count: pending,    color: '#92400E' },
    { key: 'expiring', label: 'Expiring (30 days)', count: expiring30, color: '#F59E0B' },
    { key: 'denied',   label: 'Denied / Appeal',    count: denied,     color: '#6D28D9' },
    { key: 'ppo',      label: '✅ PPO (No Auth)',    count: ppoCount,   color: '#059669' },
  ];
  var GRID = '2fr 0.5fr 0.8fr 0.85fr 1.05fr 1fr 0.85fr 0.7fr';
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Authorization Tracker"
        subtitle={censusPatients.length + ' total patients · ' + records.length + ' with auth · ' + active + ' active auth · ' + critical + ' critical'}
        actions={
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={function() { setShowAIExtractor(true); }}
              style={{ padding:'8px 16px', background:'#7C3AED', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
              ✨ AI Extract Auth
            </button>
            <button onClick={function() { setEditRecord(null); setShowModal(true); }}
              style={{ padding:'8px 16px', background:'var(--red)', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
              + New Auth Record
            </button>
          </div>
        }
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
 
        {/* Summary */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--card-bg)', flexShrink: 0 }}>
          {[
            { label: 'Census Patients',  val: censusPatients.length, color: 'var(--black)', sub: records.length + ' have auth records', tab: 'no_auth' },
            { label: 'Active Auths',       val: active,         color: 'var(--green)', sub: 'currently authorized', tab: 'all' },
            { label: 'Critical',           val: critical,       color: '#DC2626',      sub: '\u22647 visits or denied',   alert: critical > 0, tab: 'critical' },
            { label: 'Auth Pending',       val: pending,        color: '#92400E',      sub: 'awaiting approval',          alert: pending > 0, tab: 'pending' },
            { label: 'Expiring \u226430d', val: expiring30,     color: '#F59E0B',      sub: 'need renewal soon',          alert: expiring30 > 0, tab: 'expiring' },
            { label: 'Denied / Appeal',    val: denied,         color: '#6D28D9',      sub: 'needs action',               alert: denied > 0, tab: 'denied' },
          ].map(function(tile) {
            var isActive = activeTab === tile.tab;
            return (
              <div key={tile.label} onClick={function() { setActiveTab(isActive ? 'all' : tile.tab); }}
                style={{ flex: 1, padding: '10px 16px', borderRight: '1px solid var(--border)', textAlign: 'center', background: tile.alert ? '#FFFBF5' : 'transparent', cursor: 'pointer', borderBottom: isActive ? '2px solid ' + tile.color : '2px solid transparent', transition: 'border-bottom 0.15s ease' }}>
                <div style={{ fontSize: 10, color: 'var(--gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{tile.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: tile.color, marginTop: 2 }}>{tile.val}</div>
                <div style={{ fontSize: 10, color: tile.alert ? tile.color : 'var(--gray)', marginTop: 2, fontWeight: tile.alert ? 600 : 400 }}>
                  {isActive ? '\u2713 showing' : tile.sub}
                </div>
              </div>
            );
          })}
        </div>
 
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 20px 0', background: 'var(--bg)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {tabs.map(function(tab) {
            var isActive = activeTab === tab.key;
            return (
              <button key={tab.key} onClick={function() { setActiveTab(tab.key); }}
                style={{ padding: '7px 14px', border: 'none', borderRadius: '6px 6px 0 0', fontSize: 12, fontWeight: isActive ? 700 : 500, cursor: 'pointer', background: isActive ? 'var(--card-bg)' : 'transparent', color: isActive ? (tab.color || 'var(--black)') : 'var(--gray)', borderBottom: isActive ? '2px solid ' + (tab.color || 'var(--red)') : '2px solid transparent', display: 'flex', alignItems: 'center', gap: 6 }}>
                {tab.label}
                {tab.count > 0 && <span style={{ fontSize: 10, fontWeight: 700, background: isActive ? (tab.color || 'var(--red)') : 'var(--border)', color: isActive ? '#fff' : 'var(--gray)', padding: '1px 6px', borderRadius: 999 }}>{tab.count}</span>}
              </button>
            );
          })}
        </div>
 
        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Search patient, member ID, auth #..." value={search} onChange={function(e) { setSearch(e.target.value); }}
            style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', minWidth: 240 }} />
          <select value={regionFilter} onChange={function(e) { setRegionFilter(e.target.value); }} style={SEL}>
            <option value="ALL">All Regions</option>
            {REGIONS.map(function(r) { return <option key={r} value={r}>Region {r} &mdash; {COORD_MAP[r]||''}</option>; })}
          </select>
          <select value={insuranceFilter} onChange={function(e) { setInsuranceFilter(e.target.value); }} style={SEL}>
            <option value="ALL">All Insurances</option>
            {INSURANCES.map(function(ins) { return <option key={ins} value={ins}>{ins}</option>; })}
          </select>
          <select value={statusFilter} onChange={function(e) { setStatusFilter(e.target.value); }} style={SEL}>
            <option value="ALL">All Statuses</option>
            {STATUSES.map(function(s) { return <option key={s.value} value={s.value}>{s.label}</option>; })}
          </select>
          <select value={sortBy} onChange={function(e) { setSortBy(e.target.value); }} style={SEL}>
            <option value="urgency">Sort: Most Urgent First</option>
            <option value="visits">Sort: Fewest Visits Remaining</option>
            <option value="expiry">Sort: Expiring Soonest</option>
            <option value="soc">Sort: SOC Date</option>
            <option value="name">Sort: Patient Name</option>
            <option value="region">Sort: Region</option>
          </select>
          <span style={{ fontSize: 12, color: 'var(--gray)', marginLeft: 'auto' }}>{filtered.length} records</span>
        </div>
 
        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          {records.length === 0 && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>&#128274;</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--black)', marginBottom: 8 }}>No auth records yet</div>
              <button onClick={function() { setEditRecord(null); setShowModal(true); }}
                style={{ padding: '10px 20px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 8 }}>
                + New Auth Record
              </button>
            </div>
          )}
 
          {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}>Loading...</div>}
          {!loading && filtered.length === 0 && records.length > 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)', fontSize: 13 }}>No records match your filters.</div>
          )}
 
          {!loading && filtered.length > 0 && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: GRID, padding: '8px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <span>Patient</span><span>Rgn</span><span>Insurance</span>
                <span>SOC Date</span><span>Auth Expiry</span>
                <span>Visits Remaining</span><span>Status</span><span>Actions</span>
              </div>
 
              {filtered.map(function(r, i) {
                var urgency = r._urgency;
                var isExpanded = expandedId === r.id;
                var expDays = daysUntil(r.auth_expiry_date);
                var rowBg = urgency === 'critical' ? '#FFF5F5' : urgency === 'high' ? '#FFFBF0' : i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)';
 
                return (
                  <div key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: GRID, padding: '11px 20px', alignItems: 'center', background: rowBg, cursor: 'pointer' }}
                      onClick={function() { setExpandedId(isExpanded ? null : r.id); }}>
 
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <UrgencyDot urgency={urgency} />
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>{r.patient_name}</div>
                            {r.auth_sequence > 1 && (
                              <span style={{ fontSize: 9, fontWeight: 700, color: '#7C3AED', background: '#F5F3FF', padding: '1px 5px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                                Auth {r.auth_sequence} of {r.auth_sequence}
                              </span>
                            )}
                          </div>
                          {r.member_id && <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 1, fontFamily: 'DM Mono, monospace' }}>{r.member_id}</div>}
                          {r.auth_number && <div style={{ fontSize: 10, color: '#1565C0', marginTop: 1, fontFamily: 'DM Mono, monospace' }}>Auth #{r.auth_number}</div>}
                          {r.alert_predecessor_pending && (
                            <div style={{ fontSize: 9, fontWeight: 700, color: '#7C3AED', marginTop: 2 }}>
                              🔒 Queued — predecessor not exhausted
                            </div>
                          )}
                        </div>
                      </div>
 
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)' }}>Rgn {r.region || '?'}</div>
                        {r.region && COORD_MAP[r.region] && <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 1 }}>{COORD_MAP[r.region].split(' ')[0]}</div>}
                      </div>
 
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--black)' }}>{r.insurance}</div>
                        {isPPO(r) ? (
                          <div style={{ fontSize: 9, fontWeight: 700, color: '#065F46', background: '#ECFDF5', padding: '1px 6px', borderRadius: 4, marginTop: 2, display: 'inline-block' }}>PPO — No Auth Req.</div>
                        ) : (
                          <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 1 }}>{r.insurance_type === 'medicare' ? 'Medicare' : 'Standard'}</div>
                        )}
                      </div>
 
                      <div>
                        {r.soc_date
                          ? <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--black)' }}>{fmtDate(r.soc_date)}</div>
                          : <span style={{ fontSize: 11, color: 'var(--gray)' }}>&mdash;</span>}
                      </div>
 
                      <ExpiryCell date={r.auth_expiry_date} />
                      <VisitsBar rec={r} />
                      <StatusBadge status={r.auth_status} />
 
                      <div style={{ display: 'flex', gap: 6 }} onClick={function(e) { e.stopPropagation(); }}>
                        <button onClick={function() { setEditRecord(r); setShowModal(true); }}
                          style={{ padding: '4px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, color: 'var(--black)', cursor: 'pointer' }}>Edit</button>
                        <button onClick={function() { deleteRecord(r.id); }}
                          style={{ padding: '4px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, color: 'var(--danger)', cursor: 'pointer' }}>Del</button>
                      </div>
                    </div>
 
                    {/* Expanded detail + documents */}
                    {isExpanded && (
                      <div style={{ padding: '16px 20px 20px 34px', background: '#FAFAFA', borderTop: '1px solid var(--border)' }}>
                        {/* Predecessor warning banner */}
                        {r.alert_predecessor_pending && (
                          <div style={{ background: '#F5F3FF', border: '1px solid #C4B5FD', borderRadius: 8, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                            <span style={{ fontSize: 18, flexShrink: 0 }}>🔒</span>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#7C3AED' }}>Queued Auth — Predecessor Must Be Exhausted First</div>
                              <div style={{ fontSize: 11, color: '#6D28D9', marginTop: 3 }}>
                                This is Auth #{r.auth_sequence} for this patient. The {r.auth_sequence - 1 === 1 ? 'first' : 'previous'} authorization's visits must be fully used before these {r.visits_authorized} visits begin counting.
                                Visits on this auth are locked until the predecessor is exhausted.
                              </div>
                            </div>
                          </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 4 }}>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Visit Details</div>
                            <div style={{ fontSize: 12, color: 'var(--black)' }}>Visits: <strong>{r.visits_used}/{r.visits_authorized}</strong> ({rawVisitsRemaining(r)} remaining)</div>
                            {r.alert_predecessor_pending && <div style={{ fontSize: 11, color: '#7C3AED', fontWeight: 700 }}>⟳ Effective visits: 0 (locked)</div>}
                            <div style={{ fontSize: 12, color: 'var(--black)', marginTop: 3 }}>Evals: <strong>{r.evals_used}/{r.evals_authorized}</strong></div>
                            <div style={{ fontSize: 12, color: 'var(--black)', marginTop: 3 }}>Reassessments: <strong>{r.reassessments_used}/{r.reassessments_authorized}</strong></div>
                            {r.frequency && <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 3 }}>Frequency: {r.frequency}</div>}
                            {r.cpt_codes && <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 4 }}>CPT: {r.cpt_codes}</div>}
                          </div>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Key Dates</div>
                            {r.soc_date && <div style={{ fontSize: 12, color: 'var(--black)' }}>SOC: <strong>{fmtDate(r.soc_date)}</strong></div>}
                            {r.auth_submitted_date && <div style={{ fontSize: 12, marginTop: 3 }}>Submitted: {fmtDate(r.auth_submitted_date)}</div>}
                            {r.auth_needed_by && <div style={{ fontSize: 12, color: '#DC2626', fontWeight: 600, marginTop: 3 }}>Needed by: {fmtDate(r.auth_needed_by)}</div>}
                            {r.auth_approved_date && <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 3 }}>Approved: {fmtDate(r.auth_approved_date)}</div>}
                            {r.auth_expiry_date && <div style={{ fontSize: 12, color: expDays !== null && expDays <= 14 ? '#DC2626' : 'var(--black)', fontWeight: expDays !== null && expDays <= 14 ? 700 : 400, marginTop: 3 }}>Expires: {fmtDate(r.auth_expiry_date)}</div>}
                          </div>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>PCP / Provider</div>
                            {r.pcp_name && <div style={{ fontSize: 12 }}>{r.pcp_name}</div>}
                            {r.pcp_facility && <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>{r.pcp_facility}</div>}
                            {r.pcp_phone && <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>Ph: {r.pcp_phone}</div>}
                            {r.pcp_fax && <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>Fax: {r.pcp_fax}</div>}
                            {r.dob && <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 6 }}>DOB: {fmtDate(r.dob)}</div>}
                          </div>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Notes</div>
                            {r.notes && <div style={{ fontSize: 12, color: 'var(--black)', lineHeight: 1.5 }}>{r.notes}</div>}
                            {r.denial_reason && <div style={{ fontSize: 12, color: '#DC2626', marginTop: 6, fontWeight: 600 }}>Denial: {r.denial_reason}</div>}
                          </div>
                        </div>
 
                        {/* Document upload panel */}
                        <DocumentPanel authId={r.id} patientName={r.patient_name} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
 
      {showModal && (
        <AddEditModal
          record={editRecord}
          onClose={function() { setShowModal(false); setEditRecord(null); }}
          onSave={function() { setShowModal(false); setEditRecord(null); fetchRecords(); }}
        />
      )}

      {showAIExtractor && (
        <AIDocExtractor
          mode="auth"
          onClose={() => setShowAIExtractor(false)}
          onExtracted={() => { setShowAIExtractor(false); fetchRecords(); }}
        />
      )}
    </div>
  );
}
 
