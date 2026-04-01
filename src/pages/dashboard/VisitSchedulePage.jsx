import React, { useState, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { REGIONS } from '../../lib/constants';
import { parseVisitDate, toDateStr, formatShortDate, getWeekDays, getMonthDays } from '../../lib/dateUtils';
 
const SC = {
  completed: { bg: '#ECFDF5', color: '#065F46', border: '#6EE7B7' },
  scheduled: { bg: '#EFF6FF', color: '#1E40AF', border: '#93C5FD' },
  missed: { bg: '#FEF3C7', color: '#92400E', border: '#FCD34D' },
  cancelled: { bg: '#FEF2F2', color: '#991B1B', border: '#FCA5A5' },
  def: { bg: '#F9FAFB', color: '#374151', border: '#E5E7EB' },
};
 
function getSS(status) {
  const s = status ? status.toLowerCase() : '';
  if (s.includes('completed')) return SC.completed;
  if (s.includes('scheduled')) return SC.scheduled;
  if (s.includes('missed')) return SC.missed;
  if (s.includes('cancelled')) return SC.cancelled;
  return SC.def;
}
 
const VALID = ['A','B','C','G','H','J','M','N','T','V'];
const BTN = { padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--card-bg)', fontSize: 14, cursor: 'pointer', color: 'var(--black)' };
const SEL = { padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--card-bg)', color: 'var(--black)', outline: 'none' };

function StatsBar({ visits, view, anchor, byDate, todayStr, getWeekDays }) {
  var viewVisits = visits;
  if (view === 'day') {
    var ds = todayStr;
    try { ds = anchor.getFullYear() + '-' + String(anchor.getMonth()+1).padStart(2,'0') + '-' + String(anchor.getDate()).padStart(2,'0'); } catch(e) {}
    viewVisits = byDate[ds] || [];
  } else if (view === 'week') {
    var days = getWeekDays(anchor);
    var weekKeys = days.map(function(d) {
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    });
    viewVisits = [];
    weekKeys.forEach(function(k) { if (byDate[k]) viewVisits = viewVisits.concat(byDate[k]); });
  }
  var comp = viewVisits.filter(function(v) { return v.status && v.status.toLowerCase().includes('completed'); }).length;
  var sched = viewVisits.filter(function(v) { return v.status && v.status.toLowerCase().includes('scheduled'); }).length;
  var missed = viewVisits.filter(function(v) { return v.status && v.status.toLowerCase().includes('missed'); }).length;
  var cancel = viewVisits.filter(function(v) { return v.status && v.status.toLowerCase().includes('cancelled'); }).length;
  var total = viewVisits.length;
  var compPct = total > 0 ? Math.round((comp / total) * 100) : 0;
  var items = [
    { label: 'Total', val: total, color: 'var(--black)' },
    { label: 'Completed', val: comp, color: 'var(--green)' },
    { label: 'Scheduled', val: sched, color: 'var(--blue)' },
    { label: 'Missed', val: missed, color: 'var(--yellow)' },
    { label: 'Cancelled', val: cancel, color: 'var(--danger)' },
    { label: 'Completion Rate', val: compPct + '%', color: compPct >= 80 ? 'var(--green)' : compPct >= 60 ? 'var(--yellow)' : 'var(--danger)' },
  ];
  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', background: 'var(--card-bg)', flexShrink: 0 }}>
      {items.map(function(item) {
        return (
          <div key={item.label} style={{ flex: 1, padding: '10px 16px', borderRight: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: item.color }}>{item.val}</div>
            <div style={{ fontSize: 10, color: 'var(--gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>{item.label}</div>
          </div>
        );
      })}
    </div>
  );
}
export default function VisitSchedulePage() {
  const visits = useMemo(function() {
    try { return JSON.parse(localStorage.getItem('axiom_pariox_data') || '[]'); }
    catch (e) { return []; }
  }, []);
 
  const [view, setView] = useState('week');
  const [anchor, setAnchor] = useState(new Date());
  const [regionFilter, setRegionFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedDay, setSelectedDay] = useState(null);
 
  const withDates = useMemo(function() {
    return visits.map(function(v) {
      return Object.assign({}, v, { pd: parseVisitDate(v.raw_date) });
    }).filter(function(v) { return v.pd; });
  }, [visits]);
 
  const filtered = useMemo(function() {
    return withDates.filter(function(v) {
      if (regionFilter !== 'ALL' && v.region !== regionFilter) return false;
      if (statusFilter !== 'ALL' && v.status && !v.status.toLowerCase().includes(statusFilter)) return false;
      return true;
    });
  }, [withDates, regionFilter, statusFilter]);
 
  const byDate = useMemo(function() {
    var map = {};
    filtered.forEach(function(v) {
      var k = toDateStr(v.pd);
      if (!map[k]) map[k] = [];
      map[k].push(v);
    });
    return map;
  }, [filtered]);
 
  function nav(dir) {
    var d = new Date(anchor);
    if (view === 'day') d.setDate(d.getDate() + dir);
    else if (view === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setAnchor(d);
    setSelectedDay(null);
  }
 
  var todayStr = toDateStr(new Date());
  var detailDate = selectedDay || (view === 'day' ? toDateStr(anchor) : null);
  var detailVisits = detailDate ? (byDate[detailDate] || []) : [];
  var completedCount = filtered.filter(function(v) { return v.status && v.status.toLowerCase().includes('completed'); }).length;
  var scheduledCount = filtered.filter(function(v) { return v.status && v.status.toLowerCase().includes('scheduled'); }).length;
 
  function getViewLabel() {
    if (view === 'day') return formatShortDate(anchor);
    if (view === 'week') {
      var days = getWeekDays(anchor);
      return formatShortDate(days[0]) + ' \u2013 ' + formatShortDate(days[6]);
    }
    return anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
 
  if (!visits.length) {
    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
      React.createElement(TopBar, { title: 'Visit Schedule', subtitle: 'Day \u00b7 Week \u00b7 Month' }),
      React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } },
        React.createElement('div', { style: { fontSize: 32, marginBottom: 12 } }, '\uD83D\uDCC5'),
        React.createElement('div', { style: { fontSize: 18, fontWeight: 600, color: 'var(--black)', marginBottom: 8 } }, 'No visit data'),
        React.createElement('div', { style: { color: 'var(--gray)', fontSize: 14 } }, 'Upload your Pariox visit schedule in Data Uploads')
      )
    );
  }
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Visit Schedule" subtitle={filtered.length + ' visits \u00b7 ' + completedCount + ' completed \u00b7 ' + scheduledCount + ' scheduled'} />
<StatsBar visits={filtered} view={view} anchor={anchor} byDate={byDate} todayStr={todayStr} getWeekDays={getWeekDays} />
     <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--card-bg)', flexShrink: 0, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={function() { nav(-1); }} style={BTN}>&#8592;</button>
            <button onClick={function() { setAnchor(new Date()); setSelectedDay(null); }} style={BTN}>Today</button>
            <button onClick={function() { nav(1); }} style={BTN}>&#8594;</button>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--black)', marginLeft: 8 }}>{getViewLabel()}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <select value={regionFilter} onChange={function(e) { setRegionFilter(e.target.value); }} style={SEL}>
              <option value="ALL">All Regions</option>
              {VALID.map(function(r) { return React.createElement('option', { key: r, value: r }, 'Region ' + r + ' \u2014 ' + (REGIONS[r] || '')); })}
            </select>
            <select value={statusFilter} onChange={function(e) { setStatusFilter(e.target.value); }} style={SEL}>
              <option value="ALL">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="scheduled">Scheduled</option>
              <option value="missed">Missed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <div style={{ display: 'flex', background: 'var(--bg)', borderRadius: 6, padding: 2, border: '1px solid var(--border)' }}>
              {['day','week','month'].map(function(v) {
                return (
                  <button key={v} onClick={function() { setView(v); setSelectedDay(null); }}
                    style={{ padding: '5px 14px', border: 'none', borderRadius: 5, fontSize: 12, fontWeight: view === v ? 700 : 500, cursor: 'pointer', background: view === v ? 'var(--card-bg)' : 'none', color: view === v ? 'var(--black)' : 'var(--gray)' }}>
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
 
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 20px' }}>
 
            {view === 'day' && (function() {
              var ds = toDateStr(anchor);
              var dv = byDate[ds] || [];
              return (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0 12px' }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--black)' }}>{formatShortDate(anchor)}</span>
                    <span style={{ fontSize: 13, color: 'var(--gray)' }}>{dv.length} visits</span>
                  </div>
                  {dv.length === 0
                    ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)', fontSize: 14 }}>No visits on this day</div>
                    : dv.map(function(v, i) {
                        var st = getSS(v.status);
                        return (
                          <div key={i} style={{ padding: '12px 16px', borderRadius: 8, marginBottom: 6, borderLeft: '3px solid ' + st.border, background: st.bg }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>{v.patient_name}</div>
                                <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>{v.staff_name} · {v.discipline} · {v.event_type}</div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color, border: '1px solid ' + st.border }}>{v.status}</span>
                                <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>Region {v.region} · {v.visit_time || '—'}</div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                  }
                </div>
              );
            })()}
 
            {view === 'week' && (function() {
              var days = getWeekDays(anchor);
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, padding: '16px 0' }}>
                  {days.map(function(d) {
                    var ds = toDateStr(d);
                    var dv = byDate[ds] || [];
                    var isToday = ds === todayStr;
                    var isSel = ds === selectedDay;
                    var comp = dv.filter(function(v) { return v.status && v.status.toLowerCase().includes('completed'); }).length;
                    var sched = dv.filter(function(v) { return v.status && v.status.toLowerCase().includes('scheduled'); }).length;
                    return (
                      <div key={ds} onClick={function() { setSelectedDay(isSel ? null : ds); }}
                        style={{ borderRadius: 10, padding: 12, cursor: 'pointer', minHeight: 120, border: isSel ? '2px solid var(--red)' : isToday ? '2px solid var(--blue)' : '1px solid var(--border)', background: isSel ? '#FFF5F3' : 'var(--card-bg)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: isToday ? 'var(--blue)' : 'var(--gray)' }}>
                            {d.toLocaleDateString('en-US', { weekday: 'short' })}
                          </span>
                          <span style={{ fontSize: 20, fontWeight: isToday ? 700 : 600, color: isToday ? 'var(--blue)' : 'var(--black)' }}>{d.getDate()}</span>
                        </div>
                        {dv.length > 0 ? (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--black)', textAlign: 'center' }}>{dv.length} visits</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                              {comp > 0 && <div style={{ borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 600, textAlign: 'center', background: '#ECFDF5', color: '#065F46' }}>&#10003; {comp} done</div>}
                              {sched > 0 && <div style={{ borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 600, textAlign: 'center', background: '#EFF6FF', color: '#1E40AF' }}>&#9711; {sched} sched.</div>}
                              {dv.slice(0, 3).map(function(v, i) {
                                return <div key={i} style={{ fontSize: 10, color: 'var(--gray)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.patient_name ? v.patient_name.split(',')[0] : ''}</div>;
                              })}
                              {dv.length > 3 && <div style={{ fontSize: 10, color: 'var(--gray)' }}>+{dv.length - 3} more</div>}
                            </div>
                          </div>
                        ) : <div style={{ fontSize: 11, color: 'var(--border)', marginTop: 8 }}>—</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
 
            {view === 'month' && (function() {
              var days = getMonthDays(anchor);
              var weekLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
              return (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4, paddingTop: 12 }}>
                    {weekLabels.map(function(l) {
                      return <div key={l} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 0' }}>{l}</div>;
                    })}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                    {days.map(function(item, i) {
                      var date = item.date;
                      var thisMonth = item.thisMonth;
                      var ds = toDateStr(date);
                      var dv = byDate[ds] || [];
                      var isToday = ds === todayStr;
                      var isSel = ds === selectedDay;
                      return (
                        <div key={i} onClick={function() { if (dv.length > 0) setSelectedDay(isSel ? null : ds); }}
                          style={{ borderRadius: 6, padding: 6, minHeight: 60, opacity: thisMonth ? 1 : 0.35, cursor: dv.length > 0 ? 'pointer' : 'default', border: isSel ? '2px solid var(--red)' : isToday ? '2px solid var(--blue)' : '1px solid var(--border)', background: isSel ? '#FFF5F3' : 'var(--card-bg)' }}>
                          <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, marginBottom: 4, color: isToday ? '#fff' : 'var(--black)', background: isToday ? 'var(--blue)' : 'transparent' }}>
                            {date.getDate()}
                          </div>
                          {dv.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)', background: '#FFF5F3', padding: '1px 6px', borderRadius: 4 }}>{dv.length}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
 
          {detailDate && detailVisits.length > 0 && view !== 'day' && (
            <div style={{ width: 320, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--card-bg)', flexShrink: 0 }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--black)' }}>
                    {new Date(detailDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>{detailVisits.length} visits</div>
                </div>
                <button onClick={function() { setSelectedDay(null); }} style={{ background: 'none', border: 'none', fontSize: 14, color: 'var(--gray)', cursor: 'pointer', padding: 2 }}>&#10005;</button>
              </div>
              <div style={{ overflow: 'auto', flex: 1 }}>
                {detailVisits.map(function(v, i) {
                  var st = getSS(v.status);
                  return (
                    <div key={i} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', borderLeft: '3px solid ' + st.border }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>{v.patient_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 3 }}>{v.staff_name} · {v.discipline}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color, border: '1px solid ' + st.border }}>{v.status}</span>
                        <span style={{ fontSize: 11, color: 'var(--gray)' }}>Region {v.region}</span>
                        {v.visit_time && <span style={{ fontSize: 11, color: 'var(--gray)' }}>{v.visit_time}</span>}
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
