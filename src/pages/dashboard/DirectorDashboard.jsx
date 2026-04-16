import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, fetchAllPages } from '../../lib/supabase';
import TopBar from '../../components/TopBar';

const BLENDED_RATE = 185;
const WEEKLY_TARGET = 1000;
const REVENUE_TARGET = 200000;
const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

function fmt$(n) { return '$' + Math.round(n).toLocaleString(); }
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function daysAgo(d) {
  if (!d) return null;
  return Math.floor((new Date() - new Date(d + 'T00:00:00')) / 86400000);
}

// ── Triage Card ───────────────────────────────────────────────────────────────
function TriageCard({ rank, title, count, subtitle, color, bg, border, detail, action, actionLabel, urgent }) {
  const clickable = typeof action === 'function';
  return (
    <div
      onClick={clickable ? action : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); action(); } }) : undefined}
      onMouseEnter={clickable ? (e => { e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.12)'; e.currentTarget.style.transform = 'translateY(-1px)'; }) : undefined}
      onMouseLeave={clickable ? (e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }) : undefined}
      style={{
        background: bg, border: `2px solid ${border || color}`,
        borderRadius: 12, padding: '16px 18px', position: 'relative', overflow: 'hidden',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'transform 0.1s ease, box-shadow 0.15s ease',
      }}>
      {urgent && (
        <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:`linear-gradient(90deg, ${color}, transparent)` }} />
      )}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:22, height:22, borderRadius:'50%', background:color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:900, color:'#fff', flexShrink:0 }}>
            {rank}
          </div>
          <div style={{ fontSize:12, fontWeight:700, color:'#0F1117', lineHeight:1.3 }}>{title}</div>
        </div>
        <div style={{ fontSize:28, fontWeight:900, fontFamily:'DM Mono, monospace', color, lineHeight:1 }}>{count}</div>
      </div>
      <div style={{ fontSize:11, color:'#6B7280', marginBottom: detail ? 10 : 0 }}>{subtitle}</div>
      {detail && (
        <div style={{ fontSize:11, color, fontWeight:600, background:`${color}15`, borderRadius:6, padding:'5px 8px', marginBottom:action?8:0 }}>
          {detail}
        </div>
      )}
      {action && (
        <button
          onClick={(e) => { e.stopPropagation(); action(); }}
          style={{ fontSize:10, fontWeight:700, color:'#fff', background:color, border:'none', borderRadius:5, padding:'4px 10px', cursor:'pointer', width:'100%', marginTop:4 }}>
          {actionLabel || 'View →'}
        </button>
      )}
    </div>
  );
}

// ── Revenue Gauge ─────────────────────────────────────────────────────────────
function RevenueGauge({ actual, target }) {
  const pct = Math.min(100, Math.round((actual / target) * 100));
  const color = pct >= 80 ? '#059669' : pct >= 60 ? '#D97706' : '#DC2626';
  const gap = target - actual;
  return (
    <div style={{ background:'#0F1117', borderRadius:12, padding:'18px 20px', color:'#fff' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>
        Weekly Revenue Pace
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:12 }}>
        <div>
          <div style={{ fontSize:36, fontWeight:900, fontFamily:'DM Mono, monospace', color, lineHeight:1 }}>{fmt$(actual)}</div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginTop:2 }}>of {fmt$(target)} target</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', color }}>{pct}%</div>
          <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>to target</div>
        </div>
      </div>
      <div style={{ background:'rgba(255,255,255,0.1)', borderRadius:999, height:8, marginBottom:10 }}>
        <div style={{ width:`${pct}%`, height:'100%', background:color, borderRadius:999, transition:'width 0.8s ease' }} />
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'rgba(255,255,255,0.4)' }}>
        <span>Gap to target: <span style={{ color:'#FBBF24', fontWeight:700 }}>{fmt$(gap)}</span></span>
        <span>{fmt$(target)} = {Math.ceil(target / BLENDED_RATE)} visits/wk @ ${BLENDED_RATE}/visit</span>
      </div>
    </div>
  );
}

// ── Region Heat Row ───────────────────────────────────────────────────────────
function RegionRow({ region, active, inactiveActive, onHold, pending, completedVisits, revenueGap }) {
  const activityRate = active > 0 ? Math.round(((active - inactiveActive) / active) * 100) : 0;
  const barColor = activityRate >= 80 ? '#059669' : activityRate >= 60 ? '#D97706' : '#DC2626';
  return (
    <div style={{ display:'grid', gridTemplateColumns:'0.5fr 0.7fr 1.2fr 0.7fr 0.7fr 0.7fr 0.9fr', padding:'9px 16px', borderBottom:'1px solid var(--border)', alignItems:'center', gap:8, background:'var(--card-bg)' }}
      onMouseEnter={e => e.currentTarget.style.background='#F8F9FF'}
      onMouseLeave={e => e.currentTarget.style.background='var(--card-bg)'}>
      <div style={{ fontSize:13, fontWeight:800, color:'#0F1117' }}>Rgn {region}</div>
      <div style={{ fontSize:14, fontWeight:700, fontFamily:'DM Mono, monospace' }}>{active}</div>
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <div style={{ flex:1, height:6, background:'#E5E7EB', borderRadius:999 }}>
            <div style={{ width:`${activityRate}%`, height:'100%', background:barColor, borderRadius:999 }} />
          </div>
          <span style={{ fontSize:11, fontWeight:700, color:barColor, minWidth:28 }}>{activityRate}%</span>
        </div>
        {inactiveActive > 0 && <div style={{ fontSize:9, color:'#DC2626', marginTop:2 }}>{inactiveActive} overdue vs freq</div>}
      </div>
      <div style={{ fontSize:13, fontWeight:inactiveActive>10?700:400, color:inactiveActive>10?'#DC2626':'var(--gray)' }}>{inactiveActive}</div>
      <div style={{ fontSize:13, color:'var(--gray)' }}>{onHold}</div>
      <div style={{ fontSize:13, color:'var(--gray)' }}>{pending}</div>
      <div style={{ fontSize:11, fontWeight:700, color:revenueGap>5000?'#DC2626':revenueGap>2000?'#D97706':'#059669' }}>
        {revenueGap > 0 ? `-${fmt$(revenueGap)}/wk` : '✓ Active'}
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function DirectorDashboard({ onNavigate }) {
  const go = (page, intent) => { if (typeof onNavigate === 'function') onNavigate(page, intent); };
  const [loading, setLoading] = useState(true);
  const [census, setCensus] = useState([]);
  const [visits, setVisits] = useState([]);
  const [authRenewals, setAuthRenewals] = useState([]);
  const [onHold, setOnHold] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [clinicians, setClinicians] = useState([]);
  const [discharges, setDischarges] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    // Use local date (not UTC) for week start — avoids timezone shift at night
    const now = new Date();
    const localYear = now.getFullYear();
    const localMonth = String(now.getMonth() + 1).padStart(2, '0');
    const localDay = String(now.getDate()).padStart(2, '0');
    const todayLocal = `${localYear}-${localMonth}-${localDay}`;

    // Monday of current week in local time
    const dow = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysFromMon = dow === 0 ? 6 : dow - 1;
    const monDate = new Date(now);
    monDate.setDate(now.getDate() - daysFromMon);
    const weekStartStr = `${monDate.getFullYear()}-${String(monDate.getMonth()+1).padStart(2,'0')}-${String(monDate.getDate()).padStart(2,'0')}`;

    // Sunday of current week
    const sunDate = new Date(monDate);
    sunDate.setDate(monDate.getDate() + 6);
    const weekEndStr = `${sunDate.getFullYear()}-${String(sunDate.getMonth()+1).padStart(2,'0')}-${String(sunDate.getDate()).padStart(2,'0')}`;

    // All paginated — census (750+), visits this week (800+), and auth
    // tables are each capable of exceeding the 1000-row PostgREST cap.
    const [c, v, ar, oh, wl, cl, dc] = await Promise.all([
      fetchAllPages(supabase.from('census_data').select('patient_name,region,status,insurance,last_visit_date,days_since_last_visit,first_seen_date,inferred_frequency,overdue_threshold_days,days_overdue')),
      fetchAllPages(supabase.from('visit_schedule_data').select('patient_name,staff_name,visit_date,status,event_type,region').gte('visit_date', weekStartStr).lte('visit_date', weekEndStr)),
      fetchAllPages(supabase.from('auth_renewal_tasks').select('patient_name,region,priority,task_status,days_until_expiry,visits_remaining,expiry_date').not('task_status', 'in', '("approved","denied","closed")')),
      fetchAllPages(supabase.from('on_hold_recovery').select('patient_name,region,hold_type,days_on_hold')),
      fetchAllPages(supabase.from('waitlist_assignments').select('patient_name,region,assignment_status,assigned_clinician,waitlisted_since,priority')),
      fetchAllPages(supabase.from('clinicians').select('full_name,region,discipline,weekly_visit_target,is_active').eq('is_active', true)),
      fetchAllPages(supabase.from('patient_discharges').select('patient_name,discharge_date,followup_30day_required,followup_30day_completed')),
    ]);

    setCensus(c);
    setVisits(v);
    setAuthRenewals(ar);
    setOnHold(oh);
    setWaitlist(wl);
    setClinicians(cl);
    setDischarges(dc);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const metrics = useMemo(() => {
    if (!census.length) return null;

    const active = census.filter(p => /active/i.test(p.status || ''));
    // Frequency-aware overdue: each patient has their own threshold (4w4→3d, 2w4→4d, 1w4→10d, 1em1→30d, 1em2→60d).
    const inactiveActive = active.filter(p => (p.days_overdue || 0) > 0);
    const onHoldPts = census.filter(p => /on.?hold/i.test(p.status || ''));
    const pendingStart = census.filter(p => /soc.?pending|eval.?pending/i.test(p.status || ''));

    // Visits this week
    const completedThisWeek = visits.filter(v => /completed/i.test(v.status || ''));
    const cancelledThisWeek = visits.filter(v => /cancel/i.test(v.status || '') || /cancel/i.test(v.event_type || ''));
    const missedThisWeek = visits.filter(v => /missed/i.test(v.status || ''));

    // Revenue
    const weeklyRevenue = completedThisWeek.length * BLENDED_RATE;
    const revenueGap = REVENUE_TARGET - weeklyRevenue;
    const inactiveRevGap = inactiveActive.length * BLENDED_RATE * 2;

    // Auth renewals
    const urgentAuths = authRenewals.filter(a => a.priority === 'urgent');
    const highAuths = authRenewals.filter(a => a.priority === 'high');

    // Clinician utilization
    const visitMap = {};
    completedThisWeek.forEach(v => {
      const k = (v.staff_name || '').toLowerCase().trim();
      visitMap[k] = (visitMap[k] || 0) + 1;
    });
    const underutilized = clinicians.filter(cl => {
      const done = visitMap[(cl.full_name || '').toLowerCase().trim()] || 0;
      const pct = cl.weekly_visit_target > 0 ? (done / cl.weekly_visit_target) * 100 : 0;
      return pct < 60 && cl.weekly_visit_target >= 10;
    });

    // On hold overdue (21+ days)
    const onHoldOverdue = onHold.filter(p => (p.days_on_hold || 0) > 21);

    // Discharge follow-up overdue
    const dischargeOverdue = discharges.filter(d => {
      if (!d.followup_30day_required || d.followup_30day_completed) return false;
      if (!d.discharge_date) return false;
      return daysAgo(d.discharge_date) >= 30;
    });

    // Waitlist unassigned
    const waitlistUnassigned = waitlist.filter(w => w.assignment_status === 'pending' && !w.assigned_clinician);

    // Region breakdown
    const regionData = REGIONS.map(r => {
      const rActive = active.filter(p => p.region === r);
      const rInactive = inactiveActive.filter(p => p.region === r);
      const rOnHold = onHoldPts.filter(p => p.region === r);
      const rPending = pendingStart.filter(p => p.region === r);
      const rVisits = completedThisWeek.filter(v => v.region === r);
      return {
        region: r,
        active: rActive.length,
        inactiveActive: rInactive.length,
        onHold: rOnHold.length,
        pending: rPending.length,
        completedVisits: rVisits.length,
        revenueGap: rInactive.length * BLENDED_RATE * 2,
      };
    }).filter(r => r.active > 0 || r.onHold > 0 || r.pending > 0);

    return {
      active: active.length, inactiveActive, onHoldPts, pendingStart,
      completedThisWeek, cancelledThisWeek, missedThisWeek,
      weeklyRevenue, revenueGap, inactiveRevGap,
      urgentAuths, highAuths, underutilized, onHoldOverdue,
      dischargeOverdue, waitlistUnassigned, regionData,
      clinicianCapacity: clinicians.reduce((s, c) => s + (c.weekly_visit_target || 0), 0),
      cancelRate: completedThisWeek.length > 0 ? Math.round((cancelledThisWeek.length / (completedThisWeek.length + cancelledThisWeek.length + missedThisWeek.length)) * 100) : 0,
    };
  }, [census, visits, authRenewals, onHold, waitlist, clinicians, discharges]);

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Director Command" subtitle="Loading live data..." />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:32, marginBottom:8 }}>⚡</div>
          <div>Pulling live operations data...</div>
        </div>
      </div>
    </div>
  );

  const m = metrics;
  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  const totalInactiveGap = m.inactiveActive.length * BLENDED_RATE * 2;

  // Score: 5 critical checks, each worth 20 pts
  const score = Math.round(
    (m.urgentAuths.length === 0 ? 20 : Math.max(0, 20 - m.urgentAuths.length * 2)) +
    (m.inactiveActive.length < 50 ? 20 : Math.max(0, 20 - Math.round((m.inactiveActive.length - 50) / 10))) +
    (m.onHoldOverdue.length === 0 ? 20 : Math.max(0, 20 - m.onHoldOverdue.length)) +
    (m.completedThisWeek.length >= 800 ? 20 : Math.round((m.completedThisWeek.length / 800) * 20)) +
    (m.cancelRate < 8 ? 20 : Math.max(0, 20 - (m.cancelRate - 8) * 2))
  );
  const scoreColor = score >= 80 ? '#059669' : score >= 60 ? '#D97706' : '#DC2626';

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%', background:'var(--bg)' }}>
      <TopBar
        title="Director Command"
        subtitle={today}
        actions={
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            {lastRefresh && <span style={{ fontSize:10, color:'var(--gray)' }}>Updated {lastRefresh.toLocaleTimeString()}</span>}
            <button onClick={load} style={{ padding:'6px 14px', background:'#0F1117', color:'#fff', border:'none', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer' }}>
              ↻ Refresh
            </button>
          </div>
        }
      />

      <div style={{ flex:1, overflowY:'auto', padding:20, display:'flex', flexDirection:'column', gap:16 }}>

        {/* Revenue + Score Row */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:16 }}>
          <RevenueGauge actual={m.weeklyRevenue} target={REVENUE_TARGET} />
          <div style={{ background:'#0F1117', borderRadius:12, padding:'18px 24px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minWidth:140 }}>
            <div style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Ops Score</div>
            <div style={{ fontSize:52, fontWeight:900, fontFamily:'DM Mono, monospace', color:scoreColor, lineHeight:1 }}>{score}</div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', marginTop:4 }}>/100</div>
            <div style={{ fontSize:9, color:scoreColor, marginTop:6, textAlign:'center', fontWeight:600 }}>
              {score >= 80 ? 'Strong' : score >= 60 ? 'Needs Work' : 'Critical'}
            </div>
          </div>
        </div>

        {/* Today's Visit Pulse — each tile routes to the relevant drill-down
            so Liam can jump straight from the snapshot to the detail page
            instead of scanning the sidebar. */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10 }}>
          {[
            { label:'Completed', val:m.completedThisWeek.length, color:'#059669', sub:`of ${WEEKLY_TARGET} target`, bg:'#F0FFF4', target:'visits', hint:'visit schedule' },
            { label:'Cancelled', val:m.cancelledThisWeek.length, color:'#DC2626', sub:`${m.cancelRate}% cancel rate`, bg:m.cancelRate>10?'#FEF2F2':'var(--card-bg)', target:'missed-cancelled', hint:'missed/cancelled report' },
            { label:'Missed', val:m.missedThisWeek.length, color:'#D97706', sub:'this week', bg:m.missedThisWeek.length>30?'#FEF3C7':'var(--card-bg)', target:'missed-cancelled', hint:'missed/cancelled report' },
            { label:'Clinician Cap.', val:m.clinicianCapacity, color:'#1565C0', sub:'max visits/week', bg:'#EFF6FF', target:'staff', hint:'staff directory' },
            { label:'Utilization', val:Math.round((m.completedThisWeek.length/m.clinicianCapacity)*100)+'%', color:m.completedThisWeek.length/m.clinicianCapacity>0.75?'#059669':'#D97706', sub:`${m.completedThisWeek.length}/${m.clinicianCapacity} capacity`, bg:'var(--card-bg)', target:'clinician-accountability', hint:'by clinician' },
          ].map(c => {
            const clickable = !!c.target;
            return (
              <div key={c.label}
                onClick={clickable ? () => go(c.target) : undefined}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={clickable ? e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); go(c.target); } } : undefined}
                style={{ background:c.bg, border:'1px solid var(--border)', borderRadius:10, padding:'10px 12px', textAlign:'center', cursor: clickable ? 'pointer' : 'default', transition:'transform 0.1s ease, box-shadow 0.15s ease' }}
                onMouseEnter={clickable ? e => { e.currentTarget.style.transform='translateY(-1px)'; e.currentTarget.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'; } : undefined}
                onMouseLeave={clickable ? e => { e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='none'; } : undefined}>
                <div style={{ fontSize:9, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{c.label}</div>
                <div style={{ fontSize:24, fontWeight:900, fontFamily:'DM Mono, monospace', color:c.color, marginTop:2 }}>{c.val}</div>
                <div style={{ fontSize:9, color:'var(--gray)', marginTop:1 }}>{c.sub}</div>
                {clickable && (
                  <div style={{ fontSize:8, color:c.color, marginTop:3, opacity:0.65, fontWeight:600 }}>open {c.hint} →</div>
                )}
              </div>
            );
          })}
        </div>

        {/* TRIAGE — 5 Priority Actions */}
        <div>
          <div style={{ fontSize:13, fontWeight:800, color:'#0F1117', marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ background:'#DC2626', color:'#fff', borderRadius:5, padding:'2px 8px', fontSize:11 }}>TRIAGE</span>
            Today's 5 Priority Actions
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10 }}>
            <TriageCard
              rank={1} urgent
              title="Active Patients Not Seen 14+ Days"
              count={m.inactiveActive.length}
              subtitle="Generating $0 despite Active status"
              color="#DC2626" bg="#FEF2F2" border="#FECACA"
              detail={`${fmt$(totalInactiveGap)}/wk revenue sitting idle`}
              actionLabel="Open Census → Sort Last Seen"
              action={() => go('census', { lastSeen: 'overdue', status: 'active' })}
            />
            <TriageCard
              rank={2} urgent
              title="Auth Renewals — Urgent"
              count={m.urgentAuths.length}
              subtitle="Expiring ≤7 days or ≤4 visits left"
              color="#DC2626" bg="#FFF5F5" border="#FECACA"
              detail={`+${m.highAuths.length} high priority also open`}
              actionLabel="Open Auth Renewals"
              action={() => go('auth-renewals')}
            />
            <TriageCard
              rank={3}
              title="Pipeline Stall — Accepted Not Started"
              count={m.pendingStart.length}
              subtitle="SOC/Eval Pending — won't bill until first visit"
              color="#D97706" bg="#FEF3C7" border="#FCD34D"
              detail={`${fmt$(m.pendingStart.length * BLENDED_RATE * 2)}/wk potential if started`}
              actionLabel="Open SOC → Active Pipeline"
              action={() => go('pipeline')}
            />
            <TriageCard
              rank={4}
              title="Underutilized Clinicians"
              count={m.underutilized.length}
              subtitle="Below 60% of weekly visit target"
              color="#7C3AED" bg="#F5F3FF" border="#DDD6FE"
              detail="Capacity exists — needs patient assignment"
              actionLabel="Open Clinician Accountability"
              action={() => go('clinician-accountability')}
            />
            <TriageCard
              rank={5}
              title="On-Hold Patients"
              count={m.onHoldPts.length}
              subtitle={`${m.onHoldOverdue.length} over 21 days — need recovery call`}
              color="#1565C0" bg="#EFF6FF" border="#BFDBFE"
              detail={`${m.waitlistUnassigned.length} waitlist patients unassigned`}
              actionLabel="Open On-Hold Recovery"
              action={() => go('on-hold')}
            />
          </div>
        </div>

        {/* Revenue Gap by Region */}
        <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ fontSize:13, fontWeight:800, color:'#0F1117' }}>Region Health & Revenue Gap</div>
            <div style={{ fontSize:11, color:'var(--gray)' }}>Activity rate = active patients seen within their prescribed frequency</div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'0.5fr 0.7fr 1.2fr 0.7fr 0.7fr 0.7fr 0.9fr', padding:'7px 16px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:9, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', gap:8 }}>
            <span>Region</span><span>Active</span><span>Activity Rate</span><span>Inactive</span><span>On Hold</span><span>Pending</span><span>Rev Gap/Wk</span>
          </div>
          {m.regionData.map(r => (
            <RegionRow key={r.region} {...r} />
          ))}
          <div style={{ padding:'10px 16px', background:'#F8F9FF', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'space-between', fontSize:11 }}>
            <span style={{ fontWeight:700 }}>Total</span>
            <span style={{ color:'var(--gray)' }}>{m.active} active</span>
            <span style={{ color:'var(--gray)' }}></span>
            <span style={{ color:'#DC2626', fontWeight:700 }}>{m.inactiveActive.length} overdue vs freq</span>
            <span style={{ color:'var(--gray)' }}>{m.onHoldPts.length}</span>
            <span style={{ color:'var(--gray)' }}>{m.pendingStart.length}</span>
            <span style={{ color:'#DC2626', fontWeight:700 }}>-{fmt$(totalInactiveGap)}/wk</span>
          </div>
        </div>

        {/* Auth Renewals Snapshot + Clinician Underutilization side by side */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          {/* Auth snapshot */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontSize:13, fontWeight:800 }}>🔄 Auth Renewals at Risk</div>
              <div style={{ fontSize:11 }}>
                <span style={{ color:'#DC2626', fontWeight:700 }}>{m.urgentAuths.length} urgent</span>
                <span style={{ color:'var(--gray)' }}> · {m.highAuths.length} high</span>
              </div>
            </div>
            {m.urgentAuths.length === 0 && m.highAuths.length === 0 ? (
              <div style={{ padding:24, textAlign:'center', color:'#059669', fontWeight:700, fontSize:13 }}>✅ No urgent renewals — all clear</div>
            ) : (
              <div style={{ maxHeight:240, overflowY:'auto' }}>
                {[...m.urgentAuths, ...m.highAuths].slice(0,8).map((a, i) => (
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr auto auto auto', padding:'8px 14px', borderBottom:'1px solid var(--border)', gap:10, alignItems:'center', background:a.priority==='urgent'?'#FFF5F5':'var(--card-bg)' }}>
                    <div>
                      <div style={{ fontSize:11, fontWeight:600 }}>{a.patient_name}</div>
                      <div style={{ fontSize:9, color:'var(--gray)' }}>Rgn {a.region}</div>
                    </div>
                    <span style={{ fontSize:10, fontWeight:700, color:a.priority==='urgent'?'#DC2626':'#D97706', background:a.priority==='urgent'?'#FEF2F2':'#FEF3C7', padding:'2px 6px', borderRadius:999 }}>
                      {a.priority}
                    </span>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontSize:11, fontWeight:700, color:a.days_until_expiry<=7?'#DC2626':'#D97706' }}>{a.days_until_expiry}d</div>
                      <div style={{ fontSize:9, color:'var(--gray)' }}>left</div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontSize:11, fontWeight:700, color:a.visits_remaining<=4?'#DC2626':'#D97706' }}>{a.visits_remaining}</div>
                      <div style={{ fontSize:9, color:'var(--gray)' }}>visits</div>
                    </div>
                  </div>
                ))}
                {(m.urgentAuths.length + m.highAuths.length) > 8 && (
                  <div style={{ padding:'8px 14px', fontSize:11, color:'var(--gray)', textAlign:'center' }}>+{(m.urgentAuths.length + m.highAuths.length) - 8} more — open Auth Renewals page</div>
                )}
              </div>
            )}
          </div>

          {/* Clinician underutilization */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontSize:13, fontWeight:800 }}>👤 Clinicians Under 60% Utilization</div>
              <div style={{ fontSize:11, color:'#7C3AED', fontWeight:700 }}>{m.underutilized.length} clinicians</div>
            </div>
            {m.underutilized.length === 0 ? (
              <div style={{ padding:24, textAlign:'center', color:'#059669', fontWeight:700, fontSize:13 }}>✅ All clinicians above 60% — strong week</div>
            ) : (
              <div style={{ maxHeight:240, overflowY:'auto' }}>
                {(() => {
                  const visitMap = {};
                  m.completedThisWeek.forEach(v => {
                    const k = (v.staff_name || '').toLowerCase().trim();
                    visitMap[k] = (visitMap[k] || 0) + 1;
                  });
                  return m.underutilized.slice(0, 8).map((cl, i) => {
                    const done = visitMap[(cl.full_name || '').toLowerCase().trim()] || 0;
                    const pct = Math.round((done / cl.weekly_visit_target) * 100);
                    return (
                      <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr auto auto', padding:'8px 14px', borderBottom:'1px solid var(--border)', gap:10, alignItems:'center' }}>
                        <div>
                          <div style={{ fontSize:11, fontWeight:600 }}>{cl.full_name}</div>
                          <div style={{ fontSize:9, color:'var(--gray)' }}>{cl.discipline} · Rgn {cl.region}</div>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:12, fontWeight:700, color:pct<30?'#DC2626':'#D97706' }}>{done}/{cl.weekly_visit_target}</div>
                          <div style={{ fontSize:9, color:'var(--gray)' }}>visits</div>
                        </div>
                        <div style={{ width:40, textAlign:'right' }}>
                          <div style={{ fontSize:12, fontWeight:900, fontFamily:'DM Mono, monospace', color:pct<30?'#DC2626':'#D97706' }}>{pct}%</div>
                        </div>
                      </div>
                    );
                  });
                })()}
                {m.underutilized.length > 8 && (
                  <div style={{ padding:'8px 14px', fontSize:11, color:'var(--gray)', textAlign:'center' }}>+{m.underutilized.length - 8} more — open Staff Directory</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Path to $200K */}
        <div style={{ background:'#0F1117', borderRadius:12, padding:'16px 20px', color:'#fff' }}>
          <div style={{ fontSize:12, fontWeight:800, color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 }}>
            📈 Path to $200K Weekly Revenue
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
            {[
              {
                label: 'Current Revenue Pace',
                val: fmt$(m.weeklyRevenue),
                sub: `${m.completedThisWeek.length} visits @ $${BLENDED_RATE}`,
                color: m.weeklyRevenue >= 150000 ? '#34D399' : m.weeklyRevenue >= 100000 ? '#FBBF24' : '#F87171',
              },
              {
                label: 'Recover Inactive Actives',
                val: `+${fmt$(totalInactiveGap)}`,
                sub: `${m.inactiveActive.length} patients × 2 visits × $${BLENDED_RATE}`,
                color: '#FBBF24',
              },
              {
                label: 'Convert Pipeline',
                val: `+${fmt$(m.pendingStart.length * BLENDED_RATE * 2)}`,
                sub: `${m.pendingStart.length} SOC/Eval pending × 2 visits`,
                color: '#FBBF24',
              },
              {
                label: 'Projected at Full Recovery',
                val: fmt$(m.weeklyRevenue + totalInactiveGap + (m.pendingStart.length * BLENDED_RATE * 2)),
                sub: `vs $${(REVENUE_TARGET/1000).toFixed(0)}K target`,
                color: (m.weeklyRevenue + totalInactiveGap + (m.pendingStart.length * BLENDED_RATE * 2)) >= REVENUE_TARGET ? '#34D399' : '#FBBF24',
              },
            ].map(item => (
              <div key={item.label} style={{ background:'rgba(255,255,255,0.06)', borderRadius:8, padding:'12px 14px' }}>
                <div style={{ fontSize:9, fontWeight:700, color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>{item.label}</div>
                <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', color:item.color, lineHeight:1 }}>{item.val}</div>
                <div style={{ fontSize:9, color:'rgba(255,255,255,0.35)', marginTop:4 }}>{item.sub}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
