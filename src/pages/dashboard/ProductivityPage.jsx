import React, { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { REGIONS } from '../../lib/constants';
 
var TARGETS = { ft: 25, pt: 15, prn: 10 };
var TYPE_LABELS = { ft: 'Full Time', pt: 'Part Time', prn: 'PRN / 1099' };
var VALID_REGIONS = ['A','B','C','G','H','J','M','N','T','V','All'];
 
// Convert "Last, First" -> "First Last" to match DB format
function normalizeName(raw) {
  if (!raw) return '';
  var s = raw.trim();
  // If contains comma: "Last, First Middle" -> "First Middle Last"
  if (s.includes(',')) {
    var parts = s.split(',');
    var last = parts[0].trim();
    var first = parts[1] ? parts[1].trim() : '';
    return (first + ' ' + last).trim();
  }
  return s;
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
  var [sortBy, setSortBy] = useState('pct');
  var [search, setSearch] = useState('');
 
  useEffect(function() {
    supabase.from('clinicians')
      .select('*')
      .eq('is_active', true)
      .order('region')
      .order('full_name')
      .then(function(res) {
        setClinicians(res.data || []);
        setLoading(false);
      });
  }, []);
 
  // Build visit map — normalize "Last, First" to "First Last"
  var visitsByClinician = useMemo(function() {
    var map = {};
    visits.forEach(function(v) {
      var rawName = (v.staff_name || '').trim();
      var name = normalizeName(rawName);
      if (!name) return;
      if (!map[name]) map[name] = { completed: 0, scheduled: 0, missed: 0, cancelled: 0, evals: 0, reassessments: 0 };
      var s = (v.status || '').toLowerCase();
      var e = (v.event_type || '').toLowerCase();
      if (s.includes('completed')) map[name].completed++;
      else if (s.includes('scheduled')) map[name].scheduled++;
      else if (s.includes('missed')) map[name].missed++;
      else if (s.includes('cancelled')) map[name].cancelled++;
      if (e.includes('eval') && !e.includes('reassess') && !e.includes('re-eval')) map[name].evals++;
      if (e.includes('reassess') || e.includes('recert') || e.includes('re-eval')) map[name].reassessments++;
    });
    return map;
  }, [visits]);
 
  var enriched = useMemo(function() {
    return clinicians.map(function(c) {
      var stats = visitsByClinician[c.full_name] || { completed: 0, scheduled: 0, missed: 0, cancelled: 0, evals: 0, reassessments: 0 };
      var target = TARGETS[c.employment_type] || 25;
      var done = stats.completed;
      var pct = target > 0 ? Math.round((done / target) * 100) : 0;
      return Object.assign({}, c, { stats: stats, target: target, done: done, pct: pct });
    });
  }, [clinicians, visitsByClinician]);
 
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
    return {
      ft: { count: ft.length, avg: avg(ft), atRisk: ft.filter(function(c) { return c.pct < 70 && c.done > 0; }).length, noData: ft.filter(function(c) { return c.done === 0; }).length },
      pt: { count: pt.length, avg: avg(pt), atRisk: pt.filter(function(c) { return c.pct < 70 && c.done > 0; }).length },
      prn: { count: prn.length, alerted: prn.filter(function(c) { return c.pct >= 100; }).length },
    };
  }, [enriched]);
 
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
      <TopBar
        title="Productivity Tracker"
        subtitle={filtered.length + ' clinicians \u00b7 Week of ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
 
        {/* Summary Strip */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--card-bg)', flexShrink: 0 }}>
          <div style={{ flex: 1, padding: '12px 20px', borderRight: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Full Time ({summary.ft.count}) \u2014 Target: 25</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: summary.ft.avg >= 80 ? 'var(--green)' : summary.ft.avg >= 60 ? 'var(--yellow)' : 'var(--danger)', marginTop: 3 }}>{summary.ft.avg}% avg</div>
            {summary.ft.atRisk > 0 && <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600, marginTop: 2 }}>{summary.ft.atRisk} below 70%</div>}
          </div>
          <div style={{ flex: 1, padding: '12px 20px', borderRight: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Part Time ({summary.pt.count}) \u2014 Target: 15</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: summary.pt.avg >= 80 ? 'var(--green)' : summary.pt.avg >= 60 ? 'var(--yellow)' : 'var(--danger)', marginTop: 3 }}>{summary.pt.avg}% avg</div>
            {summary.pt.atRisk > 0 && <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600, marginTop: 2 }}>{summary.pt.atRisk} below 70%</div>}
          </div>
          <div style={{ flex: 1, padding: '12px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>PRN / 1099 ({summary.prn.count}) \u2014 Alert: 10</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: summary.prn.alerted > 0 ? 'var(--danger)' : 'var(--blue)', marginTop: 3 }}>{summary.prn.alerted} alerted</div>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>at or above 10-visit threshold</div>
          </div>
        </div>
 
        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            placeholder="Search clinician or discipline..."
            value={search}
            onChange={function(e) { setSearch(e.target.value); }}
            style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', minWidth: 200 }}
          />
          <select value={regionFilter} onChange={function(e) { setRegionFilter(e.target.value); }} style={SEL}>
            <option value="ALL">All Regions</option>
            {VALID_REGIONS.map(function(r) {
              return React.createElement('option', { key: r, value: r },
                r === 'All' ? 'Virtual / All Regions' : 'Region ' + r + ' \u2014 ' + (REGIONS[r] || '')
              );
            })}
          </select>
          <select value={typeFilter} onChange={function(e) { setTypeFilter(e.target.value); }} style={SEL}>
            <option value="ALL">All Employment Types</option>
            <option value="ft">Full Time (target: 25/wk)</option>
            <option value="pt">Part Time (target: 15/wk)</option>
            <option value="prn">PRN / 1099 (alert at: 10)</option>
          </select>
          <select value={sortBy} onChange={function(e) { setSortBy(e.target.value); }} style={SEL}>
            <option value="pct">Sort: Lowest Productivity First</option>
            <option value="pct_desc">Sort: Highest Productivity First</option>
            <option value="name">Sort: Name A\u2013Z</option>
            <option value="region">Sort: Region</option>
          </select>
          <span style={{ fontSize: 12, color: visits.length === 0 ? 'var(--danger)' : 'var(--gray)', marginLeft: 'auto', fontWeight: visits.length === 0 ? 600 : 400 }}>
            {visits.length === 0 ? '\u26A0 Upload visit data to see live productivity' : visits.length + ' visits loaded'}
          </span>
        </div>
 
        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
 
          {visits.length === 0 && (
            <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 10, padding: '14px 20px', marginBottom: 16, fontSize: 13, color: '#92400E', fontWeight: 500 }}>
              No visit data loaded. Go to Data Uploads and upload your Pariox visit schedule to see live clinician productivity.
            </div>
          )}
 
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 0.6fr 0.7fr 0.9fr 1.6fr 0.7fr 0.7fr 0.7fr 0.8fr 1fr', padding: '8px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <span>Clinician</span>
              <span>Region</span>
              <span>Disc.</span>
              <span>Type</span>
              <span>Progress This Week</span>
              <span>Done</span>
              <span>Target</span>
              <span>Evals</span>
              <span>Re-Assess</span>
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
              var hasData = c.done > 0;
              return (
                <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '2.2fr 0.6fr 0.7fr 0.9fr 1.6fr 0.7fr 0.7fr 0.7fr 0.8fr 1fr', padding: '10px 20px', alignItems: 'center', borderBottom: '1px solid var(--border)', background: isAlert ? '#FFF5F5' : i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>{c.full_name}</div>
                    {c.notes && <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 1 }}>{c.notes}</div>}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray)' }}>
                    {c.region === 'All' ? 'Virtual' : 'Rgn ' + c.region}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--gray)' }}>{c.discipline}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: c.employment_type === 'ft' ? '#065F46' : c.employment_type === 'pt' ? '#1E40AF' : '#92400E',
                    background: c.employment_type === 'ft' ? '#ECFDF5' : c.employment_type === 'pt' ? '#EFF6FF' : '#FEF3C7',
                    padding: '2px 8px', borderRadius: 999,
                  }}>
                    {TYPE_LABELS[c.employment_type]}
                  </span>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--gray)', marginBottom: 4 }}>
                      <span>{hasData ? c.done + ' visits' : 'No data'}</span>
                      <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, color: hasData ? sc.color : 'var(--gray)' }}>{c.pct}%</span>
                    </div>
                    <div style={{ height: 7, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: Math.min(c.pct, 100) + '%', background: hasData ? barColor : 'var(--border)', borderRadius: 999, transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: hasData ? 'var(--black)' : 'var(--gray)' }}>{c.done}</span>
                  <span style={{ fontSize: 12, color: 'var(--gray)', fontFamily: 'DM Mono, monospace' }}>{c.target}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'DM Mono, monospace', color: c.stats.evals > 0 ? '#1565C0' : 'var(--gray)' }}>{c.stats.evals}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'DM Mono, monospace', color: c.stats.reassessments > 0 ? '#7C3AED' : 'var(--gray)' }}>{c.stats.reassessments}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: hasData ? sc.color : 'var(--gray)', background: hasData ? sc.bg : 'var(--bg)', padding: '3px 10px', borderRadius: 999 }}>
                    {!hasData ? 'No Data' : isAlert ? '\uD83D\uDD34 Alert' : label}
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
 
