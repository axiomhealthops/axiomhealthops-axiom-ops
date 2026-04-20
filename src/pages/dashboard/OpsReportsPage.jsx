// OpsReportsPage.jsx
//
// Director-facing daily operations reports viewer.
// Shows the 8am / 12pm / 5pm automated reports with coordinator
// task completion tracking, overload alerts, inactivity flags,
// and activity logs.

import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import { useAuth } from '../../hooks/useAuth';

/* ── Report type metadata ─────────────────────────────── */
const REPORT_META = {
  morning_overview: { label: 'Morning Overview', icon: '☀️', color: '#2563EB', bg: '#EFF6FF', tagline: 'Tasks & assignments for today' },
  midday_snapshot:  { label: 'Midday Snapshot',  icon: '🕛', color: '#059669', bg: '#ECFDF5', tagline: 'Progress check — completed vs. open' },
  eod_review:       { label: 'End-of-Day Review', icon: '🌙', color: '#7C3AED', bg: '#F5F3FF', tagline: 'Full daily wrap-up & tomorrow\'s carry-over' },
};

/* ── Formatters ───────────────────────────────────────── */
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
function timeAgo(ts) {
  if (!ts) return 'Never';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ── Stat pill ────────────────────────────────────────── */
function Stat({ label, value, color, bg }) {
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', background: bg || '#F3F4F6', borderRadius: 8, padding: '8px 14px', minWidth: 70 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || '#111' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2, textAlign: 'center', whiteSpace: 'nowrap' }}>{label}</div>
    </div>
  );
}

/* ── Activity status badge ────────────────────────────── */
function ActivityBadge({ actionsToday, lastActivityAt }) {
  if ((actionsToday || 0) > 0) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: '#059669', background: '#ECFDF5', borderRadius: 4, padding: '2px 8px' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#059669', display: 'inline-block' }} />
        {actionsToday} actions
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: '#DC2626', background: '#FEF2F2', borderRadius: 4, padding: '2px 8px' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#DC2626', display: 'inline-block' }} />
      NO ACTIVITY {lastActivityAt ? `(last: ${timeAgo(lastActivityAt)})` : '(NEVER)'}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════
   INACTIVITY ALERT — the most important section
   ══════════════════════════════════════════════════════════ */
function InactivityAlert({ inactiveList }) {
  if (!inactiveList?.length) return null;
  const neverLoggedIn = inactiveList.filter(c => c.never_logged_in);
  const inactive = inactiveList.filter(c => !c.never_logged_in);
  return (
    <div style={{ background: '#FEF2F2', border: '2px solid #DC2626', borderRadius: 10, padding: '14px 18px', marginBottom: 4 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#991B1B', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        🚨 COORDINATOR INACTIVITY ALERT — {inactiveList.length} staff with ZERO activity today
      </div>
      {neverLoggedIn.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#7F1D1D', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Never used the app:
          </div>
          {neverLoggedIn.map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', fontSize: 13 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7F1D1D', flexShrink: 0 }} />
              <strong style={{ color: '#7F1D1D', minWidth: 160 }}>{c.name}</strong>
              <span style={{ fontSize: 11, color: '#991B1B', background: '#FEE2E2', borderRadius: 4, padding: '1px 8px', fontWeight: 600 }}>{c.role_label}</span>
              <span style={{ fontSize: 11, color: '#991B1B', fontWeight: 800, marginLeft: 'auto' }}>NEVER LOGGED IN</span>
            </div>
          ))}
        </div>
      )}
      {inactive.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#991B1B', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            No activity today:
          </div>
          {inactive.map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', fontSize: 13 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#DC2626', flexShrink: 0 }} />
              <strong style={{ color: '#991B1B', minWidth: 160 }}>{c.name}</strong>
              <span style={{ fontSize: 11, color: '#991B1B', background: '#FEE2E2', borderRadius: 4, padding: '1px 8px', fontWeight: 600 }}>{c.role_label}</span>
              <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 'auto' }}>
                Last active: {c.last_activity_at ? timeAgo(c.last_activity_at) : 'Unknown'}
                {c.days_since_activity != null && c.days_since_activity > 0 && (
                  <span style={{ color: '#DC2626', fontWeight: 700, marginLeft: 6 }}>({c.days_since_activity}d inactive)</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Coordinator table for Auth Coordinators ──────────── */
function AuthCoordTable({ coordinators, reportType }) {
  if (!coordinators?.length) return null;
  const isMorning = reportType === 'morning_overview';
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1E40AF', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        🔐 Authorization Coordinators
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              <th style={S.th}>Name</th>
              <th style={S.thNum}>Status</th>
              <th style={S.thNum}>Open Tasks</th>
              <th style={S.thNum}>Due Today</th>
              <th style={S.thNum}>Urgent</th>
              <th style={S.thNum}>Overdue</th>
              <th style={S.thNum}>Renewals</th>
              {!isMorning && <th style={S.thNum}>Completed</th>}
              {!isMorning && <th style={S.thNum}>Auth Updated</th>}
            </tr>
          </thead>
          <tbody>
            {coordinators.map((c, i) => {
              const isInactive = c.is_inactive;
              const hasOverdue = (c.tasks_overdue || 0) > 0;
              const hasUrgent = (c.tasks_urgent || 0) > 0;
              return (
                <tr key={i} style={{ background: isInactive ? '#FEF2F2' : (i % 2 === 0 ? '#fff' : '#F9FAFB') }}>
                  <td style={S.td}>
                    <strong style={{ color: isInactive ? '#991B1B' : undefined }}>{c.name}</strong>
                  </td>
                  <td style={S.tdNum}><ActivityBadge actionsToday={c.actions_today} lastActivityAt={c.last_activity_at} /></td>
                  <td style={S.tdNum}>{c.tasks_open || 0}</td>
                  <td style={S.tdNum}>{c.tasks_due_today || 0}</td>
                  <td style={{ ...S.tdNum, color: hasUrgent ? '#DC2626' : undefined, fontWeight: hasUrgent ? 700 : 400 }}>{c.tasks_urgent || 0}</td>
                  <td style={{ ...S.tdNum, color: hasOverdue ? '#DC2626' : undefined, fontWeight: hasOverdue ? 700 : 400 }}>{c.tasks_overdue || 0}</td>
                  <td style={S.tdNum}>{c.renewal_tasks_open || 0}</td>
                  {!isMorning && <td style={{ ...S.tdNum, color: (c.completed_today || 0) > 0 ? '#059669' : undefined, fontWeight: (c.completed_today || 0) > 0 ? 700 : 400 }}>{c.completed_today || 0}</td>}
                  {!isMorning && <td style={S.tdNum}>{c.auth_records_updated || 0}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Coordinator table for Intake Coordinators ────────── */
function IntakeCoordTable({ coordinators, reportType, pipeline }) {
  if (!coordinators?.length) return null;
  const isMorning = reportType === 'morning_overview';
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#B45309', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        📥 Intake Coordinators
        {pipeline && (
          <span style={{ fontSize: 11, fontWeight: 400, color: '#6B7280', marginLeft: 8 }}>
            Pipeline: {pipeline.new_today || 0} new today · {pipeline.total_pending || 0} pending
          </span>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              <th style={S.th}>Name</th>
              <th style={S.thNum}>Status</th>
              <th style={S.thNum}>Pending</th>
              {!isMorning && <th style={S.thNum}>Accepted</th>}
              {!isMorning && <th style={S.thNum}>Denied</th>}
              {!isMorning && <th style={S.thNum}>Updated</th>}
            </tr>
          </thead>
          <tbody>
            {coordinators.map((c, i) => {
              const isInactive = c.is_inactive;
              return (
                <tr key={i} style={{ background: isInactive ? '#FEF2F2' : (i % 2 === 0 ? '#fff' : '#F9FAFB') }}>
                  <td style={S.td}><strong style={{ color: isInactive ? '#991B1B' : undefined }}>{c.name}</strong></td>
                  <td style={S.tdNum}><ActivityBadge actionsToday={c.actions_today} lastActivityAt={c.last_activity_at} /></td>
                  <td style={S.tdNum}>{c.still_pending || 0}</td>
                  {!isMorning && <td style={{ ...S.tdNum, color: (c.accepted_today || 0) > 0 ? '#059669' : undefined }}>{c.accepted_today || 0}</td>}
                  {!isMorning && <td style={S.tdNum}>{c.denied_today || 0}</td>}
                  {!isMorning && <td style={S.tdNum}>{c.referrals_updated_today || 0}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Coordinator table for Care Coordinators ──────────── */
function CareCoordTable({ coordinators, reportType }) {
  if (!coordinators?.length) return null;
  const isMorning = reportType === 'morning_overview';
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#047857', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        👩‍💼 Care Coordinators
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              <th style={S.th}>Name</th>
              <th style={S.thNum}>Status</th>
              <th style={S.thNum}>Open Tasks</th>
              <th style={S.thNum}>Overdue</th>
              {!isMorning && <th style={S.thNum}>Completed</th>}
              <th style={S.thNum}>Chart Notes</th>
              <th style={S.thNum}>Coord Notes</th>
              <th style={S.thNum}>Discharges</th>
              <th style={S.thNum}>On-Hold</th>
            </tr>
          </thead>
          <tbody>
            {coordinators.map((c, i) => {
              const isInactive = c.is_inactive;
              const hasOverdue = (c.tasks_overdue || 0) > 0;
              return (
                <tr key={i} style={{ background: isInactive ? '#FEF2F2' : (i % 2 === 0 ? '#fff' : '#F9FAFB') }}>
                  <td style={S.td}><strong style={{ color: isInactive ? '#991B1B' : undefined }}>{c.name}</strong></td>
                  <td style={S.tdNum}><ActivityBadge actionsToday={c.actions_today} lastActivityAt={c.last_activity_at} /></td>
                  <td style={S.tdNum}>{c.tasks_open || 0}</td>
                  <td style={{ ...S.tdNum, color: hasOverdue ? '#DC2626' : undefined, fontWeight: hasOverdue ? 700 : 400 }}>{c.tasks_overdue || 0}</td>
                  {!isMorning && <td style={{ ...S.tdNum, color: (c.completed_today || 0) > 0 ? '#059669' : undefined, fontWeight: (c.completed_today || 0) > 0 ? 700 : 400 }}>{c.completed_today || 0}</td>}
                  <td style={S.tdNum}>{c.chart_notes_today || 0}</td>
                  <td style={S.tdNum}>{c.coord_notes_today || 0}</td>
                  <td style={S.tdNum}>{c.discharges_today || 0}</td>
                  <td style={S.tdNum}>{c.onhold_updates_today || 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Pod Leaders table ────────────────────────────────── */
function PodLeaderTable({ leaders }) {
  if (!leaders?.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#6D28D9', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        👤 Pod Leaders
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              <th style={S.th}>Name</th>
              <th style={S.thNum}>Status</th>
              <th style={S.thNum}>Chart Notes</th>
            </tr>
          </thead>
          <tbody>
            {leaders.map((c, i) => {
              const isInactive = c.is_inactive;
              return (
                <tr key={i} style={{ background: isInactive ? '#FEF2F2' : (i % 2 === 0 ? '#fff' : '#F9FAFB') }}>
                  <td style={S.td}><strong style={{ color: isInactive ? '#991B1B' : undefined }}>{c.name}</strong></td>
                  <td style={S.tdNum}><ActivityBadge actionsToday={c.actions_today} lastActivityAt={c.last_activity_at} /></td>
                  <td style={S.tdNum}>{c.chart_notes_today || 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Activity log panel ───────────────────────────────── */
function ActivityLog({ entries }) {
  if (!entries?.length) return null;
  const ACTION_COLORS = {
    auth_updated: '#2563EB', auth_created: '#2563EB',
    note_added: '#059669', chart_note_added: '#7C3AED', chart_status_changed: '#7C3AED',
    task_created: '#B45309', task_completed: '#059669',
    referral_accepted: '#059669', referral_denied: '#DC2626',
    discharge_created: '#6B7280', onhold_updated: '#9333EA',
  };
  const ACTION_LABELS = {
    auth_updated: 'Auth Update', auth_created: 'Auth Created',
    note_added: 'Note Added', chart_note_added: 'Chart Note', chart_status_changed: 'Chart Status',
    task_created: 'Task Created', task_completed: 'Task Done',
    referral_accepted: 'Referral OK', referral_denied: 'Referral Denied',
    discharge_created: 'Discharge', onhold_updated: 'On-Hold',
  };
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        📋 Today's Activity Log <span style={{ fontSize: 11, fontWeight: 400, color: '#6B7280' }}>({entries.length} events)</span>
      </div>
      <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              <th style={{ ...S.th, width: 80 }}>Time</th>
              <th style={{ ...S.th, width: 100 }}>Type</th>
              <th style={{ ...S.th, width: 140 }}>Coordinator</th>
              <th style={S.th}>Details</th>
              <th style={{ ...S.th, width: 140 }}>Patient</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((a, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#F9FAFB' }}>
                <td style={{ ...S.td, color: '#6B7280', fontSize: 11 }}>{fmtTime(a.time)}</td>
                <td style={S.td}>
                  <span style={{
                    display: 'inline-block', fontSize: 10, fontWeight: 600,
                    color: ACTION_COLORS[a.action] || '#374151',
                    background: (ACTION_COLORS[a.action] || '#374151') + '14',
                    borderRadius: 4, padding: '2px 6px',
                  }}>
                    {ACTION_LABELS[a.action] || a.action}
                  </span>
                </td>
                <td style={{ ...S.td, fontWeight: 600 }}>{a.coordinator || '—'}</td>
                <td style={{ ...S.td, color: '#374151' }}>{a.detail}</td>
                <td style={{ ...S.td, color: '#6B7280' }}>{a.patient}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Summary stats row ────────────────────────────────── */
function SummaryStats({ summary, reportType }) {
  if (!summary) return null;
  const auth = summary.auth_coordinators || [];
  const care = summary.care_coordinators || [];
  const inactive = summary.inactive_coordinators || [];

  const totalAuthOpen = auth.reduce((s, c) => s + (c.tasks_open || 0), 0);
  const totalAuthOverdue = auth.reduce((s, c) => s + (c.tasks_overdue || 0), 0);
  const totalAuthRenewals = auth.reduce((s, c) => s + (c.renewal_tasks_open || 0), 0);
  const totalCareOpen = care.reduce((s, c) => s + (c.tasks_open || 0), 0);
  const totalCareOverdue = care.reduce((s, c) => s + (c.tasks_overdue || 0), 0);
  const totalChartNotes = care.reduce((s, c) => s + (c.chart_notes_today || 0), 0);
  const totalCoordNotes = care.reduce((s, c) => s + (c.coord_notes_today || 0), 0);
  const intakePending = summary.intake_pipeline?.total_pending || 0;
  const intakeNew = summary.intake_pipeline?.new_today || 0;
  const isMorning = reportType === 'morning_overview';
  const totalAuthCompleted = auth.reduce((s, c) => s + (c.completed_today || 0), 0);
  const totalCareCompleted = care.reduce((s, c) => s + (c.completed_today || 0), 0);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
      <Stat label="INACTIVE STAFF" value={inactive.length} color={inactive.length > 0 ? '#DC2626' : '#059669'} bg={inactive.length > 0 ? '#FEF2F2' : '#ECFDF5'} />
      <Stat label="Auth Open" value={totalAuthOpen} color="#2563EB" bg="#EFF6FF" />
      <Stat label="Auth Overdue" value={totalAuthOverdue} color={totalAuthOverdue > 0 ? '#DC2626' : '#6B7280'} bg={totalAuthOverdue > 0 ? '#FEF2F2' : '#F3F4F6'} />
      <Stat label="Renewals" value={totalAuthRenewals} color="#7C3AED" bg="#F5F3FF" />
      <Stat label="Care Open" value={totalCareOpen} color="#047857" bg="#ECFDF5" />
      <Stat label="Care Overdue" value={totalCareOverdue} color={totalCareOverdue > 0 ? '#DC2626' : '#6B7280'} bg={totalCareOverdue > 0 ? '#FEF2F2' : '#F3F4F6'} />
      <Stat label="Chart Notes" value={totalChartNotes} color="#7C3AED" bg="#F5F3FF" />
      <Stat label="Coord Notes" value={totalCoordNotes} color="#059669" bg="#ECFDF5" />
      <Stat label="Intake Pending" value={intakePending} color="#B45309" bg="#FFFBEB" />
      <Stat label="New Referrals" value={intakeNew} color="#B45309" bg="#FFFBEB" />
      {!isMorning && <Stat label="Auth Completed" value={totalAuthCompleted} color="#059669" bg="#ECFDF5" />}
      {!isMorning && <Stat label="Care Completed" value={totalCareCompleted} color="#059669" bg="#ECFDF5" />}
    </div>
  );
}

/* ── Full report renderer (reads from summary JSON) ───── */
function ReportContent({ report }) {
  const summary = report.summary;
  if (!summary || Object.keys(summary).length === 0) {
    if (report.report_html) return <div dangerouslySetInnerHTML={{ __html: report.report_html }} />;
    return <div style={{ color: 'var(--gray)', padding: 20 }}>No report data available.</div>;
  }
  let data = summary;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return <div style={{ color: 'var(--gray)', padding: 20 }}>Unable to parse report data.</div>; }
  }

  return (
    <div style={{ padding: '16px 20px' }}>
      {/* INACTIVITY ALERT — first thing you see */}
      <InactivityAlert inactiveList={data.inactive_coordinators} />

      <SummaryStats summary={data} reportType={report.report_type} />

      {/* Overloaded coordinators */}
      {data.overload_coordinators?.length > 0 && (
        <div style={{ background: '#FFFBEB', border: '2px solid #F59E0B', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>⚠️ Overloaded (30+ incomplete tasks)</div>
          {data.overload_coordinators.map((c, i) => (
            <div key={i} style={{ fontSize: 12, color: '#92400E', padding: '2px 0' }}>
              <strong>{c.name}</strong> — {c.incomplete} incomplete, {c.overdue} overdue
            </div>
          ))}
        </div>
      )}

      <AuthCoordTable coordinators={data.auth_coordinators} reportType={report.report_type} />
      <IntakeCoordTable coordinators={data.intake_coordinators} reportType={report.report_type} pipeline={data.intake_pipeline} />
      <CareCoordTable coordinators={data.care_coordinators} reportType={report.report_type} />
      <PodLeaderTable leaders={data.pod_leaders} />
      <ActivityLog entries={data.activity_log_today} />
    </div>
  );
}

/* ── Main page component ──────────────────────────────── */
export default function OpsReportsPage() {
  const { profile } = useAuth();
  const [reports, setReports] = useState([]);
  const [overloads, setOverloads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState(null);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));

  function load() {
    setLoading(true);
    Promise.all([
      supabase.from('daily_ops_reports')
        .select('*')
        .eq('report_date', dateFilter)
        .neq('report_type', 'overload_check_only')
        .order('created_at', { ascending: false }),
      supabase.from('coordinator_overload_alerts')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(20),
    ]).then(([r, o]) => {
      setReports(r.data || []);
      setOverloads(o.data || []);
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, [dateFilter]);
  useRealtimeTable(['daily_ops_reports', 'coordinator_overload_alerts'], load);

  const dates = useMemo(() => {
    const d = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const dt = new Date(today);
      dt.setDate(today.getDate() - i);
      d.push(dt.toISOString().slice(0, 10));
    }
    return d;
  }, []);

  const canView = ['super_admin', 'admin', 'assoc_director', 'ceo'].includes(profile?.role);

  if (!canView) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Operations Reports" subtitle="Access restricted to Directors" />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>
        This page is restricted to Director-level access.
      </div>
    </div>
  );

  // Count total inactive across all current reports for the header
  const latestReport = reports[0];
  const inactiveCount = latestReport?.summary?.inactive_coordinators?.length || 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <TopBar
        title="Operations Reports"
        subtitle="Automated daily snapshots — coordinator task tracking & team performance"
      />
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Top-level inactivity warning — always visible, not inside a report */}
        {inactiveCount > 0 && (
          <div style={{ background: '#FEF2F2', border: '2px solid #DC2626', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>🚨</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#991B1B' }}>
                {inactiveCount} coordinator{inactiveCount === 1 ? '' : 's'} with ZERO activity today
              </div>
              <div style={{ fontSize: 12, color: '#991B1B', marginTop: 2 }}>
                {(latestReport?.summary?.inactive_coordinators || []).map(c => c.name).join(', ')}
              </div>
            </div>
          </div>
        )}

        {/* Overload alerts banner */}
        {overloads.length > 0 && (
          <div style={{ background: '#FFFBEB', border: '2px solid #F59E0B', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E', marginBottom: 6 }}>⚠️ Recent Overload Alerts (30+ incomplete tasks)</div>
            {overloads.slice(0, 5).map(o => (
              <div key={o.id} style={{ fontSize: 12, color: '#92400E', padding: '3px 0' }}>
                <strong>{o.coordinator_name}</strong> — {o.incomplete_count} incomplete tasks
                <span style={{ color: '#9CA3AF', marginLeft: 8 }}>{fmtTime(o.sent_at)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Date selector */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray)' }}>Report Date:</span>
          <select value={dateFilter} onChange={e => setDateFilter(e.target.value)}
            style={{ padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--card-bg)' }}>
            {dates.map(d => <option key={d} value={d}>{fmtDate(d)}</option>)}
          </select>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gray)' }}>{reports.length} report{reports.length === 1 ? '' : 's'} for this date</div>
        </div>

        {/* Report cards */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}>Loading...</div>
        ) : reports.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)', fontSize: 14 }}>
            No reports generated for this date yet. Reports are sent at 8am, 12pm, and 5pm ET on weekdays.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {reports.map(r => {
              const meta = REPORT_META[r.report_type] || REPORT_META.morning_overview;
              const isSelected = selectedReport?.id === r.id;
              const s = r.summary || {};
              const authCount = (s.auth_coordinators || []).length;
              const careCount = (s.care_coordinators || []).length;
              const intakeCount = (s.intake_coordinators || []).length;
              const activityCount = (s.activity_log_today || []).length;
              const inactiveInReport = (s.inactive_coordinators || []).length;
              return (
                <div key={r.id}
                  onClick={() => setSelectedReport(isSelected ? null : r)}
                  style={{
                    background: isSelected ? meta.bg : 'var(--card-bg)',
                    border: `2px solid ${isSelected ? meta.color : 'var(--border)'}`,
                    borderRadius: 10, padding: '16px 18px', cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 22 }}>{meta.icon}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>{meta.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--gray)' }}>{meta.tagline}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 8 }}>
                    Generated {fmtTime(r.created_at)}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {inactiveInReport > 0 && <span style={{ ...S.cardPill, background: '#FEE2E2', color: '#DC2626', fontWeight: 700 }}>🚨 {inactiveInReport} inactive</span>}
                    {authCount > 0 && <span style={S.cardPill}>{authCount} auth</span>}
                    {careCount > 0 && <span style={S.cardPill}>{careCount} care</span>}
                    {intakeCount > 0 && <span style={S.cardPill}>{intakeCount} intake</span>}
                    {activityCount > 0 && <span style={S.cardPill}>{activityCount} events</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Expanded report */}
        {selectedReport && (
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: (REPORT_META[selectedReport.report_type]?.bg || '#F9FAFB') }}>
              <div>
                <span style={{ fontSize: 15, fontWeight: 700, color: REPORT_META[selectedReport.report_type]?.color }}>
                  {REPORT_META[selectedReport.report_type]?.icon} {REPORT_META[selectedReport.report_type]?.label}
                </span>
                <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 12 }}>
                  {fmtDate(selectedReport.report_date)} at {fmtTime(selectedReport.created_at)}
                </span>
              </div>
              <button onClick={() => setSelectedReport(null)}
                style={{ fontSize: 11, color: '#6B7280', background: '#fff', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 12px', cursor: 'pointer', fontWeight: 600 }}>
                Close
              </button>
            </div>
            <ReportContent report={selectedReport} />
          </div>
        )}

      </div>
    </div>
  );
}

/* ── Shared styles ────────────────────────────────────── */
const S = {
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  thead: { background: '#F3F4F6' },
  th: { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#374151', borderBottom: '2px solid #E5E7EB' },
  thNum: { textAlign: 'center', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#374151', borderBottom: '2px solid #E5E7EB' },
  td: { padding: '7px 10px', borderBottom: '1px solid #F3F4F6', fontSize: 12 },
  tdNum: { padding: '7px 10px', borderBottom: '1px solid #F3F4F6', fontSize: 12, textAlign: 'center' },
  cardPill: { fontSize: 10, background: '#F3F4F6', color: '#6B7280', borderRadius: 4, padding: '2px 6px' },
};
