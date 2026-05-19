// RiskBadge.jsx
//
// Small inline badge that flags a patient who appears on the High Risk
// watchlist (patient_risk_factors). Designed to drop next to a patient
// name across the system: Patient Census, Coordinator Portal, Clinician
// Accountability, SWIFT Team, Hospitalization Tracker.
//
// Usage:
//   import { useRiskMap } from '../hooks/useRiskMap';
//   import RiskBadge from '../components/RiskBadge';
//
//   const risk = useRiskMap();
//   ...
//   <span>{name} <RiskBadge profile={risk.get(name, region)} /></span>
//
// Or, when no profile is in scope, pass `name` and `region` directly:
//   <RiskBadge name={name} region={region} risk={risk} />
//
// Badge variants:
//   LOC 5  — red dot     ("LOC 5")
//   LOC 4  — orange dot  ("LOC 4")
//   LOC 3  — yellow dot  (only shown when `showAll=true`)
//   else   — not rendered (returns null) unless `showAll=true`
//
// Click on the badge opens the High Risk Patients page filtered to LOC 4+5
// via the dispatched `axiom-navigate` window event the dashboard listens for.
//
// CLAUDE.md compliance: no inline unicode characters in JSX text. All
// special chars wrapped in JS expressions.

import React from 'react';
import { useRiskMap } from '../hooks/useRiskMap';

const STYLES = {
  5: { color: '#7F1D1D', bg: '#FEE2E2', border: '#FCA5A5', dot: '#DC2626', label: 'LOC 5' },
  4: { color: '#9A3412', bg: '#FFEDD5', border: '#FDBA74', dot: '#EA580C', label: 'LOC 4' },
  3: { color: '#92400E', bg: '#FEF3C7', border: '#FDE68A', dot: '#D97706', label: 'LOC 3' },
  2: { color: '#1565C0', bg: '#EFF6FF', border: '#BFDBFE', dot: '#3B82F6', label: 'LOC 2' },
  1: { color: '#065F46', bg: '#ECFDF5', border: '#A7F3D0', dot: '#10B981', label: 'LOC 1' },
};

function navigateToHighRisk() {
  window.dispatchEvent(new CustomEvent('axiom-navigate', {
    detail: { page: 'high-risk-patients', intent: { filter: 'loc45' } },
  }));
}

function buildTooltip(p) {
  if (!p) return '';
  const flags = [];
  if (p.has_wounds) flags.push('wounds');
  if (p.comorbidities_3plus) flags.push('3+ comorbidities');
  if (p.falls_6mo) flags.push('falls in 6mo');
  if (p.high_compliance_risk) flags.push('high compliance risk');
  if (p.high_environmental_risk) flags.push('high environmental risk');
  const cm = p.caremap_score !== null && p.caremap_score !== undefined ? `CareMap ${p.caremap_score}` : 'No CareMap on file';
  const flagStr = flags.length ? ` — ${flags.join(', ')}` : '';
  return `${p.loc_level ? `LOC ${p.loc_level}` : 'High-risk watchlist'} ${'·'} ${cm}${flagStr}`;
}

// Single source of truth for the badge UI.
export default function RiskBadge({ profile, name, region, risk, showAll = false, size = 'sm', onClick }) {
  // Lookup profile from a passed-in useRiskMap() instance if not given directly
  const p = profile || (risk && risk.get ? risk.get(name, region) : null);
  if (!p) return null;
  const loc = p.loc_level;
  if (!showAll && (loc !== 4 && loc !== 5)) return null;
  const s = STYLES[loc] || STYLES[3];

  const small = size === 'sm';
  const handleClick = onClick || (() => navigateToHighRisk());

  return (
    <span
      title={buildTooltip(p)}
      onClick={(e) => { e.stopPropagation(); handleClick(p); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: small ? 9 : 10, fontWeight: 800, lineHeight: 1,
        color: s.color, background: s.bg, border: `1px solid ${s.border}`,
        padding: small ? '2px 5px' : '3px 7px',
        borderRadius: 999, marginLeft: 6, cursor: 'pointer',
        verticalAlign: 'middle', whiteSpace: 'nowrap', userSelect: 'none',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot, display: 'inline-block' }} />
      {s.label}
    </span>
  );
}

// Self-contained variant: fetches its own copy of the risk map so a page
// that doesn't already use useRiskMap can drop in a single import. Less
// efficient for long lists (each badge fetches) — prefer passing `risk`
// from a parent useRiskMap() call when rendering many badges.
export function RiskBadgeForPatient({ name, region, showAll = false, size = 'sm' }) {
  const risk = useRiskMap();
  if (risk.loading) return null;
  return <RiskBadge name={name} region={region} risk={risk} showAll={showAll} size={size} />;
}
