import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';

const BLENDED_RATE = 185;
const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function staleness(days) {
  if (days === null || days === undefined) return { color: '#6B7280', bg: '#F3F4F6', label: 'Unknown' };
  if (days > 60) return { color: '#DC2626', bg: '#FEF2F2', label: '🔴 Critical' };
  if (days > 30) return { color: '#D97706', bg: '#FEF3C7', label: '🟠 Overdue' };
  if (days > 14) return { color: '#7C3AED', bg: '#F5F3FF', label: '🟣 Stalled' };
  return { color: '#059669', bg: '#ECFDF5', label: '🟢 Recent' };
}

function ActionModal({ patient, onClose, onSaved }) {
  const [notes, setNotes] = useState(patient.pipeline_notes || '');
  const [assignedTo, setAssignedTo] = useState(patient.pipeline_assigned_to || '');
  const [targetDate, setTargetDate] = useState(patient.target_start_date || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await supabase.from('census_data').update({
      pipeline_notes: notes,
      pipeline_assigned_to: assignedTo,
      target_start_date: targetDate || null,
    }).eq('patient_name', patient.patient_name);
    setSaving(false);
    onSaved();
  }

  const s = staleness(patient.days_since_referral);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--card-bg)', borderRadius: 14, width: '100%', maxWidth: 500, boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ padding: '16px 22px', background: s.color, borderRadius: '14px 14px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{patient.patient_name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
              {patient.status} · Rgn {patient.region} · {patient.insurance} · {patient.days_since_referral ? `${patient.days_since_referral}d since referral` : 'Referral date unknown'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'rgba(255,255,255,0.7)' }}>×</button>
        </div>
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {patient.referral_source && (
            <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 12, fontSize: 11 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Referral Source</div>
              <div style={{ color: 'var(--gray)' }}>{patient.referral_source}</div>
              {patient.pcp_name && <div style={{ color: 'var(--gray)', marginTop: 2 }}>PCP: {patient.pcp_name}</div>}
              {patient.diagnosis && <div style={{ color: 'var(--gray)', marginTop: 2 }}>Dx: {patient.diagnosis}</div>}
            </div>
          )}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Assigned To</label>
            <input value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
              placeholder="Coordinator or clinician responsible..."
              style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Target Start Date</label>
            <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--card-bg)' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Pipeline Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Scheduling barrier, patient contact attempt, insurance issue, waiting on clinician assignment..."
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box', resize: 'vertical', minHeight: 80, background: 'var(--card-bg)' }} />
          </div>
        </div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--bg)' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, background: 'var(--card-bg)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving}
            style={{ padding: '8px 22px', background: '#1565C0', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PipelineTrackerPage() {
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState([]);
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterStaleness, setFilterStaleness] = useState('ALL');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('days_since_referral');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    const { data: census } = await supabase.from('census_data')
      .select('patient_name,region,status,insurance,first_seen_date')
      .or('status.ilike.%soc pending%,status.ilike.%eval pending%');

    const { data: intakeAll } = await supabase.from('intake_referrals')
      .select('patient_name,date_received,referral_source,pcp_name,diagnosis,referral_status')
      .eq('referral_status', 'Accepted')
      .order('date_received', { ascending: false });

    // Build intake lookup (most recent accepted referral per patient)
    const intakeMap = {};
    (intakeAll || []).forEach(r => {
      const key = (r.patient_name || '').toLowerCase().trim();
      if (!intakeMap[key]) intakeMap[key] = r;
    });

    const today = new Date();
    const enriched = (census || []).map(p => {
      const key = (p.patient_name || '').toLowerCase().trim();
      const ir = intakeMap[key] || {};
      const daysSinceReferral = ir.date_received
        ? Math.floor((today - new Date(ir.date_received + 'T00:00:00')) / 86400000)
        : null;
      const daysSinceAdded = p.first_seen_date
        ? Math.floor((today - new Date(p.first_seen_date + 'T00:00:00')) / 86400000)
        : null;
      return {
        ...p,
        date_received: ir.date_received || null,
        referral_source: ir.referral_source || null,
        pcp_name: ir.pcp_name || null,
        diagnosis: ir.diagnosis || null,
        days_since_referral: daysSinceReferral,
        days_since_added: daysSinceAdded,
        pipeline_notes: p.pipeline_notes || null,
        pipeline_assigned_to: p.pipeline_assigned_to || null,
        target_start_date: p.target_start_date || null,
      };
    });
    setPatients(enriched);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return patients.filter(p => {
      if (filterRegion !== 'ALL' && p.region !== filterRegion) return false;
      if (filterStatus !== 'ALL' && !p.status.toLowerCase().includes(filterStatus.toLowerCase())) return false;
      if (filterStaleness !== 'ALL') {
        const days = p.days_since_referral;
        if (filterStaleness === 'critical' && (days === null || days <= 60)) return false;
        if (filterStaleness === 'overdue' && (days === null || days <= 30 || days > 60)) return false;
        if (filterStaleness === 'stalled' && (days === null || days <= 14 || days > 30)) return false;
        if (filterStaleness === 'recent' && (days === null || days > 14)) return false;
        if (filterStaleness === 'unknown' && days !== null) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        if (!`${p.patient_name} ${p.insurance} ${p.referral_source || ''} ${p.pcp_name || ''}`.toLowerCase().includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      if (sortField === 'days_since_referral') {
        const av = a.days_since_referral ?? -1, bv = b.days_since_referral ?? -1;
        return bv - av; // oldest first
      }
      return 0;
    });
  }, [patients, filterRegion, filterStatus, filterStaleness, search, sortField]);

  const stats = useMemo(() => ({
    total: patients.length,
    critical: patients.filter(p => (p.days_since_referral || 0) > 60).length,
    overdue: patients.filter(p => (p.days_since_referral || 0) > 30 && (p.days_since_referral || 0) <= 60).length,
    stalled: patients.filter(p => (p.days_since_referral || 0) > 14 && (p.days_since_referral || 0) <= 30).length,
    unknown: patients.filter(p => p.days_since_referral === null).length,
    revenueIfStarted: patients.length * BLENDED_RATE * 2,
    byRegion: REGIONS.reduce((acc, r) => ({ ...acc, [r]: patients.filter(p => p.region === r).length }), {}),
  }), [patients]);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Pipeline Tracker" subtitle="Loading..." />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading...</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <TopBar
        title="SOC → Active Pipeline"
        subtitle={`${stats.total} patients accepted but not yet active · ${stats.critical} critical (60d+) · $${Math.round(stats.revenueIfStarted / 1000)}K/wk potential`}
      />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {stats.critical > 0 && (
          <div style={{ background: '#FEF2F2', borderBottom: '2px solid #FECACA', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 16 }}>🚨</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#DC2626' }}>
              {stats.critical} patient{stats.critical > 1 ? 's' : ''} have been in the pipeline 60+ days without starting — revenue and patient care at risk
            </span>
          </div>
        )}

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            {[
              { label: 'Total Pipeline', val: stats.total, color: '#1565C0', bg: '#EFF6FF', sub: 'SOC + Eval Pending', onClick: () => { setFilterStaleness('ALL'); } },
              { label: '🔴 Critical 60d+', val: stats.critical, color: '#DC2626', bg: '#FEF2F2', sub: 'Immediate action needed', onClick: () => setFilterStaleness('critical') },
              { label: '🟠 Overdue 30–60d', val: stats.overdue, color: '#D97706', bg: '#FEF3C7', sub: 'Follow-up required', onClick: () => setFilterStaleness('overdue') },
              { label: '🟣 Stalled 14–30d', val: stats.stalled, color: '#7C3AED', bg: '#F5F3FF', sub: 'Scheduling in progress', onClick: () => setFilterStaleness('stalled') },
              { label: '💰 Revenue Potential', val: '$' + Math.round(stats.revenueIfStarted / 1000) + 'K/wk', color: '#059669', bg: '#ECFDF5', sub: 'if all start this week', onClick: () => {} },
            ].map(c => (
              <div key={c.label} onClick={c.onClick} style={{ background: c.bg, border: `2px solid ${filterStaleness !== 'ALL' && c.label.toLowerCase().includes(filterStaleness) ? c.color : 'var(--border)'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: c.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</div>
                <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: c.color, marginTop: 4 }}>{c.val}</div>
                <div style={{ fontSize: 9, color: 'var(--gray)', marginTop: 2 }}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* Region pills */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {REGIONS.filter(r => stats.byRegion[r] > 0).map(r => (
              <div key={r} onClick={() => setFilterRegion(filterRegion === r ? 'ALL' : r)}
                style={{ padding: '6px 12px', borderRadius: 8, background: filterRegion === r ? '#0F1117' : '#F3F4F6', border: `2px solid ${filterRegion === r ? '#0F1117' : 'transparent'}`, cursor: 'pointer', textAlign: 'center', minWidth: 60 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: filterRegion === r ? '#fff' : 'var(--gray)' }}>Rgn {r}</div>
                <div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: filterRegion === r ? '#fff' : 'var(--black)' }}>{stats.byRegion[r]}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient, referral source, PCP..."
              style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)', width: 220 }} />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)' }}>
              <option value="ALL">SOC + Eval Pending</option>
              <option value="soc">SOC Pending Only</option>
              <option value="eval">Eval Pending Only</option>
            </select>
            <select value={filterStaleness} onChange={e => setFilterStaleness(e.target.value)}
              style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)' }}>
              <option value="ALL">All Staleness</option>
              <option value="critical">🔴 Critical (60d+)</option>
              <option value="overdue">🟠 Overdue (30–60d)</option>
              <option value="stalled">🟣 Stalled (14–30d)</option>
              <option value="recent">🟢 Recent (&lt;14d)</option>
              <option value="unknown">Unknown date</option>
            </select>
            {(filterRegion !== 'ALL' || filterStatus !== 'ALL' || filterStaleness !== 'ALL' || search) && (
              <button onClick={() => { setFilterRegion('ALL'); setFilterStatus('ALL'); setFilterStaleness('ALL'); setSearch(''); }}
                style={{ fontSize: 10, color: 'var(--gray)', background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer' }}>Clear</button>
            )}
            <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gray)' }}>{filtered.length} shown · click row to assign &amp; note</div>
          </div>

          {/* Pipeline table */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 0.4fr 0.7fr 0.8fr 0.7fr 0.7fr 1.4fr 1fr', padding: '8px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 9, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', gap: 8 }}>
              <span>Patient</span><span>Rgn</span><span>Insurance</span><span>Status</span><span>Referral Date</span><span>Days Stalled</span><span>Referral Source</span><span>Assigned To</span>
            </div>
            {filtered.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)' }}>No patients match current filters.</div>
            ) : filtered.map((p, i) => {
              const s = staleness(p.days_since_referral);
              const rowBg = (p.days_since_referral || 0) > 60 ? '#FFF5F5' : (p.days_since_referral || 0) > 30 ? '#FFFBEB' : i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)';
              return (
                <div key={p.patient_name + i} onClick={() => setSelected(p)}
                  style={{ display: 'grid', gridTemplateColumns: '1.8fr 0.4fr 0.7fr 0.8fr 0.7fr 0.7fr 1.4fr 1fr', padding: '9px 16px', borderBottom: '1px solid var(--border)', background: rowBg, alignItems: 'center', gap: 8, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#EFF6FF'}
                  onMouseLeave={e => e.currentTarget.style.background = rowBg}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{p.patient_name}</div>
                    {p.diagnosis && <div style={{ fontSize: 9, color: 'var(--gray)' }}>{p.diagnosis}</div>}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)' }}>{p.region}</span>
                  <span style={{ fontSize: 11 }}>{p.insurance}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: /soc/i.test(p.status) ? '#1565C0' : '#7C3AED', background: /soc/i.test(p.status) ? '#EFF6FF' : '#F5F3FF', padding: '2px 6px', borderRadius: 999 }}>
                    {p.status}
                  </span>
                  <span style={{ fontSize: 11 }}>{fmtDate(p.date_received)}</span>
                  <div>
                    {p.days_since_referral !== null ? (
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: s.color }}>{p.days_since_referral}</div>
                        <div style={{ fontSize: 8, fontWeight: 700, color: s.color, background: s.bg, borderRadius: 999, padding: '1px 5px', display: 'inline-block', marginTop: 2 }}>{s.label}</div>
                      </div>
                    ) : (
                      <span style={{ fontSize: 10, color: '#9CA3AF', fontStyle: 'italic' }}>No date</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--gray)', lineHeight: 1.3 }}>
                    {p.referral_source ? p.referral_source.slice(0, 45) + (p.referral_source.length > 45 ? '…' : '') : '—'}
                  </div>
                  <div>
                    {p.pipeline_assigned_to ? (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#1565C0' }}>{p.pipeline_assigned_to}</div>
                        {p.target_start_date && <div style={{ fontSize: 9, color: 'var(--gray)' }}>Start: {fmtDate(p.target_start_date)}</div>}
                      </div>
                    ) : (
                      <span style={{ fontSize: 10, color: '#9CA3AF', fontStyle: 'italic' }}>Unassigned</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {selected && (
        <ActionModal
          patient={selected}
          onClose={() => setSelected(null)}
          onSaved={() => { setSelected(null); load(); }}
        />
      )}
    </div>
  );
}
