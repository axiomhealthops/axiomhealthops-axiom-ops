// =====================================================================
// PayrollSettingsPage.jsx
//
// Admin-only configuration for the payroll variance/audit engine.
// Edits three tables:
//   - payroll_flag_rules         (rule thresholds + active flags)
//   - visit_duration_assumptions (event_type pattern -> minutes)
//   - clinician_payroll_map      (staff_name -> Paylocity / axiom-payroll IDs)
//
// Phase 2A: scaffold + read-only previews. Inline edit is Phase 2B.
// Reference: docs/Payroll_Review_Design.md (rev 2) §3-§4.
// =====================================================================

import { useEffect, useState } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';

export default function PayrollSettingsPage() {
  const [rules, setRules] = useState([]);
  const [durations, setDurations] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      const [r, d, m] = await Promise.all([
        supabase
          .from('payroll_flag_rules')
          .select('*')
          .order('severity', { ascending: false })
          .order('rule_key'),
        supabase
          .from('visit_duration_assumptions')
          .select('*')
          .order('event_pattern'),
        supabase
          .from('clinician_payroll_map')
          .select('*')
          .order('staff_name_normalized'),
      ]);
      if (!active) return;
      setRules(r.data || []);
      setDurations(d.data || []);
      setMappings(m.data || []);
      setLoading(false);
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <TopBar
        title="Payroll Rules"
        subtitle="Variance thresholds, visit-duration assumptions, and clinician payroll mapping"
      />

      <div style={S.body}>
        <div style={S.note}>
          Phase 2A: read-only view of seed config. Inline editing and
          clinician mapping import come in Phase 2B. Today, edit values
          directly in the Supabase table editor if needed.
        </div>

        {/* Flag rules */}
        <Section title="Flag rules" count={rules.length}>
          <Table
            cols={['Rule', 'Severity', 'Threshold', 'Active']}
            rows={rules.map((r) => [
              <div key="n">
                <div style={S.bold}>{r.name}</div>
                <div style={S.dim}>
                  <code>{r.rule_key}</code>
                </div>
                <div style={S.dim}>{r.description}</div>
              </div>,
              <Pill key="s" tone={r.severity === 'hard' ? 'red' : 'yellow'}>
                {r.severity}
              </Pill>,
              <code key="t" style={S.code}>
                {JSON.stringify(r.threshold)}
              </code>,
              r.is_active ? 'Yes' : 'No',
            ])}
            loading={loading}
            emptyMsg="No rules configured."
          />
        </Section>

        {/* Visit duration assumptions */}
        <Section title="Visit-duration assumptions" count={durations.length}>
          <Table
            cols={['Event pattern', 'Minutes', 'Notes', 'Active']}
            rows={durations.map((d) => [
              <code key="p" style={S.code}>
                {d.event_pattern}
              </code>,
              <span key="m" style={S.bold}>
                {d.minutes}
              </span>,
              d.notes || '',
              d.is_active ? 'Yes' : 'No',
            ])}
            loading={loading}
            emptyMsg="No duration assumptions configured."
          />
        </Section>

        {/* Clinician payroll mappings */}
        <Section title="Clinician payroll mapping" count={mappings.length}>
          <Table
            cols={[
              'Staff name (Pariox)',
              'Paylocity emp ID',
              'Axiom-payroll emp ID',
              'Hourly rate',
              'Active',
            ]}
            rows={mappings.map((m) => [
              m.staff_name_normalized,
              m.paylocity_employee_id || '-',
              m.axiom_payroll_emp_id || '-',
              m.hourly_rate ? `$${Number(m.hourly_rate).toFixed(2)}` : '-',
              m.is_active ? 'Yes' : 'No',
            ])}
            loading={loading}
            emptyMsg="No mappings yet. Phase 2B will seed these from the axiom-payroll employees collection."
          />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, count, children }) {
  return (
    <div style={S.section}>
      <div style={S.sectionHead}>
        <div style={S.sectionTitle}>{title}</div>
        <div style={S.sectionCount}>{count}</div>
      </div>
      {children}
    </div>
  );
}

function Table({ cols, rows, loading, emptyMsg }) {
  if (loading) {
    return <div style={S.empty}>Loading...</div>;
  }
  if (!rows || rows.length === 0) {
    return <div style={S.empty}>{emptyMsg}</div>;
  }
  return (
    <div style={S.tableWrap}>
      <table style={S.table}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} style={S.th}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={i % 2 === 1 ? S.trAlt : null}>
              {r.map((cell, j) => (
                <td key={j} style={S.td}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pill({ tone, children }) {
  const tones = {
    red: { bg: '#FEE2E2', fg: '#991B1B' },
    yellow: { bg: '#FEF3C7', fg: '#92400E' },
    green: { bg: '#D1FAE5', fg: '#065F46' },
  };
  const t = tones[tone] || tones.yellow;
  return (
    <span
      style={{
        background: t.bg,
        color: t.fg,
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 999,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {children}
    </span>
  );
}

const S = {
  body: { padding: 24, maxWidth: 1400, margin: '0 auto' },
  note: {
    background: '#EFF6FF',
    border: '1px solid #BFDBFE',
    color: '#1E40AF',
    padding: '12px 16px',
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 20,
  },
  section: {
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    marginBottom: 20,
    overflow: 'hidden',
  },
  sectionHead: {
    padding: '14px 18px',
    borderBottom: '1px solid var(--border)',
    background: '#F9FAFB',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: 'var(--black)' },
  sectionCount: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--gray)',
    background: '#E5E7EB',
    padding: '2px 8px',
    borderRadius: 999,
  },
  empty: { padding: '24px 18px', fontSize: 13, color: 'var(--gray)' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left',
    padding: '10px 14px',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--gray)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    borderBottom: '1px solid var(--border)',
  },
  td: {
    padding: '10px 14px',
    borderBottom: '1px solid var(--border)',
    verticalAlign: 'top',
  },
  trAlt: { background: '#FAFAFA' },
  bold: { fontWeight: 600, color: 'var(--black)' },
  dim: { fontSize: 11, color: 'var(--gray)', marginTop: 2 },
  code: {
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: 12,
    background: '#F3F4F6',
    padding: '1px 6px',
    borderRadius: 4,
    color: '#374151',
  },
};
