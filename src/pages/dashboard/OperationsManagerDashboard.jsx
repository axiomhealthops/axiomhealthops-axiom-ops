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
// 2026-05-28: Carla Ops Manager extension — three additive components
// role-gated to admin + super_admin (other roles see the existing dashboard
// unchanged).
import EngagementAlertBanner from '../../components/ops/EngagementAlertBanner';
import TeamPerformanceToday from '../../components/ops/TeamPerformanceToday';
import TodaysStandups from '../../components/ops/TodaysStandups';

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
  // Use ceiling so a patient who entered the stage 6 hours ago shows 1d
  // (rather than 0d, which would hide everything fresher than a full day).
  return Math.max(1, Math.ceil((Date.now() - d) / 86400000));
}
// Removed the business-day approximation — it was rounding every short
// duration down to 0d (e.g. 3 calendar days × 5/7 = 2.14 → 2, but 1 day
// × 5/7 = 0.71 → 0). For ops-level signals, calendar days are more
// intuitive and match the rest of the system's conventions.
function median(arr) {
  if (!arr || arr.length === 0) return null;
  var s = arr.slice().sort(function(a, b) { return a - b; });
  var m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[m - 1] + s[m]) / 2) : s[m];
}

// ─── Small reusable presentational components ───────────────────────────
function StageCard({ stage, count, medianDays, stuckCount, trend, onClick, isActive }) {
  // Color the median by health: green ≤ threshold, amber close, red over.
  var t = stage.stuckThreshold;
  var medColor = (t === null || medianDays === null) ? '#374151'
    : medianDays > t ? '#DC2626'
    : medianDays > t * 0.7 ? '#D97706'
    : '#10B981';
  var canClick = count > 0 && typeof onClick === 'function';

  return (
    <div
      onClick={canClick ? onClick : null}
      style={{
        background: isActive ? '#0F1117' : 'white',
        color: isActive ? '#fff' : 'inherit',
        border: '1px solid ' + (isActive ? '#0F1117' : '#E5E7EB'),
        borderRadius: 10, padding: '10px 12px', minWidth: 140, flex: 1,
        display: 'flex', flexDirection: 'column',
        cursor: canClick ? 'pointer' : 'default',
        transition: 'transform 0.1s, border-color 0.15s',
        boxShadow: isActive ? '0 0 0 3px rgba(15,17,23,0.15)' : 'none',
      }}
      onMouseEnter={canClick && !isActive ? function(e) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.borderColor = '#9CA3AF'; } : null}
      onMouseLeave={canClick && !isActive ? function(e) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = '#E5E7EB'; } : null}>
      <div style={{ fontSize: 9, fontWeight: 700, color: isActive ? '#9CA3AF' : '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {stage.label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 26, fontWeight: 800, fontFamily: 'DM Mono, monospace', color: isActive ? '#fff' : '#111827', lineHeight: 1 }}>
          {count}
        </span>
        {trend !== null && trend !== undefined && (
          <span style={{ fontSize: 10, fontWeight: 700, color: trend > 0 ? '#FCA5A5' : trend < 0 ? '#86EFAC' : '#9CA3AF' }}>
            {trend > 0 ? '↑' : trend < 0 ? '↓' : '·'} {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div style={{ fontSize: 10, color: isActive ? '#D1D5DB' : '#6B7280', marginTop: 4 }}>
        {medianDays !== null
          ? <>median <span style={{ color: isActive ? '#fff' : medColor, fontWeight: 700 }}>{medianDays}d</span></>
          : <span style={{ color: '#9CA3AF' }}>no data</span>}
      </div>
      {stage.stuckThreshold !== null && stuckCount > 0 && (
        <div style={{
          marginTop: 6, padding: '3px 6px',
          background: isActive ? 'rgba(220,38,38,0.2)' : '#FEF2F2',
          border: '1px solid ' + (isActive ? 'rgba(252,165,165,0.5)' : '#FECACA'),
          borderRadius: 5, fontSize: 10, color: isActive ? '#FCA5A5' : '#DC2626', fontWeight: 700,
        }}>
          ⚠ {stuckCount} &gt; {stage.stuckThreshold}d
        </div>
      )}
      <div style={{ marginTop: 6, fontSize: 9, color: isActive ? '#6B7280' : '#9CA3AF', borderTop: '1px solid ' + (isActive ? '#374151' : '#F3F4F6'), paddingTop: 5 }}>
        Owner: <strong style={{ color: isActive ? '#9CA3AF' : '#6B7280' }}>{stage.owner}</strong>
      </div>
      {canClick && !isActive && (
        <div style={{ marginTop: 4, fontSize: 9, color: '#9CA3AF', textAlign: 'center', fontStyle: 'italic' }}>
          click to view patients
        </div>
      )}
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(function(it, i) {
          var clickable = typeof it.onClick === 'function' && (typeof it.value === 'number' ? it.value > 0 : true);
          return (
            <div key={i}
              onClick={clickable ? it.onClick : null}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                padding: '4px 6px', margin: '0 -6px', borderRadius: 5,
                cursor: clickable ? 'pointer' : 'default',
                transition: 'background 0.1s',
              }}
              onMouseEnter={clickable ? function(e) { e.currentTarget.style.background = '#F3F4F6'; } : null}
              onMouseLeave={clickable ? function(e) { e.currentTarget.style.background = 'transparent'; } : null}>
              <span style={{ fontSize: 11, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                {it.label}
                {clickable && <span style={{ fontSize: 9, color: '#9CA3AF' }}>↗</span>}
              </span>
              <span style={{
                fontSize: 13, fontWeight: 700, fontFamily: 'DM Mono, monospace',
                color: it.alert ? '#DC2626' : '#111827',
                textDecoration: clickable ? 'underline' : 'none',
                textDecorationColor: '#D1D5DB',
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
  // Right-sidebar drilldown for Pipeline Flow stages & Dept Health metrics.
  // Stores { title, subtitle, patients[], color } or null.
  const [drilldown, setDrilldown] = useState(null);

  function load() {
    setLoading(true);
    Promise.all([
      // Current census state — pipeline_assigned_to gives us care-coord owner
      fetchAllPages(
        supabase.from('census_data')
          .select('id, patient_name, region, status, insurance, status_changed_at, first_seen_date, last_seen_date, last_visit_date, days_overdue, pipeline_assigned_to')
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
      // Auth lifecycle — assigned_to gives us the auth coordinator owning each row
      fetchAllPages(
        supabase.from('auth_tracker')
          .select('id, patient_name, region, auth_status, visits_authorized, visits_used, auth_submitted_date, auth_approved_date, auth_expiry_date, soc_date, is_currently_active, assigned_to, insurance')
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

  // Open a drilldown for a pipeline stage (SOC Pending / Auth Pending / etc.)
  function openStageDrilldown(stage) {
    var patients = census.filter(function(p) { return stage.statusMatches(p.status || ''); })
      .map(function(p) {
        // Find when they entered this stage for sorting by oldest-first
        var logs = statusLog.filter(function(l) {
          return l.patient_name === p.patient_name && stage.statusMatches(l.new_status || '');
        });
        var enteredAt = logs.length > 0 ? logs[0].changed_at : p.status_changed_at;
        return Object.assign({}, p, {
          _enteredAt: enteredAt,
          _daysInStage: daysSince(enteredAt),
        });
      })
      .sort(function(a, b) {
        var ad = a._daysInStage === null ? 0 : a._daysInStage;
        var bd = b._daysInStage === null ? 0 : b._daysInStage;
        return bd - ad;
      });
    setDrilldown({
      key: 'stage:' + stage.key,
      title: stage.label,
      subtitle: 'Owned by ' + stage.owner + (stage.stuckThreshold ? ' · stuck threshold ' + stage.stuckThreshold + 'd' : ''),
      color: '#0F1117',
      patients: patients,
      metricColumn: 'daysInStage',
    });
  }

  // Open a drilldown for a Department Health metric (e.g. eval pending, on hold,
  // welcome call backlog). filterFn is a predicate against a list of source rows.
  function openMetricDrilldown(opts) {
    setDrilldown({
      key: opts.key,
      title: opts.title,
      subtitle: opts.subtitle,
      color: opts.color || '#1565C0',
      patients: opts.patients,
      metricColumn: opts.metricColumn,
    });
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
        return daysSince(enteredAt);
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

      {/* 2026-05-28: Engagement banner ONLY for admin / super_admin. Other
          roles never see staff login-recency data. Banner self-hides when
          there are no stale coordinators. */}
      {['admin','super_admin'].includes(profile?.role) && (
        <EngagementAlertBanner />
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>

        {/* Identity strip */}
        <div style={{
          background: 'white', border: '1px solid #E5E7EB', borderRadius: 10,
          padding: '12px 16px', marginBottom: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#06B6D4', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
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
                    onClick={function() { openStageDrilldown(m.stage); }}
                    isActive={drilldown && drilldown.key === 'stage:' + m.stage.key}
                  />
                  {i < stageMetrics.length - 1 && (
                    <div style={{ color: '#D1D5DB', fontSize: 20, padding: '0 4px', flexShrink: 0 }}>→</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 2026-05-28: Team Performance Today + Today's Standups — admin/super_admin only.
            These two sections are additive; coordinator roles never see them. */}
        {['admin','super_admin'].includes(profile?.role) && (
          <>
            <div style={{ marginLeft: -18, marginRight: -18 }}>
              <TeamPerformanceToday />
            </div>
            <div style={{ marginLeft: -18, marginRight: -18 }}>
              <TodaysStandups />
            </div>
          </>
        )}

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
                  {
                    label: 'Referrals this week',
                    value: referralStats.thisWeek,
                    onClick: function() {
                      var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
                      var pts = intakeReferrals.filter(function(r) { return r.date_received >= weekAgo; })
                        .map(function(r) { return Object.assign({}, r, { _daysAgo: daysSince(r.date_received) }); })
                        .sort(function(a, b) { return (b._daysAgo || 0) - (a._daysAgo || 0); });
                      openMetricDrilldown({
                        key: 'intake:thisweek', title: 'Referrals This Week', color: '#1565C0',
                        subtitle: 'All referrals received in the last 7 days · oldest first',
                        patients: pts, metricColumn: 'referralAge',
                      });
                    },
                  },
                  { label: 'Acceptance rate', value: referralStats.acceptanceRate + '%' },
                  {
                    label: 'Awaiting decision',
                    value: referralStats.pending,
                    alert: referralStats.pending > 10,
                    onClick: function() {
                      var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
                      var pts = intakeReferrals.filter(function(r) {
                        if (r.date_received < weekAgo) return false;
                        var s = r.referral_status;
                        return s !== 'Accepted' && s !== 'Denied';
                      }).map(function(r) { return Object.assign({}, r, { _daysAgo: daysSince(r.date_received) }); })
                        .sort(function(a, b) { return (b._daysAgo || 0) - (a._daysAgo || 0); });
                      openMetricDrilldown({
                        key: 'intake:pending', title: 'Referrals Awaiting Decision', color: '#1565C0',
                        subtitle: 'Received this week · not yet accepted or denied',
                        patients: pts, metricColumn: 'referralAge',
                      });
                    },
                  },
                  {
                    label: 'Welcome call backlog',
                    value: referralStats.welcomeBacklog,
                    alert: referralStats.welcomeBacklog > 0,
                    onClick: function() {
                      var pts = intakeReferrals.filter(function(r) {
                        return r.referral_status === 'Accepted' &&
                          (!r.welcome_call || r.welcome_call === 'Not Called' || r.welcome_call === '');
                      }).map(function(r) { return Object.assign({}, r, { _daysAgo: daysSince(r.date_received) }); })
                        .sort(function(a, b) { return (b._daysAgo || 0) - (a._daysAgo || 0); });
                      openMetricDrilldown({
                        key: 'intake:welcome_backlog', title: 'Welcome Call Backlog', color: '#1565C0',
                        subtitle: 'Accepted referrals with no welcome call logged · oldest first',
                        patients: pts, metricColumn: 'referralAge',
                      });
                    },
                  },
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
                  {
                    label: 'Open auths',
                    value: authStats.open,
                    onClick: function() {
                      var pts = auths.filter(function(a) {
                        var s = (a.auth_status || '').toLowerCase();
                        return s === 'submitted' || s === 'pending';
                      }).map(function(a) { return Object.assign({}, a, { _daysAgo: daysSince(a.auth_submitted_date) }); })
                        .sort(function(a, b) { return (b._daysAgo || 0) - (a._daysAgo || 0); });
                      openMetricDrilldown({
                        key: 'auth:open', title: 'Open Auths', color: '#7C3AED',
                        subtitle: 'Submitted or pending · oldest-submitted first',
                        patients: pts, metricColumn: 'authAge',
                      });
                    },
                  },
                  { label: 'Median submission → approval', value: authStats.medianLag !== null ? authStats.medianLag + 'd' : '—' },
                  {
                    label: 'Stalled (> 5 days pending)',
                    value: authStats.stalled,
                    alert: authStats.stalled > 0,
                    onClick: function() {
                      var pts = auths.filter(function(a) {
                        var s = (a.auth_status || '').toLowerCase();
                        if (s !== 'submitted' && s !== 'pending') return false;
                        var d = daysSince(a.auth_submitted_date);
                        return d !== null && d > 5;
                      }).map(function(a) { return Object.assign({}, a, { _daysAgo: daysSince(a.auth_submitted_date) }); })
                        .sort(function(a, b) { return (b._daysAgo || 0) - (a._daysAgo || 0); });
                      openMetricDrilldown({
                        key: 'auth:stalled', title: 'Stalled Auths (> 5d)', color: '#DC2626',
                        subtitle: 'Auths submitted more than 5 days ago, still not approved',
                        patients: pts, metricColumn: 'authAge',
                      });
                    },
                  },
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
                  {
                    label: 'Eval pending',
                    value: careStats.evalPending,
                    onClick: function() {
                      var pts = census.filter(function(p) { return /eval.*pending/i.test(p.status || ''); })
                        .map(function(p) { return Object.assign({}, p, { _daysInStage: daysSince(p.status_changed_at) }); })
                        .sort(function(a, b) { return (b._daysInStage || 0) - (a._daysInStage || 0); });
                      openMetricDrilldown({
                        key: 'cc:eval_pending', title: 'Eval Pending', color: '#059669',
                        subtitle: 'Patients awaiting evaluation · 48h SLA',
                        patients: pts, metricColumn: 'daysInStage',
                      });
                    },
                  },
                  {
                    label: 'Overdue evals (> 48h)',
                    value: careStats.overdueEvals,
                    alert: careStats.overdueEvals > 0,
                    onClick: function() {
                      var pts = census.filter(function(p) {
                        if (!/eval.*pending/i.test(p.status || '')) return false;
                        var d = daysSince(p.status_changed_at);
                        return d !== null && d > 2;
                      }).map(function(p) { return Object.assign({}, p, { _daysInStage: daysSince(p.status_changed_at) }); })
                        .sort(function(a, b) { return (b._daysInStage || 0) - (a._daysInStage || 0); });
                      openMetricDrilldown({
                        key: 'cc:overdue_evals', title: 'Overdue Evals (> 48h)', color: '#DC2626',
                        subtitle: 'Eval Pending patients past the 48-hour SLA',
                        patients: pts, metricColumn: 'daysInStage',
                      });
                    },
                  },
                  {
                    label: 'Patients on hold',
                    value: careStats.onHold,
                    onClick: function() {
                      var pts = census.filter(function(p) { return /on hold|on_hold/i.test(p.status || ''); })
                        .map(function(p) { return Object.assign({}, p, { _daysInStage: daysSince(p.status_changed_at) }); })
                        .sort(function(a, b) { return (b._daysInStage || 0) - (a._daysInStage || 0); });
                      openMetricDrilldown({
                        key: 'cc:on_hold', title: 'Patients On Hold', color: '#D97706',
                        subtitle: 'Care coord needs to action recovery · oldest-on-hold first',
                        patients: pts, metricColumn: 'daysInStage',
                      });
                    },
                  },
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

      {/* ── DRILLDOWN SLIDE-IN PANEL (right side) ──────────────────── */}
      {drilldown && (
        <>
          {/* Click-away backdrop */}
          <div
            onClick={function() { setDrilldown(null); }}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(15,17,23,0.35)', zIndex: 200,
              animation: 'fadeIn 0.15s ease',
            }} />
          {/* Panel */}
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: 460, maxWidth: '92vw',
            background: 'white', zIndex: 201,
            boxShadow: '-8px 0 32px rgba(15,17,23,0.18)',
            display: 'flex', flexDirection: 'column',
            animation: 'slideInRight 0.2s ease',
          }}>
            {/* Header */}
            <div style={{
              padding: '14px 18px', borderBottom: '1px solid #E5E7EB',
              background: drilldown.color, color: 'white',
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.8 }}>
                  Drilldown · {drilldown.patients.length} {drilldown.patients.length === 1 ? 'record' : 'records'}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4, lineHeight: 1.2 }}>
                  {drilldown.title}
                </div>
                <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>
                  {drilldown.subtitle}
                </div>
              </div>
              <button
                onClick={function() { setDrilldown(null); }}
                style={{
                  background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white',
                  borderRadius: 6, padding: '4px 10px', fontSize: 16, cursor: 'pointer',
                  fontWeight: 700, flexShrink: 0,
                }}
                title="Close">×</button>
            </div>
            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {/* Owner accountability summary — count unassigned + owner breakdown */}
              {drilldown.patients.length > 0 && drilldown.key && drilldown.key.indexOf('intake:') !== 0 && (() => {
                var unassignedCount = drilldown.patients.filter(function(p) {
                  return !(p.assigned_to || p.pipeline_assigned_to);
                }).length;
                var ownerCounts = {};
                drilldown.patients.forEach(function(p) {
                  var o = p.assigned_to || p.pipeline_assigned_to;
                  if (o) ownerCounts[o] = (ownerCounts[o] || 0) + 1;
                });
                var topOwners = Object.entries(ownerCounts)
                  .sort(function(a, b) { return b[1] - a[1]; })
                  .slice(0, 3);
                return (
                  <div style={{
                    padding: '10px 18px', background: '#FAFAFA',
                    borderBottom: '1px solid #E5E7EB',
                    fontSize: 10, color: '#374151',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                  }}>
                    <div>
                      {unassignedCount > 0 ? (
                        <span style={{ color: '#991B1B', fontWeight: 700 }}>
                          ⚠ {unassignedCount} unassigned · accountability gap
                        </span>
                      ) : (
                        <span style={{ color: '#059669', fontWeight: 700 }}>
                          ✓ All assigned
                        </span>
                      )}
                    </div>
                    {topOwners.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {topOwners.map(function(entry) {
                          return (
                            <span key={entry[0]} style={{
                              padding: '2px 7px', background: 'white', border: '1px solid #E5E7EB',
                              borderRadius: 10, fontSize: 9, fontWeight: 700, color: '#374151',
                            }}>
                              {entry[0]} · <span style={{ color: '#6B7280' }}>{entry[1]}</span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
              {drilldown.patients.length === 0 ? (
                <div style={{ padding: 36, textAlign: 'center', color: '#10B981', fontSize: 13 }}>
                  ✅ Nothing here right now.
                </div>
              ) : (
                drilldown.patients.map(function(p, i) {
                  // metricColumn drives the right-side number
                  var metricValue = '';
                  var metricColor = '#6B7280';
                  if (drilldown.metricColumn === 'daysInStage') {
                    metricValue = (p._daysInStage !== null && p._daysInStage !== undefined) ? p._daysInStage + 'd' : '—';
                    metricColor = p._daysInStage > 7 ? '#DC2626' : p._daysInStage > 3 ? '#D97706' : '#059669';
                  } else if (drilldown.metricColumn === 'referralAge') {
                    metricValue = (p._daysAgo !== null && p._daysAgo !== undefined) ? p._daysAgo + 'd' : '—';
                    metricColor = p._daysAgo > 5 ? '#DC2626' : p._daysAgo > 2 ? '#D97706' : '#059669';
                  } else if (drilldown.metricColumn === 'authAge') {
                    metricValue = (p._daysAgo !== null && p._daysAgo !== undefined) ? p._daysAgo + 'd' : '—';
                    metricColor = p._daysAgo > 5 ? '#DC2626' : p._daysAgo > 3 ? '#D97706' : '#059669';
                  }
                  // Status / extra context line
                  var statusLine = p.status || p.auth_status || p.referral_status || '';
                  var canOpenModal = !!p.patient_name;
                  // Resolve owner: auth rows use assigned_to, census rows use pipeline_assigned_to.
                  // Intake referrals have no per-row assignment — show "Intake Team".
                  var owner = p.assigned_to || p.pipeline_assigned_to || null;
                  var isIntakeRow = drilldown.key && drilldown.key.indexOf('intake:') === 0;
                  var ownerLabel, ownerColor, ownerBg, ownerBorder;
                  if (owner) {
                    ownerLabel = owner;
                    ownerColor = '#1E40AF'; ownerBg = '#EFF6FF'; ownerBorder = '#BFDBFE';
                  } else if (isIntakeRow) {
                    ownerLabel = 'Intake Team'; ownerColor = '#6B7280'; ownerBg = '#F3F4F6'; ownerBorder = '#E5E7EB';
                  } else {
                    ownerLabel = '⚠ Unassigned'; ownerColor = '#991B1B'; ownerBg = '#FEF2F2'; ownerBorder = '#FECACA';
                  }
                  return (
                    <div key={(p.id || p.patient_name) + '|' + i}
                      onClick={canOpenModal ? function() { openPatient(p.patient_name, p.region); } : null}
                      style={{
                        padding: '10px 18px', borderBottom: '1px solid #F3F4F6',
                        display: 'flex', alignItems: 'center', gap: 12,
                        cursor: canOpenModal ? 'pointer' : 'default',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={canOpenModal ? function(e) { e.currentTarget.style.background = '#EFF6FF'; } : null}
                      onMouseLeave={canOpenModal ? function(e) { e.currentTarget.style.background = 'white'; } : null}>
                      <div style={{
                        flexShrink: 0, width: 36, height: 36, borderRadius: 6,
                        background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 800, color: '#374151', fontFamily: 'DM Mono, monospace',
                      }}>
                        {p.region || '—'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: 700, color: '#111827',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          textDecoration: canOpenModal ? 'underline' : 'none',
                          textDecorationColor: '#D1D5DB',
                        }}>
                          {p.patient_name || '—'}
                        </div>
                        <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {statusLine}{p.insurance ? ' · ' + p.insurance : ''}
                        </div>
                        <div style={{
                          marginTop: 4,
                          display: 'inline-block',
                          padding: '2px 7px',
                          background: ownerBg,
                          border: '1px solid ' + ownerBorder,
                          borderRadius: 4,
                          fontSize: 9, fontWeight: 700,
                          color: ownerColor,
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                          maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {ownerLabel}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{
                          fontSize: 16, fontWeight: 800, fontFamily: 'DM Mono, monospace',
                          color: metricColor, lineHeight: 1,
                        }}>
                          {metricValue}
                        </div>
                        <div style={{ fontSize: 8, color: '#9CA3AF', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {drilldown.metricColumn === 'daysInStage' ? 'in stage'
                            : drilldown.metricColumn === 'authAge' ? 'submitted'
                            : 'received'}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {/* Footer */}
            <div style={{
              padding: '10px 18px', borderTop: '1px solid #E5E7EB',
              background: '#FAFAFA', fontSize: 10, color: '#6B7280',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>Click a patient to open status editor</span>
              <button
                onClick={function() { setDrilldown(null); }}
                style={{ background: 'none', border: '1px solid #D1D5DB', borderRadius: 5, padding: '4px 10px', fontSize: 10, cursor: 'pointer', color: '#6B7280' }}>
                Close
              </button>
            </div>
          </div>
          {/* Inline keyframes for the slide-in animation */}
          <style>{
            '@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } } ' +
            '@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }'
          }</style>
        </>
      )}

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
