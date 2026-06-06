import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, fetchAllPages } from '../../lib/supabase';
import TopBar from '../../components/TopBar';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import ManagerScorecards from '../../components/director/ManagerScorecards';
import ExceptionFeed from '../../components/director/ExceptionFeed';
import WeekSelector, { readPersistedWeekOffset } from '../../components/WeekSelector';
// 2026-05-31 CEO redesign — subtractive layout per docs/CEO_Dashboard_Design.md.
// StateToggle auto-hides until GA has ≥10 active patients; mapping helper
// folds in marketing_territories so the toggle reflects live data the
// moment ops adds region letters to Georgia Territory.
import StateToggle from '../../components/StateToggle';
import { useStateMapping, getRegionsForState, readPersistedState } from '../../lib/stateMapping';
import { EXPANSION } from '../../lib/constants';
// LieutenantSnapshots removed in v2.1 rework — redundant with Manager Scorecards.
// Carla's scorecard IS her snapshot; Hervylie's scorecard IS his. One source of truth.
// Visit math from shared module (2026-05-17 refactor)
import { BLENDED_RATE, WEEKLY_REVENUE_TARGET as REVENUE_TARGET,
         isCancelled, isAttempted, isMissed, isCompleted, dedupEncounters } from '../../lib/visitMath';
// 2026-06-06: per-(patient_name, visit_date) latest-uploaded_at dedup. Drops
// ghost rows that survive in visit_schedule_data when Pariox reassigns a slot
// across uploads. See src/lib/visitDedup.js for the rationale.
import { dedupVisitsByLatestUpload } from '../../lib/visitDedup';
import { getWeekRange } from '../../lib/dateUtils';

const WEEKLY_TARGET = 750;
const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

function fmt$(n) { return '$' + Math.round(n).toLocaleString(); }
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function daysAgo(d) {
  if (!d) return null;
  return Math.floor((new Date() - new Date(d + 'T00:00:00')) / 86400000);
}

// ── Triage Card ───────────────────────────────────────────────────────────────
function TriageCard({ rank, title, count, subtitle, color, bg, border, detail, action, actionLabel, urgent }) {
  const clickable = typeof action === 'function';
  return (
    <div
      onClick={clickable ? action : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); action(); } }) : undefined}
      onMouseEnter={clickable ? (e => { e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.12)'; e.currentTarget.style.transform = 'translateY(-1px)'; }) : undefined}
      onMouseLeave={clickable ? (e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }) : undefined}
      style={{
        background: bg, border: `2px solid ${border || color}`,
        borderRadius: 12, padding: '16px 18px', position: 'relative', overflow: 'hidden',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'transform 0.1s ease, box-shadow 0.15s ease',
      }}>
      {urgent && (
        <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:`linear-gradient(90deg, ${color}, transparent)` }} />
      )}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:22, height:22, borderRadius:'50%', background:color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:900, color:'#fff', flexShrink:0 }}>
            {rank}
          </div>
          <div style={{ fontSize:12, fontWeight:700, color:'#0F1117', lineHeight:1.3 }}>{title}</div>
        </div>
        <div style={{ fontSize:28, fontWeight:900, fontFamily:'DM Mono, monospace', color, lineHeight:1 }}>{count}</div>
      </div>
      <div style={{ fontSize:11, color:'#6B7280', marginBottom: detail ? 10 : 0 }}>{subtitle}</div>
      {detail && (
        <div style={{ fontSize:11, color, fontWeight:600, background:`${color}15`, borderRadius:6, padding:'5px 8px', marginBottom:action?8:0 }}>
          {detail}
        </div>
      )}
      {action && (
        <button
          onClick={(e) => { e.stopPropagation(); action(); }}
          style={{ fontSize:10, fontWeight:700, color:'#fff', background:color, border:'none', borderRadius:5, padding:'4px 10px', cursor:'pointer', width:'100%', marginTop:4 }}>
          {actionLabel || 'View →'}
        </button>
      )}
    </div>
  );
}

// ── Revenue Gauge ─────────────────────────────────────────────────────────────
function RevenueGauge({ actual, target }) {
  const pct = Math.min(100, Math.round((actual / target) * 100));
  const color = pct >= 80 ? '#059669' : pct >= 60 ? '#D97706' : '#DC2626';
  const gap = target - actual;
  return (
    <div style={{ background:'#0F1117', borderRadius:12, padding:'18px 20px', color:'#fff' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>
        Weekly Revenue Pace
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:12 }}>
        <div>
          <div style={{ fontSize:36, fontWeight:900, fontFamily:'DM Mono, monospace', color, lineHeight:1 }}>{fmt$(actual)}</div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginTop:2 }}>of {fmt$(target)} target</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', color }}>{pct}%</div>
          <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>to target</div>
        </div>
      </div>
      <div style={{ background:'rgba(255,255,255,0.1)', borderRadius:999, height:8, marginBottom:10 }}>
        <div style={{ width:`${pct}%`, height:'100%', background:color, borderRadius:999, transition:'width 0.8s ease' }} />
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'rgba(255,255,255,0.4)' }}>
        <span>Gap to target: <span style={{ color:'#FBBF24', fontWeight:700 }}>{fmt$(gap)}</span></span>
        <span>{fmt$(target)} = {Math.ceil(target / BLENDED_RATE)} visits/wk @ ${BLENDED_RATE}/visit</span>
      </div>
    </div>
  );
}

// ── Region Heat Row ───────────────────────────────────────────────────────────
function RegionRow({ region, active, inactiveActive, onHold, pending, completedVisits, revenueGap }) {
  const activityRate = active > 0 ? Math.round(((active - inactiveActive) / active) * 100) : 0;
  const barColor = activityRate >= 80 ? '#059669' : activityRate >= 60 ? '#D97706' : '#DC2626';
  return (
    <div style={{ display:'grid', gridTemplateColumns:'0.5fr 0.7fr 1.2fr 0.7fr 0.7fr 0.7fr 0.9fr', padding:'9px 16px', borderBottom:'1px solid var(--border)', alignItems:'center', gap:8, background:'var(--card-bg)' }}
      onMouseEnter={e => e.currentTarget.style.background='#F8F9FF'}
      onMouseLeave={e => e.currentTarget.style.background='var(--card-bg)'}>
      <div style={{ fontSize:13, fontWeight:800, color:'#0F1117' }}>Rgn {region}</div>
      <div style={{ fontSize:14, fontWeight:700, fontFamily:'DM Mono, monospace' }}>{active}</div>
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <div style={{ flex:1, height:6, background:'#E5E7EB', borderRadius:999 }}>
            <div style={{ width:`${activityRate}%`, height:'100%', background:barColor, borderRadius:999 }} />
          </div>
          <span style={{ fontSize:11, fontWeight:700, color:barColor, minWidth:28 }}>{activityRate}%</span>
        </div>
        {inactiveActive > 0 && <div style={{ fontSize:9, color:'#DC2626', marginTop:2 }}>{inactiveActive} overdue vs freq</div>}
      </div>
      <div style={{ fontSize:13, fontWeight:inactiveActive>10?700:400, color:inactiveActive>10?'#DC2626':'var(--gray)' }}>{inactiveActive}</div>
      <div style={{ fontSize:13, color:'var(--gray)' }}>{onHold}</div>
      <div style={{ fontSize:13, color:'var(--gray)' }}>{pending}</div>
      <div style={{ fontSize:11, fontWeight:700, color:revenueGap>5000?'#DC2626':revenueGap>2000?'#D97706':'#059669' }}>
        {revenueGap > 0 ? `-${fmt$(revenueGap)}/wk` : '✓ Active'}
      </div>
    </div>
  );
}

// ── Hero Band (Director Command v2.1 rework) ─────────────────────────────────
// The hero band is the only thing Liam sees in the first 5 seconds of his
// daily standup. Per his explicit answer (2026-05-16):
//   "Are we hitting revenue this week?" is THE question this page must answer.
// So we lead with a massive revenue number, the ops score beside it, and one
// declarative summary sentence with the today's-action counts baked in.
//
// 2026-05-31: added wow prop for week-over-week delta indicator.
function HeroBand({ weeklyRevenue, target, score, scoreColor, p1Count, redManagerCount, daysLeftInWeek, pathTiles, wow, isPastWeek }) {
  const pct = Math.min(100, Math.round((weeklyRevenue / target) * 100));
  const gap = Math.max(0, target - weeklyRevenue);
  const paceColor = pct >= 80 ? '#34D399' : pct >= 60 ? '#FBBF24' : '#F87171';

  return (
    <div style={{ background: '#0F1117', borderRadius: 14, padding: '20px 24px', color: '#fff' }}>
      {/* Headline strip: revenue mega-number + ops score */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
            Weekly Revenue Pace
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 56, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: paceColor, lineHeight: 1 }}>
              {fmt$(weeklyRevenue)}
            </div>
            <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>
              of {fmt$(target)} target
            </div>
            <div style={{
              padding: '4px 10px', background: paceColor + '22', color: paceColor,
              borderRadius: 6, fontSize: 14, fontWeight: 800, fontFamily: 'DM Mono, monospace',
            }}>
              {pct}%
            </div>
            {/* Week-over-week revenue delta — added 2026-05-31. Hidden if no prior data. */}
            {wow && wow.revenue > 0 && (() => {
              const delta = weeklyRevenue - wow.revenue;
              const pctDelta = wow.revenue > 0 ? Math.round((delta / wow.revenue) * 100) : 0;
              const up = delta >= 0;
              const dColor = up ? '#34D399' : '#F87171';
              return (
                <div title={'vs ' + wow.label + ': ' + fmt$(wow.revenue)} style={{
                  padding: '4px 10px', background: dColor + '22', color: dColor,
                  borderRadius: 6, fontSize: 13, fontWeight: 800, fontFamily: 'DM Mono, monospace',
                }}>
                  {up ? '▲' : '▼'} {fmt$(Math.abs(delta))} ({up ? '+' : ''}{pctDelta}%) vs prior
                </div>
              );
            })()}
          </div>
          {/* Progress bar */}
          <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 999, height: 10, marginTop: 14, overflow: 'hidden' }}>
            <div style={{ width: pct + '%', height: '100%', background: paceColor, borderRadius: 999, transition: 'width 0.8s ease' }} />
          </div>
        </div>
        <div style={{
          padding: '14px 22px', background: 'rgba(255,255,255,0.05)', borderRadius: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 130,
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Ops Score
          </div>
          <div style={{ fontSize: 44, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: scoreColor, lineHeight: 1, marginTop: 4 }}>
            {score}
          </div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>/ 100</div>
          <div style={{ fontSize: 9, color: scoreColor, marginTop: 4, fontWeight: 700 }}>
            {score >= 80 ? 'STRONG' : score >= 60 ? 'NEEDS WORK' : 'CRITICAL'}
          </div>
        </div>
      </div>

      {/* Headline summary sentence — Liam's 5-second read.
          2026-05-31: when viewing a past week, swap "on pace for" / "days left
          in week" framing to a final-result framing — those phrases imply a
          live week and would mislead on historical reads. */}
      <div style={{
        padding: '12px 16px', background: 'rgba(255,255,255,0.04)', borderRadius: 8,
        fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5, marginBottom: 16,
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        {pct >= 80 ? '✓ ' : pct >= 60 ? '⚠ ' : '✗ '}
        {isPastWeek ? (
          <>
            <strong style={{ color: paceColor }}>Finished at {fmt$(weeklyRevenue)}</strong> of {fmt$(target)} target
            {gap > 0 && <span style={{ color: 'rgba(255,255,255,0.55)' }}> (gap {fmt$(gap)})</span>}
          </>
        ) : (
          <>
            <strong style={{ color: paceColor }}>On pace for {fmt$(weeklyRevenue)}</strong> of {fmt$(target)} this week
            {gap > 0 && <span style={{ color: 'rgba(255,255,255,0.55)' }}> (gap {fmt$(gap)})</span>}
          </>
        )}
        {' · '}
        {p1Count > 0 ? (
          <><strong style={{ color: '#F87171' }}>{p1Count} P1 {p1Count === 1 ? 'issue' : 'issues'}</strong> need your eyes</>
        ) : (
          <span style={{ color: '#34D399' }}>no P1 issues</span>
        )}
        {' · '}
        {redManagerCount > 0 ? (
          <><strong style={{ color: '#F87171' }}>{redManagerCount} {redManagerCount === 1 ? 'manager' : 'managers'} in red</strong></>
        ) : (
          <span style={{ color: '#34D399' }}>all managers green/amber</span>
        )}
        {!isPastWeek && (
          <>
            {' · '}
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>{daysLeftInWeek} days left in week</span>
          </>
        )}
      </div>

      {/* Path to $200K — supporting context for the headline */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          Path to {fmt$(target)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {pathTiles.map(function(item) {
            return (
              <div key={item.label} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                  {item.label}
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: item.color, lineHeight: 1 }}>
                  {item.val}
                </div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
                  {item.sub}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── CEO KPI Strip (2026-05-31 redesign) ──────────────────────────────────────
// Five tiles below the hero. Every tile is clickable and shows a WoW delta
// where the data honestly supports one. Where it doesn't (point-in-time
// snapshots like census, no historical version of derived stalled counts),
// we show contextual info instead of fabricating a delta.
function CeoKpiTile({ label, value, sub, deltaText, deltaDirection, onClick, color = '#0F1117', accent }) {
  const clickable = typeof onClick === 'function';
  return (
    <div
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      onMouseEnter={clickable ? (e) => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.10)'; e.currentTarget.style.transform = 'translateY(-1px)'; } : undefined}
      onMouseLeave={clickable ? (e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; } : undefined}
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '14px 16px',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'transform 0.1s ease, box-shadow 0.15s ease',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {accent && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent }} />
      )}
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 30, fontWeight: 900, fontFamily: 'DM Mono, monospace', color, lineHeight: 1 }}>
          {value}
        </div>
        {deltaText && (
          <div style={{
            padding: '2px 8px',
            background: deltaDirection === 'up' ? '#ECFDF5' : deltaDirection === 'down' ? '#FEF2F2' : '#F3F4F6',
            color: deltaDirection === 'up' ? '#059669' : deltaDirection === 'down' ? '#DC2626' : '#6B7280',
            borderRadius: 5,
            fontSize: 11,
            fontWeight: 800,
            fontFamily: 'DM Mono, monospace',
          }}>
            {deltaDirection === 'up' ? '▲ ' : deltaDirection === 'down' ? '▼ ' : ''}{deltaText}
          </div>
        )}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 6 }}>{sub}</div>
      )}
      {clickable && (
        <div style={{ fontSize: 10, color: color, marginTop: 8, fontWeight: 600, opacity: 0.7 }}>open →</div>
      )}
    </div>
  );
}

// ── Needs You Today (2026-05-31) ─────────────────────────────────────────────
// Top 5 ranked action items — replaces the "scroll-and-hunt" exception feed
// at the top-of-page. Each row: 1 line, 1 action button. Hard-capped at 5.
function NeedsYouToday({ items, onAction }) {
  const top5 = (items || []).slice(0, 5);
  return (
    <div style={{
      background: 'var(--card-bg)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        background: '#FFF5F0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            background: '#DC2626', color: '#fff', borderRadius: 5,
            padding: '2px 8px', fontSize: 10, fontWeight: 800, letterSpacing: '0.05em',
          }}>FOCUS</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#0F1117' }}>Needs you today</span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--gray)' }}>
          {top5.length === 0 ? 'nothing critical — green across the board' : `top ${top5.length} of ${items.length} open`}
        </span>
      </div>
      {top5.length === 0 ? (
        <div style={{ padding: '20px 16px', textAlign: 'center', color: '#059669', fontSize: 13, fontWeight: 600 }}>
          ✓ No critical issues. Spend the morning on growth, not triage.
        </div>
      ) : (
        <div>
          {top5.map(function (it, i) {
            const sev = it.severity || 'medium';
            const sevColor = sev === 'p1' ? '#DC2626' : sev === 'high' ? '#D97706' : '#1565C0';
            const sevBg = sev === 'p1' ? '#FEF2F2' : sev === 'high' ? '#FEF3C7' : '#EFF6FF';
            return (
              <div key={i} style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                gap: 12,
                padding: '11px 16px',
                borderBottom: i < top5.length - 1 ? '1px solid var(--border)' : 'none',
                alignItems: 'center',
              }}>
                <span style={{
                  background: sevBg, color: sevColor,
                  padding: '3px 8px', borderRadius: 999,
                  fontSize: 10, fontWeight: 800, letterSpacing: '0.05em',
                  textTransform: 'uppercase', minWidth: 30, textAlign: 'center',
                }}>
                  {sev}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0F1117', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.title}
                  </div>
                  {it.detail && (
                    <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 1 }}>{it.detail}</div>
                  )}
                </div>
                {it.actionLabel && (
                  <button
                    type="button"
                    onClick={function () { if (typeof onAction === 'function') onAction(it); }}
                    style={{
                      padding: '6px 12px',
                      background: '#0F1117', color: '#fff',
                      border: 'none', borderRadius: 6,
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {it.actionLabel}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Expansion Status tile (2026-05-31) ───────────────────────────────────────
// Shows Georgia (and any future state) credentialing/staffing progress as
// executive context. Lives in the Detail block so the CEO sees expansion
// momentum without an empty toggle tab. Source: src/lib/constants.js EXPANSION.
function ExpansionStatus({ territories }) {
  // Group: how many territories per state? GA might have multiple over time.
  const territoryByState = useMemo(function () {
    const out = {};
    (territories || []).forEach(function (t) {
      if (!out[t.state]) out[t.state] = [];
      out[t.state].push(t);
    });
    return out;
  }, [territories]);
  return (
    <div style={{
      background: 'var(--card-bg)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>📍 Expansion Status</div>
        <div style={{ fontSize: 11, color: 'var(--gray)' }}>credentialing · staffing · first-patient target</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', padding: 16, gap: 12 }}>
        {EXPANSION.map(function (e) {
          const ts = territoryByState[e.state === 'Georgia' ? 'GA' : e.state.slice(0,2).toUpperCase()] || [];
          const credColor = e.credentialing >= 80 ? '#059669' : e.credentialing >= 50 ? '#D97706' : '#DC2626';
          return (
            <div key={e.state} style={{ background: 'var(--bg)', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#0F1117' }}>{e.state}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase' }}>{e.status}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
                <div style={{ fontSize: 22, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: credColor, lineHeight: 1 }}>
                  {e.credentialing}%
                </div>
                <div style={{ fontSize: 10, color: 'var(--gray)' }}>credentialed</div>
              </div>
              <div style={{ background: 'var(--border)', borderRadius: 999, height: 5, marginBottom: 8 }}>
                <div style={{ width: `${e.credentialing}%`, height: '100%', background: credColor, borderRadius: 999 }} />
              </div>
              <div style={{ fontSize: 11, color: '#0F1117' }}>
                <span style={{ fontWeight: 700 }}>{e.staffHired}</span> staff hired
                {' · '}
                <span style={{ color: 'var(--gray)' }}>target {e.target}</span>
              </div>
              {ts.length > 0 && (
                <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 6 }}>
                  {ts.length} territor{ts.length === 1 ? 'y' : 'ies'}: {ts.map(function (t) { return t.name; }).join(', ')}
                  {' · '}
                  {ts.reduce(function (s, t) { return s + ((t.legacy_region_letters || []).length); }, 0)} region letters mapped
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function DirectorDashboard({ onNavigate }) {
  const go = (page, intent) => { if (typeof onNavigate === 'function') onNavigate(page, intent); };
  const [loading, setLoading] = useState(true);
  const [census, setCensus] = useState([]);
  const [visits, setVisits] = useState([]);
  const [prevVisits, setPrevVisits] = useState([]); // 2026-05-31: prior-week visits for WoW deltas
  const [authRenewals, setAuthRenewals] = useState([]);
  const [onHold, setOnHold] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [clinicians, setClinicians] = useState([]);
  const [discharges, setDischarges] = useState([]);
  // Added for Manager Accountability layer (Director Command v2):
  //   - coordinators: org tree → who maps to which scorecard row
  //   - statusLog: not strictly required by current scorecard logic but
  //     wired through so we can add trend math without another fetch round
  //   - activityLog: powers response-latency + inactive-coordinator alerts
  //   - intakeReferrals + auths: feed Carla's Lieutenant Snapshot
  const [coordinators, setCoordinators] = useState([]);
  const [statusLog, setStatusLog] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [intakeReferrals, setIntakeReferrals] = useState([]);
  const [auths, setAuths] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);

  // 2026-05-31: week-toggle state. Lazy init reads localStorage so refreshing
  // the page doesn't reset to "this week" if Liam was investigating a past week.
  const [weekOffset, setWeekOffset] = useState(function() {
    return readPersistedWeekOffset('directorCommand');
  });

  // 2026-05-31 CEO redesign: state filter (ALL/FL/GA). The toggle UI
  // auto-hides until GA has ≥10 active patients (see StateToggle), but the
  // filter value is wired through every query unconditionally so the
  // plumbing is in place. Default 'ALL' matches the pre-redesign behavior.
  const [stateFilter, setStateFilter] = useState(function() {
    return readPersistedState('directorCommand', 'ALL');
  });

  // marketing_territories → region letter mapping. Live, with a static fallback
  // so the page never blocks on this fetch. See src/lib/stateMapping.js.
  const mapping = useStateMapping();

  // Active region letters for the current state filter. When ALL, this is the
  // full canonical region set. When FL/GA, it's the per-state list pulled from
  // marketing_territories. We thread this list into every server query that
  // supports a region filter, narrowing the result set at the database edge
  // instead of fetching all rows and discarding them client-side.
  const activeRegions = useMemo(function() {
    return getRegionsForState(stateFilter, mapping.stateToRegions);
  }, [stateFilter, mapping.stateToRegions]);

  const load = useCallback(async () => {
    // 2026-05-17: Work week is SUN-SAT per Liam. Uses canonical getWeekRange
    // helper so this never drifts from other dashboards.
    // 2026-05-31: now driven by weekOffset so the page reactively re-queries
    // when Liam toggles weeks. Prior-week range pulled in parallel for WoW deltas.
    const wk = getWeekRange(new Date(), weekOffset);
    const weekStartStr = wk.startStr;
    const weekEndStr = wk.endStr;
    const prevWk = getWeekRange(new Date(), weekOffset + 1);
    const prevWeekStartStr = prevWk.startStr;
    const prevWeekEndStr = prevWk.endStr;

    // 30-day window for status_log (powers sparkline trend math without
    // pulling all 4K+ historical transitions).
    const thirtyDaysAgoIso = new Date(Date.now() - 30 * 86400000).toISOString();
    // 7-day window for activity_log — sufficient for response-latency
    // proxy and "inactive coordinator" detection on the Director view.
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 86400000).toISOString();
    const thirtyDaysAgoDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    // 2026-05-31 CEO redesign: wire state filter to every region-keyed query.
    // applyRegion narrows the .in('region', activeRegions) clause when a
    // state is selected; for 'ALL' it returns the unmodified query so the
    // pre-redesign behavior is preserved exactly.
    const isFiltered = stateFilter && stateFilter !== 'ALL' && activeRegions && activeRegions.length > 0;
    const applyRegion = function (q) { return isFiltered ? q.in('region', activeRegions) : q; };
    // patient_discharges has no region column today — left unfiltered. If a
    // future migration adds region, wrap this query too.
    // coordinators is filtered by overlap (any of their assigned regions
    // intersects the active state's letters). For ALL we keep everyone.
    const applyCoords = function (q) {
      if (!isFiltered) return q;
      // Postgres array-overlap operator '&&' via .overlaps()
      return q.overlaps('regions', activeRegions);
    };

    // All paginated — census (750+), visits this week (800+), and auth
    // tables are each capable of exceeding the 1000-row PostgREST cap.
    const [c, v, pv, ar, oh, wl, cl, dc, co, sl, al, ir, au] = await Promise.all([
      fetchAllPages(applyRegion(supabase.from('census_data').select('patient_name,region,status,insurance,last_visit_date,days_since_last_visit,first_seen_date,inferred_frequency,overdue_threshold_days,days_overdue,status_changed_at,pipeline_assigned_to'))),
      fetchAllPages(applyRegion(supabase.from('visit_schedule_data').select('patient_name,staff_name,visit_date,status,event_type,region,uploaded_at').gte('visit_date', weekStartStr).lte('visit_date', weekEndStr))),
      // Prior-week visits — for week-over-week delta indicators on KPI tiles.
      fetchAllPages(applyRegion(supabase.from('visit_schedule_data').select('patient_name,staff_name,visit_date,status,event_type,region,uploaded_at').gte('visit_date', prevWeekStartStr).lte('visit_date', prevWeekEndStr))),
      fetchAllPages(applyRegion(supabase.from('auth_renewal_tasks').select('patient_name,region,priority,task_status,days_until_expiry,visits_remaining,expiry_date').not('task_status', 'in', '("approved","denied","closed")'))),
      fetchAllPages(applyRegion(supabase.from('on_hold_recovery').select('patient_name,region,hold_type,days_on_hold'))),
      fetchAllPages(applyRegion(supabase.from('waitlist_assignments').select('patient_name,region,assignment_status,assigned_clinician,waitlisted_since,priority'))),
      fetchAllPages(applyRegion(supabase.from('clinicians').select('full_name,region,discipline,weekly_visit_target,is_active').eq('is_active', true))),
      // patient_discharges: no region column — load unfiltered. If a future
      // migration adds region, wrap with applyRegion.
      fetchAllPages(supabase.from('patient_discharges').select('patient_name,discharge_date,followup_30day_required,followup_30day_completed')),
      // Director Command v2 — manager accountability layer:
      fetchAllPages(applyCoords(supabase.from('coordinators').select('id,full_name,role,job_title,team,regions,is_active').eq('is_active', true))),
      fetchAllPages(applyRegion(supabase.from('census_status_log').select('patient_name,region,old_status,new_status,changed_at').gte('changed_at', thirtyDaysAgoIso))),
      // activity_log has no region column — power-of-the-team metric reads
      // unfiltered so quiet-coordinator detection stays accurate.
      fetchAllPages(supabase.from('coordinator_activity_log').select('coordinator_name,coordinator_role,action_type,created_at').gte('created_at', sevenDaysAgoIso)),
      fetchAllPages(applyRegion(supabase.from('intake_referrals').select('patient_name,region,insurance,referral_status,date_received,welcome_call').gte('date_received', thirtyDaysAgoDate))),
      fetchAllPages(applyRegion(supabase.from('auth_tracker').select('patient_name,region,auth_status,auth_submitted_date,auth_approved_date,is_currently_active,assigned_to').eq('is_currently_active', true))),
    ]);

    setCensus(c);
    // 2026-06-06: per-(patient_name, visit_date) latest-uploaded_at dedup —
    // strip ghost rows BEFORE all downstream classifyVisits/dedupEncounters/
    // revenue math. Same rule applied across all 8 reader pages this sweep.
    setVisits(dedupVisitsByLatestUpload(v));
    setPrevVisits(dedupVisitsByLatestUpload(pv));
    setAuthRenewals(ar);
    setOnHold(oh);
    setWaitlist(wl);
    setClinicians(cl);
    setDischarges(dc);
    setCoordinators(co);
    setStatusLog(sl);
    setActivityLog(al);
    setIntakeReferrals(ir);
    setAuths(au);
    setLastRefresh(new Date());
    setLoading(false);
  }, [weekOffset, stateFilter, activeRegions]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable(['census_data', 'visit_schedule_data', 'auth_renewal_tasks', 'on_hold_recovery', 'patient_discharges', 'clinicians', 'waitlist_assignments', 'coordinators', 'census_status_log', 'coordinator_activity_log', 'intake_referrals', 'auth_tracker'], load);

  // ── Week-over-week deltas (added 2026-05-31) ─────────────────────────
  // Computed independently of the main `metrics` memo so they update as soon
  // as prevVisits changes, and so we don't bloat the main memo.
  const wow = useMemo(function() {
    if (!prevVisits || prevVisits.length === 0) return null;
    const prevCompleted = dedupEncounters(prevVisits.filter(isCompleted));
    const prevRevenue = prevCompleted.length * BLENDED_RATE;
    return {
      completed: prevCompleted.length,
      revenue: prevRevenue,
      label: getWeekRange(new Date(), weekOffset + 1).label,
    };
  }, [prevVisits, weekOffset]);

  const metrics = useMemo(() => {
    if (!census.length) return null;

    const active = census.filter(p => /active/i.test(p.status || ''));
    // Frequency-aware overdue: each patient has their own threshold (4w4→3d, 2w4→4d, 1w4→10d, 1em1→30d, 1em2→60d).
    const inactiveActive = active.filter(p => (p.days_overdue || 0) > 0);
    const onHoldPts = census.filter(p => /on.?hold/i.test(p.status || ''));
    const pendingStart = census.filter(p => /soc.?pending|eval.?pending/i.test(p.status || ''));

    // Visits this week — uses shared visitMath helpers (2026-05-17 refactor).
    // Raw rows kept for per-clinician utilization; deduped encounters drive revenue.
    const rawCompleted = visits.filter(isCompleted);
    const rawCancelled = visits.filter(isCancelled);
    const rawMissed = visits.filter(isMissed);

    const completedThisWeek = dedupEncounters(rawCompleted);
    const cancelledThisWeek = dedupEncounters(rawCancelled);
    const missedThisWeek = dedupEncounters(rawMissed);

    // Revenue — based on encounters (billing events), not raw clinician rows
    const weeklyRevenue = completedThisWeek.length * BLENDED_RATE;
    const revenueGap = REVENUE_TARGET - weeklyRevenue;
    const inactiveRevGap = inactiveActive.length * BLENDED_RATE * 2;

    // Auth renewals
    const urgentAuths = authRenewals.filter(a => a.priority === 'urgent');
    const highAuths = authRenewals.filter(a => a.priority === 'high');

    // Clinician utilization — use raw rows (each clinician's individual visits count
    // toward their productivity, even if it was a co-treat)
    const visitMap = {};
    rawCompleted.forEach(v => {
      const k = (v.staff_name || '').toLowerCase().trim();
      visitMap[k] = (visitMap[k] || 0) + 1;
    });
    const underutilized = clinicians.filter(cl => {
      const done = visitMap[(cl.full_name || '').toLowerCase().trim()] || 0;
      const pct = cl.weekly_visit_target > 0 ? (done / cl.weekly_visit_target) * 100 : 0;
      return pct < 60 && cl.weekly_visit_target >= 10;
    });

    // On hold overdue (21+ days)
    const onHoldOverdue = onHold.filter(p => (p.days_on_hold || 0) > 21);

    // Discharge follow-up overdue
    const dischargeOverdue = discharges.filter(d => {
      if (!d.followup_30day_required || d.followup_30day_completed) return false;
      if (!d.discharge_date) return false;
      return daysAgo(d.discharge_date) >= 30;
    });

    // Waitlist unassigned
    const waitlistUnassigned = waitlist.filter(w => w.assignment_status === 'pending' && !w.assigned_clinician);

    // Region breakdown
    const regionData = REGIONS.map(r => {
      const rActive = active.filter(p => p.region === r);
      const rInactive = inactiveActive.filter(p => p.region === r);
      const rOnHold = onHoldPts.filter(p => p.region === r);
      const rPending = pendingStart.filter(p => p.region === r);
      const rVisits = completedThisWeek.filter(v => v.region === r);
      return {
        region: r,
        active: rActive.length,
        inactiveActive: rInactive.length,
        onHold: rOnHold.length,
        pending: rPending.length,
        completedVisits: rVisits.length,
        revenueGap: rInactive.length * BLENDED_RATE * 2,
      };
    }).filter(r => r.active > 0 || r.onHold > 0 || r.pending > 0);

    // 2026-05-31 CEO redesign: census WoW proxy using statusLog. Honest
    // "delta" since census is point-in-time, not a snapshot — we count
    // transitions INTO 'active' this week vs the prior week. Imperfect but
    // directional (and clearly labeled in the UI).
    const wk = getWeekRange(new Date(), weekOffset);
    const prevWk = getWeekRange(new Date(), weekOffset + 1);
    const wkStartMs = wk.start.getTime();
    const wkEndMs = wk.end.getTime();
    const prevStartMs = prevWk.start.getTime();
    const prevEndMs = prevWk.end.getTime();
    const newActiveThisWk = statusLog.filter(function (e) {
      if (!/active/i.test(e.new_status || '')) return false;
      if (/active/i.test(e.old_status || '')) return false; // exclude sub-active churn
      const t = e.changed_at ? new Date(e.changed_at).getTime() : 0;
      return t >= wkStartMs && t <= wkEndMs;
    }).length;
    const newActivePrevWk = statusLog.filter(function (e) {
      if (!/active/i.test(e.new_status || '')) return false;
      if (/active/i.test(e.old_status || '')) return false;
      const t = e.changed_at ? new Date(e.changed_at).getTime() : 0;
      return t >= prevStartMs && t <= prevEndMs;
    }).length;

    // Team engagement: of the coordinators on staff, how many have at least
    // one mutation in the last 2 business days? Quiet = no mutation in 2+ days.
    // Uses the already-loaded 7-day activity_log slice so no extra query.
    const twoDaysAgoMs = Date.now() - 2 * 86400000;
    const recentlyActiveNames = new Set();
    activityLog.forEach(function (a) {
      if (!a.coordinator_name) return;
      const t = a.created_at ? new Date(a.created_at).getTime() : 0;
      if (t >= twoDaysAgoMs) recentlyActiveNames.add(a.coordinator_name);
    });
    const teamSize = coordinators.length;
    const teamActive = coordinators.filter(function (c) { return recentlyActiveNames.has(c.full_name); }).length;
    const teamQuiet = Math.max(0, teamSize - teamActive);

    // Prior-week team engagement proxy: coords active in 7-day window minus
    // those active in last 2 days. Imperfect (overlapping windows), but
    // gives a sense of whether more or fewer people are showing up this week.
    const sevenDaysAgoMs = Date.now() - 7 * 86400000;
    const last7Names = new Set();
    activityLog.forEach(function (a) {
      if (!a.coordinator_name) return;
      const t = a.created_at ? new Date(a.created_at).getTime() : 0;
      if (t >= sevenDaysAgoMs && t < twoDaysAgoMs) last7Names.add(a.coordinator_name);
    });
    const teamActivePrev5d = coordinators.filter(function (c) { return last7Names.has(c.full_name); }).length;

    // Pipeline stalled count + "newly stalled this week" proxy from status_log
    const stuck = census.filter(function (p) {
      const s = p.status || '';
      const d = p.status_changed_at ? Math.ceil((Date.now() - new Date(p.status_changed_at).getTime()) / 86400000) : null;
      if (d === null) return false;
      if (/soc.*pending/i.test(s)) return d > 3;
      if (/auth.*pending/i.test(s) && !/active/i.test(s)) return d > 5;
      if (/eval.*pending/i.test(s)) return d > 2;
      return false;
    });

    return {
      active: active.length, inactiveActive, onHoldPts, pendingStart,
      completedThisWeek, cancelledThisWeek, missedThisWeek, rawCompleted,
      weeklyRevenue, revenueGap, inactiveRevGap,
      urgentAuths, highAuths, underutilized, onHoldOverdue,
      dischargeOverdue, waitlistUnassigned, regionData,
      clinicianCapacity: clinicians.reduce((s, c) => s + (c.weekly_visit_target || 0), 0),
      cancelRate: completedThisWeek.length > 0 ? Math.round((cancelledThisWeek.length / (completedThisWeek.length + cancelledThisWeek.length + missedThisWeek.length)) * 100) : 0,
      // CEO-strip additions
      newActiveThisWk, newActivePrevWk,
      teamSize, teamActive, teamQuiet, teamActivePrev5d,
      stuck,
    };
  }, [census, visits, authRenewals, onHold, waitlist, clinicians, discharges, statusLog, activityLog, coordinators, weekOffset]);

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Director Command" subtitle="Loading live data..." />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:32, marginBottom:8 }}>⚡</div>
          <div>Pulling live operations data...</div>
        </div>
      </div>
    </div>
  );

  const m = metrics;
  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  const totalInactiveGap = m.inactiveActive.length * BLENDED_RATE * 2;

  // Days left in week (counts Mon-Sun = 7; if today is Wed = 4 days left)
  const now = new Date();
  const dow = now.getDay(); // 0=Sun
  const daysLeftInWeek = dow === 0 ? 0 : 7 - dow;

  // For the hero headline sentence — needs proxies for "P1 exceptions" and
  // "red managers". We compute lightweight versions here so we don't need to
  // round-trip through the ExceptionFeed/ManagerScorecards components.
  function _stuckPatients() {
    return census.filter(function(p) {
      var s = p.status || '';
      var d = p.status_changed_at ? Math.ceil((Date.now() - new Date(p.status_changed_at).getTime()) / 86400000) : null;
      if (d === null) return false;
      if (/soc.*pending/i.test(s)) return d > 3;
      if (/auth.*pending/i.test(s) && !/active/i.test(s)) return d > 5;
      if (/eval.*pending/i.test(s)) return d > 2;
      return false;
    });
  }
  const headlineP1Count = (() => {
    // P1 proxy: dead spots + unassigned-stuck-7d+ + inactive coords 48h+
    var stuck = _stuckPatients();
    var unassignedDeep = stuck.filter(function(p) {
      var d = Math.ceil((Date.now() - new Date(p.status_changed_at).getTime()) / 86400000);
      return !p.pipeline_assigned_to && d >= 7;
    }).length;
    // Dead spots — count stuck patients whose owner has zero activity in 48h
    var coordLast = {};
    activityLog.forEach(function(a) {
      if (!a.coordinator_name) return;
      if (!coordLast[a.coordinator_name] || a.created_at > coordLast[a.coordinator_name]) {
        coordLast[a.coordinator_name] = a.created_at;
      }
    });
    var deadSpots = stuck.filter(function(p) {
      if (!p.pipeline_assigned_to) return false;
      var last = coordLast[p.pipeline_assigned_to];
      if (!last) return true;
      var hrs = (Date.now() - new Date(last).getTime()) / 3600000;
      return hrs >= 48;
    }).length;
    return unassignedDeep + deadSpots;
  })();
  const headlineRedManagerCount = (() => {
    // Red proxy: managers whose span has median stuck > 7d
    // We approximate by counting ADs whose region spans have any patient
    // stuck > 7d (the simpler and faster proxy than rebuilding the full
    // scorecard math here).
    var byRegionStuckDays = {};
    _stuckPatients().forEach(function(p) {
      var d = Math.ceil((Date.now() - new Date(p.status_changed_at).getTime()) / 86400000);
      if (!byRegionStuckDays[p.region]) byRegionStuckDays[p.region] = [];
      byRegionStuckDays[p.region].push(d);
    });
    function medianArr(arr) {
      var s = arr.slice().sort(function(a,b){return a-b;});
      var k = Math.floor(s.length / 2);
      return s.length % 2 === 0 ? Math.round((s[k-1] + s[k]) / 2) : s[k];
    }
    var redCount = 0;
    // FL_PARENT_REGIONS check — inline here to avoid pulling in another import
    var parents = { 'FL North': ['B','C','G'], 'FL Central': ['A','H','M','N'], 'FL South': ['J','T','V'] };
    Object.values(parents).forEach(function(regions) {
      var pool = [];
      regions.forEach(function(r) { if (byRegionStuckDays[r]) pool = pool.concat(byRegionStuckDays[r]); });
      if (pool.length > 0 && medianArr(pool) > 7) redCount++;
    });
    return redCount;
  })();

  // Path-to-target tiles — promoted from below into the hero band
  const pathTiles = [
    {
      label: 'Current Pace',
      val: fmt$(m.weeklyRevenue),
      sub: `${m.completedThisWeek.length} visits @ $${BLENDED_RATE}`,
      color: m.weeklyRevenue >= 150000 ? '#34D399' : m.weeklyRevenue >= 100000 ? '#FBBF24' : '#F87171',
    },
    {
      label: 'Recover Inactives',
      val: `+${fmt$(totalInactiveGap)}`,
      sub: `${m.inactiveActive.length} pts × 2 visits`,
      color: '#FBBF24',
    },
    {
      label: 'Convert Pipeline',
      val: `+${fmt$(m.pendingStart.length * BLENDED_RATE * 2)}`,
      sub: `${m.pendingStart.length} SOC/Eval pending`,
      color: '#FBBF24',
    },
    {
      label: 'Full Recovery',
      val: fmt$(m.weeklyRevenue + totalInactiveGap + (m.pendingStart.length * BLENDED_RATE * 2)),
      sub: `vs ${fmt$(REVENUE_TARGET)} target`,
      color: (m.weeklyRevenue + totalInactiveGap + (m.pendingStart.length * BLENDED_RATE * 2)) >= REVENUE_TARGET ? '#34D399' : '#FBBF24',
    },
  ];

  // Score: 5 critical checks, each worth 20 pts
  const score = Math.round(
    (m.urgentAuths.length === 0 ? 20 : Math.max(0, 20 - m.urgentAuths.length * 2)) +
    (m.inactiveActive.length < 50 ? 20 : Math.max(0, 20 - Math.round((m.inactiveActive.length - 50) / 10))) +
    (m.onHoldOverdue.length === 0 ? 20 : Math.max(0, 20 - m.onHoldOverdue.length)) +
    (m.completedThisWeek.length >= 600 ? 20 : Math.round((m.completedThisWeek.length / 600) * 20)) +
    (m.cancelRate < 8 ? 20 : Math.max(0, 20 - (m.cancelRate - 8) * 2))
  );
  const scoreColor = score >= 80 ? '#059669' : score >= 60 ? '#D97706' : '#DC2626';

  // ── "Needs You Today" — unified, ranked top 5 ───────────────────────────
  // Pull from every alert source the dashboard already loads, score each by
  // severity + dollar impact, take the top 5. Hard cap = 5. The point is a
  // CEO who can act on the morning's 5 most important calls in 60 seconds —
  // not scroll a 50-item queue.
  const needsYouToday = (function () {
    const items = [];
    // P1: urgent auth renewals (≤7d expiry or ≤4 visits remaining)
    m.urgentAuths.slice(0, 5).forEach(function (a) {
      items.push({
        severity: 'p1',
        score: 100 - (a.days_until_expiry || 0),
        title: `Auth renewal expires in ${a.days_until_expiry}d — ${a.patient_name}`,
        detail: `${a.visits_remaining} visits left · Rgn ${a.region} · est $${(a.visits_remaining * BLENDED_RATE).toLocaleString()} at risk`,
        actionLabel: 'Open auth',
        target: 'auth-renewals',
      });
    });
    // P1: red manager region (median stuck >7d in a parent region)
    if (headlineRedManagerCount > 0) {
      items.push({
        severity: 'p1',
        score: 95,
        title: `${headlineRedManagerCount} manager${headlineRedManagerCount === 1 ? '' : 's'} in red`,
        detail: 'Parent region with median patient stuck >7 days. Review scorecards.',
        actionLabel: 'Scorecards',
        target: 'ops-dashboard',
      });
    }
    // HIGH: inactive actives generating $0 (top 1 line aggregating, plus 1 patient-detail row if egregious)
    if (m.inactiveActive.length > 0) {
      items.push({
        severity: 'high',
        score: 80 + Math.min(15, Math.floor(m.inactiveActive.length / 10)),
        title: `${m.inactiveActive.length} active patients not seen past their frequency`,
        detail: `${fmt$(totalInactiveGap)}/wk revenue idle · sort census by Last Seen`,
        actionLabel: 'Open census',
        target: 'census',
      });
    }
    // HIGH: on-hold overdue (>21d on hold — need recovery call)
    if (m.onHoldOverdue.length > 0) {
      items.push({
        severity: 'high',
        score: 70 + Math.min(15, m.onHoldOverdue.length),
        title: `${m.onHoldOverdue.length} patients on hold >21 days`,
        detail: 'Recovery calls needed to convert back to active or discharge.',
        actionLabel: 'On-hold',
        target: 'on-hold',
      });
    }
    // MEDIUM: pipeline stalled (SOC/Auth/Eval Pending past threshold)
    if (m.stuck && m.stuck.length > 0) {
      items.push({
        severity: 'medium',
        score: 50 + Math.min(20, m.stuck.length),
        title: `${m.stuck.length} pipeline patients stalled`,
        detail: `Won't bill until first visit · est $${(m.pendingStart.length * BLENDED_RATE * 2).toLocaleString()}/wk if converted`,
        actionLabel: 'Pipeline',
        target: 'pipeline',
      });
    }
    // MEDIUM: team engagement — coordinators quiet >2 days
    if (m.teamQuiet >= 3) {
      items.push({
        severity: 'medium',
        score: 45 + m.teamQuiet,
        title: `${m.teamQuiet} of ${m.teamSize} coordinators quiet >2 days`,
        detail: 'No mutations logged. Spot-check before standup.',
        actionLabel: 'Engagement',
        target: 'ops-dashboard',
      });
    }
    // Sort by score desc, take top 5
    return items.sort(function (a, b) { return b.score - a.score; }).slice(0, 5);
  })();

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%', background:'var(--bg)' }}>
      <TopBar
        title="Director Command"
        subtitle={today}
        actions={
          <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
            {/* 2026-05-31 CEO redesign: state toggle auto-hides until Georgia
                has ≥10 active patients (see StateToggle). Until then, the
                page reads exactly as it always has — no visible control,
                queries unfiltered. Wiring is in place; rendering is gated. */}
            <StateToggle
              value={stateFilter}
              onChange={setStateFilter}
              storageKey="directorCommand"
              stateToRegions={mapping.stateToRegions}
            />
            {/* Week toggle — 2026-05-31. Persists last-viewed week so a
                refresh mid-investigation doesn't snap back to this week. */}
            <WeekSelector
              value={weekOffset}
              onChange={setWeekOffset}
              storageKey="directorCommand"
              allowFuture={false}
            />
            {lastRefresh && <span style={{ fontSize:10, color:'var(--gray)' }}>Updated {lastRefresh.toLocaleTimeString()}</span>}
            <button onClick={load} style={{ padding:'6px 14px', background:'#0F1117', color:'#fff', border:'none', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer' }}>
              ↻ Refresh
            </button>
          </div>
        }
      />

      <div style={{ flex:1, overflowY:'auto', padding:20, display:'flex', flexDirection:'column', gap:20 }}>

        {/* ═══════════════════════════════════════════════════════════════
            DIRECTOR COMMAND v3 — CEO Subtractive Layout (2026-05-31)
            Design doc: docs/CEO_Dashboard_Design.md §3
            Liam's directive: "CEO-level means LESS on screen, not more."
            Visible-above-fold:
              1. HERO          → revenue mega + ops score + WoW + summary
              2. CEO KPI STRIP → 5 tiles, all clickable, all with deltas
              3. NEEDS YOU TODAY → top 5 ranked, 1-line each, max 5
              4. DETAIL (collapsed) → everything else, one click away:
                 ExceptionFeed, ManagerScorecards, Visit Pulse,
                 ExpansionStatus, Triage 5, Region Health, Auth, Clinician,
                 Path-to-$200K
            Underlying components (ExceptionFeed, ManagerScorecards) are
            NOT modified — they're wrapped inside the collapse so other
            pages that import them keep working unchanged.
            ═══════════════════════════════════════════════════════════════ */}

        {/* ─── 1. HERO BAND ──────────────────────────────────────────── */}
        <HeroBand
          weeklyRevenue={m.weeklyRevenue}
          target={REVENUE_TARGET}
          score={score}
          scoreColor={scoreColor}
          p1Count={headlineP1Count}
          redManagerCount={headlineRedManagerCount}
          daysLeftInWeek={daysLeftInWeek}
          pathTiles={pathTiles}
          wow={wow}
          isPastWeek={weekOffset > 0}
        />

        {/* ─── 2. CEO KPI STRIP — 5 tiles, all clickable, all delta'd ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          {/* Visits — clean WoW from prevVisits */}
          <CeoKpiTile
            label="Visits This Week"
            value={m.completedThisWeek.length.toLocaleString()}
            sub={`of ${WEEKLY_TARGET} target · ${Math.round((m.completedThisWeek.length/WEEKLY_TARGET)*100)}%`}
            deltaText={wow && wow.completed > 0 ? `${Math.abs(m.completedThisWeek.length - wow.completed)} vs prior` : null}
            deltaDirection={wow && wow.completed > 0 ? (m.completedThisWeek.length >= wow.completed ? 'up' : 'down') : null}
            color={m.completedThisWeek.length >= WEEKLY_TARGET ? '#059669' : '#0F1117'}
            accent="#059669"
            onClick={() => go('visits')}
          />
          {/* Active Census — delta from status_log transitions into 'active' */}
          <CeoKpiTile
            label="Active Census"
            value={m.active.toLocaleString()}
            sub={`+${m.newActiveThisWk} new this wk · vs ${m.newActivePrevWk} prior`}
            deltaText={m.newActivePrevWk > 0 || m.newActiveThisWk > 0 ? `${Math.abs(m.newActiveThisWk - m.newActivePrevWk)} new vs prior` : null}
            deltaDirection={m.newActiveThisWk === m.newActivePrevWk ? 'flat' : (m.newActiveThisWk > m.newActivePrevWk ? 'up' : 'down')}
            accent="#1565C0"
            onClick={() => go('census')}
          />
          {/* Pipeline Stalled — count + qualified note */}
          <CeoKpiTile
            label="Pipeline Stalled"
            value={(m.stuck ? m.stuck.length : 0).toLocaleString()}
            sub={`SOC/Auth/Eval pending past threshold · ${fmt$(m.pendingStart.length * BLENDED_RATE * 2)}/wk if converted`}
            deltaText={(m.stuck && m.stuck.length > 0) ? `${m.stuck.length} open` : null}
            deltaDirection={(m.stuck && m.stuck.length > 5) ? 'down' : 'flat'}
            color={(m.stuck && m.stuck.length > 5) ? '#D97706' : '#0F1117'}
            accent="#D97706"
            onClick={() => go('pipeline')}
          />
          {/* Auth Renewals Urgent */}
          <CeoKpiTile
            label="Auth Urgent"
            value={m.urgentAuths.length.toLocaleString()}
            sub={`${m.highAuths.length} high priority also open · expiring ≤7d or ≤4 visits`}
            deltaText={m.urgentAuths.length > 0 ? `${m.urgentAuths.length} ≤7d` : null}
            deltaDirection={m.urgentAuths.length > 3 ? 'down' : (m.urgentAuths.length === 0 ? 'up' : 'flat')}
            color={m.urgentAuths.length > 3 ? '#DC2626' : '#0F1117'}
            accent="#DC2626"
            onClick={() => go('auth-renewals')}
          />
          {/* Team Engagement — active coords vs quiet, WoW from activity_log */}
          <CeoKpiTile
            label="Team Active"
            value={`${m.teamActive}/${m.teamSize}`}
            sub={`${m.teamQuiet} quiet >2d · ${m.teamActivePrev5d} active in prior 5d window`}
            deltaText={m.teamActive !== m.teamActivePrev5d ? `${Math.abs(m.teamActive - m.teamActivePrev5d)} vs prior` : null}
            deltaDirection={m.teamActive === m.teamActivePrev5d ? 'flat' : (m.teamActive > m.teamActivePrev5d ? 'up' : 'down')}
            color={m.teamQuiet > 3 ? '#D97706' : '#0F1117'}
            accent="#7C3AED"
            onClick={() => go('ops-dashboard')}
          />
        </div>

        {/* ─── 3. NEEDS YOU TODAY — top 5 ranked actions ────────────── */}
        <NeedsYouToday
          items={needsYouToday}
          onAction={(it) => { if (it && it.target) go(it.target); }}
        />

        {/* ─── 4. DETAIL — Collapsed by default. Everything below is one click. */}
        <details style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <summary style={{
            padding: '12px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#111827',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              🔎 Detail — Scorecards · Exceptions · Visit Pulse · Region Health · Auth · Clinician · Expansion
              <span style={{ fontSize: 10, fontWeight: 400, color: '#6B7280' }}>
                Folded by default · open for weekly review
              </span>
            </span>
            <span style={{ fontSize: 10, color: '#6B7280' }}>click to expand ▾</span>
          </summary>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16, borderTop: '1px solid var(--border)' }}>

        {/* MOVED INSIDE DETAIL — Manager Scorecards (formerly above-fold).
            Underlying component unchanged. Other pages that import it keep
            working. CEO sees it via the Detail expand. */}
        <ManagerScorecards
          census={census}
          statusLog={statusLog}
          activityLog={activityLog}
          coordinators={coordinators}
          onScorecardClick={(sc) => {
            if (sc.regions === 'ALL') {
              go('ops-dashboard');
            } else if (sc.regions && sc.regions.length === 1) {
              go('rm-dashboard', { region: sc.regions[0] });
            } else {
              go('rm-dashboard', { regions: sc.regions });
            }
          }}
        />

        {/* MOVED INSIDE DETAIL — Exception Feed (formerly above-fold). */}
        <ExceptionFeed
          census={census}
          activityLog={activityLog}
          coordinators={coordinators}
          onJumpTo={(target, intent) => go(target, intent)}
        />

        {/* MOVED INSIDE DETAIL — Visit Pulse strip (formerly above-fold).
            Kept as a deeper view; the CEO strip above is the at-a-glance. */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            📊 {weekOffset === 0 ? "This Week's Pulse" : (weekOffset === 1 ? "Last Week's Pulse" : `Pulse — ${getWeekRange(new Date(), weekOffset).label}`)}
            <span style={{ fontSize: 10, fontWeight: 400, color: '#6B7280' }}>
              Visit numbers · click any tile to drill in
              {wow && wow.completed > 0 && (() => {
                const d = m.completedThisWeek.length - wow.completed;
                const up = d >= 0;
                return (
                  <span style={{ marginLeft: 8, color: up ? '#059669' : '#DC2626', fontWeight: 700 }}>
                    {up ? '▲' : '▼'} {Math.abs(d)} visits vs prior week
                  </span>
                );
              })()}
            </span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10 }}>
            {[
              { label:'Completed', val:m.completedThisWeek.length, color:'#059669', sub:`of ${WEEKLY_TARGET} target`, bg:'#F0FFF4', target:'visits', hint:'visit schedule' },
              { label:'Cancelled', val:m.cancelledThisWeek.length, color:'#DC2626', sub:`${m.cancelRate}% cancel rate`, bg:m.cancelRate>10?'#FEF2F2':'var(--card-bg)', target:'missed-cancelled', hint:'missed/cancelled report' },
              { label:'Missed', val:m.missedThisWeek.length, color:'#D97706', sub:'this week', bg:m.missedThisWeek.length>30?'#FEF3C7':'var(--card-bg)', target:'missed-cancelled', hint:'missed/cancelled report' },
              { label:'Clinician Cap.', val:m.clinicianCapacity, color:'#1565C0', sub:'max visits/week', bg:'#EFF6FF', target:'staff', hint:'staff directory' },
              { label:'Utilization', val:m.clinicianCapacity > 0 ? Math.round((m.completedThisWeek.length/m.clinicianCapacity)*100)+'%' : '—', color:(m.clinicianCapacity>0 && m.completedThisWeek.length/m.clinicianCapacity>0.75)?'#059669':'#D97706', sub:`${m.completedThisWeek.length}/${m.clinicianCapacity} capacity`, bg:'var(--card-bg)', target:'clinician-accountability', hint:'by clinician' },
            ].map(c => {
              const clickable = !!c.target;
              return (
                <div key={c.label}
                  onClick={clickable ? () => go(c.target) : undefined}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onKeyDown={clickable ? e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); go(c.target); } } : undefined}
                  style={{ background:c.bg, border:'1px solid var(--border)', borderRadius:10, padding:'10px 12px', textAlign:'center', cursor: clickable ? 'pointer' : 'default', transition:'transform 0.1s ease, box-shadow 0.15s ease' }}
                  onMouseEnter={clickable ? e => { e.currentTarget.style.transform='translateY(-1px)'; e.currentTarget.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'; } : undefined}
                  onMouseLeave={clickable ? e => { e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='none'; } : undefined}>
                  <div style={{ fontSize:9, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{c.label}</div>
                  <div style={{ fontSize:24, fontWeight:900, fontFamily:'DM Mono, monospace', color:c.color, marginTop:2 }}>{c.val}</div>
                  <div style={{ fontSize:9, color:'var(--gray)', marginTop:1 }}>{c.sub}</div>
                  {clickable && (
                    <div style={{ fontSize:8, color:c.color, marginTop:3, opacity:0.65, fontWeight:600 }}>open {c.hint} →</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* INSIDE DETAIL — Expansion Status (Georgia + future states).
            Lives in Detail so the CEO has context on expansion momentum
            without the FL/GA toggle ever showing an empty GA tab.        */}
        <ExpansionStatus territories={mapping.territories} />

        {/* TRIAGE — 5 Priority Actions */}
        <div>
          <div style={{ fontSize:13, fontWeight:800, color:'#0F1117', marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ background:'#DC2626', color:'#fff', borderRadius:5, padding:'2px 8px', fontSize:11 }}>TRIAGE</span>
            Today's 5 Priority Actions
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10 }}>
            <TriageCard
              rank={1} urgent
              title="Active Patients Not Seen 14+ Days"
              count={m.inactiveActive.length}
              subtitle="Generating $0 despite Active status"
              color="#DC2626" bg="#FEF2F2" border="#FECACA"
              detail={`${fmt$(totalInactiveGap)}/wk revenue sitting idle`}
              actionLabel="Open Census → Sort Last Seen"
              action={() => go('census', { lastSeen: 'overdue', status: 'active' })}
            />
            <TriageCard
              rank={2} urgent
              title="Auth Renewals — Urgent"
              count={m.urgentAuths.length}
              subtitle="Expiring ≤7 days or ≤4 visits left"
              color="#DC2626" bg="#FFF5F5" border="#FECACA"
              detail={`+${m.highAuths.length} high priority also open`}
              actionLabel="Open Auth Renewals"
              action={() => go('auth-renewals')}
            />
            <TriageCard
              rank={3}
              title="Pipeline Stall — Accepted Not Started"
              count={m.pendingStart.length}
              subtitle="SOC/Eval Pending — won't bill until first visit"
              color="#D97706" bg="#FEF3C7" border="#FCD34D"
              detail={`${fmt$(m.pendingStart.length * BLENDED_RATE * 2)}/wk potential if started`}
              actionLabel="Open SOC → Active Pipeline"
              action={() => go('pipeline')}
            />
            <TriageCard
              rank={4}
              title="Underutilized Clinicians"
              count={m.underutilized.length}
              subtitle="Below 60% of weekly visit target"
              color="#7C3AED" bg="#F5F3FF" border="#DDD6FE"
              detail="Capacity exists — needs patient assignment"
              actionLabel="Open Clinician Accountability"
              action={() => go('clinician-accountability')}
            />
            <TriageCard
              rank={5}
              title="On-Hold Patients"
              count={m.onHoldPts.length}
              subtitle={`${m.onHoldOverdue.length} over 21 days — need recovery call`}
              color="#1565C0" bg="#EFF6FF" border="#BFDBFE"
              detail={`${m.waitlistUnassigned.length} waitlist patients unassigned`}
              actionLabel="Open On-Hold Recovery"
              action={() => go('on-hold')}
            />
          </div>
        </div>

        {/* Revenue Gap by Region */}
        <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ fontSize:13, fontWeight:800, color:'#0F1117' }}>Region Health & Revenue Gap</div>
            <div style={{ fontSize:11, color:'var(--gray)' }}>Activity rate = active patients seen within their prescribed frequency</div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'0.5fr 0.7fr 1.2fr 0.7fr 0.7fr 0.7fr 0.9fr', padding:'7px 16px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:9, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', gap:8 }}>
            <span>Region</span><span>Active</span><span>Activity Rate</span><span>Inactive</span><span>On Hold</span><span>Pending</span><span>Rev Gap/Wk</span>
          </div>
          {m.regionData.map(r => (
            <RegionRow key={r.region} {...r} />
          ))}
          <div style={{ padding:'10px 16px', background:'#F8F9FF', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'space-between', fontSize:11 }}>
            <span style={{ fontWeight:700 }}>Total</span>
            <span style={{ color:'var(--gray)' }}>{m.active} active</span>
            <span style={{ color:'var(--gray)' }}></span>
            <span style={{ color:'#DC2626', fontWeight:700 }}>{m.inactiveActive.length} overdue vs freq</span>
            <span style={{ color:'var(--gray)' }}>{m.onHoldPts.length}</span>
            <span style={{ color:'var(--gray)' }}>{m.pendingStart.length}</span>
            <span style={{ color:'#DC2626', fontWeight:700 }}>-{fmt$(totalInactiveGap)}/wk</span>
          </div>
        </div>

        {/* Auth Renewals Snapshot + Clinician Underutilization side by side */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          {/* Auth snapshot */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontSize:13, fontWeight:800 }}>🔄 Auth Renewals at Risk</div>
              <div style={{ fontSize:11 }}>
                <span style={{ color:'#DC2626', fontWeight:700 }}>{m.urgentAuths.length} urgent</span>
                <span style={{ color:'var(--gray)' }}> · {m.highAuths.length} high</span>
              </div>
            </div>
            {m.urgentAuths.length === 0 && m.highAuths.length === 0 ? (
              <div style={{ padding:24, textAlign:'center', color:'#059669', fontWeight:700, fontSize:13 }}>✅ No urgent renewals — all clear</div>
            ) : (
              <div style={{ maxHeight:240, overflowY:'auto' }}>
                {[...m.urgentAuths, ...m.highAuths].slice(0,8).map((a, i) => (
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr auto auto auto', padding:'8px 14px', borderBottom:'1px solid var(--border)', gap:10, alignItems:'center', background:a.priority==='urgent'?'#FFF5F5':'var(--card-bg)' }}>
                    <div>
                      <div style={{ fontSize:11, fontWeight:600 }}>{a.patient_name}</div>
                      <div style={{ fontSize:9, color:'var(--gray)' }}>Rgn {a.region}</div>
                    </div>
                    <span style={{ fontSize:10, fontWeight:700, color:a.priority==='urgent'?'#DC2626':'#D97706', background:a.priority==='urgent'?'#FEF2F2':'#FEF3C7', padding:'2px 6px', borderRadius:999 }}>
                      {a.priority}
                    </span>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontSize:11, fontWeight:700, color:a.days_until_expiry<=7?'#DC2626':'#D97706' }}>{a.days_until_expiry}d</div>
                      <div style={{ fontSize:9, color:'var(--gray)' }}>left</div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontSize:11, fontWeight:700, color:a.visits_remaining<=4?'#DC2626':'#D97706' }}>{a.visits_remaining}</div>
                      <div style={{ fontSize:9, color:'var(--gray)' }}>visits</div>
                    </div>
                  </div>
                ))}
                {(m.urgentAuths.length + m.highAuths.length) > 8 && (
                  <div style={{ padding:'8px 14px', fontSize:11, color:'var(--gray)', textAlign:'center' }}>+{(m.urgentAuths.length + m.highAuths.length) - 8} more — open Auth Renewals page</div>
                )}
              </div>
            )}
          </div>

          {/* Clinician underutilization */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontSize:13, fontWeight:800 }}>👤 Clinicians Under 60% Utilization</div>
              <div style={{ fontSize:11, color:'#7C3AED', fontWeight:700 }}>{m.underutilized.length} clinicians</div>
            </div>
            {m.underutilized.length === 0 ? (
              <div style={{ padding:24, textAlign:'center', color:'#059669', fontWeight:700, fontSize:13 }}>✅ All clinicians above 60% — strong week</div>
            ) : (
              <div style={{ maxHeight:240, overflowY:'auto' }}>
                {(() => {
                  const visitMap = {};
                  (m.rawCompleted || []).forEach(v => {
                    const k = (v.staff_name || '').toLowerCase().trim();
                    visitMap[k] = (visitMap[k] || 0) + 1;
                  });
                  return m.underutilized.slice(0, 8).map((cl, i) => {
                    const done = visitMap[(cl.full_name || '').toLowerCase().trim()] || 0;
                    const pct = Math.round((done / cl.weekly_visit_target) * 100);
                    return (
                      <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr auto auto', padding:'8px 14px', borderBottom:'1px solid var(--border)', gap:10, alignItems:'center' }}>
                        <div>
                          <div style={{ fontSize:11, fontWeight:600 }}>{cl.full_name}</div>
                          <div style={{ fontSize:9, color:'var(--gray)' }}>{cl.discipline} · Rgn {cl.region}</div>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:12, fontWeight:700, color:pct<30?'#DC2626':'#D97706' }}>{done}/{cl.weekly_visit_target}</div>
                          <div style={{ fontSize:9, color:'var(--gray)' }}>visits</div>
                        </div>
                        <div style={{ width:40, textAlign:'right' }}>
                          <div style={{ fontSize:12, fontWeight:900, fontFamily:'DM Mono, monospace', color:pct<30?'#DC2626':'#D97706' }}>{pct}%</div>
                        </div>
                      </div>
                    );
                  });
                })()}
                {m.underutilized.length > 8 && (
                  <div style={{ padding:'8px 14px', fontSize:11, color:'var(--gray)', textAlign:'center' }}>+{m.underutilized.length - 8} more — open Staff Directory</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Path to $200K — kept as full breakdown inside Detail. The compressed
            version lives in the HeroBand for the daily-glance view; this version
            keeps the original label phrasing for the weekly-review context.   */}
        <div style={{ background:'#0F1117', borderRadius:12, padding:'16px 20px', color:'#fff' }}>
          <div style={{ fontSize:12, fontWeight:800, color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 }}>
            📈 Path to $200K Weekly Revenue — Full Breakdown
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
            {[
              {
                label: 'Current Revenue Pace',
                val: fmt$(m.weeklyRevenue),
                sub: `${m.completedThisWeek.length} visits @ $${BLENDED_RATE}`,
                color: m.weeklyRevenue >= 150000 ? '#34D399' : m.weeklyRevenue >= 100000 ? '#FBBF24' : '#F87171',
              },
              {
                label: 'Recover Inactive Actives',
                val: `+${fmt$(totalInactiveGap)}`,
                sub: `${m.inactiveActive.length} patients × 2 visits × $${BLENDED_RATE}`,
                color: '#FBBF24',
              },
              {
                label: 'Convert Pipeline',
                val: `+${fmt$(m.pendingStart.length * BLENDED_RATE * 2)}`,
                sub: `${m.pendingStart.length} SOC/Eval pending × 2 visits`,
                color: '#FBBF24',
              },
              {
                label: 'Projected at Full Recovery',
                val: fmt$(m.weeklyRevenue + totalInactiveGap + (m.pendingStart.length * BLENDED_RATE * 2)),
                sub: `vs $${(REVENUE_TARGET/1000).toFixed(0)}K target`,
                color: (m.weeklyRevenue + totalInactiveGap + (m.pendingStart.length * BLENDED_RATE * 2)) >= REVENUE_TARGET ? '#34D399' : '#FBBF24',
              },
            ].map(item => (
              <div key={item.label} style={{ background:'rgba(255,255,255,0.06)', borderRadius:8, padding:'12px 14px' }}>
                <div style={{ fontSize:9, fontWeight:700, color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>{item.label}</div>
                <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', color:item.color, lineHeight:1 }}>{item.val}</div>
                <div style={{ fontSize:9, color:'rgba(255,255,255,0.35)', marginTop:4 }}>{item.sub}</div>
              </div>
            ))}
          </div>
        </div>

          </div>
        </details>

      </div>
    </div>
  );
}
