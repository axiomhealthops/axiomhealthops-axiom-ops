import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
 
const NAV_ITEMS = [
  { section: 'OVERVIEW', items: [
    { id: 'overview',    label: 'Overview',        icon: '\u2B21' },
    { id: 'alerts',      label: 'Live Alerts',     icon: '\u26A1' },
    { id: 'actions',     label: 'Action List',     icon: '\u2713' },
  ]},
  { section: 'INTAKE', items: [
    { id: 'intake',      label: 'Intake Dashboard',icon: '\uD83D\uDCE5' },
  ]},
  { section: 'PATIENTS', items: [
    { id: 'census',      label: 'Patient Census',  icon: '\uD83D\uDC65' },
    { id: 'visits',      label: 'Visit Schedule',  icon: '\uD83D\uDCC5' },
    { id: 'on-hold',     label: 'On-Hold Recovery',icon: '\u23F8' },
    { id: 'auth',        label: 'Auth Tracker',    icon: '\uD83D\uDD10' },
  ]},
  { section: 'PERFORMANCE', items: [
    { id: 'productivity',label: 'Productivity',    icon: '\uD83D\uDCCA' },
    { id: 'revenue',     label: 'Revenue',         icon: '\uD83D\uDCB0' },
    { id: 'growth',      label: 'Growth Tracker',  icon: '\uD83D\uDCC8' },
    { id: 'scorecard',   label: 'Scorecard',       icon: '\uD83C\uDFAF' },
  ]},
  { section: 'OPERATIONS', items: [
    { id: 'staff',       label: 'Staff Directory', icon: '\uD83D\uDC64' },
    { id: 'regions',     label: 'Regions',         icon: '\uD83D\uDDFA' },
    { id: 'expansion',   label: 'Expansion',       icon: '\uD83D\uDE80' },
    { id: 'daily-reports',label:'Daily Reports',   icon: '\uD83D\uDCCB' },
    { id: 'exec-report', label: 'Executive Report',icon: '\uD83D\uDCCA' },
  ]},
  { section: 'COORDINATOR', items: [
    { id: 'coordinator-portal', label: 'Coordinator Portal', icon: '\uD83D\uDC69\u200D\uD83D\uDCBC' },
  ]},
  { section: 'ADMIN', items: [
    { id: 'users',       label: 'User Management', icon: '\uD83D\uDC65' },
    { id: 'uploads',     label: 'Data Uploads',    icon: '\u2B06' },
    { id: 'settings',    label: 'Settings',        icon: '\uD83D\uDD27' },
  ]},
];
 
export default function Sidebar({ activePage, onNavigate, collapsed, onToggle }) {
  const { profile, signOut } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
 
  return (
    <div style={{ ...styles.sidebar, width: collapsed ? '64px' : '220px', transition: 'width 0.2s ease' }}>
      <div style={styles.header}>
        <div style={styles.logoMark}>A</div>
        {!collapsed && (
          <div style={styles.logoText}>
            <div style={styles.logoTitle}>AxiomHealth</div>
            <div style={styles.logoSub}>Operations</div>
          </div>
        )}
        <button onClick={onToggle} style={styles.collapseBtn}>{collapsed ? '\u2192' : '\u2190'}</button>
      </div>
 
      <nav style={styles.nav}>
        {NAV_ITEMS.map(section => {
          const items = section.section === 'ADMIN'
            ? section.items.filter(item => isSuperAdmin || !['users'].includes(item.id))
            : section.items;
          return (
            <div key={section.section} style={styles.section}>
              {!collapsed && <div style={styles.sectionLabel}>{section.section}</div>}
              {items.map(item => (
                <button key={item.id} onClick={() => onNavigate(item.id)}
                  title={collapsed ? item.label : undefined}
                  style={{ ...styles.navItem, ...(activePage === item.id ? styles.navItemActive : {}) }}>
                  <span style={styles.navIcon}>{item.icon}</span>
                  {!collapsed && <span style={styles.navLabel}>{item.label}</span>}
                </button>
              ))}
            </div>
          );
        })}
      </nav>
 
      <div style={styles.footer}>
        {!collapsed && (
          <div style={styles.userInfo}>
            <div style={styles.userName}>{profile?.full_name || 'User'}</div>
            <div style={styles.userRole}>{profile?.role?.replace('_', ' ') || ''}</div>
          </div>
        )}
        <button onClick={signOut} title="Sign out" style={styles.signOutBtn}>&#x238B;</button>
      </div>
    </div>
  );
}
 
const styles = {
  sidebar: { height: '100vh', background: '#0F1117', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden', borderRight: '1px solid #1E2535', position: 'fixed', top: 0, left: 0, zIndex: 100 },
  header: { display: 'flex', alignItems: 'center', gap: '10px', padding: '16px 12px', borderBottom: '1px solid #1E2535', minHeight: '64px' },
  logoMark: { width: '32px', height: '32px', borderRadius: '8px', background: '#D94F2B', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: '700', flexShrink: 0 },
  logoText: { flex: 1, minWidth: 0 },
  logoTitle: { fontSize: '13px', fontWeight: '700', color: '#fff', letterSpacing: '-0.2px', whiteSpace: 'nowrap' },
  logoSub: { fontSize: '10px', color: '#4B5563', fontWeight: '400', marginTop: '1px' },
  collapseBtn: { background: 'none', border: 'none', color: '#4B5563', fontSize: '14px', cursor: 'pointer', padding: '4px', flexShrink: 0, marginLeft: 'auto' },
  nav: { flex: 1, overflowY: 'auto', padding: '8px 0' },
  section: { marginBottom: '4px' },
  sectionLabel: { fontSize: '9px', fontWeight: '600', color: '#374151', letterSpacing: '0.08em', padding: '8px 14px 4px' },
  navItem: { width: 'calc(100% - 8px)', display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 12px', background: 'none', border: 'none', color: '#6B7280', fontSize: '13px', fontWeight: '400', cursor: 'pointer', textAlign: 'left', borderRadius: '6px', margin: '1px 4px' },
  navItemActive: { background: '#161B26', color: '#fff', fontWeight: '500' },
  navIcon: { fontSize: '14px', flexShrink: 0, width: '18px', textAlign: 'center' },
  navLabel: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  footer: { borderTop: '1px solid #1E2535', padding: '12px', display: 'flex', alignItems: 'center', gap: '8px' },
  userInfo: { flex: 1, minWidth: 0 },
  userName: { fontSize: '12px', fontWeight: '600', color: '#D1D5DB', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  userRole: { fontSize: '10px', color: '#4B5563', textTransform: 'capitalize', marginTop: '1px' },
  signOutBtn: { background: 'none', border: 'none', color: '#4B5563', fontSize: '16px', cursor: 'pointer', padding: '4px', flexShrink: 0 },
};
 
