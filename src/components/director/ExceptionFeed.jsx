// =====================================================================
// ExceptionFeed.jsx
//
// Director-only "only show me what's broken" feed. The opposite of a
// dashboard — this is an inbox. Each row represents a specific
// accountability failure that warrants Liam's attention TODAY.
//
// Exception types (each computed against the live data passed in):
//   1. DEAD SPOTS — patient stuck > 2x stage threshold AND zero logged
//      action by the assigned owner in the last 48 hours
//   2. UNASSIGNED + STUCK — patient stuck past threshold AND nobody is
//      named on pipeline_assigned_to / assigned_to. Carla's accountability.
//   3. INACTIVE COORDINATORS — active-role coordinators with zero activity
//      in last 24h (excludes ADs/admins who may not log directly)
//   4. VACANT-REGION ALERTS — regions with AD-acting coverage where the
//      acting AD hasn't taken any logged action on patients in 48h
//
// Each row supports a one-click "jump to" that fires onJumpTo(target, intent).
// =====================================================================

import { useMemo } from 'react';
import { REGION_TO_AD, ASSOC_DIRECTORS } from '../../lib/constants';

const STAGE_THRESHOLDS = [
  { test: function(s) { return /soc.*pending/i.test(s); }, days: 3, label: 'SOC Pending' },
  { test: function(s) { return /auth.*pending/i.test(s) && !/active/i.test(s); }, days: 5, label: 'Auth Pending' },
  { test: function(s) { return /eval.*pending/i.test(s); }, days: 2, label: 'Eval Pending' },
];

function stageFor(status) {
  for (var i = 0; i < STAGE_THRESHOLDS.length; i++) {
    if (STAGE_THRESHOLDS[i].test(status || '')) return STAGE_THRESHOLDS[i];
  }
  return null;
}
function daysSince(iso) {
  if (!iso) return null;
  var d = new Date(iso).getTime();
  if (isNaN(d)) return null;
  return Math.max(0, Math.ceil((Date.now() - d) / 86400000));
}

// ─── Severity classifier ────────────────────────────────────────────────
function severityFor(exception) {
  // P1 = blocker (no movement in 7+ days), P2 = needs action (3-7d), P3 = watch
  if (exception.type === 'DEAD_SPOT' && exception.daysSinceLastAction >= 7) return 'P1';
  if (exception.type === 'UNASSIGNED' && exception.daysStuck >= 7) return 'P1';
  if (exception.type === 'VACANT_REGION') return 'P1';
  if (exception.type === 'INACTIVE_COORDINATOR' && exception.hoursInactive >= 48) return 'P1';
  if (exception.type === 'INACTIVE_COORDINATOR') return 'P2';
  return 'P2';
}

function ExceptionRow({ exception, onJumpTo }) {
  var sev = severityFor(exception);
  var sevColor = sev === 'P1' ? '#DC2626' : sev === 'P2' ? '#D97706' : '#6B7280';
  var sevBg = sev === 'P1' ? '#FEF2F2' : sev === 'P2' ? '#FFFBEB' : '#F9FAFB';

  // Configure per-type display
  var icon, headline, owner, meta, jumpTarget, jumpIntent;
  switch (exception.type) {
    case 'DEAD_SPOT':
      icon = '🪦';
      headline = exception.patientName + ' · ' + exception.stage + ' for ' + exception.daysStuck + 'd';
      owner = exception.owner || '⚠ unassigned';
      meta = 'No action by owner in ' + exception.daysSinceLastAction + 'd';
      jumpTarget = 'ops-dashboard';
      break;
    case 'UNASSIGNED':
      icon = '🚫';
      headline = exception.patientName + ' · ' + exception.stage + ' for ' + exception.daysStuck + 'd';
      owner = '⚠ Nobody assigned';
      meta = 'Accountability gap · ' + (exception.region ? 'Region ' + exception.region : 'no region');
      jumpTarget = 'ops-dashboard';
      break;
    case 'INACTIVE_COORDINATOR':
      icon = '💤';
      headline = exception.coordinatorName + ' · ' + exception.role;
      owner = exception.team || exception.role;
      meta = exception.hoursInactive === Infinity
        ? 'No activity in last 24h'
        : 'Last action ' + exception.hoursInactive + 'h ago';
      jumpTarget = 'staff';
      break;
    case 'VACANT_REGION':
      icon = '🗺️';
      headline = 'Region ' + exception.region + ' · ' + exception.actingAD + ' acting';
      owner = exception.actingAD;
      meta = 'No logged actions on region patients in ' + exception.hoursInactive + 'h';
      jumpTarget = 'rm-dashboard';
      jumpIntent = { region: exception.region };
      break;
    default:
      return null;
  }

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '36px 28px 1fr 110px 110px 60px',
      padding: '10px 14px', borderBottom: '1px solid #F3F4F6',
      alignItems: 'center', fontSize: 11, gap: 8,
      transition: 'background 0.1s',
    }}
      onMouseEnter={function(e) { e.currentTarget.style.background = '#FAFAFA'; }}
      onMouseLeave={function(e) { e.currentTarget.style.background = 'white'; }}>
      <div style={{
        padding: '2px 6px', background: sevBg, color: sevColor,
        fontSize: 9, fontWeight: 800, borderRadius: 3, textAlign: 'center',
        fontFamily: 'DM Mono, monospace',
      }}>{sev}</div>
      <div style={{ fontSize: 16, textAlign: 'center' }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: '#111827',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {headline}
        </div>
        <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
          {meta}
        </div>
      </div>
      <div style={{
        fontSize: 11, fontWeight: 600,
        color: /unassigned|nobody/i.test(owner) ? '#991B1B' : '#374151',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {owner}
      </div>
      <div style={{ fontSize: 10, color: '#6B7280' }}>
        {exception.type.replace(/_/g, ' ').toLowerCase()}
      </div>
      <button
        onClick={function() { if (typeof onJumpTo === 'function') onJumpTo(jumpTarget, jumpIntent); }}
        style={{
          background: '#111827', color: 'white', border: 'none', borderRadius: 4,
          padding: '4px 8px', fontSize: 9, fontWeight: 700, cursor: 'pointer',
        }}>Open →</button>
    </div>
  );
}

// ─── Main export ────────────────────────────────────────────────────────
export default function ExceptionFeed({ census, activityLog, coordinators, onJumpTo }) {

  const exceptions = useMemo(function() {
    var out = [];
    if (!census || census.length === 0) return out;

    // Index: latest activity per coordinator and per patient (proxy)
    var coordLastActionByName = {};
    activityLog.forEach(function(a) {
      var k = a.coordinator_name;
      if (!k) return;
      if (!coordLastActionByName[k] || a.created_at > coordLastActionByName[k]) {
        coordLastActionByName[k] = a.created_at;
      }
    });

    // 1. DEAD SPOTS + UNASSIGNED — scan stuck patients
    census.forEach(function(p) {
      var stage = stageFor(p.status);
      if (!stage) return;
      var d = daysSince(p.status_changed_at);
      if (d === null || d <= stage.days) return;

      var owner = p.pipeline_assigned_to;
      var isDeadlyStuck = d > stage.days * 2;

      if (!owner && d > stage.days) {
        // UNASSIGNED + stuck — Carla's job to triage
        out.push({
          type: 'UNASSIGNED',
          patientName: p.patient_name,
          region: p.region,
          stage: stage.label,
          daysStuck: d,
        });
      } else if (owner && isDeadlyStuck) {
        // DEAD SPOT — owner exists but isn't moving the patient
        var lastAction = coordLastActionByName[owner];
        var daysSinceLast = lastAction ? daysSince(lastAction) : 99;
        if (daysSinceLast >= 2) {
          out.push({
            type: 'DEAD_SPOT',
            patientName: p.patient_name,
            region: p.region,
            stage: stage.label,
            daysStuck: d,
            owner: owner,
            daysSinceLastAction: daysSinceLast,
          });
        }
      }
    });

    // 2. INACTIVE COORDINATORS — frontline roles with no activity in 24h
    var frontlineRoles = ['intake_coordinator', 'auth_coordinator', 'care_coordinator'];
    coordinators.forEach(function(c) {
      if (frontlineRoles.indexOf(c.role) < 0) return;
      var lastAction = coordLastActionByName[c.full_name];
      var hoursInactive;
      if (!lastAction) {
        hoursInactive = Infinity;
      } else {
        hoursInactive = Math.round((Date.now() - new Date(lastAction).getTime()) / 3600000);
      }
      if (hoursInactive >= 24) {
        out.push({
          type: 'INACTIVE_COORDINATOR',
          coordinatorName: c.full_name,
          role: c.role,
          team: c.team,
          hoursInactive: hoursInactive,
        });
      }
    });

    // 3. VACANT REGION ALERTS — acting-AD regions where AD has not logged
    //    any action recently. Acting regions per Liam (2026-05-15 reorg):
    //    B, G → Lia · M, N → Ariel · T, V → Samantha
    var actingRegions = {
      B: 'Lia Davis', G: 'Lia Davis',
      M: 'Ariel Maboudi', N: 'Ariel Maboudi',
      T: 'Samantha Faliks', V: 'Samantha Faliks',
    };
    var alreadyAlerted = {};
    Object.keys(actingRegions).forEach(function(rgn) {
      var actingAD = actingRegions[rgn];
      var lastAction = coordLastActionByName[actingAD];
      var hoursInactive;
      if (!lastAction) {
        hoursInactive = Infinity;
      } else {
        hoursInactive = Math.round((Date.now() - new Date(lastAction).getTime()) / 3600000);
      }
      // Only alert if 48h+ AND we haven't already added an alert for this AD
      // (one row per AD-acting situation, not one per region they cover)
      var key = actingAD + ':' + (hoursInactive >= 48 ? '48' : 'ok');
      if (hoursInactive >= 48 && !alreadyAlerted[actingAD]) {
        alreadyAlerted[actingAD] = true;
        out.push({
          type: 'VACANT_REGION',
          region: rgn,
          actingAD: actingAD,
          hoursInactive: hoursInactive === Infinity ? 999 : hoursInactive,
        });
      }
    });

    // Sort by severity (P1 first), then by "how bad" within type
    function sevRank(e) { return severityFor(e) === 'P1' ? 0 : severityFor(e) === 'P2' ? 1 : 2; }
    function withinSort(e) {
      if (e.type === 'DEAD_SPOT') return -e.daysStuck;
      if (e.type === 'UNASSIGNED') return -e.daysStuck;
      if (e.type === 'INACTIVE_COORDINATOR') return -e.hoursInactive;
      if (e.type === 'VACANT_REGION') return -e.hoursInactive;
      return 0;
    }
    out.sort(function(a, b) {
      var s = sevRank(a) - sevRank(b);
      if (s !== 0) return s;
      return withinSort(a) - withinSort(b);
    });

    return out;
  }, [census, activityLog, coordinators]);

  var p1Count = exceptions.filter(function(e) { return severityFor(e) === 'P1'; }).length;
  var p2Count = exceptions.filter(function(e) { return severityFor(e) === 'P2'; }).length;

  return (
    <div style={{
      background: 'white', border: '1px solid #E5E7EB', borderRadius: 10,
      overflow: 'hidden', marginBottom: 16,
    }}>
      <div style={{
        padding: '12px 14px', borderBottom: '1px solid #E5E7EB',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
            🚨 Live Exception Feed
            <span style={{ fontSize: 10, fontWeight: 400, color: '#6B7280' }}>
              Only what's broken · sorted by severity · one-click jump-to
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {p1Count > 0 && (
            <span style={{
              padding: '3px 9px', background: '#FEF2F2', color: '#DC2626',
              fontSize: 11, fontWeight: 800, borderRadius: 4, fontFamily: 'DM Mono, monospace',
            }}>
              {p1Count} P1
            </span>
          )}
          {p2Count > 0 && (
            <span style={{
              padding: '3px 9px', background: '#FFFBEB', color: '#D97706',
              fontSize: 11, fontWeight: 800, borderRadius: 4, fontFamily: 'DM Mono, monospace',
            }}>
              {p2Count} P2
            </span>
          )}
          {exceptions.length === 0 && (
            <span style={{ fontSize: 11, color: '#059669', fontWeight: 700 }}>✓ All clear</span>
          )}
        </div>
      </div>
      {exceptions.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: '#10B981', fontSize: 12 }}>
          ✅ No exceptions today. Pipeline owners are on top of things.
        </div>
      ) : (
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '36px 28px 1fr 110px 110px 60px',
            padding: '7px 14px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB',
            fontSize: 9, fontWeight: 700, color: '#6B7280',
            textTransform: 'uppercase', letterSpacing: '0.04em', gap: 8,
            position: 'sticky', top: 0, zIndex: 1,
          }}>
            <span>Sev</span>
            <span></span>
            <span>Issue</span>
            <span>Owner</span>
            <span>Type</span>
            <span></span>
          </div>
          {exceptions.slice(0, 50).map(function(ex, i) {
            return <ExceptionRow key={i} exception={ex} onJumpTo={onJumpTo} />;
          })}
          {exceptions.length > 50 && (
            <div style={{
              padding: 10, textAlign: 'center', fontSize: 10, color: '#9CA3AF', background: '#F9FAFB',
            }}>
              Showing 50 of {exceptions.length} · sorted by severity desc
            </div>
          )}
        </div>
      )}
    </div>
  );
}
