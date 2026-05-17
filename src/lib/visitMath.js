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
