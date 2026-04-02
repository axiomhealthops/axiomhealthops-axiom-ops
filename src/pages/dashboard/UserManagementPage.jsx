import { useState, useEffect } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

const ROLES = ['super_admin','admin','pod_leader','team_member'];
const ROLE_LABELS = { super_admin:'Super Admin', admin:'Admin', pod_leader:'Pod Leader', team_member:'Team Member' };
const ROLE_COLORS = { super_admin:'#DC2626', admin:'#7C3AED', pod_leader:'#1565C0', team_member:'#065F46' };
const ROLE_BGS   = { super_admin:'#FEF2F2', admin:'#F5F3FF', pod_leader:'#EFF6FF', team_member:'#ECFDF5' };
const ALL_REGIONS = ['A','B','C','G','H','I','J','M','N','T','V'];

function genPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from({length:12}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

function UserCard({ user, profile, pages, overrides, isSuperAdmin, isAdmin, onUpdate, onDeactivate, onToggleOverride, onSendReset, onSetPassword }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ role:user.role, regions:user.regions||[], team:user.team||'', email:user.email||'' });
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('details'); // details | access | password
  const [newPwd, setNewPwd] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');
  const [resetMsg, setResetMsg] = useState('');
  const userOverrides = overrides[user.id] || {};

  function getRoleDefault(page, role) {
    if (role === 'super_admin') return true;
    return page[role];
  }

  async function handleSave() {
    setSaving(true);
    // Update email if changed
    if (editForm.email !== user.email && user.user_id) {
      await supabase.rpc('admin_update_user', { target_user_id: user.user_id, new_email: editForm.email });
    }
    await onUpdate(user.id, { role:editForm.role, regions:editForm.regions, team:editForm.team, email:editForm.email });
    setSaving(false);
    setIsEditing(false);
  }

  async function handleSetPassword() {
    if (!newPwd || newPwd.length < 8) { setPwdMsg('Min 8 characters'); return; }
    if (!user.user_id) { setPwdMsg('User has no auth account yet'); return; }
    setSaving(true);
    const { data } = await supabase.rpc('admin_update_user', { target_user_id: user.user_id, new_password: newPwd });
    setPwdMsg(data?.success ? '✓ Password updated' : 'Error: ' + (data?.error||'unknown'));
    setSaving(false);
    setNewPwd('');
  }

  async function handleSendReset() {
    setSaving(true);
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: 'https://axiomhealthops-axiom-ops.vercel.app/reset-password'
    });
    setResetMsg(error ? 'Error: ' + error.message : '✓ Reset email sent to ' + user.email);
    setSaving(false);
  }

  const tabStyle = (t) => ({
    padding:'6px 14px', border:'none', background:'none', fontSize:12, fontWeight:tab===t?700:400,
    color:tab===t?'var(--black)':'var(--gray)', borderBottom:tab===t?'2px solid var(--red)':'2px solid transparent',
    cursor:'pointer'
  });

  return (
    <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
      {/* Header */}
      <div style={{ padding:'14px 20px', display:'flex', alignItems:'center', gap:14 }}>
        <div style={{ width:38, height:38, borderRadius:'50%', background:ROLE_BGS[user.role]||'#F3F4F6', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:700, color:ROLE_COLORS[user.role]||'var(--gray)', flexShrink:0 }}>
          {(user.full_name||'?')[0]}
        </div>
        <div style={{ flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontSize:14, fontWeight:600, color:'var(--black)' }}>{user.full_name||'—'}</span>
            <span style={{ fontSize:10, fontWeight:700, color:ROLE_COLORS[user.role]||'var(--gray)', background:ROLE_BGS[user.role]||'#F3F4F6', padding:'2px 8px', borderRadius:999 }}>
              {ROLE_LABELS[user.role]||user.role}
            </span>
            {user.is_active === false && <span style={{ fontSize:10, fontWeight:700, color:'#6B7280', background:'#F3F4F6', padding:'2px 8px', borderRadius:999 }}>Inactive</span>}
            {!user.user_id && <span style={{ fontSize:10, fontWeight:700, color:'#D97706', background:'#FEF3C7', padding:'2px 8px', borderRadius:999 }}>⚠ No Auth Account</span>}
          </div>
          <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>{user.email} {user.regions?.length > 0 ? '· Regions: ' + user.regions.join(', ') : ''}</div>
        </div>
        {isAdmin && (
          <div style={{ display:'flex', gap:6 }}>
            <button onClick={() => setIsEditing(v=>!v)}
              style={{ padding:'5px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, background:'var(--bg)', cursor:'pointer', fontWeight:500 }}>
              {isEditing ? 'Close' : 'Manage'}
            </button>
            <button onClick={() => onDeactivate(user.id, user.is_active !== false)}
              style={{ padding:'5px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, background:'var(--bg)', cursor:'pointer', color:user.is_active===false?'#065F46':'#DC2626', fontWeight:500 }}>
              {user.is_active === false ? 'Activate' : 'Deactivate'}
            </button>
          </div>
        )}
      </div>

      {/* Edit panel */}
      {isEditing && (
        <div style={{ borderTop:'1px solid var(--border)', background:'var(--bg)' }}>
          {/* Tabs */}
          <div style={{ display:'flex', borderBottom:'1px solid var(--border)', padding:'0 20px' }}>
            {[['details','Profile & Role'],['access','Page Access'],['password','Password']].map(([t,l]) => (
              <button key={t} onClick={() => setTab(t)} style={tabStyle(t)}>{l}</button>
            ))}
          </div>

          <div style={{ padding:20 }}>
            {/* DETAILS TAB */}
            {tab === 'details' && (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:16 }}>
                  {[['Full Name (display only)','name','text',true],['Email Address','email','email',false],['Team / Department','team','text',false]].map(([label,key,type,readOnly]) => (
                    <div key={key}>
                      <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>{label}</div>
                      <input type={type} value={key==='name'?user.full_name:editForm[key]} readOnly={readOnly}
                        onChange={e => !readOnly && setEditForm(p=>({...p,[key]:e.target.value}))}
                        style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', background:readOnly?'var(--bg)':'var(--card-bg)', color:'var(--black)' }} />
                    </div>
                  ))}
                  <div>
                    <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>Role</div>
                    <select value={editForm.role} onChange={e => setEditForm(p=>({...p,role:e.target.value}))}
                      style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                      {ROLES.filter(r => isSuperAdmin || r !== 'super_admin').map(r => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>Regions</div>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                      {ALL_REGIONS.map(r => (
                        <button key={r} onClick={() => setEditForm(p=>({...p,regions:p.regions.includes(r)?p.regions.filter(x=>x!==r):[...p.regions,r]}))}
                          style={{ padding:'3px 8px', borderRadius:5, border:'1px solid var(--border)', fontSize:11, fontWeight:600, background:editForm.regions.includes(r)?'#1565C0':'var(--card-bg)', color:editForm.regions.includes(r)?'#fff':'var(--gray)', cursor:'pointer' }}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={handleSave} disabled={saving}
                    style={{ padding:'8px 20px', background:'var(--red)', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button onClick={() => setIsEditing(false)}
                    style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>
                    Cancel
                  </button>
                </div>
              </>
            )}

            {/* ACCESS TAB */}
            {tab === 'access' && (
              <>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--black)', marginBottom:8 }}>
                  Page Access Overrides <span style={{ fontWeight:400, color:'var(--gray)' }}>— click to grant or deny beyond role default</span>
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
              </>
            )}

            {/* PASSWORD TAB */}
            {tab === 'password' && (
              <div style={{ display:'flex', flexDirection:'column', gap:16, maxWidth:500 }}>
                {/* Send Reset Email */}
                <div style={{ padding:16, background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--black)', marginBottom:4 }}>Send Password Reset Email</div>
                  <div style={{ fontSize:12, color:'var(--gray)', marginBottom:12 }}>
                    Sends a secure reset link to <strong>{user.email}</strong>. User clicks it to set their own password.
                  </div>
                  {resetMsg && <div style={{ fontSize:12, color:resetMsg.startsWith('✓')?'#065F46':'#DC2626', marginBottom:10, fontWeight:600 }}>{resetMsg}</div>}
                  <button onClick={handleSendReset} disabled={saving}
                    style={{ padding:'8px 16px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                    {saving ? 'Sending…' : '📧 Send Reset Link'}
                  </button>
                </div>

                {/* Manual Password Set */}
                {isSuperAdmin && (
                  <div style={{ padding:16, background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'var(--black)', marginBottom:4 }}>Set Password Manually</div>
                    <div style={{ fontSize:12, color:'var(--gray)', marginBottom:12 }}>
                      Directly set a password for this user. Share it with them securely.
                    </div>
                    {pwdMsg && <div style={{ fontSize:12, color:pwdMsg.startsWith('✓')?'#065F46':'#DC2626', marginBottom:10, fontWeight:600 }}>{pwdMsg}</div>}
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <input type="text" placeholder="Enter new password…" value={newPwd} onChange={e => setNewPwd(e.target.value)}
                        style={{ flex:1, padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none' }} />
                      <button onClick={() => setNewPwd(genPassword())}
                        style={{ padding:'8px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, background:'var(--bg)', cursor:'pointer', whiteSpace:'nowrap' }}>
                        🎲 Generate
                      </button>
                    </div>
                    <button onClick={handleSetPassword} disabled={saving || !newPwd}
                      style={{ marginTop:10, padding:'8px 16px', background:'var(--red)', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:newPwd?'pointer':'not-allowed', opacity:newPwd?1:0.5 }}>
                      {saving ? 'Saving…' : '🔑 Set Password'}
                    </button>
                  </div>
                )}
              </div>
            )}
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
    const [{ data:u }, { data:p }, { data:o }, { data:authUsers }] = await Promise.all([
      supabase.from('coordinators').select('*').order('full_name'),
      supabase.from('page_permissions').select('*').order('sort_order'),
      supabase.from('user_page_overrides').select('*'),
      supabase.from('coordinators').select('id, user_id'),
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
    // 1. Create auth user via admin invite
    const { data: inviteData, error: inviteErr } = await supabase.auth.admin?.inviteUserByEmail?.(newUser.email) || {};
    // 2. Insert coordinator profile
    const { error } = await supabase.from('coordinators').insert({
      full_name: newUser.full_name, email: newUser.email,
      role: newUser.role, regions: newUser.regions, team: newUser.team || null,
      user_id: inviteData?.user?.id || null,
    });
    if (error) { setMsg('Error: ' + error.message); setSaving(false); return; }
    setMsg('✓ User created. A setup email will be sent if the invite API is available.');
    setNewUser({ full_name:'', email:'', role:'team_member', regions:[], team:'' });
    setShowAdd(false); setSaving(false);
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
            {msg && <span style={{ fontSize:12, color:msg.startsWith('✓')?'#065F46':'#DC2626', fontWeight:500 }}>{msg}</span>}
            {isAdmin && (
              <button onClick={() => setShowAdd(v=>!v)}
                style={{ padding:'7px 14px', background:showAdd?'var(--border)':'var(--red)', color:showAdd?'var(--black)':'#fff', border:'none', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' }}>
                {showAdd ? 'Cancel' : '+ Add User'}
              </button>
            )}
          </div>
        }
      />
      <div style={{ flex:1, overflow:'auto', padding:20, display:'flex', flexDirection:'column', gap:12 }}>

        {/* Add user panel */}
        {showAdd && (
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:20 }}>
            <div style={{ fontSize:14, fontWeight:600, color:'var(--black)', marginBottom:16 }}>Create New User Account</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
              {[['Full Name','full_name','text'],['Email Address','email','email'],['Team / Department','team','text']].map(([label,key,type]) => (
                <div key={key}>
                  <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>{label}</div>
                  <input type={type} value={newUser[key]} onChange={e => setNewUser(p=>({...p,[key]:e.target.value}))}
                    style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box' }} />
                </div>
              ))}
              <div>
                <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>Role</div>
                <select value={newUser.role} onChange={e => setNewUser(p=>({...p,role:e.target.value}))}
                  style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                  {ROLES.filter(r => isSuperAdmin || r !== 'super_admin').map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>Regions</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                  {ALL_REGIONS.map(r => (
                    <button key={r} onClick={() => setNewUser(p=>({...p,regions:p.regions.includes(r)?p.regions.filter(x=>x!==r):[...p.regions,r]}))}
                      style={{ padding:'3px 8px', borderRadius:5, border:'1px solid var(--border)', fontSize:11, fontWeight:600, background:newUser.regions.includes(r)?'#1565C0':'var(--bg)', color:newUser.regions.includes(r)?'#fff':'var(--gray)', cursor:'pointer' }}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ marginTop:16, display:'flex', gap:8, alignItems:'center' }}>
              <button onClick={addUser} disabled={saving}
                style={{ padding:'8px 20px', background:'var(--red)', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                {saving ? 'Creating…' : 'Create User'}
              </button>
              <span style={{ fontSize:11, color:'var(--gray)' }}>User will receive an invite email. Use the Manage panel to set a manual password if needed.</span>
            </div>
          </div>
        )}

        <input placeholder="Search by name, email, or role…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding:'8px 14px', border:'1px solid var(--border)', borderRadius:8, fontSize:13, outline:'none', background:'var(--card-bg)', width:320 }} />

        {filtered.map(user => (
          <UserCard key={user.id} user={user} profile={profile} pages={pages} overrides={overrides}
            isSuperAdmin={isSuperAdmin} isAdmin={isAdmin}
            onUpdate={updateUser} onDeactivate={deactivateUser} onToggleOverride={toggleOverride} />
        ))}
      </div>
    </div>
  );
}
