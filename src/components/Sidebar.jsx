import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

// Sidebar sections in the correct flow order
const ALL_SECTIONS = [
  { key: 'OVERVIEW',       label: 'OVERVIEW' },
  { key: 'INTAKE',         label: 'INTAKE' },
  { key: 'PATIENTS',       label: 'PATIENTS' },
  { key: 'AUTHORIZATION',  label: 'AUTHORIZATION' },
  { key: 'COORDINATION',   label: 'CARE COORDINATION' },
  { key: 'CLINICAL',       label: 'CLINICAL' },
  { key: 'PERFORMANCE',    label: 'PERFORMANCE' },
  { key: 'OPERATIONS',     label: 'OPERATIONS' },
  { key: 'ADMIN',          label: 'ADMIN' },
];

const PAGE_ICONS = {
  overview: '◈', alerts: '⚡', actions: '✓',
  intake: '📥',
  census: '👥', visits: '📅', 'on-hold': '⏸',
  auth: '🔐',
  'coordinator-portal': '👩‍💼',
  productivity: '📊', revenue: '💰', growth: '📈', scorecard: '🎯',
  staff: '👤', regions: '🗺', 'daily-reports': '📋', 'exec-report': '📊', reports: '📤', 'rm-dashboard': '🎯', hospitalizations: '🏥', 'missed-cancelled': '📉', 'my-region': '🗺', 'medicare-tracker': '🏥', 'marketing-crm': '📣', 'waitlist': '⏳',
  users: '👥', uploads: '↑', settings: '⚙',
};

export default function Sidebar({ activePage, onNavigate, collapsed, onToggle, alertBadges = {} }) {
  const { profile, canAccess, signOut } = useAuth();
  const [navItems, setNavItems] = useState([]);

  useEffect(() => {
    loadNav();
  }, [profile]);

  async function loadNav() {
    const { data: pages } = await supabase
      .from('page_permissions')
      .select('*')
      .order('sort_order');
    if (!pages) return;

    // Filter to what this user can access
    const role = profile?.role;
    const accessible = pages.filter(p => {
      if (role === 'super_admin') return p.super_admin;
      if (role === 'ceo') return p.super_admin;
      if (role === 'admin') return p.admin;
      if (role === 'regional_manager') return p.regional_manager; // RM has own restricted pages
      if (role === 'pod_leader') return p.pod_leader;
      if (role === 'team_member') return p.team_member;
      return false;
    });

    // Group by section
    const grouped = {};
    accessible.forEach(p => {
      if (!grouped[p.page_section]) grouped[p.page_section] = [];
      grouped[p.page_section].push(p);
    });

    const sections = ALL_SECTIONS
      .filter(s => grouped[s.key] && grouped[s.key].length > 0)
      .map(s => ({ ...s, items: grouped[s.key] }));

    setNavItems(sections);
  }

  const roleLabel = {
    super_admin: 'Super Admin',
    ceo: 'CEO',
    admin: 'Admin',
    regional_manager: 'Regional Manager',
    admin: 'Admin',
    pod_leader: 'Pod Leader',
    team_member: 'Team Member',
  }[profile?.role] || '';

  return (
    <div style={{ ...S.sidebar, width: collapsed ? 64 : 220 }}>
      {/* Logo */}
      <div style={S.header}>
        <img src="/logo.png" alt="AHM" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'contain', flexShrink: 0, background: 'transparent' }} />
        {!collapsed && (
          <div style={S.logoText}>
            <div style={S.logoTitle}>AxiomHealth</div>
            <div style={S.logoSub}>Operations</div>
          </div>
        )}
        <button onClick={onToggle} style={S.collapseBtn}>{collapsed ? '→' : '←'}</button>
      </div>

      {/* Nav */}
      <nav style={S.nav}>
        {navItems.map(section => (
          <div key={section.key} style={S.section}>
            {!collapsed && <div style={S.sectionLabel}>{section.label}</div>}
            {section.items.map(item => {
              const active = activePage === item.page_key;
              return (
                <button key={item.page_key}
                  onClick={() => onNavigate(item.page_key)}
                  title={collapsed ? item.page_label : undefined}
                  style={{ ...S.navItem, ...(active ? S.navItemActive : {}) }}>
                  <span style={S.navIcon}>{PAGE_ICONS[item.page_key] || '·'}</span>
                  {!collapsed && <span style={S.navLabel}>{item.page_label}</span>}
                  {!collapsed && alertBadges[item.page_key] > 0 && (
                    <span style={{ marginLeft:'auto', fontSize:10, fontWeight:800, background:'#DC2626', color:'#fff', borderRadius:999, padding:'1px 7px', minWidth:18, textAlign:'center' }}>
                      {alertBadges[item.page_key] > 99 ? '99+' : alertBadges[item.page_key]}
                    </span>
                  )}
                  {collapsed && alertBadges[item.page_key] > 0 && (
                    <span style={{ position:'absolute', top:4, right:4, width:8, height:8, background:'#DC2626', borderRadius:'50%' }} />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={S.footer}>
        {!collapsed && (
          <div style={S.userInfo}>
            <div style={S.userName}>{profile?.full_name || 'User'}</div>
            <div style={S.userRole}>{roleLabel}</div>
          </div>
        )}
        <button onClick={signOut} title="Sign out" style={S.signOutBtn}>⎋</button>
      </div>
    </div>
  );
}

const S = {
  sidebar: { height: '100vh', background: '#0F1117', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden', borderRight: '1px solid #1E2535', position: 'fixed', top: 0, left: 0, zIndex: 100, transition: 'width 0.2s ease' },
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '16px 12px', borderBottom: '1px solid #1E2535', minHeight: 64 },
  logoMark: { width: 32, height: 32, borderRadius: 8, background: '#D94F2B', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, flexShrink: 0 },
  logoText: { flex: 1, minWidth: 0 },
  logoTitle: { fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '-0.2px', whiteSpace: 'nowrap' },
  logoSub: { fontSize: 10, color: '#4B5563', marginTop: 1 },
  collapseBtn: { background: 'none', border: 'none', color: '#4B5563', fontSize: 14, cursor: 'pointer', padding: 4, flexShrink: 0, marginLeft: 'auto' },
  nav: { flex: 1, overflowY: 'auto', padding: '8px 0' },
  section: { marginBottom: 4 },
  sectionLabel: { fontSize: 9, fontWeight: 600, color: '#374151', letterSpacing: '0.08em', padding: '8px 14px 4px', textTransform: 'uppercase' },
  navItem: { position:'relative', width: 'calc(100% - 8px)', display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', background: 'none', border: 'none', color: '#6B7280', fontSize: 13, fontWeight: 400, cursor: 'pointer', textAlign: 'left', borderRadius: 6, margin: '1px 4px' },
  navItemActive: { background: '#161B26', color: '#fff', fontWeight: 500 },
  navIcon: { fontSize: 13, flexShrink: 0, width: 18, textAlign: 'center' },
  navLabel: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  footer: { borderTop: '1px solid #1E2535', padding: 12, display: 'flex', alignItems: 'center', gap: 8 },
  userInfo: { flex: 1, minWidth: 0 },
  userName: { fontSize: 12, fontWeight: 600, color: '#D1D5DB', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  userRole: { fontSize: 10, color: '#4B5563', marginTop: 1 },
  signOutBtn: { background: 'none', border: 'none', color: '#4B5563', fontSize: 16, cursor: 'pointer', padding: 4, flexShrink: 0 },
};
