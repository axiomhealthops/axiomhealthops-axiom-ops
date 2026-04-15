// useAssignedRegions.js
//
// Centralized region-scoping logic. Every data-loading page should call
// this hook and apply the returned `regions` filter to its queries so
// coordinators only see data for regions they're assigned to.
//
// Rules (per Liam, 2026-04-15):
//   * super_admin  → all regions (no filter). Returned regions = null.
//   * admin        → filter by profile.regions array (admins are seeded
//                    with all 11 regions; if trimmed, they scope to that
//                    subset).
//   * regional_manager / care_coordinator / intake_coordinator /
//     auth_coordinator / assoc_director / clinician / telehealth /
//     pod_leader / team_member → filter by profile.regions.
//   * Empty or null regions array on a non-super_admin user → FAIL CLOSED
//     (user sees nothing). This is intentional — a misconfigured user
//     should not leak cross-region data. Fix by assigning regions in
//     User Management.
//
// Helpers:
//   scopeList(rows, getRegion?) — filters an array by allowed regions.
//     `getRegion` defaults to r => r.region. Pass a custom extractor if
//     the region field lives at a different path.
//   applyToQuery(query, column?) — applies .in(column, regions) to a
//     Supabase query builder. `column` defaults to 'region'. Returns the
//     query unchanged if user has all-access.
//   isInScope(region) — boolean check for a single region value.

import { useMemo } from 'react';
import { useAuth } from './useAuth';

export function useAssignedRegions() {
  const { profile, loading } = useAuth();

  const result = useMemo(() => {
    // Still loading profile → no regions yet, treat as empty
    if (loading || !profile) {
      return { regions: [], isAllAccess: false, loading: true };
    }

    // Super admin sees everything. Returned regions = null sentinel.
    if (profile.role === 'super_admin') {
      return { regions: null, isAllAccess: true, loading: false };
    }

    // Everyone else scopes to their assigned regions. Fail closed when
    // the array is missing or empty.
    const regions = Array.isArray(profile.regions) ? profile.regions.filter(Boolean) : [];
    return {
      regions,
      isAllAccess: false,
      loading: false,
    };
  }, [profile, loading]);

  // Client-side filter helper. Works for any array of objects with a
  // `.region` field (or pass a custom extractor).
  function scopeList(rows, getRegion = r => r?.region) {
    if (!rows) return rows;
    if (result.isAllAccess) return rows;
    if (!result.regions || result.regions.length === 0) return [];
    const allowed = new Set(result.regions);
    return rows.filter(r => allowed.has(getRegion(r)));
  }

  // Server-side filter helper. Apply to a Supabase query *before* .select()
  // is awaited. No-op for all-access users.
  function applyToQuery(query, column = 'region') {
    if (result.isAllAccess) return query;
    if (!result.regions || result.regions.length === 0) {
      // Force an empty result set rather than silently returning everything.
      return query.in(column, ['__NONE__']);
    }
    return query.in(column, result.regions);
  }

  function isInScope(region) {
    if (result.isAllAccess) return true;
    if (!result.regions || result.regions.length === 0) return false;
    return result.regions.includes(region);
  }

  return {
    ...result,
    scopeList,
    applyToQuery,
    isInScope,
  };
}
