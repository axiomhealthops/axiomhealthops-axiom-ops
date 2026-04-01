import React, { useState, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { REGIONS } from '../../lib/constants';
 
const STATUS_COLORS = {
  completed: { bg: '#ECFDF5', color: '#065F46', border: '#6EE7B7' },
  scheduled: { bg: '#EFF6FF', color: '#1E40AF', border: '#93C5FD' },
  missed: { bg: '#FEF3C7', color: '#92400E', border: '#FCD34D' },
  cancelled: { bg: '#FEF2F2', color: '#991B1B', border: '#FCA5A5' },
};
 
function getStatusStyle(status) {
  const s = status?.toLowerCase() || '';
  if (s.includes('completed')) return STATUS_COLORS.completed;
  if (s.includes('scheduled')) return STATUS_COLORS.scheduled;
  if (s.includes('missed')) return STATUS_COLORS.missed;
  if (s.includes('cancelled')) return STATUS_COLORS.cancelled;
  return { bg: '#F9FAFB', color: '#374151', border: '#E5E7EB' };
}
 
function parseDate(raw) {
  if (!raw) return null;
  const clean = raw.replace(/"/g, '').trim();
  if (!clean) return null;
  // MM/DD/YYYY or M/D/YYYY
  const mdy = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return new Date(parseInt(mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2]));
  // YYYY-MM-DD
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
  // fallback
  const d = new Date(clean);
  return isNaN(d.getTime()) ? null : d;
}
 
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
 
function formatDate(d) {
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}
 
function getWeekDays(anchor) {
  const start = new Date(anchor);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}
 
function getMonthDays(anchor) {
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
 
export default function VisitSchedulePage() {
  const visits = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('axiom_pariox_data') || '[]');
    } catch { return []; }
  }, []);
 
  const [view, setView] = useState('week');
  const [anchor, setAnchor] = useState(new Date());
  const [regionFilter, setRegionFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedDay, setSelectedDay] = useState(null);
 
  const validRegions = ['A','B','C','G','H','J','M','N','T','V'];
 
  const visitsWithDates = useMemo(() => {
    return visits.map(v => ({
      ...v,
      parsedDate: parseDate(v.raw_date),
    })).filter(v => v.parsedDate);
  }, [visits]);
 
  const filtered = useMemo(() => {
    return visitsWithDates.filter(v => {
      if (regionFilter !== 'ALL' && v.region !== regionFilter) return false;
      if (statusFilter !== 'ALL' && !v.status?.toLowerCase().includes(statusFilter)) return false;
      return true;
    });
  }, [visitsWithDates, regionFilter, statusFilter]);
 
  const visitsByDate = useMemo(() => {
    const map = {};
    filtered.forEach(v => {
      const key = toDateStr(v.parsedDate);
      if (!map[key]) map[key] = [];
      map[key].push(v);
    });
    return map;
  }, [filtered]);
 
  function navigate(dir) {
    const d = new Date(anchor);
    if (view === 'day') d.setDate(d.getDate() + dir);
    else if (view === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setAnchor(d);
    setSelectedDay(null);
  }
 
  function goToday() {
    setAnchor(new Date());
    setSelectedDay(null);
  }
 
  const todayStr = toDateStr(new Date());
  const totalFiltered = filtered.length;
  const completedCount = filtered.filter(v => v.status?.toLowerCase().includes('completed')).length;
  const scheduledCount = filtered.filter(v => v.status?.toLowerCase().includes('scheduled')).length;
 
  const detailDate = selectedDay || (view === 'day' ? toDateStr(anchor) : null);
  const detailVisits = detailDate ? (visitsByDate[detailDate] || []) : [];
 
  function ViewLabel() {
    if (view === 'day') return <span>{formatDate(anchor)}</span>;
    if (view === 'week') {
      const days = getWeekDays(anchor);
      return <span>{formatDate(days[0])} – {formatDate(days[6])}</span>;
    }
    return (
      <span>
        {anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
      </span>
    );
  }
 
  if (visits.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <TopBar title="Visit Schedule" subtitle="Day · Week · Month calendar view" />
        <div style={S.empty}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📅</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--black)', marginBottom: 8 }}>
            No visit data
          </div>
          <div style={{ color: 'var(--gray)', fontSize: 14 }}>
            Upload your Pariox visit schedule in Data Uploads
          </div>
        </div>
      </div>
    );
  }
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Visit Schedule"
        subtitle={`${totalFiltered} visits · ${completedCount} completed · ${scheduledCount} scheduled`}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
 
        <div style={S.controls}>
          <div style={S.navGroup}>
            <button onClick={() => navigate(-1)} style={S.navBtn}>←</button>
            <button onClick={goToday} style={S.todayBtn}>Today</button>
            <button onClick={() => navigate(1)} style={S.navBtn}>→</button>
            <span style={S.viewLabel}><ViewLabel /></span>
          </div>
          <div style={S.rightControls}>
            <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} style={S.select}>
              <option value="ALL">All Regions</option>
              {validRegions.map(r => (
                <option key={r} value={r}>Region {r} — {REGIONS[r]}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={S.select}>
              <option value="ALL">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="scheduled">Scheduled</option>
              <option value="missed">Missed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <div style={S.viewToggle}>
              {['day', 'week', 'month'].map(v => (
                <button
                  key={v}
                  onClick={() => { setView(v); setSelectedDay(null); }}
                  style={{ ...S.toggleBtn, ...(view === v ? S.toggleActive : {}) }}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
 
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 20px' }}>
 
            {view === 'day' && (() => {
              const dateStr = toDateStr(anchor);
              const dayVisits = visitsByDate[dateStr] || [];
              return (
                <div>
                  <div style={S.dayHeader}>
                    <span style={S.dayTitle}>{formatDate(anchor)}</span>
                    <span style={S.dayCount}>{dayVisits.length} visits</span>
                  </div>
                  {dayVisits.length === 0 ? (
                    <div style={S.noVisits}>No visits on this day</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {dayVisits.map((v, i) => {
                        const st = getStatusStyle(v.status);
                        return (
                          <div key={i} style={{
                            ...S.visitCard,
                            borderLeft: `3px solid ${st.border}`,
                            background: st.bg,
                          }}>
                            <div style={S.visitRow}>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>
                                  {v.patient_name}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>
                                  {v.staff_name} · {v.discipline} · {v.event_type}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <span style={{
                                  ...S.pill,
                                  background: st.bg,
                                  color: st.color,
                                  border: `1px solid ${st.border}`,
                                }}>
                                  {v.status}
                                </span>
                                <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>
                                  Region {v.region} · {v.visit_time || '—'}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
 
            {view === 'week' && (() => {
              const days = getWeekDays(anchor);
              return (
                <div style={S.weekGrid}>
                  {days.map(d => {
                    const ds = toDateStr(d);
                    const dv = visitsByDate[ds] || [];
                    const isToday = ds === todayStr;
                    const isSelected = ds === selectedDay;
                    const completed = dv.filter(v => v.status?.toLowerCase().includes('completed')).length;
                    const scheduled = dv.filter(v => v.status?.toLowerCase().includes('scheduled')).length;
                    return (
                      <div
                        key={ds}
                        onClick={() => setSelectedDay(isSelected ? null : ds)}
                        style={{
                          ...S.weekDay,
                          border: isSelected ? '2px solid var(--red)' : isToday ? '2px solid var(--blue)' : '1px solid var(--border)',
                          background: isSelected ? '#FFF5F3' : 'var(--card-bg)',
                        }}
                      >
                        <div style={S.weekDayHeader}>
                          <span style={{
                            ...S.weekDayName,
                            color: isToday ? 'var(--blue)' : 'var(--gray)',
                          }}>
                            {d.toLocaleDateString('en-US', { weekday: 'short' })}
                          </span>
                          <span style={{
                            ...S.weekDayNum,
                            color: isToday ? 'var(--blue)' : 'var(--black)',
                            fontWeight: isToday ? 700 : 600,
                          }}>
                            {d.getDate()}
                          </span>
                        </div>
                        {dv.length > 0 ? (
                          <>
                            <div style={S.weekCount}>{dv.length} visits</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                              {completed > 0 && (
                                <div style={{ ...S.weekPill, background: '#ECFDF5', color: '#065F46' }}>
                                  ✓ {completed} done
                                </div>
                              )}
                              {scheduled > 0 && (
                                <div style={{ ...S.weekPill, background: '#EFF6FF', color: '#1E40AF' }}>
                                  ◷ {scheduled} sched.
                                </div>
                              )}
                              {dv.slice(0, 3).map((v, i) => (
                                <div key={i} style={S.weekVisitRow}>
                                  {v.patient_name?.split(',')[0]}
                                </div>
                              ))}
                              {dv.length > 3 && (
                                <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 2 }}>
                                  +{dv.length - 3} more
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize: 11, color: 'var(--border)', marginTop: 8 }}>—</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
 
            {view === 'month' && (() => {
              const days = getMonthDays(anchor);
              const weekLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
              return (
                <div>
                  <div style={S.monthWeekLabels}>
                    {weekLabels.map(l => (
                      <div key={l} style={S.monthWeekLabel}>{l}</div>
                    ))}
                  </div>
                  <div style={S.monthGrid}>
                    {days.map(({ date, thisMonth }, i) => {
                      const ds = toDateStr(date);
                      const dv = visitsByDate[ds] || [];
                      const isToday = ds === todayStr;
                      const isSelected = ds === selectedDay;
                      return (
                        <div
                          key={i}
                          onClick={() => dv.length > 0 && setSelectedDay(isSelected ? null : ds)}
                          style={{
                            ...S.monthCell,
                            opacity: thisMonth ? 1 : 0.35,
                            border: isSelected ? '2px solid var(--red)' : isToday ? '2px solid var(--blue)' : '1px solid var(--border)',
                            cursor: dv.length > 0 ? 'pointer' : 'default',
                            background: isSelected ? '#FFF5F3' : 'var(--card-bg)',
                          }}
                        >
                          <div style={{
                            ...S.monthNum,
                            color: isToday ? '#fff' : 'var(--black)',
                            background: isToday ? 'var(--blue)' : 'transparent',
                          }}>
                            {date.getDate()}
                          </div>
                          {dv.length > 0 && (
                            <div style={S.monthDot}>
                              <span style={S.monthCount}>{dv.length}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
 
          {detailDate && detailVisits.length > 0 && view !== 'day' && (
            <div style={S.detailPanel}>
              <div style={S.detailHeader}>
                <div>
                  <div style={S.detailDate}>
                    {new Date(detailDate + 'T12:00:00').toLocaleDateString('en-US', {
                      weekday: 'long', month: 'long', day: 'numeric',
                    })}
                  </div>
                  <div style={S.detailCount}>{detailVisits.length} visits</div>
                </div>
                <button onClick={() => setSelectedDay(null)} style={S.closeBtn}>✕</button>
              </div>
              <div style={{ overflow: 'auto', flex: 1 }}>
                {detailVisits.map((v, i) => {
                  const st = getStatusStyle(v.status);
                  return (
                    <div key={i} style={{ ...S.detailVisit, borderLeft: `3px solid ${st.border}` }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>
                        {v.patient_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 3 }}>
                        {v.staff_name} · {v.discipline}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                        <span style={{
                          ...S.pill,
                          background: st.bg,
                          color: st.color,
                          border: `1px solid ${st.border}`,
                        }}>
                          {v.status}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--gray)' }}>Region {v.region}</span>
                        {v.visit_time && (
                          <span style={{ fontSize: 11, color: 'var(--gray)' }}>{v.visit_time}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
 
const S = {
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  controls: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 20px', borderBottom: '1px solid var(--border)',
    background: 'var(--card-bg)', flexShrink: 0, flexWrap: 'wrap', gap: 10,
  },
  navGroup: { display: 'flex', alignItems: 'center', gap: 8 },
  navBtn: {
    padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6,
    background: 'var(--card-bg)', fontSize: 14, cursor: 'pointer', color: 'var(--black)',
  },
  todayBtn: {
    padding: '6px 14px', border: '1px solid var(--border)', borderRadius: 6,
    background: 'var(--card-bg)', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', color: 'var(--black)',
  },
  viewLabel: { fontSize: 15, fontWeight: 600, color: 'var(--black)', marginLeft: 8 },
  rightControls: { display: 'flex', alignItems: 'center', gap: 10 },
  select: {
    padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6,
    fontSize: 12, background: 'var(--card-bg)', color: 'var(--black)', outline: 'none',
  },
  viewToggle: {
    display: 'flex', background: 'var(--bg)', borderRadius: 6,
    padding: 2, border: '1px solid var(--border)',
  },
  toggleBtn: {
    padding: '5px 14px', border: 'none', borderRadius: 5,
    fontSize: 12, fontWeight: 500, cursor: 'pointer', background: 'none', color: 'var(--gray)',
  },
  toggleActive: {
    background: 'var(--card-bg)', color: 'var(--black)',
    fontWeight: 700, boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  dayHeader: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', padding: '16px 0 12px',
  },
  dayTitle: { fontSize: 18, fontWeight: 700, color: 'var(--black)' },
  dayCount: { fontSize: 13, color: 'var(--gray)' },
  noVisits: { textAlign: 'center', padding: 40, color: 'var(--gray)', fontSize: 14 },
  visitCard: { padding: '12px 16px', borderRadius: 8, marginBottom: 2 },
  visitRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  pill: { padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 },
  weekGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 8, padding: '16px 0',
  },
  weekDay: { borderRadius: 10, padding: '12px', cursor: 'pointer', transition: 'all 0.15s', minHeight: 120 },
  weekDayHeader: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 8 },
  weekDayName: { fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' },
  weekDayNum: { fontSize: 20, lineHeight: 1.2 },
  weekCount: { fontSize: 11, fontWeight: 700, color: 'var(--black)', textAlign: 'center' },
  weekPill: { borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 600, textAlign: 'center' },
  weekVisitRow: {
    fontSize: 10, color: 'var(--gray)',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '1px 0',
  },
  monthWeekLabels: {
    display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 4, marginBottom: 4, paddingTop: 12,
  },
  monthWeekLabel: {
    textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--gray)',
    textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 0',
  },
  monthGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 },
  monthCell: { borderRadius: 6, padding: '6px', minHeight: 60, transition: 'all 0.1s' },
  monthNum: {
    width: 22, height: 22, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 600, marginBottom: 4,
  },
  monthDot: { display: 'flex', alignItems: 'center', gap: 2 },
  monthCount: {
    fontSize: 11, fontWeight: 700, color: 'var(--red)',
    background: '#FFF5F3', padding: '1px 6px', borderRadius: 4,
  },
  detailPanel: {
    width: 320, borderLeft: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column',
    background: 'var(--card-bg)', flexShrink: 0,
  },
  detailHeader: {
    padding: '16px 20px', borderBottom: '1px solid var(--border)',
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'flex-start', flexShrink: 0,
  },
  detailDate: { fontSize: 14, fontWeight: 700, color: 'var(--black)' },
  detailCount: { fontSize: 12, color: 'var(--gray)', marginTop: 2 },
  closeBtn: { background: 'none', border: 'none', fontSize: 14, color: 'var(--gray)', cursor: 'pointer', padding: 2 },
  detailVisit: { padding: '14px 20px', borderBottom: '1px solid var(--border)' },
};
 
