import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';

const COORDINATOR_MAP = {
  'Gypsy Renos':      ['A'],
  'Mary Imperio':     ['B', 'C', 'G'],
  'Audrey Sarmiento': ['H', 'J', 'M', 'N'],
  'April Manalo':     ['T', 'V'],
};

function StatBox({ label, val, color = 'var(--black)', sub }) {
  return (
    <div style={{ textAlign: 'center', padding: '12px 8px' }}>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'DM Mono, monospace', color }}>{val}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--black)', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

export default function RegionsPage() {
  const [visits, setVisits] = useState([]);
  const [intake, setIntake] = useState([]);
  const [auth, setAuth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRegion, setSelectedRegion] = useState(null);

  useEffect(() => {
    Promise.all([
      supabase.from('visit_schedule_data').select('patient_name,visit_date,status,event_type,staff_name,region,insurance').not('visit_date', 'is', null),
      supabase.from('intake_referrals').select('referral_status,date_received,region,insurance,patient_name').not('date_received', 'is', null),
      supabase.from('auth_tracker').select('auth_status,region,insurance,patient_name,visits_used,visits_authorized'),
    ]).then(([v, i, a]) => {
      setVisits(v.data || []);
      setIntake(i.data || []);
      setAuth(a.data || []);
      setLoading(false);
    });
  }, []);

  const regions = useMemo(() => {
    const all = [...new Set([
      ...visits.map(v => v.region),
      ...intake.map(i => i.region),
      ...auth.map(a => a.region),
    ].filter(Boolean))].sort();

    return all.map(region => {
      const rVisits = visits.filter(v => v.region === region);
      const completed = rVisits.filter(v => /completed/i.test(v.status || '') && !/cancel/i.test(v.event_type || '')).length;
      const cancelled = rVisits.filter(v => /cancel/i.test(v.event_type || '') || /cancel/i.test(v.status || '')).length;
      const scheduled = rVisits.filter(v => /scheduled/i.test(v.status || '') && !/cancel/i.test(v.event_type || '')).length;
      const rIntake = intake.filter(i => i.region === region);
      const accepted = rIntake.filter(i => i.referral_status === 'Accepted').length;
      const denied = rIntake.filter(i => i.referral_status === 'Denied').length;
      const rAuth = auth.filter(a => a.region === region);
      const activeAuth = rAuth.filter(a => /approved|active/i.test(a.auth_status || '')).length;
      const coordinator = Object.entries(COORDINATOR_MAP).find(([, rs]) => rs.includes(region))?.[0] || 'Unassigned';
      return {
        region, completed, cancelled, scheduled, accepted, denied, activeAuth,
        totalIntake: rIntake.length, totalAuth: rAuth.length,
        conversionRate: rIntake.length > 0 ? Math.round((accepted / rIntake.length) * 100) : 0,
        revenue: completed * 230, coordinator,
        patients: [...new Set(rVisits.map(v => v.patient_name).filter(Boolean))],
      };
    }).sort((a, b) => b.completed - a.completed);
  }, [visits, intake, auth]);

  const selected = selectedRegion ? regions.find(r => r.region === selectedRegion) : null;

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Regions" subtitle="Loading…" />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Regions" subtitle={`${regions.length} active regions`} />
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
          {Object.entries(COORDINATOR_MAP).map(([name, coordRegions]) => {
            const coordData = regions.filter(r => coordRegions.includes(r.region));
            const totalCompleted = coordData.reduce((s, r) => s + r.completed, 0);
            const totalIntake = coordData.reduce((s, r) => s + r.totalIntake, 0);
            return (
              <div key={name} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)', marginBottom: 2 }}>{name}</div>
                <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 12 }}>Regions: {coordRegions.join(', ')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <StatBox label="Visits" val={totalCompleted} color="#065F46" />
                  <StatBox label="Referrals" val={totalIntake} color="#1565C0" />
                  <StatBox label="Revenue" val={'$' + (totalCompleted * 230 / 1000).toFixed(0) + 'k'} color="#065F46" />
                  <StatBox label="Regions" val={coordRegions.length} color="#7C3AED" />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1.4fr' : '1fr', gap: 20 }}>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '0.4fr 1fr 0.7fr 0.7fr 0.7fr 0.7fr 0.7fr', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <span>Rgn</span><span>Coordinator</span><span>Completed</span><span>Intake</span><span>Accepted</span><span>Auth</span><span>Revenue</span>
            </div>
            {regions.map((r, i) => {
              const isSel = selectedRegion === r.region;
              return (
                <div key={r.region} onClick={() => setSelectedRegion(isSel ? null : r.region)}
                  style={{ display: 'grid', gridTemplateColumns: '0.4fr 1fr 0.7fr 0.7fr 0.7fr 0.7fr 0.7fr', padding: '10px 16px', borderBottom: '1px solid var(--border)', background: isSel ? '#EFF6FF' : i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)', cursor: 'pointer', borderLeft: isSel ? '3px solid #1565C0' : '3px solid transparent', alignItems: 'center' }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: isSel ? '#1565C0' : 'var(--black)' }}>{r.region}</span>
                  <span style={{ fontSize: 11, color: 'var(--gray)' }}>{r.coordinator}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#065F46' }}>{r.completed}</span>
                  <span style={{ fontSize: 12 }}>{r.totalIntake}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#065F46' }}>{r.accepted} <span style={{ color: 'var(--gray)', fontWeight: 400, fontSize: 10 }}>({r.conversionRate}%)</span></span>
                  <span style={{ fontSize: 12, color: '#7C3AED' }}>{r.activeAuth}</span>
                  <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', fontWeight: 600, color: '#065F46' }}>${(r.revenue / 1000).toFixed(0)}k</span>
                </div>
              );
            })}
          </div>

          {selected && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#1565C0' }}>Region {selected.region}</div>
                  <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 2 }}>Coordinator: {selected.coordinator}</div>
                </div>
                <button onClick={() => setSelectedRegion(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--gray)' }}>Close</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, background: 'var(--bg)', borderRadius: 10, padding: 12 }}>
                <StatBox label="Completed" val={selected.completed} color="#065F46" />
                <StatBox label="Scheduled" val={selected.scheduled} color="#1565C0" />
                <StatBox label="Cancelled" val={selected.cancelled} color="#DC2626" />
                <StatBox label="Revenue" val={'$' + selected.revenue.toLocaleString()} color="#065F46" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, background: 'var(--bg)', borderRadius: 10, padding: 12 }}>
                <StatBox label="Referrals" val={selected.totalIntake} />
                <StatBox label="Accepted" val={selected.accepted} color="#065F46" sub={selected.conversionRate + '% rate'} />
                <StatBox label="Denied" val={selected.denied} color="#DC2626" />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--black)', marginBottom: 8 }}>Active Patients ({selected.patients.length})</div>
                <div style={{ maxHeight: 200, overflowY: 'auto', background: 'var(--bg)', borderRadius: 8, padding: 8 }}>
                  {selected.patients.slice(0, 60).map(p => (
                    <div key={p} style={{ fontSize: 12, padding: '4px 8px', borderBottom: '1px solid var(--border)', color: 'var(--black)' }}>{p}</div>
                  ))}
                  {selected.patients.length > 60 && <div style={{ fontSize: 11, color: 'var(--gray)', padding: '6px 8px' }}>+{selected.patients.length - 60} more</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
