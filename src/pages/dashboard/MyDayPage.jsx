// MyDayPage — the daily-zero landing page for auth coordinators.
//
// Job-to-be-done: when an auth coordinator logs in, they see the four
// task sources combined into a single prioritized list, with a clear daily
// metric ("X of Y cleared today") so they have a concrete target.
//
// Task sources (combined virtually here, not joined in DB):
//   1. auth_renewal_tasks WHERE assigned_to=me AND task_status IN ('open','in_progress')
//   2. auth_tracker       WHERE assigned_to=me AND auth_status   IN ('pending','submitted')
//   3. auth_tracker       WHERE assigned_to=me AND auth_health   IN ('over_limit','low_visits')
//   4. auth_tracker       WHERE assigned_to=me AND auth_expiry_date <= today+7 AND auth_health != 'exhausted'
//
// Clear-to-zero logic: a task drops off ONLY when its underlying status
// actually changes (auth_status, task_status, auth_health). No "mark done"
// button — the metric is gameable-resistant by design.
//
// Daily snapshot: on first page load of the day, we insert a row into
// coordinator_daily_metrics with start_task_keys = exact array of task keys
// open at that moment. Subsequent loads compute precise set-based diffs:
//   cleared_today          = start_task_keys \ current_keys (started open → now closed)
//   remaining_from_morning = start_task_keys ∩ current_keys (started open → still open)
//   new_today              = current_keys \ start_task_keys (arrived after first load)
// This is auditable: "did this coordinator close THESE specific 12 tasks?"
//
// See supabase/migrations/20260527130000_coordinator_my_day.sql for the
// snapshot table + RLS.

import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, safeUpdate, fetchAllPages, logActivity } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d + 'T00:00:00') - new Date()) / 86400000);
}
function todayDateStr() {
  // Local date YYYY-MM-DD (matches DATE column semantics)
  var n = new Date();
  var m = String(n.getMonth()+1).padStart(2,'0');
  var d = String(n.getDate()).padStart(2,'0');
  return n.getFullYear() + '-' + m + '-' + d;
}

// Tier definitions — order matters (higher = more urgent)
var TIERS = {
  CRITICAL: { label: 'Critical',  color: '#7F1D1D', bg: '#FEE2E2', border: '#FECACA', icon: 'C' },
  HIGH:     { label: 'High',      color: '#92400E', bg: '#FFFBEB', border: '#FDE68A', icon: 'H' },
  NORMAL:   { label: 'Open',      color: '#1E40AF', bg: '#EFF6FF', border: '#BFDBFE', icon: 'O' },
};

// ── Task builder — takes raw rows from the 4 sources and produces a
// uniform task list, deduped, with tier classification.
function buildTaskList(renewalTasks, authRows) {
  var tasks = [];
  var authIdsSeen = {}; // dedupe auth rows that hit multiple sources

  // Source 1: renewal tasks
  (renewalTasks || []).forEach(function(t) {
    var tier = t.priority === 'urgent' ? 'CRITICAL'
             : t.priority === 'high'   ? 'HIGH'
             : 'NORMAL';
    tasks.push({
      key: 'rt:' + t.id,
      source: 'renewal_task',
      sourceTable: 'auth_renewal_tasks',
      sourceId: t.id,
      tier: tier,
      patientName: t.patient_name || '(unnamed)',
      region: t.region || '',
      insurance: t.insurance || '',
      reason: 'Renewal task - ' + (t.task_status || 'open').replace('_',' '),
      daysLeft: t.days_until_expiry,
      visitsRemaining: t.visits_remaining,
      currentStatus: t.task_status,
      raw: t,
    });
  });

  // Source 2-4: auth_tracker rows (with priority for tier classification)
  (authRows || []).forEach(function(a) {
    if (authIdsSeen[a.id]) return; // safety, though source query is single
    authIdsSeen[a.id] = true;

    var d = daysUntil(a.auth_expiry_date);
    var visitsRem = Math.max(0, (a.visits_authorized || 0) - (a.visits_used || 0));

    // Determine which "bucket" this auth qualifies for + assign tier
    var reasons = [];
    var tier = 'NORMAL';

    if (a.auth_health === 'over_limit') {
      reasons.push('OVER LIMIT (+' + Math.max(0, (a.visits_used||0) - (a.visits_authorized||0)) + ')');
      tier = 'CRITICAL';
    } else if (a.auth_health === 'low_visits') {
      reasons.push('Low visits (' + visitsRem + ' left)');
      if (tier !== 'CRITICAL') tier = 'HIGH';
    }

    if (d !== null && d <= 3 && d >= 0) {
      reasons.push('Expires in ' + d + 'd');
      tier = 'CRITICAL';
    } else if (d !== null && d <= 7 && d > 3) {
      reasons.push('Expires in ' + d + 'd');
      if (tier === 'NORMAL') tier = 'HIGH';
    } else if (d !== null && d < 0) {
      reasons.push('EXPIRED ' + Math.abs(d) + 'd ago');
      tier = 'CRITICAL';
    }

    if (/^(pending|submitted)$/i.test(a.auth_status || '')) {
      reasons.push('Auth ' + a.auth_status);
      // pending/submitted alone doesn't bump tier above NORMAL
    }

    if (reasons.length === 0) return; // doesn't qualify for any bucket

    tasks.push({
      key: 'at:' + a.id,
      source: 'auth_tracker',
      sourceTable: 'auth_tracker',
      sourceId: a.id,
      tier: tier,
      patientName: a.patient_name || '(unnamed)',
      region: a.region || '',
      insurance: a.insurance || '',
      reason: reasons.join(' / '),
      daysLeft: d,
      visitsRemaining: visitsRem,
      currentStatus: a.auth_status,
      authHealth: a.auth_health,
      raw: a,
    });
  });

  // Sort: CRITICAL > HIGH > NORMAL, then days_until_expiry asc (soonest first)
  var tierRank = { CRITICAL: 0, HIGH: 1, NORMAL: 2 };
  tasks.sort(function(a, b) {
    var tDiff = tierRank[a.tier] - tierRank[b.tier];
    if (tDiff !== 0) return tDiff;
    var aD = a.daysLeft == null ? 9999 : a.daysLeft;
    var bD = b.daysLeft == null ? 9999 : b.daysLeft;
    return aD - bD;
  });

  return tasks;
}

// ── Components ─────────────────────────────────────────────────────────────

function HeroMetric({ totalOpen, startCount, clearedFromMorning, remainingFromMorning, newToday, percent }) {
  // "Inbox zero" specifically means every task from the morning is closed.
  // New tasks arriving after start-of-day don't block hitting zero — they're tomorrow's problem.
  var morningCleared = startCount > 0 && remainingFromMorning === 0;
  var fullZero = totalOpen === 0 && startCount > 0;
  return (
    <div style={{ padding:'24px 20px', background: fullZero ? '#ECFDF5' : 'var(--card-bg)', borderBottom:'1px solid var(--border)' }}>
      <div style={{ display:'flex', gap:24, alignItems:'center', flexWrap:'wrap' }}>
        {/* Big number — TOTAL open right now (morning carryover + new) */}
        <div style={{ minWidth:200 }}>
          <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--gray)', marginBottom:6 }}>
            Open right now
          </div>
          <div style={{ fontSize:64, fontWeight:800, lineHeight:1, color: fullZero ? '#059669' : (totalOpen > 10 ? '#DC2626' : 'var(--black)') }}>
            {totalOpen}
          </div>
          {startCount === 0 ? (
            <div style={{ fontSize:12, color:'var(--gray)', marginTop:6 }}>No snapshot yet for today.</div>
          ) : (
            <div style={{ fontSize:12, color:'var(--gray)', marginTop:6, lineHeight:1.5 }}>
              <div><strong>{clearedFromMorning} of {startCount}</strong> from this morning cleared ({percent}%)</div>
              <div>{remainingFromMorning} from this morning still open{newToday > 0 ? (' · ' + newToday + ' new since') : ''}</div>
            </div>
          )}
        </div>

        {/* Progress bar — % of THIS MORNING's tasks cleared (not affected by new arrivals) */}
        {startCount > 0 && (
          <div style={{ flex:1, minWidth:260 }}>
            <div style={{ fontSize:10, fontWeight:600, color:'var(--gray)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>
              This morning&apos;s queue
            </div>
            <div style={{ height:14, background:'#F3F4F6', borderRadius:7, overflow:'hidden', border:'1px solid var(--border)' }}>
              <div style={{
                width: percent + '%',
                height:'100%',
                background: morningCleared ? 'linear-gradient(90deg, #10B981, #059669)'
                                           : (percent >= 50 ? 'linear-gradient(90deg, #F59E0B, #D97706)'
                                                            : 'linear-gradient(90deg, #DC2626, #B91C1C)'),
                transition:'width 0.4s ease',
              }} />
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--gray)', marginTop:6 }}>
              <span>Started: {startCount}</span>
              <span>{clearedFromMorning} cleared</span>
              <span>{remainingFromMorning} left from AM</span>
            </div>
            {newToday > 0 && (
              <div style={{ fontSize:10, color:'#92400E', marginTop:6, padding:'4px 8px', background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:4 }}>
                <strong>+{newToday}</strong> new task{newToday===1?'':'s'} arrived after your day started
              </div>
            )}
          </div>
        )}

        {/* Zero state celebrations */}
        {fullZero && (
          <div style={{ padding:'14px 18px', background:'#D1FAE5', border:'1px solid #6EE7B7', borderRadius:10, color:'#065F46' }}>
            <div style={{ fontSize:14, fontWeight:700 }}>Inbox zero. Day complete.</div>
            <div style={{ fontSize:11, marginTop:2 }}>Every task cleared, including any that arrived today. Tomorrow&apos;s queue arrives at midnight.</div>
          </div>
        )}
        {morningCleared && !fullZero && (
          <div style={{ padding:'14px 18px', background:'#ECFDF5', border:'1px solid #A7F3D0', borderRadius:10, color:'#065F46' }}>
            <div style={{ fontSize:14, fontWeight:700 }}>This morning&apos;s queue cleared.</div>
            <div style={{ fontSize:11, marginTop:2 }}>{newToday} new task{newToday===1?'':'s'} arrived since — handle when you can.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function TierSection({ tier, tasks, onAdvance, savingId }) {
  if (tasks.length === 0) return null;
  var cfg = TIERS[tier];
  return (
    <div style={{ borderBottom:'1px solid var(--border)' }}>
      <div style={{ padding:'10px 20px', background: cfg.bg, borderBottom:'1px solid ' + cfg.border, display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:11, fontWeight:800, color: cfg.color, textTransform:'uppercase', letterSpacing:'0.08em' }}>
          {cfg.label}
        </span>
        <span style={{ fontSize:11, color: cfg.color, fontWeight:600 }}>
          ({tasks.length})
        </span>
      </div>
      <div>
        {tasks.map(function(t) {
          return <TaskRow key={t.key} task={t} onAdvance={onAdvance} saving={savingId === t.key} />;
        })}
      </div>
    </div>
  );
}

function TaskRow({ task, onAdvance, saving }) {
  // Next-status buttons depend on source
  var actions = [];
  if (task.source === 'auth_tracker') {
    if (task.currentStatus === 'pending') {
      actions.push({ label: 'Mark Submitted', next: 'submitted' });
    } else if (task.currentStatus === 'submitted') {
      actions.push({ label: 'Mark Active',   next: 'active' });
      actions.push({ label: 'Mark Denied',   next: 'denied' });
    } else {
      actions.push({ label: 'Mark Active',   next: 'active' });
    }
  } else if (task.source === 'renewal_task') {
    if (task.currentStatus === 'open') {
      actions.push({ label: 'Start',     next: 'in_progress' });
    }
    actions.push({ label: 'Submitted',  next: 'submitted' });
    actions.push({ label: 'Approved',   next: 'approved' });
    actions.push({ label: 'Denied',     next: 'denied' });
  }

  return (
    <div style={{ padding:'12px 20px', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid var(--border)' }}>
      {/* Left: patient + reason */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:700, color:'var(--black)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {task.patientName}
          {task.region ? <span style={{ fontSize:10, color:'var(--gray)', marginLeft:8, fontWeight:400 }}>Region {task.region}</span> : null}
          {task.insurance ? <span style={{ fontSize:10, color:'var(--gray)', marginLeft:8, fontWeight:400 }}>{task.insurance}</span> : null}
        </div>
        <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>
          {task.reason}
          {task.visitsRemaining != null && task.source === 'auth_tracker' ? (
            <span style={{ marginLeft:10 }}>Visits left: <strong>{task.visitsRemaining}</strong></span>
          ) : null}
        </div>
      </div>

      {/* Right: action buttons */}
      <div style={{ display:'flex', gap:6, flexShrink:0 }}>
        {actions.map(function(a) {
          return (
            <button key={a.next}
              onClick={function() { onAdvance(task, a.next); }}
              disabled={saving}
              style={{
                padding:'6px 10px',
                fontSize:11,
                fontWeight:600,
                border:'1px solid var(--border)',
                borderRadius:6,
                background: saving ? '#F3F4F6' : 'var(--card-bg)',
                color: saving ? 'var(--gray)' : 'var(--black)',
                cursor: saving ? 'not-allowed' : 'pointer',
                whiteSpace:'nowrap',
              }}>
              {saving ? '...' : a.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function MyDayPage() {
  const { profile } = useAuth();
  const profileName = profile?.full_name || profile?.email || '';

  const [authRows, setAuthRows] = useState([]);
  const [renewalTasks, setRenewalTasks] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    if (!profileName) { setLoading(false); return; }
    const today = todayDateStr();
    const inSevenDays = (function() {
      var d = new Date(); d.setDate(d.getDate() + 7);
      var m = String(d.getMonth()+1).padStart(2,'0');
      var dd = String(d.getDate()).padStart(2,'0');
      return d.getFullYear() + '-' + m + '-' + dd;
    })();

    // Pull the 4 task sources in parallel
    const [authsRes, tasksRes, snapRes] = await Promise.all([
      // auth_tracker rows assigned to me that qualify for any bucket
      fetchAllPages(
        supabase.from('auth_tracker')
          .select('*')
          .eq('assigned_to', profileName)
          .or(
            // pending/submitted OR over_limit/low_visits OR expiring soon
            'auth_status.in.(pending,submitted),' +
            'auth_health.in.(over_limit,low_visits),' +
            'auth_expiry_date.lte.' + inSevenDays
          )
      ),
      // renewal tasks assigned to me that are open/in_progress
      fetchAllPages(
        supabase.from('auth_renewal_tasks')
          .select('*')
          .eq('assigned_to', profileName)
          .in('task_status', ['open', 'in_progress'])
      ),
      // today's snapshot if any
      supabase.from('coordinator_daily_metrics')
        .select('*')
        .eq('coordinator_name', profileName)
        .eq('snapshot_date', today)
        .maybeSingle(),
    ]);

    var auths = authsRes || [];
    var tasks = tasksRes || [];
    setAuthRows(auths);
    setRenewalTasks(tasks);

    // Build initial task list to compute current count for snapshot
    var allTasks = buildTaskList(tasks, auths);
    var currentCount = allTasks.length;
    var criticalCount = allTasks.filter(function(t) { return t.tier === 'CRITICAL'; }).length;
    var highCount     = allTasks.filter(function(t) { return t.tier === 'HIGH'; }).length;
    var normalCount   = allTasks.filter(function(t) { return t.tier === 'NORMAL'; }).length;

    var snap = snapRes?.data || null;
    if (!snap) {
      // First load of the day — capture the exact set of task keys open right now.
      // This is the authoritative "this morning's queue" we'll diff against later.
      var startKeys = allTasks.map(function(t) { return t.key; });
      const { data: inserted, error: insertErr } = await supabase
        .from('coordinator_daily_metrics')
        .insert({
          coordinator_name: profileName,
          snapshot_date: today,
          start_task_keys: startKeys,
          start_count: currentCount,
          start_critical: criticalCount,
          start_high: highCount,
          start_normal: normalCount,
          snapshot_started_at: new Date().toISOString(),
          last_updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (!insertErr) snap = inserted;
    } else {
      // Update last_updated_at (non-blocking)
      supabase.from('coordinator_daily_metrics')
        .update({ last_updated_at: new Date().toISOString() })
        .eq('id', snap.id)
        .then(function() { /* no-op */ });
    }
    setSnapshot(snap);
    setLoading(false);
  }, [profileName]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable(['auth_tracker', 'auth_renewal_tasks'], load);

  // Build the unified task list from current state
  const tasks = useMemo(() => buildTaskList(renewalTasks, authRows), [renewalTasks, authRows]);
  const tasksByTier = useMemo(() => ({
    CRITICAL: tasks.filter(function(t) { return t.tier === 'CRITICAL'; }),
    HIGH:     tasks.filter(function(t) { return t.tier === 'HIGH'; }),
    NORMAL:   tasks.filter(function(t) { return t.tier === 'NORMAL'; }),
  }), [tasks]);

  // ── Daily metrics — EXACT set-based math ────────────────────────────────
  // This is the gameable-resistant version: we know exactly WHICH tasks were
  // open this morning, not just how many. So:
  //   cleared_from_morning   = start_task_keys NOT in current_keys
  //   remaining_from_morning = start_task_keys     in current_keys
  //   new_today              = current_keys   NOT in start_task_keys
  //
  // Total open right now = remaining_from_morning + new_today = current task count.
  // The "% cleared" progress bar reflects what was actually closed FROM this
  // morning's queue, unaffected by new tasks arriving mid-day.
  const startTaskKeys = snapshot?.start_task_keys || [];
  const startCount = startTaskKeys.length;
  const currentKeys = useMemo(() => tasks.map(function(t) { return t.key; }), [tasks]);
  const currentKeySet = useMemo(() => new Set(currentKeys), [currentKeys]);
  const startKeySet   = useMemo(() => new Set(startTaskKeys), [startTaskKeys]);

  const clearedFromMorning = useMemo(() =>
    startTaskKeys.filter(function(k) { return !currentKeySet.has(k); }).length,
  [startTaskKeys, currentKeySet]);

  const remainingFromMorning = useMemo(() =>
    startTaskKeys.filter(function(k) { return currentKeySet.has(k); }).length,
  [startTaskKeys, currentKeySet]);

  const newToday = useMemo(() =>
    currentKeys.filter(function(k) { return !startKeySet.has(k); }).length,
  [currentKeys, startKeySet]);

  const totalOpen = tasks.length;
  const percent = startCount > 0 ? Math.round((clearedFromMorning / startCount) * 100) : 0;

  async function advanceStatus(task, newStatus) {
    setSavingId(task.key);
    try {
      if (task.source === 'auth_tracker') {
        const { error } = await safeUpdate(
          'auth_tracker',
          {
            auth_status: newStatus,
            updated_at: new Date().toISOString(),
            updated_by: profileName,
          },
          { id: task.sourceId }
        );
        if (error) throw error;
        // 2026-05-27 audit fix: every auth_tracker write must trigger sync.
        if (task.patientName) {
          await supabase.rpc('sync_visits_to_auth_for_patient', { p_patient_name: task.patientName });
          await supabase.rpc('recompute_auth_sequence',         { p_patient_name: task.patientName });
        }
        try {
          await logActivity({
            coordinatorId: profile?.id,
            coordinatorName: profileName,
            coordinatorRole: profile?.role,
            actionType: 'auth_status_change',
            tableName: 'auth_tracker',
            recordId: task.sourceId,
            actionDetail: 'My Day: ' + task.currentStatus + ' -> ' + newStatus,
          });
        } catch (e) { /* non-blocking */ }
      } else if (task.source === 'renewal_task') {
        var closed = ['approved','denied','closed'].indexOf(newStatus) >= 0;
        const { error } = await supabase.from('auth_renewal_tasks').update({
          task_status: newStatus,
          updated_at: new Date().toISOString(),
          completed_at: closed ? new Date().toISOString() : null,
          completed_by: closed ? profileName : null,
        }).eq('id', task.sourceId);
        if (error) throw error;
      }
      // Reload to refresh task list + cleared count
      await load();
    } catch (err) {
      console.error('advanceStatus failed:', err);
      alert('Could not advance status: ' + (err.message || err));
    }
    setSavingId(null);
  }

  if (loading) {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
        <TopBar title="My Day" subtitle="Loading..." />
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>
          Loading your tasks...
        </div>
      </div>
    );
  }

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  const greeting = (function() {
    var h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%' }}>
      <TopBar
        title="My Day"
        subtitle={greeting + (profileName ? ', ' + profileName.split(' ')[0] : '') + ' - ' + today}
        actions={
          <button onClick={load} style={{ padding:'6px 14px', background:'#0F1117', color:'#fff', border:'none', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer' }}>
            Refresh
          </button>
        }
      />

      {/* Purpose banner */}
      <div style={{ padding:'10px 20px', background:'#EFF6FF', borderBottom:'1px solid #BFDBFE', fontSize:12, color:'#1E40AF', display:'flex', gap:8, alignItems:'center' }}>
        <span style={{ fontSize:14 }}>★</span>
        <span><strong>Your daily target: clear to zero.</strong> Tasks here are pulled from renewals, pending auths, compliance alerts, and expiring auths assigned to you. A task drops off only when its real status changes - no "mark done" shortcut.</span>
      </div>

      {/* Hero metric */}
      <HeroMetric
        totalOpen={totalOpen}
        startCount={startCount}
        clearedFromMorning={clearedFromMorning}
        remainingFromMorning={remainingFromMorning}
        newToday={newToday}
        percent={percent}
      />

      {/* Task list */}
      <div style={{ flex:1, overflow:'auto' }}>
        {totalOpen === 0 && startCount === 0 && (
          <div style={{ padding:'40px 20px', textAlign:'center', color:'var(--gray)' }}>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:6 }}>Nothing assigned to you yet.</div>
            <div style={{ fontSize:12 }}>When auths or renewal tasks get assigned to you, they will appear here.</div>
          </div>
        )}
        {totalOpen === 0 && startCount > 0 && (
          <div style={{ padding:'40px 20px', textAlign:'center', color:'#059669' }}>
            <div style={{ fontSize:18, fontWeight:700, marginBottom:6 }}>All clear.</div>
            <div style={{ fontSize:12, color:'var(--gray)' }}>
              You cleared {clearedFromMorning} of this morning&apos;s {startCount} task{startCount===1?'':'s'}
              {newToday > 0 ? (' and the ' + newToday + ' that arrived since') : ''}.
              Tomorrow&apos;s queue arrives at midnight.
            </div>
          </div>
        )}
        <TierSection tier="CRITICAL" tasks={tasksByTier.CRITICAL} onAdvance={advanceStatus} savingId={savingId} />
        <TierSection tier="HIGH"     tasks={tasksByTier.HIGH}     onAdvance={advanceStatus} savingId={savingId} />
        <TierSection tier="NORMAL"   tasks={tasksByTier.NORMAL}   onAdvance={advanceStatus} savingId={savingId} />
      </div>
    </div>
  );
}
