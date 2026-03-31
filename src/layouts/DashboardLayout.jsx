import { useState } from 'react';
import Sidebar from '../components/Sidebar';

export default function DashboardLayout({ activePage, onNavigate, children }) {
  const [collapsed, setCollapsed] = useState(false);
  const sidebarWidth = collapsed ? 64 : 220;

  return (
    <div style={styles.root}>
      <Sidebar
        activePage={activePage}
        onNavigate={onNavigate}
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
      />
      <main style={{
        ...styles.main,
        marginLeft: sidebarWidth,
        transition: 'margin-left 0.2s ease',
      }}>
        {children}
      </main>
    </div>
  );
}

const styles = {
  root: {
    display: 'flex',
    minHeight: '100vh',
    background: 'var(--bg)',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    overflow: 'auto',
  },
};
