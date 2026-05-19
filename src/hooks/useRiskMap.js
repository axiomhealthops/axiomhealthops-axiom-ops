// useRiskMap.js
//
// Provides a cached lookup of high-risk patients from patient_risk_factors,
// keyed by lowercased patient_name (region is appended when known) so any
// page that displays patient names can render a small risk badge without
// duplicating the fetch.
//
// The patient_risk_factors table is tiny (currently 186 rows) — we fetch
// it once per mount and listen for realtime updates. If usage grows, swap
// in a global context provider so the table is fetched once per session.
//
// Returned API:
//   risk.loading            — true until first fetch resolves
//   risk.byKey              — Map<string, profile> keyed by name+region
//   risk.byName             — Map<string, profile> keyed by name only (last writer wins)
//   risk.get(name, region?) — returns the profile or null
//   risk.isHigh(name, r?)   — true if LOC 4 or 5
//   risk.locOf(name, r?)    — numeric LOC level or null
//
// Risk profile shape (subset of patient_risk_factors columns):
//   { id, patient_name, region, loc_level, caremap_score,
//     has_wounds, comorbidities_3plus, falls_6mo,
//     high_compliance_risk, high_environmental_risk, comments }

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, fetchAllPages } from '../lib/supabase';
import { useRealtimeTable } from './useRealtimeTable';

function normName(s) {
  return (s || '').trim().toLowerCase();
}

function makeKey(name, region) {
  return `${normName(name)}::${(region || '').toUpperCase()}`;
}

export function useRiskMap() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await fetchAllPages(
      supabase
        .from('patient_risk_factors')
        .select('id,patient_name,region,loc_level,caremap_score,has_wounds,comorbidities_3plus,falls_6mo,high_compliance_risk,high_environmental_risk,comments')
    );
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable(['patient_risk_factors'], load);

  const indexed = useMemo(() => {
    const byKey = new Map();
    const byName = new Map();
    for (const r of rows) {
      byKey.set(makeKey(r.patient_name, r.region), r);
      byName.set(normName(r.patient_name), r);
    }
    return { byKey, byName };
  }, [rows]);

  function get(name, region) {
    if (!name) return null;
    if (region) {
      const v = indexed.byKey.get(makeKey(name, region));
      if (v) return v;
    }
    return indexed.byName.get(normName(name)) || null;
  }

  function locOf(name, region) {
    const p = get(name, region);
    return p ? (p.loc_level ?? null) : null;
  }

  function isHigh(name, region) {
    const loc = locOf(name, region);
    return loc === 4 || loc === 5;
  }

  return {
    loading,
    byKey: indexed.byKey,
    byName: indexed.byName,
    get, locOf, isHigh,
    rows,
  };
}
