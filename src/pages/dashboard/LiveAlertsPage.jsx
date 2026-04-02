import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';

const ALERT_TYPES = {
  auth_expiring:    { label: 'Auth Expiring',      color: '#DC2626', bg: '#FEF2F2', icon: '⏰' },
  auth_exhausted:   { label: 'Auth Nearly Used',   color: '#D97706', bg: '#FEF3C7', icon: '⚠️' },
  pending_auth:     { label: 'Pending Auth',        color: '#1565C0', bg: '#EFF6FF', icon: '🔐' },
  missed_visit:     { label: 'Missed Visit',        color: '#7C3AED', bg: '#F5F3FF', icon: '❌' },
  high_cancel:      { label: 'High Cancellations',  color: '#EA580C', bg: '#FFF7ED', icon: '🚫' },
  no_visits:        { label: 'No Visits Scheduled', color: '#DC2626', bg: '#FEF2F2', icon: '📅' },
};

function daysBetween(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.round((d - now) / (1000 * 60 * 60 * 24));
}

export default function LiveAlertsPage() {
  const [auth, setAuth] = useState([]);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const d7 = new Date(); d7.setDate(d7.getDate() - 7);
    const d7s = d7.toISOString().slice(0, 10);
    Promise.all([
      supabase.from('auth_tracker').select('*'),
      supabase.from('visit_schedule_data')
        .select('patient_name,visit_date,status,event_type,region,staff_name,insurance')
        .gte('visit_date', d7s),
    ]).then(([a, v]) => {
      setAuth(a.data || []);
      setVisits(v.data || []);
      setLoading(false);
    });
  }, []);

  const alerts = useMemo(() => {
    const items = [];

    // 1. Auth expiring within 14 days
    auth.forEach(a => {
      const days = daysBetween(a.auth_expiry_date);
      if (days !== null && days >= 0 && days <= 14 && /active|approved/i.test(a.auth_status || '')) {
        items.push({
          type: 'auth_expiring',
          patient: a.patient_name || '—',
          detail: `Auth expires in ${days} day${days === 1 ? '' : 's'} (${a.auth_expiry_date?.slice(0,10)})`,
          insurance: a.insurance || '—',
          region: a.region || '—',
          priority: days <= 3 ? 'HIGH' : days <= 7 ? 'MEDIUM' : 'LOW',
          raw: a,
        });
      }
    });

    // 2. Auth visits nearly exhausted (≤5 remaining)
    auth.forEach(a => {
      const used = a.visits_used || 0;
      const authorized = a.visits_authorized || 24;
      const remaining = authorized - used;
      if (remaining <= 5 && remaining >= 0 && /active|approved/i.test(a.auth_status || '')) {
        items.push({
          type: 'auth_exhausted',
          patient: a.patient_name || '—',
          detail: `${remaining} visit${remaining === 1 ? '' : 's'} remaining of ${authorized} authorized (${used} used)`,
          insurance: a.insurance || '—',
          region: a.region || '—',
          priority: remaining <= 2 ? 'HIGH' : 'MEDIUM',
          raw: a,
        });
      }
    });

    // 3. Pending auth
    auth.filter(a => /pending/i.test(a.auth_status || '')).forEach(a => {
      items.push({
        type: 'pending_auth',
        patient: a.patient_name || '—',
        detail: `Authorization pending approval — ${a.insurance || 'unknown insurance'}`,
        insurance: a.insurance || '—',
        region: a.region || '—',
        priority: 'MEDIUM',
        raw: a,
      });
    });

    // 4. Missed visits this week
    visits.filter(v => /missed/i.test(v.status || '') && !/cancel/i.test(v.event_type || '')).forEach(v => {
      items.push({
        type: 'missed_visit',
        patient: v.patient_name || '—',
        detail: `Missed visit on ${v.visit_date} — ${v.staff_name || 'Unknown clinician'}`,
        insurance: v.insurance || '—',
        region: v.region || '—',
        priority: 'MEDIUM',
        raw: v,
      });
    });

    // 5. High cancellations — patients with 2+ cancellations this week
    const cancelMap = {};
    visits.filter(v => /cancel/i.test(v.event_type || '') || /cancel/i.test(v.status || '')).forEach(v => {
      const k = v.patient_name || 'Unknown';
      cancelMap[k] = (cancelMap[k] || 0) + 1;
    });
    Object.entries(cancelMap).filter(([, c]) => c >= 2).forEach(([patient, count]) => {
      const sample = visits.find(v => v.patient_name === patient);
      items.push({
        type: 'high_cancel',
        patient,
        detail: `${count} cancellations this week`,
        insurance: sample?.insurance || '—',
        region: sample?.region || '—',
        priority: count >= 3 ? 'HIGH' : 'MEDIUM',
        raw: sample,
      });
    });

    // Sort: HIGH first, then MEDIUM, then LOW
    const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return items.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  }, [auth, visits]);

  const filtered = alerts.filter(a => {
    if (filter !== 'ALL' && a.type !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return a.patient.toLowerCase().includes(q) || a.detail.toLowerCase().includes(q) || a.region.toLowerCase().includes(q);
    }
    return true;
  });

  const counts = {
    HIGH: alerts.filter(a => a.priority === 'HIGH').length,
    MEDIUM: alerts.filter(a => a.priority === 'MEDIUM').length,
    LOW: alerts.filter(a => a.priority === 'LOW').length,
  };

  const priorityColor = { HIGH: '#DC2626', MEDIUM: '#D97706', LOW: '#1565C0' };
  const priorityBg = { HIGH: '#FEF2F2', MEDIUM: '#FEF3C7', LOW: '#EFF6FF' };

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Live Alerts" subtitle="Loading…" />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Live Alerts" subtitle={`${alerts.length} active alerts · ${counts.HIGH} high priority`}
        actions={
          <input placeholder="Search patient, region…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', width: 200, background: 'var(--card-bg)' }} />
        }
      />
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* Priority summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', borderBottom: '1px solid var(--border)' }}>
          {[
            { label: 'High Priority', count: counts.HIGH, color: '#DC2626', bg: '#FEF2F2', desc: 'Require immediate action' },
            { label: 'Medium Priority', count: counts.MEDIUM, color: '#D97706', bg: '#FEF3C7', desc: 'Review within 24hrs' },
            { label: 'Low Priority', count: counts.LOW, color: '#1565C0', bg: '#EFF6FF', desc: 'Monitor and action soon' },
          ].map(t => (
            <div key={t.label} style={{ padding: '16px 24px', background: t.bg, borderRight: '1px solid var(--border)' }}>
              <div style={{ fontSize: 32, fontWeight: 800, fontFamily: 'DM Mono, monospace', color: t.color }}>{t.count}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)', marginTop: 2 }}>{t.label}</div>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>{t.desc}</div>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--card-bg)', flexWrap: 'wrap' }}>
          <button onClick={() => setFilter('ALL')}
            style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${filter==='ALL'?'var(--black)':'var(--border)'}`, background: filter==='ALL'?'var(--black)':'transparent', color: filter==='ALL'?'#fff':'var(--gray)', fontSize: 12, fontWeight: filter==='ALL'?700:400, cursor: 'pointer' }}>
            All ({alerts.length})
          </button>
          {Object.entries(ALERT_TYPES).map(([key, t]) => {
            const c = alerts.filter(a => a.type === key).length;
            if (c === 0) return null;
            return (
              <button key={key} onClick={() => setFilter(key === filter ? 'ALL' : key)}
                style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${filter===key?t.color:'var(--border)'}`, background: filter===key?t.bg:'transparent', color: filter===key?t.color:'var(--gray)', fontSize: 12, fontWeight: filter===key?700:400, cursor: 'pointer' }}>
                {t.icon} {t.label} ({c})
              </button>
            );
          })}
        </div>

        {/* Alert list */}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--gray)' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>No alerts match your filters</div>
            </div>
          )}
          {filtered.map((alert, i) => {
            const t = ALERT_TYPES[alert.type];
            return (
              <div key={i} style={{ background: 'var(--card-bg)', border: `1px solid var(--border)`, borderLeft: `4px solid ${t.color}`, borderRadius: 10, padding: '14px 18px', display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 16, alignItems: 'center' }}>
                <div style={{ fontSize: 20 }}>{t.icon}</div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>{alert.patient}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: t.color, background: t.bg, padding: '2px 7px', borderRadius: 999 }}>{t.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--gray)' }}>{alert.detail}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>
                    Region {alert.region} · {alert.insurance}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: priorityColor[alert.priority], background: priorityBg[alert.priority], padding: '3px 8px', borderRadius: 999 }}>
                    {alert.priority}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
