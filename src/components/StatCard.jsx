export default function StatCard({ label, value, sub, color, mono = true }) {
  return (
    <div style={styles.card}>
      <div style={styles.label}>{label}</div>
      <div style={{
        ...styles.value,
        color: color || 'var(--black)',
        fontFamily: mono ? 'DM Mono, monospace' : 'DM Sans, sans-serif',
      }}>
        {value}
      </div>
      {sub && <div style={styles.sub}>{sub}</div>}
    </div>
  );
}

const styles = {
  card: {
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '20px 24px',
    flex: 1,
    minWidth: '160px',
  },
  label: {
    fontSize: '12px',
    fontWeight: '500',
    color: 'var(--gray)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: '8px',
  },
  value: {
    fontSize: '28px',
    fontWeight: '600',
    letterSpacing: '-0.5px',
    lineHeight: 1,
  },
  sub: {
    fontSize: '12px',
    color: 'var(--gray)',
    marginTop: '6px',
  },
};
