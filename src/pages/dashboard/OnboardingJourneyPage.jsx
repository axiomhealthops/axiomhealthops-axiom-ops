import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import {
  STAGE_LABEL, WORKER_CLASS_LABEL, JOURNEY_COLUMNS, columnForHire, stepsForHire, stepIndexForHire,
  entersTraining, isStatusChange, daysSince, daysUntil, fmtDate, startLabel, hasNoStartDate,
  docProgress, kitProgress, moduleProgress, rampGates, paceOf, PACE_COLOR,
} from '../../lib/onboardingMath';

// Liam's read-only journey. Not a working tool — a place to see where every
// hire sits from offer letter to active staff, and who to chase when one stalls.

function Avatar({ hire, size = 32 }) {
  const initials = (hire.full_name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const clinical = entersTraining(hire);
  return <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.36, fontWeight: 700, color: clinical ? 'var(--black)' : 'var(--gray)', background: clinical ? 'var(--ec-light-teal)' : 'var(--border)' }}>{initials}</div>;
}
function Kpi({ label, value, foot, tone }) {
  const top = tone === 'risk' ? 'var(--danger)' : tone === 'warn' ? 'var(--yellow)' : tone === 'accent' ? 'var(--ec-teal)' : tone === 'info' ? 'var(--blue)' : 'var(--border)';
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderTop: `3px solid ${top}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: 'var(--gray)', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--black)', marginTop: 4, letterSpacing: '-0.5px', lineHeight: 1.05 }}>{value}</div>
      {foot && <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>{foot}</div>}
    </div>
  );
}
function SectionH({ children, style }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray)', margin: '24px 2px 10px', ...style }}>{children}</div>;
}
function Check() {
  return <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function Flag() {
  return <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M3 1.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="M3 2h6l-1.3 2L9 6H3" fill="currentColor" /></svg>;
}
function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Who Liam should chase when a hire is stuck.
function followUpOwner(r) {
  if (r.hire.cleared_for_caseload) return null;
  const col = r.column;
  if (r.pay && r.pay.state === 'ready') return 'Quinn — ready to run payroll';
  if (col === 'offer' || col === 'paperwork') return 'Danielly — HR';
  if (col === 'training' || col === 'field') return 'Uma — onboarding';
  if (r.kp && r.kp.issued === 0) return 'Earl — supplies';
  return 'Danielly — HR';
}

export default function OnboardingJourneyPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [hires, setHires] = useState([]);
  const [docs, setDocs] = useState([]);
  const [supplies, setSupplies] = useState([]);
  const [progress, setProgress] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [notes, setNotes] = useState([]);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [h, d, s, p, pr, n] = await Promise.all([
        supabase.from('onboarding_hires').select('*').eq('is_active', true).order('start_date', { nullsFirst: false }),
        supabase.from('onboarding_documents').select('*'),
        supabase.from('onboarding_supplies').select('*'),
        supabase.from('onboarding_module_progress').select('*'),
        supabase.from('onboarding_payroll_handoffs').select('*'),
        supabase.from('onboarding_notes').select('*').order('created_at', { ascending: false }),
      ]);
      const bad = [h, d, s, p, pr, n].find(r => r.error);
      if (bad) throw bad.error;
      setHires(h.data || []); setDocs(d.data || []); setSupplies(s.data || []); setProgress(p.data || []); setPayroll(pr.data || []); setNotes(n.data || []);
    } catch (e) { console.error(e); setErr(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => hires.map(h => {
    const d = docs.filter(r => r.hire_id === h.id);
    const k = supplies.filter(r => r.hire_id === h.id);
    const mp = progress.filter(r => r.hire_id === h.id);
    const pay = payroll.find(p => p.hire_id === h.id) || null;
    const hnotes = notes.filter(n => n.hire_id === h.id);
    return { hire: h, docs: d, kit: k, mods: mp, pay, notes: hnotes,
      openBlocker: hnotes.some(n => n.is_blocker && !n.is_resolved),
      dp: docProgress(d), kp: kitProgress(k), mprog: moduleProgress(mp), pace: paceOf(h, d, mp, k), gates: rampGates(h, d, mp), column: columnForHire(h) };
  }), [hires, docs, supplies, progress, payroll, notes]);

  if (loading) return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}><TopBar title="Onboarding journey" subtitle="Loading..." /><div style={{ padding: 40, color: 'var(--gray)' }}>Loading...</div></div>;

  const cohort = {
    total: rows.length,
    soon: rows.filter(r => { const d = daysUntil(r.hire.start_date); return d !== null && d >= 0 && d <= 7; }).length,
    blocked: rows.filter(r => r.pace.key === 'blocked').length,
    active: rows.filter(r => r.hire.cleared_for_caseload).length,
  };
  const followUp = rows.filter(r => (r.pace.key !== 'ok' || r.openBlocker) && !r.hire.cleared_for_caseload)
    .sort((a, b) => ((b.openBlocker ? 2 : 0) + (b.pace.key === 'blocked' ? 1 : 0)) - ((a.openBlocker ? 2 : 0) + (a.pace.key === 'blocked' ? 1 : 0)));

  const sel = open ? rows.find(r => r.hire.id === open) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <TopBar title="Onboarding journey" subtitle="Director view — offer letter to active staff"
        actions={<button onClick={load} style={{ fontSize: 12, fontWeight: 600, padding: '7px 13px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--gray)', cursor: 'pointer' }}>Refresh</button>} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 26px 60px', background: 'var(--bg)' }}>
        {err && <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid var(--danger)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'var(--danger)' }}>{err}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <Kpi tone="accent" label="In the pipeline" value={cohort.total} foot={`${rows.filter(r => entersTraining(r.hire)).length} new hires · ${rows.filter(r => isStatusChange(r.hire)).length} status changes`} />
          <Kpi tone="warn" label="Starting within 7 days" value={cohort.soon} foot="Docs and kit must be ready" />
          <Kpi tone="risk" label="Blocked" value={cohort.blocked} foot="Someone needs a nudge from you" />
          <Kpi tone="info" label="Active on caseload" value={cohort.active} foot="Reached the field" />
        </div>

        {/* the journey — read only */}
        <SectionH>Where everyone sits</SectionH>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${JOURNEY_COLUMNS.length}, minmax(180px, 1fr))`, gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
          {JOURNEY_COLUMNS.map(col => {
            const inCol = rows.filter(r => r.column === col.key);
            return (
              <div key={col.key}>
                <div style={{ padding: '2px 4px 8px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>{col.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray)' }}>{inCol.length}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--gray)', marginTop: 1 }}>{col.owner}</div>
                  <div style={{ height: 3, borderRadius: 2, marginTop: 6, background: 'var(--border)' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {inCol.map(r => {
                    const c = PACE_COLOR[r.pace.key];
                    return (
                      <button key={r.hire.id} onClick={() => setOpen(r.hire.id)} style={{ textAlign: 'left', background: 'var(--card-bg)', border: '1px solid var(--border)', borderLeft: `3px solid ${c.fg}`, borderRadius: 9, padding: '9px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Avatar hire={r.hire} size={28} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--black)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.hire.full_name}</div>
                            <div style={{ fontSize: 10.5, color: 'var(--gray)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[r.hire.discipline, r.hire.region && `Region ${r.hire.region}`].filter(Boolean).join(' · ') || 'Details TBD'}</div>
                          </div>
                        </div>
                        {r.pace.key !== 'ok' && <span style={{ fontSize: 10.5, fontWeight: 700, color: c.fg }}>{r.pace.label} {'—'} {r.pace.why}</span>}
                        {r.openBlocker && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'var(--danger)' }}><Flag />Blocker flagged</span>}
                      </button>
                    );
                  })}
                  {inCol.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--light-gray)', padding: '10px 4px' }}>Empty</div>}
                </div>
              </div>
            );
          })}
        </div>

        {/* follow-up: who to chase */}
        <SectionH>Needs your follow-up {'—'} and who to chase</SectionH>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {followUp.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>Nothing stalled. The pipeline is moving.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <colgroup><col style={{ width: '26%' }} /><col style={{ width: '14%' }} /><col style={{ width: '18%' }} /><col style={{ width: '20%' }} /><col /></colgroup>
                <thead><tr>
                  {['Name', 'Stage', 'What is stuck', 'Chase', 'Starts'].map(h => <th key={h} style={{ textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--gray)', padding: '11px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {followUp.map(r => (
                    <tr key={r.hire.id} onClick={() => setOpen(r.hire.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <Avatar hire={r.hire} size={30} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>{r.hire.full_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--gray)' }}>{isStatusChange(r.hire) ? 'Status change' : 'New hire'}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>{STAGE_LABEL[r.hire.stage]}</td>
                      <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '4px 9px', borderRadius: 999, background: PACE_COLOR[r.pace.key].bg, color: PACE_COLOR[r.pace.key].fg }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: PACE_COLOR[r.pace.key].fg }} />{r.pace.why}
                        </span>
                      </td>
                      <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--border)', fontSize: 12.5, fontWeight: 600, color: 'var(--black)' }}>{followUpOwner(r)}</td>
                      <td style={{ padding: '11px 12px', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>{startLabel(r.hire)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {sel && <ReadDrawer r={sel} onClose={() => setOpen(null)} />}
    </div>
  );
}

// Read-only person summary. Same journey stepper, no controls.
function ReadDrawer({ r, onClose }) {
  const h = r.hire;
  const steps = stepsForHire(h);
  const idx = stepIndexForHire(h);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const line = (k, v, bad) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}><span style={{ color: 'var(--gray)' }}>{k}</span><span style={{ fontWeight: 600, color: bad ? 'var(--danger)' : 'var(--black)' }}>{v}</span></div>;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(460px, 100%)', height: '100%', background: 'var(--bg)', overflowY: 'auto', boxShadow: '-8px 0 32px rgba(15,23,42,0.18)' }}>
        <div style={{ position: 'sticky', top: 0, background: 'var(--card-bg)', borderBottom: '1px solid var(--border)', padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <Avatar hire={h} size={42} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--black)' }}>{h.full_name}</div>
            <div style={{ fontSize: 12.5, color: 'var(--gray)', marginTop: 1 }}>{[h.discipline, h.ls_level, h.region && `Region ${h.region}`].filter(Boolean).join(' · ') || 'Details not yet on file'}</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, color: 'var(--gray)', padding: 4 }}>{'×'}</button>
        </div>
        <div style={{ padding: '18px 20px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 22 }}>
            {steps.map((s, i) => {
              const done = i < idx, current = i === idx;
              const color = done ? 'var(--green)' : current ? 'var(--ec-indigo)' : 'var(--light-gray)';
              return (
                <div key={s.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                  {i > 0 && <div style={{ position: 'absolute', top: 11, right: '50%', width: '100%', height: 2, background: i <= idx ? 'var(--green)' : 'var(--border)' }} />}
                  <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, background: done ? 'var(--green)' : current ? 'var(--ec-indigo)' : 'var(--card-bg)', border: `2px solid ${done ? 'var(--green)' : current ? 'var(--ec-indigo)' : 'var(--border)'}`, color: '#fff' }}>
                    {done ? <Check /> : <span style={{ fontSize: 11, fontWeight: 700, color: current ? '#fff' : 'var(--light-gray)' }}>{i + 1}</span>}
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: current ? 700 : 500, color, marginTop: 6, textAlign: 'center', lineHeight: 1.2 }}>{s.label}</span>
                </div>
              );
            })}
          </div>

          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 11, padding: '12px 15px' }}>
            {line('Type', isStatusChange(h) ? 'Status change' : 'New hire')}
            {line('Worker class', WORKER_CLASS_LABEL[h.worker_class])}
            {line('Start', startLabel(h), hasNoStartDate(h))}
            {line('Documents', `${r.dp.done} of ${r.dp.total}`, !r.dp.complete)}
            {entersTraining(h) && line('Training', `${r.mprog.pct}%${r.mprog.idleDays >= 5 ? ` · idle ${r.mprog.idleDays}d` : ''}`)}
            {entersTraining(h) && line('Supervised visits', `${h.supervised_visits_completed} of ${h.supervised_visits_target}`)}
            {line('Kit issued', `${r.kp.issued} of ${r.kp.total}`, r.kp.issued === 0)}
            {r.pay && line('Payroll', { not_ready: 'Not ready', ready: 'Ready to send', sent: 'Sent, awaiting setup', confirmed: 'Confirmed', failed: 'Failed' }[r.pay.state])}
            {line('Preceptor', h.preceptor_name || (entersTraining(h) ? 'Not assigned' : 'n/a'), entersTraining(h) && !h.preceptor_name)}
          </div>

          {r.pace.key !== 'ok' && (
            <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 10, background: PACE_COLOR[r.pace.key].bg, border: `1px solid ${PACE_COLOR[r.pace.key].fg}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: PACE_COLOR[r.pace.key].fg }}>{r.pace.label} {'—'} {r.pace.why}</div>
              <div style={{ fontSize: 12, color: 'var(--black)', marginTop: 4 }}>Chase {followUpOwner(r)}.</div>
            </div>
          )}

          {/* team progress notes — read only for the director */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 8 }}>Team notes</div>
            {(r.notes || []).length === 0
              ? <div style={{ fontSize: 12, color: 'var(--gray)' }}>No notes from the team yet.</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {r.notes.map(n => {
                    const openBlk = n.is_blocker && !n.is_resolved;
                    return (
                      <div key={n.id} style={{ borderLeft: `3px solid ${openBlk ? 'var(--danger)' : n.is_blocker ? 'var(--green)' : 'var(--border)'}`, background: openBlk ? 'rgba(220,38,38,0.04)' : 'var(--bg)', borderRadius: '0 8px 8px 0', padding: '9px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--black)' }}>{n.author_name || 'Team member'}</span>
                          <span style={{ fontSize: 11, color: 'var(--gray)' }}>{timeAgo(n.created_at)}</span>
                          {openBlk && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--danger)', background: 'rgba(220,38,38,0.10)', padding: '2px 6px', borderRadius: 5 }}><Flag />Blocker</span>}
                          {n.is_blocker && n.is_resolved && <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--green)', background: 'rgba(5,150,105,0.10)', padding: '2px 6px', borderRadius: 5 }}>Resolved</span>}
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--black)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{n.body}</div>
                      </div>
                    );
                  })}
                </div>}
          </div>
        </div>
      </div>
    </div>
  );
}
