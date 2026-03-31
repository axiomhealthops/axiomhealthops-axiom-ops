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

  const filtered
