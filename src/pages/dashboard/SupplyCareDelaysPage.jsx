// SupplyCareDelaysPage.jsx
//
// Log + triage supply-caused care delays. This is the counter-balance KPI
// data source — without it, "cheapest way to win" is to under-supply
// clinicians (the Scaling Up warning Liam's brief flagged).
//
// Two halves:
//   1. Log form at the top — quick entry, defaults to today
//   2. Recent delays list below — last 90 days, sortable, filterable
//
// Open delays show a "Resolve" action that records who closed it and when.
//
// CLAUDE.md compliance: ASCII only.

import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

const REGIONS = ['A','B','C','G','H','J','M','N','T','V'];
const SEVERITIES = [
  { key: 'rescheduled', label: 'Visit rescheduled', color: '#7F1D1D', bg: '#FEE2E2' },
  { key: 'workaround',  label: 'Workaround used',   color: '#9A3412', bg: '#FFEDD5' },
  { key: 'partial',     label: 'Partial care',      color: '#92400E', bg: '#FEF3C7' },
];

const EMPTY = {
  delay_date: new Date().toISOString().slice(0, 10),
  patient_name: '', region: '', clinician_name: '',
  missing_item: '', severity: 'rescheduled', caused_visit_skip: false,
  notes: '',
};

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtDateTime(s) {
  if (!s) return '-';
  return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function SupplyCareDelaysPage() {
  const { profile } = useAuth();
  const [delays, setDelays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [filterRegion, setFilterRegion] = useState('ALL');
  const [filterSeverity, setFilterSeverity] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('open'); // open | all | resolved

  async function load() {
    setLoading(true);
    const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const rows = await fetchAllPages(supabase.from('supply_care_delays').select('*')
      .gte('delay_date', since)
      .order('delay_date', { ascending: false }));
    setDelays(rows || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  useRealtimeTable(['supply_care_delays'], load);

  function set(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    if (!form.missing_item.trim()) {
      setErr('Missing item is required.');
      return;
    }
    setSaving(true); setErr('');
    const payload = { ...form,
      patient_name: form.patient_name.trim() || null,
      region: form.region || null,
      clinician_name: form.clinician_name.trim() || null,
      missing_item: form.missing_item.trim(),
      notes: form.notes.trim() || null,
      reported_by: profile?.full_name || profile?.email || null,
    };
    const { error } = await supabase.from('supply_care_delays').insert(payload);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setForm({ ...EMPTY });
    setShowForm(false);
    load();
  }

  async function resolve(id) {
    const { error } = await supabase.from('supply_care_delays')
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: profile?.full_name || profile?.email || null,
      })
      .eq('id', id);
    if (error) { console.error(error.message); return; }
    load();
  }
  async function reopen(id) {
    const { error } = await supabase.from('supply_care_delays')
      .update({ resolved_at: null, resolved_by: null })
      .eq('id', id);
    if (error) { console.error(error.message); return; }
    load();
  }

  const filtered = useMemo(() => {
    let out = delays;
    if (filterStatus === 'open')     out = out.filter(d => !d.resolved_at);
    if (filterStatus === 'resolved') out = out.filter(d => d.resolved_at);
    if (filterRegion !== 'ALL')      out = out.filter(d => d.region === filterRegion);
    if (filterSeverity !== 'ALL')    out = out.filter(d => d.severity === filterSeverity);
    return out;
  }, [delays, filterStatus, filterRegion, filterSeverity]);

  const stats = useMemo(() => ({
    last30: delays.filter(d => new Date(d.delay_date) > new Date(Date.now() - 30 * 86400000)).length,
    open: delays.filter(d => !d.resolved_at).length,
    causedSkip: delays.filter(d => d.caused_visit_skip).length,
  }), [delays]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <TopBar title="Supply Care Delays"
        subtitle="Log when a missing item caused a reschedule, workaround, or partial care. Drives counter-balance KPI." />

      <div style={{ padding: '14px 20px' }}>

        {/* KPI strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
          <StatTile label="Last 30 days" value={stats.last30} color="#1F2937" />
          <StatTile label="Open / unresolved" value={stats.open} color={stats.open > 0 ? '#7F1D1D' : '#065F46'} />
          <StatTile label="Caused visit skip" value={stats.causedSkip} color={stats.causedSkip > 0 ? '#7F1D1D' : '#065F46'} />
        </div>

        {/* Log button + form */}
        <div style={{ marginBottom: 14 }}>
          {!showForm && (
            <button onClick={() => setShowForm(true)}
              style={{ padding: '10px 18px', background: '#0F1117', color: '#fff',
                border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + Log a care delay
            </button>
          )}
          {showForm && (
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                <Field label="When">
                  <input type="date" value={form.delay_date}
                    onChange={e => set('delay_date', e.target.value)}
                    style={inputStyle()} />
                </Field>
                <Field label="Patient">
                  <input value={form.patient_name} onChange={e => set('patient_name', e.target.value)}
                    placeholder="Last, First" style={inputStyle()} />
                </Field>
                <Field label="Region">
                  <select value={form.region} onChange={e => set('region', e.target.value)} style={inputStyle()}>
                    <option value="">- region -</option>
                    {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
                  </select>
                </Field>
                <Field label="Clinician">
                  <input value={form.clinician_name} onChange={e => set('clinician_name', e.target.value)}
                    placeholder="(optional)" style={inputStyle()} />
                </Field>
                <Field label="Missing item *" span={2}>
                  <input value={form.missing_item} onChange={e => set('missing_item', e.target.value)}
                    placeholder="e.g. LE Class 2 compression, size M"
                    style={inputStyle()} />
                </Field>
                <Field label="Severity">
                  <select value={form.severity} onChange={e => set('severity', e.target.value)} style={inputStyle()}>
                    {SEVERITIES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </Field>
                <Field label="Caused visit skip?">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0' }}>
                    <input type="checkbox" checked={form.caused_visit_skip}
                      onChange={e => set('caused_visit_skip', e.target.checked)} />
                    <span style={{ fontSize: 12 }}>Yes - visit could not happen</span>
                  </label>
                </Field>
                <Field label="Notes" span={2}>
                  <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                    placeholder="What happened, what was the workaround, who needs to follow up"
                    style={{ ...inputStyle(), minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }} />
                </Field>
              </div>

              {err && (
                <div style={{ marginTop: 10, padding: '8px 10px', background: '#FEF2F2',
                  color: '#991B1B', fontSize: 12, borderRadius: 6, border: '1px solid #FECACA' }}>{err}</div>
              )}

              <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => { setShowForm(false); setForm({ ...EMPTY }); setErr(''); }}
                  style={{ padding: '8px 16px', border: '1px solid #E5E7EB', background: '#fff',
                    borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={save} disabled={saving}
                  style={{ padding: '8px 18px', border: 'none', background: saving ? '#9CA3AF' : '#0F1117',
                    color: '#fff', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: saving ? 'wait' : 'pointer' }}>
                  {saving ? 'Saving...' : 'Log delay'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Filters */}
        <div style={{ marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['open', 'all', 'resolved'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              style={{ padding: '6px 12px', border: `1px solid ${filterStatus === s ? '#0F1117' : '#E5E7EB'}`,
                background: filterStatus === s ? '#0F1117' : '#fff',
                color: filterStatus === s ? '#fff' : '#1F2937',
                borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                textTransform: 'capitalize' }}>{s}</button>
          ))}
          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, background: '#fff' }}>
            <option value="ALL">All regions</option>
            {REGIONS.map(r => <option key={r} value={r}>Region {r}</option>)}
          </select>
          <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, background: '#fff' }}>
            <option value="ALL">All severities</option>
            {SEVERITIES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: '#6B7280', alignSelf: 'center' }}>
            Showing {filtered.length} of {delays.length}
          </div>
        </div>

        {/* List */}
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 60px 1.5fr 140px 90px 120px',
            gap: 8, padding: '10px 12px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB',
            fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <div>Date</div><div>Patient</div><div>Rgn</div><div>Missing item</div>
            <div>Severity</div><div>Skip?</div><div>Action</div>
          </div>
          {loading && <div style={{ padding: 24, textAlign: 'center', color: '#9CA3AF' }}>Loading...</div>}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center', color: '#065F46',
              background: '#ECFDF5', fontSize: 13 }}>
              No delays match the filters. (Filter status: {filterStatus})
            </div>
          )}
          {filtered.map((d, i) => {
            const sev = SEVERITIES.find(s => s.key === d.severity) || SEVERITIES[0];
            return (
              <div key={d.id} style={{ display: 'grid',
                gridTemplateColumns: '90px 1fr 60px 1.5fr 140px 90px 120px',
                gap: 8, padding: '10px 12px', fontSize: 12,
                borderBottom: '1px solid #F3F4F6',
                background: i % 2 === 0 ? '#fff' : '#FAFAFA',
                opacity: d.resolved_at ? 0.6 : 1, alignItems: 'center' }}>
                <div style={{ color: '#6B7280' }}>{fmtDate(d.delay_date)}</div>
                <div>
                  <div style={{ fontWeight: 600 }}>{d.patient_name || '-'}</div>
                  {d.clinician_name && <div style={{ fontSize: 10, color: '#6B7280' }}>{d.clinician_name}</div>}
                </div>
                <div style={{ fontWeight: 700, fontFamily: 'DM Mono, monospace' }}>{d.region || '-'}</div>
                <div>
                  <div>{d.missing_item}</div>
                  {d.notes && <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>{d.notes}</div>}
                </div>
                <div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: sev.color,
                    background: sev.bg, padding: '2px 8px', borderRadius: 999 }}>{sev.label}</span>
                </div>
                <div style={{ fontSize: 11, color: d.caused_visit_skip ? '#7F1D1D' : '#6B7280',
                  fontWeight: d.caused_visit_skip ? 700 : 400 }}>
                  {d.caused_visit_skip ? 'YES' : 'No'}
                </div>
                <div>
                  {d.resolved_at ? (
                    <div>
                      <button onClick={() => reopen(d.id)}
                        style={{ fontSize: 10, color: '#1565C0', background: 'none',
                          border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                        reopen
                      </button>
                      <div style={{ fontSize: 9, color: '#6B7280' }}>{fmtDateTime(d.resolved_at)}</div>
                    </div>
                  ) : (
                    <button onClick={() => resolve(d.id)}
                      style={{ padding: '4px 10px', background: '#065F46', color: '#fff',
                        border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                      Resolve
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, span = 1 }) {
  return (
    <div style={{ gridColumn: 'span ' + span }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280',
        textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
function inputStyle() {
  return {
    width: '100%', padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: 6,
    fontSize: 12, outline: 'none', background: '#fff', boxSizing: 'border-box',
  };
}
function StatTile({ label, value, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280',
        textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: 'DM Mono, monospace', marginTop: 2 }}>{value}</div>
    </div>
  );
}
