import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

const BLENDED_RATE = 185;

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function daysAgo(d) {
  if (!d) return null;
  return Math.floor((new Date() - new Date(d+'T00:00:00')) / 86400000);
}
function pctColor(p) { return p>=80?'#059669':p>=60?'#D97706':'#DC2626'; }

// Compute overdue dynamically from last_visit_date + overdue_threshold_days
// instead of relying on the pre-computed days_overdue column, which goes stale
// after visit uploads until the SQL batch job runs again.
function computeOverdue(p) {
  if (!p.last_visit_date) return { daysSince: null, overdue: (p.overdue_threshold_days || 14) };
  var daysSince = Math.floor((Date.now() - new Date(p.last_visit_date + 'T00:00:00').getTime()) / 86400000);
  var threshold = p.overdue_threshold_days || 14;
  var overdue = Math.max(0, daysSince - threshold);
  return { daysSince: daysSince, overdue: overdue };
}

export default function RMDailyDashboard() {
  const { profile } = useAuth();
  const [census, setCensus] = useState([]);
  const [visits, setVisits] = useState([]);
  const [auths, setAuths] = useState([]);
  const [clinicians, setClinicians] = useState([]);
  const [onHold, setOnHold] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [search, setSearch] = useState('');

  const myRegions = useMemo(() => profile?.regions || [], [profile]);

  const load = useCallback(async () => {
    if (!myRegions.length) { setLoading(false); return; }
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (weekStart.getDay()===0?-6:1));
    const weekStartStr = weekStart.toISOString().slice(0,10);

    const [c, v, a, cl, oh] = await Promise.all([
      supabase.from('census_data').select('*').in('region', myRegions),
      supabase.from('visit_schedule_data').select('patient_name,staff_name,visit_date,status,event_type,region,discipline')
        .in('region', myRegions).gte('visit_date', weekStartStr),
      supabase.from('auth_tracker').select('patient_name,region,insurance,auth_status,auth_expiry_date,visits_authorized,visits_used,auth_number,assigned_to')
        .in('region', myRegions).eq('auth_status','active'),
      supabase.from('clinicians').select('*').in('region', myRegions).eq('is_active', true),
      supabase.from('on_hold_recovery').select('*').in('region', myRegions),
    ]);
    setCensus(c.data||[]);
    setVisits(v.data||[]);
    setAuths(a.data||[]);
    setClinicians(cl.data||[]);
    setOnHold(oh.data||[]);
    setLoading(false);
  }, [myRegions]);

  useEffect(() => { load(); }, [load]);

  const metrics = useMemo(() => {
    const active = census.filter(p => /active/i.test(p.status||''));
    // Frequency-aware overdue: each patient has their own threshold based on inferred cadence.
    //   4w4 → 3d, 2w4 → 4d, 1w4 → 10d, 1em1 → 30d, 1em2 → 60d, prn → never flagged.
    // Computed dynamically from last_visit_date + overdue_threshold_days so it stays
    // fresh even before the SQL batch recalculates the days_overdue column.
    const inactiveActive = active.filter(p => computeOverdue(p).overdue > 0);
    const completed = visits.filter(v => /completed/i.test(v.status||''));
    const cancelled = visits.filter(v => /cancel/i.test(v.status||'')||/cancel/i.test(v.event_type||''));
    const missed = visits.filter(v => /missed/i.test(v.status||''));
    const totalCap = clinicians.reduce((s,c)=>s+(c.weekly_visit_target||0),0);

    // Clinician stats
    const visitMap = {};
    completed.forEach(v => {
      const k = (v.staff_name_normalized || v.staff_name||'').toLowerCase().trim();
      visitMap[k] = (visitMap[k]||0)+1;
    });
    const clinicianStats = clinicians.map(cl => {
      const done = visitMap[(cl.full_name||'').toLowerCase().trim()]||0;
      const pct = cl.weekly_visit_target>0?Math.round(done/cl.weekly_visit_target*100):0;
      return { ...cl, completed:done, utilization:pct, capacity:Math.max(0,(cl.weekly_visit_target||0)-done) };
    }).sort((a,b)=>a.utilization-b.utilization);

    // Auth expiring
    const authExpiring = auths.filter(a => {
      if (!a.auth_expiry_date) return false;
      const days = Math.ceil((new Date(a.auth_expiry_date+'T00:00:00')-new Date())/86400000);
      return days <= 14;
    });

    return {
      activePatients: active.length,
      inactiveActive: inactiveActive.length,
      inactiveRevGap: inactiveActive.length * BLENDED_RATE * 2,
      completedVisits: completed.length,
      cancelledVisits: cancelled.length,
      missedVisits: missed.length,
      totalCapacity: totalCap,
      utilization: totalCap>0?Math.round(completed.length/totalCap*100):0,
      onHold: census.filter(p=>/on.?hold/i.test(p.status||'')).length,
      socPending: census.filter(p=>/soc.?pending|eval.?pending/i.test(p.status||'')).length,
      authExpiring: authExpiring.length,
      clinicianStats,
      inactivePatients: inactiveActive,
      authExpiringList: authExpiring,
    };
  }, [census, visits, auths, clinicians, onHold]);

  const filteredPatients = useMemo(() => {
    let list = census;
    if (activeTab === 'inactive') list = census.filter(p => /active/i.test(p.status||'') && computeOverdue(p).overdue > 0);
    if (activeTab === 'on_hold') list = census.filter(p => /on.?hold/i.test(p.status||''));
    if (activeTab === 'pipeline') list = census.filter(p => /soc.?pending|eval.?pending/i.test(p.status||''));
    if (activeTab === 'all_patients') list = census;
    if (search) { const q=search.toLowerCase(); list=list.filter(p=>`${p.patient_name} ${p.insurance}`.toLowerCase().includes(q)); }
    return list.sort((a,b)=>computeOverdue(b).overdue - computeOverdue(a).overdue);
  }, [census, activeTab, search]);

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="My Region — Daily View" subtitle="Loading..." />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading regional data...</div>
    </div>
  );

  if (!myRegions.length) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="My Region — Daily View" subtitle="No regions assigned" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>No regions assigned. Contact your administrator.</div>
    </div>
  );

  const today = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%' }}>
      <TopBar
        title={`Region ${myRegions.join('/')} — Daily`}
        subtitle={`${today} · ${metrics.activePatients} active · ${metrics.completedVisits} visits this week`}
        actions={<button onClick={load} style={{ padding:'6px 14px', background:'#0F1117', color:'#fff', border:'none', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer' }}>↻ Refresh</button>}
      />

      {/* Alert banners */}
      {metrics.inactiveActive > 0 && (
        <div style={{ background:'#FEF2F2', borderBottom:'2px solid #FECACA', padding:'7px 20px', display:'flex', alignItems:'center', gap:10 }}>
          <span>🚨</span>
          <span style={{ fontSize:12, fontWeight:700, color:'#DC2626' }}>
            {metrics.inactiveActive} active patients overdue vs their prescribed frequency — ${Math.round(metrics.inactiveRevGap/1000)}K/wk revenue gap in your region
          </span>
          <button onClick={() => setActiveTab('inactive')} style={{ marginLeft:'auto', fontSize:10, fontWeight:700, color:'#DC2626', background:'white', border:'1px solid #FECACA', borderRadius:5, padding:'3px 8px', cursor:'pointer' }}>View Patients</button>
        </div>
      )}
      {metrics.authExpiring > 0 && (
        <div style={{ background:'#FEF3C7', borderBottom:'1px solid #FCD34D', padding:'7px 20px', display:'flex', alignItems:'center', gap:10 }}>
          <span>⚠</span>
          <span style={{ fontSize:12, fontWeight:700, color:'#92400E' }}>{metrics.authExpiring} auth{metrics.authExpiring>1?'s':''} expiring in 14 days — contact Carla now</span>
        </div>
      )}

      <div style={{ flex:1, overflowY:'auto' }}>
        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>

          {/* KPI strip — each tile routes to the matching tab so RMs can drill
              in without scanning the tab bar. "targetTab" null = informational only. */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10 }}>
            {[
              { label:'Active Patients', val:metrics.activePatients, color:'#059669', bg:'#ECFDF5', targetTab:'all_patients', hint:'see full roster' },
              { label:'Visits This Week', val:metrics.completedVisits, color:'#1565C0', bg:'#EFF6FF', targetTab:null, hint:null },
              { label:'Capacity Used', val:metrics.utilization+'%', color:pctColor(metrics.utilization), bg:'var(--card-bg)', targetTab:'clinicians', hint:'by clinician' },
              { label:'🔴 Overdue vs Freq', val:metrics.inactiveActive, color:'#DC2626', bg:'#FEF2F2', targetTab:'inactive', hint:'view patients' },
              { label:'🔄 On Hold', val:metrics.onHold, color:'#7C3AED', bg:'#F5F3FF', targetTab:'on_hold', hint:'view list' },
              { label:'⏳ Pipeline', val:metrics.socPending, color:'#D97706', bg:'#FEF3C7', targetTab:'pipeline', hint:'view pipeline' },
            ].map(c => {
              const clickable = !!c.targetTab;
              const isActive = clickable && activeTab === c.targetTab;
              return (
                <div key={c.label}
                  onClick={clickable ? () => setActiveTab(c.targetTab) : undefined}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onKeyDown={clickable ? e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); setActiveTab(c.targetTab); } } : undefined}
                  style={{ background:c.bg, border: isActive ? `2px solid ${c.color}` : '1px solid var(--border)', borderRadius:10, padding: isActive ? '9px 11px' : '10px 12px', textAlign:'center', cursor: clickable ? 'pointer' : 'default', transition: 'transform 0.1s ease, box-shadow 0.15s ease', boxShadow: isActive ? `0 0 0 2px ${c.color}20` : 'none' }}
                  onMouseEnter={clickable ? e => { e.currentTarget.style.transform='translateY(-1px)'; e.currentTarget.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'; } : undefined}
                  onMouseLeave={clickable ? e => { e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow= isActive ? `0 0 0 2px ${c.color}20` : 'none'; } : undefined}>
                  <div style={{ fontSize:8, fontWeight:700, color:c.color, textTransform:'uppercase', letterSpacing:'0.05em' }}>{c.label}</div>
                  <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', color:c.color, marginTop:2 }}>{c.val}</div>
                  {clickable && (
                    <div style={{ fontSize:8, color:c.color, marginTop:2, opacity: isActive ? 0.9 : 0.55, fontWeight:600 }}>
                      {isActive ? '✓ showing' : c.hint + ' →'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Tab row */}
          <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:8, overflow:'hidden', alignSelf:'flex-start' }}>
            {[
              { k:'overview',     l:'📊 Overview' },
              { k:'clinicians',   l:`👤 My Clinicians (${clinicians.length})` },
              { k:'inactive',     l:`🚨 Overdue (${metrics.inactiveActive})` },
              { k:'on_hold',      l:`🔄 On Hold (${metrics.onHold})` },
              { k:'pipeline',     l:`⏳ Pipeline (${metrics.socPending})` },
              { k:'all_patients', l:'All Patients' },
            ].map(t => (
              <button key={t.k} onClick={() => setActiveTab(t.k)}
                style={{ padding:'7px 14px', border:'none', fontSize:11, fontWeight:activeTab===t.k?700:400, cursor:'pointer', background:activeTab===t.k?'#0F1117':'var(--card-bg)', color:activeTab===t.k?'#fff':'var(--gray)', borderRight:'1px solid var(--border)' }}>
                {t.l}
              </button>
            ))}
          </div>

          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              {/* Visit breakdown */}
              <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:16 }}>
                <div style={{ fontSize:13, fontWeight:800, marginBottom:12 }}>This Week's Visit Summary</div>
                {[
                  { label:'Completed', val:metrics.completedVisits, color:'#059669' },
                  { label:'Cancelled', val:metrics.cancelledVisits, color:'#DC2626' },
                  { label:'Missed', val:metrics.missedVisits, color:'#D97706' },
                  { label:'Total Capacity', val:metrics.totalCapacity, color:'#1565C0' },
                ].map(r => (
                  <div key={r.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                    <span style={{ fontSize:12, color:'var(--gray)' }}>{r.label}</span>
                    <span style={{ fontSize:18, fontWeight:900, fontFamily:'DM Mono, monospace', color:r.color }}>{r.val}</span>
                  </div>
                ))}
                <div style={{ marginTop:12 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:4 }}>
                    <span style={{ color:'var(--gray)' }}>Utilization</span>
                    <span style={{ fontWeight:700, color:pctColor(metrics.utilization) }}>{metrics.utilization}%</span>
                  </div>
                  <div style={{ background:'#E5E7EB', borderRadius:999, height:8 }}>
                    <div style={{ width:`${metrics.utilization}%`, height:'100%', background:pctColor(metrics.utilization), borderRadius:999 }} />
                  </div>
                </div>
              </div>

              {/* Auth expiring */}
              <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:16 }}>
                <div style={{ fontSize:13, fontWeight:800, marginBottom:12, display:'flex', justifyContent:'space-between' }}>
                  <span>Auths Expiring ≤14 Days</span>
                  <span style={{ fontSize:11, color:metrics.authExpiring>0?'#DC2626':'#059669', fontWeight:700 }}>{metrics.authExpiring > 0 ? `${metrics.authExpiring} at risk` : '✅ All clear'}</span>
                </div>
                {metrics.authExpiringList.length === 0 ? (
                  <div style={{ padding:24, textAlign:'center', color:'#059669', fontWeight:700 }}>✅ No auths expiring this week</div>
                ) : metrics.authExpiringList.slice(0,6).map((a, i) => {
                  const days = Math.ceil((new Date(a.auth_expiry_date+'T00:00:00')-new Date())/86400000);
                  return (
                    <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px solid var(--border)' }}>
                      <div>
                        <div style={{ fontSize:11, fontWeight:600 }}>{a.patient_name}</div>
                        <div style={{ fontSize:9, color:'var(--gray)' }}>{a.insurance}</div>
                      </div>
                      <div style={{ fontSize:14, fontWeight:900, fontFamily:'DM Mono, monospace', color:days<=7?'#DC2626':'#D97706' }}>
                        {days <= 0 ? 'EXP' : `${days}d`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* CLINICIANS TAB */}
          {activeTab === 'clinicians' && (
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', fontSize:13, fontWeight:800 }}>
                My Clinicians — This Week
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1.8fr 0.5fr 1.6fr 0.6fr 0.6fr 0.6fr', padding:'8px 16px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:9, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', gap:8 }}>
                <span>Clinician</span><span>Disc</span><span>Utilization</span><span>Done</span><span>Target</span><span>Available</span>
              </div>
              {metrics.clinicianStats.map((cl, i) => (
                <div key={cl.full_name} style={{ display:'grid', gridTemplateColumns:'1.8fr 0.5fr 1.6fr 0.6fr 0.6fr 0.6fr', padding:'9px 16px', borderBottom:'1px solid var(--border)', background:cl.utilization<30?'#FFF5F5':cl.utilization<60?'#FFFBEB':i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:12, fontWeight:600 }}>{cl.full_name}</span>
                  <span style={{ fontSize:10, color:'var(--gray)' }}>{cl.discipline}</span>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{ flex:1, height:6, background:'#E5E7EB', borderRadius:999 }}>
                      <div style={{ width:`${Math.min(100,cl.utilization)}%`, height:'100%', background:pctColor(cl.utilization), borderRadius:999 }} />
                    </div>
                    <span style={{ fontSize:11, fontWeight:700, color:pctColor(cl.utilization), minWidth:28 }}>{cl.utilization}%</span>
                  </div>
                  <span style={{ fontSize:13, fontWeight:700, color:'#059669' }}>{cl.completed}</span>
                  <span style={{ fontSize:12, color:'var(--gray)' }}>{cl.weekly_visit_target}</span>
                  <span style={{ fontSize:12, fontWeight:600, color:cl.capacity>5?'#059669':cl.capacity>0?'#D97706':'#DC2626' }}>+{cl.capacity}</span>
                </div>
              ))}
            </div>
          )}

          {/* PATIENT TABS (inactive/on_hold/pipeline/all_patients) */}
          {['inactive','on_hold','pipeline','all_patients'].includes(activeTab) && (
            <>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient..."
                  style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)', width:200 }} />
                <div style={{ marginLeft:'auto', fontSize:11, color:'var(--gray)' }}>{filteredPatients.length} patients</div>
              </div>
              <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
                <div style={{ display:'grid', gridTemplateColumns:'1.7fr 0.9fr 0.8fr 0.6fr 0.7fr 0.6fr 0.7fr 1.1fr', padding:'8px 16px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:9, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', gap:8 }}>
                  <span>Patient</span><span>Insurance</span><span>Status</span><span>Freq</span><span>Last Visit</span><span>Days Since</span><span>Overdue</span><span>Last Clinician</span>
                </div>
                {filteredPatients.length === 0 ? (
                  <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>
                    {activeTab==='inactive'?'✅ No patients overdue — every patient seen within their prescribed frequency window.':'No patients in this category.'}
                  </div>
                ) : filteredPatients.map((p, i) => {
                  const ov = computeOverdue(p);
                  const days = ov.daysSince;
                  const overdue = ov.overdue;
                  const dc = overdue>0?'#DC2626':days>7?'#D97706':'#059669';
                  const rowBg = overdue>0?'#FFF5F5':i%2===0?'var(--card-bg)':'var(--bg)';
                  const freq = p.inferred_frequency || '—';
                  return (
                    <div key={p.patient_name+i} style={{ display:'grid', gridTemplateColumns:'1.7fr 0.9fr 0.8fr 0.6fr 0.7fr 0.6fr 0.7fr 1.1fr', padding:'9px 16px', borderBottom:'1px solid var(--border)', background:rowBg, alignItems:'center', gap:8 }}>
                      <div style={{ fontSize:12, fontWeight:600 }}>{p.patient_name}</div>
                      <span style={{ fontSize:11 }}>{p.insurance}</span>
                      <span style={{ fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:999, background:/active/i.test(p.status||'')?'#ECFDF5':'#F5F3FF', color:/active/i.test(p.status||'')?'#065F46':'#7C3AED' }}>{p.status}</span>
                      <span style={{ fontSize:10, fontWeight:600, fontFamily:'DM Mono, monospace', color:'#475569' }}>{freq}</span>
                      <span style={{ fontSize:11 }}>{fmtDate(p.last_visit_date)}</span>
                      <span style={{ fontSize:13, fontWeight:700, fontFamily:'DM Mono, monospace', color:dc }}>{days !== null ? `${days}d` : '—'}</span>
                      <span style={{ fontSize:12, fontWeight:700, fontFamily:'DM Mono, monospace', color:overdue>0?'#DC2626':'#94A3B8' }}>{overdue>0?`+${overdue}d`:'—'}</span>
                      <span style={{ fontSize:11, color:'#1565C0', fontWeight:p.last_visit_clinician?600:400 }}>{p.last_visit_clinician || '—'}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
