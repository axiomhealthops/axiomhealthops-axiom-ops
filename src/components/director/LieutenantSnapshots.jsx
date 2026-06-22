// =====================================================================
// LieutenantSnapshots.jsx
//
// Compressed view of what Carla and Hervylie see on their own dashboards.
// Director-only — lets Liam verify what his direct reports are looking at
// without leaving his command page.
//
// Each snapshot mirrors the key headline numbers from the underlying
// dashboard:
//   - Carla (Ops Manager): stuck patients across pipeline, response
//     latency, total span
//   - Hervylie (Pod Leader): Region A care coord metrics
//
// Section is collapsible — collapsed by default so it doesn't dominate
// the page when not needed.
// =====================================================================

import { useState, useMemo } from 'react';

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

function Tile({ label, value, color, sub, alert }) {
  return (
    <div style={{
      padding: '8px 10px', background: alert ? '#FEF2F2' : '#F9FAFB',
      border: '1px solid ' + (alert ? '#FECACA' : '#E5E7EB'),
      borderRadius: 6, minWidth: 80, flex: 1,
    }}>
      <div style={{ fontSize: 9, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{
        fontSize: 18, fontWeight: 800, fontFamily: 'DM Mono, monospace',
        color: color || '#111827', lineHeight: 1.1, marginTop: 3,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 9, color: '#9CA3AF', marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Snapshot({ title, role, name, tiles, accent, onJumpTo, jumpTarget, jumpLabel }) {
  return (
    <div style={{
      background: 'white', border: '1px solid #E5E7EB',
      borderLeft: '4px solid ' + accent, borderRadius: 8,
      padding: '12px 14px', flex: 1, minWidth: 320,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, gap: 8 }}>
        <div>
          <div style={{ fontSize: 9, color: accent, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {title}
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#111827', marginTop: 2 }}>
            {name}
          </div>
          <div style={{ fontSize: 10, color: '#6B7280' }}>
            {role}
          </div>
        </div>
        {onJumpTo && jumpTarget && (
          <button
            onClick={function() { onJumpTo(jumpTarget); }}
            style={{
              background: 'none', border: '1px solid ' + accent, color: accent,
              padding: '4px 10px', fontSize: 10, fontWeight: 700, borderRadius: 5, cursor: 'pointer',
            }}>
            {jumpLabel || 'Open →'}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tiles.map(function(t, i) {
          return <Tile key={i} {...t} />;
        })}
      </div>
    </div>
  );
}

export default function LieutenantSnapshots({ census, intakeReferrals, auths, activityLog, onJumpTo }) {
  const [open, setOpen] = useState(false);

  const carlaTiles = useMemo(function() {
    // Mirror Carla's headline numbers
    var stuckPatients = census.filter(function(p) {
      var stage = stageFor(p.status);
      if (!stage) return false;
      var d = daysSince(p.status_changed_at);
      return d !== null && d > stage.days;
    });
    var unassigned = census.filter(function(p) {
      return stageFor(p.status) && !p.pipeline_assigned_to;
    }).length;
    var totalActive = census.filter(function(p) { return /^active/i.test(p.status || ''); }).length;
    var openAuths = (auths || []).filter(function(a) {
      var s = (a.auth_status || '').toLowerCase();
      return s === 'submitted' || s === 'pending';
    }).length;
    var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    var thisWeekRefs = (intakeReferrals || []).filter(function(r) { return r.date_received >= weekAgo; }).length;

    return [
      { label: 'Stuck total', value: stuckPatients.length, color: stuckPatients.length > 20 ? '#DC2626' : '#111827', alert: stuckPatients.length > 30 },
      { label: 'Unassigned', value: unassigned, color: unassigned > 0 ? '#DC2626' : '#059669', alert: unassigned > 5 },
      { label: 'Open auths', value: openAuths, color: '#7C3AED' },
      { label: 'Refs (7d)', value: thisWeekRefs, color: '#1565C0' },
      { label: 'Active', value: totalActive, color: '#059669' },
    ];
  }, [census, intakeReferrals, auths]);

  const hervylieTiles = useMemo(function() {
    var regionA = census.filter(function(p) { return p.region === 'A'; });
    var stuck = regionA.filter(function(p) {
      var stage = stageFor(p.status);
      if (!stage) return false;
      var d = daysSince(p.status_changed_at);
      return d !== null && d > stage.days;
    });
    var evalPending = regionA.filter(function(p) { return /eval.*pending/i.test(p.status || ''); }).length;
    var onHold = regionA.filter(function(p) { return /on hold|on_hold/i.test(p.status || ''); }).length;
    var hervylieActions24h = (activityLog || []).filter(function(a) {
      return /hervylie/i.test(a.coordinator_name || '');
    }).length;

    return [
      { label: 'Region A total', value: regionA.length, color: '#111827' },
      { label: 'Stuck', value: stuck.length, color: stuck.length > 5 ? '#DC2626' : '#111827', alert: stuck.length > 8 },
      { label: 'Eval pending', value: evalPending, color: '#059669' },
      { label: 'On hold', value: onHold, color: onHold > 0 ? '#D97706' : '#6B7280' },
      { label: 'Actions 24h', value: hervylieActions24h, color: hervylieActions24h === 0 ? '#DC2626' : '#059669', alert: hervylieActions24h === 0 },
    ];
  }, [census, activityLog]);

  return (
    <div style={{ marginBottom: 16 }}>
      <button
        onClick={function() { setOpen(!open); }}
        style={{
          width: '100%', background: 'white', border: '1px solid #E5E7EB',
          borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 12, fontWeight: 700, color: '#111827',
        }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          👥 Lieutenant Snapshots — Carla & Hervylie
          <span style={{ fontSize: 10, fontWeight: 400, color: '#6B7280' }}>
            What they're looking at right now
          </span>
        </span>
        <span style={{ fontSize: 14, color: '#9CA3AF' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{
          marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap',
        }}>
          <Snapshot
            title="Operations Manager"
            name="Carla Smith"
            role="Manages Intake / Auth / Care Coordination"
            accent="#06B6D4"
            tiles={carlaTiles}
            onJumpTo={onJumpTo}
            jumpTarget="ops-dashboard"
            jumpLabel="Open Ops →"
          />
          <Snapshot
            title="Pod Leader"
            name="Hervylie Manaay"
            role="Region A acting care coord coverage"
            accent="#1565C0"
            tiles={hervylieTiles}
            onJumpTo={onJumpTo}
            jumpTarget="coordinator-portal"
            jumpLabel="Open POD →"
          />
        </div>
      )}
    </div>
  );
}
