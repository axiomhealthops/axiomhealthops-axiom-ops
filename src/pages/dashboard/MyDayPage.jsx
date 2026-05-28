// MyDayPage — the daily-zero landing page for auth coordinators.
//
// Job-to-be-done: when an auth coordinator logs in, they see the four task
// sources combined into a single prioritized list, with a clear daily metric
// ("X of Y cleared today") so they have a concrete target.
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
//   cleared_today          = start_task_keys \ current_keys (started open -> now closed)
//   remaining_from_morning = start_task_keys n current_keys (started open -> still open)
//   new_today              = current_keys \ start_task_keys (arrived after first load)
// This is auditable: "did this coordinator close THESE specific 12 tasks?"
//
// Features:
//   - Search by patient name + filter chips (region/insurance/tier)
//   - Click any task to expand inline: full auth #, member ID, payer info,
//     recent activity log, attached PDFs, AI extract button
//   - When advancing a task's status, an inline note input appears -
//     note is logged to coordinator_activity_log for the audit trail
//   - Bulk select via checkboxes; advance multiple tasks at once
//   - "Cleared today" history panel below the open list (collapsible)
//     shows what was closed today, with timestamps and notes
//
// See supabase/migrations/20260527130000_coordinator_my_day.sql for the
// snapshot table + RLS, and README_auth_team_audit_2026_05_27.md for the
// engineering audit context.

import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, safeUpdate, fetchAllPages, logActivity } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import MyDayNotificationsFeed from '../../components/MyDayNotificationsFeed';

// ── 2026-05-27: KPI strip (Auth Command Center hub) ─────────────────────────
// Five clickable counts that drill into the focused work-surface pages.
// Counts are global (not scoped to the current user) — coordinators need to
// see the whole department state, not just their assigned slice. Region scope
// still applies via RLS / page-level filters on the drill-down pages.
function KpiStrip({ counts, loading, onNavigate }) {
  function nav(page, intent) {
    if (onNavigate) onNavigate(page, intent);
    else window.dispatchEvent(new CustomEvent('axiom-navigate', { detail: { page, intent } }));
  }
  const tiles = [
    { label: 'Visits < 7 left',  value: counts.lowVisits,    color: '#7F1D1D', bg: '#FEE2E2', target: 'visit-runway',
      sub: 'low runway' },
    { label: 'Expiring <= 14d',  value: counts.expiring,     color: '#9A3412', bg: '#FFEDD5', target: 'auth-expiry-timeline',
      sub: 'pre-empt the renewal' },
    { label: 'Auth Pending',     value: counts.pending,      color: '#92400E', bg: '#FEF3C7', target: 'auth-pending-coverage',
      sub: 'no active coverage' },
    { label: 'Stuck > 3d',       value: counts.stuck,        color: '#1E40AF', bg: '#DBEAFE', target: 'stuck-auths',
      sub: 'started not finished' },
    { label: 'Over Limit',       value: counts.overLimit,    color: '#DC2626', bg: '#FEF2F2', target: 'auth-over-limit',
      sub: 'compliance risk' },
  ];
  return (
    <div style={{ padding:'14px 20px 12px', display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:10, background:'var(--bg)', borderBottom:'1px solid var(--border)' }}>
      {tiles.map(t => (
        <button key={t.target} onClick={() => nav(t.target, null)}
          style={{
            background: t.bg, border: `1px solid ${t.color}33`, borderRadius: 10,
            padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
            display: 'flex', flexDirection: 'column', gap: 4,
            transition: 'transform 0.1s, box-shadow 0.1s',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
          <div style={{ fontSize:10, fontWeight:700, color:'#6B7280', letterSpacing:'0.05em', textTransform:'uppercase' }}>{t.label}</div>
          <div style={{ fontSize:26, fontWeight:800, fontFamily:'DM Mono, monospace', color: t.color, lineHeight:1 }}>
            {loading ? '...' : t.value}
          </div>
          <div style={{ fontSize:10, color:'#6B7280' }}>{t.sub}</div>
        </button>
      ))}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d + 'T00:00:00') - new Date()) / 86400000);
}
function todayDateStr() {
  var n = new Date();
  var m = String(n.getMonth()+1).padStart(2,'0');
  var d = String(n.getDate()).padStart(2,'0');
  return n.getFullYear() + '-' + m + '-' + d;
}
function parseKey(k) {
  // 'rt:142' -> { type: 'rt', id: 142 }
  // 'at:8821' -> { type: 'at', id: 8821 }
  var i = k.indexOf(':');
  if (i < 0) return null;
  return { type: k.slice(0, i), id: k.slice(i + 1) };
}

// Tier definitions — order matters (higher = more urgent)
var TIERS = {
  CRITICAL: { label: 'Critical',  color: '#7F1D1D', bg: '#FEE2E2', border: '#FECACA' },
  HIGH:     { label: 'High',      color: '#92400E', bg: '#FFFBEB', border: '#FDE68A' },
  NORMAL:   { label: 'Open',      color: '#1E40AF', bg: '#EFF6FF', border: '#BFDBFE' },
};

// ── Task builder — takes raw rows from the 4 sources and produces a
// uniform task list, deduped, with tier classification.
function buildTaskList(renewalTasks, authRows) {
  var tasks = [];
  var authIdsSeen = {};

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

  (authRows || []).forEach(function(a) {
    if (authIdsSeen[a.id]) return;
    authIdsSeen[a.id] = true;

    var d = daysUntil(a.auth_expiry_date);
    var visitsRem = Math.max(0, (a.visits_authorized || 0) - (a.visits_used || 0));

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
    }

    if (reasons.length === 0) return;

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

// ── Sub-components ─────────────────────────────────────────────────────────

function HeroMetric({ totalOpen, startCount, clearedFromMorning, remainingFromMorning, newToday, percent }) {
  var morningCleared = startCount > 0 && remainingFromMorning === 0;
  var fullZero = totalOpen === 0 && startCount > 0;
  return (
    <div style={{ padding:'24px 20px', background: fullZero ? '#ECFDF5' : 'var(--card-bg)', borderBottom:'1px solid var(--border)' }}>
      <div style={{ display:'flex', gap:24, alignItems:'center', flexWrap:'wrap' }}>
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
              <div>{remainingFromMorning} from this morning still open{newToday > 0 ? (' / ' + newToday + ' new since') : ''}</div>
            </div>
          )}
        </div>

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

        {fullZero && (
          <div style={{ padding:'14px 18px', background:'#D1FAE5', border:'1px solid #6EE7B7', borderRadius:10, color:'#065F46' }}>
            <div style={{ fontSize:14, fontWeight:700 }}>Inbox zero. Day complete.</div>
            <div style={{ fontSize:11, marginTop:2 }}>Every task cleared, including any that arrived today.</div>
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

function FilterBar({ search, setSearch, filterTier, setFilterTier, filterRegion, setFilterRegion, filterInsurance, setFilterInsurance, regions, insurances, totalCount, filteredCount }) {
  var chipStyle = function(active) {
    return {
      padding: '5px 10px',
      borderRadius: 6,
      border: '1px solid ' + (active ? '#0F1117' : 'var(--border)'),
      background: active ? '#0F1117' : 'var(--card-bg)',
      color: active ? '#fff' : 'var(--black)',
      fontSize: 11,
      fontWeight: 600,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    };
  };
  return (
    <div style={{ padding:'10px 20px', borderBottom:'1px solid var(--border)', display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', background:'var(--card-bg)' }}>
      <input
        value={search}
        onChange={function(e) { setSearch(e.target.value); }}
        placeholder="Search patient name..."
        style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, minWidth:180, outline:'none', background:'var(--bg)', color:'var(--black)' }}
      />
      <div style={{ display:'flex', gap:4 }}>
        <button onClick={function() { setFilterTier('ALL'); }} style={chipStyle(filterTier==='ALL')}>All</button>
        <button onClick={function() { setFilterTier('CRITICAL'); }} style={chipStyle(filterTier==='CRITICAL')}>Critical</button>
        <button onClick={function() { setFilterTier('HIGH'); }} style={chipStyle(filterTier==='HIGH')}>High</button>
        <button onClick={function() { setFilterTier('NORMAL'); }} style={chipStyle(filterTier==='NORMAL')}>Open</button>
      </div>
      <select
        value={filterRegion}
        onChange={function(e) { setFilterRegion(e.target.value); }}
        style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, background:'var(--card-bg)', color:'var(--black)', outline:'none' }}>
        <option value="ALL">All regions</option>
        {regions.map(function(r) { return <option key={r} value={r}>Region {r}</option>; })}
      </select>
      <select
        value={filterInsurance}
        onChange={function(e) { setFilterInsurance(e.target.value); }}
        style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, background:'var(--card-bg)', color:'var(--black)', outline:'none' }}>
        <option value="ALL">All insurance</option>
        {insurances.map(function(ins) { return <option key={ins} value={ins}>{ins}</option>; })}
      </select>
      <div style={{ marginLeft:'auto', fontSize:11, color:'var(--gray)' }}>
        Showing <strong style={{ color:'var(--black)' }}>{filteredCount}</strong> of {totalCount}
      </div>
    </div>
  );
}

function BulkActionBar({ selectedCount, onClear, onAdvance, saving }) {
  if (selectedCount === 0) return null;
  var btn = {
    padding:'6px 12px',
    fontSize:11,
    fontWeight:600,
    border:'1px solid var(--border)',
    borderRadius:6,
    background:'var(--card-bg)',
    color:'var(--black)',
    cursor: saving ? 'not-allowed' : 'pointer',
    whiteSpace:'nowrap',
  };
  return (
    <div style={{ padding:'10px 20px', background:'#0F1117', color:'#fff', display:'flex', alignItems:'center', gap:12, position:'sticky', top:0, zIndex:5 }}>
      <strong style={{ fontSize:12 }}>{selectedCount} task{selectedCount===1?'':'s'} selected</strong>
      <button onClick={function() { onAdvance('submitted'); }} disabled={saving} style={btn}>Mark all Submitted</button>
      <button onClick={function() { onAdvance('active'); }}    disabled={saving} style={btn}>Mark all Active</button>
      <button onClick={onClear} style={Object.assign({}, btn, { background:'transparent', color:'#fff', border:'1px solid rgba(255,255,255,0.3)', marginLeft:'auto' })}>Clear selection</button>
    </div>
  );
}

function TaskRow({ task, expanded, selected, onToggleExpand, onToggleSelect, onAdvanceWithNote, onOpenInExtractor, expansionData, saving }) {
  // Status advance options vary by source
  var actions = [];
  if (task.source === 'auth_tracker') {
    if (task.currentStatus === 'pending')        actions.push({ label: 'Mark Submitted', next: 'submitted' });
    else if (task.currentStatus === 'submitted') {
      actions.push({ label: 'Mark Active', next: 'active' });
      actions.push({ label: 'Mark Denied', next: 'denied' });
    } else actions.push({ label: 'Mark Active', next: 'active' });
  } else if (task.source === 'renewal_task') {
    if (task.currentStatus === 'open') actions.push({ label: 'Start', next: 'in_progress' });
    actions.push({ label: 'Submitted', next: 'submitted' });
    actions.push({ label: 'Approved',  next: 'approved' });
    actions.push({ label: 'Denied',    next: 'denied' });
  }

  var [pendingAction, setPendingAction] = useState(null); // { next, note }

  function startAction(nextStatus) {
    setPendingAction({ next: nextStatus, note: '' });
  }
  function confirmAction() {
    onAdvanceWithNote(task, pendingAction.next, pendingAction.note);
    setPendingAction(null);
  }
  function cancelAction() {
    setPendingAction(null);
  }

  return (
    <div style={{ borderBottom:'1px solid var(--border)' }}>
      {/* Main row */}
      <div style={{ padding:'12px 20px', display:'flex', alignItems:'center', gap:12 }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={function(e) { e.stopPropagation(); onToggleSelect(task.key); }}
          style={{ cursor:'pointer', flexShrink:0 }}
        />
        <div
          onClick={function() { onToggleExpand(task.key); }}
          style={{ flex:1, minWidth:0, cursor:'pointer' }}
          title="Click to expand"
        >
          <div style={{ fontSize:13, fontWeight:700, color:'var(--black)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            <span style={{ marginRight:6, color:'var(--gray)', fontSize:10 }}>{expanded ? '▼' : '▶'}</span>
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

        <div style={{ display:'flex', gap:6, flexShrink:0 }}>
          {actions.map(function(a) {
            return (
              <button key={a.next}
                onClick={function() { startAction(a.next); }}
                disabled={saving || pendingAction != null}
                style={{
                  padding:'6px 10px', fontSize:11, fontWeight:600,
                  border:'1px solid var(--border)', borderRadius:6,
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

      {/* Pending-action note input (shown when a status button was clicked) */}
      {pendingAction && (
        <div style={{ padding:'10px 20px 14px 50px', background:'#FFFBEB', borderTop:'1px dashed var(--border)' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'#92400E', marginBottom:6 }}>
            Add a note before marking <strong>{pendingAction.next}</strong> (logged to activity audit trail)
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <input
              autoFocus
              value={pendingAction.note}
              onChange={function(e) { setPendingAction({ next: pendingAction.next, note: e.target.value }); }}
              onKeyDown={function(e) {
                if (e.key === 'Enter') confirmAction();
                if (e.key === 'Escape') cancelAction();
              }}
              placeholder="e.g., Called Humana ref #12345 / Submitted via fax to (863) 555-0142"
              style={{ flex:1, padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)', color:'var(--black)' }}
            />
            <button onClick={confirmAction} style={{ padding:'7px 14px', background:'#059669', color:'#fff', border:'none', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer' }}>
              Save &amp; Advance
            </button>
            <button onClick={cancelAction} style={{ padding:'7px 12px', background:'transparent', color:'var(--gray)', border:'1px solid var(--border)', borderRadius:6, fontSize:11, cursor:'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Expanded detail panel */}
      {expanded && task.source === 'auth_tracker' && (
        <div style={{ padding:'12px 20px 16px 50px', background:'#FAFAFA', borderTop:'1px dashed var(--border)', fontSize:12, color:'var(--black)' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:10, marginBottom:10 }}>
            <Detail label="Auth #" value={task.raw.auth_number} />
            <Detail label="Member ID" value={task.raw.member_id} />
            <Detail label="Status" value={task.raw.auth_status} />
            <Detail label="Health" value={task.raw.auth_health} />
            <Detail label="Authorized" value={task.raw.visits_authorized} />
            <Detail label="Used" value={task.raw.visits_used} />
            <Detail label="SOC" value={task.raw.soc_date && fmtDate(task.raw.soc_date)} />
            <Detail label="Approved" value={task.raw.auth_approved_date && fmtDate(task.raw.auth_approved_date)} />
            <Detail label="Expires" value={task.raw.auth_expiry_date && fmtDate(task.raw.auth_expiry_date)} />
            <Detail label="Frequency" value={task.raw.frequency} />
            <Detail label="Therapy" value={task.raw.therapy_type} />
            <Detail label="DOB" value={task.raw.dob && fmtDate(task.raw.dob)} />
          </div>
          {(task.raw.pcp_name || task.raw.pcp_phone) && (
            <div style={{ marginBottom:10, padding:'6px 10px', background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:6, fontSize:11 }}>
              <strong>PCP:</strong> {task.raw.pcp_name || '-'} {task.raw.pcp_phone ? '· ' + task.raw.pcp_phone : ''} {task.raw.pcp_fax ? '· fax ' + task.raw.pcp_fax : ''}
            </div>
          )}
          {task.raw.notes && (
            <div style={{ marginBottom:10, padding:'6px 10px', background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:6, fontSize:11 }}>
              <strong>Notes:</strong> {task.raw.notes}
            </div>
          )}
          {expansionData?.activity?.length > 0 && (
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>
                Today&apos;s activity
              </div>
              {expansionData.activity.slice(0, 5).map(function(a, i) {
                return (
                  <div key={i} style={{ fontSize:11, padding:'4px 0', borderBottom:'1px dotted var(--border)' }}>
                    <span style={{ color:'var(--gray)' }}>{fmtTime(a.created_at)}</span>
                    <span style={{ marginLeft:8, color:'var(--black)' }}>{a.action_detail || a.action_type}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={function() { onOpenInExtractor(task); }} style={{ padding:'6px 12px', background:'#7C3AED', color:'#fff', border:'none', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer' }}>
              Upload new auth PDF (AI extract)
            </button>
          </div>
        </div>
      )}
      {expanded && task.source === 'renewal_task' && (
        <div style={{ padding:'12px 20px 16px 50px', background:'#FAFAFA', borderTop:'1px dashed var(--border)', fontSize:12, color:'var(--black)' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:10, marginBottom:10 }}>
            <Detail label="Priority" value={task.raw.priority} />
            <Detail label="Status" value={task.raw.task_status} />
            <Detail label="Days until expiry" value={task.raw.days_until_expiry} />
            <Detail label="Visits remaining" value={task.raw.visits_remaining} />
            <Detail label="Insurance" value={task.raw.insurance} />
            <Detail label="Auth expiry" value={task.raw.expiry_date && fmtDate(task.raw.expiry_date)} />
          </div>
          {task.raw.notes && (
            <div style={{ marginBottom:10, padding:'6px 10px', background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:6, fontSize:11 }}>
              <strong>Notes:</strong> {task.raw.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.06em' }}>{label}</div>
      <div style={{ fontSize:12, color:'var(--black)', marginTop:2 }}>{value != null && value !== '' ? value : '—'}</div>
    </div>
  );
}

function TierSection({ tier, tasks, expandedKey, selectedKeys, onToggleExpand, onToggleSelect, onAdvanceWithNote, onOpenInExtractor, expansionData, savingId }) {
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
          return (
            <TaskRow
              key={t.key}
              task={t}
              expanded={expandedKey === t.key}
              selected={selectedKeys.has(t.key)}
              onToggleExpand={onToggleExpand}
              onToggleSelect={onToggleSelect}
              onAdvanceWithNote={onAdvanceWithNote}
              onOpenInExtractor={onOpenInExtractor}
              expansionData={expandedKey === t.key ? expansionData : null}
              saving={savingId === t.key}
            />
          );
        })}
      </div>
    </div>
  );
}

function HistoryPanel({ history, expanded, onToggle }) {
  return (
    <div style={{ borderTop:'1px solid var(--border)' }}>
      <div
        onClick={onToggle}
        style={{ padding:'12px 20px', background:'#F9FAFB', cursor:'pointer', display:'flex', alignItems:'center', gap:10 }}
      >
        <span style={{ fontSize:11, color:'var(--gray)' }}>{expanded ? '▼' : '▶'}</span>
        <span style={{ fontSize:12, fontWeight:700, color:'var(--black)', textTransform:'uppercase', letterSpacing:'0.06em' }}>
          Cleared today
        </span>
        <span style={{ fontSize:11, color:'var(--gray)', fontWeight:600 }}>
          ({history.length})
        </span>
      </div>
      {expanded && (
        <div>
          {history.length === 0 ? (
            <div style={{ padding:'14px 20px', fontSize:12, color:'var(--gray)', fontStyle:'italic' }}>
              Nothing cleared yet today.
            </div>
          ) : history.map(function(h, i) {
            return (
              <div key={i} style={{ padding:'10px 20px', borderTop:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:'var(--black)' }}>
                    {h.patientName}
                    <span style={{ fontSize:10, color:'var(--gray)', marginLeft:8, fontWeight:400 }}>
                      → {h.currentStatus || 'cleared'}
                    </span>
                  </div>
                  {h.note && (
                    <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>
                      Note: {h.note}
                    </div>
                  )}
                </div>
                <div style={{ fontSize:10, color:'var(--gray)', flexShrink:0 }}>
                  {h.timestamp ? fmtTime(h.timestamp) : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function MyDayPage({ onNavigate }) {
  const { profile } = useAuth();
  const profileName = profile?.full_name || profile?.email || '';

  const [authRows, setAuthRows] = useState([]);
  const [renewalTasks, setRenewalTasks] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  // Filter/search state
  const [search, setSearch] = useState('');
  const [filterTier, setFilterTier] = useState('ALL');
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterInsurance, setFilterInsurance] = useState('ALL');

  // Expansion + selection + history-panel state
  const [expandedKey, setExpandedKey] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [expansionData, setExpansionData] = useState(null); // activity log for expanded row

  // 2026-05-27: KPI strip counts (department-wide, not user-scoped)
  const [kpi, setKpi] = useState({ lowVisits: 0, expiring: 0, pending: 0, stuck: 0, overLimit: 0 });
  const [kpiLoading, setKpiLoading] = useState(true);

  const loadKpis = useCallback(async () => {
    setKpiLoading(true);
    const fourteenDays = new Date(Date.now() + 14*86400000).toISOString().slice(0,10);
    const threeDaysAgo = new Date(Date.now() - 3*86400000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
    const [low, exp, pend, stuckPending, stuckSubmitted, over] = await Promise.all([
      supabase.from('auth_tracker').select('id', { count:'exact', head:true })
        .eq('is_currently_active', true).eq('auth_health', 'low_visits'),
      supabase.from('auth_tracker').select('id', { count:'exact', head:true })
        .eq('is_currently_active', true).lte('auth_expiry_date', fourteenDays)
        .gte('auth_expiry_date', new Date().toISOString().slice(0,10)),
      supabase.from('v_auth_pending_coverage').select('patient_name', { count:'exact', head:true }),
      supabase.from('auth_tracker').select('id', { count:'exact', head:true })
        .eq('auth_status', 'pending').lt('created_at', threeDaysAgo),
      supabase.from('auth_tracker').select('id', { count:'exact', head:true })
        .eq('auth_status', 'submitted').lt('auth_submitted_date', sevenDaysAgo),
      supabase.from('auth_tracker').select('id', { count:'exact', head:true })
        .eq('auth_health', 'over_limit'),
    ]);
    setKpi({
      lowVisits: low.count || 0,
      expiring:  exp.count || 0,
      pending:   pend.count || 0,
      stuck:     (stuckPending.count || 0) + (stuckSubmitted.count || 0),
      overLimit: over.count || 0,
    });
    setKpiLoading(false);
  }, []);

  useEffect(() => { loadKpis(); }, [loadKpis]);
  // KPI counts refresh on the same realtime triggers as the task list
  useRealtimeTable(['auth_tracker','census_data'], loadKpis);

  const load = useCallback(async () => {
    if (!profileName) { setLoading(false); return; }
    const today = todayDateStr();
    const inSevenDays = (function() {
      var d = new Date(); d.setDate(d.getDate() + 7);
      var m = String(d.getMonth()+1).padStart(2,'0');
      var dd = String(d.getDate()).padStart(2,'0');
      return d.getFullYear() + '-' + m + '-' + dd;
    })();

    const [authsRes, tasksRes, snapRes] = await Promise.all([
      fetchAllPages(
        supabase.from('auth_tracker')
          .select('*')
          .eq('assigned_to', profileName)
          .or(
            'auth_status.in.(pending,submitted),' +
            'auth_health.in.(over_limit,low_visits),' +
            'auth_expiry_date.lte.' + inSevenDays
          )
      ),
      fetchAllPages(
        supabase.from('auth_renewal_tasks')
          .select('*')
          .eq('assigned_to', profileName)
          .in('task_status', ['open', 'in_progress'])
      ),
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

    var allTasks = buildTaskList(tasks, auths);
    var currentCount = allTasks.length;
    var criticalCount = allTasks.filter(function(t) { return t.tier === 'CRITICAL'; }).length;
    var highCount     = allTasks.filter(function(t) { return t.tier === 'HIGH'; }).length;
    var normalCount   = allTasks.filter(function(t) { return t.tier === 'NORMAL'; }).length;

    var snap = snapRes?.data || null;
    if (!snap) {
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
  const currentKeys = useMemo(() => tasks.map(function(t) { return t.key; }), [tasks]);
  const currentKeySet = useMemo(() => new Set(currentKeys), [currentKeys]);

  // Available filter options (derived from current tasks)
  const regions = useMemo(() => {
    var r = {};
    tasks.forEach(function(t) { if (t.region) r[t.region] = true; });
    return Object.keys(r).sort();
  }, [tasks]);
  const insurances = useMemo(() => {
    var i = {};
    tasks.forEach(function(t) { if (t.insurance) i[t.insurance] = true; });
    return Object.keys(i).sort();
  }, [tasks]);

  // Filtered task list
  const filteredTasks = useMemo(() => {
    var s = (search || '').toLowerCase().trim();
    return tasks.filter(function(t) {
      if (s && !(t.patientName || '').toLowerCase().includes(s)) return false;
      if (filterTier !== 'ALL' && t.tier !== filterTier) return false;
      if (filterRegion !== 'ALL' && t.region !== filterRegion) return false;
      if (filterInsurance !== 'ALL' && t.insurance !== filterInsurance) return false;
      return true;
    });
  }, [tasks, search, filterTier, filterRegion, filterInsurance]);

  const tasksByTier = useMemo(() => ({
    CRITICAL: filteredTasks.filter(function(t) { return t.tier === 'CRITICAL'; }),
    HIGH:     filteredTasks.filter(function(t) { return t.tier === 'HIGH'; }),
    NORMAL:   filteredTasks.filter(function(t) { return t.tier === 'NORMAL'; }),
  }), [filteredTasks]);

  // ── Daily metrics ──────────────────────────────────────────────────────
  const startTaskKeys = snapshot?.start_task_keys || [];
  const startKeySet   = useMemo(() => new Set(startTaskKeys), [startTaskKeys]);
  const startCount = startTaskKeys.length;

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

  // ── History (cleared today) ───────────────────────────────────────────
  // Cleared = in start_task_keys but no longer in currentKeys. Fetch current
  // state of those rows + activity log notes from today.
  useEffect(() => {
    async function fetchHistory() {
      var clearedKeys = startTaskKeys.filter(function(k) { return !currentKeySet.has(k); });
      if (clearedKeys.length === 0) { setHistory([]); return; }
      var atIds = clearedKeys.filter(function(k) { return k.indexOf('at:') === 0; }).map(function(k) { return parseKey(k).id; });
      var rtIds = clearedKeys.filter(function(k) { return k.indexOf('rt:') === 0; }).map(function(k) { return parseKey(k).id; });

      var todayStart = new Date(); todayStart.setHours(0,0,0,0);

      var queries = [];
      if (atIds.length > 0) {
        queries.push(supabase.from('auth_tracker').select('id,patient_name,auth_status,auth_health').in('id', atIds));
      } else queries.push(Promise.resolve({ data: [] }));
      if (rtIds.length > 0) {
        queries.push(supabase.from('auth_renewal_tasks').select('id,patient_name,task_status').in('id', rtIds));
      } else queries.push(Promise.resolve({ data: [] }));
      queries.push(
        supabase.from('coordinator_activity_log')
          .select('table_name,record_id,action_detail,created_at')
          .eq('coordinator_name', profileName)
          .gte('created_at', todayStart.toISOString())
          .order('created_at', { ascending: false })
      );

      var results = await Promise.all(queries);
      var atRows = (results[0]?.data || []);
      var rtRows = (results[1]?.data || []);
      var actLog = (results[2]?.data || []);

      // Build a lookup: latest activity log entry per (table_name, record_id)
      var logLookup = {};
      actLog.forEach(function(a) {
        var k = a.table_name + ':' + a.record_id;
        if (!logLookup[k]) logLookup[k] = a;
      });

      var items = [];
      atRows.forEach(function(r) {
        var lk = 'auth_tracker:' + r.id;
        var log = logLookup[lk];
        items.push({
          key: 'at:' + r.id,
          patientName: r.patient_name,
          currentStatus: r.auth_status + (r.auth_health ? ' / ' + r.auth_health : ''),
          note: log?.action_detail || null,
          timestamp: log?.created_at || null,
        });
      });
      rtRows.forEach(function(r) {
        var lk = 'auth_renewal_tasks:' + r.id;
        var log = logLookup[lk];
        items.push({
          key: 'rt:' + r.id,
          patientName: r.patient_name,
          currentStatus: r.task_status,
          note: log?.action_detail || null,
          timestamp: log?.created_at || null,
        });
      });
      // Most recent first
      items.sort(function(a, b) {
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return b.timestamp.localeCompare(a.timestamp);
      });
      setHistory(items);
    }
    fetchHistory();
  }, [startTaskKeys.join(','), currentKeys.join(','), profileName]); // intentionally string-deps

  // ── Expansion: when row expands, load recent activity log for that task ─
  useEffect(() => {
    async function loadExpansion() {
      if (!expandedKey) { setExpansionData(null); return; }
      var p = parseKey(expandedKey);
      if (!p) return;
      var tableName = p.type === 'at' ? 'auth_tracker' : 'auth_renewal_tasks';
      var todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const { data } = await supabase
        .from('coordinator_activity_log')
        .select('action_type,action_detail,created_at,coordinator_name')
        .eq('table_name', tableName)
        .eq('record_id', p.id)
        .gte('created_at', new Date(Date.now() - 7*86400000).toISOString())
        .order('created_at', { ascending: false })
        .limit(20);
      setExpansionData({ activity: data || [] });
    }
    loadExpansion();
  }, [expandedKey]);

  // ── Status advance with note ──────────────────────────────────────────
  async function advanceStatusWithNote(task, newStatus, note) {
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
            actionDetail: 'My Day: ' + task.currentStatus + ' -> ' + newStatus + (note ? ' / ' + note : ''),
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
        try {
          await logActivity({
            coordinatorId: profile?.id,
            coordinatorName: profileName,
            coordinatorRole: profile?.role,
            actionType: 'renewal_task_status_change',
            tableName: 'auth_renewal_tasks',
            recordId: task.sourceId,
            actionDetail: 'My Day: ' + task.currentStatus + ' -> ' + newStatus + (note ? ' / ' + note : ''),
          });
        } catch (e) { /* non-blocking */ }
      }
      // Drop from selection if it was selected
      setSelectedKeys(function(prev) {
        var n = new Set(prev); n.delete(task.key); return n;
      });
      // Close expansion if this row was expanded
      if (expandedKey === task.key) setExpandedKey(null);
      await load();
    } catch (err) {
      console.error('advanceStatusWithNote failed:', err);
      alert('Could not advance status: ' + (err.message || err));
    }
    setSavingId(null);
  }

  // ── Bulk advance ──────────────────────────────────────────────────────
  async function bulkAdvance(newStatus) {
    if (selectedKeys.size === 0) return;
    if (!window.confirm('Advance ' + selectedKeys.size + ' task' + (selectedKeys.size===1?'':'s') + ' to "' + newStatus + '"?')) return;
    setBulkSaving(true);
    var keysArr = Array.from(selectedKeys);
    for (var i = 0; i < keysArr.length; i++) {
      var t = tasks.find(function(x) { return x.key === keysArr[i]; });
      if (t) await advanceStatusWithNote(t, newStatus, 'Bulk action');
    }
    setSelectedKeys(new Set());
    setBulkSaving(false);
  }

  // ── PDF upload: navigate to All Authorizations with extractor pre-opened ─
  function openInExtractor(task) {
    if (onNavigate) onNavigate('auth', { extractFor: task.patientName, prefillAuthId: task.sourceId });
    else window.alert('Open the "All Authorizations" page and click "AI Extract Auth" to upload a new PDF for ' + task.patientName + '.');
  }

  function toggleExpand(key) {
    setExpandedKey(function(curr) { return curr === key ? null : key; });
  }
  function toggleSelect(key) {
    setSelectedKeys(function(prev) {
      var n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }
  function clearSelection() { setSelectedKeys(new Set()); }

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

      <div style={{ padding:'10px 20px', background:'#EFF6FF', borderBottom:'1px solid #BFDBFE', fontSize:12, color:'#1E40AF', display:'flex', gap:8, alignItems:'center' }}>
        <span style={{ fontSize:14 }}>★</span>
        <span><strong>Your daily target: clear to zero.</strong> Tasks here are pulled from renewals, pending auths, compliance alerts, and expiring auths assigned to you. Click any row to expand. Add a note when advancing status — it logs to the audit trail.</span>
      </div>

      {/* 2026-05-27: Auth Command Center KPI strip — department-wide counts,
          clickable to drill into focused work-surface pages. */}
      <KpiStrip counts={kpi} loading={kpiLoading} onNavigate={onNavigate} />

      <HeroMetric
        totalOpen={totalOpen}
        startCount={startCount}
        clearedFromMorning={clearedFromMorning}
        remainingFromMorning={remainingFromMorning}
        newToday={newToday}
        percent={percent}
      />

      <BulkActionBar
        selectedCount={selectedKeys.size}
        saving={bulkSaving}
        onClear={clearSelection}
        onAdvance={bulkAdvance}
      />

      <FilterBar
        search={search} setSearch={setSearch}
        filterTier={filterTier} setFilterTier={setFilterTier}
        filterRegion={filterRegion} setFilterRegion={setFilterRegion}
        filterInsurance={filterInsurance} setFilterInsurance={setFilterInsurance}
        regions={regions}
        insurances={insurances}
        totalCount={tasks.length}
        filteredCount={filteredTasks.length}
      />

      {/* 2026-05-27: 2-column hub. Left = existing task list + history (unchanged).
          Right = notifications rail (mentions, assigned tasks, alerts). Rail collapses
          to a stacked block under the list on narrow viewports via the grid auto-min. */}
      <div style={{ flex:1, overflow:'auto', display:'grid',
        gridTemplateColumns:'minmax(0, 1fr) minmax(280px, 340px)',
        gap:0 }}>
        <div style={{ overflow:'auto', borderRight:'1px solid var(--border)' }}>
        {filteredTasks.length === 0 && tasks.length === 0 && startCount === 0 && (
          <div style={{ padding:'40px 20px', textAlign:'center', color:'var(--gray)' }}>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:6 }}>Nothing assigned to you yet.</div>
            <div style={{ fontSize:12 }}>When auths or renewal tasks get assigned to you, they will appear here.</div>
          </div>
        )}
        {filteredTasks.length === 0 && tasks.length > 0 && (
          <div style={{ padding:'30px 20px', textAlign:'center', color:'var(--gray)' }}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>No tasks match your filters.</div>
            <div style={{ fontSize:11 }}>{tasks.length} task{tasks.length===1?'':'s'} open — clear search/filters to see all.</div>
          </div>
        )}
        {filteredTasks.length === 0 && tasks.length === 0 && startCount > 0 && (
          <div style={{ padding:'40px 20px', textAlign:'center', color:'#059669' }}>
            <div style={{ fontSize:18, fontWeight:700, marginBottom:6 }}>All clear.</div>
            <div style={{ fontSize:12, color:'var(--gray)' }}>
              You cleared {clearedFromMorning} of this morning&apos;s {startCount} task{startCount===1?'':'s'}
              {newToday > 0 ? (' and the ' + newToday + ' that arrived since') : ''}.
              Tomorrow&apos;s queue arrives at midnight.
            </div>
          </div>
        )}
        <TierSection tier="CRITICAL" tasks={tasksByTier.CRITICAL}
          expandedKey={expandedKey} selectedKeys={selectedKeys}
          onToggleExpand={toggleExpand} onToggleSelect={toggleSelect}
          onAdvanceWithNote={advanceStatusWithNote}
          onOpenInExtractor={openInExtractor}
          expansionData={expansionData} savingId={savingId}
        />
        <TierSection tier="HIGH" tasks={tasksByTier.HIGH}
          expandedKey={expandedKey} selectedKeys={selectedKeys}
          onToggleExpand={toggleExpand} onToggleSelect={toggleSelect}
          onAdvanceWithNote={advanceStatusWithNote}
          onOpenInExtractor={openInExtractor}
          expansionData={expansionData} savingId={savingId}
        />
        <TierSection tier="NORMAL" tasks={tasksByTier.NORMAL}
          expandedKey={expandedKey} selectedKeys={selectedKeys}
          onToggleExpand={toggleExpand} onToggleSelect={toggleSelect}
          onAdvanceWithNote={advanceStatusWithNote}
          onOpenInExtractor={openInExtractor}
          expansionData={expansionData} savingId={savingId}
        />

        <HistoryPanel
          history={history}
          expanded={historyOpen}
          onToggle={function() { setHistoryOpen(function(v) { return !v; }); }}
        />
        </div>{/* end left column (task list + history) */}

        {/* Right rail: unified notifications feed */}
        <div style={{ padding:'12px', overflow:'hidden', display:'flex', flexDirection:'column' }}>
          <MyDayNotificationsFeed />
        </div>
      </div>
    </div>
  );
}
