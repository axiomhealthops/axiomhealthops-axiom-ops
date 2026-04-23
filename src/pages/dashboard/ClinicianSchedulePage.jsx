import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import TopBar from '../../components/TopBar';
import { REGIONS } from '../../lib/constants';
import { useAuth } from '../../hooks/useAuth';
import ScheduleVisitModal from '../../components/ScheduleVisitModal';

/* ── helpers ─────────────────────────────────────────────── */
function pad(n) { return String(n).padStart(2, '0'); }
function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
function fmtDate(s) {
  if (!s) return '—';
  var d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
function startOfWeek(d) { var day = d.getDay(); return addDays(d, -day); }
function getWeekDays(anchor) {
  var s = startOfWeek(anchor);
  var days = [];
  for (var i = 0; i < 7; i++) days.push(addDays(s, i));
  return days;
}

var STATUS_COLORS = {
  scheduled:  { bg: '#EFF6FF', color: '#1E40AF', border: '#93C5FD' },
  confirmed:  { bg: '#F0FDF4', color: '#166534', border: '#86EFAC' },
  completed:  { bg: '#ECFDF5', color: '#065F46', border: '#6EE7B7' },
  cancelled:  { bg: '#FEF2F2', color: '#991B1B', border: '#FCA5A5' },
  no_show:    { bg: '#FEF3C7', color: '#92400E', border: '#FCD34D' },
  rescheduled:{ bg: '#FFF7ED', color: '#9A3412', border: '#FDBA74' },
};

var VISIT_TYPE_LABELS = {
  routine: 'Routine', eval: 'Evaluation', reassessment: 'Reassess',
  follow_up: 'Follow-Up', wound_care: 'Wound Care',
  supervisory: 'Supervisory', discharge: 'Discharge',
};

/* ── main component ──────────────────────────────────────── */
export default function ClinicianSchedulePage() {
  var { profile } = useAuth();
  var [visits, setVisits] = useState([]);
  var [clinicians, setClinicians] = useState([]);
  var [loading, setLoading] = useState(true);

  // Filters
  var [clinicianId, setClinicianId] = useState('');
  var [regionFilter, setRegionFilter] = useState('');
  var [statusFilter, setStatusFilter] = useState('');
  var [view, setView] = useState('week');        // 'day' | 'week' | 'list'
  var [anchor, setAnchor] = useState(new Date());
  var [search, setSearch] = useState('');

  // Schedule modal
  var [scheduleModal, setScheduleModal] = useState(null); // { patient, existingVisit? }

  /* ── data loading ──────────────────────────────────── */
  useEffect(function() { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    var [vRes, cRes] = await Promise.all([
      supabase.from('scheduled_visits').select('*').in('status', ['scheduled','confirmed','completed','cancelled','no_show','rescheduled']).order('visit_date'),
      supabase.from('clinicians').select('id, full_name, discipline, region, is_active').eq('is_active', true).order('full_name'),
    ]);
    setVisits(vRes.data || []);
    setClinicians(cRes.data || []);
    setLoading(false);
  }

  // Realtime
  useEffect(function() {
    var chan = supabase.channel('clinician-schedule-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scheduled_visits' }, function() { loadData(); })
      .subscribe();
    return function() { supabase.removeChannel(chan); };
  }, []);

  /* ── filtering ─────────────────────────────────────── */
  var filtered = useMemo(function() {
    var list = visits;
    if (clinicianId) list = list.filter(function(v) { return v.clinician_id === clinicianId; });
    if (regionFilter) list = list.filter(function(v) { return v.region === regionFilter; });
    if (statusFilter) list = list.filter(function(v) { return v.status === statusFilter; });
    if (search) {
      var q = search.toLowerCase();
      list = list.filter(function(v) {
        return (v.patient_name || '').toLowerCase().includes(q) ||
               (v.clinician_name || '').toLowerCase().includes(q);
      });
    }
    return list;
  }, [visits, clinicianId, regionFilter, statusFilter, search]);

  /* ── date-range views ──────────────────────────────── */
  var dateRange = useMemo(function() {
    if (view === 'day') return [toISO(anchor)];
    if (view === 'week') return getWeekDays(anchor).map(toISO);
    return null; // list = all
  }, [view, anchor]);

  var visibleVisits = useMemo(function() {
    if (!dateRange) return filtered;
    var set = {};
    dateRange.forEach(function(d) { set[d] = true; });
    return filtered.filter(function(v) { return set[v.visit_date]; });
  }, [filtered, dateRange]);

  // Group by date
  var byDate = useMemo(function() {
    var map = {};
    visibleVisits.forEach(function(v) {
      if (!map[v.visit_date]) map[v.visit_date] = [];
      map[v.visit_date].push(v);
    });
    return map;
  }, [visibleVisits]);

  // Group by clinician (for week grid)
  var byClinician = useMemo(function() {
    var map = {};
    visibleVisits.forEach(function(v) {
      var key = v.clinician_id || 'unassigned';
      if (!map[key]) map[key] = { name: v.clinician_name || 'Unassigned', visits: [] };
      map[key].visits.push(v);
    });
    return map;
  }, [visibleVisits]);

  /* ── stats ─────────────────────────────────────────── */
  var stats = useMemo(function() {
    var s = { total: visibleVisits.length, scheduled: 0, confirmed: 0, completed: 0, cancelled: 0, no_show: 0 };
    visibleVisits.forEach(function(v) { if (s[v.status] !== undefined) s[v.status]++; });
    return s;
  }, [visibleVisits]);

  /* ── actions ───────────────────────────────────────── */
  async function updateVisitStatus(visitId, newStatus, reason) {
    var update = { status: newStatus, updated_at: new Date().toISOString() };
    if (reason) update.cancelled_reason = reason;
    await supabase.from('scheduled_visits').update(update).eq('id', visitId);
  }

  function navPrev() {
    if (view === 'day') setAnchor(addDays(anchor, -1));
    else if (view === 'week') setAnchor(addDays(anchor, -7));
  }
  function navNext() {
    if (view === 'day') setAnchor(addDays(anchor, 1));
    else if (view === 'week') setAnchor(addDays(anchor, 7));
  }
  function navToday() { setAnchor(new Date()); }

  /* ── clinician list for filter ─────────────────────── */
  var filteredClinicians = useMemo(function() {
    if (!regionFilter) return clinicians;
    return clinicians.filter(function(c) { return c.region === regionFilter || c.region === 'All' || (c.region && c.region.split(',').map(function(r){return r.trim();}).includes(regionFilter)); });
  }, [clinicians, regionFilter]);

  /* ── render ────────────────────────────────────────── */
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray)' }}>Loading schedule…</div>;

  var today = toISO(new Date());

  return (
    <div>
      <TopBar title="Clinician Schedule" subtitle={'📅 ' + visibleVisits.length + ' visits in view'} />

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 10, padding: '12px 20px', flexWrap: 'wrap' }}>
        {[
          { label: 'Total', val: stats.total, color: '#374151' },
          { label: 'Scheduled', val: stats.scheduled, color: '#1E40AF' },
          { label: 'Confirmed', val: stats.confirmed, color: '#166534' },
          { label: 'Completed', val: stats.completed, color: '#065F46' },
          { label: 'Cancelled', val: stats.cancelled, color: '#991B1B' },
          { label: 'No Show', val: stats.no_show, color: '#92400E' },
        ].map(function(s) {
          return (
            <div key={s.label} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px', minWidth: 90, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 2 }}>{s.label}</div>
            </div>
          );
        })}
      </div>

      {/* Filters + Navigation */}
      <div style={{ display: 'flex', gap: 8, padding: '0 20px 12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search */}
        <input placeholder="Search patient or clinician…" value={search} onChange={function(e) { setSearch(e.target.value); }}
          style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, width: 200, background: 'var(--card-bg)', outline: 'none' }} />

        {/* Region filter */}
        <select value={regionFilter} onChange={function(e) { setRegionFilter(e.target.value); setClinicianId(''); }}
          style={SEL}>
          <option value="">All Regions</option>
          {REGIONS.map(function(r) { return <option key={r} value={r}>Region {r}</option>; })}
        </select>

        {/* Clinician filter */}
        <select value={clinicianId} onChange={function(e) { setClinicianId(e.target.value); }}
          style={SEL}>
          <option value="">All Clinicians</option>
          {filteredClinicians.map(function(c) { return <option key={c.id} value={c.id}>{c.full_name} ({c.discipline})</option>; })}
        </select>

        {/* Status filter */}
        <select value={statusFilter} onChange={function(e) { setStatusFilter(e.target.value); }}
          style={SEL}>
          <option value="">All Statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="no_show">No Show</option>
        </select>

        <div style={{ flex: 1 }} />

        {/* View toggle */}
        {['day', 'week', 'list'].map(function(v) {
          return (
            <button key={v} onClick={function() { setView(v); }}
              style={{ ...BTN, background: view === v ? '#059669' : 'var(--card-bg)', color: view === v ? '#fff' : 'var(--black)', fontWeight: view === v ? 700 : 400, fontSize: 11, textTransform: 'capitalize' }}>
              {v}
            </button>
          );
        })}

        {/* Date nav (day/week only) */}
        {view !== 'list' && (
          <>
            <button onClick={navPrev} style={BTN}>‹</button>
            <button onClick={navToday} style={{ ...BTN, fontWeight: 600, fontSize: 11 }}>Today</button>
            <button onClick={navNext} style={BTN}>›</button>
          </>
        )}
      </div>

      {/* Date header */}
      {view !== 'list' && (
        <div style={{ padding: '0 20px 8px', fontSize: 14, fontWeight: 700, color: 'var(--black)' }}>
          {view === 'day' ? anchor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
            : 'Week of ' + startOfWeek(anchor).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' – ' + addDays(startOfWeek(anchor), 6).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      )}

      {/* ── WEEK VIEW ── */}
      {view === 'week' && (
        <div style={{ padding: '0 20px 20px', overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(140px, 1fr))', gap: 1, background: 'var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            {/* Day headers */}
            {getWeekDays(anchor).map(function(day) {
              var ds = toISO(day);
              var isToday = ds === today;
              return (
                <div key={ds} style={{ background: isToday ? '#F0FDF4' : 'var(--bg)', padding: '8px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase' }}>
                    {day.toLocaleDateString('en-US', { weekday: 'short' })}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: isToday ? 800 : 500, color: isToday ? '#059669' : 'var(--black)' }}>
                    {day.getDate()}
                  </div>
                </div>
              );
            })}

            {/* Visit cells */}
            {getWeekDays(anchor).map(function(day) {
              var ds = toISO(day);
              var dayVisits = byDate[ds] || [];
              var isToday = ds === today;
              return (
                <div key={ds + '-body'} style={{ background: isToday ? '#FAFFF9' : 'var(--card-bg)', padding: 6, minHeight: 100, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {dayVisits.length === 0 && <div style={{ fontSize: 10, color: 'var(--gray)', textAlign: 'center', marginTop: 16 }}>No visits</div>}
                  {dayVisits.map(function(v) {
                    var sc = STATUS_COLORS[v.status] || STATUS_COLORS.scheduled;
                    return (
                      <div key={v.id} style={{ background: sc.bg, border: '1px solid ' + sc.border, borderRadius: 6, padding: '5px 7px', fontSize: 10, cursor: 'pointer' }}
                        onClick={function() { setScheduleModal({ patient: { patient_name: v.patient_name, region: v.region }, existingVisit: v }); }}>
                        <div style={{ fontWeight: 700, color: sc.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {v.patient_name}
                        </div>
                        <div style={{ color: sc.color, opacity: 0.8, marginTop: 1 }}>
                          {v.visit_time || 'Flex'} · {VISIT_TYPE_LABELS[v.visit_type] || v.visit_type}
                        </div>
                        <div style={{ color: sc.color, opacity: 0.6, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {v.clinician_name}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── DAY VIEW ── */}
      {view === 'day' && (
        <div style={{ padding: '0 20px 20px' }}>
          {visibleVisits.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)', fontSize: 14 }}>No visits scheduled for this day.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {visibleVisits.sort(function(a,b) { return (a.visit_time || 'ZZ').localeCompare(b.visit_time || 'ZZ'); }).map(function(v) {
              var sc = STATUS_COLORS[v.status] || STATUS_COLORS.scheduled;
              return (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px' }}>
                  {/* Time */}
                  <div style={{ width: 70, fontSize: 13, fontWeight: 700, color: 'var(--black)', flexShrink: 0, textAlign: 'center' }}>
                    {v.visit_time || 'Flex'}
                  </div>
                  {/* Status pill */}
                  <div style={{ background: sc.bg, color: sc.color, border: '1px solid ' + sc.border, borderRadius: 20, padding: '2px 10px', fontSize: 10, fontWeight: 700, flexShrink: 0, textTransform: 'capitalize' }}>
                    {(v.status || '').replace(/_/g, ' ')}
                  </div>
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>{v.patient_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 1 }}>
                      {VISIT_TYPE_LABELS[v.visit_type] || v.visit_type} · {v.clinician_name} · Rgn {v.region || '—'}
                    </div>
                    {v.notes && <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 2, fontStyle: 'italic' }}>{v.notes}</div>}
                  </div>
                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {v.status === 'scheduled' && (
                      <>
                        <button onClick={function() { updateVisitStatus(v.id, 'confirmed'); }} style={{ ...ABTN, background: '#059669', color: '#fff' }} title="Confirm">✓</button>
                        <button onClick={function() { updateVisitStatus(v.id, 'completed'); }} style={{ ...ABTN, background: '#1E40AF', color: '#fff' }} title="Complete">✔</button>
                        <button onClick={function() { setScheduleModal({ patient: { patient_name: v.patient_name, region: v.region }, existingVisit: v }); }} style={{ ...ABTN }} title="Edit">✎</button>
                        <button onClick={function() { if (confirm('Cancel this visit?')) updateVisitStatus(v.id, 'cancelled', 'Cancelled by coordinator'); }} style={{ ...ABTN, color: '#DC2626' }} title="Cancel">✕</button>
                      </>
                    )}
                    {v.status === 'confirmed' && (
                      <>
                        <button onClick={function() { updateVisitStatus(v.id, 'completed'); }} style={{ ...ABTN, background: '#1E40AF', color: '#fff' }} title="Complete">✔</button>
                        <button onClick={function() { updateVisitStatus(v.id, 'no_show'); }} style={{ ...ABTN, background: '#92400E', color: '#fff' }} title="No Show">✗</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── LIST VIEW ── */}
      {view === 'list' && (
        <div style={{ padding: '0 20px 20px' }}>
          {filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)', fontSize: 14 }}>No visits found.</div>}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 120px 80px 80px 60px 100px', gap: 0, padding: '8px 12px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <div>Date</div><div>Patient</div><div>Clinician</div><div>Type</div><div>Time</div><div>Region</div><div>Status</div><div>Actions</div>
            </div>
            {/* Rows */}
            {filtered.slice(0, 200).map(function(v) {
              var sc = STATUS_COLORS[v.status] || STATUS_COLORS.scheduled;
              var isPast = v.visit_date < today;
              return (
                <div key={v.id} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 120px 80px 80px 60px 100px', gap: 0, padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, alignItems: 'center', opacity: isPast && v.status === 'completed' ? 0.6 : 1 }}>
                  <div style={{ fontWeight: 600 }}>{fmtDate(v.visit_date)}</div>
                  <div style={{ fontWeight: 600, color: 'var(--black)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.patient_name}</div>
                  <div style={{ color: 'var(--gray)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.clinician_name}</div>
                  <div style={{ fontSize: 11 }}>{VISIT_TYPE_LABELS[v.visit_type] || v.visit_type}</div>
                  <div>{v.visit_time || 'Flex'}</div>
                  <div>{v.region || '—'}</div>
                  <div>
                    <span style={{ background: sc.bg, color: sc.color, border: '1px solid ' + sc.border, borderRadius: 20, padding: '1px 8px', fontSize: 9, fontWeight: 700, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
                      {(v.status || '').replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {v.status === 'scheduled' && (
                      <>
                        <button onClick={function() { updateVisitStatus(v.id, 'completed'); }} style={{ ...ABTN, fontSize: 10 }} title="Complete">✔</button>
                        <button onClick={function() { setScheduleModal({ patient: { patient_name: v.patient_name, region: v.region }, existingVisit: v }); }} style={{ ...ABTN, fontSize: 10 }} title="Edit">✎</button>
                        <button onClick={function() { if (confirm('Cancel?')) updateVisitStatus(v.id, 'cancelled', 'Cancelled'); }} style={{ ...ABTN, fontSize: 10, color: '#DC2626' }} title="Cancel">✕</button>
                      </>
                    )}
                    {v.status === 'confirmed' && (
                      <button onClick={function() { updateVisitStatus(v.id, 'completed'); }} style={{ ...ABTN, fontSize: 10 }} title="Complete">✔</button>
                    )}
                  </div>
                </div>
              );
            })}
            {filtered.length > 200 && (
              <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--gray)', textAlign: 'center' }}>Showing 200 of {filtered.length} visits. Use filters to narrow results.</div>
            )}
          </div>
        </div>
      )}

      {/* Schedule modal */}
      {scheduleModal && (
        <ScheduleVisitModal
          patient={scheduleModal.patient}
          coordinatorId={profile?.id}
          coordinatorName={profile?.full_name}
          existingVisit={scheduleModal.existingVisit}
          onClose={function() { setScheduleModal(null); }}
          onSaved={function() { setScheduleModal(null); loadData(); }}
        />
      )}
    </div>
  );
}

/* ── styles ──────────────────────────────────────────────── */
var SEL = { padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, background: 'var(--card-bg)', color: 'var(--black)', outline: 'none' };
var BTN = { padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--card-bg)', fontSize: 12, cursor: 'pointer', color: 'var(--black)' };
var ABTN = { padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 5, background: 'var(--card-bg)', fontSize: 12, cursor: 'pointer', color: 'var(--black)', lineHeight: 1 };
