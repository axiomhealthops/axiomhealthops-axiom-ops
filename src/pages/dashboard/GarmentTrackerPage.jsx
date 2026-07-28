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
// Built 2026-06-15. Rebuilt 2026-07-24 — see below.
//
// ---------------------------------------------------------------------
// 2026-07-24 REBUILD — what the production data forced
// ---------------------------------------------------------------------
// Measured against all 217 orders before touching anything:
//
//   * All 217 rows were created by ONE sheet import on 2026-06-16. Zero
//     orders have been created through this UI in the 38 days since, and
//     the last write of any kind was 2026-06-27. The page works; it just
//     was not adopted.
//   * 0 orders have EVER reached 'delivered'. The last two Kanban
//     columns render permanently empty, and the two tiles that read off
//     delivery ("Delivered MTD", "MTD Spend") are structurally stuck at
//     0 and $0.00 — two of seven tiles carrying no information.
//   * The old stale rule (`created_at` older than 7 days) flagged 217 of
//     217 orders. Every card drew a red border, so the alarm meant
//     nothing. Now in garmentSla.js with per-stage targets and a real
//     per-stage clock.
//   * 138 orders sit in 'order_placed' — 99 of them over 60 days —
//     carrying $19,420.92 of garment value, with 0 vendors and 0 ETAs
//     recorded. Nobody can chase a late order because nothing records
//     who it was ordered from or when it was due. `markOrderPlaced` now
//     requires a vendor, and the board surfaces the gap as its own tile.
//
// So the redesign is not cosmetic. The old layout gave equal weight to
// seven numbers, two of which could not move, and drew the same alarm
// on every card. The rebuild ranks by what somebody has to do today:
// one hero count of work we owe, the money exposed, and the tracking
// gap — each tile also being the filter that isolates it, so a number
// that looks wrong is one click from the rows behind it.
//
// All SLA / aging / rollup math lives in src/lib/garmentSla.js and is
// asserted in `npm run check`. Do not re-derive it here.
// =====================================================================

import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages, logActivity } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import GarmentSheetUploadCard from '../../components/GarmentSheetUploadCard';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import { EC, TERRITORIES, TERRITORY_LETTERS } from '../../lib/constants';
import { exportXLSX, exportCSV } from '../../lib/exportSheet';
import {
  orderHealth, healthStyle, formatAge, summarize, byUrgency,
  STAGE_SLA_DAYS, TERMINAL_STAGES,
} from '../../lib/garmentSla';
import { finderFor, finderByKey, SIZE_FINDER_INDEX } from '../../lib/garmentSizing';
import { sizeGarment, variantsFor, coloursFor, lengthBandsFor } from '../../lib/garmentSizeEngine';

const REGIONS = TERRITORY_LETTERS;

// Kanban columns shown by default. 'archived' / 'denied' / 'cancelled' are
// real stages but hidden from the board — surfaced via the Stage filter.
const STAGES = [
  { key: 'submitted',      label: 'Submitted',         color: '#9C5700', bg: '#FFFBEB', border: '#F59E0B', helper: 'Awaiting PT/OT clinical approval', owner: 'Evaluating PT/OT' },
  { key: 'auth_pending',   label: 'Auth Pending',      color: '#1E40AF', bg: '#EFF6FF', border: '#3B82F6', helper: 'Clinically approved, awaiting admin sign-off + insurance auth', owner: 'Admin + Auth' },
  { key: 'ready_to_order', label: 'Ready to Order',    color: '#065F46', bg: '#ECFDF5', border: '#10B981', helper: 'Approved — Supply Chain to place order', owner: 'Supply Chain' },
  { key: 'order_placed',   label: 'Order Placed / In Transit', color: '#7C3AED', bg: '#F5F3FF', border: '#7C3AED', helper: 'Order placed with vendor, awaiting delivery', owner: 'Vendor' },
  { key: 'delivered',      label: 'Delivered',         color: '#065F46', bg: '#D1FAE5', border: '#059669', helper: 'POD received — archives 14 days after delivery', owner: 'Field clinician' },
];
// Hidden stages — included in STAGE_MAP so badges and filters render, but not
// rendered as kanban columns by default.
const HIDDEN_STAGES = [
  { key: 'archived',  label: 'Archived',  color: '#475569', bg: '#F1F5F9', border: '#64748B', helper: 'Delivered > 14 days ago', owner: '-' },
  { key: 'denied',    label: 'Denied',    color: '#9C0006', bg: '#FEF2F2', border: '#DC2626', helper: 'Approval was denied', owner: '-' },
  { key: 'cancelled', label: 'Cancelled', color: '#475569', bg: '#F1F5F9', border: '#64748B', helper: 'Order was cancelled', owner: '-' },
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
// Compact money for tiles — "$19.4k" reads at a glance where
// "$19,420.92" makes the eye stop and parse.
function fmtMoneyShort(n) {
  const x = Number(n) || 0;
  if (Math.abs(x) >= 1000) return '$' + (x / 1000).toFixed(1) + 'k';
  return '$' + x.toFixed(0);
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

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
  const [filterHealth, setFilterHealth] = useState('ALL');   // ALL | breached | at_risk | no_eta | unlinked
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkAction, setBulkAction] = useState(null);       // 'place' | 'eta' | null

  const loadData = useCallback(() => {
    fetchAllPages(supabase.from('v_garment_orders_with_stage').select('*').order('created_at', { ascending: false }))
      .then(rows => { setOrders(Array.isArray(rows) ? rows : []); setLoading(false); })
      .catch(err => { console.error(err); setLoading(false); });
  }, []);
  useEffect(() => { loadData(); }, [loadData]);
  useRealtimeTable(['garment_orders'], loadData);

  // Search is debounced because every keystroke re-derives health for
  // every order. At 217 rows that is imperceptible; the import path can
  // put thousands here and the cost is linear.
  const [searchDebounced, setSearchDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  // One health pass over the whole board, reused by the tiles, the
  // columns, the table and the sort. Deriving it per consumer is how
  // tiles and columns drift apart.
  const healthById = useMemo(() => {
    const now = new Date();
    const m = new Map();
    for (const o of orders) m.set(o.id, orderHealth(o, now));
    return m;
  }, [orders]);

  const stats = useMemo(() => summarize(orders), [orders]);

  const myName = (profile?.full_name || '').toLowerCase();
  const myRegions = Array.isArray(profile?.regions) ? profile.regions : [];

  const filtered = useMemo(() => orders.filter(o => {
    if (filterRegion !== 'ALL' && o.region !== filterRegion) return false;
    if (filterLimb !== 'ALL' && o.limb_type !== filterLimb) return false;
    if (filterType !== 'ALL' && o.order_type !== filterType) return false;
    // 'ALL' = active board (everything except archived/denied/cancelled).
    // 'ALL_INCLUDING_ARCHIVED' = no stage filter at all.
    if (filterStage === 'ALL' && ['archived','denied','cancelled'].includes(o.stage)) return false;
    if (filterStage !== 'ALL' && filterStage !== 'ALL_INCLUDING_ARCHIVED' && o.stage !== filterStage) return false;

    // Health / exception filters. These are what the KPI tiles set when
    // clicked, so a tile and its filter can never disagree about what
    // it counted.
    if (filterHealth !== 'ALL') {
      const h = healthById.get(o.id);
      if (filterHealth === 'breached'  && h?.health !== 'breached') return false;
      if (filterHealth === 'at_risk'   && h?.health !== 'at_risk')  return false;
      if (filterHealth === 'action'    && !['submitted','auth_pending','ready_to_order'].includes(o.stage)) return false;
      if (filterHealth === 'no_eta'    && !(o.stage === 'order_placed' && !o.vendor_eta_date)) return false;
      if (filterHealth === 'unlinked'  && o.patient_id) return false;
    }

    // "My work" — a field clinician landing on 217 rows has no way in.
    // Matches on their name in any of the four people-columns, or on
    // their assigned regions.
    if (mineOnly) {
      const named = [o.clinician_name, o.approver_name, o.clinical_approver_name, o.final_approver_name]
        .filter(Boolean).some(n => n.toLowerCase() === myName);
      const inRegion = myRegions.length > 0 && myRegions.includes(o.region);
      if (!named && !inRegion) return false;
    }

    if (searchDebounced) {
      const q = searchDebounced.toLowerCase();
      const hay = [o.patient_name, o.clinician_name, o.approver_name, o.clinical_approver_name,
                   o.final_approver_name, o.garment_code, o.garment_sku, o.garment_size,
                   o.order_number, o.vendor, o.insurance].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [orders, filterRegion, filterLimb, filterType, filterStage, filterHealth, mineOnly, searchDebounced, healthById, myName, myRegions]);

  // Selection only ever holds ids that are still visible — otherwise a
  // filter change can leave a bulk action pointed at rows nobody can see.
  const visibleIds = useMemo(() => new Set(filtered.map(o => o.id)), [filtered]);
  const selection = useMemo(() => filtered.filter(o => selectedIds.has(o.id)), [filtered, selectedIds]);
  useEffect(() => {
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIds]);

  function resetFilters() {
    setFilterRegion('ALL'); setFilterLimb('ALL'); setFilterType('ALL');
    setFilterStage('ALL'); setFilterHealth('ALL'); setMineOnly(false); setSearch('');
  }
  // A KPI tile IS its filter. Clicking "Late" shows exactly the rows the
  // tile counted; clicking it again clears.
  function applyTileFilter(key, stage) {
    const same = filterHealth === key && (stage ? filterStage === stage : true);
    if (same) { setFilterHealth('ALL'); setFilterStage('ALL'); return; }
    setFilterHealth(key);
    setFilterStage(stage || 'ALL');
    setViewMode('table');
  }

  function exportRows(rows, filename) {
    const out = rows.map(o => {
      const h = healthById.get(o.id) || {};
      return {
        Stage: STAGE_MAP[o.stage]?.label || o.stage,
        'Days in Stage': formatAge(h),
        'SLA (days)': h.sla ?? '',
        Health: h.health || '',
        'Age is a floor': h.isFloor ? 'YES - true age is at most this' : '',
        Patient: o.patient_name,
        'Linked to census': o.patient_id ? 'yes' : 'NO',
        Region: o.region || '',
        Limb: o.limb_type,
        'Order Type': o.order_type || '',
        Insurance: o.insurance || '',
        Clinician: o.clinician_name || '',
        'Evaluating PT/OT': o.clinical_approver_name || o.approver_name || '',
        'Final Approver': o.final_approver_name || '',
        'Auth Needed': o.auth_needed === null ? 'unknown' : o.auth_needed ? 'yes' : 'no',
        'Auth #': o.auth_number || '',
        'Auth Date': o.auth_date || '',
        Vendor: o.vendor || '',
        'Order #': o.order_number || '',
        'Order Placed': o.order_placed_date || '',
        'Vendor ETA': o.vendor_eta_date || '',
        Size: o.garment_size || '',
        SKU: o.garment_sku || '',
        'Garment Code': o.garment_code || '',
        Cost: o.garment_cost ?? '',
        Carrier: o.carrier || '',
        Tracking: o.tracking_number || '',
        'Delivery Date': o.delivery_date || '',
        Notes: o.notes || '',
      };
    });
    return { out, filename };
  }
  function doExport(kind) {
    const { out, filename } = exportRows(filtered, `garment-orders-${todayStr()}`);
    if (!out.length) return;
    if (kind === 'csv') exportCSV(out, filename); else exportXLSX(out, 'Garment Orders', filename);
  }

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Garment Tracker" subtitle="Loading..." />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading...</div>
    </div>
  );

  // ─── Group filtered orders by stage for the Kanban, worst first ────
  const now = new Date();
  const urgency = byUrgency(now);
  const grouped = STAGES.reduce((acc, st) => {
    acc[st.key] = filtered.filter(o => o.stage === st.key).sort(urgency);
    return acc;
  }, {});

  const isFinalApprover = canFinalApprove(profile);
  const filtersActive = filterRegion !== 'ALL' || filterLimb !== 'ALL' || filterType !== 'ALL'
    || filterStage !== 'ALL' || filterHealth !== 'ALL' || mineOnly || !!search;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Garment Tracker"
        subtitle={`${stats.needsAction} awaiting action - ${stats.breached} past target - ${stats.inTransit} in transit - ${fmtMoney(stats.openValue)} committed and undelivered`}
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
            {/* Both formats, same as every other export in the product:
                XLSX for Excel, CSV for Google Sheets. */}
            <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
              <button onClick={() => doExport('xlsx')} title="Export the rows currently shown to Excel"
                style={{ padding: '6px 12px', background: 'transparent', color: 'var(--gray)', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>XLSX</button>
              <button onClick={() => doExport('csv')} title="Export the rows currently shown to CSV"
                style={{ padding: '6px 12px', background: 'transparent', color: 'var(--gray)', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', borderLeft: '1px solid var(--border)' }}>CSV</button>
            </div>
            <button onClick={() => setShowNewModal(true)}
              style={{ padding: '8px 16px', background: EC.gradient, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(124, 91, 247, 0.2)' }}>
              + New Order
            </button>
          </div>
        }
      />
      <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Sheet import. Gated to the final-approver roles: it rewrites
            every sheet-owned field on every order, which is not a
            clinician-level action. Reloads the board on success so the
            imported queue is visible immediately. */}
        {isFinalApprover && <GarmentSheetUploadCard onImported={loadData} />}

        {/* ── Command strip ────────────────────────────────────────────
            Four numbers that change what somebody does today, each one
            also being the filter that isolates it. The old seven-tile
            row gave the same weight to "Archived" (structurally 0) as to
            work in the queue. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
          <Kpi
            label="Awaiting our action"
            value={stats.needsAction}
            sub={`${stats.byStage.submitted || 0} PT/OT · ${stats.byStage.auth_pending || 0} admin · ${stats.byStage.ready_to_order || 0} to place`}
            accent={EC.indigo} bg="#EEF2FF" hero
            active={filterHealth === 'action'}
            onClick={() => applyTileFilter('action')}
          />
          <Kpi
            label="Past stage target"
            value={stats.breached}
            sub={stats.atRisk > 0 ? `${stats.atRisk} more at risk · ${fmtMoneyShort(stats.breachedValue)} exposed` : `${fmtMoneyShort(stats.breachedValue)} exposed`}
            accent="#9C0006" bg="#FEF2F2"
            active={filterHealth === 'breached'}
            onClick={() => applyTileFilter('breached')}
          />
          <Kpi
            label="In transit, no ETA"
            value={stats.inTransitNoEta}
            sub={`of ${stats.inTransit} placed · ${stats.noVendor} with no vendor`}
            accent="#7C3AED" bg="#F5F3FF"
            active={filterHealth === 'no_eta'}
            onClick={() => applyTileFilter('no_eta', 'order_placed')}
          />
          <Kpi
            label="Committed, undelivered"
            value={fmtMoneyShort(stats.openValue)}
            sub={`${(stats.byStage.ready_to_order || 0) + stats.inTransit} orders approved and not yet received`}
            accent="#065F46" bg="#ECFDF5"
          />
        </div>

        {/* ── Stage funnel ─────────────────────────────────────────────
            Replaces five of the seven old tiles. Shows where the work is
            piled up, proportionally, and doubles as the stage filter.
            Delivered is included even at zero — an empty final stage is
            itself the finding, and hiding it would hide it. */}
        <StageFunnel
          stats={stats} orders={orders} healthById={healthById}
          active={filterStage}
          onPick={k => { setFilterStage(k === filterStage ? 'ALL' : k); setFilterHealth('ALL'); }}
        />

        {/* Filter bar */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search patient, clinician, vendor, SKU, order#"
            style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--bg)', width: 260 }} />
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
          <Filter label="Health" value={filterHealth} onChange={setFilterHealth}
            options={[
              ['ALL', 'Any health'],
              ['breached', 'Past target'],
              ['at_risk', 'At risk'],
              ['action', 'Awaiting our action'],
              ['no_eta', 'Placed, no ETA'],
              ['unlinked', 'Unlinked from census'],
            ]} />
          <label title="Orders where you are the clinician or approver, or that sit in your region"
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--gray)', cursor: 'pointer', fontWeight: 600 }}>
            <input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} />
            My work
          </label>
          {filtersActive && (
            <button onClick={resetFilters} style={{ ...ghostBtn, padding: '5px 10px', fontSize: 11 }}>Clear</button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center', fontSize: 11, color: 'var(--gray)' }}>
            {stats.unlinked > 0 && (
              <button onClick={() => applyTileFilter('unlinked')}
                title="These orders never matched a census patient, so they are invisible to anything that joins on patient"
                style={{ ...ghostBtn, padding: '4px 9px', fontSize: 11, color: '#9C5700', borderColor: '#F59E0B', background: '#FFFBEB' }}>
                {stats.unlinked} unlinked
              </button>
            )}
            <span>Showing {filtered.length} of {orders.length}</span>
          </div>
        </div>

        {/* Bulk action bar — appears only with a selection. The 41-order
            ready-to-order backlog is the reason this exists: placing them
            one drawer at a time is 41 modals. */}
        {selection.length > 0 && (
          <BulkBar
            selection={selection}
            isFinalApprover={isFinalApprover}
            onClear={() => setSelectedIds(new Set())}
            onPlace={() => setBulkAction('place')}
            onEta={() => setBulkAction('eta')}
            onExport={() => {
              const { out, filename } = exportRows(selection, `garment-selection-${todayStr()}`);
              exportXLSX(out, 'Garment Orders', filename);
            }}
          />
        )}

        {/* Main view */}
        {viewMode === 'kanban' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(250px, 1fr))', gap: 12, overflowX: 'auto', paddingBottom: 8, alignItems: 'start' }}>
            {STAGES.map(st => (
              <StageColumn
                key={st.key} stage={st} orders={grouped[st.key]} healthById={healthById}
                onOpen={setSelectedOrder}
              />
            ))}
          </div>
        ) : (
          <OrderTable
            orders={filtered} healthById={healthById}
            selectedIds={selectedIds} onToggle={id => setSelectedIds(prev => {
              const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
            })}
            onToggleAll={() => setSelectedIds(prev =>
              prev.size === filtered.length ? new Set() : new Set(filtered.map(o => o.id)))}
            onClick={setSelectedOrder}
          />
        )}
      </div>

      {showNewModal && (
        <OrderModal profile={profile} onClose={() => setShowNewModal(false)} onSaved={() => { setShowNewModal(false); loadData(); }} />
      )}
      {selectedOrder && (
        <OrderDrawer profile={profile} order={selectedOrder} health={healthById.get(selectedOrder.id)}
          onClose={() => setSelectedOrder(null)} onSaved={() => { setSelectedOrder(null); loadData(); }} />
      )}
      {bulkAction && (
        <BulkModal
          kind={bulkAction} selection={selection} profile={profile}
          onClose={() => setBulkAction(null)}
          onSaved={() => { setBulkAction(null); setSelectedIds(new Set()); loadData(); }}
        />
      )}
    </div>
  );
}

// ─── Components ──────────────────────────────────────────────────────────

function Kpi({ label, value, accent, bg, sub, hero, active, onClick }) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }) : undefined}
      title={clickable ? (active ? 'Click to clear this filter' : 'Click to see these orders') : undefined}
      style={{
        background: bg || 'var(--card-bg)', border: `1px solid ${active ? accent : 'var(--border)'}`,
        borderLeft: `4px solid ${accent}`, borderRadius: 10, padding: hero ? '12px 14px' : '10px 12px',
        cursor: clickable ? 'pointer' : 'default',
        boxShadow: active ? `0 0 0 2px ${accent}22` : 'none',
        outline: 'none',
      }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: hero ? 30 : 22, fontWeight: 700, color: accent, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 4, lineHeight: 1.35 }}>{sub}</div>}
    </div>
  );
}

/**
 * Horizontal stage funnel. Width is proportional to volume so a pile-up
 * is visible without reading a single number, and each segment carries
 * its own breach count — a stage can be small and entirely on fire.
 */
function StageFunnel({ stats, orders, healthById, active, onPick }) {
  const counts = STAGES.map(st => {
    const rows = orders.filter(o => o.stage === st.key);
    const breached = rows.filter(o => healthById.get(o.id)?.health === 'breached').length;
    const value = rows.reduce((s, o) => s + (Number(o.garment_cost) || 0), 0);
    return { st, n: rows.length, breached, value };
  });
  const max = Math.max(1, ...counts.map(c => c.n));

  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Pipeline by stage</div>
        <div style={{ fontSize: 10, color: 'var(--gray)' }}>
          Target: {STAGES.filter(s => STAGE_SLA_DAYS[s.key]).map(s => `${s.label.split(' /')[0]} ${STAGE_SLA_DAYS[s.key]}d`).join(' · ')}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: 8 }}>
        {counts.map(({ st, n, breached, value }) => (
          <div key={st.key} onClick={() => onPick(st.key)} role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(st.key); } }}
            title={`${st.label} — owned by ${st.owner}. ${st.helper}`}
            style={{ cursor: 'pointer', opacity: active === 'ALL' || active === st.key ? 1 : 0.5, outline: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: st.color, lineHeight: 1.1 }}>{n}</span>
              {breached > 0 && (
                <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', background: '#DC2626', padding: '1px 5px', borderRadius: 999 }}>
                  {breached} late
                </span>
              )}
            </div>
            {/* Proportional bar. An empty stage still renders a track, so
                "Delivered: 0" reads as a real, measured zero rather than
                as a rendering gap. */}
            <div style={{ height: 6, background: 'var(--bg)', borderRadius: 999, margin: '5px 0 4px', overflow: 'hidden', border: '1px solid var(--border)' }}>
              <div style={{ width: `${(n / max) * 100}%`, height: '100%', background: st.border, borderRadius: 999 }} />
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: 0.3, lineHeight: 1.2 }}>{st.label}</div>
            <div style={{ fontSize: 9, color: 'var(--gray)', marginTop: 2 }}>
              {st.owner}{value > 0 ? ` · ${fmtMoneyShort(value)}` : ''}
            </div>
          </div>
        ))}
      </div>
      {stats.unknownClock > 0 && (
        <div style={{ marginTop: 10, fontSize: 10, color: 'var(--gray)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          {stats.unknownClock} order{stats.unknownClock === 1 ? ' has' : 's have'} no usable date for their current stage and are shown without an age rather than assumed current.
        </div>
      )}
    </div>
  );
}

function StageColumn({ stage: st, orders, healthById, onOpen }) {
  const breached = orders.filter(o => healthById.get(o.id)?.health === 'breached').length;
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderTop: `4px solid ${st.border}`, borderRadius: 10, display: 'flex', flexDirection: 'column', minHeight: 200 }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: st.color, textTransform: 'uppercase', letterSpacing: 0.3 }}>{st.label}</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {breached > 0 && (
              <span title={`${breached} past the ${STAGE_SLA_DAYS[st.key]}-day target`}
                style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: '#DC2626', padding: '2px 6px', borderRadius: 999 }}>{breached}</span>
            )}
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)', background: st.bg, padding: '2px 8px', borderRadius: 999 }}>{orders.length}</div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 3, lineHeight: 1.3 }}>
          {st.helper}{STAGE_SLA_DAYS[st.key] ? ` · target ${STAGE_SLA_DAYS[st.key]}d` : ''}
        </div>
      </div>
      <div style={{ flex: 1, padding: 8, overflowY: 'auto', maxHeight: 620, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {orders.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--gray)', lineHeight: 1.5 }}>
            {st.key === 'delivered'
              // The single most important empty state on this page. A
              // blank column reads as "nothing to do"; this reads as
              // "the process has never been closed out", which is what
              // the data actually says.
              ? 'No delivery has ever been recorded. Orders stop being tracked once they are placed.'
              : 'Empty'}
          </div>
        ) : orders.map(o => (
          <OrderCard key={o.id} order={o} health={healthById.get(o.id)} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

// Memoised: a keystroke in the search box otherwise re-renders every
// card on the board.
const OrderCard = memo(function OrderCard({ order: o, health, onOpen }) {
  const hs = healthStyle(health?.health);
  const late = health?.health === 'breached';
  return (
    <div onClick={() => onOpen(o)} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(o); }}
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${hs.border}`,
        borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 4, outline: 'none',
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--black)' }}>{o.patient_name}</div>
        <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', background: o.limb_type === 'UE' ? '#7C3AED' : '#0E7490', padding: '1px 6px', borderRadius: 999 }}>{o.limb_type}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--gray)' }}>
        {o.order_type || 'Order type unset'}{o.region ? ` · Region ${o.region}` : ''}
      </div>
      {o.clinician_name && <div style={{ fontSize: 11, color: 'var(--gray)' }}>{'>'} {o.clinician_name}</div>}
      {(o.garment_size || o.garment_sku) && (
        <div style={{ fontSize: 10, color: 'var(--gray)' }}>
          {[o.garment_size, o.garment_sku].filter(Boolean).join(' · ')}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 3 }}>
        {/* Age chip. The '+' is load-bearing: it says the true age is at
            most this, because the timestamp for this stage is missing.
            Never render a floor as an exact figure. */}
        <span title={health?.isFloor
            ? `At most ${health.ageDays} days — the timestamp for this stage was never recorded, so this is an upper bound measured from ${health.basis?.replace(/_/g, ' ')}.`
            : `Measured from ${health?.basis?.replace(/_/g, ' ') || 'unknown'}`}
          style={{ fontSize: 9, fontWeight: 700, color: hs.fg, background: hs.bg, border: `1px solid ${hs.border}`, padding: '1px 6px', borderRadius: 999 }}>
          {formatAge(health)}{late && health?.overBy ? ` · ${health.overBy}d over` : ''}
        </span>
        {o.stage === 'order_placed' && !o.vendor_eta_date && (
          <span title="No vendor ETA recorded, so there is no date on which anyone would know this is late"
            style={{ fontSize: 9, fontWeight: 700, color: '#7C3AED', background: '#F5F3FF', border: '1px solid #DDD6FE', padding: '1px 6px', borderRadius: 999 }}>No ETA</span>
        )}
        {!o.patient_id && (
          <span title="Patient name does not match any census record yet"
            style={{ fontSize: 9, fontWeight: 700, color: '#9C5700', background: '#FFFBEB', border: '1px solid #FDE68A', padding: '1px 6px', borderRadius: 999 }}>Unlinked</span>
        )}
        {o.garment_cost != null && (
          <span style={{ fontSize: 10, fontWeight: 600, color: '#065F46', marginLeft: 'auto' }}>{fmtMoney(o.garment_cost)}</span>
        )}
      </div>
    </div>
  );
});

function Filter({ label, value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      title={label} aria-label={label}
      style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, outline: 'none', background: 'var(--bg)' }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function BulkBar({ selection, isFinalApprover, onClear, onPlace, onEta, onExport }) {
  const allReady = selection.every(o => o.stage === 'ready_to_order');
  const allPlaced = selection.every(o => o.stage === 'order_placed');
  const value = selection.reduce((s, o) => s + (Number(o.garment_cost) || 0), 0);
  return (
    <div style={{ background: EC.navy, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
        {selection.length} selected{value > 0 ? ` · ${fmtMoney(value)}` : ''}
      </span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        {isFinalApprover && allReady && (
          <button onClick={onPlace} style={{ ...primaryBtn, background: '#7C3AED' }}>Mark {selection.length} Order{selection.length === 1 ? '' : 's'} Placed</button>
        )}
        {isFinalApprover && allPlaced && (
          <button onClick={onEta} style={{ ...primaryBtn, background: '#0EA5E9' }}>Set Vendor ETA</button>
        )}
        {!allReady && !allPlaced && (
          <span style={{ fontSize: 11, color: '#CBD5E1' }}>Select orders in a single stage to act on them together</span>
        )}
        <button onClick={onExport} style={{ ...ghostBtn, background: 'transparent', color: '#fff', borderColor: '#475569' }}>Export selection</button>
        <button onClick={onClear} style={{ ...ghostBtn, background: 'transparent', color: '#fff', borderColor: '#475569' }}>Clear</button>
      </div>
    </div>
  );
}

// ─── Table view ──────────────────────────────────────────────────────────

const TABLE_COLS = [
  { key: 'stage',        label: 'Stage' },
  { key: 'age',          label: 'Age' },
  { key: 'patient_name', label: 'Patient' },
  { key: 'limb_type',    label: 'Limb' },
  { key: 'order_type',   label: 'Type' },
  { key: 'region',       label: 'Region' },
  { key: 'clinician_name', label: 'Clinician' },
  { key: 'vendor',       label: 'Vendor' },
  { key: 'order_number', label: 'Order#' },
  { key: 'garment_cost', label: 'Cost', right: true },
  { key: 'vendor_eta_date', label: 'ETA' },
  { key: 'delivery_date',   label: 'Delivered' },
];

function OrderTable({ orders, healthById, selectedIds, onToggle, onToggleAll, onClick }) {
  const [sort, setSort] = useState({ key: 'age', dir: 'desc' });

  const sorted = useMemo(() => {
    const rows = [...orders];
    const dir = sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let va, vb;
      if (sort.key === 'age') {
        va = healthById.get(a.id)?.ageDays ?? -1;
        vb = healthById.get(b.id)?.ageDays ?? -1;
      } else if (sort.key === 'garment_cost') {
        va = Number(a.garment_cost) || 0; vb = Number(b.garment_cost) || 0;
      } else {
        va = (a[sort.key] ?? '').toString().toLowerCase();
        vb = (b[sort.key] ?? '').toString().toLowerCase();
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return rows;
  }, [orders, sort, healthById]);

  function toggleSort(key) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
  }

  const allSelected = orders.length > 0 && selectedIds.size === orders.length;

  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
            <th style={{ ...th, width: 34 }}>
              <input type="checkbox" checked={allSelected} onChange={onToggleAll} aria-label="Select all rows" />
            </th>
            {TABLE_COLS.map(c => (
              <th key={c.key} onClick={() => toggleSort(c.key)}
                style={{ ...th, textAlign: c.right ? 'right' : 'left', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ^' : ' v') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={TABLE_COLS.length + 1} style={{ padding: 30, textAlign: 'center', color: 'var(--gray)' }}>No orders match the current filters.</td></tr>
          ) : sorted.map(o => {
            const st = STAGE_MAP[o.stage] || STAGE_MAP.submitted;
            const h = healthById.get(o.id);
            const hs = healthStyle(h?.health);
            const sel = selectedIds.has(o.id);
            return (
              <tr key={o.id}
                style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: sel ? '#EEF2FF' : 'transparent' }}>
                <td style={td} onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={sel} onChange={() => onToggle(o.id)} aria-label={`Select ${o.patient_name}`} />
                </td>
                <td style={td} onClick={() => onClick(o)}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: st.color, background: st.bg, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{st.label}</span>
                </td>
                <td style={td} onClick={() => onClick(o)}>
                  <span title={h?.isFloor ? 'Upper bound — the timestamp for this stage was never recorded' : undefined}
                    style={{ fontSize: 10, fontWeight: 700, color: hs.fg, background: hs.bg, border: `1px solid ${hs.border}`, padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                    {formatAge(h)}
                  </span>
                </td>
                <td style={{ ...td, fontWeight: 600, color: 'var(--black)' }} onClick={() => onClick(o)}>
                  {o.patient_name}
                  {!o.patient_id && <span title="Patient does not match census yet" style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#9C5700', background: '#FFFBEB', padding: '1px 6px', borderRadius: 999 }}>?</span>}
                </td>
                <td style={td} onClick={() => onClick(o)}>{o.limb_type}</td>
                <td style={td} onClick={() => onClick(o)}>{o.order_type || '-'}</td>
                <td style={td} onClick={() => onClick(o)}>{o.region || '-'}</td>
                <td style={td} onClick={() => onClick(o)}>{o.clinician_name || '-'}</td>
                <td style={td} onClick={() => onClick(o)}>
                  {o.vendor || <span style={{ color: '#DC2626', fontWeight: 600 }}>none</span>}
                </td>
                <td style={td} onClick={() => onClick(o)}>{o.order_number || '-'}</td>
                <td style={{ ...td, textAlign: 'right' }} onClick={() => onClick(o)}>{fmtMoney(o.garment_cost)}</td>
                <td style={td} onClick={() => onClick(o)}>
                  {o.vendor_eta_date ? fmtDate(o.vendor_eta_date)
                    : o.stage === 'order_placed' ? <span style={{ color: '#7C3AED', fontWeight: 600 }}>not set</span> : '-'}
                </td>
                <td style={td} onClick={() => onClick(o)}>{fmtDate(o.delivery_date) || '-'}</td>
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
    garment_size:       order?.garment_size       || '',
    garment_sku:        order?.garment_sku        || '',
    size_tool:          order?.size_tool          || '',
    size_measurements:  order?.size_measurements  || null,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [dirty, setDirty] = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); setDirty(true); }

  // Losing a half-filled clinical form to a stray backdrop click is the
  // kind of thing that sends people back to the spreadsheet.
  function guardedClose() {
    if (dirty && !window.confirm('Discard this garment order? Nothing has been saved.')) return;
    onClose();
  }

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
      // Only stamp the sizing provenance when a size was actually captured.
      ...(form.garment_size || form.garment_sku
        ? { sized_at: new Date().toISOString(), sized_by: profile?.id || null, sized_by_name: profile?.full_name || null }
        : {}),
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
    <Modal title={isEdit ? 'Edit Garment Order' : 'New Garment Order'} onClose={guardedClose} headerBg={EC.gradient}>
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

        {/* Sizing. This is the step that had nowhere to live: the size
            finders produce a size + Sigvaris item number and the result
            was previously re-typed into free-text garment_code, or lost. */}
        <div style={{ gridColumn: '1 / -1' }}>
          <SizeFinderPanel
            limb={form.limb_type}
            value={{ garment_size: form.garment_size, garment_sku: form.garment_sku, size_tool: form.size_tool, size_measurements: form.size_measurements }}
            onChange={patch => { setForm(f => ({ ...f, ...patch })); setDirty(true); }}
          />
        </div>

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
        <button onClick={guardedClose} disabled={saving} style={ghostBtn}>Cancel</button>
        <button onClick={save} disabled={saving} style={{ ...primaryBtn, background: EC.gradient }}>
          {saving ? 'Saving...' : isEdit ? 'Save' : 'Submit Order'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

// ─── Size finder ─────────────────────────────────────────────────────────

/**
 * Bridge to the eight published Sigvaris size finders.
 *
 * The finders are claude.ai artifacts and run under a CSP that blocks
 * every outbound request, so they cannot post a result back here — the
 * handoff has to be the clinician carrying the answer across. What this
 * panel does is make that handoff one deliberate step instead of an
 * undocumented one: it opens the RIGHT finder for the limb being
 * ordered, and gives the size, the item number and the measurements a
 * named home on the order instead of a free-text box.
 *
 * See docs — porting the finders in-app removes the round trip entirely
 * and is the intended end state; this is the version that works today
 * without touching the published artifacts.
 */
function SizeFinderPanel({ limb, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [variant, setVariant] = useState('');
  const [colour, setColour] = useState('');
  const finders = useMemo(() => finderFor(limb), [limb]);
  const m = value.size_measurements || {};
  const activeFinder = finderByKey(value.size_tool);

  function setMeasure(pt, v) {
    const next = { ...m };
    if (v === '' || v == null) delete next[pt]; else next[pt] = Number(v);
    onChange({ size_measurements: Object.keys(next).length ? next : null });
  }

  // Live size, recomputed as measurements are typed. `__length` is the
  // garment-length axis and is deliberately kept out of the measurement
  // set the engine intersects on — it selects a length band, it is not
  // a circumference.
  const result = useMemo(() => {
    if (!activeFinder?.inApp || !variant) return null;
    const { __length, ...circumferences } = m;
    return sizeGarment(activeFinder.key, variant, circumferences, { colour, length: __length });
  }, [activeFinder, variant, m, colour]);

  return (
    <div style={{ background: '#EFF6FF', border: '1px solid #3B82F6', borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1E40AF', textTransform: 'uppercase', letterSpacing: 0.4 }}>Garment Sizing</div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 3 }}>
            Measure with the Sigvaris size finder, then record the size and item number here so a re-order does not start from scratch.
          </div>
        </div>
        <a href={SIZE_FINDER_INDEX} target="_blank" rel="noreferrer"
          style={{ ...ghostBtn, textDecoration: 'none', display: 'inline-block', whiteSpace: 'nowrap' }}>
          All size finders {'↗'}
        </a>
      </div>

      {/* Only the finders that apply to the limb on this order. Offering
          an arm calculator on an LE order is how the wrong chart gets
          used. */}
      {/* A chart we can size in-app is a BUTTON — clicking it must not
          send the clinician out of the order form, which is the whole
          point of porting it. A chart we cannot size yet is a link to
          the published finder, because that is genuinely where the
          answer still lives. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {finders.map(f => {
          const on = value.size_tool === f.key;
          const chip = {
            fontSize: 11, fontWeight: 600, textDecoration: 'none', cursor: 'pointer',
            color: on ? '#fff' : '#1E40AF',
            background: on ? '#1E40AF' : 'var(--card-bg)',
            border: '1px solid #93C5FD', borderRadius: 999, padding: '4px 11px',
          };
          return f.inApp ? (
            <button key={f.key} type="button" title={f.blurb}
              onClick={() => { onChange({ size_tool: f.key }); setOpen(true); }}
              style={chip}>
              {f.label}
            </button>
          ) : (
            <a key={f.key} href={f.url} target="_blank" rel="noreferrer" title={`${f.blurb} — not sized in-app yet, opens the published finder`}
              onClick={() => { onChange({ size_tool: f.key }); setOpen(true); }}
              style={{ ...chip, borderStyle: 'dashed' }}>
              {f.label} {'↗'}
            </a>
          );
        })}
      </div>
      {activeFinder?.inApp && (
        <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 6 }}>
          Sized in-app.{' '}
          <a href={activeFinder.url} target="_blank" rel="noreferrer" style={{ color: '#1E40AF' }}>
            Open the published finder {'↗'}
          </a>{' '}
          to cross-check — it remains the reference until the port is verified against it.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, marginTop: 12, alignItems: 'end' }}>
        <Field label="Recommended Size">
          <input value={value.garment_size || ''} onChange={e => onChange({ garment_size: e.target.value })}
            placeholder="Medium Regular" style={inputStyle} />
        </Field>
        <Field label="Sigvaris Item # (SKU)">
          <input value={value.garment_sku || ''} onChange={e => onChange({ garment_sku: e.target.value })}
            placeholder="As shown by the size finder" style={inputStyle} />
        </Field>
        <button type="button" onClick={() => setOpen(o => !o)} style={{ ...ghostBtn, whiteSpace: 'nowrap' }}>
          {open ? 'Hide' : 'Add'} measurements
        </button>
      </div>

      {open && activeFinder && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #BFDBFE' }}>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 8 }}>
            Measuring points for {activeFinder.label}, in cm. Stored with the order so a vendor sizing dispute can be re-checked against what was measured.
          </div>

          {/* Which product within the chart. The charts differ per
              product (Pulse stops at X Large; Compreknee has three
              sizes), so this has to be picked before a size means
              anything. */}
          {activeFinder.inApp && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
              <Field label="Product">
                <select value={variant} onChange={e => setVariant(e.target.value)} style={inputStyle}>
                  <option value="">- pick one -</option>
                  {variantsFor(activeFinder.key).map(v => <option key={v.key} value={v.key}>{v.name}</option>)}
                </select>
              </Field>
              {variant && coloursFor(activeFinder.key, variant).length > 0 && (
                <Field label="Colour">
                  <select value={colour} onChange={e => setColour(e.target.value)} style={inputStyle}>
                    <option value="">- pick one -</option>
                    {coloursFor(activeFinder.key, variant).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              )}
              {variant && lengthBandsFor(activeFinder.key, variant).length > 0 && (
                <Field label={activeFinder.lengthLabel || 'Garment length (cm)'}>
                  <input type="number" step="0.1" min="0" value={m.__length ?? ''}
                    onChange={e => setMeasure('__length', e.target.value)} placeholder="cm" style={inputStyle} />
                </Field>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {activeFinder.points.map(p => (
              <Field key={p.code} label={`${p.code} — ${p.label}`}>
                <input type="number" step="0.1" min="0" value={m[p.code] ?? ''}
                  onChange={e => setMeasure(p.code, e.target.value)}
                  placeholder="cm" style={inputStyle} />
              </Field>
            ))}
          </div>

          {/* Live result. `result` is null for the two garments whose
              sizing model is not ported — those say so plainly and send
              the clinician to the published finder rather than showing a
              confident number this app cannot stand behind. */}
          {activeFinder.inApp ? (
            variant ? <SizeResult result={result} onUse={() => {
              if (result?.status === 'ok' && result.sizes.length === 1) {
                onChange({
                  garment_size: `${result.sizes[0]}${result.band ? ` ${result.band}` : ''}`,
                  ...(result.sku ? { garment_sku: result.sku } : {}),
                });
              }
            }} /> : null
          ) : (
            <div style={{ marginTop: 10, padding: '9px 12px', background: 'var(--card-bg)', border: '1px dashed #93C5FD', borderRadius: 8, fontSize: 11, color: 'var(--gray)', lineHeight: 1.5 }}>
              This garment is not sized in-app yet — it uses a different sizing model than the charts that are ported. Measure in the published finder above, then type the size and item number in. The measurements you enter here are still saved with the order.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The size finder's answer.
 *
 * The three non-'ok' states are the point of this component. The
 * original calculators refuse to name a size when the axes disagree or
 * fall off the chart, and tell the clinician to have the patient
 * professionally fitted. Rendering those refusals as prominently as a
 * successful match is what stops a wrong garment being ordered — a
 * compression garment that does not fit is, at best, a re-order six
 * weeks later.
 */
function SizeResult({ result, onUse }) {
  if (!result || result.status === 'incomplete') {
    return (
      <div style={{ marginTop: 10, padding: '9px 12px', background: 'var(--card-bg)', border: '1px dashed #93C5FD', borderRadius: 8, fontSize: 11, color: 'var(--gray)' }}>
        {result?.message || 'Enter the measurements above to see a recommended size.'}
      </div>
    );
  }
  const tone = result.status === 'ok'
    ? { fg: '#065F46', bg: '#ECFDF5', border: '#10B981' }
    : { fg: '#9C0006', bg: '#FEF2F2', border: '#DC2626' };
  const single = result.status === 'ok' && result.sizes.length === 1;

  return (
    <div style={{ marginTop: 10, padding: '10px 12px', background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: tone.fg }}>
            {result.status === 'ok' ? result.sizes.join(' or ') : 'No size recommended'}
            {result.band && result.status === 'ok' ? ` · ${result.band}` : ''}
          </div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 3, lineHeight: 1.4 }}>{result.message}</div>
          {result.sku && <div style={{ fontSize: 12, fontWeight: 700, color: tone.fg, marginTop: 4 }}>Item # {result.sku}</div>}
        </div>
        {single && (
          <button type="button" onClick={onUse} style={{ ...primaryBtn, background: '#059669', whiteSpace: 'nowrap' }}>
            Use this size
          </button>
        )}
      </div>
      {/* What each axis matched on its own — the only way a clinician can
          see WHICH measurement is the one pushing the result out of range. */}
      {Object.keys(result.perAxis || {}).length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${tone.border}33`, fontSize: 10, color: 'var(--gray)' }}>
          {Object.entries(result.perAxis).map(([axis, sizes]) => (
            <span key={axis} style={{ marginRight: 12 }}>
              <strong>{axis}</strong>: {sizes.length ? sizes.join(', ') : 'off chart'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Bulk action modal ───────────────────────────────────────────────────

/**
 * Two bulk operations, both aimed squarely at the measured backlog:
 *   'place' — 41 approved orders that each need the same vendor and the
 *             same placement date. One drawer each is 41 modals.
 *   'eta'   — 138 placed orders carrying no vendor ETA, which is why
 *             none of them can be chased.
 *
 * Writes are per-row rather than one bulk update so a single failing row
 * cannot take the batch down silently — the chunked-upsert lesson from
 * CLAUDE.md incidents 12 and 15, applied here before it bites.
 */
function BulkModal({ kind, selection, profile, onClose, onSaved }) {
  const [vendor, setVendor] = useState('');
  const [placedDate, setPlacedDate] = useState(todayStr());
  const [eta, setEta] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [progress, setProgress] = useState(null);

  const isPlace = kind === 'place';

  async function run() {
    setErr('');
    if (isPlace && !vendor.trim()) { setErr('Vendor is required. 138 orders were placed without one and none of them can be chased.'); return; }
    if (isPlace && !placedDate) { setErr('An order placed date is required.'); return; }
    if (!isPlace && !eta) { setErr('Pick the vendor ETA to apply.'); return; }

    setSaving(true);
    const failures = [];
    let done = 0;
    for (const o of selection) {
      const patch = isPlace
        ? { vendor: vendor.trim(), order_placed_date: placedDate, ...(eta ? { vendor_eta_date: eta } : {}) }
        : { vendor_eta_date: eta, ...(vendor.trim() ? { vendor: vendor.trim() } : {}) };
      const { error } = await supabase.from('garment_orders').update(patch).eq('id', o.id);
      if (error) failures.push(`${o.patient_name}: ${error.message}`);
      done++;
      setProgress(`${done} of ${selection.length}`);
    }
    logActivity({
      coordinatorId: profile?.id, coordinatorName: profile?.full_name, coordinatorRole: profile?.role,
      actionType: isPlace ? 'garment_order_placed_bulk' : 'garment_order_eta_bulk',
      actionDetail: `${selection.length - failures.length} of ${selection.length} orders updated${vendor ? ` (${vendor.trim()})` : ''}`,
      tableName: 'garment_orders',
    });
    if (isPlace) {
      // Notify per order — recipients are resolved server-side and the
      // fan-out is what tells Supply Chain the handoff happened.
      for (const o of selection) {
        await emitGarmentHandoff(o.id, 'final_approved',
          `${profile?.full_name || 'Supply Chain'} placed an order with ${vendor.trim()} for ${o.patient_name}.`);
      }
    }
    setSaving(false);
    setProgress(null);
    if (failures.length) {
      // Never report a silent success. CLAUDE.md incident 15.
      setErr(`${failures.length} of ${selection.length} failed and were NOT updated:\n` + failures.slice(0, 5).join('\n'));
      return;
    }
    onSaved();
  }

  return (
    <Modal title={isPlace ? `Place ${selection.length} Orders` : `Set Vendor ETA on ${selection.length} Orders`}
      onClose={onClose} headerBg={isPlace ? '#7C3AED' : '#0EA5E9'}>
      <div style={{ padding: 22 }}>
        <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 14, lineHeight: 1.5 }}>
          {isPlace
            ? 'Applies the same vendor and placement date to every selected order and advances each to Order Placed / In Transit. Per-order details (garment code, cost) stay editable individually afterwards.'
            : 'Applies the same expected delivery date to every selected order. Without an ETA there is no date on which an order can be called late.'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <Field label="Vendor" required={isPlace}>
            <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Sigvaris, Juzo, etc." style={inputStyle} />
          </Field>
          {isPlace && (
            <Field label="Order Placed Date" required>
              <input type="date" value={placedDate} onChange={e => setPlacedDate(e.target.value)} style={inputStyle} />
            </Field>
          )}
          <Field label={`Vendor ETA${isPlace ? ' (optional)' : ''}`} required={!isPlace}>
            <input type="date" value={eta} onChange={e => setEta(e.target.value)} style={inputStyle} />
          </Field>
        </div>
        <div style={{ marginTop: 14, maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--bg)' }}>
          {selection.map(o => (
            <div key={o.id} style={{ fontSize: 11, color: 'var(--gray)', padding: '2px 0' }}>
              {o.patient_name} · {o.limb_type} {o.order_type || ''} {o.region ? `· Region ${o.region}` : ''}
            </div>
          ))}
        </div>
        {err && <div style={{ ...errorBox, margin: '14px 0 0', whiteSpace: 'pre-wrap' }}>{err}</div>}
      </div>
      <ModalFooter>
        {progress && <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--gray)' }}>{progress}</span>}
        <button onClick={onClose} disabled={saving} style={ghostBtn}>Cancel</button>
        <button onClick={run} disabled={saving} style={{ ...primaryBtn, background: isPlace ? '#7C3AED' : '#0EA5E9' }}>
          {saving ? 'Working...' : isPlace ? 'Place Orders' : 'Set ETA'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

// ─── Detail drawer with stage advancement actions ────────────────────────

function OrderDrawer({ profile, order, health, onClose, onSaved }) {
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
    garment_size:      order.garment_size || '',
    garment_sku:       order.garment_sku || '',
    size_tool:         order.size_tool || '',
    size_measurements: order.size_measurements || null,
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
  //
  // Vendor is now REQUIRED. All 138 orders currently in transit were
  // placed without one, which is exactly why none of them can be chased:
  // the system knows an order exists but not who owes us the garment.
  function markOrderPlaced() {
    if (!form.vendor?.trim()) {
      setErr('Vendor is required. Without it nobody can chase this order — that is how 138 orders ended up in transit with no owner.');
      return;
    }
    if (!form.order_number?.trim() && !form.order_placed_date) {
      setErr('Add an order number or order placed date before marking placed.');
      return;
    }
    persist({
      vendor: form.vendor.trim(),
      order_number: form.order_number || null,
      order_placed_date: form.order_placed_date || todayStr(),
      garment_code: form.garment_code || null,
      garment_cost: form.garment_cost ? Number(form.garment_cost) : null,
      vendor_eta_date: form.vendor_eta_date || null,
      garment_size: form.garment_size || null,
      garment_sku: form.garment_sku || null,
    }, 'garment_order_placed', {
      event: 'final_approved', // reuses the existing recipient fan-out
      message: `${profile?.full_name || 'Supply Chain'} placed order #${form.order_number || '?'} with ${form.vendor.trim()} for ${order.patient_name}.`,
    });
  }

  // Stage 4 — delivery confirmed. Sets delivery_date which flips the stage to
  // 'delivered' (and eventually to 'archived' 14 days later via the view).
  function markDelivered() {
    if (!form.delivery_date) {
      setErr('Add a delivery date to mark delivered.');
      return;
    }
    if (form.delivery_date > todayStr()) {
      setErr('Delivery date is in the future. Record the ETA in Vendor ETA instead.');
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
    // Cancelling is a workflow-destroying action and had no confirmation.
    if (!window.confirm(`Cancel the ${order.limb_type} garment order for ${order.patient_name}? It leaves the active board and both approvals are voided.`)) return;
    persist({
      final_approval_status: 'cancelled',
      clinical_approval_status: order.clinical_approval_status === 'pending' ? 'cancelled' : order.clinical_approval_status,
    }, 'garment_order_cancelled', { event: 'cancelled', message: `Order for ${order.patient_name} was cancelled.` });
  }
  function saveAll()    { persist(form, 'garment_order_updated'); }

  const isFinalApprover = canFinalApprove(profile);
  const st = STAGE_MAP[order.stage] || STAGE_MAP.submitted;
  const hs = healthStyle(health?.health);
  const cd = order.clinical_details || {};

  return (
    <Modal title={`${order.patient_name}  -  ${order.limb_type} ${order.order_type || ''}`} onClose={onClose} headerBg={st.color} wide>
      <div style={{ padding: 22 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: st.color, padding: '3px 10px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.4 }}>{st.label}</span>
          <span title={health?.isFloor
              ? `Upper bound. The timestamp for this stage was never recorded, so this is measured from ${health.basis?.replace(/_/g, ' ')} and the true age is at most this.`
              : `Measured from ${health?.basis?.replace(/_/g, ' ') || 'unknown'}`}
            style={{ fontSize: 11, fontWeight: 700, color: hs.fg, background: hs.bg, border: `1px solid ${hs.border}`, padding: '3px 10px', borderRadius: 999 }}>
            {formatAge(health)} in stage{health?.sla ? ` · target ${health.sla}d` : ''}{health?.overBy ? ` · ${health.overBy}d over` : ''}
          </span>
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
          <Detail label="Size" value={order.garment_size} />
          <Detail label="Item # (SKU)" value={order.garment_sku} />
          <Detail label="Vendor" value={order.vendor} />
        </div>

        <Timeline order={order} />

        {/* Stage 1 — clinical approval by the evaluating PT/OT */}
        {order.clinical_approval_status === 'pending' && (
          <div style={{ marginBottom: 16, padding: 14, background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#9C5700', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>Stage 1 — Clinical Approval</div>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 8 }}>
              For {order.clinical_approver_name || order.approver_name || 'the evaluating PT/OT'} to sign off on the clinical need. Target: {STAGE_SLA_DAYS.submitted} days.
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

        {/* Stage 2 — final approval, role-gated to admin/super_admin */}
        {order.clinical_approval_status === 'approved' && order.final_approval_status === 'pending' && (
          <div style={{ marginBottom: 16, padding: 14, background: '#FEF3C7', border: '1px solid #D97706', borderRadius: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>Stage 2 — Final Approval</div>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 8 }}>
              Admin or super-admin sign-off. This is what triggers placing the order. Target: {STAGE_SLA_DAYS.auth_pending} days.
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

        {/* Sizing, editable from any pre-delivery stage. Supply Chain
            frequently learns the final size at order time, not request time. */}
        {!TERMINAL_STAGES.includes(order.stage) && (
          <div style={{ marginBottom: 16 }}>
            <SizeFinderPanel
              limb={order.limb_type}
              value={{ garment_size: form.garment_size, garment_sku: form.garment_sku, size_tool: form.size_tool, size_measurements: form.size_measurements }}
              onChange={patch => setForm(f => ({ ...f, ...patch }))}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={() => persist({
                garment_size: form.garment_size || null,
                garment_sku: form.garment_sku || null,
                size_tool: form.size_tool || null,
                size_measurements: form.size_measurements,
                sized_at: new Date().toISOString(),
                sized_by: profile?.id || null,
                sized_by_name: profile?.full_name || null,
              }, 'garment_order_sized')} disabled={saving} style={{ ...primaryBtn, background: '#1E40AF' }}>
                {saving ? 'Saving...' : 'Save Sizing'}
              </button>
            </div>
          </div>
        )}

        {/* Ready to Order — Supply Chain Manager records that the order was placed
            with the vendor. Role-gated to admin/super_admin (the SCM role). */}
        {order.stage === 'ready_to_order' && (
          <div style={{ marginBottom: 16, padding: 14, background: '#ECFDF5', border: '1px solid #10B981', borderRadius: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#065F46', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>Supply Chain — Place Order</div>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 10 }}>
              Record the vendor order number, code, and cost. Saving advances the order to <strong>Order Placed / In Transit</strong>. Target: {STAGE_SLA_DAYS.ready_to_order} days in this stage.
            </div>
            {isFinalApprover ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  <Field label="Vendor" required><input value={form.vendor} onChange={e => set('vendor', e.target.value)} placeholder="Sigvaris, Juzo, etc." style={inputStyle} /></Field>
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
              {!order.vendor_eta_date && ' No vendor ETA is recorded on this order, so nothing can tell whether it is late — set one below.'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <Field label="Vendor"><input value={form.vendor} onChange={e => set('vendor', e.target.value)} placeholder="Sigvaris, Juzo, etc." style={inputStyle} /></Field>
              <Field label="Vendor ETA"><input type="date" value={form.vendor_eta_date} onChange={e => set('vendor_eta_date', e.target.value)} style={inputStyle} /></Field>
              <Field label="Tracking Number"><input value={form.tracking_number} onChange={e => set('tracking_number', e.target.value)} style={inputStyle} /></Field>
              <Field label="Carrier"><input value={form.carrier} onChange={e => set('carrier', e.target.value)} placeholder="UPS / FedEx / etc." style={inputStyle} /></Field>
              <Field label="Delivery Date"><input type="date" max={todayStr()} value={form.delivery_date} onChange={e => set('delivery_date', e.target.value)} style={inputStyle} /></Field>
              <Field label="POD / Proof URL"><input value={form.delivery_proof_url} onChange={e => set('delivery_proof_url', e.target.value)} placeholder="Photo / signed POD link" style={inputStyle} /></Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, gap: 8 }}>
              <button onClick={saveAll} disabled={saving} style={{ ...ghostBtn }}>Save Tracking</button>
              <button onClick={markDelivered} disabled={saving} style={{ ...primaryBtn, background: '#059669' }}>{saving ? 'Working...' : 'Mark Delivered'}</button>
            </div>
          </div>
        )}

        {/* Cancel + utility row — available on every non-terminal stage. */}
        {!TERMINAL_STAGES.includes(order.stage) && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button onClick={cancelOrder} disabled={saving} style={{ ...ghostBtn, color: '#9C0006', borderColor: '#FECACA' }}>Cancel Order</button>
          </div>
        )}

        {/* Read-only details for terminal / closed states */}
        {TERMINAL_STAGES.includes(order.stage) && (
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
            {order.size_measurements && Object.keys(order.size_measurements).length > 0 && (
              <div style={{ marginTop: 8 }}>
                <strong style={{ color: 'var(--gray)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, display: 'block' }}>Measurements (cm)</strong>
                <span>{Object.entries(order.size_measurements).map(([k, v]) => `${k} ${v}`).join(' · ')}</span>
                {order.sized_by_name && <span style={{ color: 'var(--gray)' }}> — {order.sized_by_name}{order.sized_at ? `, ${fmtDate(order.sized_at)}` : ''}</span>}
              </div>
            )}
            {order.order_form_url && (
              <div style={{ marginTop: 8 }}>
                <a href={order.order_form_url} target="_blank" rel="noreferrer" style={{ color: EC.teal, fontWeight: 600 }}>Open completed order form {'↗'}</a>
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

/**
 * Approval history as one vertical run instead of three coloured banners
 * scattered down the drawer. Every timestamp already existed; it was
 * just never presented as a sequence, so "how long did this actually
 * take" could not be read off the screen.
 *
 * Steps whose timestamp is missing render as "date not recorded" rather
 * than being hidden — on the 217 imported orders that is the honest
 * answer, and hiding the step would make an approval that did happen
 * look like it never did.
 */
function Timeline({ order }) {
  const steps = [
    { label: 'Requested',        at: order.field_request_date || order.created_at, who: order.clinician_name, done: true },
    { label: 'Clinically approved', at: order.clinical_approval_date, who: order.clinical_approver_name || order.approver_name,
      done: order.clinical_approval_status === 'approved', note: order.clinical_approval_comments,
      failed: order.clinical_approval_status === 'denied' },
    { label: 'Final approved',   at: order.final_approval_date, who: order.final_approver_name,
      done: order.final_approval_status === 'approved', note: order.final_approval_comments,
      failed: order.final_approval_status === 'denied' },
    { label: 'Order placed',     at: order.order_placed_date, who: order.vendor ? `vendor: ${order.vendor}` : 'vendor not recorded',
      done: !!order.order_placed_date },
    { label: 'Delivered',        at: order.delivery_date, who: order.carrier || null, done: !!order.delivery_date },
  ];
  return (
    <div style={{ marginBottom: 16, padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>History</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((s, i) => {
          const color = s.failed ? '#DC2626' : s.done ? '#059669' : '#CBD5E1';
          return (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ width: 9, height: 9, borderRadius: 999, background: color, marginTop: 4, flexShrink: 0, border: `2px solid ${color}` }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: s.done || s.failed ? 'var(--black)' : 'var(--gray)' }}>
                  {s.failed ? s.label.replace('approved', 'denied') : s.label}
                  <span style={{ fontWeight: 400, color: 'var(--gray)', marginLeft: 8, fontSize: 11 }}>
                    {s.at ? fmtDate(s.at) : (s.done || s.failed) ? 'date not recorded' : 'pending'}
                    {s.who ? ` · ${s.who}` : ''}
                  </span>
                </div>
                {s.note && <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{s.note}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
  // Escape closes, which is what every other modal in the product does
  // and what people reach for before hunting the X.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--card-bg)', borderRadius: 14, width: '100%', maxWidth: wide ? 980 : 760, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '14px 22px', background: headerBg, borderRadius: '14px 14px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer' }}>{'×'}</button>
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
