// TeamPerformanceToday.jsx
//
// Three-column leaderboard for Carla: Care / Auth / Intake. Each column
// shows that role's coordinators with:
//   - status dot (logged in today, this week, stale)
//   - open work count (pulled from the right source per role)
//   - completed-today count
//   - last_active timestamp
//
// Work source per role:
//   care_coordinator   coordinator_tasks (assigned_to, status, completed_at)
//   auth_coordinator   auth_renewal_tasks (assigned_to, task_status, completed_at)
//                      + auth_tracker (assigned_to)
//   intake_coordinator intake_referrals (this week, status='Pending', no welcome_call)
//                      (no assigned_to per Phase 2 design — Kiarra owns the queue)
//
// CLAUDE.md compliance: ASCII only in JSX text.

import { useEffect, useMemo, useState } from 'react';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

function fmtAgo(ts) {
  if (!ts) return 'never';
  const d = new Date(ts);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  return Math.floor(hrs / 24) + 'd';
}

function statusDot(daysSinceLogin) {
  if (daysSinceLogin === null || daysSinceLogin === undefined) return { color: '#9CA3AF', label: 'never' };
  if (daysSinceLogin === 0) return { color: '#10B981', label: 'today' };
  if (daysSinceLogin <= 2)  return { color: '#3B82F6', label: 'recent' };
  if (daysSinceLogin <= 7)  return { color: '#F59E0B', label: 'week' };
  return { color: '#DC2626', label: 'stale' };
}

function CoordinatorRow({ c, open, doneToday }) {
  const s = statusDot(c.days_since_last_login);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '12px 1fr 50px 50px 50px',
      gap: 6, alignItems: 'center', padding: '7px 10px',
      borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 8, height: 8, background: s.color, borderRadius: '50%' }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--black)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {c.full_name}
        </div>
        <div style={{ fontSize: 9, color: c.days_since_last_login >= 7 ? '#DC2626' : '#6B7280' }}>
          {c.days_since_last_login === null ? 'never logged in' :
           c.days_since_last_login === 0 ? 'active today' :
           c.days_since_last_login + 'd ago'}
        </div>
      </div>
      <div title="Open tasks" style={{ fontSize: 13, fontWeight: 700, fontFamily: 'DM Mono, monospace',
        color: open > 20 ? '#DC2626' : open > 10 ? '#D97706' : 'var(--black)', textAlign: 'right' }}>
        {open}
      </div>
      <div title="Completed today" style={{ fontSize: 13, fontWeight: 700, fontFamily: 'DM Mono, monospace',
        color: doneToday > 0 ? '#059669' : '#9CA3AF', textAlign: 'right' }}>
        {doneToday}
      </div>
      <div style={{ fontSize: 10, color: '#6B7280', textAlign: 'right' }}>
        {fmtAgo(c.last_sign_in_at)}
      </div>
    </div>
  );
}

function ColumnHeader({ label, totalCount }) {
  return (
    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)',
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      background: 'var(--bg)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--black)',
        textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 10, color: 'var(--gray)' }}>{totalCount} coord{totalCount === 1 ? '' : 's'}</div>
    </div>
  );
}

function MiniLegend() {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '6px 12px', fontSize: 9, color: '#6B7280',
      borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
      <span><span style={{ display:'inline-block', width:6, height:6, background:'#10B981', borderRadius:'50%', marginRight:4 }}/>today</span>
      <span><span style={{ display:'inline-block', width:6, height:6, background:'#3B82F6', borderRadius:'50%', marginRight:4 }}/>this week</span>
      <span><span style={{ display:'inline-block', width:6, height:6, background:'#DC2626', borderRadius:'50%', marginRight:4 }}/>stale &gt; 7d</span>
    </div>
  );
}

export default function TeamPerformanceToday() {
  const [engagement, setEngagement] = useState([]);
  const [careTasks, setCareTasks] = useState([]);
  const [authRenewals, setAuthRenewals] = useState([]);
  const [authTracker, setAuthTracker] = useState([]);
  const [intake, setIntake] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    // Sunday-Saturday work week per dateUtils.js convention
    const today = new Date();
    const dayOfWeek = today.getDay();
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - dayOfWeek); weekStart.setHours(0,0,0,0);
    const weekStartStr = weekStart.toISOString().slice(0,10);

    const [eng, ct, ar, at, ir] = await Promise.all([
      supabase.rpc('get_coordinator_engagement'),
      fetchAllPages(supabase.from('coordinator_tasks')
        .select('id,assigned_to,status,completed_at,created_at')),
      fetchAllPages(supabase.from('auth_renewal_tasks')
        .select('id,assigned_to,task_status,completed_at,opened_at')),
      fetchAllPages(supabase.from('auth_tracker')
        .select('id,assigned_to,auth_status,updated_at')
        .in('auth_status', ['pending','submitted'])),
      fetchAllPages(supabase.from('intake_referrals')
        .select('id,patient_name,referral_status,welcome_call,date_received')
        .gte('date_received', weekStartStr)),
    ]);
    setEngagement(eng.data || []);
    setCareTasks(ct || []);
    setAuthRenewals(ar || []);
    setAuthTracker(at || []);
    setIntake(ir || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);
  useRealtimeTable(['coordinator_tasks','auth_renewal_tasks','auth_tracker','intake_referrals'], load);

  const today0 = useMemo(() => {
    const d = new Date(); d.setHours(0,0,0,0); return d.getTime();
  }, []);

  const careCoords = engagement.filter(e => e.role === 'care_coordinator');
  const authCoords = engagement.filter(e => e.role === 'auth_coordinator');
  const intakeCoords = engagement.filter(e => e.role === 'intake_coordinator');

  function countByName(rows, nameField, predicate) {
    const map = {};
    for (const r of rows) {
      if (!predicate || predicate(r)) {
        const k = (r[nameField] || '').toLowerCase().trim();
        if (k) map[k] = (map[k] || 0) + 1;
      }
    }
    return map;
  }

  // Care coord open / done today
  const careOpenByName = useMemo(
    () => countByName(careTasks, 'assigned_to', r => !['completed','closed','cancelled'].includes(r.status)),
    [careTasks]
  );
  const careDoneTodayByName = useMemo(
    () => countByName(careTasks, 'assigned_to',
      r => r.status === 'completed' && r.completed_at && new Date(r.completed_at).getTime() >= today0),
    [careTasks, today0]
  );

  // Auth coord open work = open renewal tasks + pending/submitted auth_tracker rows assigned to them
  const authOpenByName = useMemo(() => {
    const a = countByName(authRenewals, 'assigned_to',
      r => !['approved','denied','closed'].includes(r.task_status));
    const b = countByName(authTracker, 'assigned_to', null);
    const merged = { ...a };
    for (const k of Object.keys(b)) merged[k] = (merged[k] || 0) + b[k];
    return merged;
  }, [authRenewals, authTracker]);
  const authDoneTodayByName = useMemo(
    () => countByName(authRenewals, 'assigned_to',
      r => ['approved','denied','closed'].includes(r.task_status) && r.completed_at && new Date(r.completed_at).getTime() >= today0),
    [authRenewals, today0]
  );

  // Intake — team queue (no per-coord assignment)
  const intakeOpenTotal = useMemo(
    () => intake.filter(r => r.referral_status === 'Pending' && !r.welcome_call).length,
    [intake]
  );

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--gray)', fontSize: 12 }}>
        Loading team performance...
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)',
      borderRadius: 10, margin: '12px 20px', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>Team Performance Today</div>
        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>
          Per-coordinator open work + completed-today. Status dot = login recency. Numbers update live.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>

        {/* Care Coord */}
        <div style={{ borderRight: '1px solid var(--border)' }}>
          <ColumnHeader label="Care Coordinators" totalCount={careCoords.length} />
          <div style={{ display: 'grid', gridTemplateColumns: '12px 1fr 50px 50px 50px',
            gap: 6, padding: '4px 10px', fontSize: 9, fontWeight: 700, color: '#6B7280',
            background: 'var(--bg)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <span /><span>NAME</span>
            <span style={{ textAlign:'right' }}>OPEN</span>
            <span style={{ textAlign:'right' }}>DONE</span>
            <span style={{ textAlign:'right' }}>SEEN</span>
          </div>
          {careCoords.length === 0 && (
            <div style={{ padding: 20, textAlign:'center', color:'var(--gray)', fontSize: 11 }}>No care coordinators</div>
          )}
          {careCoords.map(c => (
            <CoordinatorRow key={c.coordinator_id} c={c}
              open={careOpenByName[(c.full_name||'').toLowerCase().trim()] || 0}
              doneToday={careDoneTodayByName[(c.full_name||'').toLowerCase().trim()] || 0} />
          ))}
          <MiniLegend />
        </div>

        {/* Auth Coord */}
        <div style={{ borderRight: '1px solid var(--border)' }}>
          <ColumnHeader label="Auth Coordinators" totalCount={authCoords.length} />
          <div style={{ display: 'grid', gridTemplateColumns: '12px 1fr 50px 50px 50px',
            gap: 6, padding: '4px 10px', fontSize: 9, fontWeight: 700, color: '#6B7280',
            background: 'var(--bg)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <span /><span>NAME</span>
            <span style={{ textAlign:'right' }}>OPEN</span>
            <span style={{ textAlign:'right' }}>DONE</span>
            <span style={{ textAlign:'right' }}>SEEN</span>
          </div>
          {authCoords.length === 0 && (
            <div style={{ padding: 20, textAlign:'center', color:'var(--gray)', fontSize: 11 }}>No auth coordinators</div>
          )}
          {authCoords.map(c => (
            <CoordinatorRow key={c.coordinator_id} c={c}
              open={authOpenByName[(c.full_name||'').toLowerCase().trim()] || 0}
              doneToday={authDoneTodayByName[(c.full_name||'').toLowerCase().trim()] || 0} />
          ))}
          <MiniLegend />
        </div>

        {/* Intake Coord — team queue (no per-coord assignment) */}
        <div>
          <ColumnHeader label="Intake Coordinators" totalCount={intakeCoords.length} />
          <div style={{ display: 'grid', gridTemplateColumns: '12px 1fr 80px 50px',
            gap: 6, padding: '4px 10px', fontSize: 9, fontWeight: 700, color: '#6B7280',
            background: 'var(--bg)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <span /><span>NAME</span>
            <span style={{ textAlign:'right' }}>Q THIS WK</span>
            <span style={{ textAlign:'right' }}>SEEN</span>
          </div>
          {intakeCoords.length === 0 && (
            <div style={{ padding: 20, textAlign:'center', color:'var(--gray)', fontSize: 11 }}>No intake coordinators</div>
          )}
          {intakeCoords.map(c => {
            const s = statusDot(c.days_since_last_login);
            return (
              <div key={c.coordinator_id} style={{ display:'grid',
                gridTemplateColumns:'12px 1fr 80px 50px', gap: 6, alignItems: 'center',
                padding: '7px 10px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ width: 8, height: 8, background: s.color, borderRadius:'50%' }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color:'var(--black)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.full_name}
                  </div>
                  <div style={{ fontSize: 9, color: c.days_since_last_login >= 7 ? '#DC2626' : '#6B7280' }}>
                    {c.days_since_last_login === null ? 'never logged in' :
                     c.days_since_last_login === 0 ? 'active today' :
                     c.days_since_last_login + 'd ago'}
                  </div>
                </div>
                <div title="Pending referrals this week (no welcome call)"
                  style={{ fontSize: 13, fontWeight: 700, fontFamily: 'DM Mono, monospace',
                    color: intakeOpenTotal > 20 ? '#DC2626' : intakeOpenTotal > 10 ? '#D97706' : 'var(--black)',
                    textAlign: 'right' }}>
                  {intakeOpenTotal}
                </div>
                <div style={{ fontSize: 10, color: '#6B7280', textAlign: 'right' }}>
                  {fmtAgo(c.last_sign_in_at)}
                </div>
              </div>
            );
          })}
          <MiniLegend />
        </div>
      </div>
    </div>
  );
}
