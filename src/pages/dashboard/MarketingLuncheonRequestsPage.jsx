// =====================================================================
// MarketingLuncheonRequestsPage.jsx
//
// Approval workflow for marketing-funded provider luncheons and
// in-service educational sessions. Marketing field staff (HAEs, RMs,
// ADs, anyone with marketing_rep secondary) submit requests. Yvonne
// Flores (director_payer_marketing) reviews and approves/denies before
// any money is committed.
//
// Roles:
//   - Approvers (super_admin, admin, director_payer_marketing): see ALL
//     requests, can approve / deny / change status.
//   - Field marketing users: see their own requests + same-region peers'
//     requests (visibility for coordination), can create new requests,
//     can edit/cancel their own pending requests, can fill in post-event
//     outcomes on their own approved requests.
//
// Built 2026-06-09.
// =====================================================================

import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages, logActivity } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import { TERRITORIES, TERRITORY_LETTERS, GA_TERRITORIES, GA_TERRITORY_LETTERS, EC } from '../../lib/constants';

const STATUSES = ['pending','approved','denied','completed','cancelled'];

const STATUS_META = {
  pending:   { label: 'Pending',   color: '#9C5700', bg: '#FFFBEB', border: '#F59E0B' },
  approved:  { label: 'Approved',  color: '#065F46', bg: '#ECFDF5', border: '#10B981' },
  denied:    { label: 'Denied',    color: '#9C0006', bg: '#FEF2F2', border: '#DC2626' },
  completed: { label: 'Completed', color: '#1E40AF', bg: '#EFF6FF', border: '#3B82F6' },
  cancelled: { label: 'Cancelled', color: '#475569', bg: '#F1F5F9', border: '#94A3B8' },
};

const EVENT_TYPE_LABEL = {
  luncheon:   'Provider Luncheon',
  in_service: 'In-Service / Education',
  other:      'Other Marketing Event',
};

function fmtDate(s) {
  if (!s) return '';
  try { return new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return s; }
}
function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '-';
  const x = Number(n);
  if (isNaN(x)) return '-';
  return '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function firstOfMonth() { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }

const ALL_TERRITORY_LETTERS = [...TERRITORY_LETTERS, ...GA_TERRITORY_LETTERS];

export default function MarketingLuncheonRequestsPage() {
  const { profile } = useAuth();
  // Approvers: Liam (super_admin) and Yvonne (director_payer_marketing) only.
  // admins (Carla, Ashley, Dustin, Randi) can VIEW everything but cannot
  // approve/deny — they should escalate to Yvonne for sign-off.
  const isApprover = ['super_admin', 'director_payer_marketing'].includes(profile?.role);

  const [requests, setRequests] = useState([]);
  const [providers, setProviders] = useState([]);  // marketing_contacts from CRM
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(isApprover ? 'pending' : 'all');
  const [view, setView] = useState(isApprover ? 'all' : 'mine');  // 'all' | 'mine' | 'region'
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [reviewingRequest, setReviewingRequest] = useState(null);

  function loadData() {
    Promise.all([
      fetchAllPages(supabase.from('marketing_luncheon_requests').select('*').order('created_at', { ascending: false })),
      // Pull active CRM providers so the New Request form can autocomplete from them.
      // Tying this form to the CRM ensures clinic/region/address stay consistent
      // with what reps have already logged, and links the request via provider_id.
      fetchAllPages(supabase.from('marketing_contacts').select('id, practice_name, contact_name, address, city, state, zip, region, phone').eq('is_active', true).order('practice_name')),
    ]).then(([reqs, provs]) => {
      setRequests(Array.isArray(reqs) ? reqs : []);
      setProviders(Array.isArray(provs) ? provs : []);
      setLoading(false);
    }).catch(err => { console.error(err); setLoading(false); });
  }
  useEffect(() => { loadData(); }, []);
  useRealtimeTable(['marketing_luncheon_requests', 'marketing_contacts'], loadData);

  const filtered = useMemo(() => {
    return requests.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (view === 'mine' && r.requested_by !== profile?.id) return false;
      return true;
    });
  }, [requests, statusFilter, view, profile?.id]);

  // ─── Stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const s = { pending: 0, approved: 0, denied: 0, completed: 0, cancelled: 0, approved_budget_this_month: 0 };
    const thisMonth = firstOfMonth();
    requests.forEach(r => {
      if (s[r.status] != null) s[r.status]++;
      if (r.status === 'approved' && r.approved_at >= thisMonth) {
        s.approved_budget_this_month += Number(r.estimated_cost || 0);
      }
    });
    return s;
  }, [requests]);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Luncheon / In-Service Requests" subtitle="Loading..." />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading...</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Marketing - Luncheon / In-Service Requests"
        subtitle={
          isApprover
            ? `${stats.pending} pending approval - ${stats.approved} approved - ${stats.denied} denied - ${fmtMoney(stats.approved_budget_this_month)} approved this month`
            : `${requests.filter(r => r.requested_by === profile?.id).length} of your requests - ${stats.pending} team-wide pending`
        }
        actions={
          <button onClick={() => setShowNewModal(true)}
            style={{
              padding: '8px 18px', background: EC.gradient, color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(124, 91, 247, 0.2)',
            }}>
            + New Request
          </button>
        }
      />
      <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <Stat label="Pending Approval" value={stats.pending} accent={STATUS_META.pending.color} bg={STATUS_META.pending.bg} />
          <Stat label="Approved" value={stats.approved} accent={STATUS_META.approved.color} bg={STATUS_META.approved.bg} />
          <Stat label="Denied" value={stats.denied} accent={STATUS_META.denied.color} bg={STATUS_META.denied.bg} />
          <Stat label="Completed" value={stats.completed} accent={STATUS_META.completed.color} bg={STATUS_META.completed.bg} />
          <Stat label="Approved Spend (MTD)" value={fmtMoney(stats.approved_budget_this_month)} accent={EC.indigo} bg="#EEF2FF" />
        </div>

        {/* Filter bar */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', marginRight: 4 }}>Status:</div>
          <FilterPill label="All" active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
          {STATUSES.map(s => (
            <FilterPill key={s}
              label={`${STATUS_META[s].label} (${stats[s] || 0})`}
              active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              accent={STATUS_META[s].color}
              bg={STATUS_META[s].bg}
            />
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', marginRight: 4 }}>View:</div>
          <FilterPill label="All Requests" active={view === 'all'} onClick={() => setView('all')} />
          <FilterPill label="Mine Only" active={view === 'mine'} onClick={() => setView('mine')} />
        </div>

        {/* Requests table */}
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>
              No requests match the current filter.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#FAFAFA', borderBottom: '2px solid var(--border)' }}>
                  <th style={th}>Status</th>
                  <th style={th}>Event Date</th>
                  <th style={th}>Type</th>
                  <th style={th}>Clinic / Provider</th>
                  <th style={th}>Region</th>
                  <th style={th}>Requested By</th>
                  <th style={{ ...th, textAlign: 'right' }}>Est. Cost</th>
                  <th style={{ ...th, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const meta = STATUS_META[r.status] || STATUS_META.pending;
                  const isMine = r.requested_by === profile?.id;
                  const canReview = isApprover && r.status === 'pending';
                  const canCancel = isMine && r.status === 'pending';
                  const canEdit = isMine && r.status === 'pending';
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={td}>
                        <StatusChip status={r.status} />
                      </td>
                      <td style={td}>{fmtDate(r.event_date)}</td>
                      <td style={td}>{EVENT_TYPE_LABEL[r.event_type] || r.event_type}</td>
                      <td style={{ ...td, fontWeight: 600, color: 'var(--black)' }}>
                        {r.clinic_or_provider_name}
                        {r.provider_id && (
                          <span title="Linked to a CRM provider record"
                            style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#065F46', background: '#ECFDF5', padding: '1px 6px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.3, verticalAlign: 'middle' }}>CRM</span>
                        )}
                      </td>
                      <td style={td}>{r.region || '-'}</td>
                      <td style={td}>{r.requested_by_name}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(r.estimated_cost)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <ActionBtn label="View" onClick={() => setReviewingRequest(r)} />
                          {canReview && <ActionBtn label="Review" onClick={() => setReviewingRequest(r)} primary />}
                          {canEdit && <ActionBtn label="Edit" onClick={() => setEditingRequest(r)} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

      </div>

      {showNewModal && (
        <RequestModal
          profile={profile}
          providers={providers}
          onClose={() => setShowNewModal(false)}
          onSaved={() => { setShowNewModal(false); loadData(); }}
        />
      )}
      {editingRequest && (
        <RequestModal
          profile={profile}
          providers={providers}
          request={editingRequest}
          onClose={() => setEditingRequest(null)}
          onSaved={() => { setEditingRequest(null); loadData(); }}
        />
      )}
      {reviewingRequest && (
        <ReviewModal
          profile={profile}
          providers={providers}
          isApprover={isApprover}
          request={reviewingRequest}
          onClose={() => setReviewingRequest(null)}
          onSaved={() => { setReviewingRequest(null); loadData(); }}
        />
      )}
    </div>
  );
}

// ─── New / Edit request modal ────────────────────────────────────────────

function RequestModal({ profile, providers = [], request, onClose, onSaved }) {
  const isEdit = !!request;
  const [form, setForm] = useState({
    event_type:               request?.event_type               || 'luncheon',
    provider_id:              request?.provider_id              || '',
    clinic_or_provider_name:  request?.clinic_or_provider_name  || '',
    region:                   request?.region                   || profile?.regions?.[0] || '',
    event_address:            request?.event_address            || '',
    event_date:               request?.event_date               || '',
    event_time:               request?.event_time               || '',
    num_attendees:            request?.num_attendees            || '',
    estimated_cost:           request?.estimated_cost           || '',
    vendor_name:              request?.vendor_name              || '',
    purpose:                  request?.purpose                  || '',
    topic:                    request?.topic                    || '',
    notes:                    request?.notes                    || '',
  });
  const [providerSearch, setProviderSearch] = useState(request?.clinic_or_provider_name || '');
  const [showProviderDropdown, setShowProviderDropdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  // Filter providers by typed search text (practice name OR contact name)
  const providerMatches = useMemo(() => {
    const q = providerSearch.trim().toLowerCase();
    if (!q || q.length < 2) return providers.slice(0, 8);  // show first 8 if empty
    return providers
      .filter(p =>
        (p.practice_name || '').toLowerCase().includes(q)
        || (p.contact_name  || '').toLowerCase().includes(q)
        || (p.city          || '').toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [providers, providerSearch]);

  const linkedProvider = providers.find(p => p.id === form.provider_id);

  function pickProvider(p) {
    const fullAddress = [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ');
    setForm(f => ({
      ...f,
      provider_id:              p.id,
      clinic_or_provider_name:  p.practice_name + (p.contact_name ? ` - ${p.contact_name}` : ''),
      region:                   p.region || f.region,
      event_address:            fullAddress || f.event_address,
    }));
    setProviderSearch(p.practice_name + (p.contact_name ? ` - ${p.contact_name}` : ''));
    setShowProviderDropdown(false);
  }

  function detachProvider() {
    setForm(f => ({ ...f, provider_id: '' }));
  }

  async function save() {
    setErr('');
    if (!form.clinic_or_provider_name?.trim()) { setErr('Clinic/Provider name is required.'); return; }
    if (!form.event_date) { setErr('Event date is required.'); return; }
    if (!form.purpose?.trim()) { setErr('Purpose is required so Yvonne knows what she\'s approving.'); return; }
    setSaving(true);
    const payload = {
      ...form,
      provider_id:    form.provider_id    === '' ? null : form.provider_id,
      num_attendees:  form.num_attendees  === '' ? null : Number(form.num_attendees),
      estimated_cost: form.estimated_cost === '' ? null : Number(form.estimated_cost),
      event_time:     form.event_time     === '' ? null : form.event_time,
      event_address:  form.event_address  === '' ? null : form.event_address,
      vendor_name:    form.vendor_name    === '' ? null : form.vendor_name,
      topic:          form.topic          === '' ? null : form.topic,
      notes:          form.notes          === '' ? null : form.notes,
      requested_by:      isEdit ? request.requested_by      : profile?.id,
      requested_by_name: isEdit ? request.requested_by_name : (profile?.full_name || profile?.email || 'Unknown'),
    };

    let saveErr = null;
    if (isEdit) {
      const res = await supabase.from('marketing_luncheon_requests').update(payload).eq('id', request.id);
      saveErr = res.error;
    } else {
      const res = await supabase.from('marketing_luncheon_requests').insert(payload);
      saveErr = res.error;
    }

    if (saveErr) {
      setErr('Save failed: ' + (saveErr.message || JSON.stringify(saveErr)));
      setSaving(false);
      return;
    }

    logActivity({
      coordinatorId: profile?.id, coordinatorName: profile?.full_name, coordinatorRole: profile?.role,
      actionType: isEdit ? 'luncheon_request_updated' : 'luncheon_request_submitted',
      actionDetail: `${EVENT_TYPE_LABEL[form.event_type]} - ${form.clinic_or_provider_name} on ${form.event_date} - ${fmtMoney(form.estimated_cost)}`,
      tableName: 'marketing_luncheon_requests',
      metadata: { event_type: form.event_type, region: form.region, estimated_cost: form.estimated_cost },
    });

    setSaving(false);
    onSaved();
  }

  return (
    <Modal title={isEdit ? 'Edit Luncheon Request' : 'New Luncheon / In-Service Request'} onClose={onClose} headerBg={EC.gradient}>
      <div style={{ padding: 22, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Event Type" required>
          <select value={form.event_type} onChange={e => set('event_type', e.target.value)} style={inputStyle}>
            <option value="luncheon">Provider Luncheon</option>
            <option value="in_service">In-Service / Education</option>
            <option value="other">Other Marketing Event</option>
          </select>
        </Field>
        <Field label="Region">
          <select value={form.region} onChange={e => set('region', e.target.value)} style={inputStyle}>
            <option value="">- pick one -</option>
            {ALL_TERRITORY_LETTERS.map(r => {
              const t = TERRITORIES[r] || GA_TERRITORIES[r];
              return <option key={r} value={r}>{r === 'GA' ? 'Georgia' : `Territory ${r}`} - {t?.counties || ''}</option>;
            })}
          </select>
        </Field>
        <Field label="Clinic / Provider Name" required colSpan={2}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={providerSearch}
              onChange={e => {
                setProviderSearch(e.target.value);
                set('clinic_or_provider_name', e.target.value);
                if (form.provider_id) set('provider_id', '');  // typing detaches CRM link
                setShowProviderDropdown(true);
              }}
              onFocus={() => setShowProviderDropdown(true)}
              onBlur={() => setTimeout(() => setShowProviderDropdown(false), 150)}
              placeholder="Type to search the CRM, or enter a new clinic / provider name"
              style={{ ...inputStyle, paddingRight: linkedProvider ? 110 : 36 }}
            />
            {/* Search icon */}
            <span style={{ position: 'absolute', right: linkedProvider ? 96 : 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--gray)', pointerEvents: 'none' }}>
              {linkedProvider ? '' : '⌕'}
            </span>
            {/* "From CRM" chip when linked */}
            {linkedProvider && (
              <span
                onClick={detachProvider}
                title="Click to detach from CRM (lets you edit the name freely)"
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: '#ECFDF5', color: '#065F46', border: '1px solid #10B981',
                  padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                  cursor: 'pointer', letterSpacing: 0.3, textTransform: 'uppercase',
                }}>
                From CRM {'×'}
              </span>
            )}

            {/* Dropdown */}
            {showProviderDropdown && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8,
                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)', zIndex: 50, maxHeight: 280, overflow: 'auto',
              }}>
                {providerMatches.length === 0 ? (
                  <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--gray)' }}>
                    No matching providers in the CRM. Keep typing to enter a new one — you can add the provider to the CRM later from Marketing CRM.
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: 0.4, background: '#FAFAFA', borderBottom: '1px solid var(--border)' }}>
                      Existing CRM Providers {providerSearch && `matching "${providerSearch}"`}
                    </div>
                    {providerMatches.map(p => (
                      <div key={p.id}
                        onMouseDown={() => pickProvider(p)}
                        style={{
                          padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = '#F0FDFA'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>{p.practice_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>
                            {p.contact_name && <>{p.contact_name} {'·'} </>}
                            {p.city && <>{p.city}{p.state ? ', ' + p.state : ''} {'·'} </>}
                            {p.region && <>Territory {p.region}</>}
                          </div>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: EC.teal, background: '#ECFEFF', padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.3, flexShrink: 0 }}>Pick</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>
            {linkedProvider
              ? <>Linked to CRM provider. Region and address auto-filled from the CRM record. Click the green chip to detach.</>
              : <>Start typing to search the CRM. If the clinic doesn't exist yet, just type the new name — the request will record it as freeform.</>
            }
          </div>
        </Field>
        <Field label="Event Address" colSpan={2}>
          <input type="text" value={form.event_address} onChange={e => set('event_address', e.target.value)} placeholder="Street, city, ZIP" style={inputStyle} />
        </Field>
        <Field label="Event Date" required>
          <input type="date" value={form.event_date} onChange={e => set('event_date', e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Event Time">
          <input type="time" value={form.event_time} onChange={e => set('event_time', e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Estimated Attendees">
          <input type="number" min="0" value={form.num_attendees} onChange={e => set('num_attendees', e.target.value)} placeholder="e.g. 12" style={inputStyle} />
        </Field>
        <Field label="Estimated Cost ($)">
          <input type="number" min="0" step="0.01" value={form.estimated_cost} onChange={e => set('estimated_cost', e.target.value)} placeholder="e.g. 250.00" style={inputStyle} />
        </Field>
        <Field label="Vendor / Caterer" colSpan={2}>
          <input type="text" value={form.vendor_name} onChange={e => set('vendor_name', e.target.value)} placeholder="e.g. Panera, Olive Garden, Jersey Mike's" style={inputStyle} />
        </Field>
        <Field label="Purpose" required colSpan={2}>
          <textarea rows={2} value={form.purpose} onChange={e => set('purpose', e.target.value)}
            placeholder="What's the goal? (e.g. introduce EdemaCare to PCP referral group, follow-up on stalled referral pipeline, build relationship with new clinic)"
            style={{ ...inputStyle, resize: 'vertical', minHeight: 56 }} />
        </Field>
        <Field label="Topic (in-service only)" colSpan={2}>
          <input type="text" value={form.topic} onChange={e => set('topic', e.target.value)} placeholder="e.g. Lymphedema diagnostic criteria, when to refer" style={inputStyle} />
        </Field>
        <Field label="Additional Notes" colSpan={2}>
          <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
            placeholder="Any context Yvonne should know - relationship history, prior outreach, expected ROI"
            style={{ ...inputStyle, resize: 'vertical', minHeight: 56 }} />
        </Field>
      </div>
      {err && <div style={errorBoxStyle}>{err}</div>}
      <ModalFooter>
        <button onClick={onClose} disabled={saving} style={ghostBtn}>Cancel</button>
        <button onClick={save} disabled={saving} style={{ ...primaryBtn, background: EC.gradient }}>
          {saving ? 'Submitting...' : isEdit ? 'Save Changes' : 'Submit for Approval'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

// ─── Review / Approve / Deny modal ───────────────────────────────────────

function ReviewModal({ profile, providers = [], isApprover, request, onClose, onSaved }) {
  const linkedProvider = providers.find(p => p.id === request.provider_id);
  const [approvalNotes, setApprovalNotes] = useState(request.approval_notes || '');
  const [denialReason, setDenialReason] = useState(request.denial_reason || '');
  const [actualCost, setActualCost] = useState(request.actual_cost ?? '');
  const [referrals, setReferrals] = useState(request.referrals_received ?? '');
  const [outcomeNotes, setOutcomeNotes] = useState(request.outcome_notes || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const isMine = request.requested_by === profile?.id;
  const canApprove = isApprover && request.status === 'pending';
  const canCancel = isMine && request.status === 'pending';
  const canMarkComplete = (isMine || isApprover) && request.status === 'approved';

  async function updateStatus(newStatus, extras = {}) {
    setErr('');
    setSaving(true);
    const payload = { status: newStatus, ...extras };
    if (newStatus === 'approved' || newStatus === 'denied') {
      payload.approved_by      = profile?.id;
      payload.approved_by_name = profile?.full_name || profile?.email || 'Unknown';
      payload.approved_at      = new Date().toISOString();
    }
    const { error } = await supabase.from('marketing_luncheon_requests').update(payload).eq('id', request.id);
    if (error) {
      setErr('Update failed: ' + error.message);
      setSaving(false);
      return;
    }
    logActivity({
      coordinatorId: profile?.id, coordinatorName: profile?.full_name, coordinatorRole: profile?.role,
      actionType: `luncheon_request_${newStatus}`,
      actionDetail: `${EVENT_TYPE_LABEL[request.event_type]} - ${request.clinic_or_provider_name} - ${request.requested_by_name}`,
      tableName: 'marketing_luncheon_requests', recordId: request.id,
      metadata: { status: newStatus, estimated_cost: request.estimated_cost, region: request.region },
    });
    setSaving(false);
    onSaved();
  }

  function approve() {
    updateStatus('approved', { approval_notes: approvalNotes || null });
  }
  function deny() {
    if (!denialReason.trim()) { setErr('Please add a reason so the requester knows what to fix.'); return; }
    updateStatus('denied', { denial_reason: denialReason, approval_notes: approvalNotes || null });
  }
  function cancel() {
    updateStatus('cancelled');
  }
  function markComplete() {
    const extras = {
      actual_cost:        actualCost === '' ? null : Number(actualCost),
      referrals_received: referrals  === '' ? null : Number(referrals),
      outcome_notes:      outcomeNotes || null,
    };
    updateStatus('completed', extras);
  }

  return (
    <Modal title={`Request Review - ${request.clinic_or_provider_name}`} onClose={onClose} headerBg={STATUS_META[request.status]?.color || EC.navy}>
      <div style={{ padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <StatusChip status={request.status} />
          {linkedProvider && (
            <span title="This request is linked to an active CRM provider record"
              style={{
                background: '#ECFDF5', color: '#065F46', border: '1px solid #10B981',
                padding: '3px 10px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: 0.3,
              }}>Linked to CRM</span>
          )}
          <div style={{ fontSize: 13, color: 'var(--gray)' }}>
            Requested by <strong style={{ color: 'var(--black)' }}>{request.requested_by_name}</strong>
            {request.approved_by_name && (
              <> - {request.status === 'denied' ? 'Denied' : 'Approved'} by <strong style={{ color: 'var(--black)' }}>{request.approved_by_name}</strong> on {fmtDate(request.approved_at?.slice(0,10))}</>
            )}
          </div>
        </div>

        {linkedProvider && (
          <div style={{ marginBottom: 14, padding: '10px 14px', background: '#F0FDFA', border: '1px solid #67E8F9', borderRadius: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#0E7490', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>CRM Provider Record</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>{linkedProvider.practice_name}</div>
            <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>
              {linkedProvider.contact_name && <>{linkedProvider.contact_name} {'·'} </>}
              {linkedProvider.phone && <>{linkedProvider.phone} {'·'} </>}
              {[linkedProvider.city, linkedProvider.state, linkedProvider.zip].filter(Boolean).join(', ')}
              {linkedProvider.region && <> {'·'} Territory {linkedProvider.region}</>}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 22px', marginBottom: 18 }}>
          <Detail label="Event Type" value={EVENT_TYPE_LABEL[request.event_type]} />
          <Detail label="Event Date" value={fmtDate(request.event_date)} />
          <Detail label="Event Time" value={request.event_time || '-'} />
          <Detail label="Region" value={request.region || '-'} />
          <Detail label="Address" value={request.event_address || '-'} />
          <Detail label="Vendor" value={request.vendor_name || '-'} />
          <Detail label="Attendees" value={request.num_attendees ?? '-'} />
          <Detail label="Estimated Cost" value={fmtMoney(request.estimated_cost)} />
          {request.actual_cost != null && <Detail label="Actual Cost" value={fmtMoney(request.actual_cost)} />}
          {request.referrals_received != null && <Detail label="Referrals Received" value={request.referrals_received} />}
        </div>

        <Detail label="Purpose" value={request.purpose} block />
        {request.topic && <Detail label="Topic" value={request.topic} block />}
        {request.notes && <Detail label="Requester Notes" value={request.notes} block />}
        {request.approval_notes && <Detail label="Approver Notes" value={request.approval_notes} block />}
        {request.denial_reason && <Detail label="Denial Reason" value={request.denial_reason} block tint="#FEF2F2" />}
        {request.outcome_notes && <Detail label="Outcome Notes" value={request.outcome_notes} block />}

        {/* APPROVAL ACTIONS */}
        {canApprove && (
          <div style={{ marginTop: 18, padding: 16, background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#9C5700', marginBottom: 10 }}>Approval Decision</div>
            <Field label="Approval / Denial Notes (optional - shared with requester)">
              <textarea rows={2} value={approvalNotes} onChange={e => setApprovalNotes(e.target.value)}
                placeholder="Any conditions, follow-up requirements, or budget notes"
                style={{ ...inputStyle, resize: 'vertical', minHeight: 56 }} />
            </Field>
            <Field label="Denial Reason (required only if denying)">
              <input type="text" value={denialReason} onChange={e => setDenialReason(e.target.value)}
                placeholder="e.g. budget already committed, redundant with prior outreach"
                style={inputStyle} />
            </Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={deny} disabled={saving}
                style={{ padding: '8px 18px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {saving ? 'Working...' : 'Deny'}
              </button>
              <button onClick={approve} disabled={saving}
                style={{ padding: '8px 18px', background: '#059669', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {saving ? 'Working...' : 'Approve'}
              </button>
            </div>
          </div>
        )}

        {/* CANCEL (requester) */}
        {canCancel && !canApprove && (
          <div style={{ marginTop: 18, padding: 14, background: '#F1F5F9', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--gray)' }}>Pulling this request? You can cancel before approval.</div>
            <button onClick={cancel} disabled={saving} style={ghostBtn}>{saving ? 'Working...' : 'Cancel This Request'}</button>
          </div>
        )}

        {/* MARK COMPLETE (post-event outcome logging) */}
        {canMarkComplete && (
          <div style={{ marginTop: 18, padding: 16, background: '#EFF6FF', border: '1px solid #3B82F6', borderRadius: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1E40AF', marginBottom: 10 }}>Log Outcome (after the event)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Actual Cost ($)">
                <input type="number" min="0" step="0.01" value={actualCost} onChange={e => setActualCost(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Referrals Received from Event">
                <input type="number" min="0" value={referrals} onChange={e => setReferrals(e.target.value)} style={inputStyle} />
              </Field>
            </div>
            <Field label="Outcome Notes">
              <textarea rows={2} value={outcomeNotes} onChange={e => setOutcomeNotes(e.target.value)}
                placeholder="What went well, who was in the room, follow-up commitments"
                style={{ ...inputStyle, resize: 'vertical', minHeight: 56 }} />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button onClick={markComplete} disabled={saving}
                style={{ padding: '8px 18px', background: '#1E40AF', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {saving ? 'Working...' : 'Mark Completed'}
              </button>
            </div>
          </div>
        )}

        {err && <div style={errorBoxStyle}>{err}</div>}
      </div>
      <ModalFooter>
        <button onClick={onClose} style={ghostBtn}>Close</button>
      </ModalFooter>
    </Modal>
  );
}

// ─── UI primitives ───────────────────────────────────────────────────────

function StatusChip({ status }) {
  const m = STATUS_META[status] || STATUS_META.pending;
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 999,
      background: m.bg, color: m.color, border: `1px solid ${m.border}`,
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3,
    }}>{m.label}</span>
  );
}

function Stat({ label, value, accent, bg }) {
  return (
    <div style={{ background: bg || 'var(--card-bg)', border: `1px solid var(--border)`, borderLeft: `4px solid ${accent}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function FilterPill({ label, active, onClick, accent, bg }) {
  return (
    <button onClick={onClick}
      style={{
        background: active ? (accent || EC.navy) : (bg || 'var(--bg)'),
        color: active ? '#fff' : 'var(--black)',
        border: `1px solid ${active ? (accent || EC.navy) : 'var(--border)'}`,
        borderRadius: 999, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
      }}>
      {label}
    </button>
  );
}

function ActionBtn({ label, onClick, primary }) {
  return (
    <button onClick={onClick}
      style={{
        background: primary ? EC.gradient : 'transparent',
        color: primary ? '#fff' : EC.teal,
        border: primary ? 'none' : `1px solid ${EC.teal}`,
        borderRadius: 6, padding: '4px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
      }}>
      {label}
    </button>
  );
}

function Field({ label, required, colSpan, children }) {
  return (
    <div style={{ gridColumn: colSpan ? `span ${colSpan}` : undefined }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)', marginBottom: 4 }}>
        {label}{required && <span style={{ color: '#DC2626', marginLeft: 4 }}>*</span>}
      </div>
      {children}
    </div>
  );
}

function Detail({ label, value, block, tint }) {
  return (
    <div style={{ gridColumn: block ? '1 / -1' : undefined, padding: block ? '8px 12px' : 0, background: tint || 'transparent', borderRadius: 6, marginBottom: block ? 8 : 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--black)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{String(value)}</div>
    </div>
  );
}

function Modal({ title, onClose, children, headerBg }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--card-bg)', borderRadius: 14, width: '100%', maxWidth: 760, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '14px 22px', background: headerBg, borderRadius: '14px 14px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer' }}>{'×'}</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({ children }) {
  return (
    <div style={{ padding: '12px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--bg)' }}>
      {children}
    </div>
  );
}

const inputStyle = { width: '100%', padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box' };
const ghostBtn   = { padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, background: 'var(--card-bg)', cursor: 'pointer', fontWeight: 600, color: 'var(--black)' };
const primaryBtn = { padding: '8px 18px', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const errorBoxStyle = { margin: '0 22px 14px', padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#9C0006', fontSize: 12, fontWeight: 600, borderRadius: 7 };
const th = { textAlign: 'left', padding: '10px 14px', fontSize: 11, color: 'var(--gray)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 };
const td = { padding: '10px 14px', verticalAlign: 'top' };
