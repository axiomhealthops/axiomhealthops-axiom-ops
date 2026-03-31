import React from 'react';
import TopBar from '../../components/TopBar';
import { EXPANSION } from '../../lib/constants';

const STATUS_COLORS = {
  'In Progress': { bg: '#EFF6FF', color: '#1E40AF', dot: '#3B82F6' },
  'Planning': { bg: '#FEF3C7', color: '#92400E', dot: '#F59E0B' },
  'Live': { bg: '#ECFDF5', color: '#065F46', dot: '#10B981' },
};

export default function ExpansionPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Expansion Tracker" subtitle="Georgia · Texas · North Carolina" />
      <div style={{ padding: '28px', flex: 1, overflow: 'auto' }}>
        <div style={styles.grid}>
          {EXPANSION.map(state => {
            const s = STATUS_COLORS[state.status] || STATUS_COLORS['Planning'];
            return (
              <div key={state.state} style={styles.card}>
                <div style={styles.cardHeader}>
                  <div>
                    <div style={styles.stateName}>{state.state}</div>
                    <div style={styles.target}>Target: {state.target}</div>
                  </div>
                  <div style={{ ...styles.statusBadge, background: s.bg, color: s.color }}>
                    <span style={{ ...styles.dot, background: s.dot }} />
                    {state.status}
                  </div>
                </div>
                <div style={styles.progressSection}>
                  <div style={styles.progressLabel}>
                    <span>Credentialing Progress</span>
                    <span style={styles.progressPct}>{state.credentialing}%</span>
                  </div>
                  <div style={styles.progressTrack}>
                    <div style={{
                      ...styles.progressFill,
                      width: `${state.credentialing}%`,
                      background: state.credentialing >= 80 ? '#10B981' : state.credentialing >= 40 ? '#F59E0B' : '#3B82F6',
                    }} />
                  </div>
                </div>
                <div style={styles.statsRow}>
                  <div style={styles.statItem}>
                    <div style={styles.statVal}>{state.staffHired}</div>
                    <div style={styles.statLbl}>Staff Hired</div>
                  </div>
                  <div style={styles.statItem}>
                    <div style={styles.statVal}>{state.credentialing}%</div>
                    <div style={styles.statLbl}>Credentialed</div>
                  </div>
                  <div style={styles.statItem}>
                    <div style={styles.statVal}>{state.target}</div>
                    <div style={styles.statLbl}>Go-Live</div>
                  </div>
                </div>
                <div style={styles.milestones}>
                  <div style={styles.milestonesTitle}>Milestones</div>
                  {[
                    { label: 'Entity Formation', done: true },
                    { label: 'Medicaid Application', done: state.credentialing >= 20 },
                    { label: 'Staff Credentialing', done: state.credentialing >= 50 },
                    { label: 'First Patient', done: state.credentialing >= 80 },
                    { label: 'Full Operations', done: state.status === 'Live' },
                  ].map(m => (
                    <div key={m.label} style={styles.milestone}>
                      <span style={{ color: m.done ? '#10B981' : 'var(--border)', fontSize: 14 }}>{m.done ? '✓' : '○'}</span>
                      <span style={{ fontSize: 13, color: m.done ? 'var(--black)' : 'var(--gray)', marginLeft: 8 }}>{m.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const styles = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 },
  card: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 14, padding: 24 },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  stateName: { fontSize: 20, fontWeight: 700, color: 'var(--black)', letterSpacing: '-0.3px' },
  target: { fontSize: 12, color: 'var(--gray)', marginTop: 2 },
  statusBadge: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600 },
  dot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  progressSection: { marginBottom: 20 },
  progressLabel: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--gray)', marginBottom: 6 },
  progressPct: { fontFamily: 'DM Mono, monospace', fontWeight: 600 },
  progressTrack: { height: 8, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999, transition: 'width 0.4s ease' },
  statsRow: { display: 'flex', gap: 16, marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--border)' },
  statItem: { flex: 1, textAlign: 'center' },
  statVal: { fontSize: 22, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--black)' },
  statLbl: { fontSize: 11, color: 'var(--gray)', marginTop: 2 },
  milestones: {},
  milestonesTitle: { fontSize: 11, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 },
  milestone: { display: 'flex', alignItems: 'center', marginBottom: 7 },
};
