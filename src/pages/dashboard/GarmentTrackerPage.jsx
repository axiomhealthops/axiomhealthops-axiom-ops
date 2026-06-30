// =====================================================================
// GarmentTrackerPage.jsx
//
// Replaces the legacy Google Form "MASTER Garment Order Form Responses"
// spreadsheet. Captures the LE + UE garment ordering pipeline from
// clinician request through supervisor approval, insurance auth, vendor
// order placement, and delivery proof.
//
// Workflow stages (Kanban columns), derived in v_garment_orders_with_stage:
//   submitted → auth_pending → ready_to_order → order_placed → delivered → archived
//   side branches: denied, cancelled
//
// Transitions (each is one user action in the drawer):
//   submitted      → auth_pending     : PT/OT clinical approval
//   auth_pending   → ready_to_order   : admin/super_admin final approval (insurance auth captured here too)
//   ready_to_order → order_placed     : Supply Chain Manager (admin/super_admin) records order placement
//   order_placed   → delivered        : delivery confirmed (POD)
//   delivered      → archived         : automatic, 14 days after delivery_date (computed in the view)
// At each handoff the page fires the notify-garment-handoff edge function which
// emails recipients and inserts into garment_order_notifications.
//
// Patient association: patient_name auto-links to census_data.id via a
// BEFORE INSERT/UPDATE trigger. Unmatched rows still save — they show with
// an "unlinked" badge so care coord can fix the spelling.
//
// Built 2026-06-15.
// =====================================================================

import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages, logActivity } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import { EC, TERRITORIES, TERRITORY_LETTERS } from '../../lib/constants';

const REGIONS = TERRITORY_LETTERS;

// Kanban columns shown by default. 'archived' / 'denied' / 'cancelled' are
// real stages but hidden from the board — surfaced via the Stage filter.
const STAGES = [
  { key: 'submitted',      label: 'Submitted',         color: '#9C5700', bg: '#FFFBEB', border: '#F59E0B', helper: 'Awaiting PT/OT clinical approval' },
  { key: 'auth_pending',   label: 'Auth Pending',      color: '#1E40AF', bg: '#EFF6FF', border: '#3B82F6', helper: 'Clinically approved, awaiting admin sign-off + insurance auth' },
  { key: 'ready_to_order', label: 'Ready to Order',    color: '#065F46', bg: '#ECFDF5', border: '#10B981', helper: 'Approved — Supply Chain to place order' },
  { key: 'order_placed',   label: 'Order Placed / In Transit', color: '#7C3AED', bg: '#F5F3FF', border: '#7C3AED', helper: 'Order placed with vendor, awaiting delivery' },
  { key: 'delivered',      label: 'Delivered',         color: '#065F46', bg: '#D1FAE5', border: '#059669', helper: 'POD received — archives 14 days after delivery' },
];
// Hidden stages — included in STAGE_MAP so badges and filters render, but not
// rendered as kanban columns by default.
const HIDDEN_STAGES = [
  { key: 'archived',  label: 'Archived',  color: '#475569', bg: '#F1F5F9', border: '#64748B', helper: 'Delivered > 14 days ago' },
  { key: 'denied',    label: 'Denied',    color: '#9C0006', bg: '#FEF2F2', border: '#DC2626', helper: 'Approval was denied' },
  { key: 'cancelled', label: 'Cancelled', color: '#475569', bg: '#F1F5F9', border: '#64748B', helper: 'Order was cancelled' },
];
const STAGE_MAP = Object.fromEntries([...STAGES, ...HIDDEN_STAGES].map(s => [s.key, s]));

const ORDER_TYPES = ['Initial Garment', 'Re-order', 'Replacement', 'Adjustment', 'Other'];

// Roles allowed to perform the final approval (the supply-chain sign-off that
// flips the order into 'approved' and triggers ordering). Anyone in this set
// can act — keeps the workflow from stalling when one person is out.
const FINAL_APPROVER_ROLES = ['admin', 'super_admin'];
function canFinalApprove(profile) {
  if (!profile) return false;
  const all = [profile.role, ...(Array.isArray(profile.secondary_roles) ? profile.secondary_roles : [])];
  return all.some(r => FINAL_APPROVER_ROLES.includes(r));
}

function fmtDate(d) {
  if (!d) return '';
  try { return new Date((d.length > 10 ? d : d + 'T00:00:00')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}
function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '-';
  const x = Number(n);
  return isNaN(x) ? '-' : '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function firstOfMonth() { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }
function daysAgo(s) {
  if (!s) return null;
  return Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
}

// Fan out a garment-order handoff notification:
//   - inserts in-app rows into garment_order_notifications (RLS will let the
//     recipients read them via the existing realtime channel)
//   - invokes the notify-garment-handoff edge function for email
// Recipients are resolved server-side in the edge function so we don't have
// to hand it a coordinator list — keeps the admin/super_admin set in one
// place (the DB) and avoids stale frontend role lists.
async function emitGarmentHandoff(orderId, event, message) {
  try {
    const { error } = await supabase.functions.invoke('notify-garment-handoff', {
      body: { order_id: orderId, event, message: message || null },
    });
    if (error) console.warn('notify-garment-handoff invoke failed:', error.message);
  } catch (e) {
    console.warn('notify-garment-handoff invoke threw:', e?.message || e);
  }
}

export default function GarmentTrackerPage() {
  const { profile } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('kanban');  // 'kanban' | 'table'
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterLimb, setFilterLimb] = useState('ALL');
  const [filterType, setFilterType] = useState('ALL');
  const [filterStage, setFilterStage] = useState('ALL');
  const [search, setSearch] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);

  function loadData() {
    fetchAllPages(supabase.from('v_garment_orders_with_stage').select('*').order('created_at', { ascending: false }))
      .then(rows => { setOrders(Array.isArray(rows) ? rows : []); setLoading(false); })
      .catch(err => { console.error(err); setLoading(false); });
  }
  useEffect(() => { loadData(); }, []);
  useRealtimeTable(['garment_orders'], loadData);

  const filtered = useMemo(() => orders.filter(o => {
    if (filterRegion !== 'ALL' && o.region !== filterRegion) return false;
    if (filterLimb !== 'ALL' && o.limb_type !== filterLimb) return false;
    if (filterType !== 'ALL' && o.order_type !== filterType) return false;
    // 'ALL' = active board (everything except archived/denied/cancelled).
    // 'ALL_INCLUDING_ARCHIVED' = no stage filter at all.
    if (filterStage === 'ALL' && ['archived','denied','cancelled'].includes(o.stage)) return false;
    if (filterStage !== 'ALL' && filterStage !== 'ALL_INCLUDING_ARCHIVED' && o.stage !== filterStage) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = [o.patient_name, o.clinician_name, o.approver_name, o.clinical_approver_name, o.final_approver_name, o.garment_code, o.order_number, o.insurance].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [orders, filterRegion, filterLimb, filterType, filterStage, search]);

  // ─── Stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const s = { submitted: 0, auth_pending: 0, ready_to_order: 0, order_placed: 0, delivered: 0, archived: 0, denied: 0, cancelled: 0 };
    const monthCutoff = firstOfMonth();
    let mtdSpend = 0, mtdDelivered = 0;
    orders.forEach(o => {
      if (s[o.stage] != null) s[o.stage]++;
      if (o.delivery_date && o.delivery_date >= monthCutoff) {
        mtdDelivered++;
        mtdSpend += Number(o.garment_cost || 0);
      }
    });
    return { ...s, mtdSpend, mtdDelivered };
  }, [orders]);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Garment Tracker" subtitle="Loading..." />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading...</div>
    </div>
  );

  // ─── Group filtered orders by stage for the Kanban ────────────────
  const grouped = STAGES.reduce((acc, st) => {
    acc[st.key] = filtered.filter(o => o.stage === st.key);
    return acc;
  }, {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Garment Tracker"
        subtitle={`${orders.length} total orders - ${stats.submitted} awaiting PT/OT - ${stats.auth_pending} awaiting admin - ${stats.ready_to_order} ready to order - ${stats.order_placed} in motion - ${stats.delivered} delivered`}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
              <button onClick={() => setViewMode('kanban')}
                style={{ padding: '6px 12px', background: viewMode === 'kanban' ? EC.navy : 'transparent', color: viewMode === 'kanban' ? '#fff' : 'var(--gray)', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Kanban
              </button>
              <button onClick={() => setViewMode('table')}
                style={{ padding: '6px 12px', background: viewMode === 'table' ? EC.navy : 'transparent', color: viewMode === 'table' ? '#fff' : 'var(--gray)', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Table
              </button>
            </div>
            <button onClick={() => setShowNewModal(true)}
              style={{ padding: '8px 16px', background: EC.gradient, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(124, 91, 247, 0.2)' }}>
              + New Order
            </button>
          </div>
        }
      />
      <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10 }}>
          <Stat label="Submitted" value={stats.submitted} accent={STAGE_MAP.submitted.color} bg={STAGE_MAP.submitted.bg} sub="awaiting PT/OT" />
          <Stat label="Auth Pending" value={stats.auth_pending} accent={STAGE_MAP.auth_pending.color} bg={STAGE_MAP.auth_pending.bg} sub="awaiting admin" />
          <Stat label="Ready to Order" value={stats.ready_to_order} accent={STAGE_MAP.ready_to_order.color} bg={STAGE_MAP.ready_to_order.bg} sub="Supply Chain" />
          <Stat label="In Motion" value={stats.order_placed} accent={STAGE_MAP.order_placed.color} bg={STAGE_MAP.order_placed.bg} sub="placed / in transit" />
          <Stat label="Delivered (MTD)" value={stats.mtdDelivered} accent={STAGE_MAP.delivered.color} bg={STAGE_MAP.delivered.bg} />
          <Stat label="Archived" value={stats.archived} accent={STAGE_MAP.archived.color} bg={STAGE_MAP.archived.bg} sub=">14d after POD" />
          <Stat label="MTD Spend" value={fmtMoney(stats.mtdSpend)} accent={EC.indigo} bg="#EEF2FF" />
        </div>

        {/* Filter bar */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search patient, clinician, garment code, order#"
            style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--bg)', width: 280 }} />
          <Filter label="Region" value={filterRegion} onChange={setFilterRegion} options={[['ALL', 'All Regions'], ...REGIONS.map(r => [r, `Territory ${r}`])]} />
          <Filter label="Limb" value={filterLimb} onChange={setFilterLimb} options={[['ALL', 'LE + UE'], ['LE', 'Lower Extremity (LE)'], ['UE', 'Upper Extremity (UE)']]} />
          <Filter label="Order Type" value={filterType} onChange={setFilterType} options={[['ALL', 'All Types'], ...ORDER_TYPES.map(t => [t, t])]} />
          <Filter label="Stage" value={filterStage} onChange={setFilterStage}
            options={[
              ['ALL', 'Active Only'],
              ...STAGES.map(s => [s.key, s.label]),
              ['archived', 'Archived'],
              ['denied', 'Denied'],
              ['cancelled', 'Cancelled'],
              ['ALL_INCLUDING_ARCHIVED', 'Everything'],
            ]} />
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gray)' }}>
            Showing {filtered.length} of {orders.length}
          </div>
        </div>

        {/* Main view */}
        {viewMode === 'kanban' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(220px, 1fr))', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
            {STAGES.map(st => (
              <div key={st.key} style={{ background: 'var(--card-bg)', border: `1px solid var(--border)`, borderTop: `4px solid ${st.border}`, borderRadius: 10, display: 'flex', flexDirection: 'column', minHeight: 200 }}>
                <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: st.color, textTransform: 'uppercase', letterSpacing: 0.3 }}>{st.label}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)', background: st.bg, padding: '2px 8px', borderRadius: 999 }}>{grouped[st.key].length}</div>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 3, lineHeight: 1.3 }}>{st.helper}</div>
                </div>
                <div style={{ flex: 1, padding: 8, overflowY: 'auto', maxHeight: 600, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {grouped[st.key].length === 0 ? (
                    <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--gray)' }}>Empty</div>
                  ) : grouped[st.key].map(o => (
                    <OrderCard key={o.id} order={o} stage={st} onClick={() => setSelectedOrder(o)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <OrderTable orders={filtered} onClick={o => setSelectedOrder(o)} />
        )}
      </div>

      {showNewModal && (
        <OrderModal profile={profile} onClose={() => setShowNewModal(false)} onSaved={() => { setShowNewModal(false); loadData(); }} />
      )}
      {selectedOrder && (
        <OrderDrawer profile={profile} order={selectedOrder} onClose={() => setSelectedOrder(null)} onSaved={() => { setSelectedOrder(null); loadData(); }} />
      )}
    </div>
  );
}

// ─── Components ──────────────────────────────────────────────────────────

function Stat({ label, value, accent, bg, sub }) {
  return (
    <div style={{ background: bg || 'var(--card-bg)', border: '1px solid var(--border)', borderLeft: `4px solid ${accent}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Filter({ label, value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      title={label}
      style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--bg)' }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function OrderCard({ order: o, stage, onClick }) {
  const days = daysAgo(o.status_change_date || o.created_at);
  const isStale = days != null && days > 7 && o.stage !== 'delivered';
  return (
    <div onClick={onClick}
      style={{
        background: '#fff', border: `1px solid ${isStale ? '#DC2626' : 'var(--border)'}`,
        borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--black)' }}>{o.patient_name}</div>
        <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', background: o.limb_type === 'UE' ? '#7C3AED' : '#0E7490', padding: '1px 6px', borderRadius: 999 }}>{o.limb_type}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--gray)' }}>
        {o.order_type || 'Order type unset'}{o.region ? ` · Region ${o.region}` : ''}
      </div>
      {o.clinician_name && <div style={{ fontSize: 11, color: 'var(--gray)' }}>{'>'} {o.clinician_name}</div>}
      {o.garment_cost != null && <div style={{ fontSize: 11, fontWeight: 600, color: '#065F46' }}>{fmtMoney(o.garment_cost)}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--gray)' }}>
          {days != null ? `${days}d in stage` : 'new'}
        </span>
        {!o.patient_id && (
          <span title="Patient name does not match any census record yet" style={{ fontSize: 9, fontWeight: 700, color: '#9C5700', background: '#FFFBEB', padding: '1px 6px', borderRadius: 999 }}>Unlinked</span>
        )}
        {isStale && (
          <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', background: '#DC2626', padding: '1px 6px', borderRadius: 999 }}>Stale</span>
        )}
      </div>
    </div>
  );
}

function OrderTable({ orders, onClick }) {
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#FAFAFA', borderBottom: '2px solid var(--border)' }}>
            <th style={th}>Stage</th>
            <th style={th}>Patient</th>
            <th style={th}>Limb</th>
            <th style={th}>Type</th>
            <th style={th}>Region</th>
            <th style={th}>Clinician</th>
            <th style={th}>Order#</th>
            <th style={{ ...th, textAlign: 'right' }}>Cost</th>
            <th style={th}>Placed</th>
            <th style={th}>Delivered</th>
            <th style={th}>Auth</th>
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 ? (
            <tr><td colSpan={11} style={{ padding: 30, textAlign: 'center', color: 'var(--gray)' }}>No orders match the current filters.</td></tr>
          ) : orders.map(o => {
            const st = STAGE_MAP[o.stage] || STAGE_MAP.submitted;
            return (
              <tr key={o.id} onClick={() => onClick(o)}
                style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                <td style={td}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: st.color, background: st.bg, padding: '2px 8px', borderRadius: 999 }}>{st.label}</span>
                </td>
                <td style={{ ...td, fontWeight: 600, color: 'var(--black)' }}>
                  {o.patient_name}
                  {!o.patient_id && <span title="Patient does not match census yet" style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#9C5700', background: '#FFFBEB', padding: '1px 6px', borderRadius: 999 }}>?</span>}
                </td>
                <td style={td}>{o.limb_type}</td>
                <td style={td}>{o.order_type || '-'}</td>
                <td style={td}>{o.region || '-'}</td>
                <td style={td}>{o.clinician_name || '-'}</td>
                <td style={td}>{o.order_number || '-'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{fmtMoney(o.garment_cost)}</td>
                <td style={td}>{fmtDate(o.order_placed_date) || '-'}</td>
                <td style={td}>{fmtDate(o.delivery_date) || '-'}</td>
                <td style={td}>{o.auth_needed === false ? 'N/A' : o.auth_number || (o.auth_needed ? 'pending' : '-')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── New / Edit modal ────────────────────────────────────────────────────

function OrderModal({ profile, order, onClose, onSaved }) {
  const isEdit = !!order;
  const [form, setForm] = useState({
    patient_name:       order?.patient_name       || '',
    region:             order?.region             || profile?.regions?.[0] || '',
    limb_type:          order?.limb_type          || 'LE',
    order_type:         order?.order_type         || 'Initial Garment',
    insurance:          order?.insurance          || '',
    patient_address:    order?.patient_address    || '',
    current_loc:        order?.current_loc        || '',
    current_frequency:  order?.current_frequency  || '',
    phase_of_care:      order?.phase_of_care      || '',
    etiology:           order?.etiology           || '',
    clinician_name:     order?.clinician_name     || profile?.full_name || '',
    clinician_email:    order?.clinician_email    || profile?.email || '',
    approver_name:      order?.approver_name      || '',
    approver_email:     order?.approver_email     || '',
    order_form_url:     order?.order_form_url     || '',
    additional_items:   order?.additional_items   || '',
    notes:              order?.notes              || '',
    auth_needed:        order?.auth_needed ?? null,
    field_request_date: order?.field_request_date || todayStr(),
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    setErr('');
    if (!form.patient_name?.trim()) { setErr('Patient name is required.'); return; }
    if (!form.limb_type) { setErr('LE or UE is required.'); return; }
    setSaving(true);
    const payload = {
      ...form,
      patient_name: form.patient_name.trim(),
      created_by: profile?.id || null,
      // Mirror the PT/OT contact into the new clinical_approver_* columns so
      // notify-garment-handoff can route stage-1 emails without reading the
      // legacy approver_* fields.
      clinical_approver_name: form.approver_name?.trim() || null,
      clinical_approver_email: form.approver_email?.trim() || null,
    };
    let savedId = order?.id;
    if (isEdit) {
      const { error } = await supabase.from('garment_orders').update(payload).eq('id', order.id);
      if (error) { setErr('Save failed: ' + error.message); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from('garment_orders').insert(payload).select('id').single();
      if (error) { setErr('Save failed: ' + error.message); setSaving(false); return; }
      savedId = data?.id;
    }
    logActivity({
      coordinatorId: profile?.id, coordinatorName: profile?.full_name, coordinatorRole: profile?.role,
      actionType: isEdit ? 'garment_order_updated' : 'garment_order_created',
      actionDetail: `${form.limb_type} ${form.order_type} for ${form.patient_name} (${form.region || 'no region'})`,
      patientName: form.patient_name,
      tableName: 'garment_orders',
    });
    if (!isEdit && savedId) {
      await emitGarmentHandoff(savedId, 'submitted',
        `${form.clinician_name || 'A field clinician'} submitted a ${form.limb_type} garment request for ${form.patient_name}.`);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <Modal title={isEdit ? 'Edit Garment Order' : 'New Garment Order'} onClose={onClose} headerBg={EC.gradient}>
      <div style={{ padding: 22, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Patient Name (Last, First)" required>
          <input type="text" value={form.patient_name} onChange={e => set('patient_name', e.target.value)} placeholder="Smith, Jane" style={inputStyle} />
        </Field>
        <Field label="Region">
          <select value={form.region} onChange={e => set('region', e.target.value)} style={inputStyle}>
            <option value="">- pick one -</option>
            {REGIONS.map(r => {
              const t = TERRITORIES[r];
              return <option key={r} value={r}>Territory {r} - {t?.counties}</option>;
            })}
          </select>
        </Field>
        <Field label="Limb Type" required>
          <select value={form.limb_type} onChange={e => set('limb_type', e.target.value)} style={inputStyle}>
            <option value="LE">Lower Extremity (LE)</option>
            <option value="UE">Upper Extremity (UE)</option>
          </select>
        </Field>
        <Field label="Order Type">
          <select value={form.order_type} onChange={e => set('order_type', e.target.value)} style={inputStyle}>
            {ORDER_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Insurance">
          <input type="text" value={form.insurance} onChange={e => set('insurance', e.target.value)} placeholder="Humana, Medicare, CarePlus, etc." style={inputStyle} />
        </Field>
        <Field label="Current LOC">
          <input type="text" value={form.current_loc} onChange={e => set('current_loc', e.target.value)} placeholder="LOC 2 / LOC 3" style={inputStyle} />
        </Field>
        <Field label="Current Frequency">
          <input type="text" value={form.current_frequency} onChange={e => set('current_frequency', e.target.value)} placeholder="2x/wk" style={inputStyle} />
        </Field>
        <Field label="Phase of Care">
          <input type="text" value={form.phase_of_care} onChange={e => set('phase_of_care', e.target.value)} placeholder="Active Decongestion, Maintenance" style={inputStyle} />
        </Field>
        <Field label="Field Request Date">
          <input type="date" value={form.field_request_date || ''} onChange={e => set('field_request_date', e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Patient Address" colSpan={2}>
          <input type="text" value={form.patient_address} onChange={e => set('patient_address', e.target.value)} placeholder="Street, city, ZIP" style={inputStyle} />
        </Field>
        <Field label="Etiology" colSpan={2}>
          <input type="text" value={form.etiology} onChange={e => set('etiology', e.target.value)} placeholder="Surgical/Oncologic, Lipedema, Primary lymphedema, etc." style={inputStyle} />
        </Field>
        <Field label="Field Clinician Name">
          <input type="text" value={form.clinician_name} onChange={e => set('clinician_name', e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Field Clinician Email">
          <input type="email" value={form.clinician_email} onChange={e => set('clinician_email', e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Supervisory Clinician (Approver) Name">
          <input type="text" value={form.approver_name} onChange={e => set('approver_name', e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Approver Email">
          <input type="email" value={form.approver_email} onChange={e => set('approver_email', e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Completed Order Form URL" colSpan={2}>
          <input type="text" value={form.order_form_url} onChange={e => set('order_form_url', e.target.value)} placeholder="Google Drive link or other URL" style={inputStyle} />
        </Field>
        <Field label="Additional Items / Accessories" colSpan={2}>
          <textarea rows={2} value={form.additional_items} onChange={e => set('additional_items', e.target.value)}
            placeholder="Liners, donners, socks, gripper patches — include vendor + quantity"
            style={{ ...inputStyle, resize: 'vertical', minHeight: 50 }} />
        </Field>
        <Field label="Notes for Approver" colSpan={2}>
          <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 50 }} />
        </Field>
        <Field label="Auth Needed?">
          <select value={form.auth_needed === null ? '' : String(form.auth_needed)} onChange={e => set('auth_needed', e.target.value === '' ? null : e.target.value === 'true')} style={inputStyle}>
            <option value="">Unknown</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </Field>
      </div>
      {err && <div style={errorBox}>{err}</div>}
      <ModalFooter>
        <button onClick={onClose} disabled={saving} style={ghostBtn}>Cancel</button>
        <button onClick={save} disabled={saving} style={{ ...primaryBtn, background: EC.gradient }}>
          {saving ? 'Saving...' : isEdit ? 'Save' : 'Submit Order'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

// ─── Detail drawer with stage advancement actions ────────────────────────

function OrderDrawer({ profile, order, onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [clinicalComments, setClinicalComments] = useState('');
  const [finalComments, setFinalComments] = useState('');
  const [form, setForm] = useState({
    auth_needed:       order.auth_needed,
    auth_number:       order.auth_number || '',
    auth_date:         order.auth_date || '',
    vendor:            order.vendor || '',
    order_number:      order.order_number || '',
    order_placed_date: order.order_placed_date || '',
    garment_code:      order.garment_code || '',
    garment_cost:      order.garment_cost || '',
    delivery_date:     order.delivery_date || '',
    delivery_proof_url: order.delivery_proof_url || '',
    vendor_eta_date:   order.vendor_eta_date || '',
    tracking_number:   order.tracking_number || '',
    carrier:           order.carrier || '',
    notes:             order.notes || '',
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function persist(patch, action, handoff) {
    setErr('');
    setSaving(true);
    const { error } = await supabase.from('garment_orders').update(patch).eq('id', order.id);
    if (error) { setErr(`Update failed: ${error.message}`); setSaving(false); return; }
    logActivity({
      coordinatorId: profile?.id, coordinatorName: profile?.full_name, coordinatorRole: profile?.role,
      actionType: action || 'garment_order_updated',
      actionDetail: `${order.limb_type} ${order.order_type || ''} for ${order.patient_name}`,
      patientName: order.patient_name,
      tableName: 'garment_orders', recordId: order.id,
    });
    if (handoff) await emitGarmentHandoff(order.id, handoff.event, handoff.message);
    setSaving(false);
    onSaved();
  }

  // Stage 1 — PT/OT signs off the clinical need. Anyone landing on this drawer
  // can act; the gate is the named PT/OT on the request, which is enforced
  // socially (their name is on it) rather than by RLS to keep delegation easy.
  function clinicalApprove() {
    const now = new Date().toISOString();
    persist({
      clinical_approval_status: 'approved',
      clinical_approval_date: now,
      clinical_approval_comments: clinicalComments || null,
      clinical_approver_id: profile?.id || order.clinical_approver_id || null,
      clinical_approver_name: profile?.full_name || order.clinical_approver_name || null,
      clinical_approver_email: profile?.email || order.clinical_approver_email || null,
    }, 'garment_order_clinical_approved', {
      event: 'clinical_approved',
      message: `${profile?.full_name || 'The evaluating clinician'} approved the ${order.limb_type} request for ${order.patient_name}. Awaiting admin sign-off.`,
    });
  }
  function clinicalDeny() {
    if (!clinicalComments.trim()) { setErr('Please add a reason for denial.'); return; }
    persist({
      clinical_approval_status: 'denied',
      clinical_approval_date: new Date().toISOString(),
      clinical_approval_comments: clinicalComments,
      clinical_approver_id: profile?.id || null,
      clinical_approver_name: profile?.full_name || null,
      clinical_approver_email: profile?.email || null,
      final_approval_status: 'denied',
    }, 'garment_order_clinical_denied', {
      event: 'clinical_denied',
      message: `${profile?.full_name || 'The evaluating clinician'} denied the ${order.limb_type} request for ${order.patient_name}. Reason: ${clinicalComments}`,
    });
  }

  // Stage 2 — supply-chain / admin sign-off. Role-gated below.
  function finalApprove() {
    const now = new Date().toISOString();
    persist({
      final_approval_status: 'approved',
      final_approval_date: now,
      final_approval_comments: finalComments || null,
      final_approver_id: profile?.id || null,
      final_approver_name: profile?.full_name || null,
      final_approver_email: profile?.email || null,
    }, 'garment_order_final_approved', {
      event: 'final_approved',
      message: `${profile?.full_name || 'An admin'} gave final approval for ${order.patient_name}'s ${order.limb_type} ${order.order_type || 'garment'}. Ready to place the order.`,
    });
  }
  function finalDeny() {
    if (!finalComments.trim()) { setErr('Please add a reason for denial.'); return; }
    persist({
      final_approval_status: 'denied',
      final_approval_date: new Date().toISOString(),
      final_approval_comments: finalComments,
      final_approver_id: profile?.id || null,
      final_approver_name: profile?.full_name || null,
      final_approver_email: profile?.email || null,
    }, 'garment_order_final_denied', {
      event: 'final_denied',
      message: `${profile?.full_name || 'An admin'} denied the ${order.limb_type} request for ${order.patient_name} at final review. Reason: ${finalComments}`,
    });
  }
  // Stage 3 — Supply Chain places the order. Role-gated below.
  function markOrderPlaced() {
    if (!form.order_number?.trim() && !form.order_placed_date) {
      setErr('Add an order number or order placed date before marking placed.');
      return;
    }
    persist({
      vendor: form.vendor || null,
      order_number: form.order_number || null,
      order_placed_date: form.order_placed_date || todayStr(),
      garment_code: form.garment_code || null,
      garment_cost: form.garment_cost ? Number(form.garment_cost) : null,
      vendor_eta_date: form.vendor_eta_date || null,
    }, 'garment_order_placed', {
      event: 'final_approved', // reuses the existing recipient fan-out
      message: `${profile?.full_name || 'Supply Chain'} placed order #${form.order_number || '?'} with ${form.vendor || 'vendor'} for ${order.patient_name}.`,
    });
  }

  // Stage 4 — delivery confirmed. Sets delivery_date which flips the stage to
  // 'delivered' (and eventually to 'archived' 14 days later via the view).
  function markDelivered() {
    if (!form.delivery_date) {
      setErr('Add a delivery date to mark delivered.');
      return;
    }
    persist({
      delivery_date: form.delivery_date,
      delivery_proof_url: form.delivery_proof_url || null,
      tracking_number: form.tracking_number || null,
      carrier: form.carrier || null,
    }, 'garment_order_delivered', {
      event: 'final_approved',
      message: `${order.patient_name}'s ${order.limb_type} garment was delivered on ${form.delivery_date}.`,
    });
  }

  function cancelOrder(){
    persist({
      final_approval_status: 'cancelled',
      clinical_approval_status: order.clinical_approval_status === 'pending' ? 'cancelled' : order.clinical_approval_status,
    }, 'garment_order_cancelled', { event: 'cancelled', message: `Order for ${order.patient_name} was cancelled.` });
  }
  function saveAll()    { persist(form, 'garment_order_updated'); }

  const isFinalApprover = canFinalApprove(profile);

  const st = STAGE_MAP[order.stage] || STAGE_MAP.submitted;
  const cd = order.clinical_details || {};

  return (
    <Modal title={`${order.patient_name}  -  ${order.limb_type} ${order.order_type || ''}`} onClose={onClose} headerBg={st.color} wide>
      <div style={{ padding: 22 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: st.color, padding: '3px 10px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.4 }}>{st.label}</span>
          <span style={{ fontSize: 11, color: 'var(--gray)' }}>{st.helper}</span>
          {!order.patient_id && (
            <span title="Patient name does not match any census record"
              style={{ fontSize: 10, fontWeight: 700, color: '#9C5700', background: '#FFFBEB', border: '1px solid #F59E0B', padding: '2px 8px', borderRadius: 999 }}>
              Unlinked from census
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 22px', marginBottom: 16 }}>
          <Detail label="Region" value={order.region} />
          <Detail label="Insurance" value={order.insurance} />
          <Detail label="Order Type" value={order.order_type} />
          <Detail label="LOC" value={order.current_loc} />
          <Detail label="Frequency" value={order.current_frequency} />
          <Detail label="Phase of Care" value={order.phase_of_care} />
          <Detail label="Etiology" value={order.etiology} />
          <Detail label="Field Request" value={fmtDate(order.field_request_date)} />
          <Detail label="Field Clinician" value={order.clinician_name} />
          <Detail label="Evaluating PT/OT" value={order.clinical_approver_name || order.approver_name} />
          <Detail label="Final Approver" value={order.final_approver_name} />
          <Detail label="Address" value={order.patient_address} />
        </div>

        {/* Stage 1 — clinical approval by the evaluating PT/OT */}
        {order.clinical_approval_status === 'pending' && (
          <div style={{ marginBottom: 16, padding: 14, background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#9C5700', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>Stage 1 — Clinical Approval</div>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 8 }}>
              For {order.clinical_approver_name || order.approver_name || 'the evaluating PT/OT'} to sign off on the clinical need.
            </div>
            <textarea rows={2} value={clinicalComments} onChange={e => setClinicalComments(e.target.value)}
              placeholder="Clinical comments / denial reason"
              style={{ ...inputStyle, resize: 'vertical', minHeight: 50 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
              <button onClick={clinicalDeny} disabled={saving} style={{ ...primaryBtn, background: '#DC2626' }}>{saving ? 'Working...' : 'Deny'}</button>
              <button onClick={clinicalApprove} disabled={saving} style={{ ...primaryBtn, background: '#059669' }}>{saving ? 'Working...' : 'Clinically Approve'}</button>
            </div>
          </div>
        )}

        {/* Stage 1 result, shown once decided */}
        {order.clinical_approval_status !== 'pending' && (
          <div style={{ marginBottom: 12, padding: '10px 14px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, fontSize: 12, color: '#065F46' }}>
            <strong>Clinical {order.clinical_approval_status}</strong>
            {order.clinical_approver_name ? ` by ${order.clinical_approver_name}` : ''}
            {order.clinical_approval_date ? ` · ${fmtDate(order.clinical_approval_date)}` : ''}
            {order.clinical_approval_comments ? ` — ${order.clinical_approval_comments}` : ''}
          </div>
        )}

        {/* Stage 2 — final approval, role-gated to admin/super_admin */}
        {order.clinical_approval_status === 'approved' && order.final_approval_status === 'pending' && (
          <div style={{ marginBottom: 16, padding: 14, background: '#FEF3C7', border: '1px solid #D97706', borderRadius: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>Stage 2 — Final Approval</div>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 8 }}>
              Admin or super-admin sign-off. This is what triggers placing the order.
            </div>
            {isFinalApprover ? (
              <>
                <textarea rows={2} value={finalComments} onChange={e => setFinalComments(e.target.value)}
                  placeholder="Final approval comments / denial reason"
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 50 }} />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                  <button onClick={finalDeny} disabled={saving} style={{ ...primaryBtn, background: '#DC2626' }}>{saving ? 'Working...' : 'Deny'}</button>
                  <button onClick={finalApprove} disabled={saving} style={{ ...primaryBtn, background: '#92400E' }}>{saving ? 'Working...' : 'Final Approve'}</button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--gray)', fontStyle: 'italic' }}>
                You don't have permission to give the final approval. An admin or super-admin has been notified.
              </div>
            )}
          </div>
        )}

        {/* Stage 2 result, shown once decided */}
        {order.final_approval_status !== 'pending' && order.clinical_approval_status === 'approved' && (
          <div style={{ marginBottom: 12, padding: '10px 14px', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 10, fontSize: 12, color: '#3730A3' }}>
            <strong>Final {order.final_approval_status}</strong>
            {order.final_approver_name ? ` by ${order.final_approver_name}` : ''}
            {order.final_approval_date ? ` · ${fmtDate(order.final_approval_date)}` : ''}
            {order.final_approval_comments ? ` — ${order.final_approval_comments}` : ''}
          </div>
        )}

        {/* Insurance auth capture — visible from Auth Pending onward. Insurance auth
            is gathered in parallel with the admin final approval; it doesn't block
            the stage transition by itself. */}
        {['auth_pending','ready_to_order','order_placed'].includes(order.stage) && (
          <div style={{ marginBottom: 16, padding: 14, background: '#EFF6FF', border: '1px solid #3B82F6', borderRadius: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1E40AF', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Insurance Authorization</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <Field label="Auth Needed?">
                <select value={form.auth_needed === null ? '' : String(form.auth_needed)} onChange={e => set('auth_needed', e.target.value === '' ? null : e.target.value === 'true')} style={inputStyle}>
                  <option value="">Unknown</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </Field>
              <Field label="Auth Number"><input value={form.auth_number} onChange={e => set('auth_number', e.target.value)} style={inputStyle} /></Field>
              <Field label="Auth Date"><input type="date" value={form.auth_date} onChange={e => set('auth_date', e.target.value)} style={inputStyle} /></Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button onClick={saveAll} disabled={saving} style={{ ...primaryBtn, background: '#1E40AF' }}>{saving ? 'Saving...' : 'Save Auth Info'}</button>
            </div>
          </div>
        )}

        {/* Ready to Order — Supply Chain Manager records that the order was placed
            with the vendor. Role-gated to admin/super_admin (the SCM role). */}
        {order.stage === 'ready_to_order' && (
          <div style={{ marginBottom: 16, padding: 14, background: '#ECFDF5', border: '1px solid #10B981', borderRadius: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#065F46', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>Supply Chain — Place Order</div>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 10 }}>
              Record the vendor order number, code, and cost. Saving advances the order to <strong>Order Placed / In Transit</strong>.
            </div>
            {isFinalApprover ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  <Field label="Vendor"><input value={form.vendor} onChange={e => set('vendor', e.target.value)} placeholder="Sigvaris, Juzo, etc." style={inputStyle} /></Field>
                  <Field label="Order Number"><input value={form.order_number} onChange={e => set('order_number', e.target.value)} style={inputStyle} /></Field>
                  <Field label="Order Placed Date"><input type="date" value={form.order_placed_date || todayStr()} onChange={e => set('order_placed_date', e.target.value)} style={inputStyle} /></Field>
                  <Field label="Garment Code"><input value={form.garment_code} onChange={e => set('garment_code', e.target.value)} placeholder="A6583 x 2" style={inputStyle} /></Field>
                  <Field label="Garment Cost ($)"><input type="number" step="0.01" value={form.garment_cost} onChange={e => set('garment_cost', e.target.value)} style={inputStyle} /></Field>
                  <Field label="Vendor ETA"><input type="date" value={form.vendor_eta_date} onChange={e => set('vendor_eta_date', e.target.value)} style={inputStyle} /></Field>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                  <button onClick={markOrderPlaced} disabled={saving} style={{ ...primaryBtn, background: '#7C3AED' }}>{saving ? 'Working...' : 'Mark Order Placed'}</button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--gray)', fontStyle: 'italic' }}>
                Only the Supply Chain Manager (admin / super-admin) can place the order. They have been notified.
              </div>
            )}
          </div>
        )}

        {/* Order Placed → Delivered. Anyone in the chain can confirm delivery
            (typically the field clinician once they receive POD). */}
        {order.stage === 'order_placed' && (
          <div style={{ marginBottom: 16, padding: 14, background: '#F5F3FF', border: '1px solid #7C3AED', borderRadius: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#5B21B6', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>Confirm Delivery</div>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 10 }}>
              Saving with a delivery date advances the order to <strong>Delivered</strong> and starts the 14-day archive countdown.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <Field label="Tracking Number"><input value={form.tracking_number} onChange={e => set('tracking_number', e.target.value)} style={inputStyle} /></Field>
              <Field label="Carrier"><input value={form.carrier} onChange={e => set('carrier', e.target.value)} placeholder="UPS / FedEx / etc." style={inputStyle} /></Field>
              <Field label="Delivery Date"><input type="date" value={form.delivery_date} onChange={e => set('delivery_date', e.target.value)} style={inputStyle} /></Field>
              <Field label="POD / Proof URL" colSpan={3}><input value={form.delivery_proof_url} onChange={e => set('delivery_proof_url', e.target.value)} placeholder="Photo / signed POD link" style={inputStyle} /></Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, gap: 8 }}>
              <button onClick={saveAll} disabled={saving} style={{ ...ghostBtn }}>Save Tracking</button>
              <button onClick={markDelivered} disabled={saving} style={{ ...primaryBtn, background: '#059669' }}>{saving ? 'Working...' : 'Mark Delivered'}</button>
            </div>
          </div>
        )}

        {/* Cancel + utility row — available on every non-terminal stage. */}
        {!['delivered','archived','denied','cancelled'].includes(order.stage) && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button onClick={cancelOrder} disabled={saving} style={{ ...ghostBtn, color: '#9C0006', borderColor: '#FECACA' }}>Cancel Order</button>
          </div>
        )}

        {/* Read-only details for terminal / closed states */}
        {['delivered','archived','denied','cancelled'].includes(order.stage) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 22px', marginBottom: 16 }}>
            <Detail label="Auth #" value={order.auth_number} />
            <Detail label="Auth Date" value={fmtDate(order.auth_date)} />
            <Detail label="Order #" value={order.order_number} />
            <Detail label="Order Placed" value={fmtDate(order.order_placed_date)} />
            <Detail label="Garment Code" value={order.garment_code} />
            <Detail label="Cost" value={fmtMoney(order.garment_cost)} />
            <Detail label="Delivery Date" value={fmtDate(order.delivery_date)} />
            {order.delivery_proof_url && (
              <Detail label="POD" value={<a href={order.delivery_proof_url} target="_blank" rel="noreferrer" style={{ color: EC.teal }}>view</a>} />
            )}
            <Detail label="Clinical Comments" value={order.clinical_approval_comments || order.approval_comments} block />
            <Detail label="Final Approval Comments" value={order.final_approval_comments} block />
          </div>
        )}

        {/* Clinical details */}
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Clinical Assessment Details</summary>
          <div style={{ marginTop: 10, padding: 12, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--black)', lineHeight: 1.6 }}>
            {Object.entries(cd).filter(([_, v]) => v).map(([k, v]) => (
              <div key={k} style={{ marginBottom: 6 }}>
                <strong style={{ color: 'var(--gray)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, display: 'block' }}>{k.replace(/_/g, ' ')}</strong>
                <span style={{ whiteSpace: 'pre-wrap' }}>{String(v)}</span>
              </div>
            ))}
            {order.order_form_url && (
              <div style={{ marginTop: 8 }}>
                <a href={order.order_form_url} target="_blank" rel="noreferrer" style={{ color: EC.teal, fontWeight: 600 }}>Open completed order form ↗</a>
              </div>
            )}
            {order.additional_items && (
              <div style={{ marginTop: 8 }}>
                <strong style={{ color: 'var(--gray)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, display: 'block' }}>Additional Items / Accessories</strong>
                <span style={{ whiteSpace: 'pre-wrap' }}>{order.additional_items}</span>
              </div>
            )}
          </div>
        </details>

        {err && <div style={{ ...errorBox, margin: '14px 0 0' }}>{err}</div>}
      </div>
      <ModalFooter>
        <button onClick={onClose} style={ghostBtn}>Close</button>
      </ModalFooter>
    </Modal>
  );
}

// ─── UI primitives ───────────────────────────────────────────────────────

function Field({ label, required, colSpan, children }) {
  return (
    <div style={{ gridColumn: colSpan ? `span ${colSpan}` : undefined }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)', marginBottom: 4 }}>
        {label}{required && <span style={{ color: '#DC2626', marginLeft: 4 }}>*</span>}
      </div>
      {children}
    </div>
  );
}

function Detail({ label, value, block }) {
  return (
    <div style={{ gridColumn: block ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--black)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{value || '-'}</div>
    </div>
  );
}

function Modal({ title, onClose, children, headerBg, wide }) {
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--card-bg)', borderRadius: 14, width: '100%', maxWidth: wide ? 980 : 760, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '14px 22px', background: headerBg, borderRadius: '14px 14px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer' }}>{'×'}</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({ children }) {
  return (
    <div style={{ padding: '12px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--bg)' }}>
      {children}
    </div>
  );
}

const inputStyle = { width: '100%', padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' };
const ghostBtn   = { padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, background: 'var(--card-bg)', cursor: 'pointer', fontWeight: 600, color: 'var(--black)' };
const primaryBtn = { padding: '8px 18px', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const errorBox   = { margin: '0 22px 14px', padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#9C0006', fontSize: 12, fontWeight: 600, borderRadius: 7 };
const th = { textAlign: 'left', padding: '10px 14px', fontSize: 11, color: 'var(--gray)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 };
const td = { padding: '10px 14px', verticalAlign: 'top' };
