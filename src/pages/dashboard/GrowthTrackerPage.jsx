import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';

function monthKey(d) { return d ? String(d).slice(0,7) : null; }
function fmtMonth(k) {
  if (!k) return '';
  const [y,m] = k.split('-');
  return new Date(+y,+m-1).toLocaleString('en-US',{month:'short',year:'2-digit'});
}
function growthPct(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export default function GrowthTrackerPage() {
  const [intake, setIntake] = useState([]);
  const [visits, setVisits] = useState([]);
  const [auth, setAuth] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from('intake_referrals').select('referral_status,date_received,region,insurance').not('date_received','is',null),
      supabase.from('visit_schedule_data').select('visit_date,status,event_type,region').not('visit_date','is',null),
      supabase.from('auth_tracker').select('auth_status,created_at'),
    ]).then(([i,v,a]) => {
      setIntake(i.data||[]);
      setVisits(v.data||[]);
      setAuth(a.data||[]);
      setLoading(false);
    });
  }, []);

  const stats = useMemo(() => {
    // Monthly intake trend
    const intakeByMonth = {};
    intake.forEach(r => {
      const k = monthKey(r.date_received);
      if (!k) return;
      if (!intakeByMonth[k]) intakeByMonth[k] = { total:0, accepted:0, denied:0 };
      intakeByMonth[k].total++;
      if (r.referral_status === 'Accepted') intakeByMonth[k].accepted++;
      else intakeByMonth[k].denied++;
    });
    const intakeMonths = Object.keys(intakeByMonth).sort().slice(-14).map(k => ({ k, label: fmtMonth(k), ...intakeByMonth[k] }));

    // Monthly visit completions
    const visitsByMonth = {};
    visits.forEach(v => {
      const k = monthKey(v.visit_date);
      if (!k) return;
      if (!visitsByMonth[k]) visitsByMonth[k] = { completed:0, cancelled:0, missed:0, scheduled:0 };
      if (/completed/i.test(v.status||'')) visitsByMonth[k].completed++;
      else if (/cancel/i.test(v.event_type||'')||/cancel/i.test(v.status||'')) visitsByMonth[k].cancelled++;
      else if (/missed/i.test(v.status||'')) visitsByMonth[k].missed++;
      else visitsByMonth[k].scheduled++;
    });
    const visitMonths = Object.keys(visitsByMonth).sort().slice(-14).map(k => ({ k, label: fmtMonth(k), ...visitsByMonth[k] }));

    // Month over month growth for referrals
    const lastIntake = intakeMonths.slice(-2);
    const refGrowth = lastIntake.length === 2 ? growthPct(lastIntake[1].total, lastIntake[0].total) : null;
    const acceptGrowth = lastIntake.length === 2 ? growthPct(lastIntake[1].accepted, lastIntake[0].accepted) : null;

    // Visit growth
    const lastVisits = visitMonths.slice(-2);
    const visitGrowth = lastVisits.length === 2 ? growthPct(lastVisits[1].completed, lastVisits[0].completed) : null;

    // Acceptance rate trend
    const maxIntake = Math.max(...intakeMonths.map(m=>m.total),1);
    const maxVisit = Math.max(...visitMonths.map(m=>m.completed),1);

    // By region growth (current vs prior 30 days)
    const now = new Date().toISOString().slice(0,10);
    const d30 = new Date(); d30.setDate(d30.getDate()-30); const d30s = d30.toISOString().slice(0,10);
    const d60 = new Date(); d60.setDate(d60.getDate()-60); const d60s = d60.toISOString().slice(0,10);

    const regionCurrent = {};
    const regionPrior = {};
    intake.forEach(r => {
      if (!r.region) return;
      if (r.date_received >= d30s) regionCurrent[r.region] = (regionCurrent[r.region]||0)+1;
      else if (r.date_received >= d60s) regionPrior[r.region] = (regionPrior[r.region]||0)+1;
    });
    const regions = [...new Set([...Object.keys(regionCurrent),...Object.keys(regionPrior)])].sort();
    const byRegion = regions.map(r => ({
      region: r,
      current: regionCurrent[r]||0,
      prior: regionPrior[r]||0,
      growth: growthPct(regionCurrent[r]||0, regionPrior[r]||0),
    })).sort((a,b)=>b.current-a.current);

    return { intakeMonths, visitMonths, refGrowth, acceptGrowth, visitGrowth, maxIntake, maxVisit, byRegion };
  }, [intake, visits, auth]);

  function GrowthBadge({ pct }) {
    if (pct === null) return <span style={{ fontSize: 11, color: 'var(--gray)' }}>—</span>;
    const up = pct >= 0;
    return <span style={{ fontSize: 11, fontWeight: 700, color: up?'#065F46':'#DC2626', background: up?'#ECFDF5':'#FEF2F2', padding: '2px 7px', borderRadius: 999 }}>{up?'+':''}{pct}%</span>;
  }

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Growth Tracker" subtitle="Loading…" />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Growth Tracker" subtitle="Month-over-month trends across referrals, visits, and regions" />
      <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* MoM KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
          {[
            { label: 'Referral Growth (MoM)', val: stats.refGrowth, sub: 'vs prior month total referrals' },
            { label: 'Acceptance Growth (MoM)', val: stats.acceptGrowth, sub: 'vs prior month accepted referrals' },
            { label: 'Visit Growth (MoM)', val: stats.visitGrowth, sub: 'vs prior month completed visits' },
          ].map(t => (
            <div key={t.label} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)', marginBottom: 8 }}>{t.label}</div>
              <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: t.val===null?'var(--gray)':t.val>=0?'#065F46':'#DC2626' }}>
                {t.val === null ? '—' : (t.val >= 0 ? '+' : '') + t.val + '%'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>{t.sub}</div>
            </div>
          ))}
        </div>

        {/* Referral intake trend */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginBottom: 4 }}>Monthly Referral Intake (14 Months)</div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 16 }}>Total, accepted, and denied referrals per month</div>
          {stats.intakeMonths.length === 0 ? (
            <div style={{ padding:'20px 0', color:'var(--gray)', fontSize:13 }}>No intake data available — re-import your XLSX to populate dates.</div>
          ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 140 }}>
            {stats.intakeMonths.map((m) => {
              const maxH = Math.max(stats.maxIntake, 1);
              const tH = Math.max((m.total/maxH)*120,4);
              const aH = m.total > 0 ? Math.max((m.accepted/m.total)*tH, 2) : 0;
              const dH = tH - aH;
              const pct = m.total>0?Math.round((m.accepted/m.total)*100):0;
              return (
                <div key={m.k} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                  <div style={{ fontSize:8, color:'var(--gray)', fontWeight:500 }}>{pct}%</div>
                  <div style={{ width:'100%', height:tH, display:'flex', flexDirection:'column', borderRadius:'3px 3px 0 0', overflow:'hidden' }}>
                    <div style={{ width:'100%', height:dH, background:'#FCA5A5', flexShrink:0 }} />
                    <div style={{ width:'100%', flex:1, background:'#10B981' }} />
                  </div>
                  <div style={{ fontSize:8, color:'var(--gray)', textAlign:'center' }}>{m.label}</div>
                  <div style={{ fontSize:9, fontWeight:700 }}>{m.total}</div>
                </div>
              );
            })}
          </div>
          )}
          <div style={{ display:'flex', gap:16, marginTop:10 }}>
            {[['#10B981','Accepted'],['#FCA5A5','Denied']].map(([c,l])=>(
              <div key={l} style={{ display:'flex', alignItems:'center', gap:5, fontSize:11 }}>
                <div style={{ width:10, height:10, background:c, border:'1px solid var(--border)', borderRadius:2 }} />{l}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
          {/* Visit completions */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginBottom: 4 }}>Monthly Visit Completions</div>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 16 }}>Completed visits per month</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 100 }}>
              {stats.visitMonths.map((m) => {
                const h = Math.max((m.completed/stats.maxVisit)*80,4);
                return (
                  <div key={m.k} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                    <div style={{ width:'100%', height:h, background:'#1565C0', borderRadius:'3px 3px 0 0', minHeight:3 }} />
                    <div style={{ fontSize:8, color:'var(--gray)', textAlign:'center' }}>{m.label}</div>
                    <div style={{ fontSize:9, fontWeight:700 }}>{m.completed}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* By region */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginBottom: 4 }}>Region Growth (30d vs Prior 30d)</div>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 16 }}>Referral volume by region</div>
            {stats.byRegion.slice(0,10).map(r => (
              <div key={r.region} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid var(--border)' }}>
                <span style={{ fontSize:13, fontWeight:600 }}>Region {r.region}</span>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ fontSize:12, color:'var(--gray)' }}>{r.prior} → <strong>{r.current}</strong></span>
                  <GrowthBadge pct={r.growth} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
