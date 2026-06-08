// =====================================================================
// useCoordinatorEngagement.js
//
// Single source of truth for "is coordinator X actually active in the
// system right now?" — replaces the fragile pattern of N pages each
// checking `coordinator_activity_log` (or worse, `auth.users.last_sign_in_at`)
// directly.
//
// BACKSTORY (2026-06-08):
//   This bug has now appeared on THREE separate pages:
//     - Carla's Ops Manager engagement banner (May 2026): fixed to use
//       v_coordinator_engagement.
//     - Director Command's Live Exception Feed INACTIVE_COORDINATOR check
//       (June 8, 2026): was still using `coordinator_activity_log` only,
//       flagging the same 8 coordinators Liam flagged in May — Gerilyn,
//       Mary, April, Audrey, Gypsy, Kiarra, Ethel, Jhon — even though
//       all 8 had logged 50+ activity rows in the last 24 hours.
//     - Manager Scorecards response_latency: managers (Carla, Hervylie,
//       Samantha, Ariel, Lia) don't typically write to activity_log so
//       it shows N/A — even when they're actively touching auth_tracker
//       and care_coord_notes.
//
//   Root cause: engagement signal logic was duplicated across components,
//   each using a subset of the available data sources. The DB-side
//   `v_coordinator_engagement` view checks SIX sources
//   (coordinator_activity_log, coordinator_daily_metrics, auth_tracker,
//   patient_notes, care_coord_notes, auth.users.last_sign_in_at) and
//   takes MAX. The RPC `get_coordinator_engagement` wraps it with a role
//   check (director/admin/ceo/assoc_director only) and returns the rows.
//
//   This hook fetches that RPC once and returns a Map keyed by full_name
//   (lowercased) so any page can look up a coordinator's true last-active
//   timestamp with one call. NEW PAGES MUST USE THIS HOOK INSTEAD OF
//   ROLLING THEIR OWN ENGAGEMENT LOGIC.
// =====================================================================

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * @returns {{
 *   engagementMap: Map<string, {
 *     full_name: string,
 *     role: string,
 *     last_active_utc: string|null,
 *     last_sign_in_at: string|null,
 *     days_inactive: number|null,
 *     days_inactive_local: number|null,
 *     home_timezone: string,
 *   }>,
 *   rows: Array<object>,
 *   loading: boolean,
 *   reload: () => Promise<void>,
 * }}
 *
 * USAGE:
 *   const { engagementMap, loading } = useCoordinatorEngagement();
 *   const lastActive = engagementMap.get(coordinator.full_name.toLowerCase())?.last_active_utc;
 *   const hoursInactive = lastActive
 *     ? Math.round((Date.now() - new Date(lastActive).getTime()) / 3600000)
 *     : Infinity;
 *
 * NOTE: the Map is keyed by LOWERCASE full_name so case mismatches in
 * activity_log don't cause false-positive "inactive" flags.
 */
export function useCoordinatorEngagement() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_coordinator_engagement');
    if (error) {
      console.warn('[useCoordinatorEngagement] RPC failed:', error.message);
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Build a case-insensitive Map for O(1) lookup by full_name.
  const engagementMap = new Map();
  (rows || []).forEach(function(r) {
    if (r && r.full_name) {
      engagementMap.set(r.full_name.toLowerCase().trim(), r);
    }
  });

  return { engagementMap, rows, loading, reload: load };
}

/**
 * Convenience: given an engagementMap and a full_name, return the hours
 * since the coordinator was last active (across all 6 signals). Returns
 * Infinity if the coordinator isn't in the map (e.g. not a coordinator,
 * or RPC failed). This is the exact predicate ExceptionFeed and the
 * Manager Scorecards should use.
 */
export function hoursInactiveFromEngagement(engagementMap, fullName) {
  if (!engagementMap || !fullName) return Infinity;
  const e = engagementMap.get((fullName || '').toLowerCase().trim());
  if (!e || !e.last_active_utc) return Infinity;
  return Math.round((Date.now() - new Date(e.last_active_utc).getTime()) / 3600000);
}
