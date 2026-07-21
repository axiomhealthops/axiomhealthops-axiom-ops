import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, fetchAllPages } from '../../lib/supabase';
import TopBar from '../../components/TopBar';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import ManagerScorecards from '../../components/director/ManagerScorecards';
import ExceptionFeed from '../../components/director/ExceptionFeed';
import WeekSelector, { readPersistedWeekOffset } from '../../components/WeekSelector';
import StateToggle from '../../components/StateToggle';
import { useStateMapping, getRegionsForState, readPersistedState } from '../../lib/stateMapping';
import {
  BLENDED_RATE,
  WEEKLY_REVENUE_TARGET as REVENUE_TARGET,
  WEEKLY_VISIT_TARGET,
  classifyWeekSlots,
} from '../../lib/visitMath';
// 2026-07-21: switched from dedupVisitsByLatestUpload to the authoritative-batch
// rule. The old rule left 268 phantom slots in the week of Jul 19 (935 vs 667)
// because Pariox sends full-week snapshots and the per-(patient,date) key can
// never notice a dropped slot. See src/lib/visitDedup.js.
import { dedupVisitsByAuthoritativeBatch } from '../../lib/visitDedup';
import { getWeekRange } from '../../lib/dateUtils';
import { bucketCensus } from '../../lib/censusStatus';

// =====================================================================
// DIRECTOR COMMAND v4 — "Company Pulse" (2026-07-21)
//
// Liam's brief: as COO he must read every major bucket and act inside
// 10-15 seconds. The v3 page failed that on three counts, all fixed here.
//
// 1. THE VISIT NUMBER WAS MISLEADING.
//    v3 showed one tile, "Visits This Week", wired to COMPLETED only, and
//    compared it against a locally-hardcoded 750. Mid-week that reads
//    "104 / 750 = 14%" and looks like a collapse. The company had in fact
//    booked 749 visits for that week. Delivery risk and booking risk are
//    different problems with different owners, and the page could not
//    tell them apart. Now four separate widgets: Booked, Completed,
//    Remaining, Lost.
//
// 2. THE TARGET DISAGREED WITH ITSELF.
//    v3: `const WEEKLY_TARGET = 750` local to this file, while
//    visitMath.js exported WEEKLY_VISIT_TARGET = 1000. Two pages, two
//    targets. The local constant is deleted; the shared one is imported.
//
// 3. STATUS BUCKETS WERE INVISIBLE OR WRONG.
//    - No total-census figure existed anywhere on the page.
//    - /active/i matched "Active - Auth Pendin" too, so Active Census
//      read 496 here and 473 on the census page.
//    - Waitlist, Auth Pending, Eval Pending, Hospitalized and the four
//      On Hold sub-types had no representation at all.
//    All nine live buckets now render as individual widgets and sum
//    exactly to the live roster. See src/lib/censusStatus.js.
//
// REMOVED (nothing lost — each still lives on its own page):
//   Triage 5 cards -> the same records, better sorted, on census/auth/pipeline
//   Path to $200K x2 -> RevenuePage
//   Expansion Status -> ExpansionPage
//   Auth Renewals list -> AuthRenewalsPage
//   Clinician Underutilization list -> ClinicianAccountabilityPage
//   Region Health table -> RegionsPage / RM dashboards
// Manager Scorecards + Exception Feed stay, folded into Detail.
//
// Dropped queries: waitlist_assignments (census is the source of truth and
// the two disagreed: 17 vs 44), patient_discharges, intake_referrals and
// auth_tracker (all three were fetched but never rendered after the v2.1
// LieutenantSnapshots removal). 13 round-trips -> 8.
// =====================================================================

function fmt$(n) { return '$' + Math.round(n).toLocaleString(); }
function fmtN(n) { return (n || 0).toLocaleString(); }

// Restrained palette. Colour means "a threshold was crossed", never
// decoration — if every widget is coloured, none of them signal anything.
const INK = '#0F172A';
const MUTED = '#64748B';
const GOOD = '#059669';
const WARN = '#D97706';
const BAD = '#DC2626';
const TEAL = '#06B6D4';

// ── Delivery band ─────────────────────────────────────────────────────
// The single most important read on the page: is the week's work booked,
// and is it being delivered? Booking health and delivery health are shown
// as two separate bars because they fail independently and get escalated
// to two different people.
function DeliveryBand({ slots, target, weekLabel, isPastWeek, wow, capacity }) {
  // Headline is in SCHEDULING units to match Pariox and the target; revenue
  // below converts to billable encounters. See classifyWeekSlots.
  const booked = slots.bookedVisits;
  const bookedPct = target > 0 ? Math.round((booked / target) * 100) : 0;
  const resolved = slots.completedVisits + slots.missedVisits + slots.cancelledVisits;
  const deliveredPct = resolved > 0 ? Math.round((slots.completedVisits / resolved) * 100) : null;

  const bookColor = bookedPct >= 95 ? '#34D399' : bookedPct >= 80 ? '#FBBF24' : '#F87171';
  const delColor = deliveredPct === null ? 'rgba(255,255,255,0.35)'
    : deliveredPct >= 92 ? '#34D399' : deliveredPct >= 85 ? '#FBBF24' : '#F87171';

  // Revenue uses ENCOUNTERS, not visits — a co-treat bills once. Multiplying
  // `booked` (a visit count) by BLENDED_RATE would overstate by ~12%.
  const bookedRevenue = slots.booked * BLENDED_RATE;
  const bookedRevPct = Math.round((bookedRevenue / REVENUE_TARGET) * 100);
  const lost = slots.missedVisits + slots.cancelledVisits;
  const lostRevenue = (slots.missed + slots.cancelled) * BLENDED_RATE;

  return (
    <div style={{ background: INK, borderRadius: 14, padding: '20px 24px', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Visit Delivery {'·'} {weekLabel}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
          Clinician capacity {fmtN(capacity)} visits/wk
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
        {/* Booking health */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 52, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: bookColor, lineHeight: 1 }}>
              {fmtN(booked)}
            </div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>
              booked of {fmtN(target)}
            </div>
            <div style={{ padding: '3px 9px', background: bookColor + '22', color: bookColor, borderRadius: 6, fontSize: 13, fontWeight: 800, fontFamily: 'DM Mono, monospace' }}>
              {bookedPct}%
            </div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 999, height: 8, marginTop: 12, overflow: 'hidden' }}>
            <div style={{ width: Math.min(100, bookedPct) + '%', height: '100%', background: bookColor, borderRadius: 999, transition: 'width 0.8s ease' }} />
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 8 }}>
            Worth <strong style={{ color: '#fff' }}>{fmt$(bookedRevenue)}</strong> if fully delivered
            {' '}({bookedRevPct}% of the {fmt$(REVENUE_TARGET)} target)
          </div>
        </div>

        {/* Delivery health */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 52, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: delColor, lineHeight: 1 }}>
              {deliveredPct === null ? '--' : deliveredPct + '%'}
            </div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>
              delivered
            </div>
            {wow && wow.deliveredPct !== null && deliveredPct !== null && (() => {
              const d = deliveredPct - wow.deliveredPct;
              const up = d >= 0;
              const c = up ? '#34D399' : '#F87171';
              return (
                <div title={'vs ' + wow.label} style={{ padding: '3px 9px', background: c + '22', color: c, borderRadius: 6, fontSize: 12, fontWeight: 800, fontFamily: 'DM Mono, monospace' }}>
                  {up ? '+' : ''}{d} pts vs prior
                </div>
              );
            })()}
          </div>
          <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 999, height: 8, marginTop: 12, overflow: 'hidden' }}>
            <div style={{ width: (deliveredPct === null ? 0 : deliveredPct) + '%', height: '100%', background: delColor, borderRadius: 999, transition: 'width 0.8s ease' }} />
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 8 }}>
            {fmtN(slots.completedVisits)} completed of {fmtN(resolved)} resolved so far
            {lost > 0 && (
              <> {'·'} <strong style={{ color: '#F87171' }}>{fmtN(lost)} lost</strong> ({fmt$(lostRevenue)})</>
            )}
          </div>
        </div>
      </div>

      {/* One-sentence read. Booking and delivery are diagnosed separately
          so the sentence names the actual failing system, not just a colour. */}
      <div style={{ marginTop: 16, padding: '11px 15px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>
        {bookedPct < 90 ? (
          <>
            <strong style={{ color: '#F87171' }}>Booking gap.</strong> {fmtN(Math.max(0, target - booked))} visits short of a full week
            {' '}(about {fmt$(Math.max(0, target - booked) * BLENDED_RATE)}). Scheduling and assignment own this, not the clinicians.
          </>
        ) : deliveredPct !== null && deliveredPct < 88 ? (
          <>
            <strong style={{ color: '#FBBF24' }}>Delivery gap.</strong> The week is booked at {bookedPct}%, but {100 - deliveredPct}% of
            {' '}resolved slots fell out ({fmtN(lost)} visits, {fmt$(lostRevenue)}). This is a clinician and same-day-recovery problem.
          </>
        ) : (
          <>
            <strong style={{ color: '#34D399' }}>On track.</strong> {bookedPct}% booked, {deliveredPct === null ? 'no' : deliveredPct + '%'} delivered
            {isPastWeek ? ' for the week.' : '. Remaining risk is the ' + fmtN(slots.scheduledVisits) + ' visits still to run.'}
          </>
        )}
      </div>
    </div>
  );
}

// ── Unresolved-slot warning ───────────────────────────────────────────
// RETRACTION (2026-07-21, same day): an earlier version of this component
// claimed ~30% of booked slots never resolved from the week of Jun 7
// onward, and framed it as a Pariox feed regression worth ~$68K/week.
// That was wrong. It was an artifact of dedupVisitsByLatestUpload leaving
// stale slots alive when a full-week Pariox snapshot dropped them. Under
// dedupVisitsByAuthoritativeBatch every finished week from May 24 to
// Jul 12 resolves to 0-2 unresolved slots. There is no feed regression.
//
// The component is kept because the underlying check is still worth
// running — a finished week SHOULD be fully resolved, and if that stops
// being true we want to see it. It simply no longer fires on our own bug.
// Threshold raised to 15% so normal end-of-week lag stays quiet.
function UnresolvedWarning({ prev, weekLabel }) {
  if (!prev || prev.booked === 0) return null;
  const pct = Math.round((prev.scheduled / prev.booked) * 100);
  if (pct < 15) return null;
  return (
    <div style={{ background: '#FFFBEB', border: `1px solid ${WARN}`, borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Data integrity
      </div>
      <div style={{ fontSize: 12, color: '#78350F', lineHeight: 1.5, flex: 1, minWidth: 260 }}>
        <strong>{fmtN(prev.scheduled)} of {fmtN(prev.booked)} slots ({pct}%) from {weekLabel} are still marked Scheduled</strong>
        {' '}with no outcome posted. That week is over, so these are either delivered visits Pariox never
        {' '}closed out ({fmt$(prev.scheduled * BLENDED_RATE)} of unrecognized revenue) or visits that
        {' '}never happened and were never marked. Worth asking whoever owns the Pariox export.
      </div>
    </div>
  );
}

// ── Metric widget ─────────────────────────────────────────────────────
// Used for both the visit row and the census row. One number, one owner,
// one risk line, one click. Nothing else earns the space.
function Widget({ label, value, sub, risk, owner, accent, tone, onClick, size = 'md' }) {
  const clickable = typeof onClick === 'function';
  const valueColor = tone === 'bad' ? BAD : tone === 'warn' ? WARN : tone === 'good' ? GOOD : INK;
  return (
    <div
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      onMouseEnter={clickable ? (e) => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(15,23,42,0.10)'; e.currentTarget.style.transform = 'translateY(-1px)'; } : undefined}
      onMouseLeave={clickable ? (e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; } : undefined}
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: size === 'lg' ? '18px 20px' : '14px 16px',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'transform 0.1s ease, box-shadow 0.15s ease',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {accent && <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 3, background: accent }} />}
      <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
        {label}
      </div>
      <div style={{ fontSize: size === 'lg' ? 40 : 30, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: valueColor, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: MUTED, marginTop: 6, lineHeight: 1.4 }}>{sub}</div>}
      {risk && (
        <div style={{ fontSize: 11, fontWeight: 700, color: BAD, background: '#FEF2F2', borderRadius: 5, padding: '4px 7px', marginTop: 8, lineHeight: 1.3 }}>
          {risk}
        </div>
      )}
      {owner && (
        <div style={{ fontSize: 10, color: MUTED, marginTop: 'auto', paddingTop: 8, fontWeight: 600 }}>
          {owner}
        </div>
      )}
    </div>
  );
}

// ── Section heading ───────────────────────────────────────────────────
function SectionHead({ title, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: INK, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{title}</div>
      {note && <div style={{ fontSize: 11, color: MUTED }}>{note}</div>}
    </div>
  );
}

// ── Needs You Today ───────────────────────────────────────────────────
// Carried over from v3 largely intact — it was the one part of the page
// that already answered "what do I do now". Hard cap of 5 retained.
function NeedsYouToday({ items, onAction }) {
  const top5 = (items || []).slice(0, 5);
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ background: BAD, color: '#fff', borderRadius: 5, padding: '2px 8px', fontSize: 10, fontWeight: 800, letterSpacing: '0.05em' }}>FOCUS</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: INK }}>Needs you today</span>
        </div>
        <span style={{ fontSize: 11, color: MUTED }}>
          {top5.length === 0 ? 'nothing critical' : `top ${top5.length} of ${items.length} open`}
        </span>
      </div>
      {top5.length === 0 ? (
        <div style={{ padding: '20px 16px', textAlign: 'center', color: GOOD, fontSize: 13, fontWeight: 600 }}>
          No critical issues. Spend the morning on growth, not triage.
        </div>
      ) : (
        <div>
          {top5.map(function (it, i) {
            const sev = it.severity || 'medium';
            const sevColor = sev === 'p1' ? BAD : sev === 'high' ? WARN : '#0EA5E9';
            const sevBg = sev === 'p1' ? '#FEF2F2' : sev === 'high' ? '#FEF3C7' : '#EFF6FF';
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, padding: '11px 16px', borderBottom: i < top5.length - 1 ? '1px solid var(--border)' : 'none', alignItems: 'center' }}>
                <span style={{ background: sevBg, color: sevColor, padding: '3px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', minWidth: 30, textAlign: 'center' }}>
                  {sev}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</div>
                  {it.detail && <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>{it.detail}</div>}
                </div>
                {it.actionLabel && (
                  <button
                    type="button"
                    onClick={function () { if (typeof onAction === 'function') onAction(it); }}
                    style={{ padding: '6px 12px', background: INK, color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {it.actionLabel}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────
export default function DirectorDashboard({ onNavigate }) {
  const go = (page, intent) => { if (typeof onNavigate === 'function') onNavigate(page, intent); };
  const [loading, setLoading] = useState(true);
  const [census, setCensus] = useState([]);
  const [visits, setVisits] = useState([]);
  const [prevVisits, setPrevVisits] = useState([]);
  const [authRenewals, setAuthRenewals] = useState([]);
  const [onHoldRecovery, setOnHoldRecovery] = useState([]);
  const [clinicians, setClinicians] = useState([]);
  const [coordinators, setCoordinators] = useState([]);
  const [statusLog, setStatusLog] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);

  const [weekOffset, setWeekOffset] = useState(function () {
    return readPersistedWeekOffset('directorCommand');
  });
  const [stateFilter, setStateFilter] = useState(function () {
    return readPersistedState('directorCommand', 'ALL');
  });

  const mapping = useStateMapping();
  const activeRegions = useMemo(function () {
    return getRegionsForState(stateFilter, mapping.stateToRegions);
  }, [stateFilter, mapping.stateToRegions]);

  const load = useCallback(async () => {
    const wk = getWeekRange(new Date(), weekOffset);
    const prevWk = getWeekRange(new Date(), weekOffset + 1);
    const thirtyDaysAgoIso = new Date(Date.now() - 30 * 86400000).toISOString();
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 86400000).toISOString();

    const isFiltered = stateFilter && stateFilter !== 'ALL' && activeRegions && activeRegions.length > 0;
    const applyRegion = function (q) { return isFiltered ? q.in('region', activeRegions) : q; };
    const applyCoords = function (q) { return isFiltered ? q.overlaps('regions', activeRegions) : q; };

    const [c, v, pv, ar, oh, cl, co, sl, al] = await Promise.all([
      fetchAllPages(applyRegion(supabase.from('census_data').select('patient_name,region,status,insurance,last_visit_date,days_since_last_visit,first_seen_date,inferred_frequency,overdue_threshold_days,days_overdue,status_changed_at,pipeline_assigned_to'))),
      fetchAllPages(applyRegion(supabase.from('visit_schedule_data').select('patient_name,staff_name,visit_date,status,event_type,region,uploaded_at').gte('visit_date', wk.startStr).lte('visit_date', wk.endStr))),
      fetchAllPages(applyRegion(supabase.from('visit_schedule_data').select('patient_name,staff_name,visit_date,status,event_type,region,uploaded_at').gte('visit_date', prevWk.startStr).lte('visit_date', prevWk.endStr))),
      fetchAllPages(applyRegion(supabase.from('auth_renewal_tasks').select('patient_name,region,priority,task_status,days_until_expiry,visits_remaining,expiry_date').not('task_status', 'in', '("approved","denied","closed")'))),
      fetchAllPages(applyRegion(supabase.from('on_hold_recovery').select('patient_name,region,hold_type,days_on_hold'))),
      fetchAllPages(applyRegion(supabase.from('clinicians').select('full_name,region,discipline,weekly_visit_target,is_active').eq('is_active', true))),
      fetchAllPages(applyCoords(supabase.from('coordinators').select('id,full_name,role,job_title,team,regions,is_active').eq('is_active', true))),
      fetchAllPages(applyRegion(supabase.from('census_status_log').select('patient_name,region,old_status,new_status,changed_at').gte('changed_at', thirtyDaysAgoIso))),
      fetchAllPages(supabase.from('coordinator_activity_log').select('coordinator_name,coordinator_role,action_type,created_at').gte('created_at', sevenDaysAgoIso)),
    ]);

    setCensus(c);
    setVisits(dedupVisitsByAuthoritativeBatch(v));
    setPrevVisits(dedupVisitsByAuthoritativeBatch(pv));
    setAuthRenewals(ar);
    setOnHoldRecovery(oh);
    setClinicians(cl);
    setCoordinators(co);
    setStatusLog(sl);
    setActivityLog(al);
    setLastRefresh(new Date());
    setLoading(false);
  }, [weekOffset, stateFilter, activeRegions]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable(
    ['census_data', 'visit_schedule_data', 'auth_renewal_tasks', 'on_hold_recovery', 'clinicians', 'coordinators', 'census_status_log', 'coordinator_activity_log'],
    load
  );

  // ── Census buckets — the nine live widgets ──────────────────────────
  const cb = useMemo(() => bucketCensus(census), [census]);

  // ── This week's slots ───────────────────────────────────────────────
  const slots = useMemo(() => classifyWeekSlots(visits), [visits]);

  const wow = useMemo(() => {
    if (!prevVisits || prevVisits.length === 0) return null;
    const p = classifyWeekSlots(prevVisits);
    const resolved = p.completed + p.missed + p.cancelled;
    return {
      ...p,
      // Delivery rate is measured over RESOLVED slots only. Using `booked` as
      // the denominator would silently fold the ~30% unresolved backlog into
      // the failure rate and make delivery look far worse than it is. See
      // UnresolvedWarning above — that backlog gets its own callout instead
      // of being smeared across this metric.
      deliveredPct: resolved > 0 ? Math.round((p.completed / resolved) * 100) : null,
      label: getWeekRange(new Date(), weekOffset + 1).label,
    };
  }, [prevVisits, weekOffset]);

  const metrics = useMemo(() => {
    const capacity = clinicians.reduce((s, c) => s + (c.weekly_visit_target || 0), 0);
    const urgentAuths = authRenewals.filter(a => a.priority === 'urgent');
    const highAuths = authRenewals.filter(a => a.priority === 'high');
    const onHoldOverdue = onHoldRecovery.filter(p => (p.days_on_hold || 0) > 21);

    // Team engagement — coordinators with no logged mutation in 2 days.
    const twoDaysAgoMs = Date.now() - 2 * 86400000;
    const recent = new Set();
    activityLog.forEach(a => {
      if (!a.coordinator_name) return;
      const t = a.created_at ? new Date(a.created_at).getTime() : 0;
      if (t >= twoDaysAgoMs) recent.add(a.coordinator_name);
    });
    const teamSize = coordinators.length;
    const teamActive = coordinators.filter(c => recent.has(c.full_name)).length;

    // Net census movement this week, from the status log. Census itself is
    // point-in-time so it cannot produce a delta on its own.
    const wk = getWeekRange(new Date(), weekOffset);
    const inWeek = (e) => {
      const t = e.changed_at ? new Date(e.changed_at).getTime() : 0;
      return t >= wk.start.getTime() && t <= wk.end.getTime();
    };
    const newActiveThisWk = statusLog.filter(e =>
      inWeek(e) && /active/i.test(e.new_status || '') && !/active/i.test(e.old_status || '')
    ).length;
    const dischargedThisWk = statusLog.filter(e =>
      inWeek(e) && /^discharge/i.test(e.new_status || '') && !/^discharge/i.test(e.old_status || '')
    ).length;

    return {
      capacity, urgentAuths, highAuths, onHoldOverdue,
      teamSize, teamActive, teamQuiet: Math.max(0, teamSize - teamActive),
      newActiveThisWk, dischargedThisWk,
    };
  }, [clinicians, authRenewals, onHoldRecovery, activityLog, coordinators, statusLog, weekOffset]);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Director Command" subtitle="Loading live data..." />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED }}>
        Pulling live operations data...
      </div>
    </div>
  );

  const m = metrics;
  const wk = getWeekRange(new Date(), weekOffset);
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const isPastWeek = weekOffset > 0;

  const activeBucket = cb.byKey.active || { count: 0, riskCount: 0 };
  const activeAuthBucket = cb.byKey.active_auth || { count: 0 };
  const treating = activeBucket.count + activeAuthBucket.count;

  // Total pipeline waiting to start care — the buckets that generate zero
  // revenue today but represent already-won demand.
  const pipelineKeys = ['soc_pending', 'eval_pending', 'auth_pending', 'waitlist'];
  const pipelineCount = pipelineKeys.reduce((s, k) => s + (cb.byKey[k] ? cb.byKey[k].count : 0), 0);
  const pipelineNeverSeen = pipelineKeys.reduce((s, k) => s + (cb.byKey[k] ? cb.byKey[k].riskCount : 0), 0);

  // ── Needs You Today ─────────────────────────────────────────────────
  const needsYouToday = (function () {
    const items = [];

    // A finished week should be fully resolved. Fires only above 15% so
    // ordinary end-of-week documentation lag stays quiet. NOTE: an earlier
    // build of this fired constantly on our own dedup bug -- see the
    // retraction on UnresolvedWarning above.
    if (wow && wow.booked > 0 && wow.scheduled / wow.booked >= 0.15) {
      items.push({
        severity: 'p1',
        score: 120,
        title: `${wow.scheduled} visits from ${wow.label} never got an outcome posted`,
        detail: `${Math.round((wow.scheduled / wow.booked) * 100)}% of that week unresolved ${'·'} ${fmt$(wow.scheduled * BLENDED_RATE)} unrecognized`,
        actionLabel: 'Visit schedule',
        target: 'visits',
      });
    }

    m.urgentAuths.slice(0, 5).forEach(a => {
      items.push({
        severity: 'p1',
        score: 100 - (a.days_until_expiry || 0),
        title: `Auth renewal expires in ${a.days_until_expiry}d -- ${a.patient_name}`,
        detail: `${a.visits_remaining} visits left ${'·'} Rgn ${a.region} ${'·'} ${fmt$((a.visits_remaining || 0) * BLENDED_RATE)} at risk`,
        actionLabel: 'Open auth',
        target: 'auth-renewals',
      });
    });

    // Pipeline patients on the roster with no visit ever booked. This is the
    // metric v3 tried to capture with `stuck`, but it read status_changed_at
    // which is null on ~95% of rows -- so it was evaluating 2 of 38 SOC
    // Pending patients. last_visit_date is fully populated.
    if (pipelineNeverSeen > 0) {
      items.push({
        severity: pipelineNeverSeen >= 30 ? 'p1' : 'high',
        score: 90 + Math.min(9, Math.floor(pipelineNeverSeen / 10)),
        title: `${pipelineNeverSeen} pipeline patients never seen, 14d+ on roster`,
        detail: `Accepted but never started ${'·'} ${fmt$(pipelineNeverSeen * BLENDED_RATE * 2)}/wk once converted`,
        actionLabel: 'Open census',
        target: 'census',
        intent: { status: 'soc_pending' },
      });
    }

    if (activeBucket.riskCount > 0) {
      items.push({
        severity: 'high',
        score: 80 + Math.min(15, Math.floor(activeBucket.riskCount / 10)),
        title: `${activeBucket.riskCount} active patients past their prescribed frequency`,
        detail: `${fmt$(activeBucket.riskCount * BLENDED_RATE * 2)}/wk idle ${'·'} sort census by Last Seen`,
        actionLabel: 'Open census',
        target: 'census',
        intent: { status: 'active', lastSeen: 'overdue' },
      });
    }

    // visit units for the headline count, encounter units for the dollars
    const lost = slots.missedVisits + slots.cancelledVisits;
    const lostRev = (slots.missed + slots.cancelled) * BLENDED_RATE;
    if (lost >= 25) {
      items.push({
        severity: 'high',
        score: 75 + Math.min(15, Math.floor(lost / 10)),
        title: `${lost} visits lost this week (${slots.missedVisits} missed, ${slots.cancelledVisits} cancelled)`,
        detail: `${fmtN(lostRev / BLENDED_RATE)} billable encounters ${'·'} ${fmt$(lostRev)} of booked work fell out`,
        actionLabel: 'Missed/cancelled',
        target: 'missed-cancelled',
      });
    }

    if (m.onHoldOverdue.length > 0) {
      items.push({
        severity: 'medium',
        score: 60 + Math.min(15, m.onHoldOverdue.length),
        title: `${m.onHoldOverdue.length} patients on hold over 21 days`,
        detail: 'Recovery call needed -- convert back to active or discharge.',
        actionLabel: 'On-hold',
        target: 'on-hold',
      });
    }

    if (m.teamQuiet >= 3) {
      items.push({
        severity: 'medium',
        score: 45 + m.teamQuiet,
        title: `${m.teamQuiet} of ${m.teamSize} coordinators quiet over 2 days`,
        detail: 'No mutations logged. Spot-check before standup.',
        actionLabel: 'Engagement',
        target: 'ops-dashboard',
      });
    }

    return items.sort((a, b) => b.score - a.score).slice(0, 5);
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--bg)' }}>
      <TopBar
        title="Director Command"
        subtitle={today}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <StateToggle value={stateFilter} onChange={setStateFilter} storageKey="directorCommand" stateToRegions={mapping.stateToRegions} />
            <WeekSelector value={weekOffset} onChange={setWeekOffset} storageKey="directorCommand" allowFuture={false} />
            {lastRefresh && <span style={{ fontSize: 10, color: MUTED }}>Updated {lastRefresh.toLocaleTimeString()}</span>}
            <button onClick={load} style={{ padding: '6px 14px', background: INK, color: '#fff', border: 'none', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              Refresh
            </button>
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* 1. DELIVERY BAND */}
        <DeliveryBand
          slots={slots}
          target={WEEKLY_VISIT_TARGET}
          weekLabel={wk.label}
          isPastWeek={isPastWeek}
          wow={wow}
          capacity={m.capacity}
        />

        {/* 1b. DATA INTEGRITY — silent unless a finished week is unresolved */}
        <UnresolvedWarning prev={wow} weekLabel={wow ? wow.label : ''} />

        {/* 2. VISITS THIS WEEK — four separate widgets */}
        <div>
          <SectionHead
            title="Visits this week"
            note={`${wk.label} (Sun-Sat) ${'·'} booked = completed + remaining + lost`}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            {/* Visit counts below are in SCHEDULING units (patient+date+staff),
                which is what Pariox and the ops team count and what Liam reads
                off the schedule. Revenue is computed from ENCOUNTERS
                (patient+date) because a co-treat bills once. See
                classifyWeekSlots in visitMath.js. */}
            <Widget
              label="Scheduled (booked)"
              value={fmtN(slots.bookedVisits)}
              sub={`of ${fmtN(WEEKLY_VISIT_TARGET)} target ${'·'} ${Math.round((slots.bookedVisits / WEEKLY_VISIT_TARGET) * 100)}% ${'·'} ${fmtN(slots.booked)} billable encounters`}
              owner="Scheduling / Assignment"
              accent={TEAL}
              tone={slots.bookedVisits >= WEEKLY_VISIT_TARGET * 0.95 ? 'good' : slots.bookedVisits >= WEEKLY_VISIT_TARGET * 0.8 ? 'warn' : 'bad'}
              onClick={() => go('visits')}
            />
            <Widget
              label="Completed so far"
              value={fmtN(slots.completedVisits)}
              // NOT "vs same point last week" -- prevVisits is the prior week
              // in FULL, so comparing a Tuesday's 104 against a finished
              // week's 601 would read as a 83% collapse. Labelled as a final
              // figure so the comparison is honest.
              sub={`${fmt$(slots.completed * BLENDED_RATE)} banked${wow ? ` ${'·'} prior wk finished at ${fmtN(wow.completed)}` : ''}`}
              owner="Clinical"
              accent={GOOD}
              tone="good"
              onClick={() => go('visits')}
            />
            <Widget
              label="Remaining to run"
              value={fmtN(slots.scheduledVisits)}
              sub={`${fmt$(slots.scheduled * BLENDED_RATE)} still deliverable${wow && wow.booked > 0 ? ` ${'·'} ~${Math.round((wow.completed / wow.booked) * 100)}% of booked converted last wk` : ''}`}
              owner="Clinical / ADs"
              accent="#0EA5E9"
              onClick={() => go('visits')}
            />
            <Widget
              label="Lost"
              value={fmtN(slots.missedVisits + slots.cancelledVisits)}
              sub={`${slots.missedVisits} missed ${'·'} ${slots.cancelledVisits} cancelled`}
              risk={(slots.missedVisits + slots.cancelledVisits) > 0 ? `${fmt$((slots.missed + slots.cancelled) * BLENDED_RATE)} fell out of the week` : null}
              owner="Care Coord / Clinical"
              accent={BAD}
              tone={(slots.missedVisits + slots.cancelledVisits) >= 25 ? 'bad' : undefined}
              onClick={() => go('missed-cancelled')}
            />
          </div>
        </div>

        {/* 3. CENSUS HEADLINE — active + total */}
        <div>
          <SectionHead
            title="Census"
            note={`live roster excludes ${fmtN(cb.discharged)} discharged and ${fmtN(cb.nonAdmit)} non-admit ${'·'} ${fmtN(cb.total)} all-time`}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
            <Widget
              size="lg"
              label="Active patients"
              value={fmtN(activeBucket.count)}
              sub={`${fmtN(treating)} receiving care incl. ${fmtN(activeAuthBucket.count)} auth-pending ${'·'} +${m.newActiveThisWk} new this wk`}
              risk={activeBucket.riskCount > 0 ? `${activeBucket.riskCount} past prescribed frequency (${fmt$(activeBucket.riskCount * BLENDED_RATE * 2)}/wk idle)` : null}
              owner="Clinical / ADs"
              accent={GOOD}
              onClick={() => go('census', { status: 'active' })}
            />
            <Widget
              size="lg"
              label="Total live roster"
              value={fmtN(cb.liveRoster)}
              sub={`every patient we can still act on ${'·'} ${fmtN(pipelineCount)} not yet in treatment`}
              risk={m.dischargedThisWk > 0 ? `${m.dischargedThisWk} discharged this week` : null}
              owner="All departments"
              accent={TEAL}
              onClick={() => go('census', { status: 'live_roster' })}
            />
          </div>
        </div>

        {/* 4. STATUS GRID — one widget per bucket, with its owning department */}
        <div>
          <SectionHead
            title="By status -- who owns it"
            note={`the ${cb.buckets.length} buckets below sum to the ${fmtN(cb.liveRoster)} live roster`}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(178px, 1fr))', gap: 12 }}>
            {cb.buckets.map(b => (
              <Widget
                key={b.key}
                label={b.label}
                value={fmtN(b.count)}
                sub={
                  b.subTypes && b.subTypes.length > 0
                    ? b.subTypes.map(s => `${s.count} ${s.label.toLowerCase()}`).join(' · ')
                    : (b.medianAge !== null ? `median ${b.medianAge}d on roster` : null)
                }
                risk={b.riskCount > 0 ? `${b.riskCount} ${b.riskLabel}` : null}
                owner={b.owner}
                accent={b.riskCount > 0 ? BAD : 'var(--border)'}
                tone={b.count === 0 ? undefined : (b.riskCount > 0 && b.riskCount / b.count >= 0.5 ? 'bad' : undefined)}
                onClick={() => go(b.nav.page, b.nav.intent)}
              />
            ))}
          </div>
          {/* Reconciliation guard. Renders only if Pariox introduces a status
              censusStatus.js does not model, so a new bucket can never quietly
              disappear from the roster total. */}
          {cb.unmapped.length > 0 && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: '#FEF3C7', border: `1px solid ${WARN}`, borderRadius: 8, fontSize: 12, color: '#78350F' }}>
              <strong>Unmapped status detected:</strong>{' '}
              {cb.unmapped.map(u => `${u.status} (${u.count})`).join(', ')}
              {' '}-- counted in the roster total but not in any widget above. Add it to LIVE_BUCKETS in src/lib/censusStatus.js.
            </div>
          )}
        </div>

        {/* 5. NEEDS YOU TODAY */}
        <NeedsYouToday
          items={needsYouToday}
          onAction={(it) => { if (it && it.target) go(it.target, it.intent); }}
        />

        {/* 6. DETAIL — weekly-review depth, folded away from the daily read */}
        <details style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <summary style={{ padding: '12px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: INK, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>
              Detail -- Manager Scorecards {'·'} Exception Feed
              <span style={{ fontSize: 10, fontWeight: 400, color: MUTED, marginLeft: 8 }}>for the weekly review, not the daily read</span>
            </span>
            <span style={{ fontSize: 10, color: MUTED }}>expand</span>
          </summary>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16, borderTop: '1px solid var(--border)' }}>
            <ManagerScorecards
              census={census}
              statusLog={statusLog}
              activityLog={activityLog}
              coordinators={coordinators}
              onScorecardClick={(sc) => {
                if (sc.regions === 'ALL') go('ops-dashboard');
                else if (sc.regions && sc.regions.length === 1) go('rm-dashboard', { region: sc.regions[0] });
                else go('rm-dashboard', { regions: sc.regions });
              }}
            />
            <ExceptionFeed
              census={census}
              activityLog={activityLog}
              coordinators={coordinators}
              onJumpTo={(target, intent) => go(target, intent)}
            />
          </div>
        </details>

      </div>
    </div>
  );
}
