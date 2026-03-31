import React, { useState, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { REGIONS } from '../../lib/constants';

const STATUS_COLORS = {
  completed: { bg: '#ECFDF5', color: '#065F46' },
  scheduled: { bg: '#EFF6FF', color: '#1E40AF' },
  missed: { bg: '#FEF3C7', color: '#92400E' },
  cancelled: { bg: '#FEF2F2', color: '#991B1B' },
};

function StatusPill({ status }) {
  const s = status?.toLowerCase() || '';
  const match = Object.entries(STATUS_COLORS).find(([k]) => s.includes(k));
  const style = match ? match[1] : { bg: '#F3F4F6', color: '#374151' };
  return (
    <span style={{ background: style.bg, color: style.color, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {status || '—'}
    </span>
  );
}

const VIEW_OPTIONS = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All' },
];

function parseVisitDate(raw) {
  if (!raw) return null;
  const cleaned = raw.trim();
  const d = new Date(cleaned);
  return isNaN(d) ? null : d;
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function isSameWeek(d, ref) {
  const startOfWeek = new Date(ref);
  startOfWeek.setDate(ref.getDate() - ref.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);
  return d >= startOfWeek && d <= endOfWeek;
}

function isSameMonth(d, ref) {
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

export default function VisitSchedulePage() {
  const [timeView, setTimeView] = useState('week');
  const [regionFilter, setRegionFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());

  const visits = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('axiom_pariox_data') || '[]'); } catch { return []; }
  }, []);

  const validRegions = ['A','B','C','G','H','J','M','N','T','V'];

  const filtered = useMemo(() => {
    return visits.filter(v => {
      if (!validRegions.includes(v.region)) return false;
      if (regionFilter !== 'ALL' && v.region !== regionFilter) return false;
      if (statusFilter !== 'ALL' && !v.status?.toLowerCase().includes(statusFilter.toLowerCase())) return false;
      if (search && !v.patient_name?.toLowerCase().includes(search.toLowerCase()) &&
          !v.staff_name?.toLowerCase().includes(search.toLowerCase())) return false;

      if (timeView === 'all') return true;
      const d = parseVisitDate(v.raw_date);
      if (!d) return false;
      if (timeView === 'day') return isSameDay(d, selectedDate);
      if (timeView === 'week') return isSameWeek(d, selectedDate);
      if (timeView === 'month') return isSameMonth(d, selectedDate);
      return true;
    });
  }, [visits, regionFilter, statusFilter, search, timeView, selectedDate]);

  const completedCount = filtered.filter(v => v.status?.toLowerCase().includes('completed')).length;
  const scheduledCount = filtered.filter(v => v.status?.toLowerCase().includes('scheduled')).length;

  const regions = useMemo(() =>
    ['ALL', ...new Set(visits.filter(v => validRegions.includes(v.region)).map(v => v.region)).values()].sort(),
    [visits]);

  function navDate(dir) {
    const d = new Date(selectedDate);
    if (timeView === 'day') d.setDate(d.getDate() + dir);
    else if (timeView === 'week') d.setDate(d.getDate() + dir * 7);
    else if (timeView === 'month') d.setMonth(d.getMonth() + dir);
    setSelectedDate(d);
  }

  function getDateLabel() {
    if (timeView === 'day') return selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    if (timeView === 'week') {
      const start = new Date(selectedDate);
      start.setDate(selectedDate.getDate() - selectedDate.getDay());
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    if (timeView === 'month') return selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return 'All Time';
  }

  if (visits.length === 0) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Visit Schedule" subtitle="No data loaded" />
      <div style={S.empty}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📅</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>No visit data loaded</div>
        <div style={{ color: 'var(--gray)', fontSize: 14, marginTop: 8 }}>Upload your Pariox visit schedule in Data Uploads</div>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Visit Schedule"
        subtitle={`${filtered.length} visits · ${completedCount} completed · ${scheduledCount} scheduled`}
      />
      <div style={{ padding: '16px 28px', flex: 1, overflow: 'auto' }}>

        {/* Time view tabs */}
        <div style={S.toolbar}>
          <div style={S.tabs}>
            {VIEW_OPTIONS.map(v => (
              <button
                key={v.key}
                onClick={() => setTimeView(v.key)}
                style={{ ...S.tab, ...(timeView === v.key ? S.tabActive : {}) }}
              >
                {v.label}
              </button>
            ))}
          </div>

          {timeView !== 'all' && (
            <div style={S.dateNav}>
              <button onClick={() => navDate(-1)} style={S.navBtn}>←</button>
              <span style={S.dateLabel}>{getDateLabel()}</span>
              <button onClick={() => navDate(1)} style={S.navBtn}>→</button>
              <button onClick={() => setSelectedDate(new Date())} style={S.todayBtn}>Today</button>
            </div>
          )}
        </div>

        {/* KPI row */}
        <div style={S.kpiRow}>
          {[
            ['Total', filtered.length, 'var(--black)'],
            ['Completed', completedCount, 'var(--green)'],
            ['Scheduled', scheduledCount, 'var(--blue)'],
            ['Missed', filtered.filter(v => v.status?.toLowerCase().includes('missed')).length, 'var(--yellow)'],
            ['Cancelled', filtered.filter(v => v.status?.toLowerCase().includes('cancelled')).length, 'var(--danger)'],
          ].map(([label, val, color]) => (
            <div key={label} style={S.kpiCard}>
              <div style={S.kpiLabel}>{label}</div>
              <div style={{ ...S.kpiVal, color }}>{val}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={S.filterRow}>
          <input
            placeholder="Search patient or clinician..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={S.search}
          />
          <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} style={S.select}>
            {regions.map(r => <option key={r} value={r}>{r === 'ALL' ? 'All Regions' : `Region ${r} — ${REGIONS[r] || ''}`}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={S.select}>
            <option value="ALL">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="scheduled">Scheduled</option>
            <option value="missed">Missed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {/* Visit Table */}
        {filtered.length === 0 ? (
          <div style={S.empty}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
            <div style={{ fontWeight: 600, color: 'var(--black)' }}>No visits found</div>
            <div style={{ color: 'var(--gra
