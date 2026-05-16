// =====================================================================
// OperationsManagerDashboard.jsx
//
// Operations Manager dashboard built for Carla Smith (and accessible to
// Hervylie as POD Leader + Liam as Director). The headline question this
// page answers is: "Where are patients stuck in the pipeline today, and
// which team owns it?"
//
// Carla's primary lens (per Liam, 2026-05-15):
//   - Spot bottlenecks in the referral-to-revenue pipeline
//   - Time-in-stage medians by patient cohort
//   - Stuck patients with named team accountability
//   - Department health snapshot (Intake / Auth / Care Coord)
//
// Data sources (no migration needed — everything's in existing tables):
//   - census_data           — current state of each patient
//   - census_status_log     — full history of status transitions w/ timestamps
//   - intake_referrals      — referral inflow, accept/decline
//   - auth_tracker          — auth lifecycle timestamps
//   - coordinators          — team attribution + productivity
//
// Pipeline stages (left → right):
//   Referral → SOC Pending → Auth Pending → Eval Pending → Active
//   Owned by: Intake     Intake/Auth    Auth         Care Coord     —
// =====================================================================

import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import StatusChangeModal from '../../components/StatusChangeModal';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

// ─── Pipeline stage definitions ─────────────────────────────────────────
// Each stage knows: its display label, which census statuses count toward it,
// the owning team (used in stuck-patient attribution), and the threshold (in
// business days) above which a patient becomes "stuck" and surfaces in the
// action list.
const STAGES = [
  {
    key: 'soc_pending',  label: 'SOC Pending',  short: 'SOC',
    statusMatches: function(s) { return /soc.*pending/i.test(s); },
    owner: 'Intake → Auth handoff',
    ownerTeam: 'Auth Team',
    stuckThreshold: 3,
  },
  {
    key: 'auth_pending', label: 'Auth Pending', short: 'Auth',
    statusMatches: function(s) { return /auth.*pending/i.test(s) && !/active/i.test(s); },
    owner: 'Auth Team',
    ownerTeam: 'Auth Team',
    stuckThreshold: 5,
  },
  {
    key: 'eval_pending', label: 'Eval Pending', short: 'Eval',
    statusMatches: function(s) { return /eval.*pending/i.test(s); },
    owner: 'Care Coordination',
    ownerTeam: 'Care Coord',
    stuckThreshold: 2,   // 48-hour SLA per Liam
  },
  {
    key: 'active',       label: 'Active',       short: 'Active',
    statusMatches: function(s) { return /^active/i.test(s); },
    owner: 'Care Coord + Clinician',
    ownerTeam: 'Care Coord',
    stuckThreshold: null, // active isn't stuck — different metric (overdue visits)
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────
function daysSince(iso) {
  if (!iso) return null;
  var d = new Date(iso).getTime();
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d) / 86400000);
}
function businessDaysSince(iso) {
  // Simple business-day approximation: subtract weekends from calendar days.
  // Good enough for ops-level signals; exact holiday math can be a follow-up.
  var d = daysSince(iso);
  if (d === null) return null;
  return Math.max(0, Math.floor(d * 5 / 7));
}
function median(arr) {
  if (!arr || arr.length === 0) return null;
  var s = arr.slice().sort(function(a, b) { return a - b; });
  var m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[m - 1] + s[m]) / 2) : s[m];
}

// ─── Small reusable presentational components ───────────────────────────
function StageCard({ stage, count, medianDays, stuckCount, trend }) {
  // Color the median by health: green ≤ threshold, amber close, red over.
  var t = stage.stuckThreshold;
  var medColor = (t === null || medianDays === null) ? '#374151'
    : medianDays > t ? '#DC2626'
    : medianDays > t * 0.7 ? '#D97706'
    : '#10B981';

  return (
    <div style={{
      background: 'white', border: '1px solid #E5E7EB', borderRadius: 10,
      padding: '10px 12px', minWidth: 140, flex: 1,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {stage.label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 26, fontWeight: 800, fontFamily: 'DM Mono, monospace', color: '#111827', lineHeight: 1 }}>
          {count}
        </span>
        {trend !== null && trend !== undefined && (
          <span style={{ fontSize: 10, fontWeight: 700, color: trend > 0 ? '#DC2626' : trend < 0 ? '#10B981' : '#6B7280' }}>
            {trend > 0 ? '↑' : trend < 0 ? '↓' : '·'} {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div style={{ fontSize: 10, color: '#6B7280', marginTop: 4 }}>
        {medianDays !== null
          ? <>median <span style={{ color: medColor, fontWeight: 700 }}>{medianDays}d</span></>
          : <span style={{ color: '#9CA3AF' }}>no data</span>}
      </div>
      {stage.stuckThreshold !== null && stuckCount > 0 && (
        <div style={{
          marginTop: 6, padding: '3px 6px', background: '#FEF2F2', border: '1px solid #FECACA',
          borderRadius: 5, fontSize: 10, color: '#DC2626', fontWeight: 700,
        }}>
          ⚠ {stuckCount} &gt; {stage.stuckThreshold}d
        </div>
      )}
      <div style={{ marginTop: 6, fontSize: 9, color: '#9CA3AF', borderTop: '1px solid #F3F4F6', paddingTop: 5 }}>
        Owner: <strong style={{ color: '#6B7280' }}>{stage.owner}</strong>
      </div>
    </div>
  );
}

function DepartmentHealthCard({ title, items, accentColor }) {
  return (
    <div style={{
      background: 'white', border: '1px solid #E5E7EB', borderRadius: 10,
      padding: 14, flex: 1, minWidth: 220,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: accentColor,
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10,
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(function(it, i) {
          return (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 11, color: '#6B7280' }}>{it.label}</span>
              <span style={{
                fontSize: 13, fontWeight: 700, fontFamily: 'DM Mono, monospace',
                color: it.alert ? '#DC2626' : '#111827',
              }}>{it.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main dashboard ─────────────────────────────────────────────────────
export default function OperationsManagerDashboard(props) {
  const { profile } = useAuth();
  const onNavigate = props && props.onNavigate;
  const [census, setCensus] = useState([]);
  const [statusLog, setStatusLog] = useState([]);
  const [intakeReferrals, setIntakeReferrals] = useState([]);
  const [auths, setAuths] = useState([]);
  const [coordinators, setCoordinators] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusPatient, setStatusPatient] = useState(null);

  function load() {
    setLoading(true);
    Promise.all([
      // Current census state
      fetchAllPages(
        supabase.from('census_data')
          .select('id, patient_name, region, status, insurance, status_changed_at, first_seen_date, last_seen_date, last_visit_date, days_overdue')
      ),
      // Status transitions (last 60 days — enough for trend math)
      fetchAllPages(
        supabase.from('census_status_log')
          .select('patient_name, region, old_status, new_status, changed_at')
          .gte('changed_at', new Date(Date.now() - 60 * 86400000).toISOString())
          .order('changed_at', { ascending: false })
      ),
      // Referrals received this week (intake inflow)
      fetchAllPages(
        supabase.from('intake_referrals')
          .select('id, patient_name, region, insurance, referral_status, date_received, welcome_call, first_appt, chart_status')
          .gte('date_received', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
      ),
      // Auth lifecycle
      fetchAllPages(
        supabase.from('auth_tracker')
          .select('id, patient_name, region, auth_status, visits_authorized, visits_used, auth_submitted_date, auth_approved_date, auth_expiry_date, soc_date, is_currently_active')
          .eq('is_currently_active', true)
      ),
      // Active coordinators (for team productivity)
      fetchAllPages(
        supabase.from('coordinators')
          .select('id, full_name, role, job_title, team, regions, is_active')
          .eq('is_active', true)
      ),
      // Activity log — 24h window powers the "are coords working" monitor
      fetchAllPages(
        supabase.from('coordinator_activity_log')
          .select('coordinator_name, coordinator_role, action_type, created_at')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: false })
      ),
    ]).then(function(r) {
      setCensus(r[0]);
      setStatusLog(r[1]);
      setIntakeReferrals(r[2]);
      setAuths(r[3]);
      setCoordinators(r[4]);
      setActivityLog(r[5]);
      setLoading(false);
    }).catch(function(err) {
      console.error('[OperationsManagerDashboard] load error:', err);
      setLoading(false);
    });
  }
  useEffect(function() { load(); }, []);
  useRealtimeTable(['census_data', 'census_status_log', 'intake_referrals', 'auth_tracker', 'coordinators', 'coordinator_activity_log'], load);

  // Helper to look up a census row by patient_name (for opening StatusChangeModal
  // from any clickable row anywhere on the page)
  function openPatient(patientName, region) {
    if (!patientName) return;
    var match = census.find(function(c) {
      return c.patient_name && c.patient_name.toLowerCase().trim() === patientName.toLowerCase().trim()
        && (region ? c.region === region : true);
    });
    if (match) setStatusPatient(match);
  }

  // Per-coordinator activity summary used by the Activity Monitor strip
  var coordinatorActivity = useMemo(function() {
    var byName = {};
    activityLog.forEach(function(a) {
      var name = a.coordinator_name;
      if (!name || name === 'System') return;
      if (!byName[name]) byName[name] = { name: name, role: a.coordinator_role, count: 0, lastAt: null };
      byName[name].count++;
      if (!byName[name].lastAt || a.created_at > byName[name].lastAt) byName[name].lastAt = a.created_at;
    });
    // Merge in coordinators who haven't acted today so we can flag them
    coordinators.forEach(function(c) {
      if (['admin', 'super_admin'].indexOf(c.role) >= 0) return; // skip admins from worker activity panel
      var name = c.full_name;
      if (!byName[name]) byName[name] = { name: name, role: c.role, count: 0, lastAt: null };
      byName[name].coord_id = c.id;
      byName[name].team = c.team || c.role;
      byName[name].regions = c.regions;
    });
    // Score: minutes since last action (Infinity if never)
    return Object.values(byName).map(function(c) {
      var minsAgo = c.lastAt ? Math.floor((Date.now() - new Date(c.lastAt).getTime()) / 60000) : Infinity;
      var status = minsAgo === Infinity ? 'offline'
        : minsAgo < 60 ? 'active'
        : minsAgo < 240 ? 'idle'
        : 'stale';
      return Object.assign({}, c, { minsAgo: minsAgo, status: status });
    }).sort(function(a, b) {
      // Sort: most recent activity first; never-acted at the bottom
      if (a.minsAgo === Infinity && b.minsAgo === Infinity) return a.name.localeCompare(b.name);
      if (a.minsAgo === Infinity) return 1;
      if (b.minsAgo === Infinity) return -1;
      return a.minsAgo - b.minsAgo;
    });
  }, [activityLog, coordinators]);

  // ─── Pipeline stage metrics ───────────────────────────────────────────
  // For each stage:
  //   - count = patients currently in that status
  //   - medianDays = median days since each currently-stuck patient entered the stage
  //   - stuckCount = patients exceeding the stage's threshold
  //   - trend = % change vs same week prior (count delta)
  const stageMetrics = useMemo(function() {
    return STAGES.map(function(stage) {
      var inStage = census.filter(function(p) { return stage.statusMatches(p.status || ''); });

      // Compute days-in-stage for each patient by looking up their most recent
      // transition INTO this stage from status_log. Fall back to census_data
      // status_changed_at if no log entry found.
      var daysList = inStage.map(function(p) {
        var matchingLogs = statusLog.filter(function(l) {
          return l.patient_name === p.patient_name && stage.statusMatches(l.new_status || '');
        });
        var enteredAt = matchingLogs.length > 0
          ? matchingLogs[0].changed_at  // most recent (already sorted desc)
          : p.status_changed_at;
        return businessDaysSince(enteredAt);
      }).filter(function(d) { return d !== null; });

      var medianDays = median(daysList);
      var stuckCount = stage.stuckThreshold
        ? daysList.filter(function(d) { return d > stage.stuckThreshold; }).length
        : 0;

      // Trend: compare current count to count one week ago by replaying status log.
      // Simple approximation: count transitions INTO this stage in the last 7 days
      // vs the 7 days before that.
      var now = Date.now();
      var inLast7 = statusLog.filter(function(l) {
        if (!stage.statusMatches(l.new_status || '')) return false;
        var t = new Date(l.changed_at).getTime();
        return t >= now - 7 * 86400000 && t <= now;
      }).length;
      var inPrior7 = statusLog.filter(function(l) {
        if (!stage.statusMatches(l.new_status || '')) return false;
        var t = new Date(l.changed_at).getTime();
        return t >= now - 14 * 86400000 && t < now - 7 * 86400000;
      }).length;
      var trend = inPrior7 > 0
        ? Math.round(((inLast7 - inPrior7) / inPrior7) * 100)
        : (inLast7 > 0 ? 100 : 0);

      return {
        stage: stage,
        count: inStage.length,
        medianDays: medianDays,
        stuckCount: stuckCount,
        stuckPatients: inStage.map(function(p, i) {
          return Object.assign({}, p, { _daysInStage: daysList[i] });
        }).filter(function(p) {
          return stage.stuckThreshold !== null && p._daysInStage > stage.stuckThreshold;
        }).sort(function(a, b) { return b._daysInStage - a._daysInStage; }),
        trend: trend,
      };
    });
  }, [census, statusLog]);

  // Referrals this week + acceptance rate
  const referralStats = useMemo(function() {
    var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    var thisWeek = intakeReferrals.filter(function(r) { return r.date_received >= weekAgo; });
    var accepted = thisWeek.filter(function(r) { return r.referral_status === 'Accepted'; }).length;
    var declined = thisWeek.filter(function(r) { return r.referral_status === 'Denied'; }).length;
    var pending = thisWeek.length - accepted - declined;
    var welcomeBacklog = intakeReferrals.filter(function(r) {
      return r.referral_status === 'Accepted' && (!r.welcome_call || r.welcome_call === 'Not Called' || r.welcome_call === '');
    }).length;
    return {
      thisWeek: thisWeek.length,
      accepted: accepted,
      declined: declined,
      pending: pending,
      acceptanceRate: thisWeek.length > 0 ? Math.round((accepted / thisWeek.length) * 100) : 0,
      welcomeBacklog: welcomeBacklog,
    };
  }, [intakeReferrals]);

  // Auth team health
  const authStats = useMemo(function() {
    var openAuths = auths.filter(function(a) {
      var s = (a.auth_status || '').toLowerCase();
      return s === 'submitted' || s === 'pending';
    });
    var withSubmitDate = auths.filter(function(a) {
      return a.auth_submitted_date && a.auth_approved_date;
    });
    var lags = withSubmitDate.map(function(a) {
      var s = new Date(a.auth_submitted_date).getTime();
      var e = new Date(a.auth_approved_date).getTime();
      if (isNaN(s) || isNaN(e) || e < s) return null;
      return Math.round((e - s) / 86400000);
    }).filter(function(d) { return d !== null; });
    var stalledAuths = openAuths.filter(function(a) {
      var d = daysSince(a.auth_submitted_date);
      return d !== null && d > 5;
    }).length;
    return {
      open: openAuths.length,
      medianLag: median(lags),
      stalled: stalledAuths,
    };
  }, [auths]);

  // Care Coord health: eval pending count + average days-to-eval
  const careStats = useMemo(function() {
    var evalPending = census.filter(function(p) { return /eval.*pending/i.test(p.status || ''); });
    var overdueEvals = evalPending.filter(function(p) {
      var d = daysSince(p.status_changed_at);
      return d !== null && d > 2; // 48h SLA
    }).length;
    var onHold = census.filter(function(p) { return /on hold|on_hold/i.test(p.status || ''); }).length;
    return {
      evalPending: evalPending.length,
      overdueEvals: overdueEvals,
      onHold: onHold,
    };
  }, [census]);

  // Total median time: referral received → first appearance as Active
  const totalPipelineMedian = useMemo(function() {
    // For active patients, find the original referral and the date they
    // first transitioned to Active. Median across all matches.
    var times = [];
    statusLog.forEach(function(l) {
      if (!/^active/i.test(l.new_status || '')) return;
      var ref = intakeReferrals.find(function(r) {
        return r.patient_name && l.patient_name &&
          r.patient_name.toLowerCase().trim() === l.patient_name.toLowerCase().trim();
      });
      if (!ref || !ref.date_received) return;
      var start = new Date(ref.date_received).getTime();
      var end = new Date(l.changed_at).getTime();
      if (isNaN(start) || isNaN(end) || end < start) return;
      times.push(Math.round((end - start) / 86400000 * 5 / 7)); // business days
    });
    return median(times);
  }, [statusLog, intakeReferrals]);

  // All stuck patients across stages (flattened action list)
  const allStuckPatients = useMemo(function() {
    var list = [];
    stageMetrics.forEach(function(m) {
      m.stuckPatients.forEach(function(p) {
        list.push(Object.assign({}, p, {
          _stage: m.stage.label,
          _ownerTeam: m.stage.ownerTeam,
          _threshold: m.stage.stuckThreshold,
        }));
      });
    });
    return list.sort(function(a, b) { return b._daysInStage - a._daysInStage; });
  }, [stageMetrics]);

  // Display
  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Operations Manager" subtitle="Loading pipeline data…" />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}>
        Computing time-in-stage from {statusLog.length || '4,300+'} transitions…
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <TopBar
        title="Operations Manager Dashboard"
        subtitle="Spot bottlenecks in the referral → revenue pipeline"
        actions={<button onClick={load} style={{ padding: '5px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>↻ Refresh</button>}
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>

        {/* Identity strip */}
        <div style={{
          background: 'white', border: '1px solid #E5E7EB', borderRadius: 10,
          padding: '12px 16px', marginBottom: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#D94F2B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Operations Manager
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', marginTop: 2 }}>
              {profile?.full_name || 'Operations Manager'}
            </div>
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
              Reports to Liam O'Brien (Director of Operations) · Managing Intake / Auth / Care Coordination
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Referral → Active median
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'DM Mono, monospace', color: '#111827', marginTop: 2 }}>
              {totalPipelineMedian !== null ? totalPipelineMedian + 'd' : '—'}
            </div>
            <div style={{ fontSize: 10, color: '#9CA3AF' }}>business days, end-to-end</div>
          </div>
        </div>

        {/* ── PIPELINE FLOW STRIP — the headline bottleneck identifier ── */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            🚦 Patient Pipeline Flow
            <span style={{ fontSize: 10, fontWeight: 400, color: '#6B7280' }}>
              Where patients are right now · time-in-stage medians · red badge = stuck
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', overflowX: 'auto', paddingBottom: 4 }}>
            {stageMetrics.map(function(m, i) {
              return (
                <div key={m.stage.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <StageCard
                    stage={m.stage}
                    count={m.count}
                    medianDays={m.medianDays}
                    stuckCount={m.stuckCount}
                    trend={m.trend}
                  />
                  {i < stageMetrics.length - 1 && (
                    <div style={{ color: '#D1D5DB', fontSize: 20, padding: '0 4px', flexShrink: 0 }}>→</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── DEPARTMENT HEALTH SNAPSHOT ─────────────────────────────── */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            🏥 Department Health
            <span style={{ fontSize: 10, fontWeight: 400, color: '#6B7280' }}>
              At-a-glance on the three teams reporting through Hervylie
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column' }}>
              <DepartmentHealthCard
                title="Intake Team"
                accentColor="#1565C0"
                items={[
                  { label: 'Referrals this week', value: referralStats.thisWeek },
                  { label: 'Acceptance rate', value: referralStats.acceptanceRate + '%' },
                  { label: 'Awaiting decision', value: referralStats.pending, alert: referralStats.pending > 10 },
                  { label: 'Welcome call backlog', value: referralStats.welcomeBacklog, alert: referralStats.welcomeBacklog > 0 },
                ]}
              />
              {onNavigate && (
                <button onClick={function() { onNavigate('intake'); }}
                  style={{ marginTop: 6, padding: '6px 10px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#1565C0', cursor: 'pointer' }}>
                  → Jump to Intake Dashboard
                </button>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column' }}>
              <DepartmentHealthCard
                title="Authorization Team"
                accentColor="#7C3AED"
                items={[
                  { label: 'Open auths', value: authStats.open },
                  { label: 'Median submission → approval', value: authStats.medianLag !== null ? authStats.medianLag + 'd' : '—' },
                  { label: 'Stalled (> 5 days pending)', value: authStats.stalled, alert: authStats.stalled > 0 },
                ]}
              />
              {onNavigate && (
                <button onClick={function() { onNavigate('auth-coordinator'); }}
                  style={{ marginTop: 6, padding: '6px 10px', background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#7C3AED', cursor: 'pointer' }}>
                  → Jump to Auth Dashboard
                </button>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column' }}>
              <DepartmentHealthCard
                title="Care Coordination"
                accentColor="#059669"
                items={[
                  { label: 'Eval pending', value: careStats.evalPending },
                  { label: 'Overdue evals (> 48h)', value: careStats.overdueEvals, alert: careStats.overdueEvals > 0 },
                  { label: 'Patients on hold', value: careStats.onHold },
                ]}
              />
              {onNavigate && (
                <button onClick={function() { onNavigate('coordinator-portal'); }}
                  style={{ marginTop: 6, padding: '6px 10px', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#059669', cursor: 'pointer' }}>
                  → Jump to Care Coord Portal
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── ACTIVITY MONITOR — are coordinators actually working today? ── */}
        <div style={{
          background: 'white', border: '1px solid #E5E7EB', borderRadius: 10,
          padding: '12px 14px', marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
              👁 Coordinator Activity — last 24h
              <span style={{ fontSize: 10, fontWeight: 400, color: '#6B7280' }}>
                Live signal of who's actually working
              </span>
            </div>
            <div style={{ fontSize: 10, color: '#6B7280', display: 'flex', gap: 12 }}>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#10B981', borderRadius: '50%', marginRight: 4 }} /> Active (&lt; 1h)</span>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#F59E0B', borderRadius: '50%', marginRight: 4 }} /> Idle (1-4h)</span>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#DC2626', borderRadius: '50%', marginRight: 4 }} /> Stale / Offline</span>
            </div>
          </div>
          {coordinatorActivity.length === 0 ? (
            <div style={{ padding: 12, fontSize: 11, color: '#9CA3AF', textAlign: 'center' }}>
              No activity data yet today.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
              {coordinatorActivity.map(function(c) {
                var dotColor = c.status === 'active' ? '#10B981' : c.status === 'idle' ? '#F59E0B' : '#DC2626';
                var lastLabel = c.minsAgo === Infinity ? 'No activity today'
                  : c.minsAgo < 60 ? c.minsAgo + 'm ago'
                  : c.minsAgo < 1440 ? Math.floor(c.minsAgo / 60) + 'h ago'
                  : Math.floor(c.minsAgo / 1440) + 'd ago';
                return (
                  <div key={c.name} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', border: '1px solid #F3F4F6', borderRadius: 6,
                    background: c.status === 'stale' || c.status === 'offline' ? '#FEF2F2' : '#FAFAFA',
                  }}>
                    <span style={{
                      flexShrink: 0, width: 9, height: 9, background: dotColor, borderRadius: '50%',
                      boxShadow: c.status === 'active' ? '0 0 0 3px ' + dotColor + '33' : 'none',
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name}
                      </div>
                      <div style={{ fontSize: 9, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.role || c.team || ''} · {lastLabel}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 700, fontFamily: 'DM Mono, monospace',
                      color: c.count > 0 ? '#111827' : '#9CA3AF',
                    }}>
                      {c.count}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── STUCK PATIENTS — flattened action list ──────────────────── */}
        <div style={{
          background: 'white', border: '1px solid #E5E7EB', borderRadius: 10,
          overflow: 'hidden', marginBottom: 14,
        }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>
                ⚠ Stuck Patients — Daily Action List
              </div>
              <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
                Patients exceeding stage threshold · sorted longest-stuck first · clear team accountability
              </div>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'DM Mono, monospace', color: allStuckPatients.length > 0 ? '#DC2626' : '#10B981' }}>
              {allStuckPatients.length}
            </div>
          </div>
          {allStuckPatients.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#10B981', fontSize: 12 }}>
              ✅ No patients exceeding stage thresholds — pipeline is flowing.
            </div>
          ) : (
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              <div style={{
                display: 'grid', gridTemplateColumns: '60px 1.4fr 110px 110px 1fr 70px',
                padding: '7px 14px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB',
                fontSize: 9, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', position: 'sticky', top: 0,
              }}>
                <span>Region</span>
                <span>Patient</span>
                <span>Stage</span>
                <span>Owner</span>
                <span>Insurance</span>
                <span style={{ textAlign: 'right' }}>Stuck</span>
              </div>
              {allStuckPatients.slice(0, 50).map(function(p, i) {
                var sevColor = p._daysInStage > p._threshold * 3 ? '#DC2626'
                  : p._daysInStage > p._threshold * 2 ? '#D97706'
                  : '#F59E0B';
                var rowBg = i % 2 === 0 ? 'white' : '#F9FAFB';
                return (
                  <div key={(p.id || p.patient_name) + '|' + i}
                    onClick={function() { openPatient(p.patient_name, p.region); }}
                    style={{
                      display: 'grid', gridTemplateColumns: '60px 1.4fr 110px 110px 1fr 70px',
                      padding: '8px 14px', borderBottom: '1px solid #F3F4F6',
                      background: rowBg, alignItems: 'center', fontSize: 11,
                      cursor: 'pointer', transition: 'background 0.1s',
                    }}
                    onMouseEnter={function(e) { e.currentTarget.style.background = '#EFF6FF'; }}
                    onMouseLeave={function(e) { e.currentTarget.style.background = rowBg; }}>
                    <span style={{ fontWeight: 700, color: '#374151', fontFamily: 'DM Mono, monospace' }}>{p.region}</span>
                    <span style={{ fontWeight: 600, color: '#111827', textDecoration: 'underline', textDecorationColor: '#D1D5DB' }}>{p.patient_name}</span>
                    <span style={{ color: '#6B7280', fontSize: 10 }}>{p._stage}</span>
                    <span style={{ color: '#6B7280', fontSize: 10 }}>{p._ownerTeam}</span>
                    <span style={{ color: '#6B7280', fontSize: 10 }}>{p.insurance || '—'}</span>
                    <span style={{ textAlign: 'right', fontWeight: 800, fontFamily: 'DM Mono, monospace', color: sevColor, fontSize: 13 }}>
                      {p._daysInStage}d
                    </span>
                  </div>
                );
              })}
              {allStuckPatients.length > 50 && (
                <div style={{ padding: 10, textAlign: 'center', fontSize: 10, color: '#9CA3AF', background: '#F9FAFB' }}>
                  Showing 50 of {allStuckPatients.length} · sorted by days-stuck desc
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer reminder for Phase 2 features */}
        <div style={{ fontSize: 10, color: '#9CA3AF', textAlign: 'center', padding: '8px 0' }}>
          v1.1 · clickable stuck patients, activity monitor, dept quick-jumps · phase 2 will add week-over-week trend charts and SLA breach attribution
        </div>

      </div>

      {statusPatient && (
        <StatusChangeModal
          patient={statusPatient}
          coordinatorId={profile?.id}
          coordinatorName={profile?.full_name}
          onClose={function() { setStatusPatient(null); }}
          onSaved={function() { setStatusPatient(null); load(); }}
        />
      )}
    </div>
  );
}
