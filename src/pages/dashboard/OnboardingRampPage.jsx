import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import {
  BOARDS, STAGE_LABEL, DOC_SET_LABEL, WORKER_CLASS_LABEL, SUPPLY_STATE_LABEL,
  entersTraining, isStatusChange, daysSince, daysUntil, fmtDate, startLabel,
  hasNoStartDate, docProgress, kitProgress, moduleProgress, rampGates, paceOf,
  PACE_COLOR,
} from '../../lib/onboardingMath';

// ── small shared bits ───────────────────────────────────────────────────────
function Card({ children, style }) {
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}

function SectionH({ children, style }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray)', margin: '22px 2px 10px', ...style }}>
      {children}
    </div>
  );
}

function Kpi({ label, value, foot, tone }) {
  const top = tone === 'risk' ? 'var(--danger)' : tone === 'warn' ? 'var(--yellow)'
    : tone === 'accent' ? 'var(--ec-teal)' : tone === 'info' ? 'var(--blue)' : 'var(--border)';
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
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.fg, flexShrink: 0 }} />
      {children}
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
  return (
    <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 5, background: c.bg, color: c.fg }}>
      {children}
    </span>
  );
}

function Bar({ pct, tone }) {
  const fg = tone === 'risk' ? 'var(--danger)' : tone === 'warn' ? 'var(--yellow)' : 'var(--ec-teal)';
  return (
    <div style={{ flex: 1, height: 7, borderRadius: 999, background: 'var(--border)', overflow: 'hidden', minWidth: 40 }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: fg, borderRadius: 999 }} />
    </div>
  );
}

function Btn({ children, onClick, disabled, kind, title }) {
  const primary = kind !== 'ghost';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer',
        border: primary ? 'none' : '1px solid var(--border)',
        background: disabled ? 'var(--border)' : primary ? 'var(--ec-indigo)' : 'transparent',
        color: disabled ? 'var(--light-gray)' : primary ? '#fff' : 'var(--gray)',
        opacity: disabled ? 0.6 : 1, whiteSpace: 'nowrap',
      }}
    >{children}</button>
  );
}

function Person({ hire, sub }) {
  const initials = (hire.full_name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const clinical = entersTraining(hire);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <div style={{
        width: 33, height: 33, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color: clinical ? 'var(--black)' : 'var(--gray)',
        background: clinical ? 'var(--ec-light-teal)' : 'var(--border)',
      }}>{initials}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--black)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hire.full_name}</div>
        <div style={{ fontSize: 11, color: 'var(--gray)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub || [hire.discipline, hire.ls_level, hire.region && `Region ${hire.region}`].filter(Boolean).join(' · ') || 'Details not on file'}
        </div>
        <div style={{ marginTop: 3 }}>
          <Tag tone={isStatusChange(hire) ? 'gray' : 'violet'}>{isStatusChange(hire) ? 'Status change' : 'New hire'}</Tag>
        </div>
      </div>
    </div>
  );
}

const TH = { textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--gray)', padding: '11px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' };
const TD = { padding: '11px 12px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle', fontSize: 13, color: 'var(--black)' };

function Table({ cols, children }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>{cols.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        {children}
      </table>
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ padding: 32, textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>{children}</div>;
}

function ReadOnlyNote({ owner }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)', background: 'rgba(71,85,105,0.10)', padding: '4px 9px', borderRadius: 999 }}>
      View only {'—'} {owner} edits this board
    </span>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
export default function OnboardingRampPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [err, setErr] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const [hires, setHires] = useState([]);
  const [docs, setDocs] = useState([]);
  const [supplies, setSupplies] = useState([]);
  const [modules, setModules] = useState([]);
  const [progress, setProgress] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [owners, setOwners] = useState([]);

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
      const firstErr = [h, d, s, m, p, pr, o].find(r => r.error);
      if (firstErr) throw firstErr.error;
      setHires(h.data || []); setDocs(d.data || []); setSupplies(s.data || []);
      setModules(m.data || []); setProgress(p.data || []); setPayroll(pr.data || []);
      setOwners(o.data || []);
    } catch (e) {
      console.error('Onboarding load failed:', e);
      setErr(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Read-all / edit-own. The DB enforces this too — these flags only decide
  // whether a control is offered, never whether a write is allowed.
  const allAccess = ['super_admin', 'ceo'].includes(profile?.role);
  const myBoards = useMemo(() => {
    const mine = owners.filter(o => o.coordinator_id === profile?.id).map(o => o.board);
    return new Set(mine);
  }, [owners, profile]);
  const canEdit = useCallback((board) => allAccess || myBoards.has(board), [allAccess, myBoards]);

  const byHire = useCallback((rows, id) => rows.filter(r => r.hire_id === id), []);

  const rows = useMemo(() => hires.map(h => {
    const d = byHire(docs, h.id);
    const k = byHire(supplies, h.id);
    const mp = byHire(progress, h.id);
    const pay = payroll.find(p => p.hire_id === h.id) || null;
    return {
      hire: h, docs: d, kit: k, mods: mp, pay,
      dp: docProgress(d), kp: kitProgress(k), mprog: moduleProgress(mp),
      pace: paceOf(h, d, mp, k), gates: rampGates(h, d, mp),
    };
  }), [hires, docs, supplies, progress, payroll, byHire]);

  const inHr = rows.filter(r => ['offer_out', 'hr_docs'].includes(r.hire.stage));
  const inTraining = rows.filter(r => entersTraining(r.hire) && ['ready_for_training', 'in_training', 'supervised'].includes(r.hire.stage));
  const needKit = rows.filter(r => !r.kp.complete && r.hire.stage !== 'offer_out');

  // ── writes ────────────────────────────────────────────────────────────────
  async function mutate(key, fn) {
    setSaving(key); setErr(null);
    try {
      const { error } = await fn();
      if (error) throw error;
      await load();
    } catch (e) {
      console.error(e);
      setErr(e.message || 'Save failed');
    } finally { setSaving(null); }
  }

  const toggleDoc = (doc) => mutate('doc' + doc.id, () =>
    supabase.from('onboarding_documents').update({ is_complete: !doc.is_complete }).eq('id', doc.id));

  const setKitState = (item, state) => mutate('kit' + item.id, () =>
    supabase.from('onboarding_supplies').update({
      state,
      ordered_at: state === 'ordered' ? new Date().toISOString() : item.ordered_at,
      issued_at: state === 'issued' ? new Date().toISOString() : null,
    }).eq('id', item.id));

  const setModuleStatus = (row, status) => mutate('mod' + row.id, () =>
    supabase.from('onboarding_module_progress').update({
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
      last_activity_at: new Date().toISOString(),
    }).eq('id', row.id));

  const releaseToTraining = (hire) => mutate('rel' + hire.id, () =>
    supabase.from('onboarding_hires').update({
      stage: 'ready_for_training',
      released_to_training_at: new Date().toISOString(),
      released_by: profile?.full_name || 'unknown',
      updated_at: new Date().toISOString(),
    }).eq('id', hire.id));

  const bumpSupervised = (hire, delta) => mutate('sup' + hire.id, () =>
    supabase.from('onboarding_hires').update({
      supervised_visits_completed: Math.max(0, (hire.supervised_visits_completed || 0) + delta),
      stage: 'supervised',
      updated_at: new Date().toISOString(),
    }).eq('id', hire.id));

  const clearForCaseload = (hire) => mutate('clr' + hire.id, () =>
    supabase.from('onboarding_hires').update({
      cleared_for_caseload: true, cleared_at: new Date().toISOString(),
      cleared_by: profile?.full_name || 'unknown', stage: 'cleared',
      updated_at: new Date().toISOString(),
    }).eq('id', hire.id));

  const logContact = (hire) => mutate('con' + hire.id, async () => {
    const r1 = await supabase.from('onboarding_contacts').insert({
      hire_id: hire.id, method: 'logged', contacted_by: profile?.full_name || 'unknown', outcome: 'contacted',
    });
    if (r1.error) return r1;
    return supabase.from('onboarding_hires').update({
      last_contact_at: new Date().toISOString(),
      contact_attempts: (hire.contact_attempts || 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', hire.id);
  });

  const markPayroll = (row, state) => mutate('pay' + row.pay.id, () =>
    supabase.from('onboarding_payroll_handoffs').update({
      state,
      sent_at: state === 'sent' ? new Date().toISOString() : row.pay.sent_at,
      confirmed_at: state === 'confirmed' ? new Date().toISOString() : null,
      confirmed_by: state === 'confirmed' ? (profile?.full_name || 'unknown') : null,
      updated_at: new Date().toISOString(),
    }).eq('id', row.pay.id));

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <TopBar title="Onboarding and ramp" subtitle="Loading pipeline..." />
        <div style={{ padding: 40, color: 'var(--gray)' }}>Loading...</div>
      </div>
    );
  }

  const activeBoard = BOARDS.find(b => b.key === tab);
  const editable = activeBoard?.board ? canEdit(activeBoard.board) : allAccess;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <TopBar
        title="Onboarding and ramp"
        subtitle={`${hires.length} in the pipeline · ${hires.filter(h => h.hire_type === 'new_hire').length} new hires, ${hires.filter(h => h.hire_type === 'status_change').length} status changes`}
        actions={<Btn kind="ghost" onClick={load}>Refresh</Btn>}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 28px 60px', background: 'var(--bg)' }}>
        {err && (
          <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid var(--danger)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'var(--danger)' }}>
            {err}
          </div>
        )}

        {/* board nav */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8, marginBottom: 18 }}>
          {BOARDS.map(b => {
            const on = tab === b.key;
            const mine = b.board ? canEdit(b.board) : allAccess;
            return (
              <button key={b.key} onClick={() => { setTab(b.key); setExpanded(null); }}
                style={{
                  textAlign: 'left', background: on ? 'rgba(99,102,241,0.06)' : 'var(--card-bg)',
                  border: '1px solid var(--border)', borderTop: `3px solid ${on ? 'var(--ec-indigo)' : 'var(--border)'}`,
                  borderRadius: 10, padding: '10px 12px', cursor: 'pointer',
                }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>
                  {b.label}
                  {!mine && <span style={{ float: 'right', fontSize: 10, color: 'var(--light-gray)', fontWeight: 600 }}>view only</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>{b.owner} {'·'} {b.role}</div>
              </button>
            );
          })}
        </div>

        {/* owner bar */}
        {activeBoard && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap',
            background: 'var(--card-bg)', border: '1px solid var(--border)', borderLeft: `3px solid ${editable ? 'var(--ec-indigo)' : 'var(--gray)'}`,
            borderRadius: '0 10px 10px 0', padding: '11px 15px', marginBottom: 16,
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)' }}>{activeBoard.owner}</div>
              <div style={{ fontSize: 12, color: 'var(--gray)' }}>{activeBoard.role}</div>
            </div>
            {!editable && <ReadOnlyNote owner={activeBoard.owner} />}
          </div>
        )}

        {tab === 'overview'  && <Overview rows={rows} />}
        {tab === 'hr'        && <HrBoard rows={inHr} all={rows} editable={editable} saving={saving}
                                         expanded={expanded} setExpanded={setExpanded}
                                         toggleDoc={toggleDoc} release={releaseToTraining} logContact={logContact} />}
        {tab === 'training'  && <TrainingBoard rows={inTraining} modules={modules} editable={editable} saving={saving}
                                         expanded={expanded} setExpanded={setExpanded}
                                         setModuleStatus={setModuleStatus} bump={bumpSupervised} clear={clearForCaseload} />}
        {tab === 'supply'    && <SupplyBoard rows={needKit} all={rows} editable={editable} saving={saving}
                                         expanded={expanded} setExpanded={setExpanded} setKitState={setKitState} />}
        {tab === 'payroll'   && <PayrollBoard rows={rows} editable={editable} saving={saving} markPayroll={markPayroll} />}
      </div>
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
function Overview({ rows }) {
  const noStart = rows.filter(r => hasNoStartDate(r.hire) && r.hire.stage !== 'offer_out');
  const startingSoon = rows.filter(r => {
    const d = daysUntil(r.hire.start_date);
    return d !== null && d >= 0 && d <= 7 && !r.dp.complete;
  });
  const working = rows.filter(r => {
    const d = daysUntil(r.hire.start_date);
    return d !== null && d <= 0 && r.kp.issued === 0;
  });
  const cleared = rows.filter(r => r.hire.cleared_for_caseload);
  const blocked = rows.filter(r => r.pace.key === 'blocked');

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <Kpi tone="accent" label="In pipeline" value={rows.length}
             foot={`${rows.filter(r => entersTraining(r.hire)).length} new hires · ${rows.filter(r => isStatusChange(r.hire)).length} status changes`} />
        <Kpi tone="risk" label="Start inside 7 days, docs open" value={startingSoon.length}
             foot={startingSoon.map(r => r.hire.full_name.split(' ')[0]).join(', ') || 'None'} />
        <Kpi tone="risk" label="No start date" value={noStart.length} foot="Blocks kit, training and payroll" />
        <Kpi tone="risk" label="Working with no kit" value={working.length}
             foot={working.map(r => r.hire.full_name.split(' ')[0]).join(', ') || 'None'} />
        <Kpi tone="info" label="Cleared to full caseload" value={cleared.length} foot="Carrying their own patients" />
      </div>

      <SectionH>Blocked across every board</SectionH>
      <Card>
        {blocked.length === 0 ? <Empty>Nothing blocked right now.</Empty> : (
          <div>
            {blocked.map(r => (
              <div key={r.hire.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 15px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ width: 24, height: 24, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, background: 'rgba(220,38,38,0.12)', color: 'var(--danger)' }}>!</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--black)' }}>{r.hire.full_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>
                    {r.pace.label} {'—'} {r.pace.why}
                    {r.hire.start_date && ` · starts ${fmtDate(r.hire.start_date)}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <SectionH>Everyone in the pipeline</SectionH>
      <Card>
        <Table cols={['26%', '13%', '12%', '16%', '17%', 'auto']}>
          <thead><tr>
            <th style={TH}>Name</th><th style={TH}>Start</th><th style={TH}>Class</th>
            <th style={TH}>Stage</th><th style={TH}>Status</th><th style={TH}>Documents</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.hire.id}>
                <td style={TD}><Person hire={r.hire} /></td>
                <td style={TD}>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{startLabel(r.hire)}</div>
                  {r.hire.start_date_note && <div style={{ fontSize: 10.5, color: 'var(--gray)', marginTop: 2 }}>{r.hire.start_date_note}</div>}
                </td>
                <td style={TD}><span style={{ fontSize: 12, color: 'var(--gray)' }}>{WORKER_CLASS_LABEL[r.hire.worker_class]}</span></td>
                <td style={TD}><Tag tone={isStatusChange(r.hire) ? 'gray' : 'blue'}>{STAGE_LABEL[r.hire.stage]}</Tag></td>
                <td style={TD}>
                  <Pill tone={r.pace.key}>{r.pace.label}</Pill>
                  <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 3 }}>{r.pace.why}</div>
                </td>
                <td style={TD}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Bar pct={r.dp.total ? (r.dp.done / r.dp.total) * 100 : 0} tone={r.dp.complete ? 'ok' : 'warn'} />
                    <span style={{ fontSize: 11.5, fontWeight: 600, minWidth: 34, textAlign: 'right' }}>{r.dp.done}/{r.dp.total}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--gray)', marginTop: 3 }}>{DOC_SET_LABEL[r.hire.document_set]}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}

// ── HR board (Danielly) ─────────────────────────────────────────────────────
function HrBoard({ rows, all, editable, saving, expanded, setExpanded, toggleDoc, release, logContact }) {
  const noStart = rows.filter(r => hasNoStartDate(r.hire) && r.hire.stage !== 'offer_out');
  const offers = rows.filter(r => r.hire.stage === 'offer_out');
  const readyToRelease = rows.filter(r => r.dp.complete && entersTraining(r.hire));
  const soon = rows.filter(r => { const d = daysUntil(r.hire.start_date); return d !== null && d >= 0 && d <= 7; });

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <Kpi tone="info" label="In HR now" value={rows.length} foot="Not yet released" />
        <Kpi tone="risk" label="Start inside 7 days" value={soon.length} foot="Documents must land first" />
        <Kpi tone="risk" label="No start date" value={noStart.length} foot="Cannot plan or provision" />
        <Kpi tone="warn" label="Offers unanswered" value={offers.length} foot="Chase or close out" />
        <Kpi tone="accent" label="Ready to release" value={readyToRelease.length} foot="Hand to Uma" />
      </div>

      <SectionH>Hires held by HR</SectionH>
      <Card>
        {rows.length === 0 ? <Empty>Nobody is currently in HR.</Empty> : (
          <Table cols={['26%', '12%', '11%', '20%', '16%', 'auto']}>
            <thead><tr>
              <th style={TH}>Name</th><th style={TH}>Start</th><th style={TH}>Set</th>
              <th style={TH}>Documents</th><th style={TH}>Last contact</th><th style={TH}>Release</th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const gap = daysSince(r.hire.last_contact_at);
                const open = expanded === r.hire.id;
                return [
                  <tr key={r.hire.id} onClick={() => setExpanded(open ? null : r.hire.id)} style={{ cursor: 'pointer', background: open ? 'rgba(6,182,212,0.05)' : 'transparent' }}>
                    <td style={TD}><Person hire={r.hire} /></td>
                    <td style={TD}>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{startLabel(r.hire)}</div>
                      {!r.hire.start_date_confirmed && r.hire.start_date && <div style={{ fontSize: 10.5, color: 'var(--yellow)', marginTop: 2 }}>Tentative</div>}
                    </td>
                    <td style={TD}><span style={{ fontSize: 11.5, color: 'var(--gray)' }}>{DOC_SET_LABEL[r.hire.document_set]}</span></td>
                    <td style={TD}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Bar pct={r.dp.total ? (r.dp.done / r.dp.total) * 100 : 0} tone={r.dp.complete ? 'ok' : 'warn'} />
                        <span style={{ fontSize: 11.5, fontWeight: 600, minWidth: 34, textAlign: 'right' }}>{r.dp.done}/{r.dp.total}</span>
                      </div>
                    </td>
                    <td style={TD}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: gap === null ? 'var(--danger)' : gap >= 4 ? 'var(--yellow)' : 'var(--black)' }}>
                        {gap === null ? 'Never' : gap === 0 ? 'Today' : `${gap}d ago`}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--gray)' }}>{r.hire.contact_attempts || 0} attempts</div>
                    </td>
                    <td style={TD}>
                      {isStatusChange(r.hire)
                        ? <Tag tone="gray">To Earl, not Uma</Tag>
                        : r.dp.complete
                          ? <Btn disabled={!editable || saving === 'rel' + r.hire.id} onClick={(e) => { e.stopPropagation(); release(r.hire); }}>Release to Uma</Btn>
                          : <span style={{ fontSize: 11.5, color: 'var(--gray)' }}>Blocked {'—'} docs open</span>}
                    </td>
                  </tr>,
                  open && (
                    <tr key={r.hire.id + '-d'}>
                      <td style={{ padding: 0, background: 'rgba(6,182,212,0.04)' }} colSpan={6}>
                        <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 13 }}>
                          <Card style={{ borderRadius: 10 }}>
                            <div style={{ padding: '12px 14px' }}>
                              <SectionH style={{ margin: '0 0 10px' }}>Documents {'—'} {DOC_SET_LABEL[r.hire.document_set]}</SectionH>
                              {r.docs.map(d => {
                                const due = daysUntil(d.due_date);
                                return (
                                  <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', borderBottom: '1px solid var(--border)', cursor: editable ? 'pointer' : 'default' }}>
                                    <input type="checkbox" checked={d.is_complete} disabled={!editable || saving === 'doc' + d.id}
                                           onChange={() => toggleDoc(d)} style={{ width: 15, height: 15, cursor: editable ? 'pointer' : 'default' }} />
                                    <span style={{ flex: 1, fontSize: 12.5, color: d.is_complete ? 'var(--gray)' : 'var(--black)', textDecoration: d.is_complete ? 'line-through' : 'none' }}>{d.label}</span>
                                    {d.due_date && !d.is_complete && (
                                      <span style={{ fontSize: 10.5, fontWeight: 700, color: due !== null && due <= 1 ? 'var(--danger)' : 'var(--gray)' }}>
                                        due {fmtDate(d.due_date)}
                                      </span>
                                    )}
                                  </label>
                                );
                              })}
                              <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--gray)' }}>
                                Payroll handoff fires to Quinn once all {r.dp.total} are complete.
                              </div>
                            </div>
                          </Card>
                          <Card style={{ borderRadius: 10 }}>
                            <div style={{ padding: '12px 14px' }}>
                              <SectionH style={{ margin: '0 0 10px' }}>Contact and assignment</SectionH>
                              <Row k="Discipline" v={r.hire.discipline || 'Not on file'} />
                              <Row k="Ladder level" v={r.hire.ls_level || 'Not assigned'} />
                              <Row k="Region" v={r.hire.region || 'Not on file'} />
                              <Row k="Worker class" v={WORKER_CLASS_LABEL[r.hire.worker_class]} />
                              <Row k="Hiring source" v={r.hire.hiring_source || '—'} />
                              <Row k="Attempts" v={String(r.hire.contact_attempts || 0)} />
                              {r.hire.area && <div style={{ marginTop: 9, fontSize: 11.5, color: 'var(--gray)', lineHeight: 1.5 }}>Area: {r.hire.area}</div>}
                              {r.hire.notes && <div style={{ marginTop: 9, padding: '9px 11px', borderRadius: 8, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)', fontSize: 11.5, lineHeight: 1.5, color: 'var(--black)' }}>{r.hire.notes}</div>}
                              <div style={{ marginTop: 10 }}>
                                <Btn kind="ghost" disabled={!editable || saving === 'con' + r.hire.id} onClick={(e) => { e.stopPropagation(); logContact(r.hire); }}>Log a contact</Btn>
                              </div>
                            </div>
                          </Card>
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

function Row({ k, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
      <span style={{ color: 'var(--gray)' }}>{k}</span>
      <span style={{ fontWeight: 600, color: 'var(--black)', textAlign: 'right' }}>{v}</span>
    </div>
  );
}

// ── Training board (Uma) ────────────────────────────────────────────────────
function TrainingBoard({ rows, modules, editable, saving, expanded, setExpanded, setModuleStatus, bump, clear }) {
  const idle = rows.filter(r => r.mprog.idleDays !== null && r.mprog.idleDays >= 5);
  const noPreceptor = rows.filter(r => !r.hire.preceptor_name);
  const readyToClear = rows.filter(r => r.gates.ready && !r.hire.cleared_for_caseload);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <Kpi tone="accent" label="In training" value={rows.filter(r => r.hire.stage === 'in_training').length} foot="Released from HR" />
        <Kpi tone="info" label="Ready to start" value={rows.filter(r => r.hire.stage === 'ready_for_training').length} foot="Assign modules" />
        <Kpi tone="warn" label="Idle 5+ days" value={idle.length} foot="No recorded activity" />
        <Kpi tone="risk" label="No preceptor" value={noPreceptor.length} foot="Blocks supervised visits" />
        <Kpi tone="accent" label="Ready to clear" value={readyToClear.length} foot="All three gates met" />
      </div>

      <SectionH>Hires released to training</SectionH>
      <Card>
        {rows.length === 0 ? <Empty>Nobody has been released from HR yet. Status changes never appear here.</Empty> : (
          <Table cols={['26%', '13%', '19%', '15%', '15%', 'auto']}>
            <thead><tr>
              <th style={TH}>New hire</th><th style={TH}>Released</th><th style={TH}>Training</th>
              <th style={TH}>Supervised</th><th style={TH}>Full caseload</th><th style={TH}>Preceptor</th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const open = expanded === r.hire.id;
                return [
                  <tr key={r.hire.id} onClick={() => setExpanded(open ? null : r.hire.id)} style={{ cursor: 'pointer', background: open ? 'rgba(6,182,212,0.05)' : 'transparent' }}>
                    <td style={TD}><Person hire={r.hire} /></td>
                    <td style={TD}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{r.hire.released_to_training_at ? fmtDate(r.hire.released_to_training_at.slice(0, 10)) : 'Pending'}</div>
                      {r.hire.released_by && <div style={{ fontSize: 10.5, color: 'var(--gray)' }}>by {r.hire.released_by}</div>}
                    </td>
                    <td style={TD}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Bar pct={r.mprog.pct} tone={r.mprog.idleDays >= 5 ? 'warn' : 'ok'} />
                        <span style={{ fontSize: 11.5, fontWeight: 600, minWidth: 34, textAlign: 'right' }}>{r.mprog.pct}%</span>
                      </div>
                      <div style={{ fontSize: 10.5, color: r.mprog.idleDays >= 5 ? 'var(--danger)' : 'var(--gray)', marginTop: 3 }}>
                        {r.mprog.done} / {r.mprog.total} modules
                        {r.mprog.idleDays !== null && ` · idle ${r.mprog.idleDays}d`}
                      </div>
                    </td>
                    <td style={TD}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{r.hire.supervised_visits_completed} of {r.hire.supervised_visits_target}</div>
                      {editable && (
                        <div style={{ display: 'flex', gap: 5, marginTop: 4 }} onClick={e => e.stopPropagation()}>
                          <Btn kind="ghost" disabled={saving === 'sup' + r.hire.id} onClick={() => bump(r.hire, 1)}>+1</Btn>
                          <Btn kind="ghost" disabled={saving === 'sup' + r.hire.id} onClick={() => bump(r.hire, -1)}>-1</Btn>
                        </div>
                      )}
                    </td>
                    <td style={TD}>
                      {r.hire.cleared_for_caseload
                        ? <Pill tone="ok">Cleared</Pill>
                        : r.gates.ready
                          ? <Btn disabled={!editable || saving === 'clr' + r.hire.id} onClick={(e) => { e.stopPropagation(); clear(r.hire); }}>Clear now</Btn>
                          : <Pill tone="blocked">Not ready</Pill>}
                    </td>
                    <td style={TD}><span style={{ fontSize: 12, color: r.hire.preceptor_name ? 'var(--black)' : 'var(--danger)' }}>{r.hire.preceptor_name || 'Not assigned'}</span></td>
                  </tr>,
                  open && (
                    <tr key={r.hire.id + '-d'}>
                      <td style={{ padding: 0, background: 'rgba(6,182,212,0.04)' }} colSpan={6}>
                        <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 13 }}>
                          <Card style={{ borderRadius: 10 }}>
                            <div style={{ padding: '12px 14px' }}>
                              <SectionH style={{ margin: '0 0 10px' }}>Modules</SectionH>
                              {r.mods.map(mp => {
                                const mod = modules.find(m => m.id === mp.module_id);
                                return (
                                  <label key={mp.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', borderBottom: '1px solid var(--border)', cursor: editable ? 'pointer' : 'default' }}>
                                    <input type="checkbox" checked={mp.status === 'completed'} disabled={!editable || saving === 'mod' + mp.id}
                                           onChange={() => setModuleStatus(mp, mp.status === 'completed' ? 'not_started' : 'completed')}
                                           style={{ width: 15, height: 15 }} />
                                    <span style={{ flex: 1, fontSize: 12.5, color: mp.status === 'completed' ? 'var(--gray)' : 'var(--black)' }}>
                                      {mod ? mod.title : 'Module'}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </Card>
                          <Card style={{ borderRadius: 10 }}>
                            <div style={{ padding: '12px 14px' }}>
                              <SectionH style={{ margin: '0 0 10px' }}>Ramp readiness {'—'} three gates</SectionH>
                              <Gate ok={r.gates.hr.ok} title="HR clearance" meta={r.gates.hr.label} />
                              <Gate ok={r.gates.training.ok} title="Required modules" meta={r.gates.training.label} />
                              <Gate ok={r.gates.supervised.ok} title="Supervised visits" meta={r.gates.supervised.label} />
                              <div style={{ marginTop: 10, padding: '9px 11px', borderRadius: 8, background: r.gates.ready ? 'rgba(5,150,105,0.09)' : 'rgba(217,119,6,0.09)', border: `1px solid ${r.gates.ready ? 'rgba(5,150,105,0.25)' : 'rgba(217,119,6,0.25)'}`, fontSize: 11.5, lineHeight: 1.5 }}>
                                {r.gates.ready
                                  ? 'All three gates met. Clearing hands this clinician a full caseload.'
                                  : 'Every gate must clear before a full caseload. The short one is named above.'}
                              </div>
                            </div>
                          </Card>
                          <Card style={{ borderRadius: 10 }}>
                            <div style={{ padding: '12px 14px' }}>
                              <SectionH style={{ margin: '0 0 10px' }}>Field kit {'—'} from Earl</SectionH>
                              {r.kit.map(i => (
                                <Row key={i.id} k={i.label} v={SUPPLY_STATE_LABEL[i.state]} />
                              ))}
                              {r.kp.issued === 0 && (
                                <div style={{ marginTop: 9, padding: '9px 11px', borderRadius: 8, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', fontSize: 11.5, lineHeight: 1.5, color: 'var(--black)' }}>
                                  Nothing issued yet. Supervised visits cannot start without a kit.
                                </div>
                              )}
                            </div>
                          </Card>
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

function Gate({ ok, title, meta }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{
        width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, marginTop: 1,
        background: ok ? 'rgba(5,150,105,0.15)' : 'rgba(217,119,6,0.15)', color: ok ? 'var(--green)' : 'var(--yellow)',
      }}>{ok ? 'Y' : '!'}</span>
      <div>
        <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--black)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 1 }}>{meta}</div>
      </div>
    </div>
  );
}

// ── Supplies board (Earl) ───────────────────────────────────────────────────
function SupplyBoard({ rows, editable, saving, expanded, setExpanded, setKitState }) {
  const working = rows.filter(r => { const d = daysUntil(r.hire.start_date); return d !== null && d <= 0 && r.kp.issued === 0; });
  const soon = rows.filter(r => { const d = daysUntil(r.hire.start_date); return d !== null && d > 0 && d <= 7; });
  const topUps = rows.filter(r => isStatusChange(r.hire));
  const blocked = rows.filter(r => hasNoStartDate(r.hire));

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <Kpi tone="risk" label="Already working, no kit" value={working.length} foot="Cannot treat a patient" />
        <Kpi tone="risk" label="Needed inside 7 days" value={soon.length} foot="Order now" />
        <Kpi tone="info" label="Status-change top-ups" value={topUps.length} foot="iPad and field supplies" />
        <Kpi tone="warn" label="Blocked on a start date" value={blocked.length} foot="No ship date can be set" />
      </div>

      <SectionH>Kits outstanding</SectionH>
      <Card>
        {rows.length === 0 ? <Empty>Every kit is issued.</Empty> : (
          <Table cols={['26%', '13%', '12%', '18%', 'auto']}>
            <thead><tr>
              <th style={TH}>Name</th><th style={TH}>Needed by</th><th style={TH}>Kit</th>
              <th style={TH}>Progress</th><th style={TH}>Outstanding</th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const open = expanded === r.hire.id;
                const missing = r.kit.filter(i => i.state === 'not_raised').map(i => i.label);
                return [
                  <tr key={r.hire.id} onClick={() => setExpanded(open ? null : r.hire.id)} style={{ cursor: 'pointer', background: open ? 'rgba(6,182,212,0.05)' : 'transparent' }}>
                    <td style={TD}><Person hire={r.hire} sub={[r.hire.discipline, WORKER_CLASS_LABEL[r.hire.worker_class]].filter(Boolean).join(' · ')} /></td>
                    <td style={TD}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{startLabel(r.hire)}</div>
                      {(() => { const d = daysUntil(r.hire.start_date); return d !== null && d <= 0 ? <div style={{ fontSize: 10.5, color: 'var(--danger)' }}>already started</div> : null; })()}
                    </td>
                    <td style={TD}><Tag tone={isStatusChange(r.hire) ? 'gray' : 'violet'}>{isStatusChange(r.hire) ? 'Top-up' : 'Full kit'}</Tag></td>
                    <td style={TD}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Bar pct={r.kp.total ? (r.kp.issued / r.kp.total) * 100 : 0} tone={r.kp.issued === 0 ? 'risk' : 'ok'} />
                        <span style={{ fontSize: 11.5, fontWeight: 600, minWidth: 38, textAlign: 'right' }}>{r.kp.issued}/{r.kp.total}</span>
                      </div>
                    </td>
                    <td style={TD}><span style={{ fontSize: 11.5, color: missing.length ? 'var(--danger)' : 'var(--gray)' }}>{missing.length ? `${missing.length} not raised` : 'All raised'}</span></td>
                  </tr>,
                  open && (
                    <tr key={r.hire.id + '-d'}>
                      <td style={{ padding: 0, background: 'rgba(6,182,212,0.04)' }} colSpan={5}>
                        <div style={{ padding: '14px 16px' }}>
                          <Card style={{ borderRadius: 10 }}>
                            <div style={{ padding: '12px 14px' }}>
                              <SectionH style={{ margin: '0 0 10px' }}>{isStatusChange(r.hire) ? 'Top-up kit' : 'Full field kit'}</SectionH>
                              {r.kit.map(i => (
                                <div key={i.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                                  <span style={{ fontSize: 12.5, color: 'var(--black)' }}>{i.label}</span>
                                  <select value={i.state} disabled={!editable || saving === 'kit' + i.id}
                                          onClick={e => e.stopPropagation()}
                                          onChange={e => setKitState(i, e.target.value)}
                                          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--black)' }}>
                                    {Object.entries(SUPPLY_STATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                  </select>
                                </div>
                              ))}
                              <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--gray)', lineHeight: 1.5 }}>
                                Contractors are equipped the same as employees {'—'} 1099 changes what paperwork they file, never what kit they receive.
                              </div>
                            </div>
                          </Card>
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

// ── Payroll board (Quinn) ───────────────────────────────────────────────────
function PayrollBoard({ rows, editable, saving, markPayroll }) {
  const withPay = rows.filter(r => r.pay);
  const ready = withPay.filter(r => r.pay.state === 'ready');
  const sent = withPay.filter(r => r.pay.state === 'sent');
  const confirmed = withPay.filter(r => r.pay.state === 'confirmed');
  const blocked = withPay.filter(r => r.pay.state === 'not_ready');

  const STATE_TONE = { not_ready: 'blocked', ready: 'behind', sent: 'behind', confirmed: 'ok' };
  const STATE_LABEL = { not_ready: 'Not ready', ready: 'Ready to send', sent: 'Sent, awaiting setup', confirmed: 'Payroll confirmed' };

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <Kpi tone="accent" label="Ready to send" value={ready.length} foot="All documents complete" />
        <Kpi tone="info" label="Sent, awaiting setup" value={sent.length} foot="With Quinn" />
        <Kpi tone="warn" label="Blocked on documents" value={blocked.length} foot="Held with HR" />
        <Kpi tone="accent" label="Confirmed" value={confirmed.length} foot="Payroll live" />
      </div>

      <SectionH>Handoff queue {'—'} fires when the document set completes</SectionH>
      <Card>
        <Table cols={['26%', '14%', '16%', '20%', 'auto']}>
          <thead><tr>
            <th style={TH}>Name</th><th style={TH}>Start</th><th style={TH}>Document set</th>
            <th style={TH}>State</th><th style={TH}>Action</th>
          </tr></thead>
          <tbody>
            {withPay.map(r => (
              <tr key={r.hire.id}>
                <td style={TD}><Person hire={r.hire} /></td>
                <td style={TD}><span style={{ fontSize: 12, fontWeight: 600 }}>{startLabel(r.hire)}</span></td>
                <td style={TD}>
                  <div style={{ fontSize: 12 }}>{DOC_SET_LABEL[r.pay.document_set]}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--gray)', marginTop: 2 }}>{r.dp.done} of {r.dp.total} complete</div>
                </td>
                <td style={TD}>
                  <Pill tone={STATE_TONE[r.pay.state]}>{STATE_LABEL[r.pay.state]}</Pill>
                  {r.pay.sent_at && <div style={{ fontSize: 10.5, color: 'var(--gray)', marginTop: 3 }}>sent {fmtDate(r.pay.sent_at.slice(0, 10))}</div>}
                </td>
                <td style={TD}>
                  {r.pay.state === 'ready' && <Btn disabled={!editable || saving === 'pay' + r.pay.id} onClick={() => markPayroll(r, 'sent')}>Mark sent</Btn>}
                  {r.pay.state === 'sent' && <Btn disabled={!editable || saving === 'pay' + r.pay.id} onClick={() => markPayroll(r, 'confirmed')}>Confirm setup</Btn>}
                  {r.pay.state === 'not_ready' && <span style={{ fontSize: 11.5, color: 'var(--gray)' }}>Waiting on HR</span>}
                  {r.pay.state === 'confirmed' && <span style={{ fontSize: 11.5, color: 'var(--green)' }}>Complete</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <SectionH>Three document sets, three triggers</SectionH>
      <Card>
        <div style={{ padding: '14px 16px' }}>
          <Row k="W-2 employee (full time and part time)" v="6 documents" />
          <Row k="Offer, I-9, W-4, direct deposit, background, policies" v={`${rows.filter(r => r.hire.document_set === 'w2').length} people`} />
          <Row k="1099 PRN contractor" v="4 documents" />
          <Row k="Agreement, W-9, licence and insurance, policies" v={`${rows.filter(r => r.hire.document_set === 'contractor_1099').length} people`} />
          <Row k="Status change" v="3 documents" />
          <Row k="Status letter, pay change, benefits election" v={`${rows.filter(r => r.hire.document_set === 'status_change').length} people`} />
          <div style={{ marginTop: 11, padding: '10px 12px', borderRadius: 8, background: 'rgba(217,119,6,0.09)', border: '1px solid rgba(217,119,6,0.25)', fontSize: 11.5, lineHeight: 1.55, color: 'var(--black)' }}>
            Contractors never file a W-4 or an I-9, and status changes file neither {'—'} the record already exists, so only rate and benefits move. Running any of them through the employee checklist would request documents that must not be collected.
          </div>
        </div>
      </Card>
    </>
  );
}
