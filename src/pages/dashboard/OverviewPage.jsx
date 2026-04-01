import React, { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import StatCard from '../../components/StatCard';
import { supabase } from '../../lib/supabase';
import { METRICS, REGIONS } from '../../lib/constants';
 
var PLAN_COLORS = {
  'Humana':      { bg: '#EFF6FF', color: '#1E40AF', border: '#BFDBFE' },
  'CarePlus':    { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' },
  'Aetna':       { bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  'Medicare':    { bg: '#F5F3FF', color: '#5B21B6', border: '#DDD6FE' },
  'FHCP':        { bg: '#FFF1F2', color: '#9F1239', border: '#FECDD3' },
  'Devoted':     { bg: '#F0FDF4', color: '#14532D', border: '#BBF7D0' },
  'Simply':      { bg: '#FFF7ED', color: '#9A3412', border: '#FED7AA' },
  'Health First':{ bg: '#F0F9FF', color: '#0C4A6E', border: '#BAE6FD' },
  'Cigna':       { bg: '#FDF4FF', color: '#701A75', border: '#F0ABFC' },
  'United':      { bg: '#F7F7F7', color: '#374151', border: '#E5E7EB' },
  'Private':     { bg: '#F9FAFB', color: '#374151', border: '#E5E7EB' },
  'Other':       { bg: '#F9FAFB', color: '#6B7280', border: '#E5E7EB' },
};
 
function getPlanStyle(name) {
  if (!name) return PLAN_COLORS['Other'];
  // Normalize common variations
  var n = name.trim();
  if (PLAN_COLORS[n]) return PLAN_COLORS[n];
  var lower = n.toLowerCase();
  if (lower.includes('humana')) return PLAN_COLORS['Humana'];
  if (lower.includes('careplus') || lower.includes('care plus')) return PLAN_COLORS['CarePlus'];
  if (lower.includes('aetna')) return PLAN_COLORS['Aetna'];
  if (lower.includes('medicare')) return PLAN_COLORS['Medicare'];
  if (lower.includes('fhcp')) return PLAN_COLORS['FHCP'];
  if (lower.includes('devoted')) return PLAN_COLORS['Devoted'];
  if (lower.includes('simply')) return PLAN_COLORS['Simply'];
  if (lower.includes('health first') || lower.includes('healthfirst')) return PLAN_COLORS['Health First'];
  if (lower.includes('cigna')) return PLAN_COLORS['Cigna'];
  if (lower.includes('united')) return PLAN_COLORS['United'];
  if (lower.includes('private')) return PLAN_COLORS['Private'];
  return PLAN_COLORS['Other'];
}
 
export default function OverviewPage() {
  var visits = useMemo(function() {
    try { return JSON.parse(localStorage.getItem('axiom_pariox_data') || '[]'); } catch (e) { return []; }
  }, []);
  var census = useMemo(function() {
    try { return JSON.parse(localStorage.getItem('axiom_census') || '[]'); } catch (e) { return []; }
  }, []);
 
  var [authStats, setAuthStats] = useState([]);
  var [authLoading, setAuthLoading] = useState(true);
 
  useEffect(function() {
    supabase.from('auth_tracker')
      .select('insurance, auth_status, visits_authorized, visits_used, auth_expiry_date, region')
      .then(function(res) {
        setAuthStats(res.data || []);
        setAuthLoading(false);
      });
  }, []);
 
  // Visit stats
  var validRegions = ['A','B','C','G','H','J','M','N','T','V'];
  var completed = visits.filter(function(v) { return v.status && v.status.toLowerCase().includes('completed'); }).length;
  var scheduled = visits.filter(function(v) { return v.status && v.status.toLowerCase().includes('scheduled'); }).length;
  var totalVisits = visits.length;
  var pct = Math.round((totalVisits / METRICS.WEEKLY_VISIT_TARGET) * 100);
  var estRevenue = completed * METRICS.AVG_REIMBURSEMENT;
 
  // Region breakdown from visit data
  var regionMap = useMemo(function() {
    var map = {};
    visits.forEach(function(v) {
      if (!validRegions.includes(v.region)) return;
      if (!map[v.region]) map[v.region] = 0;
      map[v.region]++;
    });
    return Object.entries(map).sort(function(a, b) { return b[1] - a[1]; });
  }, [visits]);
 
  var maxRegionCount = regionMap.length > 0 ? regionMap[0][1] : 1;
 
  // Insurance breakdown from auth_tracker
  var insuranceBreakdown = useMemo(function() {
    var map = {};
    authStats.forEach(function(r) {
      var ins = (r.insurance || 'Other').trim();
      if (!map[ins]) map[ins] = { total: 0, active: 0, pending: 0, critical: 0, expiring: 0 };
      map[ins].total++;
      if (r.auth_status === 'active') map[ins].active++;
      if (r.auth_status === 'pending' || r.auth_status === 'submitted') map[ins].pending++;
      var remaining = (r.visits_authorized || 0) - (r.visits_used || 0);
      if (remaining <= 7 && r.auth_status === 'active') map[ins].critical++;
      if (r.auth_expiry_date) {
        var days = Math.round((new Date(r.auth_expiry_date) - new Date()) / (1000*60*60*24));
        if (days >= 0 && days <= 30) map[ins].expiring++;
      }
    });
    return Object.entries(map).sort(function(a, b) { return b[1].total - a[1].total; });
  }, [authStats]);
 
  var totalAuthPatients = authStats.length;
  var maxInsCount = insuranceBreakdown.length > 0 ? insuranceBreakdown[0][1].total : 1;
 
  // Census insurance breakdown from localStorage
  var censusInsurance = useMemo(function() {
    var map = {};
    census.forEach(function(p) {
      var ins = (p.insurance || 'Unknown').trim().toUpperCase();
      // Normalize abbreviations
      var normalized = ins;
      if (ins.includes('HUM') || ins === 'HUB' || ins === 'HUG' || ins === 'HUM') normalized = 'Humana';
      else if (ins.includes('CPL') || ins.includes('CPA') || ins.includes('CPB') || ins.includes('CARE')) normalized = 'CarePlus';
      else if (ins.includes('AET')) normalized = 'Aetna';
      else if (ins.includes('MED')) normalized = 'Medicare';
      else if (ins.includes('FHCP') || ins.includes('FHC')) normalized = 'FHCP';
      else if (ins.includes('DEV')) normalized = 'Devoted';
      else if (ins.includes('SIM') || ins.includes('SIMP')) normalized = 'Simply';
      else if (ins.includes('HF') || ins.includes('HEALTH')) normalized = 'Health First';
      else if (ins.includes('CIG')) normalized = 'Cigna';
      else if (ins === 'PRIVATE' || ins === 'PVT') normalized = 'Private';
      map[normalized] = (map[normalized] || 0) + 1;
    });
    return Object.entries(map).sort(function(a, b) { return b[1] - a[1]; });
  }, [census]);
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Operations Overview"
        subtitle={'Welcome back, Liam'}
      />
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
 
        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          <StatCard label="VISITS THIS WEEK" value={totalVisits.toLocaleString()} sub={completed + ' completed \u00b7 ' + scheduled + ' scheduled'} color={pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--red)'} />
          <StatCard label="VISIT TARGET %" value={pct + '%'} sub={(METRICS.WEEKLY_VISIT_TARGET - totalVisits) + ' remaining'} color={pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--red)'} />
          <StatCard label="ACTIVE CENSUS" value={(census.length || 0).toLocaleString()} sub={'Target: ' + METRICS.CENSUS_TARGET} color={'var(--blue)'} />
          <StatCard label="EST. REVENUE" value={'$' + estRevenue.toLocaleString()} sub={'Target: $' + METRICS.REVENUE_TARGET.toLocaleString() + '/wk'} color={'var(--blue)'} />
        </div>
 
        {/* Weekly Visit Progress */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)' }}>Weekly Visit Progress</div>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--gray)' }}>{totalVisits} / {METRICS.WEEKLY_VISIT_TARGET}</div>
          </div>
          <div style={{ height: 10, background: 'var(--border)', borderRadius: 999, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ height: '100%', width: Math.min(pct, 100) + '%', background: pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--red)', borderRadius: 999, transition: 'width 0.5s ease' }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--gray)' }}>{pct}% of weekly target \u2014 {completed} completed, {scheduled} scheduled</div>
        </div>
 
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
 
          {/* Insurance Plan Breakdown - Auth Tracker */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--black)' }}>Patients by Insurance Plan</div>
                <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>From authorization tracker \u00b7 {totalAuthPatients} total</div>
              </div>
            </div>
            {authLoading ? (
              <div style={{ color: 'var(--gray)', fontSize: 13 }}>Loading...</div>
            ) : insuranceBreakdown.length === 0 ? (
              <div style={{ color: 'var(--gray)', fontSize: 13 }}>No auth records yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {insuranceBreakdown.map(function(item) {
                  var ins = item[0];
                  var data = item[1];
                  var style = getPlanStyle(ins);
                  var barPct = maxInsCount > 0 ? (data.total / maxInsCount) * 100 : 0;
                  return (
                    <div key={ins}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: style.color, background: style.bg, border: '1px solid ' + style.border, padding: '2px 8px', borderRadius: 999 }}>{ins}</span>
                          {data.critical > 0 && (
                            <span style={{ fontSize: 10, color: '#DC2626', fontWeight: 700 }}>&#9888; {data.critical} critical</span>
                          )}
                          {data.pending > 0 && (
                            <span style={{ fontSize: 10, color: '#92400E' }}>{data.pending} pending</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: 'var(--gray)' }}>{data.active} active</span>
                          <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--black)' }}>{data.total}</span>
                        </div>
                      </div>
                      <div style={{ height: 6, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: barPct + '%', background: style.color, borderRadius: 999, opacity: 0.7 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
 
          {/* Visits by Region */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--black)' }}>Visits by Region</div>
                <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>This week \u00b7 {totalVisits} total visits</div>
              </div>
            </div>
            {visits.length === 0 ? (
              <div style={{ color: 'var(--gray)', fontSize: 13 }}>Upload visit data to see regional breakdown</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {regionMap.map(function(item) {
                  var region = item[0];
                  var count = item[1];
                  var barPct = (count / maxRegionCount) * 100;
                  return (
                    <div key={region}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 13, color: 'var(--black)', fontWeight: 500 }}>Region {region}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--black)' }}>{count}</span>
                      </div>
                      <div style={{ height: 6, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: barPct + '%', background: 'var(--red)', borderRadius: 999 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
 
        {/* Auth Status Summary */}
        {!authLoading && authStats.length > 0 && (
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--black)', marginBottom: 16 }}>Auth Status Summary</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
              {[
                { label: 'Active', val: authStats.filter(function(r){return r.auth_status==='active';}).length, color: 'var(--green)', bg: '#ECFDF5' },
                { label: 'Pending', val: authStats.filter(function(r){return r.auth_status==='pending';}).length, color: '#92400E', bg: '#FEF3C7' },
                { label: 'Critical', val: authStats.filter(function(r){return r.auth_status==='active' && (r.visits_authorized - r.visits_used) <= 7;}).length, color: '#DC2626', bg: '#FEF2F2' },
                { label: 'Expiring 30d', val: authStats.filter(function(r){ if(!r.auth_expiry_date) return false; var d=Math.round((new Date(r.auth_expiry_date)-new Date())/(1000*60*60*24)); return d>=0&&d<=30; }).length, color: '#F59E0B', bg: '#FEF3C7' },
                { label: 'Denied', val: authStats.filter(function(r){return r.auth_status==='denied';}).length, color: '#7C3AED', bg: '#EDE9FE' },
                { label: 'On Hold', val: authStats.filter(function(r){return r.auth_status==='on_hold';}).length, color: '#374151', bg: '#F3F4F6' },
              ].map(function(tile) {
                return (
                  <div key={tile.label} style={{ background: tile.bg, borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: tile.color }}>{tile.val}</div>
                    <div style={{ fontSize: 11, color: tile.color, fontWeight: 600, marginTop: 4 }}>{tile.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
 
      </div>
    </div>
  );
}
 
