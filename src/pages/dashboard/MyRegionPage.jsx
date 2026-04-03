import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

const RATE = 230;

const ALL_MANAGERS = {
  A:'Uma Jacobs', B:'Lia Davis', C:'Earl Dimaano', G:'Samantha Faliks',
  H:'Kaylee Ramsey', J:'Hollie Fincher', M:'Ariel Maboudi', N:'Ariel Maboudi',
  T:'Samantha Faliks', V:'Samantha Faliks',
};

function isCancelled(e,s) { return /cancel/i.test(e||'')||/cancel/i.test(s||''); }
function isCompleted(s,e) { return /completed/i.test(s||'') && !isCancelled(e,s); }
function isMissed(s,e) { return /missed/i.test(s||'') && !isCancelled(e,s); }
function fmtDate(d) { if (!d) return '—'; return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}); }

function StatCard({ label, value, sub, color='var(--black)', bg='var(--card-bg)', icon }) {
  return (
    <div style={{ background:bg, border:'1px solid var(--border)', borderRadius:10, padding:'14px 16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{label}</div>
        {icon && <span style={{ fontSize:16 }}>{icon}</span>}
      </div>
      <div style={{ fontSize:24, fontWeight:800, fontFamily:'DM Mono, monospace', color, marginTop:6 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'var(--gray)', marginTop:3 }}>{sub}</div>}
    </div>
  );
}

export default function MyRegionPage() {
  const { profile } = useAuth();
  const [visits, setVisits] = useState([]);
  const [census, setCensus] = useState([]);
  const [clinicians, setClinicians] = useState([]);
  const [authData, setAuthData] = useState([]);
  const [intake, setIntake] = useState([]);
  const [onHold, setOnHold] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [searchPatient, setSearchPatient] = useState('');
  const [filterClinician, setFilterClinician] = useState('ALL');

  // Determine which regions this user manages
  const myRegions = useMemo(() => {
    if (!profile) return [];
    // Super admin / CEO / admin see all
    if (['super_admin','ceo','admin'].includes(profile.role)) return ['A','B','C','G','H','J','M','N','T','V'];
    // Regional managers and pod leaders see their assigned regions
    const assigned = profile.regions || [];
    if (assigned.length > 0) return assigned;
    // Fallback: match by name against regional manager map
    const name = profile.full_name || '';
    return Object.entries(ALL_MANAGERS)
      .filter(([,mgr]) => mgr.toLowerCase().includes(name.split(' ')[0]?.toLowerCase() || ''))
      .map(([r]) => r);
  }, [profile]);

  const isAdmin = ['super_admin','ceo','admin'].includes(profile?.role || '');
  const managerName = profile?.full_name || 'Regional Manager';
  const regionLabel = myRegions.length > 0 ? `Region${myRegions.length > 1 ? 's' : ''} ${myRegions.join(', ')}` : 'No regions assigned';

  useEffect(() => {
    if (myRegions.length === 0) { setLoading(false); return; }
    Promise.all([
      supabase.from('visit_schedule_data').select('*').in('region', myRegions).not('visit_date','is',null),
      supabase.from('census_data').select('*').in('region', myRegions),
      supabase.from('clinicians').select('*').in('region', myRegions).eq('is_active', true),
      supabase.from('auth_tracker').select('*').in('region', myRegions),
      supabase.from('intake_referrals').select('*').in('region', myRegions).not('date_received','is',null),
      supabase.from('on_hold_recovery').select('*').in('region', myRegions).eq('recovery_status','on_hold'),
    ]).then(([v,c,cl,a,i,oh]) => {
      setVisits(v.data||[]); setCensus(c.data||[]); setClinicians(cl.data||[]);
      setAuthData(a.data||[]); setIntake(i.data||[]); setOnHold(oh.data||[]);
      setLoading(false);
    });
  }, [myRegions.join(',')]);

  // ── Week boundaries ────────────────────────────────────────────
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - (now.getDay()===0?6:now.getDay()-1)); weekStart.setHours(0,0,0,0);
  const weekStartStr = weekStart.toISOString().slice(0,10);
  const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;

  // ── Visit stats ────────────────────────────────────────────────
  const weekVisits = visits.filter(v => v.visit_date >= weekStartStr);
  const completed = weekVisits.filter(v => isCompleted(v.status,v.event_type));
  const missed = weekVisits.filter(v => isMissed(v.status,v.event_type));
  const cancelled = weekVisits.filter(v => isCancelled(v.event_type,v.status));
  const scheduled = weekVisits.filter(v => /scheduled/i.test(v.status||'') && !isCancelled(v.event_type,v.status));
  const missRate = completed.length+missed.length > 0 ? Math.round(missed.length/(completed.length+missed.length)*100) : 0;
  const weekRevenue = completed.length * RATE;

  // Active patients
  const activePatients = census.filter(c => c.status === 'Active' || c.status === 'Active - Auth Pendin');
  const hospitalizedPts = census.filter(c => c.status === 'Hospitalized');

  // Monthly referrals
  const monthIntake = intake.filter(i => i.date_received >= monthStart);
  const accepted = monthIntake.filter(i => i.referral_status === 'Accepted').length;

  // ── Clinician productivity ─────────────────────────────────────
  const clinicianStats = useMemo(() => {
    return clinicians.map(c => {
      const lastName = (c.full_name||'').split(',')[0].trim().split(' ').pop();
      const pariox = c.pariox_name || '';
      const myVisits = weekVisits.filter(v =>
        v.staff_name && (
          (pariox && v.staff_name.toLowerCase().includes(pariox.toLowerCase())) ||
          v.staff_name.toLowerCase().includes(lastName.toLowerCase())
        )
      );
      const comp = myVisits.filter(v => isCompleted(v.status,v.event_type)).length;
      const miss = myVisits.filter(v => isMissed(v.status,v.event_type)).length;
      const canc = myVisits.filter(v => isCancelled(v.event_type,v.status)).length;
      const sched = myVisits.filter(v => /scheduled/i.test(v.status||'') && !isCancelled(v.event_type,v.status)).length;
      const target = c.weekly_visit_target || 25;
      const pct = Math.round((comp / target) * 100);
      return { ...c, comp, miss, canc, sched, target, pct, revenue: comp * RATE };
    }).sort((a,b) => b.pct - a.pct);
  }, [clinicians, weekVisits]);

  // ── Patient list (census-driven) ──────────────────────────────
  const patientList = useMemo(() => {
    return census
      .filter(p => {
        if (searchPatient && !p.patient_name?.toLowerCase().includes(searchPatient.toLowerCase())) return false;
        return true;
      })
      .map(p => {
        const auth = authData.find(a => a.patient_name === p.patient_name);
        const lastVisit = visits.filter(v => v.patient_name === p.patient_name && isCompleted(v.status,v.event_type))
          .sort((a,b) => b.visit_date.localeCompare(a.visit_date))[0];
        const nextVisit = visits.filter(v => v.patient_name === p.patient_name && /scheduled/i.test(v.status||''))
          .sort((a,b) => a.visit_date.localeCompare(b.visit_date))[0];
        const missedCount = visits.filter(v => v.patient_name === p.patient_name && isMissed(v.status,v.event_type)).length;
        const currentLevel = visits.filter(v => v.patient_name === p.patient_name && isCompleted(v.status,v.event_type))
          .sort((a,b) => b.visit_date.localeCompare(a.visit_date))[0]?.event_type || '';
        return { ...p, auth, lastVisit, nextVisit, missedCount, currentLevel };
      })
      .sort((a,b) => (a.patient_name||'').localeCompare(b.patient_name||''));
  }, [census, authData, visits, searchPatient]);

  // Auth tracker — expiring / low visits
  const expiringAuth = authData.filter(a => {
    if (!a.auth_expiry_date) return false;
    const days = Math.floor((new Date(a.auth_expiry_date) - now) / 86400000);
    return days >= 0 && days <= 14;
  });
  const lowVisits = authData.filter(a => a.visits_authorized && a.visits_used && (a.visits_authorized - a.visits_used) <= 4);

  const clinicians_in_region = clinicians.map(c => c.full_name).filter(Boolean);

  if (!profile) return null;

  if (myRegions.length === 0) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="My Region" subtitle="No regions assigned" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:12, color:'var(--gray)' }}>
        <div style={{ fontSize:32 }}>🗺</div>
        <div style={{ fontSize:15, fontWeight:600 }}>No regions are assigned to your account</div>
        <div style={{ fontSize:13 }}>Contact your administrator to assign regions to your profile.</div>
      </div>
    </div>
  );

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="My Region" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading your regional data…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar
        title={isAdmin ? `Regional View${myRegions.length<10?' — '+regionLabel:''}` : `My Region — ${regionLabel}`}
        subtitle={`${managerName} · ${activePatients.length} active patients · ${clinicians.length} clinicians`}
      />
      <div style={{ flex:1, overflow:'auto' }}>

        {/* Tab bar */}
        <div style={{ display:'flex', gap:0, borderBottom:'1px solid var(--border)', background:'var(--card-bg)', padding:'0 20px' }}>
          {[['overview','📊 Overview'],['productivity','👤 Clinician Productivity'],['patients','🧑 My Patients'],['auth','🔑 Authorizations'],['onhold','⏸ On Hold']].map(([k,l]) => (
            <button key={k} onClick={() => setActiveTab(k)}
              style={{ padding:'12px 16px', border:'none', borderBottom:`2px solid ${activeTab===k?'#DC2626':'transparent'}`, background:'none', fontSize:12, fontWeight:activeTab===k?700:400, color:activeTab===k?'#DC2626':'var(--gray)', cursor:'pointer', whiteSpace:'nowrap' }}>
              {l}
            </button>
          ))}
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8, padding:'8px 0' }}>
            <span style={{ fontSize:11, color:'var(--gray)' }}>Showing:</span>
            {myRegions.map(r => (
              <span key={r} style={{ fontSize:11, fontWeight:700, color:'var(--black)', background:'var(--border)', padding:'2px 8px', borderRadius:999 }}>
                Region {r}
              </span>
            ))}
          </div>
        </div>

        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>

          {/* ── OVERVIEW TAB ──────────────────────────────────────── */}
          {activeTab === 'overview' && (
            <>
              {/* KPI row */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:14 }}>
                <StatCard label="Visits This Week" value={completed.length} icon="✅"
                  sub={`${scheduled.length} still scheduled`} color="#065F46" bg="#ECFDF5" />
                <StatCard label="Miss Rate" value={missRate+'%'} icon="❌"
                  sub={`${missed.length} missed this week`}
                  color={missRate>15?'#DC2626':missRate>8?'#D97706':'#065F46'}
                  bg={missRate>15?'#FEF2F2':missRate>8?'#FEF3C7':'#ECFDF5'} />
                <StatCard label="Active Patients" value={activePatients.length} icon="🧑"
                  sub={`${hospitalizedPts.length} hospitalized · ${onHold.length} on hold`} />
                <StatCard label="Referrals This Month" value={monthIntake.length} icon="📥"
                  sub={`${accepted} accepted · ${monthIntake.length>0?Math.round(accepted/monthIntake.length*100):0}% conv.`}
                  color="#1565C0" bg="#EFF6FF" />
                <StatCard label="Est. Week Revenue" value={'$'+(weekRevenue/1000).toFixed(1)+'k'} icon="💰"
                  sub={`$${RATE}/visit · ${completed.length} completed`} color="#065F46" bg="#ECFDF5" />
              </div>

              {/* Per-region breakdown if multiple regions */}
              {myRegions.length > 1 && (
                <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
                  <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', fontSize:14, fontWeight:700 }}>Performance by Region</div>
                  <div style={{ display:'grid', gridTemplateColumns:'0.4fr 1fr 0.8fr 0.7fr 0.7fr 0.7fr 0.7fr 0.7fr', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em' }}>
                    <span>Rgn</span><span>Manager</span><span>Patients</span><span>Completed</span><span>Missed</span><span>Cancelled</span><span>Miss Rate</span><span>Revenue</span>
                  </div>
                  {myRegions.map((r,i) => {
                    const rv = weekVisits.filter(v => v.region === r);
                    const rc = rv.filter(v => isCompleted(v.status,v.event_type));
                    const rm = rv.filter(v => isMissed(v.status,v.event_type));
                    const rcan = rv.filter(v => isCancelled(v.event_type,v.status));
                    const rpts = census.filter(p => p.region === r && (p.status==='Active'||p.status==='Active - Auth Pendin')).length;
                    const mr = rc.length+rm.length>0 ? Math.round(rm.length/(rc.length+rm.length)*100) : 0;
                    return (
                      <div key={r} style={{ display:'grid', gridTemplateColumns:'0.4fr 1fr 0.8fr 0.7fr 0.7fr 0.7fr 0.7fr 0.7fr', padding:'10px 20px', borderBottom:'1px solid var(--border)', background:i%2===0?'var(--card-bg)':'var(--bg)', fontSize:12, alignItems:'center' }}>
                        <span style={{ fontSize:20, fontWeight:900 }}>{r}</span>
                        <span style={{ color:'var(--gray)', fontSize:11 }}>{ALL_MANAGERS[r]}</span>
                        <span style={{ fontWeight:700 }}>{rpts}</span>
                        <span style={{ fontWeight:700, color:'#065F46' }}>{rc.length}</span>
                        <span style={{ fontWeight:rm.length>0?700:400, color:rm.length>5?'#DC2626':rm.length>0?'#D97706':'var(--gray)' }}>{rm.length}</span>
                        <span style={{ color:'var(--gray)' }}>{rcan.length}</span>
                        <span style={{ fontWeight:700, color:mr>15?'#DC2626':mr>8?'#D97706':'#065F46' }}>{mr}%</span>
                        <span style={{ fontFamily:'DM Mono, monospace', fontWeight:600, color:'#065F46', fontSize:11 }}>${(rc.length*RATE/1000).toFixed(1)}k</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Alerts row */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                {/* Auth alerts */}
                <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:18 }}>
                  <div style={{ fontSize:14, fontWeight:700, marginBottom:12 }}>
                    🔑 Auth Alerts
                    {expiringAuth.length+lowVisits.length > 0 && (
                      <span style={{ marginLeft:8, fontSize:11, color:'#DC2626', background:'#FEF2F2', padding:'2px 7px', borderRadius:999 }}>
                        {expiringAuth.length+lowVisits.length} need attention
                      </span>
                    )}
                  </div>
                  {expiringAuth.length === 0 && lowVisits.length === 0 ? (
                    <div style={{ color:'var(--gray)', fontSize:13 }}>✅ No auth alerts for your regions</div>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:200, overflowY:'auto' }}>
                      {expiringAuth.slice(0,5).map(a => {
                        const days = Math.floor((new Date(a.auth_expiry_date) - now) / 86400000);
                        return (
                          <div key={a.id} style={{ display:'flex', justifyContent:'space-between', padding:'7px 10px', background:'#FEF3C7', borderRadius:7, fontSize:12 }}>
                            <span style={{ fontWeight:600 }}>{a.patient_name}</span>
                            <span style={{ color:'#D97706', fontWeight:700 }}>Expires in {days}d</span>
                          </div>
                        );
                      })}
                      {lowVisits.slice(0,5).map(a => (
                        <div key={a.id} style={{ display:'flex', justifyContent:'space-between', padding:'7px 10px', background:'#FEF2F2', borderRadius:7, fontSize:12 }}>
                          <span style={{ fontWeight:600 }}>{a.patient_name}</span>
                          <span style={{ color:'#DC2626', fontWeight:700 }}>{a.visits_authorized-a.visits_used} visits left</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* On Hold + Hospitalized */}
                <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:18 }}>
                  <div style={{ fontSize:14, fontWeight:700, marginBottom:12 }}>⏸ On Hold & Hospitalized</div>
                  {onHold.length === 0 && hospitalizedPts.length === 0 ? (
                    <div style={{ color:'var(--gray)', fontSize:13 }}>No patients currently on hold or hospitalized</div>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:200, overflowY:'auto' }}>
                      {hospitalizedPts.map(p => (
                        <div key={p.patient_name} style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', background:'#FEF2F2', borderRadius:6, fontSize:12 }}>
                          <span style={{ fontWeight:600 }}>{p.patient_name}</span>
                          <span style={{ fontSize:10, color:'#DC2626', fontWeight:700, background:'#FEF2F2', padding:'1px 7px', borderRadius:999 }}>🏥 Hospitalized</span>
                        </div>
                      ))}
                      {onHold.slice(0,8).map(p => (
                        <div key={p.id} style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', background:'#FEF3C7', borderRadius:6, fontSize:12 }}>
                          <span style={{ fontWeight:600 }}>{p.patient_name}</span>
                          <span style={{ fontSize:10, color:'#D97706', fontWeight:700 }}>{p.days_on_hold||0}d on hold</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── CLINICIAN PRODUCTIVITY TAB ───────────────────────── */}
          {activeTab === 'productivity' && (
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:15, fontWeight:700 }}>Clinician Productivity — This Week</div>
                  <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>{clinicianStats.length} active clinicians · vs weekly visit targets</div>
                </div>
                <div style={{ display:'flex', gap:12, fontSize:11 }}>
                  <span style={{ color:'#065F46' }}>🟢 ≥80%</span>
                  <span style={{ color:'#D97706' }}>🟡 60–79%</span>
                  <span style={{ color:'#DC2626' }}>🔴 &lt;60%</span>
                </div>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1.4fr 0.5fr 0.9fr 0.7fr 0.6fr 0.6fr 0.6fr 0.7fr 0.7fr', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', gap:8 }}>
                <span>Clinician</span><span>Rgn</span><span>% of Target</span><span>Completed</span><span>Target</span><span>Missed</span><span>Cancelled</span><span>Scheduled</span><span>Revenue</span>
              </div>

              {clinicianStats.length === 0 ? (
                <div style={{ padding:32, textAlign:'center', color:'var(--gray)' }}>No clinician data available for this week.</div>
              ) : clinicianStats.map((c, i) => {
                const pctColor = c.pct >= 80 ? '#065F46' : c.pct >= 60 ? '#D97706' : '#DC2626';
                const pctBg = c.pct >= 80 ? '#ECFDF5' : c.pct >= 60 ? '#FEF3C7' : '#FEF2F2';
                return (
                  <div key={c.id} style={{ display:'grid', gridTemplateColumns:'1.4fr 0.5fr 0.9fr 0.7fr 0.6fr 0.6fr 0.6fr 0.7fr 0.7fr', padding:'10px 20px', borderBottom:'1px solid var(--border)', background:i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'center', gap:8 }}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600 }}>{c.full_name}</div>
                      <div style={{ fontSize:10, color:'var(--gray)' }}>{c.discipline} · {c.employment_type}</div>
                    </div>
                    <span style={{ fontSize:13, fontWeight:700, color:'var(--gray)' }}>{c.region}</span>
                    <div>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:3 }}>
                        <span style={{ fontWeight:800, color:pctColor, background:pctBg, padding:'1px 7px', borderRadius:999 }}>{Math.min(c.pct,999)}%</span>
                        <span style={{ color:'var(--gray)', fontSize:10 }}>{c.comp}/{c.target}</span>
                      </div>
                      <div style={{ height:5, background:'var(--border)', borderRadius:999 }}>
                        <div style={{ height:'100%', width:Math.min(c.pct,100)+'%', background:pctColor, borderRadius:999 }} />
                      </div>
                    </div>
                    <span style={{ fontSize:13, fontWeight:700, color:'#065F46' }}>{c.comp}</span>
                    <span style={{ fontSize:12, color:'var(--gray)' }}>{c.target}</span>
                    <span style={{ fontSize:13, fontWeight:c.miss>0?700:400, color:c.miss>3?'#DC2626':c.miss>0?'#D97706':'var(--gray)' }}>{c.miss}</span>
                    <span style={{ fontSize:13, color:'var(--gray)' }}>{c.canc}</span>
                    <span style={{ fontSize:12, color:'#1565C0' }}>{c.sched}</span>
                    <span style={{ fontSize:12, fontFamily:'DM Mono, monospace', color:'#065F46' }}>${(c.revenue/1000).toFixed(1)}k</span>
                  </div>
                );
              })}

              {/* Team totals footer */}
              <div style={{ display:'grid', gridTemplateColumns:'1.4fr 0.5fr 0.9fr 0.7fr 0.6fr 0.6fr 0.6fr 0.7fr 0.7fr', padding:'10px 20px', borderTop:'2px solid var(--border)', background:'var(--bg)', fontSize:12, fontWeight:700, gap:8 }}>
                <span>TOTALS</span><span></span><span></span>
                <span style={{ color:'#065F46' }}>{clinicianStats.reduce((s,c)=>s+c.comp,0)}</span>
                <span>{clinicianStats.reduce((s,c)=>s+c.target,0)}</span>
                <span style={{ color:'#DC2626' }}>{clinicianStats.reduce((s,c)=>s+c.miss,0)}</span>
                <span>{clinicianStats.reduce((s,c)=>s+c.canc,0)}</span>
                <span style={{ color:'#1565C0' }}>{clinicianStats.reduce((s,c)=>s+c.sched,0)}</span>
                <span style={{ fontFamily:'DM Mono, monospace', color:'#065F46' }}>${(clinicianStats.reduce((s,c)=>s+c.revenue,0)/1000).toFixed(1)}k</span>
              </div>
            </div>
          )}

          {/* ── PATIENTS TAB ─────────────────────────────────────── */}
          {activeTab === 'patients' && (
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
                <div>
                  <div style={{ fontSize:15, fontWeight:700 }}>Patients in My Region{myRegions.length>1?'s':''}</div>
                  <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>{census.length} total · {activePatients.length} active</div>
                </div>
                <input value={searchPatient} onChange={e => setSearchPatient(e.target.value)}
                  placeholder="Search patient name…"
                  style={{ padding:'7px 12px', border:'1px solid var(--border)', borderRadius:7, fontSize:12, outline:'none', background:'var(--bg)', width:220 }} />
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.4fr 0.9fr 0.7fr 0.8fr 0.8fr 0.7fr 0.7fr', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', gap:8 }}>
                <span>Patient</span><span>Rgn</span><span>Status</span><span>Insurance</span><span>Last Visit</span><span>Next Visit</span><span>Missed</span><span>Auth</span>
              </div>

              <div style={{ maxHeight:500, overflowY:'auto' }}>
                {patientList.length === 0 ? (
                  <div style={{ padding:32, textAlign:'center', color:'var(--gray)' }}>No patients found.</div>
                ) : patientList.map((p, i) => {
                  const statusColor = p.status === 'Active' ? '#065F46' : p.status === 'Hospitalized' ? '#DC2626' : p.status?.includes('Hold') ? '#D97706' : '#6B7280';
                  const statusBg = p.status === 'Active' ? '#ECFDF5' : p.status === 'Hospitalized' ? '#FEF2F2' : p.status?.includes('Hold') ? '#FEF3C7' : '#F3F4F6';
                  const authVisitsLeft = p.auth ? (p.auth.visits_authorized||0)-(p.auth.visits_used||0) : null;
                  const authAlert = authVisitsLeft !== null && authVisitsLeft <= 4;
                  return (
                    <div key={p.id||i} style={{ display:'grid', gridTemplateColumns:'1.5fr 0.4fr 0.9fr 0.7fr 0.8fr 0.8fr 0.7fr 0.7fr', padding:'9px 20px', borderBottom:'1px solid var(--border)', background:i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'center', gap:8 }}>
                      <div>
                        <div style={{ fontSize:12, fontWeight:600 }}>{p.patient_name}</div>
                        {p.currentLevel && <div style={{ fontSize:10, color:'var(--gray)' }}>{p.currentLevel.replace(' *e*','').replace(' (PDF)','').substring(0,30)}</div>}
                      </div>
                      <span style={{ fontSize:12, fontWeight:700, color:'var(--gray)' }}>{p.region}</span>
                      <span style={{ fontSize:10, fontWeight:700, color:statusColor, background:statusBg, padding:'2px 7px', borderRadius:999, display:'inline-block' }}>
                        {p.status || '—'}
                      </span>
                      <span style={{ fontSize:11, color:'var(--gray)' }}>{p.insurance || '—'}</span>
                      <span style={{ fontSize:11, color: p.lastVisit ? 'var(--black)' : 'var(--gray)' }}>{p.lastVisit ? fmtDate(p.lastVisit.visit_date) : '—'}</span>
                      <span style={{ fontSize:11, color: p.nextVisit ? '#1565C0' : 'var(--gray)', fontWeight: p.nextVisit ? 600 : 400 }}>{p.nextVisit ? fmtDate(p.nextVisit.visit_date) : '—'}</span>
                      <span style={{ fontSize:12, fontWeight:p.missedCount>0?700:400, color:p.missedCount>2?'#DC2626':p.missedCount>0?'#D97706':'var(--gray)' }}>
                        {p.missedCount > 0 ? `${p.missedCount} ⚠` : '0'}
                      </span>
                      <span style={{ fontSize:11, fontWeight:authAlert?700:400, color:authAlert?'#DC2626':'var(--gray)' }}>
                        {authVisitsLeft !== null ? `${authVisitsLeft} left${authAlert?' ⚠':''}` : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── AUTHORIZATIONS TAB ───────────────────────────────── */}
          {activeTab === 'auth' && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {(expiringAuth.length > 0 || lowVisits.length > 0) && (
                <div style={{ background:'#FEF2F2', border:'2px solid #FECACA', borderRadius:10, padding:'12px 16px' }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'#DC2626', marginBottom:6 }}>
                    ⚠ {expiringAuth.length + lowVisits.length} authorizations need attention
                  </div>
                  <div style={{ fontSize:11, color:'#991B1B' }}>
                    {expiringAuth.length} expiring within 14 days · {lowVisits.length} with ≤4 visits remaining
                  </div>
                </div>
              )}
              <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
                <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', fontSize:14, fontWeight:700 }}>
                  All Authorizations — {regionLabel}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.5fr 0.8fr 0.7fr 0.7fr 0.7fr 0.8fr 0.8fr 0.7fr', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', gap:8 }}>
                  <span>Patient</span><span>Rgn</span><span>Insurance</span><span>Auth #</span><span>Status</span><span>Visits Auth</span><span>Visits Used</span><span>Expiry</span><span>Days Left</span>
                </div>
                <div style={{ maxHeight:500, overflowY:'auto' }}>
                  {authData.length === 0 ? (
                    <div style={{ padding:32, textAlign:'center', color:'var(--gray)' }}>No authorization records.</div>
                  ) : authData.sort((a,b) => {
                    // Sort by urgency: expiring first, then low visits
                    const aD = a.auth_expiry_date ? Math.floor((new Date(a.auth_expiry_date)-now)/86400000) : 999;
                    const bD = b.auth_expiry_date ? Math.floor((new Date(b.auth_expiry_date)-now)/86400000) : 999;
                    return aD - bD;
                  }).map((a,i) => {
                    const daysLeft = a.auth_expiry_date ? Math.floor((new Date(a.auth_expiry_date)-now)/86400000) : null;
                    const visLeft = a.visits_authorized && a.visits_used ? a.visits_authorized-a.visits_used : null;
                    const isUrgent = (daysLeft !== null && daysLeft <= 14) || (visLeft !== null && visLeft <= 4);
                    return (
                      <div key={a.id} style={{ display:'grid', gridTemplateColumns:'1.5fr 0.5fr 0.8fr 0.7fr 0.7fr 0.7fr 0.8fr 0.8fr 0.7fr', padding:'9px 20px', borderBottom:'1px solid var(--border)', background:isUrgent?(i%2===0?'#FFFBEB':'#FEF9C3'):(i%2===0?'var(--card-bg)':'var(--bg)'), alignItems:'center', gap:8 }}>
                        <span style={{ fontSize:12, fontWeight:600 }}>{a.patient_name}</span>
                        <span style={{ fontSize:12, color:'var(--gray)', fontWeight:700 }}>{a.region}</span>
                        <span style={{ fontSize:11, color:'var(--gray)' }}>{a.insurance||'—'}</span>
                        <span style={{ fontSize:11, fontFamily:'DM Mono, monospace' }}>{a.auth_number||'—'}</span>
                        <span style={{ fontSize:10, fontWeight:700, color:a.auth_status==='active'?'#065F46':'#D97706', background:a.auth_status==='active'?'#ECFDF5':'#FEF3C7', padding:'1px 7px', borderRadius:999 }}>{a.auth_status||'—'}</span>
                        <span style={{ fontSize:12 }}>{a.visits_authorized||'—'}</span>
                        <span style={{ fontSize:12 }}>{a.visits_used||'0'}</span>
                        <span style={{ fontSize:11, fontFamily:'DM Mono, monospace' }}>{a.auth_expiry_date||'—'}</span>
                        <span style={{ fontSize:12, fontWeight:700, color:daysLeft!==null&&daysLeft<=7?'#DC2626':daysLeft!==null&&daysLeft<=14?'#D97706':'var(--gray)' }}>
                          {daysLeft !== null ? `${daysLeft}d` : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── ON HOLD TAB ──────────────────────────────────────── */}
          {activeTab === 'onhold' && (
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:15, fontWeight:700 }}>On Hold Patients — {regionLabel}</div>
                  <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>{onHold.length} currently on hold</div>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.5fr 1fr 0.8fr 0.8fr 0.8fr 1fr', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', gap:8 }}>
                <span>Patient</span><span>Rgn</span><span>Hold Type</span><span>Days on Hold</span><span>On Hold Since</span><span>Last Contact</span><span>Exp. Return</span>
              </div>
              <div style={{ maxHeight:500, overflowY:'auto' }}>
                {onHold.length === 0 ? (
                  <div style={{ padding:32, textAlign:'center', color:'var(--gray)' }}>✅ No patients currently on hold in your region{myRegions.length>1?'s':''}.</div>
                ) : onHold.sort((a,b) => (b.days_on_hold||0)-(a.days_on_hold||0)).map((p,i) => {
                  const days = p.days_on_hold || 0;
                  const dColor = days>=30?'#DC2626':days>=14?'#D97706':'#065F46';
                  const dBg = days>=30?'#FEF2F2':days>=14?'#FEF3C7':'#ECFDF5';
                  return (
                    <div key={p.id} style={{ display:'grid', gridTemplateColumns:'1.5fr 0.5fr 1fr 0.8fr 0.8fr 0.8fr 1fr', padding:'10px 20px', borderBottom:'1px solid var(--border)', background:i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:12, fontWeight:600 }}>{p.patient_name}</span>
                      <span style={{ fontSize:12, color:'var(--gray)', fontWeight:700 }}>{p.region}</span>
                      <span style={{ fontSize:11, color:'var(--gray)' }}>{p.hold_type||'On Hold'}</span>
                      <span style={{ fontSize:12, fontWeight:700, color:dColor, background:dBg, padding:'2px 8px', borderRadius:999, display:'inline-block' }}>{days}d</span>
                      <span style={{ fontSize:11, color:'var(--gray)' }}>{fmtDate(p.hold_date)}</span>
                      <span style={{ fontSize:11, color:p.last_contact_date?'var(--black)':'#DC2626', fontWeight:p.last_contact_date?400:600 }}>
                        {p.last_contact_date ? fmtDate(p.last_contact_date) : '⚠ None'}
                      </span>
                      <span style={{ fontSize:11, color:p.expected_return_date?'#065F46':'var(--gray)', fontWeight:p.expected_return_date?600:400 }}>
                        {fmtDate(p.expected_return_date)}
                      </span>
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
