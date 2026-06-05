export function parseVisitDate(raw) {
  if (!raw) return null;
  const clean = String(raw).replace(/"/g, '').trim();
  if (!clean) return null;
  const mdy = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return new Date(parseInt(mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2]));
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
  const d = new Date(clean);
  return isNaN(d.getTime()) ? null : d;
}
 
export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
 
export function formatShortDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
 
export function getWeekDays(anchor) {
  const start = new Date(anchor);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, function(_, i) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

// =====================================================================
// Canonical week-range helpers — added 2026-05-17 per Liam.
// EdemaCare's work week is SUNDAY → SATURDAY (NOT Mon-Sun).
// Always use these helpers in dashboards/reports so weeks stay aligned
// across the whole system. Never hand-roll the day-of-week math again.
// =====================================================================

/**
 * Returns the Sunday at the start of the work week containing `date`.
 * Local timezone (avoids UTC drift at night).
 *
 * @param {Date|string} date — anchor date (today by default)
 * @param {number} [weeksOffset=0] — 0 = current week, 1 = last week, etc.
 * @returns {Date} Sunday at 00:00:00 local time
 */
export function getWeekStart(date, weeksOffset = 0) {
  const d = date instanceof Date
    ? new Date(date.getTime())
    : (date ? new Date(date + 'T00:00:00') : new Date());
  // getDay() returns 0=Sun, 1=Mon, ... 6=Sat — perfect for Sun-start week
  d.setDate(d.getDate() - d.getDay() - (weeksOffset || 0) * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns the Saturday at the end of the work week containing `date`.
 *
 * @param {Date|string} date — anchor date
 * @param {number} [weeksOffset=0] — 0 = current week, 1 = last week, etc.
 * @returns {Date} Saturday at 23:59:59 local time
 */
export function getWeekEnd(date, weeksOffset = 0) {
  const start = getWeekStart(date, weeksOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Convenience wrapper returning both ends of the week + string forms
 * + a human-readable label like "May 17 – May 23, 2026".
 *
 * @param {Date|string} date — anchor date
 * @param {number} [weeksOffset=0] — 0 = current week, 1 = last week, etc.
 * @returns {{start: Date, end: Date, startStr: string, endStr: string, label: string}}
 */
export function getWeekRange(date, weeksOffset = 0) {
  const start = getWeekStart(date, weeksOffset);
  const end = getWeekEnd(date, weeksOffset);
  return {
    start: start,
    end: end,
    startStr: toDateStr(start),
    endStr: toDateStr(end),
    label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
         + ' – '
         + end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}
 
// =====================================================================
// Multi-mode period range helper — added 2026-06-05 for the Payer +
// Marketing Report (Yvonne Flores). Reused anywhere a dashboard needs
// to swap between Week / Month / Quarter / YTD windows. Week mode
// delegates to getWeekRange() to keep Sun-Sat semantics consistent.
//
// Returns { start, end, startStr, endStr, label, mode } where dates are
// local-time and string forms are YYYY-MM-DD for SQL filters.
// =====================================================================
/**
 * @param {'week'|'month'|'quarter'|'ytd'} mode
 * @param {Date|string} anchor - date inside the desired window. Defaults to today.
 */
export function getPeriodRange(mode, anchor) {
  const today = new Date();
  const a = anchor instanceof Date
    ? new Date(anchor.getTime())
    : (anchor ? new Date(anchor + 'T00:00:00') : new Date(today.getTime()));

  if (mode === 'week') {
    return { ...getWeekRange(a, 0), mode: 'week' };
  }

  if (mode === 'month') {
    const start = new Date(a.getFullYear(), a.getMonth(), 1);
    const end = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
    return {
      start, end,
      startStr: toDateStr(start),
      endStr: toDateStr(end),
      label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      mode: 'month',
    };
  }

  if (mode === 'quarter') {
    const q = Math.floor(a.getMonth() / 3); // 0..3
    const start = new Date(a.getFullYear(), q * 3, 1);
    const end = new Date(a.getFullYear(), q * 3 + 3, 0);
    end.setHours(23, 59, 59, 999);
    return {
      start, end,
      startStr: toDateStr(start),
      endStr: toDateStr(end),
      label: `Q${q + 1} ${a.getFullYear()}`,
      mode: 'quarter',
    };
  }

  // ytd — Jan 1 of anchor year through today (or Dec 31 if anchor is past year)
  const yStart = new Date(a.getFullYear(), 0, 1);
  const isCurrentYear = a.getFullYear() === today.getFullYear();
  const yEnd = isCurrentYear
    ? new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)
    : new Date(a.getFullYear(), 11, 31, 23, 59, 59, 999);
  return {
    start: yStart, end: yEnd,
    startStr: toDateStr(yStart),
    endStr: toDateStr(yEnd),
    label: isCurrentYear ? `${a.getFullYear()} YTD` : `${a.getFullYear()}`,
    mode: 'ytd',
  };
}

export function getMonthDays(anchor) {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const days = [];
  const startDay = start.getDay();
  for (let i = 0; i < startDay; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() - (startDay - i));
    days.push({ date: d, thisMonth: false });
  }
  for (let i = 1; i <= end.getDate(); i++) {
    days.push({ date: new Date(anchor.getFullYear(), anchor.getMonth(), i), thisMonth: true });
  }
  while (days.length % 7 !== 0) {
    const last = days[days.length - 1].date;
    const d = new Date(last);
    d.setDate(last.getDate() + 1);
    days.push({ date: d, thisMonth: false });
  }
  return days;
}
 
