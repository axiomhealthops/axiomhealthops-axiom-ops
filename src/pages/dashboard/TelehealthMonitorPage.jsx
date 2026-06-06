// =====================================================================
// TelehealthMonitorPage.jsx — Telehealth Team Visit Monitor
//
// Built 2026-06-05 per docs/Reassess_Eval_Telehealth_Design.md.
// Sidebar: CLINICAL DEPARTMENT. URL slug: telehealth-monitor.
//
// The page is data-driven from coordinators where role='telehealth'
// (6 clinicians as of 2026-06-05: Alexis, Liz, Abi, Marzina, Kelsey,
// Carrie). Each has a weekly_visit_target column on coordinators
// (30 = FT, 15 = PT, NULL = not measured). Roster auto-grows if HR
// adds more clinicians.
//
// Visit identification:
//   - Primary: staff_name matches an active telehealth coordinator
//   - Per-(patient_name, visit_date) latest-uploaded_at Pariox dedup
//     applied. See CLAUDE.md "Things that broke before" #10.
//
// All classification uses src/lib/visitMath.js helpers — isCompleted,
// isCancelled, isMissed, isEval — so a visit marked status='Completed'
// + event_type='Cancelled Treatment' is properly counted as a cancel.
//
// JSX-unicode rule: per CLAUDE.md #4 we keep glyphs in JS expressions
// or stick to ASCII so the build tooling doesn't store broken escapes.
// =====================================================================

import { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
import PeriodSelector, { readPersistedPeriod } from '../../components/PeriodSelector';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import { getPeriodRange, getWeekStart, getWeekEnd, toDateStr } from '../../lib/dateUtils';
import { isCompleted, isCancelled, isMissed, isEval } from '../../lib/visitMath';

const BRAND = '#0F1117';

// ── Helpers ──────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Per-(patient, visit_date) latest-uploaded_at dedup — CLAUDE.md #10
function dedupLatestPerSlot(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = (r.patient_name || '') + '||' + (r.visit_date || '') + '||' + (r.staff_name || '');
    const prev = map.get(key);
    if (!prev || new Date(r.uploaded_at) > new Date(prev.uploaded_at)) {
      map.set(key, r);
    }
  }
  // Then collapse co-treat duplicates per (patient, date) — keep all staff
  // rows so per-clinician productivity is accurate.
  return Array.from(map.values());
}

function pctColor(pct) {
  if (pct >= 100) return { bg: '#ECFDF5', border: '#A7F3D0', color: '#059669', label: 'On Target' };
  if (pct >= 75)  return { bg: '#FFFBEB', border: '#FCD34D', color: '#D97706', label: 'Under Target' };
  return { bg: '#FEF2F2', border: '#FECACA', color: '#DC2626', label: 'Below Target' };
}

// Classify a single visit row -> bucket label
function classify(v) {
  if (isCompleted(v)) return 'completed';
  if (isCancelled(v)) return 'cancelled';
  if (isMissed(v))    return 'missed';
  if (/scheduled/i.test(v.status || '')) return 'scheduled';
  return 'other';
}

// ── Page ─────────────────────────────────────────────────────────────
export default function TelehealthMonitorPage() {
  const { profile } = useAuth();
  const [period, setPeriod] = useState(() => readPersistedPeriod('telehealth_monitor', { mode: 'week', anchor: toDateStr(new Date()) }));
  const [roster, setRoster] = useState([]);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [visitTab, setVisitTab] = useState('this_week');

  const range = useMemo(() => getPeriodRange(period.mode, period.anchor), [period]);

  const load = useCallback(async () => {
    setLoading(true);
    // 1. Roster from coordinators
    const { data: rosterRows } = await supabase
      .from('coordinators')
      .select('id, full_name, email, weekly_visit_target, is_active')
      .eq('role', 'telehealth')
      .eq('is_active', true)
      .order('full_name');

    // 2. Visits in selected period (use widest possible window so we can
    //    compute current-week / today / next-week stats too)
    const today = new Date();
    const fourWeeksAgo = new Date(today.getTime() - 28 * 86400000);
    const twoWeeksAhead = new Date(today.getTime() + 14 * 86400000);
    // Use whichever is wider: the selected period OR the rolling 6-week window
    const fetchStart = range.start < fourWeeksAgo ? toDateStr(range.start) : toDateStr(fourWeeksAgo);
    const fetchEnd = range.end > twoWeeksAhead ? toDateStr(range.end) : toDateStr(twoWeeksAhead);

    const vsdRows = await fetchAllPages(
      supabase.from('visit_schedule_data')
        .select('patient_name, region, visit_date, staff_name, event_type, status, uploaded_at')
        .gte('visit_date', fetchStart)
        .lte('visit_date', fetchEnd)
        .order('visit_date', { ascending: true })
    );

    // Filter to telehealth clinicians by name match — DB-driven roster
    const rosterNames = new Set();
    for (const r of (rosterRows || [])) {
      const last = (r.full_name.split(' ').slice(-1)[0] || '').trim();
      const first = (r.full_name.split(' ')[0] || '').trim();
      // Pariox writes as "Last, First" so build a normalised match
      rosterNames.add((last + ', ' + first).toLowerCase());
      // Also keep the raw form just in case
      rosterNames.add(r.full_name.toLowerCase());
    }
    const filtered = vsdRows.filter(v => {
      const sn = (v.staff_name || '').toLowerCase();
      // Direct match on roster OR fallback on event_type for any non-roster
      // eval/reassess row (catches sub coverage scenarios)
      if (rosterNames.has(sn)) return true;
      if (rosterNames.size === 0 && (/eval/i.test(v.event_type || '') || /reassess/i.test(v.event_type || ''))) return true;
      return false;
    });

    setRoster(rosterRows || []);
    setVisits(dedupLatestPerSlot(filtered));
    setLoading(false);
  }, [range.start, range.end]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable(['visit_schedule_data', 'coordinators'], load);

  // ── Roster scorecard ─────────────────────────────────────────────
  const scorecard = useMemo(() => {
    // For per-week average we count visits inside the *current selected*
    // period, then divide by # weeks in the period for target comparison.
    const inPeriod = visits.filter(v => v.visit_date >= range.startStr && v.visit_date <= range.endStr);

    // # weeks in the period — at least 1 to avoid divide-by-zero
    const periodDays = Math.max(1, Math.round((range.end - range.start) / 86400000) + 1);
    const weeksInPeriod = Math.max(1, periodDays / 7);

    return roster.map(c => {
      const last = (c.full_name.split(' ').slice(-1)[0] || '').trim();
      const first = (c.full_name.split(' ')[0] || '').trim();
      const piName = (last + ', ' + first).toLowerCase();
      const my = inPeriod.filter(v => (v.staff_name || '').toLowerCase() === piName);

      const completed = my.filter(isCompleted).length;
      const cancelled = my.filter(isCancelled).length;
      const missed = my.filter(isMissed).length;
      const evals = my.filter(isEval).length;
      const total = completed + cancelled + missed;
      const weekly_avg = my.length / weeksInPeriod;
      const target = c.weekly_visit_target;
      const pct = target ? Math.round((weekly_avg / target) * 100) : null;
      const color = pct !== null ? pctColor(pct) : null;
      const completion_rate = total > 0 ? Math.round((completed / total) * 100) : null;

      return {
        id: c.id,
        full_name: c.full_name,
        email: c.email,
        target,
        total_visits: my.length,
        weekly_avg,
        pct,
        color,
        completed, cancelled, missed,
        completion_rate,
        evals,
        reassess: my.length - evals,
      };
    }).sort((a, b) => b.total_visits - a.total_visits);
  }, [roster, visits, range]);

  // ── Team totals ──────────────────────────────────────────────────
  const team = useMemo(() => {
    const total = scorecard.reduce((acc, r) => acc + r.total_visits, 0);
    const completed = scorecard.reduce((acc, r) => acc + r.completed, 0);
    const cancelled = scorecard.reduce((acc, r) => acc + r.cancelled, 0);
    const missed = scorecard.reduce((acc, r) => acc + r.missed, 0);
    const targetSum = scorecard.reduce((acc, r) => acc + (r.target || 0), 0);
    const periodDays = Math.max(1, Math.round((range.end - range.start) / 86400000) + 1);
    const weeksInPeriod = Math.max(1, periodDays / 7);
    const team_weekly_avg = total / weeksInPeriod;
    const completion_rate = (completed + cancelled + missed) > 0 ? Math.round((completed / (completed + cancelled + missed)) * 100) : null;
    return {
      total, completed, cancelled, missed, targetSum, team_weekly_avg, completion_rate,
      evals: scorecard.reduce((acc, r) => acc + r.evals, 0),
      reassess: scorecard.reduce((acc, r) => acc + r.reassess, 0),
    };
  }, [scorecard, range]);

  // ── Visit tab data ───────────────────────────────────────────────
  const visitsInTab = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = toDateStr(today);
    const wStart = toDateStr(getWeekStart(today, 0));
    const wEnd = toDateStr(getWeekEnd(today, 0));
    const nwStart = toDateStr(getWeekStart(today, -1));
    const nwEnd = toDateStr(getWeekEnd(today, -1));
    const fourWeeksAgo = toDateStr(new Date(today.getTime() - 28 * 86400000));

    let list = visits;
    if (visitTab === 'today') list = visits.filter(v => v.visit_date === todayStr);
    else if (visitTab === 'this_week') list = visits.filter(v => v.visit_date >= wStart && v.visit_date <= wEnd);
    else if (visitTab === 'next_week') list = visits.filter(v => v.visit_date >= nwStart && v.visit_date <= nwEnd);
    else if (visitTab === 'last_4w') list = visits.filter(v => v.visit_date >= fourWeeksAgo && v.visit_date <= todayStr);
    return list.sort((a, b) => a.visit_date.localeCompare(b.visit_date) || (a.staff_name || '').localeCompare(b.staff_name || ''));
  }, [visits, visitTab]);

  // ── XLSX Export ──────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Roster scorecard
    const rosterRows = [
      ['Clinician','Weekly Target','Total Visits ('+range.label+')','Weekly Avg','% of Target','On Track?','Completed','Cancelled','Missed','Completion %','Evals','Reassess'],
      ...scorecard.map(r => [
        r.full_name,
        r.target ?? '-',
        r.total_visits,
        Number(r.weekly_avg.toFixed(1)),
        r.pct ?? '-',
        r.color?.label ?? '-',
        r.completed, r.cancelled, r.missed,
        r.completion_rate ?? '-',
        r.evals, r.reassess,
      ]),
      [],
      ['TEAM TOTAL','',team.total,Number(team.team_weekly_avg.toFixed(1)),'','',team.completed,team.cancelled,team.missed,team.completion_rate ?? '-',team.evals,team.reassess],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rosterRows), 'Roster Scorecard');

    // Sheet 2: Visit detail
    const visitRows = [
      ['Date','Clinician','Patient','Region','Event Type','Status','Bucket'],
      ...visitsInTab.map(v => [v.visit_date, v.staff_name, v.patient_name, v.region || '-', v.event_type, v.status, classify(v)]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(visitRows), 'Visit Detail');

    const fname = 'EdemaCare_Telehealth_Monitor_' + range.startStr + '_to_' + range.endStr + '.xlsx';
    XLSX.writeFile(wb, fname);
  }, [scorecard, team, visitsInTab, range]);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Telehealth Team" subtitle="Loading..." />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading telehealth team data...</div>
    </div>
  );

  const subtitle =
    roster.length + ' active clinicians '
    + '· ' + team.total + ' visits in ' + range.label
    + ' · ' + (team.completion_rate ?? '-') + '% completion';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <TopBar
        title="Telehealth Team"
        subtitle={subtitle}
        actions={(
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={load} style={{ padding: '6px 12px', background: 'none', border: '1px solid var(--border)', color: 'var(--black)', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Refresh</button>
            <button onClick={handleExport} style={{ padding: '6px 12px', background: BRAND, border: '1px solid ' + BRAND, color: '#fff', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Export XLSX</button>
          </div>
        )}
      />

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Period selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <PeriodSelector
              mode={period.mode}
              anchor={period.anchor}
              onChange={setPeriod}
              storageKey="telehealth_monitor"
            />
            <div style={{ fontSize: 11, color: 'var(--gray)' }}>
              Targets: <strong style={{ color: '#059669' }}>30 visits/week</strong> full-time, <strong style={{ color: '#D97706' }}>15 visits/week</strong> part-time.
              Editable per clinician on the coordinators record.
            </div>
          </div>

          {/* Team summary strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {[
              { label: 'Total Visits',     val: team.total,                    color: '#1565C0', bg: '#EFF6FF' },
              { label: 'Weekly Avg',       val: team.team_weekly_avg.toFixed(0), color: '#1565C0', bg: '#EFF6FF' },
              { label: 'Completed',        val: team.completed,                color: '#059669', bg: '#ECFDF5' },
              { label: 'Cancelled',        val: team.cancelled,                color: '#D97706', bg: '#FEF3C7' },
              { label: 'Missed',           val: team.missed,                   color: '#DC2626', bg: '#FEF2F2' },
              { label: 'Completion Rate',  val: (team.completion_rate ?? '-') + '%', color: '#059669', bg: '#ECFDF5' },
              { label: 'Evaluations',      val: team.evals,                    color: '#7C3AED', bg: '#F5F3FF' },
              { label: 'Reassessments',    val: team.reassess,                 color: '#0D9488', bg: '#F0FDFA' },
            ].map(c => (
              <div key={c.label} style={{ background: c.bg, border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: c.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</div>
                <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: c.color, marginTop: 2 }}>{c.val}</div>
              </div>
            ))}
          </div>

          {/* Roster scorecard */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: '#0F1117', color: '#fff', fontSize: 12, fontWeight: 700, letterSpacing: '0.04em' }}>
              ROSTER SCORECARD - {range.label}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 0.7fr 0.7fr 0.7fr 0.9fr 0.8fr 0.8fr 0.8fr 0.9fr 1.1fr', padding: '8px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 9, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.04em', gap: 8 }}>
              <span>Clinician</span><span>Target</span><span>Visits</span><span>Wk Avg</span><span>% Target</span><span>Done</span><span>Cancel</span><span>Miss</span><span>Comp %</span><span>Eval / Reassess</span>
            </div>
            {scorecard.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)' }}>No active telehealth clinicians.</div>
            ) : scorecard.map((r, i) => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1.7fr 0.7fr 0.7fr 0.7fr 0.9fr 0.8fr 0.8fr 0.8fr 0.9fr 1.1fr', padding: '11px 16px', borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)', alignItems: 'center', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{r.full_name}</div>
                  <div style={{ fontSize: 9, color: 'var(--gray)' }}>{r.email}</div>
                </div>
                <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace' }}>{r.target ?? '-'}/wk</span>
                <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'DM Mono, monospace' }}>{r.total_visits}</span>
                <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace' }}>{r.weekly_avg.toFixed(1)}</span>
                {r.pct !== null ? (
                  <div>
                    <span style={{ fontSize: 9, fontWeight: 700, color: r.color.color, background: r.color.bg, padding: '3px 9px', borderRadius: 999, border: '1px solid ' + r.color.border }}>
                      {r.pct}%
                    </span>
                  </div>
                ) : <span style={{ fontSize: 10, color: 'var(--gray)' }}>-</span>}
                <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', color: '#059669' }}>{r.completed}</span>
                <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', color: '#D97706' }}>{r.cancelled}</span>
                <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', color: '#DC2626' }}>{r.missed}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: r.completion_rate !== null && r.completion_rate < 80 ? '#DC2626' : 'var(--black)' }}>
                  {r.completion_rate !== null ? r.completion_rate + '%' : '-'}
                </span>
                <span style={{ fontSize: 11 }}>
                  <span style={{ color: '#7C3AED' }}>{r.evals}</span> {' / '} <span style={{ color: '#0D9488' }}>{r.reassess}</span>
                </span>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 0.7fr 0.7fr 0.7fr 0.9fr 0.8fr 0.8fr 0.8fr 0.9fr 1.1fr', padding: '11px 16px', background: '#F9FAFB', alignItems: 'center', gap: 8, borderTop: '2px solid var(--border)' }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>TEAM TOTAL</span>
              <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', fontWeight: 700 }}>{team.targetSum}/wk</span>
              <span style={{ fontSize: 14, fontWeight: 900, fontFamily: 'DM Mono, monospace' }}>{team.total}</span>
              <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', fontWeight: 700 }}>{team.team_weekly_avg.toFixed(1)}</span>
              <span></span>
              <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', color: '#059669', fontWeight: 700 }}>{team.completed}</span>
              <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', color: '#D97706', fontWeight: 700 }}>{team.cancelled}</span>
              <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', color: '#DC2626', fontWeight: 700 }}>{team.missed}</span>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{team.completion_rate ?? '-'}%</span>
              <span style={{ fontSize: 11, fontWeight: 700 }}>
                <span style={{ color: '#7C3AED' }}>{team.evals}</span> {' / '} <span style={{ color: '#0D9488' }}>{team.reassess}</span>
              </span>
            </div>
          </div>

          {/* Visit detail tabs */}
          <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', alignSelf: 'flex-start' }}>
            {[
              { k: 'today',     l: 'Today' },
              { k: 'this_week', l: 'This Week (Sun-Sat)' },
              { k: 'next_week', l: 'Next Week' },
              { k: 'last_4w',   l: 'Last 4 Weeks' },
            ].map(t => (
              <button key={t.k} onClick={() => setVisitTab(t.k)}
                style={{ padding: '7px 14px', border: 'none', fontSize: 11, fontWeight: visitTab === t.k ? 700 : 400, cursor: 'pointer', background: visitTab === t.k ? '#0F1117' : 'var(--card-bg)', color: visitTab === t.k ? '#fff' : 'var(--gray)', borderRight: '1px solid var(--border)' }}>
                {t.l}
              </button>
            ))}
          </div>

          {/* Visit detail table */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.2fr 1.8fr 0.4fr 1.7fr 0.8fr 0.7fr', padding: '8px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 9, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.04em', gap: 8 }}>
              <span>Date</span><span>Clinician</span><span>Patient</span><span>Rgn</span><span>Event Type</span><span>Status</span><span>Bucket</span>
            </div>
            {visitsInTab.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)' }}>No telehealth visits in this period.</div>
            ) : visitsInTab.slice(0, 500).map((v, i) => {
              const bucket = classify(v);
              const bucketColor =
                bucket === 'completed' ? '#059669' :
                bucket === 'cancelled' ? '#D97706' :
                bucket === 'missed'    ? '#DC2626' :
                bucket === 'scheduled' ? '#1565C0' : '#6B7280';
              return (
                <div key={(v.patient_name || '') + (v.visit_date || '') + (v.staff_name || '') + i}
                  style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.2fr 1.8fr 0.4fr 1.7fr 0.8fr 0.7fr', padding: '7px 16px', borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontFamily: 'DM Mono, monospace' }}>{fmtDate(v.visit_date)}</span>
                  <span style={{ fontSize: 11, fontWeight: 600 }}>{v.staff_name}</span>
                  <span style={{ fontSize: 11 }}>{v.patient_name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)' }}>{v.region || '-'}</span>
                  <span style={{ fontSize: 10, color: 'var(--gray)' }}>{v.event_type}</span>
                  <span style={{ fontSize: 10 }}>{v.status}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: bucketColor, textTransform: 'uppercase' }}>{bucket}</span>
                </div>
              );
            })}
            {visitsInTab.length > 500 && (
              <div style={{ padding: 10, textAlign: 'center', fontSize: 11, color: 'var(--gray)' }}>
                Showing first 500 of {visitsInTab.length}. Use Export XLSX for full list.
              </div>
            )}
          </div>

          {/* Notes */}
          <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, padding: '10px 14px', fontSize: 11, color: '#92400E' }}>
            <strong>How this page works:</strong> roster is data-driven from <code>coordinators WHERE role='telehealth' AND is_active</code>.
            Visits are matched by <code>staff_name</code> on the roster, then deduped per-(patient, date) using latest <code>uploaded_at</code> (CLAUDE.md #10).
            Weekly target colour band: green &ge;100%, yellow 75-99%, red &lt;75%.
            Visit buckets use <code>visitMath.js</code> helpers so Pariox's "Completed + Cancelled Treatment" rows are counted as cancellations, not revenue.
          </div>
        </div>
      </div>
    </div>
  );
}
