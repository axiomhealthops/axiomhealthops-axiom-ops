import React, { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { REGIONS } from '../../lib/constants';
 
var TARGETS = { ft: 25, pt: 15, prn: 10 };
var TYPE_LABELS = { ft: 'Full Time', pt: 'Part Time', prn: 'PRN / 1099' };
var VALID_REGIONS = ['A','B','C','G','H','J','M','N','T','V','All'];
 
function parioxToFirstLast(raw) {
  if (!raw) return '';
  var s = raw.trim();
  if (s.includes(',')) {
    var idx = s.indexOf(',');
    var last = s.substring(0, idx).trim();
    var first = s.substring(idx + 1).trim();
    return first + ' ' + last;
  }
  return s;
}
 
function buildNameMap(clinicians) {
  var map = {};
  clinicians.forEach(function(c) {
    map[c.full_name.toLowerCase()] = c.id;
    if (c.pariox_name) {
      map[c.pariox_name.trim().toLowerCase()] = c.id;
      map[parioxToFirstLast(c.pariox_name).toLowerCase()] = c.id;
    }
  });
  return map;
}
 
function getBarColor(pct, type) {
  if (type === 'prn') return pct >= 100 ? '#DC2626' : '#3B82F6';
  if (pct >= 90) return '#10B981';
  if (pct >= 70) return '#F59E0B';
  return '#DC2626';
}
 
function getStatusLabel(pct, type) {
  if (type === 'prn') return pct >= 100 ? 'Alert' : 'Active';
  if (pct >= 90) return 'On Track';
  if (pct >= 70) return 'At Risk';
  return 'Low';
}
 
function getStatusColors(pct, type) {
  if (type === 'prn') return pct >= 100 ? { color: '#991B1B', bg: '#FEF2F2' } : { color: '#1E40AF', bg: '#EFF6FF' };
  if (pct >= 90) return { color: '#065F46', bg: '#ECFDF5' };
  if (pct >= 70) return { color: '#92400E', bg: '#FEF3C7' };
  return { color: '#991B1B', bg: '#FEF2F2' };
}
 
export default function ProductivityPage() {
  var visits = useMemo(function() {
    try { return JSON.parse(localStorage.getItem('axiom_pariox_data') || '[]'); }
    catch (e) { return []; }
  }, []);
 
  var [clinicians, setClinicians] = useState([]);
  var [loading, setLoading] = useState(true);
  var [regionFilter, setRegionFilter] = useState('ALL');
  var [typeFilter, setTypeFilter] = useState('ALL');
  var [sortBy, setSortBy] = useState('region');
  var [search, setSearch] = useState('');
 
  useEffect(function() {
    supabase.from('clinicians')
      .select('id, full_name, discipline, employment_type, region, notes, pariox_name, is_active')
      .eq('is_active', true)
      .order('region')
      .order('full_name')
      .then(function(res) {
        setClinicians(res.data || []);
        setLoading(false);
      });
  }, []);
 
  var nameMap = useMemo(function() { return buildNameMap(clinicians); }, [clinicians]);
 
  var statsByClinicianId = useMemo(function() {
    var map = {};
    visits.forEach(function(v) {
      var rawName = (v.staff_name || '').trim();
      if (!rawName) return;
      var id = nameMap[rawName.toLowerCase()] ||
               nameMap[parioxToFirstLast(rawName).toLowerCase()];
      if (!id) return;
      if (!map[id]) map[id] = { completed: 0, scheduled: 0, missed: 0, cancelled: 0, evals: 0, reassessments: 0, missedActive: 0 };
      var s = (v.status || '').toLowerCase();
      var e = (v.event_type || '').toLowerCase();
      if (s === 'missed (active)') map[id].missedActive++;
      else if (s.includes('completed')) map[id].completed++;
      else if (s.includes('scheduled')) map[id].scheduled++;
      else if (s.includes('missed')) map[id].missed++;
      else if (s.includes('cancelled')) map[id].cancelled++;
      if (e.includes('evaluation') && !e.includes('reassess') && !e.includes('re-assess')) map[id].evals++;
      if (e.includes('reassess') || e.includes('re-assess') || e.includes('recert')) map[id].reassessments++;
    });
    return map;
  }, [visits, nameMap]);
 
  var enriched = useMemo(function() {
    return clinicians.map(function(c) {
      var stats = statsByClinicianId[c.id] || { completed: 0, scheduled: 0, missed: 0, cancelled: 0, evals: 0, reassessments: 0, missedActive: 0 };
      var target = TARGETS[c.employment_type] || 25;
      var done = stats.completed;
      // Total visits assigned this week = completed + scheduled + missed + cancelled + missedActive
      var totalAssigned = done + stats.scheduled + stats.missed + stats.cancelled + stats.missedActive;
      var pct = target > 0 ? Math.round((done / target) * 100) : 0;
      // Projected: if they complete all scheduled too
      var projected = target > 0 ? Math.min(Math.round(((done + stats.scheduled) / target) * 100), 100) : 0;
      return Object.assign({}, c, { stats: stats, target: target, done: done, pct: pct, projected: projected, totalAssigned: totalAssigned });
    });
  }, [clinicians, statsByClinicianId]);
 
  var filtered = useMemo(function() {
    return enriched.filter(function(c) {
      if (regionFilter !== 'ALL' && c.region !== regionFilter) return false;
      if (typeFilter !== 'ALL' && c.employment_type !== typeFilter) return false;
      if (search) {
        var q = search.toLowerCase();
        if (!c.full_name.toLowerCase().includes(q) && !(c.discipline || '').toLowerCase().includes(q)) return false;
      }
      return true;
    }).sort(function(a, b) {
      if (sortBy === 'pct') return a.pct - b.pct;
      if (sortBy === 'pct_desc') return b.pct - a.pct;
      if (sortBy === 'name') return a.full_name.localeCompare(b.full_name);
      if (sortBy === 'region') return (a.region || '').localeCompare(b.region || '');
      return 0;
    });
  }, [enriched, regionFilter, typeFilter, search, sortBy]);
 
  var summary = useMemo(function() {
    var ft = enriched.filter(function(c) { return c.employment_type === 'ft'; });
    var pt = enriched.filter(function(c) { return c.employment_type === 'pt'; });
    var prn = enriched.filter(function(c) { return c.employment_type === 'prn'; });
    var avg = function(arr) { return arr.length > 0 ? Math.round(arr.reduce(function(a, c) { return a + c.pct; }, 0) / arr.length) : 0; };
    var totalCompleted = enriched.reduce(function(a, c) { return a + c.done; }, 0);
    var totalScheduled = enriched.reduce(function(a, c) { return a + c.stats.scheduled; }, 0);
    var totalMissedActive = enriched.reduce(function(a, c) { return a + c.stats.missedActive; }, 0);
    return {
      ft: { count: ft.length, avg: avg(ft), atRisk: ft.filter(function(c) { return c.pct < 70 && c.done > 0; }).length },
      pt: { count: pt.length, avg: avg(pt), atRisk: pt.filter(function(c) { return c.pct < 70 && c.done > 0; }).length },
      prn: { count: prn.length, alerted: prn.filter(function(c) { return c.pct >= 100; }).length },
      totalCompleted: totalCompleted,
      totalScheduled: totalScheduled,
      totalMissedActive: totalMissedActive,
    };
  }, [enriched]);
 
  var matchedCount = enriched.filter(function(c) { return c.totalAssigned > 0; }).length;
  var SEL = { padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--card-bg)', color: 'var(--black)', outline: 'none' };
 
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <TopBar title="Productivity Tracker" subtitle="Loading clinicians..." />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)', fontSize: 14 }}>Loading...</div>
      </div>
    );
  }
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Productivity Tracker"
        subtitle={filtered.length + ' clinicians \u00b7 Week of ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
 
        {/* Summary Strip */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--card-bg)', flexShrink: 0 }}>
          <div style={{ flex: 1, padding: '12px 20px', borderRight: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Completed This Week</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--green)', marginTop: 3 }}>{summary.totalCompleted}</div>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>across all clinicians</div>
          </div>
          <div style={{ flex: 1, padding: '12px 20px', borderRight: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Scheduled Remaining</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--blue)', marginTop: 3 }}>{summary.totalScheduled}</div>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>visits still on calendar</div>
          </div>
          <div style={{ flex: 1, padding: '12px 20px', borderRight: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Notes Not Submitted</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: summary.totalMissedActive > 0 ? 'var(--danger)' : 'var(--green)', marginTop: 3 }}>{summary.totalMissedActive}</div>
            <div style={{ fontSize: 11, color: summary.totalMissedActive > 0 ? 'var(--danger)' : 'var(--gray)', marginTop: 2, fontWeight: summary.totalMissedActive > 0 ? 600 : 400 }}>{summary.totalMissedActive > 0 ? 'Cannot bill — follow up now' : 'All notes submitted'}</div>
          </div>
          <div style={{ flex: 1, padding: '12px 20px', borderRight: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Full Time Avg ({summary.ft.count})</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: summary.ft.avg >= 80 ? 'var(--green)' : summary.ft.avg >= 60 ? 'var(--yellow)' : 'var(--danger)', marginTop: 3 }}>{summary.ft.avg}%</div>
            {summary.ft.atRisk > 0 && <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600, marginTop: 2 }}>{summary.ft.atRisk} below 70%</div>}
          </div>
          <div style={{ flex: 1, padding: '12px 20px', borderRight: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Part Time Avg ({summary.pt.count})</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: summary.pt.avg >= 80 ? 'var(--green)' : summary.pt.avg >= 60 ? 'var(--yellow)' : 'var(--danger)', marginTop: 3 }}>{summary.pt.avg}%</div>
            {summary.pt.atRisk > 0 && <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600, marginTop: 2 }}>{summary.pt.atRisk} below 70%</div>}
          </div>
          <div style={{ flex: 1, padding: '12px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>PRN Alerted ({summary.prn.count})</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: summary.prn.alerted > 0 ? 'var(--danger)' : 'var(--blue)', marginTop: 3 }}>{summary.prn.alerted}</div>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>at 10+ visit threshold</div>
          </div>
        </div>
 
        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Search clinician or discipline..." value={search}
            onChange={function(e) { setSearch(e.target.value); }}
            style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', minWidth: 200 }} />
          <select value={regionFilter} onChange={function(e) { setRegionFilter(e.target.value); }} style={SEL}>
            <option value="ALL">All Regions</option>
            {VALID_REGIONS.map(function(r) {
              return React.createElement('option', { key: r, value: r }, r === 'All' ? 'Virtual / All Regions' : 'Region ' + r + ' \u2014 ' + (REGIONS[r] || ''));
            })}
          </select>
          <select value={typeFilter} onChange={function(e) { setTypeFilter(e.target.value); }} style={SEL}>
            <option value="ALL">All Employment Types</option>
            <option value="ft">Full Time (target: 25/wk)</option>
            <option value="pt">Part Time (target: 15/wk)</option>
            <option value="prn">PRN / 1099 (alert at: 10)</option>
          </select>
          <select value={sortBy} onChange={function(e) { setSortBy(e.target.value); }} style={SEL}>
            <option value="region">Sort: Region</option>
            <option value="pct">Sort: Lowest Productivity First</option>
            <option value="pct_desc">Sort: Highest Productivity First</option>
            <option value="name">Sort: Name A-Z</option>
          </select>
          <span style={{ fontSize: 12, color: visits.length === 0 ? 'var(--danger)' : 'var(--gray)', marginLeft: 'auto', fontWeight: visits.length === 0 ? 600 : 400 }}>
            {visits.length === 0 ? '\u26A0 Upload visit data to see live productivity' : visits.length + ' visits loaded \u00b7 ' + matchedCount + ' clinicians matched'}
          </span>
        </div>
 
        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          {visits.length === 0 && (
            <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 10, padding: '14px 20px', marginBottom: 16, fontSize: 13, color: '#92400E', fontWeight: 500 }}>
              No visit data loaded. Go to Data Uploads and upload your Pariox visit schedule.
            </div>
          )}
 
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.6fr 0.6fr 0.9fr 2.2fr 0.7fr 0.8fr 0.7fr 0.6fr 0.6fr 0.6fr 0.9fr', padding: '8px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <span>Clinician</span>
              <span>Region</span>
              <span>Disc.</span>
              <span>Type</span>
              <span>Week Progress</span>
              <span style={{ color: '#065F46' }}>Done</span>
              <span style={{ color: '#1565C0' }}>Sched.</span>
              <span>Target</span>
              <span>Evals</span>
              <span>Re-Asmt</span>
              <span style={{ color: '#DC2626' }}>Note\u26A0</span>
              <span>Status</span>
            </div>
 
            {filtered.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>No clinicians match your filters.</div>
            )}
 
            {filtered.map(function(c, i) {
              var sc = getStatusColors(c.pct, c.employment_type);
              var barColor = getBarColor(c.pct, c.employment_type);
              var label = getStatusLabel(c.pct, c.employment_type);
              var isAlert = c.employment_type === 'prn' && c.pct >= 100;
              var hasMissedActive = c.stats.missedActive > 0;
              var hasData = c.totalAssigned > 0;
              // Progress bar shows: completed (solid) + scheduled (lighter)
              var completedWidth = c.target > 0 ? Math.min((c.done / c.target) * 100, 100) : 0;
              var scheduledWidth = c.target > 0 ? Math.min((c.stats.scheduled / c.target) * 100, 100 - completedWidth) : 0;
 
              return (
                <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '2fr 0.6fr 0.6fr 0.9fr 2.2fr 0.7fr 0.8fr 0.7fr 0.6fr 0.6fr 0.6fr 0.9fr', padding: '10px 20px', alignItems: 'center', borderBottom: '1px solid var(--border)', background: isAlert || hasMissedActive ? '#FFF5F5' : i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)' }}>
 
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>{c.full_name}</div>
                    {c.notes && <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 1 }}>{c.notes}</div>}
                  </div>
 
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray)' }}>{c.region === 'All' ? 'Virtual' : 'Rgn ' + c.region}</span>
                  <span style={{ fontSize: 12, color: 'var(--gray)' }}>{c.discipline}</span>
 
                  <span style={{ fontSize: 11, fontWeight: 600, color: c.employment_type === 'ft' ? '#065F46' : c.employment_type === 'pt' ? '#1E40AF' : '#92400E', background: c.employment_type === 'ft' ? '#ECFDF5' : c.employment_type === 'pt' ? '#EFF6FF' : '#FEF3C7', padding: '2px 8px', borderRadius: 999 }}>
                    {TYPE_LABELS[c.employment_type]}
                  </span>
 
                  {/* Dual progress bar: completed + scheduled */}
                  <div>
                    {hasData ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 4 }}>
                          <span style={{ color: 'var(--gray)' }}>
                            <span style={{ color: '#065F46', fontWeight: 700 }}>{c.done} done</span>
                            {c.stats.scheduled > 0 && <span style={{ color: '#1565C0' }}> + {c.stats.scheduled} sched.</span>}
                            {c.stats.missed > 0 && <span style={{ color: '#DC2626' }}> · {c.stats.missed} missed</span>}
                          </span>
                          <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, color: sc.color }}>{c.pct}%</span>
                        </div>
                        <div style={{ height: 8, background: 'var(--border)', borderRadius: 999, overflow: 'hidden', display: 'flex' }}>
                          {completedWidth > 0 && (
                            <div style={{ height: '100%', width: completedWidth + '%', background: barColor, borderRadius: scheduledWidth > 0 ? '999px 0 0 999px' : 999, flexShrink: 0 }} />
                          )}
                          {scheduledWidth > 0 && (
                            <div style={{ height: '100%', width: scheduledWidth + '%', background: '#93C5FD', flexShrink: 0 }} />
                          )}
                        </div>
                        {c.projected > c.pct && (
                          <div style={{ fontSize: 10, color: '#1565C0', marginTop: 3 }}>
                            Projected: {c.projected}% if all scheduled completed
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--gray)', fontStyle: 'italic' }}>
                        {visits.length > 0 ? 'No visits this week' : 'Upload data'}
                      </div>
                    )}
                  </div>
 
                  {/* Done */}
                  <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: hasData ? '#065F46' : 'var(--gray)' }}>
                    {hasData ? c.done : '\u2014'}
                  </span>
 
                  {/* Scheduled */}
                  <span style={{ fontSize: 14, fontWeight: 600, fontFamily: 'DM Mono, monospace', color: c.stats.scheduled > 0 ? '#1565C0' : 'var(--gray)' }}>
                    {hasData ? c.stats.scheduled : '\u2014'}
                  </span>
 
                  {/* Target */}
                  <span style={{ fontSize: 12, color: 'var(--gray)', fontFamily: 'DM Mono, monospace' }}>{c.target}</span>
 
                  {/* Evals */}
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'DM Mono, monospace', color: c.stats.evals > 0 ? '#1565C0' : 'var(--gray)' }}>
                    {c.stats.evals > 0 ? c.stats.evals : '\u2014'}
                  </span>
 
                  {/* Reassessments */}
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'DM Mono, monospace', color: c.stats.reassessments > 0 ? '#7C3AED' : 'var(--gray)' }}>
                    {c.stats.reassessments > 0 ? c.stats.reassessments : '\u2014'}
                  </span>
 
                  {/* Missed Active */}
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: hasMissedActive ? '#DC2626' : 'var(--gray)' }}
                    title="Missed (Active) — note not submitted, cannot bill">
                    {hasMissedActive ? c.stats.missedActive : '\u2014'}
                  </span>
 
                  {/* Status */}
                  <span style={{ fontSize: 11, fontWeight: 700, color: hasData ? sc.color : 'var(--gray)', background: hasData ? sc.bg : 'transparent', padding: '3px 10px', borderRadius: 999 }}>
                    {isAlert ? '\uD83D\uDD34 Alert' : hasMissedActive ? '\uD83D\uDCCB Note Due' : hasData ? label : '\u2014'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
