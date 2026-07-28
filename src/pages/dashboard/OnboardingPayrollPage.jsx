import { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { DOC_SET_LABEL, WORKER_CLASS_LABEL, isStatusChange, entersTraining, fmtDate, startLabel, docProgress } from '../../lib/onboardingMath';

// Quinn's dedicated payroll page. Same data as the onboarding board's payroll
// lane, but on its own so Payroll lands straight on the handoff queue.

const PAY_STATE = {
  not_ready:  { label: 'Not ready',            fg: 'var(--gray)',   bg: 'rgba(71,85,105,0.10)' },
  ready:      { label: 'Ready to send',        fg: 'var(--yellow)', bg: 'rgba(217,119,6,0.12)' },
  sent:       { label: 'Sent, awaiting setup', fg: 'var(--blue)',   bg: 'rgba(14,165,233,0.12)' },
  confirmed:  { label: 'Payroll confirmed',    fg: 'var(--green)',  bg: 'rgba(5,150,105,0.11)' },
  failed:     { label: 'Failed',               fg: 'var(--danger)', bg: 'rgba(220,38,38,0.10)' },
};

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
      <div style={{ fontSize: 29, fontWeight: 700, color: 'var(--black)', marginTop: 4, letterSpacing: '-0.5px', lineHeight: 1.05 }}>{value}</div>
      {foot && <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>{foot}</div>}
    </div>
  );
}
function SectionH({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray)', margin: '24px 2px 10px' }}>{children}</div>;
}
function Btn({ children, onClick, disabled, kind }) {
  const primary = kind !== 'ghost';
  return <button onClick={onClick} disabled={disabled} style={{ fontSize: 12, fontWeight: 600, padding: '7px 13px', borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer', border: primary ? 'none' : '1px solid var(--border)', background: disabled ? 'var(--border)' : primary ? 'var(--ec-indigo)' : 'transparent', color: disabled ? 'var(--light-gray)' : primary ? '#fff' : 'var(--gray)', opacity: disabled ? 0.7 : 1, whiteSpace: 'nowrap' }}>{children}</button>;
}
const TH = { textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--gray)', padding: '11px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' };
const TD = { padding: '11px 12px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle', fontSize: 13, color: 'var(--black)' };

export default function OnboardingPayrollPage() {
  const { profile } = useAuth();
  const allAccess = ['super_admin', 'ceo'].includes(profile?.role);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [err, setErr] = useState(null);
  const [hires, setHires] = useState([]);
  const [docs, setDocs] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [owners, setOwners] = useState([]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [h, d, pr, o] = await Promise.all([
        supabase.from('onboarding_hires').select('*').eq('is_active', true).order('start_date', { nullsFirst: false }),
        supabase.from('onboarding_documents').select('*'),
        supabase.from('onboarding_payroll_handoffs').select('*'),
        supabase.from('onboarding_board_owners').select('*'),
      ]);
      const bad = [h, d, pr, o].find(r => r.error);
      if (bad) throw bad.error;
      setHires(h.data || []); setDocs(d.data || []); setPayroll(pr.data || []); setOwners(o.data || []);
    } catch (e) { console.error(e); setErr(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const canEdit = allAccess || owners.some(o => o.coordinator_id === profile?.id && o.board === 'payroll');

  const rows = useMemo(() => hires.map(h => {
    const d = docs.filter(r => r.hire_id === h.id);
    const pay = payroll.find(p => p.hire_id === h.id) || null;
    return { hire: h, dp: docProgress(d), pay };
  }).filter(r => r.pay), [hires, docs, payroll]);

  async function mutate(key, fn) {
    setSaving(key); setErr(null);
    try { const { error } = await fn(); if (error) throw error; await load(); }
    catch (e) { console.error(e); setErr(e.message || 'Save failed'); }
    finally { setSaving(null); }
  }
  const markPayroll = (r, state) => mutate('pay' + r.pay.id, () => supabase.from('onboarding_payroll_handoffs').update({
    state, sent_at: state === 'sent' ? new Date().toISOString() : r.pay.sent_at,
    confirmed_at: state === 'confirmed' ? new Date().toISOString() : null,
    confirmed_by: state === 'confirmed' ? (profile?.full_name || 'unknown') : null,
    updated_at: new Date().toISOString(),
  }).eq('id', r.pay.id));

  if (loading) return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}><TopBar title="Onboarding payroll" subtitle="Loading..." /><div style={{ padding: 40, color: 'var(--gray)' }}>Loading...</div></div>;

  const ready = rows.filter(r => r.pay.state === 'ready');
  const sent = rows.filter(r => r.pay.state === 'sent');
  const blocked = rows.filter(r => r.pay.state === 'not_ready');
  const confirmed = rows.filter(r => r.pay.state === 'confirmed');
  const order = { ready: 0, sent: 1, not_ready: 2, failed: 3, confirmed: 4 };
  const sorted = [...rows].sort((a, b) => (order[a.pay.state] ?? 9) - (order[b.pay.state] ?? 9));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <TopBar title="Onboarding payroll" subtitle="New-hire payroll setup — Quinn Mäensivu"
        actions={<Btn kind="ghost" onClick={load}>Refresh</Btn>} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 26px 60px', background: 'var(--bg)' }}>
        {err && <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid var(--danger)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'var(--danger)' }}>{err}</div>}
        {!canEdit && <div style={{ marginBottom: 14, fontSize: 12, fontWeight: 600, color: 'var(--gray)', background: 'rgba(71,85,105,0.08)', padding: '8px 12px', borderRadius: 8, display: 'inline-block' }}>View only — Quinn edits payroll.</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <Kpi tone="accent" label="Ready to send" value={ready.length} foot="All documents complete" />
          <Kpi tone="info" label="Sent, awaiting setup" value={sent.length} foot="With Quinn" />
          <Kpi tone="warn" label="Blocked on documents" value={blocked.length} foot="Held with HR" />
          <Kpi tone="accent" label="Confirmed" value={confirmed.length} foot="Payroll live" />
        </div>

        <SectionH>Handoff queue — fires automatically when the document set completes</SectionH>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup><col style={{ width: '26%' }} /><col style={{ width: '13%' }} /><col style={{ width: '18%' }} /><col style={{ width: '22%' }} /><col /></colgroup>
              <thead><tr>{['Name', 'Start', 'Document set', 'State', 'Action'].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
              <tbody>
                {sorted.map(r => {
                  const st = PAY_STATE[r.pay.state] || PAY_STATE.not_ready;
                  return (
                    <tr key={r.hire.id}>
                      <td style={TD}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Avatar hire={r.hire} size={31} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{r.hire.full_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--gray)' }}>{WORKER_CLASS_LABEL[r.hire.worker_class]}{isStatusChange(r.hire) ? ' · status change' : ''}</div>
                          </div>
                        </div>
                      </td>
                      <td style={TD}><span style={{ fontSize: 12, fontWeight: 600 }}>{startLabel(r.hire)}</span></td>
                      <td style={TD}>
                        <div style={{ fontSize: 12.5 }}>{DOC_SET_LABEL[r.pay.document_set]}</div>
                        <div style={{ fontSize: 10.5, color: r.dp.complete ? 'var(--green)' : 'var(--gray)', marginTop: 2 }}>{r.dp.done} of {r.dp.total} complete</div>
                      </td>
                      <td style={TD}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '4px 9px', borderRadius: 999, background: st.bg, color: st.fg }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: st.fg }} />{st.label}
                        </span>
                        {r.pay.sent_at && <div style={{ fontSize: 10.5, color: 'var(--gray)', marginTop: 3 }}>sent {fmtDate(r.pay.sent_at.slice(0, 10))}</div>}
                      </td>
                      <td style={TD}>
                        {r.pay.state === 'ready' && <Btn disabled={!canEdit || saving === 'pay' + r.pay.id} onClick={() => markPayroll(r, 'sent')}>Mark sent</Btn>}
                        {r.pay.state === 'sent' && <Btn disabled={!canEdit || saving === 'pay' + r.pay.id} onClick={() => markPayroll(r, 'confirmed')}>Confirm setup</Btn>}
                        {r.pay.state === 'not_ready' && <span style={{ fontSize: 11.5, color: 'var(--gray)' }}>Waiting on HR</span>}
                        {r.pay.state === 'confirmed' && <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--green)' }}>Complete</span>}
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && <tr><td style={{ ...TD, textAlign: 'center', color: 'var(--gray)' }} colSpan={5}>No hires in the payroll queue yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <SectionH>Three document sets, three triggers</SectionH>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '15px 17px' }}>
          {[
            ['W-2 employee (full time and part time)', 'Offer, I-9, W-4, direct deposit, background, policies', rows.filter(r => r.hire.document_set === 'w2').length],
            ['1099 PRN contractor', 'Agreement, W-9, licence and insurance, policies', rows.filter(r => r.hire.document_set === 'contractor_1099').length],
            ['Status change', 'Status letter, pay change, benefits election', rows.filter(r => r.hire.document_set === 'status_change').length],
          ].map(([t, d, n], i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: i < 2 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>{t}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray)' }}>{n} in pipeline</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--gray)', marginTop: 2 }}>{d}</div>
            </div>
          ))}
          <div style={{ marginTop: 11, padding: '10px 12px', borderRadius: 8, background: 'rgba(217,119,6,0.09)', border: '1px solid rgba(217,119,6,0.25)', fontSize: 11.5, lineHeight: 1.55, color: 'var(--black)' }}>
            Contractors never file a W-4 or an I-9, and status changes file neither — the record already exists, so only rate and benefits move. Each worker class has its own document set so the trigger never asks for paperwork that must not be collected.
          </div>
        </div>
      </div>
    </div>
  );
}
