import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';

// Level definitions — maps Pariox event_type keywords to structured levels
const LEVELS = [
  { key:'eval',  label:'Evaluation',  short:'EVAL', color:'#6B7280', bg:'#F3F4F6', visits:0,  freq:'Initial assessment',          desc:'New patient evaluation' },
  { key:'1',     label:'Level 1',     short:'L1',   color:'#DC2626', bg:'#FEF2F2', visits:4,  freq:'4x/week × 4 weeks (4w4)',     desc:'Intensive daily treatment' },
  { key:'2',     label:'Level 2',     short:'L2',   color:'#D97706', bg:'#FEF3C7', visits:4,  freq:'2x/week × 2 weeks (2w2)',     desc:'Reducing frequency' },
  { key:'3',     label:'Level 3',     short:'L3',   color:'#059669', bg:'#ECFDF5', visits:4,  freq:'1x/week × 4 weeks (1w4)',     desc:'Weekly maintenance building' },
  { key:'4',     label:'Level 4',     short:'L4',   color:'#1565C0', bg:'#EFF6FF', visits:4,  freq:'1x/2wks × 4 visits (1w4)',   desc:'Bi-weekly maintenance' },
  { key:'5',     label:'Level 5',     short:'L5',   color:'#7C3AED', bg:'#F5F3FF', visits:4,  freq:'Monthly × 4 visits',          desc:'Monthly monitoring' },
  { key:'maint', label:'Maintenance', short:'MAINT',color:'#065F46', bg:'#ECFDF5', visits:999,freq:'Ongoing maintenance',          desc:'Long-term management' },
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

function daysAgo(dateStr) {
  if (!dateStr) return null;
  return Math.floor((new Date() - new Date(dateStr+'T00:00:00')) / 86400000);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d+'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];
const RM = { A:'Uma Jacobs', B:'Lia Davis', C:'Earl Dimaano', G:'Samantha Faliks', H:'Kaylee Ramsey', J:'Hollie Fincher', M:'Ariel Maboudi', N:'Ariel Maboudi', T:'Samantha Faliks', V:'Samantha Faliks' };

export default function ClinicalProgressionPage() {
  const [visits, setVisits] = useState([]);
  const [census, setCensus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterLevel, setFilterLevel] = useState('ALL');
  const [filterFlag, setFilterFlag] = useState('ALL'); // ALL | due | overdue | ready
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('days_at_level');
  const [sortDir, setSortDir] = useState('desc');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    Promise.all([
      supabase.from('visit_schedule_data').select('patient_name,region,event_type,visit_date,status,staff_name').order('visit_date', { ascending: false }),
      supabase.from('census_data').select('patient_name,region,status,insurance').eq('status','Active'),
    ]).then(([v,c]) => {
      setVisits(v.data||[]); setCensus(c.data||[]);
      setLoading(false);
    });
  }, []);

  // Build per-patient progression data
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
      const allVisits = data.visits.sort((a,b) => b.visit_date.localeCompare(a.visit_date));

      // Current level = most recent completed visit's level
      const currentLvl = completedVisits[0]?.level || null;
      const cfg = currentLvl ? levelConfig(currentLvl) : null;

      // Visits completed at current level
      const visitsAtCurrentLevel = currentLvl
        ? completedVisits.filter(v => v.level === currentLvl).length
        : 0;

      // First visit at current level (to calculate days)
      const firstAtLevel = currentLvl
        ? completedVisits.filter(v => v.level === currentLvl).slice(-1)[0]?.visit_date
        : null;

      // Days at current level
      const daysAtLevel = firstAtLevel ? daysAgo(firstAtLevel) : null;

      // Last visit date
      const lastVisitDate = completedVisits[0]?.visit_date || null;
      const lastVisitDays = lastVisitDate ? daysAgo(lastVisitDate) : null;

      // Next scheduled visit
      const nextVisit = data.visits.filter(v => /scheduled/i.test(v.status||'')).sort((a,b) => a.visit_date.localeCompare(b.visit_date))[0];

      // Step-down readiness
      const targetVisits = cfg?.visits || 999;
      const isComplete = currentLvl !== 'maint' && visitsAtCurrentLevel >= targetVisits;
      const isNearComplete = visitsAtCurrentLevel >= targetVisits - 1 && !isComplete;

      // Overdue flag — last visit > 14 days ago
      const isOverdue = lastVisitDays !== null && lastVisitDays > 14 && currentLvl !== 'maint';

      // Level history — unique levels visited in order
      const levelHistory = [...new Set(completedVisits.map(v => v.level).reverse())];

      // Reassessment due — at current level for 30+ days
      const reassessmentDue = currentLvl && currentLvl !== 'eval' && currentLvl !== 'maint' && daysAtLevel !== null && daysAtLevel >= 30;

      // Next level
      const levelKeys = LEVELS.map(l => l.key);
      const currentIdx = levelKeys.indexOf(currentLvl);
      const nextLevel = currentLvl && currentLvl !== 'maint' && currentIdx < levelKeys.length - 1
        ? levelKeys[currentIdx + 1]
        : null;

      return {
        patient_name: p.patient_name,
        region: p.region || data.region,
        insurance: p.insurance,
        currentLevel: currentLvl,
        cfg,
        visitsAtCurrentLevel,
        targetVisits,
        daysAtLevel,
        lastVisitDate,
        lastVisitDays,
        nextVisit,
        isComplete,
        isNearComplete,
        isOverdue,
        levelHistory,
        reassessmentDue,
        nextLevel,
        clinician: completedVisits[0]?.staff_name || null,
        totalCompletedVisits: completedVisits.length,
      };
    });
  }, [visits, census]);

  const filtered = useMemo(() => {
    return patients.filter(p => {
      if (filterRegion !== 'ALL' && p.region !== filterRegion) return false;
      if (filterLevel !== 'ALL' && p.currentLevel !== filterLevel) return false;
      if (filterFlag === 'ready' && !p.isComplete) return false;
      if (filterFlag === 'due' && !p.reassessmentDue) return false;
      if (filterFlag === 'overdue' && !p.isOverdue) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!`${p.patient_name} ${p.clinician}`.toLowerCase().includes(q)) return false;
      }
      return true;
    }).sort((a,b) => {
      let av = a[sortField]; let bv = b[sortField];
      if (av == null) av = sortDir==='asc'?Infinity:-Infinity;
      if (bv == null) bv = sortDir==='asc'?Infinity:-Infinity;
      if (typeof av === 'string') return sortDir==='asc'?av.localeCompare(bv):bv.localeCompare(av);
      return sortDir==='asc'?av-bv:bv-av;
    });
  }, [patients, filterRegion, filterLevel, filterFlag, search, sortField, sortDir]);

  // Summary stats
  const stats = useMemo(() => ({
    total: patients.length,
    readyForStepDown: patients.filter(p => p.isComplete).length,
    reassessmentDue: patients.filter(p => p.reassessmentDue).length,
    overdue: patients.filter(p => p.isOverdue).length,
    byLevel: LEVELS.reduce((acc,l) => ({ ...acc, [l.key]: patients.filter(p=>p.currentLevel===l.key).length }), {}),
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
      <TopBar title="Clinical Frequency Progression" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading visit data…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar
        title="Clinical Frequency Progression"
        subtitle={`${stats.total} active patients · ${stats.readyForStepDown} ready for step-down · ${stats.reassessmentDue} reassessment due`}
      />
      <div style={{ flex:1, overflow:'auto' }}>
        {/* Filter bar */}
        <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', background:'var(--card-bg)', display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:7, overflow:'hidden' }}>
            {[['ALL','All Patients'],['ready','⬆ Ready for Step-Down'],['due','📋 Reassessment Due'],['overdue','⚠ Visit Overdue']].map(([k,l]) => (
              <button key={k} onClick={() => setFilterFlag(k)}
                style={{ padding:'6px 12px', border:'none', fontSize:11, fontWeight:filterFlag===k?700:400, cursor:'pointer',
                  background:filterFlag===k?'#0F1117':'var(--card-bg)', color:filterFlag===k?'#fff':'var(--gray)' }}>
                {l}
              </button>
            ))}
          </div>

          <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)}
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Levels</option>
            {LEVELS.filter(l=>l.key!=='eval').map(l => (
              <option key={l.key} value={l.key}>{l.label}</option>
            ))}
          </select>

          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Regions</option>
            {REGIONS.map(r => <option key={r} value={r}>Region {r} — {RM[r]}</option>)}
          </select>

          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient or clinician…"
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)', width:200 }} />

          {(filterFlag!=='ALL'||filterLevel!=='ALL'||filterRegion!=='ALL'||search) && (
            <button onClick={() => { setFilterFlag('ALL'); setFilterLevel('ALL'); setFilterRegion('ALL'); setSearch(''); }}
              style={{ fontSize:11, color:'var(--gray)', background:'none', border:'1px solid var(--border)', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}>
              Clear
            </button>
          )}

          <div style={{ marginLeft:'auto', fontSize:11, color:'var(--gray)' }}>{filtered.length} patients</div>
        </div>

        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>

          {/* Summary KPI cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 }}>
            <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#1565C0', textTransform:'uppercase', letterSpacing:'0.05em' }}>⬆ Ready for Step-Down</div>
              <div style={{ fontSize:28, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#1565C0', marginTop:6 }}>{stats.readyForStepDown}</div>
              <div style={{ fontSize:11, color:'#1E40AF', marginTop:2 }}>Completed visits at current level</div>
            </div>
            <div style={{ background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#D97706', textTransform:'uppercase', letterSpacing:'0.05em' }}>📋 Reassessment Due</div>
              <div style={{ fontSize:28, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#D97706', marginTop:6 }}>{stats.reassessmentDue}</div>
              <div style={{ fontSize:11, color:'#92400E', marginTop:2 }}>30+ days at current level</div>
            </div>
            <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#DC2626', textTransform:'uppercase', letterSpacing:'0.05em' }}>⚠ Visit Overdue</div>
              <div style={{ fontSize:28, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#DC2626', marginTop:6 }}>{stats.overdue}</div>
              <div style={{ fontSize:11, color:'#991B1B', marginTop:2 }}>No visit in 14+ days</div>
            </div>
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em' }}>👥 Active Patients</div>
              <div style={{ fontSize:28, fontWeight:900, fontFamily:'DM Mono, monospace', color:'var(--black)', marginTop:6 }}>{stats.total}</div>
              <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>Across all regions</div>
            </div>
          </div>

          {/* Level distribution bar */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:18 }}>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:14 }}>Patient Distribution by Level</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {LEVELS.map(l => {
                const cnt = stats.byLevel[l.key] || 0;
                if (!cnt) return null;
                return (
                  <div key={l.key} onClick={() => setFilterLevel(filterLevel===l.key?'ALL':l.key)}
                    style={{ flex:cnt, minWidth:60, background:l.bg, border:`2px solid ${filterLevel===l.key?l.color:'transparent'}`, borderRadius:8, padding:'10px 14px', cursor:'pointer', transition:'all 0.15s' }}>
                    <div style={{ fontSize:11, fontWeight:800, color:l.color }}>{l.short}</div>
                    <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', color:l.color }}>{cnt}</div>
                    <div style={{ fontSize:9, color:l.color, marginTop:2, opacity:0.8 }}>{l.freq}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Main table */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontSize:14, fontWeight:700 }}>Patient Progression Detail</div>
              <div style={{ fontSize:11, color:'var(--gray)' }}>{filtered.length} patients · click column headers to sort</div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1.4fr 0.4fr 0.7fr 0.9fr 0.6fr 0.9fr 0.8fr 0.8fr 0.9fr', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', gap:8 }}>
              {[['Patient','patient_name'],['Rgn','region'],['Level','currentLevel'],['Progress','visitsAtCurrentLevel'],['Days','daysAtLevel'],['Last Visit','lastVisitDays'],['Next Visit',''],['Clinician','clinician'],['Status','']].map(([l,f]) => (
                <div key={l} style={{ cursor:f?'pointer':'default' }} onClick={() => f&&toggleSort(f)}>
                  {l}{f&&<SortIcon field={f} />}
                </div>
              ))}
            </div>

            <div>
              {filtered.length === 0 ? (
                <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>No patients match the current filters.</div>
              ) : filtered.map((p, i) => {
                const c = p.cfg;
                const pct = p.targetVisits < 999 ? Math.min(Math.round(p.visitsAtCurrentLevel/p.targetVisits*100), 100) : 100;
                const rowBg = p.isOverdue ? '#FFF5F5' : p.isComplete ? '#F0FFF4' : i%2===0 ? 'var(--card-bg)' : 'var(--bg)';
                return (
                  <div key={p.patient_name} style={{ display:'grid', gridTemplateColumns:'1.4fr 0.4fr 0.7fr 0.9fr 0.6fr 0.9fr 0.8fr 0.8fr 0.9fr', padding:'10px 20px', borderBottom:'1px solid var(--border)', background:rowBg, alignItems:'center', gap:8, cursor:'pointer' }}
                    onClick={() => setSelected(selected?.patient_name===p.patient_name?null:p)}
                    onMouseEnter={e => e.currentTarget.style.background='#EFF6FF'}
                    onMouseLeave={e => e.currentTarget.style.background=rowBg}>
                    <div>
                      <div style={{ fontSize:12, fontWeight:600 }}>{p.patient_name}</div>
                      {p.reassessmentDue && <div style={{ fontSize:9, fontWeight:700, color:'#D97706' }}>📋 REASSESSMENT DUE</div>}
                    </div>
                    <span style={{ fontSize:12, fontWeight:700, color:'var(--gray)' }}>{p.region}</span>
                    <div>
                      {c ? (
                        <span style={{ fontSize:10, fontWeight:800, color:c.color, background:c.bg, padding:'2px 8px', borderRadius:999 }}>{c.short}</span>
                      ) : <span style={{ color:'var(--gray)', fontSize:11 }}>—</span>}
                    </div>
                    <div>
                      {p.targetVisits < 999 ? (
                        <div>
                          <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, marginBottom:2 }}>
                            <span style={{ fontWeight:600, color: p.isComplete?'#065F46':c?.color||'var(--gray)' }}>
                              {p.isComplete ? '✅ Complete' : `${p.visitsAtCurrentLevel}/${p.targetVisits}`}
                            </span>
                          </div>
                          <div style={{ height:5, background:'var(--border)', borderRadius:999 }}>
                            <div style={{ height:'100%', width:pct+'%', background:p.isComplete?'#065F46':c?.color||'#ccc', borderRadius:999, transition:'width 0.3s' }} />
                          </div>
                        </div>
                      ) : <span style={{ fontSize:11, color:'#065F46', fontWeight:600 }}>Ongoing</span>}
                    </div>
                    <span style={{ fontSize:12, fontFamily:'DM Mono, monospace', color:p.daysAtLevel>30?'#D97706':'var(--gray)' }}>
                      {p.daysAtLevel !== null ? `${p.daysAtLevel}d` : '—'}
                    </span>
                    <span style={{ fontSize:11, color:p.lastVisitDays>14?'#DC2626':p.lastVisitDays>7?'#D97706':'var(--black)', fontWeight:p.lastVisitDays>14?700:400 }}>
                      {p.lastVisitDate ? `${p.lastVisitDays}d ago` : '—'}
                    </span>
                    <span style={{ fontSize:11, color:p.nextVisit?'#1565C0':'var(--gray)', fontWeight:p.nextVisit?600:400 }}>
                      {p.nextVisit ? new Date(p.nextVisit.visit_date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'}
                    </span>
                    <span style={{ fontSize:11, color:'var(--gray)' }}>{(p.clinician||'').split(',')[0]||'—'}</span>
                    <div>
                      {p.isComplete && p.nextLevel && (
                        <span style={{ fontSize:9, fontWeight:700, color:'#065F46', background:'#ECFDF5', padding:'2px 7px', borderRadius:999, border:'1px solid #A7F3D0' }}>
                          ⬆ STEP TO {levelConfig(p.nextLevel).short}
                        </span>
                      )}
                      {p.isOverdue && !p.isComplete && (
                        <span style={{ fontSize:9, fontWeight:700, color:'#DC2626', background:'#FEF2F2', padding:'2px 7px', borderRadius:999 }}>⚠ OVERDUE</span>
                      )}
                      {p.isNearComplete && !p.isComplete && (
                        <span style={{ fontSize:9, fontWeight:700, color:'#D97706', background:'#FEF3C7', padding:'2px 7px', borderRadius:999 }}>FINAL VISIT</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Expanded patient detail panel */}
          {selected && (
            <div style={{ background:'var(--card-bg)', border:'2px solid #1565C0', borderRadius:12, padding:20 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
                <div>
                  <div style={{ fontSize:16, fontWeight:700 }}>{selected.patient_name}</div>
                  <div style={{ fontSize:12, color:'var(--gray)', marginTop:2 }}>Region {selected.region} · {selected.insurance} · {selected.clinician||'No clinician assigned'}</div>
                </div>
                <button onClick={() => setSelected(null)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'var(--gray)' }}>×</button>
              </div>

              {/* Level journey */}
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:12, fontWeight:600, color:'var(--gray)', marginBottom:10 }}>Treatment Journey</div>
                <div style={{ display:'flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
                  {LEVELS.filter(l => l.key !== 'eval').map((l, idx) => {
                    const visited = selected.levelHistory.includes(l.key);
                    const current = selected.currentLevel === l.key;
                    const done = selected.levelHistory.indexOf(selected.currentLevel) > selected.levelHistory.indexOf(l.key);
                    return (
                      <div key={l.key} style={{ display:'flex', alignItems:'center', gap:4 }}>
                        <div style={{ padding:'6px 12px', borderRadius:7, fontWeight:700, fontSize:11,
                          background: current ? l.color : visited ? l.bg : 'var(--bg)',
                          color: current ? '#fff' : visited ? l.color : '#ccc',
                          border: `2px solid ${current||visited ? l.color : 'var(--border)'}` }}>
                          {l.short}
                          {current && <span style={{ fontSize:9, marginLeft:4 }}>← NOW</span>}
                        </div>
                        {idx < LEVELS.filter(l=>l.key!=='eval').length-1 && (
                          <span style={{ color:'var(--border)', fontSize:14 }}>→</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Stats row */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12 }}>
                {[
                  { label:'Current Level', val: selected.cfg?.label || '—', color: selected.cfg?.color },
                  { label:'Visits at Level', val: `${selected.visitsAtCurrentLevel}${selected.targetVisits<999?' / '+selected.targetVisits:''}` },
                  { label:'Days at Level', val: selected.daysAtLevel !== null ? `${selected.daysAtLevel} days` : '—', color: selected.daysAtLevel>30?'#D97706':undefined },
                  { label:'Last Visit', val: selected.lastVisitDate ? fmtDate(selected.lastVisitDate) : '—', color: selected.lastVisitDays>14?'#DC2626':undefined },
                  { label:'Next Visit', val: selected.nextVisit ? fmtDate(selected.nextVisit.visit_date) : 'Not scheduled', color: selected.nextVisit?'#1565C0':'#DC2626' },
                ].map(s => (
                  <div key={s.label} style={{ background:'var(--bg)', borderRadius:8, padding:'10px 12px' }}>
                    <div style={{ fontSize:10, color:'var(--gray)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.04em' }}>{s.label}</div>
                    <div style={{ fontSize:14, fontWeight:700, color:s.color||'var(--black)', marginTop:4 }}>{s.val}</div>
                  </div>
                ))}
              </div>

              {selected.isComplete && selected.nextLevel && (
                <div style={{ marginTop:14, background:'#ECFDF5', border:'2px solid #A7F3D0', borderRadius:8, padding:'12px 16px', display:'flex', alignItems:'center', gap:12 }}>
                  <span style={{ fontSize:24 }}>⬆</span>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:'#065F46' }}>Ready for Step-Down to {levelConfig(selected.nextLevel).label}</div>
                    <div style={{ fontSize:11, color:'#047857' }}>Patient has completed {selected.visitsAtCurrentLevel} visits at {selected.cfg?.label}. Next protocol: {levelConfig(selected.nextLevel).freq}</div>
                  </div>
                </div>
              )}
              {selected.reassessmentDue && (
                <div style={{ marginTop:14, background:'#FEF3C7', border:'2px solid #FCD34D', borderRadius:8, padding:'12px 16px' }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'#92400E' }}>📋 30-Day Reassessment Due</div>
                  <div style={{ fontSize:11, color:'#92400E', marginTop:2 }}>Patient has been at {selected.cfg?.label} for {selected.daysAtLevel} days. Clinical reassessment required per protocol.</div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
