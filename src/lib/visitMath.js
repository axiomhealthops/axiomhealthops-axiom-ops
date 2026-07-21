// =====================================================================
// visitMath.js
//
// Single source of truth for visit revenue math, cancellation detection,
// and encounter deduplication. Created 2026-05-17 after we discovered the
// Executive Report had drifted to $185/visit (vs Director's $230) and was
// counting Pariox-style cancelled-marked-completed visits as billable.
//
// IMPORTANT: Pariox's quirks this module handles:
//   1. Cancelled visits often have status="Completed" AND event_type=
//      "Cancelled Treatment". You MUST check event_type, not just status.
//   2. Attempted visits have event_type="Attempted Visit" — not billable.
//   3. Multiple clinician rows for the same patient on the same date (e.g.
//      PT + PTA co-treat) should count as ONE encounter for revenue math
//      but stay separate for per-clinician productivity.
//
// All pages doing weekly revenue / visit-count math should import from
// here. Other Pariox-tied pages (DirectorDashboard, ExecutiveReport,
// ReportsExportPage, OperationsManagerDashboard) have been migrated.
// =====================================================================

// Blended Medicare/Commercial rate per encounter. Single source of truth
// — was previously hardcoded in 3+ files with values $185, $230, etc.
// Update HERE if Liam decides to revise.
export const BLENDED_RATE = 230;

// Weekly revenue target the company is driving toward
export const WEEKLY_REVENUE_TARGET = 200000;

// Capacity / target benchmarks (per-week)
export const WEEKLY_VISIT_CAPACITY = 1175;
export const WEEKLY_VISIT_TARGET   = 1000;

// ─── Visit classification ──────────────────────────────────────────────
// All four predicates take the full visit row object (with status +
// event_type fields). They're case-insensitive and null-safe.

/** True if this visit was cancelled (regardless of how Pariox flagged it). */
export function isCancelled(v) {
  if (!v) return false;
  return /cancel/i.test(v.event_type || '') || /cancel/i.test(v.status || '');
}

/** True if this visit was attempted but not completed (Pariox: "Attempted Visit"). */
export function isAttempted(v) {
  if (!v) return false;
  return /attempted/i.test(v.event_type || '');
}

/** True if this visit was a no-show / missed. Excludes cancellations. */
export function isMissed(v) {
  if (!v) return false;
  return /missed/i.test(v.status || '') && !isCancelled(v);
}

/** True if this visit was an evaluation visit. */
export function isEval(v) {
  if (!v) return false;
  return /eval/i.test(v.event_type || '');
}

/**
 * True if this slot is still on the calendar and has not yet resolved —
 * i.e. it is booked work that hasn't happened. Excludes cancellations,
 * because Pariox emits status="Scheduled" + event_type="Cancelled
 * Treatment" for same-week cancels (5 such rows in the week of 2026-07-19).
 * Same class of trap as isCompleted — check event_type, not status alone.
 */
export function isScheduled(v) {
  if (!v) return false;
  return /scheduled/i.test(v.status || '') && !isCancelled(v) && !isAttempted(v);
}

/**
 * True if this is a billable completed encounter. CRITICAL: must exclude
 * cancelled-as-completed and attempted, because Pariox marks them
 * status="Completed" too. This is the function that gets the math right.
 */
export function isCompleted(v) {
  if (!v) return false;
  return /completed/i.test(v.status || '') && !isCancelled(v) && !isAttempted(v);
}

// ─── Encounter deduplication ──────────────────────────────────────────
/**
 * Collapse multiple clinician-rows for the same patient on the same date
 * into a single encounter. Use this when computing revenue or encounter
 * counts — NOT for per-clinician productivity (which legitimately wants
 * each clinician's row counted).
 *
 * @param {Array} rows — array of visit rows with patient_name + visit_date
 * @returns {Array} subset of input rows, first row for each unique encounter
 */
export function dedupEncounters(rows) {
  if (!rows || rows.length === 0) return [];
  const seen = new Set();
  return rows.filter(v => {
    const key = `${(v.patient_name || '').toLowerCase().trim()}||${v.visit_date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Aggregation helpers ──────────────────────────────────────────────
/**
 * Given a list of visits, return {completed, cancelled, missed} counts
 * with cancellations excluded from completed (and deduped for billing).
 */
export function classifyVisits(rows) {
  if (!rows) return { completed: 0, cancelled: 0, missed: 0, attempted: 0, total: 0 };
  const completed = dedupEncounters(rows.filter(isCompleted)).length;
  const cancelled = dedupEncounters(rows.filter(isCancelled)).length;
  const missed    = dedupEncounters(rows.filter(isMissed)).length;
  const attempted = rows.filter(isAttempted).length;
  return {
    completed,
    cancelled,
    missed,
    attempted,
    total: completed + cancelled + missed,
  };
}

/** Estimated revenue from a list of completed (already-deduped) encounters. */
export function estimateRevenue(completedCount, rate = BLENDED_RATE) {
  return (completedCount || 0) * rate;
}

// ─── Slot-level week classification ───────────────────────────────────
/**
 * Collapse a week of visit rows into one outcome per (patient, date) SLOT
 * and count each outcome. Added 2026-07-21 for Director Command.
 *
 * WHY THIS IS DIFFERENT FROM classifyVisits()
 * -------------------------------------------
 * classifyVisits() dedups each class independently, so a slot with both a
 * completed row and a leftover scheduled row is counted once as completed
 * AND once as scheduled. That is fine when you only read `.completed`,
 * but it makes the four counts non-additive — you cannot say
 * "booked = completed + missed + scheduled" from its output.
 *
 * This function assigns each slot exactly ONE outcome, so the counts are
 * mutually exclusive and sum to `booked + cancelled`. That property is what
 * lets Director Command state "935 booked, 104 done, 800 to go" and have
 * the three numbers actually reconcile on screen.
 *
 * Outcome precedence per slot: completed > missed > cancelled > scheduled.
 * A slot that has any completed row was delivered, whatever else Pariox
 * also wrote for it.
 *
 * IMPORTANT: pass rows through dedupVisitsByLatestUpload() FIRST to drop
 * ghost rows. See src/lib/visitDedup.js.
 *
 * TWO UNITS, AND THEY ARE NOT INTERCHANGEABLE (clarified 2026-07-21)
 * -----------------------------------------------------------------
 * A co-treat — PT and PTA on the same patient the same day — is TWO visits
 * on the schedule but ONE billable encounter. Pariox and the ops team count
 * the former; revenue counts the latter. Quoting one number in the other
 * unit is a ~12% error (749 vs 657 in the week of 2026-07-19), which is
 * exactly how Director Command came to show 924 when Liam's schedule said
 * 764. So this returns both, explicitly named:
 *
 *   *Visits   — (patient, date, staff) rows. The scheduling unit. Use for
 *               "how many visits are booked", capacity and productivity.
 *   (bare)    — (patient, date) encounters. The billing unit. Use for
 *               revenue: encounters * BLENDED_RATE. Never multiply the
 *               visit count by the rate.
 *
 * @param {Array<Object>} rows visit_schedule_data rows for a single week
 * @returns {{completed:number, missed:number, cancelled:number,
 *            scheduled:number, booked:number, slots:number,
 *            completedVisits:number, missedVisits:number,
 *            cancelledVisits:number, scheduledVisits:number,
 *            bookedVisits:number, visitRows:number}}
 *          booked = completed + missed + scheduled (cancelled excluded —
 *          a cancelled slot is not deliverable work).
 */
export function classifyWeekSlots(rows) {
  const empty = {
    completed: 0, missed: 0, cancelled: 0, scheduled: 0, booked: 0, slots: 0,
    completedVisits: 0, missedVisits: 0, cancelledVisits: 0, scheduledVisits: 0,
    bookedVisits: 0, visitRows: 0,
  };
  if (!rows || rows.length === 0) return empty;

  // rank: lower wins
  function rank(v) {
    if (isCompleted(v)) return 0;
    if (isMissed(v)) return 1;
    if (isCancelled(v)) return 2;
    if (isScheduled(v)) return 3;
    return 4; // attempted / unrecognized — tracked as a slot, no outcome
  }

  // Per slot: winning outcome + the distinct clinicians on it.
  const bySlot = new Map();
  for (const v of rows) {
    if (!v) continue;
    const key = (v.patient_name || '').toLowerCase().trim() + '||' + (v.visit_date + '').slice(0, 10);
    const r = rank(v);
    let e = bySlot.get(key);
    if (!e) { e = { r, staff: new Set() }; bySlot.set(key, e); }
    else if (r < e.r) e.r = r;
    e.staff.add((v.staff_name || '').toLowerCase().trim());
  }

  const out = { ...empty, slots: bySlot.size };
  for (const e of bySlot.values()) {
    const n = e.staff.size || 1;
    out.visitRows += n;
    if (e.r === 0) { out.completed++; out.completedVisits += n; }
    else if (e.r === 1) { out.missed++; out.missedVisits += n; }
    else if (e.r === 2) { out.cancelled++; out.cancelledVisits += n; }
    else if (e.r === 3) { out.scheduled++; out.scheduledVisits += n; }
  }
  out.booked = out.completed + out.missed + out.scheduled;
  out.bookedVisits = out.completedVisits + out.missedVisits + out.scheduledVisits;
  return out;
}
