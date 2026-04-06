import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}
function daysSince(d) {
  if (!d) return null;
  return Math.floor((new Date() - new Date(d+'T00:00:00')) / 86400000);
}
function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d+'T00:00:00') - new Date()) / 86400000);
}

// ── Note Modal ────────────────────────────────────────────────────────────────
function NoteModal({ patient, onClose, onSaved, coordId }) {
  const [note, setNote] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [noteType, setNoteType] = useState('patient_contact');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!note.trim()) return;
    setSaving(true);
    await supabase.from('care_coord_notes').insert({
      patient_name: patient.patient_name,
      region: patient.region,
      note_type: noteType,
      note,
      coordinator_id: coordId,
      contact_date: new Date().toISOString().slice(0,10),
      follow_up_date: followUpDate || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:480, boxShadow:'0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ padding:'16px 22px', background:'#1565C0', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>{patient.patient_name}</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.6)', marginTop:2 }}>Rgn {patient.region} · {patient.status} · {patient.insurance}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'rgba(255,255,255,0.6)' }}>×</button>
        </div>
        <div style={{ padding:22, display:'flex', flexDirection:'column', gap:14 }}>
          <div>
            <label style={{ fontSize:11, fontWeight:700, display:'block', marginBottom:8 }}>Contact Type</label>
            <div style={{ display:'flex', gap:6 }}>
              {['patient_contact','family_contact','clinician_update','on_hold_outreach'].map(t => (
                <button key={t} onClick={() => setNoteType(t)}
                  style={{ padding:'6px 10px', borderRadius:6, border:`2px solid ${noteType===t?'#1565C0':'var(--border)'}`, background:noteType===t?'#EFF6FF':'var(--card-bg)', fontSize:10, fontWeight:700, color:noteType===t?'#1565C0':'var(--gray)', cursor:'pointer' }}>
                  {t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:700, display:'block', marginBottom:4 }}>Note</label>
            <textarea value={note} onChange={e=>setNote(e.target.value)} rows={4} placeholder="What happened on this contact? Any updates to patient status..."
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:7, fontSize:12, outline:'none', background:'var(--bg)', resize:'vertical', boxSizing:'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:700, display:'block', marginBottom:4 }}>Follow-Up Date (optional)</label>
            <input type="date" value={followUpDate} onChange={e=>setFollowUpDate(e.target.value)}
              style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }} />
          </div>
        </div>
        <div style={{ padding:'12px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
          <button onClick={onClose} style={{ padding:'7px 14px', border:'1px solid var(--border)', borderRadius:7, fontSize:12, cursor:'pointer', background:'var(--card-bg)' }}>Cancel</button>
          <button onClick={save} disabled={saving||!note.trim()}
            style={{ padding:'7px 18px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer', opacity:note.trim()?1:0.5 }}>
            {saving ? 'Saving…' : 'Log Contact'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Priority Task Item ─────────────────────────────────────────────────────────
function TaskItem({ priority, icon, title, subtitle, count, urgency, onClick }) {
  const colors = {
    critical: { bg:'#FEF2F2', border:'#FECACA', badge:'#DC2626', badgeBg:'#FEE2E2', text:'#DC2626' },
    urgent:   { bg:'#FEF3C7', border:'#FCD34D', badge:'#D97706', badgeBg:'#FEF3C7', text:'#92400E' },
    medium:   { bg:'#EFF6FF', border:'#BFDBFE', badge:'#1565C0', badgeBg:'#DBEAFE', text:'#1E40AF' },
    low:      { bg:'var(--card-bg)', border:'var(--border)', badge:'#6B7280', badgeBg:'#F3F4F6', text:'#6B7280' },
  };
  const c = colors[urgency] || colors.low;
  return (
    <div onClick={onClick} style={{ background:c.bg, border:`1px solid ${c.border}`, borderRadius:10, padding:'12px 14px', display:'flex', alignItems:'center', gap:12, cursor:onClick?'pointer':'default' }}
      onMouseEnter={e => onClick && (e.currentTarget.style.opacity='0.85')}
      onMouseLeave={e => onClick && (e.currentTarget.style.opacity='1')}>
      <div style={{ fontSize:22, width:32, textAlign:'center', flexShrink:0 }}>{icon}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:700, color:c.text }}>{title}</div>
        {subtitle && <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>{subtitle}</div>}
      </div>
      <div style={{ textAlign:'right', flexShrink:0 }}>
        <div style={{ fontSize:20, fontWeight:900, fontFamily:'DM Mono, monospace', color:c.badge }}>{count}</div>
        <div style={{ fontSize:9, fontWeight:700, color:c.badge, background:c.badgeBg, padding:'1px 6px', borderRadius:999, textTransform:'uppercase' }}>{urgency}</div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CareCoordMyPatients() {
  const { profile } = useAuth();
  const [census, setCensus] = useState([]);
  const [auths, setAuths] = useState([]);
  const [notes, setNotes] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [clinSettings, setClinSettings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [notePatient, setNotePatient] = useState(null);

  // Determine regions to show
  const myRegions = useMemo(() => {
    const role = profile?.role;
    if (['super_admin','admin','assoc_director','pod_leader'].includes(role)) return null;
    const r = profile?.regions;
    return Array.isArray(r) && r.length > 0 ? r : null;
  }, [profile]);

  const regionLabel = myRegions ? `Regions ${myRegions.join(', ')}` : 'All Regions';

  const load = useCallback(async () => {
    const filters = myRegions;
    const [c, a, n, r, cs] = await Promise.all([
      // Census
      (() => { let q = supabase.from('census_data').select('*'); if (filters) q = q.in('region', filters); return q; })(),
      // Auth tracker
      (() => { let q = supabase.from('auth_tracker').select('patient_name,auth_status,auth_expiry_date,region,insurance'); if (filters) q = q.in('region', filters); return q; })(),
      // Care coord notes (recent 90d)
      (() => { let q = supabase.from('care_coord_notes').select('*').gte('created_at', new Date(Date.now()-90*86400000).toISOString()).order('created_at',{ascending:false}); return q; })(),
      // Referrals accepted, needing action
      (() => { let q = supabase.from('intake_referrals').select('id,patient_name,region,referral_status,welcome_call,first_appt,chart_status,date_received,insurance').eq('referral_status','Accepted'); if (filters) q = q.in('region', filters); return q; })(),
      // Clinical settings for reassessment alerts
      (() => { let q = supabase.from('patient_clinical_settings').select('patient_name,region,reassessment_status,next_reassessment_deadline,alert_reassessment_unscheduled,visit_frequency,inferred_frequency'); if (filters) q = q.in('region', filters); return q; })(),
    ]);
    setCensus(c.data || []);
    setAuths(a.data || []);
    setNotes(n.data || []);
    setReferrals(r.data || []);
    setClinSettings(cs.data || []);
    setLoading(false);
  }, [myRegions]);

  useEffect(() => { load(); }, [load]);

  // ── Enrich census ──────────────────────────────────────────────────────────
  const enrichedCensus = useMemo(() => {
    const noteMap = {};
    notes.forEach(n => {
      const k = n.patient_name?.toLowerCase().trim();
      if (!noteMap[k] || n.contact_date > noteMap[k].contact_date) noteMap[k] = n;
    });
    const csMap = {};
    clinSettings.forEach(cs => { csMap[cs.patient_name?.toLowerCase().trim()] = cs; });

    return census.map(p => {
      const k = p.patient_name?.toLowerCase().trim();
      const lastNote = noteMap[k];
      const cs = csMap[k];
      const daysSinceContact = lastNote ? daysSince(lastNote.contact_date) : null;
      const followUpDue = lastNote?.follow_up_date ? new Date(lastNote.follow_up_date+'T00:00:00') <= new Date() : false;
      const reassessDeadline = cs?.next_reassessment_deadline;
      const daysToReassess = daysUntil(reassessDeadline);
      return { ...p, lastNote, daysSinceContact, followUpDue, cs, daysToReassess, reassessUnscheduled: cs?.alert_reassessment_unscheduled };
    });
  }, [census, notes, clinSettings]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active = enrichedCensus.filter(p => /active/i.test(p.status||''));
    const onHold = enrichedCensus.filter(p => /on.?hold/i.test(p.status||''));
    const pipeline = enrichedCensus.filter(p => /soc.?pending|eval.?pending/i.test(p.status||''));
    const noContact14 = active.filter(p => p.daysSinceContact === null || p.daysSinceContact > 14);
    const followUpsDue = active.filter(p => p.followUpDue);
    const reassessUrgent = enrichedCensus.filter(p => p.reassessUnscheduled && p.daysToReassess !== null && p.daysToReassess <= 14);
    const authExpiring = auths.filter(a => a.auth_status === 'active' && a.auth_expiry_date && daysUntil(a.auth_expiry_date) !== null && daysUntil(a.auth_expiry_date) <= 21);
    const welcomeCallNeeded = referrals.filter(r => !r.welcome_call || r.welcome_call === 'Not Called' || r.welcome_call === '');

    return {
      active: active.length, onHold: onHold.length, pipeline: pipeline.length,
      noContact14: noContact14.length, followUpsDue: followUpsDue.length,
      reassessUrgent: reassessUrgent.length, authExpiring: authExpiring.length,
      welcomeCallNeeded: welcomeCallNeeded.length,
      totalPatients: enrichedCensus.length,
    };
  }, [enrichedCensus, auths, referrals]);

  // ── Prioritized task list ──────────────────────────────────────────────────
  const prioritizedTasks = useMemo(() => {
    const tasks = [];

    // 1. Overdue follow-ups (CRITICAL - coordinator committed to follow up)
    const overdueFU = enrichedCensus.filter(p => p.followUpDue && /active/i.test(p.status||''));
    if (overdueFU.length) tasks.push({
      priority: 1, urgency: 'critical', icon: '📞',
      title: 'Overdue Follow-Ups',
      subtitle: `You committed to follow up — ${overdueFU.slice(0,3).map(p=>p.patient_name.split(',')[0]).join(', ')}${overdueFU.length>3?` +${overdueFU.length-3} more`:''}`,
      count: overdueFU.length, tab: 'follow_ups',
    });

    // 2. Reassessment critical (≤7d to deadline, unscheduled)
    const reassessCritical = enrichedCensus.filter(p => p.reassessUnscheduled && p.daysToReassess !== null && p.daysToReassess <= 7);
    if (reassessCritical.length) tasks.push({
      priority: 2, urgency: 'critical', icon: '🚨',
      title: 'Reassessments — Deadline This Week',
      subtitle: `45-day compliance deadline in ≤7 days, not scheduled in Pariox`,
      count: reassessCritical.length, tab: 'my_patients',
    });

    // 3. Auth expiring ≤14d
    const authCritical = auths.filter(a => a.auth_status==='active' && a.auth_expiry_date && daysUntil(a.auth_expiry_date) !== null && daysUntil(a.auth_expiry_date) <= 14);
    if (authCritical.length) tasks.push({
      priority: 3, urgency: 'critical', icon: '🔐',
      title: 'Auth Expiring — 14 Days or Less',
      subtitle: `Active patients whose authorization runs out this week or next`,
      count: authCritical.length, tab: 'my_patients',
    });

    // 4. Welcome calls needed
    const wcNeeded = referrals.filter(r => !r.welcome_call || r.welcome_call === 'Not Called' || r.welcome_call === '');
    if (wcNeeded.length) tasks.push({
      priority: 4, urgency: 'urgent', icon: '📋',
      title: 'Welcome Calls Outstanding',
      subtitle: `Accepted referrals — patient not yet contacted`,
      count: wcNeeded.length, tab: 'my_patients',
    });

    // 5. Reassessment urgent (≤14d)
    const reassessUrgent = enrichedCensus.filter(p => p.reassessUnscheduled && p.daysToReassess !== null && p.daysToReassess > 7 && p.daysToReassess <= 14);
    if (reassessUrgent.length) tasks.push({
      priority: 5, urgency: 'urgent', icon: '📅',
      title: 'Reassessments — Action This Week',
      subtitle: `Deadline within 14 days — needs Pariox scheduling now`,
      count: reassessUrgent.length, tab: 'my_patients',
    });

    // 6. No contact 14d+
    const noContact = enrichedCensus.filter(p => /active/i.test(p.status||'') && (p.daysSinceContact === null || p.daysSinceContact > 14));
    if (noContact.length) tasks.push({
      priority: 6, urgency: noContact.length > 20 ? 'urgent' : 'medium', icon: '👤',
      title: 'Active Patients — No Contact 14d+',
      subtitle: `Active patients you haven't logged contact with recently`,
      count: noContact.length, tab: 'no_contact',
    });

    // 7. Auth expiring 15-21d
    const authWarning = auths.filter(a => a.auth_status==='active' && a.auth_expiry_date && daysUntil(a.auth_expiry_date) !== null && daysUntil(a.auth_expiry_date) > 14 && daysUntil(a.auth_expiry_date) <= 21);
    if (authWarning.length) tasks.push({
      priority: 7, urgency: 'medium', icon: '⚠',
      title: 'Auth Expiring — 15–21 Days',
      subtitle: `Flag for Carla — renewal needs to be in progress`,
      count: authWarning.length, tab: 'my_patients',
    });

    // 8. On-hold patients to recover
    const onHold = enrichedCensus.filter(p => /on.?hold/i.test(p.status||''));
    if (onHold.length) tasks.push({
      priority: 8, urgency: 'medium', icon: '🔄',
      title: 'On-Hold Patients to Re-engage',
      subtitle: `Reach out and attempt to reschedule`,
      count: onHold.length, tab: 'on_hold',
    });

    // 9. SOC/Pipeline patients
    const soc = enrichedCensus.filter(p => /soc.?pending|eval.?pending/i.test(p.status||''));
    if (soc.length) tasks.push({
      priority: 9, urgency: 'low', icon: '⏳',
      title: 'SOC / Eval Pending',
      subtitle: `New patients awaiting start of care`,
      count: soc.length, tab: 'pipeline',
    });

    return tasks.sort((a,b) => a.priority - b.priority);
  }, [enrichedCensus, auths, referrals]);

  // ── Filtered list for patient tabs ────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = enrichedCensus;
    if (activeTab === 'my_patients') list = list.filter(p => /active/i.test(p.status||''));
    if (activeTab === 'no_contact')  list = list.filter(p => /active/i.test(p.status||'') && (p.daysSinceContact===null||p.daysSinceContact>14));
    if (activeTab === 'follow_ups')  list = list.filter(p => p.followUpDue);
    if (activeTab === 'on_hold')     list = list.filter(p => /on.?hold/i.test(p.status||''));
    if (activeTab === 'pipeline')    list = list.filter(p => /soc.?pending|eval.?pending/i.test(p.status||''));
    if (filterStatus) list = list.filter(p => p.status === filterStatus);
    if (search) { const q = search.toLowerCase(); list = list.filter(p => `${p.patient_name} ${p.region} ${p.insurance}`.toLowerCase().includes(q)); }
    // Sort: overdue follow-ups first, then by days since contact desc, then no-contact patients
    return [...list].sort((a,b) => {
      if (a.followUpDue && !b.followUpDue) return -1;
      if (!a.followUpDue && b.followUpDue) return 1;
      const aNoContact = a.daysSinceContact === null ? 9999 : a.daysSinceContact;
      const bNoContact = b.daysSinceContact === null ? 9999 : b.daysSinceContact;
      return bNoContact - aNoContact;
    });
  }, [enrichedCensus, activeTab, filterStatus, search]);

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="My Patients" subtitle="Loading..." />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading your dashboard...</div>
    </div>
  );

  const today = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  const coordName = profile?.full_name?.split(' ')[0] || 'Coordinator';

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%' }}>
      <TopBar
        title="My Dashboard"
        subtitle={`${regionLabel} · ${stats.active} active patients`}
        actions={<button onClick={load} style={{ padding:'5px 10px', background:'none', border:'1px solid var(--border)', borderRadius:6, fontSize:11, cursor:'pointer' }}>↻ Refresh</button>}
      />
      <div style={{ flex:1, overflowY:'auto' }}>
        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>

          {/* ── TAB BAR ── */}
          <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:8, overflow:'hidden', alignSelf:'flex-start', flexWrap:'wrap' }}>
            {[
              { k:'dashboard', l:'🏠 Dashboard' },
              { k:'my_patients', l:`Active Patients (${stats.active})` },
              { k:'no_contact', l:`No Contact (${stats.noContact14})` },
              { k:'follow_ups', l:`Follow-Ups Due (${stats.followUpsDue})` },
              { k:'on_hold', l:`On-Hold (${stats.onHold})` },
              { k:'pipeline', l:`Pipeline (${stats.pipeline})` },
            ].map(t => (
              <button key={t.k} onClick={() => setActiveTab(t.k)}
                style={{ padding:'7px 14px', border:'none', fontSize:11, fontWeight:activeTab===t.k?700:400, cursor:'pointer', background:activeTab===t.k?'#1565C0':'var(--card-bg)', color:activeTab===t.k?'#fff':'var(--gray)', borderRight:'1px solid var(--border)' }}>
                {t.l}
              </button>
            ))}
          </div>

          {/* ── DASHBOARD TAB ── */}
          {activeTab === 'dashboard' && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              {/* Greeting */}
              <div style={{ background:'linear-gradient(135deg, #1565C0 0%, #0D47A1 100%)', borderRadius:12, padding:'18px 22px', color:'#fff' }}>
                <div style={{ fontSize:18, fontWeight:800 }}>Good {new Date().getHours()<12?'morning':new Date().getHours()<17?'afternoon':'evening'}, {coordName} 👋</div>
                <div style={{ fontSize:12, color:'rgba(255,255,255,0.7)', marginTop:4 }}>{today} · {regionLabel}</div>
              </div>

              {/* KPI Strip */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10 }}>
                {[
                  { label:'Active Patients',    val:stats.active,         color:'#059669', bg:'#ECFDF5' },
                  { label:'No Contact 14d+',    val:stats.noContact14,    color:stats.noContact14>10?'#DC2626':'#D97706', bg:stats.noContact14>10?'#FEF2F2':'#FEF3C7' },
                  { label:'Follow-Ups Due',     val:stats.followUpsDue,   color:stats.followUpsDue>0?'#DC2626':'#059669', bg:stats.followUpsDue>0?'#FEF2F2':'#ECFDF5' },
                  { label:'Auth Expiring 21d',  val:stats.authExpiring,   color:stats.authExpiring>0?'#D97706':'#059669', bg:stats.authExpiring>0?'#FEF3C7':'#ECFDF5' },
                  { label:'On Hold',            val:stats.onHold,         color:'#7C3AED', bg:'#F5F3FF' },
                ].map(c => (
                  <div key={c.label} style={{ background:c.bg, border:'1px solid var(--border)', borderRadius:10, padding:'12px 14px', textAlign:'center' }}>
                    <div style={{ fontSize:8, fontWeight:700, color:c.color, textTransform:'uppercase', letterSpacing:'0.05em' }}>{c.label}</div>
                    <div style={{ fontSize:28, fontWeight:900, fontFamily:'DM Mono, monospace', color:c.color, marginTop:4 }}>{c.val}</div>
                  </div>
                ))}
              </div>

              {/* Prioritized Task List */}
              <div>
                <div style={{ fontSize:14, fontWeight:800, marginBottom:10 }}>
                  📋 Today's Priority List
                  <span style={{ fontSize:11, fontWeight:400, color:'var(--gray)', marginLeft:8 }}>Tackle in this order</span>
                </div>
                {prioritizedTasks.length === 0 ? (
                  <div style={{ background:'#ECFDF5', border:'1px solid #A7F3D0', borderRadius:10, padding:24, textAlign:'center' }}>
                    <div style={{ fontSize:28, marginBottom:8 }}>✅</div>
                    <div style={{ fontWeight:700, color:'#065F46' }}>All clear! No outstanding tasks right now.</div>
                    <div style={{ fontSize:12, color:'#059669', marginTop:4 }}>Great work — check back after your next Pariox upload for updates.</div>
                  </div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {prioritizedTasks.map((task, i) => (
                      <div key={i} style={{ display:'flex', gap:8, alignItems:'stretch' }}>
                        <div style={{ width:24, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'var(--gray)', flexShrink:0 }}>
                          {i+1}
                        </div>
                        <div style={{ flex:1 }}>
                          <TaskItem {...task} onClick={task.tab ? () => setActiveTab(task.tab) : null} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Contact Log */}
              <div>
                <div style={{ fontSize:14, fontWeight:800, marginBottom:10 }}>🗒 Recent Contact Log</div>
                {notes.slice(0,8).length === 0 ? (
                  <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:20, textAlign:'center', color:'var(--gray)', fontSize:12 }}>
                    No contact notes logged yet. Use the "Log Contact" button on any patient to start your record.
                  </div>
                ) : (
                  <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
                    {notes.slice(0,8).map((n,i) => (
                      <div key={n.id||i} style={{ padding:'10px 16px', borderBottom: i<Math.min(notes.length,8)-1?'1px solid var(--border)':'none', display:'flex', gap:12, alignItems:'flex-start' }}>
                        <div style={{ fontSize:11, color:'var(--gray)', minWidth:70 }}>{fmtDate(n.contact_date)}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:12, fontWeight:700 }}>{n.patient_name}</div>
                          <div style={{ fontSize:11, color:'var(--gray)', marginTop:1 }}>{n.note?.slice(0,100)}{n.note?.length>100?'…':''}</div>
                        </div>
                        {n.follow_up_date && (
                          <div style={{ fontSize:10, color:new Date(n.follow_up_date+'T00:00:00')<=new Date()?'#DC2626':'#D97706', fontWeight:700, flexShrink:0 }}>
                            Follow-up {fmtDate(n.follow_up_date)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── PATIENT LIST TABS ── */}
          {activeTab !== 'dashboard' && (
            <>
              {/* Alert banners */}
              {activeTab === 'follow_ups' && stats.followUpsDue > 0 && (
                <div style={{ background:'#FFFBEB', border:'1px solid #FCD34D', borderRadius:8, padding:'8px 14px', fontSize:12, fontWeight:700, color:'#92400E' }}>
                  ⚠ {stats.followUpsDue} follow-up(s) overdue — you committed to contact these patients
                </div>
              )}
              {activeTab === 'no_contact' && stats.noContact14 > 0 && (
                <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, padding:'8px 14px', fontSize:12, fontWeight:700, color:'#DC2626' }}>
                  🔴 {stats.noContact14} active patients with no logged contact in 14+ days
                </div>
              )}

              {/* Filters */}
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search patient name..."
                  style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)', width:200 }} />
                {(search||filterStatus) && <button onClick={() => {setSearch(''); setFilterStatus('');}} style={{ fontSize:10, color:'var(--gray)', background:'none', border:'1px solid var(--border)', borderRadius:5, padding:'3px 8px', cursor:'pointer' }}>Clear</button>}
                <div style={{ marginLeft:'auto', fontSize:11, color:'var(--gray)' }}>{filtered.length} patients</div>
              </div>

              {/* Patient Table */}
              <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
                <div style={{ display:'grid', gridTemplateColumns:'1.6fr 0.4fr 0.7fr 0.7fr 0.9fr 1fr 0.9fr', padding:'7px 16px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:9, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', gap:8 }}>
                  <span>Patient</span><span>Rgn</span><span>Status</span><span>Insurance</span><span>Last Seen</span><span>Last Contact</span><span>Action</span>
                </div>
                {filtered.length === 0 ? (
                  <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>
                    {activeTab==='no_contact' ? '✅ All active patients contacted within 14 days!' : activeTab==='follow_ups' ? '✅ No overdue follow-ups!' : 'No patients match current filters.'}
                  </div>
                ) : filtered.map((p,i) => {
                  const rowBg = p.followUpDue ? '#FFFBEB' : (p.daysSinceContact===null||p.daysSinceContact>21) ? '#FFF5F5' : i%2===0?'var(--card-bg)':'var(--bg)';
                  const contactColor = p.daysSinceContact===null ? '#DC2626' : p.daysSinceContact>14 ? '#D97706' : '#059669';
                  return (
                    <div key={p.id||i} style={{ display:'grid', gridTemplateColumns:'1.6fr 0.4fr 0.7fr 0.7fr 0.9fr 1fr 0.9fr', padding:'9px 16px', borderBottom:'1px solid var(--border)', background:rowBg, alignItems:'center', gap:8 }}>
                      <div>
                        <div style={{ fontSize:12, fontWeight:600 }}>{p.patient_name}</div>
                        {p.followUpDue && <div style={{ fontSize:9, color:'#DC2626', fontWeight:700 }}>⚠ Follow-up overdue: {fmtDate(p.lastNote?.follow_up_date)}</div>}
                        {p.reassessUnscheduled && p.daysToReassess !== null && p.daysToReassess <= 14 && <div style={{ fontSize:9, color:'#DC2626', fontWeight:700 }}>🚨 Reassessment due {fmtDate(p.cs?.next_reassessment_deadline)}</div>}
                      </div>
                      <span style={{ fontSize:11, fontWeight:700, color:'var(--gray)' }}>{p.region}</span>
                      <span style={{ fontSize:10 }}>{p.status?.slice(0,14)}</span>
                      <span style={{ fontSize:10, color:'var(--gray)' }}>{p.insurance}</span>
                      <span style={{ fontSize:11 }}>{fmtDate(p.last_visit_date)}</span>
                      <div>
                        {p.lastNote ? (
                          <>
                            <div style={{ fontSize:11, fontWeight:600, color:contactColor }}>{p.daysSinceContact===0?'Today':p.daysSinceContact===1?'Yesterday':`${p.daysSinceContact}d ago`}</div>
                            <div style={{ fontSize:9, color:'var(--gray)' }}>{p.lastNote.note?.slice(0,40)}{p.lastNote.note?.length>40?'…':''}</div>
                          </>
                        ) : (
                          <span style={{ fontSize:11, color:'#DC2626', fontWeight:700 }}>Never logged</span>
                        )}
                      </div>
                      <button onClick={() => setNotePatient(p)}
                        style={{ padding:'5px 10px', background:'#1565C0', color:'#fff', border:'none', borderRadius:6, fontSize:10, fontWeight:700, cursor:'pointer' }}>
                        Log Contact
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {notePatient && (
        <NoteModal patient={notePatient} coordId={profile?.id}
          onClose={() => setNotePatient(null)}
          onSaved={() => { setNotePatient(null); load(); }} />
      )}
    </div>
  );
}
