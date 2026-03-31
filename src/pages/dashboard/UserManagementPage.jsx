import React, { useState, useEffect } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';

const ROLES = ['super_admin', 'ceo', 'director', 'regional_mgr', 'admin', 'pod_leader', 'team_leader', 'team_member', 'coordinator'];

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchUsers(); }, []);

  async function fetchUsers() {
    const { data } = await supabase.from('coordinators').select('*').order('role', { ascending: true });
    setUsers(data || []);
    setLoading(false);
  }

  async function updateRole(id, role) {
    await supabase.from('coordinators').update({ role }).eq('id', id);
    fetchUsers();
  }

  async function toggleActive(id, current) {
    await supabase.from('coordinators').update({ is_active: !current }).eq('id', id);
    fetchUsers();
  }

  const ROLE_COLORS = {
    super_admin: { bg: '#FEF2F2', color: '#991B1B' },
    director: { bg: '#FEF2F2', color: '#991B1B' },
    pod_leader: { bg: '#EFF6FF', color: '#1E40AF' },
    team_leader: { bg: '#F0FDF4', color: '#166534' },
    team_member: { bg: '#F9FAFB', color: '#374151' },
    coordinator: { bg: '#FEF3C7', color: '#92400E' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="User Management"
        subtitle={`${users.length} users · ${users.filter(u => u.is_active).length} active`}
      />
      <div style={{ padding: '20px 28px', flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={styles.empty}>Loading...</div>
        ) : (
          <div style={styles.table}>
            <div style={styles.tableHeader}>
              <span>Name</span>
              <span>Email</span>
              <span>Role</span>
              <span>Team</span>
              <span>Regions</span>
              <span>Status</span>
            </div>
            {users.map(u => {
              const roleStyle = ROLE_COLORS[u.role] || { bg: '#F9FAFB', color: '#374151' };
              return (
                <div key={u.id} style={styles.tableRow}>
                  <span style={styles.cellName}>
                    <div style={styles.avatar}>{u.full_name?.[0] || '?'}</div>
                    {u.full_name}
                  </span>
                  <span style={styles.cell}>{u.email}</span>
                  <span style={styles.cell}>
                    <select
                      value={u.role}
                      onChange={e => updateRole(u.id, e.target.value)}
                      style={{ ...styles.roleSelect, background: roleStyle.bg, color: roleStyle.color }}
                    >
                      {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                    </select>
                  </span>
                  <span style={styles.cell}>{u.team || '—'}</span>
                  <span style={styles.cell}>{u.regions?.join(', ') || '—'}</span>
                  <span style={styles.cell}>
                    <button
                      onClick={() => toggleActive(u.id, u.is_active)}
                      style={{
                        padding: '3px 12px', borderRadius: 999, border: 'none',
                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        background: u.is_active ? '#ECFDF5' : '#FEF2F2',
                        color: u.is_active ? '#065F46' : '#991B1B',
                      }}
                    >
                      {u.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  empty: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, color: 'var(--gray)' },
  table: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' },
  tableHeader: { display: 'grid', gridTemplateColumns: '1.8fr 2fr 1.4fr 1fr 1fr 0.8fr', padding: '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--bg)', borderBottom: '1px solid var(--border)' },
  tableRow: { display: 'grid', gridTemplateColumns: '1.8fr 2fr 1.4fr 1fr 1fr 0.8fr', padding: '12px 20px', alignItems: 'center', borderBottom: '1px solid var(--border)' },
  cellName: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 600, color: 'var(--black)' },
  avatar: { width: 28, height: 28, borderRadius: '50%', background: 'var(--red)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 },
  cell: { fontSize: 12, color: 'var(--gray)' },
  roleSelect: { padding: '4px 10px', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, outline: 'none', cursor: 'pointer', textTransform: 'capitalize' },
};
