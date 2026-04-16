import { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';

var WHATS_NEW = [
  'AI Doc Extractor save bug fixed — notes column added',
  'Modal escape: Esc key + click-outside now close intake & AI modals',
  'KPI tiles are now clickable on RM Daily, Clinician Accountability, Director, Productivity dashboards',
  'Auth Tracker + Auth Coordinator: KPI tiles clickable, modals hardened',
];

function WhatsNewBanner({ onDismiss }) {
  return (
    <div style={{ background:'#EFF6FF', borderBottom:'2px solid #BFDBFE', padding:'8px 20px', display:'flex', alignItems:'center', gap:12, fontSize:12, flexShrink:0, zIndex:50 }}>
      <span style={{ fontSize:14, flexShrink:0 }}>🆕</span>
      <div style={{ flex:1, display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
        <span style={{ fontWeight:700, color:'#1E40AF', marginRight:4 }}>What's new:</span>
        {WHATS_NEW.map(function(item, i) {
          return (
            <span key={i} style={{ background:'#DBEAFE', color:'#1E40AF', padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:500, whiteSpace:'nowrap' }}>
              {item}
            </span>
          );
        })}
      </div>
      <button onClick={onDismiss}
        style={{ background:'none', border:'none', fontSize:16, color:'#93C5FD', cursor:'pointer', padding:'0 4px', flexShrink:0 }}
        title="Dismiss for this session">×</button>
    </div>
  );
}

export default function DashboardLayout({ activePage, onNavigate, children, alertBadges = {} }) {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

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

        {/* What's new banner */}
        {!bannerDismissed && <div style={{ paddingTop: 52 }}><WhatsNewBanner onDismiss={() => setBannerDismissed(true)} /></div>}

        {/* Main content — full width, small top padding so content doesn't sit under hamburger */}
        <main style={{ minHeight: '100vh', paddingTop: bannerDismissed ? 8 : 0, display: 'flex', flexDirection: 'column' }}>
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
        {!bannerDismissed && <WhatsNewBanner onDismiss={() => setBannerDismissed(true)} />}
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
