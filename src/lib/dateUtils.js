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
  return `${y}-${m}-${day}`;
}

export function formatShortDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function getWeekDays(anchor) {
  const start = new Date(anchor);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
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
