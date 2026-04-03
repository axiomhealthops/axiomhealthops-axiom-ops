import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

const REGIONAL_MANAGERS = {
  A:'Uma Jacobs', B:'Lia Davis', C:'Earl Dimaano', G:'Samantha Faliks',
  H:'Kaylee Ramsey', J:'Hollie Fincher', M:'Ariel Maboudi', N:'Ariel Maboudi',
  T:'Samantha Faliks', V:'Samantha Faliks',
};

function classifyRow(row) {
  const s = (row.status || '').toLowerCase();
  const e = (row.event_type || '').toLowerCase();
  if (e.includes('cancel')) return 'Cancelled';
  if (s.includes('missed')) return 'Missed';
  return 'Other';
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function downloadCSV(rows, filename) {
  const headers = [
    'Date','Patient','Region','Manager','Clinician','Visit Type','Classification','Status','Notes'
  ];
  const lines = [headers.join(',')];
  rows.forEach(r => {
    const cls = classifyRow(r);
    lines.push([
      r.visit_date || '',
      `"${(r.patient_name||'').replace(/"/g,'""')}"`,
      r.region || '',
      `"${REGIONAL_MANAGERS[r.region]||''}"`,
      `"${(r.staff_name||'').replace(/"/g,'""')}"`,
      `"${(r.event_type||'').replace(/"/g,'""')}"`,
      cls,
      `"${(r.status||'').replace(/"/g,'""')}"`,
      `"${(r.notes||'').replace(/"/g,'""')}"`,
    ].join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  a.click(); URL.revokeObjectURL(url);
}

function downloadXLSX(rows, filename) {
  // Build a tab-separated file that Excel opens natively
  const headers = ['Date','Patient','Region','Manager','Clinician','Visit Type','Classification','Status','Notes'];
  const lines = [headers.join('\t')];
  rows.forEach(r => {
    const cls = classifyRow(r);
    lines.push([
      r.visit_date || '',
      r.patient_name || '',
      r.region || '',
      REGIONAL_MANAGERS[r.region] || '',
      r.staff_name || '',
      r.event_type || '',
      cls,
      r.status || '',
      r.notes || '',
    ].join('\t'));
  });
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  a.click(); URL.revokeObjectURL(url);
}

export default function MissedCancelledReportPage() {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterType, setFilterType] = useState('ALL');   // ALL | Missed | Cancelled
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterClinician, setFilterClinician] = useState('ALL');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [sortField, setSortField] = useState('visit_date');
  const [sortDir, setSortDir] = useState('desc');
  const { profile } = useAuth();

  useEffect(() => {
    const isRM = profile?.role === 'regional_manager';
    const myRegions = isRM ? (profile?.regions || []) : null;
    let query = supabase.from('visit_schedule_data')
      .select('*')
      .or('status.ilike.%miss%,event_type.ilike.%cancel%')
      .order('visit_date', { ascending: false });
    if (myRegions && myRegions.length > 0) query = query.in('region', myRegions);
    query.then(({ data }) => { setVisits(data || []); setLoading(false); });
  }, [profile]);

  // Derived filter options
  const clinicians = useMemo(() =>
    [...new Set(visits.map(v => v.staff_name).filter(Boolean))].sort(),
    [visits]
  );

  const filtered = useMemo(() => {
    return visits.filter(r => {
      const cls = classifyRow(r);
      if (filterType !== 'ALL' && cls !== filterType) return false;
      if (filterRegion !== 'ALL' && r.region !== filterRegion) return false;
      if (filterClinician !== 'ALL' && r.staff_name !== filterClinician) return false;
      if (filterDateFrom && r.visit_date < filterDateFrom) return false;
      if (filterDateTo && r.visit_date > filterDateTo) return false;
      if (searchQ) {
        const q = searchQ.toLowerCase();
        if (!`${r.patient_name} ${r.staff_name} ${r.event_type} ${r.notes}`.toLowerCase().includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      let av = a[sortField] || '';
      let bv = b[sortField] || '';
      if (sortDir === 'asc') return av < bv ? -1 : av > bv ? 1 : 0;
      return av > bv ? -1 : av < bv ? 1 : 0;
    });
  }, [visits, filterType, filterRegion, filterClinician, filterDateFrom, filterDateTo, searchQ, sortField, sortDir]);

  // Summary stats
  const totalMissed = filtered.filter(r => classifyRow(r) === 'Missed').length;
  const totalCancelled = filtered.filter(r => classifyRow(r) === 'Cancelled').length;
  const byRegion = REGIONS.map(r => ({
    region: r,
    missed: filtered.filter(v => v.region === r && classifyRow(v) === 'Missed').length,
    cancelled: filtered.filter(v => v.region === r && classifyRow(v) === 'Cancelled').length,
  })).filter(r => r.missed + r.cancelled > 0);

  // Clinician breakdown — top offenders
  const byClinician = [...new Map(filtered.map(v => v.staff_name).filter(Boolean).map(n => [n, {
    name: n,
    missed: filtered.filter(v => v.staff_name === n && classifyRow(v) === 'Missed').length,
    cancelled: filtered.filter(v => v.staff_name === n && classifyRow(v) === 'Cancelled').length,
    region: filtered.find(v => v.staff_name === n)?.region || '',
  }])).values()].sort((a, b) => (b.missed + b.cancelled) - (a.missed + a.cancelled)).slice(0, 10);

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  }

  function SortIcon({ field }) {
    if (sortField !== field) return <span style={{ color:'#ccc', fontSize:10 }}> ↕</span>;
    return <span style={{ color:'#1565C0', fontSize:10 }}>{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>;
  }

  const exportFilename = `Missed_Cancelled_Visits_${new Date().toISOString().slice(0,10)}`;

  const col = (label, field, flex='1', extra={}) => (
    <div style={{ flex, fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', cursor:'pointer', userSelect:'none', ...extra }}
      onClick={() => toggleSort(field)}>
      {label}<SortIcon field={field} />
    </div>
  );

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Missed & Cancelled Visits Report" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar
        title="Missed & Cancelled Visits Report"
        subtitle={`${totalMissed} missed · ${totalCancelled} cancelled · ${filtered.length} total records`}
      />
      <div style={{ flex:1, overflow:'auto' }}>

        {/* Filter bar */}
        <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', background:'var(--card-bg)', display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
          {/* Type toggle */}
          <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:7, overflow:'hidden' }}>
            {[['ALL','All Types'],['Missed','Missed'],['Cancelled','Cancelled']].map(([k,l]) => (
              <button key={k} onClick={() => setFilterType(k)}
                style={{ padding:'6px 12px', border:'none', fontSize:11, fontWeight:filterType===k?700:400, cursor:'pointer',
                  background: filterType===k ? (k==='Missed'?'#DC2626':k==='Cancelled'?'#D97706':'#0F1117') : 'var(--card-bg)',
                  color: filterType===k ? '#fff' : 'var(--gray)' }}>
                {l}
              </button>
            ))}
          </div>

          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Regions</option>
            {REGIONS.map(r => <option key={r} value={r}>Region {r} — {REGIONAL_MANAGERS[r]}</option>)}
          </select>

          <select value={filterClinician} onChange={e => setFilterClinician(e.target.value)}
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)', maxWidth:200 }}>
            <option value="ALL">All Clinicians</option>
            {clinicians.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <span style={{ fontSize:11, color:'var(--gray)' }}>From</span>
            <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
              style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }} />
            <span style={{ fontSize:11, color:'var(--gray)' }}>To</span>
            <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
              style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }} />
          </div>

          <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="Search patient, clinician…"
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)', width:180 }} />

          {(filterType !== 'ALL' || filterRegion !== 'ALL' || filterClinician !== 'ALL' || filterDateFrom || filterDateTo || searchQ) && (
            <button onClick={() => { setFilterType('ALL'); setFilterRegion('ALL'); setFilterClinician('ALL'); setFilterDateFrom(''); setFilterDateTo(''); setSearchQ(''); }}
              style={{ fontSize:11, color:'var(--gray)', background:'none', border:'1px solid var(--border)', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}>
              Clear
            </button>
          )}

          {/* Export buttons */}
          <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
            <button onClick={() => downloadCSV(filtered, exportFilename + '.csv')}
              style={{ padding:'7px 14px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, fontWeight:600, background:'var(--card-bg)', cursor:'pointer' }}>
              ⬇ CSV
            </button>
            <button onClick={() => downloadXLSX(filtered, exportFilename + '.xls')}
              style={{ padding:'7px 14px', background:'#1565C0', color:'#fff', border:'none', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer' }}>
              ⬇ Excel
            </button>
          </div>
        </div>

        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>

          {/* Summary cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 }}>
            <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#DC2626', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>❌ Missed Visits</div>
              <div style={{ fontSize:28, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#DC2626' }}>{totalMissed}</div>
              <div style={{ fontSize:11, color:'#991B1B', marginTop:3 }}>
                {filtered.length > 0 ? Math.round(totalMissed/filtered.length*100) : 0}% of filtered records
              </div>
            </div>
            <div style={{ background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#D97706', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>🚫 Cancelled Visits</div>
              <div style={{ fontSize:28, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#D97706' }}>{totalCancelled}</div>
              <div style={{ fontSize:11, color:'#92400E', marginTop:3 }}>
                {filtered.length > 0 ? Math.round(totalCancelled/filtered.length*100) : 0}% of filtered records
              </div>
            </div>
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>📅 Date Range</div>
              <div style={{ fontSize:14, fontWeight:700, color:'var(--black)', marginTop:4 }}>
                {filtered.length > 0 ? fmtDate(filtered.reduce((a,b) => a.visit_date < b.visit_date ? a : b).visit_date) : '—'}
              </div>
              <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>
                → {filtered.length > 0 ? fmtDate(filtered.reduce((a,b) => a.visit_date > b.visit_date ? a : b).visit_date) : '—'}
              </div>
            </div>
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>🏆 Most Affected Region</div>
              {byRegion.length > 0 ? (() => {
                const top = [...byRegion].sort((a,b) => (b.missed+b.cancelled)-(a.missed+a.cancelled))[0];
                return <>
                  <div style={{ fontSize:24, fontWeight:900, fontFamily:'DM Mono, monospace', color:'var(--black)' }}>Region {top.region}</div>
                  <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>{top.missed} missed · {top.cancelled} cancelled</div>
                </>;
              })() : <div style={{ fontSize:13, color:'var(--gray)' }}>—</div>}
            </div>
          </div>

          {/* Breakdown charts row */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>

            {/* By Region */}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:18 }}>
              <div style={{ fontSize:14, fontWeight:700, color:'var(--black)', marginBottom:14 }}>By Region</div>
              {byRegion.length === 0
                ? <div style={{ color:'var(--gray)', fontSize:13 }}>No data for current filters.</div>
                : byRegion.sort((a,b) => (b.missed+b.cancelled)-(a.missed+a.cancelled)).map(r => {
                    const total = r.missed + r.cancelled;
                    const maxTotal = Math.max(...byRegion.map(x => x.missed + x.cancelled), 1);
                    return (
                      <div key={r.region} style={{ marginBottom:10 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:3 }}>
                          <span>
                            <strong>Region {r.region}</strong>
                            <span style={{ color:'var(--gray)', fontSize:10, marginLeft:8 }}>{REGIONAL_MANAGERS[r.region]}</span>
                          </span>
                          <span style={{ fontFamily:'DM Mono, monospace', fontWeight:700 }}>
                            <span style={{ color:'#DC2626' }}>{r.missed}M</span>
                            {' · '}
                            <span style={{ color:'#D97706' }}>{r.cancelled}C</span>
                          </span>
                        </div>
                        <div style={{ height:8, background:'var(--border)', borderRadius:999, overflow:'hidden', display:'flex' }}>
                          <div style={{ width:(r.missed/maxTotal*100)+'%', background:'#EF4444', transition:'width 0.4s' }} />
                          <div style={{ width:(r.cancelled/maxTotal*100)+'%', background:'#F59E0B', transition:'width 0.4s' }} />
                        </div>
                      </div>
                    );
                  })
              }
              <div style={{ display:'flex', gap:12, marginTop:10, fontSize:10 }}>
                <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:10, height:10, background:'#EF4444', borderRadius:2, display:'inline-block' }} />Missed</span>
                <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:10, height:10, background:'#F59E0B', borderRadius:2, display:'inline-block' }} />Cancelled</span>
              </div>
            </div>

            {/* Top Clinicians */}
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:18 }}>
              <div style={{ fontSize:14, fontWeight:700, color:'var(--black)', marginBottom:14 }}>Top Clinicians by Missed/Cancelled</div>
              {byClinician.length === 0
                ? <div style={{ color:'var(--gray)', fontSize:13 }}>No data for current filters.</div>
                : byClinician.map((c, i) => (
                    <div key={c.name} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid var(--border)' }}>
                      <div>
                        <div style={{ fontSize:12, fontWeight:600 }}>{c.name}</div>
                        <div style={{ fontSize:10, color:'var(--gray)' }}>Region {c.region}</div>
                      </div>
                      <div style={{ display:'flex', gap:8, fontSize:11 }}>
                        {c.missed > 0 && <span style={{ color:'#DC2626', fontWeight:700, background:'#FEF2F2', padding:'1px 7px', borderRadius:999 }}>{c.missed} missed</span>}
                        {c.cancelled > 0 && <span style={{ color:'#D97706', fontWeight:700, background:'#FEF3C7', padding:'1px 7px', borderRadius:999 }}>{c.cancelled} cancelled</span>}
                      </div>
                    </div>
                  ))
              }
            </div>
          </div>

          {/* Full data table */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:'var(--black)' }}>Detailed Records</div>
                <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>{filtered.length} records · Click column headers to sort</div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={() => downloadCSV(filtered, exportFilename + '.csv')}
                  style={{ padding:'6px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, fontWeight:600, background:'var(--bg)', cursor:'pointer' }}>
                  ⬇ CSV
                </button>
                <button onClick={() => downloadXLSX(filtered, exportFilename + '.xls')}
                  style={{ padding:'6px 12px', background:'#1565C0', color:'#fff', border:'none', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer' }}>
                  ⬇ Excel
                </button>
              </div>
            </div>

            {/* Table header */}
            <div style={{ display:'grid', gridTemplateColumns:'0.7fr 1.6fr 0.5fr 1fr 1.2fr 1.4fr 0.7fr 0.9fr', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', gap:8 }}>
              {col('Date', 'visit_date', '0.7fr')}
              {col('Patient', 'patient_name', '1.6fr')}
              {col('Region', 'region', '0.5fr')}
              {col('Manager', '', '1fr', { cursor:'default' })}
              {col('Clinician', 'staff_name', '1.2fr')}
              {col('Visit Type', 'event_type', '1.4fr')}
              {col('Type', '', '0.7fr', { cursor:'default' })}
              {col('Status', 'status', '0.9fr')}
            </div>

            {/* Rows */}
            <div style={{ maxHeight:500, overflowY:'auto' }}>
              {filtered.length === 0 ? (
                <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>
                  No records match the current filters.
                </div>
              ) : filtered.map((r, i) => {
                const cls = classifyRow(r);
                const clsColor = cls === 'Missed' ? '#DC2626' : '#D97706';
                const clsBg = cls === 'Missed' ? '#FEF2F2' : '#FEF3C7';
                return (
                  <div key={r.id || i} style={{
                    display:'grid', gridTemplateColumns:'0.7fr 1.6fr 0.5fr 1fr 1.2fr 1.4fr 0.7fr 0.9fr',
                    padding:'9px 20px', borderBottom:'1px solid var(--border)', gap:8,
                    background: i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)',
                    alignItems:'center',
                  }}>
                    <div style={{ fontSize:12, fontFamily:'DM Mono, monospace', color:'var(--black)' }}>{fmtDate(r.visit_date)}</div>
                    <div style={{ fontSize:12, fontWeight:600, color:'var(--black)' }}>{r.patient_name}</div>
                    <div style={{ fontSize:12, fontWeight:700, color:'var(--gray)' }}>{r.region}</div>
                    <div style={{ fontSize:11, color:'var(--gray)' }}>{REGIONAL_MANAGERS[r.region] || '—'}</div>
                    <div style={{ fontSize:12 }}>{r.staff_name || '—'}</div>
                    <div style={{ fontSize:11, color:'var(--gray)' }}>{(r.event_type || '').replace(' *e*', '').replace(' (PDF)', '')}</div>
                    <div>
                      <span style={{ fontSize:10, fontWeight:700, color:clsColor, background:clsBg, padding:'2px 7px', borderRadius:999 }}>{cls}</span>
                    </div>
                    <div style={{ fontSize:11, color:'var(--gray)' }}>{r.status}</div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
