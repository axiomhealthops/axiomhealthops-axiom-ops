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
/**
 * Rule C — per visit_date, keep only the latest batch that is a FULL SNAPSHOT
 * for that date. Added 2026-07-21.
 *
 * WHY dedupVisitsByLatestUpload IS NOT ENOUGH
 * ------------------------------------------
 * Pariox sends a full re-export of the current week most mornings. The
 * 2026-07-21 11:24 batch carried 760 rows covering Jul 19-25 inclusive —
 * completed, missed AND scheduled. It is a snapshot, not a delta.
 *
 * dedupVisitsByLatestUpload keys on (patient_name, visit_date). When a
 * snapshot DROPS a slot — visit cancelled, rescheduled, patient discharged —
 * there is no newer row for that key, so the stale row wins by default and
 * lives forever. Measured on 2026-07-21: 935 surviving slots vs 667 in the
 * authoritative snapshot. 268 phantom slots, 40% inflation.
 *
 * Across nine weeks this artifact produced a fake "~30% of booked slots never
 * resolve" pattern that looked exactly like a Pariox feed regression starting
 * the week of Jun 7. It was not. Under this rule those weeks resolve to
 * 0 unresolved slots. The bug was ours.
 *
 * WHY NOT SIMPLY "LATEST BATCH PER DATE"
 * --------------------------------------
 * That is the naive fix this file already documents as harmful: a small
 * partial upload (the Jul 20 batches were 53 and 64 rows) would become "the
 * latest batch for that date" and delete the ~150 rows a real snapshot had
 * posted. That is the Brian Espinola 19-vs-22 undercount.
 *
 * Verified across 2026-05-24 .. 2026-07-25: every completed week resolves to
 * 0-2 unresolved slots, and weekly completed counts land within 1-2% of the
 * old rule (the old rule ran ~72 visits / ~$16.5K high over six weeks).
 *
 * HOW A SNAPSHOT IS TOLD APART FROM A DELTA
 * -----------------------------------------
 * By the batch's TOTAL size, not its per-date size. In the Jul 19-25 window
 * the batches were 760, 510, 141, 90, 66, 64, 53, 52, 41, 9, 8, 2 rows —
 * snapshots and deltas differ by ~5x, so the split is unambiguous. An
 * earlier attempt compared per-DATE row counts against the max ever seen
 * for that date, which breaks the moment a day legitimately shrinks (lots
 * of cancellations): the newer, correct snapshot fell below the bar and the
 * stale bloated batch won. Batch totals do not have that failure mode.
 *
 * Then, per date: the latest snapshot covering that date establishes the
 * authoritative set, and any LATER delta rows are layered on top so a small
 * partial can still add or correct a visit without ever emptying the day.
 * dedupVisitsByLatestUpload then resolves per-key conflicts between the two.
 *
 * THIS IS A READER-SIDE WORKAROUND, NOT THE REAL FIX
 * --------------------------------------------------
 * The real fix belongs in ingest: when a Pariox export covers a date range,
 * that range should be REPLACED, not upserted into. Until then every reader
 * has to re-derive the truth from batch shapes, which is inference, not
 * fact. Flagged to Liam 2026-07-21.
 *
 * @param {Array<Object>} rows rows with patient_name, visit_date, uploaded_at
 * @returns {Array<Object>} rows from the authoritative batch for each date
 */
const SNAPSHOT_RATIO = 0.5;

export function dedupVisitsByAuthoritativeBatch(rows) {
  if (!rows || rows.length === 0) return rows || [];

  // Pass 1: total rows per batch, and which dates each batch touches.
  const batchTotals = new Map();     // uploaded_at -> total rows
  const datesByBatch = new Map();    // uploaded_at -> Set(date)
  for (const r of rows) {
    if (!r) continue;
    const up = r.uploaded_at || '';
    const d = (r.visit_date + '').slice(0, 10);
    batchTotals.set(up, (batchTotals.get(up) || 0) + 1);
    let s = datesByBatch.get(up);
    if (!s) { s = new Set(); datesByBatch.set(up, s); }
    s.add(d);
  }

  // Pass 2: which batches are full snapshots?
  let maxTotal = 0;
  for (const n of batchTotals.values()) if (n > maxTotal) maxTotal = n;
  const bar = maxTotal * SNAPSHOT_RATIO;
  const snapshots = [];
  for (const [up, n] of batchTotals) if (n >= bar) snapshots.push(up);

  // Pass 3: per date, the latest snapshot that covers it.
  const chosen = new Map();          // date -> uploaded_at of governing snapshot
  for (const up of snapshots) {
    for (const d of datesByBatch.get(up)) {
      const prev = chosen.get(d);
      if (prev === undefined || up > prev) chosen.set(d, up);
    }
  }

  // Pass 4: keep the governing snapshot's rows plus anything uploaded after
  // it. Dates no snapshot ever covered keep everything.
  const kept = rows.filter(function (r) {
    if (!r) return false;
    const d = (r.visit_date + '').slice(0, 10);
    const gov = chosen.get(d);
    if (gov === undefined) return true;
    const up = r.uploaded_at || '';
    return up >= gov;
  });

  // Pass 5: collapse snapshot-vs-later-delta duplicates for the same slot.
  return dedupVisitsByLatestUpload(kept);
}

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
