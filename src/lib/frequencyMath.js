// =====================================================================
// frequencyMath.js
//
// The only place that interprets `census_data.inferred_frequency`.
//
// Same rule as censusStatus.js: never regex the raw column at a call
// site. That module exists because `/active/i` also matched
// "Active - Auth Pendin" and made two pages disagree by 23 patients.
// This one exists because the frequency column has the same disease in a
// worse form.
//
// WHAT IS WRONG WITH THE RAW COLUMN
// ---------------------------------
// Six values are clean and carry a matching `overdue_threshold_days`:
//
//     1em1 -> 30    2w4 -> 4     1w4 -> 10
//     4w4  -> 3     1em2 -> 60   prn  -> 9999 (never overdue)
//
// Everything else is free text a clinician typed, and `census_data`
// carries NO threshold for any of it. Measured 2026-07-22 over 493
// active patients:
//
//   56 have no overdue threshold at all
//   38 OF THOSE CARRY A PERFECTLY PARSEABLE FREQUENCY, buried in text
//      like "LOC 3 DM 1w4", "LOC 4 Maintenance 2w8", "Maintenance -1em2"
//   18 are genuinely unknown ("N/A", "NA", null)
//
// Those 38 patients are invisible to every overdue check in the system.
// Not flagged-and-ignored: never evaluated. A patient prescribed 1w4
// whose record says "LOC 3 DM 1w4" instead of "1w4" can go unseen
// indefinitely and never appear on a single report.
//
// NOTATION
// --------
//   NwD    N visits per week, for D weeks          "2w4" = 2x/wk, 4 wks
//   NemM   N visits every M months                 "1em2" = 1 per 2 months
//   NewW   N visits every W weeks                  "1ew2" = 1 per 2 weeks
//   prn    as needed — never overdue
//
// CONFIRMED BY LIAM 2026-07-22: `1em2` means "once every two months",
// NOT "once a month for two months". The trailing digit is an INTERVAL
// on the em/ew forms and a DURATION on the NwD form — the same position
// genuinely means two different things depending on the letter. That is
// the one part of this notation you cannot infer from `NwD`, so it is
// recorded here rather than left to be rediscovered.
//
// The DB agreed before he did: `1em1` carries threshold 30 and `1em2`
// carries 60. Under a duration reading both would be 30, since how long
// an order runs does not change how long you wait between visits.
//
// Note the two readings only diverge when the trailing digit is 2+. At
// `1em1` — 174 of the 193 em/ew patients — they give the same answer.
//
// MULTI-PHASE ORDERS
// ------------------
// "LOC 3 - 4w4, 2w2" is a taper: 4x/wk for 4 weeks, THEN 2x/wk for 2.
// The first token is the current phase, so it wins. Tracking which phase
// a patient is actually in needs a start date the census does not carry,
// so taking the first is deliberately conservative — it over-estimates
// expected frequency for a patient late in a taper, which surfaces them
// for review rather than hiding them.
//
// UNRECOGNIZED VALUES NEVER GET A SILENT DEFAULT. `recognized:false`
// comes back and the caller is expected to surface it, exactly like
// censusStatus.js `.unmapped`. Defaulting an unparseable frequency to
// "weekly" would invent clinical expectations that nobody prescribed.
// =====================================================================

// Thresholds for the WEEKLY cadences, copied from what `census_data`
// already stores. Keyed by visits per week. These carry a deliberate
// grace period on top of the bare interval (1/wk is a 7-day interval but
// only goes overdue at 10) because a weekly visit slipping a couple of
// days is routine scheduling, not a lapse.
const KNOWN_WEEKLY_THRESHOLD = new Map([
  [4, 3],
  [2, 4],
  [1, 10],
]);

const NEVER_OVERDUE = 9999;
const DAYS_PER_MONTH = 30;

/**
 * Days of silence after which a patient on this cadence is overdue.
 *
 * Split by unit, because the two families genuinely behave differently
 * and a single per-week formula cannot serve both:
 *
 *   NwD   -> table above, with its built-in grace.
 *   NemM  -> the interval itself, M months at 30 days. `1em1` = 30 and
 *            `1em2` = 60, matching census_data exactly.
 *   NewW  -> the interval itself, W weeks at 7 days.
 *
 * An earlier version keyed everything off visits-per-week and let the
 * monthly cadences fall through to a generic heuristic. That produced 46
 * days for `1em1` and 88 for `1em2` against the column's 30 and 60 —
 * precisely the second-disagreeing-source problem this module exists to
 * prevent, and invisible until an assertion pinned the real values.
 */
function thresholdFor(unit, n, span, perWeek) {
  if (!perWeek || perWeek <= 0) return NEVER_OVERDUE;
  if (unit === 'em') return span * DAYS_PER_MONTH;
  if (unit === 'ew') return span * 7;
  const known = KNOWN_WEEKLY_THRESHOLD.get(n);
  if (known !== undefined) return known;
  // Novel weekly cadence (3w4, 5w2...): same shape as the known values.
  return Math.max(3, Math.round(7 / n) + 2);
}

/**
 * Parse a raw `inferred_frequency` string.
 *
 * @param {string} raw
 * @returns {{
 *   recognized: boolean,   // false = do not invent an expectation
 *   asNeeded: boolean,     // prn — counted, never overdue
 *   perWeek: number,       // expected visits per week (0 for prn/unknown)
 *   canonical: string,     // the token that was matched, e.g. "1w4"
 *   thresholdDays: number, // days of silence before overdue
 *   phases: number,        // how many phases the order carried
 *   raw: string,
 * }}
 */
export function parseFrequency(raw) {
  const out = {
    recognized: false, asNeeded: false, perWeek: 0,
    canonical: '', thresholdDays: NEVER_OVERDUE, phases: 0,
    raw: raw == null ? '' : String(raw),
  };
  if (!raw) return out;

  const s = String(raw).toLowerCase();

  // prn is a real, recognized instruction — "as needed" — and must not be
  // confused with an unparseable value. It is recognized AND never overdue.
  if (/\bprn\b/.test(s)) {
    return { ...out, recognized: true, asNeeded: true, canonical: 'prn' };
  }
  if (/^\s*(n\/?a|none|null)\s*$/.test(s)) return out;

  // Every frequency token in the string, in order. The LOC / DM / AD /
  // Maintenance prefixes are simply not matched, which is why they stop
  // mattering. \d+ on the trailing group tolerates "1w10".
  const tokens = s.match(/(\d+)\s*(em|ew|w)\s*(\d+)/g) || [];
  if (tokens.length === 0) return out;

  const first = /(\d+)\s*(em|ew|w)\s*(\d+)/.exec(tokens[0]);
  const n = parseInt(first[1], 10);
  const unit = first[2];
  const span = parseInt(first[3], 10);
  if (!n || !span) return out;

  let perWeek;
  if (unit === 'w') perWeek = n;                       // n per week
  else if (unit === 'ew') perWeek = n / span;          // n every `span` weeks
  else perWeek = n / (span * (365 / 12 / 7));          // n every `span` months

  return {
    ...out,
    recognized: true,
    perWeek,
    canonical: `${n}${unit}${span}`,
    thresholdDays: thresholdFor(unit, n, span, perWeek),
    phases: tokens.length,
  };
}

/**
 * Expected visits this week for a patient, rounded to whole visits.
 * A cadence sparser than weekly returns 0 — a monthly patient is not
 * owed a visit in any given week, and counting them as a fractional
 * shortfall every week would bury the patients who are genuinely behind.
 */
export function expectedVisitsThisWeek(freq) {
  if (!freq || !freq.recognized || freq.asNeeded) return 0;
  if (freq.perWeek < 1) return 0;
  return Math.round(freq.perWeek);
}

/**
 * Compare prescribed cadence against what was actually delivered.
 *
 * `delivered` is this week's completed visit count for the patient.
 * Returns null when no expectation can be asserted, so callers can tell
 * "no shortfall" apart from "no basis to judge" — the distinction the
 * raw column currently destroys.
 */
export function coverageGap(rawFrequency, delivered) {
  const freq = parseFrequency(rawFrequency);
  const expected = expectedVisitsThisWeek(freq);
  if (!freq.recognized) {
    return { freq, expected: null, delivered, shortfall: null, reason: 'unparseable' };
  }
  if (freq.asNeeded) {
    return { freq, expected: 0, delivered, shortfall: 0, reason: 'prn' };
  }
  if (expected === 0) {
    return { freq, expected: 0, delivered, shortfall: 0, reason: 'sparser-than-weekly' };
  }
  return {
    freq, expected, delivered,
    shortfall: Math.max(0, expected - (delivered || 0)),
    reason: null,
  };
}

/**
 * Roll a patient list up into the numbers a coverage board reports.
 *
 * Patients whose frequency cannot be parsed are counted in `unparseable`
 * and EXCLUDED from the shortfall, never folded in at an assumed rate.
 * An inflated gap built on guesses is worse than a smaller true one.
 *
 * @param {Array<{frequency: string, delivered: number}>} patients
 */
export function summarizeCoverage(patients) {
  const out = {
    total: 0, withExpectation: 0, unparseable: 0, asNeeded: 0,
    sparserThanWeekly: 0, fullyCovered: 0, short: 0,
    expectedVisits: 0, deliveredVisits: 0, shortfallVisits: 0,
    unparseableValues: new Map(),
  };
  for (const p of patients || []) {
    if (!p) continue;
    out.total++;
    const g = coverageGap(p.frequency, p.delivered || 0);
    if (g.reason === 'unparseable') {
      out.unparseable++;
      const k = (p.frequency == null || p.frequency === '') ? '(blank)' : String(p.frequency);
      out.unparseableValues.set(k, (out.unparseableValues.get(k) || 0) + 1);
      continue;
    }
    if (g.reason === 'prn') { out.asNeeded++; continue; }
    if (g.reason === 'sparser-than-weekly') { out.sparserThanWeekly++; continue; }
    out.withExpectation++;
    out.expectedVisits += g.expected;
    out.deliveredVisits += g.delivered || 0;
    out.shortfallVisits += g.shortfall;
    if (g.shortfall > 0) out.short++; else out.fullyCovered++;
  }
  return out;
}
