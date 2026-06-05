// =====================================================================
// PeriodSelector.jsx
//
// Mode-aware period picker — Week (Sun-Sat) / Month / Quarter / YTD.
// Built 2026-06-05 for the Payer + Marketing Report (Yvonne Flores).
// Designed to drop into any dashboard that filters by getPeriodRange().
//
// CONTRACT
//   Props:
//     mode        — 'week' | 'month' | 'quarter' | 'ytd'
//     anchor      — YYYY-MM-DD string for the window the user picked.
//                   The component snaps to the period containing this date.
//     onChange({mode, anchor}) — called with new selection.
//     storageKey  — optional. Persists {mode, anchor} to localStorage.
//     allowFuture — bool. Default false. Future periods are blocked from
//                   the Next button so the user can't see un-real data.
//
// NOTES
//   Section 2 (census MoM) is monthly-only — that page should hide the
//   mode toggle and lock to 'month'. See `lockMode` prop.
// =====================================================================

import { useCallback, useMemo } from 'react';
import { getPeriodRange, toDateStr } from '../lib/dateUtils';

const STORAGE_PREFIX = 'edemacare_periodselector_';

const MODES = [
  { key: 'week',    label: 'Week'    },
  { key: 'month',   label: 'Month'   },
  { key: 'quarter', label: 'Quarter' },
  { key: 'ytd',     label: 'YTD'     },
];

/** Read persisted {mode, anchor} from localStorage. Safe on SSR / locked browsers. */
export function readPersistedPeriod(storageKey, fallback) {
  const f = fallback || { mode: 'month', anchor: toDateStr(new Date()) };
  if (!storageKey) return f;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (!raw) return f;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return f;
    if (!['week','month','quarter','ytd'].includes(parsed.mode)) return f;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.anchor || '')) return f;
    return parsed;
  } catch (e) {
    return f;
  }
}

function persistPeriod(storageKey, value) {
  if (!storageKey) return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(value));
  } catch (e) {
    // ignore
  }
}

function shiftAnchor(anchor, mode, deltaPeriods) {
  // Move the anchor by N periods of the given mode. delta=-1 = previous period.
  const d = new Date(anchor + 'T00:00:00');
  if (mode === 'week') {
    d.setDate(d.getDate() + 7 * deltaPeriods);
  } else if (mode === 'month') {
    d.setMonth(d.getMonth() + deltaPeriods);
  } else if (mode === 'quarter') {
    d.setMonth(d.getMonth() + 3 * deltaPeriods);
  } else if (mode === 'ytd') {
    d.setFullYear(d.getFullYear() + deltaPeriods);
  }
  return toDateStr(d);
}

export default function PeriodSelector({
  mode = 'month',
  anchor = toDateStr(new Date()),
  onChange,
  storageKey = null,
  lockMode = false,
  allowFuture = false,
}) {
  const range = useMemo(function() { return getPeriodRange(mode, anchor); }, [mode, anchor]);

  // Detect if `range` overlaps a future period (i.e. range.end > today)
  const isFuture = useMemo(function() {
    const today = new Date(); today.setHours(0,0,0,0);
    return range.start.getTime() > today.getTime();
  }, [range]);

  const setMode = useCallback(function(nextMode) {
    if (lockMode || nextMode === mode) return;
    const next = { mode: nextMode, anchor };
    persistPeriod(storageKey, next);
    if (typeof onChange === 'function') onChange(next);
  }, [lockMode, mode, anchor, storageKey, onChange]);

  const setAnchor = useCallback(function(nextAnchor) {
    const next = { mode, anchor: nextAnchor };
    persistPeriod(storageKey, next);
    if (typeof onChange === 'function') onChange(next);
  }, [mode, storageKey, onChange]);

  const goPrev = useCallback(function() { setAnchor(shiftAnchor(anchor, mode, -1)); }, [anchor, mode, setAnchor]);
  const goNext = useCallback(function() {
    const nextAnchor = shiftAnchor(anchor, mode, +1);
    if (!allowFuture) {
      // Block if the new period would start after today
      const tentative = getPeriodRange(mode, nextAnchor);
      const today = new Date(); today.setHours(0,0,0,0);
      if (tentative.start.getTime() > today.getTime()) return;
    }
    setAnchor(nextAnchor);
  }, [anchor, mode, allowFuture, setAnchor]);
  const goToday = useCallback(function() { setAnchor(toDateStr(new Date())); }, [setAnchor]);

  const pillButtonStyle = {
    background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
    padding: '6px 10px', fontSize: 12, fontWeight: 600, color: '#0F1117',
    cursor: 'pointer', transition: 'background 0.1s ease',
  };
  const disabledStyle = { opacity: 0.4, cursor: 'not-allowed' };
  const modeBtn = (active) => ({
    background: active ? '#0F1117' : '#fff',
    color: active ? '#fff' : '#0F1117',
    border: '1px solid ' + (active ? '#0F1117' : 'var(--border)'),
    borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700,
    cursor: lockMode ? 'not-allowed' : 'pointer', letterSpacing: '0.04em',
  });

  return (
    <div role="group" aria-label="Period selector"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        background: 'var(--card-bg)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 4 }}>
      {/* Mode toggle */}
      {!lockMode && (
        <div style={{ display: 'inline-flex', gap: 4, padding: 2 }}>
          {MODES.map(m => (
            <button key={m.key} type="button" onClick={() => setMode(m.key)}
              style={modeBtn(mode === m.key)} disabled={lockMode}>
              {m.label}
            </button>
          ))}
        </div>
      )}

      <button type="button" onClick={goPrev} style={pillButtonStyle}
        aria-label="Previous period" title="Previous period">
        {'‹ Prev'}
      </button>

      <div style={{ display: 'inline-flex', flexDirection: 'column',
        alignItems: 'center', padding: '4px 12px', minWidth: 130, textAlign: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#0F1117', fontFamily: 'DM Mono, monospace' }}>
          {range.label}
        </span>
        <span style={{ fontSize: 9, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 1 }}>
          {mode === 'week' ? 'Sun–Sat' : mode === 'ytd' ? (range.label.endsWith('YTD') ? 'Through today' : 'Full year') : mode}
        </span>
      </div>

      <button type="button" onClick={goNext}
        style={Object.assign({}, pillButtonStyle, (!allowFuture && isFuture) ? disabledStyle : {})}
        disabled={!allowFuture && isFuture}
        aria-label="Next period" title={(!allowFuture && isFuture) ? 'Cannot view future periods' : 'Next period'}>
        {'Next ›'}
      </button>

      <button type="button" onClick={goToday}
        style={Object.assign({}, pillButtonStyle, { background: '#0F1117', color: '#fff', borderColor: '#0F1117' })}
        title="Jump to today">
        Today
      </button>
    </div>
  );
}
