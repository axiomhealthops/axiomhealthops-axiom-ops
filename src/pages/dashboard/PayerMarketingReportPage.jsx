// =====================================================================
// PayerMarketingReportPage.jsx
//
// Yvonne Flores (Director of Payer Relations and Marketing) — single-stop
// report combining: (1) Referrals by Region, (2) Census MoM Growth,
// (3) Visit Status by Region per Month, (4) RM/ADC Visit Tracking against
// the 12-visit/wk threshold.
//
// Design doc: docs/Yvonne_Payer_Marketing_Report_Design.md (Phase 1).
// Locked decisions per Liam 2026-06-05:
//   - New role `director_payer_marketing` (narrower than admin)
//   - Region grouping: marketing_territories.region_group (DB source of truth)
//   - Both gross + net census growth
//   - RM/ADC weekly target = 12 (Earl, Kaylee, Hollie, Uma, Ariel);
//     Lia + Samantha exempt (not in clinician_weekly_visit_targets)
//   - XLSX export only (multi-sheet workbook)
//   - Per-(patient_name, visit_date) latest-uploaded_at dedup (NOT the
//     broken per-date-latest-batch rule we shipped 2026-06-03 to fix)
// =====================================================================

import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import PeriodSelector, { readPersistedPeriod } from '../../components/PeriodSelector';
import DrillDownDrawer from '../../components/DrillDownDrawer';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { getPeriodRange, toDateStr } from '../../lib/dateUtils';
import {
  isCompleted as _isCompletedRow,
  isCancelled as _isCancelledRow,
  isMissed    as _isMissedRow,
} from '../../lib/visitMath';
import * as XLSX from 'xlsx';

const CANONICAL_REGIONS = ['A', 'B', 'C', 'G', 'H', 'J', 'M', 'N', 'T', 'V'];

// Brand
const BRAND_RED = '#D94F2B';
const BG_SUBTLE = '#FBF7F6';

// Threshold color bands per Liam's spec: green ≥12, yellow 10-11, red <10.
// Exempt entries (Lia Davis + Samantha Faliks per 2026-06-05 clarification)
// render with a neutral gray band and the literal label "Exempt" regardless
// of their actual visit count — we still SHOW the count, we just don't
// color-band it. The is_exempt flag in clinician_weekly_visit_targets is
// the source of truth; weekly_target is NULL for exempt rows.
function thresholdColor(actual, target, isExempt) {
  if (isExempt || target == null) return { fg: '#6B7280', bg: '#F3F4F6', label: 'Exempt' };
  if (actual >= target)        return { fg: '#166534', bg: '#DCFCE7', label: 'On target' };
  if (actual >= target - 2)    return { fg: '#92400E', bg: '#FEF3C7', label: 'Near target' };
  return                              { fg: '#991B1B', bg: '#FEE2E2', label: 'Below target' };
}

function pct(num, den) {
  if (!den || den === 0) return '—';
  return ((num / den) * 100).toFixed(1) + '%';
}

function fmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toLocaleString();
}

function fmtSigned(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  if (n > 0) return '+' + n.toLocaleString();
  return n.toLocaleString();
}

// Deterministic month key list between two dates.
function monthRange(startDate, endDate) {
  const out = [];
  const cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 7)); // YYYY-MM
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

// Per-(patient, date) latest-uploaded_at dedup (the 2026-06-03 fix). Keeps
// co-treats (same uploaded_at, different staff) and the right historical
// data on cross-staff reassignments. NEVER use the broken per-date latest-
// batch rule.
function dedupVisitsByPatientDate(rows) {
  if (!rows || rows.length === 0) return [];
  const latestByKey = new Map();
  for (const row of rows) {
    const key = (row.patient_name || '').toLowerCase().trim() + '||' + row.visit_date;
    const cur = latestByKey.get(key);
    const ts = row.uploaded_at ? new Date(row.uploaded_at).getTime() : 0;
    if (!cur || ts > cur.ts) {
      latestByKey.set(key, { ts, rows: [row] });
    } else if (ts === cur.ts) {
      // same uploaded_at — co-treat, keep both
      cur.rows.push(row);
    }
  }
  const out = [];
  for (const v of latestByKey.values()) for (const r of v.rows) out.push(r);
  return out;
}

export default function PayerMarketingReportPage() {
  // ── State ────────────────────────────────────────────────────────────
  const initialPeriod = useMemo(function() {
    return readPersistedPeriod('yvonne_report', { mode: 'month', anchor: toDateStr(new Date()) });
  }, []);
  const [period, setPeriod] = useState(initialPeriod);
  const [regionFilter, setRegionFilter] = useState(() => new Set(CANONICAL_REGIONS));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Raw data
  const [referrals, setReferrals] = useState([]);
  const [visits, setVisits] = useState([]);
  const [censusGrowth, setCensusGrowth] = useState([]);
  const [territories, setTerritories] = useState([]); // marketing_territories source of truth
  const [targets, setTargets] = useState([]);         // clinician_weekly_visit_targets

  // ── Drill-down drawer state ─────────────────────────────────────────
  // The drawer lazily reuses the in-memory referrals/visits arrays. For
  // Section 2 (census growth) we issue an on-demand fetch since the raw
  // status-log rows aren't already in client state. See openCensusDrill.
  const [drill, setDrill] = useState({ open: false, title: '', subtitle: '', loading: false, columns: [], rows: [] });
  const closeDrill = useCallback(function() { setDrill(prev => ({ ...prev, open: false })); }, []);

  // Derived period range
  const range = useMemo(function() { return getPeriodRange(period.mode, period.anchor); }, [period]);

  // ── Fetch ────────────────────────────────────────────────────────────
  useEffect(function() {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const startStr = range.startStr;
        const endStr = range.endStr;

        // For Section 2 (census growth) we always want the full set of months
        // touched by ANY of the period selector — gross/net needs a span >=
        // 2 months to show MoM movement. We always load YTD for that section
        // and just visually clip the table down to months inside the period.
        const yStart = new Date(range.start.getFullYear(), 0, 1);
        const yStartStr = toDateStr(yStart);

        const [refResp, visitsResp, growthResp, territoriesResp, targetsResp] = await Promise.all([
          fetchAllPages(
            supabase.from('intake_referrals')
              // 2026-06-05 fix: drill drawer was showing patient/insurance
              // as "—" because those columns weren't in the SELECT. Pull
              // the human-readable fields so Yvonne can verify each row.
              .select('id, region, referral_status, date_received, patient_name, insurance, referral_source, denial_reason')
              .gte('date_received', startStr)
              .lte('date_received', endStr)
          ),
          fetchAllPages(
            supabase.from('visit_schedule_data')
              // Include insurance for the visit-drill drawer so we can
              // verify payer mix at the visit level (matches what the
              // referrals drawer shows).
              .select('id, patient_name, visit_date, region, status, event_type, staff_name_normalized, insurance, uploaded_at')
              .gte('visit_date', startStr)
              .lte('visit_date', endStr)
          ),
          supabase
            .from('v_census_monthly_growth_by_region')
            .select('region, month, gross_adds, discharges, net_growth')
            .gte('month', yStartStr)
            .order('month', { ascending: true })
            .then(r => r),
          supabase
            .from('marketing_territories')
            .select('region_group, state, legacy_region_letters, sort_order')
            .eq('state', 'FL')
            .order('sort_order', { ascending: true })
            .then(r => r),
          supabase
            .from('clinician_weekly_visit_targets')
            .select('id, full_name, staff_name_normalized, role_at_assignment, region_letter, weekly_target, is_exempt, is_active')
            .eq('is_active', true)
            .then(r => r),
        ]);

        if (cancelled) return;

        if (growthResp?.error) throw growthResp.error;
        if (territoriesResp?.error) throw territoriesResp.error;
        if (targetsResp?.error) throw targetsResp.error;

        setReferrals(refResp || []);
        setVisits(visitsResp || []);
        setCensusGrowth(growthResp?.data || []);
        setTerritories(territoriesResp?.data || []);
        setTargets(targetsResp?.data || []);
      } catch (err) {
        console.error('[PayerMarketingReport] load error:', err);
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return function() { cancelled = true; };
  }, [range.startStr, range.endStr]);

  // ── Derive: region -> region_group from marketing_territories ───────
  const regionGroupMap = useMemo(function() {
    // letter -> 'North FL' | 'Central FL' | 'South FL'
    const map = {};
    for (const t of territories) {
      for (const letter of (t.legacy_region_letters || [])) {
        map[letter] = t.region_group;
      }
    }
    // Fallback for any canonical region the DB hasn't claimed yet.
    for (const letter of CANONICAL_REGIONS) if (!map[letter]) map[letter] = 'Unassigned';
    return map;
  }, [territories]);

  // Region groups in display order — North FL, Central FL, South FL, then anything else.
  const regionGroupOrder = useMemo(function() {
    const seen = new Set();
    const out = [];
    for (const t of territories) if (!seen.has(t.region_group)) { seen.add(t.region_group); out.push(t.region_group); }
    if (!seen.has('Unassigned')) { /* add only if needed */ }
    return out;
  }, [territories]);

  // Region groups -> letters in canonical order
  const regionsByGroup = useMemo(function() {
    const out = {};
    for (const g of regionGroupOrder) out[g] = [];
    for (const letter of CANONICAL_REGIONS) {
      const g = regionGroupMap[letter] || 'Unassigned';
      if (!out[g]) out[g] = [];
      out[g].push(letter);
    }
    return out;
  }, [regionGroupOrder, regionGroupMap]);

  // ── Region filter chip toggle ───────────────────────────────────────
  const toggleRegion = useCallback(function(letter) {
    setRegionFilter(function(prev) {
      const next = new Set(prev);
      if (next.has(letter)) next.delete(letter); else next.add(letter);
      return next;
    });
  }, []);
  const setAllRegions = useCallback(function() { setRegionFilter(new Set(CANONICAL_REGIONS)); }, []);
  const clearRegions = useCallback(function() { setRegionFilter(new Set()); }, []);

  // ── Section 1: Referrals by region (within period) ──────────────────
  const section1 = useMemo(function() {
    const rows = referrals.filter(r => regionFilter.has((r.region || '').toUpperCase()) || (!CANONICAL_REGIONS.includes((r.region || '').toUpperCase()) && regionFilter.size === CANONICAL_REGIONS.length));
    const byRegion = {};
    let totalA = 0, totalD = 0, totalAll = 0;
    for (const r of rows) {
      let region = (r.region || '').toUpperCase();
      if (!CANONICAL_REGIONS.includes(region)) region = 'Other';
      if (!byRegion[region]) byRegion[region] = { accepted: 0, denied: 0, other: 0, total: 0 };
      const s = (r.referral_status || '').toLowerCase();
      if (s === 'accepted') { byRegion[region].accepted++; totalA++; }
      else if (s === 'denied') { byRegion[region].denied++; totalD++; }
      else byRegion[region].other++;
      byRegion[region].total++;
      totalAll++;
    }
    return { byRegion, totalA, totalD, totalAll };
  }, [referrals, regionFilter]);

  // ── Section 2: Census MoM growth (region × month) ───────────────────
  const section2 = useMemo(function() {
    // Show full set of months from the earliest growth row through the
    // end of the selected period (or today, whichever later). MoM math
    // needs continuity — we don't clip to the period.
    if (censusGrowth.length === 0) return { months: [], byRegion: {} };
    const earliest = censusGrowth.reduce((min, r) => r.month < min ? r.month : min, censusGrowth[0].month);
    const endMonth = toDateStr(range.end).slice(0, 7) + '-01';
    const months = monthRange(new Date(earliest + 'T00:00:00'), new Date(endMonth + 'T00:00:00'));

    const byRegion = {};
    for (const letter of CANONICAL_REGIONS) byRegion[letter] = {};
    for (const r of censusGrowth) {
      const letter = (r.region || '').toUpperCase();
      if (!CANONICAL_REGIONS.includes(letter)) continue;
      const monthKey = String(r.month).slice(0, 7);
      byRegion[letter][monthKey] = {
        gross: Number(r.gross_adds) || 0,
        disch: Number(r.discharges) || 0,
        net: Number(r.net_growth) || 0,
      };
    }
    return { months, byRegion };
  }, [censusGrowth, range]);

  // ── Section 3: Visit status by region per month (deduped) ───────────
  const section3 = useMemo(function() {
    if (visits.length === 0) return { months: [], byRegion: {} };
    const dedup = dedupVisitsByPatientDate(visits);

    const months = monthRange(range.start, range.end);
    const byRegion = {};
    for (const letter of CANONICAL_REGIONS) {
      byRegion[letter] = {};
      for (const m of months) byRegion[letter][m] = { scheduled: 0, completed: 0, cancelled: 0, missed: 0 };
    }

    for (const v of dedup) {
      let letter = (v.region || '').toUpperCase();
      if (!CANONICAL_REGIONS.includes(letter)) continue;
      const monthKey = String(v.visit_date).slice(0, 7);
      if (!byRegion[letter][monthKey]) continue;
      const bucket = byRegion[letter][monthKey];
      // Order matters: cancelled supersedes status='Completed' per Pariox quirk
      if (_isCancelledRow(v)) bucket.cancelled++;
      else if (_isCompletedRow(v)) bucket.completed++;
      else if (_isMissedRow(v)) bucket.missed++;
      else if ((v.status || '').toLowerCase() === 'scheduled') bucket.scheduled++;
    }
    return { months, byRegion };
  }, [visits, range]);

  // ── Section 4: RM/ADC weekly visit tracking ─────────────────────────
  // "weekly_avg" — number of visits per ISO week (Sun-Sat) inside the period.
  // For a "week" period this equals total visits in the window. For a month/
  // quarter/YTD period this is total ÷ (weeks elapsed within the window).
  const section4 = useMemo(function() {
    if (!targets || targets.length === 0) return [];
    const dedup = dedupVisitsByPatientDate(visits);

    // Number of complete weeks in the period (at least 1 to avoid /0).
    const days = Math.max(1, Math.ceil((range.end - range.start) / (1000 * 60 * 60 * 24)));
    const weeks = Math.max(1, days / 7);

    const out = targets.map(t => {
      const snn = t.staff_name_normalized;
      const theirVisits = dedup.filter(v => v.staff_name_normalized === snn);
      const completed = theirVisits.filter(_isCompletedRow).length;
      const cancelled = theirVisits.filter(_isCancelledRow).length;
      const missed = theirVisits.filter(v => _isMissedRow(v) && !_isCancelledRow(v)).length;
      const total = completed + cancelled + missed;
      const weeklyAvg = total / weeks;
      const color = thresholdColor(weeklyAvg, t.weekly_target, t.is_exempt);
      // Variance only meaningful when not exempt and a target exists.
      const variance = (t.is_exempt || t.weekly_target == null)
        ? null
        : Number((weeklyAvg - t.weekly_target).toFixed(2));
      return {
        full_name: t.full_name,
        staff_name_normalized: snn,
        role_at_assignment: t.role_at_assignment,
        region_letter: t.region_letter,
        weekly_target: t.weekly_target,
        is_exempt: !!t.is_exempt,
        weeks_in_period: weeks,
        total_visits: total,
        completed,
        cancelled,
        missed,
        weekly_avg: weeklyAvg,
        variance,
        color,
      };
    });
    // Stable display order: non-exempt RMs first (by region), then non-exempt
    // ADCs, then exempt ADCs at the bottom so they don't visually compete
    // with the threshold-banded rows.
    out.sort((a, b) => {
      if (a.is_exempt !== b.is_exempt) return a.is_exempt ? 1 : -1;
      if (a.role_at_assignment !== b.role_at_assignment) {
        // RMs before ADCs
        return a.role_at_assignment === 'regional_manager' ? -1 : 1;
      }
      const ra = a.region_letter || 'ZZ';
      const rb = b.region_letter || 'ZZ';
      if (ra !== rb) return ra < rb ? -1 : 1;
      return (a.full_name || '').localeCompare(b.full_name || '');
    });
    return out;
  }, [targets, visits, range]);

  // ── Drill-down column defs (shared) ─────────────────────────────────
  const REFERRAL_COLUMNS = useMemo(function() {
    return [
      { key: 'date_received', label: 'Date',    width: 86,
        render: r => r.date_received || '—' },
      { key: 'patient_name',  label: 'Patient',
        render: r => (
          <span style={{ fontWeight: 600, color: '#0F1117' }}>{r.patient_name || '—'}</span>
        ) },
      { key: 'region',        label: 'Reg', width: 40, align: 'center',
        render: r => <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700 }}>{r.region || '—'}</span> },
      { key: 'insurance',     label: 'Insurance',
        render: r => <span style={{ color: '#4B5563' }}>{r.insurance || '—'}</span> },
      { key: 'referral_source', label: 'Source',
        render: r => <span style={{ color: '#6B7280', fontSize: 11 }}>{r.referral_source || '—'}</span> },
      { key: 'referral_status', label: 'Status', width: 80,
        // Denial reason surfaces as a tooltip on the Denied pill so Yvonne
        // doesn't have to open a separate page to see why something was denied.
        render: r => (
          <span title={r.denial_reason ? 'Denial reason: ' + r.denial_reason : ''}>
            <StatusPill v={r.referral_status} />
          </span>
        ) },
    ];
  }, []);

  const VISIT_COLUMNS = useMemo(function() {
    return [
      { key: 'visit_date',   label: 'Date',     width: 86,
        render: v => v.visit_date || '—' },
      { key: 'patient_name', label: 'Patient',
        render: v => <span style={{ fontWeight: 600, color: '#0F1117' }}>{v.patient_name || '—'}</span> },
      { key: 'region',       label: 'Reg', width: 40, align: 'center',
        render: v => <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700 }}>{v.region || '—'}</span> },
      { key: 'staff_name_normalized', label: 'Staff',
        render: v => <span style={{ color: '#4B5563' }}>{v.staff_name_normalized || '—'}</span> },
      { key: 'insurance', label: 'Insurance',
        render: v => <span style={{ color: '#4B5563', fontSize: 11 }}>{v.insurance || '—'}</span> },
      { key: 'status', label: 'Status', width: 120,
        // event_type as tooltip — gives the Pariox-level detail (e.g.
        // "Lymphedema Visit - Level 3 *e* (PDF)") without cluttering the row.
        render: v => (
          <span title={v.event_type || ''}>
            <VisitStatusPill v={v} />
          </span>
        ) },
    ];
  }, []);

  const CENSUS_COLUMNS = useMemo(function() {
    return [
      { key: 'changed_at', label: 'When', width: 110,
        render: r => r.changed_at ? new Date(r.changed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—' },
      { key: 'patient_name', label: 'Patient',
        render: r => <span style={{ fontWeight: 600, color: '#0F1117' }}>{r.patient_name || '—'}</span> },
      { key: 'region', label: 'Reg', width: 40, align: 'center',
        render: r => <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700 }}>{r.region || '—'}</span> },
      { key: 'old_status', label: 'From',
        render: r => <span style={{ color: '#6B7280', fontSize: 11 }}>{r.old_status || '—'}</span> },
      { key: 'new_status', label: 'To',
        render: r => <span style={{ color: '#0F1117', fontSize: 11, fontWeight: 600 }}>{r.new_status || '—'}</span> },
    ];
  }, []);

  // ── Drill helpers ───────────────────────────────────────────────────
  // Section 1: referrals filtered by region (or 'Other' bucket) and status.
  const openReferralDrill = useCallback(function(opts) {
    const { region, status } = opts; // region may be 'A'..'V' or 'Other'; status: 'Accepted' | 'Denied' | 'Other' | 'All'
    const isOther = region === 'Other';
    const rows = referrals
      .filter(r => {
        const reg = (r.region || '').toUpperCase();
        const isCanonical = CANONICAL_REGIONS.includes(reg);
        if (isOther) {
          if (isCanonical) return false;
        } else {
          if (reg !== region) return false;
        }
        const s = (r.referral_status || '').toLowerCase();
        if (status === 'All' || !status) return true;
        if (status === 'Accepted') return s === 'accepted';
        if (status === 'Denied')   return s === 'denied';
        if (status === 'Other')    return s !== 'accepted' && s !== 'denied';
        return false;
      })
      .sort((a, b) => (b.date_received || '').localeCompare(a.date_received || ''));
    const subtitle = `Region ${region} · ${status} · ${range.label}`;
    setDrill({ open: true, loading: false,
      title: `${status === 'All' ? 'Referrals' : status + ' Referrals'} — ${region}`,
      subtitle, columns: REFERRAL_COLUMNS, rows,
    });
  }, [referrals, range, REFERRAL_COLUMNS]);

  // Section 1 TOTAL: same filter logic but across all selected regions.
  const openReferralDrillAcrossRegions = useCallback(function(status) {
    const inSelected = r => regionFilter.has((r.region || '').toUpperCase()) ||
      (!CANONICAL_REGIONS.includes((r.region || '').toUpperCase()) && regionFilter.size === CANONICAL_REGIONS.length);
    const rows = referrals
      .filter(inSelected)
      .filter(r => {
        const s = (r.referral_status || '').toLowerCase();
        if (status === 'All' || !status) return true;
        if (status === 'Accepted') return s === 'accepted';
        if (status === 'Denied')   return s === 'denied';
        if (status === 'Other')    return s !== 'accepted' && s !== 'denied';
        return false;
      })
      .sort((a, b) => (b.date_received || '').localeCompare(a.date_received || ''));
    setDrill({ open: true, loading: false,
      title: `${status === 'All' ? 'All Referrals' : status + ' Referrals'} — All Selected Regions`,
      subtitle: range.label + ' · ' + rows.length + ' total',
      columns: REFERRAL_COLUMNS, rows,
    });
  }, [referrals, regionFilter, range, REFERRAL_COLUMNS]);

  // Section 3: visits filtered by region + month + classification (deduped).
  const openVisitDrill = useCallback(function(opts) {
    const { region, monthKey, kind } = opts; // kind: 'scheduled'|'completed'|'cancelled'|'missed'|'all'
    const dedup = dedupVisitsByPatientDate(visits);
    const rows = dedup
      .filter(v => (v.region || '').toUpperCase() === region)
      .filter(v => String(v.visit_date).slice(0, 7) === monthKey)
      .filter(v => {
        if (kind === 'all') return true;
        if (kind === 'cancelled') return _isCancelledRow(v);
        if (kind === 'completed') return _isCompletedRow(v);
        if (kind === 'missed')    return _isMissedRow(v) && !_isCancelledRow(v);
        if (kind === 'scheduled') return (v.status || '').toLowerCase() === 'scheduled';
        return false;
      })
      .sort((a, b) => (b.visit_date || '').localeCompare(a.visit_date || ''));
    const labelMap = { scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled', missed: 'Missed', all: 'All' };
    setDrill({ open: true, loading: false,
      title: `${labelMap[kind]} Visits — Region ${region}`,
      subtitle: `${monthKey} · ${rows.length} ${rows.length === 1 ? 'visit' : 'visits'}`,
      columns: VISIT_COLUMNS, rows,
    });
  }, [visits, VISIT_COLUMNS]);

  // Section 4: all visits for one RM/ADC inside the selected period, optional filter.
  const openRMDrill = useCallback(function(opts) {
    const { staffName, kind } = opts;
    const dedup = dedupVisitsByPatientDate(visits);
    const rows = dedup
      .filter(v => v.staff_name_normalized === staffName)
      .filter(v => {
        if (!kind || kind === 'all') return true;
        if (kind === 'cancelled') return _isCancelledRow(v);
        if (kind === 'completed') return _isCompletedRow(v);
        if (kind === 'missed')    return _isMissedRow(v) && !_isCancelledRow(v);
        return false;
      })
      .sort((a, b) => (b.visit_date || '').localeCompare(a.visit_date || ''));
    const labelMap = { completed: 'Completed', cancelled: 'Cancelled', missed: 'Missed', all: 'All' };
    setDrill({ open: true, loading: false,
      title: `${labelMap[kind] || 'All'} Visits — ${staffName}`,
      subtitle: `${range.label} · ${rows.length} ${rows.length === 1 ? 'visit' : 'visits'}`,
      columns: VISIT_COLUMNS, rows,
    });
  }, [visits, range, VISIT_COLUMNS]);

  // Section 2: census status changes for a region + month + direction.
  // Status-log rows aren't preloaded — fetch on demand. Pretty small set.
  const openCensusDrill = useCallback(async function(opts) {
    const { region, monthKey, kind } = opts; // kind: 'gross'|'disch'|'net'
    const monthStart = monthKey + '-01';
    const next = new Date(monthStart + 'T00:00:00');
    next.setMonth(next.getMonth() + 1);
    const monthEnd = toDateStr(next);

    setDrill({ open: true, loading: true, title: `Loading…`, subtitle: '', columns: CENSUS_COLUMNS, rows: [] });

    try {
      const rows = await fetchAllPages(
        supabase.from('census_status_log')
          .select('patient_name, region, old_status, new_status, changed_at')
          .eq('region', region)
          .gte('changed_at', monthStart)
          .lt('changed_at', monthEnd)
          .order('changed_at', { ascending: false })
      );

      // Apply the SAME filter the view uses so client + view counts stay in sync.
      const ACTIVE_SET = new Set(['Active', 'Active - Auth Pendin', 'Active - Auth Pending']);
      const isParserBug = s => /^\d{4}-\d{2}-\d{2}/.test(s || '') || /^\d{2}:\d{2}:\d{2}/.test(s || '');
      const filtered = rows.filter(r => !isParserBug(r.new_status) && r.patient_key);
      let bucketed;
      if (kind === 'gross')      bucketed = filtered.filter(r => ACTIVE_SET.has(r.new_status));
      else if (kind === 'disch') bucketed = filtered.filter(r => (r.new_status || '').startsWith('Discharge') || r.new_status === 'Non-Admit');
      else                       bucketed = filtered; // 'net' or 'all' shows everything

      // 2026-06-05: Pariox re-logs the same status transition on every
      // upload even when nothing actually changed. Rivera in Region B
      // April had 38 rows for one logical discharge. Dedupe: keep the
      // EARLIEST occurrence per patient_key as the representative — that
      // tells Yvonne "when did this patient's status first show up in
      // this bucket this month."
      const seen = new Map();
      // Order ascending by changed_at so the first occurrence wins.
      bucketed.sort((a, b) => (a.changed_at || '').localeCompare(b.changed_at || ''));
      const deduped = [];
      for (const r of bucketed) {
        if (!seen.has(r.patient_key)) {
          seen.set(r.patient_key, true);
          deduped.push(r);
        }
      }
      // Display most recent first.
      deduped.sort((a, b) => (b.changed_at || '').localeCompare(a.changed_at || ''));

      const labelMap = { gross: 'Gross Adds', disch: 'Discharges', net: 'All Status Changes' };
      const dupedFromCount = bucketed.length - deduped.length;
      setDrill({ open: true, loading: false,
        title: `${labelMap[kind] || 'Status Changes'} — Region ${region}`,
        subtitle: `${monthKey} · ${deduped.length} unique patient${deduped.length === 1 ? '' : 's'}`
          + (dupedFromCount > 0 ? ` · ${dupedFromCount} duplicate log row${dupedFromCount === 1 ? '' : 's'} suppressed` : ''),
        columns: CENSUS_COLUMNS, rows: deduped,
      });
    } catch (e) {
      console.error('[openCensusDrill]', e);
      setDrill({ open: true, loading: false, title: 'Error', subtitle: e.message || String(e), columns: [], rows: [] });
    }
  }, [CENSUS_COLUMNS]);

  // ── XLSX export — single workbook, 5 sheets ─────────────────────────
  const handleExport = useCallback(function() {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary
    const summary = [
      ['EdemaCare — Payer + Marketing Report'],
      ['Owner', 'Yvonne Flores, Director of Payer Relations and Marketing'],
      ['Period', range.label + ' (' + range.startStr + ' → ' + range.endStr + ')'],
      ['Period mode', period.mode],
      ['Regions included', Array.from(regionFilter).sort().join(', ') || 'None'],
      ['Generated', new Date().toLocaleString('en-US')],
      [],
      ['Notes'],
      ['Census growth data starts 2026-04-03 (earliest census_status_log row).'],
      ['Visit dedup rule: per (patient_name, visit_date), latest uploaded_at.'],
      ['Cancelled visits identified by event_type, not status (Pariox quirk).'],
      ['RM/ADC threshold = 12 visits/wk. Lia Davis + Samantha Faliks exempt.'],
      ['EdemaCare is a service of AxiomHealth Management LLC'],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');

    // Sheet 2: Referrals by Region
    const refRows = [['Region Group', 'Region', 'Accepted', 'Denied', 'Pending/Other', 'Total', 'Accept Rate']];
    for (const group of regionGroupOrder) {
      for (const letter of (regionsByGroup[group] || [])) {
        if (!regionFilter.has(letter)) continue;
        const cell = section1.byRegion[letter] || { accepted: 0, denied: 0, other: 0, total: 0 };
        refRows.push([group, letter, cell.accepted, cell.denied, cell.other, cell.total,
          cell.total ? Number((cell.accepted / cell.total * 100).toFixed(1)) : 0]);
      }
    }
    const otherCell = section1.byRegion['Other'];
    if (otherCell) {
      refRows.push(['Other', 'Other / Unknown', otherCell.accepted, otherCell.denied, otherCell.other, otherCell.total,
        otherCell.total ? Number((otherCell.accepted / otherCell.total * 100).toFixed(1)) : 0]);
    }
    refRows.push(['', 'TOTAL', section1.totalA, section1.totalD, section1.totalAll - section1.totalA - section1.totalD, section1.totalAll,
      section1.totalAll ? Number((section1.totalA / section1.totalAll * 100).toFixed(1)) : 0]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(refRows), 'Referrals by Region');

    // Sheet 3: Census Growth (MoM)
    const csRows = [['Region Group', 'Region', 'Month', 'Gross Adds', 'Discharges', 'Net Growth']];
    for (const group of regionGroupOrder) {
      for (const letter of (regionsByGroup[group] || [])) {
        if (!regionFilter.has(letter)) continue;
        for (const m of section2.months) {
          const cell = section2.byRegion[letter]?.[m] || { gross: 0, disch: 0, net: 0 };
          csRows.push([group, letter, m, cell.gross, cell.disch, cell.net]);
        }
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(csRows), 'Census Growth MoM');

    // Sheet 4: Visit Status by Region per Month
    const vsRows = [['Region Group', 'Region', 'Month', 'Scheduled', 'Completed', 'Cancelled', 'Missed', 'Completion Rate']];
    for (const group of regionGroupOrder) {
      for (const letter of (regionsByGroup[group] || [])) {
        if (!regionFilter.has(letter)) continue;
        for (const m of section3.months) {
          const cell = section3.byRegion[letter]?.[m] || { scheduled: 0, completed: 0, cancelled: 0, missed: 0 };
          const totalAttempted = cell.completed + cell.cancelled + cell.missed;
          const rate = totalAttempted ? Number((cell.completed / totalAttempted * 100).toFixed(1)) : 0;
          vsRows.push([group, letter, m, cell.scheduled, cell.completed, cell.cancelled, cell.missed, rate]);
        }
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(vsRows), 'Visit Status by Region');

    // Sheet 5: RM/ADC Visit Tracking
    const rmRows = [['Name', 'Role', 'Region', 'Weekly Target', 'Total Visits in Period', 'Weeks in Period', 'Weekly Average', 'Variance vs Target', 'Completed', 'Cancelled', 'Missed', 'Status']];
    for (const r of section4) {
      rmRows.push([
        r.full_name,
        r.role_at_assignment,
        r.region_letter || '—',
        r.is_exempt ? 'Exempt' : r.weekly_target,
        r.total_visits,
        Number(r.weeks_in_period.toFixed(2)),
        Number(r.weekly_avg.toFixed(2)),
        r.variance == null ? '—' : (r.variance > 0 ? '+' + r.variance : r.variance),
        r.completed, r.cancelled, r.missed,
        r.color.label,
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rmRows), 'RM-ADC Visit Tracking');

    const fname = 'EdemaCare_Payer_Marketing_Report_' + range.startStr + '_to_' + range.endStr + '.xlsx';
    XLSX.writeFile(wb, fname);
  }, [range, period, regionFilter, section1, section2, section3, section4, regionGroupOrder, regionsByGroup]);

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div style={{ background: BG_SUBTLE, minHeight: '100vh' }}>
      <TopBar
        title="Payer + Marketing Report"
        subtitle="Yvonne Flores · Director of Payer Relations and Marketing"
        actions={null}
      />

      <div style={{ padding: '20px 28px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <PeriodSelector
          mode={period.mode}
          anchor={period.anchor}
          onChange={setPeriod}
          storageKey="yvonne_report"
        />
        <button onClick={handleExport}
          style={{ background: BRAND_RED, color: '#fff', border: 'none',
            borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 700,
            cursor: 'pointer', letterSpacing: '0.04em' }}>
          ⬇ Export XLSX
        </button>
      </div>

      {/* Region multi-select chips */}
      <div style={{ padding: '0 28px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Regions:</span>
        {CANONICAL_REGIONS.map(letter => (
          <button key={letter} onClick={() => toggleRegion(letter)}
            style={{
              padding: '4px 10px', fontSize: 11, fontWeight: 700,
              borderRadius: 999, cursor: 'pointer',
              border: '1px solid ' + (regionFilter.has(letter) ? '#0F1117' : 'var(--border)'),
              background: regionFilter.has(letter) ? '#0F1117' : '#fff',
              color: regionFilter.has(letter) ? '#fff' : '#0F1117',
            }}>
            {letter}
            <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 6 }}>{regionGroupMap[letter] || ''}</span>
          </button>
        ))}
        <button onClick={setAllRegions} style={{ fontSize: 11, color: BRAND_RED, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>All</button>
        <button onClick={clearRegions} style={{ fontSize: 11, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>None</button>
      </div>

      {loading && (
        <div style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>Loading report…</div>
      )}
      {error && (
        <div style={{ margin: '0 28px 16px', padding: 16, background: '#FEE2E2', borderRadius: 8, color: '#991B1B', fontSize: 13 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {!loading && !error && (
        <div style={{ padding: '0 28px 40px' }}>
          {/* SECTION 1 — Referrals by Region */}
          <Section title="1. Referrals by Region" subtitle={'Window: ' + range.label}>
            <Table>
              <THead cells={['Region Group', 'Region', 'Accepted', 'Denied', 'Other', 'Total', 'Accept Rate']} />
              <tbody>
                {regionGroupOrder.map(group => {
                  const letters = (regionsByGroup[group] || []).filter(l => regionFilter.has(l));
                  if (letters.length === 0) return null;
                  return [
                    <tr key={'group-' + group}>
                      <td colSpan={7} style={{ ...cellStyle, background: '#F3F4F6', fontWeight: 700, color: '#1F2937', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{group}</td>
                    </tr>,
                    ...letters.map(letter => {
                      const c = section1.byRegion[letter] || { accepted: 0, denied: 0, other: 0, total: 0 };
                      return (
                        <tr key={'r1-' + letter}>
                          <td style={cellStyle}></td>
                          <td style={{ ...cellStyle, fontWeight: 700, fontFamily: 'DM Mono, monospace' }}>{letter}</td>
                          <td style={cellStyle}><Num value={c.accepted} onClick={() => openReferralDrill({ region: letter, status: 'Accepted' })} /></td>
                          <td style={cellStyle}><Num value={c.denied} onClick={() => openReferralDrill({ region: letter, status: 'Denied' })} /></td>
                          <td style={cellStyle}><Num value={c.other} onClick={() => openReferralDrill({ region: letter, status: 'Other' })} /></td>
                          <td style={{ ...cellStyle, fontWeight: 700 }}><Num value={c.total} onClick={() => openReferralDrill({ region: letter, status: 'All' })} bold /></td>
                          <td style={cellStyle}>{pct(c.accepted, c.total)}</td>
                        </tr>
                      );
                    }),
                  ];
                })}
                {section1.byRegion['Other'] && (
                  <tr>
                    <td style={cellStyle}>Other</td>
                    <td style={{ ...cellStyle, fontStyle: 'italic' }}>Other / Unknown</td>
                    <td style={cellStyle}><Num value={section1.byRegion['Other'].accepted} onClick={() => openReferralDrill({ region: 'Other', status: 'Accepted' })} /></td>
                    <td style={cellStyle}><Num value={section1.byRegion['Other'].denied} onClick={() => openReferralDrill({ region: 'Other', status: 'Denied' })} /></td>
                    <td style={cellStyle}><Num value={section1.byRegion['Other'].other} onClick={() => openReferralDrill({ region: 'Other', status: 'Other' })} /></td>
                    <td style={{ ...cellStyle, fontWeight: 700 }}><Num value={section1.byRegion['Other'].total} onClick={() => openReferralDrill({ region: 'Other', status: 'All' })} bold /></td>
                    <td style={cellStyle}>{pct(section1.byRegion['Other'].accepted, section1.byRegion['Other'].total)}</td>
                  </tr>
                )}
                <tr>
                  <td style={{ ...cellStyle, fontWeight: 700, background: BG_SUBTLE }}></td>
                  <td style={{ ...cellStyle, fontWeight: 700, background: BG_SUBTLE }}>TOTAL</td>
                  <td style={{ ...cellStyle, fontWeight: 700, background: BG_SUBTLE }}><NumAllRegions value={section1.totalA} status="Accepted" openDrill={openReferralDrillAcrossRegions} /></td>
                  <td style={{ ...cellStyle, fontWeight: 700, background: BG_SUBTLE }}><NumAllRegions value={section1.totalD} status="Denied" openDrill={openReferralDrillAcrossRegions} /></td>
                  <td style={{ ...cellStyle, fontWeight: 700, background: BG_SUBTLE }}><NumAllRegions value={section1.totalAll - section1.totalA - section1.totalD} status="Other" openDrill={openReferralDrillAcrossRegions} /></td>
                  <td style={{ ...cellStyle, fontWeight: 700, background: BG_SUBTLE }}><NumAllRegions value={section1.totalAll} status="All" openDrill={openReferralDrillAcrossRegions} /></td>
                  <td style={{ ...cellStyle, fontWeight: 700, background: BG_SUBTLE }}>{pct(section1.totalA, section1.totalAll)}</td>
                </tr>
              </tbody>
            </Table>
          </Section>

          {/* SECTION 2 — Census MoM Growth */}
          <Section title="2. Regional Census Growth (MoM)"
            subtitle="Gross adds vs discharges, with net delta. Data begins 2026-04-03.">
            {section2.months.length === 0 ? (
              <Empty>No census status log entries yet for the period.</Empty>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <Table>
                  <thead>
                    <tr>
                      <th style={headStyle} rowSpan={2}>Region Group</th>
                      <th style={headStyle} rowSpan={2}>Region</th>
                      {section2.months.map(m => (
                        <th key={m} style={{ ...headStyle, textAlign: 'center' }} colSpan={3}>{m}</th>
                      ))}
                    </tr>
                    <tr>
                      {section2.months.map(m => (
                        [<th key={m + 'g'} style={{ ...headStyle, fontSize: 9 }}>Gross</th>,
                         <th key={m + 'd'} style={{ ...headStyle, fontSize: 9 }}>Disch</th>,
                         <th key={m + 'n'} style={{ ...headStyle, fontSize: 9 }}>Net</th>]
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {regionGroupOrder.map(group => {
                      const letters = (regionsByGroup[group] || []).filter(l => regionFilter.has(l));
                      if (letters.length === 0) return null;
                      return [
                        <tr key={'group2-' + group}>
                          <td colSpan={2 + section2.months.length * 3} style={{ ...cellStyle, background: '#F3F4F6', fontWeight: 700, color: '#1F2937', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{group}</td>
                        </tr>,
                        ...letters.map(letter => (
                          <tr key={'r2-' + letter}>
                            <td style={cellStyle}></td>
                            <td style={{ ...cellStyle, fontWeight: 700, fontFamily: 'DM Mono, monospace' }}>{letter}</td>
                            {section2.months.map(m => {
                              const c = section2.byRegion[letter]?.[m] || { gross: 0, disch: 0, net: 0 };
                              const netColor = c.net > 0 ? '#166534' : c.net < 0 ? '#991B1B' : '#6B7280';
                              return [
                                <td key={m + 'g'} style={cellStyle}><Num value={c.gross} onClick={() => openCensusDrill({ region: letter, monthKey: m, kind: 'gross' })} /></td>,
                                <td key={m + 'd'} style={cellStyle}><Num value={c.disch} onClick={() => openCensusDrill({ region: letter, monthKey: m, kind: 'disch' })} /></td>,
                                <td key={m + 'n'} style={{ ...cellStyle, color: netColor, fontWeight: 700 }}>
                                  <Num value={c.net} display={fmtSigned(c.net)} onClick={() => openCensusDrill({ region: letter, monthKey: m, kind: 'net' })} bold />
                                </td>,
                              ];
                            })}
                          </tr>
                        )),
                      ];
                    })}
                  </tbody>
                </Table>
              </div>
            )}
          </Section>

          {/* SECTION 3 — Visit Status by Region per Month */}
          <Section title="3. Visit Status by Region per Month"
            subtitle="Per-(patient, date) latest-uploaded_at dedup applied. Cancelled detected via event_type.">
            {section3.months.length === 0 ? (
              <Empty>No visits found in this period.</Empty>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <Table>
                  <thead>
                    <tr>
                      <th style={headStyle} rowSpan={2}>Region Group</th>
                      <th style={headStyle} rowSpan={2}>Region</th>
                      {section3.months.map(m => (
                        <th key={m} style={{ ...headStyle, textAlign: 'center' }} colSpan={5}>{m}</th>
                      ))}
                    </tr>
                    <tr>
                      {section3.months.map(m => ([
                        <th key={m + 's'} style={{ ...headStyle, fontSize: 9 }}>Sched</th>,
                        <th key={m + 'c'} style={{ ...headStyle, fontSize: 9 }}>Comp</th>,
                        <th key={m + 'x'} style={{ ...headStyle, fontSize: 9 }}>Canc</th>,
                        <th key={m + 'm'} style={{ ...headStyle, fontSize: 9 }}>Miss</th>,
                        <th key={m + 'r'} style={{ ...headStyle, fontSize: 9 }}>%</th>,
                      ]))}
                    </tr>
                  </thead>
                  <tbody>
                    {regionGroupOrder.map(group => {
                      const letters = (regionsByGroup[group] || []).filter(l => regionFilter.has(l));
                      if (letters.length === 0) return null;
                      return [
                        <tr key={'group3-' + group}>
                          <td colSpan={2 + section3.months.length * 5} style={{ ...cellStyle, background: '#F3F4F6', fontWeight: 700, color: '#1F2937', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{group}</td>
                        </tr>,
                        ...letters.map(letter => (
                          <tr key={'r3-' + letter}>
                            <td style={cellStyle}></td>
                            <td style={{ ...cellStyle, fontWeight: 700, fontFamily: 'DM Mono, monospace' }}>{letter}</td>
                            {section3.months.map(m => {
                              const c = section3.byRegion[letter]?.[m] || { scheduled: 0, completed: 0, cancelled: 0, missed: 0 };
                              const attempted = c.completed + c.cancelled + c.missed;
                              return [
                                <td key={m + 's'} style={cellStyle}><Num value={c.scheduled} onClick={() => openVisitDrill({ region: letter, monthKey: m, kind: 'scheduled' })} /></td>,
                                <td key={m + 'c'} style={{ ...cellStyle, fontWeight: 600, color: '#166534' }}><Num value={c.completed} onClick={() => openVisitDrill({ region: letter, monthKey: m, kind: 'completed' })} color="#166534" /></td>,
                                <td key={m + 'x'} style={{ ...cellStyle, color: '#991B1B' }}><Num value={c.cancelled} onClick={() => openVisitDrill({ region: letter, monthKey: m, kind: 'cancelled' })} color="#991B1B" /></td>,
                                <td key={m + 'm'} style={{ ...cellStyle, color: '#92400E' }}><Num value={c.missed} onClick={() => openVisitDrill({ region: letter, monthKey: m, kind: 'missed' })} color="#92400E" /></td>,
                                <td key={m + 'r'} style={{ ...cellStyle, fontWeight: 600 }}>{pct(c.completed, attempted)}</td>,
                              ];
                            })}
                          </tr>
                        )),
                      ];
                    })}
                  </tbody>
                </Table>
              </div>
            )}
          </Section>

          {/* SECTION 4 — RM/ADC Visit Threshold Tracking */}
          <Section title="4. RM / ADC Visit Threshold (12 visits/wk min)"
            subtitle="All RMs + ADCs shown. Lia Davis and Samantha Faliks display their actual numbers but are exempt from the 12/wk threshold (no color band). Weekly average = total visits ÷ weeks in selected period.">
            <Table>
              <THead cells={['Name', 'Role', 'Region', 'Weekly Target', 'Total Visits', 'Weeks in Period', 'Weekly Avg', 'Variance', 'Completed', 'Cancelled', 'Missed', 'Status']} />
              <tbody>
                {section4.length === 0 && (
                  <tr><td colSpan={12} style={{ ...cellStyle, textAlign: 'center', color: '#6B7280' }}>No targets configured. Add rows to clinician_weekly_visit_targets.</td></tr>
                )}
                {section4.map(r => {
                  const variance = r.variance;
                  const varColor = variance == null ? '#6B7280'
                    : variance >= 0 ? '#166534'
                    : '#991B1B';
                  return (
                    <tr key={r.staff_name_normalized} style={r.is_exempt ? { background: '#FAFAFA' } : null}>
                      <td style={{ ...cellStyle, fontWeight: 700 }}>{r.full_name}</td>
                      <td style={cellStyle}>{r.role_at_assignment === 'regional_manager' ? 'RM' : r.role_at_assignment === 'assoc_director' ? 'ADC' : r.role_at_assignment}</td>
                      <td style={{ ...cellStyle, fontFamily: 'DM Mono, monospace' }}>{r.region_letter || '—'}</td>
                      <td style={cellStyle}>
                        {r.is_exempt
                          ? <span style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', fontStyle: 'italic' }}>Exempt</span>
                          : r.weekly_target}
                      </td>
                      <td style={cellStyle}><Num value={r.total_visits} onClick={() => openRMDrill({ staffName: r.staff_name_normalized, kind: 'all' })} /></td>
                      <td style={cellStyle}>{r.weeks_in_period.toFixed(2)}</td>
                      <td style={{ ...cellStyle, fontWeight: 700 }}>{r.weekly_avg.toFixed(1)}</td>
                      <td style={{ ...cellStyle, color: varColor, fontWeight: 600 }}>
                        {variance == null ? '—' : (variance > 0 ? '+' + variance.toFixed(1) : variance.toFixed(1))}
                      </td>
                      <td style={{ ...cellStyle, color: '#166534' }}><Num value={r.completed} onClick={() => openRMDrill({ staffName: r.staff_name_normalized, kind: 'completed' })} color="#166534" /></td>
                      <td style={{ ...cellStyle, color: '#991B1B' }}><Num value={r.cancelled} onClick={() => openRMDrill({ staffName: r.staff_name_normalized, kind: 'cancelled' })} color="#991B1B" /></td>
                      <td style={{ ...cellStyle, color: '#92400E' }}><Num value={r.missed} onClick={() => openRMDrill({ staffName: r.staff_name_normalized, kind: 'missed' })} color="#92400E" /></td>
                      <td style={cellStyle}>
                        <span style={{
                          display: 'inline-block', padding: '3px 10px', borderRadius: 999,
                          fontSize: 11, fontWeight: 700,
                          background: r.color.bg, color: r.color.fg,
                        }}>
                          {r.color.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Section>

          <div style={{ marginTop: 24, fontSize: 10, color: '#6B7280', textAlign: 'center' }}>
            EdemaCare is a service of AxiomHealth Management LLC · Generated {new Date().toLocaleString('en-US')}
          </div>
        </div>
      )}

      {/* Drill-down side drawer (Section 1 / 2 / 3 / 4) */}
      <DrillDownDrawer
        open={drill.open}
        onClose={closeDrill}
        title={drill.title}
        subtitle={drill.subtitle}
        loading={drill.loading}
        columns={drill.columns}
        rows={drill.rows}
      />
    </div>
  );
}

// ── Small presentational helpers ───────────────────────────────────────
function Section({ title, subtitle, children }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 18, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F1117' }}>{title}</h2>
        {subtitle && <div style={{ fontSize: 11, color: '#6B7280' }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ padding: 24, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>{children}</div>;
}

function Table({ children }) {
  return <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>{children}</table>;
}

function THead({ cells }) {
  return (
    <thead>
      <tr>{cells.map((c, i) => <th key={i} style={headStyle}>{c}</th>)}</tr>
    </thead>
  );
}

const headStyle = {
  textAlign: 'left', padding: '8px 10px',
  background: '#F9FAFB', fontWeight: 700, fontSize: 11,
  color: '#374151', borderBottom: '1px solid var(--border)',
  letterSpacing: '0.04em', textTransform: 'uppercase',
};

const cellStyle = {
  padding: '8px 10px', borderBottom: '1px solid #F3F4F6',
  color: '#1F2937', fontSize: 12,
};

// ── Clickable number cell ──────────────────────────────────────────────
// Zero values render as a dim, non-interactive dash so the user doesn't
// click to discover an empty drawer. Non-zero values get an underline
// hover so it's obvious you can click.
function Num({ value, display, onClick, bold = false, color }) {
  const n = Number(value) || 0;
  if (n === 0 && (value === 0 || value == null)) {
    return <span style={{ color: '#9CA3AF' }}>{display || '0'}</span>;
  }
  return (
    <button type="button" onClick={onClick}
      style={{
        background: 'none', border: 'none', padding: 0, font: 'inherit',
        cursor: 'pointer', color: color || '#0F1117',
        fontWeight: bold ? 800 : 600,
        textDecoration: 'underline', textDecorationStyle: 'dotted',
        textDecorationColor: '#D1D5DB', textUnderlineOffset: 3,
      }}
      onMouseEnter={e => { e.currentTarget.style.textDecorationColor = color || '#0F1117'; }}
      onMouseLeave={e => { e.currentTarget.style.textDecorationColor = '#D1D5DB'; }}
      title="Click to see underlying rows">
      {display != null ? display : (typeof value === 'number' ? value.toLocaleString() : value)}
    </button>
  );
}

function NumAllRegions({ value, status, openDrill }) {
  const n = Number(value) || 0;
  if (n === 0) return <span style={{ color: '#9CA3AF' }}>0</span>;
  return (
    <button type="button" onClick={() => openDrill(status)}
      style={{
        background: 'none', border: 'none', padding: 0, font: 'inherit',
        cursor: 'pointer', color: '#0F1117', fontWeight: 800,
        textDecoration: 'underline', textDecorationStyle: 'dotted',
        textDecorationColor: '#D1D5DB', textUnderlineOffset: 3,
      }}
      title="Click to see underlying rows">
      {n.toLocaleString()}
    </button>
  );
}

// ── Status pills used inside the drill drawer ─────────────────────────
function StatusPill({ v }) {
  const s = (v || '').toLowerCase();
  let bg = '#F3F4F6', fg = '#374151';
  if (s === 'accepted') { bg = '#DCFCE7'; fg = '#166534'; }
  else if (s === 'denied') { bg = '#FEE2E2'; fg = '#991B1B'; }
  else if (s === 'on hold') { bg = '#FEF3C7'; fg = '#92400E'; }
  else if (s === 'pending') { bg = '#DBEAFE'; fg = '#1E40AF'; }
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: 10, fontWeight: 700, background: bg, color: fg }}>{v || '—'}</span>
  );
}

function VisitStatusPill({ v }) {
  // Use the same classification rules the page uses for counting so the
  // pill label matches the bucket the user clicked from.
  let label, bg, fg;
  if (_isCancelledRow(v))        { label = 'Cancelled';  bg = '#FEE2E2'; fg = '#991B1B'; }
  else if (_isCompletedRow(v))   { label = 'Completed';  bg = '#DCFCE7'; fg = '#166534'; }
  else if (_isMissedRow(v))      { label = 'Missed';     bg = '#FEF3C7'; fg = '#92400E'; }
  else if ((v.status || '').toLowerCase() === 'scheduled') { label = 'Scheduled'; bg = '#DBEAFE'; fg = '#1E40AF'; }
  else                            { label = v.status || '—'; bg = '#F3F4F6'; fg = '#374151'; }
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: 10, fontWeight: 700, background: bg, color: fg }} title={v.event_type || ''}>
      {label}
    </span>
  );
}
