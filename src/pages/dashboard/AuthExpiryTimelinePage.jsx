// AuthExpiryTimelinePage.jsx
//
// Calendar/timeline view of active authorizations by expiry date. Buckets:
//   Today, This Week (1-7), Next Week (8-14), 15-30d, 30-60d, >60d, Already Expired.
//
// Lets the auth team see "what's coming up" at a glance and pre-empt the work.

import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import PatientAuthDrawer from '../../components/PatientAuthDrawer';

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

const BUCKETS = [
  { key: 'expired',    label: 'Already Expired', color: '#7F1D1D', bg: '#FEE2E2', border: '#FCA5A5',
    test: d => d < 0 },
  { key: 'today',      label: 'Today',           color: '#7F1D1D', bg: '#FEE2E2', border: '#FCA5A5',
    test: d => d === 0 },
  { key: 'this_week',  label: 'This Week (1-7d)', color: '#9A3412', bg: '#FFEDD5', border: '#FDBA74',
    test: d => d >= 1 && d <= 7 },
  { key: 'next_week',  label: 'Next Week (8-14d)', color: '#92400E', bg: '#FEF3C7', border: '#FDE68A',
    test: d => d >= 8 && d <= 14 },
  { key: 'm15to30',    label: '15 - 30 days',     color: '#1E40AF', bg: '#DBEAFE', border: '#93C5FD',
    test: d => d >= 15 && d <= 30 },
  { key: 'm30to60',    label: '30 - 60 days',     color: '#065F46', bg: '#ECFDF5', border: '#A7F3D0',
    test: d => d >= 31 && d <= 60 },
];

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function bucketOf(daysToExpiry) {
  if (daysToExpiry == null) return null;
  for (const b of BUCKETS) {
    if (b.test(daysToExpiry)) return b.key;
  }
  return null; // >60 days, not surfaced
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

export default function AuthExpiryTimelinePage({ intent }) {
  const regionScope = useAssignedRegions();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterBucket, setFilterBucket] = useState(intent?.bucket || 'ALL');
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [searchQ, setSearchQ] = useState('');
  // 2026-05-28: drawer for in-place editing.
  const [drawer, setDrawer] = useState({ open: false, authId: null, patientName: null });

  async function load() {
    setLoading(true);
    // Active auths with an expiry date in the next 60d or already expired
    const today = new Date().toISOString().slice(0,10);
    const sixtyDays = new Date(Date.now() + 60*86400000).toISOString().slice(0,10);
    let q = supabase.from('auth_tracker').select('*')
      .eq('is_currently_active', true)
      .not('auth_expiry_date', 'is', null)
      .lte('auth_expiry_date', sixtyDays);
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

  const enriched = useMemo(() => rows.map(r => {
    const today = new Date(); today.setHours(0,0,0,0);
    const expiry = r.auth_expiry_date ? new Date(r.auth_expiry_date + 'T00:00:00') : null;
    const days = expiry ? Math.round((expiry - today) / 86400000) : null;
    return { ...r, days_to_expiry: days, bucket: bucketOf(days) };
  }), [rows]);

  const stats = useMemo(() => {
    const out = { total: 0 };
    BUCKETS.forEach(b => { out[b.key] = enriched.filter(r => r.bucket === b.key).length; });
    out.total = enriched.filter(r => r.bucket).length;
    return out;
  }, [enriched]);

  const filtered = useMemo(() => {
    let out = enriched.filter(r => r.bucket);
    if (filterBucket !== 'ALL') out = out.filter(r => r.bucket === filterBucket);
    if (filterRegion !== 'ALL') out = out.filter(r => r.region === filterRegion);
    if (searchQ) {
      const q = searchQ.toLowerCase();
      out = out.filter(r =>
        (r.patient_name || '').toLowerCase().includes(q) ||
        (r.insurance || '').toLowerCase().includes(q)
      );
    }
    out.sort((a, b) => (a.days_to_expiry ?? 9999) - (b.days_to_expiry ?? 9999));
    return out;
  }, [enriched, filterBucket, filterRegion, searchQ]);

  function exportXlsx() {
    const data = filtered.map(r => ({
      'Patient': r.patient_name,
      'Region': r.region || '',
      'Insurance': r.insurance || '',
      'Auth Number': r.auth_number || '',
      'Auth Expiry': r.auth_expiry_date || '',
      'Days to Expiry': r.days_to_expiry,
      'Bucket': BUCKETS.find(b => b.key === r.bucket)?.label || '',
      'Visits Authorized': r.visits_authorized,
      'Visits Used': r.visits_used,
      'Visits Remaining': Math.max(0, (r.visits_authorized||0) - (r.visits_used||0)),
      'Assigned To': r.assigned_to || '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'ExpiryTimeline');
    XLSX.writeFile(wb, `auth_expiry_timeline_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  if (regionScope.loading || loading) {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
        <TopBar title="Auth Expiry Timeline" subtitle="Loading..." />
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#6B7280' }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Auth Expiry Timeline"
        subtitle={`${stats.total} active auths expiring in the next 60 days ${'·'} bucketed by urgency`} />

      <div style={{ flex:1, overflow:'auto' }}>
        <div style={{ padding:'16px 20px 12px', display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:10 }}>
          <Tile label="All in 60d" value={stats.total} color="#1E40AF" bg="#DBEAFE"
            active={filterBucket === 'ALL'} onClick={() => setFilterBucket('ALL')} />
          {BUCKETS.map(b => (
            <Tile key={b.key} label={b.label} value={stats[b.key]}
              color={b.color} bg={b.bg}
              active={filterBucket === b.key} onClick={() => setFilterBucket(b.key)} />
          ))}
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
              gridTemplateColumns:'minmax(180px, 1.6fr) 50px 110px 130px 100px 80px 90px 80px 1fr 40px',
              gap:0, background:'#F9FAFB', padding:'10px 14px',
              fontSize:10, fontWeight:700, color:'#6B7280', textTransform:'uppercase', letterSpacing:'0.05em',
              borderBottom:'1px solid #E5E7EB',
            }}>
              <div>Patient</div>
              <div>Rgn</div>
              <div>Insurance</div>
              <div>Bucket</div>
              <div>Expiry</div>
              <div>Days</div>
              <div>Visits Left</div>
              <div>Auth #</div>
              <div>Assignee</div>
              <div></div>
            </div>
            {filtered.length === 0 && (
              <div style={{ padding:40, textAlign:'center', color:'#9CA3AF', fontSize:13 }}>
                No patients match the current filters.
              </div>
            )}
            {filtered.map((r, idx) => {
              const b = BUCKETS.find(x => x.key === r.bucket);
              const remaining = Math.max(0, (r.visits_authorized||0) - (r.visits_used||0));
              return (
                <div key={r.id}
                  onClick={() => setDrawer({ open: true, authId: r.id, patientName: r.patient_name })}
                  title="Click to edit / submit renewal"
                  style={{
                  display:'grid',
                  gridTemplateColumns:'minmax(180px, 1.6fr) 50px 110px 130px 100px 80px 90px 80px 1fr 40px',
                  gap:0, padding:'10px 14px', fontSize:12, color:'#1F2937',
                  borderBottom: idx < filtered.length - 1 ? '1px solid #F3F4F6' : 'none',
                  background: idx % 2 === 0 ? '#fff' : '#FAFAFA',
                  cursor: 'pointer',
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#EFF6FF'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = idx % 2 === 0 ? '#fff' : '#FAFAFA'; }}>
                  <div style={{ fontWeight:600 }}>{r.patient_name}</div>
                  <div style={{ fontFamily:'DM Mono, monospace', fontWeight:700 }}>{r.region || '-'}</div>
                  <div style={{ color:'#6B7280' }}>{r.insurance || '-'}</div>
                  <div>
                    <span style={{
                      fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:999,
                      color: b.color, background: b.bg, border:`1px solid ${b.border}`,
                      whiteSpace:'nowrap',
                    }}>{b.label}</span>
                  </div>
                  <div style={{ color:'#6B7280' }}>{fmtDate(r.auth_expiry_date)}</div>
                  <div style={{ fontFamily:'DM Mono, monospace', fontWeight:700,
                    color: r.days_to_expiry < 0 ? '#7F1D1D' : r.days_to_expiry <= 7 ? '#9A3412' : '#6B7280' }}>
                    {r.days_to_expiry < 0 ? Math.abs(r.days_to_expiry) + 'd ago' : r.days_to_expiry + 'd'}
                  </div>
                  <div style={{ fontFamily:'DM Mono, monospace', fontWeight:600 }}>
                    {remaining} / {r.visits_authorized}
                  </div>
                  <div style={{ fontFamily:'DM Mono, monospace', fontSize:11, color:'#6B7280' }}>{r.auth_number || '-'}</div>
                  <div style={{ color:'#6B7280', fontSize:11 }}>{r.assigned_to || '-'}</div>
                  <div style={{ textAlign: 'right', color: '#9CA3AF', fontSize: 14 }} aria-hidden>
                    {String.fromCodePoint(0x270F)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <PatientAuthDrawer
        isOpen={drawer.open}
        authId={drawer.authId}
        patientName={drawer.patientName}
        listLabel="Auth Expiry Timeline"
        onClose={() => setDrawer({ open: false, authId: null, patientName: null })}
        onActionTaken={() => { load(); }} />
    </div>
  );
}
