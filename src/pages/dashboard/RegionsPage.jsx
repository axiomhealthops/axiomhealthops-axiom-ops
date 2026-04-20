import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

// Regional Managers (not care coordinators)
const REGIONAL_MANAGERS = {
  A: 'Uma Jacobs',
  B: 'Lia Davis', C: 'Earl Dimaano', G: 'Samantha Faliks',
  H: 'Kaylee Ramsey', J: 'Hollie Fincher', M: 'Ariel Maboudi', N: 'Ariel Maboudi',
  T: 'Samantha Faliks', V: 'Samantha Faliks',
};

const REGION_ORDER = ['A','B','C','G','H','J','M','N','T','V'];

function isEval(e) { return /eval/i.test(e||''); }
function isRA(e) { return /reassess|re-assess|30.day/i.test(e||''); }
function isCancelled(e,s) { return /cancel/i.test(e||'')||/cancel/i.test(s||''); }

export default function RegionsPage() {
  const [clinicians, setClinicians] = useState([]);
  const [visits, setVisits] = useState([]);
  const [intake, setIntake] = useState([]);
  const [auth, setAuth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRegion, setSelectedRegion] = useState(null);

  function load() {
    Promise.all([
      fetchAllPages(supabase.from('clinicians').select('*').eq('is_active', true).order('full_name')),
      fetchAllPages(supabase.from('visit_schedule_data').select('patient_name,visit_date,status,event_type,staff_name,region,insurance').not('visit_date','is',null)),
      fetchAllPages(supabase.from('intake_referrals').select('referral_status,date_received,region,patient_name').not('date_received','is',null)),
      fetchAllPages(supabase.from('auth_tracker').select('auth_status,region,patient_name,visits_used,visits_authorized')),
    ]).then(([cl, v, i, a]) => {
      setClinicians(cl);
      setVisits(v);
      setIntake(i);
      setAuth(a);
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, []);
  useRealtimeTable(['clinicians', 'visit_schedule_data', 'auth_tracker', 'intake_referrals'], load);

  const regions = useMemo(() => {
    return REGION_ORDER.map(region => {
      const rVisits = visits.filter(v => v.region === region);

      // Deduplicated counts
      const evalSeen = new Set();
      let completed = 0, scheduled = 0, cancelled = 0;
      rVisits.forEach(v => {
        if (isCancelled(v.event_type, v.status)) { cancelled++; return; }
        const needsDedup = isEval(v.event_type) || isRA(v.event_type);
        if (needsDedup) {
          const key = `${v.patient_name}||${v.visit_date}`;
          if (evalSeen.has(key)) return;
          evalSeen.add(key);
        }
        if (/completed/i.test(v.status||'')) completed++;
        else if (/scheduled/i.test(v.status||'')) scheduled++;
      });

      const rIntake = intake.filter(i => i.region === region);
      const accepted = rIntake.filter(i => i.referral_status === 'Accepted').length;
      const denied = rIntake.filter(i => i.referral_status === 'Denied').length;
      const rAuth = auth.filter(a => a.region === region);
      const activeAuth = rAuth.filter(a => /approved|active/i.test(a.auth_status||'')).length;

      // Clinicians in this region with their caseload
      const regionClinicians = clinicians.filter(c => c.region === region);
      const clinicianCaseloads = regionClinicians.map(c => {
        // Match visits by staff_name to pariox_name or full_name
        const clinicianVisits = visits.filter(v =>
          v.region === region && (
            (c.pariox_name && v.staff_name && v.staff_name.toLowerCase().includes(c.pariox_name.toLowerCase())) ||
            (v.staff_name && v.staff_name.toLowerCase().includes(c.full_name.toLowerCase().split(' ').pop()))
          )
        );
        const cCompleted = clinicianVisits.filter(v => /completed/i.test(v.status||'') && !isCancelled(v.event_type,v.status)).length;
        const cScheduled = clinicianVisits.filter(v => /scheduled/i.test(v.status||'') && !isCancelled(v.event_type,v.status)).length;
        const target = c.weekly_visit_target || 25;
        const pct = Math.round(((cCompleted+cScheduled)/target)*100);
        return { ...c, cCompleted, cScheduled, cTotal: cCompleted+cScheduled, target, pct };
      }).sort((a,b) => b.cTotal - a.cTotal);

      return {
        region,
        manager: REGIONAL_MANAGERS[region] || 'Unassigned',
        completed, scheduled, cancelled,
        accepted, denied, totalIntake: rIntake.length,
        activeAuth, totalAuth: rAuth.length,
        conversionRate: rIntake.length > 0 ? Math.round((accepted/rIntake.length)*100) : 0,
        revenue: completed * 230,
        clinicians: clinicianCaseloads,
        clinicianCount: regionClinicians.length,
      };
    });
  }, [visits, intake, auth, clinicians]);

  const selected = selectedRegion ? regions.find(r => r.region === selectedRegion) : null;

  function Stat({ label, val, color='var(--black)', sub }) {
    return (
      <div style={{ textAlign:'center', padding:'10px 8px' }}>
        <div style={{ fontSize:20, fontWeight:700, fontFamily:'DM Mono, monospace', color }}>{val}</div>
        <div style={{ fontSize:10, fontWeight:600, color:'var(--black)', marginTop:2 }}>{label}</div>
        {sub && <div style={{ fontSize:9, color:'var(--gray)', marginTop:1 }}>{sub}</div>}
      </div>
    );
  }

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Regions" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Regions" subtitle={`${REGION_ORDER.length} regions · ${clinicians.length} active clinicians`} />
      <div style={{ flex:1, overflow:'auto', padding:20, display:'flex', flexDirection:'column', gap:20 }}>

        {/* Manager Summary Cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:16 }}>
          {[...new Set(Object.values(REGIONAL_MANAGERS))].map(mgr => {
            const mgrRegions = Object.entries(REGIONAL_MANAGERS).filter(([,m]) => m === mgr).map(([r]) => r);
            const mgrData = regions.filter(r => mgrRegions.includes(r.region));
            const totComp = mgrData.reduce((s,r) => s+r.completed, 0);
            const totSched = mgrData.reduce((s,r) => s+r.scheduled, 0);
            const totIntake = mgrData.reduce((s,r) => s+r.totalIntake, 0);
            const totClin = mgrData.reduce((s,r) => s+r.clinicianCount, 0);
            return (
              <div key={mgr} style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:16 }}>
                <div style={{ fontSize:13, fontWeight:700, color:'var(--black)', marginBottom:2 }}>{mgr}</div>
                <div style={{ fontSize:11, color:'var(--gray)', marginBottom:12 }}>Regions: {mgrRegions.join(', ')} · {totClin} clinicians</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4 }}>
                  <Stat label="Completed" val={totComp} color="#065F46" />
                  <Stat label="Scheduled" val={totSched} color="#1565C0" />
                  <Stat label="Referrals" val={totIntake} color="#7C3AED" />
                  <Stat label="Revenue" val={'$'+(totComp*230/1000).toFixed(0)+'k'} color="#065F46" />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display:'grid', gridTemplateColumns: selected ? '1fr 1.5fr' : '1fr', gap:20 }}>
          {/* Region Table — alphabetical */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'10px 16px', background:'var(--bg)', borderBottom:'1px solid var(--border)', display:'grid', gridTemplateColumns:'0.5fr 1.2fr 0.7fr 0.7fr 0.7fr 0.7fr 0.7fr', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em' }}>
              <span>Rgn</span><span>Manager</span><span>Visits</span><span>Referrals</span><span>Accepted</span><span>Clinicians</span><span>Revenue</span>
            </div>
            {regions.map((r, i) => {
              const isSel = selectedRegion === r.region;
              return (
                <div key={r.region} onClick={() => setSelectedRegion(isSel ? null : r.region)}
                  style={{ display:'grid', gridTemplateColumns:'0.5fr 1.2fr 0.7fr 0.7fr 0.7fr 0.7fr 0.7fr', padding:'10px 16px', borderBottom:'1px solid var(--border)', background:isSel?'#EFF6FF':i%2===0?'var(--card-bg)':'var(--bg)', cursor:'pointer', borderLeft:isSel?'3px solid #1565C0':'3px solid transparent', alignItems:'center' }}>
                  <span style={{ fontSize:16, fontWeight:800, color:isSel?'#1565C0':'var(--black)' }}>{r.region}</span>
                  <span style={{ fontSize:11, color:'var(--gray)' }}>{r.manager}</span>
                  <div>
                    <span style={{ fontSize:13, fontWeight:700, color:'#065F46' }}>{r.completed}</span>
                    <span style={{ fontSize:10, color:'var(--gray)' }}> +{r.scheduled}</span>
                  </div>
                  <span style={{ fontSize:12 }}>{r.totalIntake}</span>
                  <span style={{ fontSize:12, fontWeight:600, color:'#065F46' }}>{r.accepted} <span style={{ color:'var(--gray)', fontWeight:400, fontSize:10 }}>({r.conversionRate}%)</span></span>
                  <span style={{ fontSize:12, color:'#7C3AED' }}>{r.clinicianCount}</span>
                  <span style={{ fontSize:12, fontFamily:'DM Mono, monospace', fontWeight:600, color:'#065F46' }}>${(r.revenue/1000).toFixed(0)}k</span>
                </div>
              );
            })}
          </div>

          {/* Region Detail Panel */}
          {selected && (
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden', display:'flex', flexDirection:'column' }}>
              <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:24, fontWeight:800, color:'#1565C0' }}>Region {selected.region}</div>
                  <div style={{ fontSize:12, color:'var(--gray)', marginTop:2 }}>Manager: {selected.manager}</div>
                </div>
                <button onClick={() => setSelectedRegion(null)} style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:12, color:'var(--gray)' }}>Close</button>
              </div>

              <div style={{ flex:1, overflow:'auto', padding:16, display:'flex', flexDirection:'column', gap:16 }}>
                {/* KPI row */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', background:'var(--bg)', borderRadius:10, padding:8 }}>
                  <Stat label="Completed" val={selected.completed} color="#065F46" />
                  <Stat label="Scheduled" val={selected.scheduled} color="#1565C0" />
                  <Stat label="Cancelled" val={selected.cancelled} color="#DC2626" />
                  <Stat label="Revenue" val={'$'+selected.revenue.toLocaleString()} color="#065F46" />
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', background:'var(--bg)', borderRadius:10, padding:8 }}>
                  <Stat label="Total Referrals" val={selected.totalIntake} />
                  <Stat label="Accepted" val={selected.accepted} color="#065F46" sub={selected.conversionRate+'% rate'} />
                  <Stat label="Denied" val={selected.denied} color="#DC2626" />
                </div>

                {/* Clinician Caseloads */}
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--black)', marginBottom:10 }}>
                    Clinicians ({selected.clinicians.length}) — Current Caseload
                  </div>
                  {selected.clinicians.length === 0 ? (
                    <div style={{ fontSize:12, color:'var(--gray)', padding:12, background:'var(--bg)', borderRadius:8 }}>No clinicians matched to this region.</div>
                  ) : (
                    selected.clinicians.map(c => (
                      <div key={c.id} style={{ display:'grid', gridTemplateColumns:'1fr auto', alignItems:'center', gap:12, padding:'8px 12px', marginBottom:8, background:'var(--bg)', borderRadius:8, border:'1px solid var(--border)' }}>
                        <div>
                          <div style={{ fontSize:12, fontWeight:600, color:'var(--black)' }}>{c.full_name}</div>
                          <div style={{ fontSize:10, color:'var(--gray)', marginTop:1 }}>{c.discipline} · {c.employment_type}</div>
                          <div style={{ marginTop:6, height:5, background:'var(--border)', borderRadius:999, overflow:'hidden' }}>
                            <div style={{ height:'100%', width:`${Math.min(c.pct,100)}%`, background: c.pct>=80?'#10B981':c.pct>=50?'#D97706':'#DC2626', borderRadius:999 }} />
                          </div>
                        </div>
                        <div style={{ textAlign:'center', minWidth:60 }}>
                          <div style={{ fontSize:14, fontWeight:700, fontFamily:'DM Mono, monospace', color: c.pct>=80?'#065F46':c.pct>=50?'#D97706':'#DC2626' }}>{c.cTotal}</div>
                          <div style={{ fontSize:9, color:'var(--gray)' }}>/ {c.target} target</div>
                          <div style={{ fontSize:9, fontWeight:700, color:'var(--gray)' }}>{c.pct}%</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
