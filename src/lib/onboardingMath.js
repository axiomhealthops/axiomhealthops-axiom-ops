// ── Onboarding & Ramp — the only place that interprets onboarding state ──────
// Same rule as censusStatus.js and frequencyMath.js: never open-code these
// checks at a call site. Pinned by assertions in `npm run check`.

export const BOARDS = [
  { key: 'overview', label: 'Overview',           owner: 'Liam O\'Brien',  role: 'Director of Operations', board: null },
  { key: 'hr',       label: 'HR readiness',       owner: 'Danielly',       role: 'HR Director',            board: 'hr' },
  { key: 'training', label: 'Training and field', owner: 'Uma Jacobs',     role: 'Onboarding',             board: 'training' },
  { key: 'supply',   label: 'Supplies',           owner: 'Earl Dimaano',   role: 'Supply Chain',           board: 'supply' },
  { key: 'payroll',  label: 'Payroll handoff',    owner: 'Quinn',          role: 'Payroll Manager',        board: 'payroll' },
];

// Stage vocabulary matches Liam's tracker wording, not invented labels.
export const STAGE_LABEL = {
  offer_out:          'Offer out',
  hr_docs:            'Onboarding',
  ready_for_training: 'Ready for training',
  in_training:        'In training',
  supervised:         'Supervised visits',
  cleared:            'Full caseload',
  withdrawn:          'Withdrawn',
};

export const DOC_SET_LABEL = {
  w2:              'W-2 employee',
  contractor_1099: '1099 contractor',
  status_change:   'Status change',
};

export const WORKER_CLASS_LABEL = {
  full_time:       'Full time',
  part_time:       'Part time',
  contractor_1099: '1099 PRN',
};

export const SUPPLY_STATE_LABEL = {
  not_raised:   'Not raised',
  ordered:      'Ordered',
  in_transit:   'In transit',
  issued:       'Issued',
  not_required: 'Not required',
};

// A status change never enters training. Encoded once so no caller can
// accidentally route one onto Uma's board.
export function entersTraining(hire) {
  return hire?.hire_type === 'new_hire';
}

export function isStatusChange(hire) {
  return hire?.hire_type === 'status_change';
}

// Days since a date, or null when we genuinely do not know. Never default to
// zero — "no contact recorded" and "contacted today" are different facts.
export function daysSince(value, now = new Date()) {
  if (!value) return null;
  const then = new Date(value);
  if (isNaN(then.getTime())) return null;
  return Math.floor((now - then) / 86400000);
}

export function daysUntil(dateStr, now = new Date()) {
  if (!dateStr) return null;
  const then = new Date(dateStr + 'T00:00:00');
  if (isNaN(then.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((then - today) / 86400000);
}

export function fmtDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// "TBD" is a real state that blocks kit, training plan and payroll alike —
// it is not the same as "starts soon". Callers must be able to tell them apart.
export function startLabel(hire) {
  if (hire.start_date) return fmtDate(hire.start_date);
  return hire.start_date_note || 'TBD';
}

export function hasNoStartDate(hire) {
  return !hire.start_date;
}

export function docProgress(docs) {
  const required = docs.filter(d => d.is_required);
  const done = required.filter(d => d.is_complete).length;
  return { done, total: required.length, complete: required.length > 0 && done === required.length };
}

export function kitProgress(items) {
  const counted = items.filter(i => i.state !== 'not_required');
  const issued = counted.filter(i => i.state === 'issued').length;
  return {
    issued,
    total: counted.length,
    blocked: counted.filter(i => i.state === 'not_raised').length,
    moving: counted.filter(i => i.state === 'ordered' || i.state === 'in_transit').length,
    complete: counted.length > 0 && issued === counted.length,
  };
}

export function moduleProgress(rows) {
  const total = rows.length;
  const done = rows.filter(r => r.status === 'completed' || r.status === 'waived').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const activity = rows.map(r => r.last_activity_at).filter(Boolean).sort().pop() || null;
  return { done, total, pct, idleDays: daysSince(activity) };
}

// Three gates, all of which must clear. Returns the gates themselves rather
// than a bare boolean so the UI can say WHICH one is short.
export function rampGates(hire, docs, mods) {
  const d = docProgress(docs);
  const m = moduleProgress(mods);
  const sup = {
    done: hire.supervised_visits_completed || 0,
    target: hire.supervised_visits_target || 10,
  };
  return {
    hr:         { ok: d.complete, label: `${d.done} of ${d.total} documents` },
    training:   { ok: m.total > 0 && m.done === m.total, label: `${m.done} of ${m.total} modules` },
    supervised: { ok: sup.done >= sup.target, label: `${sup.done} of ${sup.target} supervised visits` },
    ready:      d.complete && m.total > 0 && m.done === m.total && sup.done >= sup.target,
  };
}

// Pace is judged against the day, not against a bare percentage. 35 percent on
// day 8 is blocked; 35 percent on day 3 is fine.
export function paceOf(hire, docs, mods, kit) {
  if (hire.cleared_for_caseload) return { key: 'ok', label: 'Cleared', why: 'Full caseload' };

  const started = hire.start_date && daysUntil(hire.start_date) <= 0;
  const contactGap = daysSince(hire.last_contact_at);
  const k = kitProgress(kit);

  if (hire.stage === 'offer_out') {
    return { key: 'behind', label: 'Offer out', why: 'Awaiting response' };
  }
  if (hasNoStartDate(hire)) {
    return { key: 'blocked', label: 'Drifting', why: 'No start date' };
  }
  if (started && k.issued === 0) {
    return { key: 'blocked', label: 'No kit', why: 'Working unequipped' };
  }
  const overdueDoc = docs.find(d => d.is_required && !d.is_complete && d.due_date
    && daysUntil(d.due_date) !== null && daysUntil(d.due_date) <= 1);
  if (overdueDoc) {
    return { key: 'blocked', label: 'Deadline', why: `${overdueDoc.label} due` };
  }
  if (!hire.acknowledged && contactGap === null) {
    return { key: 'blocked', label: 'No contact', why: 'Never contacted' };
  }
  if (contactGap !== null && contactGap >= 4) {
    return { key: 'behind', label: 'Silent', why: `${contactGap} days no reply` };
  }
  const m = moduleProgress(mods);
  if (m.idleDays !== null && m.idleDays >= 5) {
    return { key: 'behind', label: 'Idle', why: `${m.idleDays} days no activity` };
  }
  const soon = daysUntil(hire.start_date);
  if (soon !== null && soon >= 0 && soon <= 7 && !docProgress(docs).complete) {
    return { key: 'blocked', label: 'Docs open', why: `Starts in ${soon} days` };
  }
  return { key: 'ok', label: 'On track', why: STAGE_LABEL[hire.stage] || '' };
}

export const PACE_COLOR = {
  ok:      { fg: 'var(--green)',  bg: 'rgba(5,150,105,0.10)' },
  behind:  { fg: 'var(--yellow)', bg: 'rgba(217,119,6,0.12)' },
  blocked: { fg: 'var(--danger)', bg: 'rgba(220,38,38,0.10)' },
};
