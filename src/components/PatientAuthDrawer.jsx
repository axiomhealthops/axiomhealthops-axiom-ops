// PatientAuthDrawer.jsx
//
// Shared "act-in-context" drawer for every page in the AUTHORIZATION section.
// Slides in from the right so the coordinator never leaves their list page.
// One drawer powers Compliance:Over Limit, Stuck Auths, Visit Runway, Auth
// Expiry Timeline, Auth Pending Coverage, Renewal Tasks, My Auth Queue, and
// All Authorizations.
//
// Closes the alert loop Liam described: "If anyone is expiring soon... track,
// alert, and update to get them back active." The drawer is the update step.
//
// Props:
//   authId        uuid|null   row to edit. null = patient has no auth yet (create).
//   patientName   string      required; used for activity logging, notes, alerts.
//   isOpen        bool        controls slide-in animation + mount.
//   onClose       () => void  parent must clear its `selected` state.
//   onActionTaken () => void  called after EVERY save so the parent re-queries
//                              and the patient drops off the list when filter
//                              no longer matches.
//
// Behavior contract:
//   - Every save writes to coordinator_activity_log (engagement signal).
//   - Every auth_tracker write calls sync_visits_to_auth_for_patient +
//     recompute_auth_sequence so visit counts, auth_health, and alerts
//     reflect immediately (no waiting on the 15-min cron).
//   - Status changes use the same safeUpdate path as inline toggles, so when
//     the parallel guardrails build wraps that path in validation, the drawer
//     inherits it automatically.
//   - No unicode in JSX text (per CLAUDE.md). ASCII or {'×'} only.
//
// 2026-05-28  initial build.
import { useState, useEffect, useCallback } from 'react';
import { supabase, safeUpdate, logActivity, fetchAllPages } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import PatientNotesPanel from './PatientNotesPanel';

// ----- pure helpers (kept top-level so no per-render allocation) ------------
const STATUSES = [
  { k: 'pending',        l: 'Pending',         c: '#D97706', bg: '#FEF3C7' },
  { k: 'submitted',      l: 'Submitted',       c: '#1E40AF', bg: '#EFF6FF' },
  { k: 'active',         l: 'Active',          c: '#059669', bg: '#ECFDF5' },
  { k: 'renewal_needed', l: 'Renewal Needed',  c: '#991B1B', bg: '#FEF2F2' },
  { k: 'appealing',      l: 'Appealing',       c: '#7C3AED', bg: '#EDE9FE' },
  { k: 'denied',         l: 'Denied',          c: '#DC2626', bg: '#FEF2F2' },
  { k: 'on_hold',        l: 'On Hold',         c: '#374151', bg: '#F3F4F6' },
  { k: 'discharged',     l: 'Discharged',      c: '#6B7280', bg: '#F3F4F6' },
];
const DISCIPLINES = [
  { k: 'PT',    c: '#1565C0', bg: '#EFF6FF' },
  { k: 'OT',    c: '#7C3AED', bg: '#EDE9FE' },
  { k: 'PT/OT', c: '#059669', bg: '#ECFDF5' },
  { k: 'PTA',   c: '#0891B2', bg: '#ECFEFF' },
  { k: 'COTA',  c: '#DB2777', bg: '#FDF2F8' },
];

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

// Soft toast shown at top of drawer footer. Auto-clears after 3.5s.
function useToast() {
  const [toast, setToast] = useState(null);
  const show = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind, t: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  return { toast, show, clear: () => setToast(null) };
}

// ----- main component -------------------------------------------------------
export default function PatientAuthDrawer({
  authId,
  patientName,
  isOpen,
  onClose,
  onActionTaken,
  // optional: parent can name the list so the toast message is specific
  listLabel,
}) {
  const { profile } = useAuth();
  const profileName = profile?.full_name || profile?.email || '';
  const { toast, show: showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState(null);
  const [allAuthsForPatient, setAllAuthsForPatient] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [activity, setActivity] = useState([]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState('edit'); // edit | actions | notes | activity

  // Local UI state for the "Dismiss Alert" reason input + "Contact Attempt" text
  const [dismissTargetId, setDismissTargetId] = useState(null);
  const [dismissReason, setDismissReason] = useState('');
  const [contactNote, setContactNote] = useState('');

  // Escape key closes drawer (unless mid-save).
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e) { if (e.key === 'Escape' && !saving) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, saving]);

  // Load all context for the drawer in parallel when it opens.
  const load = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);

    // Three parallel queries: auth row (if authId), patient's auth history,
    // open alerts for this patient, and recent activity touching this patient.
    const authQ = authId
      ? supabase.from('auth_tracker').select('*').eq('id', authId).maybeSingle()
      : Promise.resolve({ data: null });
    const sibQ = patientName
      ? supabase.from('auth_tracker').select('id, auth_number, auth_status, auth_discipline, auth_expiry_date, visits_authorized, visits_used, auth_sequence, is_currently_active')
          .eq('patient_name', patientName)
          .order('auth_sequence', { ascending: false })
      : Promise.resolve({ data: [] });
    const alertQ = patientName
      ? supabase.from('alerts').select('id, alert_type, priority, title, message, created_at, is_read, is_dismissed')
          .eq('patient_name', patientName)
          .eq('is_dismissed', false)
          .order('created_at', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] });
    const actQ = patientName
      ? supabase.from('coordinator_activity_log')
          .select('coordinator_name, action_type, action_detail, created_at, table_name')
          .eq('patient_name', patientName)
          .order('created_at', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] });

    const [a, sibs, alerted, acts] = await Promise.all([authQ, sibQ, alertQ, actQ]);

    const row = a.data || null;
    setAuth(row);
    setAllAuthsForPatient(sibs.data || []);
    setAlerts(alerted.data || []);
    setActivity(acts.data || []);

    // Initial form state.  For new patients (no authId), seed sensible defaults.
    setForm(row
      ? {
          auth_status:         row.auth_status || 'pending',
          auth_number:         row.auth_number || '',
          auth_discipline:     row.auth_discipline || '',
          auth_submitted_date: row.auth_submitted_date || '',
          auth_approved_date:  row.auth_approved_date || '',
          auth_expiry_date:    row.auth_expiry_date || '',
          visits_authorized:   row.visits_authorized ?? '',
          visits_used:         row.visits_used ?? '',
          notes:               row.notes || '',
          denial_reason:       row.denial_reason || '',
          assigned_to:         row.assigned_to || profileName,
        }
      : {
          // New auth from a "pending coverage" patient.  We have a patient_name
          // only - the form lets the coordinator fill in the rest.
          patient_name:        patientName,
          auth_status:         'pending',
          auth_number:         '',
          auth_discipline:     '',
          auth_submitted_date: todayISO(),
          auth_approved_date:  '',
          auth_expiry_date:    '',
          visits_authorized:   '',
          visits_used:         0,
          notes:               '',
          denial_reason:       '',
          assigned_to:         profileName,
        }
    );
    setSection('edit');
    setDismissTargetId(null);
    setDismissReason('');
    setContactNote('');
    setLoading(false);
  }, [isOpen, authId, patientName, profileName]);

  useEffect(() => { load(); }, [load]);

  // Shared post-save side-effects: sync visits, recompute sequence, log
  // activity, surface toast, notify parent.
  async function afterMutation(actionType, detail) {
    if (patientName) {
      // These are idempotent; failures are non-blocking.
      try { await supabase.rpc('sync_visits_to_auth_for_patient', { p_patient_name: patientName }); } catch (_) {}
      try { await supabase.rpc('recompute_auth_sequence',         { p_patient_name: patientName }); } catch (_) {}
    }
    try {
      await logActivity({
        coordinatorId:   profile?.id,
        coordinatorName: profileName,
        coordinatorRole: profile?.role,
        actionType,
        tableName:       'auth_tracker',
        recordId:        authId || null,
        actionDetail:    detail,
        // patient_name is canonical on coordinator_activity_log; pass through metadata.
        metadata:        { patient_name: patientName },
      });
    } catch (_) { /* non-blocking */ }

    const where = listLabel ? ` off ${listLabel}` : '';
    showToast(`Updated - ${patientName} moved${where} if filter no longer matches.`);
    if (typeof onActionTaken === 'function') onActionTaken();
  }

  // ----- ACTIONS ------------------------------------------------------------

  // Save the full edit form.  Mirrors AuthEditModal validation so the user
  // gets the same guardrails whether they open the drawer or the legacy modal.
  async function saveEdit() {
    if (!form) return;
    setSaving(true);

    const va = form.visits_authorized === '' || form.visits_authorized == null ? null : parseInt(form.visits_authorized, 10);
    const vu = form.visits_used        === '' || form.visits_used        == null ? null : parseInt(form.visits_used, 10);

    if (va !== null && va < 0)             return failSave('Visits authorized cannot be negative.');
    if (vu !== null && vu < 0)             return failSave('Visits used cannot be negative.');
    if (va !== null && vu !== null && vu > va) {
      return failSave(`Visits used (${vu}) exceeds authorized (${va}). Correct before saving.`);
    }
    if (form.auth_approved_date && form.auth_expiry_date && form.auth_approved_date > form.auth_expiry_date) {
      return failSave('Auth approved date is after expiry date. Check for typos (year).');
    }
    for (const f of ['auth_submitted_date', 'auth_approved_date', 'auth_expiry_date']) {
      const v = form[f];
      if (v && (v.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(v))) {
        return failSave(`Invalid date format on ${f.replace(/_/g, ' ')}: "${v}". Use YYYY-MM-DD.`);
      }
    }

    const payload = {
      auth_status:         form.auth_status,
      auth_number:         form.auth_number || null,
      auth_discipline:     form.auth_discipline || null,
      auth_submitted_date: form.auth_submitted_date || null,
      auth_approved_date:  form.auth_approved_date  || null,
      auth_expiry_date:    form.auth_expiry_date    || null,
      visits_authorized:   va,
      visits_used:         vu,
      notes:               form.notes || null,
      denial_reason:       form.denial_reason || null,
      assigned_to:         form.assigned_to || null,
      updated_at:          new Date().toISOString(),
      updated_by:          profileName || null,
    };

    if (authId) {
      const { error } = await safeUpdate('auth_tracker', payload, { id: authId });
      if (error) return failSave(error.message);
    } else {
      // Create flow (Auth Pending Coverage "never_had_auth" case).
      const insertPayload = {
        ...payload,
        patient_name: patientName,
        // Pull region/insurance from siblings if known, otherwise leave blank.
        region:    allAuthsForPatient[0]?.region    || null,
        insurance: allAuthsForPatient[0]?.insurance || null,
      };
      const { error } = await supabase.from('auth_tracker').insert([insertPayload]);
      if (error) return failSave(error.message);
    }

    setSaving(false);
    await afterMutation(authId ? 'auth_edit' : 'auth_create',
      authId ? `Edit auth via drawer; status=${payload.auth_status}` : `Create auth via drawer; status=${payload.auth_status}`);
    // Reload to pick up DB-side computed fields.
    await load();
  }

  function failSave(msg) {
    showToast(msg, 'err');
    setSaving(false);
  }

  // Quick status change (no full save) - bypasses the form and writes only auth_status.
  async function quickStatus(newStatus) {
    if (!authId || saving) return;
    if (auth && (auth.auth_status || '') === newStatus) return;
    setSaving(true);
    const { error } = await safeUpdate('auth_tracker', {
      auth_status: newStatus,
      updated_at:  new Date().toISOString(),
      updated_by:  profileName,
    }, { id: authId });
    setSaving(false);
    if (error) return showToast(error.message, 'err');
    setForm(f => ({ ...f, auth_status: newStatus }));
    setAuth(a => a ? { ...a, auth_status: newStatus } : a);
    await afterMutation('auth_status_change', `Status: ${auth?.auth_status || '-'} -> ${newStatus}`);
  }

  // Submit Renewal: status -> submitted, sets auth_submitted_date if blank.
  async function submitRenewal() {
    if (!authId || saving) return;
    setSaving(true);
    const update = {
      auth_status:         'submitted',
      auth_submitted_date: auth?.auth_submitted_date || todayISO(),
      assigned_to:         auth?.assigned_to || profileName,
      updated_at:          new Date().toISOString(),
      updated_by:          profileName,
    };
    const { error } = await safeUpdate('auth_tracker', update, { id: authId });
    setSaving(false);
    if (error) return showToast(error.message, 'err');
    setAuth(a => a ? { ...a, ...update } : a);
    setForm(f => ({ ...f, auth_status: 'submitted', auth_submitted_date: update.auth_submitted_date }));
    await afterMutation('auth_renewal_submitted',
      `Renewal submitted for ${patientName}; auth #${auth?.auth_number || '(none)'}`);
  }

  // Mark Contact Attempt: leaves status alone, writes a patient_note + activity row.
  async function markContact() {
    if (!patientName) return;
    if (!contactNote.trim()) return showToast('Add a note describing the contact attempt.', 'err');
    setSaving(true);
    const noteText = `[Contact attempt] ${contactNote.trim()}`;
    const { error: nErr } = await supabase.from('patient_notes').insert([{
      patient_name: patientName,
      note:         noteText,
      author_name:  profileName,
      author_role:  profile?.role || null,
    }]);
    setSaving(false);
    if (nErr) return showToast(nErr.message, 'err');
    setContactNote('');
    await afterMutation('auth_contact_attempt', noteText.slice(0, 200));
  }

  // Dismiss Alert (with reason).  Marks alert.is_dismissed and logs the reason.
  async function dismissAlert(alertId) {
    if (!dismissReason.trim()) return showToast('Type a dismissal reason before confirming.', 'err');
    setSaving(true);
    const { error } = await supabase.from('alerts')
      .update({ is_dismissed: true, is_read: true, updated_at: new Date().toISOString() })
      .eq('id', alertId);
    setSaving(false);
    if (error) return showToast(error.message, 'err');
    const dismissed = alerts.find(x => x.id === alertId);
    setAlerts(prev => prev.filter(x => x.id !== alertId));
    setDismissTargetId(null);
    setDismissReason('');
    await afterMutation('alert_dismissed',
      `Dismissed alert "${dismissed?.title || alertId}". Reason: ${dismissReason.trim().slice(0, 200)}`);
  }

  // ----- RENDER -------------------------------------------------------------
  if (!isOpen) return null;

  return (
    <>
      {/* Scrim - dim background, click to close */}
      <div onClick={() => !saving && onClose()}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(15,17,23,0.45)', zIndex: 1999,
          opacity: isOpen ? 1 : 0, transition: 'opacity 180ms ease',
        }} />

      {/* Drawer - slides in from the right */}
      <aside role="dialog" aria-label={`Authorization drawer for ${patientName}`}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 2000,
          width: 'min(560px, 96vw)',
          background: 'var(--card-bg)', boxShadow: '-12px 0 32px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}>

        {/* HEADER */}
        <div style={{ padding: '14px 18px', background: '#0F1117', color: '#fff', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {patientName || 'Patient'}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {auth
                ? `${auth.insurance || '-'} - Region ${auth.region || '-'} - Auth ${auth.auth_sequence || 1}`
                : 'No auth on file - create one below'}
            </div>
          </div>
          <button onClick={() => !saving && onClose()}
            aria-label="Close drawer"
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 22, cursor: saving ? 'wait' : 'pointer' }}>
            {'×'}
          </button>
        </div>

        {/* Section tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0 }}>
          {[
            { k: 'edit',     l: 'Edit Auth' },
            { k: 'actions',  l: `Alerts${alerts.length ? ' (' + alerts.length + ')' : ''}` },
            { k: 'notes',    l: 'Notes' },
            { k: 'activity', l: 'History' },
          ].map(t => {
            const is = section === t.k;
            return (
              <button key={t.k} onClick={() => setSection(t.k)}
                style={{
                  flex: 1, padding: '8px 10px', border: 'none', background: 'transparent',
                  cursor: 'pointer', fontSize: 11, fontWeight: 700,
                  color: is ? '#1565C0' : 'var(--gray)',
                  borderBottom: is ? '2px solid #1565C0' : '2px solid transparent',
                }}>
                {t.l}
              </button>
            );
          })}
        </div>

        {/* BODY (scrolls) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
          {loading || !form ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)', fontSize: 12 }}>
              Loading patient context...
            </div>
          ) : section === 'edit' ? (
            <EditSection auth={auth} form={form} setForm={setForm}
              quickStatus={quickStatus} submitRenewal={submitRenewal}
              authId={authId} saving={saving} allAuths={allAuthsForPatient} />
          ) : section === 'actions' ? (
            <ActionsSection alerts={alerts}
              dismissTargetId={dismissTargetId} setDismissTargetId={setDismissTargetId}
              dismissReason={dismissReason} setDismissReason={setDismissReason}
              dismissAlert={dismissAlert}
              contactNote={contactNote} setContactNote={setContactNote}
              markContact={markContact} saving={saving} />
          ) : section === 'notes' ? (
            <div>
              <PatientNotesPanel patientName={patientName} maxHeight="55vh" />
            </div>
          ) : (
            <ActivitySection activity={activity} />
          )}
        </div>

        {/* FOOTER - toast + primary actions */}
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0 }}>
          {toast && (
            <div style={{
              marginBottom: 8, padding: '7px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: toast.kind === 'err' ? '#FEF2F2' : '#ECFDF5',
              color:      toast.kind === 'err' ? '#991B1B' : '#065F46',
              border:     `1px solid ${toast.kind === 'err' ? '#FCA5A5' : '#A7F3D0'}`,
            }}>
              {toast.msg}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={() => !saving && onClose()}
              style={{ padding: '8px 14px', border: '1px solid var(--border)', background: 'var(--card-bg)', borderRadius: 7, fontSize: 12, cursor: saving ? 'wait' : 'pointer' }}>
              Close
            </button>
            {section === 'edit' && (
              <button onClick={saveEdit} disabled={saving}
                style={{ padding: '8px 22px', background: '#1565C0', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving...' : authId ? 'Save Changes' : 'Create Authorization'}
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

// ============================================================================
// Subcomponents - kept in-file so the drawer is one tidy import.
// ============================================================================

function EditSection({ auth, form, setForm, quickStatus, submitRenewal, authId, saving, allAuths }) {
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const visitsRemaining = (form.visits_authorized !== '' && form.visits_authorized != null)
    ? Math.max(0, parseInt(form.visits_authorized || 0, 10) - parseInt(form.visits_used || 0, 10))
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Snapshot tiles */}
      {auth && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          <Tile label="Visits Left"
            value={visitsRemaining != null ? `${visitsRemaining}/${form.visits_authorized || 0}` : '-'}
            color={visitsRemaining != null && visitsRemaining <= 4 ? '#DC2626' : visitsRemaining != null && visitsRemaining <= 8 ? '#D97706' : '#059669'} />
          <Tile label="Expires" value={fmtDate(form.auth_expiry_date)} />
          <Tile label="Status" value={(form.auth_status || '-').replace(/_/g, ' ')} />
        </div>
      )}

      {/* Quick-action row */}
      {authId && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={submitRenewal} disabled={saving}
            style={btn('#7C3AED', '#fff')}>Submit Renewal</button>
          <button onClick={() => quickStatus('active')} disabled={saving}
            style={btn('#ECFDF5', '#065F46', '#A7F3D0')}>Mark Approved</button>
          <button onClick={() => quickStatus('denied')} disabled={saving}
            style={btn('#FEF2F2', '#991B1B', '#FCA5A5')}>Mark Denied</button>
          <button onClick={() => quickStatus('on_hold')} disabled={saving}
            style={btn('#F3F4F6', '#374151', '#E5E7EB')}>Hold</button>
        </div>
      )}

      {/* Sibling auths */}
      {allAuths && allAuths.length > 1 && (
        <details style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 8, padding: '8px 10px' }}>
          <summary style={{ fontSize: 11, fontWeight: 700, color: '#6D28D9', cursor: 'pointer' }}>
            Auth history for this patient ({allAuths.length} total)
          </summary>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {allAuths.map(s => (
              <div key={s.id} style={{ fontSize: 11, color: '#374151', display: 'flex', justifyContent: 'space-between' }}>
                <span>Auth {s.auth_sequence || 1} - {s.auth_status} {s.is_currently_active ? '(current)' : ''}</span>
                <span style={{ fontFamily: 'DM Mono, monospace', color: '#6B7280' }}>
                  {s.visits_used ?? 0}/{s.visits_authorized ?? 0} - {fmtDate(s.auth_expiry_date)}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Status radio row */}
      <Field label="Auth Status">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {STATUSES.map(s => {
            const is = form.auth_status === s.k;
            return (
              <button key={s.k} onClick={() => set('auth_status', s.k)}
                style={{
                  padding: '5px 9px', borderRadius: 5, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                  border: `2px solid ${is ? s.c : 'var(--border)'}`,
                  background: is ? s.bg : 'var(--card-bg)',
                  color: is ? s.c : 'var(--gray)',
                }}>{s.l}</button>
            );
          })}
        </div>
      </Field>

      {/* Discipline */}
      <Field label="Discipline">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {DISCIPLINES.map(d => {
            const is = form.auth_discipline === d.k;
            return (
              <button key={d.k} onClick={() => set('auth_discipline', is ? '' : d.k)}
                style={{
                  padding: '5px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  border: `2px solid ${is ? d.c : 'var(--border)'}`,
                  background: is ? d.bg : 'var(--card-bg)',
                  color: is ? d.c : 'var(--gray)',
                }}>{d.k}</button>
            );
          })}
        </div>
        {!form.auth_discipline && (
          <div style={{ fontSize: 10, color: '#D97706', marginTop: 4 }}>
            Discipline not set - clinician assignment relies on this.
          </div>
        )}
      </Field>

      {/* Grid of plain fields */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {[
          { k: 'auth_number',         l: 'Auth Number',     t: 'text', ph: 'Auth #...' },
          { k: 'assigned_to',         l: 'Assigned To',     t: 'text', ph: 'Coordinator name...' },
          { k: 'auth_submitted_date', l: 'Submitted',       t: 'date' },
          { k: 'auth_approved_date',  l: 'Approved',        t: 'date' },
          { k: 'auth_expiry_date',    l: 'Expires',         t: 'date' },
          { k: 'visits_authorized',   l: 'Visits Auth.',    t: 'number' },
          { k: 'visits_used',         l: 'Visits Used',     t: 'number' },
          { k: 'denial_reason',       l: 'Denial Reason',   t: 'text', ph: 'If denied...' },
        ].map(f => (
          <Field key={f.k} label={f.l}>
            <input type={f.t} value={form[f.k] ?? ''} placeholder={f.ph}
              onChange={e => set(f.k, e.target.value)}
              style={inputStyle()} />
          </Field>
        ))}
      </div>

      {/* Notes */}
      <Field label="Internal Notes">
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
          placeholder="Payer call notes, portal used, follow-up needed..."
          style={{ ...inputStyle(), minHeight: 70, resize: 'vertical' }} />
      </Field>
    </div>
  );
}

function ActionsSection({ alerts, dismissTargetId, setDismissTargetId, dismissReason, setDismissReason,
                          dismissAlert, contactNote, setContactNote, markContact, saving }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Contact attempt */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Log a Contact Attempt</div>
        <div style={{ fontSize: 10, color: 'var(--gray)', marginBottom: 8 }}>
          Use when you called the payer or patient and need to capture the outcome without changing status.
        </div>
        <textarea value={contactNote} onChange={e => setContactNote(e.target.value)}
          placeholder="e.g. Called Humana, on hold 22 min, told to fax W-9 - will retry tomorrow."
          style={{ ...inputStyle(), minHeight: 60, resize: 'vertical' }} />
        <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={markContact} disabled={saving || !contactNote.trim()}
            style={btn('#0F1117', '#fff', '#0F1117', !contactNote.trim() || saving)}>
            Save Contact Note
          </button>
        </div>
      </div>

      {/* Alerts */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700 }}>
          Open Alerts ({alerts.length})
        </div>
        {alerts.length === 0 ? (
          <div style={{ padding: 16, fontSize: 11, color: 'var(--gray)' }}>
            No open alerts for this patient.
          </div>
        ) : alerts.map(a => (
          <div key={a.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
                background: a.priority === 'critical' ? '#FEE2E2' : a.priority === 'high' ? '#FFEDD5' : '#EFF6FF',
                color:      a.priority === 'critical' ? '#991B1B' : a.priority === 'high' ? '#9A3412' : '#1E40AF',
                textTransform: 'uppercase',
              }}>{a.priority}</span>
              <div style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{a.title}</div>
              {dismissTargetId === a.id ? null : (
                <button onClick={() => { setDismissTargetId(a.id); setDismissReason(''); }}
                  style={btn('var(--card-bg)', 'var(--gray)', 'var(--border)')}>
                  Dismiss
                </button>
              )}
            </div>
            {a.message && (
              <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>{a.message}</div>
            )}
            {dismissTargetId === a.id && (
              <div style={{ marginTop: 8, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: 8 }}>
                <div style={{ fontSize: 10, color: '#92400E', fontWeight: 700, marginBottom: 4 }}>
                  Why are you dismissing this alert?
                </div>
                <input value={dismissReason} onChange={e => setDismissReason(e.target.value)}
                  placeholder="e.g. Patient in hospice, will not renew."
                  style={inputStyle()} />
                <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                  <button onClick={() => { setDismissTargetId(null); setDismissReason(''); }}
                    style={btn('var(--card-bg)', 'var(--gray)', 'var(--border)')}>
                    Cancel
                  </button>
                  <button onClick={() => dismissAlert(a.id)} disabled={saving || !dismissReason.trim()}
                    style={btn('#DC2626', '#fff', '#DC2626', !dismissReason.trim() || saving)}>
                    Confirm Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivitySection({ activity }) {
  if (!activity || activity.length === 0) {
    return <div style={{ padding: 16, fontSize: 11, color: 'var(--gray)' }}>No recent activity for this patient.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      {activity.map((a, i) => (
        <div key={i} style={{ padding: '8px 12px', borderBottom: i < activity.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 11 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{(a.action_type || '').replace(/_/g, ' ')}</span>
            <span style={{ color: 'var(--gray)', fontFamily: 'DM Mono, monospace', fontSize: 10 }}>
              {new Date(a.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          </div>
          {a.action_detail && (
            <div style={{ color: 'var(--gray)', marginTop: 2 }}>{a.action_detail}</div>
          )}
          {a.coordinator_name && (
            <div style={{ color: 'var(--gray)', marginTop: 1, fontSize: 10 }}>by {a.coordinator_name}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ----- tiny presentational helpers (no exports - drawer scope) --------------
function Tile({ label, value, color }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px' }}>
      <div style={{ fontSize: 9, color: 'var(--gray)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'DM Mono, monospace', color: color || 'var(--black)' }}>
        {value}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function inputStyle() {
  return {
    width: '100%', padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 5,
    fontSize: 12, outline: 'none', background: 'var(--card-bg)', boxSizing: 'border-box',
  };
}
function btn(bg, color, border, disabled) {
  return {
    padding: '6px 10px', fontSize: 11, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
    border: `1px solid ${border || bg}`, background: bg, color, borderRadius: 5,
    opacity: disabled ? 0.5 : 1,
  };
}
