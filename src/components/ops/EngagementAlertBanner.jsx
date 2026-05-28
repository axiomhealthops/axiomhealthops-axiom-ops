// EngagementAlertBanner.jsx
//
// Conditional banner on the Operations Manager Dashboard. Surfaces
// coordinators who haven't logged in for >2 business days. Only renders
// when there's at least one stale coordinator — no banner fatigue on
// good days.
//
// Stale threshold: 3+ calendar days since last_sign_in_at. 2 business
// days = 3 calendar days on a Tuesday morning (after weekend). We're
// using calendar days for simplicity; in practice "Mary 40 days ago" is
// the kind of finding this catches.
//
// Data source: get_coordinator_engagement() RPC (returns auth.users
// last_sign_in_at via SECURITY DEFINER, role-gated to admin+).
//
// CLAUDE.md compliance: ASCII only in JSX text.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

const STALE_DAYS = 3; // > 2 business days

export default function EngagementAlertBanner({ onNavigate }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data, error } = await supabase.rpc('get_coordinator_engagement');
    if (error) { console.warn('get_coordinator_engagement failed:', error.message); setLoading(false); return; }
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const stale = useMemo(() => {
    return (rows || [])
      .filter(r => ['care_coordinator','auth_coordinator','intake_coordinator'].includes(r.role))
      .filter(r => r.days_since_last_login === null || r.days_since_last_login >= STALE_DAYS)
      .sort((a, b) => (b.days_since_last_login ?? 9999) - (a.days_since_last_login ?? 9999));
  }, [rows]);

  if (loading) return null;
  if (stale.length === 0) return null;

  const worst = stale[0];
  const worstLabel = worst.days_since_last_login === null
    ? worst.full_name + ': never logged in'
    : worst.full_name + ': ' + worst.days_since_last_login + 'd ago';

  return (
    <div style={{
      padding: '12px 20px',
      background: '#FEF2F2',
      borderBottom: '1px solid #FCA5A5',
      color: '#7F1D1D',
      display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 20 }}>!</span>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          {stale.length} coordinator{stale.length === 1 ? '' : 's'} stale &gt; {STALE_DAYS - 1} business day{STALE_DAYS - 1 === 1 ? '' : 's'}
        </div>
        <div style={{ fontSize: 11, marginTop: 2, color: '#991B1B' }}>
          Worst: {worstLabel}. Click to see the full list and reach out.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {stale.slice(0, 5).map(s => (
          <span key={s.coordinator_id} style={{
            fontSize: 10, fontWeight: 700,
            background: s.days_since_last_login >= 14 ? '#DC2626' : '#9A3412',
            color: '#fff',
            padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap',
          }}>
            {s.full_name.split(' ')[0]} {s.days_since_last_login === null ? 'never' : (s.days_since_last_login + 'd')}
          </span>
        ))}
        {stale.length > 5 && (
          <span style={{ fontSize: 10, color: '#7F1D1D', padding: '3px 8px' }}>
            +{stale.length - 5} more
          </span>
        )}
      </div>
    </div>
  );
}
