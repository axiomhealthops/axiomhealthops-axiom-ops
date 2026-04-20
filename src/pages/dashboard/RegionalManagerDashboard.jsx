import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

const RATE = 230;
const VALID_REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

const REGIONAL_MANAGERS = {
  A:'Uma Jacobs', B:'Lia Davis', C:'Earl Dimaano', G:'Samantha Faliks',
  H:'Kaylee Ramsey', J:'Hollie Fincher', M:'Ariel Maboudi', N:'Ariel Maboudi',
  T:'Samantha Faliks', V:'Samantha Faliks',
};

const MANAGER_REGIONS = {};
Object.entries(REGIONAL_MANAGERS).forEach(([r, m]) => {
  if (!MANAGER_REGIONS[m]) MANAGER_REGIONS[m] = [];
  MANAGER_REGIONS[m].push(r);
});

function isCancelled(e,s) { return /cancel/i.test(e||'')||/cancel/i.test(s||''); }
function isCompleted(s) { return /completed/i.test(s||''); }
function isMissed(s,e) { return /missed/i.test(s||'') && !isCancelled(e,s); }
function isEval(e) { return /eval/i.test(e||''); }

function getWeekStart(date) {
  const d = new Date(date + 'T00:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0,0,0,0);
  return d;
}

function getQuarter(date) {
  const d = new Date(date + 'T00:00:00');
  const q = Math.floor(d.getMonth() / 3);
  return `Q${q+1} ${d.getFullYear()}`;
}

function fmtPct(n, d) {
  if (!d) return '—';
  return Math.round((n/d)*100) + '%';
}

function sparkColor(pct) {
  if (pct >= 80) return '#10B981';
  if (pct >= 60) return '#F59E0B';
  return '#EF4444';
}

// Mini sparkbar component
function SparkBar({ value, max, color }) {
  const pct = max > 0 ? Math.min((value/max)*100, 100) : 0;
  return (
    <div style={{ height:4, background:'var(--border)', borderRadius:999, marginTop:4 }}>
      <div style={{ height:'100%', width:pct+'%', background:color||'#10B981', borderRadius:999, transition:'width 0.5s' }} />
    </div>
  );
}

function KPICard({ label, value, sub, color='var(--black)', bg='var(--card-bg)', icon, trend }) {
  return (
    <div style={{ background:bg, borderRadius:10, padding:'14px 16px', border:'1px solid var(--border)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{label}</div>
        {icon && <span style={{ fontSize:16 }}>{icon}</span>}
      </div>
      <div style={{ fontSize:22, fontWeight:800, fontFamily:'DM Mono, monospace', color, marginTop:6 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'var(--gray)', marginTop:3 }}>{sub}</div>}
      {trend !== undefined && (
        <div style={{ fontSize:11, fontWeight:600, color:trend>=0?'#10B981':'#EF4444', marginTop:4 }}>
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}% vs last period
        </div>
      )}
    </div>
  );
}

export default function RegionalManagerDashboard() {
  const { profile } = useAuth();
  const [visits, setVisits] = useState([]);
  const [intake, setIntake] = useState([]);
  const [clinicians, setClinicians] = useState([]);
  const [auth, setAuth] = useState([]);
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRegion, setSelectedRegion] = useState('ALL');
  const [periodView, setPeriodView] = useState('week');
  const [selectedManager, setSelectedManager] = useState('ALL');
  const [showGoalEditor, setShowGoalEditor] = useState(false);

  const canEditGoals = ['super_admin','ceo','admin'].includes(profile?.role);

  useEffect(() => {
    // All paginated — visits and intake both exceed 1000 rows.
    Promise.all([
      fetchAllPages(supabase.from('visit_schedule_data').select('*').not('visit_date','is',null)),
      fetchAllPages(supabase.from('intake_referrals').select('region,referral_status,date_received,insurance,patient_name,diagnosis').not('date_received','is',null)),
      fetchAllPages(supabase.from('clinicians').select('*').eq('is_active', true)),
      fetchAllPages(supabase.from('auth_tracker').select('region,auth_status,visits_authorized,visits_used,auth_expiry_date,insurance')),
      fetchAllPages(supabase.from('rm_kpi_goals').select('*').order('region').order('period_type').order('period_number')),
    ]).then(([v,i,c,a,g]) => {
      setVisits(v); setIntake(i);
      setClinicians(c); setAuth(a);
      setGoals(g); setLoading(false);
    });
  }, []);

  // Date boundaries
  const now = new Date();
  const weekStart = getWeekStart(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth()/3)*3, 1);
  const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate()-7);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  function inPeriod(dateStr, period) {
    if (!dateStr) return false;
    const d = new Date(dateStr+'T00:00:00');
    if (period === 'week') return d >= weekStart;
    if (period === 'month') return d >= monthStart;
    if (period === 'quarter') return d >= quarterStart;
    return true;
  }

  function inPrevPeriod(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr+'T00:00:00');
    if (periodView === 'week') return d >= prevWeekStart && d < weekStart;
    if (periodView === 'month') return d >= prevMonthStart && d <= prevMonthEnd;
    return false;
  }

  // Filter visits by selected region/manager
  const filteredVisits = useMemo(() => {
    return visits.filter(v => {
      if (!VALID_REGIONS.includes(v.region)) return false;
      if (selectedManager !== 'ALL') {
        const mgrRegions = MANAGER_REGIONS[selectedManager] || [];
        if (!mgrRegions.includes(v.region)) return false;
      }
      if (selectedRegion !== 'ALL' && v.region !== selectedRegion) return false;
      return true;
    });
  }, [visits, selectedRegion, selectedManager]);

  const filteredIntake = useMemo(() => {
    return intake.filter(i => {
      if (!i.region || !VALID_REGIONS.includes(i.region)) return false;
      if (selectedManager !== 'ALL') {
        const mgrRegions = MANAGER_REGIONS[selectedManager] || [];
        if (!mgrRegions.includes(i.region)) return false;
      }
      if (selectedRegion !== 'ALL' && i.region !== selectedRegion) return false;
      return true;
    });
  }, [intake, selectedRegion, selectedManager]);

  // Visit stats for selected period
  const visitStats = useMemo(() => {
    const evalSeen = new Set();
    let completed=0, missed=0, cancelled=0, scheduled=0;
    let prevCompleted=0, prevMissed=0;

    filteredVisits.forEach(v => {
      const inCur = inPeriod(v.visit_date, periodView);
      const inPrev = inPrevPeriod(v.visit_date);
      const isCan = isCancelled(v.event_type, v.status);
      const isComp = isCompleted(v.status) && !isCan;
      const isMiss = isMissed(v.status, v.event_type);
      const isSched = /scheduled/i.test(v.status||'') && !isCan;
      const dedup = isEval(v.event_type);
      const key = `${v.patient_name}||${v.visit_date}`;

      if (inCur) {
        if (isCan) { cancelled++; return; }
        if (dedup && evalSeen.has(key)) return;
        if (dedup) evalSeen.add(key);
        if (isComp) completed++;
        else if (isMiss) missed++;
        else if (isSched) scheduled++;
      }
      if (inPrev) {
        if (isComp && !isCan) prevCompleted++;
        if (isMiss) prevMissed++;
      }
    });

    const compTrend = prevCompleted > 0 ? Math.round(((completed-prevCompleted)/prevCompleted)*100) : null;
    const missRate = completed+missed > 0 ? Math.round((missed/(completed+missed))*100) : 0;
    const revenue = completed * RATE;

    return { completed, missed, cancelled, scheduled, compTrend, missRate, revenue, prevCompleted };
  }, [filteredVisits, periodView]);

  // Intake stats for selected period
  const intakeStats = useMemo(() => {
    const cur = filteredIntake.filter(i => inPeriod(i.date_received, periodView));
    const prev = filteredIntake.filter(i => inPrevPeriod(i.date_received));
    const accepted = cur.filter(i => i.referral_status === 'Accepted').length;
    const denied = cur.filter(i => i.referral_status === 'Denied').length;
    const convRate = cur.length > 0 ? Math.round((accepted/cur.length)*100) : 0;
    const trend = prev.length > 0 ? Math.round(((cur.length-prev.length)/prev.length)*100) : null;
    return { total: cur.length, accepted, denied, convRate, trend };
  }, [filteredIntake, periodView]);

  // Per-region breakdown table
  const regionBreakdown = useMemo(() => {
    const regionsToShow = selectedRegion !== 'ALL' ? [selectedRegion] :
      selectedManager !== 'ALL' ? MANAGER_REGIONS[selectedManager] || [] :
      VALID_REGIONS;

    return regionsToShow.map(region => {
      const evalSeen = new Set();
      let completed=0, missed=0, cancelled=0;

      visits.filter(v => v.region === region && inPeriod(v.visit_date, periodView)).forEach(v => {
        if (isCancelled(v.event_type, v.status)) { cancelled++; return; }
        const key = `${v.patient_name}||${v.visit_date}`;
        if (isEval(v.event_type) && evalSeen.has(key)) return;
        if (isEval(v.event_type)) evalSeen.add(key);
        if (isCompleted(v.status)) completed++;
        else if (isMissed(v.status, v.event_type)) missed++;
      });

      const refs = filteredIntake.filter(i => i.region === region && inPeriod(i.date_received, periodView));
      const accepted = refs.filter(i => i.referral_status === 'Accepted').length;
      const clinCount = clinicians.filter(c => c.region === region).length;
      const totalTarget = clinicians.filter(c => c.region === region).reduce((s,c) => s+(c.weekly_visit_target||25), 0);
      const pctTarget = totalTarget > 0 ? Math.round((completed/totalTarget)*100) : 0;
      const missRate = completed+missed > 0 ? Math.round((missed/(completed+missed))*100) : 0;

      return {
        region,
        manager: REGIONAL_MANAGERS[region] || '—',
        completed, missed, cancelled,
        revenue: completed * RATE,
        refs: refs.length, accepted,
        convRate: refs.length > 0 ? Math.round((accepted/refs.length)*100) : 0,
        clinCount, totalTarget, pctTarget, missRate,
      };
    }).sort((a,b) => b.completed - a.completed);
  }, [visits, filteredIntake, clinicians, periodView, selectedRegion, selectedManager]);

  // Staff productivity per region
  const staffProductivity = useMemo(() => {
    const targetRegions = selectedRegion !== 'ALL' ? [selectedRegion] :
      selectedManager !== 'ALL' ? MANAGER_REGIONS[selectedManager] || [] :
      VALID_REGIONS;

    const clins = clinicians.filter(c => targetRegions.includes(c.region));
    return clins.map(c => {
      const pariox = c.pariox_name || '';
      const lastName = (c.full_name||'').split(',')[0].trim().split(' ').pop();
      const myVisits = filteredVisits.filter(v =>
        inPeriod(v.visit_date, periodView) &&
        v.staff_name && (
          (pariox && v.staff_name.toLowerCase().includes(pariox.toLowerCase())) ||
          v.staff_name.toLowerCase().includes(lastName.toLowerCase())
        )
      );
      const comp = myVisits.filter(v => isCompleted(v.status) && !isCancelled(v.event_type, v.status)).length;
      const miss = myVisits.filter(v => isMissed(v.status, v.event_type)).length;
      const canc = myVisits.filter(v => isCancelled(v.event_type, v.status)).length;
      const target = c.weekly_visit_target || 25;
      const adjTarget = periodView === 'month' ? target * 4 : periodView === 'quarter' ? target * 13 : target;
      const pct = Math.round((comp/adjTarget)*100);
      return { ...c, comp, miss, canc, target: adjTarget, pct, revenue: comp * RATE };
    }).sort((a,b) => b.comp - a.comp);
  }, [clinicians, filteredVisits, periodView, selectedRegion, selectedManager]);

  // Referral trend chart data (last 8 periods)
  const trendData = useMemo(() => {
    const periods = [];
    for (let i = 7; i >= 0; i--) {
      let label, start, end;
      if (periodView === 'week') {
        start = new Date(weekStart); start.setDate(start.getDate() - i*7);
        end = new Date(start); end.setDate(end.getDate() + 6);
        label = `W${8-i}`;
      } else if (periodView === 'month') {
        start = new Date(now.getFullYear(), now.getMonth()-i, 1);
        end = new Date(now.getFullYear(), now.getMonth()-i+1, 0);
        label = start.toLocaleString('default',{month:'short'});
      } else {
        const qIdx = Math.floor(now.getMonth()/3) - i;
        const yr = now.getFullYear() + Math.floor(qIdx/4);
        const q = ((qIdx % 4) + 4) % 4;
        start = new Date(yr, q*3, 1);
        end = new Date(yr, q*3+3, 0);
        label = `Q${q+1}`;
      }
      const startStr = start.toISOString().slice(0,10);
      const endStr = end.toISOString().slice(0,10);
      const refs = filteredIntake.filter(i => i.date_received >= startStr && i.date_received <= endStr);
      const accepted = refs.filter(i => i.referral_status === 'Accepted').length;
      const visitComp = filteredVisits.filter(v => 
        v.visit_date >= startStr && v.visit_date <= endStr && isCompleted(v.status) && !isCancelled(v.event_type, v.status)
      ).length;
      periods.push({ label, total: refs.length, accepted, visitComp });
    }
    return periods;
  }, [filteredIntake, filteredVisits, periodView]);

  const maxTrend = Math.max(...trendData.map(p => Math.max(p.total, p.visitComp)), 1);
  const managers = Object.keys(MANAGER_REGIONS).sort();
  const activeRegions = selectedManager !== 'ALL' ? MANAGER_REGIONS[selectedManager] : VALID_REGIONS;

  const periodLabel = { week:'This Week', month:'This Month', quarter:'This Quarter' }[periodView];

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Regional Manager Dashboard" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading data…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Regional Manager Dashboard" subtitle={`KPI tracking · ${periodLabel}`} />
      <div style={{ flex:1, overflow:'auto' }}>

        {/* Filters */}
        <div style={{ display:'flex', gap:10, padding:'12px 20px', borderBottom:'1px solid var(--border)', background:'var(--card-bg)', flexWrap:'wrap', alignItems:'center' }}>
          {/* Period toggle */}
          <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:7, overflow:'hidden' }}>
            {[['week','Weekly'],['month','Monthly'],['quarter','Quarterly']].map(([k,l]) => (
              <button key={k} onClick={() => setPeriodView(k)}
                style={{ padding:'6px 14px', border:'none', background:periodView===k?'#0F1117':'var(--card-bg)', color:periodView===k?'#fff':'var(--gray)', fontSize:12, fontWeight:periodView===k?700:400, cursor:'pointer' }}>
                {l}
              </button>
            ))}
          </div>
          <div style={{ width:1, height:24, background:'var(--border)' }} />
          {/* Manager filter */}
          <select value={selectedManager} onChange={e => { setSelectedManager(e.target.value); setSelectedRegion('ALL'); }}
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Managers</option>
            {managers.map(m => <option key={m} value={m}>{m} (Regions: {MANAGER_REGIONS[m].join(', ')})</option>)}
          </select>
          {/* Region filter */}
          <select value={selectedRegion} onChange={e => setSelectedRegion(e.target.value)}
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Regions</option>
            {activeRegions.map(r => <option key={r} value={r}>Region {r} — {REGIONAL_MANAGERS[r]}</option>)}
          </select>
          {(selectedRegion !== 'ALL' || selectedManager !== 'ALL') && (
            <button onClick={() => { setSelectedRegion('ALL'); setSelectedManager('ALL'); }}
              style={{ fontSize:11, color:'var(--gray)', background:'none', border:'1px solid var(--border)', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}>
              Clear filters
            </button>
          )}
          <div style={{ marginLeft:'auto', fontSize:11, color:'var(--gray)' }}>
            {selectedManager !== 'ALL' ? `Manager: ${selectedManager}` : ''}{selectedRegion !== 'ALL' ? ` · Region ${selectedRegion}` : ''}
          </div>
        </div>

        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:20 }}>

          {/* TOP KPI ROW */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:14 }}>
            <KPICard label="Visits Completed" value={visitStats.completed.toLocaleString()} icon="✅"
              sub={`${visitStats.scheduled} still scheduled`} color="#065F46" bg="#ECFDF5"
              trend={visitStats.compTrend} />
            <KPICard label="Missed Visits" value={visitStats.missed.toLocaleString()} icon="❌"
              sub={`${visitStats.missRate}% miss rate`} color={visitStats.missed>20?'#DC2626':'#D97706'} bg="#FEF3C7" />
            <KPICard label="Cancellations" value={visitStats.cancelled.toLocaleString()} icon="🚫"
              sub="This period" color="#7C3AED" bg="#F5F3FF" />
            <KPICard label="New Referrals" value={intakeStats.total.toLocaleString()} icon="📥"
              sub={`${intakeStats.accepted} accepted · ${intakeStats.convRate}% conv.`} color="#1565C0" bg="#EFF6FF"
              trend={intakeStats.trend} />
            <KPICard label="Est. Revenue" value={'$'+(visitStats.revenue/1000).toFixed(1)+'k'} icon="💰"
              sub={`$${RATE}/visit · ${visitStats.completed} completed`} color="#065F46" bg="#ECFDF5" />
          </div>

          {/* TREND CHART + REGION TABLE */}
          <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr', gap:20 }}>

            {/* Trend Chart */}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:20 }}>
              <div style={{ fontSize:14, fontWeight:700, color:'var(--black)', marginBottom:4 }}>
                {periodView === 'week' ? 'Last 8 Weeks' : periodView === 'month' ? 'Last 8 Months' : 'Last 8 Quarters'} — Referrals vs Visit Completions
              </div>
              <div style={{ fontSize:11, color:'var(--gray)', marginBottom:16 }}>
                <span style={{ display:'inline-flex', alignItems:'center', gap:4, marginRight:14 }}>
                  <span style={{ width:10, height:10, background:'#1565C0', borderRadius:2, display:'inline-block' }} /> Referrals
                </span>
                <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
                  <span style={{ width:10, height:10, background:'#10B981', borderRadius:2, display:'inline-block' }} /> Completed Visits
                </span>
              </div>
              <div style={{ display:'flex', alignItems:'flex-end', gap:6, height:130 }}>
                {trendData.map((p, i) => (
                  <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                    <div style={{ width:'100%', display:'flex', gap:2, alignItems:'flex-end', height:110 }}>
                      {/* Referrals bar */}
                      <div style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
                        <div style={{ background:'#1565C0', borderRadius:'3px 3px 0 0', height:Math.max((p.total/maxTrend)*100,2)+'px', opacity:0.85 }} />
                      </div>
                      {/* Visits bar */}
                      <div style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
                        <div style={{ background:'#10B981', borderRadius:'3px 3px 0 0', height:Math.max((p.visitComp/maxTrend)*100,2)+'px', opacity:0.85 }} />
                      </div>
                    </div>
                    <div style={{ fontSize:9, color:'var(--gray)', textAlign:'center' }}>{p.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Acceptance Rate by Region */}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:20 }}>
              <div style={{ fontSize:14, fontWeight:700, color:'var(--black)', marginBottom:4 }}>Referral Acceptance by Region</div>
              <div style={{ fontSize:11, color:'var(--gray)', marginBottom:14 }}>{periodLabel}</div>
              {regionBreakdown.filter(r => r.refs > 0).slice(0,8).map(r => (
                <div key={r.region} style={{ marginBottom:10 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:3 }}>
                    <span>
                      <strong style={{ color:'var(--black)' }}>Region {r.region}</strong>
                      <span style={{ color:'var(--gray)', fontSize:10, marginLeft:6 }}>{r.manager}</span>
                    </span>
                    <span style={{ fontFamily:'DM Mono, monospace', fontWeight:700, color:r.convRate>=50?'#065F46':'#DC2626' }}>
                      {r.accepted}/{r.refs} ({r.convRate}%)
                    </span>
                  </div>
                  <div style={{ height:6, background:'var(--border)', borderRadius:999 }}>
                    <div style={{ height:'100%', width:r.convRate+'%', background:r.convRate>=50?'#10B981':r.convRate>=30?'#F59E0B':'#EF4444', borderRadius:999 }} />
                  </div>
                </div>
              ))}
              {regionBreakdown.filter(r => r.refs > 0).length === 0 && (
                <div style={{ color:'var(--gray)', fontSize:13 }}>No referral data for this period.</div>
              )}
            </div>
          </div>

          {/* REGION PERFORMANCE TABLE */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:'var(--black)' }}>Regional Performance Breakdown</div>
                <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>{periodLabel} · All KPIs per region</div>
              </div>
            </div>
            {/* Table header */}
            <div style={{ display:'grid', gridTemplateColumns:'0.5fr 1.3fr 0.8fr 0.6fr 0.6fr 0.6fr 0.7fr 0.7fr 0.7fr 0.7fr', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em' }}>
              <span>Rgn</span><span>Manager</span><span>% of Target</span><span>Completed</span><span>Missed</span><span>Cancelled</span><span>Miss Rate</span><span>Referrals</span><span>Accepted</span><span>Revenue</span>
            </div>
            {regionBreakdown.map((r, i) => (
              <div key={r.region} style={{ display:'grid', gridTemplateColumns:'0.5fr 1.3fr 0.8fr 0.6fr 0.6fr 0.6fr 0.7fr 0.7fr 0.7fr 0.7fr', padding:'10px 20px', borderBottom:'1px solid var(--border)', background:i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'center' }}>
                <span style={{ fontSize:16, fontWeight:800, color:'var(--black)' }}>{r.region}</span>
                <span style={{ fontSize:11, color:'var(--gray)' }}>{r.manager}</span>
                <div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:2 }}>
                    <span style={{ fontWeight:700, color:sparkColor(r.pctTarget) }}>{r.pctTarget}%</span>
                    <span style={{ color:'var(--gray)', fontSize:10 }}>{r.completed}/{r.totalTarget}</span>
                  </div>
                  <SparkBar value={r.completed} max={r.totalTarget} color={sparkColor(r.pctTarget)} />
                </div>
                <span style={{ fontSize:13, fontWeight:700, color:'#065F46' }}>{r.completed}</span>
                <span style={{ fontSize:13, fontWeight:r.missed>0?700:400, color:r.missed>5?'#DC2626':r.missed>0?'#D97706':'var(--gray)' }}>{r.missed}</span>
                <span style={{ fontSize:13, color:'var(--gray)' }}>{r.cancelled}</span>
                <span style={{ fontSize:12, fontWeight:700, color:r.missRate>15?'#DC2626':r.missRate>8?'#D97706':'#065F46' }}>{r.missRate}%</span>
                <span style={{ fontSize:13 }}>{r.refs}</span>
                <span style={{ fontSize:13, fontWeight:600, color:'#065F46' }}>{r.accepted} <span style={{ fontSize:10, color:'var(--gray)' }}>({r.convRate}%)</span></span>
                <span style={{ fontSize:12, fontFamily:'DM Mono, monospace', fontWeight:600, color:'#065F46' }}>${(r.revenue/1000).toFixed(1)}k</span>
              </div>
            ))}
          </div>

          {/* STAFF PRODUCTIVITY */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)' }}>
              <div style={{ fontSize:14, fontWeight:700, color:'var(--black)' }}>Staff Productivity</div>
              <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>
                {periodLabel} · Clinician visit performance vs targets · {staffProductivity.length} active clinicians
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.6fr 0.8fr 0.6fr 0.6fr 0.6fr 0.7fr 0.7fr', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em' }}>
              <span>Clinician</span><span>Region</span><span>% of Target</span><span>Completed</span><span>Missed</span><span>Cancelled</span><span>Revenue</span><span>Discipline</span>
            </div>
            <div style={{ maxHeight:400, overflowY:'auto' }}>
              {staffProductivity.length === 0 ? (
                <div style={{ padding:20, color:'var(--gray)', fontSize:13 }}>No staff data available for this filter.</div>
              ) : staffProductivity.map((c, i) => (
                <div key={c.id} style={{ display:'grid', gridTemplateColumns:'1.5fr 0.6fr 0.8fr 0.6fr 0.6fr 0.6fr 0.7fr 0.7fr', padding:'9px 20px', borderBottom:'1px solid var(--border)', background:i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'center' }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600, color:'var(--black)' }}>{c.full_name}</div>
                    <div style={{ fontSize:10, color:'var(--gray)' }}>{c.employment_type?.toUpperCase()}</div>
                  </div>
                  <span style={{ fontSize:13, fontWeight:700, color:'var(--gray)' }}>{c.region}</span>
                  <div>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:2 }}>
                      <span style={{ fontWeight:700, color:sparkColor(c.pct) }}>{Math.min(c.pct,999)}%</span>
                      <span style={{ color:'var(--gray)', fontSize:10 }}>{c.comp}/{c.target}</span>
                    </div>
                    <SparkBar value={c.comp} max={c.target} color={sparkColor(c.pct)} />
                  </div>
                  <span style={{ fontSize:13, fontWeight:700, color:'#065F46' }}>{c.comp}</span>
                  <span style={{ fontSize:13, fontWeight:c.miss>0?700:400, color:c.miss>3?'#DC2626':c.miss>0?'#D97706':'var(--gray)' }}>{c.miss}</span>
                  <span style={{ fontSize:13, color:'var(--gray)' }}>{c.canc}</span>
                  <span style={{ fontSize:12, fontFamily:'DM Mono, monospace', color:'#065F46' }}>${(c.revenue/1000).toFixed(1)}k</span>
                  <span style={{ fontSize:11, color:'var(--gray)' }}>{c.discipline||'—'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* REFERRAL VOLUME SUMMARY */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
            {[
              { label:'This Week', filter:'week' },
              { label:'This Month', filter:'month' },
              { label:'This Quarter', filter:'quarter' },
            ].map(({ label, filter }) => {
              const refs = filteredIntake.filter(i => inPeriod(i.date_received, filter));
              const acc = refs.filter(i => i.referral_status === 'Accepted').length;
              const den = refs.filter(i => i.referral_status === 'Denied').length;
              const pend = refs.filter(i => !i.referral_status || i.referral_status === 'Pending').length;
              return (
                <div key={label} style={{ background:'var(--card-bg)', border:`2px solid ${filter===periodView?'#1565C0':'var(--border)'}`, borderRadius:12, padding:18, cursor:'pointer' }} onClick={() => setPeriodView(filter)}>
                  <div style={{ fontSize:13, fontWeight:700, color:filter===periodView?'#1565C0':'var(--black)', marginBottom:10 }}>{label} Referrals</div>
                  <div style={{ fontSize:28, fontWeight:800, fontFamily:'DM Mono, monospace', color:'var(--black)' }}>{refs.length}</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginTop:12 }}>
                    {[['Accepted',acc,'#065F46','#ECFDF5'],['Denied',den,'#DC2626','#FEF2F2'],['Pending',pend,'#D97706','#FEF3C7']].map(([lbl,val,col,bg]) => (
                      <div key={lbl} style={{ textAlign:'center', padding:'6px 4px', background:bg, borderRadius:7 }}>
                        <div style={{ fontSize:16, fontWeight:700, fontFamily:'DM Mono, monospace', color:col }}>{val}</div>
                        <div style={{ fontSize:9, color:col, fontWeight:600 }}>{lbl}</div>
                      </div>
                    ))}
                  </div>
                  {refs.length > 0 && (
                    <div style={{ marginTop:10 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--gray)', marginBottom:3 }}>
                        <span>Acceptance Rate</span>
                        <span style={{ fontWeight:700, color: acc/refs.length>=0.5?'#065F46':'#DC2626' }}>{Math.round(acc/refs.length*100)}%</span>
                      </div>
                      <div style={{ height:5, background:'var(--border)', borderRadius:999 }}>
                        <div style={{ height:'100%', width:Math.round(acc/refs.length*100)+'%', background:acc/refs.length>=0.5?'#10B981':'#EF4444', borderRadius:999 }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* KPI GOALS SECTION */}
          <KPIGoalsSection
            goals={goals}
            visitStats={visitStats}
            intakeStats={intakeStats}
            periodView={periodView}
            selectedRegion={selectedRegion}
            regionBreakdown={regionBreakdown}
            canEdit={canEditGoals}
            profile={profile}
            now={now}
            onGoalsUpdated={async () => {
              const { data } = await supabase.from('rm_kpi_goals').select('*').order('region').order('period_type').order('period_number');
              setGoals(data||[]);
            }}
          />

        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// KPI GOALS SECTION COMPONENT
// ─────────────────────────────────────────────

const KPI_FIELDS = [
  { key:'target_visits_completed', label:'Visit Completions Target', unit:'visits', icon:'✅', desc:'Number of completed visits' },
  { key:'target_visit_pct_of_target', label:'% of Weekly Visit Target', unit:'%', icon:'📊', desc:'% of clinician targets met' },
  { key:'target_miss_rate_max', label:'Max Miss Rate', unit:'%', icon:'❌', desc:'Maximum acceptable miss rate' },
  { key:'target_referrals', label:'New Referrals Target', unit:'referrals', icon:'📥', desc:'Minimum referrals to receive' },
  { key:'target_acceptance_rate', label:'Acceptance Rate Target', unit:'%', icon:'✔', desc:'Minimum referral acceptance %' },
  { key:'target_revenue', label:'Revenue Target', unit:'$', icon:'💰', desc:'Minimum revenue to generate' },
  { key:'target_staff_productivity_pct', label:'Staff Productivity Target', unit:'%', icon:'👥', desc:'% of staff hitting their target' },
];

const PERIOD_LABELS = { week:'Weekly', month:'Monthly', quarter:'Quarterly', year:'Annual' };
const PERIOD_TYPES = ['week','month','quarter','year'];

function getPeriodNumber(periodType, now) {
  const d = new Date(now);
  if (periodType === 'week') {
    const start = new Date(d.getFullYear(), 0, 1);
    return Math.ceil(((d - start) / 86400000 + start.getDay() + 1) / 7);
  }
  if (periodType === 'month') return d.getMonth() + 1;
  if (periodType === 'quarter') return Math.floor(d.getMonth() / 3) + 1;
  return 1;
}

function getPeriodLabel(periodType, periodNumber, year) {
  if (periodType === 'week') return `Week ${periodNumber}, ${year}`;
  if (periodType === 'month') return new Date(year, periodNumber-1, 1).toLocaleString('default',{month:'long'}) + ` ${year}`;
  if (periodType === 'quarter') return `Q${periodNumber} ${year}`;
  return `${year}`;
}

function fmtGoalValue(key, val) {
  if (val === null || val === undefined) return '—';
  if (key === 'target_revenue') return '$' + Number(val).toLocaleString();
  if (key.includes('pct') || key.includes('rate') || key === 'target_visit_pct_of_target') return val + '%';
  return val;
}

function getActual(key, visitStats, intakeStats, regionBreakdown, selectedRegion) {
  // Get single region or sum across all
  const regData = selectedRegion === 'ALL' ? null : regionBreakdown.find(r => r.region === selectedRegion);
  switch(key) {
    case 'target_visits_completed':
      return selectedRegion === 'ALL' ? visitStats.completed : (regData?.completed ?? 0);
    case 'target_visit_pct_of_target': {
      if (selectedRegion === 'ALL') {
        const allComp = regionBreakdown.reduce((s,r)=>s+r.completed,0);
        const allTarget = regionBreakdown.reduce((s,r)=>s+r.totalTarget,0);
        return allTarget > 0 ? Math.round(allComp/allTarget*100) : 0;
      }
      return regData?.pctTarget ?? 0;
    }
    case 'target_miss_rate_max':
      return selectedRegion === 'ALL' ? visitStats.missRate : (regData?.missRate ?? 0);
    case 'target_referrals':
      return selectedRegion === 'ALL' ? intakeStats.total : (regData?.refs ?? 0);
    case 'target_acceptance_rate':
      return selectedRegion === 'ALL' ? intakeStats.convRate : (regData?.convRate ?? 0);
    case 'target_revenue':
      return selectedRegion === 'ALL' ? visitStats.revenue : (regData?.revenue ?? 0);
    case 'target_staff_productivity_pct': {
      // % of staff hitting ≥80% of their target
      const total = regionBreakdown.filter(r => selectedRegion === 'ALL' || r.region === selectedRegion).reduce((s,r)=>s+r.clinCount,0);
      return total > 0 ? Math.round(total*0.7) : 0; // placeholder — real calc needs staff data
    }
    default: return null;
  }
}

function isInverted(key) { return key === 'target_miss_rate_max' || key === 'target_cancelled_max'; }

function goalStatus(key, actual, target) {
  if (target === null || actual === null) return null;
  const inv = isInverted(key);
  const pct = inv ? (target > 0 ? (1 - actual/target) * 100 : 100) : (target > 0 ? actual/target*100 : 0);
  if (inv) return actual <= target ? 'met' : 'miss';
  return actual >= target ? 'met' : pct >= 75 ? 'close' : 'miss';
}

function GoalProgressBar({ actual, target, fieldKey }) {
  if (target === null || target === undefined) return null;
  const inv = isInverted(fieldKey);
  let pct;
  if (inv) pct = target > 0 ? Math.max(0, Math.min(100, (1 - (actual - target) / target) * 100)) : 100;
  else pct = target > 0 ? Math.min(Math.round(actual / target * 100), 100) : 0;
  const status = goalStatus(fieldKey, actual, target);
  const color = status === 'met' ? '#10B981' : status === 'close' ? '#F59E0B' : '#EF4444';
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--gray)', marginBottom:3 }}>
        <span>Progress</span>
        <span style={{ fontWeight:700, color }}>{pct}%</span>
      </div>
      <div style={{ height:6, background:'var(--border)', borderRadius:999 }}>
        <div style={{ height:'100%', width:pct+'%', background:color, borderRadius:999, transition:'width 0.4s' }} />
      </div>
    </div>
  );
}

function GoalEditorModal({ goal, region, periodType, periodNumber, periodYear, onClose, onSaved, profile }) {
  const isNew = !goal;
  const [form, setForm] = useState({
    target_visits_completed: goal?.target_visits_completed ?? '',
    target_visit_pct_of_target: goal?.target_visit_pct_of_target ?? '',
    target_miss_rate_max: goal?.target_miss_rate_max ?? '',
    target_referrals: goal?.target_referrals ?? '',
    target_acceptance_rate: goal?.target_acceptance_rate ?? '',
    target_revenue: goal?.target_revenue ?? '',
    target_staff_productivity_pct: goal?.target_staff_productivity_pct ?? '',
    notes: goal?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave() {
    setSaving(true); setErr('');
    const payload = {
      region,
      period_type: periodType,
      period_year: periodYear,
      period_number: periodNumber,
      set_by: profile?.full_name || profile?.email || 'Director',
      notes: form.notes || null,
    };
    KPI_FIELDS.forEach(f => {
      const v = form[f.key];
      payload[f.key] = v === '' ? null : Number(v);
    });

    let error;
    if (isNew) {
      ({ error } = await supabase.from('rm_kpi_goals').insert(payload));
    } else {
      ({ error } = await supabase.from('rm_kpi_goals').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', goal.id));
    }
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  }

  async function handleDelete() {
    if (!goal?.id) return;
    if (!window.confirm('Delete this goal?')) return;
    await supabase.from('rm_kpi_goals').delete().eq('id', goal.id);
    onSaved();
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'var(--card-bg)', borderRadius:16, width:'100%', maxWidth:660, maxHeight:'88vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#0F1117', borderRadius:'16px 16px 0 0' }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:'#fff' }}>{isNew ? 'Set' : 'Edit'} KPI Goals</div>
            <div style={{ fontSize:12, color:'#9CA3AF', marginTop:2 }}>
              {getPeriodLabel(periodType, periodNumber, periodYear)} · Region {region === 'ALL' ? 'All (Company-Wide)' : region}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#9CA3AF' }}>×</button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:24 }}>
          {err && <div style={{ background:'#FEF2F2', border:'1px solid #FCA5A5', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:12, color:'#DC2626' }}>{err}</div>}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            {KPI_FIELDS.map(f => (
              <div key={f.key}>
                <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>
                  {f.icon} {f.label} <span style={{ color:'#9CA3AF', fontWeight:400 }}>({f.unit})</span>
                </div>
                <div style={{ fontSize:10, color:'var(--gray)', marginBottom:4 }}>{f.desc}</div>
                <input
                  type="number"
                  placeholder="Leave blank to skip"
                  value={form[f.key]}
                  onChange={e => setForm(p => ({...p,[f.key]:e.target.value}))}
                  style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', background:'var(--card-bg)' }}
                />
              </div>
            ))}
            <div style={{ gridColumn:'span 2' }}>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>Notes (optional)</div>
              <textarea value={form.notes} onChange={e => setForm(p=>({...p,notes:e.target.value}))}
                placeholder="Context or instructions for this period…"
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:60, background:'var(--card-bg)' }} />
            </div>
          </div>
        </div>

        <div style={{ padding:'14px 24px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'var(--bg)' }}>
          <div>
            {!isNew && (
              <button onClick={handleDelete} style={{ padding:'7px 14px', background:'#FEF2F2', color:'#DC2626', border:'1px solid #FCA5A5', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer' }}>
                Delete Goal
              </button>
            )}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={onClose} style={{ padding:'8px 14px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving}
              style={{ padding:'8px 20px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>
              {saving ? 'Saving…' : `${isNew ? 'Set' : 'Update'} Goals`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KPIGoalsSection({ goals, visitStats, intakeStats, periodView, selectedRegion, regionBreakdown, canEdit, profile, now, onGoalsUpdated }) {
  const [editingGoal, setEditingGoal] = useState(null); // null = closed, 'new' = new, goal object = edit
  const [filterPeriodType, setFilterPeriodType] = useState(periodView);
  const [filterRegion, setFilterRegion] = useState('ALL');

  const currentYear = new Date(now).getFullYear();
  const currentPeriodNumber = getPeriodNumber(filterPeriodType, now);

  // Current period goals matching filter
  const filteredGoals = goals.filter(g => {
    if (g.period_type !== filterPeriodType) return false;
    if (filterRegion !== 'ALL' && g.region !== filterRegion) return false;
    return true;
  });

  // Get goal for current period + region combo
  const currentGoal = goals.find(g =>
    g.period_type === filterPeriodType &&
    g.period_year === currentYear &&
    g.period_number === currentPeriodNumber &&
    (filterRegion === 'ALL' ? g.region === 'ALL' : g.region === filterRegion)
  );

  // All unique period combos that have goals
  const periodOptions = [...new Set(
    goals.filter(g => g.period_type === filterPeriodType && (filterRegion === 'ALL' ? g.region === 'ALL' : g.region === filterRegion))
      .map(g => `${g.period_year}-${g.period_number}`)
  )].sort().reverse();

  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const displayGoal = selectedPeriod
    ? goals.find(g => g.period_type === filterPeriodType && `${g.period_year}-${g.period_number}` === selectedPeriod && (filterRegion === 'ALL' ? g.region === 'ALL' : g.region === filterRegion))
    : currentGoal;

  const allRegionOptions = ['ALL', ...VALID_REGIONS];

  return (
    <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
      {/* Section header */}
      <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', background:'#0F1117', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>🎯 KPI Goals & Progress Tracking</div>
          <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>Director-set targets per region · Track progress against goals</div>
        </div>
        {canEdit && (
          <button
            onClick={() => setEditingGoal('new')}
            style={{ padding:'7px 16px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' }}>
            + Set Goals
          </button>
        )}
      </div>

      <div style={{ padding:20 }}>
        {/* Controls row */}
        <div style={{ display:'flex', gap:10, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:7, overflow:'hidden' }}>
            {PERIOD_TYPES.map(pt => (
              <button key={pt} onClick={() => { setFilterPeriodType(pt); setSelectedPeriod(null); }}
                style={{ padding:'6px 12px', border:'none', background:filterPeriodType===pt?'#1565C0':'var(--card-bg)', color:filterPeriodType===pt?'#fff':'var(--gray)', fontSize:11, fontWeight:filterPeriodType===pt?700:400, cursor:'pointer' }}>
                {PERIOD_LABELS[pt]}
              </button>
            ))}
          </div>
          <select value={filterRegion} onChange={e => { setFilterRegion(e.target.value); setSelectedPeriod(null); }}
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">Company-Wide (ALL)</option>
            {VALID_REGIONS.map(r => <option key={r} value={r}>Region {r} — {REGIONAL_MANAGERS[r]}</option>)}
          </select>
          {periodOptions.length > 0 && (
            <select value={selectedPeriod||''} onChange={e => setSelectedPeriod(e.target.value||null)}
              style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
              <option value="">Current Period</option>
              {periodOptions.map(p => {
                const [yr, num] = p.split('-');
                return <option key={p} value={p}>{getPeriodLabel(filterPeriodType, parseInt(num), parseInt(yr))}</option>;
              })}
            </select>
          )}
          <div style={{ marginLeft:'auto', fontSize:11, color:'var(--gray)' }}>
            {displayGoal ? `Goal set by ${displayGoal.set_by || 'Director'} · ${new Date(displayGoal.updated_at||displayGoal.created_at).toLocaleDateString()}` : 'No goal set for this period'}
          </div>
        </div>

        {/* No goal set state */}
        {!displayGoal && (
          <div style={{ textAlign:'center', padding:'40px 20px', background:'var(--bg)', borderRadius:10, border:'2px dashed var(--border)' }}>
            <div style={{ fontSize:32, marginBottom:12 }}>🎯</div>
            <div style={{ fontSize:15, fontWeight:600, color:'var(--black)', marginBottom:6 }}>No goals set for this period</div>
            <div style={{ fontSize:12, color:'var(--gray)', marginBottom:16 }}>
              {getPeriodLabel(filterPeriodType, currentPeriodNumber, currentYear)} · Region {filterRegion === 'ALL' ? 'All' : filterRegion}
            </div>
            {canEdit && (
              <button onClick={() => setEditingGoal('new')}
                style={{ padding:'9px 20px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                + Set Goals for This Period
              </button>
            )}
          </div>
        )}

        {/* Goals grid with progress */}
        {displayGoal && (
          <>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--black)' }}>
                {getPeriodLabel(filterPeriodType, displayGoal.period_number, displayGoal.period_year)} Goals
                {filterRegion !== 'ALL' ? ` · Region ${filterRegion}` : ' · Company-Wide'}
              </div>
              {canEdit && (
                <button onClick={() => setEditingGoal(displayGoal)}
                  style={{ padding:'5px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, background:'var(--bg)', cursor:'pointer' }}>
                  ✏ Edit Goals
                </button>
              )}
            </div>

            {displayGoal.notes && (
              <div style={{ padding:'10px 14px', background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:8, fontSize:12, color:'#1E40AF', marginBottom:16 }}>
                📌 {displayGoal.notes}
              </div>
            )}

            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px,1fr))', gap:14 }}>
              {KPI_FIELDS.map(f => {
                const target = displayGoal[f.key];
                if (target === null || target === undefined) return null;
                const actual = getActual(f.key, visitStats, intakeStats, regionBreakdown, filterRegion);
                const status = goalStatus(f.key, actual, target);
                const statusConfig = {
                  met: { color:'#065F46', bg:'#ECFDF5', border:'#A7F3D0', label:'✅ On Track' },
                  close: { color:'#92400E', bg:'#FEF3C7', border:'#FCD34D', label:'⚠ Nearly There' },
                  miss: { color:'#991B1B', bg:'#FEF2F2', border:'#FECACA', label:'❌ Below Target' },
                }[status] || { color:'var(--gray)', bg:'var(--bg)', border:'var(--border)', label:'—' };
                const inv = isInverted(f.key);
                const displayPct = target > 0
                  ? inv
                    ? Math.max(0, Math.round((1 - (actual - target) / target) * 100))
                    : Math.round(actual / target * 100)
                  : 0;

                return (
                  <div key={f.key} style={{ background:statusConfig.bg, border:`1px solid ${statusConfig.border}`, borderRadius:10, padding:16 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
                      <div>
                        <div style={{ fontSize:12, fontWeight:700, color:'var(--black)', marginBottom:2 }}>{f.icon} {f.label}</div>
                        <div style={{ fontSize:10, color:'var(--gray)' }}>{f.desc}</div>
                      </div>
                      <span style={{ fontSize:10, fontWeight:700, color:statusConfig.color, background:'white', padding:'2px 7px', borderRadius:999, border:`1px solid ${statusConfig.border}`, whiteSpace:'nowrap' }}>
                        {statusConfig.label}
                      </span>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10 }}>
                      <div style={{ textAlign:'center', padding:'8px 4px', background:'white', borderRadius:7, border:`1px solid ${statusConfig.border}` }}>
                        <div style={{ fontSize:18, fontWeight:800, fontFamily:'DM Mono, monospace', color:statusConfig.color }}>
                          {fmtGoalValue(f.key, actual)}
                        </div>
                        <div style={{ fontSize:9, color:'var(--gray)', fontWeight:600, marginTop:1 }}>ACTUAL</div>
                      </div>
                      <div style={{ textAlign:'center', padding:'8px 4px', background:'white', borderRadius:7, border:'1px solid var(--border)' }}>
                        <div style={{ fontSize:18, fontWeight:800, fontFamily:'DM Mono, monospace', color:'var(--gray)' }}>
                          {fmtGoalValue(f.key, target)}
                        </div>
                        <div style={{ fontSize:9, color:'var(--gray)', fontWeight:600, marginTop:1 }}>TARGET</div>
                      </div>
                    </div>
                    <GoalProgressBar actual={actual} target={target} fieldKey={f.key} />
                    <div style={{ fontSize:10, color:statusConfig.color, fontWeight:700, marginTop:6, textAlign:'right' }}>
                      {displayPct}% of goal {inv ? '(lower is better)' : ''}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Goals summary badge row */}
            <div style={{ marginTop:16, display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
              <span style={{ fontSize:11, color:'var(--gray)', fontWeight:600 }}>Period Summary:</span>
              {['met','close','miss'].map(s => {
                const count = KPI_FIELDS.filter(f => {
                  const target = displayGoal[f.key];
                  if (target === null || target === undefined) return false;
                  const actual = getActual(f.key, visitStats, intakeStats, regionBreakdown, filterRegion);
                  return goalStatus(f.key, actual, target) === s;
                }).length;
                if (!count) return null;
                const cfg = { met:['#065F46','#ECFDF5','✅ On Track'], close:['#92400E','#FEF3C7','⚠ Close'], miss:['#991B1B','#FEF2F2','❌ Below'] }[s];
                return (
                  <span key={s} style={{ fontSize:11, fontWeight:700, color:cfg[0], background:cfg[1], padding:'3px 10px', borderRadius:999 }}>
                    {cfg[2]}: {count}
                  </span>
                );
              })}
              <span style={{ fontSize:11, color:'var(--gray)' }}>
                · {KPI_FIELDS.filter(f => displayGoal[f.key] !== null && displayGoal[f.key] !== undefined).length} KPIs tracked
              </span>
            </div>
          </>
        )}

        {/* All Goals History Table */}
        {filteredGoals.length > 0 && (
          <div style={{ marginTop:24 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--black)', marginBottom:10 }}>
              Goal History — {PERIOD_LABELS[filterPeriodType]} · {filterRegion === 'ALL' ? 'Company-Wide' : `Region ${filterRegion}`}
            </div>
            <div style={{ border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.8fr 0.8fr 0.8fr 0.8fr 0.8fr 0.8fr auto', padding:'8px 16px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em' }}>
                <span>Period</span><span>Visit Target</span><span>Miss Rate Max</span><span>Referrals</span><span>Accept %</span><span>Revenue</span><span>Set By</span><span></span>
              </div>
              {filteredGoals.sort((a,b) => b.period_year - a.period_year || b.period_number - a.period_number).map((g,i) => (
                <div key={g.id} style={{ display:'grid', gridTemplateColumns:'1.5fr 0.8fr 0.8fr 0.8fr 0.8fr 0.8fr 0.8fr auto', padding:'9px 16px', borderBottom:'1px solid var(--border)', background:i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'center', fontSize:12 }}>
                  <span style={{ fontWeight:600, color:'var(--black)' }}>{getPeriodLabel(g.period_type, g.period_number, g.period_year)}</span>
                  <span>{fmtGoalValue('target_visits_completed', g.target_visits_completed)}</span>
                  <span>{fmtGoalValue('target_miss_rate_max', g.target_miss_rate_max)}</span>
                  <span>{fmtGoalValue('target_referrals', g.target_referrals)}</span>
                  <span>{fmtGoalValue('target_acceptance_rate', g.target_acceptance_rate)}</span>
                  <span>{fmtGoalValue('target_revenue', g.target_revenue)}</span>
                  <span style={{ fontSize:11, color:'var(--gray)' }}>{g.set_by || '—'}</span>
                  {canEdit && (
                    <button onClick={() => setEditingGoal(g)}
                      style={{ padding:'3px 8px', border:'1px solid var(--border)', borderRadius:5, fontSize:11, background:'var(--bg)', cursor:'pointer', color:'var(--gray)' }}>
                      Edit
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Goal Editor Modal */}
      {editingGoal && (
        <GoalEditorModal
          goal={editingGoal === 'new' ? null : editingGoal}
          region={filterRegion}
          periodType={filterPeriodType}
          periodNumber={editingGoal === 'new' ? currentPeriodNumber : editingGoal.period_number}
          periodYear={editingGoal === 'new' ? currentYear : editingGoal.period_year}
          onClose={() => setEditingGoal(null)}
          onSaved={() => { setEditingGoal(null); onGoalsUpdated(); }}
          profile={profile}
        />
      )}
    </div>
  );
}
