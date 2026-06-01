import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

// All visit math now sourced from /lib/visitMath.js (2026-05-17 refactor)
// so this page can never drift from DirectorDashboard / ReportsExportPage.
import { BLENDED_RATE, WEEKLY_VISIT_CAPACITY as WEEKLY_CAPACITY, WEEKLY_VISIT_TARGET as WEEKLY_TARGET,
         isCancelled, isAttempted, isMissed, isCompleted, dedupEncounters } from '../../lib/visitMath';

function fmt$(n) { return '$' + Math.round(n || 0).toLocaleString(); }
function fmtPct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// 2026-05-17: Switched to Sunday-Saturday week per Liam. Uses the canonical
// getWeekRange helper but maps to this page's existing {start, end, label}
// shape (it doesn't use the Date objects, just the YYYY-MM-DD strings).
import { getWeekRange as _getWeekRange } from '../../lib/dateUtils';
function getWeekRange(weeksAgo = 0) {
  const r = _getWeekRange(new Date(), weeksAgo);
  return { start: r.startStr, end: r.endStr, label: r.label };
}

function StatusPill({ val, thresholdGood, thresholdWarn, suffix = '', invert = false }) {
  let color, bg;
  const v = parseFloat(val);
  if (invert) {
    color = v <= thresholdGood ? '#059669' : v <= thresholdWarn ? '#D97706' : '#DC2626';
    bg = v <= thresholdGood ? '#ECFDF5' : v <= thresholdWarn ? '#FEF3C7' : '#FEF2F2';
  } else {
    color = v >= thresholdGood ? '#059669' : v >= thresholdWarn ? '#D97706' : '#DC2626';
    bg = v >= thresholdGood ? '#ECFDF5' : v >= thresholdWarn ? '#FEF3C7' : '#FEF2F2';
  }
  return (
    <span style={{ background: bg, color, fontWeight: 800, padding: '3px 10px', borderRadius: 999, fontSize: 13, fontFamily: 'DM Mono, monospace' }}>
      {val}{suffix}
    </span>
  );
}

export default function ExecutiveReportPage() {
  const [visits, setVisits] = useState([]);
  const [census, setCensus] = useState([]);
  const [auths, setAuths] = useState([]);
  const [intake, setIntake] = useState([]);
  const [renewals, setRenewals] = useState([]);
  const [clinicians, setClinicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weeksAgo, setWeeksAgo] = useState(0);
  const printRef = useRef();

  const week = useMemo(() => getWeekRange(weeksAgo), [weeksAgo]);
  const prevWeek = useMemo(() => getWeekRange(weeksAgo + 1), [weeksAgo]);

  const load = useCallback(async () => {
    setLoading(true);
    // CRITICAL: Use fetchAllPages for tables that can exceed 1000 rows in the
    // query window — without it, supabase-js silently truncates. We discovered
    // 2026-05-17 that the 2-week visit query returns 1,641 rows in production
    // but was being capped at 1,000, dropping ~640 visits and under-counting
    // revenue by ~$30K. The patient census + intake referrals are likewise
    // capable of crossing 1,000.
    const [v, c, a, i, r, cl] = await Promise.all([
      fetchAllPages(
        supabase.from('visit_schedule_data')
          .select('patient_name,visit_date,status,event_type,staff_name,staff_name_normalized,region,insurance')
          .gte('visit_date', prevWeek.start).lte('visit_date', week.end)
      ),
      fetchAllPages(
        supabase.from('census_data')
          .select('patient_name,status,region,insurance,last_visit_date,days_since_last_visit,last_visit_clinician,inferred_frequency,overdue_threshold_days,days_overdue')
      ),
      fetchAllPages(
        supabase.from('auth_tracker')
          .select('auth_status,auth_expiry_date,visits_authorized,visits_used,insurance,region')
      ),
      fetchAllPages(
        supabase.from('intake_referrals')
          .select('referral_status,date_received,region,insurance,patient_classification')
          .gte('date_received', prevWeek.start)
      ),
      fetchAllPages(
        supabase.from('auth_renewal_tasks')
          .select('task_status,priority,days_until_expiry')
          .not('task_status', 'in', '("approved","denied","closed")')
      ),
      fetchAllPages(
        supabase.from('clinicians').select('full_name,region,weekly_visit_target').eq('is_active', true)
      ),
    ]);
    setVisits(v);
    setCensus(c);
    setAuths(a);
    setIntake(i);
    setRenewals(r);
    setClinicians(cl);
    setLoading(false);
  }, [week.start, week.end, prevWeek.start]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable(['census_data', 'visit_schedule_data', 'auth_tracker', 'clinicians', 'intake_referrals', 'auth_renewal_tasks'], load);

  const stats = useMemo(() => {
    const thisWeekVisits = visits.filter(v => v.visit_date >= week.start && v.visit_date <= week.end);
    const prevWeekVisits = visits.filter(v => v.visit_date >= prevWeek.start && v.visit_date <= prevWeek.end);

    // Use isCompleted helper (excludes cancelled-marked-completed + attempted)
    // + dedup by patient+date so co-treats count as 1 encounter for revenue.
    const thisCompletedDeduped = dedupEncounters(thisWeekVisits.filter(isCompleted));
    const prevCompletedDeduped = dedupEncounters(prevWeekVisits.filter(isCompleted));
    const thisCancelledDeduped = dedupEncounters(thisWeekVisits.filter(isCancelled));
    const thisMissedDeduped    = dedupEncounters(thisWeekVisits.filter(isMissed));
    const thisCompleted  = thisCompletedDeduped.length;
    const prevCompleted  = prevCompletedDeduped.length;
    const thisCancelled  = thisCancelledDeduped.length;
    const thisMissed     = thisMissedDeduped.length;
    // Scheduled stays raw because each clinician's scheduled slot is real capacity
    const thisScheduled  = thisWeekVisits.filter(v => /scheduled/i.test(v.status || '')).length;
    // Total = deduped encounter count for the denominator of rates (so completion%
    // and cancel% reflect encounter-level not row-level math)
    const totalThisWeek  = thisCompleted + thisCancelled + thisMissed;

    const estRevenue      = thisCompleted * BLENDED_RATE;
    const prevRevenue     = prevCompleted * BLENDED_RATE;
    const utilizationPct  = fmtPct(thisCompleted + thisScheduled, WEEKLY_CAPACITY);
    const completionPct   = totalThisWeek > 0 ? fmtPct(thisCompleted, totalThisWeek) : 0;
    const cancelPct       = totalThisWeek > 0 ? fmtPct(thisCancelled, totalThisWeek) : 0;
    const revDelta        = estRevenue - prevRevenue;
    const visitDelta      = thisCompleted - prevCompleted;

    // Census
    const activePatients = census.filter(p => /active/i.test(p.status || ''));
    // Frequency-aware overdue: each patient has their own threshold (4w4→3d, 2w4→4d, 1w4→10d, 1em1→30d, 1em2→60d).
    const inactiveActive = activePatients.filter(p => (p.days_overdue || 0) > 0);
    const onHold         = census.filter(p => /on.?hold/i.test(p.status || ''));
    const socPending     = census.filter(p => /soc.?pending|eval.?pending/i.test(p.status || ''));
    const inactiveRevGap = inactiveActive.length * BLENDED_RATE * 2;

    // Auth — was using `=== 'active'` which excluded 95 'approved' rows and any
    // case variations. Use case-insensitive match for both active + approved
    // (both mean "patient has a working auth right now").
    const activeAuths    = auths.filter(a => /^(active|approved)$/i.test(a.auth_status || ''));
    const urgentRenewals = renewals.filter(r => r.priority === 'urgent').length;
    const totalRenewals  = renewals.length;
    const pendingAuths   = auths.filter(a => /^(pending|submitted)$/i.test(a.auth_status || '')).length;

    // Intake this week
    const thisWeekIntake = intake.filter(r => r.date_received >= week.start);
    const acceptedThisWeek = thisWeekIntake.filter(r => r.referral_status === 'Accepted').length;
    const newPatients    = thisWeekIntake.filter(r => r.patient_classification === 'new_patient').length;

    // Region breakdown — use isCompleted helper + dedup so regional totals
    // sum to the same number as the headline.
    const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];
    const regionData = REGIONS.map(rgn => {
      const rgnActive     = activePatients.filter(p => p.region === rgn).length;
      const rgnInactive   = inactiveActive.filter(p => p.region === rgn).length;
      const rgnCompleted  = dedupEncounters(thisWeekVisits.filter(v => v.region === rgn && isCompleted(v))).length;
      const rgnCapacity   = clinicians.filter(c => c.region === rgn).reduce((s, c) => s + (c.weekly_visit_target || 0), 0);
      const rgnUtil       = fmtPct(rgnCompleted, rgnCapacity);
      return { rgn, rgnActive, rgnInactive, rgnCompleted, rgnCapacity, rgnUtil };
    }).filter(r => r.rgnActive > 0 || r.rgnCompleted > 0);

    // Path to $200K
    const weeklyTarget200k = 200000;
    const visitsNeeded = Math.ceil(weeklyTarget200k / BLENDED_RATE);
    const currentGap   = Math.max(0, visitsNeeded - thisCompleted);
    const revenueGap   = Math.max(0, weeklyTarget200k - estRevenue);

    return {
      thisCompleted, prevCompleted, visitDelta,
      thisCancelled, thisMissed, thisScheduled,
      estRevenue, prevRevenue, revDelta,
      utilizationPct, completionPct, cancelPct,
      activePatients: activePatients.length,
      inactiveActive: inactiveActive.length, inactiveRevGap,
      onHold: onHold.length, socPending: socPending.length,
      activeAuths: activeAuths.length, urgentRenewals, totalRenewals, pendingAuths,
      acceptedThisWeek, newPatients,
      regionData,
      visitsNeeded, currentGap, revenueGap,
    };
  }, [visits, census, auths, intake, renewals, clinicians, week, prevWeek]);

  function handlePrint() {
    const win = window.open('', '_blank');
    const html = printRef.current.innerHTML;
    win.document.write(`<html><head><title>EdemaCare Weekly Report — ${week.label}</title>
      <style>
        body { font-family: 'DM Sans', -apple-system, sans-serif; margin: 0; padding: 24px; color: #0F1117; }
        * { box-sizing: border-box; }
        .no-print { display: none !important; }
      </style></head><body>${html}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Weekly Executive Report" subtitle="Loading..." />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Compiling report data...</div>
    </div>
  );

  const generatedTime = new Date().toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <TopBar
        title="Weekly Executive Report"
        subtitle={week.label}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setWeeksAgo(w => w + 1)} style={{ padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, background: 'var(--card-bg)', cursor: 'pointer' }}>← Prev Week</button>
            {weeksAgo > 0 && <button onClick={() => setWeeksAgo(0)} style={{ padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, background: 'var(--card-bg)', cursor: 'pointer' }}>This Week</button>}
            <button onClick={handlePrint} style={{ padding: '6px 16px', background: '#0F1117', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>🖨 Print / Export</button>
          </div>
        }
      />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div ref={printRef} style={{ padding: 24, maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Report Header */}
          <div style={{ background: '#0F1117', borderRadius: 12, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em' }}>EdemaCare Weekly Operations Report</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{week.label} · Generated {generatedTime}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 28, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: stats.estRevenue >= 100000 ? '#34D399' : stats.estRevenue >= 50000 ? '#FCD34D' : '#F87171' }}>
                {fmt$(stats.estRevenue)}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>EST. REVENUE THIS WEEK</div>
            </div>
          </div>

          {/* Section 1: Visit Performance */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)' }}>
              01 · VISIT PERFORMANCE
            </div>
            <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              {[
                { label: 'Completed Visits', val: stats.thisCompleted, delta: stats.visitDelta, suffix: '', good: 500, warn: 300 },
                { label: 'Est. Revenue', val: fmt$(stats.estRevenue), delta: stats.revDelta, deltaFmt: fmt$(Math.abs(stats.revDelta)), isDollar: true, good: 100000, warn: 50000, rawVal: stats.estRevenue },
                { label: 'Utilization', val: stats.utilizationPct + '%', good: 75, warn: 50, rawVal: stats.utilizationPct },
                { label: 'Completion Rate', val: stats.completionPct + '%', good: 80, warn: 60, rawVal: stats.completionPct },
                { label: 'Cancel Rate', val: stats.cancelPct + '%', good: 5, warn: 10, rawVal: stats.cancelPct, invert: true },
              ].map(c => {
                const color = c.invert
                  ? (c.rawVal <= c.good ? '#059669' : c.rawVal <= c.warn ? '#D97706' : '#DC2626')
                  : (c.rawVal >= c.good ? '#059669' : c.rawVal >= c.warn ? '#D97706' : '#DC2626');
                const bg = c.invert
                  ? (c.rawVal <= c.good ? '#ECFDF5' : c.rawVal <= c.warn ? '#FEF3C7' : '#FEF2F2')
                  : (c.rawVal >= c.good ? '#ECFDF5' : c.rawVal >= c.warn ? '#FEF3C7' : '#FEF2F2');
                return (
                  <div key={c.label} style={{ background: bg, borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 900, fontFamily: 'DM Mono, monospace', color, marginTop: 4 }}>{c.val}</div>
                    {c.delta !== undefined && (
                      <div style={{ fontSize: 10, color: c.delta >= 0 ? '#059669' : '#DC2626', marginTop: 2, fontWeight: 700 }}>
                        {c.delta >= 0 ? '↑' : '↓'} {c.isDollar ? fmt$(Math.abs(c.delta)) : Math.abs(c.delta)} vs last week
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: Patient Census */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)' }}>
              02 · PATIENT CENSUS
            </div>
            <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
              {[
                { label: 'Active Patients', val: stats.activePatients, color: '#059669', bg: '#ECFDF5' },
                { label: '🔴 Inactive Active 14d+', val: stats.inactiveActive, color: '#DC2626', bg: '#FEF2F2', sub: fmt$(stats.inactiveRevGap) + '/wk gap' },
                { label: '🔄 On Hold', val: stats.onHold, color: '#7C3AED', bg: '#F5F3FF' },
                { label: '⏳ SOC/Eval Pending', val: stats.socPending, color: '#D97706', bg: '#FEF3C7' },
              ].map(c => (
                <div key={c.label} style={{ background: c.bg, borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: c.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: c.color, marginTop: 4 }}>{c.val}</div>
                  {c.sub && <div style={{ fontSize: 10, color: c.color, marginTop: 2 }}>{c.sub}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Authorization */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)' }}>
              03 · AUTHORIZATION STATUS
            </div>
            <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
              {[
                { label: 'Active Auths', val: stats.activeAuths, color: '#059669', bg: '#ECFDF5' },
                { label: '🚨 Urgent Renewals', val: stats.urgentRenewals, color: '#DC2626', bg: '#FEF2F2', sub: 'need action now' },
                { label: 'Total Open Renewals', val: stats.totalRenewals, color: '#D97706', bg: '#FEF3C7' },
                { label: '📋 Pending Submission', val: stats.pendingAuths, color: '#1565C0', bg: '#EFF6FF' },
              ].map(c => (
                <div key={c.label} style={{ background: c.bg, borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: c.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: c.color, marginTop: 4 }}>{c.val}</div>
                  {c.sub && <div style={{ fontSize: 10, color: c.color, marginTop: 2 }}>{c.sub}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Section 4: Intake */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)' }}>
              04 · INTAKE THIS WEEK
            </div>
            <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
              {[
                { label: 'Referrals Received', val: intake.filter(r => r.date_received >= week.start).length, color: '#1565C0', bg: '#EFF6FF' },
                { label: 'Accepted', val: stats.acceptedThisWeek, color: '#059669', bg: '#ECFDF5' },
                { label: '🆕 New Patients', val: stats.newPatients, color: '#1565C0', bg: '#EFF6FF' },
              ].map(c => (
                <div key={c.label} style={{ background: c.bg, borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: c.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: c.color, marginTop: 4 }}>{c.val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 5: Region Breakdown */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)' }}>
              05 · REGION BREAKDOWN
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '0.5fr 1fr 1fr 1fr 1fr 1fr', padding: '8px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 9, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', gap: 8 }}>
              <span>Region</span><span>Active Pts</span><span>Inactive 14d+</span><span>Visits Done</span><span>Capacity</span><span>Utilization</span>
            </div>
            {stats.regionData.map((r, i) => {
              const utilColor = r.rgnUtil >= 75 ? '#059669' : r.rgnUtil >= 50 ? '#D97706' : '#DC2626';
              return (
                <div key={r.rgn} style={{ display: 'grid', gridTemplateColumns: '0.5fr 1fr 1fr 1fr 1fr 1fr', padding: '10px 20px', borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 900, fontFamily: 'DM Mono, monospace' }}>Rgn {r.rgn}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{r.rgnActive}</span>
                  <span style={{ fontSize: 13, fontWeight: r.rgnInactive > 5 ? 700 : 400, color: r.rgnInactive > 10 ? '#DC2626' : r.rgnInactive > 5 ? '#D97706' : 'var(--black)' }}>{r.rgnInactive}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{r.rgnCompleted}</span>
                  <span style={{ fontSize: 13, color: 'var(--gray)' }}>{r.rgnCapacity}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 6, background: '#E5E7EB', borderRadius: 999 }}>
                      <div style={{ width: `${Math.min(100, r.rgnUtil)}%`, height: '100%', background: utilColor, borderRadius: 999 }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: utilColor, minWidth: 30 }}>{r.rgnUtil}%</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Section 6: Path to $200K */}
          <div style={{ background: stats.currentGap === 0 ? '#ECFDF5' : '#0F1117', border: `2px solid ${stats.currentGap === 0 ? '#059669' : '#1F2937'}`, borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: stats.currentGap === 0 ? '#065F46' : 'rgba(255,255,255,0.5)', marginBottom: 12 }}>
              06 · PATH TO $200K/WEEK
            </div>
            {stats.currentGap === 0 ? (
              <div style={{ fontSize: 18, fontWeight: 800, color: '#059669' }}>✅ $200K target exceeded this week!</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                {[
                  { label: 'Current Weekly Revenue', val: fmt$(stats.estRevenue), color: stats.estRevenue >= 100000 ? '#34D399' : '#FCD34D' },
                  { label: 'Revenue Gap to $200K', val: fmt$(stats.revenueGap), color: '#F87171' },
                  { label: 'Additional Visits Needed', val: stats.currentGap, suffix: ' visits', color: '#93C5FD' },
                ].map(c => (
                  <div key={c.label}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{c.label}</div>
                    <div style={{ fontSize: 26, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: c.color }}>
                      {c.val}{c.suffix || ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--gray)', paddingBottom: 8 }}>
            EdemaCare Operations Platform · {generatedTime} · Rates based on ${BLENDED_RATE} blended per visit
            <div style={{ fontSize: 9, color: 'var(--gray)', marginTop: 4, opacity: 0.7 }}>EdemaCare is a service of AxiomHealth Management LLC</div>
          </div>
        </div>
      </div>
    </div>
  );
}
