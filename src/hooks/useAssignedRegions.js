// useAssignedRegions.js
//
// Centralized region-scoping logic. Every data-loading page should call
// this hook and apply the returned `regions` filter to its queries so
// coordinators only see data for regions they're assigned to.
//
// Rules (per Liam, 2026-04-15; updated 2026-06-30):
//   * super_admin     → all regions (no filter). Returned regions = null.
//   * assoc_director  → all regions (no filter). ADs cover specific
//                       territories via coordinators.regions, but per Liam
//                       2026-06-30 they need cross-territory visibility for
//                       situational awareness and to cover for each other
//                       (e.g., Samantha acting for G, Ariel acting for H/J,
//                       Earl as Supply Chain AD covering all regions). The
//                       regions array still drives "you are the AD for X"
//                       assignment displays — only the data visibility gate
//                       is lifted.
//   * admin           → filter by profile.regions array (admins are seeded
//                       with all 11 regions; if trimmed, they scope to that
//                       subset).
//   * regional_manager / care_coordinator / intake_coordinator /
//     auth_coordinator / clinician / telehealth /
//     pod_leader / team_member → filter by profile.regions.
//   * Empty or null regions array on a non-all-access user → FAIL CLOSED
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

    // All-access roles see everything across regions. Returned regions = null sentinel.
    // assoc_director is included per Liam 2026-06-30: ADs need cross-territory
    // visibility even though they oversee specific territories.
    if (profile.role === 'super_admin' || profile.role === 'assoc_director') {
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
