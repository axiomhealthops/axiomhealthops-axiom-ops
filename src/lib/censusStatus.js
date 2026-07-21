// =====================================================================
// censusStatus.js
//
// Single source of truth for census_data.status normalization and the
// canonical status buckets shown on Director Command.
//
// WHY THIS EXISTS (2026-07-21)
// ----------------------------
// Director Command was counting statuses with loose regexes applied
// directly to the raw column, which produced three separate defects:
//
//  1. /active/i.test(status) matched BOTH "Active" (472 rows) and
//     "Active - Auth Pendin" (23 rows). The "Active Census" tile read
//     496 while the census page's own "active" filter read 473. Two
//     surfaces, two answers, same question.
//
//  2. Pariox truncates status strings at 20 chars on import, so the DB
//     genuinely contains "Active - Auth Pendin" and "Discharge - Change I".
//     Every consumer was re-implementing the un-truncation, or forgetting to.
//
//  3. There was no "total census" concept at all, so nothing reconciled.
//     Now: the nine LIVE_BUCKETS sum exactly to liveRoster, and
//     liveRoster + discharged + nonAdmit === census_data row count.
//     If that identity ever breaks, a status value appeared that we
//     don't model — see UNMAPPED handling in bucketCensus().
//
// AGING DATA CAVEAT — READ BEFORE USING status_changed_at
// -------------------------------------------------------
// `status_changed_at` is NULL on ~95% of census rows (451 of 472 Active,
// 36 of 38 SOC Pending, 43 of 44 Waitlist). Pariox does not send it on
// the bulk roster upload; it is only stamped when someone changes status
// through our own UI. ANY "days in this status" metric built on it
// silently under-reports by ~20x. The pre-existing Director Command
// `stuck` / `_stuckPatients()` logic has exactly this bug — it returns
// false whenever status_changed_at is null, so "Pipeline Stalled" was
// evaluating 2 of 38 SOC Pending patients.
//
// Fields that ARE reliable (100% / near-100% populated):
//   - first_seen_date      → days on roster
//   - last_visit_date      → NULL means never visited, the strongest
//                            pipeline-stall signal we have
//   - days_since_last_visit
//   - days_overdue         → frequency-aware, already computed upstream
//
// So: aging here is measured as "never seen + days on roster" for
// pipeline buckets and "overdue vs prescribed frequency" for treating
// buckets. Neither touches status_changed_at.
// =====================================================================

/**
 * Pariox truncates status at 20 characters on the roster import. Restore
 * the full strings before any matching. Keys are the exact truncated
 * values observed in production.
 */
const TRUNCATION_REPAIRS = {
  'active - auth pendin': 'Active - Auth Pending',
  'discharge - change i': 'Discharge - Change Insurance',
};

/**
 * Normalize a raw census_data.status into its canonical form.
 * Handles casing drift (there is one lowercase 'active' row) and the
 * Pariox truncations above.
 *
 * @param {string} raw
 * @returns {string} canonical status, or '' when absent
 */
export function normalizeStatus(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const repaired = TRUNCATION_REPAIRS[trimmed.toLowerCase()];
  if (repaired) return repaired;
  // Casing drift only — 'active' -> 'Active'. Anything else passes through
  // verbatim so an unmodelled status stays visible rather than being
  // silently coerced into a bucket it doesn't belong to.
  if (trimmed.toLowerCase() === 'active') return 'Active';
  return trimmed;
}

/** True when this status means the patient has left the census entirely. */
export function isDischargedStatus(raw) {
  return /^discharge/i.test(normalizeStatus(raw));
}

/** True when this patient was never admitted in the first place. */
export function isNonAdmitStatus(raw) {
  return normalizeStatus(raw) === 'Non-Admit';
}

/**
 * True when this patient counts toward the live roster — i.e. someone at
 * EdemaCare can still act on them today. Excludes discharged and non-admit.
 */
export function isLiveRoster(raw) {
  const s = normalizeStatus(raw);
  return !!s && !isDischargedStatus(s) && !isNonAdmitStatus(s);
}

// ─── Bucket definitions ───────────────────────────────────────────────
// Order here IS the render order on Director Command. Each bucket names
// the department that owns it, because the whole point of the page is
// "which number is wrong, and who do I call about it".
//
//   key      — stable id
//   label    — widget title
//   owner    — the department Liam calls when this number moves
//   match    — predicate against the NORMALIZED status
//   nav      — { page, intent } deep link. Census intent keys match the
//              statusFilter branches already implemented in
//              PatientCensusPage (active / active_auth / soc_pending /
//              eval_pending / auth_pending / on_hold / waitlist /
//              hospitalized), so no change is needed there.
//   risk     — which staleness lens applies:
//                'overdue'   → patient is in treatment but past their
//                              prescribed frequency (days_overdue > 0)
//                'never_seen'→ patient is on the roster with no visit yet
//                              (last_visit_date IS NULL); the pipeline
//                              buckets live and die by this one
//                null        → no automatic risk lens
//   riskAfterDays — for 'never_seen', only count a patient as at-risk once
//                   they've been on the roster this long. Keeps a referral
//                   received yesterday out of the red.

export const LIVE_BUCKETS = [
  {
    key: 'active',
    label: 'Active',
    owner: 'Clinical / ADs',
    match: (s) => s === 'Active',
    nav: { page: 'census', intent: { status: 'active' } },
    risk: 'overdue',
  },
  {
    key: 'active_auth',
    // ASCII hyphen, not an em-dash: this string is rendered as a widget
    // title. See CLAUDE.md "Things that broke before" #4.
    label: 'Active - Auth Pending',
    owner: 'Auth Team',
    match: (s) => s === 'Active - Auth Pending',
    nav: { page: 'census', intent: { status: 'active_auth' } },
    risk: 'overdue',
  },
  {
    key: 'soc_pending',
    label: 'SOC Pending',
    owner: 'Intake / Care Coord',
    match: (s) => /^soc pending/i.test(s),
    nav: { page: 'census', intent: { status: 'soc_pending' } },
    risk: 'never_seen',
    riskAfterDays: 14,
  },
  {
    key: 'eval_pending',
    label: 'Eval Pending',
    owner: 'Care Coord / Scheduling',
    match: (s) => /^eval pending/i.test(s),
    nav: { page: 'census', intent: { status: 'eval_pending' } },
    risk: 'never_seen',
    riskAfterDays: 14,
  },
  {
    key: 'auth_pending',
    label: 'Auth Pending',
    owner: 'Auth Team',
    match: (s) => s === 'Auth Pending',
    nav: { page: 'census', intent: { status: 'auth_pending' } },
    risk: 'never_seen',
    riskAfterDays: 14,
  },
  {
    key: 'waitlist',
    label: 'Waitlist',
    owner: 'Care Coord / Assignment',
    match: (s) => /waitlist/i.test(s),
    nav: { page: 'waitlist' },
    risk: 'never_seen',
    riskAfterDays: 14,
  },
  {
    key: 'on_hold',
    label: 'On Hold',
    owner: 'Care Coord Recovery',
    match: (s) => /^on hold/i.test(s),
    nav: { page: 'census', intent: { status: 'on_hold' } },
    risk: 'overdue',
    // On Hold is the one bucket with meaningful sub-types (Facility,
    // Pt Request, MD Request, plain). They roll up here and break out in
    // the widget's detail line, because "96 on hold" and "51 of them are
    // facility holds" are two different conversations with two different
    // people.
    subTypes: [
      { key: 'facility', label: 'Facility', match: (s) => /facility/i.test(s) },
      { key: 'pt', label: 'Pt request', match: (s) => /pt request/i.test(s) },
      { key: 'md', label: 'MD request', match: (s) => /md request/i.test(s) },
      { key: 'plain', label: 'Unspecified', match: (s) => s === 'On Hold' },
    ],
  },
  {
    key: 'hospitalized',
    label: 'Hospitalized',
    owner: 'Care Coord',
    match: (s) => /hospitalized/i.test(s),
    nav: { page: 'hospitalizations' },
    risk: null,
  },
  {
    key: 'recert_dc',
    label: 'Recert / DC Pending',
    owner: 'Clinical',
    match: (s) => /^recert/i.test(s),
    nav: { page: 'census', intent: { status: 'Recert/DC Pending' } },
    risk: null,
  },
];

/** Days-on-roster helper. first_seen_date is 100% populated. */
export function daysOnRoster(row) {
  if (!row || !row.first_seen_date) return null;
  const t = new Date(row.first_seen_date + 'T00:00:00').getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

/**
 * Bucket an array of census_data rows.
 *
 * @param {Array<Object>} census rows with at minimum status, last_visit_date,
 *                        first_seen_date, days_overdue
 * @returns {{
 *   buckets: Array<Object>,   // one per LIVE_BUCKETS entry, in render order
 *   byKey: Object,            // same, keyed
 *   liveRoster: number,
 *   discharged: number,
 *   nonAdmit: number,
 *   total: number,
 *   unmapped: Array<{status: string, count: number}>  // must stay empty
 * }}
 */
export function bucketCensus(census) {
  const rows = census || [];
  const live = [];
  let discharged = 0;
  let nonAdmit = 0;

  rows.forEach((r) => {
    const s = normalizeStatus(r && r.status);
    if (!s) return;
    if (isDischargedStatus(s)) { discharged++; return; }
    if (isNonAdmitStatus(s)) { nonAdmit++; return; }
    live.push({ row: r, status: s });
  });

  const claimed = new Set();
  const buckets = LIVE_BUCKETS.map((def) => {
    const members = live.filter((entry, i) => {
      if (claimed.has(i)) return false;
      if (!def.match(entry.status)) return false;
      claimed.add(i);
      return true;
    });

    // Risk count — see the AGING DATA CAVEAT at the top of this file for
    // why this never reads status_changed_at.
    let riskCount = 0;
    let riskLabel = null;
    if (def.risk === 'overdue') {
      riskCount = members.filter((m) => (m.row.days_overdue || 0) > 0).length;
      riskLabel = 'past prescribed frequency';
    } else if (def.risk === 'never_seen') {
      const after = def.riskAfterDays || 0;
      riskCount = members.filter((m) => {
        if (m.row.last_visit_date) return false;
        const d = daysOnRoster(m.row);
        return d === null ? false : d >= after;
      }).length;
      riskLabel = `never seen, ${def.riskAfterDays}d+ on roster`;
    }

    // Median days on roster reads better than mean here — a handful of
    // 200-day stragglers otherwise drag the average somewhere nobody
    // recognizes.
    const ages = members.map((m) => daysOnRoster(m.row)).filter((d) => d !== null).sort((a, b) => a - b);
    const medianAge = ages.length
      ? (ages.length % 2 ? ages[(ages.length - 1) / 2]
        : Math.round((ages[ages.length / 2 - 1] + ages[ages.length / 2]) / 2))
      : null;

    const subTypes = (def.subTypes || []).map((st) => ({
      key: st.key,
      label: st.label,
      count: members.filter((m) => st.match(m.status)).length,
    })).filter((st) => st.count > 0);

    return {
      key: def.key,
      label: def.label,
      owner: def.owner,
      nav: def.nav,
      count: members.length,
      riskCount,
      riskLabel,
      medianAge,
      subTypes,
      patients: members.map((m) => m.row),
    };
  });

  // Anything live that no bucket claimed. Should always be empty; if a new
  // Pariox status appears it surfaces here instead of vanishing from the
  // roster total, which is how #3 above stays fixed.
  const unmappedCounts = {};
  live.forEach((entry, i) => {
    if (claimed.has(i)) return;
    unmappedCounts[entry.status] = (unmappedCounts[entry.status] || 0) + 1;
  });
  const unmapped = Object.keys(unmappedCounts).map((s) => ({ status: s, count: unmappedCounts[s] }));

  const byKey = {};
  buckets.forEach((b) => { byKey[b.key] = b; });

  return {
    buckets,
    byKey,
    liveRoster: live.length,
    discharged,
    nonAdmit,
    total: rows.length,
    unmapped,
  };
}
