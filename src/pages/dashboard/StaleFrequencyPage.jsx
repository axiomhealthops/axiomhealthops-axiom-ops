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
// queue to drive frequency reductions (coordinators own scheduling/admin
// changes per ops org chart — clinicians are front-line only).
//
// Frequency inference: we bucket each active patient's completed visits
// into three 30-day windows over the last 90 days and compute visits/week.
// If all three windows match within a tolerance AND the rate >= ~2/week,
// the patient is flagged STALE. If the last 30d rate is lower than the
// prior 60d rate, the patient is classified PROGRESSING (good — shows
// capacity is being freed).
//
// Note: Pariox data history only extends to Jan 2026 today, so we can't
// yet detect "stable for 180+ days". Once we accumulate that, the stability
// window should be extended.

import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

const WINDOW_DAYS = 30;
const STABILITY_DAYS = 90; // evaluate over last 90 days (3 × 30d windows)
const MIN_WEEKLY_FOR_FLAG = 1.5; // ≥ roughly 2x/week → eligible for reduction review
const TOLERANCE = 0.5; // visits/week variance across windows considered "stable"

// Map a visits-per-week number to a human-readable frequency label matching
// the vocabulary used elsewhere in the app (Clinical Progression uses 4w4,
// 2w4, 1w4, 1em1 etc.)
function freqLabel(vpw) {
  if (vpw >= 3) return '4w4 (4x/wk+)';
  if (vpw >= 1.5) return '2w4 (2x/wk)';
  if (vpw >= 0.6) return '1w4 (1x/wk)';
  if (vpw >= 0.15) return '1em1 (monthly)';
  return 'sub-monthly';
}

// Round to 1 decimal
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
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('stale'); // 'stale' | 'progressing' | 'insufficient'
  const [regionFilter, setRegionFilter] = useState('ALL');

  useEffect(() => {
    Promise.all([
      fetchAllPages(supabase.from('census_data').select('patient_name,region,status,insurance').ilike('status', 'active%')),
      fetchAllPages(
        supabase.from('visit_schedule_data')
          .select('patient_name,visit_date,status,event_type,region,staff_name')
          .gte('visit_date', new Date(Date.now() - STABILITY_DAYS * 86400000).toISOString().slice(0, 10))
      ),
      fetchAllPages(supabase.from('patient_clinical_settings').select('patient_name,last_reassessment_date,next_reassessment_deadline,reassessment_status,frequency_notes,visit_frequency')),
    ]).then(([c, v, cs]) => {
      setCensus(c);
      setVisits(v);
      setClinicalSettings(cs);
      setLoading(false);
    });
  }, []);

  // Scope to the user's assigned regions. Super admin (regions = null) sees
  // everything. Anyone with a specific region list only sees their regions.
  const allowedRegions = useMemo(() => {
    if (!profile) return null;
    if (profile.role === 'super_admin') return null;
    if (!profile.regions || profile.regions.length === 0) {
      // If user has no regions assigned, show nothing (fail closed).
      // Admins should have all regions populated.
      return [];
    }
    return profile.regions;
  }, [profile]);

  // Classify every active patient with at least 30 days of data.
  const classified = useMemo(() => {
    if (loading) return [];
    const settingsByPatient = new Map();
    clinicalSettings.forEach(s => settingsByPatient.set(s.patient_name, s));

    const now = Date.now();
    const d30 = now - 30 * 86400000;
    const d60 = now - 60 * 86400000;
    const d90 = now - 90 * 86400000;

    return census
      .filter(p => {
        if (!allowedRegions) return true;
        return allowedRegions.includes(p.region);
      })
      .map(p => {
        const patientVisits = visits.filter(v =>
          v.patient_name === p.patient_name &&
          isCompleted(v.status) &&
          !isCancelled(v.event_type, v.status)
        );

        // Bucket visits into three 30-day windows
        let w1 = 0, w2 = 0, w3 = 0;
        patientVisits.forEach(v => {
          const vt = new Date(v.visit_date + 'T00:00:00').getTime();
          if (vt >= d30) w1++;
          else if (vt >= d60) w2++;
          else if (vt >= d90) w3++;
        });

        const weeksPerWindow = 30 / 7; // ~4.29
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

        // Classification
        let classification;
        if (totalRecent < 4) {
          classification = 'insufficient'; // too few visits to judge (maybe new, maybe inactive)
        } else if (avgRate >= MIN_WEEKLY_FOR_FLAG && spread <= TOLERANCE) {
          // Stable at high frequency for ≥ 90 days
          classification = 'stale';
        } else if (rate1 < rate3 - TOLERANCE && rate3 >= MIN_WEEKLY_FOR_FLAG) {
          // Trending down — progressing correctly (had high frequency, now lower)
          classification = 'progressing';
        } else {
          classification = 'insufficient';
        }

        return {
          ...p,
          w1, w2, w3,
          rate1: r1(rate1),
          rate2: r1(rate2),
          rate3: r1(rate3),
          avgRate: r1(avgRate),
          spread: r1(spread),
          totalRecent,
          currentFreq: freqLabel(rate1),
          inferredFreq: freqLabel(avgRate),
          lastReassessDate,
          daysSinceReassess,
          reassessOverdue: daysSinceReassess === null || daysSinceReassess > 60,
          frequencyNotes: setting?.frequency_notes || null,
          classification,
        };
      });
  }, [census, visits, clinicalSettings, allowedRegions, loading]);

  const filtered = useMemo(() => {
    return classified
      .filter(p => p.classification === view)
      .filter(p => regionFilter === 'ALL' || p.region === regionFilter);
  }, [classified, view, regionFilter]);

  const counts = useMemo(() => ({
    stale: classified.filter(p => p.classification === 'stale').length,
    progressing: classified.filter(p => p.classification === 'progressing').length,
    insufficient: classified.filter(p => p.classification === 'insufficient').length,
  }), [classified]);

  // Estimated capacity unlock: if every 'stale' patient drops from current
  // rate to half, how many visits/week would that free up?
  const potentialCapacityPerWeek = useMemo(() => {
    return classified
      .filter(p => p.classification === 'stale')
      .reduce((sum, p) => sum + (p.avgRate / 2), 0);
  }, [classified]);

  const availableRegions = useMemo(() => {
    const set = new Set(classified.map(p => p.region).filter(Boolean));
    return ['ALL', ...[...set].sort()];
  }, [classified]);

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

      {/* Hero metric strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', borderBottom:'1px solid var(--border)' }}>
        <MetricCard
          active={view === 'stale'} onClick={() => setView('stale')}
          label="Eligible for Reduction" value={counts.stale}
          sub="2x/wk+ stable 90 days" color="#DC2626" bg="#FEF2F2"
        />
        <MetricCard
          active={view === 'progressing'} onClick={() => setView('progressing')}
          label="Correctly Progressing" value={counts.progressing}
          sub="Frequency trending down" color="#065F46" bg="#ECFDF5"
        />
        <MetricCard
          active={view === 'insufficient'} onClick={() => setView('insufficient')}
          label="Insufficient Data" value={counts.insufficient}
          sub="<4 visits or <90d history" color="#6B7280" bg="#F3F4F6"
        />
      </div>

      {/* Explanation banner */}
      <div style={{ padding:'10px 20px', background:'#FFFBEB', borderBottom:'1px solid #FCD34D', fontSize:12, color:'#78350F' }}>
        {view === 'stale' && (
          <>
            <strong>Why this matters:</strong> These patients have been on the same high frequency for 90+ days with no documented reassessment. Each one kept on 2x/week that could be 1x/week frees up clinician capacity for new SOCs. <strong>Care Coordinators:</strong> review with the clinician, then update the frequency in the patient record.
          </>
        )}
        {view === 'progressing' && (
          <>
            <strong>Good signal:</strong> These patients show frequency trending down over the last 90 days — clinicians are actively reducing treatment as patients improve. No action needed; this is the outcome we want everywhere.
          </>
        )}
        {view === 'insufficient' && (
          <>
            <strong>Data gap:</strong> These active patients have fewer than 4 completed visits in the last 90 days, or less than 90 days of history. Could mean new patient, on-hold, or clinician isn't entering visits. Worth a spot-check.
          </>
        )}
      </div>

      {/* Table */}
      <div style={{ flex:1, overflow:'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding:40, textAlign:'center', color:'var(--gray)', fontSize:14 }}>
            No patients in this category for the selected region.
          </div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:'var(--bg)', borderBottom:'1px solid var(--border)', position:'sticky', top:0, zIndex:1 }}>
                <Th>Patient</Th>
                <Th>Region</Th>
                <Th>Insurance</Th>
                <Th align="right">Last 30d</Th>
                <Th align="right">30-60d</Th>
                <Th align="right">60-90d</Th>
                <Th align="right">Avg/wk</Th>
                <Th>Current Freq</Th>
                <Th>Last Reassess</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {filtered
                .sort((a, b) => b.avgRate - a.avgRate)
                .map((p, i) => (
                <tr key={p.patient_name} style={{ borderBottom:'1px solid var(--border)', background:i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)' }}>
                  <Td><strong>{p.patient_name}</strong></Td>
                  <Td>{p.region || '—'}</Td>
                  <Td>{p.insurance || '—'}</Td>
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
                    {p.classification === 'stale' && (
                      <span style={{ fontSize:10, fontWeight:700, color:'#DC2626', background:'#FEF2F2', padding:'2px 8px', borderRadius:999 }}>
                        REVIEW NEEDED
                      </span>
                    )}
                    {p.classification === 'progressing' && (
                      <span style={{ fontSize:10, fontWeight:700, color:'#065F46', background:'#ECFDF5', padding:'2px 8px', borderRadius:999 }}>
                        ↓ REDUCING
                      </span>
                    )}
                    {p.classification === 'insufficient' && (
                      <span style={{ fontSize:10, fontWeight:700, color:'#6B7280', background:'#F3F4F6', padding:'2px 8px', borderRadius:999 }}>
                        CHECK
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
        border:'none',
        borderRight:'1px solid var(--border)',
        borderBottom: active ? `3px solid ${color}` : '3px solid transparent',
        textAlign:'left',
        cursor:'pointer',
        transition:'background 0.15s',
      }}>
      <div style={{ fontSize:11, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{label}</div>
      <div style={{ fontSize:28, fontWeight:800, fontFamily:'DM Mono, monospace', color, marginTop:4 }}>{value}</div>
      <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>{sub}</div>
    </button>
  );
}

function Th({ children, align = 'left' }) {
  return (
    <th style={{
      padding:'8px 12px', textAlign:align, fontSize:10, fontWeight:700,
      color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em',
    }}>{children}</th>
  );
}

function Td({ children, align = 'left', mono = false }) {
  return (
    <td style={{
      padding:'8px 12px', textAlign:align,
      fontFamily: mono ? 'DM Mono, monospace' : 'inherit',
      color:'var(--black)',
    }}>{children}</td>
  );
}
