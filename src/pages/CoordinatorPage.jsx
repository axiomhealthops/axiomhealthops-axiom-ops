import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
 
var COORD_MAP = {
  A: 'Gypsy Renos',
  B: 'Mary Imperio', C: 'Mary Imperio', G: 'Mary Imperio',
  H: 'Audrey Sarmiento', J: 'Audrey Sarmiento', M: 'Audrey Sarmiento', N: 'Audrey Sarmiento',
  T: 'April Manalo', V: 'April Manalo',
};
 
var REGION_GROUPS = {
  'Gypsy Renos':       ['A'],
  'Mary Imperio':      ['B', 'C', 'G'],
  'Audrey Sarmiento':  ['H', 'J', 'M', 'N'],
  'April Manalo':      ['T', 'V'],
};
 
var TASK_CONFIG = {
  eval_scheduling:    { label: 'Schedule Eval',       icon: '🔵', color: '#1E40AF', bg: '#EFF6FF' },
  new_referral:       { label: 'New Referral',        icon: '🟢', color: '#065F46', bg: '#ECFDF5' },
  auth_renewal:       { label: 'Auth Renewal',        icon: '🟡', color: '#92400E', bg: '#FEF3C7' },
  auth_critical:      { label: 'Auth Critical',       icon: '🔴', color: '#991B1B', bg: '#FEF2F2' },
  auth_expired:       { label: 'Auth Expired',        icon: '⛔', color: '#7F1D1D', bg: '#FEF2F2' },
  missed_visit:       { label: 'Missed Visit',        icon: '⚠️', color: '#92400E', bg: '#FEF3C7' },
  cancelled_visit:    { label: 'Cancelled Visit',     icon: '❌', color: '#92400E', bg: '#FEF3C7' },
  note_not_submitted: { label: 'Note Not Submitted',  icon: '📋', color: '#991B1B', bg: '#FEF2F2' },
  hospitalized:       { label: '48hr Follow-Up',      icon: '🏥', color: '#5B21B6', bg: '#EDE9FE' },
  discharge_pending:  { label: 'Discharge Pending',   icon: '🏠', color: '#374151', bg: '#F3F4F6' },
  general:            { label: 'General Task',        icon: '📝', color: '#374151', bg: '#F9FAFB' },
};
 
var PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
var PRIORITY_STYLE = {
  critical: { color: '#991B1B', bg: '#FEF2F2', label: 'Critical' },
  high:     { color: '#92400E', bg: '#FEF3C7', label: 'High' },
  medium:   { color: '#1E40AF', bg: '#EFF6FF', label: 'Medium' },
  low:      { color: '#374151', bg: '#F3F4F6', label: 'Low' },
};
 
function TaskCard(props) {
  var task = props.task;
  var tc = TASK_CONFIG[task.task_type] || TASK_CONFIG.general;
  var pc = PRIORITY_STYLE[task.priority] || PRIORITY_STYLE.medium;
  var [completing, setCompleting] = useState(false);
  var [notes, setNotes] = useState('');
  var [showNotes, setShowNotes] = useState(false);
  var isAuto = task.auto_generated;

  async function markComplete() {
    setCompleting(true);
    var n = notes || null;
    if (isAuto) {
      // Auto-generated tasks don't exist in coordinator_tasks — persist to action_responses
      var existing = props.autoResponses && props.autoResponses[task.id];
      if (existing) {
        await supabase.from('action_responses').update({
          status: 'completed', notes: n, updated_at: new Date().toISOString(),
        }).eq('action_key', task.id);
      } else {
        await supabase.from('action_responses').insert({
          action_key: task.id, status: 'completed', notes: n,
          responder_name: props.coordName || 'Coordinator',
        });
      }
    } else {
      await supabase.from('coordinator_tasks').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        completion_notes: n,
      }).eq('id', task.id);
    }
    setCompleting(false);
    setShowNotes(false);
    setNotes('');
    props.onRefresh();
  }

  async function markDismiss() {
    if (isAuto) {
      var existing = props.autoResponses && props.autoResponses[task.id];
      if (existing) {
        await supabase.from('action_responses').update({
          status: 'dismissed', updated_at: new Date().toISOString(),
        }).eq('action_key', task.id);
      } else {
        await supabase.from('action_responses').insert({
          action_key: task.id, status: 'dismissed',
          responder_name: props.coordName || 'Coordinator',
        });
      }
    } else {
      await supabase.from('coordinator_tasks').update({ status: 'dismissed' }).eq('id', task.id);
    }
    props.onRefresh();
  }

  async function markInProgress() {
    if (isAuto) {
      var existing = props.autoResponses && props.autoResponses[task.id];
      if (existing) {
        await supabase.from('action_responses').update({
          status: 'started', updated_at: new Date().toISOString(),
        }).eq('action_key', task.id);
      } else {
        await supabase.from('action_responses').insert({
          action_key: task.id, status: 'started',
          responder_name: props.coordName || 'Coordinator',
        });
      }
    } else {
      await supabase.from('coordinator_tasks').update({ status: 'in_progress' }).eq('id', task.id);
    }
    props.onRefresh();
  }
 
  var isOverdue = task.due_date && new Date(task.due_date) < new Date();
  var autoResp = isAuto && props.autoResponses ? props.autoResponses[task.id] : null;
  var effectiveStatus = isAuto ? (autoResp ? autoResp.status : 'open') : task.status;
  var isInProgress = effectiveStatus === 'in_progress' || effectiveStatus === 'started';

  return (
    <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 10, padding: '14px 16px', borderLeft: '4px solid ' + pc.color }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 14 }}>{tc.icon}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: tc.color, background: tc.bg, padding: '2px 7px', borderRadius: 999 }}>{tc.label}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: pc.color, background: pc.bg, padding: '2px 7px', borderRadius: 999 }}>{pc.label}</span>
            {isInProgress && (
              <span style={{ fontSize: 10, fontWeight: 700, color: '#1E40AF', background: '#DBEAFE', padding: '2px 7px', borderRadius: 999 }}>In Progress</span>
            )}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 4 }}>{task.title}</div>
          {task.description && <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5 }}>{task.description}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            {task.patient_name && (
              <span style={{ fontSize: 11, color: '#374151', background: '#F3F4F6', padding: '2px 8px', borderRadius: 6 }}>
                Patient: {task.patient_name}
              </span>
            )}
            {task.frequency && (
              <span style={{ fontSize: 11, color: '#1E40AF', background: '#DBEAFE', padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>
                {task.frequency}
              </span>
            )}
            {task.clinician_name && (
              <span style={{ fontSize: 11, color: '#374151', background: '#F3F4F6', padding: '2px 8px', borderRadius: 6 }}>
                Clinician: {task.clinician_name}
              </span>
            )}
            {task.due_date && (
              <span style={{ fontSize: 11, color: isOverdue ? '#DC2626' : '#374151', fontWeight: isOverdue ? 700 : 400, background: isOverdue ? '#FEF2F2' : '#F3F4F6', padding: '2px 8px', borderRadius: 6 }}>
                Due: {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {isOverdue ? ' ⚠ Overdue' : ''}
              </span>
            )}
          </div>
        </div>
 
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          {effectiveStatus === 'open' && (
            <button onClick={markInProgress}
              style={{ padding: '5px 10px', background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Start
            </button>
          )}
          <button onClick={function() { setShowNotes(!showNotes); }}
            style={{ padding: '5px 10px', background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            ✓ Done
          </button>
          <button onClick={markDismiss}
            style={{ padding: '5px 10px', background: 'none', color: '#9CA3AF', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>
            Dismiss
          </button>
        </div>
      </div>
 
      {showNotes && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #E5E7EB' }}>
          <textarea
            placeholder="Add completion notes (optional)..."
            value={notes}
            onChange={function(e) { setNotes(e.target.value); }}
            rows={2}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={markComplete} disabled={completing}
              style={{ padding: '6px 16px', background: completing ? '#9CA3AF' : '#065F46', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: completing ? 'wait' : 'pointer' }}>
              {completing ? 'Saving...' : 'Mark Complete'}
            </button>
            <button onClick={function() { setShowNotes(false); }}
              style={{ padding: '6px 12px', background: 'none', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
 
function AddTaskModal(props) {
  var [form, setForm] = useState({
    task_type: 'general', priority: 'medium', title: '', description: '',
    patient_name: '', clinician_name: '', due_date: '',
  });
 
  function set(f, v) { setForm(Object.assign({}, form, { [f]: v })); }
 
  async function handleSave() {
    if (!form.title.trim()) { alert('Title is required'); return; }
    await supabase.from('coordinator_tasks').insert([{
      task_type: form.task_type,
      priority: form.priority,
      title: form.title,
      description: form.description || null,
      patient_name: form.patient_name || null,
      clinician_name: form.clinician_name || null,
      due_date: form.due_date || null,
      coordinator_region: props.primaryRegion,
      assigned_to: props.coordName,
      status: 'open',
      auto_generated: false,
    }]);
    props.onSave();
  }
 
  var INP = { padding: '8px 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 13, background: '#F9FAFB', color: '#111827', outline: 'none', width: '100%' };
  var LBL = { fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'block' };
 
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 12, width: '100%', maxWidth: 560, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>Add Task</div>
          <button onClick={props.onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: '#9CA3AF', cursor: 'pointer' }}>&#10005;</button>
        </div>
 
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={LBL}>Task Type</label>
            <select style={INP} value={form.task_type} onChange={function(e){set('task_type',e.target.value)}}>
              {Object.entries(TASK_CONFIG).map(function(entry) {
                return <option key={entry[0]} value={entry[0]}>{entry[1].label}</option>;
              })}
            </select>
          </div>
          <div>
            <label style={LBL}>Priority</label>
            <select style={INP} value={form.priority} onChange={function(e){set('priority',e.target.value)}}>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
 
        <div style={{ marginBottom: 12 }}>
          <label style={LBL}>Title *</label>
          <input style={INP} value={form.title} onChange={function(e){set('title',e.target.value)}} placeholder="What needs to be done?" />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={LBL}>Description</label>
          <textarea rows={2} style={Object.assign({},INP,{resize:'vertical',fontFamily:'inherit'})} value={form.description} onChange={function(e){set('description',e.target.value)}} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div><label style={LBL}>Patient</label><input style={INP} value={form.patient_name} onChange={function(e){set('patient_name',e.target.value)}} /></div>
          <div><label style={LBL}>Clinician</label><input style={INP} value={form.clinician_name} onChange={function(e){set('clinician_name',e.target.value)}} /></div>
          <div><label style={LBL}>Due Date</label><input type="date" style={INP} value={form.due_date} onChange={function(e){set('due_date',e.target.value)}} /></div>
        </div>
 
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={props.onClose} style={{ padding: '9px 18px', background: 'none', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} style={{ padding: '9px 20px', background: '#D94F2B', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Add Task</button>
        </div>
      </div>
    </div>
  );
}
 
export default function CoordinatorPage(props) {
  var coordName = props.coordName || 'Gypsy Renos';
  var regions = REGION_GROUPS[coordName] || ['A'];
  var primaryRegion = regions[0];
 
  var [tasks, setTasks] = useState([]);
  var [authRecords, setAuthRecords] = useState([]);
  var [autoResponses, setAutoResponses] = useState({});
  var [loading, setLoading] = useState(true);
  var [activeTab, setActiveTab] = useState('today');
  var [showModal, setShowModal] = useState(false);
  var [typeFilter, setTypeFilter] = useState('ALL');

  function fetchTasks() {
    Promise.all([
      supabase.from('coordinator_tasks')
        .select('*')
        .in('coordinator_region', regions)
        .in('status', ['open', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('auth_tracker')
        .select('id, patient_name, insurance, region, auth_status, visits_authorized, visits_used, auth_expiry_date, soc_date, frequency')
        .in('region', regions)
        .in('auth_status', ['active', 'pending', 'renewal_needed']),
      supabase.from('action_responses')
        .select('*')
        .like('action_key', 'auto_%'),
    ]).then(function(results) {
      setTasks(results[0].data || []);
      setAuthRecords(results[1].data || []);
      // Build map of auto task responses keyed by action_key
      var respMap = {};
      (results[2].data || []).forEach(function(r) { respMap[r.action_key] = r; });
      setAutoResponses(respMap);
      setLoading(false);
    });
  }
 
  useEffect(function() { fetchTasks(); }, [coordName]);
 
  // Auto-generate tasks from auth records
  var autoTasks = useMemo(function() {
    var generated = [];
    var today = new Date(); today.setHours(0,0,0,0);
 
    authRecords.forEach(function(r) {
      var remaining = Math.max((r.visits_authorized || 0) - (r.visits_used || 0), 0);
      var expDays = r.auth_expiry_date ? Math.round((new Date(r.auth_expiry_date) - today) / (1000*60*60*24)) : null;
 
      if (remaining <= 7 && remaining > 0 && r.auth_status === 'active') {
        generated.push({
          id: 'auto_critical_' + r.id,
          task_type: 'auth_critical',
          priority: 'critical',
          title: 'Auth Critical: ' + r.patient_name,
          description: remaining + ' visits remaining with ' + r.insurance + (r.frequency ? ' (' + r.frequency + ')' : '') + '. Renewal needed immediately to avoid gap in care.',
          patient_name: r.patient_name,
          frequency: r.frequency || null,
          status: 'open',
          auto_generated: true,
          auth_tracker_id: r.id,
        });
      } else if (remaining <= 10 && remaining > 7 && r.auth_status === 'active') {
        generated.push({
          id: 'auto_renewal_' + r.id,
          task_type: 'auth_renewal',
          priority: 'high',
          title: 'Auth Renewal: ' + r.patient_name,
          description: remaining + ' visits remaining with ' + r.insurance + (r.frequency ? ' (' + r.frequency + ')' : '') + '. Submit renewal auth request.',
          patient_name: r.patient_name,
          frequency: r.frequency || null,
          status: 'open',
          auto_generated: true,
          auth_tracker_id: r.id,
        });
      }
 
      if (expDays !== null && expDays <= 14 && expDays >= 0) {
        generated.push({
          id: 'auto_expiry_' + r.id,
          task_type: expDays <= 3 ? 'auth_critical' : 'auth_renewal',
          priority: expDays <= 3 ? 'critical' : 'high',
          title: 'Auth Expiring: ' + r.patient_name,
          description: 'Auth expires in ' + expDays + ' day' + (expDays !== 1 ? 's' : '') + ' (' + r.insurance + '). Contact PCP to renew.',
          patient_name: r.patient_name,
          status: 'open',
          auto_generated: true,
          auth_tracker_id: r.id,
        });
      }
 
      if (expDays !== null && expDays < 0) {
        generated.push({
          id: 'auto_expired_' + r.id,
          task_type: 'auth_expired',
          priority: 'critical',
          title: 'Auth EXPIRED: ' + r.patient_name,
          description: 'Authorization expired ' + Math.abs(expDays) + ' day' + (Math.abs(expDays) !== 1 ? 's' : '') + ' ago (' + r.insurance + '). Do not see patient until resolved.',
          patient_name: r.patient_name,
          status: 'open',
          auto_generated: true,
          auth_tracker_id: r.id,
        });
      }
    });
 
    return generated;
  }, [authRecords]);
 
  // Merge manual tasks + auto tasks, filtering out completed/dismissed auto tasks
  var allTasks = useMemo(function() {
    var filteredAuto = autoTasks.filter(function(t) {
      var resp = autoResponses[t.id];
      return !resp || (resp.status !== 'completed' && resp.status !== 'dismissed');
    });
    var combined = tasks.concat(filteredAuto);
    if (typeFilter !== 'ALL') combined = combined.filter(function(t) { return t.task_type === typeFilter; });
    combined.sort(function(a, b) {
      var pa = PRIORITY_ORDER[a.priority] ?? 9;
      var pb = PRIORITY_ORDER[b.priority] ?? 9;
      return pa - pb;
    });
    return combined;
  }, [tasks, autoTasks, typeFilter, autoResponses]);
 
  var todayTasks = allTasks.filter(function(t) {
    return t.priority === 'critical' || t.priority === 'high' || t.task_type === 'auth_expired';
  });
 
  var counts = {
    critical: allTasks.filter(function(t) { return t.priority === 'critical'; }).length,
    high: allTasks.filter(function(t) { return t.priority === 'high'; }).length,
    auth: allTasks.filter(function(t) { return t.task_type.startsWith('auth'); }).length,
  };
 
  var displayTasks = activeTab === 'today' ? todayTasks : allTasks;
  var today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
 
  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB', fontFamily: 'DM Sans, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#0F1117', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: '#D94F2B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: '#fff' }}>A</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>AxiomHealth</div>
            <div style={{ fontSize: 11, color: '#6B7280' }}>Care Coordinator</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#D1D5DB' }}>{coordName}</div>
          <div style={{ fontSize: 11, color: '#6B7280' }}>Regions: {regions.join(', ')} &middot; {today}</div>
        </div>
      </div>
 
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px' }}>
 
        {/* Summary tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Total Open Tasks',  val: allTasks.length,   color: '#111827', bg: 'white' },
            { label: 'Critical',          val: counts.critical,   color: '#DC2626', bg: '#FEF2F2', alert: counts.critical > 0 },
            { label: 'High Priority',     val: counts.high,       color: '#D97706', bg: '#FEF3C7', alert: counts.high > 0 },
            { label: 'Auth Issues',       val: counts.auth,       color: '#7C3AED', bg: '#EDE9FE', alert: counts.auth > 0 },
          ].map(function(tile) {
            return (
              <div key={tile.label} style={{ background: tile.bg || 'white', border: '1px solid #E5E7EB', borderRadius: 10, padding: '14px 16px', textAlign: 'center', boxShadow: tile.alert ? '0 0 0 2px ' + tile.color + '33' : 'none' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{tile.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: tile.color, marginTop: 4 }}>{tile.val}</div>
              </div>
            );
          })}
        </div>
 
        {/* Auth quick view */}
        {authRecords.length > 0 && (
          <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 12 }}>
              Auth Status &mdash; Regions {regions.join(', ')} ({authRecords.length} patients)
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {[
                { label: 'Active', count: authRecords.filter(function(r){return r.auth_status==='active'}).length, color: '#065F46', bg: '#ECFDF5' },
                { label: 'Pending', count: authRecords.filter(function(r){return r.auth_status==='pending'}).length, color: '#92400E', bg: '#FEF3C7' },
                { label: '\u22647 Visits Left', count: authRecords.filter(function(r){return Math.max((r.visits_authorized||0)-(r.visits_used||0),0)<=7 && r.auth_status==='active'}).length, color: '#DC2626', bg: '#FEF2F2' },
                { label: 'Expiring 30d', count: authRecords.filter(function(r){ if(!r.auth_expiry_date) return false; var d=Math.round((new Date(r.auth_expiry_date)-new Date())/(1000*60*60*24)); return d>=0&&d<=30; }).length, color: '#D97706', bg: '#FEF3C7' },
              ].map(function(s) {
                return (
                  <div key={s.label} style={{ background: s.bg, borderRadius: 8, padding: '8px 14px', textAlign: 'center', minWidth: 90 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: s.color }}>{s.count}</div>
                    <div style={{ fontSize: 10, color: s.color, fontWeight: 600, marginTop: 2 }}>{s.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
 
        {/* Tabs + Add */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 4, background: 'white', border: '1px solid #E5E7EB', borderRadius: 8, padding: 4 }}>
            {[
              { key: 'today', label: "Today's Priority (" + todayTasks.length + ')' },
              { key: 'all',   label: 'All Tasks (' + allTasks.length + ')' },
            ].map(function(tab) {
              var isActive = activeTab === tab.key;
              return (
                <button key={tab.key} onClick={function() { setActiveTab(tab.key); }}
                  style={{ padding: '7px 16px', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: isActive ? 600 : 500, cursor: 'pointer', background: isActive ? '#0F1117' : 'none', color: isActive ? '#fff' : '#6B7280' }}>
                  {tab.label}
                </button>
              );
            })}
          </div>
 
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={typeFilter} onChange={function(e) { setTypeFilter(e.target.value); }}
              style={{ padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, background: 'white', outline: 'none' }}>
              <option value="ALL">All Types</option>
              {Object.entries(TASK_CONFIG).map(function(entry) {
                return <option key={entry[0]} value={entry[0]}>{entry[1].label}</option>;
              })}
            </select>
            <button onClick={function() { setShowModal(true); }}
              style={{ padding: '7px 14px', background: '#D94F2B', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              + Add Task
            </button>
          </div>
        </div>
 
        {/* Task list */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF' }}>Loading tasks...</div>
        ) : displayTasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, background: 'white', borderRadius: 10, border: '1px solid #E5E7EB' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>&#9989;</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>
              {activeTab === 'today' ? 'No critical tasks today' : 'No open tasks'}
            </div>
            <div style={{ fontSize: 13, color: '#9CA3AF', marginTop: 6 }}>
              {activeTab === 'today' ? 'Switch to All Tasks to see lower priority items' : 'All caught up!'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {displayTasks.map(function(task) {
              return (
                <TaskCard key={task.id} task={task} onRefresh={fetchTasks} autoResponses={autoResponses} coordName={coordName} />
              );
            })}
          </div>
        )}
 
        {/* Completed today */}
        <CompletedSection regions={regions} />
      </div>
 
      {showModal && (
        <AddTaskModal
          coordName={coordName}
          primaryRegion={primaryRegion}
          onClose={function() { setShowModal(false); }}
          onSave={function() { setShowModal(false); fetchTasks(); }}
        />
      )}
    </div>
  );
}
 
function CompletedSection(props) {
  var [completed, setCompleted] = useState([]);
  var [show, setShow] = useState(false);
 
  useEffect(function() {
    if (!show) return;
    var today = new Date().toISOString().split('T')[0];
    supabase.from('coordinator_tasks')
      .select('*')
      .in('coordinator_region', props.regions)
      .eq('status', 'completed')
      .gte('completed_at', today)
      .order('completed_at', { ascending: false })
      .then(function(res) { setCompleted(res.data || []); });
  }, [show]);
 
  return (
    <div style={{ marginTop: 24 }}>
      <button onClick={function() { setShow(!show); }}
        style={{ fontSize: 13, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        {show ? '▼' : '▶'} Completed Today {completed.length > 0 ? '(' + completed.length + ')' : ''}
      </button>
      {show && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {completed.length === 0
            ? <div style={{ fontSize: 13, color: '#9CA3AF', padding: '12px 0' }}>No completed tasks yet today.</div>
            : completed.map(function(t) {
              var tc = TASK_CONFIG[t.task_type] || TASK_CONFIG.general;
              return (
                <div key={t.id} style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', opacity: 0.7 }}>
                  <span>&#10003;</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#374151', textDecoration: 'line-through' }}>{t.title}</span>
                    {t.completion_notes && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{t.completion_notes}</div>}
                  </div>
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>{tc.label}</span>
                </div>
              );
            })
          }
        </div>
      )}
    </div>
  );
}
 
