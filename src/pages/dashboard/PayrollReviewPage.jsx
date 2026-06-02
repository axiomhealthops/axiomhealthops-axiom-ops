// =====================================================================
// PayrollReviewPage.jsx
//
// Weekly / biweekly payroll variance + audit screen. Reconciles three
// data sources to flag clinician payroll submissions that don't seem
// right:
//   1. Paylocity clock/PTO/OT/training hours
//        — mirrored nightly from axiom-payroll Firestore (Phase 2B)
//   2. Mileage submissions
//        — mirrored nightly from axiom-payroll Firestore (Phase 2B)
//   3. Pariox completed visits
//        — already in this project's visit_schedule_data
//
// Variance math: (Paylocity Reg+OT hrs) vs (completed_visits x 60 min).
// 60-min minimum per Liam (2026-06-02). Editable via visit_duration_
// assumptions table.
//
// Reference: docs/Payroll_Review_Design.md (rev 2).
//
// ──────────────────────────────────────────────────────────────────────
// PHASE 2A STATUS (this commit):
//   - Page scaffold + sidebar wiring + role gating only.
//   - No data calls yet. Firestore mirror Edge Function is Phase 2B.
//   - Tables payroll_periods / payroll_reviews / payroll_flag_rules /
//     visit_duration_assumptions / clinician_payroll_map exist in
//     Supabase as of migration payroll_review_phase2a_schema.
// ──────────────────────────────────────────────────────────────────────
// =====================================================================

import { useState } from 'react';
import TopBar from '../../components/TopBar';
import WeekSelector from '../../components/WeekSelector';
import { useAuth } from '../../hooks/useAuth';

export default function PayrollReviewPage() {
  const { profile } = useAuth();
  const [weekOffset, setWeekOffset] = useState(0);

  // Phase 2B will load these from payroll_reviews joined with
  // payroll_periods for the selected window.
  const reviews = [];
  const kpis = {
    clinicians: 0,
    flagged: 0,
    dollarAtRisk: 0,
    approved: 0,
  };

  return (
    <div>
      <TopBar
        title="Payroll Review"
        subtitle="Variance + audit across Paylocity, mileage portal, and Pariox visits"
      />

      <div style={S.body}>
        {/* Filter strip */}
        <div style={S.filterStrip}>
          <WeekSelector
            value={weekOffset}
            onChange={setWeekOffset}
            storageKey="payroll_review_week"
          />
          <div style={S.filterHint}>
            Sun-Sat work week. Biweekly view coming in Phase 2B.
          </div>
        </div>

        {/* KPI strip */}
        <div style={S.kpiStrip}>
          <Kpi label="Clinicians" value={kpis.clinicians} />
          <Kpi label="Flagged" value={kpis.flagged} accent="#DC2626" />
          <Kpi
            label="Dollar at risk"
            value={`$${kpis.dollarAtRisk.toLocaleString()}`}
            accent="#B45309"
          />
          <Kpi
            label="Approved"
            value={`${kpis.approved} / ${kpis.clinicians}`}
            accent="#059669"
          />
        </div>

        {/* Phase 2A empty state — awaiting Firestore mirror */}
        <div style={S.emptyCard}>
          <div style={S.emptyTitle}>Awaiting Firestore mirror</div>
          <div style={S.emptyBody}>
            This page is wired up but the Phase 2B Edge Function that mirrors
            payroll + mileage from the axiom-payroll portal has not been
            deployed yet. Two unblockers needed from {profile?.full_name || 'Liam'}:
            <ul style={S.checklist}>
              <li>Firebase service-account key for project <code>axiom-payroll</code></li>
              <li>CEO heads-up that we are mirroring his Firestore (read-only, nightly)</li>
            </ul>
            See <code>docs/Payroll_Review_Design.md</code> §1 for the full plan.
          </div>
        </div>

        {/* Stub table — visible structure, no rows yet */}
        <div style={S.tableCard}>
          <div style={S.tableHeader}>
            <div>Clinician</div>
            <div>Reg hrs</div>
            <div>OT</div>
            <div>PTO</div>
            <div>Visits</div>
            <div>Expected hrs</div>
            <div>Variance %</div>
            <div>Mileage</div>
            <div>Flags</div>
            <div>$ at risk</div>
            <div>Status</div>
          </div>
          {reviews.length === 0 && (
            <div style={S.tableEmpty}>
              No payroll reviews to show. After the Firestore mirror runs,
              one row per clinician per pay period will appear here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }) {
  return (
    <div style={S.kpi}>
      <div style={S.kpiLabel}>{label}</div>
      <div style={{ ...S.kpiValue, color: accent || 'var(--black)' }}>
        {value}
      </div>
    </div>
  );
}

const S = {
  body: { padding: 24, maxWidth: 1600, margin: '0 auto' },
  filterStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  filterHint: { fontSize: 12, color: 'var(--gray)' },
  kpiStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
    marginBottom: 20,
  },
  kpi: {
    padding: '16px 18px',
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
  },
  kpiLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--gray)',
    marginBottom: 6,
  },
  kpiValue: { fontSize: 22, fontWeight: 700 },
  emptyCard: {
    background: '#FFFBEB',
    border: '1px solid #FCD34D',
    borderRadius: 8,
    padding: 20,
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#92400E',
    marginBottom: 8,
  },
  emptyBody: { fontSize: 13, color: '#78350F', lineHeight: 1.5 },
  checklist: { margin: '8px 0 0 18px', padding: 0 },
  tableCard: {
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableHeader: {
    display: 'grid',
    gridTemplateColumns:
      '1.6fr 0.7fr 0.6fr 0.6fr 0.7fr 0.9fr 0.9fr 0.8fr 0.8fr 0.9fr 0.9fr',
    gap: 8,
    padding: '12px 16px',
    background: '#F9FAFB',
    borderBottom: '1px solid var(--border)',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--gray)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  tableEmpty: {
    padding: '32px 16px',
    textAlign: 'center',
    fontSize: 13,
    color: 'var(--gray)',
  },
};
