import { useState, useEffect } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

const ROLES = ['super_admin','admin','regional_manager','auth_coordinator','intake_coordinator','care_coordinator','clinician'];
const ROLE_LABELS = { super_admin:'Super Admin', admin:'Director / Admin', regional_manager:'Regional Manager', auth_coordinator:'Auth Coordinator', intake_coordinator:'Intake Coordinator', care_coordinator:'Care Coordinator', clinician:'Clinician' };

export default function SettingsPage() {
  const { profile, refreshPermissions } = useAuth();
  const [pages, setPages] = useState([]);
  const [saving, setSaving] = useState({});
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  async function loadPages() {
    const { data } = await supabase.from('page_permissions').select('*').order('sort_order');
    setPages(data || []);
    setLoading(false);
  }

  useEffect(() => { loadPages(); }, []);
  useRealtimeTable('page_permissions', loadPages);

  async function toggle(pageKey, role) {
    const page = pages.find(p => p.page_key === pageKey);
    if (!page) return;
    // super_admin always has full access — cannot be toggled
    if (role === 'super_admin') return;
    const newVal = !page[role];
    setSaving(s => ({ ...s, [pageKey+role]: true }));
    await supabase.from('page_permissions')
      .update({ [role]: newVal, updated_at: new Date().toISOString() })
      .eq('page_key', pageKey);
    setPages(prev => prev.map(p => p.page_key === pageKey ? { ...p, [role]: newVal } : p));
    setSaving(s => ({ ...s, [pageKey+role]: false }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    await refreshPermissions();
  }

  const sections = [...new Set(pages.map(p => p.page_section))];

  if (profile?.role !== 'super_admin') return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Settings" subtitle="Access restricted" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)', fontSize:14 }}>
        Settings is only available to Super Admins.
      </div>
    </div>
  );

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Settings" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Settings" subtitle="Manage page access permissions by role"
        actions={saved && <span style={{ fontSize:12, color:'#065F46', fontWeight:600, background:'#ECFDF5', padding:'6px 12px', borderRadius:6 }}>✓ Saved</span>}
      />
      <div style={{ flex:1, overflow:'auto', padding:20 }}>
        <div style={{ background:'#FEF3C7', border:'1px solid #F59E0B', borderRadius:10, padding:'12px 16px', marginBottom:20, fontSize:12, color:'#92400E' }}>
          <strong>Role Access Control</strong> — Toggle which pages each role can access. Super Admin always has full access. Changes take effect immediately for users on their next page load.
        </div>

        {sections.map(section => {
          const sectionPages = pages.filter(p => p.page_section === section);
          return (
            <div key={section} style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden', marginBottom:16 }}>
              <div style={{ padding:'12px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--black)', textTransform:'uppercase', letterSpacing:'0.06em' }}>{section}</div>
                {/* Role headers */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,90px)', gap:4, textAlign:'center' }}>
                  {ROLES.filter(r => r !== 'super_admin').map(r => (
                    <div key={r} style={{ fontSize:9, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em' }}>{ROLE_LABELS[r]}</div>
                  ))}
                </div>
              </div>
              {sectionPages.map((page, i) => (
                <div key={page.page_key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 20px', borderBottom: i < sectionPages.length-1 ? '1px solid var(--border)' : 'none', background: i%2===0?'var(--card-bg)':'var(--bg)' }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:500, color:'var(--black)' }}>{page.page_label}</div>
                    <div style={{ fontSize:10, color:'var(--gray)', marginTop:1 }}>{page.page_key}</div>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,90px)', gap:4, textAlign:'center' }}>
                    {/* Super admin - always on, not toggleable */}
                    <div style={{ display:'flex', justifyContent:'center' }}>
                      <div style={{ width:24, height:24, borderRadius:6, background:'#D1FAE5', border:'1px solid #6EE7B7', display:'flex', alignItems:'center', justifyContent:'center' }}>
                        <span style={{ fontSize:13, color:'#065F46' }}>✓</span>
                      </div>
                    </div>
                    {/* Other roles */}
                    {ROLES.filter(r => r !== 'super_admin').map(role => {
                      const on = page[role];
                      const key = page.page_key + role;
                      return (
                        <div key={role} style={{ display:'flex', justifyContent:'center' }}>
                          <button onClick={() => toggle(page.page_key, role)}
                            disabled={saving[key]}
                            style={{ width:48, height:26, borderRadius:999, border:'none', background: on ? '#10B981' : '#E5E7EB', cursor: saving[key]?'wait':'pointer', transition:'background 0.2s', position:'relative' }}>
                            <div style={{ width:20, height:20, borderRadius:'50%', background:'#fff', position:'absolute', top:3, left: on ? 24 : 4, transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.2)' }} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })}

        {/* Role descriptions */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginTop:8 }}>
          {ROLES.map(r => (
            <div key={r} style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--black)', marginBottom:4 }}>{ROLE_LABELS[r]}</div>
              <div style={{ fontSize:11, color:'var(--gray)', lineHeight:1.5 }}>
                {r === 'super_admin' && 'Full platform access. Cannot be restricted.'}
                {r === 'admin' && 'Full access except Executive Report. Can manage users and permissions.'}
                {r === 'pod_leader' && 'Operational access: Intake through Productivity. No financial or admin pages by default.'}
                {r === 'team_member' && 'Standard clinical team access: Intake, Patients, Auth, Coordinator Portal.'}
              </div>
              <div style={{ marginTop:8, fontSize:11, fontWeight:600, color:'#1565C0' }}>
                {pages.filter(p => p[r]).length} pages accessible
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
