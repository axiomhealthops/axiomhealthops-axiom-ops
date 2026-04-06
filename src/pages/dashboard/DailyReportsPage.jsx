import { useState, useEffect, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

const BLENDED_RATE = 185;

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

const EMPTY_FORM = {
  contact_attempts: '',
  on_hold_reached: '',
  auth_issues: '',
  hospitalizations: '',
  biggest_blocker: '',
  notes: '',
};

function CheckInForm({ profile, onSaved, onCancel }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const today = new Date().toISOString().slice(0, 10);

  async function submit() {
    setSaving(true);
    setMsg('');
    const { error } = await supabase.from('daily_reports').insert({
      coordinator_id: profile?.id,
      submitted_by_name: profile?.full_name || profile?.email,
      report_date: today,
      report_type: 'daily_checkin',
      region: (profile?.regions || []).join(','),
      contact_attempts: parseInt(form.contact_attempts) || 0,
      on_hold_reached: parseInt(form.on_hold_reached) || 0,
      hospitalizations: parseInt(form.hospitalizations) || 0,
      auth_issues: form.auth_issues || null,
      biggest_blocker: form.biggest_blocker || null,
      notes: form.notes || null,
      submitted_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) {
      setMsg('Error: ' + error.message);
    } else {
      setMsg('✓ Check-in submitted!');
      setTimeout(() => onSaved(), 800);
    }
    setSaving(false);
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isAdmin = ['super_admin', 'admin'].includes(profile?.role);
  const today_label = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', maxWidth: 560 }}>
      <div style={{ padding: '16px 22px', background: '#1565C0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>📋 Daily Check-In</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>{today_label}</div>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>~90 seconds</div>
      </div>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Contact attempts */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6 }}>
              📞 Patient Contact Attempts Today
            </label>
            <input type="number" min="0" value={form.contact_attempts}
              onChange={e => set('contact_attempts', e.target.value)}
              placeholder="0"
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 20, fontFamily: 'DM Mono, monospace', fontWeight: 700, outline: 'none', background: 'var(--bg)', boxSizing: 'border-box', textAlign: 'center' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6 }}>
              🔄 On-Hold Patients Reached
            </label>
            <input type="number" min="0" value={form.on_hold_reached}
              onChange={e => set('on_hold_reached', e.target.value)}
              placeholder="0"
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 20, fontFamily: 'DM Mono, monospace', fontWeight: 700, outline: 'none', background: 'var(--bg)', boxSizing: 'border-box', textAlign: 'center' }} />
          </div>
        </div>

        {/* Hospitalizations */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6 }}>
            🏥 New Hospitalizations to Report
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[0, 1, 2, 3, '4+'].map(n => (
              <button key={n} onClick={() => set('hospitalizations', n === '4+' ? 4 : n)}
                style={{ flex: 1, padding: '10px 4px', borderRadius: 8, border: `2px solid ${form.hospitalizations === (n === '4+' ? 4 : n) ? '#DC2626' : 'var(--border)'}`, background: form.hospitalizations === (n === '4+' ? 4 : n) ? '#FEF2F2' : 'var(--card-bg)', fontSize: 16, fontWeight: 700, color: form.hospitalizations === (n === '4+' ? 4 : n) ? '#DC2626' : 'var(--gray)', cursor: 'pointer', fontFamily: 'DM Mono, monospace' }}>
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Auth issues */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6 }}>
            🔐 Auth Issues to Flag <span style={{ fontWeight: 400, color: 'var(--gray)' }}>(leave blank if none)</span>
          </label>
          <input value={form.auth_issues} onChange={e => set('auth_issues', e.target.value)}
            placeholder="e.g. Smith auth denied, Johnson renewal pending..."
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, outline: 'none', background: 'var(--bg)', boxSizing: 'border-box' }} />
        </div>

        {/* Biggest blocker */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6 }}>
            ⚠ Biggest Blocker Today <span style={{ fontWeight: 400, color: 'var(--gray)' }}>(optional)</span>
          </label>
          <input value={form.biggest_blocker} onChange={e => set('biggest_blocker', e.target.value)}
            placeholder="What's slowing you down most today?"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, outline: 'none', background: 'var(--bg)', boxSizing: 'border-box' }} />
        </div>

        {/* Notes */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6 }}>
            📝 Additional Notes <span style={{ fontWeight: 400, color: 'var(--gray)' }}>(optional)</span>
          </label>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
            placeholder="Anything else the team needs to know today..."
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, outline: 'none', background: 'var(--bg)', boxSizing: 'border-box', resize: 'vertical', minHeight: 60 }} />
        </div>

        {msg && (
          <div style={{ padding: '8px 12px', borderRadius: 7, background: msg.startsWith('✓') ? '#ECFDF5' : '#FEF2F2', color: msg.startsWith('✓') ? '#065F46' : '#DC2626', fontSize: 12, fontWeight: 700 }}>
            {msg}
          </div>
        )}
      </div>
      <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, background: 'var(--bg)' }}>
        <button onClick={onCancel} style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, cursor: 'pointer', background: 'var(--card-bg)' }}>Cancel</button>
        <button onClick={submit} disabled={saving}
          style={{ flex: 1, padding: '10px 22px', background: '#1565C0', color: '#fff', border: 'none', borderRadius: 7, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          {saving ? 'Submitting…' : '✓ Submit Check-In'}
        </button>
      </div>
    </div>
  );
}

export default function DailyReportsPage() {
  const { profile } = useAuth();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filterDate, setFilterDate] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('daily_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    setReports(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const alreadySubmittedToday = reports.some(r =>
    r.report_date === today && r.coordinator_id === profile?.id
  );

  const filtered = filterDate ? reports.filter(r => r.report_date === filterDate) : reports;

  // Summary for today
  const todayReports = reports.filter(r => r.report_date === today);
  const todaySummary = {
    submissions: todayReports.length,
    totalContacts: todayReports.reduce((s, r) => s + (r.contact_attempts || 0), 0),
    totalOnHold: todayReports.reduce((s, r) => s + (r.on_hold_reached || 0), 0),
    totalHosp: todayReports.reduce((s, r) => s + (r.hospitalizations || 0), 0),
    blockers: todayReports.filter(r => r.biggest_blocker).map(r => ({ name: r.submitted_by_name, blocker: r.biggest_blocker })),
    authIssues: todayReports.filter(r => r.auth_issues).map(r => ({ name: r.submitted_by_name, issue: r.auth_issues })),
  };

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Daily Reports" subtitle="Loading..." />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray)' }}>Loading...</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <TopBar
        title="Daily Check-Ins"
        subtitle={`${todaySummary.submissions} submitted today · ${reports.length} total`}
        actions={
          !alreadySubmittedToday && (
            <button onClick={() => setShowForm(true)}
              style={{ padding: '7px 16px', background: '#1565C0', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              📋 Submit Today's Check-In
            </button>
          )
        }
      />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Check-in form */}
          {showForm && (
            <CheckInForm
              profile={profile}
              onSaved={() => { setShowForm(false); load(); }}
              onCancel={() => setShowForm(false)}
            />
          )}

          {alreadySubmittedToday && (
            <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10, padding: '12px 16px', fontSize: 13, fontWeight: 700, color: '#065F46' }}>
              ✅ You've already submitted today's check-in. Come back tomorrow!
            </div>
          )}

          {/* Today's summary (admin view) */}
          {['super_admin', 'admin'].includes(profile?.role) && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>
                Today's Team Summary — {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
                {[
                  { label: 'Check-Ins Received', val: todaySummary.submissions, color: '#1565C0', bg: '#EFF6FF', sub: 'of team submitted' },
                  { label: '📞 Patient Contacts', val: todaySummary.totalContacts, color: '#059669', bg: '#ECFDF5', sub: 'total attempts' },
                  { label: '🔄 On-Hold Reached', val: todaySummary.totalOnHold, color: '#7C3AED', bg: '#F5F3FF', sub: 'patients re-engaged' },
                  { label: '🏥 Hospitalizations', val: todaySummary.totalHosp, color: todaySummary.totalHosp > 0 ? '#DC2626' : '#059669', bg: todaySummary.totalHosp > 0 ? '#FEF2F2' : '#ECFDF5', sub: 'reported today' },
                ].map(c => (
                  <div key={c.label} style={{ background: c.bg, border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: c.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</div>
                    <div style={{ fontSize: 28, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: c.color, marginTop: 2 }}>{c.val}</div>
                    <div style={{ fontSize: 9, color: 'var(--gray)' }}>{c.sub}</div>
                  </div>
                ))}
              </div>
              {todaySummary.blockers.length > 0 && (
                <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, padding: 12, marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', marginBottom: 6 }}>⚠ Blockers Reported Today</div>
                  {todaySummary.blockers.map((b, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--black)', marginBottom: 3 }}>
                      <span style={{ fontWeight: 700, color: '#92400E' }}>{b.name}:</span> {b.blocker}
                    </div>
                  ))}
                </div>
              )}
              {todaySummary.authIssues.length > 0 && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#DC2626', marginBottom: 6 }}>🔐 Auth Issues Flagged</div>
                  {todaySummary.authIssues.map((a, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--black)', marginBottom: 3 }}>
                      <span style={{ fontWeight: 700, color: '#DC2626' }}>{a.name}:</span> {a.issue}
                    </div>
                  ))}
                </div>
              )}
              {todaySummary.submissions === 0 && (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--gray)', fontSize: 12 }}>
                  No check-ins submitted yet today. Coordinators should submit by 9 AM.
                </div>
              )}
            </div>
          )}

          {/* History */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Submission History</div>
            <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
              style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, outline: 'none', background: 'var(--card-bg)' }} />
            {filterDate && <button onClick={() => setFilterDate('')} style={{ fontSize: 10, color: 'var(--gray)', background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer' }}>Clear</button>}
            <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gray)' }}>{filtered.length} entries</div>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>No check-ins submitted yet</div>
              <div style={{ fontSize: 12 }}>Coordinators use the Submit button above to log their daily activity</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.map(r => (
                <div key={r.id} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{r.submitted_by_name || '—'}</div>
                      <div style={{ fontSize: 10, color: 'var(--gray)' }}>{fmtDate(r.report_date)} · Submitted {fmtTime(r.submitted_at)}{r.region ? ` · Regions ${r.region}` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
                      {r.contact_attempts > 0 && <span style={{ color: '#059669', fontWeight: 700 }}>📞 {r.contact_attempts} contacts</span>}
                      {r.on_hold_reached > 0 && <span style={{ color: '#7C3AED', fontWeight: 700 }}>🔄 {r.on_hold_reached} on-hold reached</span>}
                      {r.hospitalizations > 0 && <span style={{ color: '#DC2626', fontWeight: 700 }}>🏥 {r.hospitalizations} hosp</span>}
                    </div>
                  </div>
                  {(r.auth_issues || r.biggest_blocker || r.notes) && (
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {r.auth_issues && <div style={{ fontSize: 11, color: '#DC2626' }}>🔐 Auth: {r.auth_issues}</div>}
                      {r.biggest_blocker && <div style={{ fontSize: 11, color: '#D97706' }}>⚠ Blocker: {r.biggest_blocker}</div>}
                      {r.notes && <div style={{ fontSize: 11, color: 'var(--gray)' }}>📝 {r.notes}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
