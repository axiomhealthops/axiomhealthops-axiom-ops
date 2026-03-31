import React from 'react';
import TopBar from '../../components/TopBar';
import StatCard from '../../components/StatCard';
import { useAuth } from '../../hooks/useAuth.jsx';
import { METRICS } from '../../lib/constants';

export default function OverviewPage() {
  const { profile } = useAuth();

  const visits = (() => {
    try { return JSON.parse(localStorage.getItem('axiom_pariox_data') || '[]'); } catch { return []; }
  })();

  const census = (() => {
    try { return JSON.parse(localStorage.getItem('axiom_census') || '[]'); } catch { return []; }
  })();

  const completedVisits = visits.filter(v =>
    v.status?.toLowerCase().includes('completed')
  ).length;

  const scheduledVisits = visits.filter(v =>
    v.status?.toLowerCase().includes('scheduled')
  ).length;

  const totalVisits = visits.length;
  const pct = Math.round((totalVisits / METRICS.WEEKLY_VISIT_TARGET) * 100);
  const estRevenue = completedVisits * METRICS.AVG_REIMBURSEMENT;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Operations Overview"
        subtitle={`Welcome back, ${profile?.full_name?.split(' ')[0] || 'Director'}`}
      />

      <div style={{ padding: '28px', flex: 1 }}>
        <div style={styles.statRow}>
          <StatCard
            label="Visits This Week"
            value={totalVisits.toLocaleString()}
            sub={`${completedVisits} completed · ${scheduledVisits} scheduled`}
            color={totalVisits >= METRICS.WEEKLY_VISIT_TARGET ? 'var(--green)' : 'var(--red)'}
          />
          <StatCard
            label="Visit Target %"
            value={`${pct}%`}
            sub={pct >= 100 ? '✓ Target met' : `${METRICS.WEEKLY_VISIT_TARGET - totalVisits} remaining`}
            color={pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--danger)'}
          />
          <StatCard
            label="Active Census"
            value={census.length > 0 ? census.length.toLocaleString() : '—'}
            sub={`Target: ${METRICS.CENSUS_TARGET}`}
            color={census.length >= METRICS.CENSUS_TARGET ? 'var(--green)' : 'var(--black)'}
          />
          <StatCard
            label="Est. Revenue"
            value={`$${estRevenue.toLocaleString()}`}
            sub={`Target: $${METRICS.REVENUE_TARGET.toLocaleString()}/wk`}
            color="var(--blue)"
          />
        </div>

        <div style={styles.progressCard}>
          <div style={styles.progressHeader}>
            <span style={styles.progressLabel}>Weekly Visit Progress</span>
            <span style={styles.progressPct}>{totalVisits} / {METRICS.WEEKLY_VISIT_TARGET}</span>
          </div>
          <div style={styles.progressTrack}>
            <div style={{
              ...styles.progressFill,
              width: `${Math.min(pct, 100)}%`,
              background: pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--red)',
            }} />
          </div>
          <div style={styles.progressSub}>
            {visits.length === 0
              ? '⬆ Upload your Pariox data to populate this dashboard'
              : `${pct}% of weekly target — ${completedVisits} completed, ${scheduledVisits} scheduled`}
          </div>
        </div>

        {/* Region breakdown */}
        {visits.length > 0 && (
          <div style={styles.regionCard}>
            <div style={styles.regionTitle}>Visits by Region</div>
            <div style={styles.regionGrid}>
              {Object.entries(
                visits.reduce((acc, v) => {
                  const r = v.region || 'Unknown';
                  acc[r] = (acc[r] || 0) + 1;
                  return acc;
                }, {})
              ).sort((a, b) => b[1] - a[1]).map(([region, count]) => (
                <div key={region} style={styles.regionItem}>
                  <div style={styles.regionName}>Region {region}</div>
                  <div style={styles.regionCount}>{count}</div>
                  <div style={styles.regionBar}>
                    <div style={{
                      ...styles.regionBarFill,
                      width: `${Math.min((count / Math.max(...Object.values(visits.reduce((acc, v) => {
                        const r = v.region || 'Unknown';
                        acc[r] = (acc[r] || 0) + 1;
                        return acc;
                      }, {})))) * 100, 100)}%`
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  statRow: { display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' },
  progressCard: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '24px', marginBottom: '24px' },
  progressHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  progressLabel: { fontSize: '14px', fontWeight: '600', color: 'var(--black)' },
  progressPct: { fontSize: '14px', fontFamily: 'DM Mono, monospace', color: 'var(--gray)' },
  progressTrack: { height: '10px', background: 'var(--border)', borderRadius: '999px', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: '999px', transition: 'width 0.4s ease' },
  progressSub: { fontSize: '12px', color: 'var(--gray)', marginTop: '8px' },
  regionCard: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '24px' },
  regionTitle: { fontSize: '14px', fontWeight: '600', color: 'var(--black)', marginBottom: '16px' },
  regionGrid: { display: 'flex', flexDirection: 'column', gap: '10px' },
  regionItem: { display: 'grid', gridTemplateColumns: '80px 60px 1fr', alignItems: 'center', gap: '12px' },
  regionName: { fontSize: '13px', fontWeight: '500', color: 'var(--black)' },
  regionCount: { fontSize: '13px', fontFamily: 'DM Mono, monospace', color: 'var(--gray)', textAlign: 'right' },
  regionBar: { height: '6px', background: 'var(--border)', borderRadius: '999px', overflow: 'hidden' },
  regionBarFill: { height: '100%', background: 'var(--red)', borderRadius: '999px' },
};
