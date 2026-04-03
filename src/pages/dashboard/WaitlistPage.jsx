import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

// Florida ZIP → approximate lat/lng for distance estimation
// We use zip prefix matching for proximity since clinicians have no stored coords
function zipRegion(zip) {
  if (!zip) return null;
  const z = String(zip).slice(0, 3);
  const map = {
    '320':'Orlando','321':'Orlando','322':'Jacksonville','323':'Tallahassee',
    '324':'Tallahassee','325':'Gainesville','326':'Gainesville','327':'Daytona',
    '328':'Daytona','329':'Melbourne','330':'Miami','331':'Miami','332':'Miami',
    '333':'Fort Lauderdale','334':'West Palm','335':'Tampa','336':'Tampa',
    '337':'Tampa','338':'Lakeland','339':'Fort Myers','340':'Fort Myers',
    '341':'Naples','342':'Sarasota','344':'Gainesville','346':'Tampa',
    '347':'Orlando','349':'Fort Pierce',
  };
  return map[z] || null;
}

// Rough proximity: same zip prefix (first 3 digits) = same metro area
function proximityScore(clinicianRegion, patientRegion, patientZip, clinicianZip) {
  if (clinicianRegion === patientRegion) return 3; // same region = closest
  if (clinicianRegion === 'All') return 1; // flex clinician
  // Adjacent regions (hand-coded Florida geography)
  const adjacent = {
    A: ['B','C'], B: ['A','C','G'], C: ['A','B','G'],
    G: ['B','C','H','J'], H: ['G','J','M'], J: ['G','H','N'],
    M: ['H','T','N'], N: ['H','J','M'], T: ['M','V'], V: ['T'],
  };
  if ((adjacent[patientRegion] || []).includes(clinicianRegion)) return 2;
  return 0;
}

const PRIORITY_CONFIG = {
  urgent: { label:'🔴 Urgent', color:'#DC2626', bg:'#FEF2F2', border:'#FECACA' },
  high:   { label:'🟠 High',   color:'#D97706', bg:'#FEF3C7', border:'#FCD34D' },
  normal: { label:'🟢 Normal', color:'#059669', bg:'#ECFDF5', border:'#A7F3D0' },
  low:    { label:'⬇ Low',    color:'#6B7280', bg:'#F3F4F6', border:'#E5E7EB' },
};

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];
const RM = { A:'Uma Jacobs',B:'Lia Davis',C:'Earl Dimaano',G:'Samantha Faliks',H:'Kaylee Ramsey',J:'Hollie Fincher',M:'Ariel Maboudi',N:'Ariel Maboudi',T:'Samantha Faliks',V:'Samantha Faliks' };

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

function daysAgo(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((new Date() - new Date(dateStr+'T00:00:00')) / 86400000);
}

function urgencyColor(days) {
  if (days >= 14) return { color:'#DC2626', bg:'#FEF2F2' };
  if (days >= 7)  return { color:'#D97706', bg:'#FEF3C7' };
  return { color:'#065F46', bg:'#ECFDF5' };
}

// ── Assignment Modal ─────────────────────────────────────────────────────────
function AssignModal({ patient, clinicians, onClose, onSaved, profile }) {
  const [selectedClinician, setSelectedClinician] = useState(patient.assigned_clinician || '');
  const [notes, setNotes] = useState(patient.assignment_notes || '');
  const [priority, setPriority] = useState(patient.priority || 'normal');
  const [contactDate, setContactDate] = useState(patient.last_contact_date || '');
  const [contactNotes, setContactNotes] = useState(patient.contact_notes || '');
  const [followup, setFollowup] = useState(patient.next_followup_date || '');
  const [saving, setSaving] = useState(false);

  // Score clinicians by proximity to this patient
  const scoredClinicians = useMemo(() => {
    return clinicians
      .filter(c => c.discipline === 'PTA' || c.discipline === 'PT')
      .map(c => ({
        ...c,
        score: proximityScore(c.region, patient.region, patient.zip_code, null),
        currentLoad: c.current_load || 0,
        capacity: Math.max(0, (c.weekly_visit_target || 20) - (c.current_load || 0)),
      }))
      .sort((a, b) => b.score - a.score || b.capacity - a.capacity);
  }, [clinicians, patient]);

  const grouped = useMemo(() => ({
    same: scoredClinicians.filter(c => c.score === 3),
    adjacent: scoredClinicians.filter(c => c.score === 2),
    flex: scoredClinicians.filter(c => c.score === 1),
    other: scoredClinicians.filter(c => c.score === 0),
  }), [scoredClinicians]);

  async function save() {
    setSaving(true);
    await supabase.from('waitlist_tracker').update({
      assigned_clinician: selectedClinician || null,
      assignment_notes: notes || null,
      priority,
      last_contact_date: contactDate || null,
      contact_notes: contactNotes || null,
      next_followup_date: followup || null,
      assigned_by: profile?.full_name || profile?.email || 'Unknown',
      assigned_at: selectedClinician ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('patient_name', patient.patient_name);
    setSaving(false);
    onSaved();
  }

  const ClinGroup = ({ title, list, color }) => {
    if (!list.length) return null;
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{title}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {list.map(c => {
            const sel = selectedClinician === c.full_name;
            return (
              <button key={c.full_name} onClick={() => setSelectedClinician(sel ? '' : c.full_name)}
                style={{ padding: '6px 12px', borderRadius: 7, border: `2px solid ${sel ? color : 'var(--border)'}`,
                  background: sel ? color + '20' : 'var(--card-bg)', cursor: 'pointer', textAlign: 'left', minWidth: 140 }}>
                <div style={{ fontSize: 12, fontWeight: sel ? 700 : 500, color: sel ? color : 'var(--black)' }}>{c.full_name}</div>
                <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 2 }}>
                  {c.discipline} · Rgn {c.region} · {c.weekly_visit_target} visits/wk
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:20, overflowY:'auto' }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:680, maxHeight:'92vh', overflow:'auto', boxShadow:'0 24px 60px rgba(0,0,0,0.35)' }}>
        {/* Header */}
        <div style={{ padding:'16px 22px', background:'#1565C0', borderRadius:'14px 14px 0 0', position:'sticky', top:0, zIndex:1 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:16, fontWeight:700, color:'#fff' }}>{patient.patient_name}</div>
              <div style={{ fontSize:12, color:'rgba(255,255,255,0.75)', marginTop:3 }}>
                Region {patient.region} · {patient.city}{patient.zip_code ? ` ${patient.zip_code}` : ''} · {patient.county || 'FL'} · {patient.insurance}
              </div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.7)', marginTop:2 }}>
                📅 On waitlist {daysAgo(patient.waitlist_since)} days (since {fmtDate(patient.waitlist_since)}) · {patient.diagnosis}
              </div>
            </div>
            <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'rgba(255,255,255,0.7)' }}>×</button>
          </div>
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Priority */}
          <div>
            <label style={{ fontSize:12, fontWeight:700, color:'var(--black)', display:'block', marginBottom:8 }}>Priority</label>
            <div style={{ display:'flex', gap:8 }}>
              {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                <button key={k} onClick={() => setPriority(k)}
                  style={{ flex:1, padding:'8px 10px', borderRadius:7, border:`2px solid ${priority===k?v.color:'var(--border)'}`,
                    background:priority===k?v.bg:'var(--card-bg)', cursor:'pointer' }}>
                  <div style={{ fontSize:12, fontWeight:700, color:priority===k?v.color:'var(--gray)' }}>{v.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Clinician assignment */}
          <div>
            <label style={{ fontSize:12, fontWeight:700, color:'var(--black)', display:'block', marginBottom:8 }}>
              Assign Clinician
              <span style={{ fontSize:10, fontWeight:400, color:'var(--gray)', marginLeft:8 }}>Sorted by proximity to patient's region</span>
            </label>
            <ClinGroup title={`Same Region (${patient.region}) — Closest match`} list={grouped.same} color="#1565C0" />
            <ClinGroup title="Adjacent Region — Near match" list={grouped.adjacent} color="#059669" />
            <ClinGroup title="Flex Clinicians — Cover all regions" list={grouped.flex} color="#7C3AED" />
            {grouped.other.length > 0 && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ fontSize: 11, color: 'var(--gray)', cursor: 'pointer' }}>Show {grouped.other.length} other clinicians (farther regions)</summary>
                <div style={{ marginTop: 8 }}>
                  <ClinGroup title="Other Regions" list={grouped.other} color="#6B7280" />
                </div>
              </details>
            )}
            {selectedClinician && (
              <div style={{ marginTop:8, fontSize:11, fontWeight:600, color:'#1565C0', background:'#EFF6FF', padding:'6px 10px', borderRadius:6 }}>
                ✓ Assigned to: {selectedClinician}
              </div>
            )}
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Assignment notes…"
              style={{ marginTop:8, width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:52, background:'var(--card-bg)' }} />
          </div>

          {/* Contact log */}
          <div>
            <label style={{ fontSize:12, fontWeight:700, color:'var(--black)', display:'block', marginBottom:8 }}>Contact Log</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <div>
                <label style={{ fontSize:10, color:'var(--gray)', fontWeight:600, display:'block', marginBottom:3 }}>Last Contact Date</label>
                <input type="date" value={contactDate} onChange={e => setContactDate(e.target.value)}
                  style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize:10, color:'var(--gray)', fontWeight:600, display:'block', marginBottom:3 }}>Next Follow-Up Date</label>
                <input type="date" value={followup} onChange={e => setFollowup(e.target.value)}
                  style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
              </div>
            </div>
            <textarea value={contactNotes} onChange={e => setContactNotes(e.target.value)} placeholder="Contact notes — spoke with patient, left voicemail, patient confirmed interest…"
              style={{ marginTop:8, width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:52, background:'var(--card-bg)' }} />
          </div>
        </div>

        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'var(--bg)' }}>
          <button onClick={async () => {
              await supabase.from('waitlist_tracker').update({
                resolved: true, resolved_at: new Date().toISOString(), resolution: 'activated', updated_at: new Date().toISOString(),
              }).eq('patient_name', patient.patient_name);
              onSaved();
            }}
            style={{ padding:'8px 16px', background:'#065F46', color:'#fff', border:'none', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' }}>
            ✅ Mark Activated
          </button>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
            <button onClick={save} disabled={saving}
              style={{ padding:'8px 22px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor:'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function WaitlistPage() {
  const { profile } = useAuth();
  const [patients, setPatients] = useState([]);
  const [clinicians, setClinicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterPriority, setFilterPriority] = useState('ALL');
  const [filterAssigned, setFilterAssigned] = useState('ALL'); // ALL | assigned | unassigned
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('days');
  const [sortDir, setSortDir] = useState('desc');
  const [activeModal, setActiveModal] = useState(null);
  const [showResolved, setShowResolved] = useState(false);

  const loadAll = useCallback(async () => {
    const [{ data: w }, { data: c }] = await Promise.all([
      supabase.from('waitlist_tracker').select('*').order('waitlist_since'),
      supabase.from('clinicians').select('*').eq('is_active', true),
    ]);
    setPatients(w || []);
    setClinicians(c || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Sync any new waitlist patients from census on page load
  useEffect(() => {
    async function syncFromCensus() {
      const { data: censusWaitlist } = await supabase
        .from('census_data').select('patient_name,region,insurance,first_seen_date')
        .ilike('status', '%waitlist%');
      if (!censusWaitlist?.length) return;
      for (const p of censusWaitlist) {
        await supabase.from('waitlist_tracker').upsert({
          patient_name: p.patient_name,
          region: p.region,
          insurance: p.insurance,
          waitlist_since: p.first_seen_date || new Date().toISOString().slice(0,10),
        }, { onConflict: 'patient_name', ignoreDuplicates: true });
      }
      loadAll();
    }
    syncFromCensus();
  }, [loadAll]);

  const enriched = useMemo(() => patients.map(p => ({
    ...p,
    days: daysAgo(p.waitlist_since),
    followupOverdue: p.next_followup_date && p.next_followup_date <= new Date().toISOString().slice(0,10) && !p.resolved,
    // Find best clinician match
    bestClinician: (() => {
      const regionClinicians = clinicians.filter(c =>
        (c.region === p.region || c.region === 'All') &&
        (c.discipline === 'PT' || c.discipline === 'PTA') &&
        c.is_active
      );
      return regionClinicians[0]?.full_name || null;
    })(),
    regionCliniciansCount: clinicians.filter(c =>
      (c.region === p.region || c.region === 'All') && c.is_active
    ).length,
  })), [patients, clinicians]);

  const filtered = useMemo(() => {
    return enriched
      .filter(p => {
        if (!showResolved && p.resolved) return false;
        if (showResolved && !p.resolved) return false;
        if (filterRegion !== 'ALL' && p.region !== filterRegion) return false;
        if (filterPriority !== 'ALL' && p.priority !== filterPriority) return false;
        if (filterAssigned === 'assigned' && !p.assigned_clinician) return false;
        if (filterAssigned === 'unassigned' && p.assigned_clinician) return false;
        if (search) {
          const q = search.toLowerCase();
          if (!`${p.patient_name} ${p.city} ${p.county} ${p.assigned_clinician}`.toLowerCase().includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortField === 'days') return sortDir === 'desc' ? b.days - a.days : a.days - b.days;
        if (sortField === 'name') return sortDir === 'asc' ? a.patient_name.localeCompare(b.patient_name) : b.patient_name.localeCompare(a.patient_name);
        if (sortField === 'region') return sortDir === 'asc' ? (a.region||'').localeCompare(b.region||'') : (b.region||'').localeCompare(a.region||'');
        return 0;
      });
  }, [enriched, filterRegion, filterPriority, filterAssigned, search, sortField, sortDir, showResolved]);

  const stats = useMemo(() => {
    const active = enriched.filter(p => !p.resolved);
    return {
      total: active.length,
      urgent: active.filter(p => p.days >= 14).length,
      unassigned: active.filter(p => !p.assigned_clinician).length,
      followupDue: active.filter(p => p.followupOverdue).length,
      avgDays: active.length ? Math.round(active.reduce((s,p) => s+p.days, 0) / active.length) : 0,
      byRegion: REGIONS.reduce((acc,r) => ({ ...acc, [r]: active.filter(p=>p.region===r).length }), {}),
    };
  }, [enriched]);

  function toggleSort(f) {
    if (sortField === f) setSortDir(d => d==='asc'?'desc':'asc');
    else { setSortField(f); setSortDir('desc'); }
  }

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Waitlist Management" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%' }}>
      <TopBar
        title="Waitlist Management"
        subtitle={`${stats.total} patients waiting · ${stats.unassigned} unassigned · avg ${stats.avgDays} days on waitlist`}
      />
      <div style={{ flex:1 }}>

        {/* Filter bar */}
        <div style={{ padding:'10px 20px', borderBottom:'1px solid var(--border)', background:'var(--card-bg)', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:7, overflow:'hidden' }}>
            {[['ALL','All'],['unassigned','⚠ Unassigned'],['assigned','✓ Assigned']].map(([k,l]) => (
              <button key={k} onClick={() => setFilterAssigned(k)}
                style={{ padding:'5px 10px', border:'none', fontSize:11, fontWeight:filterAssigned===k?700:400, cursor:'pointer', background:filterAssigned===k?'#0F1117':'var(--card-bg)', color:filterAssigned===k?'#fff':'var(--gray)' }}>{l}</button>
            ))}
          </div>
          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
            style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Regions</option>
            {REGIONS.map(r => <option key={r} value={r}>Region {r} — {RM[r]}</option>)}
          </select>
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
            style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Priorities</option>
            {Object.entries(PRIORITY_CONFIG).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient, city…"
            style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)', width:160 }} />
          <button onClick={() => setShowResolved(s => !s)}
            style={{ padding:'5px 10px', border:`1px solid ${showResolved?'#1565C0':'var(--border)'}`, borderRadius:6, fontSize:11, background:showResolved?'#EFF6FF':'var(--card-bg)', color:showResolved?'#1565C0':'var(--gray)', cursor:'pointer' }}>
            {showResolved ? '← Active' : 'View Resolved'}
          </button>
          <div style={{ marginLeft:'auto', fontSize:11, color:'var(--gray)' }}>{filtered.length} shown</div>
        </div>

        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>

          {/* KPI Cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12 }}>
            {[
              { label:'On Waitlist', val:stats.total, color:'var(--black)', bg:'var(--card-bg)', sub:'active patients' },
              { label:'⏰ 14+ Days', val:stats.urgent, color:'#DC2626', bg:'#FEF2F2', sub:'need immediate action', border:'#FECACA' },
              { label:'⚠ Unassigned', val:stats.unassigned, color:'#D97706', bg:'#FEF3C7', sub:'no clinician assigned', border:'#FCD34D' },
              { label:'📆 Follow-Up Due', val:stats.followupDue, color:'#7C3AED', bg:'#F5F3FF', sub:'overdue contact', border:'#DDD6FE' },
              { label:'Avg Wait', val:`${stats.avgDays}d`, color:'#1565C0', bg:'#EFF6FF', sub:'average days waiting', border:'#BFDBFE' },
            ].map(c => (
              <div key={c.label} style={{ background:c.bg, border:`1px solid ${c.border||'var(--border)'}`, borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:10, fontWeight:700, color:c.color, textTransform:'uppercase', letterSpacing:'0.05em' }}>{c.label}</div>
                <div style={{ fontSize:26, fontWeight:900, fontFamily:'DM Mono, monospace', color:c.color, marginTop:4 }}>{c.val}</div>
                <div style={{ fontSize:10, color:'var(--gray)', marginTop:2 }}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* Region distribution */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:16 }}>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:12 }}>Waitlist by Region</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {REGIONS.map(r => {
                const cnt = stats.byRegion[r] || 0;
                if (!cnt) return null;
                const clinCount = clinicians.filter(c => (c.region===r||c.region==='All') && c.is_active).length;
                const ratio = clinCount ? (cnt / clinCount).toFixed(1) : '—';
                return (
                  <div key={r} onClick={() => setFilterRegion(filterRegion===r?'ALL':r)}
                    style={{ minWidth:100, background:filterRegion===r?'#1565C0':'var(--bg)', border:`2px solid ${filterRegion===r?'#1565C0':'var(--border)'}`, borderRadius:8, padding:'10px 14px', cursor:'pointer', textAlign:'center' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:filterRegion===r?'#fff':'var(--gray)' }}>Region {r}</div>
                    <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', color:filterRegion===r?'#fff':'#1565C0' }}>{cnt}</div>
                    <div style={{ fontSize:9, color:filterRegion===r?'rgba(255,255,255,0.7)':'var(--gray)', marginTop:2 }}>{clinCount} clinicians · {ratio}:1 ratio</div>
                    <div style={{ fontSize:9, color:filterRegion===r?'rgba(255,255,255,0.6)':'var(--gray)' }}>{RM[r]}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Patient table */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontSize:14, fontWeight:700 }}>{showResolved ? 'Resolved Patients' : 'Active Waitlist'}</div>
              <div style={{ fontSize:11, color:'var(--gray)' }}>{filtered.length} patients · click to manage</div>
            </div>

            {/* Header */}
            <div style={{ display:'grid', gridTemplateColumns:'1.6fr 0.4fr 0.8fr 0.6fr 0.8fr 1fr 1fr 0.7fr', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', gap:8 }}>
              <div style={{ cursor:'pointer' }} onClick={() => toggleSort('name')}>Patient {sortField==='name'&&(sortDir==='asc'?'↑':'↓')}</div>
              <div style={{ cursor:'pointer' }} onClick={() => toggleSort('region')}>Rgn {sortField==='region'&&(sortDir==='asc'?'↑':'↓')}</div>
              <div>Location</div>
              <div>Insurance</div>
              <div style={{ cursor:'pointer' }} onClick={() => toggleSort('days')}>Days Waiting {sortField==='days'&&(sortDir==='desc'?'↓':'↑')}</div>
              <div>Closest Clinician</div>
              <div>Assigned To</div>
              <div>Priority</div>
            </div>

            {filtered.length === 0 ? (
              <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>
                {showResolved ? 'No resolved patients.' : 'No waitlist patients match current filters.'}
              </div>
            ) : filtered.map((p, i) => {
              const u = urgencyColor(p.days);
              const pc = PRIORITY_CONFIG[p.priority] || PRIORITY_CONFIG.normal;
              const followupDue = p.followupOverdue;
              const rowBg = p.days >= 14 ? '#FFF5F5' : followupDue ? '#FFFBEB' : i%2===0 ? 'var(--card-bg)' : 'var(--bg)';
              return (
                <div key={p.patient_name} style={{ display:'grid', gridTemplateColumns:'1.6fr 0.4fr 0.8fr 0.6fr 0.8fr 1fr 1fr 0.7fr', padding:'11px 20px', borderBottom:'1px solid var(--border)', background:rowBg, alignItems:'center', gap:8, cursor:'pointer' }}
                  onClick={() => setActiveModal(p)}
                  onMouseEnter={e => e.currentTarget.style.background='#EFF6FF'}
                  onMouseLeave={e => e.currentTarget.style.background=rowBg}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600 }}>{p.patient_name}</div>
                    <div style={{ fontSize:10, color:'var(--gray)', marginTop:1 }}>{p.diagnosis || 'Lymphedema'}</div>
                    {followupDue && <div style={{ fontSize:9, fontWeight:700, color:'#D97706' }}>📆 Follow-up overdue</div>}
                  </div>
                  <span style={{ fontSize:12, fontWeight:700, color:'var(--gray)' }}>{p.region}</span>
                  <div>
                    <div style={{ fontSize:11, fontWeight:600 }}>{p.city || '—'}</div>
                    {p.zip_code && <div style={{ fontSize:10, color:'var(--gray)' }}>{p.zip_code}</div>}
                  </div>
                  <span style={{ fontSize:10, color:'var(--gray)' }}>{p.insurance || '—'}</span>
                  <div>
                    <span style={{ fontSize:14, fontWeight:900, fontFamily:'DM Mono, monospace', color:u.color }}>{p.days}</span>
                    <span style={{ fontSize:10, color:'var(--gray)' }}> days</span>
                    <div style={{ fontSize:9, color:'var(--gray)', marginTop:1 }}>since {fmtDate(p.waitlist_since)}</div>
                  </div>
                  <div>
                    {p.bestClinician ? (
                      <>
                        <div style={{ fontSize:11, fontWeight:600 }}>{p.bestClinician}</div>
                        <div style={{ fontSize:9, color:'var(--gray)' }}>{p.regionCliniciansCount} in region</div>
                      </>
                    ) : <span style={{ fontSize:10, color:'#DC2626' }}>No clinicians in region</span>}
                  </div>
                  <div>
                    {p.assigned_clinician ? (
                      <>
                        <div style={{ fontSize:11, fontWeight:600, color:'#065F46' }}>✓ {p.assigned_clinician}</div>
                        {p.last_contact_date && <div style={{ fontSize:9, color:'var(--gray)' }}>Last contact: {fmtDate(p.last_contact_date)}</div>}
                      </>
                    ) : <span style={{ fontSize:10, fontWeight:700, color:'#D97706', background:'#FEF3C7', padding:'2px 7px', borderRadius:999 }}>⚠ Unassigned</span>}
                  </div>
                  <span style={{ fontSize:9, fontWeight:700, color:pc.color, background:pc.bg, padding:'3px 8px', borderRadius:999, border:`1px solid ${pc.border}` }}>
                    {pc.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {activeModal && (
        <AssignModal
          patient={activeModal}
          clinicians={clinicians}
          onClose={() => setActiveModal(null)}
          onSaved={() => { setActiveModal(null); loadAll(); }}
          profile={profile}
        />
      )}
    </div>
  );
}
