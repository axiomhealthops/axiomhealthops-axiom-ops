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

// ── Per-diem overuse ──────────────────────────────────────────────────
// Per diem is meant to absorb irregular, low-volume work — a cover
// shift, a one-off, a gap. It is not a way to run a standing caseload
// without a contract. A per-diem clinician carrying a regular weekly
// load should be moved to a part-time contract, which is Liam's call to
// make and therefore something the system has to put in front of him
// rather than leave for someone to notice.
//
// RULE (Liam, 2026-07-22): more than `threshold` visits in each of
// `minConsecutive` or more CONSECUTIVE weeks. Consecutive matters — one
// busy week is cover, several in a row is a caseload. Measured on the
// week of 2026-07-12 this fires on exactly one person, Tiffany Harrison,
// who ran 12/17/17/17/14/19 across six straight weeks on a per-diem
// contract. Amilkar Gonzalez touched 11 once in June and correctly does
// not fire, which is the calibration the "consecutive" clause buys.
//
// A week with no visits is a ZERO, not a gap. Weeks are read from the
// caller's explicit window rather than from whatever keys happen to be
// in the map, so a clinician who takes a week off breaks their own
// streak instead of silently having it bridged.

/** Employment-type values that count as per diem. Matches the DB. */
const PER_DIEM_TYPES = new Set(['prn', 'per diem', 'per_diem', '1099', '1099 per diem']);

export function isPerDiem(employmentType) {
  return PER_DIEM_TYPES.has(String(employmentType || '').toLowerCase().trim());
}

// ── Assignment tiers ──────────────────────────────────────────────────
// Three tiers, filled in order (Liam 2026-07-22):
//
//   contracted  full-time and part-time. Fill to target FIRST. This is
//               the only tier that carries a caseload obligation, so it
//               is the only one that defines capacity or a gap.
//   surge       per diem. Available above contracted, but its target of
//               10 is an alert threshold rather than a commitment.
//   reserve     licensed clinicians whose role no longer requires a
//               caseload — the ADOCs. Schedulable, but only once
//               contracted staff are at target.
//
// `is_treating === false` marks reserve. Modelled as a flag rather than
// an employment_type value because these people genuinely ARE full-time
// employees; only the treating obligation is gone. Overloading
// employment_type would corrupt payroll semantics and would wrongly drag
// them into the per-diem overuse rule.
export function isReserve(clinician) {
  return !!clinician && clinician.is_treating === false;
}

/** True only for staff who owe a weekly caseload. */
export function isContracted(clinician) {
  if (!clinician) return false;
  if (isReserve(clinician)) return false;
  return !isPerDiem(clinician.employment_type);
}

/**
 * The ceiling above which a clinician's volume needs Liam's attention,
 * or null when they have none.
 *
 * An explicit `weekly_visit_cap` always wins — it is a deliberate
 * management decision (the Director of Clinical Ops capped at 4).
 * Otherwise per-diem staff carry the default 10 alert threshold. Anyone
 * else has no ceiling: a contracted clinician exceeding target is doing
 * exactly what we want.
 */
export function capFor(clinician, perDiemDefault) {
  if (!clinician) return null;
  if (clinician.weekly_visit_cap != null) return clinician.weekly_visit_cap;
  if (isReserve(clinician)) return null;   // no obligation AND no stated ceiling
  if (isPerDiem(clinician.employment_type)) {
    return perDiemDefault == null ? 10 : perDiemDefault;
  }
  return null;
}

/**
 * Flag clinicians running sustained volume above their ceiling.
 *
 * Two shapes of the same problem, distinguished by `reason` so the
 * recommended action is right:
 *   'per-diem'      a direct per-diem contractor carrying a standing
 *                   caseload -> move to a part-time contract
 *   'agency'        same volume, but the contract is the agency's, not
 *                   ours -> renegotiate or hire directly
 *   'capped-role'   a role that should rarely treat has exceeded its
 *                   stated ceiling -> awareness, not a contract change
 *
 * @param {Array<Object>} clinicians roster rows
 * @param {Map<string, Map<string, number>>} countsByStaffWeek
 *        staffKey -> (weekStart -> visits delivered)
 * @param {Array<string>} weekStarts ordered window. A week absent from a
 *        clinician's map counts as 0 and breaks their streak.
 * @param {{perDiemDefault?: number, minConsecutive?: number}} opts
 * @returns {Array<Object>} worst first
 */
export function flagOverCap(clinicians, countsByStaffWeek, weekStarts, opts) {
  const minConsecutive = (opts && opts.minConsecutive) || 2;
  const perDiemDefault = opts && opts.perDiemDefault;
  // Injected so this stays pure and testable — Date.now() in here would
  // make every acknowledgement assertion depend on the wall clock.
  const nowMs = (opts && opts.nowMs) || Date.now();
  const ackStaleDays = (opts && opts.ackStaleDays) || 30;
  const weeks = weekStarts || [];
  const counts = countsByStaffWeek || new Map();
  const flags = [];

  for (const c of clinicians || []) {
    if (!c || !c.full_name) continue;
    const threshold = capFor(c, perDiemDefault);
    if (threshold == null) continue;
    const byWeek = counts.get(staffKey(c.full_name)) || new Map();

    // Longest run of consecutive over-threshold weeks, and the run itself.
    let best = [];
    let run = [];
    for (const w of weeks) {
      const n = byWeek.get(w) || 0;
      if (n > threshold) {
        run.push({ weekStart: w, count: n });
        if (run.length > best.length) best = run.slice();
      } else {
        run = [];
      }
    }
    if (best.length < minConsecutive) continue;

    const total = best.reduce((s, x) => s + x.count, 0);
    const average = Math.round((total / best.length) * 10) / 10;
    const reason = c.weekly_visit_cap != null ? 'capped-role'
      : c.is_agency ? 'agency'
      : 'per-diem';

    // An acknowledged flag is being worked, so it is demoted rather than
    // repeated as news every morning. It is never hidden: a conversion
    // that stalls has to stay visible. And the acknowledgement EXPIRES —
    // otherwise "I am on it" quietly becomes a permanent mute, which is
    // the failure mode of every snooze button ever built.
    const ackAt = c.employment_review_ack_at ? Date.parse(c.employment_review_ack_at) : null;
    const ackAgeDays = (ackAt && nowMs) ? Math.floor((nowMs - ackAt) / 86400000) : null;
    const acknowledged = ackAgeDays != null && ackAgeDays >= 0 && ackAgeDays < ackStaleDays;
    flags.push({
      name: c.full_name,
      region: c.region,
      discipline: c.discipline,
      jobDescription: c.job_description,
      reason,
      cap: threshold,
      consecutiveWeeks: best.length,
      streak: best,
      peak: best.reduce((m, x) => Math.max(m, x.count), 0),
      average,
      // Only a direct per-diem contractor can be moved onto one of our
      // contracts. An agency worker's contract is not ours to change, and
      // a capped role is a management decision, not a contract shape.
      suggestedType: reason === 'per-diem'
        ? (average > 15 ? 'full-time' : 'part-time')
        : null,
      acknowledged,
      ackAgeDays,
      // Acknowledged, then left. Worth surfacing louder than a fresh
      // flag, because someone said they had it.
      ackWentStale: ackAgeDays != null && ackAgeDays >= ackStaleDays,
    });
  }

  // Unacknowledged first, then by severity. An acknowledged flag drops
  // below live ones without leaving the list.
  return flags.sort((a, b) =>
    (a.acknowledged ? 1 : 0) - (b.acknowledged ? 1 : 0) ||
    b.consecutiveWeeks - a.consecutiveWeeks ||
    b.average - a.average);
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
  const underTarget = [];
  const reserve = [];
  let claimedCapacity = 0;
  let workingCapacity = 0;
  let deliveredTotal = 0;
  // Assignment gap: how many more visits would have to be BOOKED to bring
  // every contracted clinician up to their weekly target. Only full-time
  // and part-time count — per diem carries a target of 10 that is an
  // ALERT THRESHOLD, not a commitment (see the set_visit_target trigger),
  // so treating it as capacity-to-fill would invent an obligation neither
  // side agreed to and inflate the gap by ~250 visits/wk.
  let committedCapacity = 0;
  let committedDelivered = 0;
  let assignmentGap = 0;

  for (const c of active) {
    const rk = staffKey(c.full_name);
    const t = c.weekly_visit_target || 0;
    const got = creditByRoster.get(rk) || 0;
    claimedCapacity += t;
    deliveredTotal += got;
    if (isReserve(c)) {
      // Reserve staff carry a target of 0, so they can neither be "under
      // target" nor count as idle capacity. Tracked separately: visits
      // they DID deliver are real work that still needs crediting.
      reserve.push({
        name: c.full_name, region: c.region, discipline: c.discipline,
        jobDescription: c.job_description, delivered: got,
      });
      continue;
    }
    if (got > 0) {
      workingCapacity += t;
    } else {
      rosterOnly.push({ name: c.full_name, target: t, discipline: c.discipline, region: c.region });
    }
    if (!isPerDiem(c.employment_type)) {
      committedCapacity += t;
      committedDelivered += got;
      const short = Math.max(0, t - got);
      if (short > 0) {
        assignmentGap += short;
        underTarget.push({
          name: c.full_name, region: c.region, discipline: c.discipline,
          employmentType: c.employment_type, target: t, delivered: got, short,
          // A negotiated minimum rather than the employment_type default.
          // Surfaced so nobody reads "Ariel 3/8" as a broken 25 and
          // "corrects" it back — the 8 is deliberate.
          isNegotiatedMinimum: c.weekly_visit_target_override != null,
        });
      }
    }
  }
  underTarget.sort((a, b) => b.short - a.short);

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
    // Contracted (ft + pt) capacity and the gap to it. This is the
    // number to schedule against — per diem is surge on top.
    committedCapacity,
    committedDelivered,
    assignmentGap,
    committedUtilizationPct: committedCapacity > 0
      ? Math.round((committedDelivered / committedCapacity) * 100)
      : null,
    underTarget,            // contracted clinicians below target, worst first
    reserve,                // non-treating, schedulable only as last resort
    reserveDelivered: reserve.reduce((s, r) => s + r.delivered, 0),
    rosterOnly,             // on the roster, delivered nothing
    scheduleOnly,           // delivered work, not on the roster
    heuristicMatches,       // matched by guess — promote into `aliases`
    matchedCount: creditByRoster.size,
    activeCount: active.length,
  };
}
