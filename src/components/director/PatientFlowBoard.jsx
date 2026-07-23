import { useMemo, useState } from 'react';
import {
  buildFlowBoard, movementsByTeam, TEAM_LABELS, latestActivityDate,
} from '../../lib/patientFlow';

// =====================================================================
// PatientFlowBoard — daily patient progression (2026-07-21)
//
// Liam: "I need to have a way for the dashboard to outline on a daily
// basis when a status changes for a patient ... so I can then touch base
// with the Care Coordination Team, the Authorization Team, and the
// Clinical Team."
//
// So the board is organised around the CALL he has to make, not around
// the data model: movements are grouped by the team that owns the stage
// the patient moved INTO, and each stage tile names its owner.
//
// Reading order is deliberate:
//   1. the flow rail      — where everyone is right now, and what moved
//   2. the day's headline — entered / activated / lost, one line
//   3. movements by team  — the actual call list
//   4. flappers           — data problems masquerading as progress
// =====================================================================

const INK = '#0F172A';
const MUTED = '#64748B';
const GOOD = '#059669';
const WARN = '#D97706';
const BAD = '#DC2626';
const TEAL = '#06B6D4';

const TEAM_ACCENT = {
  care_coord: TEAL,
  auth: '#6366F1',
  clinical: GOOD,
  other: MUTED,
};

function fmtDay(d) {
  if (!d) return '--';
  const dt = new Date(d + 'T12:00:00Z');
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ── One stage tile in the flow rail ──────────────────────────────────
function StageTile({ stage, onPick, picked }) {
  const hasFlow = stage.inCount > 0 || stage.outCount > 0;
  return (
    <div
      onClick={() => onPick(picked ? null : stage.key)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(picked ? null : stage.key); } }}
      title={`${stage.label} — owned by ${stage.owner}. Click to see who is in this stage.`}
      style={{
        background: picked ? '#F1F5F9' : 'var(--card-bg)',
        border: `1px solid ${picked ? INK : 'var(--border)'}`,
        borderRadius: 10, padding: '10px 12px', minWidth: 0, cursor: 'pointer',
        transition: 'border-color 120ms, background 120ms',
      }}
    >
      <div style={{ fontSize: 9.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase',
                    letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {stage.short}
      </div>
      <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'DM Mono, monospace', lineHeight: 1.1,
                    color: stage.stuck > 0 ? BAD : INK }}>
        {stage.current}
      </div>
      {/* Movement in/out for the selected day. Silent when nothing moved —
          a zero here is noise, not information. */}
      <div style={{ fontSize: 10, marginTop: 3, minHeight: 14, color: MUTED }}>
        {hasFlow ? (
          <>
            {stage.inCount > 0 && <span style={{ color: GOOD, fontWeight: 700 }}>+{stage.inCount} </span>}
            {stage.outCount > 0 && <span style={{ color: WARN, fontWeight: 700 }}>-{stage.outCount}</span>}
          </>
        ) : <span style={{ opacity: 0.45 }}>no change</span>}
      </div>
      {stage.stuck > 0 && (
        <div style={{ fontSize: 9.5, fontWeight: 700, color: BAD, background: '#FEF2F2',
                      borderRadius: 4, padding: '2px 5px', marginTop: 5 }}>
          {stage.stuck} over 7d
        </div>
      )}
      <div style={{ fontSize: 9, color: MUTED, marginTop: 5, whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {stage.owner}
      </div>
    </div>
  );
}

// ── One movement line ────────────────────────────────────────────────
function MovementRow({ m }) {
  const from = m.fromStatus || 'new chart';
  const to = m.toStatus || '--';
  // Unstable patients still appear — hiding a real move would be worse —
  // but they recede so the genuine progressions read first.
  return (
    <div title={m.unstable ? 'This patient has been cycling between statuses; treat as churn until the roster is fixed.' : undefined}
      style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0',
                  borderBottom: '1px solid var(--border)', fontSize: 12, flexWrap: 'wrap',
                  opacity: m.unstable ? 0.55 : 1 }}>
      <span style={{ fontWeight: 600, minWidth: 150 }}>{m.patient}</span>
      <span style={{ fontSize: 10, color: MUTED }}>Rgn {m.region || '--'}</span>
      <span style={{ color: MUTED, fontSize: 11 }}>
        {from} <span style={{ color: INK, fontWeight: 700 }}>{'→'}</span> <span style={{ color: INK, fontWeight: 600 }}>{to}</span>
      </span>
      {m.unstable && (
        <span style={{ fontSize: 9, color: WARN, background: '#FEF3C7', borderRadius: 4, padding: '1px 5px' }}>
          cycling
        </span>
      )}
      {m.hops > 1 && (
        <span title={`${m.hops} status writes that day, netted to this one move`}
              style={{ fontSize: 9, color: WARN, background: '#FEF3C7', borderRadius: 4, padding: '1px 5px' }}>
          {m.hops} hops
        </span>
      )}
    </div>
  );
}

export default function PatientFlowBoard({ census, statusLog, onNavigate }) {
  // Which upload days are available. Uploads are weekday-only, so the
  // options come from the data rather than from a calendar.
  const days = useMemo(() => {
    const set = new Set();
    (statusLog || []).forEach((r) => { if (r && r.changed_at) set.add(String(r.changed_at).slice(0, 10)); });
    return Array.from(set).sort().reverse().slice(0, 14);
  }, [statusLog]);

  const [day, setDay] = useState(null);
  const [pickedStage, setPickedStage] = useState(null);
  const activeDay = day || latestActivityDate(statusLog);

  const board = useMemo(
    () => buildFlowBoard({ census: census || [], log: statusLog || [], date: activeDay }),
    [census, statusLog, activeDay]
  );

  const byTeam = useMemo(() => movementsByTeam(board.movements), [board.movements]);
  const picked = pickedStage
    ? board.stages.concat(board.exits).find((s) => s.key === pickedStage)
    : null;

  const t = board.totals;

  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      {/* Header + day picker */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: '#F8FAFC',
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: INK }}>Patient Flow</div>
        <div style={{ fontSize: 11, color: MUTED }}>
          status movement for {fmtDay(board.date)}
        </div>
        <select
          value={activeDay || ''}
          onChange={(e) => { setDay(e.target.value); setPickedStage(null); }}
          style={{ marginLeft: 'auto', padding: '5px 9px', border: '1px solid var(--border)',
                   borderRadius: 6, fontSize: 11, background: 'var(--card-bg)', outline: 'none' }}>
          {days.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}
        </select>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* 1. FLOW RAIL — left-to-right in the order patients actually move */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase',
                        letterSpacing: '0.06em', marginBottom: 7 }}>
            Activation pipeline
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${board.stages.length}, minmax(0, 1fr))`, gap: 8 }}>
            {board.stages.map((s) => (
              <StageTile key={s.key} stage={s} picked={pickedStage === s.key} onPick={setPickedStage} />
            ))}
          </div>
        </div>

        {/* Exit lane — where patients fall out. Often the more urgent call. */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase',
                        letterSpacing: '0.06em', marginBottom: 7 }}>
            Out of pipeline
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${board.exits.length}, minmax(0, 1fr))`, gap: 8 }}>
            {board.exits.map((s) => (
              <StageTile key={s.key} stage={s} picked={pickedStage === s.key} onPick={setPickedStage} />
            ))}
          </div>
        </div>

        {/* Drill-down for a clicked tile: who is in it, longest-waiting first.
            isFloor entries render as "N+ d" because the log only reaches back
            to 2026-04-03 and anything earlier is a lower bound, not a fact. */}
        {picked && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', background: 'var(--bg)', display: 'flex',
                          justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>
                {picked.label} {'·'} {picked.current} patient{picked.current === 1 ? '' : 's'}
                <span style={{ fontWeight: 400, color: MUTED, marginLeft: 6 }}>{picked.owner}</span>
              </span>
              <button onClick={() => setPickedStage(null)}
                style={{ fontSize: 10, padding: '3px 8px', border: '1px solid var(--border)',
                         borderRadius: 5, background: 'var(--card-bg)', cursor: 'pointer' }}>
                close
              </button>
            </div>
            <div style={{ maxHeight: 220, overflowY: 'auto', padding: '4px 12px' }}>
              {picked.patients.length === 0 && (
                <div style={{ fontSize: 12, color: MUTED, padding: '10px 0' }}>Nobody in this stage.</div>
              )}
              {picked.patients.map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0',
                                      borderBottom: i < picked.patients.length - 1 ? '1px solid var(--border)' : 'none',
                                      fontSize: 12 }}>
                  <span style={{ fontWeight: 600, minWidth: 160 }}>{p.patient}</span>
                  <span style={{ fontSize: 10, color: MUTED }}>Rgn {p.region || '--'}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: 'DM Mono, monospace', fontSize: 11,
                                 fontWeight: 700, color: p.days >= 14 ? BAD : p.days >= 7 ? WARN : MUTED }}>
                    {p.days === null ? 'unknown' : `${p.days}${p.isFloor ? '+' : ''}d`}
                  </span>
                </div>
              ))}
            </div>
            {picked.unknownDwell > 0 && (
              <div style={{ padding: '6px 12px', fontSize: 10, color: MUTED, background: 'var(--bg)',
                            borderTop: '1px solid var(--border)' }}>
                {picked.unknownDwell} of {picked.current} show <strong>+</strong> — they entered this status before the
                status log began (2026-04-03), so the figure is a minimum, not a measurement.
              </div>
            )}
          </div>
        )}

        {/* 2. DAY HEADLINE — the whole day in one sentence */}
        <div style={{ padding: '10px 14px', background: 'var(--bg)', border: '1px solid var(--border)',
                      borderRadius: 8, fontSize: 13, lineHeight: 1.5 }}>
          {t.moved === 0 ? (
            <span style={{ color: MUTED }}>No status movement recorded for {fmtDay(board.date)}.</span>
          ) : (
            <>
              <strong style={{ color: TEAL }}>{t.entered}</strong> entered the pipeline {'·'}{' '}
              <strong style={{ color: GOOD }}>{t.activated}</strong> activated {'·'}{' '}
              <strong style={{ color: WARN }}>{t.within}</strong> moved between stages {'·'}{' '}
              <strong style={{ color: BAD }}>{t.lost}</strong> fell out
              {t.bounced > 0 && (
                <span style={{ color: MUTED }}>
                  {' · '}{t.bounced} bounced and ended where {t.bounced === 1 ? 'it' : 'they'} started
                </span>
              )}
              {t.unstableMoves > 0 && (
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 5 }}>
                  {t.unstableMoves} of these {t.moved} are patients who keep cycling between statuses
                  {' '}(greyed below). Real movement today: <strong style={{ color: INK }}>{t.moved - t.unstableMoves}</strong>.
                </div>
              )}
            </>
          )}
        </div>

        {/* 3. MOVEMENTS BY TEAM — the call list */}
        {t.moved > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            {['care_coord', 'auth', 'clinical', 'other'].map((team) => {
              const list = byTeam[team] || [];
              if (list.length === 0) return null;
              return (
                <div key={team} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ padding: '7px 11px', background: 'var(--bg)', borderBottom: '1px solid var(--border)',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                borderLeft: `3px solid ${TEAM_ACCENT[team]}` }}>
                    <span style={{ fontSize: 11.5, fontWeight: 800 }}>{TEAM_LABELS[team]}</span>
                    <span style={{ fontSize: 10, color: MUTED }}>
                      {list.length} move{list.length === 1 ? '' : 's'} in
                    </span>
                  </div>
                  <div style={{ padding: '2px 11px', maxHeight: 260, overflowY: 'auto' }}>
                    {list.map((m, i) => <MovementRow key={i} m={m} />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 4. FLAPPERS — a status flipping repeatedly is a data problem, not
            care progress, and it is why the feed above is netted per day. */}
        {board.flappers.length > 0 && (
          <div style={{ background: '#FFFBEB', border: `1px solid ${WARN}`, borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#92400E', textTransform: 'uppercase',
                          letterSpacing: '0.05em', marginBottom: 5 }}>
              Unstable status {'·'} {board.flappers.length} patient{board.flappers.length === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: 12, color: '#78350F', lineHeight: 1.5, marginBottom: 7 }}>
              Written back into the same status 3+ separate times in 14 days. On production
              <strong> no patient moves forward 3+ times without doubling back</strong>, so this pattern is
              an insurance or roster problem, not care progress. Worth fixing at the source — it is
              currently the bulk of all logged status activity.
            </div>
            <div style={{ maxHeight: 130, overflowY: 'auto' }}>
              {board.flappers.slice(0, 12).map((f, i) => (
                <div key={i} style={{ fontSize: 11.5, color: '#78350F', padding: '2px 0' }}>
                  <strong>{f.patient}</strong>
                  <span style={{ opacity: 0.75 }}> (Rgn {f.region || '--'})</span>
                  {' — '}back into the same status {f.revisits}x ({f.flips} changes){f.statuses.length ? ', cycling ' + f.statuses.join(' / ') : ''}
                </div>
              ))}
              {board.flappers.length > 12 && (
                <div style={{ fontSize: 11, color: '#92400E', marginTop: 4 }}>
                  +{board.flappers.length - 12} more
                </div>
              )}
            </div>
          </div>
        )}

        {typeof onNavigate === 'function' && (
          <div>
            <button onClick={() => onNavigate('census')}
              style={{ fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 6,
                       border: 'none', background: INK, color: '#fff', cursor: 'pointer' }}>
              Open census
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
