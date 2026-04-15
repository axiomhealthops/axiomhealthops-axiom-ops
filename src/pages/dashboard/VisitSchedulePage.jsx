import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import TopBar from '../../components/TopBar';
import { REGIONS } from '../../lib/constants';
import { parseVisitDate, toDateStr, formatShortDate, getWeekDays, getMonthDays } from '../../lib/dateUtils';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
 
var SC = {
  completed: { bg: '#ECFDF5', color: '#065F46', border: '#6EE7B7' },
  scheduled: { bg: '#EFF6FF', color: '#1E40AF', border: '#93C5FD' },
  missed: { bg: '#FEF3C7', color: '#92400E', border: '#FCD34D' },
  cancelled: { bg: '#FEF2F2', color: '#991B1B', border: '#FCA5A5' },
  def: { bg: '#F9FAFB', color: '#374151', border: '#E5E7EB' },
};
 
function getSS(status) {
  var s = status ? status.toLowerCase() : '';
  if (s.includes('completed')) return SC.completed;
  if (s.includes('scheduled')) return SC.scheduled;
  if (s.includes('missed')) return SC.missed;
  if (s.includes('cancelled')) return SC.cancelled;
  return SC.def;
}
 
var VALID = ['A','B','C','G','H','J','M','N','T','V'];
var BTN = { padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--card-bg)', fontSize: 14, cursor: 'pointer', color: 'var(--black)' };
var SEL = { padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--card-bg)', color: 'var(--black)', outline: 'none' };
 
function getViewVisits(view, anchor, byDate, filtered) {
  if (view === 'day') {
    var ds = anchor.getFullYear() + '-' + String(anchor.getMonth()+1).padStart(2,'0') + '-' + String(anchor.getDate()).padStart(2,'0');
    return byDate[ds] || [];
  }
  if (view === 'week') {
    var days = getWeekDays(anchor);
    var result = [];
    days.forEach(function(d) {
      var k = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      if (byDate[k]) result = result.concat(byDate[k]);
    });
    return result;
  }
  return filtered;
}
 
function StatsBar(props) {
  var viewVisits = getViewVisits(props.view, props.anchor, props.byDate, props.filtered);
  var comp = viewVisits.filter(function(v) { return v.status && v.status.toLowerCase().includes('completed'); }).length;
  var sched = viewVisits.filter(function(v) { return v.status && v.status.toLowerCase().includes('scheduled'); }).length;
  var missed = viewVisits.filter(function(v) { return v.status && v.status.toLowerCase().includes('missed'); }).length;
  var cancel = viewVisits.filter(function(v) { return v.status && v.status.toLowerCase().includes('cancelled'); }).length;
  var total = viewVisits.length;
  var compPct = total > 0 ? Math.round((comp / total) * 100) : 0;
  var items = [
    { label: 'Total', val: total, color: 'var(--black)', key: null },
    { label: 'Completed', val: comp, color: 'var(--green)', key: 'completed' },
    { label: 'Scheduled', val: sched, color: 'var(--blue)', key: 'scheduled' },
    { label: 'Missed', val: missed, color: 'var(--yellow)', key: 'missed' },
    { label: 'Cancelled', val: cancel, color: 'var(--danger)', key: 'cancelled' },
    { label: 'Completion %', val: compPct + '%', color: compPct >= 80 ? 'var(--green)' : compPct >= 60 ? 'var(--yellow)' : 'var(--danger)', key: null },
  ];
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--card-bg)', flexShrink: 0 }}>
      {items.map(function(item) {
        var isActive = props.activeFilter === item.key && item.key !== null;
        return (
          <div key={item.label}
            onClick={function() { if (item.key) props.onFilter(isActive ? null : item.key); }}
            style={{ flex: 1, padding: '10px 16px', borderRight: '1px solid var(--border)', textAlign: 'center', cursor: item.key ? 'pointer' : 'default', background: isActive ? '#FFF5F3' : 'transparent', borderBottom: isActive ? '3px solid var(--red)' : '3px solid transparent', transition: 'all 0.15s' }}>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: item.color }}>{item.val}</div>
            <div style={{ fontSize: 10, color: isActive ? 'var(--red)' : 'var(--gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>{item.label}</div>
          </div>
        );
      })}
    </div>
  );
}
 
function DrillDown(props) {
  var label = props.statusKey.charAt(0).toUpperCase() + props.statusKey.slice(1);
  var viewVisits = getViewVisits(props.view, props.anchor, props.byDate, props.filtered);
  var allVisits = viewVisits.filter(function(v) { return v.status && v.status.toLowerCase().includes(props.statusKey); });
 
  var [search, setSearch] = useState('');
  var [clinFilter, setClinFilter] = useState('ALL');
  var [sortBy, setSortBy] = useState('date');
  var [expandedRegions, setExpandedRegions] = useState({});
 
  function toggleRegion(r) {
    setExpandedRegions(function(prev) {
      var next = Object.assign({}, prev);
      next[r] = !prev[r];
      return next;
    });
  }
 
  var filtered = allVisits.filter(function(v) {
    if (!search) return true;
    var q = search.toLowerCase();
    return (v.patient_name && v.patient_name.toLowerCase().includes(q)) ||
           (v.staff_name && v.staff_name.toLowerCase().includes(q)) ||
           (v.region && v.region.toLowerCase().includes(q));
  });
 
  // Group by region
  var byRegion = {};
  filtered.forEach(function(v) {
    var r = v.region || '?';
    if (!byRegion[r]) byRegion[r] = [];
    byRegion[r].push(v);
  });
 
  // Sort within each region
  var regionKeys = Object.keys(byRegion).sort();
  regionKeys.forEach(function(r) {
    byRegion[r].sort(function(a, b) {
      if (sortBy === 'clinician') return (a.staff_name || '').localeCompare(b.staff_name || '');
      if (sortBy === 'patient') return (a.patient_name || '').localeCompare(b.patient_name || '');
      return (a.raw_date || '').localeCompare(b.raw_date || '');
    });
  });
 
  var st = getSS(props.statusKey);
 
  return (
    <div style={{ borderBottom: '2px solid var(--border)', background: 'var(--bg)', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid var(--border)', background: '#FFF5F3', flexWrap: 'wrap', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>
          {label} Visits — {filtered.length} of {allVisits.length} across {regionKeys.length} regions
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            placeholder="Search patient, clinician..."
            value={search}
            onChange={function(e) { setSearch(e.target.value); }}
            style={{ padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', width: 200, background: 'var(--card-bg)' }}
          />
          <select value={sortBy} onChange={function(e) { setSortBy(e.target.value); }}
            style={{ padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)' }}>
            <option value="date">Sort: Date</option>
            <option value="patient">Sort: Patient</option>
            <option value="clinician">Sort: Clinician</option>
          </select>
          <button onClick={props.onClose}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: 'var(--gray)', cursor: 'pointer' }}>
            Close
          </button>
        </div>
      </div>
 
      <div style={{ maxHeight: 320, overflow: 'auto' }}>
        {regionKeys.length === 0 ? (
          <div style={{ padding: '20px', color: 'var(--gray)', fontSize: 13, textAlign: 'center' }}>No results found.</div>
        ) : regionKeys.map(function(r) {
          var visits = byRegion[r];
          var isExpanded = expandedRegions[r] !== false;
          var coordinator = REGIONS[r] || 'Unassigned';
          return (
            <div key={r} style={{ borderBottom: '1px solid var(--border)' }}>
              <div
                onClick={function() { toggleRegion(r); }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px', background: 'var(--card-bg)', cursor: 'pointer', userSelect: 'none' }}>
                <span style={{ fontSize: 11, fontWeight: 700, background: st.bg, color: st.color, border: '1px solid ' + st.border, borderRadius: 5, padding: '2px 8px', minWidth: 70, textAlign: 'center' }}>
                  Region {r}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--black)' }}>{coordinator}</span>
                <span style={{ fontSize: 11, color: 'var(--gray)', marginLeft: 4 }}>{visits.length} {label.toLowerCase()} visit{visits.length !== 1 ? 's' : ''}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--gray)' }}>{isExpanded ? '▲ collapse' : '▼ expand'}</span>
              </div>
 
              {isExpanded && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#F8F4F3' }}>
                      <th style={TH}>Patient</th>
                      <th style={TH}>Clinician</th>
                      <th style={TH}>Discipline</th>
                      <th style={TH}>Event</th>
                      <th style={TH}>Date</th>
                      <th style={TH}>Time</th>
                      <th style={TH}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visits.map(function(v, i) {
                      var vst = getSS(v.status);
                      return (
                        <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#FAFAFA', borderTop: '1px solid var(--border)' }}>
                          <td style={TD}><span style={{ fontWeight: 600, color: 'var(--black)' }}>{v.patient_name}</span></td>
                          <td style={TD}>{v.staff_name}</td>
                          <td style={TD}>{v.discipline}</td>
                          <td style={TD}>{v.event_type}</td>
                          <td style={{ ...TD, fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{v.raw_date}</td>
                          <td style={{ ...TD, fontFamily: 'DM Mono, monospace' }}>{v.visit_time || '—'}</td>
                          <td style={TD}>
                            <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: vst.bg, color: vst.color, border: '1px solid ' + vst.border, whiteSpace: 'nowrap' }}>
                              {v.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
 
var TH = { padding: '6px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' };
var TD = { padding: '8px 16px', color: 'var(--gray)', borderRight: '1px solid var(--border)', fontSize: 12, whiteSpace: 'nowrap' };
 
export default function VisitSchedulePage() {
  var [visits, setVisits] = useState([]);
  var [loading, setLoading] = useState(true);
  var [view, setView] = useState('week');
  var [anchor, setAnchor] = useState(new Date());
  var [regionFilter, setRegionFilter] = useState('ALL');
  var [statusFilter, setStatusFilter] = useState('ALL');
  var [selectedDay, setSelectedDay] = useState(null);
  var [statusClick, setStatusClick] = useState(null);
  var [clinFilter, setClinFilter] = useState('ALL');

  // Fetch visits from Supabase for a ±45-day window around the current anchor.
  // Uses .range() pagination in 1000-row chunks because PostgREST silently
  // caps .limit(N) at 1000 regardless of the value requested. Without
  // pagination the page would truncate at 1000 rows and potentially show
  // only old completed visits while missing the current week entirely.
  // Region scoping — super admin sees all; everyone else is limited to
  // their assigned regions.
  var regionScope = useAssignedRegions();

  var fetchVisits = useCallback(function(anchorDate) {
    setLoading(true);
    // Fail closed for users with no regions assigned.
    if (!regionScope.isAllAccess && (!regionScope.regions || regionScope.regions.length === 0)) {
      setVisits([]);
      setLoading(false);
      return;
    }
    var d = anchorDate || new Date();
    var from = new Date(d); from.setDate(d.getDate() - 45);
    var to   = new Date(d); to.setDate(d.getDate() + 45);
    var toLocal = function(x) { return [x.getFullYear(), String(x.getMonth()+1).padStart(2,'0'), String(x.getDate()).padStart(2,'0')].join('-'); };
    var fromStr = toLocal(from);
    var toStr   = toLocal(to);
    var PAGE = 1000;
    var all = [];
    var pull = function(offset) {
      var q = supabase.from('visit_schedule_data')
        .select('patient_name,staff_name,staff_name_normalized,visit_date,status,event_type,region,discipline,insurance,visit_time')
        .gte('visit_date', fromStr)
        .lte('visit_date', toStr)
        .order('visit_date', { ascending: false })
        .range(offset, offset + PAGE - 1);
      q = regionScope.applyToQuery(q);
      return q.then(function(res) {
          if (res.error || !res.data || res.data.length === 0) return all;
          for (var i = 0; i < res.data.length; i++) all.push(res.data[i]);
          if (res.data.length < PAGE) return all;
          return pull(offset + PAGE);
        });
    };
    pull(0).then(function(rows) {
      setVisits(rows || []);
      setLoading(false);
    });
  }, [regionScope.isAllAccess, JSON.stringify(regionScope.regions)]);

  useEffect(function() {
    if (regionScope.loading) return;
    fetchVisits(anchor);
  }, [regionScope.loading, fetchVisits]);

  var withDates = useMemo(function() {
    return visits.map(function(v) {
      // visits from Supabase have visit_date as ISO string (YYYY-MM-DD)
      var pd = v.visit_date ? new Date(v.visit_date + 'T00:00:00') : null;
      return Object.assign({}, v, { pd: pd, raw_date: v.visit_date });
    }).filter(function(v) { return v.pd && !isNaN(v.pd); });
  }, [visits]);
 
  var allClinicians = useMemo(function() {
    var seen = new Set();
    visits.forEach(function(v) { if (v.staff_name_normalized) seen.add(v.staff_name_normalized); else if (v.staff_name) seen.add(v.staff_name); });
    return Array.from(seen).sort();
  }, [visits]);

  var filtered = useMemo(function() {
    return withDates.filter(function(v) {
      if (regionFilter !== 'ALL' && v.region !== regionFilter) return false;
      if (statusFilter !== 'ALL' && v.status && !v.status.toLowerCase().includes(statusFilter)) return false;
      if (clinFilter !== 'ALL') {
        var vClin = v.staff_name_normalized || v.staff_name || '';
        if (vClin !== clinFilter) return false;
      }
      return true;
    });
  }, [withDates, regionFilter, statusFilter, clinFilter]);
 
  var byDate = useMemo(function() {
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
    setStatusClick(null);
    fetchVisits(d);
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
 
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <TopBar title="Visit Schedule" subtitle="Loading..." />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)', fontSize: 14 }}>
          Loading visit schedule...
        </div>
      </div>
    );
  }

  if (loading && !visits.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <TopBar title="Visit Schedule" subtitle="Loading..." />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)', fontSize: 14 }}>
          Loading visit schedule...
        </div>
      </div>
    );
  }

  if (!visits.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <TopBar title="Visit Schedule" subtitle="Day · Week · Month" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>&#128197;</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--black)', marginBottom: 8 }}>No visit data</div>
          <div style={{ color: 'var(--gray)', fontSize: 14 }}>Upload your Pariox visit schedule in Data Uploads</div>
        </div>
      </div>
    );
  }
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Visit Schedule" subtitle={`${filtered.length} visits · ${completedCount} completed · ${scheduledCount} scheduled`} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
 
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--card-bg)', flexShrink: 0, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={function() { nav(-1); }} style={BTN}>&#8592;</button>
            <button onClick={function() { var t = new Date(); setAnchor(t); setSelectedDay(null); setStatusClick(null); fetchVisits(t); }} style={BTN}>Today</button>
            <button onClick={function() { nav(1); }} style={BTN}>&#8594;</button>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--black)', marginLeft: 8 }}>{getViewLabel()}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <select value={regionFilter} onChange={function(e) { setRegionFilter(e.target.value); setClinFilter('ALL'); }} style={SEL}>
              <option value="ALL">All Regions</option>
              {VALID.map(function(r) { return React.createElement('option', { key: r, value: r }, 'Region ' + r + ' \u2014 ' + (REGIONS[r] || '')); })}
            </select>
            <select value={clinFilter} onChange={function(e) { setClinFilter(e.target.value); }} style={{ ...SEL, maxWidth: 200 }}>
              <option value="ALL">All Clinicians</option>
              {allClinicians.map(function(c) { return React.createElement('option', { key: c, value: c }, c); })}
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
                  <button key={v} onClick={function() { setView(v); setSelectedDay(null); setStatusClick(null); }}
                    style={{ padding: '5px 14px', border: 'none', borderRadius: 5, fontSize: 12, fontWeight: view === v ? 700 : 500, cursor: 'pointer', background: view === v ? 'var(--card-bg)' : 'none', color: view === v ? 'var(--black)' : 'var(--gray)' }}>
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
 
        <StatsBar
          view={view}
          anchor={anchor}
          byDate={byDate}
          filtered={filtered}
          activeFilter={statusClick}
          onFilter={function(k) { setStatusClick(k); setSelectedDay(null); }}
        />
 
        {statusClick && (
          <DrillDown
            statusKey={statusClick}
            view={view}
            anchor={anchor}
            byDate={byDate}
            filtered={filtered}
            onClose={function() { setStatusClick(null); }}
          />
        )}
 
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
                      <div key={ds} onClick={function() { setSelectedDay(isSel ? null : ds); setStatusClick(null); }}
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
                              {sched > 0 && <div style={{ borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 600, textAlign: 'center', background: '#EFF6FF', color: '#1E40AF' }}>{sched} sched.</div>}
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
                        <div key={i} onClick={function() { if (dv.length > 0) { setSelectedDay(isSel ? null : ds); setStatusClick(null); } }}
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
 
