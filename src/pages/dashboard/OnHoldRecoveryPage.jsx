import React, { useState, useEffect } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { REGIONS } from '../../lib/constants';

export default function OnHoldRecoveryPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    patient_name: '',
    region: '',
    hold_reason: '',
    hold_date: '',
    notes: '',
  });

  useEffect(() => { fetchRecords(); }, []);

  async function fetchRecords() {
    const { data } = await supabase
      .from('on_hold_recovery')
      .select('*')
      .order('created_at', { ascending: false });
    setRecords(data || []);
    setLoading(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    await supabase.from('on_hold_recovery').insert([{
      ...form,
      recovery_status: 'on_hold',
    }]);
    setForm({ patient_name: '', region: '', hold_reason: '', hold_date: '', notes: '' });
    setShowForm(false);
    fetchRecords();
  }

  async function updateStatus(id, status) {
    await supabase.from('on_hold_recovery').update({
      recovery_status: status,
      recovery_date: status === 'recovered'
        ? new Date().toISOString().split('T')[0]
        : null,
    }).eq('id', id);
    fetchRecords();
  }

  const onHold = records.filter(r => r.recovery_status === 'on_hold');
  const recovered = records.filter(r => r.recovery_status === 'recovered');
  const rate = records.length > 0
    ? Math.round((recovered.length / records.length) * 100)
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="On-Hold Recovery"
        subtitle={`${onHold.length} on hold · ${recovered.length} recovered`}
        actions={
          <button onClick={() => setShowForm(!showForm)} style={S.addBtn}>
            + Add Patient
          </button>
        }
      />
      <div style={{ padding: '20px 28px', flex: 1, overflow: 'auto' }}>

        <div style={S.summaryRow}>
          <div style={S.summaryCard}>
            <div style={S.lbl}>On Hold</div>
            <div style={{ ...S.val, color: 'var(--danger)' }}>{onHold.length}</div>
          </div>
          <div style={S.summaryCard}>
            <div style={S.lbl}>Recovered</div>
            <div style={{ ...S.val, color: 'var(--green)' }}>{recovered.length}</div>
          </div>
          <div style={S.summaryCard}>
            <div style={S.lbl}>Recovery Rate</div>
            <div style={{ ...S.val, color: 'var(--blue)' }}>{rate}%</div>
          </div>
        </div>

        {showForm && (
          <div style={S.formCard}>
            <div style={S.formTitle}>Add Patient On Hold</div>
            <form onSubmit={handleSubmit}>
              <div style={S.grid}>
                <input
                  required
                  placeholder="Patient Name"
                  value={form.patient_name}
                  onChange={e => setForm({ ...form, patient_name: e.target.value })}
                  style={S.input}
                />
                <input
                  placeholder="Region (A, B, C...)"
                  value={form.region}
                  onChange={e => setForm({ ...form, region: e.target.value.toUpperCase() })}
                  style={S.input}
                />
                <input
                  placeholder="Hold Reason"
                  value={form.hold_reason}
                  onChange={e => setForm({ ...form, hold_reason: e.target.value })}
                  style={S.input}
                />
                <input
                  type="date"
                  value={form.hold_date}
                  onChange={e => setForm({ ...form, hold_date: e.target.value })}
                  style={S.input}
                />
              </div>
              <input
                placeholder="Notes (optional)"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                style={{ ...S.input, width: '100%', marginTop: 10 }}
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button type="submit" style={S.submitBtn}>Save</button>
                <button type="button" onClick={() => setShowForm(false)} style={S.cancelBtn}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div style={S.empty}>Loading...</div>
        ) : onHold.length === 0 && recovered.length === 0 ? (
          <div style={S.empty}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏸</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--black)' }}>
              No patients on hold
            </div>
            <div style={{ color: 'var(--gray)', fontSize: 13, marginTop: 6 }}>
              Click "+ Add Patient" to track on-hold recovery
            </div>
          </div>
        ) : (
          <>
            {onHold.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={S.sectionLabel}>On Hold ({onHold.length})</div>
                <div style={S.table}>
                  <div style={S.th}>
                    <span>Patient</span>
                    <span>Region</span>
                    <span>Coordinator</span>
                    <span>Hold Reason</span>
                    <span>Hold Date</span>
                    <span>Action</span>
                  </div>
                  {onHold.map(r => (
                    <div key={r.id} style={S.tr}>
                      <span style={S.bold}>{r.patient_name}</span>
                      <span style={S.cell}>Region {r.region || '?'}</span>
                      <span style={S.cell}>{REGIONS[r.region] || '—'}</span>
                      <span style={S.cell}>{r.hold_reason || '—'}</span>
                      <span style={S.cell}>{r.hold_date || '—'}</span>
                      <span style={S.cell}>
                        <button
                          onClick={() => updateStatus(r.id, 'recovered')}
                          style={S.recoverBtn}
                        >
                          Mark Recovered
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {recovered.length > 0 && (
              <div>
                <div style={S.sectionLabel}>Recovered ({recovered.length})</div>
                <div style={S.table}>
                  <div style={S.th}>
                    <span>Patient</span>
                    <span>Region</span>
                    <span>Hold Reason</span>
                    <span>Hold Date</span>
                    <span>Recovery Date</span>
                    <span>Status</span>
                  </div>
                  {recovered.map(r => (
                    <div key={r.id} style={{ ...S.tr, opacity: 0.65 }}>
                      <span style={S.bold}>{r.patient_name}</span>
                      <span style={S.cell}>Region {r.region || '?'}</span>
                      <span style={S.cell}>{r.hold_reason || '—'}</span>
                      <span style={S.cell}>{r.hold_date || '—'}</span>
                      <span style={S.cell}>{r.recovery_date || '—'}</span>
                      <span style={S.cell}>
                        <span style={S.badge}>Recovered</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const COLS = '2fr 0.8fr 1.2fr 1.5fr 1fr 1.2fr';

const S = {
  addBtn: {
    padding: '8px 16px',
    background: 'var(--red)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  summaryRow: {
    display: 'flex',
    gap: 16,
    marginBottom: 24,
  },
  summaryCard: {
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '16px 24px',
    flex: 1,
  },
  lbl: {
    fontSize: 12,
    color: 'var(--gray)',
    fontWeight: 500,
    marginBottom: 4,
  },
  val: {
    fontSize: 28,
    fontWeight: 700,
    fontFamily: 'DM Mono, monospace',
  },
  formCard: {
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  formTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--black)',
    marginBottom: 14,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: 10,
  },
  input: {
    padding: '9px 12px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 13,
    background: 'var(--bg)',
    color: 'var(--black)',
    outline: 'none',
  },
  submitBtn: {
    padding: '9px 18px',
    background: 'var(--red)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  cancelBtn: {
    padding: '9px 18px',
    background: 'none',
    color: 'var(--gray)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--gray)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 10,
  },
  table: {
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  th: {
    display: 'grid',
    gridTemplateColumns: COLS,
    padding: '10px 20px',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--gray)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    background: 'var(--bg)',
    borderBottom: '1px solid var(--border)',
  },
  tr: {
    display: 'grid',
    gridTemplateColumns: COLS,
    padding: '12px 20px',
    alignItems: 'center',
    borderBottom: '1px solid var(--border)',
  },
  bold: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--black)',
  },
  cell: {
    fontSize: 12,
    color: 'var(--gray)',
  },
  recoverBtn: {
    padding: '4px 12px',
    background: 'var(--green)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  badge: {
    background: '#ECFDF5',
    color: '#065F46',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 60,
  },
};
