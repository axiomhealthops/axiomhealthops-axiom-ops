import TopBar from '../../components/TopBar';
import StatCard from '../../components/StatCard';
import { useAuth } from '../../hooks/useAuth';
import { METRICS } from '../../lib/constants';

export default function OverviewPage() {
  const { profile } = useAuth();

  // Pull from localStorage if available
  const raw = localStorage.getItem('axiom_pariox_data');
  const visits = raw ? JSON.parse(raw) : [];
  const completedVisits = visits.filter(v => {
  const s = v.status?.toLowerCase() || '';
  return s.includes('completed') || s.includes('eform') || s === '';
}).length;

const scheduledVisits = visits.filter(v => {
  const s = v.status?.toLowerCase() || '';
  return s.includes('scheduled');
}).length;

const totalVisits = visits.length;
  const pct = Math.round((completedVisits / METRICS.WEEKLY_VISIT_TARGET) * 100);

  const census = (() => {
    try { return JSON.parse(localStorage.getItem('axiom_census') || '[]'); } catch { return []; }
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Operations Overview"
        subtitle={`Welcome back, ${profile?.full_name?.split(' ')[0] || 'Director'}`}
      />

      <div style={{ padding: '28px', flex: 1 }}>
        {/* KPI Row */}
        <div style={styles.statRow}>
          <StatCard
            label="Visits This Week"
            value={completedVisits.toLocaleString()}
            sub={`Target: ${METRICS.WEEKLY_VISIT_TARGET.toLocaleString()}`}
            color={completedVisits >= METRICS.WEEKLY_VISIT_TARGET ? 'var(--green)' : 'var(--red)'}
          />
          <StatCard
            label="Visit Target %"
            value={`${pct}%`}
            sub={pct >= 100 ? '✓ Target met' : `${METRICS.WEEKLY_VISIT_TARGET - completedVisits} remaining`}
            color={pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--danger)'}
          />
          <StatCard
            label="Active Census"
            value={census.length > 0 ? census.length.toLocaleString() : '—'}
            sub={`Target: ${METRICS.CENSUS_TARGET}`}
          />
          <StatCard
            label="Est. Revenue"
            value={`$${(completedVisits * METRICS.AVG_REIMBURSEMENT).toLocaleString()}`}
            sub={`Target: $${METRICS.REVENUE_TARGET.toLocaleString()}/wk`}
            color="var(--blue)"
          />
        </div>

        {/* Progress Bar */}
        <div style={styles.progressCard}>
          <div style={styles.progressHeader}>
            <span style={styles.progressLabel}>Weekly Visit Progress</span>
            <span style={styles.progressPct}>{completedVisits} / {METRICS.WEEKLY_VISIT_TARGET}</span>
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
              : `${pct}% of weekly target achieved`}
          </div>
        </div>

        {/* Empty state when no data */}
        {visits.length === 0 && (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>📂</div>
            <div style={styles.emptyTitle}>No data loaded</div>
            <div style={styles.emptySub}>
              Go to <strong>Data Uploads</strong> in the sidebar to upload your Pariox visit schedule and patient census files.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  statRow: {
    display: 'flex',
    gap: '16px',
    marginBottom: '24px',
    flexWrap: 'wrap',
  },
  progressCard: {
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '24px',
  },
  progressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  progressLabel: {
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--black)',
  },
  progressPct: {
    fontSize: '14px',
    fontFamily: 'DM Mono, monospace',
    color: 'var(--gray)',
  },
  progressTrack: {
    height: '10px',
    background: 'var(--border)',
    borderRadius: '999px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: '999px',
    transition: 'width 0.4s ease',
  },
  progressSub: {
    fontSize: '12px',
    color: 'var(--gray)',
    marginTop: '8px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 40px',
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
  },
  emptyIcon: { fontSize: '40px', marginBottom: '16px' },
  emptyTitle: { fontSize: '18px', fontWeight: '600', color: 'var(--black)', marginBottom: '8px' },
  emptySub: { fontSize: '14px', color: 'var(--gray)', maxWidth: '400px', margin: '0 auto', lineHeight: 1.6 },
};
