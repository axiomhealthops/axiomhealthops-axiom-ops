// AuthOverLimitPage.jsx
//
// Triage view for the 85 (and counting) authorizations where visits_used
// has exceeded visits_authorized. Surfaced 2026-05-20 after the diagnostic
// uncovered that sync_visits_to_auth was never wired into triggers, so the
// visit counter never decremented. This page is the focused work surface
// the auth coordinators use to clean up — submit emergency renewals, or
// reconcile billing for historical over-limit predecessors.
//
// Drives off the alerts table (alert_type='auth_over_limit') so the count
// in AlertsBell stays in sync with the page. The page itself queries
// auth_tracker directly for the full detail.
//
// CLAUDE.md compliance: no inline unicode in JSX text; use ASCII or JS
// expressions for special chars.

import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function daysBetween(a, b) {
  if (!a) return null;
  const ms = new Date((b || new Date().toISOString().slice(0,10)) + 'T00:00:00')
           - new Date(a + 'T00:00:00');
  return Math.round(ms / 86400000);
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
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
        color: active ? '#fff' : '#6B7280',
      }}>{label}</div>
      <div style={{
        fontSize: 26, fontWeight: 800, fontFamily: 'DM Mono, monospace',
        color: active ? '#fff' : color, lineHeight: 1,
      }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 10, color: active ? '#fff' : '#6B7280' }}>{sub}</div>
      )}
    </button>
  );
}

export default function AuthOverLimitPage() {
  const regionScope = useAssignedRegions();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterAssignee, setFilterAssignee] = useState('ALL');
  const [filterScope, setFilterScope] = useState('active'); // 'active' | 'all'
  const [searchQ, setSearchQ] = useState('');
  const [sortKey, setSortKey] = useState('overage_desc');

  async function load() {
    setLoading(true);
    let q = supabase.from('auth_tracker').select('*').eq('auth_health', 'over_limit');
    if (!regionScope.isAllAccess) {
      q = regionScope.applyToQuery(q);
    }
    const data = await fetchAllPages(q);
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => {
    if (regionScope.loading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionScope.loading, regionScope.isAllAccess, JSON.stringify(regionScope.regions)]);

  useRealtimeTable(['auth_tracker'], load);

  const assignees = useMemo(
    () => [...new Set(rows.map(r => r.assigned_to).filter(Boolean))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    let out = rows;
    if (filterScope === 'active') out = out.filter(r => r.is_currently_active);
    if (filterRegion !== 'ALL') out = out.filter(r => r.region === filterRegion);
    if (filterAssignee !== 'ALL') out = out.filter(r => r.assigned_to === filterAssignee);
    if (searchQ) {
      const q = searchQ.toLowerCase();
      out = out.filter(r =>
        (r.patient_name || '').toLowerCase().includes(q) ||
        (r.insurance || '').toLowerCase().includes(q) ||
        (r.auth_number || '').toLowerCase().includes(q)
      );
    }
    out = [...out];
    if (sortKey === 'overage_desc') {
      out.sort((a, b) =>
        (b.visits_used - b.visits_authorized) - (a.visits_used - a.visits_authorized)
      );
    } else if (sortKey === 'expiry_asc') {
      out.sort((a, b) =>
        (a.auth_expiry_date || '9999').localeCompare(b.auth_expiry_date || '9999')
      );
    } else if (sortKey === 'name') {
      out.sort((a, b) => (a.patient_name || '').localeCompare(b.patient_name || ''));
    }
    return out;
  }, [rows, filterScope, filterRegion, filterAssignee, searchQ, sortKey]);

  const stats = useMemo(() => {
    const active = rows.filter(r => r.is_currently_active);
    const historical = rows.filter(r => !r.is_currently_active);
    const totalOverage = rows.reduce(
      (sum, r) => sum + Math.max(0, (r.visits_used || 0) - (r.visits_authorized || 0)),
      0
    );
    return {
      total: rows.length,
      active: active.length,
      historical: historical.length,
      totalOverage,
      worstOverage: rows.reduce(
        (max, r) => Math.max(max, (r.visits_used || 0) - (r.visits_authorized || 0)),
        0
      ),
    };
  }, [rows]);

  function exportXlsx() {
    const data = filtered.map(r => {
      const overage = (r.visits_used || 0) - (r.visits_authorized || 0);
      const daysPastExpiry = r.auth_expiry_date && new Date(r.auth_expiry_date) < new Date()
        ? daysBetween(r.auth_expiry_date, null) : null;
      return {
        'Patient': r.patient_name,
        'Region': r.region || '',
        'Insurance': r.insurance || '',
        'Auth Number': r.auth_number || '',
        'Status': r.is_currently_active ? 'Active' : 'Historical predecessor',
        'SOC Date': r.soc_date || '',
        'Auth Expiry': r.auth_expiry_date || '',
        'Days Past Expiry': daysPastExpiry ?? '',
        'Visits Authorized': r.visits_authorized,
        'Visits Used (actual)': r.visits_used,
        'Overage': overage,
        'Assigned To': r.assigned_to || '',
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'OverLimit');
    XLSX.writeFile(wb, `auth_over_limit_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  if (regionScope.loading || loading) {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
        <TopBar title="Auth Over Limit" subtitle="Loading..." />
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#6B7280' }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar
        title="Compliance: Over Limit"
        subtitle={`${stats.total} authorizations exceeded ${'·'} ${stats.active} active need emergency renewal ${'·'} ${stats.totalOverage} total visits beyond authorized`}
      />

      {/* 2026-05-27 audit: purpose banner so the auth team knows what this page is for */}
      <div style={{ padding:'10px 20px', background:'#FEF2F2', borderBottom:'1px solid #FECACA', fontSize:12, color:'#7F1D1D', display:'flex', gap:8, alignItems:'center' }}>
        <span style={{ fontSize:14 }}>🚨</span>
        <span><strong>Use this page when:</strong> a patient has exceeded their authorized visit count. Triage by overage size and prioritize emergency renewals. Read-only — edits happen in <em>All Authorizations</em>.</span>
      </div>

      <div style={{ flex:1, overflow:'auto' }}>
        {/* KPI tiles */}
        <div style={{ padding:'16px 20px 12px', display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:10 }}>
          <Tile label="Total Over Limit" value={stats.total}
                color="#7F1D1D" bg="#FEE2E2"
                sub="all sequences combined" />
          <Tile label="Active (urgent)" value={stats.active}
                color="#DC2626" bg="#FEF2F2"
                sub="needs emergency renewal"
                active={filterScope === 'active'}
                onClick={() => setFilterScope('active')} />
          <Tile label="Historical Predecessors" value={stats.historical}
                color="#9A3412" bg="#FFEDD5"
                sub="billing reconciliation"
                active={filterScope === 'all' && stats.historical > 0}
                onClick={() => setFilterScope('all')} />
          <Tile label="Total Overage Visits" value={stats.totalOverage}
                color="#1E40AF" bg="#DBEAFE"
                sub={`worst case: +${stats.worstOverage}`} />
        </div>

        {/* Filter controls */}
        <div style={{ padding:'0 20px 12px', display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="Search patient, insurance, or auth number..."
            style={{ padding:'7px 10px', border:'1px solid #E5E7EB', borderRadius:6, fontSize:12, outline:'none', background:'#fff', width:260 }} />
          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
            style={{ padding:'7px 10px', border:'1px solid #E5E7EB', borderRadius:6, fontSize:12, outline:'none', background:'#fff' }}>
            <option value="ALL">All Regions</option>
            {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
          </select>
          <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}
            style={{ padding:'7px 10px', border:'1px solid #E5E7EB', borderRadius:6, fontSize:12, outline:'none', background:'#fff' }}>
            <option value="ALL">All Assignees</option>
            {assignees.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filterScope} onChange={e => setFilterScope(e.target.value)}
            style={{ padding:'7px 10px', border:'1px solid #E5E7EB', borderRadius:6, fontSize:12, outline:'none', background:'#fff' }}>
            <option value="active">Active only</option>
            <option value="all">Active + Historical</option>
          </select>
          <select value={sortKey} onChange={e => setSortKey(e.target.value)}
            style={{ padding:'7px 10px', border:'1px solid #E5E7EB', borderRadius:6, fontSize:12, outline:'none', background:'#fff' }}>
            <option value="overage_desc">Sort: Overage (high to low)</option>
            <option value="expiry_asc">Sort: Auth expiry (soonest first)</option>
            <option value="name">Sort: Patient name</option>
          </select>
          <div style={{ marginLeft:'auto', fontSize:11, color:'#6B7280' }}>
            Showing {filtered.length} of {rows.length}
          </div>
          <button onClick={exportXlsx}
            style={{ padding:'7px 14px', border:'1px solid #E5E7EB', background:'#fff', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer', color:'#1F2937' }}>
            Export XLSX
          </button>
        </div>

        {/* Table */}
        <div style={{ padding:'0 20px 20px' }}>
          <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, overflow:'hidden' }}>
            <div style={{
              display:'grid',
              gridTemplateColumns:'minmax(180px, 1.6fr) 50px 100px 90px 100px 90px 80px 80px 80px 1fr',
              gap:0, background:'#F9FAFB', padding:'10px 14px',
              fontSize:10, fontWeight:700, color:'#6B7280', textTransform:'uppercase', letterSpacing:'0.05em',
              borderBottom:'1px solid #E5E7EB',
            }}>
              <div>Patient</div>
              <div>Rgn</div>
              <div>Insurance</div>
              <div>Auth #</div>
              <div>Expiry</div>
              <div>Authorized</div>
              <div>Actual</div>
              <div>Overage</div>
              <div>Status</div>
              <div>Assignee</div>
            </div>
            {filtered.length === 0 && (
              <div style={{ padding:40, textAlign:'center', color:'#9CA3AF', fontSize:13 }}>
                No over-limit authorizations match the current filters.
              </div>
            )}
            {filtered.map((r, idx) => {
              const overage = (r.visits_used || 0) - (r.visits_authorized || 0);
              return (
                <div key={r.id} style={{
                  display:'grid',
                  gridTemplateColumns:'minmax(180px, 1.6fr) 50px 100px 90px 100px 90px 80px 80px 80px 1fr',
                  gap:0, padding:'10px 14px', fontSize:12, color:'#1F2937',
                  borderBottom: idx < filtered.length - 1 ? '1px solid #F3F4F6' : 'none',
                  background: idx % 2 === 0 ? '#fff' : '#FAFAFA',
                }}>
                  <div style={{ fontWeight:600 }}>{r.patient_name}</div>
                  <div style={{ fontFamily:'DM Mono, monospace', fontWeight:700 }}>{r.region || '-'}</div>
                  <div style={{ color:'#6B7280' }}>{r.insurance || '-'}</div>
                  <div style={{ fontFamily:'DM Mono, monospace', fontSize:11, color:'#6B7280' }}>
                    {r.auth_number || '-'}
                  </div>
                  <div style={{ color:'#6B7280' }}>{fmtDate(r.auth_expiry_date)}</div>
                  <div style={{ fontFamily:'DM Mono, monospace', fontWeight:600 }}>{r.visits_authorized}</div>
                  <div style={{ fontFamily:'DM Mono, monospace', fontWeight:700, color:'#7F1D1D' }}>{r.visits_used}</div>
                  <div style={{
                    fontFamily:'DM Mono, monospace', fontWeight:800,
                    color:'#fff', background:'#DC2626', padding:'2px 8px',
                    borderRadius:999, textAlign:'center',
                  }}>
                    +{overage}
                  </div>
                  <div>
                    <span style={{
                      fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:999,
                      color: r.is_currently_active ? '#7F1D1D' : '#92400E',
                      background: r.is_currently_active ? '#FEE2E2' : '#FEF3C7',
                      border:'1px solid',
                      borderColor: r.is_currently_active ? '#FCA5A5' : '#FDE68A',
                      textTransform:'uppercase', letterSpacing:'0.04em', whiteSpace:'nowrap',
                    }}>
                      {r.is_currently_active ? 'Active' : 'Predecessor'}
                    </span>
                  </div>
                  <div style={{ color:'#6B7280', fontSize:11 }}>{r.assigned_to || '-'}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
