// SupplyMonthlyPlanPage.jsx
//
// Earl's monthly budget plan. Reads + writes supply_monthly_plan
// (one row per month). Drives the Budget Variance KPI on the Supply
// Manager dashboard.
//
// Layout: 18 rows — last 12 months + next 6 months.
//   Editable: planned_spend_usd, planned_active_patients, notes
//   Read-only: planned_pppm (generated), actual_spend, actual_pppm, variance
//
// CLAUDE.md compliance: ASCII only.

import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

function monthLabel(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
function monthRange() {
  // Last 12 + next 6, anchored to first of month
  const now = new Date();
  now.setDate(1); now.setHours(0,0,0,0);
  const out = [];
  for (let i = -12; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function NumberCell({ value, onSave, prefix, suffix, placeholder }) {
  const [v, setV] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => setV(value ?? ''), [value]);
  async function commit() {
    const next = v === '' ? null : Number(v);
    if (next === value) return;
    if (next != null && isNaN(next)) { setV(value ?? ''); return; }
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (!ok) setV(value ?? '');
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {prefix && <span style={{ fontSize: 11, color: '#6B7280' }}>{prefix}</span>}
      <input value={v} onChange={e => setV(e.target.value)} onBlur={commit}
        placeholder={placeholder} type="number"
        style={{ padding: '5px 8px', border: '1px solid #E5E7EB', borderRadius: 5,
          fontSize: 12, outline: 'none', width: 110, textAlign: 'right',
          background: saving ? '#FEF3C7' : '#fff', fontFamily: 'DM Mono, monospace' }} />
      {suffix && <span style={{ fontSize: 11, color: '#6B7280' }}>{suffix}</span>}
    </div>
  );
}
function NotesCell({ value, onSave }) {
  const [v, setV] = useState(value || '');
  const [saving, setSaving] = useState(false);
  useEffect(() => setV(value || ''), [value]);
  async function commit() {
    if (v === (value || '')) return;
    setSaving(true);
    const ok = await onSave(v.trim() || null);
    setSaving(false);
    if (!ok) setV(value || '');
  }
  return (
    <input value={v} onChange={e => setV(e.target.value)} onBlur={commit}
      placeholder="(optional notes)"
      style={{ padding: '5px 8px', border: '1px solid #E5E7EB', borderRadius: 5,
        fontSize: 11, outline: 'none', width: '100%', background: saving ? '#FEF3C7' : '#fff' }} />
  );
}

export default function SupplyMonthlyPlanPage() {
  const { profile } = useAuth();
  const [plans, setPlans] = useState([]);
  const [kpis, setKpis] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [p, k] = await Promise.all([
      fetchAllPages(supabase.from('supply_monthly_plan').select('*')),
      fetchAllPages(supabase.from('v_supply_kpis_monthly').select('month_start,total_spend_usd,pppm_usd,active_patients_snapshot')),
    ]);
    setPlans(p || []);
    setKpis(k || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  useRealtimeTable(['supply_monthly_plan','garment_orders'], load);

  const months = useMemo(() => monthRange(), []);
  const planByMonth  = useMemo(() => Object.fromEntries((plans || []).map(p => [p.year_month, p])), [plans]);
  const kpiByMonth   = useMemo(() => Object.fromEntries((kpis  || []).map(k => [k.month_start, k])), [kpis]);

  async function patch(ym, payload) {
    const existing = planByMonth[ym];
    if (existing) {
      const { error } = await supabase.from('supply_monthly_plan')
        .update({ ...payload, set_by: profile?.full_name || profile?.email || null, set_at: new Date().toISOString() })
        .eq('year_month', ym);
      if (error) { console.error(error.message); return false; }
    } else {
      const { error } = await supabase.from('supply_monthly_plan')
        .insert({ year_month: ym, ...payload, set_by: profile?.full_name || profile?.email || null });
      if (error) { console.error(error.message); return false; }
    }
    load();
    return true;
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <TopBar title="Supply Monthly Plan" subtitle="Loading..." />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>
          Loading plan...
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <TopBar title="Supply Monthly Plan"
        subtitle="Set the planned spend + planned active patients per month. Drives Budget Variance KPI." />

      <div style={{ padding: '14px 20px' }}>
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8,
          padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#92400E' }}>
          Editable inline. Saves on blur. Past months are kept for budget-variance history.
          Future months let you set the trajectory toward the $185 PPPM 12-month target.
        </div>

        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'grid',
            gridTemplateColumns: '110px 150px 130px 110px 130px 110px 110px 1fr',
            gap: 8, padding: '10px 14px',
            background: '#F9FAFB', borderBottom: '1px solid #E5E7EB',
            fontSize: 10, fontWeight: 700, color: '#6B7280',
            textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <div>Month</div>
            <div>Planned spend</div>
            <div>Planned patients</div>
            <div>Planned PPPM</div>
            <div>Actual spend</div>
            <div>Actual PPPM</div>
            <div>Variance</div>
            <div>Notes</div>
          </div>
          {months.map((ym, i) => {
            const p = planByMonth[ym];
            const k = kpiByMonth[ym];
            const planned = p?.planned_spend_usd != null ? Number(p.planned_spend_usd) : null;
            const actual  = k?.total_spend_usd != null ? Number(k.total_spend_usd) : null;
            const variance = planned != null && planned > 0 && actual != null
              ? ((actual - planned) / planned * 100) : null;
            const isFuture = new Date(ym) > new Date();
            const isCurrent = ym === new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
            return (
              <div key={ym} style={{ display: 'grid',
                gridTemplateColumns: '110px 150px 130px 110px 130px 110px 110px 1fr',
                gap: 8, padding: '8px 14px',
                borderBottom: '1px solid #F3F4F6',
                background: isCurrent ? '#EFF6FF' : (i % 2 === 0 ? '#fff' : '#FAFAFA'),
                alignItems: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: isCurrent ? 700 : 500,
                  color: isFuture ? '#9CA3AF' : 'var(--black)' }}>
                  {monthLabel(ym)}
                  {isCurrent && <span style={{ fontSize: 9, color: '#1565C0', marginLeft: 4 }}>(current)</span>}
                </div>
                <NumberCell value={p?.planned_spend_usd != null ? Number(p.planned_spend_usd) : null}
                  onSave={v => patch(ym, { planned_spend_usd: v })} prefix="$" />
                <NumberCell value={p?.planned_active_patients ?? null}
                  onSave={v => patch(ym, { planned_active_patients: v })} suffix="pts" />
                <div style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', color: '#1F2937' }}>
                  {p?.planned_pppm != null ? '$' + Number(p.planned_pppm).toFixed(2) : '-'}
                </div>
                <div style={{ fontSize: 12, fontFamily: 'DM Mono, monospace',
                  color: isFuture ? '#9CA3AF' : 'var(--black)' }}>
                  {actual != null ? '$' + actual.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '-'}
                </div>
                <div style={{ fontSize: 12, fontFamily: 'DM Mono, monospace',
                  color: isFuture ? '#9CA3AF' : '#1F2937' }}>
                  {k?.pppm_usd != null ? '$' + Number(k.pppm_usd).toFixed(2) : '-'}
                </div>
                <div style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', fontWeight: 700,
                  color: variance == null ? '#9CA3AF'
                       : Math.abs(variance) <= 3 ? '#065F46'
                       : variance > 0 ? '#7F1D1D' : '#9A3412' }}>
                  {variance != null ? (variance >= 0 ? '+' : '') + variance.toFixed(1) + '%' : '-'}
                </div>
                <NotesCell value={p?.notes || ''} onSave={v => patch(ym, { notes: v })} />
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 14, fontSize: 11, color: '#6B7280' }}>
          Tip: PPPM target trajectory is $210 baseline -&gt; $185 over 12 months
          (roughly -2 to -3% per quarter). Set planned PPPM each month accordingly.
        </div>
      </div>
    </div>
  );
}
