import React, { useState, useEffect } from 'react';
import TopBar from '../../components/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth.jsx';

const PRIORITY_STYLES = {
  high: { bg: '#FEF2F2', color: '#991B1B' },
  medium: { bg: '#FEF3C7', color: '#92400E' },
  low: { bg: '#EFF6FF', color: '#1E40AF' },
};

export default function ActionListPage() {
  const { profile } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium', due_date: '', region: '' });

  useEffect(() => { fetchItems(); }, []);

  async function fetchItems() {
    const { data } = await supabase.from('action_items').select('*').order('created_at', { ascending: false });
    setItems(data || []);
    setLoading(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    await supabase.from('action_items').insert([{ ...form, created_by: profile?.id }]);
    setForm({ title: '', description: '', priority: 'medium', due_date: '', region: '' });
    setShowForm(false);
    fetchItems();
  }

  async function toggleComplete(id, current) {
    await supabase.from('action_items').update({
      status: current === 'completed' ? 'open' : 'completed',
      completed_at: current === 'completed' ? null : new Date().toISOString(),
    }).eq('id', id);
    fetchItems();
  }

  async function deleteItem(id) {
    await supabase.from('action_items').delete().eq('id', id);
    fetchItems();
  }

  const open = items.filter(i => i.status !== 'completed');
  const completed = items.filter(i => i.status === 'completed');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Action List"
        subtitle={`${open.length} open · ${completed.length} completed`}
        actions={
          <button onClick={() => setShowForm(!showForm)} style={styles.addBtn}>+ Add Action</button>
        }
      />
      <div style={{ padding: '20px 28px', flex: 1, overflow: 'auto' }}>

        {showForm && (
          <div style={styles.formCard}>
            <form onSubmit={handleSubmit}>
              <div style={styles.formGrid}>
                <input required placeholder="Action title" value={form.title} onChange={e => setForm({...form, title: e.target.value})} style={{...styles.input, gridColumn: '1 / -1'}} />
                <input placeholder="Description (optional)" value={form.description} onChange={e => setForm({...form, description: e.target.value})} style={{...styles.input, gridColumn: '1 / -1'}} />
                <select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})} style={styles.input}>
                  <option value="high">High Priority</option>
                  <option value="medium">Medium Priority</option>
                  <option value="low">Low Priority</option>
                </select>
                <input type="date" value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} style={styles.input} />
                <input placeholder="Region (optional)" value={form.region} onChange={e => setForm({...form, region: e.target.value})} style={styles.input} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button type="submit" style={styles.submitBtn}>Save</button>
                <button type="button" onClick={() => setShowForm(false)} style={styles.cancelBtn}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {loading ? <div style={styles.empty}>Loading...</div> : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              {open.map(item => (
                <div key={item.id} style={styles.itemCard}>
                  <div style={styles.itemLeft}>
                    <button onClick={() => toggleComplete(item.id, item.status)} style={styles.checkbox}>
                      <span style={{ fontSize: 16 }}>○</span>
                    </button>
                    <div>
                      <div style={styles.itemTitle}>{item.title}</div>
                      {item.description && <div style={styles.itemDesc}>{item.description}</div>}
                      <div style={styles.itemMeta}>
                        {item.due_date && <span>Due: {item.due_date}</span>}
                        {item.region && <span>Region {item.region}</span>}
                      </div>
                    </div>
                  </div>
                  <div style={styles.itemRight}>
                    <span style={{ ...styles.priorityPill, ...PRIORITY_STYLES[item.priority] }}>
                      {item.priority}
                    </span>
                    <button onClick={() => deleteItem(item.id)} style={styles.deleteBtn}>✕</button>
                  </div>
                </div>
              ))}
              {open.length === 0 && (
                <div style={styles.empty}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
                  <div style={{ fontWeight: 600 }}>All caught up!</div>
                </div>
              )}
            </div>

            {completed.length > 0 && (
              <>
                <div style={styles.sectionLabel}>Completed ({completed.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {completed.map(item => (
                    <div key={item.id} style={{ ...styles.itemCard, opacity: 0.5 }}>
                      <div style={styles.itemLeft}>
                        <button onClick={() => toggleComplete(item.id, item.status)} style={styles.checkbox}>
                          <span style={{ fontSize: 16, color: 'var(--green)' }}>✓</span>
                        </button>
                        <div style={{ textDecoration: 'line-through', color: 'var(--gray)', fontSize: 13 }}>{item.title}</div>
                      </div>
                      <button onClick={() => deleteItem(item.id)} style={styles.deleteBtn}>✕</button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  addBtn: { padding: '8px 16px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  formCard: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 },
  input: { padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--bg)', color: 'var(--black)', outline: 'none' },
  submitBtn: { padding: '9px 18px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  cancelBtn: { padding: '9px 18px', background: 'none', color: 'var(--gray)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer' },
  itemCard: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  itemLeft: { display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1 },
  itemRight: { display: 'flex', alignItems: 'center', gap: 10 },
  checkbox: { background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 },
  itemTitle: { fontSize: 14, fontWeight: 500, color: 'var(--black)' },
  itemDesc: { fontSize: 12, color: 'var(--gray)', marginTop: 2 },
  itemMeta: { display: 'flex', gap: 12, fontSize: 11, color: 'var(--gray)', marginTop: 4 },
  priorityPill: { padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, textTransform: 'capitalize' },
  deleteBtn: { background: 'none', border: 'none', color: 'var(--light-gray)', cursor: 'pointer', fontSize: 12 },
  sectionLabel: { fontSize: 11, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--black)' },
};
