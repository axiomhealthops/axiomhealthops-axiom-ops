import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';

const BLENDED_RATE = 185;
const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
}

function ReassignModal({ patient, clinicians, onClose, onSaved }) {
  const [selectedClin, setSelectedClin] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const currentClin = patient.last_visit_clinician || '—';
  const filteredClins = clinicians.filter(c => (c.region === patient.region || c.region === 'All' || (c.region && c.region.split(',').map(r => r.trim()).includes(patient.region))) && c.full_name !== currentClin);

  async function save() {
    if (!selectedClin) return;
    setSaving(true);
    // Log the reassignment as a pipeline note on census_data
    const { error } = await supabase.from('census_data').update({
      pipeline_assigned_to: selectedClin,
      pipeline_notes: `Reassigned from ${currentClin} to ${selectedClin}${note ? ' — ' + note : ''}. ${new Date().toLocaleDateString()}`,
    }).eq('patient_name', patient.patient_name);
    if (!error) onSaved(selectedClin);
    setSaving(false);
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:480, boxShadow:'0 24px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ padding:'16px 22px', background:'#0F1117', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>Reassign Patient</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.5)', marginTop:2 }}>{patient.patient_name} · Region {patient.region}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'rgba(255,255,255,0.5)' }}>×</button>
        </div>
        <div style={{ padding:22, display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ background:'#F3F4F6', borderRadius:8, padding:'10px 14px', fontSize:12 }}>
            <span style={{ color:'var(--gray)' }}>Current clinician: </span>
            <strong>{currentClin}</strong>
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:700, display:'block', marginBottom:6 }}>Reassign to (Region {patient.region} clinicians)</label>
            {filteredClins.length === 0 ? (
              <div style={{ fontSize:12, color:'var(--gray)', padding:'8px 0' }}>No other clinicians in Region {patient.region}. You may need to reassign across regions.</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {filteredClins.map(c => (
                  <button key={c.full_name} onClick={() => setSelectedClin(c.full_name)}
                    style={{ padding:'10px 14px', borderRadius:8, border:`2px solid ${selectedClin===c.full_name?'#1565C0':'var(--border)'}`, background:selectedClin===c.full_name?'#EFF6FF':'var(--card-bg)', fontSize:12, fontWeight:selectedClin===c.full_name?700:400, color:selectedClin===c.full_name?'#1565C0':'var(--black)', cursor:'pointer', textAlign:'left', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span>{c.full_name}</span>
                    <span style={{ fontSize:10, color:'var(--gray)' }}>{c.discipline} · {c.weekly_visit_target} visits/wk target</span>
                  </button>
                ))}
              </div>
            )}
            {/* Cross-region option */}
            <div style={{ marginTop:10 }}>
              <label style={{ fontSize:10, color:'var(--gray)', display:'block', marginBottom:4 }}>Or any clinician:</label>
              <select value={selectedClin} onChange={e => setSelectedClin(e.target.value)}
                style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:7, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
                <option value="">— Select clinician —</option>
                {clinicians.map(c => <option key={c.full_name} value={c.full_name}>{c.full_name} (Rgn {c.region})</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:700, display:'block', marginBottom:4 }}>Reason for reassignment (optional)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Clinician availability, patient request, capacity..."
              style={{ width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:7, fontSize:12, outline:'none', background:'var(--bg)', boxSizing:'border-box' }} />
          </div>
        </div>
        <div style={{ padding:'12px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
          <button onClick={onClose} style={{ padding:'7px 14px', border:'1px solid var(--border)', borderRadius:7, fontSize:12, cursor:'pointer', background:'var(--card-bg)' }}>Cancel</button>
          <button onClick={save} disabled={!selectedClin||saving}
            style={{ padding:'7px 18px', background:'#DC2626', color:'#fff', border:'none', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer', opacity:selectedClin?1:0.4 }}>
            {saving ? 'Saving…' : '↔ Reassign Patient'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ClinicianAssignmentPage() {
  const [visits, setVisits] = useState([]);
  const [clinicians, setClinicians] = useState([]);
  const [census, setCensus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterClinician, setFilterClinician] = useState('ALL');
  const [search, setSearch] = useState('');
  const [expandedClin, setExpandedClin] = useState(null);
  const [reassignPatient, setReassignPatient] = useState(null);
  const [viewMode, setViewMode] = useState('clinician'); // clinician | patient

  // Week range
  const today = new Date().toISOString().slice(0,10);
  const dow = new Date().getDay();
  const monday = new Date(); monday.setDate(new Date().getDate() - (dow===0?6:dow-1));
  const sunday = new Date(monday); sunday.setDate(monday.getDate()+6);
  const weekStart = monday.toISOString().slice(0,10);
  const weekEnd = sunday.toISOString().slice(0,10);
  const weekLabel = monday.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' – ' + sunday.toLocaleDateString('en-US',{month:'short',day:'numeric'});

  const load = useCallback(async () => {
    const [v, cl, c] = await Promise.all([
      supabase.from('visit_schedule_data')
        .select('patient_name,staff_name,staff_name_normalized,visit_date,status,event_type,region,discipline')
        .gte('visit_date', weekStart).lte('visit_date', weekEnd),
      supabase.from('clinicians').select('full_name,region,discipline,weekly_visit_target').eq('is_active', true).order('full_name'),
      supabase.from('census_data').select('patient_name,region,status,insurance,last_visit_date,last_visit_clinician,pipeline_assigned_to,pipeline_notes').eq('status','Active'),
    ]);
    setVisits(v.data || []);
    setClinicians(cl.data || []);
    setCensus(c.data || []);
    setLoading(false);
  }, [weekStart, weekEnd]);

  useEffect(() => { load(); }, [load]);

  // ── Clinician summary with patients ───────────────────────────────────────
  const clinicianSummary = useMemo(() => {
    const map = {};
    (visits).forEach(v => {
      const k = v.staff_name_normalized || v.staff_name || '';
      if (!k) return;
      if (!map[k]) map[k] = { name:k, region:v.region, visits:[], patients:new Set(), completed:0, scheduled:0, missed:0, cancelled:0 };
      map[k].visits.push(v);
      map[k].patients.add(v.patient_name);
      if (/completed/i.test(v.status||'')) map[k].completed++;
      else if (/scheduled/i.test(v.status||'')) map[k].scheduled++;
      else if (/missed/i.test(v.status||'')) map[k].missed++;
      else if (/cancel/i.test(v.status||'')) map[k].cancelled++;
    });

    return Object.values(map).map(c => {
      const cl = clinicians.find(cl => cl.full_name.toLowerCase() === c.name.toLowerCase());
      const target = cl?.weekly_visit_target || 25;
      const total = c.completed + c.scheduled;
      const utilPct = Math.round((total / target) * 100);
      return {
        ...c,
        patientCount: c.patients.size,
        patients: Array.from(c.patients),
        total,
        target,
        utilPct,
        discipline: cl?.discipline || '',
        estRevenue: c.completed * BLENDED_RATE,
      };
    }).sort((a,b) => b.total - a.total);
  }, [visits, clinicians]);

  // ── Per-patient view ──────────────────────────────────────────────────────
  const patientClinicianMap = useMemo(() => {
    const map = {};
    visits.forEach(v => {
      const k = v.patient_name?.toLowerCase().trim();
      if (!map[k]) map[k] = { clinicians:new Set(), visits:[] };
      const clinName = v.staff_name_normalized || v.staff_name || '';
      if (clinName) map[k].clinicians.add(clinName);
      map[k].visits.push(v);
    });
    return map;
  }, [visits]);

  const patientList = useMemo(() => {
    return census.map(p => {
      const k = p.patient_name?.toLowerCase().trim();
      const vm = patientClinicianMap[k];
      return { ...p, weekClinicians: vm ? Array.from(vm.clinicians) : [], weekVisits: vm ? vm.visits.length : 0 };
    }).filter(p => {
      if (filterRegion !== 'ALL' && p.region !== filterRegion) return false;
      if (filterClinician !== 'ALL' && !p.weekClinicians.includes(filterClinician)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (![p.patient_name, p.region, ...(p.weekClinicians)].join(' ').toLowerCase().includes(q)) return false;
      }
      return true;
    }).sort((a,b) => (a.patient_name||'').localeCompare(b.patient_name||''));
  }, [census, patientClinicianMap, filterRegion, filterClinician, search]);

  const filteredClinicians = useMemo(() => {
    return clinicianSummary.filter(c => {
      if (filterRegion !== 'ALL' && c.region !== filterRegion) return false;
      if (filterClinician !== 'ALL' && c.name !== filterClinician) return false;
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [clinicianSummary, filterRegion, filterClinician, search]);

  const allClinicianNames = useMemo(() => clinicianSummary.map(c => c.name), [clinicianSummary]);

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Clinician Assignment" subtitle="Loading..." />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading...</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%' }}>
      <TopBar
        title="👥 Clinician Assignment"
        subtitle={`Week of ${weekLabel} · ${clinicianSummary.length} active clinicians · ${census.length} active patients`}
        actions={<button onClick={load} style={{ padding:'5px 10px', background:'none', border:'1px solid var(--border)', borderRadius:6, fontSize:11, cursor:'pointer' }}>↻ Refresh</button>}
      />
      <div style={{ flex:1, overflowY:'auto' }}>
        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>

          {/* Explainer */}
          <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:8, padding:'10px 14px', fontSize:11, color:'#1E40AF' }}>
            <strong>Oversight view:</strong> See every active patient and which clinician is assigned to them this week.
            Click any patient row to reassign to a different clinician. Use the Clinician view to see full schedules, or the Patient view to find specific patients.
          </div>

          {/* View toggle + filters */}
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:7, overflow:'hidden' }}>
              {[['clinician','👤 By Clinician'],['patient','🏥 By Patient']].map(([k,l]) => (
                <button key={k} onClick={() => setViewMode(k)}
                  style={{ padding:'6px 14px', border:'none', fontSize:11, fontWeight:viewMode===k?700:400, cursor:'pointer', background:viewMode===k?'#0F1117':'var(--card-bg)', color:viewMode===k?'#fff':'var(--gray)', borderRight:'1px solid var(--border)' }}>
                  {l}
                </button>
              ))}
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient or clinician..."
              style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)', width:200 }} />
            <select value={filterRegion} onChange={e => { setFilterRegion(e.target.value); setFilterClinician('ALL'); }}
              style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)' }}>
              <option value="ALL">All Regions</option>
              {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
            </select>
            <select value={filterClinician} onChange={e => setFilterClinician(e.target.value)}
              style={{ padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, fontSize:11, outline:'none', background:'var(--card-bg)', maxWidth:200 }}>
              <option value="ALL">All Clinicians</option>
              {allClinicianNames.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {(filterRegion!=='ALL'||filterClinician!=='ALL'||search) && (
              <button onClick={() => {setFilterRegion('ALL');setFilterClinician('ALL');setSearch('');}} style={{ fontSize:10, color:'var(--gray)', background:'none', border:'1px solid var(--border)', borderRadius:5, padding:'3px 8px', cursor:'pointer' }}>Clear</button>
            )}
            <div style={{ marginLeft:'auto', fontSize:11, color:'var(--gray)' }}>
              {viewMode==='clinician' ? `${filteredClinicians.length} clinicians` : `${patientList.length} patients`}
            </div>
          </div>

          {/* ── CLINICIAN VIEW ── */}
          {viewMode === 'clinician' && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {filteredClinicians.map(c => {
                const isExpanded = expandedClin === c.name;
                const utilColor = c.utilPct >= 80 ? '#059669' : c.utilPct >= 50 ? '#D97706' : '#DC2626';
                return (
                  <div key={c.name} style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
                    {/* Clinician header row */}
                    <div onClick={() => setExpandedClin(isExpanded ? null : c.name)}
                      style={{ padding:'12px 16px', display:'grid', gridTemplateColumns:'1.5fr 0.4fr 0.6fr 0.6fr 0.6fr 0.6fr 1.2fr 0.6fr', gap:8, alignItems:'center', cursor:'pointer', background:isExpanded?'#F8FAFF':'var(--card-bg)' }}
                      onMouseEnter={e => e.currentTarget.style.background='#F0F4FF'}
                      onMouseLeave={e => e.currentTarget.style.background=isExpanded?'#F8FAFF':'var(--card-bg)'}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:700 }}>{c.name}</div>
                        <div style={{ fontSize:10, color:'var(--gray)' }}>{c.discipline}</div>
                      </div>
                      <span style={{ fontSize:11, fontWeight:700, color:'var(--gray)' }}>Rgn {c.region}</span>
                      <div style={{ textAlign:'center' }}>
                        <div style={{ fontSize:18, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#1565C0' }}>{c.patientCount}</div>
                        <div style={{ fontSize:8, color:'var(--gray)', textTransform:'uppercase' }}>Patients</div>
                      </div>
                      <div style={{ textAlign:'center' }}>
                        <div style={{ fontSize:18, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#059669' }}>{c.completed}</div>
                        <div style={{ fontSize:8, color:'var(--gray)', textTransform:'uppercase' }}>Done</div>
                      </div>
                      <div style={{ textAlign:'center' }}>
                        <div style={{ fontSize:18, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#1565C0' }}>{c.scheduled}</div>
                        <div style={{ fontSize:8, color:'var(--gray)', textTransform:'uppercase' }}>Sched</div>
                      </div>
                      <div style={{ textAlign:'center' }}>
                        <div style={{ fontSize:18, fontWeight:900, fontFamily:'DM Mono, monospace', color:c.missed>0?'#DC2626':'#6B7280' }}>{c.missed}</div>
                        <div style={{ fontSize:8, color:'var(--gray)', textTransform:'uppercase' }}>Missed</div>
                      </div>
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2 }}>
                          <div style={{ flex:1, height:6, background:'#E5E7EB', borderRadius:999 }}>
                            <div style={{ width:`${Math.min(100,c.utilPct)}%`, height:'100%', background:utilColor, borderRadius:999 }} />
                          </div>
                          <span style={{ fontSize:11, fontWeight:700, color:utilColor, minWidth:34 }}>{c.utilPct}%</span>
                        </div>
                        <div style={{ fontSize:9, color:'var(--gray)' }}>{c.total}/{c.target} visits</div>
                      </div>
                      <div style={{ textAlign:'right', fontSize:11, color:'var(--gray)' }}>
                        {isExpanded ? '▲ Hide' : '▼ Show patients'}
                      </div>
                    </div>

                    {/* Expanded patient list */}
                    {isExpanded && (
                      <div style={{ borderTop:'1px solid var(--border)', background:'#F8FAFF' }}>
                        <div style={{ padding:'8px 16px', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', display:'grid', gridTemplateColumns:'1.5fr 0.5fr 0.8fr 0.8fr 0.8fr 0.8fr', gap:8 }}>
                          <span>Patient</span><span>Rgn</span><span>Next Visit</span><span>Visit Type</span><span>Status</span><span>Action</span>
                        </div>
                        {c.visits.sort((a,b) => a.visit_date.localeCompare(b.visit_date)).reduce((acc, v) => {
                          // Dedupe by patient — show next scheduled
                          if (!acc.seen.has(v.patient_name)) {
                            acc.seen.add(v.patient_name);
                            acc.rows.push(v);
                          }
                          return acc;
                        }, {seen:new Set(), rows:[]}).rows.map((v,i) => {
                          const pat = census.find(p => p.patient_name?.toLowerCase() === v.patient_name?.toLowerCase());
                          return (
                            <div key={i} style={{ padding:'8px 16px', borderTop:'1px solid var(--border)', display:'grid', gridTemplateColumns:'1.5fr 0.5fr 0.8fr 0.8fr 0.8fr 0.8fr', gap:8, alignItems:'center', background:i%2===0?'#F8FAFF':'var(--card-bg)' }}>
                              <div>
                                <div style={{ fontSize:12, fontWeight:600 }}>{v.patient_name}</div>
                                <div style={{ fontSize:9, color:'var(--gray)' }}>{pat?.insurance || ''}</div>
                              </div>
                              <span style={{ fontSize:11, color:'var(--gray)' }}>Rgn {v.region}</span>
                              <span style={{ fontSize:11 }}>{fmtDate(v.visit_date)}</span>
                              <span style={{ fontSize:10, color:'var(--gray)' }}>{(v.event_type||'').slice(0,22)}</span>
                              <span style={{ fontSize:10, fontWeight:600, color:/completed/i.test(v.status||'')?'#059669':/missed/i.test(v.status||'')?'#DC2626':'#1565C0' }}>
                                {v.status}
                              </span>
                              {pat && (
                                <button onClick={() => setReassignPatient(pat)}
                                  style={{ padding:'3px 8px', background:'#FEF2F2', color:'#DC2626', border:'1px solid #FECACA', borderRadius:5, fontSize:9, fontWeight:700, cursor:'pointer' }}>
                                  ↔ Reassign
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── PATIENT VIEW ── */}
          {viewMode === 'patient' && (
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
              <div style={{ padding:'8px 16px', background:'var(--bg)', borderBottom:'1px solid var(--border)', display:'grid', gridTemplateColumns:'1.5fr 0.5fr 0.7fr 1.2fr 0.9fr 0.7fr 0.7fr', gap:8, fontSize:9, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em' }}>
                <span>Patient</span><span>Rgn</span><span>Insurance</span><span>This Week's Clinician(s)</span><span>Last Seen</span><span>Visits This Wk</span><span>Action</span>
              </div>
              {patientList.length === 0 ? (
                <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>No patients match filters.</div>
              ) : patientList.map((p,i) => (
                <div key={p.patient_name+i} style={{ padding:'9px 16px', borderBottom:'1px solid var(--border)', display:'grid', gridTemplateColumns:'1.5fr 0.5fr 0.7fr 1.2fr 0.9fr 0.7fr 0.7fr', gap:8, alignItems:'center', background:i%2===0?'var(--card-bg)':'var(--bg)' }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600 }}>{p.patient_name}</div>
                    {p.pipeline_assigned_to && <div style={{ fontSize:9, color:'#7C3AED' }}>Flagged: {p.pipeline_assigned_to}</div>}
                  </div>
                  <span style={{ fontSize:11, fontWeight:700, color:'var(--gray)' }}>{p.region}</span>
                  <span style={{ fontSize:10, color:'var(--gray)' }}>{p.insurance}</span>
                  <div>
                    {p.weekClinicians.length === 0
                      ? <span style={{ fontSize:11, color:'#DC2626', fontWeight:700 }}>⚠ None scheduled</span>
                      : p.weekClinicians.map(cl => (
                          <div key={cl} style={{ fontSize:11, fontWeight:600, color:'#1565C0' }}>{cl}</div>
                        ))
                    }
                  </div>
                  <span style={{ fontSize:11 }}>{fmtDate(p.last_visit_date)}</span>
                  <div style={{ fontSize:16, fontWeight:900, fontFamily:'DM Mono, monospace', color:p.weekVisits===0?'#DC2626':'#059669', textAlign:'center' }}>
                    {p.weekVisits}
                  </div>
                  <button onClick={() => setReassignPatient(p)}
                    style={{ padding:'4px 10px', background:'#FEF2F2', color:'#DC2626', border:'1px solid #FECACA', borderRadius:6, fontSize:10, fontWeight:700, cursor:'pointer' }}>
                    ↔ Reassign
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {reassignPatient && (
        <ReassignModal
          patient={reassignPatient}
          clinicians={clinicians}
          onClose={() => setReassignPatient(null)}
          onSaved={(newClin) => {
            setReassignPatient(null);
            load();
          }}
        />
      )}
    </div>
  );
}
