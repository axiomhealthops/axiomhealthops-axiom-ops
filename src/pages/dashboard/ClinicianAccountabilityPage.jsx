import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';

const BLENDED_RATE = 185;
const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function pctColor(pct) {
  if (pct >= 80) return '#059669';
  if (pct >= 60) return '#D97706';
  return '#DC2626';
}
function pctBg(pct) {
  if (pct >= 80) return '#ECFDF5';
  if (pct >= 60) return '#FEF3C7';
  return '#FEF2F2';
}

function CliniciansTab({ clinicians, visits, census }) {
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterDiscipline, setFilterDiscipline] = useState('ALL');
  const [sortField, setSortField] = useState('utilization');
  const [sortDir, setSortDir] = useState('asc'); // asc = worst first
  const [expandedClinician, setExpandedClinician] = useState(null);
  // KPI-tile scope filter (matches ProductivityPage pattern): clicking a
  // summary tile narrows the table to that cohort. 'ALL' = no scope.
  // Scopes: 'under30' / 'under60' / 'hasInactive'
  const [scope, setScope] = useState('ALL');

  const weekStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1));
    return d.toISOString().slice(0, 10);
  }, []);

  const clinicianStats = useMemo(() => {
    // Build visit map for this week
    const weekVisits = visits.filter(v => v.visit_date >= weekStart);
    const visitMap = {};
    weekVisits.forEach(v => {
      const key = (v.staff_name_normalized || v.staff_name || '').toLowerCase().trim();
      if (!visitMap[key]) visitMap[key] = { completed: 0, cancelled: 0, missed: 0, patients: new Set() };
      if (/completed/i.test(v.status || '')) { visitMap[key].completed++; visitMap[key].patients.add(v.patient_name); }
      else if (/cancel/i.test(v.status || '') || /cancel/i.test(v.event_type || '')) visitMap[key].cancelled++;
      else if (/missed/i.test(v.status || '')) visitMap[key].missed++;
    });

    // Build inactive patient map: which clinician last saw each inactive active patient
    const inactiveMap = {};
    // Frequency-aware overdue: each patient has their own threshold (4w4→3d, 2w4→4d, 1w4→10d, 1em1→30d, 1em2→60d).
    census.filter(p => /active/i.test(p.status || '') && (p.days_overdue || 0) > 0).forEach(p => {
      // Normalize the clinician name for matching
      const rawClinician = p.last_visit_clinician || '';
      const normalizedClinician = rawClinician.includes(',') 
        ? rawClinician.split(',').map(s=>s.trim()).reverse().join(' ')
        : rawClinician;
      const lastClinician = normalizedClinician.toLowerCase().trim();
      if (lastClinician) {
        if (!inactiveMap[lastClinician]) inactiveMap[lastClinician] = [];
        inactiveMap[lastClinician].push(p);
      }
    });

    return clinicians
      .filter(cl => cl.is_active && (cl.weekly_visit_target || 0) >= 5)
      .map(cl => {
        const key = (cl.full_name || '').toLowerCase().trim();
        const stats = visitMap[key] || { completed: 0, cancelled: 0, missed: 0, patients: new Set() };
        const target = cl.weekly_visit_target || 0;
        const utilization = target > 0 ? Math.round((stats.completed / target) * 100) : 0;
        const inactive = inactiveMap[key] || [];
        const revenueGap = inactive.length * BLENDED_RATE * 2;
        return {
          ...cl,
          completed: stats.completed,
          cancelled: stats.cancelled,
          missed: stats.missed,
          patientsSeenCount: stats.patients.size,
          utilization,
          inactivePatients: inactive,
          inactiveCount: inactive.length,
          revenueGap,
          cancelRate: (stats.completed + stats.cancelled + stats.missed) > 0
            ? Math.round(stats.cancelled / (stats.completed + stats.cancelled + stats.missed) * 100)
            : 0,
        };
      });
  }, [clinicians, visits, census, weekStart]);

  const filtered = useMemo(() => {
    let list = clinicianStats;
    if (filterRegion !== 'ALL') list = list.filter(c => c.region === filterRegion || c.region === 'All');
    if (filterDiscipline !== 'ALL') list = list.filter(c => c.discipline === filterDiscipline);
    // Scope filter driven by the KPI tiles at the top of the page.
    if (scope === 'under30') list = list.filter(c => c.utilization < 30);
    else if (scope === 'under60') list = list.filter(c => c.utilization < 60);
    else if (scope === 'hasInactive') list = list.filter(c => c.inactiveCount > 0);
    return [...list].sort((a, b) => {
      const av = a[sortField], bv = b[sortField];
      return sortDir === 'asc' ? (av - bv) : (bv - av);
    });
  }, [clinicianStats, filterRegion, filterDiscipline, sortField, sortDir, scope]);

  const summary = useMemo(() => ({
    under60: clinicianStats.filter(c => c.utilization < 60).length,
    under30: clinicianStats.filter(c => c.utilization < 30).length,
    totalInactive: clinicianStats.reduce((s, c) => s + c.inactiveCount, 0),
    totalRevenueGap: clinicianStats.reduce((s, c) => s + c.revenueGap, 0),
    avgUtilization: clinicianStats.length > 0 ? Math.round(clinicianStats.reduce((s, c) => s + c.utilization, 0) / clinicianStats.length) : 0,
  }), [clinicianStats]);

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  const disciplines = [...new Set(clinicians.map(c => c.discipline).filter(Boolean))].sort();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}>
      {/* Summary KPIs — the three cohort tiles (Under 30%, Under 60%,
          Inactive Patients) act as scope toggles that narrow the table to
          matching clinicians. Avg Util and Revenue Gap are informational. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        {[
          { label: 'Avg Utilization', val: summary.avgUtilization + '%', color: pctColor(summary.avgUtilization), bg: pctBg(summary.avgUtilization), sub: 'across all clinicians', scopeKey: null },
          { label: '🔴 Under 30%', val: summary.under30, color: '#DC2626', bg: '#FEF2F2', sub: 'critically underutilized', scopeKey: 'under30' },
          { label: '🟠 Under 60%', val: summary.under60, color: '#D97706', bg: '#FEF3C7', sub: 'need patient assignment', scopeKey: 'under60' },
          { label: '⚠ Inactive Patients', val: summary.totalInactive, color: '#7C3AED', bg: '#F5F3FF', sub: 'linked to last clinician', scopeKey: 'hasInactive' },
          { label: '💰 Revenue Gap', val: '$' + Math.round(summary.totalRevenueGap / 1000) + 'K/wk', color: '#DC2626', bg: '#FEF2F2', sub: 'from inactive patients', scopeKey: null },
        ].map(c => {
          const clickable = !!c.scopeKey;
          const isActive = clickable && scope === c.scopeKey;
          return (
            <div key={c.label}
              onClick={clickable ? () => setScope(isActive ? 'ALL' : c.scopeKey) : undefined}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={clickable ? e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); setScope(isActive ? 'ALL' : c.scopeKey); } } : undefined}
              style={{ background: c.bg, border: isActive ? `2px solid ${c.color}` : '1px solid var(--border)', borderRadius: 10, padding: isActive ? '11px 13px' : '12px 14px', textAlign: 'center', cursor: clickable ? 'pointer' : 'default', transition: 'transform 0.1s ease, box-shadow 0.15s ease', boxShadow: isActive ? `0 0 0 2px ${c.color}20` : 'none' }}
              onMouseEnter={clickable ? e => { e.currentTarget.style.transform='translateY(-1px)'; e.currentTarget.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'; } : undefined}
              onMouseLeave={clickable ? e => { e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow= isActive ? `0 0 0 2px ${c.color}20` : 'none'; } : undefined}>
              <div style={{ fontSize: 9, fontWeight: 700, color: c.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</div>
              <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: c.color, marginTop: 4 }}>{c.val}</div>
              <div style={{ fontSize: 9, color: 'var(--gray)', marginTop: 2 }}>
                {clickable ? (isActive ? <span style={{ color: c.color, fontWeight: 700 }}>✓ filtered · click to clear</span> : <span>{c.sub} · click to filter</span>) : c.sub}
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
          style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)' }}>
          <option value="ALL">All Regions</option>
          {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
        </select>
        <select value={filterDiscipline} onChange={e => setFilterDiscipline(e.target.value)}
          style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)' }}>
          <option value="ALL">All Disciplines</option>
          {disciplines.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        {scope !== 'ALL' && (
          <button onClick={() => setScope('ALL')}
            style={{ padding: '5px 10px', border: '1px solid #D97706', background: '#FFFBEB', color: '#92400E', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            Scope: {scope === 'under30' ? 'Under 30%' : scope === 'under60' ? 'Under 60%' : 'Has Inactive Patients'} ×
          </button>
        )}
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gray)' }}>{filtered.length} clinicians · click row to see inactive patients</div>
      </div>

      {/* Clinician Table */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 0.5fr 0.5fr 1.4fr 0.6fr 0.6fr 0.6fr 0.6fr 0.7fr 0.8fr', padding: '8px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 9, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', gap: 8 }}>
          <span>Clinician</span><span>Rgn</span><span>Disc</span>
          <span onClick={() => toggleSort('utilization')} style={{ cursor: 'pointer' }}>Utilization {sortField === 'utilization' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
          <span onClick={() => toggleSort('completed')} style={{ cursor: 'pointer' }}>Done {sortField === 'completed' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
          <span>Target</span>
          <span onClick={() => toggleSort('cancelRate')} style={{ cursor: 'pointer' }}>Cancel% {sortField === 'cancelRate' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
          <span onClick={() => toggleSort('inactiveCount')} style={{ cursor: 'pointer' }}>Inactive {sortField === 'inactiveCount' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
          <span>Rev Gap</span>
          <span>Patients Seen</span>
        </div>
        {filtered.map((cl, i) => {
          const isExpanded = expandedClinician === cl.full_name;
          const rowBg = cl.utilization < 30 ? '#FFF5F5' : cl.utilization < 60 ? '#FFFBEB' : i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)';
          return (
            <div key={cl.full_name}>
              <div onClick={() => setExpandedClinician(isExpanded ? null : cl.full_name)}
                style={{ display: 'grid', gridTemplateColumns: '1.8fr 0.5fr 0.5fr 1.4fr 0.6fr 0.6fr 0.6fr 0.6fr 0.7fr 0.8fr', padding: '9px 16px', borderBottom: '1px solid var(--border)', background: rowBg, alignItems: 'center', gap: 8, cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#EFF6FF'}
                onMouseLeave={e => e.currentTarget.style.background = rowBg}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{cl.full_name}</div>
                  {cl.inactiveCount > 0 && <div style={{ fontSize: 9, color: '#DC2626', fontWeight: 700 }}>⚠ {cl.inactiveCount} inactive patient{cl.inactiveCount > 1 ? 's' : ''} assigned</div>}
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)' }}>{cl.region}</span>
                <span style={{ fontSize: 10, color: 'var(--gray)' }}>{cl.discipline}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, height: 6, background: '#E5E7EB', borderRadius: 999 }}>
                    <div style={{ width: `${Math.min(100, cl.utilization)}%`, height: '100%', background: pctColor(cl.utilization), borderRadius: 999 }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: pctColor(cl.utilization), minWidth: 30 }}>{cl.utilization}%</span>
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: '#059669' }}>{cl.completed}</span>
                <span style={{ fontSize: 12, color: 'var(--gray)' }}>{cl.weekly_visit_target}</span>
                <span style={{ fontSize: 12, fontWeight: cl.cancelRate > 10 ? 700 : 400, color: cl.cancelRate > 10 ? '#DC2626' : cl.cancelRate > 5 ? '#D97706' : 'var(--gray)' }}>{cl.cancelRate}%</span>
                <span style={{ fontSize: 14, fontWeight: cl.inactiveCount > 0 ? 700 : 400, fontFamily: 'DM Mono, monospace', color: cl.inactiveCount > 3 ? '#DC2626' : cl.inactiveCount > 0 ? '#D97706' : 'var(--gray)' }}>{cl.inactiveCount}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: cl.revenueGap > 0 ? '#DC2626' : 'var(--gray)' }}>{cl.revenueGap > 0 ? `-$${Math.round(cl.revenueGap / 1000)}K` : '—'}</span>
                <span style={{ fontSize: 12, color: 'var(--gray)' }}>{cl.patientsSeenCount} pts</span>
              </div>
              {/* Expanded: inactive patients */}
              {isExpanded && cl.inactivePatients.length > 0 && (
                <div style={{ background: '#FEF2F2', borderBottom: '2px solid #FECACA', padding: '12px 24px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#DC2626', marginBottom: 8 }}>
                    ⚠ {cl.inactivePatients.length} active patient{cl.inactivePatients.length > 1 ? 's' : ''} last seen by {cl.full_name} — overdue vs prescribed frequency
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                    {cl.inactivePatients.map(p => (
                      <div key={p.patient_name} style={{ background: '#fff', border: '1px solid #FECACA', borderRadius: 7, padding: '8px 12px' }}>
                        <div style={{ fontSize: 11, fontWeight: 600 }}>{p.patient_name}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                          <span style={{ fontSize: 9, color: 'var(--gray)' }}>Rgn {p.region} · {p.insurance}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#DC2626' }}>
                            {p.days_since_last_visit ? `${p.days_since_last_visit}d ago` : 'No visits'}
                          </span>
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--gray)', marginTop: 1 }}>Last: {fmtDate(p.last_visit_date)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {isExpanded && cl.inactivePatients.length === 0 && (
                <div style={{ background: '#ECFDF5', borderBottom: '1px solid #A7F3D0', padding: '10px 24px', fontSize: 11, color: '#065F46', fontWeight: 600 }}>
                  ✅ All assigned patients seen within their prescribed frequency — clean caseload
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InactivePatientsTab({ census, clinicians }) {
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterClinician, setFilterClinician] = useState('ALL');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('days_since_last_visit');

  const inactiveActive = useMemo(() =>
    census
      .filter(p => /active/i.test(p.status || '') && (p.days_overdue || 0) > 0)
      .sort((a, b) => (b.days_overdue || 0) - (a.days_overdue || 0)),
    [census]);

  const clinicianNames = useMemo(() =>
    [...new Set(inactiveActive.map(p => p.last_visit_clinician).filter(Boolean))].sort(),
    [inactiveActive]);

  const filtered = useMemo(() => inactiveActive.filter(p => {
    if (filterRegion !== 'ALL' && p.region !== filterRegion) return false;
    if (filterClinician !== 'ALL' && p.last_visit_clinician !== filterClinician) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${p.patient_name} ${p.insurance} ${p.last_visit_clinician || ''}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [inactiveActive, filterRegion, filterClinician, search]);

  const totalGap = filtered.reduce((s, p) => s + BLENDED_RATE * 2, 0);

  // Group by region for summary
  const byRegion = useMemo(() => {
    const map = {};
    inactiveActive.forEach(p => {
      map[p.region] = (map[p.region] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [inactiveActive]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}>
      {/* Alert banner */}
      <div style={{ background: '#FEF2F2', border: '2px solid #FECACA', borderRadius: 10, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#DC2626' }}>
            🚨 {inactiveActive.length} Active Patients Overdue vs Prescribed Frequency
          </div>
          <div style={{ fontSize: 11, color: '#DC2626', marginTop: 2 }}>
            Thresholds by cadence: 4w4→3d · 2w4→4d · 1w4→10d · 1em1→30d · 1em2→60d · Estimated weekly revenue gap: ${Math.round(inactiveActive.length * BLENDED_RATE * 2).toLocaleString()}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 28, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: '#DC2626' }}>
            ${Math.round(inactiveActive.length * BLENDED_RATE * 2 / 1000)}K
          </div>
          <div style={{ fontSize: 10, color: '#DC2626' }}>weekly gap</div>
        </div>
      </div>

      {/* Region breakdown */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {byRegion.map(([region, count]) => (
          <div key={region} onClick={() => setFilterRegion(filterRegion === region ? 'ALL' : region)}
            style={{ padding: '8px 14px', borderRadius: 8, background: filterRegion === region ? '#DC2626' : '#FEF2F2', border: `2px solid ${filterRegion === region ? '#DC2626' : '#FECACA'}`, cursor: 'pointer', textAlign: 'center', minWidth: 70 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: filterRegion === region ? '#fff' : '#DC2626' }}>Rgn {region}</div>
            <div style={{ fontSize: 20, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: filterRegion === region ? '#fff' : '#DC2626' }}>{count}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient, insurance, clinician..."
          style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)', width: 220 }} />
        <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
          style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)' }}>
          <option value="ALL">All Regions</option>
          {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
        </select>
        <select value={filterClinician} onChange={e => setFilterClinician(e.target.value)}
          style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)', maxWidth: 200 }}>
          <option value="ALL">All Last Clinicians</option>
          <option value="">No clinician on file</option>
          {clinicianNames.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {(filterRegion !== 'ALL' || filterClinician !== 'ALL' || search) && (
          <button onClick={() => { setFilterRegion('ALL'); setFilterClinician('ALL'); setSearch(''); }}
            style={{ fontSize: 10, color: 'var(--gray)', background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer' }}>Clear</button>
        )}
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gray)' }}>{filtered.length} patients · ${Math.round(totalGap / 1000)}K/wk shown</div>
      </div>

      {/* Patient table */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 0.4fr 0.9fr 0.5fr 0.7fr 0.6fr 0.6fr 1.2fr 0.6fr', padding: '8px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 9, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', gap: 8 }}>
          <span>Patient</span><span>Rgn</span><span>Insurance</span><span>Freq</span><span>Last Visit</span><span>Days</span><span>Overdue</span><span>Last Clinician</span><span>Rev Gap/Wk</span>
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)' }}>No patients match filters.</div>
        ) : filtered.map((p, i) => {
          const days = p.days_since_last_visit || 999;
          const overdue = p.days_overdue || 0;
          const rowBg = overdue > 14 ? '#FFF5F5' : overdue > 4 ? '#FFF8F0' : i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)';
          const overdueColor = overdue > 14 ? '#DC2626' : overdue > 4 ? '#D97706' : '#92400E';
          return (
            <div key={p.patient_name + i} style={{ display: 'grid', gridTemplateColumns: '1.7fr 0.4fr 0.9fr 0.5fr 0.7fr 0.6fr 0.6fr 1.2fr 0.6fr', padding: '9px 16px', borderBottom: '1px solid var(--border)', background: rowBg, alignItems: 'center', gap: 8 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{p.patient_name}</div>
                <div style={{ fontSize: 9, color: 'var(--gray)', marginTop: 1 }}>{p.status}</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)' }}>{p.region}</span>
              <span style={{ fontSize: 11 }}>{p.insurance}</span>
              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: '#475569' }}>{p.inferred_frequency || '—'}</span>
              <span style={{ fontSize: 11 }}>{fmtDate(p.last_visit_date)}</span>
              <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--gray)' }}>{p.last_visit_date ? `${days}d` : '—'}</span>
              <span style={{ fontSize: 14, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: overdueColor }}>{overdue > 0 ? `+${overdue}d` : '—'}</span>
              <div>
                {p.last_visit_clinician ? (
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#1565C0' }}>{p.last_visit_clinician}</span>
                ) : (
                  <span style={{ fontSize: 10, color: '#9CA3AF', fontStyle: 'italic' }}>No visit on file</span>
                )}
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#DC2626' }}>${BLENDED_RATE * 2}</span>
            </div>
          );
        })}
        <div style={{ padding: '10px 16px', background: '#FFF5F5', borderTop: '1px solid #FECACA', display: 'flex', justifyContent: 'flex-end', gap: 24, fontSize: 11 }}>
          <span style={{ color: 'var(--gray)' }}>{filtered.length} patients shown</span>
          <span style={{ color: '#DC2626', fontWeight: 700 }}>Total gap: ${totalGap.toLocaleString()}/week</span>
        </div>
      </div>
    </div>
  );
}

export default function ClinicianAccountabilityPage() {
  const [loading, setLoading] = useState(true);
  const [clinicians, setClinicians] = useState([]);
  const [visits, setVisits] = useState([]);
  const [census, setCensus] = useState([]);
  const [activeTab, setActiveTab] = useState('clinicians');

  const load = useCallback(async () => {
    const [cl, v, c] = await Promise.all([
      supabase.from('clinicians').select('*').eq('is_active', true),
      supabase.from('visit_schedule_data')
        .select('patient_name,staff_name,staff_name_normalized,visit_date,status,event_type,region')
        .gte('visit_date', new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)),
      supabase.from('census_data')
        .select('patient_name,region,status,insurance,last_visit_date,days_since_last_visit,last_visit_clinician,last_visit_type,inferred_frequency,overdue_threshold_days,days_overdue'),
    ]);
    setClinicians(cl.data || []);
    setVisits(v.data || []);
    setCensus(c.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Clinician Accountability" subtitle="Loading..." />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading...</div>
    </div>
  );

  const inactiveCount = census.filter(p => /active/i.test(p.status || '') && (p.days_overdue || 0) > 0).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <TopBar
        title="Clinician Accountability"
        subtitle={`${clinicians.length} active clinicians · ${inactiveCount} patients overdue vs prescribed frequency`}
      />
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--card-bg)', flexShrink: 0 }}>
        {[
          { key: 'clinicians', label: '👤 Clinician Utilization' },
          { key: 'inactive', label: `🚨 Overdue Patients (${inactiveCount})` },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ padding: '12px 20px', border: 'none', background: 'none', fontSize: 13, fontWeight: activeTab === tab.key ? 700 : 400, color: activeTab === tab.key ? 'var(--red)' : 'var(--gray)', borderBottom: activeTab === tab.key ? '2px solid var(--red)' : '2px solid transparent', cursor: 'pointer' }}>
            {tab.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'clinicians' && <CliniciansTab clinicians={clinicians} visits={visits} census={census} />}
        {activeTab === 'inactive' && <InactivePatientsTab census={census} clinicians={clinicians} />}
      </div>
    </div>
  );
}
