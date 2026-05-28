// AuthPendingCoveragePage.jsx
//
// Highest-volume work surface in the Auth Command Center (175 patients
// as of 2026-05-27). Surfaces every active-census patient who does NOT
// have an authorization actively covering them today, split by why:
//
//   never_had_auth        - no auth_tracker row exists
//   pending_not_submitted - request started, never sent to payer
//   submitted_no_response - sent to payer, no approval yet
//   expired_no_renewal    - prior auth lapsed, no successor
//
// Default sort: days_since_last_visit ASC. The most actively-being-seen
// patients without coverage are the biggest billing risk and surface first.
//
// Backed by v_auth_pending_coverage view.

import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

const STATE_TIERS = {
  never_had_auth:        { label: 'Never had auth',           color: '#7F1D1D', bg: '#FEE2E2', border: '#FCA5A5' },
  pending_not_submitted: { label: 'Started, not submitted',   color: '#9A3412', bg: '#FFEDD5', border: '#FDBA74' },
  submitted_no_response: { label: 'Submitted, no response',   color: '#92400E', bg: '#FEF3C7', border: '#FDE68A' },
  expired_no_renewal:    { label: 'Expired, no renewal',      color: '#1E40AF', bg: '#DBEAFE', border: '#93C5FD' },
  other:                 { label: 'Other',                     color: '#6B7280', bg: '#F3F4F6', border: '#E5E7EB' },
};

function tier(s) { return STATE_TIERS[s] || STATE_TIERS.other; }

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
        color: active ? '#fff' : '#6B7280' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'DM Mono, monospace',
        color: active ? '#fff' : color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: active ? '#fff' : '#6B7280' }}>{sub}</div>}
    </button>
  );
}

export default function AuthPendingCoveragePage({ intent }) {
  const regionScope = useAssignedRegions();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState(intent?.state || 'ALL');
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [searchQ, setSearchQ] = useState('');
  const [sortKey, setSortKey] = useState('days_since_visit_asc');

  async function load() {
    setLoading(true);
    let q = supabase.from('v_auth_pending_coverage').select('*');
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

  // Listen to underlying tables for changes
  useRealtimeTable(['auth_tracker','census_data'], load);

  const stats = useMemo(() => ({
    total: rows.length,
    never: rows.filter(r => r.pending_state === 'never_had_auth').length,
    pendingNotSubmitted: rows.filter(r => r.pending_state === 'pending_not_submitted').length,
    submittedNoResponse: rows.filter(r => r.pending_state === 'submitted_no_response').length,
    expired: rows.filter(r => r.pending_state === 'expired_no_renewal').length,
  }), [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (filterState !== 'ALL') out = out.filter(r => r.pending_state === filterState);
    if (filterRegion !== 'ALL') out = out.filter(r => r.region === filterRegion);
    if (searchQ) {
      const q = searchQ.toLowerCase();
      out = out.filter(r =>
        (r.patient_name || '').toLowerCase().includes(q) ||
        (r.insurance || '').toLowerCase().includes(q)
      );
    }
    out = [...out];
    if (sortKey === 'days_since_visit_asc') {
      out.sort((a, b) => (a.days_since_last_visit ?? 9999) - (b.days_since_last_visit ?? 9999));
    } else if (sortKey === 'days_in_state_desc') {
      out.sort((a, b) => (b.days_in_state ?? -1) - (a.days_in_state ?? -1));
    } else if (sortKey === 'name') {
      out.sort((a, b) => (a.patient_name || '').localeCompare(b.patient_name || ''));
    }
    return out;
  }, [rows, filterState, filterRegion, searchQ, sortKey]);

  function exportXlsx() {
    const data = filtered.map(r => ({
      'Patient': r.patient_name,
      'Region': r.region || '',
      'Insurance': r.insurance || '',
      'Census Status': r.census_status || '',
      'State': tier(r.pending_state).label,
      'Days In State': r.days_in_state ?? '',
      'Last Visit': r.last_visit_date || '',
      'Days Since Last Visit': r.days_since_last_visit ?? '',
      'Last Clinician': r.last_visit_clinician || '',
      'Latest Auth Status': r.latest_auth_status || '',
      'Latest Auth Submitted': r.auth_submitted_date || '',
      'Latest Auth Expiry': r.latest_auth_expiry || '',
      'Assigned To': r.latest_auth_assigned_to || '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'PendingCoverage');
    XLSX.writeFile(wb, `auth_pending_coverage_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  if (regionScope.loading || loading) {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
        <TopBar title="Auth Pending — No Coverage" subtitle="Loading..." />
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#6B7280' }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Auth Pending — No Coverage"
        subtitle={`${stats.total} active-census patients with no authorization actively covering them${'·'.length ? ' · sorted by most-actively-seen first' : ''}`} />

      <div style={{ padding:'10px 20px', background:'#FEF3C7', borderBottom:'1px solid #FDE68A', fontSize:12, color:'#92400E' }}>
        These patients are being scheduled and seen but have no active authorization on file. Each visit is billing risk until an auth is in place. Default sort: most-actively-seen first.
      </div>

      <div style={{ flex:1, overflow:'auto' }}>
        {/* KPI tiles - clickable filters */}
        <div style={{ padding:'16px 20px 12px', display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:10 }}>
          <Tile label="Total" value={stats.total} color="#7F1D1D" bg="#FEE2E2"
            sub="needing coverage"
            active={filterState === 'ALL'} onClick={() => setFilterState('ALL')} />
          <Tile label="Never Had Auth" value={stats.never} color="#7F1D1D" bg="#FEE2E2"
            sub="intake handoff backlog"
            active={filterState === 'never_had_auth'} onClick={() => setFilterState('never_had_auth')} />
          <Tile label="Started, Not Submitted" value={stats.pendingNotSubmitted} color="#9A3412" bg="#FFEDD5"
            sub="coordinator started, didn't send"
            active={filterState === 'pending_not_submitted'} onClick={() => setFilterState('pending_not_submitted')} />
          <Tile label="Submitted, No Response" value={stats.submittedNoResponse} color="#92400E" bg="#FEF3C7"
            sub="follow up with payer"
            active={filterState === 'submitted_no_response'} onClick={() => setFilterState('submitted_no_response')} />
          <Tile label="Expired, No Renewal" value={stats.expired} color="#1E40AF" bg="#DBEAFE"
            sub="prior auth lapsed"
            active={filterState === 'expired_no_renewal'} onClick={() => setFilterState('expired_no_renewal')} />
        </div>

        {/* Filter controls */}
        <div style={{ padding:'0 20px 12px', display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="Search patient or insurance..."
            style={{ padding:'7px 10px', border:'1px solid #E5E7EB', borderRadius:6, fontSize:12, outline:'none', background:'#fff', width:260 }} />
          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
            style={{ padding:'7px 10px', border:'1px solid #E5E7EB', borderRadius:6, fontSize:12, outline:'none', background:'#fff' }}>
            <option value="ALL">All Regions</option>
            {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
          </select>
          <select value={sortKey} onChange={e => setSortKey(e.target.value)}
            style={{ padding:'7px 10px', border:'1px solid #E5E7EB', borderRadius:6, fontSize:12, outline:'none', background:'#fff' }}>
            <option value="days_since_visit_asc">Sort: Recently seen (most active first)</option>
            <option value="days_in_state_desc">Sort: Stuck longest in state</option>
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
              gridTemplateColumns:'minmax(180px, 1.6fr) 50px 110px 170px 90px 100px 100px 1fr',
              gap:0, background:'#F9FAFB', padding:'10px 14px',
              fontSize:10, fontWeight:700, color:'#6B7280', textTransform:'uppercase', letterSpacing:'0.05em',
              borderBottom:'1px solid #E5E7EB',
            }}>
              <div>Patient</div>
              <div>Rgn</div>
              <div>Insurance</div>
              <div>State</div>
              <div>Days Stuck</div>
              <div>Last Visit</div>
              <div>Days Since</div>
              <div>Last Clinician</div>
            </div>
            {filtered.length === 0 && (
              <div style={{ padding:40, textAlign:'center', color:'#9CA3AF', fontSize:13 }}>
                No patients match the current filters.
              </div>
            )}
            {filtered.map((r, idx) => {
              const s = tier(r.pending_state);
              return (
                <div key={r.patient_name + (r.latest_auth_id || '')} style={{
                  display:'grid',
                  gridTemplateColumns:'minmax(180px, 1.6fr) 50px 110px 170px 90px 100px 100px 1fr',
                  gap:0, padding:'10px 14px', fontSize:12, color:'#1F2937',
                  borderBottom: idx < filtered.length - 1 ? '1px solid #F3F4F6' : 'none',
                  background: idx % 2 === 0 ? '#fff' : '#FAFAFA',
                }}>
                  <div style={{ fontWeight:600 }}>{r.patient_name}</div>
                  <div style={{ fontFamily:'DM Mono, monospace', fontWeight:700 }}>{r.region || '-'}</div>
                  <div style={{ color:'#6B7280' }}>{r.insurance || '-'}</div>
                  <div>
                    <span style={{
                      fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:999,
                      color: s.color, background: s.bg, border:`1px solid ${s.border}`,
                      whiteSpace:'nowrap', textTransform:'uppercase', letterSpacing:'0.04em',
                    }}>{s.label}</span>
                  </div>
                  <div style={{ fontFamily:'DM Mono, monospace', fontWeight:700, color: (r.days_in_state ?? 0) > 30 ? '#DC2626' : '#6B7280' }}>
                    {r.days_in_state != null ? r.days_in_state + 'd' : '-'}
                  </div>
                  <div style={{ color:'#6B7280' }}>{fmtDate(r.last_visit_date)}</div>
                  <div style={{ fontFamily:'DM Mono, monospace', fontWeight:600,
                    color: (r.days_since_last_visit ?? 0) < 7 ? '#7F1D1D' : '#6B7280' }}>
                    {r.days_since_last_visit != null ? r.days_since_last_visit + 'd' : '-'}
                  </div>
                  <div style={{ color:'#6B7280', fontSize:11 }}>{r.last_visit_clinician || '-'}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
