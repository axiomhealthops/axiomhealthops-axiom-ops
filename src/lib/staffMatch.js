// =====================================================================
// staffMatch.js
//
// Single source of truth for matching a CLINICIAN ROSTER row
// (`clinicians.full_name`) to a SCHEDULE row (`visit_schedule_data`),
// and for reconciling the two into an honest capacity figure.
//
// WHY THIS EXISTS
// ---------------
// Director Command's header has been printing "Clinician capacity 1,220
// visits/wk" since v4. Measured against the week of 2026-07-12, that
// number is wrong in three separate ways at once:
//
//   1. NAME FORMAT. `clinicians.full_name` is "Andrea Schwab".
//      `visit_schedule_data.staff_name` is "Taylor, Natalie". A join on
//      the raw columns matches ZERO rows -- and returns a clean, entirely
//      plausible "0% utilization, 67 idle clinicians" rather than an
//      error. The DB already ships `staff_name_normalized` ("First Last",
//      100% populated), but only 11 of the 32 files that touch
//      `staff_name` use it.
//
//   2. NICKNAME DRIFT. Even on the normalized column, the roster says
//      "Abiola Balogun" and "Nicholas DeCandia" while the schedule says
//      "Abi Balogun" and "Nick DeCandia". Both were counted as idle
//      clinicians (50 visits/wk of capacity) while their delivered work
//      was simultaneously counted as coming from unrostered staff. Both
//      sides of the utilization ratio wrong, for the same two people.
//
//   3. PHANTOM CAPACITY. 21 of 67 active clinicians did not appear on
//      the schedule at all that week, carrying 325 visits/wk of target
//      between them -- including two Associate Directors (Lia Davis,
//      Earl Dimaano) who carry a 25-visit treatment target each but
//      manage rather than treat, and six clinicians last seen on the
//      schedule between March and June.
//
// The practical consequence is strategic, not cosmetic. At a claimed
// 1,220 capacity the 1,000-visit target reads as 82% of capacity --
// comfortable. Against the ~895 the roster actually supports, the same
// target is 112% of capacity, which is a hiring decision rather than a
// scheduling one. That is the number this module exists to get right.
//
// MATCHING RULES
// --------------
// Three tiers, most authoritative first:
//
//   1. EXACT on `clinicians.full_name`.
//   2. MAINTAINED ALIAS -- exact match against an entry in the
//      `clinicians.aliases` array. This column already exists and is
//      hand-maintained; ClinicianAccountabilityPage has used it since
//      May. It is the only tier that can catch drift a heuristic never
//      will: "Marlene Ortega" <- "Marlene Olea" and "Dawn Felix-Dawn" <-
//      "Dawn Felix Wall" are different surnames, and "Edna Mccall" <-
//      "Edna PTA McCall" has a discipline embedded in the name.
//   3. HEURISTIC (surname + first initial), accepted ONLY when
//      unambiguous on BOTH sides -- exactly one roster name and one
//      schedule name share that key. Two different J. Smiths are left
//      unmatched and surfaced, because silently merging two clinicians'
//      visit counts is a worse failure than reporting an unmatched name.
//
// A tier-3 match is reported back as `heuristicMatches` so the pairing
// can be promoted into `aliases` and stop being a guess. A tier-2 match
// is clean and is not reported as an exception.
// =====================================================================

/**
 * Canonical comparison key for a person's name. Case- and
 * whitespace-insensitive; strips punctuation that Pariox and hand-entry
 * disagree on (periods in "Jr.", stray hyphens, double spaces).
 */
export function staffKey(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * "Last, First" -> "First Last". Returns the input unchanged when there
 * is no comma, so it is safe to call on either format.
 *
 * Prefer `visit_schedule_data.staff_name_normalized` where available --
 * it is 100% populated and already flipped. This is the fallback for the
 * raw column and for any source that does not carry the normalized one.
 */
export function flipName(name) {
  if (!name) return '';
  const s = String(name).trim();
  const i = s.indexOf(',');
  if (i === -1) return s;
  const last = s.slice(0, i).trim();
  const first = s.slice(i + 1).trim();
  if (!first) return last;
  return first + ' ' + last;
}

/**
 * Read a display name off a visit row, preferring the normalized column.
 */
export function visitStaffName(row) {
  if (!row) return '';
  return String(row.staff_name_normalized || flipName(row.staff_name) || '').trim();
}

/** Alias key: surname + first initial. Deliberately lossy — see caveat above. */
function aliasKey(name) {
  const k = staffKey(name);
  if (!k) return '';
  const parts = k.split(' ').filter(Boolean);
  if (parts.length < 2) return '';
  const surname = parts[parts.length - 1];
  return surname + '|' + parts[0][0];
}

/**
 * Build a lookup index over the clinician roster.
 *
 * @param {Array<Object>} clinicians rows with at least `full_name`
 * @returns {{byKey: Map, byAlias: Map, ambiguousAliases: Set}}
 */
export function buildStaffIndex(clinicians) {
  const byKey = new Map();
  const byMaintainedAlias = new Map();
  const aliasCounts = new Map();
  const byAlias = new Map();
  for (const c of clinicians || []) {
    if (!c || !c.full_name) continue;
    byKey.set(staffKey(c.full_name), c);
    // Tier 2: the hand-maintained aliases column. Indexed separately from
    // full_name so a maintained pairing can never be shadowed by, or
    // silently overwrite, a real clinician's own name.
    for (const a of c.aliases || []) {
      const ak = staffKey(a);
      if (ak && !byKey.has(ak)) byMaintainedAlias.set(ak, c);
    }
    // Tier 3: heuristic key, built from full_name AND every alias, so a
    // roster row is reachable by the surname of either spelling.
    for (const n of [c.full_name].concat(c.aliases || [])) {
      const a = aliasKey(n);
      if (!a) continue;
      if (byAlias.get(a) === c) continue;   // same clinician, not a collision
      aliasCounts.set(a, (aliasCounts.get(a) || 0) + 1);
      byAlias.set(a, c);
    }
  }
  // An alias shared by two roster names can never be resolved safely.
  const ambiguousAliases = new Set();
  for (const [a, n] of aliasCounts) if (n > 1) ambiguousAliases.add(a);
  return { byKey, byMaintainedAlias, byAlias, ambiguousAliases };
}

/**
 * Resolve a schedule-side name to a roster clinician.
 *
 * @returns {{clinician: Object|null, via: 'exact'|'alias'|'heuristic'|null}}
 */
export function matchStaff(index, scheduleName) {
  if (!index || !scheduleName) return { clinician: null, via: null };
  const k = staffKey(scheduleName);

  const exact = index.byKey.get(k);
  if (exact) return { clinician: exact, via: 'exact' };

  const maintained = index.byMaintainedAlias.get(k);
  if (maintained) return { clinician: maintained, via: 'alias' };

  const a = aliasKey(scheduleName);
  if (a && !index.ambiguousAliases.has(a)) {
    const c = index.byAlias.get(a);
    if (c) return { clinician: c, via: 'heuristic' };
  }
  return { clinician: null, via: null };
}

/**
 * Reconcile the active roster against who actually appears on the
 * schedule, and derive a capacity figure that can be defended.
 *
 * `deliveredBy` is a Map of canonical-name-key -> visit count, built by
 * the caller from whatever slice of the schedule it cares about (usually
 * one week of completed visits). Kept as an input rather than computed
 * here so this module stays pure and free of visit-classification rules,
 * which live in visitMath.js.
 *
 * @param {Array<Object>} clinicians  active roster rows
 * @param {Map<string, number>} deliveredBy  staffKey -> delivered count
 * @returns {Object} reconciliation summary + the three exception lists
 */
export function reconcileRoster(clinicians, deliveredBy) {
  const index = buildStaffIndex(clinicians);
  const delivered = deliveredBy || new Map();

  // Resolve every schedule-side name once, so each delivered count is
  // attributed to at most one roster row.
  const creditByRoster = new Map();   // staffKey(roster) -> count
  const heuristicMatches = [];        // guessed — promote these into `aliases`
  const scheduleOnly = [];            // delivering work, not on the roster

  for (const [nameKey, count] of delivered) {
    const { clinician, via } = matchStaff(index, nameKey);
    if (!clinician) {
      scheduleOnly.push({ name: nameKey, visits: count });
      continue;
    }
    const rk = staffKey(clinician.full_name);
    creditByRoster.set(rk, (creditByRoster.get(rk) || 0) + count);
    // A maintained alias is a clean match and is deliberately NOT reported.
    // Only guesses are surfaced, because only guesses need human action.
    if (via === 'heuristic') {
      heuristicMatches.push({ scheduleName: nameKey, rosterName: clinician.full_name, visits: count });
    }
  }

  const active = (clinicians || []).filter(c => c && c.full_name);
  const rosterOnly = [];
  let claimedCapacity = 0;
  let workingCapacity = 0;
  let deliveredTotal = 0;

  for (const c of active) {
    const rk = staffKey(c.full_name);
    const t = c.weekly_visit_target || 0;
    const got = creditByRoster.get(rk) || 0;
    claimedCapacity += t;
    deliveredTotal += got;
    if (got > 0) {
      workingCapacity += t;
    } else {
      rosterOnly.push({ name: c.full_name, target: t, discipline: c.discipline, region: c.region });
    }
  }

  const unrosteredVisits = scheduleOnly.reduce((s, r) => s + r.visits, 0);
  const phantomCapacity = claimedCapacity - workingCapacity;

  return {
    claimedCapacity,        // what the header prints today
    workingCapacity,        // target of clinicians who actually delivered
    phantomCapacity,        // the difference — the number to defend or delete
    deliveredTotal,         // credited to roster clinicians
    unrosteredVisits,       // delivered by people with no active roster row
    utilizationPct: workingCapacity > 0
      ? Math.round((deliveredTotal / workingCapacity) * 100)
      : null,
    rosterOnly,             // on the roster, delivered nothing
    scheduleOnly,           // delivered work, not on the roster
    heuristicMatches,       // matched by guess — promote into `aliases`
    matchedCount: creditByRoster.size,
    activeCount: active.length,
  };
}
