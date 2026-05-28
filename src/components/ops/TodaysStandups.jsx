// TodaysStandups.jsx
//
// Surfaces today's three pre-generated ops reports (morning / midday / EOD)
// from daily_ops_reports. The pg_cron jobs and the daily-ops-report edge
// function are already running — this component just exposes what's
// already being written to the table.
//
// V1: today's three only. No history toggle.
// Each card collapsed by default. Click to expand the report_html inline.
//
// CLAUDE.md compliance: no inline unicode in JSX text.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

const SLOTS = [
  { key: 'morning_overview', label: 'Morning Brief',   scheduledHourLocal: '8:00 AM ET',
    color: '#1565C0', bg: '#EFF6FF', border: '#BFDBFE' },
  { key: 'midday_snapshot',  label: 'Midday Pulse',    scheduledHourLocal: '12:00 PM ET',
    color: '#92400E', bg: '#FEF3C7', border: '#FDE68A' },
  { key: 'eod_review',       label: 'End of Day',      scheduledHourLocal: '5:00 PM ET',
    color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
];

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
}

function StandupCard({ slot, report, expanded, onToggle }) {
  const generated = report?.created_at;
  const overdue = !report && new Date().getHours() >= parseInt(slot.scheduledHourLocal.split(':')[0]);
  return (
    <div style={{ background:'var(--card-bg)', border:`1px solid ${slot.border}`,
      borderRadius: 10, overflow: 'hidden' }}>
      <button onClick={() => report && onToggle(slot.key)}
        disabled={!report}
        style={{ width: '100%', padding: '10px 14px', background: slot.bg, border: 'none',
          cursor: report ? 'pointer' : 'default', textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: expanded ? `1px solid ${slot.border}` : 'none' }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6, background: slot.color, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800, flexShrink: 0,
        }}>{slot.label[0]}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: slot.color }}>{slot.label}</div>
          <div style={{ fontSize: 10, color: slot.color, opacity: 0.8, marginTop: 1 }}>
            {report ? ('generated ' + fmtTime(generated)) :
             overdue ? 'OVERDUE - scheduled ' + slot.scheduledHourLocal :
                       'scheduled ' + slot.scheduledHourLocal}
          </div>
        </div>
        {report && (
          <div style={{ fontSize: 16, color: slot.color, fontWeight: 800 }}>
            {expanded ? '-' : '+'}
          </div>
        )}
      </button>
      {expanded && report && (
        <div style={{ padding: 0, maxHeight: 600, overflow: 'auto' }}>
          {/* The edge function writes pre-rendered HTML to report_html — render it inline. */}
          <div style={{ padding: '14px 16px', fontSize: 12, lineHeight: 1.5 }}
            dangerouslySetInnerHTML={{ __html: report.report_html || summaryFallback(report.summary) }} />
        </div>
      )}
    </div>
  );
}

// If report_html is empty, render a minimal summary from the JSON keys.
function summaryFallback(summary) {
  if (!summary) return '<p>No report data.</p>';
  const keys = Object.keys(summary).filter(k => !['report_type','report_date','generated_at'].includes(k));
  return '<dl>' + keys.map(k => {
    const v = summary[k];
    const display = Array.isArray(v) ? v.length + ' items' :
                    typeof v === 'object' ? JSON.stringify(v).slice(0, 200) :
                    String(v);
    return '<dt style="font-weight:700;margin-top:6px">' + k + '</dt><dd style="margin-left:12px">' + display + '</dd>';
  }).join('') + '</dl>';
}

export default function TodaysStandups() {
  const [reports, setReports] = useState({}); // slot.key -> latest report row for today
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null); // slot.key

  async function load() {
    setLoading(true);
    const today = new Date().toISOString().slice(0,10);
    const { data } = await supabase.from('daily_ops_reports')
      .select('id,report_type,report_date,report_html,summary,created_at')
      .eq('report_date', today)
      .order('created_at', { ascending: false });
    const byType = {};
    for (const r of (data || [])) {
      // first row wins (already sorted desc by created_at)
      if (!byType[r.report_type]) byType[r.report_type] = r;
    }
    setReports(byType);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);
  useRealtimeTable(['daily_ops_reports'], load);

  if (loading) {
    return (
      <div style={{ padding: 16, color: 'var(--gray)', fontSize: 12 }}>
        Loading today&apos;s standups...
      </div>
    );
  }

  return (
    <div style={{ margin: '12px 20px' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--black)',
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        Today&apos;s Standups
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        {SLOTS.map(slot => (
          <StandupCard key={slot.key} slot={slot}
            report={reports[slot.key] || null}
            expanded={expanded === slot.key}
            onToggle={(k) => setExpanded(prev => prev === k ? null : k)} />
        ))}
      </div>
    </div>
  );
}
