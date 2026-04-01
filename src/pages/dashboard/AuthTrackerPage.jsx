import React, { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
 
var INSURANCES = ['CarePlus','Humana','Aetna','FHCP','Devoted','Medicare','Simply','HealthFirst','Cigna','United','Other'];
var REGIONS = ['A','B','C','G','H','J','M','N','T','V'];
var AUTH_OWNERS = ['Carla Smith','Gerilyn Bayson','Ethel Camposano'];
 
var STATUS_STYLES = {
  active:          { color: '#065F46', bg: '#ECFDF5', label: 'Active' },
  pending:         { color: '#92400E', bg: '#FEF3C7', label: 'Pending' },
  submitted:       { color: '#1E40AF', bg: '#EFF6FF', label: 'Submitted' },
  renewal_needed:  { color: '#DC2626', bg: '#FEF2F2', label: 'Renewal Needed' },
  denied:          { color: '#991B1B', bg: '#FEF2F2', label: 'Denied' },
  appealing:       { color: '#7C3AED', bg: '#F5F3FF', label: 'Appealing' },
  on_hold:         { color: '#92400E', bg: '#FEF3C7', label: 'On Hold' },
  discharged:      { color: '#374151', bg: '#F9FAFB', label: 'Discharged' },
  approved:        { color: '#065F46', bg: '#ECFDF5', label: 'Approved' },
};
 
var PATIENT_STATUS_STYLES = {
  active:       { color: '#065F46', bg: '#ECFDF5' },
  on_hold:      { color: '#92400E', bg: '#FEF3C7' },
  hospitalized: { color: '#DC2626', bg: '#FEF2F2' },
  discharged:   { color: '#374151', bg: '#F9FAFB' },
  soc_pending:  { color: '#1E40AF', bg: '#EFF6FF' },
  eval_pending: { color: '#7C3AED', bg: '#F5F3FF' },
};
 
function VisitsBar(props) {
  var used = props.used || 0;
  var authorized = props.authorized || 24;
  var remaining = Math.max(authorized - used, 0);
  var pct = authorized > 0 ? Math.min((used / authorized) * 100, 100) : 0;
  var isLow = remaining <= 7;
  var isCritical = remaining <= 3;
  var barColor = isCritical ? '#DC2626' : isLow ? '#F59E0B' : '#10B981';
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3 }}>
        <span style={{ color: 'var(--gray)' }}>{used} used</span>
        <span style={{ fontWeight: 700, color: isLow ? (isCritical ? '#DC2626' : '#F59E0B') : '#065F46', fontFamily: 'DM Mono, monospace' }}>
          {remaining} left
        </span>
      </div>
      <div style={{ height: 6, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: barColor, borderRadius: 999 }} />
      </div>
      <div style={{ fontSize: 9, color: 'var(--gray)', marginTop: 2 }}>of {authorized} auth'd</div>
    </div>
  );
}
 
function PatientModal(props) {
  var patient = props.patient;
  var onClose = props.onClose;
  var onSave = props.onSave;
  var isNew = !patient.id;
 
  var [form, setForm] = useState(patient || {
    patient_name: '', dob: '', member_id: '', phone: '', region: '', coordinator_region: '',
    insurance: '', insurance_type: 'standard', pcp_name: '', pcp_phone: '', pcp_fax: '', pcp_facility: '',
    auth_number: '', request_type: 'initial', auth_owner: 'Carla Smith',
    visits_authorized: 24, visits_used: 0, evals_authorized: 2, evals_used: 0,
    reassessments_authorized: 3, reassessments_used: 0,
    soc_date: '', auth_submitted_date: '', auth_needed_by: '', auth_approved_date: '', auth_expiry_date: '',
    auth_status: 'pending', patient_status: 'active', notes: '', denial_reason: '',
  });
 
  function handleInsuranceTypeChange(type) {
    var updates = { insurance_type: type };
    if (type === 'medicare') {
      updates.visits_authorized = 20;
      updates.evals_authorized = 1;
      updates.reassessments_authorized = 0;
    } else {
      updates.visits_authorized = 24;
      updates.evals_authorized = 2;
      updates.reassessments_authorized = 3;
    }
    setForm(Object.assign({}, form, updates));
  }
 
  function set(field, val) { setForm(Object.assign({}, form, { [field]: val })); }
 
  var INP = { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, background: 'var(--bg)', color: 'var(--black)', outline: 'none', width: '100%' };
  var SEL = Object.assign({}, INP);
 
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--card-bg)', borderRadius: 16, width: '100%', maxWidth: 780, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: 'var(--card-bg)', zIndex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--black)' }}>{isNew ? 'Add New Patient' : 'Edit Patient'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--gray)', cursor: 'pointer' }}>&#10005;</button>
        </div>
        <div style={{ padding: '20px 24px' }}>
 
          {/* Patient Info */}
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Patient Information</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
            <div><label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>Patient Name *</label><input value={form.patient_name || ''} onChange={function(e){set('patient_name',e.target.value);}} style={INP} /></div>
            <div><label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>Date of Birth</label><input type="date" value={form.dob || ''} onChange={function(e){set('dob',e.target.value);}} style={INP} /></div>
            <div><label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>Member ID</label><input value={form.member_id || ''} onChange={function(e){set('member_id',e.target.value);}} style={INP} /></div>
            <div><label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>Phone</label><input value={form.phone || ''} onChange={function(e){set('phone',e.target.value);}} style={INP} /></div>
            <div><label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>Region</label>
              <select value={form.region || ''} onChange={function(e){set('region',e.target.value); set('coordinator_region',e.target.value);}} style={SEL}>
                <option value="">Select Region</option>
                {REGIONS.map(function(r){return React.createElement('option',{key:r,value:r},'Region '+r);})}
              </select>
            </div>
            <div><label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>Patient Status</label>
              <select value={form.patient_status || 'active'} onChange={function(e){set('patient_status',e.target.value);}} style={SEL}>
                <option value="active">Active</option>
                <option value="soc_pending">SOC Pending</option>
                <option value="eval_pending">Eval Pending</option>
                <option value="on_hold">On Hold</option>
                <option value="hospitalized">Hospitalized</option>
                <option value="discharged">Discharged</option>
              </select>
            </div>
          </div>
 
          {/* Insurance */}
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Insurance &amp; Authorization</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
            <div><label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>Insurance *</label>
              <select value={form.insurance || ''} onChange={function(e){set('insurance',e.target.value);}} style={SEL}>
                <option value="">Select Insurance</option>
                {INSURANCES.map(function(ins){return React.createElement('option',{key:ins,value:ins},ins);})}
              </select>
            </div>
            <div><label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>Insurance Type</label>
              <select value={form.insurance_type || 'standard'} onChange={function(e){handleInsuranceTypeChange(e.target.value);}} style={SEL}>
                <option value="standard">Standard (24 visits)</option>
                <option value="medicare">Medicare (20 visits, no renewal)</option>
              </select>
            </div>
            <div><label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>Auth Owner</label>
              <select value={form.auth_owner || 'Carla Smith'} onChange={function(e){set('auth_owner',e.target.value);}} style={SEL}>
                {AUTH_OWNERS.map(function(o){return React.createElement('option',{key:o,value:o},o);})}
              </select>
            </div>
            <div><label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>Auth Number</label><input value={form.auth_number || ''} onChange={function(e){set('auth_number',e.target.value);}} style={INP} /></div>
            <div><label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>Auth Status</label>
              <select value={form.auth_status || 'pending'} onChange={function(e){set('auth_status',e.target.value);}} style={SEL}>
                <option value="pending">Pending</option>
                <option value="submitted">Submitted</option>
                <option value="approved">Approved</option>
                <option value="active">Active</option>
                <option value="renewal_needed">Renewal Needed</option>
                <option value="denied">Denied</option>
                <option value="appealing">Appealing</option>
                <option value="on_hold">On Hold</option>
                <option value="discharged">Discharged</option>
              </select>
            </div>
            <div><label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>Request Type</label>
              <select value={form.request_type || 'initial'} onChange={function(e){set('request_type',e.target.value);}} style={SEL}>
                <option value="initial">Initial</option>
                <option value="renewal">Renewal</option>
              </select>
            </div>
          </div>
 
          {/* Visits */}
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Visit Counts</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              ['visits_authorized','Visits Auth\'d'],['visits_used','Visits Used'],
              ['evals_authorized','Evals Auth\'d'],['evals_used','Evals Used'],
              ['reassessments_authorized','Re-Assess Auth\'d'],['reassessments_used','Re-Assess Used'],
            ].map(function(item){
              return (
                <div key={item[0]}>
                  <label style={{ fontSize: 10, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>{item[1]}</label>
                  <input type="number" min="0" value={form[item[0]] !== undefined ? form[item[0]] : 0}
                    onChange={function(e){set(item[0], parseInt(e.target.value)||0);}}
                    style={Object.assign({},INP,{textAlign:'center',fontFamily:'DM Mono, monospace',fontWeight:700,fontSize:16})} />
                </div>
              );
            })}
          </div>
 
          {/* Dates */}
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Key Dates</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              ['soc_date','SOC Date'],['auth_submitted_date','Submitted'],
              ['auth_needed_by','Needed By'],['auth_approved_date','Approved'],
              ['auth_expiry_date','Expires'],
            ].map(function(item){
              return (
                <div key={item[0]}>
                  <label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>{item[1]}</label>
                  <input type="date" value={form[item[0]] || ''} onChange={function(e){set(item[0],e.target.value);}} style={INP} />
                </div>
              );
            })}
          </div>
 
          {/* PCP */}
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>PCP Information</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
            <div><label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>PCP Name</label><input value={form.pcp_name || ''} onChange={function(e){set('pcp_name',e.target.value);}} style={INP} /></div>
            <div><label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>PCP Phone</label><input value={form.pcp_phone || ''} onChange={function(e){set('pcp_phone',e.target.value);}} style={INP} /></div>
            <div><label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>PCP Fax</label><input value={form.pcp_fax || ''} onChange={function(e){set('pcp_fax',e.target.value);}} style={INP} /></div>
            <div><label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>Facility</label><input value={form.pcp_facility || ''} onChange={function(e){set('pcp_facility',e.target.value);}} style={INP} /></div>
          </div>
 
          {/* Notes */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11, color: 'var(--gray)', display: 'block', marginBottom: 4 }}>Notes</label>
            <textarea value={form.notes || ''} onChange={function(e){set('notes',e.target.value);}} rows={3}
              style={Object.assign({},INP,{resize:'vertical',fontFamily:'DM Sans, sans-serif'})} />
          </div>
 
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ padding: '10px 20px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--gray)', cursor: 'pointer' }}>Cancel</button>
            <button onClick={function(){onSave(form);}} style={{ padding: '10px 24px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {isNew ? 'Add Patient' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
 
export default function AuthTrackerPage() {
  var [patients, setPatients] = useState([]);
  var [loading, setLoading] = useState(true);
  var [search, setSearch] = useState('');
  var [regionFilter, setRegionFilter] = useState('ALL');
  var [insuranceFilter, setInsuranceFilter] = useState('ALL');
  var [statusFilter, setStatusFilter] = useState('ALL');
  var [ownerFilter, setOwnerFilter] = useState('ALL');
  var [alertFilter, setAlertFilter] = useState(false);
  var [editPatient, setEditPatient] = useState(null);
  var [showModal, setShowModal] = useState(false);
  var [selectedPatient, setSelectedPatient] = useState(null);
 
  useEffect(function(){ fetchPatients(); }, []);
 
  function fetchPatients() {
    supabase.from('auth_tracker').select('*').order('patient_name')
      .then(function(res){ setPatients(res.data || []); setLoading(false); });
  }
 
  async function savePatient(form) {
    var now = new Date().toISOString();
    // Auto-set alert flags
    var remaining = Math.max((form.visits_authorized||0) - (form.visits_used||0), 0);
    var today = new Date();
    var expiry = form.auth_expiry_date ? new Date(form.auth_expiry_date) : null;
    var daysToExpiry = expiry ? Math.floor((expiry - today) / (1000*60*60*24)) : null;
    var alertLow = remaining <= 7 && remaining > 0;
    var alertExpiry = daysToExpiry !== null && daysToExpiry <= 30;
 
    // Auto set renewal_needed status
    var status = form.auth_status;
    if (alertLow && status === 'active' && form.insurance_type !== 'medicare') {
      status = 'renewal_needed';
    }
 
    var payload = Object.assign({}, form, {
      alert_low_visits: alertLow,
      alert_expiry: alertExpiry,
      auth_status: status,
      updated_at: now,
      visits_authorized: parseInt(form.visits_authorized)||0,
      visits_used: parseInt(form.visits_used)||0,
      evals_authorized: parseInt(form.evals_authorized)||0,
      evals_used: parseInt(form.evals_used)||0,
      reassessments_authorized: parseInt(form.reassessments_authorized)||0,
      reassessments_used: parseInt(form.reassessments_used)||0,
    });
    delete payload.visits_remaining; // generated column
 
    if (form.id) {
      await supabase.from('auth_tracker').update(payload).eq('id', form.id);
    } else {
      payload.created_at = now;
      await supabase.from('auth_tracker').insert([payload]);
    }
 
    // Generate alerts for care coord if needed
    if (alertLow || alertExpiry || status === 'renewal_needed') {
      var alertInserts = [];
      if (alertLow) {
        alertInserts.push({
          alert_type: 'auth_expiring',
          priority: remaining <= 3 ? 'critical' : 'high',
          title: 'Low Auth Visits: ' + form.patient_name,
          message: remaining + ' visits remaining (of ' + form.visits_authorized + '). Submit renewal now to avoid gap in care.',
          patient_name: form.patient_name, region: form.region,
          assigned_to_region: form.region, is_read: false, is_dismissed: false,
        });
      }
      if (alertExpiry && daysToExpiry !== null) {
        alertInserts.push({
          alert_type: 'auth_expiring',
          priority: daysToExpiry <= 7 ? 'critical' : 'high',
          title: 'Auth Expiring: ' + form.patient_name,
          message: 'Authorization expires in ' + daysToExpiry + ' days (' + form.auth_expiry_date + '). Submit renewal immediately.',
          patient_name: form.patient_name, region: form.region,
          assigned_to_region: form.region, is_read: false, is_dismissed: false,
        });
      }
      if (alertInserts.length > 0) {
        await supabase.from('alerts').insert(alertInserts);
      }
    }
 
    setShowModal(false);
    setEditPatient(null);
    fetchPatients();
  }
 
  var filtered = useMemo(function() {
    return patients.filter(function(p) {
      if (regionFilter !== 'ALL' && p.region !== regionFilter) return false;
      if (insuranceFilter !== 'ALL' && p.insurance !== insuranceFilter) return false;
      if (statusFilter !== 'ALL' && p.auth_status !== statusFilter) return false;
      if (ownerFilter !== 'ALL' && p.auth_owner !== ownerFilter) return false;
      if (alertFilter && !p.alert_low_visits && !p.alert_expiry) return false;
      if (search) {
        var q = search.toLowerCase();
        if (!p.patient_name.toLowerCase().includes(q) && !(p.member_id||'').toLowerCase().includes(q) && !(p.insurance||'').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [patients, regionFilter, insuranceFilter, statusFilter, ownerFilter, alertFilter, search]);
 
  var stats = useMemo(function() {
    return {
      total: patients.length,
      active: patients.filter(function(p){return p.auth_status==='active';}).length,
      pending: patients.filter(function(p){return p.auth_status==='pending'||p.auth_status==='submitted';}).length,
      renewalNeeded: patients.filter(function(p){return p.auth_status==='renewal_needed'||p.alert_low_visits;}).length,
      denied: patients.filter(function(p){return p.auth_status==='denied';}).length,
      alerts: patients.filter(function(p){return p.alert_low_visits||p.alert_expiry;}).length,
    };
  }, [patients]);
 
  var SEL = { padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--card-bg)', color: 'var(--black)', outline: 'none' };
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Authorization Tracker"
        subtitle={filtered.length + ' patients \u00b7 ' + stats.renewalNeeded + ' renewals needed \u00b7 ' + stats.alerts + ' alerts'}
        actions={
          <button onClick={function(){setEditPatient({}); setShowModal(true);}}
            style={{ padding: '8px 16px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            + Add Patient
          </button>
        }
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
 
        {/* Summary Strip */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--card-bg)', flexShrink: 0 }}>
          {[
            { label: 'Total Patients', val: stats.total, color: 'var(--black)' },
            { label: 'Active Auths', val: stats.active, color: 'var(--green)' },
            { label: 'Pending / Submitted', val: stats.pending, color: 'var(--blue)' },
            { label: 'Renewal Needed', val: stats.renewalNeeded, color: 'var(--danger)', alert: stats.renewalNeeded > 0 },
            { label: 'Denied', val: stats.denied, color: '#991B1B', alert: stats.denied > 0 },
            { label: 'Alerts', val: stats.alerts, color: stats.alerts > 0 ? 'var(--danger)' : 'var(--green)', alert: stats.alerts > 0 },
          ].map(function(tile){
            return (
              <div key={tile.label} style={{ flex: 1, padding: '12px 16px', borderRight: '1px solid var(--border)', textAlign: 'center', background: tile.alert ? '#FFF5F5' : 'transparent' }}>
                <div style={{ fontSize: 10, color: 'var(--gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{tile.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: tile.color, marginTop: 3 }}>{tile.val}</div>
              </div>
            );
          })}
        </div>
 
        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Search patient, member ID, insurance..."
            value={search} onChange={function(e){setSearch(e.target.value);}}
            style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', minWidth: 220 }} />
          <select value={regionFilter} onChange={function(e){setRegionFilter(e.target.value);}} style={SEL}>
            <option value="ALL">All Regions</option>
            {REGIONS.map(function(r){return React.createElement('option',{key:r,value:r},'Region '+r);})}
          </select>
          <select value={insuranceFilter} onChange={function(e){setInsuranceFilter(e.target.value);}} style={SEL}>
            <option value="ALL">All Insurance</option>
            {INSURANCES.map(function(i){return React.createElement('option',{key:i,value:i},i);})}
          </select>
          <select value={statusFilter} onChange={function(e){setStatusFilter(e.target.value);}} style={SEL}>
            <option value="ALL">All Statuses</option>
            {Object.entries(STATUS_STYLES).map(function(entry){return React.createElement('option',{key:entry[0],value:entry[0]},entry[1].label);})}
          </select>
          <select value={ownerFilter} onChange={function(e){setOwnerFilter(e.target.value);}} style={SEL}>
            <option value="ALL">All Auth Owners</option>
            {AUTH_OWNERS.map(function(o){return React.createElement('option',{key:o,value:o},o);})}
          </select>
          <button
            onClick={function(){setAlertFilter(!alertFilter);}}
            style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border)', background: alertFilter ? '#FEF2F2' : 'var(--card-bg)', color: alertFilter ? '#DC2626' : 'var(--gray)' }}>
            {alertFilter ? '\uD83D\uDD34 Alerts Only' : 'Show Alerts Only'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--gray)', marginLeft: 'auto' }}>{filtered.length} of {patients.length} patients</span>
        </div>
 
        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0 0 20px' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)' }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--gray)' }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>\uD83D\uDD10</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--black)', marginBottom: 8 }}>{patients.length === 0 ? 'No patients yet' : 'No patients match filters'}</div>
              {patients.length === 0 && <div style={{ fontSize: 13, color: 'var(--gray)' }}>Click "+ Add Patient" to start tracking authorizations</div>}
            </div>
          ) : (
            <div style={{ background: 'var(--card-bg)', margin: '16px 20px', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.6fr 1fr 1.4fr 0.8fr 1.6fr 1fr 0.8fr', padding: '8px 20px', background: 'var(--bg)', borderBottom: '2px solid var(--border)', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <span>Patient</span><span>Rgn</span><span>Insurance</span>
                <span>Auth Status</span><span>Owner</span>
                <span>Visits Remaining</span><span>Expiry</span><span>Actions</span>
              </div>
              {filtered.map(function(p, i) {
                var ss = STATUS_STYLES[p.auth_status] || STATUS_STYLES.pending;
                var ps = PATIENT_STATUS_STYLES[p.patient_status] || PATIENT_STATUS_STYLES.active;
                var isAlert = p.alert_low_visits || p.alert_expiry;
                var today = new Date();
                var expiry = p.auth_expiry_date ? new Date(p.auth_expiry_date) : null;
                var daysLeft = expiry ? Math.floor((expiry - today) / (1000*60*60*24)) : null;
                return (
                  <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '2fr 0.6fr 1fr 1.4fr 0.8fr 1.6fr 1fr 0.8fr', padding: '12px 20px', alignItems: 'center', borderBottom: '1px solid var(--border)', background: isAlert ? '#FFFBF5' : i%2===0 ? 'var(--card-bg)' : 'var(--bg)' }}>
                    <div>
                      <button onClick={function(){setSelectedPatient(p);}} style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>{p.patient_name}</div>
                      </button>
                      <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, color: ps.color, background: ps.bg, padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                          {(p.patient_status||'active').replace('_',' ')}
                        </span>
                        {p.member_id && <span style={{ fontSize: 10, color: 'var(--gray)' }}>#{p.member_id}</span>}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)' }}>{p.region || '\u2014'}</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--black)' }}>{p.insurance}</div>
                      <div style={{ fontSize: 10, color: 'var(--gray)' }}>{p.insurance_type === 'medicare' ? 'Medicare (20 visits)' : 'Standard'}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: ss.color, background: ss.bg, padding: '3px 10px', borderRadius: 999 }}>{ss.label}</span>
                      {isAlert && <span style={{ fontSize: 10, color: '#DC2626', marginLeft: 6 }}>\uD83D\uDD14</span>}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--gray)' }}>{p.auth_owner ? p.auth_owner.split(' ')[0] : '\u2014'}</span>
                    <VisitsBar used={p.visits_used} authorized={p.visits_authorized} />
                    <div>
                      {expiry ? (
                        <div>
                          <div style={{ fontSize: 11, fontFamily: 'DM Mono, monospace', fontWeight: 600, color: daysLeft !== null && daysLeft <= 30 ? '#DC2626' : 'var(--black)' }}>
                            {expiry.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                          </div>
                          {daysLeft !== null && (
                            <div style={{ fontSize: 10, color: daysLeft <= 7 ? '#DC2626' : daysLeft <= 30 ? '#F59E0B' : 'var(--gray)', fontWeight: daysLeft <= 30 ? 600 : 400 }}>
                              {daysLeft < 0 ? 'EXPIRED' : daysLeft + ' days'}
                            </div>
                          )}
                        </div>
                      ) : <span style={{ color: 'var(--gray)', fontSize: 11 }}>\u2014</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={function(){setSelectedPatient(p);}} style={{ padding: '4px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, cursor: 'pointer', color: 'var(--black)' }}>View</button>
                      <button onClick={function(){setEditPatient(p); setShowModal(true);}} style={{ padding: '4px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, cursor: 'pointer', color: 'var(--black)' }}>Edit</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
 
      {showModal && (
        <PatientModal
          patient={editPatient || {}}
          onClose={function(){setShowModal(false); setEditPatient(null);}}
          onSave={savePatient}
        />
      )}
 
      {selectedPatient && (
        <PatientProfile
          patient={selectedPatient}
          onClose={function(){setSelectedPatient(null);}}
          onEdit={function(){setEditPatient(selectedPatient); setShowModal(true); setSelectedPatient(null);}}
          onRefresh={fetchPatients}
        />
      )}
    </div>
  );
}
 
function PatientProfile(props) {
  var p = props.patient;
  var [tab, setTab] = useState('overview');
  var [visitHistory, setVisitHistory] = useState([]);
  var [documents, setDocuments] = useState([]);
  var [uploading, setUploading] = useState(false);
  var [docType, setDocType] = useState('auth_request');
  var [docLabel, setDocLabel] = useState('');
  var fileRef = React.useRef();
 
  useEffect(function(){
    supabase.from('patient_visit_history').select('*').eq('patient_name', p.patient_name).order('visit_date', {ascending: false}).limit(100)
      .then(function(res){ setVisitHistory(res.data||[]); });
    supabase.from('patient_documents').select('*').eq('patient_name', p.patient_name).order('created_at', {ascending: false})
      .then(function(res){ setDocuments(res.data||[]); });
  }, [p.patient_name]);
 
  async function uploadDocument(file) {
    if (!file) return;
    setUploading(true);
    var path = p.patient_name.replace(/[^a-z0-9]/gi,'_') + '/' + Date.now() + '_' + file.name;
    var { error } = await supabase.storage.from('patient-documents').upload(path, file);
    if (!error) {
      // Mark previous docs of same type as not latest
      await supabase.from('patient_documents').update({ is_latest: false })
        .eq('patient_name', p.patient_name).eq('doc_type', docType);
      await supabase.from('patient_documents').insert([{
        patient_name: p.patient_name,
        auth_tracker_id: p.id,
        region: p.region,
        doc_type: docType,
        doc_label: docLabel || (docType.replace(/_/g,' ') + ' - ' + new Date().toLocaleDateString()),
        file_name: file.name,
        file_path: path,
        file_size: file.size,
        file_type: file.type,
        is_latest: true,
        auth_number: p.auth_number,
        uploaded_by: 'Liam O\'Brien',
        effective_date: new Date().toISOString().split('T')[0],
      }]);
      supabase.from('patient_documents').select('*').eq('patient_name', p.patient_name).order('created_at', {ascending: false})
        .then(function(res){ setDocuments(res.data||[]); });
      setDocLabel('');
    }
    setUploading(false);
  }
 
  async function getDocUrl(path) {
    var { data } = await supabase.storage.from('patient-documents').createSignedUrl(path, 3600);
    if (data) window.open(data.signedUrl, '_blank');
  }
 
  var ss = STATUS_STYLES[p.auth_status] || STATUS_STYLES.pending;
  var remaining = Math.max((p.visits_authorized||0) - (p.visits_used||0), 0);
 
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}>
      <div style={{ width: 680, height: '100vh', background: 'var(--card-bg)', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 40px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
 
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', background: 'var(--red)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{p.patient_name}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: ss.color, background: ss.bg, padding: '2px 8px', borderRadius: 999 }}>{ss.label}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)' }}>Region {p.region}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)' }}>{p.insurance}</span>
                {p.auth_number && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)' }}>Auth #{p.auth_number}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={props.onEdit} style={{ padding: '6px 14px', background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Edit</button>
              <button onClick={props.onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', padding: 4 }}>&#10005;</button>
            </div>
          </div>
        </div>
 
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0 }}>
          {[['overview','Overview'],['visits','Visit History'],['documents','Documents']].map(function(t){
            return (
              <button key={t[0]} onClick={function(){setTab(t[0]);}}
                style={{ padding: '10px 20px', border: 'none', borderBottom: tab===t[0]?'2px solid var(--red)':'2px solid transparent', background: 'none', fontSize: 13, fontWeight: tab===t[0]?700:500, color: tab===t[0]?'var(--black)':'var(--gray)', cursor: 'pointer' }}>
                {t[1]}
                {t[0]==='documents' && documents.length>0 && <span style={{marginLeft:6,background:'var(--red)',color:'#fff',borderRadius:999,padding:'0px 5px',fontSize:10,fontWeight:700}}>{documents.length}</span>}
              </button>
            );
          })}
        </div>
 
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
 
          {tab === 'overview' && (
            <div>
              {/* Visits Summary */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
                {[
                  { label: 'Visits Remaining', val: remaining, total: p.visits_authorized, color: remaining<=3?'#DC2626':remaining<=7?'#F59E0B':'#065F46' },
                  { label: 'Evals Remaining', val: Math.max((p.evals_authorized||0)-(p.evals_used||0),0), total: p.evals_authorized, color: '#1565C0' },
                  { label: 'Re-Assessments Left', val: Math.max((p.reassessments_authorized||0)-(p.reassessments_used||0),0), total: p.reassessments_authorized, color: '#7C3AED' },
                ].map(function(item){
                  return (
                    <div key={item.label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{item.label}</div>
                      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: item.color }}>{item.val}</div>
                      <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>of {item.total||0} authorized</div>
                    </div>
                  );
                })}
              </div>
 
              {/* Key Dates */}
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Key Dates</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
                  {[['SOC Date',p.soc_date],['Auth Submitted',p.auth_submitted_date],['Needed By',p.auth_needed_by],['Auth Approved',p.auth_approved_date],['Auth Expires',p.auth_expiry_date]].map(function(item){
                    if (!item[1]) return null;
                    return (
                      <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 12, color: 'var(--gray)' }}>{item[0]}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'DM Mono, monospace', color: 'var(--black)' }}>
                          {new Date(item[1]+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
 
              {/* Patient + PCP Details */}
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Patient &amp; PCP</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
                  {[['Member ID',p.member_id],['DOB',p.dob],['Phone',p.phone],['Auth Owner',p.auth_owner],['PCP',p.pcp_name],['PCP Phone',p.pcp_phone],['PCP Fax',p.pcp_fax],['Facility',p.pcp_facility]].map(function(item){
                    if (!item[1]) return null;
                    return (
                      <div key={item[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 12, color: 'var(--gray)' }}>{item[0]}</span>
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--black)', textAlign: 'right', maxWidth: 200 }}>{String(item[1])}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
 
              {p.notes && (
                <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', marginBottom: 6 }}>NOTES</div>
                  <div style={{ fontSize: 13, color: '#92400E' }}>{p.notes}</div>
                </div>
              )}
            </div>
          )}
 
          {tab === 'visits' && (
            <div>
              {visitHistory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>📋</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)' }}>No visit history yet</div>
                  <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 4 }}>Visit records are automatically added when Pariox data is uploaded</div>
                </div>
              ) : (
                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr 1fr 0.8fr', padding: '8px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <span>Date</span><span>Clinician</span><span>Type</span><span>Status</span><span>Billed</span>
                  </div>
                  {visitHistory.map(function(v){
                    return (
                      <div key={v.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr 1fr 0.8fr', padding: '10px 16px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace' }}>{v.visit_date}</span>
                        <span style={{ fontSize: 12, color: 'var(--gray)' }}>{v.clinician_name}</span>
                        <span style={{ fontSize: 11, color: 'var(--gray)' }}>{v.visit_type}</span>
                        <span style={{ fontSize: 11, color: 'var(--gray)' }}>{v.status}</span>
                        <span style={{ fontSize: 11, color: v.note_submitted?'var(--green)':'var(--danger)', fontWeight: 600 }}>{v.note_submitted?'Yes':'No'}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
 
          {tab === 'documents' && (
            <div>
              {/* Upload Section */}
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--black)', marginBottom: 12 }}>Upload Document</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <select value={docType} onChange={function(e){setDocType(e.target.value);}}
                    style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, background: 'var(--card-bg)', outline: 'none', flex: 1 }}>
                    <option value="auth_request">Auth Request</option>
                    <option value="auth_approval">Auth Approval</option>
                    <option value="auth_denial">Auth Denial</option>
                    <option value="appeal">Appeal</option>
                    <option value="clinical_notes">Clinical Notes</option>
                    <option value="other">Other</option>
                  </select>
                  <input placeholder="Label (optional)" value={docLabel} onChange={function(e){setDocLabel(e.target.value);}}
                    style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, background: 'var(--card-bg)', outline: 'none', flex: 2 }} />
                </div>
                <div
                  onClick={function(){if(fileRef.current)fileRef.current.click();}}
                  style={{ border: '2px dashed var(--border)', borderRadius: 8, padding: '20px', textAlign: 'center', cursor: 'pointer', background: 'var(--card-bg)' }}>
                  <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" style={{ display: 'none' }}
                    onChange={function(e){if(e.target.files[0])uploadDocument(e.target.files[0]);}} />
                  {uploading ? (
                    <div style={{ fontSize: 13, color: 'var(--blue)' }}>Uploading...</div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 22, marginBottom: 6 }}>📎</div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--black)' }}>Click to upload or drag &amp; drop</div>
                      <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 3 }}>PDF, JPG, PNG, DOC up to 50MB</div>
                    </div>
                  )}
                </div>
              </div>
 
              {/* Document List */}
              {documents.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: 'var(--gray)' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)' }}>No documents yet</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>Upload auth requests and approvals above</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {documents.map(function(doc){
                    var typeColors = { auth_request:'#EFF6FF', auth_approval:'#ECFDF5', auth_denial:'#FEF2F2', appeal:'#F5F3FF', clinical_notes:'#FEF3C7', other:'#F9FAFB' };
                    return (
                      <div key={doc.id} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 36, height: 36, borderRadius: 8, background: typeColors[doc.doc_type]||'#F9FAFB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>📄</div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>{doc.doc_label || doc.file_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>
                              {doc.doc_type.replace(/_/g,' ')} · {new Date(doc.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                              {doc.is_latest && <span style={{ marginLeft: 8, background: '#ECFDF5', color: '#065F46', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>LATEST</span>}
                            </div>
                          </div>
                        </div>
                        <button onClick={function(){getDocUrl(doc.file_path);}}
                          style={{ padding: '6px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, cursor: 'pointer', color: 'var(--black)', fontWeight: 600 }}>
                          Open
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
 
