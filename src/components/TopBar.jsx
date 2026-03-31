export default function TopBar({ title, subtitle, actions }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  return (
    <div style={styles.bar}>
      <div>
        <h1 style={styles.title}>{title}</h1>
        {subtitle && <p style={styles.subtitle}>{subtitle}</p>}
      </div>
      <div style={styles.right}>
        <span style={styles.date}>{dateStr}</span>
        {actions && <div style={styles.actions}>{actions}</div>}
      </div>
    </div>
  );
}

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 28px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--card-bg)',
    flexShrink: 0,
  },
  title: {
    fontSize: '20px',
    fontWeight: '700',
    color: 'var(--black)',
    letterSpacing: '-0.4px',
  },
  subtitle: {
    fontSize: '13px',
    color: 'var(--gray)',
    marginTop: '2px',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  date: {
    fontSize: '13px',
    color: 'var(--gray)',
    fontFamily: 'DM Mono, monospace',
  },
  actions: {
    display: 'flex',
    gap: '8px',
  },
};
