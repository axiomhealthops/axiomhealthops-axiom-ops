// =====================================================================
// StateToggle.jsx
//
// FL/GA/All state filter pill, modeled on WeekSelector. Built 2026-05-31
// for the Director Command CEO redesign.
//
// HIDDEN-BY-DEFAULT BEHAVIOR
// Per Liam's directive: the toggle UI control auto-hides until Georgia
// has ≥10 active patients in operational tables. Until then, the page
// behaves exactly as if the toggle were set to 'ALL', and no executive
// ever sees an empty "GA" tab — which would otherwise broadcast that
// expansion is further along than it is.
//
// The component renders `null` when the visibility check fails. The
// parent dashboard simply passes through and behaves as it does today.
//
// CONTRACT
//   Props:
//     value         — 'ALL' | 'FL' | 'GA'
//     onChange(v)   — called with new value
//     storageKey    — optional. Persists value to localStorage[...storageKey]
//     stateToRegions — map from useStateMapping(), used to compute GA letters
//     minGAPatients — threshold for showing the toggle (default 10)
//
// VISIBILITY CHECK
// On mount, queries census_data for active-status patients in any region
// the mapping says belongs to GA. If the count is below threshold, the
// component renders null. Re-runs cheaply on stateToRegions change.
// =====================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { persistState } from '../lib/stateMapping';

const SUPPORTED = ['ALL', 'FL', 'GA'];

export default function StateToggle({
  value = 'ALL',
  onChange,
  storageKey = null,
  stateToRegions = null,
  minGAPatients = 10,
}) {
  const [shouldShow, setShouldShow] = useState(false);
  const [checking, setChecking] = useState(true);

  const gaRegions = useMemo(function () {
    return (stateToRegions && stateToRegions.GA) || [];
  }, [stateToRegions]);

  // Visibility gate: count active GA patients. If <10 → hide the control.
  useEffect(function () {
    let cancelled = false;
    async function check() {
      // If GA has no region letters mapped yet, no patients can match.
      // Skip the round-trip and stay hidden.
      if (!gaRegions || gaRegions.length === 0) {
        if (!cancelled) { setShouldShow(false); setChecking(false); }
        return;
      }
      try {
        const { count, error } = await supabase
          .from('census_data')
          .select('*', { count: 'exact', head: true })
          .ilike('status', '%active%')
          .in('region', gaRegions);
        if (cancelled) return;
        if (error) { setShouldShow(false); setChecking(false); return; }
        setShouldShow((count || 0) >= minGAPatients);
        setChecking(false);
      } catch (e) {
        if (!cancelled) { setShouldShow(false); setChecking(false); }
      }
    }
    check();
    return function () { cancelled = true; };
  }, [gaRegions, minGAPatients]);

  const setValue = useCallback(function (v) {
    if (!SUPPORTED.includes(v)) return;
    persistState(storageKey, v);
    if (typeof onChange === 'function') onChange(v);
  }, [storageKey, onChange]);

  // While checking — and on the very first paint — render nothing so the
  // page doesn't flash a control then yank it away.
  if (checking || !shouldShow) return null;

  return (
    <div
      role="group"
      aria-label="State filter"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0,
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 3,
      }}
    >
      {SUPPORTED.map(function (s, idx) {
        const active = value === s;
        return (
          <button
            key={s}
            type="button"
            onClick={function () { setValue(s); }}
            aria-pressed={active}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 700,
              border: 'none',
              background: active ? '#0F1117' : 'transparent',
              color: active ? '#fff' : 'var(--gray)',
              borderRadius: 7,
              cursor: 'pointer',
              transition: 'background 0.1s ease, color 0.1s ease',
              fontFamily: idx === 0 ? 'inherit' : 'DM Mono, monospace',
            }}
            title={s === 'ALL' ? 'All states' : s === 'FL' ? 'Florida only' : 'Georgia only'}
          >
            {s === 'ALL' ? 'All' : s}
          </button>
        );
      })}
    </div>
  );
}
