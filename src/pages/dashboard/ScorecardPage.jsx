import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';

const RATE = 230;
function isEval(e) { return /eval/i.test(e||''); }
function isCompleted(s) { return /completed/i.test(s||''); }
function isCancelled(e,s) { return /cancel/i.test(e||'')||/cancel/i.test(s||''); }
function isMissed(s) { return /missed/i.test(s||''); }

function ScoreBar({ label, score, max=100, color='#10B981', detail }) {
  const pct = Math.min((score/max)*100, 100);
  const grade = pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'F';
  const gradeColor = pct >= 90 ? '#065F46' : pct >= 80 ? '#1565C0' : pct >= 70 ? '#D97706' : '#DC2626';
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>{label}</div>
          {detail && <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 1 }}>{detail}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 700 }}>{Math.round(pct)}%</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: gradeColor, minWidth: 20, textAlign: 'center' }}>{grade}</span>
        </div>
      </div>
      <div style={{ height: 10, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct+'%', background: pct>=80?color:pct>=60?'#D97706':'#DC2626', borderRadius: 999, transition: 'width 0.5s' }} />
      </div>
    </div>
  );
}

export default function ScorecardPage() {
  const [visits, setVisits] = useState([]);
  const [intake, setIntake] = useState([]);
  const [auth, setAuth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30'); // days

  useEffect(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutStr = cutoff.toISOString().slice(0,10);

    Promise.all([
      supabase.from('visit_schedule_data').select('patient_name,visit_date,discipline,event_type,status,staff_name,region').not('visit_date','is',null),
      supabase.from('intake_referrals').select('referral_status,date_received,referral_type').not('date_received','is',null),
      supabase.from('auth_tracker').select('auth_status,created_at'),
    ]).then(([v, i, a]) => {
      setVisits(v.data || []);
      setIntake(i.data || []);
      setAuth(a.data || []);
      setLoading(false);
    });
  }, []);

  const scores = useMemo(() => {
    const days = parseInt(period);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutStr = cutoff.toISOString().slice(0,10);

    const recentVisits = visits.filter(v => v.visit_date >= cutStr);
    const recentIntake = intake.filter(i => i.date_received >= cutStr);

    // 1. Visit Completion Rate
    const evalSeen = new Set();
    let completedBillable = 0;
    recentVisits.forEach(v => {
      if (!isCompleted(v.status) || isCancelled(v.event_type, v.status)) return;
      if (isEval(v.event_type)) {
        const key = `${v.patient_name}||${v.visit_date}`;
        if (evalSeen.has(key)) return;
        evalSeen.add(key);
      }
      completedBillable++;
    });
    const totalScheduled = recentVisits.filter(v => !isCancelled(v.event_type,v.status)).length;
    const completionRate = totalScheduled > 0 ? (completedBillable / totalScheduled) * 100 : 0;

    // 2. Cancellation Rate
    const cancelled = recentVisits.filter(v => isCancelled(v.event_type,v.status)).length;
    const cancellationRate = recentVisits.length > 0 ? (cancelled / recentVisits.length) * 100 : 0;
    const cancellationScore = Math.max(0, 100 - (cancellationRate * 3)); // penalise

    // 3. Intake Conversion Rate
    const totalIntake = recentIntake.length;
    const acceptedIntake = recentIntake.filter(i => i.referral_status === 'Accepted').length;
    const intakeConversion = totalIntake > 0 ? (acceptedIntake / totalIntake) * 100 : 0;

    // 4. Auth Approval Rate
    const totalAuth = auth.length;
    const approvedAuth = auth.filter(a => /approved|active/i.test(a.auth_status||'')).length;
    const authApproval = totalAuth > 0 ? (approvedAuth / totalAuth) * 100 : 0;

    // 5. Clinician Productivity (visits/clinician vs 25 target for FT)
    const clinicianVisits = {};
    recentVisits.filter(v => isCompleted(v.status)).forEach(v => {
      clinicianVisits[v.staff_name||'Unknown'] = (clinicianVisits[v.staff_name||'Unknown']||0) + 1;
    });
    const clinicians = Object.values(clinicianVisits);
    const avgVisits = clinicians.length > 0 ? clinicians.reduce((a,b)=>a+b,0)/clinicians.length : 0;
    const TARGET_VISITS = days === 7 ? 25 : days === 30 ? 100 : 300;
    const productivityScore = Math.min((avgVisits / (TARGET_VISITS / clinicians.length || 1)) * 100, 100);

    // 6. Revenue Efficiency
    const revenueEarned = completedBillable * RATE;
    const revenuePotential = totalScheduled * RATE;
    const revenueEfficiency = revenuePotential > 0 ? (revenueEarned / revenuePotential) * 100 : 0;

    // Overall score (weighted)
    const overall = (
      completionRate * 0.30 +
      cancellationScore * 0.20 +
      intakeConversion * 0.20 +
      authApproval * 0.15 +
      productivityScore * 0.15
    );

    return {
      completionRate, cancellationRate, cancellationScore,
      intakeConversion, authApproval, productivityScore,
      revenueEfficiency, overall,
      completedBillable, totalScheduled, cancelled,
      acceptedIntake, totalIntake, approvedAuth, totalAuth,
      revenueEarned, avgVisits,
    };
  }, [visits, intake, auth, period]);

  const overallGrade = scores.overall >= 90 ? 'A' : scores.overall >= 80 ? 'B' : scores.overall >= 70 ? 'C' : scores.overall >= 60 ? 'D' : 'F';
  const gradeColor = scores.overall >= 90 ? '#065F46' : scores.overall >= 80 ? '#1565C0' : scores.overall >= 70 ? '#D97706' : '#DC2626';

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Scorecard" subtitle="Loading…" />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Company Scorecard" subtitle="Operational performance across all metrics"
        actions={
          <select value={period} onChange={e => setPeriod(e.target.value)}
            style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--card-bg)', outline: 'none' }}>
            <option value="7">Last 7 Days</option>
            <option value="30">Last 30 Days</option>
            <option value="90">Last 90 Days</option>
          </select>
        }
      />
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20 }}>
          {/* Overall Score */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray)', marginBottom: 12 }}>Overall Score</div>
            <div style={{ fontSize: 80, fontWeight: 800, color: gradeColor, lineHeight: 1, fontFamily: 'DM Mono, monospace' }}>{overallGrade}</div>
            <div style={{ fontSize: 36, fontWeight: 700, color: gradeColor, fontFamily: 'DM Mono, monospace', marginTop: 4 }}>{Math.round(scores.overall)}%</div>
            <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 12, maxWidth: 200, lineHeight: 1.5 }}>
              Weighted average across 5 key performance metrics for the last {period} days
            </div>
            {/* Circular-style progress */}
            <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {[
                { label: 'Completion', val: Math.round(scores.completionRate) },
                { label: 'Intake Conv.', val: Math.round(scores.intakeConversion) },
                { label: 'Auth', val: Math.round(scores.authApproval) },
                { label: 'Revenue Eff.', val: Math.round(scores.revenueEfficiency) },
              ].map(m => (
                <div key={m.label} style={{ background: 'var(--bg)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: m.val>=80?'#065F46':m.val>=60?'#D97706':'#DC2626' }}>{m.val}%</div>
                  <div style={{ fontSize: 9, color: 'var(--gray)', marginTop: 2 }}>{m.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Individual Scores */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--black)', marginBottom: 20 }}>Performance Metrics</div>
            <ScoreBar label="Visit Completion Rate" score={scores.completionRate}
              detail={`${scores.completedBillable} completed of ${scores.totalScheduled} scheduled`} color="#10B981" />
            <ScoreBar label="Cancellation Score" score={scores.cancellationScore}
              detail={`${scores.cancelled} cancellations (${Math.round(scores.cancellationRate)}% of visits)`} color="#10B981" />
            <ScoreBar label="Intake Conversion Rate" score={scores.intakeConversion}
              detail={`${scores.acceptedIntake} accepted of ${scores.totalIntake} referrals`} color="#1565C0" />
            <ScoreBar label="Auth Approval Rate" score={scores.authApproval}
              detail={`${scores.approvedAuth} approved of ${scores.totalAuth} total auths`} color="#7C3AED" />
            <ScoreBar label="Clinician Productivity" score={scores.productivityScore}
              detail={`Avg ${Math.round(scores.avgVisits)} visits/clinician this period`} color="#D97706" />
            <ScoreBar label="Revenue Efficiency" score={scores.revenueEfficiency}
              detail={`$${Math.round(scores.revenueEarned).toLocaleString()} earned vs potential`} color="#065F46" />
          </div>
        </div>

        {/* Benchmark table */}
        <div style={{ marginTop: 20, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>Metric Benchmarks</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', padding: '8px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <span>Metric</span><span>Current</span><span>Target</span><span>Status</span><span>Weight</span>
          </div>
          {[
            { label: 'Visit Completion Rate', current: Math.round(scores.completionRate)+'%', target: '85%', ok: scores.completionRate>=85, weight: '30%' },
            { label: 'Cancellation Rate', current: Math.round(scores.cancellationRate)+'%', target: '<10%', ok: scores.cancellationRate<10, weight: '20%' },
            { label: 'Intake Conversion Rate', current: Math.round(scores.intakeConversion)+'%', target: '50%', ok: scores.intakeConversion>=50, weight: '20%' },
            { label: 'Auth Approval Rate', current: Math.round(scores.authApproval)+'%', target: '80%', ok: scores.authApproval>=80, weight: '15%' },
            { label: 'Clinician Productivity', current: Math.round(scores.avgVisits)+' visits avg', target: '25/wk', ok: scores.productivityScore>=70, weight: '15%' },
          ].map((row, i) => (
            <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', padding: '10px 20px', borderBottom: '1px solid var(--border)', background: i%2===0?'var(--card-bg)':'var(--bg)', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--black)' }}>{row.label}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, fontSize: 13 }}>{row.current}</span>
              <span style={{ fontSize: 12, color: 'var(--gray)' }}>{row.target}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: row.ok?'#065F46':'#DC2626', background: row.ok?'#ECFDF5':'#FEF2F2', padding: '2px 8px', borderRadius: 999, display: 'inline-block' }}>
                {row.ok ? '✓ On Track' : '✗ Below Target'}
              </span>
              <span style={{ fontSize: 12, color: 'var(--gray)' }}>{row.weight}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
