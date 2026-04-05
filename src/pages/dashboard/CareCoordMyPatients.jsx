import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

// Care coordinator region assignments (from org knowledge)
const COORD_REGIONS = {
  'gypsy': ['A'],
  'mary':  ['B','C','G'],
  'audrey':['H','J','M','N'],
  'april': ['T','V'],
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function daysSince(d) {
  if (!d) return null;
  return Math.floor((new Date() - new Date(d+'T00:00:00')) / 86400000);
}

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
              {[['patient_contact','📞 Patient Contact'],['on_hold_followup','🔄 Hold Follow-Up'],['scheduling','📅 Scheduling'],['clinical_update','🏥 Clinical'],['other','Other']].map(([k,l]) => (
                <button key={k} onClick={() => setNoteType(k)}
                  style={{ flex:1, padding:'5px 4px', borderRadius:6, border:`2px solid ${noteType===k?'#1565C0':'var(--border)'}`, background:noteType===k?'#EFF6FF':'var(--card-bg)', fontSize:9, fontWeight:700, color:noteType===k?'#1565C0':'var(--gray)', cursor:'pointer' }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:700, display:'block', marginBottom:4 }}>Note</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} autoFocus
              placeholder="What happened on this contact? Patient status, barriers, next steps..."
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:100, background:'var(--card-bg)' }} />
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:700, display:'block', marginBottom:4 }}>Follow-Up Date</label>
            <input type="date" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)}
              style={{ padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }} />
          </div>
        </div>
        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
          <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, cursor:'pointer', background:'var(--card-bg)' }}>Cancel</button>
          <button onClick={save} disabled={saving || !note.trim()}
            style={{ padding:'8px 22px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor:'pointer', opacity:!note.trim()?0.5:1 }}>
            {saving ? 'Saving…' : 'Log Contact'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CareCoordMyPatients() {
  const { profile } = useAuth();
  const [census, setCensus] = useState([]);
  const [visits, setVisits] = useState([]);
  const [notes, setNotes] = useState([]);
  const [onHold, setOnHold] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('my_patients');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [noteModal, setNoteModal] = useState(null);

  // Detect which coordinator this is from their name
  const myRegions = useMemo(() => {
    if (!profile?.full_name) return [];
    const firstName = profile.full_name.split(' ')[0].toLowerCase();
    return COORD_REGIONS[firstName] || (profile.regions || []);
  }, [profile]);

  const load = useCallback(async () => {
    if (!myRegions.length) { setLoading(false); return; }
    const regionFilter = myRegions.join(',');
    const [c, v, n, oh] = await Promise.all([
      supabase.from('census_data').select('*').in('region', myRegions),
      supabase.from('visit_schedule_data').select('patient_name,visit_date,status,event_type,staff_name,region')
        .in('region', myRegions).gte('visit_date', new Date(Date.now()-14*86400000).toISOString().slice(0,10)),
      supabase.from('care_coord_notes').select('*').in('region', myRegions).order('created_at',{ascending:false}).limit(200),
      supabase.from('on_hold_recovery').select('*').in('region', myRegions),
    ]);
    setCensus(c.data || []);
    setVisits(v.data || []);
    setNotes(n.data || []);
    setOnHold(oh.data || []);
    setLoading(false);
  }, [myRegions]);

  useEffect(() => { load(); }, [load]);

  const notesMap = useMemo(() => {
    const map = {};
    notes.forEach(n => {
      const k = n.patient_name?.toLowerCase().trim();
      if (!map[k]) map[k] = [];
      map[k].push(n);
    });
    return map;
  }, [notes]);

  const lastVisitMap = useMemo(() => {
    const map = {};
    visits.forEach(v => {
      const k = v.patient_name?.toLowerCase().trim();
      if (/completed/i.test(v.status||'')) {
        if (!map[k] || v.visit_date > map[k].visit_date) map[k] = v;
      }
    });
    return map;
  }, [visits]);

  const enrichedCensus = useMemo(() => census.map(p => {
    const k = p.patient_name?.toLowerCase().trim();
    const lastNote = notesMap[k]?.[0];
    const lastVisit = lastVisitMap[k];
    return {
      ...p,
      lastNote,
      lastContactDate: lastNote?.contact_date,
      daysSinceContact: lastNote ? daysSince(lastNote.contact_date) : null,
      lastVisitDate: lastVisit?.visit_date || p.last_visit_date,
      daysSinceVisit: p.days_since_last_visit || (lastVisit ? daysSince(lastVisit.visit_date) : null),
      noteCount: notesMap[k]?.length || 0,
      followUpDue: lastNote?.follow_up_date && new Date(lastNote.follow_up_date+'T00:00:00') <= new Date(),
    };
  }), [census, notesMap, lastVisitMap]);

  const stats = useMemo(() => ({
    totalPatients: census.length,
    activePatients: census.filter(p => /active/i.test(p.status||'')).length,
    onHoldPatients: census.filter(p => /on.?hold/i.test(p.status||'')).length,
    noRecentContact: enrichedCensus.filter(p => /active/i.test(p.status||'') && (p.daysSinceContact === null || p.daysSinceContact > 14)).length,
    followUpsDue: enrichedCensus.filter(p => p.followUpDue).length,
    notSeenRecently: enrichedCensus.filter(p => /active/i.test(p.status||'') && (p.daysSinceVisit === null || p.daysSinceVisit > 14)).length,
    socPending: census.filter(p => /soc.?pending|eval.?pending/i.test(p.status||'')).length,
  }), [census, enrichedCensus]);

  const filtered = useMemo(() => {
    let list = enrichedCensus;
    if (activeTab === 'my_patients') list = list.filter(p => /active/i.test(p.status||''));
    if (activeTab === 'no_contact')  list = list.filter(p => /active/i.test(p.status||'') && (p.daysSinceContact === null || p.daysSinceContact > 14));
    if (activeTab === 'follow_ups')  list = list.filter(p => p.followUpDue);
    if (activeTab === 'on_hold')     list = list.filter(p => /on.?hold/i.test(p.status||''));
    if (activeTab === 'pipeline')    list = list.filter(p => /soc.?pending|eval.?pending/i.test(p.status||''));
    if (filterStatus !== 'ALL') list = list.filter(p => p.status === filterStatus);
    if (search) { const q = search.toLowerCase(); list = list.filter(p => `${p.patient_name} ${p.insurance} ${p.last_visit_clinician||''}`.toLowerCase().includes(q)); }
    return [...list].sort((a, b) => (b.daysSinceContact ?? 9999) - (a.daysSinceContact ?? 9999));
  }, [enrichedCensus, activeTab, filterStatus, search]);

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="My Patients" subtitle="Loading..." />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading your patient list...</div>
    </div>
  );

  if (!myRegions.length) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="My Patients" subtitle="No regions assigned" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)', textAlign:'center', padding:40 }}>
        <div>
          <div style={{ fontSize:32, marginBottom:12 }}>📋</div>
          <div style={{ fontWeight:700, marginBottom:4 }}>No regions assigned to your account</div>
          <div style={{ fontSize:12, color:'var(--gray)' }}>Contact your administrator to assign regions to your profile.</div>
        </div>
      </div>
    </div>
  );

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%' }}>
      <TopBar
        title={`My Patients — Region${myRegions.length > 1 ? 's' : ''} ${myRegions.join(', ')}`}
        subtitle={`${today} · ${stats.activePatients} active · ${stats.noRecentContact} need contact`}
        actions={<button onClick={load} style={{ padding:'6px 14px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer' }}>↻ Refresh</button>}
      />

      {/* Alert banners */}
      {stats.followUpsDue > 0 && (
        <div style={{ background:'#FEF3C7', borderBottom:'2px solid #FCD34D', padding:'7px 20px', display:'flex', alignItems:'center', gap:10 }}>
          <span>📅</span>
          <span style={{ fontSize:12, fontWeight:700, color:'#92400E' }}>{stats.followUpsDue} follow-up(s) due today — check the Follow-Ups tab</span>
          <button onClick={() => setActiveTab('follow_ups')} style={{ marginLeft:'auto', fontSize:10, fontWeight:700, color:'#92400E', background:'white', border:'1px solid #FCD34D', borderRadius:5, padding:'3px 8px', cursor:'pointer' }}>View</button>
        </div>
      )}
      {stats.noRecentContact > 0 && (
        <div style={{ background:'#FEF2F2', borderBottom:'1px solid #FECACA', padding:'7px 20px', display:'flex', alignItems:'center', gap:10 }}>
          <span>⚠</span>
          <span style={{ fontSize:12, fontWeight:700, color:'#DC2626' }}>{stats.noRecentContact} active patients have not been contacted in 14+ days</span>
          <button onClick={() => setActiveTab('no_contact')} style={{ marginLeft:'auto', fontSize:10, fontWeight:700, color:'#DC2626', background:'white', border:'1px solid #FECACA', borderRadius:5, padding:'3px 8px', cursor:'pointer' }}>View List</button>
        </div>
      )}

      <div style={{ flex:1, overflowY:'auto' }}>
        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>

          {/* KPI row */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10 }}>
            {[
              { label:'My Active Patients', val:stats.activePatients, color:'#059669', bg:'#ECFDF5' },
              { label:'📞 Need Contact 14d+', val:stats.noRecentContact, color:'#DC2626', bg:'#FEF2F2' },
              { label:'📅 Follow-Ups Due', val:stats.followUpsDue, color:'#D97706', bg:'#FEF3C7' },
              { label:'🔄 On Hold', val:stats.onHoldPatients, color:'#7C3AED', bg:'#F5F3FF' },
              { label:'⏳ SOC/Eval Pending', val:stats.socPending, color:'#1565C0', bg:'#EFF6FF' },
            ].map(c => (
              <div key={c.label} style={{ background:c.bg, border:'1px solid var(--border)', borderRadius:10, padding:'10px 12px', textAlign:'center' }}>
                <div style={{ fontSize:8, fontWeight:700, color:c.color, textTransform:'uppercase', letterSpacing:'0.05em' }}>{c.label}</div>
                <div style={{ fontSize:24, fontWeight:900, fontFamily:'DM Mono, monospace', color:c.color, marginTop:2 }}>{c.val}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:8, overflow:'hidden', alignSelf:'flex-start' }}>
            {[
              { k:'my_patients', l:`Active (${stats.activePatients})` },
              { k:'no_contact',  l:`📞 Need Contact (${stats.noRecentContact})` },
              { k:'follow_ups',  l:`📅 Follow-Ups (${stats.followUpsDue})` },
              { k:'on_hold',     l:`🔄 On Hold (${stats.onHoldPatients})` },
              { k:'pipeline',    l:`⏳ Pipeline (${stats.socPending})` },
            ].map(t => (
              <button key={t.k} onClick={() => setActiveTab(t.k)}
                style={{ padding:'7px 14px', border:'none', fontSize:11, fontWeight:activeTab===t.k?700:400, cursor:'pointer', background:activeTab===t.k?'#1565C0':'var(--card-bg)', color:activeTab===t.k?'#fff':'var(--gray)', borderRight:'1px solid var(--border)' }}>
                {t.l}
              </button>
            ))}
          </div>

          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient..."
              style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)', width:200 }} />
            <div style={{ marginLeft:'auto', fontSize:11, color:'var(--gray)' }}>{filtered.length} patients</div>
          </div>

          {/* Patient Table */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ display:'grid', gridTemplateColumns:'1.8fr 0.4fr 0.9fr 0.9fr 0.7fr 0.8fr 0.8fr 1fr', padding:'8px 16px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:9, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', gap:8 }}>
              <span>Patient</span><span>Rgn</span><span>Insurance</span><span>Status</span><span>Last Visit</span><span>Last Contact</span><span>Follow-Up</span><span>Action</span>
            </div>
            {filtered.length === 0 ? (
              <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>
                {activeTab === 'no_contact' ? '✅ All active patients contacted within 14 days!' : 'No patients match current filters.'}
              </div>
            ) : filtered.map((p, i) => {
              const contactColor = p.daysSinceContact === null ? '#DC2626' : p.daysSinceContact > 14 ? '#DC2626' : p.daysSinceContact > 7 ? '#D97706' : '#059669';
              const visitColor = p.daysSinceVisit === null ? '#9CA3AF' : p.daysSinceVisit > 14 ? '#DC2626' : p.daysSinceVisit > 7 ? '#D97706' : '#059669';
              const rowBg = p.followUpDue ? '#FFF8F0' : (p.daysSinceContact === null || p.daysSinceContact > 14) && /active/i.test(p.status||'') ? '#FFF5F5' : i%2===0?'var(--card-bg)':'var(--bg)';
              return (
                <div key={p.patient_name+i} style={{ display:'grid', gridTemplateColumns:'1.8fr 0.4fr 0.9fr 0.9fr 0.7fr 0.8fr 0.8fr 1fr', padding:'9px 16px', borderBottom:'1px solid var(--border)', background:rowBg, alignItems:'center', gap:8 }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600 }}>{p.patient_name}</div>
                    {p.noteCount > 0 && <div style={{ fontSize:9, color:'#1565C0' }}>{p.noteCount} note{p.noteCount>1?'s':''} logged</div>}
                  </div>
                  <span style={{ fontSize:11, fontWeight:700, color:'var(--gray)' }}>{p.region}</span>
                  <span style={{ fontSize:11 }}>{p.insurance}</span>
                  <span style={{ fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:999, background:/active/i.test(p.status||'')?'#ECFDF5':/hold/i.test(p.status||'')?'#F5F3FF':'#F3F4F6', color:/active/i.test(p.status||'')?'#065F46':/hold/i.test(p.status||'')?'#7C3AED':'#6B7280' }}>
                    {p.status}
                  </span>
                  <div>
                    <div style={{ fontSize:11, fontWeight:600, color:visitColor }}>
                      {p.daysSinceVisit !== null ? `${p.daysSinceVisit}d ago` : 'None'}
                    </div>
                    <div style={{ fontSize:9, color:'var(--gray)' }}>{fmtDate(p.lastVisitDate)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize:11, fontWeight:600, color:contactColor }}>
                      {p.daysSinceContact !== null ? `${p.daysSinceContact}d ago` : 'Never'}
                    </div>
                    {p.lastNote && <div style={{ fontSize:9, color:'var(--gray)', maxWidth:80, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.lastNote.note}</div>}
                  </div>
                  <div>
                    {p.followUpDue ? (
                      <span style={{ fontSize:9, fontWeight:700, color:'#D97706', background:'#FEF3C7', padding:'2px 6px', borderRadius:999 }}>📅 Due</span>
                    ) : p.lastNote?.follow_up_date ? (
                      <span style={{ fontSize:10, color:'var(--gray)' }}>{fmtDate(p.lastNote.follow_up_date)}</span>
                    ) : <span style={{ fontSize:10, color:'#9CA3AF' }}>—</span>}
                  </div>
                  <button onClick={() => setNoteModal(p)}
                    style={{ padding:'5px 10px', background:'#1565C0', color:'#fff', border:'none', borderRadius:6, fontSize:10, fontWeight:700, cursor:'pointer' }}>
                    📞 Log Contact
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {noteModal && (
        <NoteModal
          patient={noteModal}
          coordId={profile?.id}
          onClose={() => setNoteModal(null)}
          onSaved={() => { setNoteModal(null); load(); }}
        />
      )}
    </div>
  );
}
