import React, { useState, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { REGIONS } from '../../lib/constants';

export default function PatientCensusPage() {
  const census = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('axiom_census') || '[]'); } catch { return []; }
  }, []);

  const visits = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('axiom_pariox_data') || '[]'); } catch { return []; }
  }, []);

  const [regionFilter, setRegionFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const regions = useMemo(() => ['ALL', ...new Set(census.map(p => p.region).filter(Boolean)).values()].sort(), [census]);

  const filtered = useMemo(() => census.filter(p => {
    if (regionFilter !== 'ALL' && p.region !== regionFilter) return false;
    if (search && !p.patient_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [census, regionFilter, search]);

  // Region summary
  const regionSummary = useMemo(() => {
    const map = {};
    census.forEach(p => {
      const r = p.region || 'Unknown';
      if (!map[r]) map[r] = { count: 0, coordinator: REGIONS[r] || 'Unassigned' };
      map[r].count++;
    });
    return Object.entries(map).sort((a, b) => b[1].count - a[1].count);
  }, [census]);

  // Visit count per patient
  const visitMap = useMemo(() => {
    const map = {};
    visits.forEach(v => {
      if (v.patient_name) {
        map[v.patient_name] = (map[v.patient_name] || 0) + 1;
      }
    });
    return map;
  }, [visits]);

  if (census.length === 0) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Patient Census" subtitle="Full census viewer" />
      <div style={styles.empty}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>👥</div>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No census data loaded</div>
        <div style={{ color: 'var(--gray)', fontSize: 14 }}>Upload your Pariox patient census in Data Uploads</div>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Patient Census"
        subtitle={`${filtered.length} of ${census.length} patients`}
      />
      <div style={{ padding: '20px 28px', flex: 1, overflow: 'auto' }}>

        {/* Region Summary Cards */}
        <div style={styles.regionRow}>
          {regionSummary.map(([region, data]) => (
            <div
              key={region}
              onClick={() => setRegionFilter(regionFilter === region ? 'ALL' : region)}
              style={{
                ...styles.regionCard,
                border: regionFilter === region ? '2px solid var(--red)' : '1px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              <div style={styles.regionLabel}>Region {region}</div>
              <div style={styles.regionCount}>{data.count}</div>
              <div style={styles.regionCoord}>{data.coordinator}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={styles.filterRow}>
          <input
            placeholder="Search patient name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={styles.searchInput}
          />
          <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} style={styles.select}>
            {regions.map(r => <option key={r} value={r}>{r === 'ALL' ? 'All Regions' : `Region ${r}`}</option>)}
          </select>
          <div style={styles.countBadge}>{filtered.length} patients</div>
        </div>

        {/* Patient Table */}
        <div style={styles.table}>
          <div style={styles.tableHeader}>
            <span>Patient Name</span>
            <span>Region</span>
            <span>Insurance</span>
            <span>Coordinator</span>
            <span>Visits</span>
            <span>Status</span>
          </div>
          {filtered.map((p, i) => (
            <div key={i} style={{ ...styles.tableRow, background: i % 2 === 0 ? 'var(--bg)' : 'var(--card-bg)' }}>
              <span style={styles.cellName}>{p.patient_name}</span>
              <span style={styles.cell}>
                <span style={styles.regionBadge}>Region {p.region || '?'}</span>
              </span>
              <span style={styles.cell}>{p.insurance || '—'}</span>
              <span style={styles.cell}>{REGIONS[p.region] || '—'}</span>
              <span style={{ ...styles.cell, fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>
                {visitMap[p.patient_name] || 0}
              </span>
              <span style={styles.cell}>
                <span style={{
                  background: '#ECFDF5',
                  color: '#065F46',
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                }}>Active</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  regionRow: { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
  regionCard: { background: 'var(--card-bg)', borderRadius: 10, padding: '14px 20px', minWidth: 120, transition: 'all 0.15s' },
  regionLabel: { fontSize: 11, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 },
  regionCount: { fontSize: 28, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--black)', lineHeight: 1 },
  regionCoord: { fontSize: 11, color: 'var(--gray)', marginTop: 4 },
  filterRow: { display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' },
  searchInput: { flex: 1, minWidth: 200, padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--card-bg)', outline: 'none' },
  select: { padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--card-bg)', color: 'var(--black)', outline: 'none' },
  countBadge: { fontSize: 13, fontWeight: 600, color: 'var(--gray)', padding: '8px 14px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' },
  table: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' },
  tableHeader: { display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr 1.5fr 0.5fr 1fr', padding: '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--bg)', borderBottom: '1px solid var(--border)' },
  tableRow: { display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr 1.5fr 0.5fr 1fr', padding: '11px 20px', alignItems: 'center', borderBottom: '1px solid var(--border)' },
  cellName: { fontSize: 13, fontWeight: 500, color: 'var(--black)' },
  cell: { fontSize: 12, color: 'var(--gray)' },
  regionBadge: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, color: 'var(--black)' },
};
