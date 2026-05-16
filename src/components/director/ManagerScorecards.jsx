// =====================================================================
// ManagerScorecards.jsx
//
// Director-only manager accountability strip. Three tiers stacked:
//   Tier 1: Carla (Ops Manager) + Hervylie (Pod Leader)
//   Tier 2: Associate Directors (Lia, Samantha, Ariel)
//   Tier 3: Regional Managers / Team Members (collapsed by default)
//
// Each scorecard shows:
//   - Manager name + role + span (regions they cover, # patients)
//   - SPAN HEALTH (lead metric): median days-stuck for stuck patients in span
//   - RESPONSE LATENCY (leading indicator): avg hours from SLA breach in their
//     span to their next logged action on that patient
//   - 7-day sparkline of span health
//   - Composite traffic light (green / amber / red)
//
// Scoring philosophy (decided with Liam, 2026-05-16):
//   - Span health = the outcome they're paid to deliver
//   - Response latency = the leading indicator that separates active from
//     passive managers — measurable via coordinator_activity_log
//   - Director-only visibility (private) — no manager sees their own score yet
//
// Data dependencies (all passed in from parent):
//   - census (with status, region, status_changed_at, pipeline_assigned_to)
//   - statusLog (last 30d of census_status_log transitions)
//   - activityLog (last 7d of coordinator_activity_log entries)
//   - coordinators (active users with role + regions)
// =====================================================================

import { useMemo } from 'react';
import { FL_PARENT_REGIONS, ASSOC_DIRECTORS, REGION_TO_PARENT } from '../../lib/constants';

// Stage thresholds (in calendar days) — must match Carla's Ops Dashboard so
// "stuck" means the same thing across the org. Kept inline here rather than
// imported so this component is self-contained for testing.
const STAGE_THRESHOLDS = [
  { test: function(s) { return /soc.*pending/i.test(s); }, days: 3, label: 'SOC Pending' },
  { test: function(s) { return /auth.*pending/i.test(s) && !/active/i.test(s); }, days: 5, label: 'Auth Pending' },
  { test: function(s) { return /eval.*pending/i.test(s); }, days: 2, label: 'Eval Pending' },
];

function daysSince(iso) {
  if (!iso) return null;
  var d = new Date(iso).getTime();
  if (isNaN(d)) return null;
  return Math.max(0, Math.ceil((Date.now() - d) / 86400000));
}
function hoursSince(iso) {
  if (!iso) return null;
  var d = new Date(iso).getTime();
  if (isNaN(d)) return null;
  return Math.max(0, Math.round((Date.now() - d) / 3600000));
}
function median(arr) {
  if (!arr || arr.length === 0) return null;
  var s = arr.slice().sort(function(a, b) { return a - b; });
  var m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[m - 1] + s[m]) / 2) : s[m];
}

// Find the stage threshold for a given status string.
// Returns null if patient is not in a "stuck-able" stage (e.g. Active).
function stageFor(status) {
  for (var i = 0; i < STAGE_THRESHOLDS.length; i++) {
    if (STAGE_THRESHOLDS[i].test(status || '')) return STAGE_THRESHOLDS[i];
  }
  return null;
}

// ─── Sparkline ──────────────────────────────────────────────────────────
function Sparkline({ values, color, width, height }) {
  if (!values || values.length === 0) return null;
  var w = width || 60;
  var h = height || 20;
  var max = Math.max.apply(null, values.concat([1]));
  var pts = values.map(function(v, i) {
    var x = (i / (values.length - 1 || 1)) * w;
    var y = h - (v / max) * (h - 2) - 1;
    return x + ',' + y;
  }).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── Single Scorecard ───────────────────────────────────────────────────
function ManagerCard({ scorecard, onClick }) {
  var sc = scorecard;
  var spanHealthColor = sc.spanHealth === null ? '#9CA3AF'
    : sc.spanHealth <= 4 ? '#059669'
    : sc.spanHealth <= 7 ? '#D97706'
    : '#DC2626';
  var latencyColor = sc.responseLatency === null ? '#9CA3AF'
    : sc.responseLatency <= 24 ? '#059669'
    : sc.responseLatency <= 48 ? '#D97706'
    : '#DC2626';
  // Composite traffic light: worst of the two
  var compositeColor = [spanHealthColor, latencyColor].reduce(function(worst, c) {
    if (c === '#DC2626') return '#DC2626';
    if (c === '#D97706' && worst !== '#DC2626') return '#D97706';
    if (worst === '#059669' || worst === '#9CA3AF') return c;
    return worst;
  }, '#059669');

  return (
    <div
      onClick={onClick}
      style={{
        background: 'white', border: '1px solid #E5E7EB', borderLeft: '4px solid ' + compositeColor,
        borderRadius: 10, padding: '12px 14px',
        cursor: typeof onClick === 'function' ? 'pointer' : 'default',
        transition: 'transform 0.1s, box-shadow 0.15s, border-color 0.15s',
        display: 'flex', flexDirection: 'column', gap: 8,
        minHeight: 140,
      }}
      onMouseEnter={typeof onClick === 'function' ? function(e) {
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      } : null}
      onMouseLeave={typeof onClick === 'function' ? function(e) {
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.transform = 'translateY(0)';
      } : null}>
      {/* Header: name + role + span */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {sc.name}
          </div>
          <div style={{ fontSize: 9, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2 }}>
            {sc.role}
          </div>
        </div>
        <div style={{
          flexShrink: 0, padding: '2px 7px', background: '#F3F4F6', borderRadius: 4,
          fontSize: 9, fontWeight: 700, color: '#374151', fontFamily: 'DM Mono, monospace',
        }}>
          {sc.totalPatients} pt
        </div>
      </div>
      {/* Span */}
      <div style={{ fontSize: 9, color: '#9CA3AF' }}>
        Span: {sc.spanLabel}
      </div>
      {/* Two-up metrics: span health + response latency */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'end' }}>
        <div>
          <div style={{ fontSize: 8, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
            Span Health
          </div>
          <div style={{
            fontSize: 22, fontWeight: 900, fontFamily: 'DM Mono, monospace',
            color: spanHealthColor, lineHeight: 1, marginTop: 2,
          }}>
            {sc.spanHealth !== null ? sc.spanHealth + 'd' : '—'}
          </div>
          <div style={{ fontSize: 8, color: '#9CA3AF', marginTop: 2 }}>
            median stuck · {sc.stuckCount} stuck
          </div>
        </div>
        <div>
          <div style={{ fontSize: 8, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
            Response
          </div>
          <div style={{
            fontSize: 22, fontWeight: 900, fontFamily: 'DM Mono, monospace',
            color: latencyColor, lineHeight: 1, marginTop: 2,
          }}>
            {sc.responseLatency !== null ? sc.responseLatency + 'h' : 'N/A'}
          </div>
          <div style={{ fontSize: 8, color: '#9CA3AF', marginTop: 2 }}>
            avg breach → action
          </div>
        </div>
      </div>
      {/* Sparkline + summary footer */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 6, borderTop: '1px solid #F3F4F6',
      }}>
        <div style={{ fontSize: 9, color: '#6B7280' }}>
          7d trend
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkline values={sc.sparkline} color={compositeColor} />
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
            background: compositeColor + '22', color: compositeColor,
          }}>
            {compositeColor === '#059669' ? '✓ Healthy' : compositeColor === '#D97706' ? '⚠ Watch' : compositeColor === '#DC2626' ? '✗ Action' : '— No data'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Tier row wrapper ───────────────────────────────────────────────────
function TierRow({ label, cards, onCardClick }) {
  if (!cards || cards.length === 0) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#6B7280',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6,
      }}>
        {label} · {cards.length}
      </div>
      <div style={{
        display: 'grid', gap: 10,
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      }}>
        {cards.map(function(c) {
          return <ManagerCard key={c.id} scorecard={c} onClick={onCardClick ? function() { onCardClick(c); } : null} />;
        })}
      </div>
    </div>
  );
}

// ─── Main export ────────────────────────────────────────────────────────
export default function ManagerScorecards({ census, statusLog, activityLog, coordinators, onScorecardClick }) {

  // Build scorecards by walking the org tree
  const tiers = useMemo(function() {
    if (!coordinators || coordinators.length === 0) {
      return { tier1: [], tier2: [], tier3: [] };
    }

    // Helper: compute a scorecard for a manager given their span of regions.
    // For Carla (Ops Manager), span is ALL regions.
    function scorecardFor(manager, regions, spanLabel) {
      // Patients in their span
      var spanCensus = regions === 'ALL'
        ? census
        : census.filter(function(p) { return regions.indexOf(p.region) >= 0; });

      // Stuck patients in span — patient is in a stuck-able stage AND exceeds threshold
      var stuckPatients = spanCensus.map(function(p) {
        var stage = stageFor(p.status);
        if (!stage) return null;
        // Days in current status
        var d = daysSince(p.status_changed_at);
        if (d === null || d <= stage.days) return null;
        return { patient: p, stage: stage, daysStuck: d };
      }).filter(function(x) { return x !== null; });

      var stuckCount = stuckPatients.length;
      var spanHealth = stuckPatients.length > 0
        ? median(stuckPatients.map(function(x) { return x.daysStuck; }))
        : null;

      // Response latency — for each stuck patient, find when the manager next
      // logged an action on them after the SLA breach time. If they never did,
      // count it as "no response" and exclude from latency average (but flag count).
      // SLA breach time ≈ patient's status_changed_at + threshold days.
      var latencies = [];
      var noResponseCount = 0;
      stuckPatients.forEach(function(x) {
        var p = x.patient;
        var breachIso = new Date(new Date(p.status_changed_at).getTime() + x.stage.days * 86400000).toISOString();
        // Find activity entries by this manager on this patient after breach time.
        // coordinator_activity_log doesn't always link by patient_name — we approximate
        // by matching coordinator_name in records that mention the patient. Simpler proxy:
        // count ANY activity by the manager after the breach as "they were active during
        // the breach window" — this is admittedly noisy and we should refine if we add a
        // patient_name FK to the activity log later.
        var managerActions = activityLog.filter(function(a) {
          return a.coordinator_name === manager.name && a.created_at > breachIso;
        });
        if (managerActions.length === 0) {
          noResponseCount++;
        } else {
          // Earliest action after breach
          var earliest = managerActions.reduce(function(min, a) {
            return a.created_at < min ? a.created_at : min;
          }, managerActions[0].created_at);
          var hrs = (new Date(earliest).getTime() - new Date(breachIso).getTime()) / 3600000;
          if (hrs >= 0) latencies.push(Math.round(hrs));
        }
      });
      var responseLatency = latencies.length > 0 ? median(latencies) : null;

      // 7-day sparkline — for each of the last 7 days, count how many patients
      // in the span were stuck at that point. Simple proxy of span trajectory.
      var sparkline = [];
      for (var d = 6; d >= 0; d--) {
        var asOf = Date.now() - d * 86400000;
        var stuckThatDay = spanCensus.filter(function(p) {
          var stage = stageFor(p.status);
          if (!stage) return false;
          var dd = (asOf - new Date(p.status_changed_at).getTime()) / 86400000;
          return dd > stage.days;
        }).length;
        sparkline.push(stuckThatDay);
      }

      return {
        id: manager.id,
        name: manager.name,
        role: manager.role,
        spanLabel: spanLabel,
        regions: regions,
        totalPatients: spanCensus.length,
        stuckCount: stuckCount,
        spanHealth: spanHealth,
        responseLatency: responseLatency,
        noResponseCount: noResponseCount,
        sparkline: sparkline,
      };
    }

    // ── Build Tier 1: Carla + Hervylie ─────────────────────────────────
    var tier1 = [];
    var carla = coordinators.find(function(c) { return /carla/i.test(c.full_name || ''); });
    if (carla) {
      tier1.push(scorecardFor(
        { id: carla.id, name: carla.full_name, role: 'Operations Manager' },
        'ALL',
        'All regions, all teams'
      ));
    }
    var hervylie = coordinators.find(function(c) { return /hervylie/i.test(c.full_name || ''); });
    if (hervylie) {
      // Hervylie is Pod Leader covering Region A care coord
      tier1.push(scorecardFor(
        { id: hervylie.id, name: hervylie.full_name, role: 'Pod Leader · Region A coverage' },
        ['A'],
        'Region A (acting care coord)'
      ));
    }

    // ── Build Tier 2: Associate Directors ──────────────────────────────
    var tier2 = [];
    Object.keys(ASSOC_DIRECTORS).forEach(function(parentRegion) {
      var adName = ASSOC_DIRECTORS[parentRegion];
      var ad = coordinators.find(function(c) { return c.full_name === adName; });
      if (ad) {
        tier2.push(scorecardFor(
          { id: ad.id, name: ad.full_name, role: 'AD · ' + parentRegion },
          FL_PARENT_REGIONS[parentRegion],
          parentRegion + ' · regions ' + FL_PARENT_REGIONS[parentRegion].join(', ')
        ));
      }
    });

    // ── Build Tier 3: Regional Managers / Team Members ─────────────────
    var tier3 = [];
    coordinators.forEach(function(c) {
      if (c.role !== 'regional_manager' && c.role !== 'team_member' && c.role !== 'pod_leader') return;
      // Skip Hervylie (already in tier 1) and anyone already counted as AD
      if (/hervylie/i.test(c.full_name || '')) return;
      if (Object.values(ASSOC_DIRECTORS).indexOf(c.full_name) >= 0) return;
      var regions = c.regions && c.regions.length > 0 ? c.regions : [];
      if (regions.length === 0) return;
      tier3.push(scorecardFor(
        { id: c.id, name: c.full_name, role: c.role === 'regional_manager' ? 'Regional Manager' : c.role === 'pod_leader' ? 'Pod Leader' : 'Team Member' },
        regions,
        regions.length === 1 ? 'Region ' + regions[0] : 'Regions ' + regions.join(', ')
      ));
    });

    // Sort tier 2 + 3 by health (worst first — that's where Liam's attention goes)
    function worstFirst(a, b) {
      if (a.spanHealth === null && b.spanHealth === null) return 0;
      if (a.spanHealth === null) return 1;
      if (b.spanHealth === null) return -1;
      return b.spanHealth - a.spanHealth;
    }
    tier2.sort(worstFirst);
    tier3.sort(worstFirst);

    return { tier1: tier1, tier2: tier2, tier3: tier3 };
  }, [census, statusLog, activityLog, coordinators]);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 13, fontWeight: 800, color: '#111827', marginBottom: 10,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        🎯 Manager Accountability
        <span style={{ fontSize: 10, fontWeight: 400, color: '#6B7280' }}>
          Span health (lagging) + response latency (leading) · director-only · click any card to drill in
        </span>
      </div>
      <TierRow label="Direct Reports" cards={tiers.tier1} onCardClick={onScorecardClick} />
      <TierRow label="Associate Directors" cards={tiers.tier2} onCardClick={onScorecardClick} />
      <details style={{ marginTop: 8 }}>
        <summary style={{
          cursor: 'pointer', fontSize: 10, color: '#6B7280', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 0',
        }}>
          ▸ Regional Managers / Team Members ({tiers.tier3.length})
        </summary>
        <div style={{ marginTop: 8 }}>
          <TierRow label="" cards={tiers.tier3} onCardClick={onScorecardClick} />
        </div>
      </details>
    </div>
  );
}
