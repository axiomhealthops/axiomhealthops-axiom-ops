import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];
const MANAGERS = { A:'Uma Jacobs',B:'Lia Davis',C:'Earl Dimaano',G:'Samantha Faliks',H:'Kaylee Ramsey',J:'Hollie Fincher',M:'Ariel Maboudi',N:'Ariel Maboudi',T:'Samantha Faliks',V:'Samantha Faliks' };

export default function MedicareTrackerPage() {
  const { profile } = useAuth();
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterFlag, setFilterFlag] = useState('ALL');
  const [searchQ, setSearchQ] = useState('');
  const [activeModal, setActiveModal] = useState(null); // { flag, type: '10'|'20' }
  const [ackNote, setAckNote] = useState('');

  async function recalculate() {
    setCalculating(true);
    try {
      // Get all medicare patients from census
      const { data: mcPts } = await supabase.from('census_data')
        .select('patient_name, region, insurance')
        .ilike('insurance', '%medicare%');

      // Get completed visit counts per patient
      const { data: visits } = await supabase.from('visit_schedule_data')
        .select('patient_name, staff_name, event_type, status, visit_date, region')
        .ilike('status', '%completed%');

      for (const pt of (mcPts || [])) {
        const ptVisits = (visits || []).filter(v =>
          v.patient_name === pt.patient_name &&
          !/cancel/i.test(v.event_type || '')
        ).sort((a, b) => a.visit_date?.localeCompare(b.visit_date));

        const total = ptVisits.length;

        // Find evaluating PT (staff from first eval visit, or most frequent staff)
        const evalVisit = ptVisits.find(v => /eval/i.test(v.event_type || ''));
        const staffCounts = {};
        ptVisits.forEach(v => { if (v.staff_name) staffCounts[v.staff_name] = (staffCounts[v.staff_name] || 0) + 1; });
        const evalPT = evalVisit?.staff_name || Object.entries(staffCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unassigned';

        const { data: existing } = await supabase.from('medicare_visit_flags')
          .select('id, flag_10th_acknowledged, flag_20th_acknowledged, total_completed_visits')
          .eq('patient_name', pt.patient_name).maybeSingle();

        const flag10 = total >= 10;
        const flag20 = total >= 20;

        // Preserve existing acknowledgements
        const ack10 = existing?.flag_10th_acknowledged || false;
        const ack20 = existing?.flag_20th_acknowledged || false;

        const payload = {
          patient_name: pt.patient_name,
          region: pt.region,
          insurance: pt.insurance,
          evaluating_pt: evalPT,
          total_completed_visits: total,
          flag_10th_note: flag10,
          flag_10th_acknowledged: ack10,
          flag_20th_discharge: flag20,
          flag_20th_acknowledged: ack20,
          last_calculated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        if (existing) {
          await supabase.from('medicare_visit_flags').update(payload).eq('patient_name', pt.patient_name);
        } else {
          await supabase.from('medicare_visit_flags').insert(payload);
        }
      }
    } catch (err) {
      console.error('Recalc error:', err);
    }
    setCalculating(false);
    loadFlags();
  }

  const regionScope = useAssignedRegions();

  async function loadFlags() {
    if (regionScope.loading) return;
    if (!regionScope.isAllAccess && (!regionScope.regions || regionScope.regions.length === 0)) {
      setFlags([]); setLoading(false); return;
    }
    const { data } = await regionScope.applyToQuery(
      supabase.from('medicare_visit_flags')
        .select('*').order('total_completed_visits', { ascending: false })
    );
    setFlags(data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadFlags();
  }, [regionScope.loading, regionScope.isAllAccess, JSON.stringify(regionScope.regions)]);
  useRealtimeTable(['census_data', 'visit_schedule_data', 'medicare_visit_flags'], load);

  async function acknowledge(flag, type) {
    const now = new Date().toISOString();
    const by = profile?.full_name || profile?.email || 'Unknown';
    const update = type === '10'
      ? { flag_10th_acknowledged: true, flag_10th_acknowledged_at: now, flag_10th_acknowledged_by: by }
      : { flag_20th_acknowledged: true, flag_20th_acknowledged_at: now, flag_20th_acknowledged_by: by };
    await supabase.from('medicare_visit_flags').update(update).eq('id', flag.id);
    setActiveModal(null);
    setAckNote('');
    loadFlags();
  }

  const filtered = useMemo(() => {
    return flags.filter(f => {
      if (filterRegion !== 'ALL' && f.region !== filterRegion) return false;
      if (filterFlag === 'needs_10' && !(f.flag_10th_note && !f.flag_10th_acknowledged)) return false;
      if (filterFlag === 'needs_20' && !(f.flag_20th_discharge && !f.flag_20th_acknowledged)) return false;
      if (filterFlag === 'active' && !(
        (f.flag_10th_note && !f.flag_10th_acknowledged) ||
        (f.flag_20th_discharge && !f.flag_20th_acknowledged)
      )) return false;
      if (searchQ && !f.patient_name?.toLowerCase().includes(searchQ.toLowerCase()) &&
        !f.evaluating_pt?.toLowerCase().includes(searchQ.toLowerCase())) return false;
      return true;
    });
  }, [flags, filterRegion, filterFlag, searchQ]);

  const needsAction = flags.filter(f =>
    (f.flag_10th_note && !f.flag_10th_acknowledged) ||
    (f.flag_20th_discharge && !f.flag_20th_acknowledged)
  );
  const critical = flags.filter(f => f.flag_20th_discharge && !f.flag_20th_acknowledged);
  const notes10 = flags.filter(f => f.flag_10th_note && !f.flag_10th_acknowledged);

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Medicare Visit Tracker" subtitle="Loading…" />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%' }}>
      <TopBar
        title="Medicare Visit Tracker"
        subtitle={`${flags.length} Medicare patients · ${needsAction.length} require action`}
      />
      <div style={{ flex:1 }}>

        {/* Action bar */}
        <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', background:'var(--card-bg)', display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:7, overflow:'hidden' }}>
            {[['ALL','All'],['active','⚠ Needs Action'],['needs_10','📋 10th Note'],['needs_20','🚨 Discharge']].map(([k,l]) => (
              <button key={k} onClick={() => setFilterFlag(k)}
                style={{ padding:'6px 12px', border:'none', fontSize:11, fontWeight:filterFlag===k?700:400, cursor:'pointer',
                  background:filterFlag===k?'#0F1117':'var(--card-bg)', color:filterFlag===k?'#fff':'var(--gray)' }}>{l}</button>
            ))}
          </div>
          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)' }}>
            <option value="ALL">All Regions</option>
            {REGIONS.map(r => <option key={r} value={r}>Region {r} — {MANAGERS[r]}</option>)}
          </select>
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search patient or PT…"
            style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--card-bg)', width:180 }} />
          <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
            <button onClick={recalculate} disabled={calculating}
              style={{ padding:'7px 16px', background:'#1565C0', color:'#fff', border:'none', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer' }}>
              {calculating ? '⟳ Recalculating…' : '⟳ Recalculate from Visits'}
            </button>
          </div>
        </div>

        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:16 }}>

          {/* Summary cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 }}>
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em' }}>Medicare Patients</div>
              <div style={{ fontSize:28, fontWeight:900, fontFamily:'DM Mono, monospace', color:'var(--black)', marginTop:6 }}>{flags.length}</div>
              <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>Active in census</div>
            </div>
            <div style={{ background: notes10.length>0?'#FEF3C7':'var(--card-bg)', border:`2px solid ${notes10.length>0?'#FCD34D':'var(--border)'}`, borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#D97706', textTransform:'uppercase', letterSpacing:'0.05em' }}>📋 10th Visit Note Due</div>
              <div style={{ fontSize:28, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#D97706', marginTop:6 }}>{notes10.length}</div>
              <div style={{ fontSize:11, color:'#92400E', marginTop:2 }}>PT note required</div>
            </div>
            <div style={{ background: critical.length>0?'#FEF2F2':'var(--card-bg)', border:`2px solid ${critical.length>0?'#FECACA':'var(--border)'}`, borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#DC2626', textTransform:'uppercase', letterSpacing:'0.05em' }}>🚨 20th Visit — Discharge</div>
              <div style={{ fontSize:28, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#DC2626', marginTop:6 }}>{critical.length}</div>
              <div style={{ fontSize:11, color:'#991B1B', marginTop:2 }}>Must discharge (20 visit max)</div>
            </div>
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#065F46', textTransform:'uppercase', letterSpacing:'0.05em' }}>✅ All Acknowledged</div>
              <div style={{ fontSize:28, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#065F46', marginTop:6 }}>
                {flags.length - needsAction.length}
              </div>
              <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>No action needed</div>
            </div>
          </div>

          {/* Critical 20th visit alerts */}
          {critical.length > 0 && (
            <div style={{ background:'#FEF2F2', border:'2px solid #FECACA', borderRadius:10, padding:'14px 18px' }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#DC2626', marginBottom:10 }}>
                🚨 {critical.length} Medicare patient{critical.length>1?'s':''} at 20 visits — DISCHARGE REQUIRED (Medicare 20-visit limit)
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {critical.map(f => (
                  <button key={f.id} onClick={() => setActiveModal({ flag: f, type: '20' })}
                    style={{ fontSize:12, fontWeight:700, color:'#DC2626', background:'white', border:'1px solid #FECACA', borderRadius:6, padding:'5px 12px', cursor:'pointer' }}>
                    {f.patient_name} ({f.total_completed_visits} visits)
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 10th visit note alerts */}
          {notes10.length > 0 && (
            <div style={{ background:'#FEF3C7', border:'2px solid #FCD34D', borderRadius:10, padding:'14px 18px' }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#92400E', marginBottom:10 }}>
                📋 {notes10.length} Medicare patient{notes10.length>1?'s':''} at 10 visits — PT note submission required
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {notes10.map(f => (
                  <button key={f.id} onClick={() => setActiveModal({ flag: f, type: '10' })}
                    style={{ fontSize:12, fontWeight:700, color:'#92400E', background:'white', border:'1px solid #FCD34D', borderRadius:6, padding:'5px 12px', cursor:'pointer' }}>
                    {f.patient_name} → {f.evaluating_pt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Main table */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontSize:14, fontWeight:700 }}>Medicare Patient Visit Log</div>
              <div style={{ fontSize:11, color:'var(--gray)' }}>{filtered.length} patients</div>
            </div>

            {/* Header */}
            <div style={{ display:'grid', gridTemplateColumns:'1.6fr 0.5fr 0.8fr 1.2fr 0.6fr 1fr 1fr', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', gap:8 }}>
              <span>Patient</span><span>Rgn</span><span>Visits</span><span>Evaluating PT</span><span>Progress</span><span>10th Note</span><span>20th Discharge</span>
            </div>

            {filtered.length === 0 ? (
              <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>
                {flags.length === 0 ? 'No Medicare patients found. Click "Recalculate from Visits" to scan.' : 'No records match current filters.'}
              </div>
            ) : filtered.map((f, i) => {
              const pct = Math.min((f.total_completed_visits / 20) * 100, 100);
              const barColor = f.total_completed_visits >= 20 ? '#DC2626' : f.total_completed_visits >= 15 ? '#D97706' : f.total_completed_visits >= 10 ? '#F59E0B' : '#1565C0';
              const needs10 = f.flag_10th_note && !f.flag_10th_acknowledged;
              const needs20 = f.flag_20th_discharge && !f.flag_20th_acknowledged;
              return (
                <div key={f.id} style={{ display:'grid', gridTemplateColumns:'1.6fr 0.5fr 0.8fr 1.2fr 0.6fr 1fr 1fr', padding:'11px 20px', borderBottom:'1px solid var(--border)', background: needs20 ? '#FFF5F5' : needs10 ? '#FFFBEB' : i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'center', gap:8 }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600 }}>{f.patient_name}</div>
                    <div style={{ fontSize:10, color:'var(--gray)', marginTop:1 }}>Medicare · Last calc: {new Date(f.last_calculated_at).toLocaleDateString()}</div>
                  </div>
                  <span style={{ fontSize:12, fontWeight:700, color:'var(--gray)' }}>{f.region}</span>
                  <div>
                    <span style={{ fontSize:18, fontWeight:900, fontFamily:'DM Mono, monospace', color:barColor }}>{f.total_completed_visits}</span>
                    <span style={{ fontSize:10, color:'var(--gray)' }}>/20</span>
                  </div>
                  <span style={{ fontSize:12 }}>{f.evaluating_pt || '—'}</span>
                  <div>
                    <div style={{ height:6, background:'var(--border)', borderRadius:999, overflow:'hidden', marginBottom:2 }}>
                      <div style={{ height:'100%', width:pct+'%', background:barColor, borderRadius:999 }} />
                    </div>
                    <div style={{ fontSize:9, color:'var(--gray)' }}>{Math.round(pct)}%</div>
                  </div>
                  <div>
                    {!f.flag_10th_note ? (
                      <span style={{ fontSize:10, color:'var(--gray)' }}>Not yet</span>
                    ) : f.flag_10th_acknowledged ? (
                      <span style={{ fontSize:10, fontWeight:600, color:'#065F46', background:'#ECFDF5', padding:'2px 8px', borderRadius:999 }}>✅ Done</span>
                    ) : (
                      <button onClick={() => setActiveModal({ flag: f, type: '10' })}
                        style={{ fontSize:10, fontWeight:700, color:'#92400E', background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:6, padding:'3px 10px', cursor:'pointer' }}>
                        📋 Note Required
                      </button>
                    )}
                  </div>
                  <div>
                    {!f.flag_20th_discharge ? (
                      <span style={{ fontSize:10, color:'var(--gray)' }}>{20 - f.total_completed_visits} visits left</span>
                    ) : f.flag_20th_acknowledged ? (
                      <span style={{ fontSize:10, fontWeight:600, color:'#065F46', background:'#ECFDF5', padding:'2px 8px', borderRadius:999 }}>✅ Discharged</span>
                    ) : (
                      <button onClick={() => setActiveModal({ flag: f, type: '20' })}
                        style={{ fontSize:10, fontWeight:700, color:'#DC2626', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:6, padding:'3px 10px', cursor:'pointer' }}>
                        🚨 Discharge Now
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Acknowledge Modal */}
      {activeModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
          <div style={{ background:'var(--card-bg)', borderRadius:14, width:'100%', maxWidth:500, boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ padding:'16px 22px', background: activeModal.type==='20'?'#DC2626':'#D97706', borderRadius:'14px 14px 0 0' }}>
              <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>
                {activeModal.type === '20' ? '🚨 Discharge Required' : '📋 10th Visit Note Required'}
              </div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.8)', marginTop:3 }}>
                {activeModal.flag.patient_name} · {activeModal.flag.total_completed_visits} completed visits
              </div>
            </div>
            <div style={{ padding:22, display:'flex', flexDirection:'column', gap:14 }}>
              <div style={{ background:'var(--bg)', borderRadius:8, padding:'12px 14px', fontSize:13 }}>
                {activeModal.type === '20' ? (
                  <>
                    <div style={{ fontWeight:700, color:'#DC2626', marginBottom:6 }}>Medicare 20-Visit Limit Reached</div>
                    <div style={{ color:'var(--gray)', lineHeight:1.5 }}>This patient has completed their maximum 20 Medicare-covered visits. A discharge must be processed. The evaluating PT ({activeModal.flag.evaluating_pt}) must complete the discharge documentation.</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight:700, color:'#D97706', marginBottom:6 }}>10th Visit Progress Note Required</div>
                    <div style={{ color:'var(--gray)', lineHeight:1.5 }}>Medicare requires a progress note from the evaluating PT at the 10th visit. This must be submitted by <strong>{activeModal.flag.evaluating_pt}</strong> before the next visit.</div>
                  </>
                )}
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--gray)', display:'block', marginBottom:4 }}>Confirmation Notes (optional)</label>
                <textarea value={ackNote} onChange={e => setAckNote(e.target.value)}
                  placeholder={activeModal.type === '20' ? 'Discharge date, reason, disposition…' : 'Note reference, submission date, EMR details…'}
                  style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:72, background:'var(--card-bg)' }} />
              </div>
            </div>
            <div style={{ padding:'14px 22px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:8, background:'var(--bg)' }}>
              <button onClick={() => { setActiveModal(null); setAckNote(''); }}
                style={{ padding:'8px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>Cancel</button>
              <button onClick={() => acknowledge(activeModal.flag, activeModal.type)}
                style={{ padding:'8px 22px', background: activeModal.type==='20'?'#DC2626':'#D97706', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:700, cursor:'pointer' }}>
                {activeModal.type === '20' ? 'Confirm Discharge' : 'Confirm Note Submitted'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
