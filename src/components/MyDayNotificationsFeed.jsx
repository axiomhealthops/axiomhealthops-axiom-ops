// MyDayNotificationsFeed.jsx
//
// Right-rail notifications panel for the My Day page. Surfaces three
// existing channels in one feed:
//   - @mentions on patient_notes (note_notifications)
//   - assigned coordinator_tasks
//   - open auth alerts (auth_over_limit / auth_low_visits / auth_expiring)
//
// All three are pulled from the v_my_day_notifications view. Caller-side
// filtering scopes mentions to the current user, tasks to the current user's
// name, and alerts to the user's assigned regions.
//
// Click behavior:
//   mention       -> dispatches axiom-navigate to the patient's profile (census page filtered)
//   assigned_task -> opens inline drawer with "complete" action
//   alert         -> navigates to the relevant drill-down page (matches alert_type)
//
// JSX unicode policy: no inline unicode in JSX text. Plain ASCII or expressions.

import { useEffect, useMemo, useState } from 'react';
import { supabase, fetchAllPages, safeUpdate, logActivity } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useAssignedRegions } from '../hooks/useAssignedRegions';
import { useRealtimeTable } from '../hooks/useRealtimeTable';

const SOURCE_VISUAL = {
  mention:       { label: 'Mention',  color: '#1565C0', bg: '#EFF6FF', border: '#BFDBFE', icon: '@' },
  assigned_task: { label: 'Task',     color: '#7C2D12', bg: '#FFF7ED', border: '#FDBA74', icon: '!' },
  alert:         { label: 'Alert',    color: '#7F1D1D', bg: '#FEE2E2', border: '#FCA5A5', icon: '*' },
};

const PRIORITY_RANK = { critical: 1, urgent: 1, high: 2, medium: 3, normal: 4, low: 5 };

function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return hrs + 'h';
  const days = Math.floor(hrs / 24);
  if (days < 7)   return days + 'd';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function navigateTo(page, intent) {
  window.dispatchEvent(new CustomEvent('axiom-navigate', { detail: { page, intent } }));
}

function NoteItem({ n, onClick }) {
  const s = SOURCE_VISUAL.mention;
  return (
    <div onClick={onClick} style={{ padding:'10px 12px', borderBottom:'1px solid var(--border)', cursor:'pointer',
      background:'var(--card-bg)', transition:'background 0.12s' }}
      onMouseEnter={e => e.currentTarget.style.background = s.bg}
      onMouseLeave={e => e.currentTarget.style.background = 'var(--card-bg)'}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
        <span style={{
          fontSize:9, fontWeight:800, color:'#fff', background:s.color,
          width:18, height:18, borderRadius:'50%', display:'inline-flex',
          alignItems:'center', justifyContent:'center', flexShrink:0,
        }}>{s.icon}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, color:'var(--gray)', fontWeight:600 }}>
            {n.from_user_name || 'Someone'} mentioned you {n.patient_name ? ('about ' + n.patient_name) : ''}
          </div>
          <div style={{ fontSize:11, color:'var(--black)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'100%' }}>
            {(n.body || '').replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')}
          </div>
          <div style={{ fontSize:10, color:'var(--gray)', marginTop:3 }}>{timeAgo(n.occurred_at)}</div>
        </div>
      </div>
    </div>
  );
}

function TaskItem({ n, onComplete }) {
  const [expanded, setExpanded] = useState(false);
  const [completing, setCompleting] = useState(false);
  const s = SOURCE_VISUAL.assigned_task;
  const pri = (n.priority || 'normal').toLowerCase();
  const priColor = pri === 'urgent' || pri === 'critical' ? '#DC2626' : pri === 'high' ? '#D97706' : '#6B7280';
  return (
    <div style={{ borderBottom:'1px solid var(--border)', background:'var(--card-bg)' }}>
      <div onClick={() => setExpanded(v => !v)} style={{ padding:'10px 12px', cursor:'pointer' }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
          <span style={{
            fontSize:9, fontWeight:800, color:'#fff', background:s.color,
            width:18, height:18, borderRadius:'50%', display:'inline-flex',
            alignItems:'center', justifyContent:'center', flexShrink:0,
          }}>{s.icon}</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--black)' }}>
              {n.title}
              <span style={{ fontSize:9, fontWeight:700, color: priColor, marginLeft:6, textTransform:'uppercase' }}>{pri}</span>
            </div>
            {n.patient_name && (
              <div style={{ fontSize:10, color:'var(--gray)', marginTop:2 }}>Patient: {n.patient_name}</div>
            )}
            <div style={{ fontSize:10, color:'var(--gray)', marginTop:3 }}>{timeAgo(n.occurred_at)}</div>
          </div>
        </div>
      </div>
      {expanded && (
        <div style={{ padding:'8px 12px 12px 38px', borderTop:'1px solid var(--border)', background:'var(--bg)' }}>
          {n.body && <div style={{ fontSize:11, color:'var(--black)', marginBottom:8, whiteSpace:'pre-wrap' }}>{n.body}</div>}
          {n.metadata?.due_date && (
            <div style={{ fontSize:10, color:'var(--gray)', marginBottom:8 }}>Due: {n.metadata.due_date}</div>
          )}
          <button onClick={async () => {
            setCompleting(true);
            await onComplete(n.metadata?.task_id);
            setCompleting(false);
          }} disabled={completing}
            style={{ padding:'5px 12px', background:'#0F1117', color:'#fff', border:'none',
              borderRadius:6, fontSize:11, fontWeight:600, cursor: completing ? 'wait' : 'pointer' }}>
            {completing ? 'Marking...' : 'Mark complete'}
          </button>
        </div>
      )}
    </div>
  );
}

function AlertItem({ n }) {
  const s = SOURCE_VISUAL.alert;
  const alertType = n.metadata?.alert_type;
  const pri = (n.priority || 'medium').toLowerCase();
  const dotColor = pri === 'critical' ? '#DC2626' : pri === 'high' ? '#D97706' : '#3B82F6';
  function onClick() {
    if (alertType === 'auth_over_limit')  navigateTo('auth-over-limit', null);
    else if (alertType === 'auth_low_visits') navigateTo('visit-runway', null);
    else if (alertType === 'auth_expiring')   navigateTo('auth-expiry-timeline', null);
  }
  return (
    <div onClick={onClick} style={{ padding:'10px 12px', borderBottom:'1px solid var(--border)', cursor:'pointer',
      background:'var(--card-bg)', transition:'background 0.12s' }}
      onMouseEnter={e => e.currentTarget.style.background = s.bg}
      onMouseLeave={e => e.currentTarget.style.background = 'var(--card-bg)'}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
        <span style={{
          fontSize:9, fontWeight:800, color:'#fff', background:dotColor,
          width:18, height:18, borderRadius:'50%', display:'inline-flex',
          alignItems:'center', justifyContent:'center', flexShrink:0,
        }}>{s.icon}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--black)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {n.title}
          </div>
          {n.patient_name && (
            <div style={{ fontSize:10, color:'var(--gray)', marginTop:2 }}>{n.patient_name}</div>
          )}
          <div style={{ fontSize:10, color:'var(--gray)', marginTop:3 }}>{timeAgo(n.occurred_at)}</div>
        </div>
      </div>
    </div>
  );
}

export default function MyDayNotificationsFeed() {
  const { profile } = useAuth();
  const regionScope = useAssignedRegions();
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all'); // all | mentions | tasks | alerts

  async function load() {
    setLoading(true);
    const all = await fetchAllPages(supabase.from('v_my_day_notifications').select('*'));
    // Scope to current user / regions in the client
    const myUserId = profile?.user_id || profile?.id;
    const myName = (profile?.full_name || '').toLowerCase();
    const myRegions = regionScope.isAllAccess ? null : (regionScope.regions || []);
    const scoped = (all || []).filter(n => {
      if (n.source === 'mention') {
        return n.recipient_user_id && myUserId && n.recipient_user_id === myUserId;
      }
      if (n.source === 'assigned_task') {
        return n.recipient_name && (n.recipient_name || '').toLowerCase() === myName;
      }
      if (n.source === 'alert') {
        if (!myRegions) return true;
        if (!n.recipient_region) return true; // unassigned region alerts visible to all
        return myRegions.includes(n.recipient_region);
      }
      return false;
    });
    // Sort: priority asc (critical first), then time desc
    scoped.sort((a, b) => {
      const pa = PRIORITY_RANK[(a.priority || 'normal').toLowerCase()] || 99;
      const pb = PRIORITY_RANK[(b.priority || 'normal').toLowerCase()] || 99;
      if (pa !== pb) return pa - pb;
      return (b.occurred_at || '').localeCompare(a.occurred_at || '');
    });
    setFeed(scoped);
    setLoading(false);
  }

  useEffect(() => {
    if (regionScope.loading || !profile) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionScope.loading, regionScope.isAllAccess, JSON.stringify(regionScope.regions), profile?.id]);

  useRealtimeTable(['note_notifications','coordinator_tasks','alerts'], load);

  const visible = useMemo(() => {
    if (tab === 'all') return feed;
    if (tab === 'mentions') return feed.filter(n => n.source === 'mention');
    if (tab === 'tasks')    return feed.filter(n => n.source === 'assigned_task');
    if (tab === 'alerts')   return feed.filter(n => n.source === 'alert');
    return feed;
  }, [feed, tab]);

  const counts = useMemo(() => ({
    all:      feed.length,
    mentions: feed.filter(n => n.source === 'mention').length,
    tasks:    feed.filter(n => n.source === 'assigned_task').length,
    alerts:   feed.filter(n => n.source === 'alert').length,
  }), [feed]);

  async function completeTask(taskId) {
    if (!taskId) return;
    const { error } = await safeUpdate('coordinator_tasks', {
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by: profile?.full_name || profile?.email || null,
      updated_at: new Date().toISOString(),
    }, { id: taskId });
    if (!error) {
      try {
        await logActivity({
          coordinatorId: profile?.id,
          coordinatorName: profile?.full_name,
          coordinatorRole: profile?.role,
          actionType: 'task_completed',
          tableName: 'coordinator_tasks',
          recordId: taskId,
          actionDetail: 'Marked complete from My Day feed',
        });
      } catch (e) { /* non-blocking */ }
    }
    load();
  }

  function openMention(n) {
    if (n.patient_name) {
      navigateTo('census', { searchPatient: n.patient_name });
    }
    // Mark this mention as read
    supabase.from('note_notifications').update({ read: true })
      .eq('id', n.source_id).then(() => load());
  }

  function TabBtn({ k, label, count }) {
    const active = tab === k;
    return (
      <button onClick={() => setTab(k)} style={{
        padding:'6px 10px', border:'none', background:'none',
        borderBottom: active ? '2px solid #0F1117' : '2px solid transparent',
        color: active ? 'var(--black)' : 'var(--gray)', fontSize:11, fontWeight: active ? 700 : 500,
        cursor:'pointer', whiteSpace:'nowrap',
      }}>
        {label} {count > 0 && <span style={{ fontSize:9, color: active ? '#fff' : '#6B7280',
          background: active ? '#0F1117' : '#E5E7EB', padding:'1px 6px', borderRadius:999,
          marginLeft:4, fontWeight:700 }}>{count}</span>}
      </button>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
      <div style={{ padding:'12px 14px', borderBottom:'1px solid var(--border)', background:'var(--card-bg)' }}>
        <div style={{ fontSize:13, fontWeight:700, color:'var(--black)' }}>Notifications</div>
        <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>
          {loading ? 'Loading...' : counts.all + ' total to review'}
        </div>
      </div>
      <div style={{ display:'flex', padding:'0 6px', borderBottom:'1px solid var(--border)', background:'var(--card-bg)', overflowX:'auto' }}>
        <TabBtn k="all"      label="All"      count={counts.all} />
        <TabBtn k="mentions" label="Mentions" count={counts.mentions} />
        <TabBtn k="tasks"    label="Tasks"    count={counts.tasks} />
        <TabBtn k="alerts"   label="Alerts"   count={counts.alerts} />
      </div>
      <div style={{ flex:1, overflowY:'auto' }}>
        {loading && feed.length === 0 ? (
          <div style={{ padding:24, textAlign:'center', color:'var(--gray)', fontSize:12 }}>Loading...</div>
        ) : visible.length === 0 ? (
          <div style={{ padding:30, textAlign:'center', color:'var(--gray)', fontSize:12 }}>
            Nothing to review. Clear inbox.
          </div>
        ) : (
          visible.map(n => {
            const key = n.source + ':' + n.source_id;
            if (n.source === 'mention')        return <NoteItem key={key} n={n} onClick={() => openMention(n)} />;
            if (n.source === 'assigned_task')  return <TaskItem key={key} n={n} onComplete={completeTask} />;
            if (n.source === 'alert')          return <AlertItem key={key} n={n} />;
            return null;
          })
        )}
      </div>
    </div>
  );
}
