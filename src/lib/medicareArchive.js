// =====================================================================
// medicareArchive.js
//
// Rules for archiving never-activated patients off the Medicare Tracker.
// Pure functions, no React and no Supabase, so scripts/check-census-visit-math.mjs
// can assert them without a build step.
//
// CONTEXT (2026-07-21)
// -------------------
// Liam: "the patient's status that was non-admit: we need to have a button
// that can archive these accounts, as these patients were never actually
// seen or activated with our services."
//
// Archiving is a SOFT hide. `medicare_visit_flags.archived_at` is set, the
// row and every counter on it stay exactly as they were, and unarchiving is
// a single UPDATE that nulls the column. Nothing is ever deleted — a
// Non-Admit row is the evidence that we assessed the patient and declined,
// which is precisely the kind of record an audit asks for.
// =====================================================================

/**
 * Can this row be archived?
 *
 * Two conditions, and the second is the one that actually protects us:
 * status is a free-text field a coordinator can edit, whereas a completed
 * visit is a billing fact. Archiving a patient we genuinely treated would
 * hide revenue from the roster, so the visit count is a hard gate
 * regardless of what the status says.
 *
 * @param {Object} flag medicare_visit_flags row
 * @returns {boolean}
 */
export function canArchiveFlag(flag) {
  if (!flag || flag.archived_at) return false;
  const status = (flag.patient_status || '').toLowerCase().trim();
  const visits = flag.total_completed_visits ?? 0;
  return status === 'non-admit' && visits === 0;
}

/**
 * Contradictions worth showing in the archive confirmation dialog.
 *
 * None of these BLOCK the archive. Liam's rule is that the tracker is
 * authoritative once staff have audited it — they review, find the census
 * status wrong, and correct it on the tracker — so archiving pushes the
 * tracker status down to census rather than deferring to it. These strings
 * exist so a conflict gets a human decision instead of being buried by the
 * hide.
 *
 * Both cases are real in production as of 2026-07-21: 4 of 19 Non-Admit
 * rows disagreed with census (3 SOC Pending, 1 Waitlist), and 2 carried a
 * census last_visit_date despite showing zero completed Medicare visits.
 *
 * @param {Object} flag       medicare_visit_flags row
 * @param {Object} censusRow  matching census_data row, or undefined
 * @returns {string[]}        empty when the row is unambiguous
 */
export function archiveWarnings(flag, censusRow) {
  const out = [];
  if (!censusRow) {
    out.push('No matching census row — the census status sync will not apply.');
    return out;
  }
  const trackerStatus = (flag && flag.patient_status) || 'Non-Admit';
  if ((censusRow.status || '').trim() !== trackerStatus.trim()) {
    out.push(
      `Census currently says "${censusRow.status || '(blank)'}" — archiving will change it to "${trackerStatus}".`
    );
  }
  if (censusRow.last_visit_date) {
    out.push(
      `Census records a visit on ${censusRow.last_visit_date}, which contradicts "never seen". ` +
      'Confirm the roster is right before archiving.'
    );
  }
  return out;
}
