// =====================================================================
// WeekSelector.jsx
//
// Sun-Sat work-week picker. Built 2026-05-31 for Director Command so Liam
// can toggle between weeks to see growth trends. Reusable — designed to
// drop into any dashboard that filters by `getWeekRange(date, weeksOffset)`.
//
// CONTRACT
//   Props:
//     value       — weeks offset from THIS week. 0 = current, 1 = last,
//                   -1 = next week (disabled by default). String or number ok.
//     onChange(n) — called with new integer weeks offset
//     storageKey  — optional. If provided, last-viewed offset is persisted
//                   to localStorage[storageKey] so refreshing the page keeps
//                   you on the week you were investigating. Default: null.
//     allowFuture — bool. Default false. Future weeks are hidden behind a
//                   disabled-next-button so a coordinator can't accidentally
//                   pull projections that aren't real revenue yet.
//
// VISUAL: compact pill row — [‹ Prev]  [May 24 – May 30, 2026]  [Next ›]
//         with a tiny "Today" button when offset ≠ 0. On mobile, the date
//         label collapses to the start date only (e.g. "May 24").
//
// WHY SUN-SAT: EdemaCare's work week is Sun-Sat. We delegate ALL date math
// to getWeekRange(date, weeksOffset) from dateUtils so it can never drift
// from the rest of the dashboards.
// =====================================================================

import { useCallback, useMemo } from 'react';
import { getWeekRange } from '../lib/dateUtils';

const DEFAULT_STORAGE_PREFIX = 'edemacare_weekselector_';

/**
 * Read last-viewed week offset from localStorage. Safe on SSR / locked-down
 * browsers — returns 0 on any error.
 */
export function readPersistedWeekOffset(storageKey) {
  if (!storageKey) return 0;
  try {
    const raw = window.localStorage.getItem(DEFAULT_STORAGE_PREFIX + storageKey);
    if (raw === null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    return 0;
  }
}

function persistWeekOffset(storageKey, offset) {
  if (!storageKey) return;
  try {
    window.localStorage.setItem(DEFAULT_STORAGE_PREFIX + storageKey, String(offset));
  } catch (e) {
    // ignore — private mode, full quota, etc.
  }
}

export default function WeekSelector({
  value = 0,
  onChange,
  storageKey = null,
  allowFuture = false,
  compact = false,
}) {
  const offset = Number.isFinite(parseInt(value, 10)) ? parseInt(value, 10) : 0;

  const range = useMemo(function() { return getWeekRange(new Date(), offset); }, [offset]);
  const isThisWeek = offset === 0;
  const isFuture = offset < 0;

  // Label: full on desktop, start-date-only on compact/mobile
  const label = compact
    ? range.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : range.label;

  const setOffset = useCallback(function(n) {
    if (!allowFuture && n < 0) return;
    persistWeekOffset(storageKey, n);
    if (typeof onChange === 'function') onChange(n);
  }, [allowFuture, storageKey, onChange]);

  const goPrev = useCallback(function() { setOffset(offset + 1); }, [offset, setOffset]);
  const goNext = useCallback(function() { setOffset(offset - 1); }, [offset, setOffset]);
  const goToday = useCallback(function() { setOffset(0); }, [setOffset]);

  // ── Date jump: pick any Sunday → compute offset ───────────────────────
  // We accept any date and snap to its containing Sun-Sat week. Future weeks
  // are clamped to today if allowFuture=false.
  const onDatePick = useCallback(function(e) {
    const v = e.target.value;
    if (!v) return;
    const picked = new Date(v + 'T00:00:00');
    if (isNaN(picked.getTime())) return;
    const pickedStart = getWeekRange(picked, 0).start;
    const todayStart = getWeekRange(new Date(), 0).start;
    const diffWeeks = Math.round((todayStart.getTime() - pickedStart.getTime()) / (7 * 86400000));
    setOffset(allowFuture ? diffWeeks : Math.max(0, diffWeeks));
  }, [setOffset, allowFuture]);

  // Style helpers — keep this self-contained so it works in any dashboard
  // without needing the consumer to wire up CSS.
  const pillButtonStyle = {
    background: '#fff',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 600,
    color: '#0F1117',
    cursor: 'pointer',
    transition: 'background 0.1s ease',
  };
  const disabledStyle = {
    opacity: 0.4,
    cursor: 'not-allowed',
  };

  return (
    <div
      role="group"
      aria-label="Week selector"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '4px',
      }}
    >
      <button
        type="button"
        onClick={goPrev}
        style={pillButtonStyle}
        aria-label="Previous week"
        title="Previous week"
      >
        {'‹ Prev'}
      </button>

      <div
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '4px 12px',
          minWidth: compact ? 90 : 170,
          textAlign: 'center',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: '#0F1117', fontFamily: 'DM Mono, monospace' }}>
          {label}
        </span>
        <span style={{ fontSize: 9, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 1 }}>
          {isThisWeek ? 'This week' : isFuture ? 'Future week' : (offset === 1 ? 'Last week' : offset + ' weeks ago')}
        </span>
      </div>

      <button
        type="button"
        onClick={goNext}
        style={Object.assign({}, pillButtonStyle, (!allowFuture && offset <= 0) ? disabledStyle : {})}
        disabled={!allowFuture && offset <= 0}
        aria-label="Next week"
        title={(!allowFuture && offset <= 0) ? 'Cannot view future weeks' : 'Next week'}
      >
        {'Next ›'}
      </button>

      {!isThisWeek && (
        <button
          type="button"
          onClick={goToday}
          style={Object.assign({}, pillButtonStyle, {
            background: '#0F1117', color: '#fff', borderColor: '#0F1117',
          })}
          aria-label="Jump to this week"
          title="Jump to this week"
        >
          Today
        </button>
      )}

      {/* Date picker: jump to any week by clicking any date in it. We expose
          the native <input type="date"> rather than a custom one so we don't
          pull in a calendar dep and so it's friendly on mobile. */}
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          fontSize: 11,
          color: 'var(--gray)',
          cursor: 'pointer',
        }}
        title="Jump to any week"
      >
        <span aria-hidden="true">{'\u{1F4C5}'}</span>
        <input
          type="date"
          value={range.startStr}
          onChange={onDatePick}
          style={{
            border: 'none',
            background: 'transparent',
            fontSize: 11,
            color: 'var(--gray)',
            cursor: 'pointer',
            padding: 0,
            width: compact ? 105 : 130,
          }}
        />
      </label>
    </div>
  );
}
