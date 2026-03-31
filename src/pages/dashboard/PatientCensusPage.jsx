import React, { useState, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { REGIONS } from '../../lib/constants';

function PatientProfile({ patient, visits, onClose }) {
  const patientVisits = visits.filter(v =>
    v.patient_name?.toLowerCase() === patient.patient_name?.toLowerCase()
  );
  const completed = patientVisits.filter(v => v.status?.toLowerCase().includes('completed'));
  const scheduled = patientVisits.filter(v => v.status?.toLowerCase().includes('scheduled'));

  return (
    <div style={profileStyles.overlay} onClick={onClose}>
      <div style={profileStyles.panel} onClick={e => e.stopPropagation()}>
        <div style={profileStyles.header}>
          <div style={profileStyles.avatar}>
            {patient.patient_name?.split(',')[0]?.[0] || patient.patient_name?.[0] || '?'}
          </div>
          <div>
            <div style={profileStyles.name}>{patient.patient_name}</div>
            <div style={profileStyles.meta}>
              Region {patient.region || '?'} · {REGIONS[patient.region] || 'Unassigned'} · {patient.insurance || 'No insurance on file'}
            </div>
          </div>
          <button onClick={onClose} style={profileStyles.closeBtn}>✕</button>
        </div>

        <div style={profileStyles.statsRow}>
          <div style={profileStyles.statBox}>
            <div style={profileStyles.statVal}>{patientVisits.length}</div>
            <div style={profileStyles.statLbl}>Total Visits</div>
          </div>
          <div style={profileStyles.statBox}>
            <div style={{ ...profileStyles.statVal, color: 'var(--green)' }}>{completed.length}</div>
            <div style={profileStyles.statLbl}>Completed</div>
          </div>
          <div style={profileStyles.statBox}>
            <div style={{ ...profileStyles.statVal, color: 'var(--blue)' }}>{scheduled.length}</div>
            <div style={profileStyles.statLbl}>Scheduled</div>
          </div>
        </div>

        <div style={profileStyles.section}>
          <div style={profileStyles.sectionTitle}>Visit History</div>
          {patientVisits.length === 0 ? (
            <div style={{ color: 'var(--gray)', fontSize: 13, padding: '12px 0' }}>No visit history found</div>
          ) : (
            <div style={profileStyles.visitList}>
              {patientVisits.map((v, i) => (
                <div key={i} style={profileStyles.visitRow}>
                  <div style={profileStyles.visitDate}>{v.raw_date || '—'}</div>
                  <div style={profileStyles.visitType}>{v.event_type || v.discipline || '—'}</div>
                  <div style={profileStyles.visitClinician}>{v.staff_name || '—'}</div>
                  <div>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 600,
                      background: v.status?.toLowerCase().includes('completed') ? '#ECFDF5' : v.status?.toLowerCase().includes('scheduled') ? '#EFF6FF' : '#FEF3C7',
                      color: v.status?.toLowerCase().includes('completed') ? '#065F46' : v.status?.toLowerCase().includes('scheduled') ? '#1E40AF' : '#92400E',
                    }}>
                      {v.status || 'Unknown'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PatientCensusPage() {
  const census = useMemo(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('axiom_census') || '[]');
      return raw
        .filter(p => p.patient_name && p.patient_name.trim())
        .sort((a, b) => {
          // Sort by region first, then alphabetically
          const rA = a.region || 'Z';
          const rB = b.region || 'Z';
          if (rA !== rB) return rA.localeCompare(rB);
          return (a.patient_name || '').localeCompare(b.patient_name || '');
        });
    } catch { return []; }
  }, []);

  const visits = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('axiom_pariox_data') || '[]'); } catch { return []; }
  }, []);

  const [regionFilter, setRegionFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);

  const regions = useMemo(() => {
    const valid = ['A', 'B', 'C', 'G', 'H', 'J', 'M', 'N', 'T', 'V'];
    const found = [...new Set(census.map(p => p.region).filter(r => r && valid.includes(r)))].sort();
    return ['ALL', ...found];
  }, [census]);

  const filtered = useMemo(() => census.filter(p => {
    if (regionFilter !== 'ALL' && p.region !== regionFilter) return false;
    if (search && !p.patient_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [census, regionFilter, search]);

  // Region summary — only valid regions
  const regionSummary = useMemo(() => {
    const valid = ['A', 'B', 'C', 'G', 'H', 'J', 'M', 'N', 'T', 'V'];
    const map = {};
    census.forEach(p => {
      if (!valid.includes(p.region)) return;
      if (!map[p.region]) map[p.region] = { count: 0, coordinator: REGIONS[p.region] || 'Unassigned' };
      map[p.region].count++;
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [census]);

  const visitMap = useMemo(() => {
    const map = {};
    visits.forEach(v => {
      if (v.patient_name) map[v.patient_name] = (map[v.patient_name] || 0) + 1;
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
      {selectedPatient && (
        <PatientProfile
          patient={selectedPatient}
          visits={visits}
          onClose={() => setSelectedPatient(null)}
        />
      )}

      <TopBar
        title="Patient Census"
        subtitle={`${filtered.length} of ${census.length} patients`}
      />

      <div style={{ padding: '20px 28px', flex: 1, overflow: 'auto' }}>

        {/* Region Summary */}
        <div style={styles.regionRow}>
          <div
            onClick={() => setRegionFilter('ALL')}
            style={{
              ...styles.regionCard,
              border: regionFilter === 'ALL' ? '2px solid var(--red)' : '1px solid var(--border)',
            }}
          >
            <div style={styles.regionLabel}>ALL</div>
            <div style={styles.regionCount}>{census.filter(p => ['A','B','C','G','H','J','M','N','T','V'].includes(p.region)).length}</div>
            <div style={styles.regionCoord}>All Coordinators</div>
          </div>
          {regionSummary.map(([region, data]) => (
            <div
              key={region}
              onClick={() => setRegionFilter(regionFilter === region ? 'ALL' : region)}
              style={{
                ...styles.regionCard,
                border: regionFilter === region ? '2px solid var(--red)' : '1px solid var(--border)',
              }}
            >
              <div style={styles.regionLabel}>Region {region}</div>
              <div style={styles.regionCount}>{data.count}</div>
              <div style={styles.regionCoord}>{data.coordinator}</div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div style={styles.filterRow}>
          <input
            placeholder="Search patient name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={styles.searchInput}
          />
          <div style={styles.countBadge}>{filtered.length} patients</div>
        </div>

        {/* CRM Table */}
        <div style={styles.table}>
          <div style={styles.tableHeader}>
            <span>Patient Name</span>
            <span>Region</span>
            <span>Coordinator</span>
            <span>Insurance</span>
            <span>Visits</span>
            <span>Status</span>
          </div>
          {filtered.map((p, i) => (
            <div
              key={i}
              style={{
                ...styles.tableRow,
                background: i % 2 === 0 ? 'var(--bg)' : 'var(--card-bg)',
                cursor: 'pointer',
              }}
              onClick={() => setSelectedPatient(p)}
            >
              <span style={styles.cellName}>{p.patient_name}</span>
              <span style={styles.cell}>
                <span style={styles.regionBadge}>Region {p.region || '?'}</span>
              </span>
              <span style={styles.cell}>{REGIONS[p.region] || '—'}</span>
              <span style={styles.cell}>{p.insurance || '—'}</span>
              <span style={{ ...styles.cell, fontFamily: 'DM Mono, monospace', fontWeight: 600, color: 'var(--black)' }}>
                {visitMap[p.patient_name] || 0}
              </span>
              <span style={styles.cell}>
                <span style={styles.activeBadge}>Active</span>
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
  regionRow: { display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' },
  regionCard: { background: 'var(--card-bg)', borderRadius: 10, padding: '12px 16px', minWidth: 100, cursor: 'pointer', transition: 'all 0.15s' },
  regionLabel: { fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 },
  regionCount: { fontSize: 26, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--black)', lineHeight: 1 },
  regionCoord: { fontSize: 10, color: 'var(--gray)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 100 },
  filterRow: { display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' },
  searchInput: { flex: 1, padding: '9px 14px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--card-bg)', outline: 'none' },
  countBadge: { fontSize: 13, fontWeight: 600, color: 'var(--gray)', padding: '8px 14px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)', whiteSpace: 'nowrap' },
  table: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' },
  tableHeader: { display: 'grid', gridTemplateColumns: '2.5fr 0.8fr 1.5fr 1.5fr 0.6fr 0.8fr', padding: '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--bg)', borderBottom: '1px solid var(--border)' },
  tableRow: { display: 'grid', gridTemplateColumns: '2.5fr 0.8fr 1.5fr 1.5fr 0.6fr 0.8fr', padding: '11px 20px', alignItems: 'center', borderBottom: '1px solid var(--border)', transition: 'background 0.1s' },
  cellName: { fontSize: 13, fontWeight: 500, color: 'var(--red)', textDecoration: 'underline', textDecorationColor: 'transparent', cursor: 'pointer' },
  cell: { fontSize: 12, color: 'var(--gray)' },
  regionBadge: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, color: 'var(--black)' },
  activeBadge: { background: '#ECFDF5', color: '#065F46', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 },
};

const profileStyles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' },
  panel: { width: '520px', height: '100vh', background: 'var(--card-bg)', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)' },
  header: { display: 'flex', alignItems: 'center', gap: 14, padding: '24px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--card-bg)', zIndex: 1 },
  avatar: { width: 48, height: 48, borderRadius: '50%', background: 'var(--red)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, flexShrink: 0 },
  name: { fontSize: 16, fontWeight: 700, color: 'var(--black)', letterSpacing: '-0.2px' },
  meta: { fontSize: 12, color: 'var(--gray)', marginTop: 3 },
  closeBtn: { marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--gray)', fontSize: 18, cursor: 'pointer', padding: 4 },
  statsRow: { display: 'flex', borderBottom: '1px solid var(--border)' },
  statBox: { flex: 1, padding: '20px', textAlign: 'center', borderRight: '1px solid var(--border)' },
  statVal: { fontSize: 28, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--black)' },
  statLbl: { fontSize: 11, color: 'var(--gray)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.05em' },
  section: { padding: '20px 24px' },
  sectionTitle: { fontSize: 12, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 },
  visitList: { display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' },
  visitRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', padding: '10px 14px', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', fontSize: 12 },
  visitDate: { fontFamily: 'DM Mono, monospace', color: 'var(--black)', fontWeight: 500 },
  visitType: { color: 'var(--black)' },
  visitClinician: { color: 'var(--gray)' },
};
