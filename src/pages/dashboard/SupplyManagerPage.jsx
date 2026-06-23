// SupplyManagerPage.jsx
//
// Earl's Supply Management KPI dashboard. Built 2026-05-28 per Liam's
// Scaling Up brief: ONE primary number (PPPM) paired with the
// counter-balance (care-delay rate), supporting scorecard, leading
// indicators, and a quarterly Critical Number.
//
// Data sources
//   garment_orders          spend, OTIF, accuracy, doc compliance, catalog %
//   census_data             active patient denominator for PPPM
//   v_supply_kpis_monthly   pre-aggregated last 12 months
//   supply_monthly_plan     Earl-entered budget
//   supply_care_delays      counter-balance log
//   supply_critical_number  the quarterly priority
//
// Honest UX: when a KPI's data isn't being collected yet (catalog %, budget
// variance, care delays), the tile shows "Not tracked yet" with a primary
// action to start. We don't fake numbers.
//
// CLAUDE.md compliance: no inline unicode in JSX text.

import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

const PPPM_TARGET_BASELINE = 210;   // Liam draft target ($210 -> $185 over 12mo)
const PPPM_TARGET_12MO     = 185;
const CARE_DELAY_TARGET    = 1.0;   // <= 1.0%
const OTIF_TARGET          = 95;
const ACCURACY_TARGET      = 98;
const DOC_COMPLIANCE_TARGET = 100;
const CATALOG_TARGET       = 85;
const BUDGET_VAR_TARGET    = 3;     // +/- 3%

function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '-';
  const x = Number(n);
  return isNaN(x) ? '-' : '$' + x.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtMoney2(n) {
  if (n === null || n === undefined || n === '') return '-';
  const x = Number(n);
  return isNaN(x) ? '-' : '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n, digits = 1) {
  if (n === null || n === undefined || n === '') return null;
  const x = Number(n);
  return isNaN(x) ? null : x.toFixed(digits) + '%';
}

function HeroNumber({ label, value, sub, color, status, footer }) {
  return (
    <div style={{
      background: 'var(--card-bg)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '20px 24px', flex: 1, minWidth: 280,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)',
        letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 6 }}>
        <div style={{ fontSize: 44, fontWeight: 900, color: color, fontFamily: 'DM Mono, monospace', lineHeight: 1 }}>
          {value}
        </div>
        {status && (
          <span style={{
            fontSize: 10, fontWeight: 700,
            color: status.color, background: status.bg, border: `1px solid ${status.border}`,
            padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>{status.label}</span>
        )}
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 4 }}>{sub}</div>}
      {footer && <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>{footer}</div>}
    </div>
  );
}

function ScorecardTile({ label, value, target, missing, hint, isLeading, ctaPage, ctaLabel }) {
  function go() {
    if (ctaPage) window.dispatchEvent(new CustomEvent('axiom-navigate', { detail: { page: ctaPage } }));
  }
  if (missing) {
    return (
      <div style={{ background: 'var(--card-bg)', border: '1px dashed var(--border)',
        borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)',
          textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#9CA3AF', marginTop: 4 }}>Not tracked yet</div>
        {hint && <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 4 }}>{hint}</div>}
        {ctaPage && (
          <button onClick={go}
            style={{ marginTop: 8, padding: '5px 10px', background: '#0F1117', color: '#fff',
              border: 'none', borderRadius: 5, fontSize: 10, fontWeight: 700, cursor: 'pointer',
              alignSelf: 'flex-start' }}>
            {ctaLabel || 'Start tracking'}
          </button>
        )}
      </div>
    );
  }
  // Status color from comparison to target
  let color = '#1F2937';
  let bg = 'var(--card-bg)';
  if (target != null && value != null) {
    const direction = label.includes('Variance') ? 'within' : (isLeading ? 'gte' : 'gte');
    const ok = direction === 'within'
      ? Math.abs(value) <= target
      : value >= target;
    color = ok ? '#065F46' : (Math.abs((value - target) / target) > 0.2 ? '#7F1D1D' : '#9A3412');
    bg = ok ? '#ECFDF5' : '#FEF3C7';
  }
  return (
    <div style={{ background: bg, border: '1px solid var(--border)',
      borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)',
        textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: 'DM Mono, monospace', marginTop: 4 }}>
        {value != null ? (label.includes('Variance') ? (value >= 0 ? '+' : '') + value.toFixed(1) + '%' : value.toFixed(1) + '%') : '-'}
      </div>
      {target != null && (
        <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 2 }}>
          Target {label.includes('Variance') ? 'within ' + target + '%' : '>= ' + target + '%'}
        </div>
      )}
    </div>
  );
}

// Lightweight sparkline-style PPPM trend (last 12 months) as inline SVG
function TrendChart({ data, valueKey, label, color, targetValue }) {
  const width = 600, height = 120, padding = 28;
  const valid = data.filter(d => d[valueKey] != null);
  if (valid.length === 0) return (
    <div style={{ padding: 20, textAlign: 'center', color: 'var(--gray)', fontSize: 12 }}>
      No data yet for {label}.
    </div>
  );
  const vals = valid.map(d => Number(d[valueKey]));
  const minV = Math.min(...vals, targetValue || vals[0]);
  const maxV = Math.max(...vals, targetValue || vals[0]);
  const range = maxV - minV || 1;
  const xStep = (width - padding * 2) / Math.max(1, data.length - 1);
  function xAt(i) { return padding + i * xStep; }
  function yAt(v) { return padding + (1 - (v - minV) / range) * (height - padding * 2); }

  const pts = data.map((d, i) => d[valueKey] != null ? `${xAt(i)},${yAt(Number(d[valueKey]))}` : null);
  const path = pts.filter(Boolean).map((p, i) => (i === 0 ? 'M' : 'L') + p).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="120" preserveAspectRatio="xMidYMid meet">
      {targetValue != null && (
        <line x1={padding} x2={width - padding} y1={yAt(targetValue)} y2={yAt(targetValue)}
          stroke="#10B981" strokeDasharray="4,3" strokeWidth="1" />
      )}
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" />
      {data.map((d, i) => d[valueKey] != null ? (
        <circle key={i} cx={xAt(i)} cy={yAt(Number(d[valueKey]))} r="3" fill={color} />
      ) : null)}
      {data.map((d, i) => (
        <text key={'lbl' + i} x={xAt(i)} y={height - 8} textAnchor="middle"
          fontSize="9" fill="#6B7280">{d.month_label.slice(0, 3)}</text>
      ))}
      {targetValue != null && (
        <text x={width - padding + 2} y={yAt(targetValue) + 3} fontSize="9" fill="#10B981">target</text>
      )}
    </svg>
  );
}

function CriticalNumberCard({ critical, onEdit }) {
  if (!critical) {
    return (
      <button onClick={onEdit}
        style={{ width: '100%', textAlign: 'left', cursor: 'pointer',
          background: '#FEF3C7', border: '1px solid #FCD34D',
          borderRadius: 12, padding: '14px 20px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E',
          textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quarterly Critical Number</div>
        <div style={{ fontSize: 13, color: '#7C2D12', marginTop: 4 }}>
          Not yet set. Click to pick one priority per quarter.
        </div>
      </button>
    );
  }
  return (
    <button onClick={onEdit}
      style={{ width: '100%', textAlign: 'left', cursor: 'pointer',
        background: 'linear-gradient(135deg, #7C2D12 0%, #C2410C 100%)',
        border: 'none', borderRadius: 12, padding: '16px 22px', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#FED7AA',
          textTransform: 'uppercase', letterSpacing: '0.06em' }}>{critical.quarter_label} Critical Number</div>
        <div style={{ fontSize: 10, color: '#FED7AA', opacity: 0.85 }}>click to edit</div>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{critical.title}</div>
      {(critical.baseline_value || critical.target_value) && (
        <div style={{ fontSize: 11, color: '#FED7AA', marginTop: 8, display: 'flex', gap: 18 }}>
          {critical.baseline_value && <span>Baseline: {critical.baseline_value}</span>}
          {critical.target_value && <span>Target: {critical.target_value}</span>}
        </div>
      )}
    </button>
  );
}

// Modal for editing or creating the current-quarter Critical Number.
function CriticalNumberModal({ critical, onClose, onSaved, profile }) {
  const quarterStart = critical?.quarter_start || (() => {
    const d = new Date();
    const q = Math.floor(d.getMonth() / 3);
    return new Date(d.getFullYear(), q * 3, 1).toISOString().slice(0, 10);
  })();
  const quarterLabel = critical?.quarter_label || (() => {
    const d = new Date(quarterStart);
    const q = Math.floor(d.getMonth() / 3) + 1;
    return 'Q' + q + ' ' + d.getFullYear();
  })();

  const [form, setForm] = useState({
    quarter_start:  quarterStart,
    quarter_label:  quarterLabel,
    title:          critical?.title || '',
    baseline_value: critical?.baseline_value || '',
    target_value:   critical?.target_value || '',
    measure_unit:   critical?.measure_unit || '',
    status:         critical?.status || 'in_progress',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!form.title.trim()) { setErr('Title is required.'); return; }
    setSaving(true); setErr('');
    const payload = {
      ...form,
      title: form.title.trim(),
      baseline_value: form.baseline_value.trim() || null,
      target_value: form.target_value.trim() || null,
      measure_unit: form.measure_unit.trim() || null,
      set_by: profile?.full_name || profile?.email || null,
      updated_at: new Date().toISOString(),
    };
    let res;
    if (critical?.id) {
      res = await supabase.from('supply_critical_number').update(payload).eq('id', critical.id);
    } else {
      res = await supabase.from('supply_critical_number').insert(payload);
    }
    setSaving(false);
    if (res.error) { setErr(res.error.message); return; }
    onSaved();
    onClose();
  }

  const inp = {
    width: '100%', padding: '8px 10px', border: '1px solid #E5E7EB',
    borderRadius: 6, fontSize: 12, outline: 'none', background: '#fff', boxSizing: 'border-box',
  };

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, width: 520, maxWidth: '92vw',
          maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '16px 22px', borderBottom: '1px solid #E5E7EB',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0F1117' }}>Critical Number</div>
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
              One priority per quarter that gets disproportionate focus.
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22,
            color: '#9CA3AF', cursor: 'pointer', padding: 0 }}>{'×'}</button>
        </div>
        <div style={{ padding: 22, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Quarter">
            <input value={form.quarter_label} onChange={e => setForm(p => ({ ...p, quarter_label: e.target.value }))}
              style={inp} placeholder="Q3 2026" />
          </Field>
          <Field label="Quarter start">
            <input type="date" value={form.quarter_start}
              onChange={e => setForm(p => ({ ...p, quarter_start: e.target.value }))}
              style={inp} />
          </Field>
          <Field label="Title *" span={2}>
            <input value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              style={inp} placeholder="e.g. Move standardized-catalog spend to 85% with zero care delays" />
          </Field>
          <Field label="Baseline value">
            <input value={form.baseline_value}
              onChange={e => setForm(p => ({ ...p, baseline_value: e.target.value }))}
              style={inp} placeholder="e.g. 0% or $210 PPPM" />
          </Field>
          <Field label="Target value">
            <input value={form.target_value}
              onChange={e => setForm(p => ({ ...p, target_value: e.target.value }))}
              style={inp} placeholder="e.g. 85% / $185" />
          </Field>
          <Field label="Status">
            <select value={form.status}
              onChange={e => setForm(p => ({ ...p, status: e.target.value }))} style={inp}>
              <option value="in_progress">in_progress</option>
              <option value="on_track">on_track</option>
              <option value="at_risk">at_risk</option>
              <option value="missed">missed</option>
              <option value="hit">hit</option>
            </select>
          </Field>
        </div>
        {err && (
          <div style={{ margin: '0 22px 12px', padding: '8px 10px', background: '#FEF2F2',
            color: '#991B1B', fontSize: 12, borderRadius: 6, border: '1px solid #FECACA' }}>{err}</div>
        )}
        <div style={{ padding: '14px 22px', borderTop: '1px solid #E5E7EB',
          display: 'flex', justifyContent: 'flex-end', gap: 8, background: '#FAFAFA' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', border: '1px solid #E5E7EB',
            background: '#fff', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            style={{ padding: '8px 18px', border: 'none',
              background: saving ? '#9CA3AF' : '#0F1117', color: '#fff',
              borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, span = 1 }) {
  return (
    <div style={{ gridColumn: 'span ' + span }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280',
        textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function LeadingIndicator({ label, value, color, hint }) {
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 12px', flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--gray)',
        textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || 'var(--black)',
        fontFamily: 'DM Mono, monospace', lineHeight: 1, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 9, color: 'var(--gray)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

export default function SupplyManagerPage() {
  const { profile } = useAuth();
  const [monthly, setMonthly] = useState([]);
  const [critical, setCritical] = useState(null);
  const [delays, setDelays] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [criticalEditOpen, setCriticalEditOpen] = useState(false);

  function navigateTo(page) {
    window.dispatchEvent(new CustomEvent('axiom-navigate', { detail: { page } }));
  }

  async function load() {
    setLoading(true);
    const [m, c, d, o] = await Promise.all([
      fetchAllPages(supabase.from('v_supply_kpis_monthly').select('*')),
      supabase.from('supply_critical_number').select('*')
        .lte('quarter_start', new Date().toISOString().slice(0, 10))
        .order('quarter_start', { ascending: false }).limit(1).single(),
      fetchAllPages(supabase.from('supply_care_delays').select('*')
        .gte('delay_date', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
        .order('delay_date', { ascending: false })),
      fetchAllPages(supabase.from('garment_orders').select('id,approval_status,field_request_date,order_placed_date,delivery_date,vendor_eta_date,vendor,order_type,garment_cost')
        .neq('approval_status', 'cancelled')),
    ]);
    setMonthly(m || []);
    setCritical(c?.data || null);
    setDelays(d || []);
    setOpenOrders(o || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);
  useRealtimeTable(['garment_orders','supply_monthly_plan','supply_care_delays','supply_critical_number'], load);

  const current = monthly[monthly.length - 1]; // most recent month
  const prior   = monthly.length >= 2 ? monthly[monthly.length - 2] : null;

  // PPPM status vs Liam's $210 / $185 trajectory
  const pppmStatus = useMemo(() => {
    if (!current?.pppm_usd) return null;
    const v = Number(current.pppm_usd);
    if (v <= PPPM_TARGET_12MO) return { label: 'on target', color: '#065F46', bg: '#ECFDF5', border: '#A7F3D0' };
    if (v <= PPPM_TARGET_BASELINE) return { label: 'in range', color: '#92400E', bg: '#FEF3C7', border: '#FDE68A' };
    return { label: 'over baseline', color: '#7F1D1D', bg: '#FEE2E2', border: '#FCA5A5' };
  }, [current]);

  const careDelayStatus = useMemo(() => {
    if (!current) return null;
    const v = Number(current.care_delay_rate_pct ?? 0);
    if (v === 0) return { label: 'zero', color: '#065F46', bg: '#ECFDF5', border: '#A7F3D0' };
    if (v <= CARE_DELAY_TARGET) return { label: 'within 1%', color: '#92400E', bg: '#FEF3C7', border: '#FDE68A' };
    return { label: 'over target', color: '#7F1D1D', bg: '#FEE2E2', border: '#FCA5A5' };
  }, [current]);

  // Leading indicators — derived from openOrders + delays
  const indicators = useMemo(() => {
    const now = Date.now();
    const agingRequests = openOrders.filter(o => {
      if (!o.field_request_date || o.order_placed_date) return false;
      return (now - new Date(o.field_request_date).getTime()) / 86400000 > 1;
    }).length;
    const stuckPOs = openOrders.filter(o => {
      if (!o.order_placed_date || o.delivery_date) return false;
      const days = (now - new Date(o.order_placed_date).getTime()) / 86400000;
      return o.vendor_eta_date
        ? new Date() > new Date(o.vendor_eta_date)
        : days > 14;
    }).length;
    const openDelays = delays.filter(d => !d.resolved_at).length;
    return { agingRequests, stuckPOs, openDelays };
  }, [openOrders, delays]);

  // Scaling-Up brief draws PPPM from $210 baseline -> $185 over 12 months.
  // Our actual data is much lower (~$7-21 PPPM from garment_orders alone). The
  // discrepancy is real: garment_orders likely undercounts total supply spend
  // because non-garment supplies aren't tracked here yet. Surface the gap.
  const baselineMismatch = current?.pppm_usd != null && Number(current.pppm_usd) < 50;

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <TopBar title="Supply Manager" subtitle="Loading KPIs..." />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>
          Loading supply KPIs...
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <TopBar title="Supply Manager"
        subtitle={current ? (current.month_label + ' month-to-date - Earl Dimaano, Supply Management') : 'Earl Dimaano, Supply Management'} />

      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>

        {/* Baseline mismatch notice */}
        {baselineMismatch && (
          <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D',
            borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#92400E' }}>
            <strong>Heads up:</strong> Live PPPM is computed from garment_orders only. Your $210 baseline included non-garment supplies (bandaging, foam, etc.) that aren&apos;t in the tracker yet. Bring those into the tracker, or hold the baseline as garment-only and reset the target.
          </div>
        )}

        {/* Hero: PPPM + Care Delay rate (the paired primary KPI) */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
          <HeroNumber
            label="Supply Cost PPPM (this month)"
            value={current?.pppm_usd != null ? fmtMoney2(current.pppm_usd) : '-'}
            sub={prior?.pppm_usd != null && current?.pppm_usd != null
              ? `${Number(current.pppm_usd) < Number(prior.pppm_usd) ? 'down from' : 'up from'} ${fmtMoney2(prior.pppm_usd)} last month`
              : 'no prior month yet'}
            color="#1565C0"
            status={pppmStatus}
            footer={'Targets: hold <= $' + PPPM_TARGET_BASELINE + ' baseline / drive to $' + PPPM_TARGET_12MO + ' over 12 mo'} />
          <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <HeroNumber
              label="Care Delay Rate (counter-balance)"
              value={fmtPct(current?.care_delay_rate_pct ?? 0, 2)}
              sub={current?.care_delays_count != null
                ? current.care_delays_count + ' supply-caused delay(s) this month'
                : 'none logged'}
              color="#7C2D12"
              status={careDelayStatus}
              footer={'Target <= ' + CARE_DELAY_TARGET + '%, trending to 0. Reported alongside PPPM, always.'} />
            <button onClick={() => navigateTo('supply-care-delays')}
              style={{ padding: '8px 14px', background: '#fff', color: '#7C2D12',
                border: '1px solid #FCD34D', borderRadius: 7, fontSize: 11,
                fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
              Log a care delay -&gt;
            </button>
          </div>
        </div>

        {/* Quarterly Critical Number — clickable to edit */}
        <div style={{ marginBottom: 14 }}>
          <CriticalNumberCard critical={critical} onEdit={() => setCriticalEditOpen(true)} />
        </div>
        {criticalEditOpen && (
          <CriticalNumberModal critical={critical}
            onClose={() => setCriticalEditOpen(false)}
            onSaved={load} profile={profile} />
        )}

        {/* Supporting scorecard (5 tiles, capped per Scaling Up rules) */}
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--black)',
            textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Supporting Scorecard (weekly / monthly)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <ScorecardTile label="Vendor OTIF"
              value={current?.otif_pct != null ? Number(current.otif_pct) : null}
              target={OTIF_TARGET}
              missing={current?.otif_pct == null}
              hint="Fill ETA + delivery dates on orders"
              ctaPage="supply-worklist" ctaLabel="Fix in Worklist" />
            <ScorecardTile label="Order Accuracy"
              value={current?.accuracy_pct != null ? Number(current.accuracy_pct) : null}
              target={ACCURACY_TARGET}
              missing={current?.accuracy_pct == null}
              hint={'Initial / all orders. ' + (current?.order_count || 0) + ' orders this month.'} />
            <ScorecardTile label="Doc Compliance"
              value={current?.doc_compliance_pct != null ? Number(current.doc_compliance_pct) : null}
              target={DOC_COMPLIANCE_TARGET}
              missing={current?.auth_required_count === 0}
              hint={(current?.auth_required_count || 0) + ' auth-required orders, '
                + Math.round(((current?.auth_required_count || 0) * (100 - (current?.doc_compliance_pct || 0))) / 100)
                + ' missing auth #'}
              ctaPage="supply-worklist" ctaLabel="Fill auth #s" />
            <ScorecardTile label="Standardized Catalog %"
              value={current?.standardized_catalog_pct != null ? Number(current.standardized_catalog_pct) : null}
              target={CATALOG_TARGET}
              missing={current?.standardized_catalog_pct == null}
              hint="Flag each order Yes / No"
              isLeading
              ctaPage="supply-worklist" ctaLabel="Tag orders" />
            <ScorecardTile label="Budget Variance"
              value={current?.budget_variance_pct != null ? Number(current.budget_variance_pct) : null}
              target={BUDGET_VAR_TARGET}
              missing={current?.budget_variance_pct == null}
              hint={current?.planned_spend_usd ? '' : 'Enter monthly plan'}
              ctaPage="supply-monthly-plan" ctaLabel="Set plan" />
          </div>
        </div>

        {/* PPPM trend (last 12 months) */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '14px 16px', marginTop: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--black)' }}>
              PPPM trend - last 12 months
            </div>
            <div style={{ fontSize: 10, color: 'var(--gray)' }}>
              Target line at ${PPPM_TARGET_12MO} (12-month target)
            </div>
          </div>
          <TrendChart data={monthly} valueKey="pppm_usd" label="PPPM"
            color="#1565C0" targetValue={PPPM_TARGET_12MO} />
        </div>

        {/* Leading indicators strip — daily-huddle inputs */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--black)',
            textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Leading Indicators (daily huddle)
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <LeadingIndicator label="Aging Requests > 24h"
              value={indicators.agingRequests}
              color={indicators.agingRequests > 0 ? '#9A3412' : '#065F46'}
              hint="submitted but no PO placed" />
            <LeadingIndicator label="Stuck POs (past ETA)"
              value={indicators.stuckPOs}
              color={indicators.stuckPOs > 0 ? '#7F1D1D' : '#065F46'}
              hint="ordered but no delivery date" />
            <LeadingIndicator label="Open Care Delays"
              value={indicators.openDelays}
              color={indicators.openDelays > 0 ? '#7F1D1D' : '#065F46'}
              hint="unresolved supply-caused delays (last 30d)" />
            <LeadingIndicator label="Recent Delays (30d)"
              value={delays.length}
              color={delays.length > 0 ? '#9A3412' : '#065F46'}
              hint="any supply-caused care delay" />
          </div>
        </div>

        {/* Footer: Earl's data-entry next steps */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '12px 14px', fontSize: 11, color: 'var(--gray)' }}>
          <div style={{ fontWeight: 700, color: 'var(--black)', marginBottom: 6 }}>What turns the dashes into numbers</div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            <li>Vendor OTIF: fill vendor_eta_date + delivery_date when placing/receiving each PO in Garment Tracker.</li>
            <li>Doc Compliance: enter auth_number for every order with auth_needed = true. Currently 6 of 219 auth-required orders have one.</li>
            <li>Standardized Catalog %: flag each garment order is_standardized_catalog = true/false during approval review.</li>
            <li>Budget Variance: enter the monthly plan in supply_monthly_plan (planned_spend_usd + planned_active_patients).</li>
            <li>Care Delay Rate: care coords / clinicians log to supply_care_delays when a missing item caused a reschedule or workaround.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
