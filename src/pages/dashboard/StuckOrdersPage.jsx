// StuckOrdersPage.jsx
//
// Director / AD intervention surface for ahmops.com (base44) supply orders.
// Reads from v_base44_stuck_orders -- a server-side view that filters orders
// sitting past their per-stage SLA (New >1d, In Progress >3d, Ordered >7d,
// Ready for Pickup >2d).
//
// This is READ-ONLY. Clinicians create and progress orders inside ahmops.com.
// The job here is visibility + escalation. Each row has:
//   - direct "Open in ahmops.com" link (deep-link by external_id)
//   - "Email submitter" mailto with prefilled subject pulling them back to the order
//
// CLAUDE.md compliance: no inline unicode in JSX text. Sun-Sat math only if
// needed (not used here -- this page is timestamp-based, not week-based).

import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

const STAGE_STYLES = {
  'New':              { color: '#7F1D1D', bg: '#FEE2E2', label: 'New (>1d)' },
  'In Progress':      { color: '#9A3412', bg: '#FFEDD5', label: 'In Progress (>3d)' },
  'Ordered':          { color: '#92400E', bg: '#FEF3C7', label: 'Ordered (>7d)' },
  'Ready for Pickup': { color: '#1E40AF', bg: '#DBEAFE', label: 'Ready for Pickup (>2d)' },
};

const AHMOPS_BASE = 'https://ahmops.com';

function fmtDate(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Tile({ label, value, color, bg, sub, active, onClick }) {
  return (
    <button onClick={onClick}
      style={{
        background: active ? color : bg,
        border: `1px solid ${active ? color : '#E5E7EB'}`,
        borderRadius: 10, padding: '12px 14px', cursor: onClick ? 'pointer' : 'default',
        textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4,
      }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
        textTransform: 'uppercase', color: active ? '#fff' : '#6B7280' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'DM Mono, monospace',
        color: active ? '#fff' : color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: active ? '#fff' : '#6B7280' }}>{sub}</div>}
    </button>
  );
}

export default function StuckOrdersPage() {
  const regionScope = useAssignedRegions();
  const [rows, setRows] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterStage, setFilterStage] = useState('ALL');
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [searchQ, setSearchQ] = useState('');

  async function load() {
    setLoading(true);
    const [stuck, sync] = await Promise.all([
      fetchAllPages(supabase.from('v_base44_stuck_orders').select('*')),
      supabase.from('v_base44_sync_status').select('*').maybeSingle(),
    ]);
    setRows(stuck || []);
    setSyncStatus(sync?.data || null);
    setLoading(false);
  }

  useEffect(() => {
    if (regionScope.loading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionScope.loading]);

  useRealtimeTable(['base44_orders', 'base44_sync_runs'], load);

  const regions = useMemo(
    () => [...new Set(rows.map(r => r.region).filter(Boolean))].sort(),
    [rows]
  );

  const scoped = useMemo(() => {
    let out = rows;
    if (!regionScope.isAllAccess && regionScope.regions?.length > 0) {
      out = out.filter(r => !r.region || regionScope.regions.includes(r.region));
    }
    return out;
  }, [rows, regionScope.isAllAccess, regionScope.regions]);

  const stats = useMemo(() => {
    const byStage = { 'New': 0, 'In Progress': 0, 'Ordered': 0, 'Ready for Pickup': 0 };
    for (const r of scoped) {
      if (byStage[r.status] !== undefined) byStage[r.status]++;
    }
    return { total: scoped.length, byStage };
  }, [scoped]);

  const filtered = useMemo(() => {
    let out = scoped;
    if (filterStage !== 'ALL') out = out.filter(r => r.status === filterStage);
    if (filterRegion !== 'ALL') out = out.filter(r => r.region === filterRegion);
    if (searchQ) {
      const q = searchQ.toLowerCase();
      out = out.filter(r =>
        (r.patient_name || '').toLowerCase().includes(q) ||
        (r.submitted_by_name || '').toLowerCase().includes(q) ||
        (r.external_id || '').toLowerCase().includes(q)
      );
    }
    return out;
  }, [scoped, filterStage, filterRegion, searchQ]);

  function exportXlsx() {
    const data = filtered.map(r => ({
      'Order ID':       r.external_id,
      'Status':         r.status,
      'Region':         r.region || '',
      'Hub':            r.fulfillment_hub || '',
      'Submitter':      r.submitted_by_name || '',
      'Patient':        r.patient_name || '',
      'Days in Status': r.days_in_status,
      'Days Overdue':   r.days_overdue,
      'Created':        r.created_at_base44 ? new Date(r.created_at_base44).toISOString().slice(0, 10) : '',
      'Last Change':    r.last_status_change_at ? new Date(r.last_status_change_at).toISOString().slice(0, 10) : '',
      'ahmops link':    `${AHMOPS_BASE}/order/${r.external_id}`,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'StuckOrders');
    XLSX.writeFile(wb, `stuck_orders_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function syncFreshness() {
    if (!syncStatus?.last_successful_sync_at) return { label: 'No successful sync yet', color: '#7F1D1D', bg: '#FEE2E2' };
    const mins = Math.floor((Date.now() - new Date(syncStatus.last_successful_sync_at).getTime()) / 60000);
    if (mins < 60) return { label: 'Synced ' + mins + 'm ago', color: '#065F46', bg: '#D1FAE5' };
    const hrs = Math.floor(mins / 60);
    if (hrs < 6)  return { label: 'Synced ' + hrs + 'h ago',  color: '#92400E', bg: '#FEF3C7' };
    return { label: 'Stale: synced ' + hrs + 'h ago', color: '#7F1D1D', bg: '#FEE2E2' };
  }

  if (regionScope.loading || loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <TopBar title="Stuck Orders" subtitle="Loading from ahmops.com mirror..." />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280' }}>
          Loading...
        </div>
      </div>
    );
  }

  const fresh = syncFreshness();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Stuck Orders"
        subtitle={`${stats.total} orders past per-stage SLA from ahmops.com ${'·'} sorted by days overdue`} />

      {/* Sync status strip */}
      <div style={{
        padding: '8px 20px', background: fresh.bg, borderBottom: '1px solid #E5E7EB',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
      }}>
        <div style={{ fontSize: 12, color: fresh.color }}>
          <strong>ahmops.com mirror:</strong> {fresh.label}
          {syncStatus?.orders_last_24h != null && (
            <span style={{ marginLeft: 16 }}>
              {syncStatus.orders_last_24h} new orders in last 24h {'·'} {syncStatus.open_orders} open total
            </span>
          )}
        </div>
        {syncStatus?.last_error_message && (
          <span style={{ fontSize: 11, color: '#7F1D1D', background: '#FEE2E2',
            padding: '3px 8px', borderRadius: 999, fontWeight: 600 }}>
            Last error: {syncStatus.last_error_message.slice(0, 80)}
          </span>
        )}
      </div>

      {/* Source-of-truth banner */}
      <div style={{ padding: '8px 20px', background: '#EFF6FF', borderBottom: '1px solid #BFDBFE',
        fontSize: 11, color: '#1E40AF' }}>
        Read-only view. Clinicians create and progress orders in ahmops.com. Open the order there to act.
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ padding: '16px 20px 12px',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <Tile label="All Stuck" value={stats.total} color="#7F1D1D" bg="#FEE2E2"
            sub="needs attention"
            active={filterStage === 'ALL'} onClick={() => setFilterStage('ALL')} />
          {Object.entries(STAGE_STYLES).map(([stage, s]) => (
            <Tile key={stage} label={s.label} value={stats.byStage[stage]}
              color={s.color} bg={s.bg} sub="past SLA"
              active={filterStage === stage} onClick={() => setFilterStage(stage)} />
          ))}
        </div>

        {/* Filter bar */}
        <div style={{ padding: '0 20px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="Search patient, submitter, or order id..."
            style={{ flex: '1 1 240px', padding: '8px 12px', border: '1px solid #E5E7EB',
              borderRadius: 6, fontSize: 13, outline: 'none' }} />
          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 13, background: '#fff' }}>
            <option value="ALL">All regions ({regions.length})</option>
            {regions.map(r => <option key={r} value={r}>Region {r}</option>)}
          </select>
          <button onClick={exportXlsx}
            style={{ padding: '8px 14px', background: '#0F1117', color: '#fff',
              border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Export XLSX
          </button>
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#6B7280', fontSize: 13 }}>
            {stats.total === 0
              ? 'Nothing stuck. The mirror is either empty (sync not configured yet) or every order is moving on schedule.'
              : 'No orders match the current filter.'}
          </div>
        ) : (
          <div style={{ padding: '0 20px 24px' }}>
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'grid',
                gridTemplateColumns: '140px 130px 80px 1fr 150px 90px 90px 130px',
                gap: 8, padding: '10px 14px',
                background: '#F9FAFB', borderBottom: '1px solid #E5E7EB',
                fontSize: 10, fontWeight: 700, color: '#6B7280',
                textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <div>Status</div>
                <div>Hub / Region</div>
                <div>Region</div>
                <div>Submitter / Patient</div>
                <div>Created</div>
                <div>Days In</div>
                <div>Overdue</div>
                <div>Actions</div>
              </div>
              {filtered.map(r => {
                const s = STAGE_STYLES[r.status] || { color: '#374151', bg: '#F3F4F6', label: r.status };
                const mailto = r.submitted_by_email
                  ? 'mailto:' + r.submitted_by_email + '?subject=' + encodeURIComponent(
                      'Order ' + r.external_id.slice(0, 8) + ' stuck in ' + r.status + ' (' + r.days_overdue + 'd overdue)'
                    ) + '&body=' + encodeURIComponent(
                      'Hi ' + (r.submitted_by_name?.split(' ')[0] || 'team') + ',\n\n'
                      + 'Order ' + r.external_id + ' has been in status "' + r.status
                      + '" for ' + r.days_in_status + ' days. Can you take a look?\n\n'
                      + AHMOPS_BASE + '/order/' + r.external_id + '\n\nThanks,\nOps'
                    )
                  : null;
                return (
                  <div key={r.external_id} style={{ display: 'grid',
                    gridTemplateColumns: '140px 130px 80px 1fr 150px 90px 90px 130px',
                    gap: 8, padding: '10px 14px',
                    borderBottom: '1px solid #F3F4F6',
                    alignItems: 'center', fontSize: 12 }}>
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg,
                        padding: '3px 8px', borderRadius: 999 }}>{r.status}</span>
                    </div>
                    <div style={{ color: '#374151' }}>{r.fulfillment_hub || '-'}</div>
                    <div style={{ color: '#374151', fontWeight: 600 }}>{r.region || '-'}</div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{r.submitted_by_name || '(unknown)'}</div>
                      {r.patient_name && <div style={{ fontSize: 10, color: '#6B7280' }}>Patient: {r.patient_name}</div>}
                      <div style={{ fontSize: 10, color: '#9CA3AF', fontFamily: 'DM Mono, monospace' }}>
                        {r.external_id.slice(0, 8)}...
                      </div>
                    </div>
                    <div style={{ fontFamily: 'DM Mono, monospace', color: '#6B7280' }}>
                      {fmtDate(r.created_at_base44)}
                    </div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, color: '#374151' }}>
                      {r.days_in_status}d
                    </div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700,
                      color: r.days_overdue >= 7 ? '#7F1D1D' : r.days_overdue >= 3 ? '#9A3412' : '#92400E' }}>
                      +{r.days_overdue}d
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <a href={`${AHMOPS_BASE}/order/${r.external_id}`} target="_blank" rel="noopener noreferrer"
                        style={{ padding: '4px 8px', background: '#0F1117', color: '#fff',
                          textDecoration: 'none', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>
                        Open
                      </a>
                      {mailto && (
                        <a href={mailto}
                          style={{ padding: '4px 8px', background: '#F3F4F6', color: '#374151',
                            textDecoration: 'none', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>
                          Email
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
