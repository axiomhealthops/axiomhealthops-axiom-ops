// =====================================================================
// visitDedup.js
//
// Single source of truth for the per-(patient_name, visit_date)
// latest-uploaded_at dedup rule used by every reader of
// `visit_schedule_data`.
//
// WHY THIS EXISTS
// ---------------
// Pariox uploads visit data in rolling-window batches. Two failure modes
// happened in early June 2026 before this rule existed:
//
//  1. Ghost rows: when Pariox reassigns a slot from Crystal -> Brian
//     between uploads, our upsert key (patient,date,event,staff) creates
//     a NEW row for Brian without overwriting Crystal's. Crystal's row
//     stays in the DB as a ghost. Without dedup, both rows count as
//     visits, inflating revenue ~$89K YTD and over-counting 35/46
//     clinicians by ~25%.
//
//  2. Bad fix: the first attempt at a page-level filter used
//     "per visit_date, keep only rows from the latest batch". That was
//     too aggressive — when Pariox sent a 3-row partial update for
//     a date that previously had 30 rows, the partial became "the
//     latest batch for that date" and the filter silently nuked the
//     27 unchanged rows. Brian Espinola under-counted 19 vs Pariox's
//     true 22 because of this. System-wide ~11% under-count.
//
// THE CORRECT RULE
// ----------------
// For each (patient_name, visit_date) tuple, keep ONLY the row with the
// latest uploaded_at. This handles all three real cases:
//
//   a) Cross-staff reassignment (same patient/date, different staff,
//      different uploaded_at) → older clinician's row dropped, new one
//      wins. Correct: Pariox reassigned the visit.
//
//   b) Same-batch co-treat (same patient/date, different staff, SAME
//      uploaded_at) → both rows kept. Correct: two clinicians legitimately
//      treated the patient that day.
//
//   c) Partial-update upload (older batch's rows for a (patient,date)
//      the newer batch didn't touch) → older rows kept. Correct: the
//      newer partial upload simply didn't re-send them; they're still
//      valid per Pariox.
//
// USAGE
// -----
// Call dedupVisitsByLatestUpload(rows) right after fetching from
// visit_schedule_data, BEFORE any classifyVisits / dedupEncounters /
// revenue math. The select MUST include `patient_name`, `visit_date`,
// and `uploaded_at`. (Some pages historically didn't fetch
// `uploaded_at`; those have been updated as part of the 2026-06-06 sweep.)
//
// NOTE: dedupEncounters() in visitMath.js collapses multi-clinician rows
// for the SAME slot down to one encounter for revenue counting.
// dedupVisitsByLatestUpload() is a DIFFERENT pass that drops stale ghost
// rows BEFORE per-clinician math. Apply dedupVisitsByLatestUpload first.
// =====================================================================

/**
 * For each (patient_name, visit_date), keep only the row with the latest
 * uploaded_at. Ties (same uploaded_at, same patient, same date — typically
 * co-treats from the same batch) survive together.
 *
 * @param {Array<Object>} rows  rows from visit_schedule_data with at minimum
 *                              patient_name, visit_date, uploaded_at
 * @returns {Array<Object>}     filtered subset, ghosts dropped
 */
export function dedupVisitsByLatestUpload(rows) {
  if (!rows || rows.length === 0) return rows || [];

  // Pass 1: find the latest uploaded_at for each (patient_name, visit_date).
  const latestByKey = new Map();
  for (const r of rows) {
    if (!r) continue;
    const d = (r.visit_date + '').slice(0, 10);
    const key = (r.patient_name || '') + '||' + d;
    const up = r.uploaded_at || '';
    const prev = latestByKey.get(key);
    if (!prev || up > prev) latestByKey.set(key, up);
  }

  // Pass 2: keep only rows whose uploaded_at matches the latest for their
  // (patient, date). String comparison works because Postgres ISO timestamps
  // are lexicographically ordered.
  return rows.filter(function(r) {
    if (!r) return false;
    const d = (r.visit_date + '').slice(0, 10);
    const key = (r.patient_name || '') + '||' + d;
    return (r.uploaded_at || '') === latestByKey.get(key);
  });
}
