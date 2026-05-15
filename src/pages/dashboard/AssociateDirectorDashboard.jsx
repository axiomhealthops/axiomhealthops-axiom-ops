// =====================================================================
// AssociateDirectorDashboard.jsx
//
// Multi-region rollup view for Associate Directors of Clinical Operations.
// Created as part of the EdemaCare 2026-05-15 reorganization (was originally
// scoped as "revamp the Regional Manager dashboard" but expanded to add this
// AD-tier view that didn't previously exist).
//
// WHO USES IT
//   * Lia Davis (FL North):    regions B, C, G
//   * Ariel Maboudi (FL Cen):  regions A, H, M, N
//   * Samantha Faliks (FL S):  regions J, T, V
//
// WHAT IT SHOWS (v1 — Phase 1)
//   1. Identity strip: AD name + parent region + region count + week ending.
//   2. Aggregate KPI strip across all their regions.
//   3. Vacancy banner: count of regions where the AD is acting as manager
//      because no dedicated TM exists (recruitment signal).
//   4. Region grid: one card per region they oversee with
//        - Region letter + manager name (or "Acting: <AD>" badge)
//        - Active census count
//        - Scheduled visits this week + completion %
//        - Open auth count
//        - "View region details →" drills into RegionalManagerDashboard
//          pre-filtered to that region.
//
// WHAT'S COMING IN v1.1 (TODO blocks below)
//   * Auth lag tracking — referral → SOC days, payor breakdown.
//   * Documentation timeliness — OASIS / eval / visit note aging.
//   * Status pipeline diff — "what changed in the last 24h" panel.
//   * Outlier panel — regions 2+ stddev from regional mean on any KPI.
//
// DATA SOURCES
//   * coordinators       — for resolving region → manager (acting vs. dedicated)
//   * visit_schedule_data — for productivity / completion rates
//   * intake_referrals   — for new-referral counts and pipeline
//   * census_data        — for active patient counts per region
//   * auth_tracker       — for open authorization counts
//
// PATTERNS USED
//   * fetchAllPages for any select that can exceed 1000 rows
//   * useRealtimeTable for live updates when key tables change
//   * useAssignedRegions for region scoping (defense in depth — RLS is
//     the primary guard, this hook prevents UI leak)
//   * Brand palette B from constants.js (red/orange family)
// =====================================================================

import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import {
  REGIONS,
  REGION_TO_PARENT,
  REGION_TO_AD,
  FL_PARENT_REGIONS,
  isActingManager,
} from '../../lib/constants';

// ---- date helpers (Sun-Sat work week, ET) ---------------------------------
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day); // back up to Sunday
  d.setHours(0, 0, 0, 0);
  return d;
}
function getWeekEnd(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}
function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---- visit classification helpers (matches RM dashboard convention) -------
function isCancelled(e, s) { return /cancel/i.test(e || '') || /cancel/i.test(s || ''); }
function isCompleted(s)    { return /completed/i.test(s || ''); }
function isMissed(s, e)    { return /missed/i.test(s || '') && !isCancelled(e, s); }
function isScheduled(s, e) { return /scheduled/i.test(s || '') && !isCancelled(e, s); }

// ---- tiny presentational components --------------------------------------
function KPI({ label, value, sub, accent = 'var(--black)', flag }) {
  return (
    <div style={{
      background: 'var(--card-bg)',
      borderRadius: 10,
      padding: '14px 16px',
      border: `1px solid ${flag ? '#FED7AA' : 'var(--border)'}`,
      position: 'relative',
    }}>
      {flag && (
        <span style={{
          position: 'absolute', top: 10, right: 10, fontSize: 9, fontWeight: 700,
          letterSpacing: '0.05em', color: '#9A3412', textTransform: 'uppercase',
          background: '#FED7AA', padding: '2px 6px', borderRadius: 4,
        }}>{flag}</span>
      )}
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--gray)',
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>{label}</div>
      <div style={{
        fontSize: 24, fontWeight: 800, fontFamily: 'DM Mono, monospace',
        color: accent, marginTop: 6,
      }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function RegionCard({ region, stats, onDrillIn }) {
  const acting = isActingManager(region.letter);
  const completion = stats.scheduledWeek > 0
    ? Math.round((stats.completedWeek / stats.scheduledWeek) * 100)
    : null;
  const compColor = completion === null ? 'var(--gray)'
    : completion >= 80 ? '#10B981'
    : completion >= 60 ? '#F59E0B'
    : '#EF4444';

  return (
    <div style={{
      background: 'var(--card-bg)',
      borderRadius: 12,
      border: `1px solid ${acting ? '#FED7AA' : 'var(--border)'}`,
      padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 13, fontWeight: 700, color: 'var(--gray)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>Region {region.letter}</span>
            {acting && (
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                color: '#9A3412', textTransform: 'uppercase',
                background: '#FED7AA', padding: '2px 8px', borderRadius: 999,
              }}>Acting Coverage</span>
            )}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--black)', marginTop: 4 }}>
            {region.manager}
          </div>
          {acting && (
            <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>
              No dedicated Regional Manager — recruitment open
            </div>
          )}
        </div>
        <button
          onClick={() => onDrillIn(region.letter)}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--black)',
            cursor: 'pointer',
          }}
        >View region →</button>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
        paddingTop: 10, borderTop: '1px solid var(--border)',
      }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active</div>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--black)', marginTop: 2 }}>
            {stats.activeCensus}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Visits Wk</div>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--black)', marginTop: 2 }}>
            {stats.scheduledWeek}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Complete</div>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: compColor, marginTop: 2 }}>
            {completion === null ? '—' : `${completion}%`}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Open Auth</div>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--black)', marginTop: 2 }}>
            {stats.openAuth}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- main component -------------------------------------------------------
export default function AssociateDirectorDashboard({ onNavigate }) {
  const { profile } = useAuth();
  const { regions: assignedRegions, isAllAccess } = useAssignedRegions();

  const [visits, setVisits]   = useState([]);
  const [intake, setIntake]   = useState([]);
  const [census, setCensus]   = useState([]);
  const [auth, setAuth]       = useState([]);
  const [coords, setCoords]   = useState([]);
  const [loading, setLoading] = useState(true);

  // Resolve which regions this user oversees. ADs see only their assigned
  // regions; super_admin/admin sees all regions for verification/debug.
  const myRegions = useMemo(() => {
    if (isAllAccess) {
      // Admin / super_admin viewing this dashboard for QA purposes — show all 10.
      return Object.keys(REGIONS).sort();
    }
    return (assignedRegions || []).filter(r => REGIONS[r]); // drop unknown letters
  }, [assignedRegions, isAllAccess]);

  // Resolve parent region name (FL North/Central/South) from first assigned region.
  // ADs have a single parent region — this is structurally consistent because
  // each AD's regions array maps to exactly one parent region.
  const parentRegion = useMemo(() => {
    if (myRegions.length === 0) return null;
    const parents = new Set(myRegions.map(r => REGION_TO_PARENT[r]).filter(Boolean));
    if (parents.size === 1) return [...parents][0];
    return null; // mixed (admin view) — handled below
  }, [myRegions]);

  // Load data scoped to my regions
  function load() {
    if (myRegions.length === 0) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      fetchAllPages(
        supabase.from('visit_schedule_data')
          .select('region,visit_date,status,event_type,patient_name')
          .in('region', myRegions)
          .not('visit_date', 'is', null)
      ),
      fetchAllPages(
        supabase.from('intake_referrals')
          .select('region,referral_status,date_received,patient_name')
          .in('region', myRegions)
      ),
      fetchAllPages(
        supabase.from('census_data')
          .select('region,patient_name,status')
          .in('region', myRegions)
      ),
      fetchAllPages(
        supabase.from('auth_tracker')
          .select('region,auth_status,visits_authorized,visits_used,auth_expiry_date')
          .in('region', myRegions)
      ),
      // For resolving "who manages region X" → coordinators with role regional_manager
      fetchAllPages(
        supabase.from('coordinators')
          .select('full_name,role,regions,is_active')
          .eq('is_active', true)
      ),
    ]).then(([v, i, c, a, co]) => {
      setVisits(v); setIntake(i); setCensus(c); setAuth(a); setCoords(co);
      setLoading(false);
    }).catch(err => {
      console.error('[AssociateDirectorDashboard] load error:', err);
      setLoading(false);
    });
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [myRegions.join(',')]);
  useRealtimeTable(['visit_schedule_data', 'census_data', 'auth_tracker', 'intake_referrals', 'coordinators'], load);

  // Week boundaries (Sun-Sat ET — matches the org's work-week convention)
  const now = new Date();
  const weekStart = getWeekStart(now);
  const weekEnd = getWeekEnd(weekStart);

  // Per-region aggregates
  const regionStats = useMemo(() => {
    const map = {};
    myRegions.forEach(letter => {
      map[letter] = {
        scheduledWeek: 0,
        completedWeek: 0,
        missedWeek: 0,
        cancelledWeek: 0,
        activeCensus: 0,
        openAuth: 0,
      };
    });

    // Visits this week
    visits.forEach(v => {
      if (!v.visit_date) return;
      const d = new Date(v.visit_date + 'T00:00:00');
      if (d < weekStart || d > weekEnd) return;
      const m = map[v.region];
      if (!m) return;
      if (isCancelled(v.event_type, v.status)) m.cancelledWeek++;
      else if (isCompleted(v.status))          { m.completedWeek++; m.scheduledWeek++; }
      else if (isMissed(v.status, v.event_type)) { m.missedWeek++; m.scheduledWeek++; }
      else if (isScheduled(v.status, v.event_type)) m.scheduledWeek++;
    });

    // Active census: any status starting with "active" (case-insensitive).
    // Matches: "Active" (most), "active", "Active - Auth Pending" etc.
    // Does NOT match: Discharge, On Hold, Waitlist, Eval/SOC/Auth Pending,
    // Hospitalized, Non-Admit, Recert/DC Pending — by design, those are
    // tracked in pipeline counts (future v1.1 module), not active census.
    census.forEach(p => {
      const m = map[p.region];
      if (!m) return;
      const s = (p.status || '').toLowerCase();
      if (s.startsWith('active')) m.activeCensus++;
    });

    // Open authorizations (any non-closed status)
    auth.forEach(a => {
      const m = map[a.region];
      if (!m) return;
      const s = (a.auth_status || '').toLowerCase();
      if (!['closed', 'denied', 'expired', 'discharged'].includes(s)) m.openAuth++;
    });

    return map;
  }, [visits, census, auth, myRegions, weekStart.getTime(), weekEnd.getTime()]);

  // Region card data: letter, current manager, acting flag
  const regionCards = useMemo(() => {
    return myRegions.map(letter => {
      // Find dedicated TM if one exists (role=regional_manager AND letter in their regions)
      const dedicatedTM = coords.find(c =>
        c.role === 'regional_manager' && (c.regions || []).includes(letter)
      );
      const manager = dedicatedTM
        ? dedicatedTM.full_name
        : REGION_TO_AD[letter] || REGIONS[letter] || 'Unassigned';
      return { letter, manager };
    });
  }, [myRegions, coords]);

  // Aggregate KPIs across all my regions
  const aggregate = useMemo(() => {
    const totals = Object.values(regionStats).reduce((acc, s) => {
      acc.scheduledWeek += s.scheduledWeek;
      acc.completedWeek += s.completedWeek;
      acc.missedWeek    += s.missedWeek;
      acc.cancelledWeek += s.cancelledWeek;
      acc.activeCensus  += s.activeCensus;
      acc.openAuth      += s.openAuth;
      return acc;
    }, { scheduledWeek: 0, completedWeek: 0, missedWeek: 0, cancelledWeek: 0, activeCensus: 0, openAuth: 0 });

    const completion = totals.scheduledWeek > 0
      ? Math.round((totals.completedWeek / totals.scheduledWeek) * 100)
      : null;
    const missRate = (totals.completedWeek + totals.missedWeek) > 0
      ? Math.round((totals.missedWeek / (totals.completedWeek + totals.missedWeek)) * 100)
      : 0;
    return { ...totals, completion, missRate };
  }, [regionStats]);

  // Acting-coverage count → recruitment signal
  const actingCount = useMemo(
    () => myRegions.filter(letter => {
      const dedicatedTM = coords.find(c =>
        c.role === 'regional_manager' && (c.regions || []).includes(letter)
      );
      return !dedicatedTM;
    }).length,
    [myRegions, coords]
  );

  function handleDrillIntoRegion(letter) {
    // Navigate to the existing RM dashboard with this region preselected.
    // The RM dashboard reads `intent` and can self-filter; if it doesn't yet,
    // the user clicks the region filter once — non-blocking for v1.
    if (typeof onNavigate === 'function') {
      onNavigate('rm-dashboard', { region: letter });
    }
  }

  // ---- empty / loading states -------------------------------------------
  if (myRegions.length === 0 && !loading) {
    return (
      <div style={{ padding: 40 }}>
        <TopBar />
        <div style={{
          marginTop: 24, padding: '40px 32px', background: 'var(--card-bg)',
          border: '1px solid var(--border)', borderRadius: 12, textAlign: 'center',
        }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--black)', marginBottom: 8 }}>
            No regions assigned
          </div>
          <div style={{ fontSize: 14, color: 'var(--gray)' }}>
            Your account doesn't have any regions assigned yet. Ask an admin to set your
            <code style={{ background: 'var(--border)', padding: '2px 6px', borderRadius: 4, margin: '0 4px' }}>coordinators.regions</code>
            array in User Management.
          </div>
        </div>
      </div>
    );
  }

  // ---- main render -------------------------------------------------------
  return (
    <div style={{ padding: '0 28px 40px' }}>
      <TopBar />

      {/* Identity strip — header label adapts to the viewer's role:
            * assoc_director → "Associate Director — {parentRegion}"
            * super_admin / admin → "{job_title} — All Regions (Admin View)"
            * anything else with regions → falls back to job_title or "Operations"
      */}
      <div style={{
        marginTop: 20, padding: '18px 22px', background: 'var(--card-bg)',
        border: '1px solid var(--border)', borderRadius: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div>
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--red, #D94F2B)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>
            {(() => {
              const r = profile?.role;
              const jt = profile?.job_title;
              if (r === 'assoc_director') return `Associate Director — ${parentRegion || 'Multi-Region'}`;
              if (r === 'super_admin' || r === 'admin') return `${jt || 'Administrator'} — All Regions (Admin View)`;
              return jt || 'Operations Dashboard';
            })()}
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--black)', marginTop: 4 }}>
            {profile?.full_name || 'Associate Director'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 2 }}>
            {profile?.role === 'assoc_director'
              ? `Overseeing ${myRegions.length} region${myRegions.length === 1 ? '' : 's'}: ${myRegions.join(', ')}`
              : `Viewing all ${myRegions.length} regions: ${myRegions.join(', ')}`}
            {' · '}Week of {fmtDate(weekStart)}–{fmtDate(weekEnd)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--gray)',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>Last refresh</div>
          <div style={{ fontSize: 13, color: 'var(--black)', marginTop: 2 }}>
            {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </div>
        </div>
      </div>

      {/* Vacancy banner */}
      {actingCount > 0 && (
        <div style={{
          marginTop: 16, padding: '14px 18px', background: '#FFF7ED',
          border: '1px solid #FED7AA', borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, background: '#FED7AA',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            fontSize: 18, fontWeight: 800, color: '#9A3412',
          }}>!</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#9A3412' }}>
              {actingCount} region{actingCount === 1 ? '' : 's'} without dedicated Regional Manager
            </div>
            <div style={{ fontSize: 12, color: '#9A3412', marginTop: 2 }}>
              You're providing acting coverage for these regions on top of your AD responsibilities. Open positions are a recruitment priority.
            </div>
          </div>
        </div>
      )}

      {/* Aggregate KPI strip */}
      <div style={{
        marginTop: 16,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 12,
      }}>
        <KPI label="Active Census"      value={aggregate.activeCensus}    sub={`across ${myRegions.length} regions`} />
        <KPI label="Visits This Week"   value={aggregate.scheduledWeek}   sub={`${aggregate.completedWeek} completed`} />
        <KPI label="Completion %"       value={aggregate.completion === null ? '—' : `${aggregate.completion}%`}
             accent={aggregate.completion >= 80 ? '#10B981' : aggregate.completion >= 60 ? '#F59E0B' : '#EF4444'} />
        <KPI label="Missed Visits"      value={aggregate.missedWeek}      sub={`${aggregate.missRate}% miss rate`}
             flag={aggregate.missRate > 10 ? 'High' : null} />
        <KPI label="Cancelled"          value={aggregate.cancelledWeek}   sub="this week" />
        <KPI label="Open Authorizations" value={aggregate.openAuth}       sub="pending or in-flight" />
      </div>

      {/* Region grid */}
      <div style={{
        marginTop: 20,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
        gap: 14,
      }}>
        {loading && (
          <div style={{ padding: 20, color: 'var(--gray)', fontSize: 13 }}>Loading regional data…</div>
        )}
        {!loading && regionCards.map(region => (
          <RegionCard
            key={region.letter}
            region={region}
            stats={regionStats[region.letter]}
            onDrillIn={handleDrillIntoRegion}
          />
        ))}
      </div>

      {/* TODO v1.1: Authorization lag tracking section
            Reads from auth_tracker. Compute median referral→SOC business days
            per region. Surface payor-level outliers. Will require joining
            intake_referrals.date_received with auth_tracker timestamps. */}

      {/* TODO v1.1: Documentation timeliness section
            Requires a documentation/notes table with submitted_at timestamps
            relative to visit completion. Patient_notes table may have what we
            need but needs investigation. */}

      {/* TODO v1.1: 24-hour status change diff panel
            Needs a patient_status_history equivalent. census_status_log table
            exists (4,384 rows) — likely the source. Surface every status
            transition in the last 24h scoped to the AD's regions. */}

      {/* TODO v1.1: Outlier panel
            Per-region z-score on completion %, miss rate, auth lag.
            Auto-surface regions 2+ stddev from the AD's own regional mean. */}
    </div>
  );
}
