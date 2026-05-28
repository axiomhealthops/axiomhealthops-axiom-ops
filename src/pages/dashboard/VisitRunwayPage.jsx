// VisitRunwayPage.jsx
//
// Visit-runway triage for active authorizations. Buckets:
//   <3 visits left   (URGENT)
//   3-6 visits left  (HIGH)
//   7-13 visits left (WATCH)
//   over_limit       (CRITICAL — distinct page exists but surfaced for context)
//
// Within each bucket, sorts by days_to_exhaust ASC. Days_to_exhaust is
// derived from the patient's visit cadence (visits/week in the last 30
// days) and remaining visit count. Approximate but useful for ranking.

import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

const BUCKETS = [
  { key: 'lt3',     label: '< 3 visits',  color: '#7F1D1D', bg: '#FEE2E2', border: '#FCA5A5', min: 0, max: 2 },
  { key: 'b3to6',   label: '3 - 6 visits', color: '#9A3412', bg: '#FFEDD5', border: '#FDBA74', min: 3, max: 6 },
  { key: 'b7to13',  label: '7 - 13 visits', color: '#92400E', bg: '#FEF3C7', border: '#FDE68A', min: 7, max: 13 },
];

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function bucketOf(remaining) {
  if (remaining < 3)  return 'lt3';
  if (remaining < 7)  return 'b3to6';
  if (remaining < 14) return 'b7to13';
  return null;
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

export default function VisitRunwayPage({ intent }) {
  const regionScope = useAssignedRegions();
  const [rows, setRows] = useState([]);
  const [visitsByPatient, setVisitsByPatient] = useState({});
  const [loading, setLoading] = useState(true);
  const [filterBucket, setFilterBucket] = useState(intent?.bucket || 'ALL');
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [searchQ, setSearchQ] = useState('');

  async function load() {
    setLoading(true);
    // Auths in low_visits state (also include over_limit for context, filtered out in default view)
    let q = supabase.from('auth_tracker').select('*')
      .in('auth_health', ['low_visits','over_limit'])
      .eq('is_currently_active', true);
    if (!regionScope.isAllAccess) q = regionScope.applyToQuery(q);
    const auths = await fetchAllPages(q);

    // Visit cadence (last 30d) for days_to_exhaust estimate
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0,10);
    const visits = await fetchAllPages(
      supabase.from('visit_schedule_data')
        .select('patient_name, visit_date, status, event_type')
        .gte('visit_date', thirtyDaysAgo)
    );
    const counts = {};
    (visits || []).forEach(v => {
      if (!/completed/i.test(v.status || '')) return;
      if (/cancel|eval|reassess|recert/i.test(v.event_type || '')) return;
      const k = (v.patient_name || '').toLowerCase().trim();
      const dk = v.visit_date;
      if (!counts[k]) counts[k] = new Set();
      counts[k].add(dk);
    });
    const cadence = {};
    Object.keys(counts).forEach(k => {
      cadence[k] = counts[k].size / 30; // visits per day
    });

    setRows(auths || []);
    setVisitsByPatient(cadence);
    setLoading(false);
  }

  useEffect(() => {
    if (regionScope.loading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionScope.loading, regionScope.isAllAccess, JSON.stringify(regionScope.regions)]);

  useRealtimeTable(['auth_tracker'], load);

  const enriched = useMemo(() => rows.map(r => {
    const rem = Math.max(0, (r.visits_authorized || 0) - (r.visits_used || 0));
    const cadence = visitsByPatient[(r.patient_name || '').toLowerCase().trim()] || 0;
    const daysToExhaust = cadence > 0 ? Math.round(rem / cadence) : null;
    return { ...r, remaining: rem, days_to_exhaust: daysToExhaust, bucket: bucketOf(rem) };
  }), [rows, visitsByPatient]);

  const stats = useMemo(() => ({
    total: enriched.filter(r => r.bucket).length,
    lt3:   enriched.filter(r => r.bucket === 'lt3').length,
    b3to6: enriched.filter(r => r.bucket === 'b3to6').length,
    b7to13: enriched.filter(r => r.bucket === 'b7to13').length,
    overLimit: enriched.filter(r => r.auth_health === 'over_limit').length,
  }), [enriched]);

  const filtered = useMemo(() => {
    let out = enriched.filter(r => r.bucket); // only low_visits, not over_limit (separate page)
    if (filterBucket !== 'ALL') out = out.filter(r => r.bucket === filterBucket);
    if (filterRegion !== 'ALL') out = out.filter(r => r.region === filterRegion);
    if (searchQ) {
      const q = searchQ.toLowerCase();
      out = out.filter(r =>
        (r.patient_name || '').toLowerCase().includes(q) ||
        (r.insurance || '').toLowerCase().includes(q)
      );
    }
    // Within each bucket sort by days_to_exhaust ASC (most-urgent first)
    out.sort((a, b) => {
      const bucketRank = (k) => BUCKETS.findIndex(x => x.key === k);
      const ba = bucketRank(a.bucket);
      const bb = bucketRank(b.bucket);
      if (ba !== bb) return ba - bb;
      const da = a.days_to_exhaust ?? 9999;
      const db = b.days_to_exhaust ?? 9999;
      return da - db;
    });
    return out;
  }, [enriched, filterBucket, filterRegion, searchQ]);

  function exportXlsx() {
    const data = filtered.map(r => ({
      'Patient': r.patient_name,
      'Region': r.region || '',
      'Insurance': r.insurance || '',
      'Visits Authorized': r.visits_authorized,
      'Visits Used': r.visits_used,
      'Remaining': r.remaining,
      'Bucket': BUCKETS.find(b => b.key === r.bucket)?.label || '',
      'Days to Exhaust (est)': r.days_to_exhaust ?? '',
      'Auth Expiry': r.auth_expiry_date || '',
      'Assigned To': r.assigned_to || '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'VisitRunway');
    XLSX.writeFile(wb, `visit_runway_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  if (regionScope.loading || loading) {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
        <TopBar title="Visit Runway" subtitle="Loading..." />
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#6B7280' }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Visit Runway"
        subtitle={`${stats.total} active auths with < 14 visits remaining ${'·'} bucketed by urgency ${'·'} sorted by days-to-exhaust within each bucket`} />

      <div style={{ flex:1, overflow:'auto' }}>
        <div style={{ padding:'16px 20px 12px', display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:10 }}>
          <Tile label="All Low Runway" value={stats.total} color="#92400E" bg="#FEF3C7"
            sub="< 14 visits remaining"
            active={filterBucket === 'ALL'} onClick={() => setFilterBucket('ALL')} />
          <Tile label="< 3 visits" value={stats.lt3} color="#7F1D1D" bg="#FEE2E2"
            sub="renew NOW"
            active={filterBucket === 'lt3'} onClick={() => setFilterBucket('lt3')} />
          <Tile label="3 - 6 visits" value={stats.b3to6} color="#9A3412" bg="#FFEDD5"
            sub="renewal threshold"
            active={filterBucket === 'b3to6'} onClick={() => setFilterBucket('b3to6')} />
          <Tile label="7 - 13 visits" value={stats.b7to13} color="#92400E" bg="#FEF3C7"
            sub="watch"
            active={filterBucket === 'b7to13'} onClick={() => setFilterBucket('b7to13')} />
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
              gridTemplateColumns:'minmax(180px, 1.6fr) 50px 110px 100px 70px 70px 90px 100px 1fr',
              gap:0, background:'#F9FAFB', padding:'10px 14px',
              fontSize:10, fontWeight:700, color:'#6B7280', textTransform:'uppercase', letterSpacing:'0.05em',
              borderBottom:'1px solid #E5E7EB',
            }}>
              <div>Patient</div>
              <div>Rgn</div>
              <div>Insurance</div>
              <div>Bucket</div>
              <div>Used</div>
              <div>Left</div>
              <div>Days Out</div>
              <div>Auth Expiry</div>
              <div>Assignee</div>
            </div>
            {filtered.length === 0 && (
              <div style={{ padding:40, textAlign:'center', color:'#9CA3AF', fontSize:13 }}>
                No patients match the current filters.
              </div>
            )}
            {filtered.map((r, idx) => {
              const b = BUCKETS.find(x => x.key === r.bucket);
              return (
                <div key={r.id} style={{
                  display:'grid',
                  gridTemplateColumns:'minmax(180px, 1.6fr) 50px 110px 100px 70px 70px 90px 100px 1fr',
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
                      color: b.color, background: b.bg, border:`1px solid ${b.border}`,
                      whiteSpace:'nowrap',
                    }}>{b.label}</span>
                  </div>
                  <div style={{ fontFamily:'DM Mono, monospace' }}>{r.visits_used}</div>
                  <div style={{ fontFamily:'DM Mono, monospace', fontWeight:700, color: b.color }}>{r.remaining}</div>
                  <div style={{ fontFamily:'DM Mono, monospace', fontWeight:600,
                    color: (r.days_to_exhaust ?? 99) <= 14 ? '#7F1D1D' : '#6B7280' }}>
                    {r.days_to_exhaust != null ? '~' + r.days_to_exhaust + 'd' : '-'}
                  </div>
                  <div style={{ color:'#6B7280' }}>{fmtDate(r.auth_expiry_date)}</div>
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
