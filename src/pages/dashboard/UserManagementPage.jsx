import { useState, useEffect } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

const ROLES = ['super_admin','admin','pod_leader','team_member'];
const ROLE_LABELS = { super_admin:'Super Admin', admin:'Admin', pod_leader:'Pod Leader', team_member:'Team Member' };
const ROLE_COLORS = { super_admin:'#DC2626', admin:'#7C3AED', pod_leader:'#1565C0', team_member:'#065F46' };
const ROLE_BGS   = { super_admin:'#FEF2F2', admin:'#F5F3FF', pod_leader:'#EFF6FF', team_member:'#ECFDF5' };
const ALL_REGIONS = ['A','B','C','G','H','I','J','M','N','T','V'];

// Extracted into its own component so hooks are called at the top level
function UserCard({ user, profile, pages, overrides, isSuperAdmin, isAdmin, onUpdate, onDeactivate, onToggleOverride }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ role: user.role, regions: user.regions || [], team: user.team || '' });
  const [saving, setSaving] = useState(false);
  const userOverrides = overrides[user.id] || {};

  function getRoleDefault(page, role) {
    if (role === 'super_admin') return true;
    return page[role];
  }

  async function handleSave() {
    setSaving(true);
    await onUpdate(user.id, { role: editForm.role, regions: editForm.regions, team: editForm.team });
    setSaving(false);
    setIsEditing(false);
  }

  return (
    <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
      {/* Header */}
      <div style={{ padding:'16px 20px', display:'flex', alignItems:'center', gap:16 }}>
        <div style={{ width:40, height:40, borderRadius:'50%', background:ROLE_BGS[user.role]||'#F3F4F6', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:700, color:ROLE_COLORS[user.role]||'var(--gray)', flexShrink:0 }}>
          {(user.full_name||'?')[0]}
        </div>
        <div style={{ flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <div style={{ fontSize:14, fontWeight:600, color:'var(--black)' }}>{user.full_name||'—'}</div>
            <span style={{ fontSize:10, fontWeight:700, color:ROLE_COLORS[user.role]||'var(--gray)', background:ROLE_BGS[user.role]||'#F3F4F6', padding:'2px 8px', borderRadius:999 }}>
              {ROLE_LABELS[user.role]||user.role}
            </span>
            {user.is_active === false && (
              <span style={{ fontSize:10, fontWeight:700, color:'#6B7280', background:'#F3F4F6', padding:'2px 8px', borderRadius:999 }}>Inactive</span>
            )}
          </div>
          <div style={{ fontSize:12, color:'var(--gray)', marginTop:2 }}>{user.email}</div>
          {user.regions?.length > 0 && (
            <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>Regions: {user.regions.join(', ')}</div>
          )}
        </div>
        {isAdmin && user.id !== profile?.id && (
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => setIsEditing(v => !v)}
              style={{ padding:'6px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, background:'var(--bg)', cursor:'pointer', fontWeight:500 }}>
              {isEditing ? 'Close' : 'Edit'}
            </button>
            <button onClick={() => onDeactivate(user.id, user.is_active !== false)}
              style={{ padding:'6px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, background:'var(--bg)', cursor:'pointer', color:user.is_active===false?'#065F46':'#DC2626', fontWeight:500 }}>
              {user.is_active === false ? 'Reactivate' : 'Deactivate'}
            </button>
          </div>
        )}
      </div>

      {/* Edit panel */}
      {isEditing && (
        <div style={{ borderTop:'1px solid var(--border)', padding:20, background:'var(--bg)', display:'flex', flexDirection:'column', gap:16 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>Role</div>
              <select value={editForm.role} onChange={e => setEditForm(p => ({ ...p, role:e.target.value }))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                {ROLES.filter(r => isSuperAdmin || r !== 'super_admin').map(r => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>Team</div>
              <input value={editForm.team} onChange={e => setEditForm(p => ({ ...p, team:e.target.value }))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>Regions</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                {ALL_REGIONS.map(r => (
                  <button key={r} onClick={() => setEditForm(p => ({ ...p, regions: p.regions.includes(r) ? p.regions.filter(x=>x!==r) : [...p.regions,r] }))}
                    style={{ padding:'3px 8px', borderRadius:5, border:'1px solid var(--border)', fontSize:11, fontWeight:600, background:editForm.regions.includes(r)?'#1565C0':'var(--card-bg)', color:editForm.regions.includes(r)?'#fff':'var(--gray)', cursor:'pointer' }}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Page overrides */}
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--black)', marginBottom:8 }}>
              Page Access Overrides <span style={{ fontWeight:400, color:'var(--gray)' }}>— override role defaults for this user specifically</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6 }}>
              {pages.map(page => {
                const roleDefault = getRoleDefault(page, editForm.role);
                const override = userOverrides[page.page_key];
                const effective = override !== undefined ? override : roleDefault;
                const hasOverride = override !== undefined;
                return (
                  <button key={page.page_key} onClick={() => onToggleOverride(user.id, page.page_key, effective)}
                    style={{ padding:'6px 8px', borderRadius:7, border:`1px solid ${hasOverride?'#1565C0':'var(--border)'}`, background:effective?(hasOverride?'#EFF6FF':'#F0FDF4'):'#F9FAFB', cursor:'pointer', textAlign:'left' }}>
                    <div style={{ fontSize:11, fontWeight:600, color:effective?'var(--black)':'var(--gray)' }}>{page.page_label}</div>
                    <div style={{ fontSize:9, marginTop:2, color:hasOverride?'#1565C0':effective?'#065F46':'#9CA3AF', fontWeight:hasOverride?700:400 }}>
                      {hasOverride ? (override?'✓ Override: Granted':'✗ Override: Denied') : (effective?'✓ Role default':'✗ No access')}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display:'flex', gap:8 }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding:'8px 20px', background:'var(--red)', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button onClick={() => setIsEditing(false)}
              style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--bg)', cursor:'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function UserManagementPage() {
  const { profile } = useAuth();
  const [users, setUsers] = useState([]);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [newUser, setNewUser] = useState({ full_name:'', email:'', role:'team_member', regions:[], team:'' });

  const isSuperAdmin = profile?.role === 'super_admin';
  const isAdmin = profile?.role === 'admin' || isSuperAdmin;

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const [{ data:u }, { data:p }, { data:o }] = await Promise.all([
      supabase.from('coordinators').select('*').order('full_name'),
      supabase.from('page_permissions').select('*').order('sort_order'),
      supabase.from('user_page_overrides').select('*'),
    ]);
    setUsers(u || []);
    setPages(p || []);
    const map = {};
    (o || []).forEach(ov => {
      if (!map[ov.coordinator_id]) map[ov.coordinator_id] = {};
      map[ov.coordinator_id][ov.page_key] = ov.granted;
    });
    setOverrides(map);
    setLoading(false);
  }

  async function addUser() {
    if (!newUser.full_name || !newUser.email) { setMsg('Name and email required'); return; }
    setSaving(true); setMsg('');
    const { error } = await supabase.from('coordinators').insert({
      full_name: newUser.full_name,
      email: newUser.email,
      role: newUser.role,
      regions: newUser.regions,
      team: newUser.team || null,
    });
    if (error) { setMsg('Error: ' + error.message); setSaving(false); return; }
    setMsg('User created. Set up their login via Supabase Auth or send an invite from the Auth dashboard.');
    setNewUser({ full_name:'', email:'', role:'team_member', regions:[], team:'' });
    setShowAdd(false);
    setSaving(false);
    await loadData();
  }

  async function updateUser(userId, updates) {
    await supabase.from('coordinators').update({ ...updates, updated_at:new Date().toISOString() }).eq('id', userId);
    await loadData();
  }

  async function deactivateUser(userId, isActive) {
    await supabase.from('coordinators').update({ is_active: !isActive }).eq('id', userId);
    await loadData();
  }

  async function toggleOverride(coordinatorId, pageKey, currentVal) {
    const existing = overrides[coordinatorId]?.[pageKey];
    if (existing !== undefined) {
      await supabase.from('user_page_overrides').delete().eq('coordinator_id', coordinatorId).eq('page_key', pageKey);
    } else {
      await supabase.from('user_page_overrides').insert({ coordinator_id:coordinatorId, page_key:pageKey, granted:!currentVal, granted_by:profile?.id });
    }
    await loadData();
  }

  const filtered = users.filter(u =>
    (u.full_name||'').toLowerCase().includes(search.toLowerCase()) ||
    (u.email||'').toLowerCase().includes(search.toLowerCase()) ||
    (u.role||'').toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="User Management" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="User Management" subtitle={`${users.length} users · ${users.filter(u=>u.is_active!==false).length} active`}
        actions={
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {msg && <span style={{ fontSize:12, color:'#065F46', fontWeight:500 }}>{msg}</span>}
            {isAdmin && (
              <button onClick={() => setShowAdd(v=>!v)}
                style={{ padding:'7px 14px', background:showAdd?'var(--border)':'var(--red)', color:showAdd?'var(--black)':'#fff', border:'none', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' }}>
                {showAdd ? 'Cancel' : '+ Add User'}
              </button>
            )}
          </div>
        }
      />
      <div style={{ flex:1, overflow:'auto', padding:20, display:'flex', flexDirection:'column', gap:16 }}>

        {/* Add user panel */}
        {showAdd && (
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:20 }}>
            <div style={{ fontSize:14, fontWeight:600, color:'var(--black)', marginBottom:16 }}>Add New User</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
              {[['Full Name','full_name','text'],['Email Address','email','email'],['Team / Department','team','text']].map(([label,key,type]) => (
                <div key={key}>
                  <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>{label}</div>
                  <input type={type} value={newUser[key]} onChange={e => setNewUser(p => ({ ...p,[key]:e.target.value }))}
                    style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box' }} />
                </div>
              ))}
              <div>
                <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>Role</div>
                <select value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role:e.target.value }))}
                  style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                  {ROLES.filter(r => isSuperAdmin || r !== 'super_admin').map(r => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>Regions</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                  {ALL_REGIONS.map(r => (
                    <button key={r} onClick={() => setNewUser(p => ({ ...p, regions: p.regions.includes(r) ? p.regions.filter(x=>x!==r) : [...p.regions,r] }))}
                      style={{ padding:'4px 10px', borderRadius:6, border:'1px solid var(--border)', fontSize:12, fontWeight:600, background:newUser.regions.includes(r)?'#1565C0':'var(--bg)', color:newUser.regions.includes(r)?'#fff':'var(--gray)', cursor:'pointer' }}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ marginTop:16, display:'flex', gap:8, alignItems:'center' }}>
              <button onClick={addUser} disabled={saving}
                style={{ padding:'8px 20px', background:'var(--red)', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:saving?'wait':'pointer' }}>
                {saving ? 'Creating…' : 'Create User'}
              </button>
              <div style={{ fontSize:11, color:'var(--gray)' }}>After creating, set up login via Supabase Auth dashboard or send an invite link</div>
            </div>
          </div>
        )}

        <input placeholder="Search by name, email, or role…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding:'8px 14px', border:'1px solid var(--border)', borderRadius:8, fontSize:13, outline:'none', background:'var(--card-bg)', width:320 }} />

        {filtered.map(user => (
          <UserCard
            key={user.id}
            user={user}
            profile={profile}
            pages={pages}
            overrides={overrides}
            isSuperAdmin={isSuperAdmin}
            isAdmin={isAdmin}
            onUpdate={updateUser}
            onDeactivate={deactivateUser}
            onToggleOverride={toggleOverride}
          />
        ))}
      </div>
    </div>
  );
}
