import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import {
  STAGE_LABEL, DOC_SET_LABEL, WORKER_CLASS_LABEL, SUPPLY_STATE_LABEL,
  JOURNEY_COLUMNS, columnForHire, stepsForHire, stepIndexForHire,
  entersTraining, isStatusChange, daysSince, daysUntil, fmtDate, startLabel,
  hasNoStartDate, docProgress, kitProgress, moduleProgress, rampGates, paceOf,
  PACE_COLOR,
} from '../../lib/onboardingMath';

// ── The people who use this page, and what each of them owns ─────────────────
// This is a shared board read the same way by everyone, with a role lens on top
// so each user sees their own work first and edits only their section.
const ROLES = [
  { key: 'all',      person: 'Liam O’Brien',    role: 'Director of Operations', board: null,       owns: [] },
  { key: 'hr',       person: 'Danielly Moura',  role: 'HR Director',            board: 'hr',       owns: ['offer', 'paperwork'] },
  { key: 'training', person: 'Uma Jacobs',      role: 'ADOC – Onboarding',      board: 'training', owns: ['training', 'field'] },
  { key: 'payroll',  person: 'Quinn Mäensivu',  role: 'Payroll Manager',        board: 'payroll',  owns: ['active'] },
  { key: 'supply',   person: 'Earl Dimaano',    role: 'Supply Chain',           board: 'supply',   owns: [] },
];

// ── shared visual atoms ──────────────────────────────────────────────────────
function Card({ children, style }) {
  return <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', ...style }}>{children}</div>;
}
function SectionH({ children, style }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray)', margin: '22px 2px 10px', ...style }}>{children}</div>;
}
function Kpi({ label, value, foot, tone }) {
  const top = tone === 'risk' ? 'var(--danger)' : tone === 'warn' ? 'var(--yellow)' : tone === 'accent' ? 'var(--ec-teal)' : tone === 'info' ? 'var(--blue)' : 'var(--border)';
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderTop: `3px solid ${top}`, borderRadius: 10, padding: '13px 15px' }}>
      <div style={{ fontSize: 12, color: 'var(--gray)', fontWeight: 500, lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 27, fontWeight: 700, color: 'var(--black)', marginTop: 4, letterSpacing: '-0.5px', lineHeight: 1.1 }}>{value}</div>
      {foot && <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>{foot}</div>}
    </div>
  );
}
function Pill({ tone, children }) {
  const c = PACE_COLOR[tone] || { fg: 'var(--gray)', bg: 'rgba(71,85,105,0.10)' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '4px 9px', borderRadius: 999, background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.fg, flexShrink: 0 }} />{children}
    </span>
  );
}
function Tag({ children, tone }) {
  const map = {
    violet: { fg: 'var(--ec-indigo)', bg: 'rgba(99,102,241,0.11)' },
    teal:   { fg: 'var(--ec-teal)',   bg: 'rgba(6,182,212,0.12)' },
    gray:   { fg: 'var(--gray)',      bg: 'rgba(71,85,105,0.10)' },
    blue:   { fg: 'var(--blue)',      bg: 'rgba(14,165,233,0.12)' },
  };
  const c = map[tone] || map.gray;
  return <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 5, background: c.bg, color: c.fg }}>{children}</span>;
}
function Bar({ pct, tone }) {
  const fg = tone === 'risk' ? 'var(--danger)' : tone === 'warn' ? 'var(--yellow)' : 'var(--ec-teal)';
  return <div style={{ flex: 1, height: 6, borderRadius: 999, background: 'var(--border)', overflow: 'hidden', minWidth: 32 }}><div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: fg, borderRadius: 999 }} /></div>;
}
function Btn({ children, onClick, disabled, kind, title, full }) {
  const primary = kind !== 'ghost';
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      fontSize: 12, fontWeight: 600, padding: '7px 13px', borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer',
      border: primary ? 'none' : '1px solid var(--border)', width: full ? '100%' : 'auto',
      background: disabled ? 'var(--border)' : primary ? 'var(--ec-indigo)' : 'transparent',
      color: disabled ? 'var(--light-gray)' : primary ? '#fff' : 'var(--gray)', opacity: disabled ? 0.7 : 1, whiteSpace: 'nowrap',
    }}>{children}</button>
  );
}
function Avatar({ hire, size = 33 }) {
  const initials = (hire.full_name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const clinical = entersTraining(hire);
  return <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.36, fontWeight: 700, color: clinical ? 'var(--black)' : 'var(--gray)', background: clinical ? 'var(--ec-light-teal)' : 'var(--border)' }}>{initials}</div>;
}
function Row({ k, v, tone }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
      <span style={{ color: 'var(--gray)' }}>{k}</span>
      <span style={{ fontWeight: 600, color: tone === 'bad' ? 'var(--danger)' : 'var(--black)', textAlign: 'right' }}>{v}</span>
    </div>
  );
}
function Check() {
  return <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function OnboardingRampPage() {
  const { profile } = useAuth();
  const allAccess = ['super_admin', 'ceo'].includes(profile?.role);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [err, setErr] = useState(null);
  const [selected, setSelected] = useState(null);        // hire id in the slide-over
  const [search, setSearch] = useState('');

  const [hires, setHires] = useState([]);
  const [docs, setDocs] = useState([]);
  const [supplies, setSupplies] = useState([]);
  const [modules, setModules] = useState([]);
  const [progress, setProgress] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [owners, setOwners] = useState([]);
  const [focus, setFocus] = useState('all');

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [h, d, s, m, p, pr, o] = await Promise.all([
        supabase.from('onboarding_hires').select('*').eq('is_active', true).order('start_date', { nullsFirst: false }),
        supabase.from('onboarding_documents').select('*').order('sort_order'),
        supabase.from('onboarding_supplies').select('*').order('sort_order'),
        supabase.from('onboarding_modules').select('*').order('sort_order'),
        supabase.from('onboarding_module_progress').select('*'),
        supabase.from('onboarding_payroll_handoffs').select('*'),
        supabase.from('onboarding_board_owners').select('*'),
      ]);
      const bad = [h, d, s, m, p, pr, o].find(r => r.error);
      if (bad) throw bad.error;
      setHires(h.data || []); setDocs(d.data || []); setSupplies(s.data || []);
      setModules(m.data || []); setProgress(p.data || []); setPayroll(pr.data || []); setOwners(o.data || []);
    } catch (e) { console.error('Onboarding load failed:', e); setErr(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Focus defaults to the logged-in user's own board so each person lands on
  // their own work. Liam and admins land on the whole cohort.
  useEffect(() => {
    if (!profile) return;
    if (allAccess) { setFocus('all'); return; }
    const mine = owners.find(o => o.coordinator_id === profile.id);
    if (mine) setFocus(ROLES.find(r => r.board === mine.board)?.key || 'all');
  }, [profile, owners, allAccess]);

  const myBoards = useMemo(() => new Set(owners.filter(o => o.coordinator_id === profile?.id).map(o => o.board)), [owners, profile]);
  const canEdit = useCallback((board) => allAccess || myBoards.has(board), [allAccess, myBoards]);

  const rows = useMemo(() => hires.map(h => {
    const d = docs.filter(r => r.hire_id === h.id);
    const k = supplies.filter(r => r.hire_id === h.id);
    const mp = progress.filter(r => r.hire_id === h.id);
    const pay = payroll.find(p => p.hire_id === h.id) || null;
    return { hire: h, docs: d, kit: k, mods: mp, pay, dp: docProgress(d), kp: kitProgress(k), mprog: moduleProgress(mp), pace: paceOf(h, d, mp, k), gates: rampGates(h, d, mp), column: columnForHire(h) };
  }), [hires, docs, supplies, progress, payroll]);

  const rowById = useCallback((id) => rows.find(r => r.hire.id === id), [rows]);
  const activeRole = ROLES.find(r => r.key === focus) || ROLES[0];

  // ── the current user's worklist ───────────────────────────────────────────
  const worklist = useMemo(() => buildWorklist(focus, rows), [focus, rows]);

  // ── writes (unchanged behaviour; RLS is the real gate) ─────────────────────
  async function mutate(key, fn) {
    setSaving(key); setErr(null);
    try { const { error } = await fn(); if (error) throw error; await load(); }
    catch (e) { console.error(e); setErr(e.message || 'Save failed'); }
    finally { setSaving(null); }
  }
  const toggleDoc = (doc) => mutate('doc' + doc.id, () => supabase.from('onboarding_documents').update({ is_complete: !doc.is_complete }).eq('id', doc.id));
  const setKitState = (item, state) => mutate('kit' + item.id, () => supabase.from('onboarding_supplies').update({ state, ordered_at: state === 'ordered' ? new Date().toISOString() : item.ordered_at, issued_at: state === 'issued' ? new Date().toISOString() : null }).eq('id', item.id));
  const setModuleStatus = (r, status) => mutate('mod' + r.id, () => supabase.from('onboarding_module_progress').update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null, last_activity_at: new Date().toISOString() }).eq('id', r.id));
  const releaseToTraining = (h) => mutate('rel' + h.id, () => supabase.from('onboarding_hires').update({ stage: 'ready_for_training', released_to_training_at: new Date().toISOString(), released_by: profile?.full_name || 'unknown', updated_at: new Date().toISOString() }).eq('id', h.id));
  const bumpSupervised = (h, delta) => mutate('sup' + h.id, () => supabase.from('onboarding_hires').update({ supervised_visits_completed: Math.max(0, (h.supervised_visits_completed || 0) + delta), stage: 'supervised', updated_at: new Date().toISOString() }).eq('id', h.id));
  const setPreceptor = (h, name) => mutate('prec' + h.id, () => supabase.from('onboarding_hires').update({ preceptor_name: name || null, updated_at: new Date().toISOString() }).eq('id', h.id));
  const clearForCaseload = (h) => mutate('clr' + h.id, () => supabase.from('onboarding_hires').update({ cleared_for_caseload: true, cleared_at: new Date().toISOString(), cleared_by: profile?.full_name || 'unknown', stage: 'cleared', updated_at: new Date().toISOString() }).eq('id', h.id));
  const logContact = (h) => mutate('con' + h.id, async () => {
    const r1 = await supabase.from('onboarding_contacts').insert({ hire_id: h.id, method: 'logged', contacted_by: profile?.full_name || 'unknown', outcome: 'contacted' });
    if (r1.error) return r1;
    return supabase.from('onboarding_hires').update({ last_contact_at: new Date().toISOString(), contact_attempts: (h.contact_attempts || 0) + 1, updated_at: new Date().toISOString() }).eq('id', h.id);
  });
  const markPayroll = (r, state) => mutate('pay' + r.pay.id, () => supabase.from('onboarding_payroll_handoffs').update({ state, sent_at: state === 'sent' ? new Date().toISOString() : r.pay.sent_at, confirmed_at: state === 'confirmed' ? new Date().toISOString() : null, confirmed_by: state === 'confirmed' ? (profile?.full_name || 'unknown') : null, updated_at: new Date().toISOString() }).eq('id', r.pay.id));

  if (loading) {
    return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}><TopBar title="Onboarding and ramp" subtitle="Loading pipeline..." /><div style={{ padding: 40, color: 'var(--gray)' }}>Loading...</div></div>;
  }

  const q = search.trim().toLowerCase();
  const visible = rows.filter(r => !q || r.hire.full_name.toLowerCase().includes(q) || (r.hire.discipline || '').toLowerCase().includes(q) || (r.hire.region || '').toLowerCase().includes(q));

  const cohort = {
    total: rows.length,
    soon: rows.filter(r => { const d = daysUntil(r.hire.start_date); return d !== null && d >= 0 && d <= 7; }).length,
    blocked: rows.filter(r => r.pace.key === 'blocked').length,
    active: rows.filter(r => r.hire.cleared_for_caseload).length,
  };

  const sel = selected ? rowById(selected) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <TopBar
        title="Onboarding and ramp"
        subtitle="From offer letter to active staff"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, discipline, region"
              style={{ fontSize: 13, padding: '7px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--black)', width: 210 }} />
            <Btn kind="ghost" onClick={load}>Refresh</Btn>
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 60px', background: 'var(--bg)' }}>
        {err && <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid var(--danger)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'var(--danger)' }}>{err}</div>}

        {/* ── role lens: who is looking, and what they own ──────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)' }}>Viewing as</span>
          {ROLES.map(r => {
            const on = focus === r.key;
            return (
              <button key={r.key} onClick={() => setFocus(r.key)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, textAlign: 'left',
                padding: '7px 13px', borderRadius: 9, cursor: 'pointer',
                border: `1px solid ${on ? 'var(--ec-indigo)' : 'var(--border)'}`,
                background: on ? 'rgba(99,102,241,0.07)' : 'var(--card-bg)',
              }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: on ? 'var(--ec-indigo)' : 'var(--black)' }}>{r.person}</span>
                <span style={{ fontSize: 10.5, color: 'var(--gray)' }}>{r.role}</span>
              </button>
            );
          })}
          {activeRole.board && !canEdit(activeRole.board) && (
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--gray)', background: 'rgba(71,85,105,0.10)', padding: '5px 10px', borderRadius: 999 }}>
              You are viewing this lens, not signed in as them
            </span>
          )}
        </div>

        {/* ── cohort vitals ─────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 4 }}>
          <Kpi tone="accent" label="In the pipeline" value={cohort.total} foot={`${rows.filter(r => entersTraining(r.hire)).length} new hires · ${rows.filter(r => isStatusChange(r.hire)).length} status changes`} />
          <Kpi tone="warn" label="Starting within 7 days" value={cohort.soon} foot="Need docs and kit ready" />
          <Kpi tone="risk" label="Blocked" value={cohort.blocked} foot="Something is stopping them" />
          <Kpi tone="info" label="Active on caseload" value={cohort.active} foot="Reached the field" />
        </div>

        {/* ── your worklist ─────────────────────────────────────────────────── */}
        <SectionH>{focus === 'all' ? 'Everything blocked right now' : `${activeRole.person.split(' ')[0]} — what needs you`}</SectionH>
        <Card>
          {worklist.length === 0
            ? <div style={{ padding: '20px', textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>Nothing needs {focus === 'all' ? 'a decision' : activeRole.person.split(' ')[0]} right now.</div>
            : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
                {worklist.map((w, i) => (
                  <button key={i} onClick={() => setSelected(w.hireId)} style={{ textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 15px', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}>
                    <span style={{ width: 24, height: 24, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, marginTop: 1, background: w.tone === 'risk' ? 'rgba(220,38,38,0.12)' : 'rgba(217,119,6,0.14)', color: w.tone === 'risk' ? 'var(--danger)' : 'var(--yellow)' }}>{w.tone === 'risk' ? '!' : ' '}</span>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--black)' }}>{w.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--gray)', marginTop: 1, lineHeight: 1.45 }}>{w.what}</div>
                    </div>
                  </button>
                ))}
              </div>}
        </Card>

        {/* ── the journey board ─────────────────────────────────────────────── */}
        <SectionH>The journey {'—'} offer letter to active staff</SectionH>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${JOURNEY_COLUMNS.length}, minmax(190px, 1fr))`, gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
          {JOURNEY_COLUMNS.map(col => {
            const inCol = visible.filter(r => r.column === col.key);
            const owned = activeRole.owns.includes(col.key);
            const dim = focus !== 'all' && activeRole.owns.length > 0 && !owned;
            return (
              <div key={col.key} style={{ opacity: dim ? 0.5 : 1 }}>
                <div style={{ padding: '2px 4px 8px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>{col.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: owned ? 'var(--ec-indigo)' : 'var(--gray)' }}>{inCol.length}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--gray)', marginTop: 1 }}>{col.owner} {'·'} {col.hint}</div>
                  <div style={{ height: 3, borderRadius: 2, marginTop: 6, background: owned ? 'var(--ec-indigo)' : 'var(--border)' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 40 }}>
                  {inCol.map(r => <HireCard key={r.hire.id} r={r} onClick={() => setSelected(r.hire.id)} />)}
                  {inCol.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--light-gray)', padding: '10px 4px' }}>Empty</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {sel && (
        <DetailDrawer
          r={sel} modules={modules} focus={focus} canEdit={canEdit} saving={saving}
          onClose={() => setSelected(null)}
          toggleDoc={toggleDoc} setKitState={setKitState} setModuleStatus={setModuleStatus}
          release={releaseToTraining} bump={bumpSupervised} setPreceptor={setPreceptor}
          clear={clearForCaseload} logContact={logContact} markPayroll={markPayroll}
        />
      )}
    </div>
  );
}

// ── a person card on the board ───────────────────────────────────────────────
function HireCard({ r, onClick }) {
  const c = PACE_COLOR[r.pace.key] || PACE_COLOR.ok;
  let metric = null;
  if (r.column === 'offer') metric = <span style={{ fontSize: 11, color: 'var(--gray)' }}>Awaiting response</span>;
  else if (r.column === 'paperwork') metric = <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Bar pct={r.dp.total ? (r.dp.done / r.dp.total) * 100 : 0} tone={r.dp.complete ? 'ok' : 'warn'} /><span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)' }}>{r.dp.done}/{r.dp.total} docs</span></div>;
  else if (r.column === 'training') metric = <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Bar pct={r.mprog.pct} tone={r.mprog.idleDays >= 5 ? 'warn' : 'ok'} /><span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)' }}>{r.mprog.pct}%</span></div>;
  else if (r.column === 'field') metric = <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)' }}>{r.hire.supervised_visits_completed} of {r.hire.supervised_visits_target} supervised</span>;
  else if (r.column === 'active') metric = <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>Cleared {r.hire.cleared_at ? fmtDate(r.hire.cleared_at.slice(0, 10)) : ''}</span>;

  return (
    <button onClick={onClick} style={{ textAlign: 'left', background: 'var(--card-bg)', border: '1px solid var(--border)', borderLeft: `3px solid ${c.fg}`, borderRadius: 9, padding: '10px 11px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Avatar hire={r.hire} size={30} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--black)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.hire.full_name}</div>
          <div style={{ fontSize: 10.5, color: 'var(--gray)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[r.hire.discipline, r.hire.region && `Region ${r.hire.region}`].filter(Boolean).join(' · ') || 'Details TBD'}</div>
        </div>
      </div>
      {metric}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: isStatusChange(r.hire) ? 'var(--gray)' : 'var(--ec-indigo)' }}>{isStatusChange(r.hire) ? 'Status change' : 'New hire'}</span>
        {r.pace.key !== 'ok' && <span style={{ fontSize: 10.5, fontWeight: 700, color: c.fg }}>{r.pace.label}</span>}
      </div>
    </button>
  );
}

// ── the one-person slide-over ────────────────────────────────────────────────
function DetailDrawer(props) {
  const { r, modules, focus, canEdit, saving, onClose, toggleDoc, setKitState, setModuleStatus, release, bump, setPreceptor, clear, logContact, markPayroll } = props;
  const h = r.hire;
  const steps = stepsForHire(h);
  const idx = stepIndexForHire(h);
  const editHr = canEdit('hr'), editTr = canEdit('training'), editSup = canEdit('supply'), editPay = canEdit('payroll');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(520px, 100%)', height: '100%', background: 'var(--bg)', overflowY: 'auto', boxShadow: '-8px 0 32px rgba(15,23,42,0.18)' }}>
        {/* header */}
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--card-bg)', borderBottom: '1px solid var(--border)', padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <Avatar hire={h} size={42} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--black)' }}>{h.full_name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--gray)', marginTop: 1 }}>{[h.discipline, h.ls_level, h.region && `Region ${h.region}`].filter(Boolean).join(' · ') || 'Details not yet on file'}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <Tag tone={isStatusChange(h) ? 'gray' : 'violet'}>{isStatusChange(h) ? 'Status change' : 'New hire'}</Tag>
                <Tag tone="gray">{WORKER_CLASS_LABEL[h.worker_class]}</Tag>
                <Tag tone="blue">{DOC_SET_LABEL[h.document_set]}</Tag>
              </div>
            </div>
            <button onClick={onClose} title="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, color: 'var(--gray)', lineHeight: 1, padding: 4 }}>{'×'}</button>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12 }}>
            <span style={{ color: 'var(--gray)' }}>Start <b style={{ color: 'var(--black)' }}>{startLabel(h)}</b></span>
            <span style={{ color: 'var(--gray)' }}>Stage <b style={{ color: 'var(--black)' }}>{STAGE_LABEL[h.stage]}</b></span>
            <span style={{ color: 'var(--gray)' }}>Pace <b style={{ color: PACE_COLOR[r.pace.key].fg }}>{r.pace.label}</b></span>
          </div>
        </div>

        <div style={{ padding: '16px 20px 40px' }}>
          {/* journey stepper */}
          <Stepper steps={steps} idx={idx} />

          {/* Paperwork — Danielly */}
          <OwnerSection title="Paperwork" owner="Danielly, HR" locked={!editHr} highlight={focus === 'hr'}>
            {r.docs.map(d => {
              const due = daysUntil(d.due_date);
              return (
                <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', cursor: editHr ? 'pointer' : 'default' }}>
                  <input type="checkbox" checked={d.is_complete} disabled={!editHr || saving === 'doc' + d.id} onChange={() => toggleDoc(d)} style={{ width: 16, height: 16 }} />
                  <span style={{ flex: 1, fontSize: 13, color: d.is_complete ? 'var(--gray)' : 'var(--black)', textDecoration: d.is_complete ? 'line-through' : 'none' }}>{d.label}</span>
                  {d.due_date && !d.is_complete && <span style={{ fontSize: 11, fontWeight: 700, color: due !== null && due <= 1 ? 'var(--danger)' : 'var(--gray)' }}>due {fmtDate(d.due_date)}</span>}
                </label>
              );
            })}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12 }}>
              <span style={{ fontSize: 11.5, color: 'var(--gray)' }}>Last contact {r.hire.last_contact_at ? `${daysSince(r.hire.last_contact_at)}d ago` : 'never'} {'·'} {r.hire.contact_attempts || 0} attempts</span>
              <Btn kind="ghost" disabled={!editHr || saving === 'con' + h.id} onClick={() => logContact(h)}>Log a contact</Btn>
            </div>
            {!isStatusChange(h) && (
              <div style={{ marginTop: 12 }}>
                {r.dp.complete
                  ? <Btn full disabled={!editHr || saving === 'rel' + h.id || h.stage !== 'hr_docs'} onClick={() => release(h)}>{h.stage === 'hr_docs' ? 'Release to Uma for training' : 'Released to training'}</Btn>
                  : <div style={{ fontSize: 11.5, color: 'var(--gray)', textAlign: 'center', padding: '8px', borderRadius: 8, background: 'var(--bg)' }}>Release unlocks once all {r.dp.total} documents are complete.</div>}
              </div>
            )}
          </OwnerSection>

          {/* Training + Field — Uma. Hidden entirely for status changes. */}
          {entersTraining(h) && (
            <OwnerSection title="Training and field readiness" owner="Uma, Onboarding" locked={!editTr} highlight={focus === 'training'}>
              <div style={{ marginBottom: 12 }}>
                {r.mods.map(mp => {
                  const mod = modules.find(m => m.id === mp.module_id);
                  return (
                    <label key={mp.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', cursor: editTr ? 'pointer' : 'default' }}>
                      <input type="checkbox" checked={mp.status === 'completed'} disabled={!editTr || saving === 'mod' + mp.id} onChange={() => setModuleStatus(mp, mp.status === 'completed' ? 'not_started' : 'completed')} style={{ width: 15, height: 15 }} />
                      <span style={{ flex: 1, fontSize: 12.5, color: mp.status === 'completed' ? 'var(--gray)' : 'var(--black)' }}>{mod ? mod.title : 'Module'}</span>
                    </label>
                  );
                })}
              </div>
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 8 }}>Three gates to a full caseload</div>
                <Gate ok={r.gates.hr.ok} title="HR clearance" meta={r.gates.hr.label} />
                <Gate ok={r.gates.training.ok} title="Required modules" meta={r.gates.training.label} />
                <Gate ok={r.gates.supervised.ok} title="Supervised visits" meta={r.gates.supervised.label} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--gray)' }}>Preceptor: <b style={{ color: h.preceptor_name ? 'var(--black)' : 'var(--danger)' }}>{h.preceptor_name || 'not assigned'}</b></span>
                  {editTr && (
                    <div style={{ display: 'flex', gap: 5 }}>
                      <Btn kind="ghost" disabled={saving === 'sup' + h.id} onClick={() => bump(h, 1)}>+1 visit</Btn>
                      <Btn kind="ghost" disabled={saving === 'sup' + h.id} onClick={() => bump(h, -1)}>-1</Btn>
                    </div>
                  )}
                </div>
                <div style={{ marginTop: 10 }}>
                  {h.cleared_for_caseload
                    ? <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', textAlign: 'center', padding: 8 }}>Cleared for full caseload</div>
                    : <Btn full disabled={!editTr || !r.gates.ready || saving === 'clr' + h.id} onClick={() => clear(h)}>{r.gates.ready ? 'Clear for full caseload' : 'All three gates must pass first'}</Btn>}
                </div>
              </div>
            </OwnerSection>
          )}

          {/* Equipment — Earl. Read-context for HR/Onboarding/Payroll. */}
          <OwnerSection title="Equipment" owner="Earl, Supply Chain" locked={!editSup} highlight={focus === 'supply'}>
            {r.kit.map(i => (
              <div key={i.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 12.5, color: 'var(--black)' }}>{i.label}</span>
                {editSup
                  ? <select value={i.state} disabled={saving === 'kit' + i.id} onChange={e => setKitState(i, e.target.value)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--black)' }}>
                      {Object.entries(SUPPLY_STATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  : <span style={{ fontSize: 12, fontWeight: 600, color: i.state === 'issued' ? 'var(--green)' : i.state === 'not_raised' ? 'var(--danger)' : 'var(--yellow)' }}>{SUPPLY_STATE_LABEL[i.state]}</span>}
              </div>
            ))}
          </OwnerSection>

          {/* Payroll — Quinn */}
          {r.pay && (
            <OwnerSection title="Payroll handoff" owner="Quinn, Payroll" locked={!editPay} highlight={focus === 'payroll'}>
              <Row k="Document set" v={DOC_SET_LABEL[r.pay.document_set]} />
              <Row k="Documents complete" v={`${r.dp.done} of ${r.dp.total}`} tone={r.dp.complete ? null : 'bad'} />
              <Row k="State" v={{ not_ready: 'Not ready', ready: 'Ready to send', sent: 'Sent, awaiting setup', confirmed: 'Payroll confirmed', failed: 'Failed' }[r.pay.state]} />
              {r.pay.sent_at && <Row k="Sent" v={fmtDate(r.pay.sent_at.slice(0, 10))} />}
              <div style={{ marginTop: 12 }}>
                {r.pay.state === 'ready' && <Btn full disabled={!editPay || saving === 'pay' + r.pay.id} onClick={() => markPayroll(r, 'sent')}>Send to Quinn and mark sent</Btn>}
                {r.pay.state === 'sent' && <Btn full disabled={!editPay || saving === 'pay' + r.pay.id} onClick={() => markPayroll(r, 'confirmed')}>Confirm payroll is set up</Btn>}
                {r.pay.state === 'not_ready' && <div style={{ fontSize: 11.5, color: 'var(--gray)', textAlign: 'center', padding: 8, borderRadius: 8, background: 'var(--bg)' }}>Fires automatically once all {r.dp.total} documents are complete.</div>}
                {r.pay.state === 'confirmed' && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', textAlign: 'center', padding: 8 }}>Payroll is live</div>}
              </div>
            </OwnerSection>
          )}

          {h.notes && (
            <div style={{ marginTop: 16, padding: '11px 13px', borderRadius: 9, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)', fontSize: 12, lineHeight: 1.55, color: 'var(--black)' }}>
              <span style={{ fontWeight: 700 }}>Note: </span>{h.notes}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ steps, idx }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 20 }}>
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
  );
}

function OwnerSection({ title, owner, locked, highlight, children }) {
  return (
    <div style={{ marginTop: 16, borderRadius: 11, border: `1px solid ${highlight ? 'var(--ec-indigo)' : 'var(--border)'}`, background: 'var(--card-bg)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--border)', background: highlight ? 'rgba(99,102,241,0.05)' : 'var(--bg)' }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--black)' }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 1 }}>{owner} owns this</div>
        </div>
        {locked && <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)', background: 'rgba(71,85,105,0.10)', padding: '4px 9px', borderRadius: 999 }}>View only</span>}
      </div>
      <div style={{ padding: '12px 14px' }}>{children}</div>
    </div>
  );
}

function Gate({ ok, title, meta }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 19, height: 19, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1, background: ok ? 'var(--green)' : 'rgba(217,119,6,0.16)', color: ok ? '#fff' : 'var(--yellow)' }}>
        {ok ? <Check /> : <span style={{ fontSize: 11, fontWeight: 700 }}>!</span>}
      </span>
      <div>
        <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--black)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 1 }}>{meta}</div>
      </div>
    </div>
  );
}

// ── worklist: what THIS role needs to act on ─────────────────────────────────
function buildWorklist(focus, rows) {
  const out = [];
  const push = (r, what, tone) => out.push({ hireId: r.hire.id, name: r.hire.full_name, what, tone });

  const soon = (r) => { const d = daysUntil(r.hire.start_date); return d !== null && d >= 0 && d <= 7; };

  if (focus === 'all') {
    rows.filter(r => r.pace.key === 'blocked').forEach(r => push(r, `${r.pace.label} — ${r.pace.why}`, 'risk'));
    return out;
  }
  if (focus === 'hr') {
    rows.filter(r => r.hire.stage === 'offer_out').forEach(r => push(r, 'Offer unanswered — chase or close', 'warn'));
    rows.filter(r => r.hire.stage === 'hr_docs' && !r.dp.complete && soon(r)).forEach(r => push(r, `Starts ${startLabel(r.hire)} — ${r.dp.total - r.dp.done} documents outstanding`, 'risk'));
    rows.filter(r => hasNoStartDate(r.hire) && r.hire.stage === 'hr_docs').forEach(r => push(r, 'No start date — blocks kit, training and payroll', 'warn'));
    rows.filter(r => r.docs.some(d => d.is_required && !d.is_complete && d.due_date && daysUntil(d.due_date) !== null && daysUntil(d.due_date) <= 1)).forEach(r => push(r, 'A document deadline is within a day', 'risk'));
    rows.filter(r => entersTraining(r.hire) && r.hire.stage === 'hr_docs' && r.dp.complete).forEach(r => push(r, 'Cleared HR — ready to release to Uma', 'warn'));
    return out;
  }
  if (focus === 'training') {
    rows.filter(r => r.hire.stage === 'ready_for_training').forEach(r => push(r, 'Released from HR — assign modules and a preceptor', 'warn'));
    rows.filter(r => entersTraining(r.hire) && ['in_training', 'supervised'].includes(r.hire.stage) && !r.hire.preceptor_name).forEach(r => push(r, 'No preceptor — supervised visits cannot start', 'risk'));
    rows.filter(r => r.hire.stage === 'in_training' && r.mprog.idleDays !== null && r.mprog.idleDays >= 5).forEach(r => push(r, `Idle ${r.mprog.idleDays} days in training`, 'warn'));
    rows.filter(r => r.gates.ready && !r.hire.cleared_for_caseload).forEach(r => push(r, 'All three gates met — ready to clear for caseload', 'warn'));
    return out;
  }
  if (focus === 'payroll') {
    rows.filter(r => r.pay && r.pay.state === 'ready').forEach(r => push(r, 'Documents complete — ready to send to payroll', 'warn'));
    rows.filter(r => r.pay && r.pay.state === 'sent').forEach(r => push(r, 'Sent — confirm payroll setup', 'warn'));
    rows.filter(r => r.pay && r.pay.state === 'not_ready' && soon(r)).forEach(r => push(r, `Starts ${startLabel(r.hire)} — documents still open with HR`, 'risk'));
    return out;
  }
  if (focus === 'supply') {
    rows.filter(r => r.kp.issued === 0 && r.hire.stage !== 'offer_out' && (() => { const d = daysUntil(r.hire.start_date); return d !== null && d <= 0; })()).forEach(r => push(r, 'Already started with no kit issued', 'risk'));
    rows.filter(r => !r.kp.complete && soon(r)).forEach(r => push(r, `Starts ${startLabel(r.hire)} — ${r.kp.total - r.kp.issued} kit items outstanding`, 'warn'));
    return out;
  }
  return out;
}
