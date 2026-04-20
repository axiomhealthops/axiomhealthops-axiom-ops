import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

const REGION_ORDER = ['A','B','C','G','H','J','M','N','T','V'];
const REGIONAL_MANAGERS = {
  A:'Uma Jacobs', B:'Lia Davis', C:'Earl Dimaano', G:'Samantha Faliks',
  H:'Kaylee Ramsey', J:'Hollie Fincher', M:'Ariel Maboudi', N:'Ariel Maboudi',
  T:'Samantha Faliks', V:'Samantha Faliks',
};
const DISCIPLINES = ['LYMPHEDEMA PT','LYMPHEDEMA PTA','OT','COTA','PT','PTA'];

function isCancelled(e,s) { return /cancel/i.test(e||'')||/cancel/i.test(s||''); }

// Module-scope so React treats them as the same component type across renders.
// Previously defined inside ClinEditorModal — that caused focus loss on every
// keystroke because each render produced a new component reference.
function F({ label, children }) {
  return <div><div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>{label}</div>{children}</div>;
}
function I(props) {
  return <input {...props} style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', background:'var(--card-bg)', ...props.style }} />;
}

function ClinEditorModal({ clin, visits, onClose, onSave }) {
  const [form, setForm] = useState({
    full_name: clin.full_name || '',
    discipline: clin.discipline || '',
    employment_type: clin.employment_type || 'ft',
    region: clin.region || '',
    phone: clin.phone || '',
    email: clin.email || '',
    address: clin.address || '',
    zip: clin.zip || '',
    weekly_visit_target: clin.weekly_visit_target || 25,
    notes: clin.notes || '',
    is_active: clin.is_active !== false,
  });
  const [saving, setSaving] = useState(false);

  // Visit history stats
  const stats = useMemo(() => {
    const mine = visits.filter(v => {
      if (!v.staff_name) return false;
      const n = clin.pariox_name || clin.full_name;
      return v.staff_name.toLowerCase().includes((n||'').toLowerCase().split(',')[0].split(' ').pop());
    });
    const completed = mine.filter(v => /completed/i.test(v.status||'') && !isCancelled(v.event_type,v.status)).length;
    const cancelled = mine.filter(v => isCancelled(v.event_type,v.status)).length;
    const missed = mine.filter(v => /missed/i.test(v.status||'') && !isCancelled(v.event_type,v.status)).length;
    const revenue = completed * 230;
    return { completed, cancelled, missed, revenue, total: mine.length };
  }, [visits, clin]);

  async function handleSave() {
    setSaving(true);
    await onSave(clin.id, { ...form, updated_at: new Date().toISOString() });
    setSaving(false);
    onClose();
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'var(--card-bg)', borderRadius:16, width:'100%', maxWidth:680, maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:16, fontWeight:700, color:'var(--black)' }}>{clin.full_name}</div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'var(--gray)' }}>×</button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:24 }}>
          {/* Visit History Stats */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:20, background:'var(--bg)', borderRadius:10, padding:14 }}>
            {[
              { label:'Completed', val:stats.completed, color:'#065F46' },
              { label:'Cancelled', val:stats.cancelled, color:'#DC2626' },
              { label:'Missed', val:stats.missed, color:'#D97706' },
              { label:'Est. Revenue', val:'$'+stats.revenue.toLocaleString(), color:'#065F46' },
            ].map(s => (
              <div key={s.label} style={{ textAlign:'center' }}>
                <div style={{ fontSize:20, fontWeight:700, fontFamily:'DM Mono, monospace', color:s.color }}>{s.val}</div>
                <div style={{ fontSize:10, color:'var(--gray)', marginTop:2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            <F label="Full Name"><I value={form.full_name} onChange={e => setForm(p=>({...p,full_name:e.target.value}))} /></F>
            <F label="Discipline">
              <select value={form.discipline} onChange={e => setForm(p=>({...p,discipline:e.target.value}))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </F>
            <F label="Employment Type">
              <select value={form.employment_type} onChange={e => setForm(p=>({...p,employment_type:e.target.value}))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                {[['ft','Full-Time'],['pt','Part-Time'],['prn','PRN'],['contract','Contract']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </F>
            <F label="Region">
              <select value={form.region} onChange={e => setForm(p=>({...p,region:e.target.value}))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                <option value="">— Unassigned —</option>
                {REGION_ORDER.map(r => <option key={r} value={r}>Region {r}</option>)}
              </select>
            </F>
            <F label="Weekly Visit Target">
              <select value={form.weekly_visit_target} onChange={e => setForm(p=>({...p,weekly_visit_target:+e.target.value}))}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--card-bg)' }}>
                {[5,10,15,20,25,30,35,40].map(n => <option key={n} value={n}>{n} visits/week</option>)}
              </select>
            </F>
            <F label="Phone"><I value={form.phone} onChange={e => setForm(p=>({...p,phone:e.target.value}))} /></F>
            <F label="Email"><I type="email" value={form.email} onChange={e => setForm(p=>({...p,email:e.target.value}))} /></F>
            <F label="Address"><I value={form.address} onChange={e => setForm(p=>({...p,address:e.target.value}))} /></F>
            <F label="Zip Code"><I value={form.zip} onChange={e => setForm(p=>({...p,zip:e.target.value}))} /></F>
            <div style={{ gridColumn:'span 2', display:'flex', alignItems:'center', gap:10 }}>
              <input type="checkbox" checked={form.is_active} onChange={e => setForm(p=>({...p,is_active:e.target.checked}))} id="active_chk" />
              <label htmlFor="active_chk" style={{ fontSize:13, fontWeight:500, cursor:'pointer' }}>Active clinician</label>
            </div>
            <div style={{ gridColumn:'span 2' }}>
              <F label="Notes">
                <textarea value={form.notes} onChange={e => setForm(p=>({...p,notes:e.target.value}))}
                  style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:70, background:'var(--card-bg)' }} />
              </F>
            </div>
          </div>
        </div>

        <div style={{ padding:'14px 24px', borderTop:'1px solid var(--border)', display:'flex', gap:8, background:'var(--bg)' }}>
          <button onClick={handleSave} disabled={saving}
            style={{ padding:'8px 20px', background:'var(--red)', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function StaffDirectoryPage() {
  const [clinicians, setClinicians] = useState([]);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  function load() {
    Promise.all([
      fetchAllPages(supabase.from('clinicians').select('*').order('full_name')),
      fetchAllPages(supabase.from('visit_schedule_data').select('patient_name,visit_date,status,event_type,staff_name,region')),
    ]).then(([c, v]) => { setClinicians(c); setVisits(v); setLoading(false); });
  }

  useEffect(() => { load(); }, []);
  useRealtimeTable(['clinicians', 'visit_schedule_data'], load);

  async function handleSave(id, updates) {
    await supabase.from('clinicians').update(updates).eq('id', id);
    const { data } = await supabase.from('clinicians').select('*').order('full_name');
    setClinicians(data || []);
  }

  const byRegion = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = clinicians.filter(c =>
      (showInactive || c.is_active !== false) &&
      (!q || c.full_name?.toLowerCase().includes(q) || c.discipline?.toLowerCase().includes(q))
    );
    const map = {};
    filtered.forEach(c => {
      const r = c.region || 'Unassigned';
      if (!map[r]) map[r] = [];
      map[r].push(c);
    });
    return map;
  }, [clinicians, search, showInactive]);

  const orderedRegions = [...REGION_ORDER.filter(r => byRegion[r]), ...(byRegion['Unassigned'] ? ['Unassigned'] : [])];

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Staff Directory" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Staff Directory" subtitle={`${clinicians.filter(c=>c.is_active!==false).length} active clinicians · ${REGION_ORDER.length} regions`}
        actions={
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <input placeholder="Search name or discipline…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ padding:'6px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', width:200, background:'var(--card-bg)' }} />
            <button onClick={() => setShowInactive(v=>!v)}
              style={{ padding:'6px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, background:showInactive?'#1565C0':'var(--card-bg)', color:showInactive?'#fff':'var(--gray)', cursor:'pointer' }}>
              {showInactive ? 'Showing All' : 'Active Only'}
            </button>
          </div>
        }
      />
      <div style={{ flex:1, overflow:'auto', padding:20, display:'flex', flexDirection:'column', gap:20 }}>
        {orderedRegions.map(region => {
          const regionClinicians = byRegion[region] || [];
          const manager = REGIONAL_MANAGERS[region] || '—';
          return (
            <div key={region} style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
              {/* Region Header */}
              <div style={{ padding:'12px 20px', background:'#0F1117', display:'flex', alignItems:'center', gap:16 }}>
                <div style={{ fontSize:24, fontWeight:800, color:'#fff', fontFamily:'DM Mono, monospace' }}>{region === 'Unassigned' ? '—' : region}</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'#fff' }}>{region === 'Unassigned' ? 'Unassigned Region' : `Region ${region}`}</div>
                  <div style={{ fontSize:11, color:'#9CA3AF', marginTop:1 }}>Manager: {manager} · {regionClinicians.length} clinician{regionClinicians.length !== 1 ? 's' : ''}</div>
                </div>
              </div>

              {/* Clinicians grid */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))', gap:1, background:'var(--border)' }}>
                {regionClinicians.map(c => {
                  // Quick caseload stats
                  const mine = visits.filter(v => {
                    if (!v.staff_name) return false;
                    const n = c.pariox_name || c.full_name;
                    return v.staff_name.toLowerCase().includes((n||'').split(',')[0].split(' ').pop().toLowerCase());
                  });
                  const completed = mine.filter(v => /completed/i.test(v.status||'') && !isCancelled(v.event_type,v.status)).length;
                  const target = c.weekly_visit_target || 25;
                  const pct = Math.min(Math.round((completed/target)*100), 100);
                  const empMap = { ft:'Full-Time', pt:'Part-Time', prn:'PRN', contract:'Contract' };

                  return (
                    <button key={c.id} onClick={() => setEditing(c)}
                      style={{ background:'var(--card-bg)', border:'none', padding:16, textAlign:'left', cursor:'pointer' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                        <div>
                          <div style={{ fontSize:13, fontWeight:600, color: c.is_active!==false?'var(--black)':'var(--gray)' }}>{c.full_name}</div>
                          <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>{c.discipline}</div>
                          <div style={{ fontSize:10, color:'var(--gray)', marginTop:1 }}>{empMap[c.employment_type]||c.employment_type}</div>
                        </div>
                        {c.is_active === false && (
                          <span style={{ fontSize:9, fontWeight:700, color:'#6B7280', background:'#F3F4F6', padding:'2px 6px', borderRadius:999 }}>Inactive</span>
                        )}
                      </div>
                      {/* Caseload bar */}
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--gray)', marginBottom:3 }}>
                        <span>Caseload</span>
                        <span style={{ fontWeight:600, color:pct>=80?'#065F46':pct>=50?'#D97706':'#DC2626' }}>{completed}/{target}</span>
                      </div>
                      <div style={{ height:4, background:'var(--border)', borderRadius:999 }}>
                        <div style={{ height:'100%', width:pct+'%', background:pct>=80?'#10B981':pct>=50?'#D97706':'#DC2626', borderRadius:999 }} />
                      </div>
                      {c.phone && <div style={{ fontSize:10, color:'var(--gray)', marginTop:8 }}>📞 {c.phone}</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <ClinEditorModal clin={editing} visits={visits} onClose={() => setEditing(null)} onSave={handleSave} />
      )}
    </div>
  );
}
