import React, { useState } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';

const STATUS_STYLES = {
  pending: { bg: '#FEF3C7', color: '#92400E' },
  approved: { bg: '#ECFDF5', color: '#065F46' },
  denied: { bg: '#FEF2F2', color: '#991B1B' },
  expired: { bg: '#F3F4F6', color: '#374151' },
};

export default function AuthTrackerPage() {
  const [records, setRecords] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showForm, setShowForm] = React.useState(false);
  const [form, setForm] = React.useState({
    patient_name: '', region: '', insurance: '', auth_number: '',
    status: 'pending', submitted_date: '', expiry_date: '',
    visits_authorized: '', notes: '',
  });

  React.useEffect(() => {
    fetchRecords();
  }, []);

  async function fetchRecords() {
    const { data } = await supabase.from('auth_tracker').select('*').order('created_at', { ascending: false });
    setRecords(data || []);
    setLoading(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    await supabase.from('auth_tracker').insert([form]);
    setForm({ patient_name: '', region: '', insurance: '', auth_number: '', status: 'pending', submitted_date: '', expiry_date: '', visits_authorized: '', notes: '' });
    setShowForm(false);
    fetchRecords();
  }

  async function updateStatus(id, status) {
    await supabase.from('auth_tracker').update({ status }).eq('id', id);
    fetchRecords();
  }

  const pending = records.filter(r => r.status === 'pending').length;
  const approved = records.filter(r => r.status === 'approved').length;
  const denied = records.filter(r => r.status === 'denied').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Auth Tracker"
        subtitle={`${records.length} total · ${pending} pending · ${approved} approved · ${denied} denied`}
        actions={
          <button onClick={() => setShowForm(!showForm)} style={styles.addBtn}>
            + Add Auth
          </button>
        }
      />
      <div style={{ padding: '20px 28px', flex: 1, overflow: 'auto' }}>

        {/* Summary */}
        <div style={styles.summaryRow}>
          {[['Pending', pending, '#D97706'], ['Approved', approved, '#065F46'], ['Denied', denied, '#991B1B']].map(([label, count, color]) => (
            <div key={label} style={styles.summaryCard}>
              <div style={{ fontSize: 12, color: 'var(--gray)', fontWeight: 500, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'DM Mono, monospace', color }}>{count}</div>
            </div>
          ))}
        </div>

        {/* Add Form */}
        {showForm && (
          <div style={styles.formCard}>
            <div style={styles.formTitle}>New Authorization</div>
            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.formGrid}>
                <input required placeholder="Patient Name" value={form.patient_name} onChange={e => setForm({...form, patient_name: e.target.value})} style={styles.input} />
                <input placeholder="Region" value={form.region} onChange={e => setForm({...form, region: e.target.value})} style={styles.input} />
                <input placeholder="Insurance" value={form.insurance} onChange={e => setForm({...form, insurance: e.target.value})} style={styles.input} />
                <input placeholder="Auth Number" value={form.auth_number} onChange={e => setForm({...form, auth_number: e.target.value})} style={styles.input} />
                <input type="date" placeholder="Submitted Date" value={form.submitted_date} onChange={e => setForm({...form, submitted_date: e.target.value})} style={styles.input} />
                <input type="date" placeholder="Expiry Date" value={form.expiry_date} onChange={e => setForm({...form, expiry_date: e.target.value})} style={styles.input} />
                <input type="number" placeholder="Visits Authorized" value={form.visits_authorized} onChange={e => setForm({...form, visits_authorized: e.target.value})} style={styles.input} />
                <select value={form.status} onChange={e => setForm({...form, status: e.target.value})} style={styles.input}>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="denied">Denied</option>
                </select>
              </div>
              <input placeholder="Notes" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} style={{...styles.input, width: '100%', marginTop: 10}} />
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button type="submit" style={styles.submitBtn}>Save Authorization</button>
                <button type="button" onClick={() => setShowForm(false)} style={styles.cancelBtn}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div style={styles.empty}>Loading...</div>
        ) : records.length === 0 ? (
          <div style={styles.empty}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔐</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>No authorizations yet</div>
            <div style={{ color: 'var(--gray)', fontSize: 13, marginTop: 6 }}>Click "+ Add Auth" to get started</div>
          </div>
        ) : (
          <div style={styles.table}>
            <div style={styles.tableHeader}>
              <span>Patient</span>
              <span>Region</span>
              <span>Insurance</span>
              <span>Auth #</span>
              <span>Expiry</span>
              <span>Visits</span>
              <span>Status</span>
            </div>
            {records.map(r => (
              <div key={r.id} style={styles.tableRow}>
                <span style={styles.cellName}>{r.patient_name}</span>
                <span style={styles.cell}>{r.region}</span>
                <span style={styles.cell}>{r.insurance}</span>
                <span style={{ ...styles.cell, fontFamily: 'DM Mono, monospace' }}>{r.auth_number || '—'}</span>
                <span style={styles.cell}>{r.expiry_date || '—'}</span>
                <span style={{ ...styles.cell, fontFamily: 'DM Mono, monospace' }}>{r.visits_authorized || '—'}</span>
                <span style={styles.cell}>
                  <select
                    value={r.status}
                    onChange={e => updateStatus(r.id, e.target.value)}
                    style={{
                      ...STATUS_STYLES[r.status],
                      border: 'none',
                      borderRadius: 999,
                      padding: '3px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="denied">Denied</option>
                    <option value="expired">Expired</option>
                  </select>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  addBtn: { padding: '8px 16px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  summaryRow: { display: 'flex', gap: 16, marginBottom: 24 },
  summaryCard: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 24px', flex: 1 },
  formCard: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 24 },
  formTitle: { fontSize: 15, fontWeight: 600, color: 'var(--black)', marginBottom: 16 },
  form: { display: 'flex', flexDirection: 'column' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 },
  input: { padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--bg)', color: 'var(--black)', outline: 'none' },
  submitBtn: { padding: '10px 20px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  cancelBtn: { padding: '10px 20px', background: 'none', color: 'var(--gray)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer' },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, color: 'var(--black)' },
  table: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' },
  tableHeader: { display: 'grid', gridTemplateColumns: '2fr 0.5fr 1fr 1fr 1fr 0.5fr 1fr', padding: '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--bg)', borderBottom: '1px solid var(--border)' },
  tableRow: { display: 'grid', gridTemplateColumns: '2fr 0.5fr 1fr 1fr 1fr 0.5fr 1fr', padding: '12px 20px', alignItems: 'center', borderBottom: '1px solid var(--border)' },
  cellName: { fontSize: 13, fontWeight: 500, color: 'var(--black)' },
  cell: { fontSize: 12, color: 'var(--gray)' },
};
