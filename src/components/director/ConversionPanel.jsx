import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  transitionsInRange, measureAllConversions, pairMatrix, conversionExportRows,
} from '../../lib/patientFlow';
import { getWeekRange } from '../../lib/dateUtils';

// =====================================================================
// ConversionPanel — "how many went from X to Y" (2026-07-23)
//
// Liam: "how many patients that were scheduled for evaluation were
// activated this week ... Same thing for how many patients went from SOC
// pending to auth pending by the end of the day, end of the week, etc."
//
// Each tile is a named transition with a DENOMINATOR, because the bare
// count is the misleading half of the story. Week of 2026-07-19:
// 5 patients went Eval Pending -> Active, but 16 left Eval Pending — so
// 11 leaked to Discharge or backwards, and the activation rate was 31%.
// "5 activated" reads like a slow week; "5 of 16" is a conversation.
//
// Weeks are Sun-Sat per project convention (see dateUtils).
// =====================================================================

const INK = '#0F172A';
const MUTED = '#64748B';
const GOOD = '#059669';
const WARN = '#D97706';
const BAD = '#DC2626';

const TEAM_ACCENT = { care_coord: '#06B6D4', auth: '#6366F1', clinical: GOOD };

function iso(d) { return d.toISOString().slice(0, 10); }

// Period options. "Today" means the latest day that actually has data —
// uploads are weekday-only, so on a Monday the newest data is Friday's.
function buildPeriods(latestDay) {
  const now = new Date();
  const thisWk = getWeekRange(now, 0);
  const lastWk = getWeekRange(now, 1);
  const d30 = new Date(now.getTime() - 30 * 86400000);
  return [
    { key: 'today', label: 'Latest day', start: latestDay, end: latestDay },
    { key: 'week', label: 'This week', start: thisWk.startStr, end: thisWk.endStr },
    { key: 'lastweek', label: 'Last week', start: lastWk.startStr, end: lastWk.endStr },
    { key: 'd30', label: 'Last 30 days', start: iso(d30), end: iso(now) },
  ];
}

function RateBadge({ rate }) {
  if (rate === null || rate === undefined) {
    return <span style={{ fontSize: 10, color: MUTED }}>no movement</span>;
  }
  const pct = Math.round(rate * 100);
  const color = pct >= 60 ? GOOD : pct >= 35 ? WARN : BAD;
  return (
    <span style={{ fontSize: 11, fontWeight: 800, fontFamily: 'DM Mono, monospace',
                   color, background: color + '18', borderRadius: 5, padding: '2px 6px' }}>
      {pct}%
    </span>
  );
}

function ConversionTile({ c, onOpen }) {
  const leaked = Math.max(0, c.leftSource - c.patients);
  return (
    <div
      onClick={() => onOpen(c)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(c); } }}
      title={`${c.label} — click for the patient list`}
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10,
               padding: '12px 14px', position: 'relative', overflow: 'hidden', cursor: 'pointer' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 3,
                    background: TEAM_ACCENT[c.team] || MUTED }} />
      <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase',
                    letterSpacing: '0.05em', marginBottom: 5 }}>
        {c.label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 28, fontWeight: 900, fontFamily: 'DM Mono, monospace',
                       lineHeight: 1, color: INK }}>
          {c.patients}
        </span>
        <span style={{ fontSize: 11, color: MUTED }}>of {c.leftSource} who left</span>
        <RateBadge rate={c.rate} />
      </div>
      <div style={{ fontSize: 10.5, color: MUTED, marginTop: 6, lineHeight: 1.4 }}>
        {c.blurb}
      </div>
      {leaked > 0 && (
        <div style={{ fontSize: 10.5, fontWeight: 700, color: BAD, background: '#FEF2F2',
                      borderRadius: 4, padding: '3px 6px', marginTop: 7 }}>
          {leaked} went elsewhere
        </div>
      )}
      {c.events > c.patients && (
        <div style={{ fontSize: 9.5, color: MUTED, marginTop: 5 }}>
          {c.events} events {'·'} some patients repeated this move
        </div>
      )}
    </div>
  );
}

export default function ConversionPanel({ statusLog, latestDay }) {
  const periods = useMemo(() => buildPeriods(latestDay), [latestDay]);
  const [periodKey, setPeriodKey] = useState('week');
  const [open, setOpen] = useState(null);      // a conversion, for the detail list
  const [showAll, setShowAll] = useState(false);

  const period = periods.find((p) => p.key === periodKey) || periods[1];

  const transitions = useMemo(
    () => transitionsInRange(statusLog, period.start, period.end),
    [statusLog, period.start, period.end]
  );
  const conversions = useMemo(() => measureAllConversions(transitions), [transitions]);
  const matrix = useMemo(() => pairMatrix(transitions), [transitions]);

  function exportXlsx() {
    const rows = conversionExportRows(transitions);
    const summary = conversions.map((c) => ({
      Conversion: c.label,
      Patients: c.patients,
      'Left Source Stage': c.leftSource,
      'Conversion Rate': c.rate === null ? 'n/a' : Math.round(c.rate * 100) + '%',
      'Went Elsewhere': Math.max(0, c.leftSource - c.patients),
      Events: c.events,
      Team: c.team,
    }));
    const allPairs = matrix.map((m) => ({
      Movement: m.pair, Patients: m.patients, Events: m.events,
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Conversions');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allPairs), 'All Movements');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Patient Detail');
    XLSX.writeFile(wb, `EdemaCare_Status_Conversions_${period.start}_to_${period.end}.xlsx`);
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase',
                      letterSpacing: '0.06em' }}>
          Conversions
        </div>
        <div style={{ fontSize: 11, color: MUTED }}>
          {period.start === period.end ? period.start : `${period.start} to ${period.end}`}
        </div>

        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {periods.map((p) => (
            <button key={p.key} onClick={() => { setPeriodKey(p.key); setOpen(null); }}
              style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6,
                       cursor: 'pointer',
                       border: `1px solid ${periodKey === p.key ? INK : 'var(--border)'}`,
                       background: periodKey === p.key ? INK : 'var(--card-bg)',
                       color: periodKey === p.key ? '#fff' : INK }}>
              {p.label}
            </button>
          ))}
          <button onClick={exportXlsx}
            title="Download conversions, every movement, and patient-level detail as XLSX"
            style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6,
                     border: '1px solid var(--border)', background: 'var(--card-bg)',
                     color: INK, cursor: 'pointer' }}>
            Export report
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
        {conversions.map((c) => (
          <ConversionTile key={c.key} c={c} onOpen={setOpen} />
        ))}
      </div>

      {/* Patient-level detail for a clicked conversion — the names to take
          into the standup, not just the number. */}
      {open && (
        <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', background: 'var(--bg)', display: 'flex',
                        justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>
              {open.label} {'·'} {open.patients} patient{open.patients === 1 ? '' : 's'}
              {open.rate !== null && (
                <span style={{ fontWeight: 400, color: MUTED, marginLeft: 6 }}>
                  {Math.round(open.rate * 100)}% of the {open.leftSource} who left that stage
                </span>
              )}
            </span>
            <button onClick={() => setOpen(null)}
              style={{ fontSize: 10, padding: '3px 8px', border: '1px solid var(--border)',
                       borderRadius: 5, background: 'var(--card-bg)', cursor: 'pointer' }}>
              close
            </button>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', padding: '4px 12px' }}>
            {open.detail.length === 0 && (
              <div style={{ fontSize: 12, color: MUTED, padding: '10px 0' }}>
                Nobody made this move in the selected period.
              </div>
            )}
            {open.detail.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0',
                                    borderBottom: i < open.detail.length - 1 ? '1px solid var(--border)' : 'none',
                                    fontSize: 12 }}>
                <span style={{ fontWeight: 600, minWidth: 160 }}>{t.patient}</span>
                <span style={{ fontSize: 10, color: MUTED }}>Rgn {t.region || '--'}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: MUTED }}>{t.day}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Everything else that moved — so a transition nobody thought to name
          is still visible rather than silently missing. */}
      <div style={{ marginTop: 12 }}>
        <button onClick={() => setShowAll((v) => !v)}
          style={{ fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 6,
                   border: '1px solid var(--border)', background: 'var(--card-bg)',
                   color: INK, cursor: 'pointer' }}>
          {showAll ? 'Hide' : 'Show'} all {matrix.length} movement type{matrix.length === 1 ? '' : 's'} in this period
        </button>
        {showAll && (
          <div style={{ marginTop: 8, border: '1px solid var(--border)', borderRadius: 8,
                        maxHeight: 300, overflowY: 'auto' }}>
            {matrix.map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 12px',
                                    borderBottom: i < matrix.length - 1 ? '1px solid var(--border)' : 'none',
                                    fontSize: 12 }}>
                <span style={{ flex: 1, minWidth: 0 }}>{m.pair}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700 }}>{m.patients}</span>
                <span style={{ fontSize: 10, color: MUTED, minWidth: 60, textAlign: 'right' }}>
                  {m.events === m.patients ? 'patients' : `${m.events} events`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
