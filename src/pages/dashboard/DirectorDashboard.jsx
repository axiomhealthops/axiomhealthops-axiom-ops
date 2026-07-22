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
import { staffKey, visitStaffName, reconcileRoster, flagOverCap } from '../../lib/staffMatch';
import { isCompleted } from '../../lib/visitMath';
import { getWeekRange, toDateStr, formatShortDate } from '../../lib/dateUtils';
import { bucketCensus, normalizeStatus } from '../../lib/censusStatus';
import { summarizeCoverage } from '../../lib/frequencyMath';

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
//
// 2026-07-22 — THE DELIVERY HEADLINE WAS MEASURING THE WRONG THING.
// It read `completed / (completed + missed + cancelled)` and labelled the
// result "delivered". On Wed Jul 22 that printed **81% delivered** next to
// "729 booked of 1,000" while only 248 visits had actually run. Three
// separate defects, all fixed here:
//
//  1. WRONG QUESTION. That ratio is a SHOW RATE over slots that already
//     resolved — it says nothing about how much of the week is done. The
//     honest completion figure was 248/729 = 34%. Reading "81% delivered"
//     mid-week tells the director the week is nearly banked when two
//     thirds of it has not happened yet.
//  2. DENOMINATORS DID NOT RECONCILE. `booked` EXCLUDES cancelled slots
//     (see classifyWeekSlots: booked = completed + missed + scheduled) but
//     `resolved` INCLUDED them. So 305 was not a subset of 729 — the left
//     and right halves of this band were measuring different universes and
//     no arithmetic on screen tied out.
//  3. NO TIME CONTEXT. Any percentage read on a Wednesday is unreadable
//     without knowing what share of the week's slots were even due yet.
//
// The fix: the headline is now completion against the SAME booked figure
// the left half shows, so 248 of 729 reconciles on sight. The old ratio
// survives as `keptPct` — restricted to elapsed days and labelled "kept
// rate" — because it is a real quality signal, just not the headline.
// Pace and a landing projection give the mid-week read its meaning.
function DeliveryBand({ slots, elapsed, todaySlots, elapsedThrough, target, weekLabel, isPastWeek, wow, capacity, roster }) {
  // Headline is in SCHEDULING units to match Pariox and the target; revenue
  // below converts to billable encounters. See classifyWeekSlots.
  const booked = slots.bookedVisits;
  const bookedPct = target > 0 ? Math.round((booked / target) * 100) : 0;

  // ── Delivery: completion against BOOKED, not against resolved ────────
  const completed = slots.completedVisits;
  const remaining = slots.scheduledVisits;
  const missed = slots.missedVisits;
  const cancelled = slots.cancelledVisits;
  const lost = missed + cancelled;
  // completed + missed + remaining === booked, exactly. Cancelled sits
  // outside that identity because classifyWeekSlots removes it from booked.
  const weekPct = booked > 0 ? Math.round((completed / booked) * 100) : null;

  // ── Pace: what share of the booked week fell on COMPLETED days? ──────
  // `elapsed` is the same classification restricted to days strictly before
  // today, so on a past week it equals the full week and pace collapses to
  // zero — correct, a finished week has no pace left to run.
  const dueBooked = elapsed ? elapsed.bookedVisits : 0;
  const duePct = booked > 0 ? Math.round((dueBooked / booked) * 100) : 0;
  const paceGap = weekPct === null ? null : weekPct - duePct;
  // Today is in progress, not late. Counted, never graded.
  const onToday = todaySlots ? todaySlots.scheduledVisits : 0;
  const doneToday = todaySlots ? todaySlots.completedVisits : 0;

  // ── Kept rate: the old metric, honestly scoped and honestly named ────
  // Denominator is completed-day slots that actually resolved. Slots from a
  // finished day still sitting on Scheduled are documentation lag, not
  // delivery failure, so they are called out separately rather than being
  // smeared into this number.
  const dueResolved = elapsed ? (elapsed.completedVisits + elapsed.missedVisits + elapsed.cancelledVisits) : 0;
  const keptPct = dueResolved > 0 ? Math.round((elapsed.completedVisits / dueResolved) * 100) : null;
  const stillOpen = elapsed ? elapsed.scheduledVisits : 0;

  // ── Projection: where the week lands if the kept rate holds ──────────
  const projected = (keptPct === null || isPastWeek)
    ? null
    : Math.round(completed + remaining * (keptPct / 100));
  const projectedPct = projected === null || target === 0 ? null : Math.round((projected / target) * 100);
  // Revenue projection runs on ENCOUNTERS, never visits. See CLAUDE.md.
  const projectedRev = projected === null
    ? null
    : (slots.completed + slots.scheduled * (keptPct / 100)) * BLENDED_RATE;

  const bookColor = bookedPct >= 95 ? '#34D399' : bookedPct >= 80 ? '#FBBF24' : '#F87171';
  // Colour the delivery headline by PACE, not by the raw percentage — a
  // 34% on Wednesday morning is healthy and must not render red.
  const delColor = paceGap === null ? 'rgba(255,255,255,0.35)'
    : paceGap >= -3 ? '#34D399' : paceGap >= -10 ? '#FBBF24' : '#F87171';

  // Revenue uses ENCOUNTERS, not visits — a co-treat bills once. Multiplying
  // `booked` (a visit count) by BLENDED_RATE would overstate by ~12%.
  const bookedRevenue = slots.booked * BLENDED_RATE;
  const bookedRevPct = Math.round((bookedRevenue / REVENUE_TARGET) * 100);
  const lostRevenue = (slots.missed + slots.cancelled) * BLENDED_RATE;

  return (
    <div style={{ background: INK, borderRadius: 14, padding: '20px 24px', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Visit Delivery {'·'} {weekLabel}
        </div>
        {/* Capacity is the roster figure MINUS clinicians who delivered
            nothing last week. The raw sum overstated it by 325 visits/wk
            on 2026-07-12, which is the difference between the 1,000
            target reading as 82% of capacity and as 112% of it. */}
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }} title={roster ? `${fmtN(roster.claimedCapacity)} claimed on the roster; ${fmtN(roster.phantomCapacity)} belongs to clinicians who delivered nothing last week` : undefined}>
          {roster && roster.phantomCapacity > 0 ? (
            <>
              Working capacity <strong style={{ color: 'rgba(255,255,255,0.75)' }}>{fmtN(roster.workingCapacity)}</strong> visits/wk
              {' '}{'·'} <span style={{ color: '#FBBF24' }}>{fmtN(roster.phantomCapacity)} unworked</span>
            </>
          ) : (
            <>Clinician capacity {fmtN(capacity)} visits/wk</>
          )}
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
              {weekPct === null ? '--' : weekPct + '%'}
            </div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>
              of booked delivered
            </div>
            {/* Pace, not week-over-week. Comparing a Wednesday against a
                finished week is the exact trap the old chip fell into. */}
            {!isPastWeek && paceGap !== null && (
              <div
                title={`${duePct}% of the booked week fell on days that have finished`}
                style={{ padding: '3px 9px', background: delColor + '22', color: delColor, borderRadius: 6, fontSize: 12, fontWeight: 800, fontFamily: 'DM Mono, monospace' }}
              >
                {paceGap >= -3 ? 'on pace' : `${Math.abs(paceGap)} pts behind pace`}
              </div>
            )}
          </div>

          {/* Stacked bar over the booked week. The three segments sum to
              booked exactly, so the bar and the numbers under it agree. */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.08)', borderRadius: 999, height: 8, marginTop: 12, overflow: 'hidden' }}>
            <div title={`${fmtN(completed)} completed`} style={{ width: (booked > 0 ? (completed / booked) * 100 : 0) + '%', height: '100%', background: '#34D399', transition: 'width 0.8s ease' }} />
            <div title={`${fmtN(missed)} missed`} style={{ width: (booked > 0 ? (missed / booked) * 100 : 0) + '%', height: '100%', background: '#F87171', transition: 'width 0.8s ease' }} />
            <div title={`${fmtN(remaining)} still to run`} style={{ width: (booked > 0 ? (remaining / booked) * 100 : 0) + '%', height: '100%', background: 'rgba(255,255,255,0.22)', transition: 'width 0.8s ease' }} />
          </div>

          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 8, lineHeight: 1.5 }}>
            <strong style={{ color: '#fff' }}>{fmtN(completed)}</strong> completed
            {' '}{'·'} {fmtN(remaining)} still to run {'·'} {fmtN(booked)} booked
            {lost > 0 && (
              <> {'·'} <strong style={{ color: '#F87171' }}>{fmtN(lost)} lost</strong> ({fmtN(missed)} missed, {fmtN(cancelled)} cancelled {'·'} {fmt$(lostRevenue)})</>
            )}
            {keptPct !== null && (
              <div style={{ marginTop: 3 }}>
                {isPastWeek ? 'Across the week' : `Through ${elapsedThrough}`}:{' '}
                <strong style={{ color: '#fff' }}>{keptPct}% kept</strong> of the
                {' '}{fmtN(dueResolved)} slots that resolved
                {stillOpen > 0 && (
                  <> {'·'} <strong style={{ color: '#FBBF24' }}>{fmtN(stillOpen)} from a finished day never closed out</strong></>
                )}
                {wow && wow.keptPct !== null && (() => {
                  const d = keptPct - wow.keptPct;
                  const c = d >= 0 ? '#34D399' : '#F87171';
                  return <> {'·'} <span style={{ color: c, fontWeight: 700 }}>{d >= 0 ? '+' : ''}{d} pts vs {wow.label}</span></>;
                })()}
              </div>
            )}
            {!isPastWeek && (onToday > 0 || doneToday > 0) && (
              <div style={{ marginTop: 3 }}>
                Today: <strong style={{ color: '#fff' }}>{fmtN(doneToday)}</strong> done
                {' '}{'·'} {fmtN(onToday)} still on the schedule (in progress, not late)
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Landing projection. Current week only — a finished week has
          nothing left to project and the row would just restate itself. */}
      {projected !== null && remaining > 0 && (
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Tracking to
          </span>
          <strong style={{ color: '#fff', fontFamily: 'DM Mono, monospace', fontSize: 15 }}>
            {fmtN(projected)} visits
          </strong>
          <span>
            ({projectedPct}% of the {fmtN(target)} target {'·'} {fmt$(projectedRev)})
            {' '}if the {keptPct}% kept rate holds across the {fmtN(remaining)} remaining
          </span>
        </div>
      )}

      {/* One-sentence read. Booking and delivery are diagnosed separately
          so the sentence names the actual failing system, not just a colour. */}
      <div style={{ marginTop: 16, padding: '11px 15px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>
        {/* Booking, delivery and documentation fail independently and get
            escalated to three different people, so the sentence names the
            failing system rather than just restating a colour. Ordered by
            who gets called first. */}
        {bookedPct < 90 ? (
          <>
            <strong style={{ color: '#F87171' }}>Booking gap.</strong> {fmtN(Math.max(0, target - booked))} visits short of a full week
            {' '}(about {fmt$(Math.max(0, target - booked) * BLENDED_RATE)}). Scheduling and assignment own this, not the clinicians.
          </>
        ) : keptPct !== null && keptPct < 88 ? (
          <>
            <strong style={{ color: '#FBBF24' }}>Delivery gap.</strong> The week is booked at {bookedPct}%, but {100 - keptPct}% of
            {' '}the slots resolved so far fell out ({fmtN(lost)} visits, {fmt$(lostRevenue)}). This is a clinician and same-day-recovery problem.
          </>
        ) : stillOpen >= 25 ? (
          <>
            <strong style={{ color: '#FBBF24' }}>Documentation lag.</strong> Booking and delivery are both healthy, but {fmtN(stillOpen)} slots
            {' '}dated before today still have no outcome posted. Until they close, this week is under-reported, not under-delivered.
          </>
        ) : (
          <>
            <strong style={{ color: '#34D399' }}>On track.</strong> {bookedPct}% booked
            {keptPct !== null && <>, {keptPct}% of resolved slots kept</>}
            {isPastWeek
              ? `. ${weekPct === null ? 'No' : weekPct + '%'} of the booked week was delivered.`
              : `. ${fmtN(remaining)} visits still to run carry the rest of the week.`}
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

// ── Coverage band ─────────────────────────────────────────────────────
// Answers the question the booking gap raises but cannot itself answer:
// WHERE would the missing visits come from?
//
// The funnel above says the week is 271 visits short of the 1,000 target
// and hands that to Scheduling. What it cannot say is whether those 271
// visits exist to be booked. They do. Measured 2026-07-12: 258 active
// patients carry a prescribed cadence of once a week or more, they were
// owed 482 visits, and 257 were delivered — a 256-visit shortfall against
// care that is already authorised, already staffed and already on the
// roster. That is 94% of the gap to target, sitting in patients we have.
//
// The framing matters for who gets called. A booking gap of unknown
// origin is a marketing and intake problem. A booking gap that is almost
// entirely unscheduled prescribed care is a scheduling problem, and the
// patients are enumerable by name today.
function CoverageBand({ coverage, bookingGap, onGo }) {
  if (!coverage || coverage.withExpectation === 0) return null;
  const short = coverage.shortfallVisits;
  if (short === 0) return null;
  // Encounter units for money — a co-treat bills once. See CLAUDE.md.
  const dollars = (short / 1.12) * BLENDED_RATE;
  const coversPct = bookingGap > 0 ? Math.round((short / bookingGap) * 100) : null;

  return (
    <div>
      <SectionHead
        title="Prescribed care not delivered"
        note={`active patients on a weekly-or-greater cadence ${'·'} measured on the last full week`}
      />
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 40, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: BAD, lineHeight: 1 }}>
            {fmtN(short)}
          </div>
          <div style={{ fontSize: 15, color: MUTED, fontWeight: 600 }}>
            visits/wk prescribed but not delivered
          </div>
          <div style={{ padding: '3px 9px', background: '#FEF2F2', color: BAD, borderRadius: 6, fontSize: 13, fontWeight: 800, fontFamily: 'DM Mono, monospace' }}>
            {fmt$(dollars)}/wk
          </div>
        </div>

        {coversPct !== null && (
          <div style={{ marginTop: 12, padding: '11px 14px', background: '#F8FAFC', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: INK, lineHeight: 1.55 }}>
            That is <strong>{coversPct}% of the {fmtN(bookingGap)}-visit gap</strong> to the weekly target,
            {' '}already authorised and already on the active roster. Closing it is a scheduling
            {' '}problem, not a referral problem.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', gap: 10, marginTop: 14 }}>
          {[
            { k: 'Patients short', v: fmtN(coverage.short), s: `of ${fmtN(coverage.withExpectation)} with a weekly cadence`, c: BAD },
            { k: 'Expected', v: fmtN(coverage.expectedVisits), s: 'visits/wk prescribed', c: INK },
            { k: 'Delivered', v: fmtN(coverage.deliveredVisits), s: `${Math.round((coverage.deliveredVisits / coverage.expectedVisits) * 100)}% of prescribed`, c: GOOD },
            { k: 'Fully covered', v: fmtN(coverage.fullyCovered), s: 'got every prescribed visit', c: GOOD },
          ].map(t => (
            <div key={t.k}>
              <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.k}</div>
              <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: t.c, lineHeight: 1.2 }}>{t.v}</div>
              <div style={{ fontSize: 10.5, color: MUTED }}>{t.s}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: MUTED }}>
          <button
            type="button"
            onClick={() => onGo('census', { status: 'active', lastSeen: 'overdue' })}
            style={{ padding: '6px 13px', background: INK, color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
          >
            Open the patients
          </button>
          {/* Excluded groups are stated, never silently folded in. An
              inflated gap built on assumed cadences would be worse than
              a smaller true one. */}
          <span>
            Excludes {fmtN(coverage.sparserThanWeekly)} on a monthly-or-sparser cadence
            {' '}and {fmtN(coverage.asNeeded)} prn {'·'} neither is owed a visit this week.
          </span>
        </div>

        {coverage.unparseable > 0 && (
          <div style={{ marginTop: 10, padding: '9px 12px', background: '#FFFBEB', border: `1px solid ${WARN}`, borderRadius: 7, fontSize: 11.5, color: '#78350F', lineHeight: 1.55 }}>
            <strong>{fmtN(coverage.unparseable)} active patients have a frequency nothing can read</strong>
            {' '}({Array.from(coverage.unparseableValues.entries()).slice(0, 6).map(([v, n]) => `${v} (${n})`).join(', ')}).
            {' '}They are excluded from the shortfall above rather than assumed, so the real number is
            {' '}this or higher. Fixing those records is the cheapest way to sharpen it.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Roster reconciliation ─────────────────────────────────────────────
// Lives in Detail, not the daily read: this is a roster-hygiene question
// for the weekly review, not something to act on at 7am. It is on the
// page at all because every capacity, productivity and hiring decision
// divides by a number that was never checked against who actually works.
function RosterReconciliation({ roster, weekLabel }) {
  if (!roster || roster.activeCount === 0) return null;
  // Reserve staff are expected, not an exception — they must not keep the
  // panel permanently in a "needs attention" state.
  const clean = roster.phantomCapacity === 0
    && roster.scheduleOnly.length === 0
    && roster.heuristicMatches.length === 0;

  const Row = ({ label, items, color, render }) => items.length === 0 ? null : (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color, marginBottom: 4 }}>
        {label} <span style={{ color: MUTED, fontWeight: 600 }}>({items.length})</span>
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.6 }}>
        {items.slice(0, 12).map((it, i) => (
          <span key={i}>
            {i > 0 && <span style={{ color: 'var(--border)' }}> {'·'} </span>}
            {render(it)}
          </span>
        ))}
        {items.length > 12 && <span> {'·'} +{fmtN(items.length - 12)} more</span>}
      </div>
    </div>
  );

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', background: 'var(--card-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: INK, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Roster vs schedule
        </div>
        <div style={{ fontSize: 11, color: MUTED }}>measured on {weekLabel} {'·'} the last full week</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 12 }}>
        {[
          { k: 'Contracted capacity', v: fmtN(roster.committedCapacity), s: 'full-time + part-time targets', c: MUTED },
          { k: 'Delivered', v: fmtN(roster.committedDelivered), s: `${roster.committedUtilizationPct === null ? '--' : roster.committedUtilizationPct + '%'} of contracted`, c: GOOD },
          { k: 'Assignment gap', v: fmtN(roster.assignmentGap), s: `visits/wk to book ${'·'} ${fmt$((roster.assignmentGap / 1.12) * BLENDED_RATE)}`, c: roster.assignmentGap > 0 ? BAD : GOOD },
          { k: 'Unworked', v: fmtN(roster.phantomCapacity), s: `${roster.rosterOnly.length} delivered nothing`, c: roster.phantomCapacity > 0 ? BAD : GOOD },
        ].map(t => (
          <div key={t.k}>
            <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.k}</div>
            <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: t.c, lineHeight: 1.2 }}>{t.v}</div>
            <div style={{ fontSize: 10.5, color: MUTED }}>{t.s}</div>
          </div>
        ))}
      </div>

      {clean ? (
        <div style={{ marginTop: 12, fontSize: 12, color: GOOD, fontWeight: 600 }}>
          Roster and schedule agree. Capacity can be taken at face value.
        </div>
      ) : (
        <>
          {/* Ordered by how cheap the fix is. A nickname is a one-field
              edit that immediately corrects two numbers at once. */}
          <Row
            label="Matched by guess -- add to the clinician's aliases"
            items={roster.heuristicMatches} color={WARN}
            render={a => `${a.rosterName} = "${a.scheduleName}" (${a.visits})`}
          />
          <Row
            label="Delivered visits but not on the active roster"
            items={roster.scheduleOnly} color={BAD}
            render={s => `${s.name} (${s.visits})`}
          />
          <Row
            label="Contracted but under target -- visits to assign"
            items={roster.underTarget} color={BAD}
            render={u => `${u.name} ${u.delivered}/${u.target}${u.isNegotiatedMinimum ? ' min' : ''} (-${u.short})`}
          />
          {/* Reserve is not a problem to fix — it is shown so the gap
              above is readable. Without it, someone reading "1,060
              contracted" would wonder where the ADOCs went. */}
          <Row
            label="Reserve -- non-treating, schedule only once contracted staff are at target"
            items={roster.reserve} color={MUTED}
            render={r => `${r.name}${r.delivered > 0 ? ` (covered ${r.delivered})` : ''}`}
          />
          <Row
            label="On the roster, delivered nothing"
            items={roster.rosterOnly} color={BAD}
            render={r => `${r.name}${r.target ? ` (${r.target})` : ''}`}
          />
          <div style={{ marginTop: 12, padding: '9px 12px', background: '#FFFBEB', border: `1px solid ${WARN}`, borderRadius: 7, fontSize: 11.5, color: '#78350F', lineHeight: 1.6 }}>
            Until these reconcile, utilization and productivity percentages on every
            page divide by a capacity figure that includes {fmtN(roster.phantomCapacity)} visits/wk
            nobody delivered{roster.unrosteredVisits > 0 && <>, and exclude {fmtN(roster.unrosteredVisits)} visits that were delivered by people with no roster row</>}.
          </div>
        </>
      )}
    </div>
  );
}

// ── Visit funnel ──────────────────────────────────────────────────────
// Replaces the four free-standing "Visits this week" widgets (2026-07-22).
//
// Those widgets restated booked / completed / remaining / lost — the same
// four numbers the delivery band above already prints — with no arithmetic
// tying them together. Two consequences: a full screen of vertical space
// spent on a repeat, and no way to see WHERE the week is being lost. A
// director reading "729 booked" and "248 completed" as unrelated tiles has
// to do the subtraction in their head to find the 271-visit booking gap,
// which is the single biggest number on the page.
//
// The funnel makes the subtraction explicit and hangs an owner off each
// stage, so the read is "who do I call about this drop" rather than "what
// is this number". Stage order follows the money: capacity we never booked,
// then booked work that did or did not happen.
function VisitFunnel({ slots, target, onGo }) {
  const booked = slots.bookedVisits;
  const completed = slots.completedVisits;
  const remaining = slots.scheduledVisits;
  const missed = slots.missedVisits;
  const cancelled = slots.cancelledVisits;
  const bookingGap = Math.max(0, target - booked);

  // Revenue always in ENCOUNTER units. The four booked stages already have
  // an encounter-unit twin on `slots`, but the booking gap does not — the
  // target (1,000) is a VISIT figure, and multiplying a visit count by
  // BLENDED_RATE overstates by ~12% because a co-treat bills once. Scale it
  // by this week's own visit-to-encounter ratio instead. See CLAUDE.md.
  const encPerVisit = booked > 0 ? slots.booked / booked : 1;
  const stages = [
    {
      key: 'gap', label: 'Never booked', value: bookingGap, accent: bookingGap > 0 ? BAD : GOOD,
      money: bookingGap * encPerVisit * BLENDED_RATE, owner: 'Scheduling / Assignment',
      note: `${Math.round((booked / target) * 100)}% of target on the calendar`,
      target: 'visits',
    },
    {
      key: 'completed', label: 'Delivered', value: completed, accent: GOOD,
      money: slots.completed * BLENDED_RATE, owner: 'Clinical',
      note: booked > 0 ? `${Math.round((completed / booked) * 100)}% of booked` : null,
      target: 'visits',
    },
    {
      key: 'remaining', label: 'Still to run', value: remaining, accent: '#0EA5E9',
      money: slots.scheduled * BLENDED_RATE, owner: 'Clinical / ADs',
      note: 'the rest of the week', target: 'visits',
    },
    {
      key: 'missed', label: 'Missed', value: missed, accent: missed > 0 ? BAD : GOOD,
      money: slots.missed * BLENDED_RATE, owner: 'Care Coord / Clinical',
      note: 'no-show, same-day recovery', target: 'missed-cancelled',
    },
    {
      key: 'cancelled', label: 'Cancelled', value: cancelled, accent: cancelled > 0 ? WARN : GOOD,
      money: slots.cancelled * BLENDED_RATE, owner: 'Care Coord',
      note: 'removed from the week', target: 'missed-cancelled',
    },
  ];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))`, gap: 10 }}>
        {stages.map(s => (
          <div
            key={s.key}
            onClick={() => onGo(s.target)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGo(s.target); } }}
            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(15,23,42,0.10)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
            style={{
              background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10,
              padding: '12px 14px', cursor: 'pointer', position: 'relative', overflow: 'hidden',
              transition: 'box-shadow 0.15s ease', display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 3, background: s.accent }} />
            <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {s.label}
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: INK, lineHeight: 1.1, marginTop: 4 }}>
              {fmtN(s.value)}
            </div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
              {fmt$(s.money)}{s.note ? ` ${'·'} ${s.note}` : ''}
            </div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 'auto', paddingTop: 7, fontWeight: 600 }}>
              {s.owner}
            </div>
          </div>
        ))}
      </div>

      {/* The reconciling line. Every number above appears here in one
          equation, so the page can be checked for internal consistency at
          a glance instead of on a calculator. */}
      <div style={{ marginTop: 10, padding: '9px 13px', background: '#F8FAFC', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11.5, color: MUTED, lineHeight: 1.6 }}>
        <strong style={{ color: INK }}>{fmtN(target)}</strong> target
        {' '}{'-'} <strong style={{ color: INK }}>{fmtN(bookingGap)}</strong> never booked
        {' '}{'='} <strong style={{ color: INK }}>{fmtN(booked)}</strong> booked
        {' '}{'='} <strong style={{ color: GOOD }}>{fmtN(completed)}</strong> delivered
        {' '}{'+'} <strong style={{ color: INK }}>{fmtN(remaining)}</strong> still to run
        {' '}{'+'} <strong style={{ color: BAD }}>{fmtN(missed)}</strong> missed.
        {cancelled > 0 && (
          <> {' '}A further <strong style={{ color: WARN }}>{fmtN(cancelled)}</strong> were cancelled and are no longer counted as booked.</>
        )}
      </div>
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
      // `aliases` is required for roster reconciliation — it is the only
      // tier that catches drift a surname heuristic cannot ("Marlene
      // Ortega" <- "Marlene Olea"). Omitting it silently downgrades every
      // maintained pairing back to a guess. See staffMatch.js.
      // employment_type / is_treating / weekly_visit_cap / is_agency drive
      // the three assignment tiers and the over-cap alert;
      // weekly_visit_target_override marks a negotiated minimum;
      // employment_review_ack_at demotes a flag already being worked.
      // Omitting any of them silently changes what the page reports.
      fetchAllPages(applyRegion(supabase.from('clinicians').select('full_name,region,discipline,weekly_visit_target,weekly_visit_target_override,weekly_visit_cap,employment_type,is_treating,is_agency,job_description,employment_review_ack_at,is_active,aliases').eq('is_active', true))),
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

  // Same classification, restricted to COMPLETED DAYS — strictly before
  // today. This is what makes a mid-week percentage readable: without it
  // there is no way to tell "34% done on Wednesday" (healthy) from "34%
  // done on Saturday" (a disaster).
  //
  // STRICTLY BEFORE, not "on or before". Measured on Wed 2026-07-22 at
  // 7:21am: Mon and Tue were fully resolved (0 slots left on Scheduled),
  // while today carried 148 scheduled and 0 completed simply because the
  // day had not started. Including today made the page read "25 pts behind
  // pace" and "148 past-dated with no outcome posted" — both pure artifacts
  // of the clock. A day in progress cannot be graded; it gets its own
  // counter instead. Cost of this rule is that a finished day is not
  // credited until the next calendar day, which under-reports rather than
  // over-reports. That is the right direction to be wrong in.
  //
  // toDateStr is local-time — do NOT swap in toISOString(), which rolls
  // over after 8pm Eastern and would pull tomorrow's slots into today.
  const elapsed = useMemo(() => {
    const todayStr = toDateStr(new Date());
    return classifyWeekSlots(
      visits.filter(v => v && (v.visit_date + '').slice(0, 10) < todayStr)
    );
  }, [visits]);

  // Today's slots, graded separately — in progress, not late.
  const todaySlots = useMemo(() => {
    const todayStr = toDateStr(new Date());
    return classifyWeekSlots(
      visits.filter(v => v && (v.visit_date + '').slice(0, 10) === todayStr)
    );
  }, [visits]);

  const wow = useMemo(() => {
    if (!prevVisits || prevVisits.length === 0) return null;
    const p = classifyWeekSlots(prevVisits);
    const resolved = p.completedVisits + p.missedVisits + p.cancelledVisits;
    return {
      ...p,
      // Kept rate is measured over RESOLVED slots only. Using `booked` as the
      // denominator would silently fold any unresolved backlog into the
      // failure rate and make delivery look far worse than it is. See
      // UnresolvedWarning above — that backlog gets its own callout instead
      // of being smeared across this metric.
      //
      // Renamed from `deliveredPct` 2026-07-22: it never measured how much
      // was delivered, and the old name is what let it get printed as the
      // headline for two weeks. Visit units, to match the band it feeds.
      keptPct: resolved > 0 ? Math.round((p.completedVisits / resolved) * 100) : null,
      label: getWeekRange(new Date(), weekOffset + 1).label,
    };
  }, [prevVisits, weekOffset]);

  // ── Roster reconciliation ───────────────────────────────────────────
  // Measured on the PRIOR FULL WEEK, never the current one: a Wednesday
  // has only a third of its visits posted, so reconciling against it
  // would report most of the roster as idle every Monday morning.
  //
  // Reconciled rather than summed because the raw sum is not a capacity
  // figure. On 2026-07-12, 21 of 67 active clinicians carried 325
  // visits/wk of target and never appeared on the schedule — two of them
  // ADs who manage rather than treat, six last seen between March and
  // June, and two (Abiola/Abi Balogun, Nicholas/Nick DeCandia) who WERE
  // working under a nickname the roster does not carry. See staffMatch.js.
  const roster = useMemo(() => {
    const deliveredBy = new Map();
    const seen = new Set();
    for (const v of prevVisits || []) {
      if (!isCompleted(v)) continue;
      const name = staffKey(visitStaffName(v));
      if (!name) continue;
      // One visit per (staff, patient, date) — a co-treat is two visits,
      // one for each clinician, which is exactly what a capacity target
      // is denominated in.
      const slot = name + '||' + (v.patient_name || '') + '||' + (v.visit_date + '').slice(0, 10);
      if (seen.has(slot)) continue;
      seen.add(slot);
      deliveredBy.set(name, (deliveredBy.get(name) || 0) + 1);
    }
    return reconcileRoster(clinicians, deliveredBy);
  }, [clinicians, prevVisits]);

  // ── Per-diem overuse ────────────────────────────────────────────────
  // Per diem is for irregular, low-volume cover, not for running a
  // standing caseload without a contract. Liam 2026-07-22: flag anyone
  // over 10 visits in 2+ CONSECUTIVE weeks so he can move them onto a
  // part-time contract. Needs a multi-week window, so it loads its own
  // slice rather than reusing this week's or last week's visits.
  const [perDiemWeeks, setPerDiemWeeks] = useState({ counts: new Map(), weeks: [] });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const LOOKBACK = 6;
      const weeks = [];
      for (let i = LOOKBACK; i >= 1; i--) weeks.push(getWeekRange(new Date(), i));
      const from = weeks[0].startStr;
      const to = weeks[weeks.length - 1].endStr;
      const rows = await fetchAllPages(
        supabase.from('visit_schedule_data')
          .select('patient_name,staff_name,staff_name_normalized,visit_date,status,event_type,uploaded_at')
          .gte('visit_date', from).lte('visit_date', to)
      );
      if (cancelled) return;
      const live = dedupVisitsByAuthoritativeBatch(rows);
      // staffKey -> (weekStartStr -> distinct patient-days)
      const counts = new Map();
      const seen = new Set();
      for (const v of live) {
        if (!isCompleted(v)) continue;
        const d = (v.visit_date + '').slice(0, 10);
        const wkObj = weeks.find(w => d >= w.startStr && d <= w.endStr);
        if (!wkObj) continue;
        const s = staffKey(visitStaffName(v));
        if (!s) continue;
        const slot = s + '||' + (v.patient_name || '') + '||' + d;
        if (seen.has(slot)) continue;
        seen.add(slot);
        let m = counts.get(s);
        if (!m) { m = new Map(); counts.set(s, m); }
        m.set(wkObj.startStr, (m.get(wkObj.startStr) || 0) + 1);
      }
      setPerDiemWeeks({ counts, weeks: weeks.map(w => w.startStr) });
    })();
    return () => { cancelled = true; };
  }, [weekOffset, stateFilter]);

  const overCapFlags = useMemo(
    () => flagOverCap(clinicians, perDiemWeeks.counts, perDiemWeeks.weeks),
    [clinicians, perDiemWeeks]
  );

  // ── Coverage: prescribed cadence vs delivered ───────────────────────
  // Measured on the prior FULL week for the same reason the roster is:
  // a Wednesday would report almost every patient as short.
  const coverage = useMemo(() => {
    const deliveredByPatient = new Map();
    const seen = new Set();
    for (const v of prevVisits || []) {
      if (!isCompleted(v)) continue;
      const p = (v.patient_name || '').toLowerCase().trim();
      if (!p) continue;
      // Distinct DAYS, not rows — a co-treat is one delivered visit
      // against a prescribed cadence, not two.
      const day = p + '||' + (v.visit_date + '').slice(0, 10);
      if (seen.has(day)) continue;
      seen.add(day);
      deliveredByPatient.set(p, (deliveredByPatient.get(p) || 0) + 1);
    }
    const actives = (census || []).filter(c => {
      const s = normalizeStatus(c.status);
      return /^active/i.test(s || '');
    });
    return summarizeCoverage(actives.map(c => ({
      frequency: c.inferred_frequency,
      delivered: deliveredByPatient.get((c.patient_name || '').toLowerCase().trim()) || 0,
    })));
  }, [census, prevVisits]);

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
  // Last day the pace read covers. On a Sunday this points at last week, and
  // `elapsed` is correctly empty — keptPct goes null and the line hides.
  const elapsedThrough = (function () {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return formatShortDate(y);
  })();

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

    // Sustained volume above a ceiling. Three different problems wearing
    // the same shape, so the wording and the recommended action follow
    // the reason rather than assuming everyone is a per-diem contractor.
    // All three are Liam's decision, which is why they are pushed here
    // instead of left in a panel for someone to stumble on.
    overCapFlags.forEach(f => {
      const wk = `${f.consecutiveWeeks} straight weeks`;
      const copy = f.reason === 'capped-role'
        ? {
            title: `${f.name} is over the ${f.cap}-visit cap on their role -- ${f.average}/wk for ${wk}`,
            detail: `${f.jobDescription || 'Capped role'} ${'·'} peak ${f.peak} ${'·'} should only treat when necessary`,
          }
        : f.reason === 'agency'
        ? {
            title: `${f.name} is agency staff averaging ${f.average} visits/wk for ${wk}`,
            detail: `Peak ${f.peak} ${'·'} Rgn ${f.region || '--'} ${'·'} a standing caseload billed through an agency ${'·'} renegotiate or hire direct`,
          }
        : {
            title: `${f.name} is per diem but averaging ${f.average} visits/wk for ${wk}`,
            detail: `Peak ${f.peak} ${'·'} Rgn ${f.region || '--'} ${'·'} a standing caseload on a per-diem contract ${'·'} move to ${f.suggestedType}`,
          };
      // Acknowledged means someone is on it: demoted, never hidden. Once
      // the acknowledgement goes stale it comes back LOUDER than a fresh
      // flag, because a stalled commitment is worse than an unseen one.
      if (f.ackWentStale) {
        items.push({
          severity: 'high',
          score: 95,
          title: `${f.name}: staffing review acknowledged ${f.ackAgeDays} days ago and still open`,
          detail: `${copy.detail} ${'·'} still ${f.average}/wk ${'·'} nothing has changed since it was picked up`,
          actionLabel: 'Staff directory',
          target: 'staff',
        });
        return;
      }
      items.push({
        severity: f.acknowledged ? 'medium' : (f.consecutiveWeeks >= 4 ? 'high' : 'medium'),
        score: f.acknowledged ? 30 : 70 + Math.min(20, f.consecutiveWeeks * 3),
        title: f.acknowledged ? `${copy.title} -- in progress` : copy.title,
        detail: f.acknowledged
          ? `${copy.detail} ${'·'} acknowledged ${f.ackAgeDays === 0 ? 'today' : `${f.ackAgeDays}d ago`}`
          : copy.detail,
        actionLabel: 'Staff directory',
        target: 'staff',
      });
    });

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
          elapsed={elapsed}
          todaySlots={todaySlots}
          elapsedThrough={elapsedThrough}
          target={WEEKLY_VISIT_TARGET}
          weekLabel={wk.label}
          isPastWeek={isPastWeek}
          wow={wow}
          capacity={m.capacity}
          roster={roster}
        />

        {/* 1b. DATA INTEGRITY — silent unless a finished week is unresolved */}
        <UnresolvedWarning prev={wow} weekLabel={wow ? wow.label : ''} />

        {/* 2. NEEDS YOU TODAY — lifted above the census reference data
             (2026-07-22). It was buried under two grids of status widgets,
             so the only actionable block on the page sat below a full
             screen of numbers nobody clicks. Pulse, then action, then
             reference. */}
        <NeedsYouToday
          items={needsYouToday}
          onAction={(it) => { if (it && it.target) go(it.target, it.intent); }}
        />

        {/* 3. WHERE THE WEEK GOES — funnel, replaces the four widgets */}
        <div>
          <SectionHead
            title="Where the week goes"
            note={`${wk.label} (Sun-Sat) ${'·'} visit units ${'·'} ${fmtN(slots.booked)} billable encounters booked`}
          />
          {/* Visit counts are in SCHEDULING units (patient+date+staff), which
              is what Pariox and the ops team count and what Liam reads off
              the schedule. Revenue is computed from ENCOUNTERS (patient+date)
              because a co-treat bills once. See classifyWeekSlots. */}
          <VisitFunnel slots={slots} target={WEEKLY_VISIT_TARGET} onGo={go} />
        </div>

        {/* 3b. WHERE THE MISSING VISITS ARE. Sits directly under the
             funnel because it answers the question the funnel's booking
             gap raises: those visits already exist, in patients we have. */}
        <CoverageBand
          coverage={coverage}
          bookingGap={Math.max(0, WEEKLY_VISIT_TARGET - slots.bookedVisits)}
          onGo={go}
        />

        {/* 4. CENSUS HEADLINE — active + total */}
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

        {/* 5. STATUS GRID — one widget per bucket, with its owning department */}
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

        {/* 6. DETAIL — weekly-review depth, folded away from the daily read */}
        <details style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <summary style={{ padding: '12px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: INK, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>
              Detail -- Roster vs Schedule {'·'} Manager Scorecards {'·'} Exception Feed
              <span style={{ fontSize: 10, fontWeight: 400, color: MUTED, marginLeft: 8 }}>for the weekly review, not the daily read</span>
            </span>
            <span style={{ fontSize: 10, color: MUTED }}>expand</span>
          </summary>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16, borderTop: '1px solid var(--border)' }}>
            <RosterReconciliation roster={roster} weekLabel={wow ? wow.label : 'the prior week'} />
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
