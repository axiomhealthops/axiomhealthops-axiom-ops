import { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';

export default function DashboardLayout({ activePage, onNavigate, children, alertBadges = {} }) {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Track viewport size so we can collapse the sidebar off-layout on mobile
  useEffect(() => {
    function onResize() {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768) setMobileOpen(false);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const sidebarWidth = collapsed ? 64 : 220;

  // ── MOBILE LAYOUT ──────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', position: 'relative' }}>
        {/* Hamburger button — fixed top-left, above content */}
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          style={{
            position: 'fixed', top: 12, left: 12, zIndex: 1200,
            width: 40, height: 40, borderRadius: 8,
            background: 'var(--card-bg)', border: '1px solid var(--border)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0, fontSize: 18,
          }}
        >☰</button>

        {/* Main content — full width, small top padding so content doesn't sit under hamburger */}
        <main style={{ minHeight: '100vh', paddingTop: 8, display: 'flex', flexDirection: 'column' }}>
          {children}
        </main>

        {/* Slide-in sidebar + backdrop */}
        {mobileOpen && (
          <>
            <div
              onClick={() => setMobileOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1300 }}
            />
            <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 1400, boxShadow: '0 0 20px rgba(0,0,0,0.3)' }}>
              <Sidebar
                activePage={activePage}
                onNavigate={(p) => { onNavigate(p); setMobileOpen(false); }}
                collapsed={false}
                onToggle={() => setMobileOpen(false)}
                alertBadges={alertBadges}
              />
            </div>
          </>
        )}
      </div>
    );
  }

  // ── DESKTOP / TABLET LAYOUT (unchanged from before) ────────────────
  return (
    <div style={styles.root}>
      <Sidebar
        activePage={activePage}
        onNavigate={onNavigate}
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        alertBadges={alertBadges}
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
