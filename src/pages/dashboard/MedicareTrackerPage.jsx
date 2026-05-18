import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useAssignedRegions } from '../../hooks/useAssignedRegions';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import { REGION_COORD } from '../../lib/alertEngine';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// 'YYYY-MM-DD' + N days → 'YYYY-MM-DD' (local, no TZ shift)
function addDays(yyyymmdd, days) {
  if (!yyyymmdd) return null;
  const d = new Date(yyyymmdd + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function daysBetween(fromYmd, toYmd) {
  if (!fromYmd || !toYmd) return null;
  const a = new Date(fromYmd + 'T00:00:00');
  const b = new Date(toYmd + 'T00:00:00');
  return Math.floor((b - a) / 86400000);
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
  const [activeModal, setActiveModal] = useState(null); // { flag, type: 'progress'|'20' }
  const [ackNote, setAckNote] = useState('');

  async function recalculate() {
    setCalculating(true);
    try {
      // 2026-05-17: paginated — visit_schedule_data with status='completed'
      // can easily exceed 1000 rows when calculating Medicare cap utilization.
      const mcPts = await fetchAllPages(supabase.from('census_data')
        .select('patient_name, region, insurance')
        .ilike('insurance', '%medicare%'));

      const visits = await fetchAllPages(supabase.from('visit_schedule_data')
        .select('patient_name, staff_name, event_type, status, visit_date, region')
        .ilike('status', '%completed%'));

      const today = new Date().toISOString().split('T')[0];
      const dueList = [];

      for (const pt of (mcPts || [])) {
        const ptVisits = (visits || []).filter(v =>
          v.patient_name === pt.patient_name &&
          !/cancel/i.test(v.event_type || '')
        ).sort((a, b) => a.visit_date?.localeCompare(b.visit_date));

        if (ptVisits.length === 0) continue;
        const total = ptVisits.length;

        // Care start anchor — first eval visit if present, else first completed visit.
        // Per Liam: 30-day clock starts at start of care / first eval, not first completed visit.
        const evalVisit = ptVisits.find(v => /eval/i.test(v.event_type || ''));
        const careStartDate = evalVisit?.visit_date || ptVisits[0].visit_date;

        // Evaluating PT (eval visit staff, fallback to most frequent staff)
        const staffCounts = {};
        ptVisits.forEach(v => { if (v.staff_name) staffCounts[v.staff_name] = (staffCounts[v.staff_name] || 0) + 1; });
        const evalPT = evalVisit?.staff_name || Object.entries(staffCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unassigned';

        const { data: existing } = await supabase.from('medicare_visit_flags')
          .select('id, flag_10th_acknowledged, flag_20th_acknowledged, last_progress_note_date, last_progress_note_visit')
          .eq('patient_name', pt.patient_name).maybeSingle();

        // Rolling anchor — last submitted note if present, else care_start.
        const anchorDate  = existing?.last_progress_note_date  || careStartDate;
        const anchorVisit = existing?.last_progress_note_visit || 0;
        const nextDueVisit = anchorVisit + 10;
        const nextDueDate  = addDays(anchorDate, 30);

        const overVisit = total >= nextDueVisit;
        const overDays  = today >= nextDueDate;
        const due = overVisit || overDays;

        // Which threshold actually fired first (for human-readable reason)?
        let dueReason = null;
        if (due) {
          if (overVisit && overDays) {
            const tenthVisitDate = ptVisits[nextDueVisit - 1]?.visit_date;
            dueReason = (tenthVisitDate && tenthVisitDate <= nextDueDate) ? '10_visits' : '30_days';
          } else if (overVisit) {
            dueReason = '10_visits';
          } else {
            dueReason = '30_days';
          }
        }

        // Legacy 10/20 flags — kept in sync for any consumers reading them.
        const flag10 = total >= 10;
        const flag20 = total >= 20;
        const ack10 = existing?.flag_10th_acknowledged || false;
        const ack20 = existing?.flag_20th_acknowledged || false;

        const payload = {
          patient_name: pt.patient_name,
          region: pt.region,
          insurance: pt.insurance,
          evaluating_pt: evalPT,
          total_completed_visits: total,
          care_start_date: careStartDate,
          next_due_visit: nextDueVisit,
          next_due_date: nextDueDate,
          progress_note_due: due,
          progress_note_due_reason: dueReason,
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

        if (due) {
          dueList.push({
            patient_name: pt.patient_name,
            region: pt.region,
            evaluating_pt: evalPT,
            reason: dueReason,
            visits: total,
            due_date: nextDueDate,
          });
        }
      }

      await syncProgressNoteAlerts(dueList);
    } catch (err) {
      console.error('Recalc error:', err);
    }
    setCalculating(false);
    loadFlags();
  }

  // Fan out in-app alerts (AlertsBell) + coordinator_tasks for the current
  // due set. Delete-then-insert pattern mirrors alertEngine.js for the same
  // task types; ensures stale flags are cleared when a patient is no longer due.
  // ADs see the alert via region scope (their assigned regions include the
  // patient's letter). Care coord gets the actionable task in their queue.
  async function syncProgressNoteAlerts(due) {
    await supabase.from('alerts').delete()
      .eq('alert_type', 'medicare_progress_note')
      .eq('is_read', false);

    await supabase.from('coordinator_tasks').delete()
      .eq('auto_generated', true)
      .eq('task_type', 'medicare_progress_note')
      .in('status', ['open', 'in_progress']);

    if (!due.length) return;

    const today = new Date().toISOString().split('T')[0];
    const alertsToInsert = [];
    const tasksToInsert = [];

    for (const d of due) {
      const coord = REGION_COORD[d.region] || null;
      const reasonText = d.reason === '10_visits'
        ? `${d.visits} completed visits — 10-visit progress-note threshold reached`
        : `30+ days since last progress note (due ${d.due_date})`;

      alertsToInsert.push({
        alert_type: 'medicare_progress_note',
        priority: 'high',
        title: `Medicare Progress Note: ${d.patient_name}`,
        message: `${d.evaluating_pt} · Region ${d.region} · ${reasonText}. PT must submit Medicare progress note.`,
        patient_name: d.patient_name,
        clinician_name: d.evaluating_pt,
        region: d.region,
        assigned_to_region: d.region,
        is_read: false,
        is_dismissed: false,
        created_at: new Date().toISOString(),
      });

      tasksToInsert.push({
        task_type: 'medicare_progress_note',
        priority: 'high',
        title: `Medicare progress note: ${d.patient_name}`,
        description: `Evaluating PT ${d.evaluating_pt} must submit a Medicare progress note. ${reasonText}. Follow up to confirm submission.`,
        patient_name: d.patient_name,
        clinician_name: d.evaluating_pt,
        coordinator_region: d.region,
        assigned_to: coord,
        status: 'open',
        auto_generated: true,
        due_date: today,
        created_at: new Date().toISOString(),
      });
    }

    if (alertsToInsert.length) await supabase.from('alerts').insert(alertsToInsert);
    if (tasksToInsert.length)  await supabase.from('coordinator_tasks').insert(tasksToInsert);
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
  useRealtimeTable(['census_data', 'visit_schedule_data', 'medicare_visit_flags'], loadFlags);

  async function acknowledge(flag, type) {
    const now = new Date().toISOString();
    const today = now.split('T')[0];
    const by = profile?.full_name || profile?.email || 'Unknown';

    if (type === 'progress') {
      // Mark a Medicare progress note as submitted: reset the rolling
      // 10/30 clock from this submission, then clear any open alert/task.
      const visitAtSubmit = flag.total_completed_visits || 0;
      await supabase.from('medicare_visit_flags').update({
        last_progress_note_date: today,
        last_progress_note_visit: visitAtSubmit,
        last_progress_note_submitted_by: by,
        last_progress_note_notes: ackNote || null,
        progress_note_due: false,
        progress_note_due_reason: null,
        next_due_date: addDays(today, 30),
        next_due_visit: visitAtSubmit + 10,
        updated_at: now,
      }).eq('id', flag.id);

      await supabase.from('alerts').delete()
        .eq('alert_type', 'medicare_progress_note')
        .eq('patient_name', flag.patient_name)
        .eq('is_read', false);
      await supabase.from('coordinator_tasks').delete()
        .eq('task_type', 'medicare_progress_note')
        .eq('patient_name', flag.patient_name)
        .eq('auto_generated', true)
        .in('status', ['open', 'in_progress']);
    } else {
      // 20th-visit discharge ack (legacy flow).
      const update = { flag_20th_acknowledged: true, flag_20th_acknowledged_at: now, flag_20th_acknowledged_by: by };
      await supabase.from('medicare_visit_flags').update(update).eq('id', flag.id);
    }

    setActiveModal(null);
    setAckNote('');
    loadFlags();
  }

  const filtered = useMemo(() => {
    return flags.filter(f => {
      if (filterRegion !== 'ALL' && f.region !== filterRegion) return false;
      if (filterFlag === 'needs_note' && !f.progress_note_due) return false;
      if (filterFlag === 'needs_20' && !(f.flag_20th_discharge && !f.flag_20th_acknowledged)) return false;
      if (filterFlag === 'active' && !(
        f.progress_note_due ||
        (f.flag_20th_discharge && !f.flag_20th_acknowledged)
      )) return false;
      if (searchQ && !f.patient_name?.toLowerCase().includes(searchQ.toLowerCase()) &&
        !f.evaluating_pt?.toLowerCase().includes(searchQ.toLowerCase())) return false;
      return true;
    });
  }, [flags, filterRegion, filterFlag, searchQ]);

  const needsAction = flags.filter(f =>
    f.progress_note_due ||
    (f.flag_20th_discharge && !f.flag_20th_acknowledged)
  );
  const critical = flags.filter(f => f.flag_20th_discharge && !f.flag_20th_acknowledged);
  const notesDue = flags.filter(f => f.progress_note_due);

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
            {[['ALL','All'],['active','⚠ Needs Action'],['needs_note','📋 Progress Note Due'],['needs_20','🚨 Discharge']].map(([k,l]) => (
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
            <div style={{ background: notesDue.length>0?'#FEF3C7':'var(--card-bg)', border:`2px solid ${notesDue.length>0?'#FCD34D':'var(--border)'}`, borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#D97706', textTransform:'uppercase', letterSpacing:'0.05em' }}>📋 Progress Note Due</div>
              <div style={{ fontSize:28, fontWeight:900, fontFamily:'DM Mono, monospace', color:'#D97706', marginTop:6 }}>{notesDue.length}</div>
              <div style={{ fontSize:11, color:'#92400E', marginTop:2 }}>10 visits or 30 days</div>
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

          {/* Progress note alerts (10 visits OR 30 days from anchor) */}
          {notesDue.length > 0 && (
            <div style={{ background:'#FEF3C7', border:'2px solid #FCD34D', borderRadius:10, padding:'14px 18px' }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#92400E', marginBottom:10 }}>
                📋 {notesDue.length} Medicare patient{notesDue.length>1?'s':''} due a progress note (10-visit / 30-day rule)
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {notesDue.map(f => (
                  <button key={f.id} onClick={() => setActiveModal({ flag: f, type: 'progress' })}
                    style={{ fontSize:12, fontWeight:700, color:'#92400E', background:'white', border:'1px solid #FCD34D', borderRadius:6, padding:'5px 12px', cursor:'pointer' }}>
                    {f.patient_name} → {f.evaluating_pt} <span style={{ fontSize:10, fontWeight:500, opacity:0.75 }}>({f.progress_note_due_reason === '10_visits' ? `${f.total_completed_visits} visits` : '30+ days'})</span>
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
            <div style={{ display:'grid', gridTemplateColumns:'1.6fr 0.5fr 0.8fr 1.2fr 0.6fr 1.2fr 1fr', padding:'8px 20px', background:'var(--bg)', borderBottom:'1px solid var(--border)', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em', gap:8 }}>
              <span>Patient</span><span>Rgn</span><span>Visits</span><span>Evaluating PT</span><span>Progress</span><span>Progress Note</span><span>20th Discharge</span>
            </div>

            {filtered.length === 0 ? (
              <div style={{ padding:40, textAlign:'center', color:'var(--gray)' }}>
                {flags.length === 0 ? 'No Medicare patients found. Click "Recalculate from Visits" to scan.' : 'No records match current filters.'}
              </div>
            ) : filtered.map((f, i) => {
              const pct = Math.min((f.total_completed_visits / 20) * 100, 100);
              const barColor = f.total_completed_visits >= 20 ? '#DC2626' : f.total_completed_visits >= 15 ? '#D97706' : f.total_completed_visits >= 10 ? '#F59E0B' : '#1565C0';
              const needsNote = !!f.progress_note_due;
              const needs20 = f.flag_20th_discharge && !f.flag_20th_acknowledged;
              const todayStr = new Date().toISOString().split('T')[0];
              const anchorDate = f.last_progress_note_date || f.care_start_date;
              const daysSinceAnchor = daysBetween(anchorDate, todayStr);
              const visitsSinceAnchor = (f.total_completed_visits || 0) - (f.last_progress_note_visit || 0);
              return (
                <div key={f.id} style={{ display:'grid', gridTemplateColumns:'1.6fr 0.5fr 0.8fr 1.2fr 0.6fr 1.2fr 1fr', padding:'11px 20px', borderBottom:'1px solid var(--border)', background: needs20 ? '#FFF5F5' : needsNote ? '#FFFBEB' : i%2===0?'var(--card-bg)':'var(--bg)', alignItems:'center', gap:8 }}>
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
                    {needsNote ? (
                      <button onClick={() => setActiveModal({ flag: f, type: 'progress' })}
                        style={{ fontSize:10, fontWeight:700, color:'#92400E', background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:6, padding:'3px 10px', cursor:'pointer', textAlign:'left' }}>
                        📋 {f.progress_note_due_reason === '10_visits' ? `${visitsSinceAnchor} visits` : `${daysSinceAnchor}d since note`}
                      </button>
                    ) : f.last_progress_note_date ? (
                      <span style={{ fontSize:10, fontWeight:600, color:'#065F46', background:'#ECFDF5', padding:'2px 8px', borderRadius:999 }}>
                        ✓ {fmtDate(f.last_progress_note_date)} ({visitsSinceAnchor}v / {daysSinceAnchor}d)
                      </span>
                    ) : (
                      <span style={{ fontSize:10, color:'var(--gray)' }}>
                        {visitsSinceAnchor}v / {daysSinceAnchor ?? 0}d since start
                      </span>
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
                {activeModal.type === '20' ? '🚨 Discharge Required' : '📋 Progress Note Submission'}
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
                    <div style={{ fontWeight:700, color:'#D97706', marginBottom:6 }}>Medicare Progress Note Required</div>
                    <div style={{ color:'var(--gray)', lineHeight:1.5 }}>
                      Medicare requires a progress note every 10 visits OR every 30 days, whichever comes first.
                      This patient is due ({activeModal.flag.progress_note_due_reason === '10_visits' ? `${activeModal.flag.total_completed_visits} completed visits` : 'past 30-day window'}).
                      Submitted by the evaluating PT (<strong>{activeModal.flag.evaluating_pt}</strong>) — confirming below resets the 10-visit / 30-day clock.
                    </div>
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
