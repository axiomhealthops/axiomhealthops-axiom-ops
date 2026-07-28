// =====================================================================
// garmentSla.js
//
// The only place that decides how old a garment order is, which stage
// clock applies, and whether it has breached. Same rule as
// censusStatus.js / frequencyMath.js / garmentSheet.js: one
// implementation, asserted in `npm run check`, never re-derived at a
// call site.
//
// WHY THIS EXISTS
// ---------------
// GarmentTrackerPage used a single flat rule:
//
//     daysAgo(status_change_date || created_at) > 7   ->  "Stale"
//
// Measured against production on 2026-07-24 that flagged **217 of 217
// orders**. Every card on the board rendered with a red border, so the
// stale badge carried exactly zero information. Two separate causes:
//
//   1. All 217 rows were created by one bulk sheet import on 2026-06-16,
//      so `created_at` is the IMPORT date for every row, not the date
//      the order actually reached its current stage. A 3-day-old
//      approval and a 90-day-old one both read "38d in stage".
//   2. One threshold for five stages. A request awaiting PT/OT sign-off
//      for 8 days is a genuine problem; a vendor order in transit for 8
//      days is completely normal. Judging both at 7 days makes the fast
//      stages invisible and the slow stage permanently alarming.
//
// THE NULL-TIMESTAMP TRAP (measured 2026-07-24, all 217 orders)
// -------------------------------------------------------------
// `clinical_approval_date` and `final_approval_date` are **NULL on
// 217 of 217 rows**. The June import wrote the approval STATUSES but
// never the approval TIMESTAMPS. So for the 41 orders sitting in
// `ready_to_order`, the database does not know when they were approved
// — only that they were.
//
// This is the `census_data.status_changed_at` defect (CLAUDE.md, Census
// status) recurring on a new table, and it gets the same treatment:
// a fallback clock is used, but the result is tagged `isFloor` and MUST
// render as "38+ d", never as "38 d". A floor presented as a precise
// figure is a fabricated measurement — it would let someone report
// "average approval-to-order time is 38 days" when the true number is
// unknown and could be anything from 1 day to 38.
//
// Coverage of the preferred clock per stage, same measurement:
//   submitted      26/27  field_request_date          precise
//   auth_pending    0/0    clinical_approval_date      (no rows)
//   ready_to_order  0/41   final_approval_date         ALL floors
//   order_placed  138/138  order_placed_date           precise
//   delivered       0/0    delivery_date               (no rows)
//
// Orders created through the UI from now on populate these correctly,
// so `isFloor` shrinks on its own as the June import ages out. It is
// not a permanent state and must not be papered over in the meantime.
// =====================================================================

/**
 * Days allowed in each stage before the order is late.
 *
 * These are operating targets, not contractual SLAs — they exist to
 * rank a queue, not to grade anybody. Rationale per stage:
 *
 *   submitted       3   A PT/OT sign-off is a same-week decision. The
 *                       clinician who evaluated the patient already
 *                       knows the answer.
 *   auth_pending    7   Admin sign-off runs in parallel with the payer
 *                       auth, which is the genuinely slow part.
 *   ready_to_order  2   Nothing is blocking. The order is approved and
 *                       funded and just needs placing; this is the
 *                       stage where delay is pure lost time.
 *   order_placed   21   Vendor lead time. Sigvaris custom garments run
 *                       2-3 weeks, so this is a chase trigger rather
 *                       than a failure.
 *
 * `delivered` has no SLA — the view archives it 14 days after POD.
 */
export const STAGE_SLA_DAYS = {
  submitted: 3,
  auth_pending: 7,
  ready_to_order: 2,
  order_placed: 21,
};

/** Stages that are finished. Nothing here is ever late. */
export const TERMINAL_STAGES = ['delivered', 'archived', 'denied', 'cancelled'];

/** Stages where the work is ours and someone must act today. */
export const ACTIONABLE_STAGES = ['submitted', 'auth_pending', 'ready_to_order'];

/**
 * A date sanity floor. `garmentSheet.toDate()` converts Excel serials,
 * and a cell holding a plain number that was never a date converts to
 * something absurd — production carries one real example,
 * `order_placed_date = 1936-05-30` on "Taylor, Wanda". Anything before
 * this is treated as absent rather than as a 90-year-old order, which
 * would otherwise dominate every "oldest" sort and every average.
 */
export const MIN_PLAUSIBLE_DATE = '2020-01-01';

function isPlausible(d) {
  return typeof d === 'string' && d >= MIN_PLAUSIBLE_DATE;
}

/** Normalise a date or timestamp to a YYYY-MM-DD string, or null. */
function toDay(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && isPlausible(s) ? s : null;
}

/**
 * When did this order enter the stage it is in now?
 *
 * Returns `{ date, basis, isFloor }`. `basis` names the column the
 * answer came from so the UI can explain itself, and `isFloor` is true
 * whenever the preferred column was null and we fell back to something
 * that can only over-estimate the age (the order entered the stage at
 * some point AFTER the fallback date, never before).
 *
 * Callers MUST honour isFloor. See the header note.
 */
export function stageClock(o) {
  if (!o) return { date: null, basis: null, isFloor: false };

  // Preferred column first, then progressively weaker fallbacks. Each
  // fallback is a date the order provably existed by, so the age it
  // yields is an upper bound on the true time in stage.
  const chains = {
    submitted:      ['field_request_date', 'created_at'],
    auth_pending:   ['clinical_approval_date', 'status_change_date', 'field_request_date', 'created_at'],
    ready_to_order: ['final_approval_date', 'status_change_date', 'clinical_approval_date', 'field_request_date', 'created_at'],
    order_placed:   ['order_placed_date', 'status_change_date', 'created_at'],
    delivered:      ['delivery_date', 'created_at'],
    archived:       ['delivery_date', 'created_at'],
    denied:         ['final_approval_date', 'clinical_approval_date', 'status_change_date', 'created_at'],
    cancelled:      ['status_change_date', 'created_at'],
  };
  const chain = chains[o.stage] || ['created_at'];

  for (let i = 0; i < chain.length; i++) {
    const d = toDay(o[chain[i]]);
    if (d) return { date: d, basis: chain[i], isFloor: i > 0 };
  }
  return { date: null, basis: null, isFloor: false };
}

/** Whole days between a YYYY-MM-DD and `now`. Never negative. */
export function daysSince(day, now = new Date()) {
  if (!day) return null;
  const then = new Date(day + 'T00:00:00');
  if (isNaN(then.getTime())) return null;
  const ms = now.getTime() - then.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

/**
 * Full health read on one order.
 *
 * health is one of:
 *   'ok'       within target
 *   'at_risk'  at or past 80% of target — the window where a nudge
 *              still prevents the breach, which is the only point at
 *              which a dashboard changes an outcome
 *   'breached' past target
 *   'done'     terminal stage, no clock
 *   'unknown'  no usable date at all — surfaced, never defaulted to ok
 */
export function orderHealth(o, now = new Date()) {
  const stage = o?.stage || 'submitted';
  const { date, basis, isFloor } = stageClock(o);
  const ageDays = daysSince(date, now);

  if (TERMINAL_STAGES.includes(stage)) {
    return { stage, sla: null, ageDays, basis, isFloor, health: 'done', overBy: null };
  }
  const sla = STAGE_SLA_DAYS[stage] ?? null;
  if (ageDays == null || sla == null) {
    return { stage, sla, ageDays, basis, isFloor, health: 'unknown', overBy: null };
  }
  const health = ageDays > sla ? 'breached' : ageDays >= sla * 0.8 ? 'at_risk' : 'ok';
  return { stage, sla, ageDays, basis, isFloor, health, overBy: Math.max(0, ageDays - sla) };
}

/** "4 d" / "38+ d" / "-". Floors are ALWAYS marked. */
export function formatAge(h) {
  if (!h || h.ageDays == null) return '-';
  return `${h.ageDays}${h.isFloor ? '+' : ''} d`;
}

const HEALTH_COLORS = {
  ok:       { fg: '#065F46', bg: '#ECFDF5', border: '#10B981', label: 'On track' },
  at_risk:  { fg: '#9C5700', bg: '#FFFBEB', border: '#F59E0B', label: 'At risk'  },
  breached: { fg: '#9C0006', bg: '#FEF2F2', border: '#DC2626', label: 'Late'     },
  done:     { fg: '#475569', bg: '#F1F5F9', border: '#94A3B8', label: 'Closed'   },
  unknown:  { fg: '#475569', bg: '#F8FAFC', border: '#CBD5E1', label: 'No date'  },
};
export function healthStyle(health) {
  return HEALTH_COLORS[health] || HEALTH_COLORS.unknown;
}

/**
 * Board-level rollup. Every figure a tile renders comes from here so
 * the tiles and the columns can never disagree.
 *
 * `openValue` deliberately counts only orders that are approved but not
 * yet delivered — money committed and not yet received. Pending
 * requests are excluded because nobody has agreed to spend that money
 * yet, and delivered orders are excluded because they have landed.
 */
export function summarize(orders, now = new Date()) {
  const s = {
    total: 0,
    byStage: {},
    needsAction: 0,       // stages where the next move is ours
    breached: 0,
    atRisk: 0,
    unknownClock: 0,
    breachedValue: 0,
    openValue: 0,
    inTransit: 0,
    inTransitNoEta: 0,    // placed, no vendor ETA -> uncchaseable
    noVendor: 0,          // placed, no vendor recorded
    unlinked: 0,          // patient_name never matched census
    deliveredMtd: 0,
    spendMtd: 0,
    oldest: null,
  };
  if (!Array.isArray(orders)) return s;

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  for (const o of orders) {
    s.total++;
    const stage = o.stage || 'submitted';
    s.byStage[stage] = (s.byStage[stage] || 0) + 1;

    const h = orderHealth(o, now);
    const cost = Number(o.garment_cost) || 0;

    if (ACTIONABLE_STAGES.includes(stage)) s.needsAction++;
    if (h.health === 'breached') { s.breached++; s.breachedValue += cost; }
    if (h.health === 'at_risk') s.atRisk++;
    if (h.health === 'unknown') s.unknownClock++;

    if (['ready_to_order', 'order_placed'].includes(stage)) s.openValue += cost;
    if (stage === 'order_placed') {
      s.inTransit++;
      if (!toDay(o.vendor_eta_date)) s.inTransitNoEta++;
      if (!o.vendor) s.noVendor++;
    }
    if (!o.patient_id) s.unlinked++;

    const del = toDay(o.delivery_date);
    if (del && del >= monthStart) { s.deliveredMtd++; s.spendMtd += cost; }

    if (!TERMINAL_STAGES.includes(stage) && h.ageDays != null) {
      if (!s.oldest || h.ageDays > s.oldest.ageDays) s.oldest = { order: o, ageDays: h.ageDays, isFloor: h.isFloor };
    }
  }
  s.breachedValue = Math.round(s.breachedValue * 100) / 100;
  s.openValue = Math.round(s.openValue * 100) / 100;
  s.spendMtd = Math.round(s.spendMtd * 100) / 100;
  return s;
}

/**
 * Sort key for a work queue: worst first.
 *
 * Breached before at-risk before ok, then oldest first inside each
 * band. Floors sort by their floor value — an order whose age is only
 * a lower bound is at LEAST that late, so ranking it by the floor is
 * conservative in the right direction.
 */
const HEALTH_RANK = { breached: 0, at_risk: 1, unknown: 2, ok: 3, done: 4 };
export function byUrgency(now = new Date()) {
  return (a, b) => {
    const ha = orderHealth(a, now), hb = orderHealth(b, now);
    const r = (HEALTH_RANK[ha.health] ?? 9) - (HEALTH_RANK[hb.health] ?? 9);
    if (r !== 0) return r;
    return (hb.ageDays ?? -1) - (ha.ageDays ?? -1);
  };
}
