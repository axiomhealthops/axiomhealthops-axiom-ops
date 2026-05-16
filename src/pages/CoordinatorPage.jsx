import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import StatusChangeModal from '../components/StatusChangeModal';
 
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
  // Only treat tasks as "auto" if they are in-memory generated (IDs start with 'auto_').
  // Tasks from coordinator_tasks table with auto_generated=true still have real UUIDs
  // and must be updated via coordinator_tasks, not action_responses.
  var isAuto = task.auto_generated && typeof task.id === 'string' && task.id.startsWith('auto_');

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
            {task.patient_name && props.onStatusChange && (
              <button onClick={function(e) { e.stopPropagation(); props.onStatusChange(task.patient_name, task.coordinator_region || null); }}
                style={{ fontSize: 10, color: '#1E40AF', background: '#EFF6FF', border: '1px solid #BFDBFE', padding: '2px 8px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                Change Status ✎
              </button>
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
  var [census, setCensus] = useState([]);
  var [clinicians, setClinicians] = useState([]);
  var [weekVisits, setWeekVisits] = useState([]);
  var [autoResponses, setAutoResponses] = useState({});
  var [loading, setLoading] = useState(true);
  var [activeTab, setActiveTab] = useState('today');
  var [showModal, setShowModal] = useState(false);
  var [typeFilter, setTypeFilter] = useState('ALL');
  var [statusPatient, setStatusPatient] = useState(null);
  // Click-to-expand state for the pipeline grid. Object { region, bucket } or null.
  // Clicking a cell number opens an inline patient list directly below the grid;
  // clicking the same cell again closes it. Click a patient row → status edit modal.
  var [expandedCell, setExpandedCell] = useState(null);
  // Click-to-expand state for the priority opportunity cards. Stores the index
  // of the expanded card or null. Each opp carries its own `.items` array which
  // renders directly below the clicked card.
  var [expandedOpp, setExpandedOpp] = useState(null);

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
      // Census data for the pipeline overview and priority opportunities.
      // We fetch only the columns we need to keep the payload small.
      supabase.from('census_data')
        .select('id, patient_name, region, status, previous_status, insurance, last_visit_date, first_seen_date, last_seen_date, days_overdue')
        .in('region', regions),
      // Clinicians assigned to the coordinator's regions — used by the
      // productivity widget. Includes pariox_name + aliases for visit
      // attribution and weekly_visit_target/employment_type for pacing math.
      supabase.from('clinicians')
        .select('id, full_name, discipline, employment_type, region, weekly_visit_target, pariox_name, aliases, is_telehealth, is_active')
        .eq('is_active', true)
        .in('region', regions)
        .order('full_name'),
    ]).then(function(results) {
      setTasks(results[0].data || []);
      setAuthRecords(results[1].data || []);
      // Build map of auto task responses keyed by action_key
      var respMap = {};
      (results[2].data || []).forEach(function(r) { respMap[r.action_key] = r; });
      setAutoResponses(respMap);
      setCensus(results[3].data || []);
      setClinicians(results[4].data || []);

      // Visits for this week — paginated because a busy week can exceed
      // PostgREST's 1000-row default. We dedupe Pariox's duplicate
      // "Level 3 + Cancelled" pairs (matching ProductivityPage's logic).
      var weekStart = new Date();
      weekStart.setHours(0,0,0,0);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
      var weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      var weekStartStr = weekStart.toISOString().slice(0,10);
      var weekEndStr = weekEnd.toISOString().slice(0,10);

      var allVisits = [];
      function pull(from) {
        return supabase.from('visit_schedule_data')
          .select('staff_name,staff_name_normalized,visit_date,status,event_type,patient_name,region')
          .gte('visit_date', weekStartStr).lte('visit_date', weekEndStr)
          .not('event_type', 'ilike', '%(PDF)%')
          .range(from, from + 999)
          .then(function(res) {
            if (res.error || !res.data || res.data.length === 0) {
              setWeekVisits(allVisits);
              return;
            }
            for (var i = 0; i < res.data.length; i++) allVisits.push(res.data[i]);
            if (res.data.length < 1000) {
              setWeekVisits(allVisits);
              return;
            }
            return pull(from + 1000);
          });
      }
      pull(0);

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

  // ── Per-region pipeline overview ────────────────────────────────────────
  // For each region this coordinator covers, count patients by census status
  // bucket so the coordinator can see their pipeline at a glance.
  var regionPipeline = useMemo(function() {
    var byRegion = {};
    regions.forEach(function(r) {
      byRegion[r] = { active:0, evalPending:0, socPending:0, authPending:0, onHold:0, hospitalized:0, waitlist:0, discharge:0 };
    });
    census.forEach(function(p) {
      var b = byRegion[p.region];
      if (!b) return;
      var s = (p.status || '').toLowerCase();
      if (s.indexOf('active') === 0)                              b.active++;
      else if (s.indexOf('eval') >= 0 && s.indexOf('pending') >= 0) b.evalPending++;
      else if (s.indexOf('soc') >= 0 && s.indexOf('pending') >= 0)  b.socPending++;
      else if (s.indexOf('auth') >= 0 && s.indexOf('pending') >= 0) b.authPending++;
      else if (s.indexOf('on hold') >= 0 || s.indexOf('on_hold') >= 0) b.onHold++;
      else if (s.indexOf('hospital') >= 0)                        b.hospitalized++;
      else if (s.indexOf('waitlist') >= 0)                        b.waitlist++;
      else if (s.indexOf('discharge') >= 0 || s.indexOf('non-admit') >= 0) b.discharge++;
    });
    var totals = { active:0, evalPending:0, socPending:0, authPending:0, onHold:0, hospitalized:0, waitlist:0, discharge:0 };
    Object.keys(byRegion).forEach(function(r) {
      Object.keys(totals).forEach(function(k) { totals[k] += byRegion[r][k]; });
    });
    return { byRegion: byRegion, totals: totals };
  }, [census, regions]);

  // ── Priority opportunities (revenue-impact ranked, $ hidden from coords) ─
  // These surface the highest-leverage actions to move patients through the
  // pipeline. Dollar amounts are NOT shown to coordinators — they see
  // priority tags instead. Sort order is still by impact under the hood.
  function daysSinceLocal(d) {
    if (!d) return null;
    return Math.floor((new Date() - new Date(d + 'T00:00:00')) / 86400000);
  }
  function daysUntilLocal(d) {
    if (!d) return null;
    return Math.ceil((new Date(d + 'T00:00:00') - new Date()) / 86400000);
  }
  var opportunities = useMemo(function() {
    var opps = [];

    // SOC Pending > 3 days — items annotated with daysSinceFirstSeen for display
    var stuckSoc = census.filter(function(p) {
      var s = (p.status || '').toLowerCase();
      if (!(s.indexOf('soc') >= 0 && s.indexOf('pending') >= 0)) return false;
      var d = daysSinceLocal(p.first_seen_date);
      return d !== null && d > 3;
    }).map(function(p) { return Object.assign({}, p, { _daysStuck: daysSinceLocal(p.first_seen_date) }); })
      .sort(function(a, b) { return b._daysStuck - a._daysStuck; });
    if (stuckSoc.length) opps.push({
      icon: '🚦', urgency: 'critical', sortKey: stuckSoc.length * 16, sourceType: 'census', metric: 'daysStuck',
      title: stuckSoc.length + ' patient' + (stuckSoc.length > 1 ? 's' : '') + ' stuck in SOC Pending > 3 days',
      subtitle: 'Push the auth team to submit. Each accepted patient unlocks an episode of visits.',
      items: stuckSoc,
    });

    // Eval Pending > 3 days
    var stuckEval = census.filter(function(p) {
      var s = (p.status || '').toLowerCase();
      if (!(s.indexOf('eval') >= 0 && s.indexOf('pending') >= 0)) return false;
      var d = daysSinceLocal(p.first_seen_date);
      return d !== null && d > 3;
    }).map(function(p) { return Object.assign({}, p, { _daysStuck: daysSinceLocal(p.first_seen_date) }); })
      .sort(function(a, b) { return b._daysStuck - a._daysStuck; });
    if (stuckEval.length) opps.push({
      icon: '📅', urgency: 'critical', sortKey: stuckEval.length * 12, sourceType: 'census', metric: 'daysStuck',
      title: stuckEval.length + ' patient' + (stuckEval.length > 1 ? 's' : '') + ' stuck in Eval Pending > 3 days',
      subtitle: 'Auth is done — schedule the eval visit. First eval unlocks the rest.',
      items: stuckEval,
    });

    // On Hold > 14 days — recoverable
    var recoverableHold = census.filter(function(p) {
      var s = (p.status || '').toLowerCase();
      if (s.indexOf('on hold') < 0 && s.indexOf('on_hold') < 0) return false;
      var d = daysSinceLocal(p.last_seen_date);
      return d !== null && d > 14;
    }).map(function(p) { return Object.assign({}, p, { _daysStuck: daysSinceLocal(p.last_seen_date) }); })
      .sort(function(a, b) { return b._daysStuck - a._daysStuck; });
    if (recoverableHold.length) opps.push({
      icon: '🔁', urgency: 'urgent', sortKey: recoverableHold.length * 6, sourceType: 'census', metric: 'daysOnHold',
      title: recoverableHold.length + ' on-hold patient' + (recoverableHold.length > 1 ? 's' : '') + ' > 14 days — recoverable',
      subtitle: 'Call to re-engage or coordinate with the clinical team.',
      items: recoverableHold,
    });

    // Active overdue (no visit in 7+ days)
    var overdueActive = census.filter(function(p) {
      var s = (p.status || '').toLowerCase();
      if (s.indexOf('active') !== 0) return false;
      var d = daysSinceLocal(p.last_visit_date);
      return d !== null && d > 7;
    }).map(function(p) { return Object.assign({}, p, { _daysStuck: daysSinceLocal(p.last_visit_date) }); })
      .sort(function(a, b) { return b._daysStuck - a._daysStuck; });
    if (overdueActive.length) opps.push({
      icon: '⏰', urgency: 'urgent', sortKey: overdueActive.length, sourceType: 'census', metric: 'daysSinceVisit',
      title: overdueActive.length + ' active patient' + (overdueActive.length > 1 ? 's' : '') + ' overdue (no visit in 7+ days)',
      subtitle: 'Schedule the next visit ASAP to keep cadence on track.',
      items: overdueActive,
    });

    // Auths with unused visits expiring < 60 days — different source data shape
    var underUsed = authRecords.filter(function(a) {
      if (a.auth_status !== 'active') return false;
      var remaining = (a.visits_authorized || 0) - (a.visits_used || 0);
      if (remaining < 4) return false;
      if (!a.auth_expiry_date) return false;
      var dte = daysUntilLocal(a.auth_expiry_date);
      return dte !== null && dte > 0 && dte <= 60;
    }).map(function(a) {
      return Object.assign({}, a, {
        _remaining: Math.max(0, (a.visits_authorized || 0) - (a.visits_used || 0)),
        _daysToExpiry: daysUntilLocal(a.auth_expiry_date),
      });
    }).sort(function(a, b) { return a._daysToExpiry - b._daysToExpiry; });
    if (underUsed.length) {
      var totalUnused = underUsed.reduce(function(s, a) { return s + a._remaining; }, 0);
      opps.push({
        icon: '📈', urgency: 'medium', sortKey: totalUnused, sourceType: 'auth', metric: 'visitsLeft',
        title: underUsed.length + ' auth' + (underUsed.length > 1 ? 's' : '') + ' with unused visits expiring < 60 days',
        subtitle: totalUnused + ' authorized visits at risk of expiring unused. Consider increasing visit frequency.',
        items: underUsed,
      });
    }

    return opps.sort(function(a, b) { return b.sortKey - a.sortKey; });
  }, [census, authRecords]);

  // Helper: when a coord clicks a row in an auth-source opportunity, we
  // look up the matching census row by patient_name + region to open the
  // existing StatusChangeModal. Falls back to a minimal pseudo-patient
  // record if the census row doesn't exist (rare).
  function openPatientFromAuth(authRow) {
    var match = census.find(function(c) {
      return c.patient_name && authRow.patient_name &&
        c.patient_name.toLowerCase().trim() === authRow.patient_name.toLowerCase().trim() &&
        c.region === authRow.region;
    });
    if (match) {
      setStatusPatient(match);
    } else {
      // No census row — show a friendly note instead of opening a broken modal
      window.alert('No active census record for ' + authRow.patient_name + ' in Region ' + authRow.region + '. The patient may not be on service yet.');
    }
  }

  // ── Clinician Productivity (this week) ─────────────────────────────────
  // Matches ProductivityPage's logic: TARGETS by employment_type, dedupe
  // Pariox's duplicate "Level 3 + Cancelled" pairs, attribute by
  // pariox_name + aliases.
  var TARGETS = { ft: 25, pt: 15, prn: 10 };
  var TYPE_LABELS = { ft: 'FT', pt: 'PT', prn: 'PRN' };

  var clinicianStats = useMemo(function() {
    // Step 1: name → clinician_id map (includes pariox_name + aliases)
    var nameMap = {};
    clinicians.forEach(function(c) {
      if (c.full_name) nameMap[c.full_name.toLowerCase()] = c.id;
      if (c.pariox_name) nameMap[c.pariox_name.toLowerCase()] = c.id;
      (c.aliases || []).forEach(function(a) { if (a) nameMap[a.toLowerCase()] = c.id; });
    });

    // Step 2: group visits by (patient, date, staff). If any row in a group
    // has cancel/attempt/missed in event_type, mark the whole slot as
    // cancelled (matches ProductivityPage dedup).
    var NON_REAL = /cancel|attempt|missed|no[ -]?show/i;
    var groups = {};
    weekVisits.forEach(function(v) {
      var rawName = (v.staff_name_normalized || v.staff_name || '').trim();
      if (!rawName || !v.patient_name || !v.visit_date) return;
      var dateKey = (v.visit_date + '').slice(0, 10);
      var key = v.patient_name + '|' + dateKey + '|' + rawName.toLowerCase();
      if (!groups[key]) groups[key] = { rows: [], cancelled: false };
      if (NON_REAL.test(v.event_type || '')) groups[key].cancelled = true;
      else groups[key].rows.push(v);
    });

    // Step 3: accumulate stats per clinician
    var statsByCid = {};
    Object.keys(groups).forEach(function(key) {
      var g = groups[key];
      if (g.cancelled) return;
      g.rows.forEach(function(v) {
        var rawName = (v.staff_name_normalized || v.staff_name || '').trim();
        var id = nameMap[rawName.toLowerCase()];
        if (!id) return;
        if (!statsByCid[id]) statsByCid[id] = { completed: 0, scheduled: 0, missed: 0, cancelled: 0, missedActive: 0 };
        var s = (v.status || '').toLowerCase();
        if (s === 'missed (active)')      statsByCid[id].missedActive++;
        else if (s.indexOf('completed') >= 0) statsByCid[id].completed++;
        else if (s.indexOf('scheduled') >= 0) statsByCid[id].scheduled++;
        else if (s.indexOf('missed') >= 0)    statsByCid[id].missed++;
        else if (s.indexOf('cancelled') >= 0) statsByCid[id].cancelled++;
      });
    });

    // Step 4: enrich each clinician with target, done, pct, flag
    return clinicians.map(function(c) {
      var s = statsByCid[c.id] || { completed: 0, scheduled: 0, missed: 0, cancelled: 0, missedActive: 0 };
      var target = c.weekly_visit_target || TARGETS[c.employment_type] || 25;
      var done = s.completed + s.missedActive;
      var totalAssigned = done + s.scheduled + s.missed + s.cancelled;
      var pct = target > 0 ? Math.round((done / target) * 100) : 0;
      var projected = done + s.scheduled;
      var projectedPct = target > 0 ? Math.round((projected / target) * 100) : 0;

      // Flag logic (mirrors PRD §7.1 pacing flag rules, but with the
      // simpler thresholds the existing ProductivityPage uses):
      //   * Over-Scheduled: PRN with totalAssigned > target (hard cap)
      //                     OR FT/PT with totalAssigned > target * 1.1
      //   * Under-Scheduled: FT/PT with totalAssigned > 0 but < (target - 2)
      //   * At Risk: FT/PT with done > 0 and pct < 70
      //   * On Track: anything else with activity
      //   * No Activity: zero visits this week
      var flag = 'on_track';
      if (totalAssigned === 0) flag = 'no_activity';
      else if (c.employment_type === 'prn' && totalAssigned > target) flag = 'over';
      else if (c.employment_type !== 'prn' && totalAssigned > target * 1.1) flag = 'over';
      else if (c.employment_type !== 'prn' && totalAssigned < target - 2) flag = 'under';
      else if (c.employment_type !== 'prn' && done > 0 && pct < 70) flag = 'at_risk';

      return Object.assign({}, c, {
        target: target, done: done, scheduled: s.scheduled,
        missed: s.missed, cancelled: s.cancelled,
        totalAssigned: totalAssigned, pct: pct, projectedPct: projectedPct,
        flag: flag,
      });
    });
  }, [clinicians, weekVisits]);

  var productivitySummary = useMemo(function() {
    var counts = { under: 0, at_risk: 0, over: 0, on_track: 0, no_activity: 0 };
    clinicianStats.forEach(function(c) { counts[c.flag]++; });
    return counts;
  }, [clinicianStats]);

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

        {/* ── MY REGIONS — PIPELINE OVERVIEW ──────────────────────────── */}
        {/* Bucket helpers used by both the cell click handlers and the
            expansion-panel filter. Matching mirrors regionPipeline. */}
        {(function renderPipeline() {
          var BUCKET_LABELS = {
            active: 'Active', evalPending: 'Eval Pending', socPending: 'SOC Pending',
            authPending: 'Auth Pending', onHold: 'On Hold', hospitalized: 'Hospitalized',
            waitlist: 'Waitlist', discharge: 'Discharge',
          };
          function bucketMatches(status, bucket) {
            var s = (status || '').toLowerCase();
            if (bucket === 'active')        return s.indexOf('active') === 0;
            if (bucket === 'evalPending')   return s.indexOf('eval') >= 0 && s.indexOf('pending') >= 0;
            if (bucket === 'socPending')    return s.indexOf('soc') >= 0 && s.indexOf('pending') >= 0;
            if (bucket === 'authPending')   return s.indexOf('auth') >= 0 && s.indexOf('pending') >= 0;
            if (bucket === 'onHold')        return s.indexOf('on hold') >= 0 || s.indexOf('on_hold') >= 0;
            if (bucket === 'hospitalized')  return s.indexOf('hospital') >= 0;
            if (bucket === 'waitlist')      return s.indexOf('waitlist') >= 0;
            if (bucket === 'discharge')     return s.indexOf('discharge') >= 0 || s.indexOf('non-admit') >= 0;
            return false;
          }
          // Patients matching the currently-expanded cell
          var expandedPatients = expandedCell
            ? census.filter(function(p) {
                var regionMatch = expandedCell.region === '__TOTAL__' ? true : p.region === expandedCell.region;
                return regionMatch && bucketMatches(p.status, expandedCell.bucket);
              }).sort(function(a, b) { return (a.patient_name || '').localeCompare(b.patient_name || ''); })
            : [];

          // Cell component: clickable number with visual selected state
          function Cell(props) {
            var isActive = expandedCell && expandedCell.region === props.region && expandedCell.bucket === props.bucket;
            var canClick = props.count > 0;
            return (
              <span
                onClick={canClick ? function() {
                  setExpandedCell(isActive ? null : { region: props.region, bucket: props.bucket });
                } : null}
                style={{
                  textAlign: 'center', fontWeight: props.weight || 600, color: props.color,
                  cursor: canClick ? 'pointer' : 'default',
                  background: isActive ? '#0F1117' : 'transparent',
                  borderRadius: 6, padding: '4px 6px',
                  border: isActive ? '1px solid #0F1117' : '1px solid transparent',
                  transition: 'background 0.15s, color 0.15s',
                  display: 'inline-block', minWidth: 32,
                }}
                onMouseEnter={canClick && !isActive ? function(e) { e.currentTarget.style.background = '#F3F4F6'; } : null}
                onMouseLeave={canClick && !isActive ? function(e) { e.currentTarget.style.background = 'transparent'; } : null}
              >
                <span style={isActive ? { color: '#fff' } : null}>{props.count}</span>
              </span>
            );
          }

          return (
            <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>🗺 My Regions &mdash; Pipeline Overview</div>
                {expandedCell && (
                  <button onClick={function() { setExpandedCell(null); }}
                    style={{ fontSize: 10, color: '#6B7280', background: 'none', border: '1px solid #E5E7EB', borderRadius: 5, padding: '3px 8px', cursor: 'pointer' }}>
                    Close patient list
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 12 }}>
                Click any number to see the patient list · click a patient to edit their record
              </div>
              <div style={{ overflow: 'auto' }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '80px repeat(8, minmax(60px, 1fr))',
                  padding: '8px 10px', background: '#F9FAFB', borderRadius: 6,
                  fontSize: 9, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  <span>Region</span>
                  <span style={{ textAlign: 'center' }}>Active</span>
                  <span style={{ textAlign: 'center' }}>Eval Pend</span>
                  <span style={{ textAlign: 'center' }}>SOC Pend</span>
                  <span style={{ textAlign: 'center' }}>Auth Pend</span>
                  <span style={{ textAlign: 'center' }}>On Hold</span>
                  <span style={{ textAlign: 'center' }}>Hospital</span>
                  <span style={{ textAlign: 'center' }}>Waitlist</span>
                  <span style={{ textAlign: 'center' }}>Discharge</span>
                </div>
                {regions.map(function(r, i) {
                  var c = regionPipeline.byRegion[r] || { active:0, evalPending:0, socPending:0, authPending:0, onHold:0, hospitalized:0, waitlist:0, discharge:0 };
                  return (
                    <div key={r} style={{
                      display: 'grid',
                      gridTemplateColumns: '80px repeat(8, minmax(60px, 1fr))',
                      padding: '8px 10px', borderBottom: i < regions.length - 1 ? '1px solid #F3F4F6' : 'none',
                      alignItems: 'center', fontSize: 14, fontFamily: 'DM Mono, monospace',
                    }}>
                      <span style={{ fontWeight: 700, fontFamily: 'DM Sans, sans-serif', color: '#111827' }}>Region {r}</span>
                      <Cell region={r} bucket="active"        count={c.active}        color="#059669" weight={700} />
                      <Cell region={r} bucket="evalPending"   count={c.evalPending}   color={c.evalPending>0?'#1565C0':'#9CA3AF'} />
                      <Cell region={r} bucket="socPending"    count={c.socPending}    color={c.socPending>0?'#1565C0':'#9CA3AF'} />
                      <Cell region={r} bucket="authPending"   count={c.authPending}   color={c.authPending>0?'#D97706':'#9CA3AF'} />
                      <Cell region={r} bucket="onHold"        count={c.onHold}        color={c.onHold>5?'#DC2626':c.onHold>0?'#7C3AED':'#9CA3AF'} />
                      <Cell region={r} bucket="hospitalized"  count={c.hospitalized}  color={c.hospitalized>0?'#DC2626':'#9CA3AF'} />
                      <Cell region={r} bucket="waitlist"      count={c.waitlist}      color="#9CA3AF" />
                      <Cell region={r} bucket="discharge"     count={c.discharge}     color="#9CA3AF" />
                    </div>
                  );
                })}
                {regions.length > 1 && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '80px repeat(8, minmax(60px, 1fr))',
                    padding: '8px 10px', marginTop: 4, background: '#0F1117', color: '#fff', borderRadius: 6,
                    alignItems: 'center', fontSize: 14, fontFamily: 'DM Mono, monospace',
                  }}>
                    <span style={{ fontWeight: 700, fontFamily: 'DM Sans, sans-serif' }}>Total</span>
                    <Cell region="__TOTAL__" bucket="active"        count={regionPipeline.totals.active}        color="#fff" weight={800} />
                    <Cell region="__TOTAL__" bucket="evalPending"   count={regionPipeline.totals.evalPending}   color="#fff" weight={700} />
                    <Cell region="__TOTAL__" bucket="socPending"    count={regionPipeline.totals.socPending}    color="#fff" weight={700} />
                    <Cell region="__TOTAL__" bucket="authPending"   count={regionPipeline.totals.authPending}   color="#fff" weight={700} />
                    <Cell region="__TOTAL__" bucket="onHold"        count={regionPipeline.totals.onHold}        color="#fff" weight={700} />
                    <Cell region="__TOTAL__" bucket="hospitalized"  count={regionPipeline.totals.hospitalized}  color="#fff" weight={700} />
                    <Cell region="__TOTAL__" bucket="waitlist"      count={regionPipeline.totals.waitlist}      color="#fff" weight={700} />
                    <Cell region="__TOTAL__" bucket="discharge"     count={regionPipeline.totals.discharge}     color="#fff" weight={700} />
                  </div>
                )}
              </div>

              {/* ── EXPANSION PANEL: patient list for the clicked cell ── */}
              {expandedCell && (
                <div style={{
                  marginTop: 14, border: '2px solid #0F1117', borderRadius: 10,
                  background: '#F9FAFB', overflow: 'hidden',
                }}>
                  <div style={{
                    padding: '10px 14px', background: '#0F1117', color: '#fff',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {expandedCell.region === '__TOTAL__' ? 'All Regions' : 'Region ' + expandedCell.region}
                        {' · '}{BUCKET_LABELS[expandedCell.bucket]}
                      </div>
                      <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
                        {expandedPatients.length} patient{expandedPatients.length === 1 ? '' : 's'} · click a row to edit status
                      </div>
                    </div>
                    <button onClick={function() { setExpandedCell(null); }}
                      style={{ background: 'none', border: '1px solid #4B5563', color: '#D1D5DB', borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
                      Close ×
                    </button>
                  </div>

                  {expandedPatients.length === 0 ? (
                    <div style={{ padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>
                      No patients in this bucket right now.
                    </div>
                  ) : (
                    <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                      <div style={{
                        display: 'grid', gridTemplateColumns: '60px 1.6fr 1fr 1fr 100px',
                        padding: '7px 14px', background: '#fff', borderBottom: '1px solid #E5E7EB',
                        fontSize: 9, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', position: 'sticky', top: 0,
                      }}>
                        <span>Region</span><span>Patient</span><span>Status</span><span>Insurance</span><span style={{ textAlign: 'right' }}>Last Visit</span>
                      </div>
                      {expandedPatients.map(function(p, i) {
                        var lastVisit = p.last_visit_date
                          ? new Date(p.last_visit_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : '—';
                        var daysAgo = p.last_visit_date ? daysSinceLocal(p.last_visit_date) : null;
                        var lastVisitColor = daysAgo === null ? '#9CA3AF'
                          : daysAgo > 14 ? '#DC2626'
                          : daysAgo > 7  ? '#D97706'
                          : '#374151';
                        return (
                          <div key={p.patient_name + '|' + p.region + '|' + i}
                            onClick={function() { setStatusPatient(p); }}
                            style={{
                              display: 'grid', gridTemplateColumns: '60px 1.6fr 1fr 1fr 100px',
                              padding: '9px 14px', borderBottom: '1px solid #F3F4F6',
                              background: i % 2 === 0 ? '#fff' : '#F9FAFB',
                              alignItems: 'center', fontSize: 12, cursor: 'pointer',
                              transition: 'background 0.1s',
                            }}
                            onMouseEnter={function(e) { e.currentTarget.style.background = '#EFF6FF'; }}
                            onMouseLeave={function(e) { e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#F9FAFB'; }}>
                            <span style={{ fontWeight: 700, color: '#374151' }}>{p.region}</span>
                            <span style={{ fontWeight: 600, color: '#111827' }}>{p.patient_name}</span>
                            <span style={{ color: '#6B7280', fontSize: 11 }}>{p.status || '—'}</span>
                            <span style={{ color: '#6B7280', fontSize: 11 }}>{p.insurance || '—'}</span>
                            <span style={{ textAlign: 'right', color: lastVisitColor, fontSize: 11, fontWeight: 600 }}>
                              {lastVisit}{daysAgo !== null ? ' (' + daysAgo + 'd)' : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── PRIORITY OPPORTUNITIES (clickable; no $ shown to coordinators) ─ */}
        <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>🎯 Priority Opportunities</div>
            {expandedOpp !== null && (
              <button onClick={function() { setExpandedOpp(null); }}
                style={{ fontSize: 10, color: '#6B7280', background: 'none', border: '1px solid #E5E7EB', borderRadius: 5, padding: '3px 8px', cursor: 'pointer' }}>
                Close list
              </button>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 12 }}>
            Click any card to see the patients · click a patient row to edit
          </div>
          {opportunities.length === 0 ? (
            <div style={{ padding: 18, textAlign: 'center', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8 }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>✅</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#065F46' }}>No obvious blockers right now — pipelines flowing!</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {opportunities.map(function(opp, i) {
                var styles = {
                  critical: { bg: '#FEF2F2', border: '#FECACA', title: '#DC2626' },
                  urgent:   { bg: '#FFFBEB', border: '#FCD34D', title: '#92400E' },
                  medium:   { bg: '#EFF6FF', border: '#BFDBFE', title: '#1E40AF' },
                }[opp.urgency] || { bg: '#F9FAFB', border: '#E5E7EB', title: '#111827' };
                var isExpanded = expandedOpp === i;
                return (
                  <div key={i}>
                    {/* Clickable card */}
                    <div
                      onClick={function() { setExpandedOpp(isExpanded ? null : i); }}
                      style={{
                        background: styles.bg,
                        border: '1px solid ' + (isExpanded ? styles.title : styles.border),
                        borderRadius: isExpanded ? '8px 8px 0 0' : 8,
                        padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 12,
                        cursor: 'pointer', transition: 'border-color 0.15s',
                      }}
                      onMouseEnter={function(e) { if (!isExpanded) e.currentTarget.style.borderColor = styles.title; }}
                      onMouseLeave={function(e) { if (!isExpanded) e.currentTarget.style.borderColor = styles.border; }}
                    >
                      <div style={{ fontSize: 20, width: 28, textAlign: 'center', flexShrink: 0 }}>{opp.icon}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: styles.title, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {opp.title}
                          <span style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 500 }}>{isExpanded ? '▾' : '▸'}</span>
                        </div>
                        <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>{opp.subtitle}</div>
                      </div>
                      <div style={{
                        fontSize: 9, fontWeight: 700, color: styles.title,
                        background: '#fff', padding: '3px 9px', borderRadius: 999,
                        border: '1px solid ' + styles.border, textTransform: 'uppercase', letterSpacing: '0.05em',
                        flexShrink: 0,
                      }}>
                        {opp.urgency}
                      </div>
                    </div>

                    {/* Inline expansion: items list directly below the clicked card */}
                    {isExpanded && opp.items && (
                      <div style={{
                        background: '#fff',
                        border: '1px solid ' + styles.title,
                        borderTop: 'none',
                        borderRadius: '0 0 8px 8px',
                        overflow: 'hidden',
                      }}>
                        {/* Header row */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: opp.sourceType === 'auth'
                            ? '50px 1.6fr 1fr 80px 90px'
                            : '50px 1.6fr 1.1fr 1fr 100px',
                          padding: '7px 14px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB',
                          fontSize: 9, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>
                          <span>Rgn</span>
                          <span>Patient</span>
                          {opp.sourceType === 'auth' ? (
                            <>
                              <span>Insurance</span>
                              <span style={{ textAlign: 'center' }}>Visits Left</span>
                              <span style={{ textAlign: 'right' }}>Expires In</span>
                            </>
                          ) : (
                            <>
                              <span>Status</span>
                              <span>Insurance</span>
                              <span style={{ textAlign: 'right' }}>
                                {opp.metric === 'daysSinceVisit' ? 'Days Since Visit' : 'Days Stuck'}
                              </span>
                            </>
                          )}
                        </div>

                        {/* Scrollable rows */}
                        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                          {opp.items.map(function(it, idx) {
                            var rowBg = idx % 2 === 0 ? '#fff' : '#F9FAFB';
                            if (opp.sourceType === 'auth') {
                              return (
                                <div key={(it.id || it.patient_name) + '|' + idx}
                                  onClick={function() { openPatientFromAuth(it); }}
                                  style={{
                                    display: 'grid', gridTemplateColumns: '50px 1.6fr 1fr 80px 90px',
                                    padding: '9px 14px', borderBottom: '1px solid #F3F4F6',
                                    background: rowBg, alignItems: 'center', fontSize: 12, cursor: 'pointer',
                                    transition: 'background 0.1s',
                                  }}
                                  onMouseEnter={function(e) { e.currentTarget.style.background = '#EFF6FF'; }}
                                  onMouseLeave={function(e) { e.currentTarget.style.background = rowBg; }}>
                                  <span style={{ fontWeight: 700, color: '#374151' }}>{it.region}</span>
                                  <span style={{ fontWeight: 600, color: '#111827' }}>{it.patient_name}</span>
                                  <span style={{ color: '#6B7280', fontSize: 11 }}>{it.insurance || '—'}</span>
                                  <span style={{ textAlign: 'center', fontWeight: 700, fontFamily: 'DM Mono, monospace', color: '#1565C0' }}>{it._remaining}</span>
                                  <span style={{
                                    textAlign: 'right', fontWeight: 700, fontFamily: 'DM Mono, monospace',
                                    color: it._daysToExpiry <= 14 ? '#DC2626' : it._daysToExpiry <= 30 ? '#D97706' : '#374151', fontSize: 11,
                                  }}>
                                    {it._daysToExpiry}d
                                  </span>
                                </div>
                              );
                            }
                            // Census-source row
                            var metricLabel = opp.metric === 'daysSinceVisit' ? 'd ago' : 'd';
                            var metricColor = it._daysStuck > 14 ? '#DC2626' : it._daysStuck > 7 ? '#D97706' : '#374151';
                            return (
                              <div key={(it.id || it.patient_name) + '|' + idx}
                                onClick={function() { setStatusPatient(it); }}
                                style={{
                                  display: 'grid', gridTemplateColumns: '50px 1.6fr 1.1fr 1fr 100px',
                                  padding: '9px 14px', borderBottom: '1px solid #F3F4F6',
                                  background: rowBg, alignItems: 'center', fontSize: 12, cursor: 'pointer',
                                  transition: 'background 0.1s',
                                }}
                                onMouseEnter={function(e) { e.currentTarget.style.background = '#EFF6FF'; }}
                                onMouseLeave={function(e) { e.currentTarget.style.background = rowBg; }}>
                                <span style={{ fontWeight: 700, color: '#374151' }}>{it.region}</span>
                                <span style={{ fontWeight: 600, color: '#111827' }}>{it.patient_name}</span>
                                <span style={{ color: '#6B7280', fontSize: 11 }}>{it.status || '—'}</span>
                                <span style={{ color: '#6B7280', fontSize: 11 }}>{it.insurance || '—'}</span>
                                <span style={{
                                  textAlign: 'right', fontWeight: 700, fontFamily: 'DM Mono, monospace',
                                  color: metricColor, fontSize: 11,
                                }}>
                                  {it._daysStuck}{metricLabel}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── CLINICIAN PRODUCTIVITY — THIS WEEK ───────────────────────── */}
        <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
              👥 Clinician Productivity &mdash; This Week
            </div>
            <div style={{ fontSize: 10, color: '#9CA3AF' }}>
              {clinicianStats.length} clinician{clinicianStats.length === 1 ? '' : 's'} in your regions
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 12 }}>
            Watch for clinicians who are under-scheduled (need more visits) or over-scheduled (need offload)
          </div>

          {/* Alert badges — only render counts > 0 */}
          {(productivitySummary.under + productivitySummary.at_risk + productivitySummary.over) > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {productivitySummary.under > 0 && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'DM Mono, monospace', color: '#DC2626' }}>{productivitySummary.under}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#991B1B' }}>under-scheduled · need more visits added</span>
                </div>
              )}
              {productivitySummary.at_risk > 0 && (
                <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'DM Mono, monospace', color: '#D97706' }}>{productivitySummary.at_risk}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#92400E' }}>at risk · below 70% of weekly target</span>
                </div>
              )}
              {productivitySummary.over > 0 && (
                <div style={{ background: '#EDE9FE', border: '1px solid #C4B5FD', borderRadius: 8, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'DM Mono, monospace', color: '#7C3AED' }}>{productivitySummary.over}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#5B21B6' }}>over-scheduled · may need offload</span>
                </div>
              )}
            </div>
          )}

          {clinicianStats.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>
              No active clinicians assigned to your regions.
            </div>
          ) : (
            <div style={{ overflow: 'auto', border: '1px solid #F3F4F6', borderRadius: 8 }}>
              {/* Table header */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1.5fr 60px 60px 80px 70px 70px 1fr 90px',
                padding: '8px 12px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB',
                fontSize: 9, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>
                <span>Clinician</span>
                <span style={{ textAlign: 'center' }}>Rgn</span>
                <span style={{ textAlign: 'center' }}>Type</span>
                <span style={{ textAlign: 'center' }}>Target</span>
                <span style={{ textAlign: 'center' }}>Done</span>
                <span style={{ textAlign: 'center' }}>Sched</span>
                <span>Pacing</span>
                <span style={{ textAlign: 'right' }}>Flag</span>
              </div>

              {/* Sort: most-urgent flags first, then % asc within flag */}
              {clinicianStats.slice().sort(function(a, b) {
                var order = { under: 0, over: 1, at_risk: 2, no_activity: 3, on_track: 4 };
                var ao = order[a.flag] ?? 9, bo = order[b.flag] ?? 9;
                if (ao !== bo) return ao - bo;
                return a.pct - b.pct;
              }).map(function(c, i) {
                var flagCfg = {
                  under:        { label: 'UNDER', bg: '#FEF2F2', color: '#DC2626', borderColor: '#FECACA' },
                  over:         { label: 'OVER',  bg: '#EDE9FE', color: '#7C3AED', borderColor: '#C4B5FD' },
                  at_risk:      { label: 'AT RISK', bg: '#FEF3C7', color: '#D97706', borderColor: '#FCD34D' },
                  on_track:     { label: 'ON TRACK', bg: '#ECFDF5', color: '#059669', borderColor: '#A7F3D0' },
                  no_activity:  { label: 'NO ACTIVITY', bg: '#F3F4F6', color: '#6B7280', borderColor: '#E5E7EB' },
                }[c.flag];

                var barColor = c.pct >= 80 ? '#10B981' : c.pct >= 60 ? '#F59E0B' : '#EF4444';
                var displayPct = Math.min(c.pct, 150);

                return (
                  <div key={c.id} style={{
                    display: 'grid', gridTemplateColumns: '1.5fr 60px 60px 80px 70px 70px 1fr 90px',
                    padding: '9px 12px', borderBottom: '1px solid #F3F4F6',
                    background: i % 2 === 0 ? 'white' : '#F9FAFB',
                    alignItems: 'center', fontSize: 12,
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, color: '#111827' }}>{c.full_name}</div>
                      <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>{c.discipline || '—'}{c.is_telehealth ? ' · Telehealth' : ''}</div>
                    </div>
                    <span style={{ textAlign: 'center', fontWeight: 700, color: '#374151', fontFamily: 'DM Mono, monospace' }}>{c.region}</span>
                    <span style={{ textAlign: 'center' }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700,
                        color: c.employment_type === 'ft' ? '#065F46' : c.employment_type === 'pt' ? '#1E40AF' : '#92400E',
                        background: c.employment_type === 'ft' ? '#ECFDF5' : c.employment_type === 'pt' ? '#EFF6FF' : '#FEF3C7',
                        padding: '2px 6px', borderRadius: 999, letterSpacing: '0.04em',
                      }}>
                        {TYPE_LABELS[c.employment_type] || (c.employment_type || '—').toUpperCase()}
                      </span>
                    </span>
                    <span style={{ textAlign: 'center', fontFamily: 'DM Mono, monospace', color: '#6B7280' }}>{c.target}</span>
                    <span style={{ textAlign: 'center', fontWeight: 700, fontFamily: 'DM Mono, monospace', color: '#065F46' }}>{c.done}</span>
                    <span style={{ textAlign: 'center', fontFamily: 'DM Mono, monospace', color: '#6B7280' }}>{c.scheduled}</span>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                        <span style={{ fontWeight: 700, color: barColor, fontFamily: 'DM Mono, monospace' }}>{c.pct}%</span>
                        <span style={{ color: '#9CA3AF' }}>{c.done}/{c.target}</span>
                      </div>
                      <div style={{ height: 4, background: '#E5E7EB', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: Math.min(displayPct, 100) + '%', background: barColor, transition: 'width 0.4s' }} />
                      </div>
                    </div>
                    <span style={{ textAlign: 'right' }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, color: flagCfg.color,
                        background: flagCfg.bg, border: '1px solid ' + flagCfg.borderColor,
                        padding: '3px 8px', borderRadius: 999, letterSpacing: '0.05em',
                      }}>
                        {flagCfg.label}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

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
                <TaskCard key={task.id} task={task} onRefresh={fetchTasks} autoResponses={autoResponses} coordName={coordName} onStatusChange={function(patName, region) {
                  setStatusPatient({ patient_name: patName, region: region, id: null, _needsLookup: true });
                }} />
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

      {statusPatient && <StatusChangePatientLookup
        patientInfo={statusPatient}
        onClose={function() { setStatusPatient(null); }}
        onSaved={function() { setStatusPatient(null); fetchTasks(); }}
      />}
    </div>
  );
}

// Wrapper that looks up census_data record by patient_name before showing the modal
function StatusChangePatientLookup({ patientInfo, onClose, onSaved }) {
  var [patient, setPatient] = useState(null);
  var [error, setError] = useState(null);

  useEffect(function() {
    supabase.from('census_data')
      .select('id, patient_name, region, status, insurance')
      .eq('patient_name', patientInfo.patient_name)
      .limit(1)
      .then(function(res) {
        if (res.data && res.data.length > 0) {
          setPatient(res.data[0]);
        } else {
          setError('Patient "' + patientInfo.patient_name + '" not found in census. Status can only be changed for patients in the census.');
        }
      });
  }, [patientInfo.patient_name]);

  if (error) {
    return (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
        <div style={{ background:'white', borderRadius:14, padding:24, maxWidth:400, textAlign:'center' }}>
          <div style={{ fontSize:14, color:'#DC2626', fontWeight:600, marginBottom:12 }}>{error}</div>
          <button onClick={onClose} style={{ padding:'7px 18px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer' }}>Close</button>
        </div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'white', borderRadius:14, padding:24, color:'#6B7280' }}>Looking up patient...</div>
      </div>
    );
  }

  return <StatusChangeModal patient={patient} onClose={onClose} onSaved={onSaved} />;
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
 
