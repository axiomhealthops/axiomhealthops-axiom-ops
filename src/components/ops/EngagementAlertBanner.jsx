// EngagementAlertBanner.jsx
//
// Conditional banner on the Operations Manager Dashboard. Surfaces
// coordinators who haven't shown ACTIVITY in the system for >2 business
// days. Only renders when there's at least one stale coordinator -- no
// banner fatigue on good days.
//
// CRITICAL FIX (May 2026):
//   Phase 1 of this banner read auth.users.last_sign_in_at. That field
//   only updates on a fresh sign-in event; Supabase refreshes sessions
//   silently via refresh tokens, so a coordinator who's logged in once
//   and stayed in their browser for a month shows up as "40 days stale"
//   while actively working. Liam flagged 8 false positives (Kiarra,
//   Mary, Gypsy, Gerilyn, April, Audrey, Jhon, Ethel) -- all logged
//   activity that same day. Bug confirmed in DB.
//
//   The fix is server-side: v_coordinator_engagement now derives a
//   last_active_utc from real activity (coordinator_activity_log,
//   coordinator_daily_metrics, auth_tracker, intake_referrals,
//   scheduled_visits). This component reads the new fields:
//     - days_inactive_local : calendar-day staleness in coordinator's
//                             home_timezone (the field to flag on)
//     - last_active_local   : timestamp in coordinator's TZ
//     - last_active_et      : same moment in America/New_York (for Carla)
//     - home_timezone       : Asia/Manila for PH staff, ET for US staff
//
// Stale threshold: 3+ local calendar days. That's >2 business days
// after a weekend.
//
// CLAUDE.md compliance: ASCII only in JSX text.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

const STALE_DAYS = 3; // > 2 business days

// Format a UTC timestamp into "MMM D, h:mm A" in a given IANA timezone.
function fmtInTZ(utcString, tz) {
  if (!utcString) return null;
  try {
    const d = new Date(utcString);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch (e) {
    return null;
  }
}

// Short timezone label for display: "Manila" / "ET"
function tzShort(tz) {
  if (!tz) return '';
  if (tz === 'Asia/Manila') return 'Manila';
  if (tz === 'America/New_York') return 'ET';
  // generic fallback
  return tz.split('/').pop().replace(/_/g, ' ');
}

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
      // Prefer the local-calendar-day field. Fall back to days_inactive
      // (UTC, fractional) and finally to days_since_last_login for safety.
      .map(r => ({
        ...r,
        _stale_days:
          r.days_inactive_local != null ? r.days_inactive_local
          : r.days_inactive != null ? Math.floor(Number(r.days_inactive))
          : r.days_since_last_login,
      }))
      .filter(r => r._stale_days === null || r._stale_days >= STALE_DAYS)
      .sort((a, b) => (b._stale_days ?? 9999) - (a._stale_days ?? 9999));
  }, [rows]);

  if (loading) return null;
  if (stale.length === 0) return null;

  const worst = stale[0];
  const worstLastLocal = fmtInTZ(worst.last_active_utc, worst.home_timezone || 'Asia/Manila');
  const worstLastET = fmtInTZ(worst.last_active_utc, 'America/New_York');
  const worstTzShort = tzShort(worst.home_timezone || 'Asia/Manila');
  const worstLabel = worst._stale_days === null
    ? worst.full_name + ': no recorded activity'
    : worst.full_name + ': ' + worst._stale_days + 'd quiet'
      + (worstLastLocal ? ' (last seen ' + worstLastLocal + ' ' + worstTzShort
          + (worstLastET && worst.home_timezone !== 'America/New_York' ? ' / ' + worstLastET + ' ET' : '')
          + ')'
        : '');

  return (
    <div
      style={{
        padding: '12px 20px',
        background: '#FEF2F2',
        borderBottom: '1px solid #FCA5A5',
        color: '#7F1D1D',
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
        cursor: onNavigate ? 'pointer' : 'default',
      }}
      onClick={onNavigate ? () => onNavigate() : undefined}
      title="Click to see the full engagement list"
    >
      <span style={{ fontSize: 20 }}>!</span>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          {stale.length} coordinator{stale.length === 1 ? '' : 's'} quiet {'>'} {STALE_DAYS - 1} business day{STALE_DAYS - 1 === 1 ? '' : 's'}
        </div>
        <div style={{ fontSize: 11, marginTop: 2, color: '#991B1B' }}>
          Worst: {worstLabel}. Stale = no activity in coordinator local time. Click to see the full list.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {stale.slice(0, 5).map(s => {
          const lastLocal = fmtInTZ(s.last_active_utc, s.home_timezone || 'Asia/Manila');
          const lastET = fmtInTZ(s.last_active_utc, 'America/New_York');
          const tzs = tzShort(s.home_timezone || 'Asia/Manila');
          const tip = lastLocal
            ? 'Last active: ' + lastLocal + ' ' + tzs
              + (lastET && s.home_timezone !== 'America/New_York' ? ' / ' + lastET + ' ET' : '')
            : 'No recorded activity';
          return (
            <span
              key={s.coordinator_id}
              title={tip}
              style={{
                fontSize: 10, fontWeight: 700,
                background: s._stale_days >= 14 ? '#DC2626' : '#9A3412',
                color: '#fff',
                padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap',
              }}
            >
              {s.full_name.split(' ')[0]} {s._stale_days === null ? 'no data' : (s._stale_days + 'd')}
            </span>
          );
        })}
        {stale.length > 5 && (
          <span style={{ fontSize: 10, color: '#7F1D1D', padding: '3px 8px' }}>
            +{stale.length - 5} more
          </span>
        )}
      </div>
    </div>
  );
}
