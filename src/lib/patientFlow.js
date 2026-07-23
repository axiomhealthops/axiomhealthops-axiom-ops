// =====================================================================
// patientFlow.js
//
// Turns census_status_log into a daily patient-progression board.
// Pure functions — no React, no Supabase — so scripts/check-*.mjs can
// assert the collapse and stuck rules without a build step.
//
// WHAT THIS ANSWERS (Liam, 2026-07-21)
// "when somebody moves from SOC Pending to Auth Pending or Auth Pending to
// Eval Pending ... so I can then touch base with the Care Coordination
// Team, the Authorization Team, and the Clinical Team."
//
// So every movement is attributed to the team that owns the stage the
// patient moved INTO — that team is who Liam calls about it.
//
// TWO DATA REALITIES THIS MODULE HANDLES
// --------------------------------------
// 1. FLAPPING. `Active <-> Discharge - Change Insurance` fired 589 times
//    across just 34 patients in 30 days (17 flips each, 127 bouncing
//    straight back, only 28 sitting in that status). Raw, that buries the
//    5-12 real activations per day. collapseDay() nets each patient's day
//    down to one movement, and a patient who ends where they started is
//    reported as `bounced` rather than as two movements. Patients flipping
//    repeatedly are surfaced separately by findFlappers() — that pattern is
//    a data/insurance problem, not care progress.
//
// 2. PARTIAL HISTORY. census_status_log starts 2026-04-03. Roughly half of
//    the patients currently sitting in a pipeline stage entered it before
//    then and have no log row for it (26 of 43 Waitlist, 21 of 35 SOC
//    Pending). For those, daysInStage falls back to first_seen_date and is
//    marked `isFloor` — the UI must render it as "14+ days", never as a
//    precise figure we cannot support.
//
// Uploads are weekday-only, so "today" is really "the most recent upload
// day". Use latestActivityDate() rather than assuming the calendar date.
// =====================================================================

import { normalizeStatus } from './censusStatus.js';

// ─── Stage model ──────────────────────────────────────────────────────
// Order here IS the left-to-right order on the board, and it mirrors the
// real flow measured over 90 days:
//   SOC Pending -> Eval Pending (25)   Waitlist -> Eval Pending (17)
//   Eval Pending -> Active (70)        SOC Pending -> Active (12)
//   Active <-> Active-Auth Pending (138 / 113)
export const FLOW_STAGES = [
  { key: 'soc_pending',  label: 'SOC Pending',   short: 'SOC',        owner: 'Intake / Care Coord',     team: 'care_coord', match: (s) => /^soc pending/i.test(s) },
  { key: 'waitlist',     label: 'Waitlist',      short: 'Waitlist',   owner: 'Care Coord / Assignment', team: 'care_coord', match: (s) => /waitlist/i.test(s) },
  { key: 'eval_pending', label: 'Eval Pending',  short: 'Eval',       owner: 'Care Coord / Scheduling', team: 'care_coord', match: (s) => /^eval pending/i.test(s) },
  { key: 'auth_pending', label: 'Auth Pending',  short: 'Auth',       owner: 'Auth Team',               team: 'auth',       match: (s) => s === 'Auth Pending' },
  { key: 'active_auth',  label: 'Active - Auth', short: 'Active/Auth',owner: 'Auth Team',               team: 'auth',       match: (s) => s === 'Active - Auth Pending' },
  { key: 'active',       label: 'Active',        short: 'Active',     owner: 'Clinical',                team: 'clinical',   match: (s) => s === 'Active' },
];

// Where patients go when they leave the pipeline. Not part of the flow
// order, but Liam asked to see fallout — it is often the more urgent call.
export const EXIT_STAGES = [
  { key: 'on_hold',      label: 'On Hold',      owner: 'Care Coord Recovery', team: 'care_coord', match: (s) => /^on hold/i.test(s) },
  { key: 'hospitalized', label: 'Hospitalized', owner: 'Care Coord',          team: 'care_coord', match: (s) => /hospitalized/i.test(s) },
  { key: 'discharge',    label: 'Discharged',   owner: 'Clinical',            team: 'clinical',   match: (s) => /^discharge/i.test(s) },
  { key: 'non_admit',    label: 'Non-Admit',    owner: 'Intake',              team: 'care_coord', match: (s) => s === 'Non-Admit' },
];

const ALL_STAGES = FLOW_STAGES.concat(EXIT_STAGES);

/** Map any raw status string to a stage key, or null if unmodelled. */
export function stageOf(rawStatus) {
  const s = normalizeStatus(rawStatus);
  if (!s) return null;
  const hit = ALL_STAGES.find((st) => st.match(s));
  return hit ? hit.key : null;
}

/** Stage definition by key. */
export function stageDef(key) {
  return ALL_STAGES.find((s) => s.key === key) || null;
}

/** True when the stage is part of the activation pipeline (not an exit). */
export function isPipelineStage(key) {
  return FLOW_STAGES.some((s) => s.key === key);
}

const dayOf = (ts) => (ts ? String(ts).slice(0, 10) : null);
const pkOf = (name) => (name || '').toLowerCase().trim();

/**
 * The most recent date that has any logged transition. Uploads are
 * weekday-only, so on a Monday morning this is Friday — never assume the
 * calendar date has data.
 *
 * @param {Array} log census_status_log rows
 * @returns {string|null} YYYY-MM-DD
 */
export function latestActivityDate(log) {
  let best = null;
  for (const r of log || []) {
    const d = dayOf(r && r.changed_at);
    if (d && (best === null || d > best)) best = d;
  }
  return best;
}

/**
 * Collapse one day's transitions to at most ONE net movement per patient.
 *
 * A patient with rows A->B then B->A on the same day did not move; they
 * are reported once with `bounced: true` and excluded from stage in/out
 * counts. A patient with A->B then B->C is reported once as A->C.
 *
 * @param {Array} log   census_status_log rows (any range)
 * @param {string} date YYYY-MM-DD
 * @returns {Array<{patient, region, fromStage, toStage, fromStatus, toStatus,
 *                  bounced, hops, at}>}
 */
export function collapseDay(log, date) {
  const byPatient = new Map();
  for (const r of log || []) {
    if (!r || dayOf(r.changed_at) !== date) continue;
    const k = pkOf(r.patient_name);
    if (!k) continue;
    if (!byPatient.has(k)) byPatient.set(k, []);
    byPatient.get(k).push(r);
  }

  const out = [];
  for (const rows of byPatient.values()) {
    rows.sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at)));
    const first = rows[0];
    const last = rows[rows.length - 1];
    const fromStatus = normalizeStatus(first.old_status);
    const toStatus = normalizeStatus(last.new_status);
    const fromStage = stageOf(first.old_status);
    const toStage = stageOf(last.new_status);
    out.push({
      patient: last.patient_name,
      region: last.region || first.region || null,
      fromStatus, toStatus, fromStage, toStage,
      // Net no-op: ended the day in the status they started it in.
      bounced: !!fromStatus && fromStatus === toStatus,
      hops: rows.length,
      at: last.changed_at,
    });
  }
  // Newest first, then alphabetical so the feed is stable between renders.
  out.sort((a, b) => String(b.at).localeCompare(String(a.at))
    || String(a.patient).localeCompare(String(b.patient)));
  return out;
}

/**
 * Patients whose status is unstable.
 *
 * DEFINITION: the patient was written INTO the same status 3+ separate
 * times inside the window — i.e. they keep RETURNING to a status they
 * already occupied. Measured on production 2026-07-07..21:
 *
 *   patients with any status change ............... 251
 *   revisited some status 2+ times ................  92
 *   revisited some status 3+ times ................  73
 *   moved forward-only with 3+ changes ............   0
 *
 * That last row is why the rule is "revisits", not "transition count".
 * A raw 3-in-14-days threshold flagged 83 patients, but a legitimate
 * SOC -> Eval -> Active progression is already three transitions, so it
 * could not tell progress from oscillation. Nobody in production actually
 * moves forward 3+ times without doubling back, so revisiting is the only
 * signature that isolates the noise.
 *
 * @param {Array} log
 * @param {number} windowDays
 * @param {string} [asOf] YYYY-MM-DD, defaults to latest activity
 * @returns {Array<{patient, region, flips, revisits, statuses}>}
 */
export function findFlappers(log, windowDays = 14, asOf = null) {
  const end = asOf || latestActivityDate(log);
  if (!end) return [];
  const startMs = new Date(end + 'T23:59:59Z').getTime() - windowDays * 86400000;

  const byPatient = new Map();
  for (const r of log || []) {
    if (!r || !r.changed_at) continue;
    const t = new Date(r.changed_at).getTime();
    if (Number.isNaN(t) || t < startMs) continue;
    if (dayOf(r.changed_at) > end) continue;
    const k = pkOf(r.patient_name);
    if (!k) continue;
    if (!byPatient.has(k)) byPatient.set(k, { patient: r.patient_name, region: r.region || null, flips: 0, counts: new Map() });
    const e = byPatient.get(k);
    e.flips++;
    const ns = normalizeStatus(r.new_status);
    if (ns) e.counts.set(ns, (e.counts.get(ns) || 0) + 1);
  }

  return Array.from(byPatient.values())
    .map((e) => {
      let revisits = 0;
      for (const n of e.counts.values()) if (n > revisits) revisits = n;
      // Only the statuses they actually cycled through are worth naming.
      const cycled = Array.from(e.counts.entries()).filter(([, n]) => n >= 2).map(([k]) => k);
      return { patient: e.patient, region: e.region, flips: e.flips, revisits,
               statuses: cycled.length ? cycled : Array.from(e.counts.keys()) };
    })
    .filter((e) => e.revisits >= 3)
    .sort((a, b) => b.revisits - a.revisits || b.flips - a.flips);
}

/**
 * Days each currently-live patient has sat in their present stage.
 *
 * Primary source is the latest log row that put them INTO their current
 * status. When there is none — the log only goes back to 2026-04-03 —
 * we fall back to first_seen_date and mark `isFloor`, because that is a
 * lower bound on time in stage, not a measurement of it.
 *
 * @param {Array} census census_data rows
 * @param {Array} log    census_status_log rows
 * @param {string} [asOf] YYYY-MM-DD
 * @returns {Map<string, {days:number, isFloor:boolean}>} keyed by lowercased name
 */
export function dwellByPatient(census, log, asOf = null) {
  // Explicit UTC: census_status_log timestamps are UTC, and parsing the
  // asOf boundary as local time shifted every dwell figure by a day.
  const nowMs = asOf ? new Date(asOf + 'T23:59:59Z').getTime() : Date.now();

  // Latest entry into each status, per patient.
  const latestInto = new Map(); // `${pk}||${status}` -> changed_at
  for (const r of log || []) {
    if (!r || !r.changed_at) continue;
    const key = pkOf(r.patient_name) + '||' + normalizeStatus(r.new_status);
    const prev = latestInto.get(key);
    if (!prev || String(r.changed_at) > String(prev)) latestInto.set(key, r.changed_at);
  }

  const out = new Map();
  for (const c of census || []) {
    if (!c || !c.patient_name) continue;
    const pk = pkOf(c.patient_name);
    const status = normalizeStatus(c.status);
    const entered = latestInto.get(pk + '||' + status);
    if (entered) {
      const t = new Date(entered).getTime();
      out.set(pk, { days: Math.max(0, Math.floor((nowMs - t) / 86400000)), isFloor: false });
    } else if (c.first_seen_date) {
      const t = new Date(c.first_seen_date + 'T00:00:00Z').getTime();
      if (!Number.isNaN(t)) {
        out.set(pk, { days: Math.max(0, Math.floor((nowMs - t) / 86400000)), isFloor: true });
      }
    }
  }
  return out;
}

/**
 * Assemble the whole board.
 *
 * @param {Object} args
 * @param {Array}  args.census census_data rows
 * @param {Array}  args.log    census_status_log rows
 * @param {string} [args.date] YYYY-MM-DD to report movement for; defaults
 *                             to the latest day that actually has data
 * @param {number} [args.stuckDays] threshold for the stuck count (default 7)
 * @returns {Object} { date, stages, exits, movements, bounced, flappers, totals }
 */
export function buildFlowBoard({ census, log, date = null, stuckDays = 7 }) {
  const day = date || latestActivityDate(log);
  const dwell = dwellByPatient(census, log, day);
  const dayRows = day ? collapseDay(log, day) : [];

  const real = dayRows.filter((m) => !m.bounced);
  const bounced = dayRows.filter((m) => m.bounced);

  // Current occupancy + dwell, per stage.
  function occupancy(defs) {
    return defs.map((def) => {
      const members = (census || []).filter((c) => {
        const s = normalizeStatus(c && c.status);
        return s && def.match(s);
      });
      const withDwell = members.map((c) => {
        const d = dwell.get(pkOf(c.patient_name));
        return { patient: c.patient_name, region: c.region || null,
                 days: d ? d.days : null, isFloor: d ? d.isFloor : true };
      });
      const stuck = withDwell.filter((p) => p.days !== null && p.days >= stuckDays);
      const oldest = withDwell.reduce((mx, p) => (p.days !== null && p.days > mx ? p.days : mx), 0);
      return {
        key: def.key, label: def.label, short: def.short || def.label,
        owner: def.owner, team: def.team,
        current: members.length,
        inCount: real.filter((m) => m.toStage === def.key).length,
        outCount: real.filter((m) => m.fromStage === def.key).length,
        stuck: stuck.length,
        oldestDays: oldest,
        // How much of this tile's dwell is a floor rather than a measurement.
        unknownDwell: withDwell.filter((p) => p.days === null || p.isFloor).length,
        patients: withDwell.sort((a, b) => (b.days || 0) - (a.days || 0)),
      };
    });
  }

  const stages = occupancy(FLOW_STAGES);
  const exits = occupancy(EXIT_STAGES);

  const pipelineKeys = new Set(FLOW_STAGES.map((s) => s.key));
  const totals = {
    // Arrived in the pipeline from outside it (or from a brand-new chart).
    entered: real.filter((m) => pipelineKeys.has(m.toStage) && !pipelineKeys.has(m.fromStage)).length,
    // Reached Active from anywhere earlier in the pipeline.
    activated: real.filter((m) => m.toStage === 'active' && pipelineKeys.has(m.fromStage) && m.fromStage !== 'active').length,
    // Fell out of the pipeline into an exit stage.
    lost: real.filter((m) => pipelineKeys.has(m.fromStage) && !pipelineKeys.has(m.toStage)).length,
    // Moved between two pipeline stages without reaching Active. Excludes
    // the activation case so entered/activated/lost/within stay mutually
    // exclusive and can be read as a set rather than overlapping filters.
    within: real.filter((m) => pipelineKeys.has(m.fromStage) && pipelineKeys.has(m.toStage)
      && m.fromStage !== m.toStage && m.toStage !== 'active').length,
    moved: real.length,
    bounced: bounced.length,
  };

  // Tag movements from unstable patients. Same-day bounces are rare (0 on
  // 2026-07-21); the oscillation happens ACROSS days, so collapseDay alone
  // cannot damp it. Tagging lets the feed show every real move while making
  // the churn visually recede.
  const flappers = findFlappers(log, 14, day);
  const unstableKeys = new Set(flappers.map((f) => pkOf(f.patient)));
  const tagged = real.map((m) => ({ ...m, unstable: unstableKeys.has(pkOf(m.patient)) }));

  return {
    date: day,
    stages, exits,
    movements: tagged,
    bounced,
    flappers,
    totals: { ...totals, unstableMoves: tagged.filter((m) => m.unstable).length },
  };
}

/**
 * Group movements by the team that owns the stage moved INTO — that is who
 * Liam calls. Movements into an unmodelled status fall under 'other'.
 */
export function movementsByTeam(movements) {
  const out = { care_coord: [], auth: [], clinical: [], other: [] };
  for (const m of movements || []) {
    const def = m.toStage ? stageDef(m.toStage) : null;
    const bucket = def && out[def.team] ? def.team : 'other';
    out[bucket].push(m);
  }
  return out;
}

export const TEAM_LABELS = {
  care_coord: 'Care Coordination',
  auth: 'Authorization',
  clinical: 'Clinical',
  other: 'Unclassified',
};

// =====================================================================
// CONVERSION REPORTING (2026-07-23)
//
// Liam: "I need to have the ability to pull out a report of how many went
// from eval pending to active so I can see exactly how many patients that
// were scheduled for evaluation were activated this week ... Same thing
// for how many patients went from SOC pending to auth pending by the end
// of the day, end of the week."
//
// WHY EVERY CONVERSION CARRIES A DENOMINATOR
// ------------------------------------------
// A bare count hides the thing worth acting on. Week of 2026-07-19:
//   Eval Pending -> Active .................  5 patients
//   left Eval Pending for ANY status ....... 16 patients
// So the activation rate was 31% and 11 patients went somewhere else
// (Discharge, back to SOC Pending, On Hold). "5 activated" reads like a
// slow week; "5 of 16, and 11 leaked" is a conversation with the Care
// Coord and Clinical leads. Every conversion below reports both.
//
// COUNT DISTINCT PATIENTS, NOT EVENTS. The same patient can make the same
// transition repeatedly — Active -> Discharge-Change-Insurance shows 18
// patients across 50 events in one week. Patients is the honest headline;
// events is kept alongside so repeat churn is visible rather than hidden.
// =====================================================================

/** The conversions Liam asked for by name, plus the rest of the pipeline. */
export const NAMED_CONVERSIONS = [
  { key: 'eval_to_active',   from: 'eval_pending', to: 'active',       label: 'Eval Pending → Active',        blurb: 'evaluations that became active patients', team: 'clinical' },
  { key: 'soc_to_auth',      from: 'soc_pending',  to: 'auth_pending', label: 'SOC Pending → Auth Pending',   blurb: 'new charts handed to authorization',      team: 'auth' },
  { key: 'soc_to_eval',      from: 'soc_pending',  to: 'eval_pending', label: 'SOC Pending → Eval Pending',   blurb: 'new charts scheduled for evaluation',     team: 'care_coord' },
  { key: 'auth_to_active',   from: 'auth_pending', to: 'active',       label: 'Auth Pending → Active',        blurb: 'authorizations cleared into treatment',   team: 'auth' },
  { key: 'activeauth_to_active', from: 'active_auth', to: 'active',    label: 'Active/Auth → Active',         blurb: 'auth resolved while already treating',    team: 'auth' },
  { key: 'waitlist_to_eval', from: 'waitlist',     to: 'eval_pending', label: 'Waitlist → Eval Pending',      blurb: 'waitlisted patients finally scheduled',   team: 'care_coord' },
];

/**
 * Normalize + stage-map every log row inside [startDate, endDate] inclusive.
 * Dates are YYYY-MM-DD and compared as strings, which is safe for ISO.
 */
export function transitionsInRange(log, startDate, endDate) {
  const out = [];
  for (const r of log || []) {
    if (!r || !r.changed_at) continue;
    const d = dayOf(r.changed_at);
    if (startDate && d < startDate) continue;
    if (endDate && d > endDate) continue;
    out.push({
      patient: r.patient_name,
      pk: pkOf(r.patient_name),
      region: r.region || null,
      fromStatus: normalizeStatus(r.old_status),
      toStatus: normalizeStatus(r.new_status),
      fromStage: stageOf(r.old_status),
      toStage: stageOf(r.new_status),
      at: r.changed_at,
      day: d,
    });
  }
  return out;
}

/**
 * One conversion metric.
 *
 * @returns {{key,label,blurb,team,from,to,
 *            patients:number, events:number,
 *            leftSource:number, rate:number|null,
 *            detail:Array}}
 *   patients   distinct patients who made this exact move
 *   events     raw transitions (>= patients when someone repeats it)
 *   leftSource distinct patients who left the `from` stage for ANY status
 *   rate       patients / leftSource — null when nobody left the stage
 */
export function measureConversion(transitions, def) {
  const made = new Map();
  let events = 0;
  const leftSource = new Set();

  for (const t of transitions || []) {
    if (t.fromStage === def.from) {
      // Moving within the same stage (a status rename) is not leaving it.
      if (t.toStage !== def.from) leftSource.add(t.pk);
    }
    if (t.fromStage === def.from && t.toStage === def.to) {
      events++;
      if (!made.has(t.pk)) made.set(t.pk, t);
    }
  }

  const patients = made.size;
  return {
    key: def.key, label: def.label, blurb: def.blurb, team: def.team,
    from: def.from, to: def.to,
    patients, events,
    leftSource: leftSource.size,
    rate: leftSource.size > 0 ? patients / leftSource.size : null,
    detail: Array.from(made.values()).sort((a, b) => String(a.at).localeCompare(String(b.at))),
  };
}

/** All named conversions for a period. */
export function measureAllConversions(transitions) {
  return NAMED_CONVERSIONS.map((d) => measureConversion(transitions, d));
}

/**
 * Every observed from->to pair, distinct patients descending. Powers the
 * "everything else" table and the export, so a move nobody thought to name
 * is still visible.
 */
export function pairMatrix(transitions) {
  const map = new Map();
  for (const t of transitions || []) {
    const from = t.fromStatus || '(new chart)';
    const to = t.toStatus || '(none)';
    if (from === to) continue; // same-status rewrite, not a move
    const k = from + ' → ' + to;
    if (!map.has(k)) map.set(k, { pair: k, fromStatus: from, toStatus: to, patients: new Set(), events: 0 });
    const e = map.get(k);
    e.patients.add(t.pk);
    e.events++;
  }
  return Array.from(map.values())
    .map((e) => ({ pair: e.pair, fromStatus: e.fromStatus, toStatus: e.toStatus,
                   patients: e.patients.size, events: e.events }))
    .sort((a, b) => b.patients - a.patients || b.events - a.events);
}

/** Flat patient-level rows for the XLSX export. */
export function conversionExportRows(transitions) {
  return (transitions || [])
    .filter((t) => t.fromStatus !== t.toStatus)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .map((t) => ({
      Date: t.day,
      Patient: t.patient,
      Region: t.region || '',
      From: t.fromStatus || '(new chart)',
      To: t.toStatus || '',
      Movement: (t.fromStatus || '(new chart)') + ' → ' + (t.toStatus || ''),
      'Owning Team': t.toStage && stageDef(t.toStage)
        ? (TEAM_LABELS[stageDef(t.toStage).team] || '') : '',
      'Changed At': t.at,
    }));
}
