import React, { useState, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { REGIONS } from '../../lib/constants';

const STATUS_CONFIG = {
  'Active': { color: '#065F46', bg: '#ECFDF5', border: '#6EE7B7', order: 1 },
  'Active - Auth Pendin': { color: '#1E40AF', bg: '#EFF6FF', border: '#93C5FD', order: 2, label: 'Active - Auth Pending' },
  'Auth Pending': { color: '#92400E', bg: '#FEF3C7', border: '#FCD34D', order: 3 },
  'SOC Pending': { color: '#5B21B6', bg: '#F5F3FF', border: '#C4B5FD', order: 4 },
  'Eval Pending': { color: '#0E7490', bg: '#ECFEFF', border: '#67E8F9', order: 5 },
  'Waitlist': { color: '#374151', bg: '#F9FAFB', border: '#D1D5DB', order: 6 },
  'On Hold': { color: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5', order: 7 },
  'On Hold - Facility': { color: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5', order: 8 },
  'On Hold - MD Request': { color: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5', order: 9 },
  'On Hold - Pt Request': { color: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5', order: 10 },
  'Hospitalized': { color: '#9A3412', bg: '#FFF7ED', border: '#FDBA74', order: 11 },
  'Discharge - Change I': { color: '#6B7280', bg: '#F3F4F6', border: '#D1D5DB', order: 12, label: 'Discharge' },
};

const KANBAN_COLUMNS = [
  { key: 'active', label: 'Active', statuses: ['Active'], color: '#065F46', bg: '#ECFDF5' },
  { key: 'auth', label: 'Auth Issues', statuses: ['Active - Auth Pendin', 'Auth Pending'], color: '#92400E', bg: '#FEF3C7' },
  { key: 'pending', label: 'Pending', statuses: ['SOC Pending', 'Eval Pending'], color: '#5B21B6', bg: '#F5F3FF' },
  { key: 'waitlist', label: 'Waitlist', statuses: ['Waitlist'], color: '#374151', bg: '#F9FAFB' },
  { key: 'hold', label: 'On Hold', statuses: ['On Hold', 'On Hold - Facility', 'On Hold - MD Request', 'On Hold - Pt Request'], color: '#DC2626', bg: '#FEF2F2' },
  { key: 'hospital', label: 'Hospitalized', statuses: ['Hospitalized'], color: '#9A3412', bg: '#FFF7ED' },
  { key: 'discharge', label: 'Discharge', statuses: ['Discharge - Change I'], color: '#6B7280', bg: '#F3F4F6' },
];

function PatientProfile({ patient, visits, onClose }) {
  const patientVisits = visits.filter(v =>
    v.patient_name?.toLowerCase() === patient.patient_name?.toLowerCase()
  );
  const cfg = STATUS_CONFIG[patient.status] || { color: '#374151', bg: '#F9FAFB' };

  return (
    <div style={PS.overlay} onClick={onClose}>
      <div style={PS.panel} onClick={e => e.stopPropagation()}>
        <div style={PS.header}>
          <div style={PS.avatar}>{patient.patient_name?.[0] || '?'}</div>
          <div style={{ flex: 1 }}>
            <div style={PS.name}>{patient.patient_name}</div>
            <div style={PS.meta}>
              Region {patient.region} · {REGIONS[patient.region] || 'Unassigned'} · {patient.insurance || 'No insurance'}
            </div>
          </div>
          <button onClick={onClose} style={PS.closeBtn}>✕</button>
        </div>

        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ ...PS.statusBadge, background: cfg.bg, color: cfg.color }}>
            {patient.status}
          </span>
        </div>

        <div style={PS.statsRow}>
          <div style={PS.statBox}>
            <div style={PS.statVal}>{patientVisits.length}</div>
            <div style={PS.statLbl}>Total Visits</div>
          </div>
          <div style={PS.statBox}>
            <div style={{ ...PS.statVal, color: 'var(--green)' }}>
              {patientVisits.filter(v => v.status?.toLowerCase().includes('completed')).length}
            </div>
            <div style={PS.statLbl}>Completed</div>
          </div>
          <div style={PS.statBox}>
            <div style={{ ...PS.statVal, color: 'var(--blue)' }}>
              {patientVisits.filter(v => v.status?.toLowerCase().includes('scheduled')).length}
            </div>
            <div style={PS.statLbl}>Scheduled</div>
          </div>
        </div>

        <div style={{ padding: '20px 24px' }}>
          <div style={PS.sectionTitle}>Visit History</div>
          {patientVisits.length === 0 ? (
            <div style={{ color: 'var(--gray)', fontSize: 13 }}>No visits on record</div>
          ) : (
            <div style={PS.visitList}>
              {patientVisits.slice(0, 20).map((v, i) => (
                <div key={i} style={PS.visitRow}>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--black)' }}>{v.raw_date}</span>
                  <span style={{ fontSize: 12, color: 'var(--gray)' }}>{v.event_type || v.discipline}</span>
                  <span style={{ fontSize: 12, color: 'var(--gray)' }}>{v.staff_name}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 999,
                    background: v.status?.toLowerCase().includes('completed') ? '#ECFDF5' : '#EFF6FF',
                    color: v.status?.toLowerCase().includes('completed') ? '#065F46' : '#1E40AF',
                  }}>{v.status}</span>
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
  const [view, setView] = useState('kanban');
  const [regionFilter, setRegionFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);

  const census = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('axiom_census') || '[]'); } catch { return []; }
  }, []);

  const visits = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('axiom_pariox_data') || '[]'); } catch { return []; }
  }, []);

  const validRegions = ['A','B','C','G','H','J','M','N','T','V'];

  const filtered = useMemo(() => census.filter(p => {
    if (!validRegions.includes(p.region)) return false;
    if (regionFilter !== 'ALL' && p.region !== regionFilter) return false;
    if (search && !p.patient_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [census, regionFilter, search]);

  const regionSummary = useMemo(() => {
    const map = {};
    census.filter(p => validRegions.includes(p.region)).forEach(p => {
      if (!map[p.region]) map[p.region] = { count: 0, active: 0 };
      map[p.region].count++;
      if (p.status === 'Active') map[p.region].active++;
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [census]);

  const visitMap = useMemo(() => {
    const map = {};
    visits.forEach(v => { if (v.patient_name) map[v.patient_name] = (map[v.patient_name] || 0) + 1; });
    return map;
  }, [visits]);

  const totalValid = census.filter(p => validRegions.includes(p.region)).length;

  if (census.length === 0) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Patient Census" subtitle="Census Kanban by Status" />
      <div style={S.empty}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>👥</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>No census data loaded</div>
        <div style={{ color: 'var(--gray)', fontSize: 14, marginTop: 8 }}>Upload your Pariox census in Data Uploads</div>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {selectedPatient && (
        <PatientProfile patient={selectedPatient} visits={visits} onClose={() => setSelectedPatient(null)} />
      )}
      <TopBar
        title="Patient Census"
        subtitle={`${filtered.length} patients · ${regionFilter === 'ALL' ? 'All Regions' : `Region ${regionFilter}`}`}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setView('kanban')} style={{ ...S.viewBtn, ...(view === 'kanban' ? S.viewBtnActive : {}) }}>Kanban</button>
            <button onClick={() => setView('list')} style={{ ...S.viewBtn, ...(view === 'list' ? S.viewBtnActive : {}) }}>List</button>
          </div>
        }
      />

      <div style={{ padding: '16px 28px 8px', flex: 1, overflow: 'auto' }}>
        {/* Region filter row */}
        <div style={S.regionRow}>
          <div
            onClick={() => setRegionFilter('ALL')}
            style={{ ...S.regionCard, border: regionFilter === 'ALL' ? '2px solid var(--red)' : '1px solid var(--border)' }}
          >
            <div style={S.regionLabel}>ALL</div>
            <div style={S.regionCount}>{totalValid}</div>
          </div>
          {regionSummary.map(([r, data]) => (
            <div
              key={r}
              onClick={() => setRegionFilter(regionFilter === r ? 'ALL' : r)}
              style={{ ...S.regionCard, border: regionFilter === r ? '2px solid var(--red)' : '1px solid var(--border)' }}
            >
              <div style={S.regionLabel}>Region {r}</div>
              <div style={S.regionCount}>{data.count}</div>
              <div style={S.regionActive}>{data.active} active</div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div style={{ marginBottom: 16 }}>
          <input
            placeholder="Search patient name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={S.search}
          />
        </div>

        {/* KANBAN VIEW */}
        {view === 'kanban' && (
          <div style={S.kanban}>
            {KANBAN_COLUMNS.map(col => {
              const patients = filtered.filter(p => col.statuses.includes(p.status))
                .sort((a, b) => (a.patient_name || '').localeCompare(b.patient_name || ''));
              return (
                <div key={col.key} style={S.column}>
                  <div style={{ ...S.colHeader, background: col.bg }}>
                    <span style={{ ...S.colTitle, color: col.color }}>{col.label}</span>
                    <span style={{ ...S.colCount, background: col.color }}>{patients.length}</span>
                  </div>
                  <div style={S.colBody}>
                    {patients.length === 0 ? (
                      <div style={S.colEmpty}>—</div>
                    ) : patients.map((p, i) => (
                      <div
                        key={i}
                        style={S.patientCard}
                        onClick={() => setSelectedPatient(p)}
                      >
                        <div style={S.patientName}>{p.patient_name}</div>
                        <div style={S.patientMeta}>
                          <span style={S.regionPill}>R{p.region}</span>
                          <span style={S.insurance}>{p.insurance || '—'}</span>
                        </div>
                        {visitMap[p.patient_name] > 0 && (
                          <div style={S.visitCount}>{visitMap[p.patient_name]} visits</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* LIST VIEW */}
        {view === 'list' && (
          <div style={S.table}>
            <div style={S.tableHeader}>
              <span>Patient Name</span>
              <span>Region</span>
              <span>Coordinator</span>
              <span>Status</span>
              <span>Insurance</span>
              <span>Visits</span>
            </div>
            {filtered
              .sort((a, b) => {
                if (a.region !== b.region) return (a.region || '').localeCompare(b.region || '');
                return (a.patient_name || '').localeCompare(b.patient_name || '');
              })
              .map((p, i) => {
                const cfg = STATUS_CONFIG[p.status] || { color: '#374151', bg: '#F9FAFB' };
                return (
                  <div
                    key={i}
                    style={{ ...S.tableRow, background: i % 2 === 0 ? 'var(--bg)' : 'var(--card-bg)', cursor: 'pointer' }}
                    onClick={() => setSelectedPatient(p)}
                  >
                    <span style={S.cellName}>{p.patient_name}</span>
                    <span style={S.cell}><span style={S.regionBadge}>Region {p.region}</span></span>
                    <span style={S.cell}>{REGIONS[p.region] || '—'}</span>
                    <span style={S.cell}>
                      <span style={{ background: cfg.bg, color: cfg.color, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                        {STATUS_CONFIG[p.status]?.label || p.status}
                      </span>
                    </span>
                    <span style={S.cell}>{p.insurance || '—'}</span>
                    <span style={{ ...S.cell, fontFamily: 'DM Mono, monospace', fontWeight: 600, color: 'var(--black)' }}>
                      {visitMap[p.patient_name] || 0}
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}

const S = {
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  viewBtn: { padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'none', color: 'var(--gray)', cursor: 'pointer' },
  viewBtnActive: { background: 'var(--black)', color: '#fff', borderColor: 'var(--black)', fontWeight: 600 },
  regionRow: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  regionCard: { background: 'var(--card-bg)', borderRadius: 8, padding: '10px 14px', minWidth: 80, cursor: 'pointer', transition: 'all 0.15s' },
  regionLabel: { fontSize: 9, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 },
  regionCount: { fontSize: 22, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--black)', lineHeight: 1 },
  regionActive: { fontSize: 10, color: 'var(--green)', marginTop: 2, fontWeight: 600 },
  search: { width: '100%', padding: '9px 14px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--card-bg)', outline: 'none' },
  kanban: { display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16, alignItems: 'flex-start' },
  column: { minWidth: 200, maxWidth: 220, background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--border)', flexShrink: 0 },
  colHeader: { padding: '10px 14px', borderRadius: '10px 10px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' },
  colTitle: { fontSize: 12, fontWeight: 700 },
  colCount: { color: '#fff', borderRadius: 999, padding: '1px 7px', fontSize: 11, fontWeight: 700 },
  colBody: { padding: 8, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '70vh', overflowY: 'auto' },
  colEmpty: { textAlign: 'center', color: 'var(--light-gray)', fontSize: 13, padding: '20px 0' },
  patientCard: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', transition: 'box-shadow 0.15s' },
  patientName: { fontSize: 12, fontWeight: 600, color: 'var(--black)', marginBottom: 5, lineHeight: 1.3 },
  patientMeta: { display: 'flex', alignItems: 'center', gap: 6 },
  regionPill: { fontSize: 10, fontWeight: 700, background: 'var(--border)', color: 'var(--gray)', borderRadius: 4, padding: '1px 5px' },
  insurance: { fontSize: 10, color: 'var(--gray)' },
  visitCount: { fontSize: 10, color: 'var(--blue)', fontWeight: 600, marginTop: 4 },
  table: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' },
  tableHeader: { display: 'grid', gridTemplateColumns: '2.5fr 0.8fr 1.5fr 1.5fr 1.2fr 0.6fr', padding: '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--bg)', borderBottom: '1px solid var(--border)' },
  tableRow: { display: 'grid', gridTemplateColumns: '2.5fr 0.8fr 1.5fr 1.5fr 1.2fr 0.6fr', padding: '11px 20px', alignItems: 'center', borderBottom: '1px solid var(--border)' },
  cellName: { fontSize: 13, fontWeight: 500, color: 'var(--red)', cursor: 'pointer' },
  cell: { fontSize: 12, color: 'var(--gray)' },
  regionBadge: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, color: 'var(--black)' },
};

const PS = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' },
  panel: { width: 520, height: '100vh', background: 'var(--card-bg)', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)' },
  header: { display: 'flex', alignItems: 'center', gap: 14, padding: '24px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--card-bg)', zIndex: 1 },
  avatar: { width: 44, height: 44, borderRadius: '50%', background: 'var(--red)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, flexShrink: 0 },
  name: { fontSize: 16, fontWeight: 700, color: 'var(--black)' },
  meta: { fontSize: 12, color: 'var(--gray)', marginTop: 3 },
  closeBtn: { background: 'none', border: 'none', color: 'var(--gray)', fontSize: 18, cursor: 'pointer', padding: 4 },
  statusBadge: { padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600 },
  statsRow: { display: 'flex', borderBottom: '1px solid var(--border)' },
  statBox: { flex: 1, padding: 20, textAlign: 'center', borderRight: '1px solid var(--border)' },
  statVal: { fontSize: 26, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--black)' },
  statLbl: { fontSize: 11, color: 'var(--gray)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.05em' },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 },
  visitList: { border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' },
  visitRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', padding: '10px 14px', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', fontSize: 12 },
};
