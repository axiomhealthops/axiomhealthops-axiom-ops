import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, logActivity } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

// CPT Codes library + off-list approval queue.
// - Library tab: add / deactivate / reactivate / remove CPT codes that
//   populate the Auth Request Form picker.
// - Pending Approvals tab: coordinators request off-list codes from inside
//   the auth form; an approver (Carla Smith / admin / super_admin) approves
//   or rejects them here. Approving adds the code to the master library.
//
// ASCII-only in JSX text (CLAUDE.md). No unicode literals.

const CATS = [
  { value: 'wound_care', label: 'Wound Care' },
  { value: 'lymphedema', label: 'Lymphedema' },
  { value: 'pt',         label: 'Physical Therapy' },
  { value: 'ot',         label: 'Occupational Therapy' },
  { value: 'garment',    label: 'Garment' },
];
const APPROVER_ROLES = ['admin', 'super_admin', 'director', 'ceo'];

function catLabel(c) { return (CATS.find(x => x.value === c) || {}).label || c || '-'; }
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function CptCodesAdminPage() {
  const { profile } = useAuth();
  const profileName = profile?.full_name || profile?.email || 'Unknown';
  const isApprover = APPROVER_ROLES.includes(profile?.role);

  const [tab, setTab]           = useState('pending');
  const [codes, setCodes]       = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [reloadKey, setReload]  = useState(0);
  const [msg, setMsg]           = useState(null);
  const [busy, setBusy]         = useState(false);

  // Add-code form (Library tab)
  const [nc, setNc] = useState({ code: '', description: '', category: 'wound_care' });
  // Per-request review controls (category + notes), keyed by request id
  const [review, setReview] = useState({});

  useEffect(() => { (async () => {
    setLoading(true);
    const [{ data: cpts }, { data: reqs }] = await Promise.all([
      supabase.from('cpt_codes').select('*').order('category').order('sort_order'),
      supabase.from('cpt_code_requests').select('*').order('created_at', { ascending: false }),
    ]);
    setCodes(cpts || []);
    setRequests(reqs || []);
    setLoading(false);
  })(); }, [reloadKey]);

  const pending = useMemo(() => requests.filter(r => r.status === 'pending'), [requests]);
  const reviewed = useMemo(() => requests.filter(r => r.status !== 'pending').slice(0, 40), [requests]);

  async function addCode() {
    const code = (nc.code || '').trim().toUpperCase();
    if (!code) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.from('cpt_codes').upsert({
      code,
      description: nc.description || '',
      category:   nc.category,
      is_active:  true,
      cpt_year:   2026,
      sort_order: 0,
      notes:      'Added by ' + profileName,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'code' });
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: error.message }); return; }
    logActivity({ coordinatorId: profile?.id, coordinatorName: profileName, coordinatorRole: profile?.role,
      actionType: 'cpt_code_added', tableName: 'cpt_codes', actionDetail: 'Added CPT ' + code, metadata: { code } }).catch(() => {});
    setNc({ code: '', description: '', category: nc.category });
    setReload(k => k + 1);
    setMsg({ type: 'ok', text: code + ' saved to the CPT library.' });
  }

  async function toggleActive(c) {
    setBusy(true);
    const { error } = await supabase.from('cpt_codes')
      .update({ is_active: !c.is_active, updated_at: new Date().toISOString() }).eq('code', c.code);
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: error.message }); return; }
    setReload(k => k + 1);
  }

  async function removeCode(c) {
    if (!window.confirm('Permanently remove ' + c.code + ' from the library? Deactivate instead if you may need it later.')) return;
    setBusy(true);
    const { error } = await supabase.from('cpt_codes').delete().eq('code', c.code);
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: error.message }); return; }
    setReload(k => k + 1);
    setMsg({ type: 'ok', text: c.code + ' removed.' });
  }

  async function approve(req) {
    const r = review[req.id] || {};
    const category = r.category || req.category || 'wound_care';
    setBusy(true); setMsg(null);
    // 1) add to master library (upsert so an existing/inactive code is reactivated)
    const { error: upErr } = await supabase.from('cpt_codes').upsert({
      code:        (req.code || '').trim().toUpperCase(),
      description: req.description || '',
      category,
      is_active:   true,
      cpt_year:    2026,
      sort_order:  0,
      notes:       'Approved by ' + profileName + ' from request',
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'code' });
    if (upErr) { setBusy(false); setMsg({ type: 'error', text: 'Could not add code: ' + upErr.message }); return; }
    // 2) mark the request approved
    const { error: reqErr } = await supabase.from('cpt_code_requests').update({
      status: 'approved', reviewed_by: profile?.user_id || null, reviewed_by_name: profileName,
      reviewed_at: new Date().toISOString(), review_notes: r.notes || null, updated_at: new Date().toISOString(),
    }).eq('id', req.id);
    setBusy(false);
    if (reqErr) { setMsg({ type: 'error', text: reqErr.message }); return; }
    logActivity({ coordinatorId: profile?.id, coordinatorName: profileName, coordinatorRole: profile?.role,
      actionType: 'cpt_request_approved', tableName: 'cpt_code_requests', recordId: req.id,
      actionDetail: 'Approved CPT ' + req.code, metadata: { code: req.code, category } }).catch(() => {});
    setReload(k => k + 1);
    setMsg({ type: 'ok', text: req.code + ' approved and added to the library.' });
  }

  async function reject(req) {
    const r = review[req.id] || {};
    setBusy(true); setMsg(null);
    const { error } = await supabase.from('cpt_code_requests').update({
      status: 'rejected', reviewed_by: profile?.user_id || null, reviewed_by_name: profileName,
      reviewed_at: new Date().toISOString(), review_notes: r.notes || null, updated_at: new Date().toISOString(),
    }).eq('id', req.id);
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: error.message }); return; }
    logActivity({ coordinatorId: profile?.id, coordinatorName: profileName, coordinatorRole: profile?.role,
      actionType: 'cpt_request_rejected', tableName: 'cpt_code_requests', recordId: req.id,
      actionDetail: 'Rejected CPT ' + req.code, metadata: { code: req.code } }).catch(() => {});
    setReload(k => k + 1);
    setMsg({ type: 'ok', text: req.code + ' rejected.' });
  }

  function setRv(id, patch) { setReview(prev => ({ ...prev, [id]: { ...prev[id], ...patch } })); }

  return (
    <div>
      <TopBar title="CPT Codes &amp; Approvals" subtitle="Manage the CPT library and review off-list code requests" />

      <div style={S.bar}>
        <button style={{ ...S.tab, ...(tab === 'pending' ? S.tabOn : {}) }} onClick={() => setTab('pending')}>
          {'Pending Approvals (' + pending.length + ')'}
        </button>
        <button style={{ ...S.tab, ...(tab === 'library' ? S.tabOn : {}) }} onClick={() => setTab('library')}>
          {'Code Library (' + codes.length + ')'}
        </button>
        <div style={{ flex: 1 }} />
        {!isApprover && (
          <div style={S.roleNote}>You can view requests, but only an approver (Carla Smith / admin) can approve codes.</div>
        )}
      </div>

      {msg && <div style={{ ...S.msg, ...(msg.type === 'error' ? S.msgErr : S.msgOk) }}>{msg.text}</div>}

      {loading && <div style={S.empty}>Loading...</div>}

      {/* -------------------- PENDING APPROVALS -------------------- */}
      {!loading && tab === 'pending' && (
        <div style={S.wrap}>
          {pending.length === 0 && <div style={S.empty}>No pending CPT code requests.</div>}
          {pending.map(req => {
            const r = review[req.id] || {};
            return (
              <div key={req.id} style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <span style={S.codeBig}>{req.code}</span>
                    <span style={S.reqMeta}>
                      {' requested by ' + (req.requested_by_name || 'Unknown') + ' - ' + fmtDateTime(req.created_at)}
                    </span>
                  </div>
                  <span style={S.pendPill}>pending</span>
                </div>
                {req.description && <div style={S.reqDesc}>{req.description}</div>}
                {req.reason && <div style={S.reqReason}>Reason: {req.reason}</div>}
                {req.context_patient && <div style={S.reqCtx}>Patient context: {req.context_patient}</div>}

                <div style={S.reviewRow}>
                  <div>
                    <div style={S.lbl}>Category</div>
                    <select style={S.input} value={r.category || req.category || 'wound_care'}
                            onChange={e => setRv(req.id, { category: e.target.value })} disabled={!isApprover}>
                      {CATS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={S.lbl}>Review note (optional)</div>
                    <input style={S.input} value={r.notes || ''} disabled={!isApprover}
                           onChange={e => setRv(req.id, { notes: e.target.value })}
                           placeholder="e.g. Verified against 2026 Humana fee schedule" />
                  </div>
                </div>
                {isApprover && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button style={S.approveBtn} disabled={busy} onClick={() => approve(req)}>Approve and add to library</button>
                    <button style={S.rejectBtn}  disabled={busy} onClick={() => reject(req)}>Reject</button>
                  </div>
                )}
              </div>
            );
          })}

          {reviewed.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={S.subhead}>Recently reviewed</div>
              {reviewed.map(req => (
                <div key={req.id} style={S.reviewedRow}>
                  <span style={S.codeSm}>{req.code}</span>
                  <span style={{ ...S.statusPill, ...(req.status === 'approved' ? S.okPill : S.noPill) }}>{req.status}</span>
                  <span style={{ color: '#6B7280', fontSize: 11 }}>{req.reviewed_by_name || ''} - {fmtDateTime(req.reviewed_at)}</span>
                  {req.review_notes && <span style={{ color: '#9CA3AF', fontSize: 11 }}>- {req.review_notes}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* -------------------- CODE LIBRARY -------------------- */}
      {!loading && tab === 'library' && (
        <div style={S.wrap}>
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Add a CPT code</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ width: 120 }}>
                <div style={S.lbl}>Code</div>
                <input style={S.input} value={nc.code} onChange={e => setNc({ ...nc, code: e.target.value })} placeholder="97597" />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={S.lbl}>Description</div>
                <input style={S.input} value={nc.description} onChange={e => setNc({ ...nc, description: e.target.value })} placeholder="Debridement, open wound, first 20 sq cm or less" />
              </div>
              <div style={{ width: 180 }}>
                <div style={S.lbl}>Category</div>
                <select style={S.input} value={nc.category} onChange={e => setNc({ ...nc, category: e.target.value })}>
                  {CATS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <button style={S.approveBtn} disabled={busy || !nc.code.trim()} onClick={addCode}>Add code</button>
            </div>
          </div>

          {CATS.map(cat => {
            const list = codes.filter(c => c.category === cat.value);
            if (list.length === 0) return null;
            return (
              <div key={cat.value} style={{ marginTop: 12 }}>
                <div style={S.subhead}>{cat.label} ({list.length})</div>
                {list.map(c => (
                  <div key={c.code} style={{ ...S.codeRow, opacity: c.is_active ? 1 : 0.5 }}>
                    <span style={S.codeSm}>{c.code}</span>
                    <span style={{ flex: 1, fontSize: 12, color: '#374151' }}>{c.description}</span>
                    {!c.is_active && <span style={S.inactivePill}>inactive</span>}
                    <button style={S.miniBtn} disabled={busy} onClick={() => toggleActive(c)}>
                      {c.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                    <button style={{ ...S.miniBtn, color: '#991B1B', borderColor: '#FECACA' }} disabled={busy} onClick={() => removeCode(c)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const S = {
  bar: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderBottom: '1px solid #E5E7EB', background: '#FAFAFA' },
  tab: { padding: '6px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151' },
  tabOn: { background: '#D94F2B', color: '#fff', borderColor: '#D94F2B' },
  roleNote: { fontSize: 11, color: '#92400E', background: '#FEF3C7', padding: '4px 10px', borderRadius: 6, border: '1px solid #FCD34D' },

  wrap: { padding: 20, display: 'flex', flexDirection: 'column', gap: 8 },
  card: { background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16 },
  subhead: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#D94F2B', margin: '6px 0 8px' },

  codeBig: { fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 800, fontSize: 16, color: '#1A1A1A' },
  codeSm: { fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 700, fontSize: 13, color: '#1A1A1A', minWidth: 72 },
  reqMeta: { fontSize: 12, color: '#6B7280' },
  reqDesc: { fontSize: 13, color: '#374151', marginTop: 6 },
  reqReason: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  reqCtx: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  reviewRow: { display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' },

  codeRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, marginBottom: 6 },
  reviewedRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px', borderBottom: '1px solid #F3F4F6', flexWrap: 'wrap' },

  lbl: { fontSize: 10, fontWeight: 700, color: '#6B7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' },
  input: { width: '100%', padding: '7px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box' },

  approveBtn: { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#065F46', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 },
  rejectBtn: { padding: '8px 14px', borderRadius: 8, border: '1px solid #D1D5DB', background: '#fff', color: '#991B1B', fontWeight: 600, cursor: 'pointer', fontSize: 13 },
  miniBtn: { padding: '5px 10px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', color: '#374151', fontWeight: 600, cursor: 'pointer', fontSize: 11 },

  pendPill: { fontSize: 10, fontWeight: 700, color: '#92400E', background: '#FEF3C7', padding: '2px 8px', borderRadius: 999, alignSelf: 'flex-start' },
  inactivePill: { fontSize: 9, fontWeight: 700, color: '#6B7280', background: '#F3F4F6', padding: '1px 6px', borderRadius: 999 },
  statusPill: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999 },
  okPill: { color: '#065F46', background: '#ECFDF5' },
  noPill: { color: '#991B1B', background: '#FEF2F2' },

  msg: { margin: '12px 20px 0', padding: '8px 12px', borderRadius: 8, fontSize: 13 },
  msgOk: { background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0' },
  msgErr: { background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' },
  empty: { padding: 40, textAlign: 'center', color: '#9CA3AF', fontSize: 13 },
};
