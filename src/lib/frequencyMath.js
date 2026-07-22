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
// The em/ew reading is INFERRED FROM THE DB, not from documentation:
// `1em1` carries threshold 30 and `1em2` carries 60. If the trailing
// digit were a duration rather than an interval, both would be 30. The
// trailing digit on `NwD` genuinely is a duration (a 4-week course), so
// the two forms do not read the same way. Flagged as an assumption —
// worth one confirmation from Liam, but it is what the existing data
// says and matching it is strictly better than the current behaviour of
// not evaluating these patients at all.
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

// Thresholds for the canonical values, copied from what `census_data`
// already stores so this module can never disagree with the column on a
// value the column knows. Keyed by visits-per-week.
const KNOWN_THRESHOLD_BY_PER_WEEK = new Map([
  [4, 3],
  [2, 4],
  [1, 10],
]);

const NEVER_OVERDUE = 9999;

/**
 * Days of silence after which a patient on this cadence is overdue.
 * Falls back to twice the expected interval plus a small grace for
 * cadences the canonical table does not cover, which is the same shape
 * as the known values (1/wk: 7-day interval -> 10) without pretending to
 * be exact.
 */
function thresholdFor(perWeek) {
  if (!perWeek || perWeek <= 0) return NEVER_OVERDUE;
  const known = KNOWN_THRESHOLD_BY_PER_WEEK.get(perWeek);
  if (known !== undefined) return known;
  const intervalDays = 7 / perWeek;
  return Math.max(3, Math.round(intervalDays * 1.4) + 3);
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
    thresholdDays: thresholdFor(perWeek),
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
