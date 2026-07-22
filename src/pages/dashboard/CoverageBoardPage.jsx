import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { BLENDED_RATE, isCompleted } from '../../lib/visitMath';
import { dedupVisitsByLatestUpload } from '../../lib/visitDedup';
import { normalizeStatus } from '../../lib/censusStatus';
import { parseFrequency, expectedVisitsThisWeek, coverageGap, summarizeCoverage } from '../../lib/frequencyMath';
import { getWeekRange } from '../../lib/dateUtils';

// =====================================================================
// COVERAGE BOARD (2026-07-22)
//
// The working list behind the "prescribed care not delivered" number on
// Director Command. That band tells Liam the size of the gap; this page
// is where an AD or care coordinator works it down, patient by patient.
//
// WHY IT EXISTS
// -------------
// The company has sat between 603 and 744 completed visits for nine
// straight weeks against a 1,000 target. The obvious reading is a demand
// problem. It is not: 258 active patients carry a prescribed cadence of
// once a week or more, they were owed 482 visits in the week of
// 2026-07-12, and 257 were delivered. The missing 256 visits are care
// that is already authorised, already staffed and already on the roster
// — 94% of the gap between booked and target.
//
// Nothing in the system listed those patients. Overdue reports key off
// `days_overdue`, which is derived from `overdue_threshold_days`, which
// is NULL for every frequency value that is not one of six clean
// strings. 38 active patients carry a perfectly parseable cadence buried
// in text like "LOC 3 DM 1w4" and were therefore never evaluated at all.
// See src/lib/frequencyMath.js.
//
// MEASUREMENT WINDOW
// ------------------
// The LAST FULL WEEK, not the current one. A Wednesday has roughly a
// third of its visits posted, so measuring in-week would report almost
// every patient as short and the list would be noise. The week selector
// is deliberately absent for the same reason — this is a "what did we
// miss" board, and the answer only exists for finished weeks.
//
// WHAT IS DELIBERATELY EXCLUDED
// -----------------------------
// Patients on a monthly-or-sparser cadence and prn patients are not owed
// a visit in any given week; counting them short every week would bury
// the patients genuinely behind. Patients whose frequency cannot be
// parsed are excluded from the shortfall and listed separately for
// records cleanup, never assumed at a default cadence. Every one of
// these exclusions is stated on screen with its count, because a number
// that quietly drops a third of the roster is how the old delivery
// headline went wrong.
// =====================================================================

const INK = '#0F172A';
const MUTED = '#64748B';
const GOOD = '#059669';
const WARN = '#D97706';
const BAD = '#DC2626';

function fmt$(n) { return '$' + Math.round(n).toLocaleString(); }
function fmtN(n) { return (n || 0).toLocaleString(); }

// Visit counts are in scheduling units; money is in ENCOUNTERS because a
// co-treat bills once. This page counts one delivered visit per patient
// per DAY, which is already encounter-shaped, so the ratio applied on
// Director Command is not needed here. See CLAUDE.md "Visit counting".
function shortfallDollars(visits) { return visits * BLENDED_RATE; }

export default function CoverageBoardPage({ onNavigate }) {
  const [census, setCensus] = useState([]);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState('ALL');
  const [sort, setSort] = useState('shortfall');
  const [showUnparseable, setShowUnparseable] = useState(false);
  const [q, setQ] = useState('');

  const scope = useAssignedRegions();
  const wk = useMemo(() => getWeekRange(new Date(), 1), []);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, v] = await Promise.all([
      fetchAllPages(scope.applyToQuery(supabase.from('census_data')
        .select('patient_name,region,status,insurance,inferred_frequency,last_visit_date,days_since_last_visit,last_visit_clinician,pipeline_assigned_to'))),
      fetchAllPages(scope.applyToQuery(supabase.from('visit_schedule_data')
        .select('patient_name,staff_name,staff_name_normalized,visit_date,status,event_type,region,uploaded_at')
        .gte('visit_date', wk.startStr).lte('visit_date', wk.endStr))),
    ]);
    setCensus(c);
    setVisits(dedupVisitsByLatestUpload(v));
    setLoading(false);
  }, [scope.isAllAccess, JSON.stringify(scope.regions), wk.startStr, wk.endStr]);

  useEffect(() => { if (!scope.loading) load(); }, [load, scope.loading]);
  useRealtimeTable(['census_data', 'visit_schedule_data'], load);

  // Delivered visits per patient, counted as distinct DAYS — a co-treat
  // is one delivered visit against a prescribed cadence, not two.
  const deliveredByPatient = useMemo(() => {
    const m = new Map();
    const seen = new Set();
    for (const v of visits) {
      if (!isCompleted(v)) continue;
      const p = (v.patient_name || '').toLowerCase().trim();
      if (!p) continue;
      const day = p + '||' + (v.visit_date + '').slice(0, 10);
      if (seen.has(day)) continue;
      seen.add(day);
      const prev = m.get(p) || { count: 0, clinicians: new Set() };
      prev.count++;
      prev.clinicians.add(v.staff_name_normalized || v.staff_name || '');
      m.set(p, prev);
    }
    return m;
  }, [visits]);

  const actives = useMemo(
    () => census.filter(c => /^active/i.test(normalizeStatus(c.status) || '')),
    [census]
  );

  const summary = useMemo(() => summarizeCoverage(actives.map(c => ({
    frequency: c.inferred_frequency,
    delivered: (deliveredByPatient.get((c.patient_name || '').toLowerCase().trim()) || {}).count || 0,
  }))), [actives, deliveredByPatient]);

  // One row per patient who is short, plus the unparseable list kept
  // separate so a records problem never inflates a clinical one.
  const { rows, unparseableRows } = useMemo(() => {
    const rows = [];
    const unparseableRows = [];
    for (const c of actives) {
      const key = (c.patient_name || '').toLowerCase().trim();
      const d = deliveredByPatient.get(key) || { count: 0, clinicians: new Set() };
      const g = coverageGap(c.inferred_frequency, d.count);
      const base = {
        ...c,
        delivered: d.count,
        clinician: Array.from(d.clinicians).filter(Boolean).join(', ') || c.last_visit_clinician || '',
      };
      if (g.reason === 'unparseable') { unparseableRows.push(base); continue; }
      if (!g.shortfall) continue;
      rows.push({ ...base, expected: g.expected, shortfall: g.shortfall, cadence: g.freq.canonical });
    }
    return { rows, unparseableRows };
  }, [actives, deliveredByPatient]);

  const regions = useMemo(() => {
    const s = new Set(rows.map(r => r.region).filter(Boolean));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (region !== 'ALL') list = list.filter(r => r.region === region);
    if (q.trim()) {
      const needle = q.toLowerCase().trim();
      list = list.filter(r => (r.patient_name || '').toLowerCase().includes(needle)
        || (r.clinician || '').toLowerCase().includes(needle));
    }
    const by = {
      // Default: biggest recoverable volume first. A 4x/week patient who
      // got nothing outranks three 1x/week patients who each got nothing.
      shortfall: (a, b) => b.shortfall - a.shortfall || (b.days_since_last_visit || 0) - (a.days_since_last_visit || 0),
      stale: (a, b) => (b.days_since_last_visit || 0) - (a.days_since_last_visit || 0),
      name: (a, b) => (a.patient_name || '').localeCompare(b.patient_name || ''),
      region: (a, b) => (a.region || '').localeCompare(b.region || '') || b.shortfall - a.shortfall,
    };
    return [...list].sort(by[sort] || by.shortfall);
  }, [rows, region, q, sort]);

  const filteredShortfall = filtered.reduce((s, r) => s + r.shortfall, 0);

  if (scope.loading || loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Coverage Board" subtitle="Loading..." />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED }}>
        Comparing prescribed cadence against delivered visits...
      </div>
    </div>
  );

  const Tile = ({ label, value, sub, color }) => (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: color || INK, lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--bg)' }}>
      <TopBar
        title="Coverage Board"
        subtitle={`Prescribed care not delivered ${'·'} ${wk.label}`}
        actions={
          <button onClick={load} style={{ padding: '6px 14px', background: INK, color: '#fff', border: 'none', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            Refresh
          </button>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <Tile label="Shortfall" value={fmtN(summary.shortfallVisits)} sub={`${fmt$(shortfallDollars(summary.shortfallVisits))}/wk`} color={BAD} />
          <Tile label="Patients short" value={fmtN(summary.short)} sub={`of ${fmtN(summary.withExpectation)} on a weekly cadence`} color={BAD} />
          <Tile label="Delivered" value={fmtN(summary.deliveredVisits)} sub={`of ${fmtN(summary.expectedVisits)} prescribed`} color={GOOD} />
          <Tile label="Fully covered" value={fmtN(summary.fullyCovered)} sub="got every prescribed visit" color={GOOD} />
        </div>

        {/* Exclusions are stated, never silent. */}
        <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.6 }}>
          Measured on the last full week ({wk.label}). Excludes {fmtN(summary.sparserThanWeekly)} patients
          {' '}on a monthly-or-sparser cadence and {fmtN(summary.asNeeded)} prn {'-'} neither is owed a visit
          {' '}in a given week.
          {summary.unparseable > 0 && (
            <>
              {' '}A further <strong style={{ color: WARN }}>{fmtN(summary.unparseable)}</strong> have a frequency
              {' '}nothing can read and are excluded rather than assumed, so the shortfall above is a floor.{' '}
              <button
                type="button"
                onClick={() => setShowUnparseable(v => !v)}
                style={{ background: 'none', border: 'none', padding: 0, color: WARN, fontWeight: 700, cursor: 'pointer', fontSize: 11.5, textDecoration: 'underline' }}
              >
                {showUnparseable ? 'Hide them' : 'Show them'}
              </button>
            </>
          )}
        </div>

        {showUnparseable && unparseableRows.length > 0 && (
          <div style={{ background: '#FFFBEB', border: `1px solid ${WARN}`, borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#78350F', marginBottom: 8 }}>
              Frequency needs cleaning {'·'} {unparseableRows.length} patients
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 6 }}>
              {unparseableRows.map(r => (
                <div key={r.patient_name} style={{ fontSize: 11.5, color: '#78350F' }}>
                  {r.patient_name} <span style={{ color: MUTED }}>{'·'} Rgn {r.region || '--'} {'·'}</span>{' '}
                  <code style={{ background: '#fff', padding: '1px 5px', borderRadius: 4 }}>
                    {r.inferred_frequency || '(blank)'}
                  </code>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Controls */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={region} onChange={e => setRegion(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, background: 'var(--card-bg)', color: INK }}>
            <option value="ALL">All regions ({rows.length})</option>
            {regions.map(r => (
              <option key={r} value={r}>Region {r} ({rows.filter(x => x.region === r).length})</option>
            ))}
          </select>
          <select value={sort} onChange={e => setSort(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, background: 'var(--card-bg)', color: INK }}>
            <option value="shortfall">Biggest shortfall first</option>
            <option value="stale">Longest since last visit</option>
            <option value="region">By region</option>
            <option value="name">By name</option>
          </select>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Patient or clinician..."
            style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, background: 'var(--card-bg)', color: INK, minWidth: 200 }} />
          <span style={{ fontSize: 11.5, color: MUTED }}>
            {fmtN(filtered.length)} patients {'·'} {fmtN(filteredShortfall)} visits {'·'} {fmt$(shortfallDollars(filteredShortfall))}/wk
          </span>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: GOOD, fontSize: 14, fontWeight: 600, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12 }}>
            Every patient on a weekly-or-greater cadence got the visits they were prescribed.
          </div>
        ) : (
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 60px 90px 1fr 90px 110px', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', background: '#F8FAFC', fontSize: 10, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <div>Patient</div><div>Rgn</div><div>Cadence</div><div>Last seen by</div><div>Delivered</div><div>Short</div>
            </div>
            {filtered.map(r => (
              <div key={r.patient_name}
                onClick={() => onNavigate && onNavigate('census', { search: r.patient_name })}
                role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') onNavigate && onNavigate('census', { search: r.patient_name }); }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F8FAFC'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                style={{ display: 'grid', gridTemplateColumns: '2fr 60px 90px 1fr 90px 110px', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', alignItems: 'center', cursor: 'pointer', fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: INK }}>
                  {r.patient_name}
                  <div style={{ fontSize: 10, color: MUTED }}>
                    {r.insurance || 'no payer'}
                    {r.days_since_last_visit != null && <> {'·'} {r.days_since_last_visit}d since last visit</>}
                    {!r.last_visit_date && <> {'·'} <span style={{ color: BAD, fontWeight: 700 }}>never seen</span></>}
                  </div>
                </div>
                <div style={{ color: MUTED }}>{r.region || '--'}</div>
                <div><code style={{ background: '#F1F5F9', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{r.cadence}</code></div>
                <div style={{ color: MUTED, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.clinician || '--'}
                </div>
                <div style={{ fontFamily: 'DM Mono, monospace', color: r.delivered === 0 ? BAD : INK }}>
                  {r.delivered} / {r.expected}
                </div>
                <div>
                  <span style={{ background: '#FEF2F2', color: BAD, padding: '3px 9px', borderRadius: 6, fontWeight: 800, fontFamily: 'DM Mono, monospace', fontSize: 12 }}>
                    -{r.shortfall}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
