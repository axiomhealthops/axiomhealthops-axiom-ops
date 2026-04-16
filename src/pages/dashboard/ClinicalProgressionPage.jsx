import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';

// ── LEVEL HIERARCHY ─────────────────────────────────────────────────────────
// L5 = Most complex/intensive → L1 = Simplest → Maintenance = Lowest (tapering)
const LEVELS = [
  { key:'eval',  label:'Evaluation',  short:'EVAL', color:'#6B7280', bg:'#F3F4F6', visits:0,  freq:'Initial assessment',            desc:'New patient evaluation' },
  { key:'5',     label:'Level 5',     short:'L5',   color:'#DC2626', bg:'#FEF2F2', visits:4,  freq:'4x/week × 4 weeks (4w4)',       desc:'Most complex — intensive daily treatment' },
  { key:'4',     label:'Level 4',     short:'L4',   color:'#D97706', bg:'#FEF3C7', visits:4,  freq:'2x/week × 2 weeks (2w2)',       desc:'High complexity — reducing frequency' },
  { key:'3',     label:'Level 3',     short:'L3',   color:'#059669', bg:'#ECFDF5', visits:4,  freq:'1x/week × 4 weeks (1w4)',       desc:'Moderate — weekly treatment' },
  { key:'2',     label:'Level 2',     short:'L2',   color:'#1565C0', bg:'#EFF6FF', visits:4,  freq:'1x/2wks × 4 visits (bi-weekly)',desc:'Low complexity — bi-weekly visits' },
  { key:'1',     label:'Level 1',     short:'L1',   color:'#7C3AED', bg:'#F5F3FF', visits:4,  freq:'Monthly × 4 visits',            desc:'Simplest — monthly monitoring' },
  { key:'maint', label:'Maintenance', short:'MAINT',color:'#065F46', bg:'#ECFDF5', visits:999, freq:'Ongoing maintenance',           desc:'Lowest — long-term management / tapering' },
];

// ── VISIT FREQUENCY OPTIONS ──────────────────────────────────────────────────
const FREQUENCIES = [
  { key:'4w4',  label:'4w4',  full:'4 visits/week × 4 weeks',      desc:'Most intensive', color:'#DC2626', bg:'#FEF2F2' },
  { key:'2w4',  label:'2w4',  full:'2 visits/week × 4 weeks',      desc:'High frequency', color:'#D97706', bg:'#FEF3C7' },
  { key:'1w4',  label:'1w4',  full:'1 visit/week × 4 weeks',       desc:'Weekly',         color:'#059669', bg:'#ECFDF5' },
  { key:'1em1', label:'1em1', full:'1 visit every month',          desc:'Monthly',        color:'#1565C0', bg:'#EFF6FF' },
  { key:'1em2', label:'1em2', full:'1 visit every other month',    desc:'Bi-monthly',     color:'#7C3AED', bg:'#F5F3FF' },
];

// ── LOC (LEVEL OF CARE) OPTIONS ──────────────────────────────────────────────
const LOC_LEVELS = [
  { key:5, label:'LOC 5', full:'HIGH RISK',   desc:'Very involved, complex patient',      color:'#DC2626', bg:'#FEF2F2' },
  { key:4, label:'LOC 4', full:'High',        desc:'Elevated complexity, close monitoring',color:'#D97706', bg:'#FEF3C7' },
  { key:3, label:'LOC 3', full:'Moderate',    desc:'Moderate risk, standard protocols',   color:'#059669', bg:'#ECFDF5' },
  { key:2, label:'LOC 2', full:'Low-Moderate',desc:'Improving, reducing intervention',    color:'#1565C0', bg:'#EFF6FF' },
  { key:1, label:'LOC 1', full:'LOW RISK',    desc:'Maintenance level, low frequency',    color:'#065F46', bg:'#F0FFF4' },
];

function getLevel(eventType) {
  if (!eventType) return null;
  const e = eventType.toLowerCase();
  if (e.includes('evaluation')) return 'eval';
  if (e.includes('maintenance')) return 'maint';
  if (e.includes('level 1')) return '1';
  if (e.includes('level 2')) return '2';
  if (e.includes('level 3')) return '3';
  if (e.includes('level 4')) return '4';
  if (e.includes('level 5')) return '5';
  return null;
}
function levelConfig(key) { return LEVELS.find(l => l.key === key) || LEVELS[0]; }
function freqConfig(key) { return FREQUENCIES.find(f => f.key === key); }
function locConfig(key) { return LOC_LEVELS.find(l => l.key === key); }
function daysAgo(dateStr) { if (!dateStr) return null; return Math.floor((new Date() - new Date(dateStr+'T00:00:00')) / 86400000); }
function fmtDate(d) { if (!d) return '—'; return new Date(d+'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }); }

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];
const RM = { A:'Uma Jacobs', B:'Lia Davis', C:'Earl Dimaano', G:'Samantha Faliks', H:'Kaylee Ramsey', J:'Hollie Fincher', M:'Ariel Maboudi', N:'Ariel Maboudi', T:'Samantha Faliks', V:'Samantha Faliks' };

// ── Clinical Settings Edit Modal ─────────────────────────────────────────────
function ClinicalSettingsModal({ patient, existing, onClose, onSaved, profile }) {
  const [form, setForm] = useState({
    visit_frequency: existing?.visit_frequency || '',
    loc: existing?.loc || '',
    loc_notes: existing?.loc_notes || '',
    frequency_notes: existing?.frequency_notes || '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const payload = {
      patient_name: patient.patient_name,
      region: patient.region,
      visit_frequency: form.visit_frequency || null,
      loc: form.loc ? parseInt(form.loc) : null,
      loc_notes: form.loc_notes || null,
      frequency_notes: form.frequency_notes || null,
      assigned_by: profile?.full_name || profile?.email || 'Unknown',
      assigned_at: existing ? existing.assigned_at : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (existing) {
      await supabase.from('patient_clinical_settings').update(payload).eq('patient_name', patient.patient_name);
    } else {
      await supabase.from('patient_clinical_settings').insert(payload);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:520, boxShadow:'0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ padding:'16px 22px', background:'#0F1117', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>Clinical Settings</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.6)', marginTop:2 }}>{patient.patient_name} · Region {patient.region}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'rgba(255,255,255,0.6)' }}>×</button>
        </div>
        <div style={{ padding:22, display:'flex', flexDirection:'column', gap:18 }}>

          {/* Visit Frequency */}
          <div>
            <label style={{ fontSize:12, fontWeight:700, color:'var(--black)', display:'block', marginBottom:8 }}>
              Visit Frequency
              <span style={{ fontSize:10, fontWeight:400, color:'var(--gray)', marginLeft:8 }}>How often is this patient being seen?</span>
            </label>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {FREQUENCIES.map(f => (
                <button key={f.key} onClick={() => setForm(p => ({ ...p, visit_frequency: p.visit_frequency===f.key?'':f.key }))}
                  style={{ padding:'8px 14px', borderRadius:8, border:`2px solid ${form.visit_frequency===f.key?f.color:'var(--border)'}`,
                    background: form.visit_frequency===f.key?f.bg:'var(--card-bg)', cursor:'pointer', transition:'all 0.15s' }}>
                  <div style={{ fontSize:13, fontWeight:700, color:form.visit_frequency===f.key?f.color:'var(--black)' }}>{f.label}</div>
                  <div style={{ fontSize:10, color:'var(--gray)', marginTop:2 }}>{f.full}</div>
                </button>
              ))}
            </div>
            <input value={form.frequency_notes} onChange={e => setForm(p=>({...p,frequency_notes:e.target.value}))}
              placeholder="Notes on frequency (optional)…"
              style={{ marginTop:8, width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
          </div>

          {/* LOC */}
          <div>
            <label style={{ fontSize:12, fontWeight:700, color:'var(--black)', display:'block', marginBottom:8 }}>
              Level of Care (LOC)
              <span style={{ fontSize:10, fontWeight:400, color:'var(--gray)', marginLeft:8 }}>Patient risk & complexity level</span>
            </label>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {LOC_LEVELS.map(l => (
                <button key={l.key} onClick={() => setForm(p => ({ ...p, loc: p.loc===l.key?'':l.key }))}
                  style={{ padding:'8px 14px', borderRadius:8, border:`2px solid ${form.loc===l.key?l.color:'var(--border)'}`,
                    background: form.loc===l.key?l.bg:'var(--card-bg)', cursor:'pointer', transition:'all 0.15s', textAlign:'left', minWidth:90 }}>
                  <div style={{ fontSize:13, fontWeight:800, color:form.loc===l.key?l.color:'var(--black)' }}>{l.label}</div>
                  <div style={{ fontSize:10, fontWeight:700, color:form.loc===l.key?l.color:'var(--gray)' }}>{l.full}</div>
                  <div style={{ fontSize:9, color:'var(--gray)', marginTop:1 }}>{l.desc}</div>
                </button>
              ))}
            </div>
            <input value={form.loc_notes} onChange={e => setForm(p=>({...p,loc_notes:e.target.value}))}
              placeholder="Clinical notes on LOC assignment (optional)…"
              style={{ marginTop:8, width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)', boxSizing:'border-box' }} />
          </div>
        </div>
        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
          <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving}
            style={{ padding:'8px 22px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor:'pointer' }}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function ClinicalProgressionPage() {
  const { profile } = useAuth();
  const [visits, setVisits] = useState([]);
  const [census, setCensus] = useState([]);
  const [clinicalSettings, setClinicalSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterLevel, setFilterLevel] = useState('ALL');
  const [filterLoc, setFilterLoc] = useState('ALL');
  const [filterFreq, setFilterFreq] = useState('ALL');
  const [filterFlag, setFilterFlag] = useState('ALL');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('days_at_level');
  const [sortDir, setSortDir] = useState('desc');
  const [selected, setSelected] = useState(null);
  const [editModal, setEditModal] = useState(null); // patient object

  const regionScope = useAssignedRegions();

  const loadAll = useCallback(() => {
    if (regionScope.loading) return;
    if (!regionScope.isAllAccess && (!regionScope.regions || regionScope.regions.length === 0)) {
      setVisits([]); setCensus([]); setClinicalSettings({}); setLoading(false); return;
    }
    Promise.all([
      fetchAllPages(regionScope.applyToQuery(supabase.from('visit_schedule_data').select('patient_name,region,event_type,visit_date,status,staff_name').order('visit_date', { ascending: false }))),
      fetchAllPages(regionScope.applyToQuery(supabase.from('census_data').select('patient_name,region,status,insurance').eq('status','Active'))),
      fetchAllPages(regionScope.applyToQuery(supabase.from('patient_clinical_settings').select('*'))),
    ]).then(([v, c, cs]) => {
      setVisits(v);
      setCensus(c);
      const csMap = {};
      cs.forEach(s => { csMap[s.patient_name] = s; });
      setClinicalSettings(csMap);
      setLoading(false);
    });
  }, [regionScope.isAllAccess, regionScope.loading, JSON.stringify(regionScope.regions)]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const patients = useMemo(() => {
    const byPatient = {};
    visits.forEach(v => {
      if (!v.patient_name) return;
      const lvl = getLevel(v.event_type);
      if (!lvl) return;
      const isCompleted = /completed/i.test(v.status||'') && !/cancel/i.test(v.event_type||'');
      if (!byPatient[v.patient_name]) byPatient[v.patient_name] = { visits: [], region: v.region };
      byPatient[v.patient_name].visits.push({ ...v, level: lvl, completed: isCompleted });
    });

    return census.map(p => {
      const data = byPatient[p.patient_name] || { visits: [], region: p.region };
      const completedVisits = data.visits.filter(v => v.completed).sort((a,b) => b.visit_date.localeCompare(a.visit_date));
      const currentLvl = completedVisits[0]?.level || null;
      const cfg = currentLvl ? levelConfig(currentLvl) : null;
      const visitsAtCurrentLevel = currentLvl ? completedVisits.filter(v => v.level === currentLvl).length : 0;
      const firstAtLevel = currentLvl ? completedVisits.filter(v => v.level === currentLvl).slice(-1)[0]?.visit_date : null;
      const daysAtLevel = firstAtLevel ? daysAgo(firstAtLevel) : null;
      const lastVisitDate = completedVisits[0]?.visit_date || null;
      const lastVisitDays = lastVisitDate ? daysAgo(lastVisitDate) : null;
      const nextVisit = data.visits.filter(v => /scheduled/i.test(v.status||'')).sort((a,b) => a.visit_date.localeCompare(b.visit_date))[0];
      const targetVisits = cfg?.visits || 999;
      const isComplete = currentLvl !== 'maint' && visitsAtCurrentLevel >= targetVisits;
      const isNearComplete = visitsAtCurrentLevel >= targetVisits - 1 && !isComplete;
      const isOverdue = lastVisitDays !== null && lastVisitDays > 14 && currentLvl !== 'maint';
      const levelHistory = [...new Set(completedVisits.map(v => v.level).reverse())];
      const reassessmentDue = currentLvl && currentLvl !== 'eval' && currentLvl !== 'maint' && daysAtLevel !== null && daysAtLevel >= 30;
      const levelKeys = LEVELS.map(l => l.key);
      const currentIdx = levelKeys.indexOf(currentLvl);
      const nextLevel = currentLvl && currentLvl !== 'maint' && currentIdx < levelKeys.length - 1 ? levelKeys[currentIdx + 1] : null;
      const cs = clinicalSettings[p.patient_name] || null;

      // Auto-derive LOC from treatment level when no manual LOC is assigned.
      // Level 5 → LOC 5 (High Risk), Level 4 → LOC 4, etc.
      // Maintenance/Level 1 → LOC 1, Evaluation → LOC 3 (moderate default).
      const LOC_FROM_LEVEL = { '5':5, '4':4, '3':3, '2':2, '1':1, 'maint':1, 'eval':3 };
      const manualLoc = cs?.loc || null;
      const derivedLoc = currentLvl ? (LOC_FROM_LEVEL[currentLvl] || null) : null;
      const effectiveLoc = manualLoc || derivedLoc;

      return {
        patient_name: p.patient_name,
        region: p.region || data.region,
        insurance: p.insurance,
        currentLevel: currentLvl, cfg,
        visitsAtCurrentLevel, targetVisits, daysAtLevel,
        lastVisitDate, lastVisitDays, nextVisit,
        isComplete, isNearComplete, isOverdue, levelHistory, reassessmentDue, nextLevel,
        clinician: completedVisits[0]?.staff_name || null,
        totalCompletedVisits: completedVisits.length,
        // Clinical settings
        visit_frequency: cs?.visit_frequency || null,
        loc: effectiveLoc,
        loc_manual: manualLoc,
        loc_derived: derivedLoc,
        loc_notes: cs?.loc_notes || null,
        frequency_notes: cs?.frequency_notes || null,
        settings_assigned_by: cs?.assigned_by || null,
      };
    });
  }, [visits, census, clinicalSettings]);

  const filtered = useMemo(() => {
    return patients.filter(p => {
      if (filterRegion !== 'ALL' && p.region !== filterRegion) return false;
      if (filterLevel !== 'ALL' && p.currentLevel !== filterLevel) return false;
      if (filterLoc === '0' && p.loc) return false;
      if (filterLoc !== 'ALL' && filterLoc !== '0' && String(p.loc) !== filterLoc) return false;
      if (filterFreq !== 'ALL' && p.visit_frequency !== filterFreq) return false;
      if (filterFlag === 'ready' && !p.isComplete) return false;
      if (filterFlag === 'due' && !p.reassessmentDue) return false;
      if (filterFlag === 'overdue' && !p.isOverdue) return false;
      if (filterFlag === 'no_loc' && p.loc) return false;
      if (filterFlag === 'high_risk' && p.loc !== 5) return false;
      if (search) { const q = search.toLowerCase(); if (!`${p.patient_name} ${p.clinician}`.toLowerCase().includes(q)) return false; }
      return true;
    }).sort((a,b) => {
      let av = a[sortField]; let bv = b[sortField];
      if (av == null) av = sortDir==='asc'?Infinity:-Infinity;
      if (bv == null) bv = sortDir==='asc'?Infinity:-Infinity;
      if (typeof av === 'string') return sortDir==='asc'?av.localeCompare(bv):bv.localeCompare(av);
      return sortDir==='asc'?av-bv:bv-av;
    });
  }, [patients, filterRegion, filterLevel, filterLoc, filterFreq, filterFlag, search, sortField, sortDir]);

  const stats = useMemo(() => ({
    total: patients.length,
    readyForStepDown: patients.filter(p => p.isComplete).length,
    reassessmentDue: patients.filter(p => p.reassessmentDue).length,
    overdue: patients.filter(p => p.isOverdue).length,
    highRisk: patients.filter(p => p.loc === 5).length,
    noLoc: patients.filter(p => !p.loc).length,
    manualLocCount: patients.filter(p => p.loc_manual).length,
    derivedLocCount: patients.filter(p => !p.loc_manual && p.loc_derived).length,
    byLevel: LEVELS.reduce((acc,l) => ({ ...acc, [l.key]: patients.filter(p=>p.currentLevel===l.key).length }), {}),
    byLoc: LOC_LEVELS.reduce((acc,l) => ({ ...acc, [l.key]: patients.filter(p=>p.loc===l.key).length }), {}),
    byFreq: FREQUENCIES.reduce((acc,f) => ({ ...acc, [f.key]: patients.filter(p=>p.visit_frequency===f.key).length }), {}),
  }), [patients]);

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d==='asc'?'desc':'asc');
    else { setSortField(field); setSortDir('desc'); }
  }
  function SortIcon({ field }) {
    if (sortField !== field) return <span style={{ color:'#ccc', fontSize:9 }}> ↕</span>;
    return <span style={{ color:'#1565C0', fontSize:9 }}>{sortDir==='asc'?' ↑':' ↓'}</span>;
  }

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Clinical Progression" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%' }}>
      <TopBar
        title="Clinical Progression"
        subtitle={`${stats.total} active patients · ${stats.highRisk} at LOC 5 (High Risk) · ${stats.byLevel['5']||0} at Treatment L5 · ${stats.readyForStepDown} ready to step down`}
      />
      <div style={{ flex:1 }}>

        {/* Filter bar */}
        <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', background:'var(--card-bg)', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:7, overflow:'hidden' }}>
            {[['ALL','All'],['ready','↓ Step-Down Ready'],['high_risk','🔴 LOC 5'],['no_loc','⚠ No LOC'],['due','📋 Reassessment'],['overdue','⏰ Overdue']].map(([k,l]) => (
              <button key={k} onClick={() => setFilterFlag(k)}
                style={{ padding:'5px 10px', border:'none', fontSize:11, fontWeight:filterFlag===k?700:400, cursor:'pointer',
                  background:filterFlag===k?'#0F1117':'var(--card-bg)', color:filterFlag===k?'#fff':'var(--gray)' }}>{l}</button>
            ))}
          </div>

          <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)}
            style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Levels</option>
            {LEVELS.filter(l=>l.key!=='eval').map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>

          <select value={filterLoc} onChange={e => setFilterLoc(e.target.value)}
            style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All LOC</option>
            {LOC_LEVELS.map(l => <option key={l.key} value={String(l.key)}>{l.label} — {l.full}</option>)}
          </select>

          <select value={filterFreq} onChange={e => setFilterFreq(e.target.value)}
            style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Frequencies</option>
            {FREQUENCIES.map(f => <option key={f.key} value={f.key}>{f.label} — {f.full}</option>)}
          </select>

          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
            style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Regions</option>
            {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
          </select>

          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient…"
            style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)', width:160 }} />

          {(filterFlag!=='ALL'||filterLevel!=='ALL'||filterLoc!=='ALL'||filterFreq!=='ALL'||filterRegion!=='ALL'||search) && (
            <button onClick={() => { setFilterFlag('ALL'); setFilterLevel('ALL'); setFilterLoc('ALL'); setFilterFreq('ALL'); setFilterRegion('ALL'); setSearch(''); }}
              style={{ fontSize:10, color:'var(--gray)', background:'none', border:'1px solid var(--border)', borderRadius:5, padding:'3px 8px', cursor:'pointer' }}>Clear</button>
          )}
          <div style={{ marginLeft:'auto', fontSize:11, color:'var(--gray)' }}>{filtered.length} shown</div>
        </div>

        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>

          {/* KPI cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:12 }}>
            {[
              { label:'LOC 5 — High Risk', val:stats.highRisk, color:'#DC2626', bg:'#FEF2F2', border:'#FECACA', sub:'Critical patients' },
              { label:'↓ Step-Down Ready', val:stats.readyForStepDown, color:'#1565C0', bg:'#EFF6FF', border:'#BFDBFE', sub:'Completed visits at level' },
              { label:'📋 Reassessment Due', val:stats.reassessmentDue, color:'#D97706', bg:'#FEF3C7', border:'#FCD34D', sub:'30+ days at current level' },
              { label:'⚠ No LOC Assigned', val:stats.noLoc, color:'#6B7280', bg:'var(--card-bg)', border:'var(--border)', sub:'Needs LOC assignment' },
              { label:'👥 Active Patients', val:stats.total, color:'var(--black)', bg:'var(--card-bg)', border:'var(--border)', sub:'All regions' },
            ].map(c => (
              <div key={c.label} style={{ background:c.bg, border:`1px solid ${c.border}`, borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:10, fontWeight:700, color:c.color, textTransform:'uppercase', letterSpacing:'0.05em' }}>{c.label}</div>
                <div style={{ fontSize:26, fontWeight:900, fontFamily:'DM Mono, monospace', color:c.color, marginTop:4 }}>{c.val}</div>
                <div style={{ fontSize:10, color:'var(--gray)', marginTop:2 }}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* LOC Distribution */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:16 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <div style={{ fontSize:13, fontWeight:700 }}>Level of Care (LOC) Distribution</div>
              <div style={{ fontSize:10, color:'var(--gray)' }}>
                {stats.manualLocCount > 0 && <span>{stats.manualLocCount} manually assigned · </span>}
                {stats.derivedLocCount > 0 && <span>{stats.derivedLocCount} auto-derived from treatment level · </span>}
                {stats.noLoc > 0 && <span style={{ color:'#D97706' }}>{stats.noLoc} unassigned</span>}
              </div>
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {LOC_LEVELS.map(l => {
                const cnt = stats.byLoc[l.key] || 0;
                const active = filterLoc === String(l.key);
                return (
                  <div key={l.key} onClick={() => setFilterLoc(active?'ALL':String(l.key))}
                    style={{ flex:1, minWidth:90, background:l.bg, border:`2px solid ${active?l.color:'transparent'}`, borderRadius:8, padding:'10px 12px', cursor:'pointer' }}>
                    <div style={{ fontSize:12, fontWeight:800, color:l.color }}>{l.label}</div>
                    <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', color:l.color }}>{cnt}</div>
                    <div style={{ fontSize:9, color:l.color, marginTop:2 }}>{l.full}</div>
                  </div>
                );
              })}
              <div style={{ flex:1, minWidth:90, background:'#F3F4F6', border:`2px solid ${filterLoc==='0'?'#6B7280':'transparent'}`, borderRadius:8, padding:'10px 12px', cursor:'pointer' }}
                onClick={() => setFilterLoc(filterLoc==='0'?'ALL':'0')}>
                <div style={{ fontSize:12, fontWeight:800, color:'#6B7280' }}>Unassigned</div>
                <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#6B7280' }}>{stats.noLoc}</div>
                <div style={{ fontSize:9, color:'#6B7280', marginTop:2 }}>No visits or level</div>
              </div>
            </div>
          </div>

          {/* Treatment Level Distribution */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:16 }}>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:12 }}>Treatment Level Distribution</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {LEVELS.filter(l => l.key !== 'eval').map(l => {
                const cnt = stats.byLevel[l.key] || 0;
                const active = filterLevel === l.key;
                return (
                  <div key={l.key} onClick={() => setFilterLevel(active?'ALL':l.key)}
                    style={{ flex:1, minWidth:80, background:l.bg, border:`2px solid ${active?l.color:'transparent'}`, borderRadius:8, padding:'10px 12px', cursor:'pointer' }}>
                    <div style={{ fontSize:12, fontWeight:800, color:l.color }}>{l.short}</div>
                    <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', color:l.color }}>{cnt}</div>
                    <div style={{ fontSize:9, color:l.color, marginTop:2 }}>{l.desc.slice(0,30)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Frequency Distribution */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:16 }}>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:12 }}>Visit Frequency Distribution</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {FREQUENCIES.map(f => {
                const cnt = stats.byFreq[f.key] || 0;
                const active = filterFreq === f.key;
                return (
                  <div key={f.key} onClick={() => setFilterFreq(active?'ALL':f.key)}
                    style={{ flex:1, minWidth:80, background:f.bg, border:`2px solid ${active?f.color:'transparent'}`, borderRadius:8, padding:'10px 12px', cursor:'pointer' }}>
                    <div style={{ fontSize:14, fontWeight:800, color:f.color }}>{f.label}</div>
                    <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', color:f.color }}>{cnt}</div>
                    <div style={{ fontSize:9, color:f.color, marginTop:2 }}>{f.desc}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Main table */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontSize:14, fontWeight:700 }}>Patient Detail</div>
              <div style={{ fontSize:11, color:'var(--gray)' }}>{filtered.length} patients · click row to expand · click headers to sort</div>
            </div>

            {/* Header */}
            <div style={{ display:'grid', gridTemplateColumns:'1.4fr 0.35fr 0.65fr 0.55fr 0.65fr 0.7fr 0.55fr 0.7fr 0.75fr 0.8fr', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', gap:6 }}>
              {[['Patient','patient_name'],['Rgn','region'],['Level','currentLevel'],['LOC','loc'],['Freq','visit_frequency'],['Progress','visitsAtCurrentLevel'],['Days','daysAtLevel'],['Last Visit','lastVisitDays'],['Clinician','clinician'],['Status','']].map(([l,f]) => (
                <div key={l} style={{ cursor:f?'pointer':'default' }} onClick={() => f&&toggleSort(f)}>
                  {l}{f&&<SortIcon field={f} />}
                </div>
              ))}
            </div>

            {filtered.length === 0 ? (
              <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>No patients match current filters.</div>
            ) : filtered.map((p, i) => {
              const c = p.cfg;
              const pct = p.targetVisits < 999 ? Math.min(Math.round(p.visitsAtCurrentLevel/p.targetVisits*100), 100) : 100;
              const fCfg = freqConfig(p.visit_frequency);
              const lCfg = locConfig(p.loc);
              const rowBg = p.isOverdue ? '#FFF5F5' : p.isComplete ? '#F0FFF4' : i%2===0 ? 'var(--card-bg)' : 'var(--bg)';
              const isExpanded = selected?.patient_name === p.patient_name;
              return (
                <div key={p.patient_name}>
                  <div style={{ display:'grid', gridTemplateColumns:'1.4fr 0.35fr 0.65fr 0.55fr 0.65fr 0.7fr 0.55fr 0.7fr 0.75fr 0.8fr', padding:'10px 20px', borderBottom:'1px solid var(--border)', background:isExpanded?'#EFF6FF':rowBg, alignItems:'center', gap:6, cursor:'pointer' }}
                    onClick={() => setSelected(isExpanded?null:p)}>
                    <div>
                      <div style={{ fontSize:12, fontWeight:600 }}>{p.patient_name}</div>
                      {p.reassessmentDue && <div style={{ fontSize:9, fontWeight:700, color:'#D97706' }}>📋 REASSESS</div>}
                      {!p.loc && !p.currentLevel && <div style={{ fontSize:9, color:'#9CA3AF' }}>No LOC / No visits</div>}
                    </div>
                    <span style={{ fontSize:11, fontWeight:700, color:'var(--gray)' }}>{p.region}</span>
                    <div>
                      {c ? <span style={{ fontSize:10, fontWeight:800, color:c.color, background:c.bg, padding:'2px 7px', borderRadius:999 }}>{c.short}</span>
                         : <span style={{ color:'var(--gray)', fontSize:11 }}>—</span>}
                    </div>
                    <div>
                      {lCfg ? (
                        <span style={{ fontSize:10, fontWeight:800, color:lCfg.color, background:lCfg.bg, padding:'2px 7px', borderRadius:999, border:`1px solid ${lCfg.color}30` }}>
                          {lCfg.label}
                        </span>
                      ) : <span style={{ fontSize:10, color:'#9CA3AF', background:'#F3F4F6', padding:'2px 6px', borderRadius:999 }}>—</span>}
                    </div>
                    <div>
                      {fCfg ? (
                        <span style={{ fontSize:10, fontWeight:700, color:fCfg.color, background:fCfg.bg, padding:'2px 7px', borderRadius:999 }}>
                          {fCfg.label}
                        </span>
                      ) : <span style={{ fontSize:10, color:'#9CA3AF', background:'#F3F4F6', padding:'2px 6px', borderRadius:999 }}>—</span>}
                    </div>
                    <div>
                      {p.targetVisits < 999 ? (
                        <div>
                          <div style={{ fontSize:10, fontWeight:600, color:p.isComplete?'#065F46':c?.color, marginBottom:2 }}>
                            {p.isComplete ? '✅' : `${p.visitsAtCurrentLevel}/${p.targetVisits}`}
                          </div>
                          <div style={{ height:4, background:'var(--border)', borderRadius:999 }}>
                            <div style={{ height:'100%', width:pct+'%', background:p.isComplete?'#065F46':c?.color||'#ccc', borderRadius:999 }} />
                          </div>
                        </div>
                      ) : <span style={{ fontSize:10, color:'#065F46' }}>Ongoing</span>}
                    </div>
                    <span style={{ fontSize:11, fontFamily:'DM Mono, monospace', color:p.daysAtLevel>30?'#D97706':'var(--gray)' }}>
                      {p.daysAtLevel !== null ? `${p.daysAtLevel}d` : '—'}
                    </span>
                    <span style={{ fontSize:11, color:p.lastVisitDays>14?'#DC2626':p.lastVisitDays>7?'#D97706':'var(--black)', fontWeight:p.lastVisitDays>14?700:400 }}>
                      {p.lastVisitDate ? `${p.lastVisitDays}d ago` : '—'}
                    </span>
                    <span style={{ fontSize:10, color:'var(--gray)' }}>{(p.clinician||'').split(',')[0]||'—'}</span>
                    <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                      {p.isComplete && p.nextLevel && (
                        <span style={{ fontSize:9, fontWeight:700, color:'#065F46', background:'#ECFDF5', padding:'2px 6px', borderRadius:999 }}>↓ {levelConfig(p.nextLevel).short}</span>
                      )}
                      {p.isOverdue && !p.isComplete && (
                        <span style={{ fontSize:9, fontWeight:700, color:'#DC2626', background:'#FEF2F2', padding:'2px 6px', borderRadius:999 }}>⚠ OVERDUE</span>
                      )}
                      {p.isNearComplete && !p.isComplete && (
                        <span style={{ fontSize:9, fontWeight:700, color:'#D97706', background:'#FEF3C7', padding:'2px 6px', borderRadius:999 }}>FINAL VISIT</span>
                      )}
                    </div>
                  </div>

                  {/* Inline expanded detail */}
                  {isExpanded && (
                    <div style={{ padding:'16px 20px 20px', background:'#F8FBFF', borderBottom:'2px solid #1565C0', borderLeft:'3px solid #1565C0' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
                        <div>
                          <div style={{ fontSize:15, fontWeight:700 }}>{p.patient_name}</div>
                          <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>Region {p.region} · {p.insurance} · {p.clinician||'No clinician'}</div>
                        </div>
                        <div style={{ display:'flex', gap:8 }}>
                          <button onClick={e => { e.stopPropagation(); setEditModal(p); }}
                            style={{ padding:'6px 14px', background:'#1565C0', color:'#fff', border:'none', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' }}>
                            ✏ Edit LOC & Frequency
                          </button>
                          <button onClick={() => setSelected(null)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'var(--gray)' }}>×</button>
                        </div>
                      </div>

                      {/* LOC + Frequency highlight */}
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
                        <div style={{ background:lCfg?lCfg.bg:'#F3F4F6', border:`1px solid ${lCfg?lCfg.color+'40':'var(--border)'}`, borderRadius:10, padding:'12px 16px' }}>
                          <div style={{ fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Level of Care (LOC)</div>
                          {lCfg ? (
                            <>
                              <div style={{ fontSize:20, fontWeight:900, color:lCfg.color }}>{lCfg.label} — {lCfg.full}</div>
                              <div style={{ fontSize:11, color:lCfg.color, marginTop:3 }}>{lCfg.desc}</div>
                              {!p.loc_manual && p.loc_derived && <div style={{ fontSize:10, color:'var(--gray)', marginTop:4 }}>Auto-derived from treatment level · Edit to override</div>}
                              {p.loc_notes && <div style={{ fontSize:11, color:'var(--gray)', marginTop:6, fontStyle:'italic' }}>{p.loc_notes}</div>}
                            </>
                          ) : (
                            <div style={{ fontSize:13, color:'#9CA3AF' }}>Not assigned — click Edit to set</div>
                          )}
                        </div>
                        <div style={{ background:fCfg?fCfg.bg:'#F3F4F6', border:`1px solid ${fCfg?fCfg.color+'40':'var(--border)'}`, borderRadius:10, padding:'12px 16px' }}>
                          <div style={{ fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Visit Frequency</div>
                          {fCfg ? (
                            <>
                              <div style={{ fontSize:20, fontWeight:900, color:fCfg.color }}>{fCfg.label}</div>
                              <div style={{ fontSize:11, color:fCfg.color, marginTop:3 }}>{fCfg.full}</div>
                              {p.frequency_notes && <div style={{ fontSize:11, color:'var(--gray)', marginTop:6, fontStyle:'italic' }}>{p.frequency_notes}</div>}
                            </>
                          ) : (
                            <div style={{ fontSize:13, color:'#9CA3AF' }}>Not assigned — click Edit to set</div>
                          )}
                        </div>
                      </div>

                      {/* Treatment journey */}
                      <div style={{ marginBottom:14 }}>
                        <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:8 }}>Treatment Journey</div>
                        <div style={{ display:'flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
                          {LEVELS.filter(l => l.key !== 'eval').map((l, idx, arr) => {
                            const visited = p.levelHistory.includes(l.key);
                            const current = p.currentLevel === l.key;
                            return (
                              <div key={l.key} style={{ display:'flex', alignItems:'center', gap:4 }}>
                                <div style={{ padding:'5px 10px', borderRadius:7, fontWeight:700, fontSize:10,
                                  background: current ? l.color : visited ? l.bg : 'var(--bg)',
                                  color: current ? '#fff' : visited ? l.color : '#ccc',
                                  border: `2px solid ${current||visited ? l.color : 'var(--border)'}` }}>
                                  {l.short}{current && <span style={{ fontSize:8, marginLeft:3 }}>NOW</span>}
                                </div>
                                {idx < arr.length-1 && <span style={{ color:'var(--border)', fontSize:12 }}>→</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Stats */}
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10 }}>
                        {[
                          { label:'Current Level', val:p.cfg?.label||'—', color:p.cfg?.color },
                          { label:'Visits at Level', val:`${p.visitsAtCurrentLevel}${p.targetVisits<999?'/'+p.targetVisits:''}` },
                          { label:'Days at Level', val:p.daysAtLevel!==null?`${p.daysAtLevel}d`:'—', color:p.daysAtLevel>30?'#D97706':undefined },
                          { label:'Last Visit', val:p.lastVisitDate?fmtDate(p.lastVisitDate):'—', color:p.lastVisitDays>14?'#DC2626':undefined },
                          { label:'Next Visit', val:p.nextVisit?fmtDate(p.nextVisit.visit_date):'Not scheduled', color:p.nextVisit?'#1565C0':'#DC2626' },
                        ].map(s => (
                          <div key={s.label} style={{ background:'var(--bg)', borderRadius:8, padding:'8px 10px' }}>
                            <div style={{ fontSize:9, color:'var(--gray)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.04em' }}>{s.label}</div>
                            <div style={{ fontSize:13, fontWeight:700, color:s.color||'var(--black)', marginTop:3 }}>{s.val}</div>
                          </div>
                        ))}
                      </div>

                      {p.isComplete && p.nextLevel && (
                        <div style={{ marginTop:12, background:'#ECFDF5', border:'2px solid #A7F3D0', borderRadius:8, padding:'10px 14px' }}>
                          <div style={{ fontSize:13, fontWeight:700, color:'#065F46' }}>↓ Ready to Progress to {levelConfig(p.nextLevel).label}</div>
                          <div style={{ fontSize:11, color:'#047857', marginTop:2 }}>Completed {p.visitsAtCurrentLevel} visits at {p.cfg?.label}. Next: {levelConfig(p.nextLevel).freq}</div>
                        </div>
                      )}
                      {p.reassessmentDue && (
                        <div style={{ marginTop:12, background:'#FEF3C7', border:'2px solid #FCD34D', borderRadius:8, padding:'10px 14px' }}>
                          <div style={{ fontSize:13, fontWeight:700, color:'#92400E' }}>📋 30-Day Reassessment Due</div>
                          <div style={{ fontSize:11, color:'#92400E', marginTop:2 }}>{p.daysAtLevel} days at {p.cfg?.label}. Reassessment required.</div>
                        </div>
                      )}
                      {p.settings_assigned_by && (
                        <div style={{ marginTop:8, fontSize:10, color:'var(--gray)' }}>LOC/Frequency assigned by {p.settings_assigned_by}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {editModal && (
        <ClinicalSettingsModal
          patient={editModal}
          existing={clinicalSettings[editModal.patient_name]}
          onClose={() => setEditModal(null)}
          onSaved={() => { setEditModal(null); loadAll(); }}
          profile={profile}
        />
      )}
    </div>
  );
}
