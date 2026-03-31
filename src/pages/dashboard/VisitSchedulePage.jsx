import React, { useState, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { REGIONS } from '../../lib/constants';

const STATUS_COLORS = {
  completed: { bg: '#ECFDF5', color: '#065F46', label: 'Completed' },
  scheduled: { bg: '#EFF6FF', color: '#1E40AF', label: 'Scheduled' },
  'missed (active)': { bg: '#FEF3C7', color: '#92400E', label: 'Missed' },
  cancelled: { bg: '#FEF2F2', color: '#991B1B', label: 'Cancelled' },
};

function StatusPill({ status }) {
  const s = status?.toLowerCase() || '';
  const match = Object.entries(STATUS_COLORS).find(([k]) => s.includes(k));
  const style = match ? match[1] : { bg: '#F3F4F6', color: '#374151', label: status };
  return (
    <span style={{
      background: style.bg,
      color: style.color,
      padding: '2px 10px',
      borderRadius: '999px',
      fontSize: '11px',
      fontWeight: '600',
      whiteSpace: 'nowrap',
    }}>
      {style.label || status}
    </span>
  );
}

export default function VisitSchedulePage() {
  const visits = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('axiom_pariox_data') || '[]'); } catch { return []; }
  }, []);

  const [regionFilter, setRegionFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [disciplineFilter, setDisciplineFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [expandedClinician, setExpandedClinician] = useState(null);

  const regions = useMemo(() => ['ALL', ...new Set(visits.map(v => v.region).filter(Boolean)).values()].sort(), [visits]);
  const disciplines = useMemo(() => ['ALL', ...new Set(visits.map(v => v.discipline).filter(Boolean)).values()].sort(), [visits]);

  const filtered = useMemo(() => visits.filter(v => {
    if (regionFilter !== 'ALL' && v.region !== regionFilter) return false;
    if (statusFilter !== 'ALL' && !v.status?.toLowerCase().includes(statusFilter.toLowerCase())) return false;
    if (disciplineFilter !== 'ALL' && v.discipline !== disciplineFilter) return false;
    if (search && !v.patient_name?.toLowerCase().includes(search.toLowerCase()) &&
        !v.staff_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [visits, regionFilter, statusFilter, disciplineFilter, search]);

  // Group by clinician
  const byClinician = useMemo(() => {
    const map = {};
    filtered.forEach(v => {
      const key = v.staff_name || 'Unknown';
      if (!map[key]) map[key] = [];
      map[key].push(v);
    });
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  if (visits.length === 0) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Visit Schedule" subtitle="Clinician drill-down from Pariox data" />
      <div style={styles.empty}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📅</div>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No visit data loaded</div>
        <div style={{ color: 'var(--gray)', fontSize: 14 }}>Upload your Pariox visit schedule in Data Uploads</div>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Visit Schedule"
        subtitle={`${filtered.length} visits · ${byClinician.length} clinicians`}
      />
      <div style={{ padding: '20px 28px', flex: 1, overflow: 'auto' }}>

        {/* Filters */}
        <div style={styles.filterRow}>
          <input
            placeholder="Search patient or clinician..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={styles.searchInput}
          />
          <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} style={styles.select}>
            {regions.map(r => <option key={r} value={r}>{r === 'ALL' ? 'All Regions' : `Region ${r}`}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={styles.select}>
            <option value="ALL">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="scheduled">Scheduled</option>
            <option value="missed">Missed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select value={disciplineFilter} onChange={e => setDisciplineFilter(e.target.value)} style={styles.select}>
            {disciplines.map(d => <option key={d} value={d}>{d === 'ALL' ? 'All Disciplines' : d}</option>)}
          </select>
        </div>

        {/* Clinician Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {byClinician.map(([clinician, clinVisits]) => {
            const completed = clinVisits.filter(v => v.status?.toLowerCase().includes('completed')).length;
            const isExpanded = expandedClinician === clinician;
            const region = clinVisits[0]?.region || '?';
            const coordinator = REGIONS[region] || 'Unassigned';

            return (
              <div key={clinician} style={styles.clinicianCard}>
                <div
                  style={styles.clinicianHeader}
                  onClick={() => setExpandedClinician(isExpanded ? null : clinician)}
                >
                  <div style={styles.clinicianLeft}>
                    <div style={styles.clinicianAvatar}>
                      {clinician.split(',')[0]?.[0] || '?'}
                    </div>
                    <div>
                      <div style={styles.clinicianName}>{clinician}</div>
                      <div style={styles.clinicianMeta}>
                        Region {region} · {coordinator} · {clinVisits[0]?.discipline || 'Unknown'}
                      </div>
                    </div>
                  </div>
                  <div style={styles.clinicianRight}>
                    <div style={styles.clinicianStat}>
                      <span style={styles.statNum}>{clinVisits.length}</span>
                      <span style={styles.statLbl}>visits</span>
                    </div>
                    <div style={styles.clinicianStat}>
                      <span style={{ ...styles.statNum, color: 'var(--green)' }}>{completed}</span>
                      <span style={styles.statLbl}>done</span>
                    </div>
                    <div style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</div>
                  </div>
                </div>

                {isExpanded && (
                  <div style={styles.visitTable}>
                    <div style={styles.tableHeader}>
                      <span>Patient</span>
                      <span>Date</span>
                      <span>Time</span>
                      <span>Type</span>
                      <span>Insurance</span>
                      <span>Status</span>
                    </div>
                    {clinVisits.map((v, i) => (
                      <div key={i} style={{ ...styles.tableRow, background: i % 2 === 0 ? 'var(--bg)' : 'var(--card-bg)' }}>
                        <span style={styles.cellName}>{v.patient_name}</span>
                        <span style={styles.cell}>{v.raw_date}</span>
                        <span style={styles.cell}>{v.visit_time}</span>
                        <span style={styles.cell}>{v.event_type}</span>
                        <span style={styles.cell}>{v.insurance}</span>
                        <span style={styles.cell}><StatusPill status={v.status} /></span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const styles = {
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--black)' },
  filterRow: { display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' },
  searchInput: { flex: 1, minWidth: 200, padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--card-bg)', outline: 'none' },
  select: { padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--card-bg)', color: 'var(--black)', outline: 'none' },
  clinicianCard: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' },
  clinicianHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', cursor: 'pointer' },
  clinicianLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  clinicianAvatar: { width: 36, height: 36, borderRadius: '50%', background: 'var(--red)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 },
  clinicianName: { fontSize: 14, fontWeight: 600, color: 'var(--black)' },
  clinicianMeta: { fontSize: 12, color: 'var(--gray)', marginTop: 2 },
  clinicianRight: { display: 'flex', alignItems: 'center', gap: 20 },
  clinicianStat: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  statNum: { fontSize: 18, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--black)' },
  statLbl: { fontSize: 10, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  expandIcon: { fontSize: 10, color: 'var(--gray)', marginLeft: 8 },
  visitTable: { borderTop: '1px solid var(--border)' },
  tableHeader: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', padding: '8px 20px', fontSize: 11, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--bg)' },
  tableRow: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', padding: '10px 20px', alignItems: 'center' },
  cellName: { fontSize: 13, fontWeight: 500, color: 'var(--black)' },
  cell: { fontSize: 12, color: 'var(--gray)' },
};
