// SupplyOrderWorklistPage.jsx
//
// Earl's daily action surface. Surfaces orders missing the fields that
// drive four of the Supply Manager KPIs, with inline edits so Earl can
// fix them in one place without leaving the page.
//
// Sections (priority order):
//   1. Aging requests > 24h            field_request_date set, no order_placed_date
//   2. POs past ETA, no delivery       order_placed + vendor_eta passed, no delivery_date
//   3. Auth-required, no auth #        auth_needed = TRUE and auth_number is NULL/empty
//   4. Untagged for catalog %          is_standardized_catalog IS NULL on placed orders
//
// Each section is collapsible (Earl can focus on one queue at a time).
// Rows save inline on blur with optimistic UI.
//
// CLAUDE.md compliance: ASCII only in JSX text.

import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages, safeUpdate, logActivity } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

const VENDOR_LIST = ['Solaris', 'Sigvaris', 'JOBST', 'Juzo', 'mediUSA', 'L&R',
                     'BSN-Jobst', 'Other'];

function fmtDate(d) {
  if (!d) return '-';
  try {
    const dt = new Date(d.length > 10 ? d : d + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return d; }
}
function daysSince(s) {
  if (!s) return null;
  return Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

function Tile({ label, value, color, sub, active, onClick }) {
  return (
    <button onClick={onClick}
      style={{
        background: active ? color : '#fff',
        border: `1px solid ${active ? color : '#E5E7EB'}`,
        borderRadius: 10, padding: '12px 14px', cursor: 'pointer',
        textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4,
      }}>
      <div style={{ fontSize: 10, fontWeight: 700,
        color: active ? '#fff' : '#6B7280',
        textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800,
        color: active ? '#fff' : color, fontFamily: 'DM Mono, monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: active ? '#fff' : '#6B7280' }}>{sub}</div>}
    </button>
  );
}

// Compact inline-editable cells. Each writes on blur and rolls back on error.
function DateCell({ value, onSave, placeholder }) {
  const [v, setV] = useState(value || '');
  const [saving, setSaving] = useState(false);
  useEffect(() => setV(value || ''), [value]);
  async function commit() {
    if (v === (value || '')) return;
    setSaving(true);
    const ok = await onSave(v || null);
    setSaving(false);
    if (!ok) setV(value || '');
  }
  return (
    <input type="date" value={v}
      onChange={e => setV(e.target.value)} onBlur={commit}
      style={{ padding: '4px 6px', border: '1px solid #E5E7EB', borderRadius: 5, fontSize: 11,
        outline: 'none', width: 120, background: saving ? '#FEF3C7' : '#fff' }}
      placeholder={placeholder} />
  );
}
function TextCell({ value, onSave, placeholder, width = 140 }) {
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
      placeholder={placeholder}
      style={{ padding: '4px 6px', border: '1px solid #E5E7EB', borderRadius: 5, fontSize: 11,
        outline: 'none', width, background: saving ? '#FEF3C7' : '#fff' }} />
  );
}
function CatalogCell({ value, onSave }) {
  // 3-state: standardized / off-catalog / not categorized
  const opts = [
    { v: true,  label: 'Yes', color: '#065F46', bg: '#ECFDF5' },
    { v: false, label: 'No',  color: '#7F1D1D', bg: '#FEE2E2' },
    { v: null,  label: '-',   color: '#6B7280', bg: '#F3F4F6' },
  ];
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {opts.map(o => {
        const active = (value === o.v) || (value === null && o.v === null);
        return (
          <button key={String(o.v)} onClick={() => onSave(o.v)}
            style={{ padding: '3px 8px', border: `1px solid ${active ? o.color : '#E5E7EB'}`,
              borderRadius: 4, fontSize: 10, fontWeight: 700,
              background: active ? o.color : o.bg, color: active ? '#fff' : o.color,
              cursor: 'pointer', minWidth: 28 }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function PatientLink({ name, region }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--black)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
        {name}
      </div>
      <div style={{ fontSize: 10, color: '#6B7280' }}>{region ? 'Region ' + region : ''}</div>
    </div>
  );
}

function SectionHeader({ title, hint, count, color, expanded, onToggle }) {
  return (
    <button onClick={onToggle}
      style={{ width: '100%', padding: '10px 14px', background: '#fff',
        border: '1px solid #E5E7EB', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 14, fontWeight: 800, color: color,
        fontFamily: 'DM Mono, monospace', minWidth: 36 }}>{count}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>{title}</div>
        <div style={{ fontSize: 11, color: '#6B7280' }}>{hint}</div>
      </div>
      <span style={{ fontSize: 14, color: '#6B7280' }}>{expanded ? '-' : '+'}</span>
    </button>
  );
}

export default function SupplyOrderWorklistPage() {
  const { profile } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({ aging: true, eta: true, auth: true, catalog: true });
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    const rows = await fetchAllPages(supabase.from('garment_orders')
      .select('id,patient_name,region,vendor,field_request_date,order_placed_date,vendor_eta_date,delivery_date,auth_needed,auth_number,is_standardized_catalog,approval_status,garment_cost,order_type,clinician_name')
      .neq('approval_status', 'cancelled')
      .order('field_request_date', { ascending: false, nullsFirst: false }));
    setOrders(rows || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  useRealtimeTable(['garment_orders'], load);

  // Optimistic in-row patch + Supabase persist + activity log
  async function patchOrder(id, payload) {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, ...payload } : o));
    const { error } = await supabase.from('garment_orders').update(payload).eq('id', id);
    if (error) {
      console.error('garment_orders update failed:', error.message);
      load();
      return false;
    }
    try {
      await logActivity({
        coordinatorId: profile?.id,
        coordinatorName: profile?.full_name,
        coordinatorRole: profile?.role,
        actionType: 'supply_worklist_edit',
        tableName: 'garment_orders',
        recordId: id,
        actionDetail: 'Worklist patch: ' + Object.keys(payload).join(', '),
      });
    } catch (e) { /* non-blocking */ }
    return true;
  }

  const buckets = useMemo(() => {
    const q = search.toLowerCase().trim();
    function match(o) {
      if (!q) return true;
      return (o.patient_name || '').toLowerCase().includes(q)
        || (o.vendor || '').toLowerCase().includes(q)
        || (o.region || '').toLowerCase().includes(q);
    }
    const aging = orders.filter(o => o.field_request_date && !o.order_placed_date
      && daysSince(o.field_request_date) > 1 && match(o));
    const eta = orders.filter(o => o.order_placed_date && !o.delivery_date
      && o.vendor_eta_date && new Date(o.vendor_eta_date) < new Date()
      && match(o));
    const auth = orders.filter(o => o.auth_needed === true
      && (!o.auth_number || !o.auth_number.trim()) && match(o));
    const catalog = orders.filter(o => o.is_standardized_catalog === null
      && o.order_placed_date && match(o));
    return { aging, eta, auth, catalog };
  }, [orders, search]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <TopBar title="Supply Order Worklist" subtitle="Loading..." />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>
          Loading orders...
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <TopBar title="Supply Order Worklist"
        subtitle="Inline-fix the fields driving the KPIs. Saves on blur." />

      <div style={{ padding: '14px 20px', background: 'var(--bg)' }}>

        {/* KPI tiles — section jump shortcuts */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
          <Tile label="Aging > 24h" value={buckets.aging.length}
            color="#7F1D1D" sub="no PO placed yet"
            active={!expanded.aging} onClick={() => setExpanded(s => ({ ...s, aging: !s.aging }))} />
          <Tile label="Stuck POs" value={buckets.eta.length}
            color="#9A3412" sub="past ETA, no delivery"
            active={!expanded.eta} onClick={() => setExpanded(s => ({ ...s, eta: !s.eta }))} />
          <Tile label="Auth #s missing" value={buckets.auth.length}
            color="#92400E" sub="auth-required, no number"
            active={!expanded.auth} onClick={() => setExpanded(s => ({ ...s, auth: !s.auth }))} />
          <Tile label="Untagged catalog" value={buckets.catalog.length}
            color="#1E40AF" sub="needs Yes/No flag"
            active={!expanded.catalog} onClick={() => setExpanded(s => ({ ...s, catalog: !s.catalog }))} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search patient, vendor, region..."
            style={{ padding: '8px 12px', border: '1px solid #E5E7EB', borderRadius: 7,
              fontSize: 13, outline: 'none', width: 320, background: '#fff' }} />
        </div>

        {/* Section 1: Aging requests */}
        <div style={{ marginBottom: 10 }}>
          <SectionHeader title="Aging requests > 24h"
            hint="Field request submitted but no PO placed. Add vendor + place the order."
            count={buckets.aging.length} color="#7F1D1D"
            expanded={expanded.aging}
            onToggle={() => setExpanded(s => ({ ...s, aging: !s.aging }))} />
          {expanded.aging && buckets.aging.length === 0 && (
            <EmptyState msg="No aging requests. Good." />
          )}
          {expanded.aging && buckets.aging.length > 0 && (
            <RowList>
              <RowHeader cols={['Patient', 'Field req', 'Vendor', 'Order placed', 'Days waiting']} />
              {buckets.aging.map((o, i) => (
                <Row key={o.id} idx={i} cols={[
                  <PatientLink name={o.patient_name} region={o.region} />,
                  <span style={{ fontSize: 11 }}>{fmtDate(o.field_request_date)}</span>,
                  <TextCell value={o.vendor} onSave={v => patchOrder(o.id, { vendor: v })} placeholder="vendor" />,
                  <DateCell value={o.order_placed_date} onSave={v => patchOrder(o.id, { order_placed_date: v })} />,
                  <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700,
                    color: daysSince(o.field_request_date) > 5 ? '#7F1D1D' : '#9A3412' }}>
                    {daysSince(o.field_request_date)}d
                  </span>,
                ]} />
              ))}
            </RowList>
          )}
        </div>

        {/* Section 2: Stuck POs */}
        <div style={{ marginBottom: 10 }}>
          <SectionHeader title="POs past ETA, no delivery confirmed"
            hint="Either record delivery, or update the ETA. Drives OTIF KPI."
            count={buckets.eta.length} color="#9A3412"
            expanded={expanded.eta}
            onToggle={() => setExpanded(s => ({ ...s, eta: !s.eta }))} />
          {expanded.eta && buckets.eta.length === 0 && <EmptyState msg="No stuck POs." />}
          {expanded.eta && buckets.eta.length > 0 && (
            <RowList>
              <RowHeader cols={['Patient', 'Vendor', 'Order placed', 'ETA was', 'Delivered', 'Days past']} />
              {buckets.eta.map((o, i) => (
                <Row key={o.id} idx={i} cols={[
                  <PatientLink name={o.patient_name} region={o.region} />,
                  <span style={{ fontSize: 11 }}>{o.vendor || '-'}</span>,
                  <span style={{ fontSize: 11 }}>{fmtDate(o.order_placed_date)}</span>,
                  <DateCell value={o.vendor_eta_date} onSave={v => patchOrder(o.id, { vendor_eta_date: v })} />,
                  <DateCell value={o.delivery_date} onSave={v => patchOrder(o.id, { delivery_date: v })} />,
                  <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, color: '#7F1D1D' }}>
                    +{daysSince(o.vendor_eta_date)}d
                  </span>,
                ]} />
              ))}
            </RowList>
          )}
        </div>

        {/* Section 3: Auth-required, no auth # */}
        <div style={{ marginBottom: 10 }}>
          <SectionHeader title="Auth-required orders missing the auth #"
            hint="Drives doc-compliance KPI. Each blank auth_number = -1 from 100%."
            count={buckets.auth.length} color="#92400E"
            expanded={expanded.auth}
            onToggle={() => setExpanded(s => ({ ...s, auth: !s.auth }))} />
          {expanded.auth && buckets.auth.length === 0 && <EmptyState msg="All auth #s recorded." />}
          {expanded.auth && buckets.auth.length > 0 && (
            <RowList>
              <RowHeader cols={['Patient', 'Vendor', 'Auth #', 'Auth date', 'Order placed']} />
              {buckets.auth.map((o, i) => (
                <Row key={o.id} idx={i} cols={[
                  <PatientLink name={o.patient_name} region={o.region} />,
                  <span style={{ fontSize: 11 }}>{o.vendor || '-'}</span>,
                  <TextCell value={o.auth_number} onSave={v => patchOrder(o.id, { auth_number: v })} placeholder="auth #" />,
                  <DateCell value={null} onSave={v => patchOrder(o.id, { auth_date: v })} />,
                  <span style={{ fontSize: 11 }}>{fmtDate(o.order_placed_date)}</span>,
                ]} />
              ))}
            </RowList>
          )}
        </div>

        {/* Section 4: Untagged for catalog % */}
        <div style={{ marginBottom: 10 }}>
          <SectionHeader title="Untagged for standardized-catalog %"
            hint="Flag each placed order Yes (preferred catalog) or No (off-formulary). Drives the catalog KPI."
            count={buckets.catalog.length} color="#1E40AF"
            expanded={expanded.catalog}
            onToggle={() => setExpanded(s => ({ ...s, catalog: !s.catalog }))} />
          {expanded.catalog && buckets.catalog.length === 0 && (
            <EmptyState msg="All placed orders tagged. Catalog KPI will populate." />
          )}
          {expanded.catalog && buckets.catalog.length > 0 && (
            <RowList>
              <RowHeader cols={['Patient', 'Vendor', 'Cost', 'Type', 'Standardized?']} />
              {buckets.catalog.map((o, i) => (
                <Row key={o.id} idx={i} cols={[
                  <PatientLink name={o.patient_name} region={o.region} />,
                  <span style={{ fontSize: 11 }}>{o.vendor || '-'}</span>,
                  <span style={{ fontSize: 11, fontFamily: 'DM Mono, monospace' }}>
                    {o.garment_cost != null ? '$' + Number(o.garment_cost).toFixed(2) : '-'}
                  </span>,
                  <span style={{ fontSize: 11 }}>{o.order_type || '-'}</span>,
                  <CatalogCell value={o.is_standardized_catalog}
                    onSave={v => patchOrder(o.id, { is_standardized_catalog: v })} />,
                ]} />
              ))}
            </RowList>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ msg }) {
  return (
    <div style={{ padding: 16, textAlign: 'center', color: '#065F46',
      background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8,
      fontSize: 12, marginTop: 6 }}>{msg}</div>
  );
}
function RowList({ children }) {
  return <div style={{ background: '#fff', border: '1px solid #E5E7EB',
    borderRadius: 8, overflow: 'hidden', marginTop: 6 }}>{children}</div>;
}
function RowHeader({ cols }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)`,
      padding: '8px 12px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB',
      fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {cols.map((c, i) => <div key={i}>{c}</div>)}
    </div>
  );
}
function Row({ cols, idx }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)`,
      gap: 8, padding: '8px 12px',
      borderBottom: '1px solid #F3F4F6',
      background: idx % 2 === 0 ? '#fff' : '#FAFAFA',
      alignItems: 'center' }}>
      {cols.map((c, i) => <div key={i}>{c}</div>)}
    </div>
  );
}
