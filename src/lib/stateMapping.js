// =====================================================================
// stateMapping.js
//
// Region letter → US state mapping, sourced from marketing_territories.
//
// CONTEXT
// EdemaCare's operational tables (census_data, visit_schedule_data,
// auth_tracker, intake_referrals) all key off single-letter region codes
// (A, B, C, G, H, J, M, N, T, V). The marketing_territories table is the
// canonical source of truth that ties each letter to a state (FL/GA).
//
// As of 2026-05-31:
//   - All 10 legacy region letters → FL via 7 FL territories.
//   - 1 Georgia Territory exists but has zero legacy_region_letters
//     assigned. Operational tables have zero GA rows.
//   - The expansion roadmap (constants.js:EXPANSION) lists GA targeting
//     May 2026, 60% credentialed, 2 staff hired.
//
// WHY A HOOK
// The mapping is fetched live at dashboard mount so that the moment ops
// adds a region letter to the Georgia Territory row, the toggle starts
// reflecting real GA data without a code change.
//
// STATIC FALLBACK
// A hardcoded fallback is exported for callers that need a synchronous
// map (component init, query helpers that run before supabase resolves).
// It reflects the marketing_territories state at the time this file was
// authored — if/when GA gets letters, the live fetch overrides it.
// =====================================================================

import { useState, useEffect } from 'react';
import { supabase } from './supabase';

// ── Canonical states we care about today ─────────────────────────────
export const SUPPORTED_STATES = ['FL', 'GA'];

// ── Static fallback map (current state of marketing_territories) ─────
// Used when the live fetch hasn't completed yet or fails. Keep in sync
// with the marketing_territories table — but the hook will override
// this with live data, so the fallback is only a brief-window safety net.
export const REGION_TO_STATE_STATIC = {
  A: 'FL', B: 'FL', C: 'FL', G: 'FL', H: 'FL',
  J: 'FL', M: 'FL', N: 'FL', T: 'FL', V: 'FL',
};

// ── State → region letters reverse map (static fallback) ─────────────
export const STATE_TO_REGIONS_STATIC = {
  FL: ['A', 'B', 'C', 'G', 'H', 'J', 'M', 'N', 'T', 'V'],
  GA: [],
};

/**
 * Pull marketing_territories and build the live region→state map.
 * Returns { regionToState, stateToRegions, territories }.
 * On error, returns the static fallback so the dashboard never crashes.
 */
export async function fetchRegionToState() {
  try {
    const { data, error } = await supabase
      .from('marketing_territories')
      .select('id, name, state, legacy_region_letters, is_active');
    if (error || !data) {
      return {
        regionToState: { ...REGION_TO_STATE_STATIC },
        stateToRegions: deepClone(STATE_TO_REGIONS_STATIC),
        territories: [],
      };
    }
    const regionToState = {};
    const stateToRegions = { FL: [], GA: [] };
    data.forEach(function (row) {
      if (!row.is_active) return;
      const st = row.state;
      if (!stateToRegions[st]) stateToRegions[st] = [];
      (row.legacy_region_letters || []).forEach(function (letter) {
        regionToState[letter] = st;
        if (!stateToRegions[st].includes(letter)) stateToRegions[st].push(letter);
      });
    });
    // Defensive: if a state ended up empty AND it's in the static map,
    // keep the static letters so the page doesn't silently lose regions.
    SUPPORTED_STATES.forEach(function (st) {
      if (!stateToRegions[st] || stateToRegions[st].length === 0) {
        stateToRegions[st] = STATE_TO_REGIONS_STATIC[st] ? [...STATE_TO_REGIONS_STATIC[st]] : [];
        (STATE_TO_REGIONS_STATIC[st] || []).forEach(function (l) {
          if (!regionToState[l]) regionToState[l] = st;
        });
      }
    });
    return { regionToState, stateToRegions, territories: data };
  } catch (e) {
    return {
      regionToState: { ...REGION_TO_STATE_STATIC },
      stateToRegions: deepClone(STATE_TO_REGIONS_STATIC),
      territories: [],
    };
  }
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

/**
 * React hook — fetches mapping once on mount, returns it plus a loading flag.
 * Static fallback is returned immediately so the dashboard never has to
 * render a "loading regions" intermediate state.
 */
export function useStateMapping() {
  const [mapping, setMapping] = useState({
    regionToState: { ...REGION_TO_STATE_STATIC },
    stateToRegions: deepClone(STATE_TO_REGIONS_STATIC),
    territories: [],
    loaded: false,
  });
  useEffect(function () {
    let cancelled = false;
    fetchRegionToState().then(function (m) {
      if (cancelled) return;
      setMapping({ ...m, loaded: true });
    });
    return function () { cancelled = true; };
  }, []);
  return mapping;
}

/**
 * Given a state code ('FL' | 'GA' | 'ALL') and a mapping, return the list
 * of region letters that the state covers. 'ALL' returns the union.
 */
export function getRegionsForState(stateFilter, stateToRegions) {
  if (!stateFilter || stateFilter === 'ALL') {
    const all = [];
    Object.values(stateToRegions || STATE_TO_REGIONS_STATIC).forEach(function (arr) {
      (arr || []).forEach(function (r) { if (!all.includes(r)) all.push(r); });
    });
    return all;
  }
  return (stateToRegions || STATE_TO_REGIONS_STATIC)[stateFilter] || [];
}

/**
 * Returns true if `region` belongs to the active state filter.
 * Used for client-side filtering when a query already pulled all regions.
 */
export function regionMatchesState(region, stateFilter, regionToState) {
  if (!stateFilter || stateFilter === 'ALL') return true;
  const map = regionToState || REGION_TO_STATE_STATIC;
  return map[region] === stateFilter;
}

/**
 * Persist the active state filter to localStorage so a refresh keeps the
 * CEO's selection. Mirrors the WeekSelector persistence pattern.
 */
const STATE_STORAGE_PREFIX = 'edemacare_statefilter_';

export function readPersistedState(storageKey, fallback = 'ALL') {
  if (!storageKey) return fallback;
  try {
    const raw = window.localStorage.getItem(STATE_STORAGE_PREFIX + storageKey);
    if (!raw) return fallback;
    if (raw === 'ALL' || raw === 'FL' || raw === 'GA') return raw;
    return fallback;
  } catch (e) {
    return fallback;
  }
}

export function persistState(storageKey, value) {
  if (!storageKey) return;
  try {
    window.localStorage.setItem(STATE_STORAGE_PREFIX + storageKey, value || 'ALL');
  } catch (e) {
    // private mode / quota — ignore
  }
}
