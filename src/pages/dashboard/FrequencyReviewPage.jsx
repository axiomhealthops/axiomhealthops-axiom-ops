// FrequencyReviewPage.jsx
//
// Purpose: present patients whose actual trailing-60-day visit cadence has
// drifted from their PRESCRIBED frequency (census_data.inferred_frequency).
// The approvers — Randi (admin), Samantha + Ariel (assoc_director) — decide
// whether to (a) accept the new cadence as the new prescribed frequency,
// (b) hold the patient to the original prescribed cadence (no action —
// clinician accountability flag), or (c) adjust to a manually chosen value.
//
// Why this exists: silent cadence drift lets under-performance quietly
// become the new normal. The overdue-detection logic uses the PRESCRIBED
// frequency (frozen via census_data.frequency_locked_at) so the "days
// overdue" metric remains honest regardless of drift. This page is the
// reconciliation queue.
//
// Backend:
//   - recompute_patient_status_fields()  (runs after every Pariox upload)
//     computes current_visit_cadence and sets needs_frequency_review when
//     it differs from inferred_frequency.
//   - approve_frequency_change(patient_name, new_frequency, reviewed_by)
//     locks the new prescribed frequency and clears the review flag.

import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

const APPROVER_ROLES = ['super_admin', 'admin', 'assoc_director'];

const FREQUENCY_META = {
  '4w4':  { label: '4w4',  desc: '4x/wk — red flag at 3+ days' },
  '2w4':  { label: '2w4',  desc: '2x/wk — red flag at 4+ days' },
  '1w4':  { label: '1w4',  desc: '1x/wk — red flag at 10+ days' },
  '1em1': { label: '1em1', desc: '1x/month — red flag at 30+ days' },
  '1em2': { label: '1em2', desc: '1x/2mo — red flag at 60+ days' },
  'prn':  { label: 'prn',  desc: 'as-needed — no flag' },
};

// Direction of drift relative to prescribed — is this clinically concerning?
//   intensified  → patient is getting MORE visits than prescribed (overuse)
//   de-escalated → patient getting FEWER visits (under-visit / accountability)
//   unchanged    → no drift (shouldn't be on queue)
const FREQ_RANK = { '4w4': 5, '2w4': 4, '1w4': 3, '1em1': 2, '1em2': 1, 'prn': 0 };
function driftDirection(prescribed, current) {
  const p = FREQ_RANK[prescribed] ?? -1;
  const c = FREQ_RANK[current]    ?? -1;
  if (p === c) return 'same';
  return c > p ? 'intensified' : 'de-escalated';
}

function fmtDate(d) {
  if (!d) return '—';
  const x = new Date(d);
  if (isNaN(x)) return d;
  return `${x.getMonth() + 1}/${x.getDate()}/${String(x.getFullYear()).slice(2)}`;
}

export default function FrequencyReviewPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterDir, setFilterDir] = useState('ALL');     // 'all' / 'intensified' / 'de-escalated'
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(null);            // patient_name being saved

  const canApprove = APPROVER_ROLES.includes(profile?.role);

  const load = useCallback(async () => {
    setLoading(true);
    const regions = profile?.regions || [];
    let q = supabase.from('census_data')
      .select('patient_name,region,status,insurance,last_visit_date,last_visit_clinician,days_since_last_visit,inferred_frequency,current_visit_cadence,overdue_threshold_days,days_overdue,needs_frequency_review,frequency_locked_at,frequency_reviewed_by,frequency_reviewed_at')
      .eq('needs_frequency_review', true)
      .ilike('status', 'active%');
    // Region-scope for assoc_director; super_admin / admin see all
    if (profile?.role === 'assoc_director' && regions.length > 0) {
      q = q.in('region', regions);
    }
    const data = await fetchAllPages(q);
    setRows(data || []);
    setLoading(false);
  }, [profile]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => rows.filter(r => {
    if (filterRegion !== 'ALL' && r.region !== filterRegion) return false;
    if (filterDir !== 'ALL') {
      const d = driftDirection(r.inferred_frequency, r.current_visit_cadence);
      if (d !== filterDir) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      if (!`${r.patient_name} ${r.insurance || ''} ${r.last_visit_clinician || ''}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [rows, filterRegion, filterDir, search]);

  const regionOptions = useMemo(() =>
    [...new Set(rows.map(r => r.region).filter(Boolean))].sort(), [rows]);

  const summary = useMemo(() => {
    let intensified = 0, deesc = 0;
    rows.forEach(r => {
      const d = driftDirection(r.inferred_frequency, r.current_visit_cadence);
      if (d === 'intensified') intensified++;
      else if (d === 'de-escalated') deesc++;
    });
    return { total: rows.length, intensified, deesc };
  }, [rows]);

  async function handleApprove(patient, newFreq) {
    setSaving(patient.patient_name);
    const reviewer = profile?.full_name || profile?.email || 'unknown';
    const { error } = await supabase.rpc('approve_frequency_change', {
      p_patient_name: patient.patient_name,
      p_new_frequency: newFreq,
      p_reviewed_by: reviewer,
    });
    if (error) {
      alert('Save failed: ' + error.message);
    } else {
      setRows(rs => rs.filter(r => r.patient_name !== patient.patient_name));
    }
    setSaving(null);
  }

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Frequency Review Queue" subtitle="Loading..." />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading...</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <TopBar
        title="Frequency Review Queue"
        subtitle={`${summary.total} patient${summary.total === 1 ? '' : 's'} whose cadence has drifted from their prescribed frequency — ${summary.deesc} under-visited · ${summary.intensified} over-visited`}
      />
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {!canApprove && (
          <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#92400E' }}>
            View only — frequency approvals restricted to Directors / Associate Directors (Randi, Samantha, Ariel).
          </div>
        )}

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          <SummaryCard title="Total Drift" count={summary.total} color="#1F2937" sub="patients flagged" />
          <SummaryCard title="Under-Visited" count={summary.deesc} color="#DC2626" sub="cadence dropped below Rx — accountability risk" />
          <SummaryCard title="Over-Visited" count={summary.intensified} color="#D97706" sub="cadence higher than Rx — auth burn risk" />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient, insurance, clinician..."
            style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)', width: 240 }} />
          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
            style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, background: 'var(--card-bg)' }}>
            <option value="ALL">All Regions</option>
            {regionOptions.map(r => <option key={r} value={r}>Region {r}</option>)}
          </select>
          <select value={filterDir} onChange={e => setFilterDir(e.target.value)}
            style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, background: 'var(--card-bg)' }}>
            <option value="ALL">All Drift Types</option>
            <option value="de-escalated">Under-visited only</option>
            <option value="intensified">Over-visited only</option>
          </select>
          {(filterRegion !== 'ALL' || filterDir !== 'ALL' || search) && (
            <button onClick={() => { setFilterRegion('ALL'); setFilterDir('ALL'); setSearch(''); }}
              style={{ fontSize: 10, color: 'var(--gray)', background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer' }}>Clear</button>
          )}
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gray)' }}>{filtered.length} of {rows.length} shown</div>
        </div>

        {/* Table */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.4fr 0.8fr 0.6fr 0.6fr 0.9fr 0.6fr 1fr 1.4fr', padding: '9px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 9, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', gap: 8 }}>
            <span>Patient</span><span>Rgn</span><span>Insurance</span><span>Rx</span><span>Actual</span><span>Drift</span><span>Last Visit</span><span>Last Clinician</span><span>Action</span>
          </div>
          {filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>
              ✅ No cadence drift to review — every patient's actual visit rhythm matches their prescribed frequency.
            </div>
          ) : filtered.map((r, i) => {
            const dir = driftDirection(r.inferred_frequency, r.current_visit_cadence);
            const dirColor = dir === 'de-escalated' ? '#DC2626' : dir === 'intensified' ? '#D97706' : '#64748B';
            const dirBg = dir === 'de-escalated' ? '#FEF2F2' : dir === 'intensified' ? '#FFFBEB' : '#F1F5F9';
            const dirText = dir === 'de-escalated' ? '↓ Under' : dir === 'intensified' ? '↑ Over' : '—';
            return (
              <div key={r.patient_name + i} style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.4fr 0.8fr 0.6fr 0.6fr 0.9fr 0.6fr 1fr 1.4fr', padding: '9px 16px', borderBottom: '1px solid var(--border)', alignItems: 'center', gap: 8, background: i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{r.patient_name}</div>
                  <div style={{ fontSize: 9, color: 'var(--gray)' }}>{r.status}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)' }}>{r.region}</span>
                <span style={{ fontSize: 11 }}>{r.insurance}</span>
                <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: '#1F2937' }}>{r.inferred_frequency || '—'}</span>
                <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: dirColor }}>{r.current_visit_cadence || '—'}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: dirBg, color: dirColor, justifySelf: 'start' }}>{dirText}</span>
                <span style={{ fontSize: 11 }}>{fmtDate(r.last_visit_date)}</span>
                <span style={{ fontSize: 11, color: '#1565C0', fontWeight: r.last_visit_clinician ? 600 : 400 }}>{r.last_visit_clinician || '—'}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {canApprove ? (
                    <>
                      <button
                        title={`Accept new cadence as prescribed — ${FREQUENCY_META[r.current_visit_cadence]?.desc || ''}`}
                        onClick={() => handleApprove(r, r.current_visit_cadence)}
                        disabled={saving === r.patient_name}
                        style={{ fontSize: 10, fontWeight: 700, background: '#059669', color: '#fff', border: 'none', borderRadius: 5, padding: '4px 8px', cursor: 'pointer', opacity: saving === r.patient_name ? 0.6 : 1 }}>
                        Accept → {r.current_visit_cadence}
                      </button>
                      <button
                        title="Keep the prescribed frequency. Clinician will be held to original cadence."
                        onClick={() => handleApprove(r, r.inferred_frequency)}
                        disabled={saving === r.patient_name}
                        style={{ fontSize: 10, fontWeight: 700, background: '#fff', color: '#1F2937', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', cursor: 'pointer', opacity: saving === r.patient_name ? 0.6 : 1 }}>
                        Hold Rx
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: 10, color: 'var(--gray)', fontStyle: 'italic' }}>awaiting approver</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ fontSize: 10, color: 'var(--gray)', background: '#F8F9FF', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', lineHeight: 1.6 }}>
          <strong>How this works:</strong> Every upload recomputes each active patient's actual trailing-60-day cadence. When it diverges from the prescribed frequency locked on census_data, the patient lands here. Overdue detection keeps using the <em>prescribed</em> frequency until you approve a change, so this is the only place drift can enter the system.
          <br />
          <strong>Under-visited</strong> = clinician accountability issue (patient is getting fewer visits than ordered). <strong>Over-visited</strong> = auth burn / utilization issue. <strong>Accept → X</strong> locks the new cadence as prescribed. <strong>Hold Rx</strong> keeps the original — expect the patient to reappear here if cadence stays drifted, until a real visit correction happens.
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ title, count, color, sub }) {
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--gray)', fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 32, fontWeight: 900, fontFamily: 'DM Mono, monospace', color, marginTop: 4 }}>{count}</div>
      <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}
