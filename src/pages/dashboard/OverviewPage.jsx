import React, { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import StatCard from '../../components/StatCard';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { METRICS, REGIONS } from '../../lib/constants';

const RATE = 230;
const VALID_REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

function weekBounds() {
  // Work week is Sun -> Sat (per ops convention). Sunday = day 0.
  const now = new Date();
  const day = now.getDay();              // 0 = Sun ... 6 = Sat
  const sun = new Date(now);
  sun.setDate(now.getDate() - day);      // back up to this week's Sunday
  const sat = new Date(sun);
  sat.setDate(sun.getDate() + 6);
  // Use local date strings — toISOString() converts to UTC and shifts the day at night
  const toLocal = d => [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  return [toLocal(sun), toLocal(sat)];
}

function isEval(event_type) { return /eval/i.test(event_type || ''); }
function isRA(event_type) { return /reassess|re-assess|30.day/i.test(event_type || ''); }
function isCancelled(event_type, status) {
  return /cancel/i.test(event_type || '') || /cancel/i.test(status || '');
}

function getPlanStyle(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('humana')) return { bg: '#EBF5FB', border: '#2E86C1', text: '#1A5276' };
  if (n.includes('careplus') || n.includes('care plus')) return { bg: '#FDFEFE', border: '#E74C3C', text: '#922B21' };
  if (n.includes('aetna')) return { bg: '#EBF5FB', border: '#5DADE2', text: '#1A5276' };
  if (n.includes('fhcp')) return { bg: '#FEF9E7', border: '#F39C12', text: '#9A7D0A' };
  if (n.includes('devoted')) return { bg: '#F9EBEA', border: '#E74C3C', text: '#922B21' };
  if (n.includes('united') || n.includes('uhc')) return { bg: '#EAF2FF', border: '#2E86C1', text: '#1A5276' };
  if (n.includes('medicare')) return { bg: '#E8F8F5', border: '#1ABC9C', text: '#0E6655' };
  return { bg: '#F8F9FA', border: '#BDC3C7', text: '#616A6B' };
}

export default function OverviewPage() {
  const [visits, setVisits] = useState([]);
  const [authStats, setAuthStats] = useState([]);
  const [census, setCensus] = useState([]);
  const [freshness, setFreshness] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const [wStart, wEnd] = weekBounds();
    // All four tables paginated via fetchAllPages since census / auth /
    // visits can each grow past the 1000-row PostgREST cap. data_freshness
    // is 3 rows so pagination is a no-op for it.
    Promise.all([
      fetchAllPages(
        supabase.from('visit_schedule_data')
          .select('patient_name,visit_date,status,event_type,region,discipline,insurance')
          .gte('visit_date', wStart).lte('visit_date', wEnd)
          .not('event_type', 'ilike', '%(PDF)%')
      ),
      fetchAllPages(
        supabase.from('auth_tracker')
          .select('insurance,auth_status,visits_authorized,visits_used,auth_expiry_date,region,patient_name')
      ),
      fetchAllPages(
        supabase.from('census_data').select('insurance,region,status,patient_name')
      ),
      fetchAllPages(
        supabase.from('data_freshness').select('*')
      ),
    ]).then(([v, a, c, f]) => {
      setVisits(v);
      setAuthStats(a);
      setCensus(c);
      setFreshness(f);
      setLoading(false);
    });
  }, []);

  // Visit stats — deduplicate evals and RAs (PT + PTA same patient + same date = 1 billable)
  const visitStats = useMemo(() => {
    const evalSeen = new Set();
    let completed = 0, scheduled = 0, cancelled = 0;

    visits.forEach(v => {
      if (isCancelled(v.event_type, v.status)) { cancelled++; return; }
      const needsDedup = isEval(v.event_type) || isRA(v.event_type);
      if (needsDedup) {
        const key = `${v.patient_name}||${v.visit_date}`;
        if (evalSeen.has(key)) return;
        evalSeen.add(key);
      }
      if (/completed/i.test(v.status || '')) completed++;
      else if (/scheduled/i.test(v.status || '')) scheduled++;
    });

    const billable = completed + scheduled;
    const pct = Math.round((billable / METRICS.WEEKLY_VISIT_TARGET) * 100);
    const estRevenue = completed * RATE;
    return { completed, scheduled, cancelled, billable, pct, estRevenue };
  }, [visits]);

  // Region breakdown — deduped, valid regions only
  const regionMap = useMemo(() => {
    const map = {};
    const seen = new Set();
    visits.forEach(v => {
      if (!VALID_REGIONS.includes(v.region)) return;
      if (isCancelled(v.event_type, v.status)) return;
      const needsDedup = isEval(v.event_type) || isRA(v.event_type);
      if (needsDedup) {
        const key = `${v.patient_name}||${v.visit_date}`;
        if (seen.has(key)) return;
        seen.add(key);
      }
      map[v.region] = (map[v.region] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [visits]);

  // Insurance breakdown from auth tracker
  const insuranceBreakdown = useMemo(() => {
    const map = {};
    authStats.forEach(r => {
      const k = r.insurance || 'Unknown';
      if (!map[k]) map[k] = { active: 0, critical: 0, pending: 0, total: 0 };
      map[k].total++;
      const status = (r.auth_status || '').toLowerCase();
      if (status.includes('active') || status.includes('approved')) map[k].active++;
      const used = r.visits_used || 0;
      const auth = r.visits_authorized || 24;
      if (auth - used <= 7) map[k].critical++;
      if (status.includes('pending')) map[k].pending++;
    });
    return Object.entries(map)
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.total - a.total);
  }, [authStats]);

  const maxInsurance = insuranceBreakdown.length > 0 ? insuranceBreakdown[0].total : 1;
  const totalAuthPatients = authStats.length;
  const { completed, scheduled, cancelled, billable, pct, estRevenue } = visitStats;

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Operations Overview" subtitle="Loading live data…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Operations Overview" subtitle={`Welcome back, Liam`} />
      {/* Data Freshness Banner */}
      {freshness.length > 0 && (() => {
        const stale = freshness.filter(f => {
          if (!f.last_upload) return true;
          const days = Math.floor((new Date() - new Date(f.last_upload)) / 86400000);
          return days > (f.stale_threshold_days || 8);
        });
        const oldest = freshness.reduce((a, b) => (!a || new Date(b.last_upload) < new Date(a.last_upload)) ? b : a, null);
        const daysSince = oldest ? Math.floor((new Date() - new Date(oldest.last_upload)) / 86400000) : null;
        if (stale.length > 0) return (
          <div style={{ background:'#FEF3C7', borderBottom:'2px solid #FCD34D', padding:'8px 20px', display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
            <span style={{ fontSize:16 }}>⚠</span>
            <div style={{ flex:1 }}>
              <span style={{ fontSize:12, fontWeight:700, color:'#92400E' }}>Data may be stale — </span>
              <span style={{ fontSize:12, color:'#92400E' }}>{stale.map(f => f.data_type).join(', ')} last uploaded {daysSince}+ days ago. Upload fresh Pariox data to update all metrics.</span>
            </div>
          </div>
        );
        return (
          <div style={{ background:'#F0FFF4', borderBottom:'1px solid #A7F3D0', padding:'6px 20px', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
            <span style={{ fontSize:12 }}>✅</span>
            <span style={{ fontSize:11, color:'#065F46' }}>All data current — last upload {daysSince === 0 ? 'today' : daysSince + 'd ago'} · {freshness.reduce((s,f) => s+(f.record_count||0), 0).toLocaleString()} total records</span>
          </div>
        );
      })()}
      <div style={{ flex:1, overflow:'auto' }}>
        {/* KPI Row */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', borderBottom:'1px solid var(--border)' }}>
          <StatCard label="VISITS THIS WEEK" value={billable.toLocaleString()}
            sub={`${completed} completed · ${scheduled} scheduled`}
            color={pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--red)'} />
          <StatCard label="VISIT TARGET %" value={pct + '%'}
            sub={`${METRICS.WEEKLY_VISIT_TARGET - billable} remaining`}
            color={pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--red)'} />
          <StatCard label="ACTIVE CENSUS" value={totalAuthPatients.toLocaleString()}
            sub={`Target: ${METRICS.CENSUS_TARGET}`} color="var(--blue)" />
          <StatCard label="EST. REVENUE" value={`$${estRevenue.toLocaleString()}`}
            sub={`$${RATE}/visit · ${completed} completed`} color="var(--blue)" />
        </div>

        {/* Weekly progress bar */}
        <div style={{ padding:'16px 24px', borderBottom:'1px solid var(--border)', background:'var(--card-bg)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <div style={{ fontSize:13, fontWeight:600, color:'var(--black)' }}>Weekly Visit Progress</div>
            <div style={{ fontSize:14, fontWeight:700, fontFamily:'DM Mono, monospace', color:'var(--gray)' }}>
              {billable} / {METRICS.WEEKLY_VISIT_TARGET}
            </div>
          </div>
          <div style={{ height:10, background:'var(--border)', borderRadius:999, overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${Math.min(pct,100)}%`, background: pct>=80?'var(--green)':pct>=60?'var(--yellow)':'var(--red)', borderRadius:999, transition:'width 0.5s' }} />
          </div>
          <div style={{ fontSize:12, color:'var(--gray)', marginTop:6 }}>
            {pct}% of weekly target — {completed} completed, {scheduled} scheduled, {cancelled} cancelled
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:0 }}>
          {/* Patients by Insurance */}
          <div style={{ padding:24, borderRight:'1px solid var(--border)', borderBottom:'1px solid var(--border)' }}>
            <div style={{ fontSize:15, fontWeight:600, color:'var(--black)', marginBottom:4 }}>Patients by Insurance Plan</div>
            <div style={{ fontSize:11, color:'var(--gray)', marginBottom:16 }}>
              From authorization tracker · {totalAuthPatients} total
            </div>
            {insuranceBreakdown.slice(0, 12).map(plan => {
              const st = getPlanStyle(plan.name);
              return (
                <div key={plan.name} style={{ marginBottom:12 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:999, background:st.bg, border:`1px solid ${st.border}`, color:st.text }}>
                        {plan.name}
                      </span>
                      {plan.critical > 0 && (
                        <span style={{ fontSize:10, color:'#DC2626', fontWeight:700 }}>⚠ {plan.critical} critical</span>
                      )}
                      {plan.pending > 0 && (
                        <span style={{ fontSize:10, color:'#D97706', fontWeight:600 }}>{plan.pending} pending</span>
                      )}
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:11, color:'var(--gray)' }}>{plan.active} active</span>
                      <span style={{ fontSize:13, fontWeight:700, color:'var(--black)' }}>{plan.total}</span>
                    </div>
                  </div>
                  <div style={{ height:6, background:'var(--border)', borderRadius:999 }}>
                    <div style={{ height:'100%', width:`${(plan.total/maxInsurance)*100}%`, background:st.border, borderRadius:999 }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Visits by Region */}
          <div style={{ padding:24, borderBottom:'1px solid var(--border)' }}>
            <div style={{ fontSize:15, fontWeight:600, color:'var(--black)', marginBottom:4 }}>Visits by Region</div>
            <div style={{ fontSize:11, color:'var(--gray)', marginBottom:16 }}>
              This week · {billable} total visits (deduped evals)
            </div>
            {regionMap.length === 0 ? (
              <div style={{ color:'var(--gray)', fontSize:13 }}>Upload visit data to see regional breakdown</div>
            ) : (
              regionMap.map(([region, count]) => {
                const maxCount = regionMap[0][1];
                const manager = REGIONS[region] || 'Unassigned';
                return (
                  <div key={region} style={{ marginBottom:10 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                      <div>
                        <span style={{ fontWeight:700, color:'var(--black)', fontSize:13 }}>Region {region}</span>
                        <span style={{ fontSize:11, color:'var(--gray)', marginLeft:8 }}>{manager}</span>
                      </div>
                      <span style={{ fontWeight:700, fontSize:13, color:'var(--black)' }}>{count}</span>
                    </div>
                    <div style={{ height:6, background:'var(--border)', borderRadius:999 }}>
                      <div style={{ height:'100%', width:`${(count/maxCount)*100}%`, background:'var(--red)', borderRadius:999 }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
