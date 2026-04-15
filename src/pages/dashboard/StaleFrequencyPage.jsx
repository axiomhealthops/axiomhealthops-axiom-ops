// StaleFrequencyPage.jsx
//
// Purpose: surface active patients whose treatment frequency has been stable
// at 2x/week or higher for 90+ days and who have NOT had a documented
// reassessment indicating clinical justification for that frequency.
//
// Why this exists: clinicians settle into comfortable caseloads on stable
// patients and resist reducing frequency or accepting new patients. Every
// patient stuck on an unnecessarily high frequency is clinician capacity
// that doesn't exist for new SOCs. This page gives Care Coordinators a
// queue to drive frequency reductions. Only admins / assoc directors /
// super admin can actually APPROVE and APPLY the frequency change
// (Samantha, Ariel, Randi are the approvers today).
//
// Frequency inference: bucket each active patient's completed visits into
// three 30-day windows over the last 90 days and compute visits/week. If
// all three windows match within a tolerance AND the rate >= ~2/week, the
// patient is flagged STALE. If the last 30d rate is lower than the 60-90d
// rate, the patient is classified PROGRESSING (good — shows capacity is
// being freed).
//
// Insurance source: census_data.insurance is populated with the insurance
// TYPE ("private") for most rows, not the payor name. Real payor lives in
// auth_tracker.insurance (preferred) or intake_referrals.insurance.

import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

const STABILITY_DAYS = 90;
const MIN_WEEKLY_FOR_FLAG = 1.5;
const TOLERANCE = 0.5;

// Roles allowed to APPROVE a frequency change. Per Liam: Samantha + Ariel
// (assoc_director) and Randi (admin). super_admin is always included for
// the director's own ability to act.
const APPROVER_ROLES = ['super_admin', 'admin', 'assoc_director'];

const FREQUENCY_OPTIONS = [
  { key: '4w4', label: '4w4', desc: '4x/week × 4 weeks' },
  { key: '2w4', label: '2w4', desc: '2x/week × 4 weeks' },
  { key: '1w4', label: '1w4', desc: '1x/week × 4 weeks' },
  { key: '1em1', label: '1em1', desc: '1x/month' },
  { key: '1em2', label: '1em2', desc: '1x every 2 months' },
  { key: 'maintenance', label: 'Maintenance', desc: 'Long-term' },
  { key: 'discharge', label: 'Discharge', desc: 'Ready for discharge' },
];

function freqLabel(vpw) {
  if (vpw >= 3) return '4w4 (4x/wk+)';
  if (vpw >= 1.5) return '2w4 (2x/wk)';
  if (vpw >= 0.6) return '1w4 (1x/wk)';
  if (vpw >= 0.15) return '1em1 (monthly)';
  return 'sub-monthly';
}

function r1(n) { return Math.round(n * 10) / 10; }
function isCompleted(status) { return /completed/i.test(status || ''); }
function isCancelled(event_type, status) {
  return /cancel/i.test(event_type || '') || /cancel/i.test(status || '');
}

export default function StaleFrequencyPage() {
  const { profile } = useAuth();
  const [census, setCensus] = useState([]);
  const [visits, setVisits] = useState([]);
  const [clinicalSettings, setClinicalSettings] = useState([]);
  const [authRecords, setAuthRecords] = useState([]);
  const [intakeRecords, setIntakeRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('stale');
  const [regionFilter, setRegionFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('avgRate');
  const [sortDir, setSortDir] = useState('desc');
  const [editing, setEditing] = useState(null); // patient object being edited

  const canApprove = APPROVER_ROLES.includes(profile?.role);

  async function loadData() {
    setLoading(true);
    const [c, v, cs, a, i] = await Promise.all([
      fetchAllPages(supabase.from('census_data').select('patient_name,region,status,insurance').ilike('status', 'active%')),
      fetchAllPages(
        supabase.from('visit_schedule_data')
          .select('patient_name,visit_date,status,event_type,region,staff_name')
          .gte('visit_date', new Date(Date.now() - STABILITY_DAYS * 86400000).toISOString().slice(0, 10))
      ),
      fetchAllPages(supabase.from('patient_clinical_settings').select('patient_name,last_reassessment_date,next_reassessment_deadline,reassessment_status,frequency_notes,visit_frequency,frequency_set_by,frequency_set_date')),
      fetchAllPages(supabase.from('auth_tracker').select('patient_name,insurance,created_at').not('insurance', 'is', null)),
      fetchAllPages(supabase.from('intake_referrals').select('patient_name,insurance,date_received').not('insurance', 'is', null)),
    ]);
    setCensus(c);
    setVisits(v);
    setClinicalSettings(cs);
    setAuthRecords(a);
    setIntakeRecords(i);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  // Build insurance lookup: prefer most-recent auth record, fall back to
  // most-recent intake record, fall back to census_data.insurance.
  const insuranceByPatient = useMemo(() => {
    const map = new Map();
    // Oldest first, so later writes overwrite with newer data
    authRecords
      .slice()
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
      .forEach(r => {
        if (r.insurance) map.set(r.patient_name, r.insurance);
      });
    // Only fill gaps with intake (don't overwrite a real auth record)
    intakeRecords
      .slice()
      .sort((a, b) => (a.date_received || '').localeCompare(b.date_received || ''))
      .forEach(r => {
        if (r.insurance && !map.has(r.patient_name)) map.set(r.patient_name, r.insurance);
      });
    return map;
  }, [authRecords, intakeRecords]);

  const allowedRegions = useMemo(() => {
    if (!profile) return null;
    if (profile.role === 'super_admin') return null;
    if (!profile.regions || profile.regions.length === 0) return [];
    return profile.regions;
  }, [profile]);

  const classified = useMemo(() => {
    if (loading) return [];
    const settingsByPatient = new Map();
    clinicalSettings.forEach(s => settingsByPatient.set(s.patient_name, s));

    const now = Date.now();
    const d30 = now - 30 * 86400000;
    const d60 = now - 60 * 86400000;
    const d90 = now - 90 * 86400000;

    return census
      .filter(p => !allowedRegions || allowedRegions.includes(p.region))
      .map(p => {
        const patientVisits = visits.filter(v =>
          v.patient_name === p.patient_name &&
          isCompleted(v.status) &&
          !isCancelled(v.event_type, v.status)
        );
        let w1 = 0, w2 = 0, w3 = 0;
        patientVisits.forEach(v => {
          const vt = new Date(v.visit_date + 'T00:00:00').getTime();
          if (vt >= d30) w1++;
          else if (vt >= d60) w2++;
          else if (vt >= d90) w3++;
        });

        const weeksPerWindow = 30 / 7;
        const rate1 = w1 / weeksPerWindow;
        const rate2 = w2 / weeksPerWindow;
        const rate3 = w3 / weeksPerWindow;
        const avgRate = (rate1 + rate2 + rate3) / 3;
        const totalRecent = w1 + w2 + w3;
        const spread = Math.max(rate1, rate2, rate3) - Math.min(rate1, rate2, rate3);

        const setting = settingsByPatient.get(p.patient_name);
        const lastReassessDate = setting?.last_reassessment_date || null;
        const daysSinceReassess = lastReassessDate
          ? Math.floor((now - new Date(lastReassessDate + 'T00:00:00').getTime()) / 86400000)
          : null;

        // Real insurance (auth/intake preferred over census "private")
        const realInsurance = insuranceByPatient.get(p.patient_name) || p.insurance || '—';

        let classification;
        if (totalRecent < 4) classification = 'insufficient';
        else if (avgRate >= MIN_WEEKLY_FOR_FLAG && spread <= TOLERANCE) classification = 'stale';
        else if (rate1 < rate3 - TOLERANCE && rate3 >= MIN_WEEKLY_FOR_FLAG) classification = 'progressing';
        else classification = 'insufficient';

        return {
          patient_name: p.patient_name,
          region: p.region || '—',
          insurance: realInsurance,
          w1, w2, w3,
          rate1: r1(rate1), rate2: r1(rate2), rate3: r1(rate3),
          avgRate: r1(avgRate),
          spread: r1(spread),
          totalRecent,
          currentFreq: freqLabel(rate1),
          inferredFreq: freqLabel(avgRate),
          lastReassessDate,
          daysSinceReassess,
          reassessOverdue: daysSinceReassess === null || daysSinceReassess > 60,
          frequencyNotes: setting?.frequency_notes || null,
          currentSetFrequency: setting?.visit_frequency || null,
          classification,
        };
      });
  }, [census, visits, clinicalSettings, insuranceByPatient, allowedRegions, loading]);

  const filtered = useMemo(() => {
    const list = classified
      .filter(p => p.classification === view)
      .filter(p => regionFilter === 'ALL' || p.region === regionFilter);

    // Sort
    const dirMult = sortDir === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dirMult;
      return String(av).localeCompare(String(bv)) * dirMult;
    });
  }, [classified, view, regionFilter, sortBy, sortDir]);

  const counts = useMemo(() => ({
    stale: classified.filter(p => p.classification === 'stale').length,
    progressing: classified.filter(p => p.classification === 'progressing').length,
    insufficient: classified.filter(p => p.classification === 'insufficient').length,
  }), [classified]);

  const potentialCapacityPerWeek = useMemo(() => {
    return classified
      .filter(p => p.classification === 'stale')
      .reduce((sum, p) => sum + (p.avgRate / 2), 0);
  }, [classified]);

  const availableRegions = useMemo(() => {
    const set = new Set(classified.map(p => p.region).filter(r => r && r !== '—'));
    return ['ALL', ...[...set].sort()];
  }, [classified]);

  function handleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir(col === 'patient_name' || col === 'region' || col === 'insurance' ? 'asc' : 'desc'); }
  }

  if (loading) {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
        <TopBar title="Stale Frequency Review" subtitle="Analyzing patient visit patterns…" />
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar
        title="Stale Frequency Review"
        subtitle={`${counts.stale} patients eligible for frequency reduction · ~${r1(potentialCapacityPerWeek)} visits/week of capacity could be unlocked`}
        actions={
          <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)}
            style={{ padding:'6px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, background:'var(--card-bg)', outline:'none' }}>
            {availableRegions.map(r => <option key={r} value={r}>{r === 'ALL' ? 'All Regions' : `Region ${r}`}</option>)}
          </select>
        }
      />

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', borderBottom:'1px solid var(--border)' }}>
        <MetricCard active={view === 'stale'} onClick={() => setView('stale')}
          label="Eligible for Reduction" value={counts.stale}
          sub="2x/wk+ stable 90 days" color="#DC2626" bg="#FEF2F2" />
        <MetricCard active={view === 'progressing'} onClick={() => setView('progressing')}
          label="Correctly Progressing" value={counts.progressing}
          sub="Frequency trending down" color="#065F46" bg="#ECFDF5" />
        <MetricCard active={view === 'insufficient'} onClick={() => setView('insufficient')}
          label="Insufficient Data" value={counts.insufficient}
          sub="<4 visits or <90d history" color="#6B7280" bg="#F3F4F6" />
      </div>

      <div style={{ padding:'10px 20px', background:'#FFFBEB', borderBottom:'1px solid #FCD34D', fontSize:12, color:'#78350F' }}>
        {view === 'stale' && (
          <>
            <strong>Why this matters:</strong> These patients have been on the same high frequency for 90+ days with no documented reassessment. Each one kept on 2x/week that could be 1x/week frees clinician capacity for new SOCs.
            {canApprove
              ? <> <strong>You can approve frequency changes</strong> — click a row to review and update.</>
              : <> <strong>Care Coordinators:</strong> review with the clinician, then request approval from Samantha, Ariel, or Randi.</>
            }
          </>
        )}
        {view === 'progressing' && <><strong>Good signal:</strong> These patients show frequency trending down over the last 90 days — clinicians are actively reducing treatment as patients improve.</>}
        {view === 'insufficient' && <><strong>Data gap:</strong> These active patients have fewer than 4 completed visits in the last 90 days, or less than 90 days of history.</>}
      </div>

      <div style={{ flex:1, overflow:'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding:40, textAlign:'center', color:'var(--gray)', fontSize:14 }}>No patients in this category for the selected region.</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:'var(--bg)', borderBottom:'1px solid var(--border)', position:'sticky', top:0, zIndex:1 }}>
                <SortableTh col="patient_name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Patient</SortableTh>
                <SortableTh col="region" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Region</SortableTh>
                <SortableTh col="insurance" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Insurance</SortableTh>
                <SortableTh col="w1" align="right" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Last 30d</SortableTh>
                <SortableTh col="w2" align="right" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>30-60d</SortableTh>
                <SortableTh col="w3" align="right" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>60-90d</SortableTh>
                <SortableTh col="avgRate" align="right" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Avg/wk</SortableTh>
                <SortableTh col="currentFreq" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Current Freq</SortableTh>
                <SortableTh col="daysSinceReassess" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Last Reassess</SortableTh>
                <Th>{canApprove ? 'Action' : 'Status'}</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <tr key={p.patient_name}
                  onClick={() => canApprove && setEditing(p)}
                  style={{
                    borderBottom:'1px solid var(--border)',
                    background: i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)',
                    cursor: canApprove ? 'pointer' : 'default',
                  }}>
                  <Td><strong>{p.patient_name}</strong></Td>
                  <Td>{p.region}</Td>
                  <Td>{p.insurance}</Td>
                  <Td align="right" mono>{p.w1} <span style={{ color:'var(--gray)' }}>({p.rate1}/wk)</span></Td>
                  <Td align="right" mono>{p.w2} <span style={{ color:'var(--gray)' }}>({p.rate2}/wk)</span></Td>
                  <Td align="right" mono>{p.w3} <span style={{ color:'var(--gray)' }}>({p.rate3}/wk)</span></Td>
                  <Td align="right" mono><strong>{p.avgRate}</strong></Td>
                  <Td>
                    <span style={{
                      fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:999,
                      background: p.avgRate >= 1.5 ? '#FEF2F2' : '#ECFDF5',
                      color: p.avgRate >= 1.5 ? '#DC2626' : '#065F46',
                    }}>{p.currentFreq}</span>
                  </Td>
                  <Td>
                    {p.lastReassessDate
                      ? <span style={{ color: p.reassessOverdue ? '#DC2626' : '#065F46' }}>
                          {p.lastReassessDate} {p.daysSinceReassess !== null && <small>({p.daysSinceReassess}d ago)</small>}
                        </span>
                      : <span style={{ color:'#DC2626', fontWeight:600 }}>Never documented</span>
                    }
                  </Td>
                  <Td>
                    {canApprove ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditing(p); }}
                        style={{ fontSize:10, fontWeight:700, padding:'4px 10px', borderRadius:6, border:'1px solid #1565C0', background:'#EFF6FF', color:'#1565C0', cursor:'pointer' }}>
                        EDIT FREQUENCY
                      </button>
                    ) : (
                      <StatusBadge classification={p.classification} />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <FrequencyEditModal
          patient={editing}
          approverName={profile?.full_name || profile?.email || 'unknown'}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadData(); }}
        />
      )}
    </div>
  );
}

function StatusBadge({ classification }) {
  if (classification === 'stale') return <span style={{ fontSize:10, fontWeight:700, color:'#DC2626', background:'#FEF2F2', padding:'2px 8px', borderRadius:999 }}>REVIEW NEEDED</span>;
  if (classification === 'progressing') return <span style={{ fontSize:10, fontWeight:700, color:'#065F46', background:'#ECFDF5', padding:'2px 8px', borderRadius:999 }}>↓ REDUCING</span>;
  return <span style={{ fontSize:10, fontWeight:700, color:'#6B7280', background:'#F3F4F6', padding:'2px 8px', borderRadius:999 }}>CHECK</span>;
}

function FrequencyEditModal({ patient, approverName, onClose, onSaved }) {
  const [newFrequency, setNewFrequency] = useState(patient.currentSetFrequency || '1w4');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave() {
    if (!notes.trim()) {
      setErr('Notes are required — document why this frequency is being changed');
      return;
    }
    setErr('');
    setSaving(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      // Upsert into patient_clinical_settings keyed on patient_name
      const { data: existing } = await supabase
        .from('patient_clinical_settings')
        .select('id')
        .eq('patient_name', patient.patient_name)
        .maybeSingle();

      const payload = {
        patient_name: patient.patient_name,
        region: patient.region,
        visit_frequency: newFrequency,
        frequency_set_by: approverName,
        frequency_set_date: today,
        frequency_notes: notes,
        last_reassessment_date: today,
        last_reassessment_type: 'frequency_review',
        updated_at: new Date().toISOString(),
      };

      if (existing?.id) {
        const { error } = await supabase
          .from('patient_clinical_settings')
          .update(payload)
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('patient_clinical_settings')
          .insert(payload);
        if (error) throw error;
      }
      onSaved();
    } catch (e) {
      setErr(e.message || 'Failed to save');
    }
    setSaving(false);
  }

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:'var(--card-bg)', borderRadius:16, width:'100%', maxWidth:560, display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding:'18px 24px', borderBottom:'1px solid var(--border)', background:'#0F1117', borderRadius:'16px 16px 0 0' }}>
          <div style={{ fontSize:16, fontWeight:700, color:'#fff' }}>Update Frequency — {patient.patient_name}</div>
          <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>
            Region {patient.region} · {patient.insurance} · Currently inferred: {patient.currentFreq} · Avg {patient.avgRate}/wk
          </div>
        </div>

        <div style={{ padding:24, display:'flex', flexDirection:'column', gap:16 }}>
          <div style={{ background:'#FFFBEB', border:'1px solid #FCD34D', borderRadius:8, padding:'10px 12px', fontSize:12, color:'#78350F' }}>
            <strong>Approver:</strong> {approverName} · this change will be logged with your name and today's date, and counts as the last reassessment.
          </div>

          <div>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:6 }}>NEW FREQUENCY</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
              {FREQUENCY_OPTIONS.map(o => (
                <button key={o.key}
                  onClick={() => setNewFrequency(o.key)}
                  style={{
                    padding:'10px 8px', borderRadius:8, cursor:'pointer',
                    border:`2px solid ${newFrequency === o.key ? '#1565C0' : 'var(--border)'}`,
                    background: newFrequency === o.key ? '#EFF6FF' : 'var(--card-bg)',
                    textAlign:'left',
                  }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--black)' }}>{o.label}</div>
                  <div style={{ fontSize:10, color:'var(--gray)', marginTop:2 }}>{o.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:6 }}>
              CLINICAL JUSTIFICATION <span style={{ color:'#DC2626' }}>*</span>
            </div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Why is this frequency appropriate now? (e.g., 'Patient achieving goals, reducing from 2x to 1x/week per clinician recommendation')"
              style={{ width:'100%', padding:'10px 12px', border:'1px solid var(--border)', borderRadius:8, fontSize:13, outline:'none', boxSizing:'border-box', resize:'vertical', minHeight:90, background:'var(--card-bg)', fontFamily:'inherit' }} />
          </div>

          {err && <div style={{ fontSize:12, color:'#DC2626', fontWeight:600 }}>{err}</div>}
        </div>

        <div style={{ padding:'14px 24px', borderTop:'1px solid var(--border)', display:'flex', gap:8, background:'var(--bg)' }}>
          <button onClick={handleSave} disabled={saving}
            style={{ padding:'9px 22px', background:'var(--red)', color:'#fff', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>
            {saving ? 'Saving…' : '✓ Approve & Apply'}
          </button>
          <button onClick={onClose}
            style={{ padding:'9px 16px', border:'1px solid var(--border)', borderRadius:7, fontSize:13, background:'var(--card-bg)', cursor:'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ active, onClick, label, value, sub, color, bg }) {
  return (
    <button onClick={onClick}
      style={{
        padding:'16px 20px',
        background: active ? bg : 'var(--card-bg)',
        border:'none', borderRight:'1px solid var(--border)',
        borderBottom: active ? `3px solid ${color}` : '3px solid transparent',
        textAlign:'left', cursor:'pointer', transition:'background 0.15s',
      }}>
      <div style={{ fontSize:11, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{label}</div>
      <div style={{ fontSize:28, fontWeight:800, fontFamily:'DM Mono, monospace', color, marginTop:4 }}>{value}</div>
      <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>{sub}</div>
    </button>
  );
}

function SortableTh({ col, sortBy, sortDir, onSort, align = 'left', children }) {
  const active = sortBy === col;
  return (
    <th onClick={() => onSort(col)}
      style={{
        padding:'8px 12px', textAlign:align, fontSize:10, fontWeight:700,
        color: active ? 'var(--black)' : 'var(--gray)',
        textTransform:'uppercase', letterSpacing:'0.05em',
        cursor:'pointer', userSelect:'none', whiteSpace:'nowrap',
      }}>
      {children}
      <span style={{ marginLeft:4, opacity: active ? 1 : 0.3, fontSize:9 }}>
        {active ? (sortDir === 'asc' ? '▲' : '▼') : '▲▼'}
      </span>
    </th>
  );
}

function Th({ children, align = 'left' }) {
  return (
    <th style={{ padding:'8px 12px', textAlign:align, fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{children}</th>
  );
}

function Td({ children, align = 'left', mono = false }) {
  return (
    <td style={{ padding:'8px 12px', textAlign:align, fontFamily: mono ? 'DM Mono, monospace' : 'inherit', color:'var(--black)' }}>{children}</td>
  );
}
