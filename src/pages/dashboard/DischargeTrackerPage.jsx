import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

const REASONS = ['goals_met','patient_request','insurance_exhausted','non_compliance','moved','deceased','hospitalized','physician_order','other'];
const OUTCOMES = ['independent','improved','referred_out','readmit_possible','no_change','unknown'];

function fmtDate(d) { if(!d)return'—'; return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function daysAgo(d) { if(!d)return null; return Math.floor((new Date()-new Date(d+'T00:00:00'))/86400000); }

function DischargeModal({ discharge, onClose, onSaved, profile }) {
  const [form, setForm] = useState({
    discharge_date: discharge.discharge_date || new Date().toISOString().slice(0,10),
    discharge_reason: discharge.discharge_reason || 'other',
    discharge_reason_notes: discharge.discharge_reason_notes || '',
    outcome: discharge.outcome || 'unknown',
    followup_30day_required: discharge.followup_30day_required !== false,
    followup_30day_completed: discharge.followup_30day_completed || false,
    followup_30day_date: discharge.followup_30day_date || '',
    followup_30day_notes: discharge.followup_30day_notes || '',
    total_visits_completed: discharge.total_visits_completed || '',
    clinician: discharge.clinician || '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await supabase.from('patient_discharges').update({
      ...form,
      total_visits_completed: form.total_visits_completed ? parseInt(form.total_visits_completed) : null,
      discharged_by: profile?.full_name || profile?.email,
      updated_at: new Date().toISOString(),
    }).eq('id', discharge.id);
    setSaving(false);
    onSaved();
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:24,overflowY:'auto'}}>
      <div style={{background:'var(--card-bg)',borderRadius:14,width:'100%',maxWidth:560,boxShadow:'0 24px 60px rgba(0,0,0,0.35)'}}>
        <div style={{padding:'16px 22px',background:'#065F46',borderRadius:'14px 14px 0 0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:'#fff'}}>{discharge.patient_name}</div>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.6)',marginTop:2}}>Region {discharge.region} · {discharge.insurance}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'rgba(255,255,255,0.6)'}}>×</button>
        </div>
        <div style={{padding:22,display:'flex',flexDirection:'column',gap:14}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div>
              <label style={{fontSize:11,fontWeight:700,display:'block',marginBottom:4}}>Discharge Date</label>
              <input type="date" value={form.discharge_date} onChange={e=>setForm(f=>({...f,discharge_date:e.target.value}))}
                style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:12,outline:'none',background:'var(--card-bg)',boxSizing:'border-box'}} />
            </div>
            <div>
              <label style={{fontSize:11,fontWeight:700,display:'block',marginBottom:4}}>Total Visits</label>
              <input type="number" value={form.total_visits_completed} onChange={e=>setForm(f=>({...f,total_visits_completed:e.target.value}))}
                style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:12,outline:'none',background:'var(--card-bg)',boxSizing:'border-box'}} />
            </div>
          </div>
          <div>
            <label style={{fontSize:11,fontWeight:700,display:'block',marginBottom:4}}>Discharge Reason</label>
            <select value={form.discharge_reason} onChange={e=>setForm(f=>({...f,discharge_reason:e.target.value}))}
              style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:12,outline:'none',background:'var(--card-bg)'}}>
              {REASONS.map(r=><option key={r} value={r}>{r.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>)}
            </select>
            <input value={form.discharge_reason_notes} onChange={e=>setForm(f=>({...f,discharge_reason_notes:e.target.value}))}
              placeholder="Additional notes on discharge reason..."
              style={{marginTop:6,width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:12,outline:'none',background:'var(--card-bg)',boxSizing:'border-box'}} />
          </div>
          <div>
            <label style={{fontSize:11,fontWeight:700,display:'block',marginBottom:4}}>Patient Outcome</label>
            <select value={form.outcome} onChange={e=>setForm(f=>({...f,outcome:e.target.value}))}
              style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:12,outline:'none',background:'var(--card-bg)'}}>
              {OUTCOMES.map(o=><option key={o} value={o}>{o.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:11,fontWeight:700,display:'block',marginBottom:4}}>Clinician</label>
            <input value={form.clinician} onChange={e=>setForm(f=>({...f,clinician:e.target.value}))}
              placeholder="Discharging clinician name..."
              style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:12,outline:'none',background:'var(--card-bg)',boxSizing:'border-box'}} />
          </div>
          <div style={{background:'var(--bg)',borderRadius:8,padding:14}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
              <input type="checkbox" checked={form.followup_30day_required} onChange={e=>setForm(f=>({...f,followup_30day_required:e.target.checked}))} id="req30" />
              <label htmlFor="req30" style={{fontSize:12,fontWeight:600}}>30-Day Follow-Up Required</label>
            </div>
            {form.followup_30day_required && (
              <div style={{display:'flex',flexDirection:'column',gap:8,paddingTop:4}}>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <input type="checkbox" checked={form.followup_30day_completed} onChange={e=>setForm(f=>({...f,followup_30day_completed:e.target.checked}))} id="done30" />
                  <label htmlFor="done30" style={{fontSize:12}}>Follow-up completed</label>
                  {form.followup_30day_completed && (
                    <input type="date" value={form.followup_30day_date} onChange={e=>setForm(f=>({...f,followup_30day_date:e.target.value}))}
                      style={{padding:'4px 8px',border:'1px solid var(--border)',borderRadius:6,fontSize:11,outline:'none',background:'var(--card-bg)'}} />
                  )}
                </div>
                <textarea value={form.followup_30day_notes} onChange={e=>setForm(f=>({...f,followup_30day_notes:e.target.value}))}
                  placeholder="Follow-up notes, patient status at 30 days..."
                  style={{width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:12,outline:'none',boxSizing:'border-box',resize:'vertical',minHeight:56,background:'var(--card-bg)'}} />
              </div>
            )}
          </div>
        </div>
        <div style={{padding:'14px 22px',borderTop:'1px solid var(--border)',display:'flex',justifyContent:'flex-end',gap:8,background:'var(--bg)'}}>
          <button onClick={onClose} style={{padding:'8px 16px',border:'1px solid var(--border)',borderRadius:7,fontSize:13,background:'var(--card-bg)',cursor:'pointer'}}>Cancel</button>
          <button onClick={save} disabled={saving}
            style={{padding:'8px 22px',background:'#065F46',color:'#fff',border:'none',borderRadius:7,fontSize:13,fontWeight:700,cursor:'pointer'}}>
            {saving?'Saving…':'Save Discharge Record'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DischargeTrackerPage() {
  const { profile } = useAuth();
  const [discharges, setDischarges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState('pending_followup');
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

  const load = useCallback(async () => {
    const { data } = await supabase.from('patient_discharges').select('*').order('discharge_date', { ascending: false });
    setDischarges(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const enriched = useMemo(() => discharges.map(d => ({
    ...d,
    daysAgo: d.discharge_date ? daysAgo(d.discharge_date) : null,
    followupOverdue: d.followup_30day_required && !d.followup_30day_completed && d.discharge_date && daysAgo(d.discharge_date) >= 30,
    followupDueSoon: d.followup_30day_required && !d.followup_30day_completed && d.discharge_date && daysAgo(d.discharge_date) >= 25 && daysAgo(d.discharge_date) < 30,
  })), [discharges]);

  const filtered = useMemo(() => enriched.filter(d => {
    if (filterTab === 'pending_followup' && !(d.followup_30day_required && !d.followup_30day_completed)) return false;
    if (filterTab === 'overdue' && !d.followupOverdue) return false;
    if (filterTab === 'incomplete' && !(d.discharge_reason === 'other' && !d.outcome)) return false;
    if (filterRegion !== 'ALL' && d.region !== filterRegion) return false;
    if (search) { const q = search.toLowerCase(); if (!`${d.patient_name} ${d.clinician||''} ${d.insurance}`.toLowerCase().includes(q)) return false; }
    return true;
  }), [enriched, filterTab, filterRegion, search]);

  const stats = useMemo(() => ({
    total: discharges.length,
    overdue30: enriched.filter(d=>d.followupOverdue).length,
    pendingFollowup: enriched.filter(d=>d.followup_30day_required&&!d.followup_30day_completed).length,
    thisMonth: discharges.filter(d=>d.discharge_date?.startsWith(new Date().toISOString().slice(0,7))).length,
  }), [discharges, enriched]);

  if (loading) return (
    <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
      <TopBar title="Discharge Tracker" subtitle="Loading..." />
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--gray)'}}>Loading...</div>
    </div>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',minHeight:'100%'}}>
      <TopBar title="Discharge Tracker" subtitle={`${stats.total} discharges · ${stats.pendingFollowup} pending 30-day follow-up · ${stats.overdue30} overdue`} />
      <div style={{flex:1}}>
        {stats.overdue30 > 0 && (
          <div style={{background:'#FEF2F2',borderBottom:'2px solid #FECACA',padding:'8px 20px',display:'flex',alignItems:'center',gap:12}}>
            <span style={{fontSize:16}}>⚠</span>
            <span style={{fontSize:12,fontWeight:700,color:'#DC2626'}}>{stats.overdue30} patient{stats.overdue30>1?'s':''} are 30+ days post-discharge without a follow-up — complete now</span>
            <button onClick={()=>setFilterTab('overdue')} style={{marginLeft:'auto',fontSize:11,fontWeight:600,color:'#DC2626',background:'white',border:'1px solid #FECACA',borderRadius:5,padding:'3px 10px',cursor:'pointer'}}>Show Overdue</button>
          </div>
        )}
        <div style={{padding:'10px 20px',borderBottom:'1px solid var(--border)',background:'var(--card-bg)',display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <div style={{display:'flex',gap:0,border:'1px solid var(--border)',borderRadius:7,overflow:'hidden'}}>
            {[['all','All Discharges'],['pending_followup','📅 Pending Follow-Up'],['overdue','⚠ Overdue'],['incomplete','📋 Incomplete Records']].map(([k,l])=>(
              <button key={k} onClick={()=>setFilterTab(k)}
                style={{padding:'5px 10px',border:'none',fontSize:11,fontWeight:filterTab===k?700:400,cursor:'pointer',background:filterTab===k?'#0F1117':'var(--card-bg)',color:filterTab===k?'#fff':'var(--gray)'}}>
                {l}
              </button>
            ))}
          </div>
          <select value={filterRegion} onChange={e=>setFilterRegion(e.target.value)}
            style={{padding:'5px 8px',border:'1px solid var(--border)',borderRadius:6,fontSize:11,outline:'none',background:'var(--card-bg)'}}>
            <option value="ALL">All Regions</option>
            {REGIONS.map(r=><option key={r} value={r}>Region {r}</option>)}
          </select>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search patient..."
            style={{padding:'5px 8px',border:'1px solid var(--border)',borderRadius:6,fontSize:11,outline:'none',background:'var(--card-bg)',width:160}} />
          <div style={{marginLeft:'auto',fontSize:11,color:'var(--gray)'}}>{filtered.length} shown</div>
        </div>
        <div style={{padding:20,display:'flex',flexDirection:'column',gap:16}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
            {[
              {label:'Total Discharges',val:stats.total,color:'var(--black)',bg:'var(--card-bg)',sub:'Historical records'},
              {label:'This Month',val:stats.thisMonth,color:'#1565C0',bg:'#EFF6FF',sub:'Recent discharges'},
              {label:'📅 Pending 30-Day',val:stats.pendingFollowup,color:'#D97706',bg:'#FEF3C7',sub:'Follow-up outstanding'},
              {label:'⚠ Overdue',val:stats.overdue30,color:'#DC2626',bg:stats.overdue30>0?'#FEF2F2':'var(--card-bg)',sub:'30+ days no follow-up'},
            ].map(c=>(
              <div key={c.label} style={{background:c.bg,border:'1px solid var(--border)',borderRadius:10,padding:'12px 14px'}}>
                <div style={{fontSize:10,fontWeight:700,color:c.color,textTransform:'uppercase',letterSpacing:'0.05em'}}>{c.label}</div>
                <div style={{fontSize:26,fontWeight:900,fontFamily:'DM Mono, monospace',color:c.color,marginTop:4}}>{c.val}</div>
                <div style={{fontSize:10,color:'var(--gray)',marginTop:2}}>{c.sub}</div>
              </div>
            ))}
          </div>
          <div style={{background:'var(--card-bg)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden'}}>
            <div style={{padding:'12px 20px',borderBottom:'1px solid var(--border)',fontSize:14,fontWeight:700}}>Discharge Records</div>
            <div style={{display:'grid',gridTemplateColumns:'1.6fr 0.4fr 0.8fr 0.8fr 0.6fr 0.9fr 0.8fr 0.9fr',padding:'8px 20px',background:'var(--bg)',borderBottom:'1px solid var(--border)',fontSize:10,fontWeight:700,color:'var(--gray)',textTransform:'uppercase',letterSpacing:'0.04em',gap:8}}>
              <span>Patient</span><span>Rgn</span><span>Insurance</span><span>Discharge Date</span><span>Days Ago</span><span>Reason</span><span>Outcome</span><span>30-Day F/U</span>
            </div>
            {filtered.length===0?(
              <div style={{padding:40,textAlign:'center',color:'var(--gray)'}}>No discharge records match current filters.</div>
            ):filtered.map((d,i)=>{
              const rowBg=d.followupOverdue?'#FFF5F5':d.followupDueSoon?'#FFFBEB':i%2===0?'var(--card-bg)':'var(--bg)';
              return (
                <div key={d.id} onClick={()=>setSelected(d)} style={{display:'grid',gridTemplateColumns:'1.6fr 0.4fr 0.8fr 0.8fr 0.6fr 0.9fr 0.8fr 0.9fr',padding:'10px 20px',borderBottom:'1px solid var(--border)',background:rowBg,alignItems:'center',gap:8,cursor:'pointer'}}
                  onMouseEnter={e=>e.currentTarget.style.background='#EFF6FF'}
                  onMouseLeave={e=>e.currentTarget.style.background=rowBg}>
                  <div>
                    <div style={{fontSize:12,fontWeight:600}}>{d.patient_name}</div>
                    {d.clinician&&<div style={{fontSize:10,color:'var(--gray)'}}>{d.clinician}</div>}
                  </div>
                  <span style={{fontSize:12,fontWeight:700,color:'var(--gray)'}}>{d.region}</span>
                  <span style={{fontSize:11}}>{d.insurance}</span>
                  <span style={{fontSize:11}}>{fmtDate(d.discharge_date)}</span>
                  <span style={{fontSize:12,fontFamily:'DM Mono, monospace',fontWeight:700,color:d.followupOverdue?'#DC2626':'var(--gray)'}}>{d.daysAgo!==null?`${d.daysAgo}d`:'—'}</span>
                  <span style={{fontSize:10,color:'var(--gray)'}}>{(d.discharge_reason||'other').replace(/_/g,' ')}</span>
                  <span style={{fontSize:10,color:d.outcome&&d.outcome!=='unknown'?'#065F46':'#9CA3AF'}}>{d.outcome?d.outcome.replace(/_/g,' '):'—'}</span>
                  <div>
                    {!d.followup_30day_required?(<span style={{fontSize:10,color:'var(--gray)'}}>Not req.</span>)
                    :d.followup_30day_completed?(<span style={{fontSize:10,fontWeight:700,color:'#065F46',background:'#ECFDF5',padding:'2px 7px',borderRadius:999}}>✅ Done</span>)
                    :d.followupOverdue?(<span style={{fontSize:10,fontWeight:700,color:'#DC2626',background:'#FEF2F2',padding:'2px 7px',borderRadius:999}}>⚠ OVERDUE</span>)
                    :(<span style={{fontSize:10,fontWeight:600,color:'#D97706',background:'#FEF3C7',padding:'2px 7px',borderRadius:999}}>Pending ({d.daysAgo}d)</span>)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {selected&&<DischargeModal discharge={selected} onClose={()=>setSelected(null)} onSaved={()=>{setSelected(null);load();}} profile={profile} />}
    </div>
  );
}
