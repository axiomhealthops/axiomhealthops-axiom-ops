// StuckAuthsPage.jsx
//
// Surfaces auth_tracker rows where the coordinator started work but the
// process stalled. Two states:
//   pending_stale     — auth_status='pending', created >3d ago (never sent to payer)
//   submitted_stale   — auth_status='submitted', auth_submitted_date >7d ago (no payer response)
//
// Sorts by days-stuck descending so the most-overdue rises to the top.

import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

const STATES = {
  pending_stale:   { label: 'Started, not sent',     color: '#7F1D1D', bg: '#FEE2E2', border: '#FCA5A5' },
  submitted_stale: { label: 'Sent, no response',     color: '#9A3412', bg: '#FFEDD5', border: '#FDBA74' },
};

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

export default function StuckAuthsPage({ intent }) {
  const regionScope = useAssignedRegions();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState(intent?.state || 'ALL');
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterAssignee, setFilterAssignee] = useState('ALL');
  const [searchQ, setSearchQ] = useState('');

  async function load() {
    setLoading(true);
    let q = supabase.from('auth_tracker').select('*').in('auth_status', ['pending','submitted']);
    if (!regionScope.isAllAccess) q = regionScope.applyToQuery(q);
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

  const enriched = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    return rows.map(r => {
      const created = r.created_at ? new Date(r.created_at) : null;
      const submitted = r.auth_submitted_date ? new Date(r.auth_submitted_date + 'T00:00:00') : null;
      let stateKey = null;
      let daysStuck = null;
      if (r.auth_status === 'pending' && created) {
        daysStuck = Math.floor((today - created) / 86400000);
        if (daysStuck >= 3) stateKey = 'pending_stale';
      } else if (r.auth_status === 'submitted' && submitted) {
        daysStuck = Math.floor((today - submitted) / 86400000);
        if (daysStuck >= 7) stateKey = 'submitted_stale';
      }
      return { ...r, stuck_state: stateKey, days_stuck: daysStuck };
    }).filter(r => r.stuck_state);
  }, [rows]);

  const assignees = useMemo(
    () => [...new Set(enriched.map(r => r.assigned_to).filter(Boolean))].sort(),
    [enriched]
  );

  const stats = useMemo(() => ({
    total: enriched.length,
    pendingStale: enriched.filter(r => r.stuck_state === 'pending_stale').length,
    submittedStale: enriched.filter(r => r.stuck_state === 'submitted_stale').length,
  }), [enriched]);

  const filtered = useMemo(() => {
    let out = enriched;
    if (filterState !== 'ALL') out = out.filter(r => r.stuck_state === filterState);
    if (filterRegion !== 'ALL') out = out.filter(r => r.region === filterRegion);
    if (filterAssignee !== 'ALL') out = out.filter(r => r.assigned_to === filterAssignee);
    if (searchQ) {
      const q = searchQ.toLowerCase();
      out = out.filter(r =>
        (r.patient_name || '').toLowerCase().includes(q) ||
        (r.insurance || '').toLowerCase().includes(q)
      );
    }
    out = [...out].sort((a, b) => (b.days_stuck ?? 0) - (a.days_stuck ?? 0));
    return out;
  }, [enriched, filterState, filterRegion, filterAssignee, searchQ]);

  function exportXlsx() {
    const data = filtered.map(r => ({
      'Patient': r.patient_name,
      'Region': r.region || '',
      'Insurance': r.insurance || '',
      'State': STATES[r.stuck_state]?.label || '',
      'Days Stuck': r.days_stuck,
      'Auth Status': r.auth_status,
      'Created': r.created_at ? new Date(r.created_at).toISOString().slice(0,10) : '',
      'Submitted Date': r.auth_submitted_date || '',
      'Assigned To': r.assigned_to || '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'StuckAuths');
    XLSX.writeFile(wb, `stuck_auths_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  if (regionScope.loading || loading) {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
        <TopBar title="Stuck Auths" subtitle="Loading..." />
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#6B7280' }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Stuck Auths"
        subtitle={`${stats.total} authorizations stalled mid-process ${'·'} sorted by days-stuck descending`} />

      <div style={{ padding:'10px 20px', background:'#FFFBEB', borderBottom:'1px solid #FDE68A', fontSize:12, color:'#92400E' }}>
        Thresholds: pending status > 3 days (never sent to payer) or submitted > 7 days (no payer response). These are renewal requests the team started but didn't finish, or sent and forgot to follow up on.
      </div>

      <div style={{ flex:1, overflow:'auto' }}>
        <div style={{ padding:'16px 20px 12px', display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:10 }}>
          <Tile label="Total Stuck" value={stats.total} color="#7F1D1D" bg="#FEE2E2"
            sub="needs cleanup"
            active={filterState === 'ALL'} onClick={() => setFilterState('ALL')} />
          <Tile label="Started, Not Sent" value={stats.pendingStale} color="#7F1D1D" bg="#FEE2E2"
            sub="pending > 3d"
            active={filterState === 'pending_stale'} onClick={() => setFilterState('pending_stale')} />
          <Tile label="Sent, No Response" value={stats.submittedStale} color="#9A3412" bg="#FFEDD5"
            sub="submitted > 7d"
            active={filterState === 'submitted_stale'} onClick={() => setFilterState('submitted_stale')} />
        </div>

        <div style={{ padding:'0 20px 12px', display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="Search patient or insurance..."
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
          <div style={{ marginLeft:'auto', fontSize:11, color:'#6B7280' }}>
            Showing {filtered.length} of {stats.total}
          </div>
          <button onClick={exportXlsx}
            style={{ padding:'7px 14px', border:'1px solid #E5E7EB', background:'#fff', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer', color:'#1F2937' }}>
            Export XLSX
          </button>
        </div>

        <div style={{ padding:'0 20px 20px' }}>
          <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, overflow:'hidden' }}>
            <div style={{
              display:'grid',
              gridTemplateColumns:'minmax(180px, 1.6fr) 50px 110px 160px 90px 100px 100px 1fr',
              gap:0, background:'#F9FAFB', padding:'10px 14px',
              fontSize:10, fontWeight:700, color:'#6B7280', textTransform:'uppercase', letterSpacing:'0.05em',
              borderBottom:'1px solid #E5E7EB',
            }}>
              <div>Patient</div>
              <div>Rgn</div>
              <div>Insurance</div>
              <div>State</div>
              <div>Days Stuck</div>
              <div>Created</div>
              <div>Submitted</div>
              <div>Assignee</div>
            </div>
            {filtered.length === 0 && (
              <div style={{ padding:40, textAlign:'center', color:'#9CA3AF', fontSize:13 }}>
                No stuck auths match the current filters. Good cleanup work.
              </div>
            )}
            {filtered.map((r, idx) => {
              const s = STATES[r.stuck_state];
              return (
                <div key={r.id} style={{
                  display:'grid',
                  gridTemplateColumns:'minmax(180px, 1.6fr) 50px 110px 160px 90px 100px 100px 1fr',
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
                  <div style={{ fontFamily:'DM Mono, monospace', fontWeight:700,
                    color: (r.days_stuck ?? 0) > 14 ? '#7F1D1D' : '#9A3412' }}>
                    {r.days_stuck}d
                  </div>
                  <div style={{ color:'#6B7280', fontSize:11 }}>{r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '-'}</div>
                  <div style={{ color:'#6B7280', fontSize:11 }}>{fmtDate(r.auth_submitted_date)}</div>
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
