import React, { useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { METRICS, REGIONS, EXPANSION } from '../../lib/constants';
 
export default function ExecutiveReportPage() {
  var visits = useMemo(function() {
    try { return JSON.parse(localStorage.getItem('axiom_pariox_data') || '[]'); } catch (e) { return []; }
  }, []);
 
  var census = useMemo(function() {
    try { return JSON.parse(localStorage.getItem('axiom_census') || '[]'); } catch (e) { return []; }
  }, []);
 
  var today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  var validRegions = ['A','B','C','G','H','J','M','N','T','V'];
 
  var completed = visits.filter(function(v) { return v.status && v.status.toLowerCase().includes('completed'); }).length;
  var total = visits.length;
  var pct = total > 0 ? Math.round((total / METRICS.WEEKLY_VISIT_TARGET) * 100) : 0;
  var estRevenue = completed * METRICS.AVG_REIMBURSEMENT;
 
  var regionBreakdown = useMemo(function() {
    var map = {};
    visits.forEach(function(v) {
      if (!validRegions.includes(v.region)) return;
      if (!map[v.region]) map[v.region] = { total: 0, completed: 0, scheduled: 0 };
      map[v.region].total++;
      if (v.status && v.status.toLowerCase().includes('completed')) map[v.region].completed++;
      if (v.status && v.status.toLowerCase().includes('scheduled')) map[v.region].scheduled++;
    });
    return Object.entries(map).sort(function(a, b) { return a[0].localeCompare(b[0]); });
  }, [visits]);
 
  var censusRegion = useMemo(function() {
    var map = {};
    census.forEach(function(p) {
      if (!validRegions.includes(p.region)) return;
      map[p.region] = (map[p.region] || 0) + 1;
    });
    return map;
  }, [census]);
 
  var TH = { display: 'grid', gridTemplateColumns: '0.8fr 1.5fr 0.8fr 1fr 1fr 1fr 1.2fr', padding: '10px 20px', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', background: 'var(--bg)', borderBottom: '1px solid var(--border)' };
  var TR = { display: 'grid', gridTemplateColumns: '0.8fr 1.5fr 0.8fr 1fr 1fr 1fr 1.2fr', padding: '12px 20px', alignItems: 'center', borderBottom: '1px solid var(--border)' };
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Executive Report"
        subtitle={today}
        actions={
          <button onClick={function() { window.print(); }} style={{ padding: '8px 16px', background: 'var(--black)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            &#128438; Print / Export
          </button>
        }
      />
      <div style={{ padding: 28, flex: 1, overflow: 'auto' }}>
 
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32, paddingBottom: 24, borderBottom: '2px solid var(--black)' }}>
          <div style={{ width: 48, height: 48, borderRadius: 10, background: 'var(--red)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, flexShrink: 0 }}>A</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--black)', letterSpacing: '-0.4px' }}>AxiomHealth Management</div>
            <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 3 }}>Weekly Operations Executive Summary \u00b7 {today}</div>
          </div>
        </div>
 
        <div style={{ marginBottom: 36 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>KEY PERFORMANCE INDICATORS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {[
              { label: 'Total Visits', value: total.toLocaleString(), pct: pct, target: METRICS.WEEKLY_VISIT_TARGET.toLocaleString() + ' target', color: pct >= 80 ? 'var(--green)' : 'var(--red)' },
              { label: 'Completed', value: completed.toLocaleString(), pct: total > 0 ? Math.round((completed / total) * 100) : 0, target: total + ' total visits', color: 'var(--green)' },
              { label: 'Active Census', value: census.filter(function(p) { return validRegions.includes(p.region); }).length.toLocaleString(), pct: Math.round((census.length / METRICS.CENSUS_TARGET) * 100), target: METRICS.CENSUS_TARGET + ' target', color: 'var(--blue)' },
              { label: 'Est. Revenue', value: '$' + estRevenue.toLocaleString(), pct: Math.min(Math.round((estRevenue / METRICS.REVENUE_TARGET) * 100), 100), target: '$' + METRICS.REVENUE_TARGET.toLocaleString() + ' target', color: 'var(--blue)' },
            ].map(function(k) {
              return (
                <div key={k.label} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{k.label}</div>
                  <div style={{ fontSize: 30, fontWeight: 700, fontFamily: 'DM Mono, monospace', letterSpacing: '-0.5px', lineHeight: 1, marginBottom: 12, color: k.color }}>{k.value}</div>
                  <div style={{ height: 6, background: 'var(--border)', borderRadius: 999, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ height: '100%', width: Math.min(k.pct, 100) + '%', background: k.color, borderRadius: 999 }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--gray)' }}>{k.pct}% \u00b7 {k.target}</div>
                </div>
              );
            })}
          </div>
        </div>
 
        {regionBreakdown.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>REGION PERFORMANCE</div>
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={TH}>
                <span>Region</span><span>Coordinator</span><span>Census</span>
                <span>Total Visits</span><span>Completed</span><span>Scheduled</span><span>Completion Rate</span>
              </div>
              {regionBreakdown.map(function(item) {
                var region = item[0];
                var data = item[1];
                var rate = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
                return (
                  <div key={region} style={TR}>
                    <span><span style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>Region {region}</span></span>
                    <span style={{ fontSize: 13, color: 'var(--gray)' }}>{REGIONS[region] || '\u2014'}</span>
                    <span style={{ fontSize: 14, fontFamily: 'DM Mono, monospace', color: 'var(--gray)' }}>{censusRegion[region] || 0}</span>
                    <span style={{ fontSize: 14, fontFamily: 'DM Mono, monospace', color: 'var(--gray)' }}>{data.total}</span>
                    <span style={{ fontSize: 14, fontFamily: 'DM Mono, monospace', color: 'var(--green)', fontWeight: 700 }}>{data.completed}</span>
                    <span style={{ fontSize: 14, fontFamily: 'DM Mono, monospace', color: 'var(--gray)' }}>{data.scheduled}</span>
                    <span style={{ fontSize: 14, fontFamily: 'DM Mono, monospace', fontWeight: 700, color: rate >= 80 ? 'var(--green)' : rate >= 60 ? 'var(--yellow)' : 'var(--danger)' }}>{rate}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
 
        <div style={{ marginBottom: 36 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>EXPANSION STATUS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {EXPANSION.map(function(e) {
              return (
                <div key={e.state} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--black)', marginBottom: 4 }}>{e.state}</div>
                  <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 12 }}>{e.status}</div>
                  <div style={{ height: 8, background: 'var(--border)', borderRadius: 999, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ height: '100%', width: e.credentialing + '%', background: 'var(--blue)', borderRadius: 999 }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--gray)' }}>{e.credentialing}% credentialed \u00b7 {e.staffHired} staff \u00b7 Target {e.target}</div>
                </div>
              );
            })}
          </div>
        </div>
 
        <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--gray)', textAlign: 'center' }}>
          Generated by AxiomHealth Operations Platform \u00b7 {today} \u00b7 Prepared by Liam O'Brien, Director of Operations
        </div>
      </div>
    </div>
  );
}
 
