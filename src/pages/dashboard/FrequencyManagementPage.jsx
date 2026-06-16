// =====================================================================
// FrequencyManagementPage.jsx
//
// One-stop frequency oversight for the approvers (Liam, Carla, Randi,
// Samantha, Ariel). Combines two previously separate pages into a single
// tabbed view so approvers don't have to bounce between them:
//
//   DRIFT  → patients whose actual trailing-60-day cadence has drifted
//            from their prescribed frequency (FrequencyReviewPage).
//   STALE  → patients stable at 2x/wk+ for 90+ days, candidates for
//            frequency reduction to free clinician capacity
//            (StaleFrequencyPage).
//
// Both child pages support an `embedded` prop that suppresses their
// individual TopBar so they nest cleanly inside this wrapper. The
// approval action (`approve_frequency_change` RPC) is the same in both
// cases, so a single approver workflow ends here.
//
// Created 2026-06-16 — merge of stale-frequency + frequency-review.
// =====================================================================

import { useState } from 'react';
import TopBar from '../../components/TopBar';
import FrequencyReviewPage from './FrequencyReviewPage';
import StaleFrequencyPage from './StaleFrequencyPage';
import { EC } from '../../lib/constants';

export default function FrequencyManagementPage({ intent } = {}) {
  // Default tab — if launched from the legacy stale-frequency link, open Stale.
  const [tab, setTab] = useState(intent === 'stale' ? 'stale' : 'drift');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Frequency Management"
        subtitle="Drift reconciliation + stale-frequency reductions in one queue"
        actions={
          <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
            <TabBtn label="Drift" active={tab === 'drift'} onClick={() => setTab('drift')}
              helper="Actual cadence vs prescribed" />
            <TabBtn label="Stale" active={tab === 'stale'} onClick={() => setTab('stale')}
              helper="2x/wk+ stable 90 days" />
          </div>
        }
      />
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        {tab === 'drift' && <FrequencyReviewPage embedded />}
        {tab === 'stale' && <StaleFrequencyPage embedded />}
      </div>
    </div>
  );
}

function TabBtn({ label, active, onClick, helper }) {
  return (
    <button
      onClick={onClick}
      title={helper}
      style={{
        padding: '7px 16px',
        background: active ? EC.navy : 'transparent',
        color: active ? '#fff' : 'var(--gray)',
        border: 'none',
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}
