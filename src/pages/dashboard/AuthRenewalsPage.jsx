import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import PatientNotesPanel from '../../components/PatientNotesPanel';

const STATUS_CFG = {
  open:        { label:'Open',       color:'#DC2626', bg:'#FEF2F2' },
  in_progress: { label:'In Progress',color:'#D97706', bg:'#FEF3C7' },
  submitted:   { label:'Submitted',  color:'#1565C0', bg:'#EFF6FF' },
  approved:    { label:'Approved ✅', color:'#065F46', bg:'#ECFDF5' },
  denied:      { label:'Denied ❌',  color:'#6B7280', bg:'#F3F4F6' },
  closed:      { label:'Closed',     color:'#6B7280', bg:'#F3F4F6' },
};
const PRIO_CFG = {
  urgent: { label:'🔴 Urgent', color:'#DC2626', bg:'#FEF2F2' },
  high:   { label:'🟠 High',   color:'#D97706', bg:'#FEF3C7' },
  normal: { label:'🟡 Normal', color:'#059669', bg:'#ECFDF5' },
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

function ActionModal({ task, onClose, onSaved, profile }) {
  const [form, setForm] = useState({
    task_status: task.task_status,
    assigned_to: task.assigned_to || '',
    notes: task.notes || '',
    priority: task.priority,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const update = {
      ...form,
      updated_at: new Date().toISOString(),
      completed_at: ['approved','denied','closed'].includes(form.task_status) ? new Date().toISOString() : null,
      completed_by: ['approved','denied','closed'].includes(form.task_status) ? (profile?.full_name||profile?.email) : null,
    };
    await supabase.from('auth_renewal_tasks').update(update).eq('id', task.id);
    setSaving(false);
    onSaved();
  }

  const sc = STATUS_CFG[form.task_status] || STATUS_CFG.open;
  const pc = PRIO_CFG[form.priority] || PRIO_CFG.normal;

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
      <div style={{background:'var(--card-bg)',borderRadius:14,width:'100%',maxWidth:520,boxShadow:'0 24px 60px rgba(0,0,0,0.35)'}}>
        <div style={{padding:'16px 22px',background:task.priority==='urgent'?'#DC2626':'#D97706',borderRadius:'14px 14px 0 0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:'#fff'}}>{task.patient_name}</div>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.7)',marginTop:2}}>
              Region {task.region} · {task.insurance} · Expires {fmtDate(task.expiry_date)} · {task.days_until_expiry}d left · {task.visits_remaining} visits remaining
            </div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'rgba(255,255,255,0.7)'}}>×</button>
        </div>
        <div style={{padding:22,display:'flex',flexDirection:'column',gap:14}}>
          <div>
            <label style={{fontSize:11,fontWeight:700,color:'var(--black)',display:'block',marginBottom:8}}>Status</label>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {Object.entries(STATUS_CFG).map(([k,v]) => (
                <button key={k} onClick={() => setForm(f=>({...f,task_status:k}))}
                  style={{padding:'5px 10px',borderRadius:6,border:`2px solid ${form.task_status===k?v.color:'var(--border)'}`,background:form.task_status===k?v.bg:'var(--card-bg)',cursor:'pointer',fontSize:11,fontWeight:form.task_status===k?700:400,color:form.task_status===k?v.color:'var(--gray)'}}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={{fontSize:11,fontWeight:700,color:'var(--black)',display:'block',marginBottom:8}}>Priority</label>
            <div style={{display:'flex',gap:6}}>
              {Object.entries(PRIO_CFG).map(([k,v]) => (
                <button key={k} onClick={() => setForm(f=>({...f,priority:k}))}
                  style={{flex:1,padding:'6px',borderRadius:6,border:`2px solid ${form.priority===k?v.color:'var(--border)'}`,background:form.priority===k?v.bg:'var(--card-bg)',cursor:'pointer',fontSize:11,fontWeight:700,color:form.priority===k?v.color:'var(--gray)'}}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={{fontSize:11,fontWeight:700,color:'var(--black)',display:'block',marginBottom:4}}>Assigned To</label>
            <input value={form.assigned_to} onChange={e=>setForm(f=>({...f,assigned_to:e.target.value}))}
              placeholder="Coordinator name..."
              style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:12,outline:'none',background:'var(--card-bg)',boxSizing:'border-box'}} />
          </div>
          <div>
            <label style={{fontSize:11,fontWeight:700,color:'var(--black)',display:'block',marginBottom:4}}>Notes</label>
            <textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}
              placeholder="Authorization number, submission date, payer contact, denial reason..."
              style={{width:'100%',padding:'8px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:12,outline:'none',boxSizing:'border-box',resize:'vertical',minHeight:72,background:'var(--card-bg)'}} />
          </div>
          <PatientNotesPanel patientName={task.patient_name} maxHeight="280px" />
        </div>
        <div style={{padding:'14px 22px',borderTop:'1px solid var(--border)',display:'flex',justifyContent:'flex-end',gap:8,background:'var(--bg)'}}>
          <button onClick={onClose} style={{padding:'8px 16px',border:'1px solid var(--border)',borderRadius:7,fontSize:13,background:'var(--card-bg)',cursor:'pointer'}}>Cancel</button>
          <button onClick={save} disabled={saving}
            style={{padding:'8px 22px',background:'#1565C0',color:'#fff',border:'none',borderRadius:7,fontSize:13,fontWeight:700,cursor:'pointer'}}>
            {saving?'Saving…':'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AuthRenewalsPage() {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('open');
  const [filterPrio, setFilterPrio] = useState('ALL');
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

  const regionScope = useAssignedRegions();

  const load = useCallback(async () => {
    if (regionScope.loading) return;
    if (!regionScope.isAllAccess && (!regionScope.regions || regionScope.regions.length === 0)) {
      setTasks([]); setLoading(false); return;
    }
    const { data } = await regionScope.applyToQuery(
      supabase.from('auth_renewal_tasks').select('*').order('days_until_expiry', { ascending: true })
    );
    setTasks(data || []);
    setLoading(false);
  }, [regionScope.loading, regionScope.isAllAccess, JSON.stringify(regionScope.regions)]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => tasks.filter(t => {
    if (filterStatus !== 'ALL' && t.task_status !== filterStatus) return false;
    if (filterPrio !== 'ALL' && t.priority !== filterPrio) return false;
    if (filterRegion !== 'ALL' && t.region !== filterRegion) return false;
    if (search) { const q = search.toLowerCase(); if (!`${t.patient_name} ${t.insurance} ${t.assigned_to||''}`.toLowerCase().includes(q)) return false; }
    return true;
  }), [tasks, filterStatus, filterPrio, filterRegion, search]);

  const stats = useMemo(() => ({
    urgent: tasks.filter(t => t.priority==='urgent' && !['approved','denied','closed'].includes(t.task_status)).length,
    open: tasks.filter(t => t.task_status==='open').length,
    inProgress: tasks.filter(t => t.task_status==='in_progress').length,
    expiring7: tasks.filter(t => t.days_until_expiry <= 7 && !['approved','denied','closed'].includes(t.task_status)).length,
  }), [tasks]);

  if (loading) return (
    <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
      <TopBar title="Auth Renewals" subtitle="Loading..." />
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--gray)'}}>Loading...</div>
    </div>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',minHeight:'100%'}}>
      <TopBar title="Auth Renewals" subtitle={`${stats.open} open · ${stats.urgent} urgent · ${stats.expiring7} expiring within 7 days`} />
      <div style={{flex:1}}>

        {stats.urgent > 0 && (
          <div style={{background:'#FEF2F2',borderBottom:'2px solid #FECACA',padding:'8px 20px',display:'flex',alignItems:'center',gap:12}}>
            <span style={{fontSize:16}}>🚨</span>
            <span style={{fontSize:12,fontWeight:700,color:'#DC2626'}}>{stats.urgent} urgent auth renewal{stats.urgent>1?'s':''} — expiring ≤7 days or ≤4 visits remaining</span>
            <button onClick={()=>{setFilterPrio('urgent');setFilterStatus('open');}} style={{marginLeft:'auto',fontSize:11,fontWeight:600,color:'#DC2626',background:'white',border:'1px solid #FECACA',borderRadius:5,padding:'3px 10px',cursor:'pointer'}}>Show Urgent</button>
          </div>
        )}

        <div style={{padding:'10px 20px',borderBottom:'1px solid var(--border)',background:'var(--card-bg)',display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <div style={{display:'flex',gap:0,border:'1px solid var(--border)',borderRadius:7,overflow:'hidden'}}>
            {[['ALL','All'],['open','Open'],['in_progress','In Progress'],['submitted','Submitted'],['approved','Approved'],['denied','Denied']].map(([k,l]) => (
              <button key={k} onClick={()=>setFilterStatus(k)}
                style={{padding:'5px 10px',border:'none',fontSize:11,fontWeight:filterStatus===k?700:400,cursor:'pointer',background:filterStatus===k?'#0F1117':'var(--card-bg)',color:filterStatus===k?'#fff':'var(--gray)'}}>
                {l}
              </button>
            ))}
          </div>
          <select value={filterPrio} onChange={e=>setFilterPrio(e.target.value)}
            style={{padding:'5px 8px',border:'1px solid var(--border)',borderRadius:6,fontSize:11,outline:'none',background:'var(--card-bg)'}}>
            <option value="ALL">All Priority</option>
            <option value="urgent">🔴 Urgent</option>
            <option value="high">🟠 High</option>
            <option value="normal">🟡 Normal</option>
          </select>
          <select value={filterRegion} onChange={e=>setFilterRegion(e.target.value)}
            style={{padding:'5px 8px',border:'1px solid var(--border)',borderRadius:6,fontSize:11,outline:'none',background:'var(--card-bg)'}}>
            <option value="ALL">All Regions</option>
            {REGIONS.map(r=><option key={r} value={r}>Region {r}</option>)}
          </select>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search patient, insurance..."
            style={{padding:'5px 8px',border:'1px solid var(--border)',borderRadius:6,fontSize:11,outline:'none',background:'var(--card-bg)',width:180}} />
          <div style={{marginLeft:'auto',fontSize:11,color:'var(--gray)'}}>{filtered.length} shown</div>
        </div>

        <div style={{padding:20,display:'flex',flexDirection:'column',gap:16}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
            {[
              {label:'🔴 Urgent',val:stats.urgent,color:'#DC2626',bg:'#FEF2F2',sub:'≤7d or ≤4 visits'},
              {label:'📋 Open Tasks',val:stats.open,color:'#D97706',bg:'#FEF3C7',sub:'Awaiting action'},
              {label:'⏳ In Progress',val:stats.inProgress,color:'#1565C0',bg:'#EFF6FF',sub:'Being worked'},
              {label:'⚠ Expiring Soon',val:stats.expiring7,color:'#DC2626',bg:stats.expiring7>0?'#FEF2F2':'var(--card-bg)',sub:'Within 7 days'},
            ].map(c=>(
              <div key={c.label} style={{background:c.bg,border:'1px solid var(--border)',borderRadius:10,padding:'12px 14px'}}>
                <div style={{fontSize:10,fontWeight:700,color:c.color,textTransform:'uppercase',letterSpacing:'0.05em'}}>{c.label}</div>
                <div style={{fontSize:26,fontWeight:900,fontFamily:'DM Mono, monospace',color:c.color,marginTop:4}}>{c.val}</div>
                <div style={{fontSize:10,color:'var(--gray)',marginTop:2}}>{c.sub}</div>
              </div>
            ))}
          </div>

          <div style={{background:'var(--card-bg)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden'}}>
            <div style={{padding:'12px 20px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontSize:14,fontWeight:700}}>Auth Renewal Tasks</div>
              <div style={{fontSize:11,color:'var(--gray)'}}>{filtered.length} tasks · click to manage</div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1.6fr 0.4fr 0.8fr 0.7fr 0.6fr 0.6fr 0.9fr 1fr',padding:'8px 20px',background:'var(--bg)',borderBottom:'1px solid var(--border)',fontSize:10,fontWeight:700,color:'var(--gray)',textTransform:'uppercase',letterSpacing:'0.04em',gap:8}}>
              <span>Patient</span><span>Rgn</span><span>Insurance</span><span>Expires</span><span>Days Left</span><span>Visits Left</span><span>Status</span><span>Assigned To</span>
            </div>
            {filtered.length===0 ? (
              <div style={{padding:40,textAlign:'center',color:'var(--gray)'}}>No renewal tasks match current filters.</div>
            ) : filtered.map((t,i) => {
              const sc = STATUS_CFG[t.task_status]||STATUS_CFG.open;
              const pc = PRIO_CFG[t.priority]||PRIO_CFG.normal;
              const rowBg = t.priority==='urgent'?'#FFF5F5':t.priority==='high'?'#FFFBEB':i%2===0?'var(--card-bg)':'var(--bg)';
              return (
                <div key={t.id} onClick={()=>setSelected(t)} style={{display:'grid',gridTemplateColumns:'1.6fr 0.4fr 0.8fr 0.7fr 0.6fr 0.6fr 0.9fr 1fr',padding:'10px 20px',borderBottom:'1px solid var(--border)',background:rowBg,alignItems:'center',gap:8,cursor:'pointer'}}
                  onMouseEnter={e=>e.currentTarget.style.background='#EFF6FF'}
                  onMouseLeave={e=>e.currentTarget.style.background=rowBg}>
                  <div>
                    <div style={{fontSize:12,fontWeight:600}}>{t.patient_name}</div>
                    <span style={{fontSize:9,fontWeight:700,color:pc.color,background:pc.bg,padding:'1px 6px',borderRadius:999}}>{pc.label}</span>
                  </div>
                  <span style={{fontSize:12,fontWeight:700,color:'var(--gray)'}}>{t.region}</span>
                  <span style={{fontSize:11}}>{t.insurance}</span>
                  <span style={{fontSize:11,color:t.days_until_expiry<=7?'#DC2626':t.days_until_expiry<=14?'#D97706':'var(--black)',fontWeight:t.days_until_expiry<=14?700:400}}>{fmtDate(t.expiry_date)}</span>
                  <span style={{fontSize:14,fontWeight:900,fontFamily:'DM Mono, monospace',color:t.days_until_expiry<=7?'#DC2626':t.days_until_expiry<=14?'#D97706':'var(--black)'}}>{t.days_until_expiry}</span>
                  <span style={{fontSize:14,fontWeight:900,fontFamily:'DM Mono, monospace',color:t.visits_remaining<=4?'#DC2626':t.visits_remaining<=8?'#D97706':'var(--black)'}}>{t.visits_remaining}</span>
                  <span style={{fontSize:10,fontWeight:700,color:sc.color,background:sc.bg,padding:'2px 8px',borderRadius:999}}>{sc.label}</span>
                  <span style={{fontSize:11,color:t.assigned_to?'var(--black)':'#9CA3AF',fontStyle:t.assigned_to?'normal':'italic'}}>{t.assigned_to||'Unassigned'}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {selected && <ActionModal task={selected} onClose={()=>setSelected(null)} onSaved={()=>{setSelected(null);load();}} profile={profile} />}
    </div>
  );
}
