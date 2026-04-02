import { useState, useEffect, useMemo, useRef } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
 
const RATE = 230;
function isEval(e) { return /eval/i.test(e||''); }
function isCompleted(s) { return /completed/i.test(s||''); }
function isCancelled(e,s) { return /cancel/i.test(e||'')||/cancel/i.test(s||''); }
function fmtD(n) { return '$' + Math.round(n).toLocaleString(); }
function pct(a,b) { return b>0?Math.round((a/b)*100):0; }
 
export default function ExecutiveReportPage() {
  const [visits, setVisits] = useState([]);
  const [intake, setIntake] = useState([]);
  const [auth, setAuth] = useState([]);
  const [loading, setLoading] = useState(true);
  const printRef = useRef();
 
  useEffect(() => {
    Promise.all([
      supabase.from('visit_schedule_data').select('patient_name,visit_date,discipline,event_type,status,staff_name,region,insurance').not('visit_date','is',null),
      supabase.from('intake_referrals').select('referral_status,date_received,region,insurance,referral_type').not('date_received','is',null),
      supabase.from('auth_tracker').select('auth_status,insurance,created_at,visits_authorized,visits_used'),
    ]).then(([v,i,a]) => {
      setVisits(v.data||[]); setIntake(i.data||[]); setAuth(a.data||[]);
      setLoading(false);
    });
  }, []);
 
  const stats = useMemo(() => {
    const now = new Date();
    const d7 = new Date(); d7.setDate(d7.getDate()-7); const d7s = d7.toISOString().slice(0,10);
    const d30 = new Date(); d30.setDate(d30.getDate()-30); const d30s = d30.toISOString().slice(0,10);
    const thisMonth = now.toISOString().slice(0,7);
 
    // Visits
    const evalSeen = new Set();
    let completed = 0, cancelled = 0, missed = 0, scheduled = 0;
    let completed30 = 0, cancelled30 = 0;
 
    visits.forEach(v => {
      const isCan = isCancelled(v.event_type, v.status);
      const isComp = isCompleted(v.status);
      const isMiss = /missed/i.test(v.status||'') && !isCan;
      const isSched = /scheduled/i.test(v.status||'') && !isCan;
      if (isCan) { cancelled++; if (v.visit_date >= d30s) cancelled30++; }
      else if (isComp) {
        if (isEval(v.event_type)) {
          const key = `${v.patient_name}||${v.visit_date}`;
          if (!evalSeen.has(key)) { evalSeen.add(key); completed++; if (v.visit_date>=d30s) completed30++; }
        } else { completed++; if (v.visit_date>=d30s) completed30++; }
      }
      else if (isMiss) missed++;
      else if (isSched) scheduled++;
    });
 
    const revenueEarned = completed * RATE;
    const revenuePipeline = scheduled * RATE;
    const revenueLost = (cancelled + missed) * RATE;
    const completionRate = pct(completed, completed+cancelled+missed);
 
    // Visits this week
    const visitsThisWeek = visits.filter(v => v.visit_date >= d7s && isCompleted(v.status) && !isCancelled(v.event_type,v.status)).length;
    const cancelledThisWeek = visits.filter(v => v.visit_date >= d7s && isCancelled(v.event_type,v.status)).length;
 
    // Intake
    const totalIntake = intake.length;
    const accepted = intake.filter(i => i.referral_status==='Accepted').length;
    const denied = intake.filter(i => i.referral_status==='Denied').length;
    const conversionRate = pct(accepted, totalIntake);
    const thisMonthIntake = intake.filter(i => i.date_received?.startsWith(thisMonth));
    const thisMonthAccepted = thisMonthIntake.filter(i => i.referral_status==='Accepted').length;
 
    // Auth
    const totalAuth = auth.length;
    const activeAuth = auth.filter(a => /approved|active/i.test(a.auth_status||'')).length;
    const pendingAuth = auth.filter(a => /pending/i.test(a.auth_status||'')).length;
    const authApprovalRate = pct(activeAuth, totalAuth);
 
    // Visit utilization (used vs authorized)
    const avgUtilization = auth.length > 0 
      ? Math.round(auth.reduce((sum,a) => sum + pct(a.visits_used||0,a.visits_authorized||24), 0) / auth.length)
      : 0;
 
    // Projection: annualized at current 30d rate
    const dailyRate = completed30 / 30;
    const annualProjection = dailyRate * 365 * RATE;
 
    // Cancellation impact per week
    const weeklyCancelCost = (cancelledThisWeek * RATE);
 
    return {
      completed, cancelled, missed, scheduled, revenueEarned, revenuePipeline, revenueLost,
      completionRate, visitsThisWeek, cancelledThisWeek,
      totalIntake, accepted, denied, conversionRate, thisMonthAccepted, thisMonthIntake: thisMonthIntake.length,
      totalAuth, activeAuth, pendingAuth, authApprovalRate, avgUtilization,
      annualProjection, weeklyCancelCost,
    };
  }, [visits, intake, auth]);
 
  function handlePrint() {
    const style = document.createElement('style');
    style.textContent = '@media print { body * { visibility: hidden; } #pulse-report, #pulse-report * { visibility: visible; } #pulse-report { position: fixed; top: 0; left: 0; width: 100%; } }';
    document.head.appendChild(style);
    window.print();
    document.head.removeChild(style);
  }
 
  const today = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
 
  const Stat = ({ label, val, sub, color='var(--black)', big=false }) => (
    <div style={{ textAlign:'center' }}>
      <div style={{ fontSize:big?28:20, fontWeight:800, fontFamily:'DM Mono, monospace', color }}>{val}</div>
      <div style={{ fontSize:11, fontWeight:700, color:'var(--black)', marginTop:2 }}>{label}</div>
      {sub && <div style={{ fontSize:10, color:'var(--gray)', marginTop:1 }}>{sub}</div>}
    </div>
  );
 
  const RagDot = ({ good }) => (
    <div style={{ width:10, height:10, borderRadius:'50%', background: good?'#10B981':'#DC2626', flexShrink:0 }} />
  );
 
  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Executive Report" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading…</div>
    </div>
  );
 
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Executive Report" subtitle="CEO Pulse Report — live company snapshot"
        actions={
          <button onClick={handlePrint}
            style={{ padding:'7px 16px', background:'#0F1117', color:'#fff', border:'none', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' }}>
            🖨 Export / Print
          </button>
        }
      />
      <div style={{ flex:1, overflow:'auto', padding:20 }}>
        <div id="pulse-report" ref={printRef} style={{ maxWidth:1000, margin:'0 auto', fontFamily:'DM Sans, system-ui, sans-serif' }}>
 
          {/* Header */}
          <div style={{ background:'#0F1117', borderRadius:16, padding:'24px 32px', color:'#fff', marginBottom:20, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <div style={{ fontSize:22, fontWeight:800, letterSpacing:'-0.5px' }}>AxiomHealth Operations</div>
              <div style={{ fontSize:14, color:'#9CA3AF', marginTop:4 }}>Company Pulse Report</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:13, color:'#9CA3AF' }}>Generated</div>
              <div style={{ fontSize:13, fontWeight:600, color:'#fff' }}>{today}</div>
              <div style={{ marginTop:8, fontSize:11, color:'#9CA3AF' }}>CONFIDENTIAL — CEO Distribution</div>
            </div>
          </div>
 
          {/* Financial Summary */}
          <div style={{ background:'linear-gradient(135deg,#065F46,#10B981)', borderRadius:14, padding:'20px 28px', marginBottom:16, color:'#fff' }}>
            <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', opacity:0.8, marginBottom:12 }}>Financial Overview</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:20 }}>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:32, fontWeight:800, fontFamily:'DM Mono, monospace' }}>{fmtD(stats.revenueEarned)}</div>
                <div style={{ fontSize:12, opacity:0.8, marginTop:2 }}>Revenue Earned (All Time)</div>
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:32, fontWeight:800, fontFamily:'DM Mono, monospace' }}>{fmtD(stats.revenuePipeline)}</div>
                <div style={{ fontSize:12, opacity:0.8, marginTop:2 }}>Pipeline (Scheduled Visits)</div>
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:32, fontWeight:800, fontFamily:'DM Mono, monospace' }}>{fmtD(stats.annualProjection)}</div>
                <div style={{ fontSize:12, opacity:0.8, marginTop:2 }}>Annualized Projection</div>
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:32, fontWeight:800, fontFamily:'DM Mono, monospace', color:'#FCA5A5' }}>{fmtD(stats.revenueLost)}</div>
                <div style={{ fontSize:12, opacity:0.8, marginTop:2 }}>Revenue Lost (Cancellations)</div>
              </div>
            </div>
          </div>
 
          {/* 3-column KPI grid */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16, marginBottom:16 }}>
 
            {/* Operations */}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:20 }}>
              <div style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--gray)', marginBottom:14 }}>Operations — Visits</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
                <Stat label="Completed" val={stats.completed.toLocaleString()} color="#065F46" />
                <Stat label="This Week" val={stats.visitsThisWeek} sub="completed" color="#1565C0" />
                <Stat label="Scheduled" val={stats.scheduled.toLocaleString()} sub="pipeline" color="#7C3AED" />
                <Stat label="Completion Rate" val={stats.completionRate+'%'} color={stats.completionRate>=80?'#065F46':'#DC2626'} />
              </div>
              <div style={{ borderTop:'1px solid var(--border)', paddingTop:12, display:'flex', flexDirection:'column', gap:6 }}>
                {[
                  { label:`Cancellations this week (${stats.cancelledThisWeek})`, cost: stats.weeklyCancelCost, good: stats.cancelledThisWeek <= 5 },
                  { label:`Total missed visits (${stats.missed})`, cost: stats.missed*RATE, good: stats.missed < 20 },
                ].map(item => (
                  <div key={item.label} style={{ display:'flex', alignItems:'center', gap:6, fontSize:11 }}>
                    <RagDot good={item.good} />
                    <span style={{ flex:1, color:'var(--black)' }}>{item.label}</span>
                    <span style={{ fontFamily:'DM Mono, monospace', fontWeight:700, color:'#DC2626', fontSize:11 }}>{fmtD(item.cost)}</span>
                  </div>
                ))}
              </div>
            </div>
 
            {/* Intake */}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:20 }}>
              <div style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--gray)', marginBottom:14 }}>Referral Intake</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
                <Stat label="Total Referrals" val={stats.totalIntake.toLocaleString()} color="var(--black)" />
                <Stat label="Accepted" val={stats.accepted.toLocaleString()} color="#065F46" />
                <Stat label="This Month" val={stats.thisMonthIntake} sub={`${stats.thisMonthAccepted} accepted`} color="#1565C0" />
                <Stat label="Conversion Rate" val={stats.conversionRate+'%'} color={stats.conversionRate>=50?'#065F46':'#DC2626'} />
              </div>
              <div style={{ borderTop:'1px solid var(--border)', paddingTop:12, display:'flex', flexDirection:'column', gap:6 }}>
                {[
                  { label:`${stats.denied} referrals denied (${100-stats.conversionRate}% deny rate)`, good: stats.conversionRate>=50 },
                  { label:`${stats.thisMonthAccepted} new patients this month`, good: stats.thisMonthAccepted >= 10 },
                ].map((item,i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:6, fontSize:11 }}>
                    <RagDot good={item.good} />
                    <span style={{ color:'var(--black)' }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
 
            {/* Authorization */}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:20 }}>
              <div style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--gray)', marginBottom:14 }}>Authorization</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
                <Stat label="Total Auths" val={stats.totalAuth.toLocaleString()} color="var(--black)" />
                <Stat label="Active/Approved" val={stats.activeAuth.toLocaleString()} color="#065F46" />
                <Stat label="Pending" val={stats.pendingAuth.toLocaleString()} sub="awaiting approval" color="#D97706" />
                <Stat label="Approval Rate" val={stats.authApprovalRate+'%'} color={stats.authApprovalRate>=75?'#065F46':'#DC2626'} />
              </div>
              <div style={{ borderTop:'1px solid var(--border)', paddingTop:12, display:'flex', flexDirection:'column', gap:6 }}>
                {[
                  { label:`Auth approval rate: ${stats.authApprovalRate}%`, good: stats.authApprovalRate >= 75 },
                  { label:`${stats.pendingAuth} auths currently pending`, good: stats.pendingAuth < 30 },
                  { label:`Avg visit utilization: ${stats.avgUtilization}%`, good: stats.avgUtilization >= 60 },
                ].map((item,i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:6, fontSize:11 }}>
                    <RagDot good={item.good} />
                    <span style={{ color:'var(--black)' }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
 
          {/* RAG Status Summary */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:20 }}>
            <div style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--gray)', marginBottom:14 }}>Company Health — Key Indicators</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
              {[
                { label:'Visit Completion Rate', val:stats.completionRate+'%', target:'≥80%', good:stats.completionRate>=80 },
                { label:'Intake Conversion Rate', val:stats.conversionRate+'%', target:'≥50%', good:stats.conversionRate>=50 },
                { label:'Auth Approval Rate', val:stats.authApprovalRate+'%', target:'≥75%', good:stats.authApprovalRate>=75 },
                { label:'Weekly Visits Completed', val:stats.visitsThisWeek, target:'≥100/wk', good:stats.visitsThisWeek>=100 },
                { label:'Weekly Cancellations', val:stats.cancelledThisWeek, target:'≤10/wk', good:stats.cancelledThisWeek<=10 },
                { label:'This Month New Patients', val:stats.thisMonthAccepted, target:'≥20/mo', good:stats.thisMonthAccepted>=20 },
              ].map(item => (
                <div key={item.label} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background: item.good?'#F0FDF4':'#FEF2F2', borderRadius:8, border:`1px solid ${item.good?'#BBF7D0':'#FCA5A5'}` }}>
                  <RagDot good={item.good} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'var(--black)' }}>{item.label}</div>
                    <div style={{ fontSize:11, color:'var(--gray)' }}>Target: {item.target}</div>
                  </div>
                  <div style={{ fontFamily:'DM Mono, monospace', fontSize:14, fontWeight:800, color:item.good?'#065F46':'#DC2626' }}>{item.val}</div>
                </div>
              ))}
            </div>
          </div>
 
          {/* Footer */}
          <div style={{ textAlign:'center', marginTop:16, fontSize:10, color:'var(--gray)' }}>
            AxiomHealth Management · Pulse Report · Generated {today} · Confidential
          </div>
        </div>
      </div>
    </div>
  );
}
 
