import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
 
const RATE = 230; // $ per billable visit
 
function isEval(event_type) {
  return /eval/i.test(event_type || '');
}
function isCompleted(status) {
  return /completed/i.test(status || '');
}
function isCancelled(event_type, status) {
  return /cancel/i.test(event_type || '') || /cancel/i.test(status || '');
}
function isMissed(status) {
  return /missed/i.test(status || '');
}
 
function weekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}
 
function fmtDollar(n) {
  return '$' + Math.round(n).toLocaleString();
}
 
export default function RevenuePage() {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('weekly'); // weekly | daily
 
  useEffect(() => {
    supabase.from('visit_schedule_data')
      .select('patient_name,visit_date,discipline,event_type,status,staff_name,region,insurance')
      .not('visit_date', 'is', null)
      .order('visit_date', { ascending: false })
      .limit(10000)
      .then(({ data }) => { setVisits(data || []); setLoading(false); });
  }, []);
 
  const stats = useMemo(() => {
    // Deduplicate evals: PT + PTA same patient + same date = 1 billable visit
    const evalSeen = new Set();
    const billable = [];
    const all = [];
 
    visits.forEach(v => {
      all.push(v);
      if (!isCompleted(v.status)) return;
      if (isCancelled(v.event_type, v.status)) return;
 
      if (isEval(v.event_type)) {
        const key = `${v.patient_name}||${v.visit_date}`;
        if (evalSeen.has(key)) return; // skip duplicate PT/PTA eval
        evalSeen.add(key);
      }
      billable.push(v);
    });
 
    const totalCompleted = billable.length;
    const totalRevenue = totalCompleted * RATE;
 
    // Scheduled (future potential)
    const scheduled = visits.filter(v =>
      /scheduled/i.test(v.status || '') && !isCancelled(v.event_type, v.status)
    ).length;
    const projectedRevenue = scheduled * RATE;
 
    // Cancelled and missed
    const cancelled = visits.filter(v => isCancelled(v.event_type, v.status)).length;
    const missed = visits.filter(v => isMissed(v.status) && !isCancelled(v.event_type, v.status)).length;
    const lostRevenue = (cancelled + missed) * RATE;
 
    // By week
    const weekMap = {};
    billable.forEach(v => {
      if (!v.visit_date) return;
      const wk = weekStart(v.visit_date);
      if (!weekMap[wk]) weekMap[wk] = { completed: 0, revenue: 0, evals: 0, cancelled: 0, missed: 0, scheduled: 0 };
      weekMap[wk].completed++;
      weekMap[wk].revenue += RATE;
      if (isEval(v.event_type)) weekMap[wk].evals++;
    });
    visits.filter(v => isCancelled(v.event_type, v.status) && v.visit_date).forEach(v => {
      const wk = weekStart(v.visit_date);
      if (!weekMap[wk]) weekMap[wk] = { completed: 0, revenue: 0, evals: 0, cancelled: 0, missed: 0, scheduled: 0 };
      weekMap[wk].cancelled++;
    });
    visits.filter(v => isMissed(v.status) && !isCancelled(v.event_type, v.status) && v.visit_date).forEach(v => {
      const wk = weekStart(v.visit_date);
      if (!weekMap[wk]) weekMap[wk] = { completed: 0, revenue: 0, evals: 0, cancelled: 0, missed: 0, scheduled: 0 };
      weekMap[wk].missed++;
    });
    visits.filter(v => /scheduled/i.test(v.status||'') && !isCancelled(v.event_type, v.status) && v.visit_date).forEach(v => {
      const wk = weekStart(v.visit_date);
      if (!weekMap[wk]) weekMap[wk] = { completed: 0, revenue: 0, evals: 0, cancelled: 0, missed: 0, scheduled: 0 };
      weekMap[wk].scheduled++;
    });
 
    const weeks = Object.entries(weekMap)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 12)
      .map(([wk, data]) => ({ week: wk, ...data }));
 
    // By clinician
    const clinicianMap = {};
    billable.forEach(v => {
      const k = v.staff_name || 'Unknown';
      if (!clinicianMap[k]) clinicianMap[k] = { visits: 0, revenue: 0 };
      clinicianMap[k].visits++;
      clinicianMap[k].revenue += RATE;
    });
    const byClinician = Object.entries(clinicianMap)
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 15);
 
    // By insurance
    const insMap = {};
    billable.forEach(v => {
      const k = v.insurance || 'Unknown';
      if (!insMap[k]) insMap[k] = { visits: 0, revenue: 0 };
      insMap[k].visits++;
      insMap[k].revenue += RATE;
    });
    const byInsurance = Object.entries(insMap)
      .map(([ins, d]) => ({ ins, ...d }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
 
    const maxWeekRev = weeks.length > 0 ? Math.max(...weeks.map(w => w.revenue), 1) : 1;
 
    return { totalCompleted, totalRevenue, scheduled, projectedRevenue, cancelled, missed, lostRevenue, weeks, byClinician, byInsurance, maxWeekRev };
  }, [visits]);
 
  const TILE = { flex: 1, padding: '14px 18px', borderRight: '1px solid var(--border)', textAlign: 'center' };
  const SEL = { padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--card-bg)', color: 'var(--black)', outline: 'none', cursor: 'pointer', fontWeight: 500 };
 
  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Revenue" subtitle="Loading visit data…" />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading…</div>
    </div>
  );
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Revenue" subtitle={`Based on ${stats.totalCompleted.toLocaleString()} completed visits · $${RATE}/visit`} />
 
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* KPI Strip */}
        <div style={{ display: 'flex', background: 'var(--card-bg)', borderBottom: '1px solid var(--border)' }}>
          {[
            { label: 'Completed Visits', val: stats.totalCompleted.toLocaleString(), sub: 'billable (deduped evals)', color: 'var(--black)' },
            { label: 'Revenue Earned', val: fmtDollar(stats.totalRevenue), sub: 'at $230/visit', color: '#065F46' },
            { label: 'Scheduled (Pipeline)', val: stats.scheduled.toLocaleString(), sub: fmtDollar(stats.projectedRevenue) + ' projected', color: '#1565C0' },
            { label: 'Lost Revenue', val: fmtDollar(stats.lostRevenue), sub: `${stats.cancelled} cancelled · ${stats.missed} missed`, color: '#DC2626', alert: true },
            { label: 'Recovery Rate', val: Math.round((stats.totalCompleted / Math.max(stats.totalCompleted + stats.cancelled + stats.missed, 1)) * 100) + '%', sub: 'completed vs all', color: '#7C3AED' },
          ].map(t => (
            <div key={t.label} style={{ ...TILE, background: t.alert ? '#FEF2F2' : 'transparent' }}>
              <div style={{ fontSize: 9, color: 'var(--gray)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: t.color, marginTop: 4 }}>{t.val}</div>
              <div style={{ fontSize: 10, color: t.alert ? t.color : 'var(--gray)', marginTop: 2, fontWeight: t.alert ? 600 : 400 }}>{t.sub}</div>
            </div>
          ))}
        </div>
 
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Weekly Revenue Chart */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--black)' }}>Weekly Revenue</div>
                <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>Last 12 weeks — completed visits only, evals deduplicated</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160 }}>
              {[...stats.weeks].reverse().map((w, i) => {
                const h = Math.max((w.revenue / stats.maxWeekRev) * 140, 4);
                const d = new Date(w.week);
                const label = `${d.getMonth()+1}/${d.getDate()}`;
                return (
                  <div key={w.week} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: '#065F46' }}>{fmtDollar(w.revenue)}</div>
                    <div style={{ width: '100%', height: h, background: 'linear-gradient(180deg, #10B981, #065F46)', borderRadius: '4px 4px 0 0', position: 'relative' }}>
                      {w.cancelled > 0 && (
                        <div style={{ position: 'absolute', top: -18, right: 0, fontSize: 8, color: '#DC2626', fontWeight: 700 }}>-{w.cancelled}</div>
                      )}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--gray)', textAlign: 'center' }}>{label}</div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--black)' }}>{w.completed}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
              {[['#10B981','Completed Visits'], ['#DC2626','-N = Cancellations']].map(([c,l]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                  <div style={{ width: 10, height: 10, background: c, borderRadius: 2 }} />{l}
                </div>
              ))}
            </div>
          </div>
 
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Top Clinicians */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginBottom: 4 }}>Revenue by Clinician (Top 15)</div>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 16 }}>Completed visits only · $230/visit</div>
              {stats.byClinician.map((c, i) => (
                <div key={c.name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ fontWeight: 500, color: 'var(--black)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{c.name}</span>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, color: '#065F46', flexShrink: 0 }}>{fmtDollar(c.revenue)} <span style={{ color: 'var(--gray)', fontWeight: 400, fontSize: 10 }}>({c.visits}v)</span></span>
                  </div>
                  <div style={{ height: 6, background: 'var(--border)', borderRadius: 999 }}>
                    <div style={{ height: '100%', width: (c.revenue / stats.byClinician[0].revenue * 100) + '%', background: '#10B981', borderRadius: 999 }} />
                  </div>
                </div>
              ))}
            </div>
 
            {/* By Insurance */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', marginBottom: 4 }}>Revenue by Insurance (Top 10)</div>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 16 }}>Which payers generate the most revenue</div>
              {stats.byInsurance.map((ins) => (
                <div key={ins.ins} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ fontWeight: 500, color: 'var(--black)' }}>{ins.ins}</span>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, color: '#1565C0' }}>{fmtDollar(ins.revenue)} <span style={{ color: 'var(--gray)', fontWeight: 400, fontSize: 10 }}>({ins.visits}v)</span></span>
                  </div>
                  <div style={{ height: 6, background: 'var(--border)', borderRadius: 999 }}>
                    <div style={{ height: '100%', width: (ins.revenue / stats.byInsurance[0].revenue * 100) + '%', background: '#1565C0', borderRadius: 999 }} />
                  </div>
                </div>
              ))}
 
              {/* Lost revenue breakdown */}
              <div style={{ marginTop: 20, padding: 14, background: '#FEF2F2', borderRadius: 10, border: '1px solid #FCA5A5' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#DC2626', marginBottom: 8 }}>Lost Revenue Breakdown</div>
                {[
                  { label: 'Cancellations', count: stats.cancelled, rev: stats.cancelled * RATE },
                  { label: 'Missed Visits', count: stats.missed, rev: stats.missed * RATE },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                    <span style={{ color: '#7F1D1D' }}>{item.label} ({item.count})</span>
                    <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, color: '#DC2626' }}>{fmtDollar(item.rev)}</span>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid #FCA5A5', paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>
                  <span style={{ color: '#7F1D1D' }}>Total Lost</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', color: '#DC2626' }}>{fmtDollar(stats.lostRevenue)}</span>
                </div>
              </div>
            </div>
          </div>
 
          {/* Weekly detail table */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr 1fr', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <span>Week Of</span><span>Completed</span><span>Evals</span><span>Cancelled</span><span>Missed</span><span>Scheduled</span><span>Revenue</span>
            </div>
            {stats.weeks.map((w, i) => (
              <div key={w.week} style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr 1fr', alignItems: 'center' }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>{w.week}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#065F46' }}>{w.completed}</span>
                <span style={{ fontSize: 12, color: '#7C3AED' }}>{w.evals}</span>
                <span style={{ fontSize: 12, color: '#DC2626', fontWeight: w.cancelled > 0 ? 600 : 400 }}>{w.cancelled}</span>
                <span style={{ fontSize: 12, color: '#D97706', fontWeight: w.missed > 0 ? 600 : 400 }}>{w.missed}</span>
                <span style={{ fontSize: 12, color: '#1565C0' }}>{w.scheduled}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700, color: '#065F46' }}>{fmtDollar(w.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
 
