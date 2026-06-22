// =====================================================================
// InsuranceSettingsPage.jsx
//
// Admin-managed lookup table for Pariox insurance abbreviations.
//
// Background:
// The Pariox export labels insurance as just "private" or "medicare" in
// the `Ins` column while the actual insurance + region is encoded in the
// "Ref Source" column as an abbreviation like "HumA" (Humana, Region A).
// This page is the canonical source of truth that resolves abbreviations
// to insurance names for the upload pipeline, reports, and patient views.
//
// Access: admin and super_admin only (RLS enforces write at the DB layer).
// Read access for any active coordinator (because the lookup happens on
// every Pariox upload and many reports).
//
// Features:
//   * Search by abbreviation, insurance name, region, or payor group
//   * Filter by region or payor group
//   * Add / Edit / Soft-delete (toggle is_active)
//   * Inline summary tiles: total, active, by category
// =====================================================================

import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, safeUpdate } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

const CATEGORIES = [
  'Commercial',
  'Medicare Advantage',
  'Medicare',
  'Medicaid Managed Care',
  'Self-Pay',
  'Other',
];

function StatTile({ label, value, sub, accent = 'var(--black)' }) {
  return (
    <div style={{
      background: 'var(--card-bg)', borderRadius: 10, padding: '12px 14px',
      border: '1px solid var(--border)',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 600, color: 'var(--gray)',
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>{label}</div>
      <div style={{
        fontSize: 22, fontWeight: 800, fontFamily: 'DM Mono, monospace',
        color: accent, marginTop: 4,
      }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function AbbreviationModal({ row, onClose, onSaved, coordinatorId }) {
  const isNew = !row?.id;
  const [form, setForm] = useState({
    abbreviation: row?.abbreviation || '',
    region: row?.region || '',
    insurance_name: row?.insurance_name || '',
    display_name: row?.display_name || '',
    category: row?.category || '',
    payor_group: row?.payor_group || '',
    notes: row?.notes || '',
    is_active: row?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Auto-build display_name as user types abbreviation + insurance
  useEffect(() => {
    if (form.region && form.insurance_name && !form.display_name) {
      setForm(f => ({ ...f, display_name: `${form.region} - ${form.insurance_name}` }));
    }
  }, [form.region, form.insurance_name]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    setErr('');
    if (!form.abbreviation.trim()) { setErr('Abbreviation is required'); return; }
    if (!form.insurance_name.trim()) { setErr('Insurance name is required'); return; }
    setSaving(true);

    const payload = {
      abbreviation: form.abbreviation.trim(),
      region: form.region.trim() || null,
      insurance_name: form.insurance_name.trim(),
      display_name: form.display_name.trim() || `${form.region.trim()} - ${form.insurance_name.trim()}`,
      category: form.category || null,
      payor_group: form.payor_group.trim() || null,
      notes: form.notes.trim() || null,
      is_active: form.is_active,
    };

    let error;
    if (isNew) {
      payload.created_by = coordinatorId || null;
      payload.updated_by = coordinatorId || null;
      ({ error } = await supabase.from('insurance_abbreviations').insert(payload));
    } else {
      payload.updated_by = coordinatorId || null;
      const result = await safeUpdate('insurance_abbreviations', payload, { id: row.id });
      error = result.error;
    }

    setSaving(false);
    if (error) {
      setErr(error.message || 'Save failed');
      return;
    }
    onSaved();
  }

  async function handleDelete() {
    if (!row?.id) return;
    if (!window.confirm(`Permanently delete abbreviation "${row.abbreviation}"? This cannot be undone. To temporarily disable, use the Active toggle instead.`)) return;
    const { error } = await supabase.from('insurance_abbreviations').delete().eq('id', row.id);
    if (error) { setErr(error.message); return; }
    onSaved();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--card-bg)', borderRadius: 14, width: '100%', maxWidth: 540,
        display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
        maxHeight: '90vh',
      }}>
        <div style={{
          padding: '14px 22px', borderBottom: '1px solid var(--border)',
          background: '#0F1117', borderRadius: '14px 14px 0 0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
              {isNew ? 'Add New Abbreviation' : `Edit "${row.abbreviation}"`}
            </div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
              Pariox insurance abbreviation → canonical insurance name mapping
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#9CA3AF',
          }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {err && (
            <div style={{
              background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8,
              padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#DC2626',
            }}>{err}</div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Abbreviation *</label>
              <input
                type="text"
                value={form.abbreviation}
                onChange={e => setForm(p => ({ ...p, abbreviation: e.target.value }))}
                placeholder="HumA"
                style={inputStyle}
                disabled={!isNew}
              />
              {!isNew && (
                <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 3 }}>
                  Abbreviation can't be changed after creation — use Delete + Add New if needed.
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle}>Region</label>
              <input
                type="text"
                value={form.region}
                onChange={e => setForm(p => ({ ...p, region: e.target.value.toUpperCase() }))}
                placeholder="A"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Insurance Name *</label>
            <input
              type="text"
              value={form.insurance_name}
              onChange={e => setForm(p => ({ ...p, insurance_name: e.target.value }))}
              placeholder="Humana"
              style={inputStyle}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Display Name</label>
            <input
              type="text"
              value={form.display_name}
              onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))}
              placeholder="A - Humana (auto-filled if blank)"
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <div>
              <label style={labelStyle}>Category</label>
              <select
                value={form.category}
                onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                style={inputStyle}
              >
                <option value="">— select —</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Payor Group</label>
              <input
                type="text"
                value={form.payor_group}
                onChange={e => setForm(p => ({ ...p, payor_group: e.target.value }))}
                placeholder="Humana"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              placeholder="Optional context…"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              id="is_active"
              checked={form.is_active}
              onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <label htmlFor="is_active" style={{ fontSize: 13, color: 'var(--black)', cursor: 'pointer' }}>
              Active <span style={{ color: 'var(--gray)' }}>(inactive abbreviations are excluded from new uploads but historical records keep their resolved insurance name)</span>
            </label>
          </div>
        </div>

        <div style={{
          padding: '14px 22px', borderTop: '1px solid var(--border)',
          background: 'var(--bg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            {!isNew && (
              <button onClick={handleDelete} style={{
                padding: '7px 14px', background: '#FEF2F2', color: '#DC2626',
                border: '1px solid #FCA5A5', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>Delete</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{
              padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 7,
              fontSize: 13, background: 'var(--card-bg)', cursor: 'pointer',
            }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{
              padding: '8px 20px', background: '#06B6D4', color: '#fff',
              border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600,
              cursor: saving ? 'wait' : 'pointer',
            }}>
              {saving ? 'Saving…' : (isNew ? 'Add Abbreviation' : 'Save Changes')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--gray)',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4,
};
const inputStyle = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--border)',
  borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box',
  background: 'var(--card-bg)',
};

export default function InsuranceSettingsPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('ALL');
  const [payorFilter, setPayorFilter] = useState('ALL');
  const [activeFilter, setActiveFilter] = useState('all'); // all|active|inactive
  const [editing, setEditing] = useState(null); // null | row | 'new'

  const canEdit = ['super_admin', 'admin', 'ceo'].includes(profile?.role);

  async function load() {
    const { data } = await supabase
      .from('insurance_abbreviations')
      .select('*')
      .order('region', { ascending: true, nullsFirst: false })
      .order('insurance_name');
    setRows(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  useRealtimeTable('insurance_abbreviations', load);

  // Filter and search
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (activeFilter === 'active' && !r.is_active) return false;
      if (activeFilter === 'inactive' && r.is_active) return false;
      if (regionFilter !== 'ALL' && r.region !== regionFilter) return false;
      if (payorFilter !== 'ALL' && r.payor_group !== payorFilter) return false;
      if (!q) return true;
      return (
        r.abbreviation?.toLowerCase().includes(q) ||
        r.insurance_name?.toLowerCase().includes(q) ||
        r.region?.toLowerCase().includes(q) ||
        r.payor_group?.toLowerCase().includes(q) ||
        r.display_name?.toLowerCase().includes(q)
      );
    });
  }, [rows, search, regionFilter, payorFilter, activeFilter]);

  // Distinct regions and payor groups for the filter dropdowns
  const regions = useMemo(() =>
    [...new Set(rows.map(r => r.region).filter(Boolean))].sort()
  , [rows]);
  const payorGroups = useMemo(() =>
    [...new Set(rows.map(r => r.payor_group).filter(Boolean))].sort()
  , [rows]);

  // Summary stats
  const stats = useMemo(() => ({
    total: rows.length,
    active: rows.filter(r => r.is_active).length,
    inactive: rows.filter(r => !r.is_active).length,
    regions: regions.length,
    payors: payorGroups.length,
  }), [rows, regions, payorGroups]);

  // Access guard
  if (!canEdit && profile?.role !== 'super_admin' && profile?.role !== 'admin') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <TopBar title="Insurance Abbreviations" subtitle="Access restricted" />
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--gray)', fontSize: 14,
        }}>
          Insurance settings are only available to admins.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Insurance Abbreviations"
        subtitle="Pariox abbreviation → canonical insurance name lookup. Used by upload pipeline and reports."
        actions={canEdit && (
          <button
            onClick={() => setEditing('new')}
            style={{
              padding: '7px 16px', background: '#06B6D4', color: '#fff',
              border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >+ Add Abbreviation</button>
        )}
      />

      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {/* Stats */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 10, marginBottom: 16,
        }}>
          <StatTile label="Total" value={stats.total} sub="abbreviations" />
          <StatTile label="Active" value={stats.active} accent="#065F46" />
          <StatTile label="Inactive" value={stats.inactive} accent={stats.inactive > 0 ? '#D97706' : 'var(--gray)'} />
          <StatTile label="Regions Covered" value={stats.regions} />
          <StatTile label="Payor Groups" value={stats.payors} />
        </div>

        {/* Filters */}
        <div style={{
          display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
          marginBottom: 14, padding: 12, background: 'var(--card-bg)',
          border: '1px solid var(--border)', borderRadius: 10,
        }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search abbreviation, insurance, region, or payor…"
            style={{ ...inputStyle, flex: 1, minWidth: 220, padding: '7px 12px' }}
          />
          <select
            value={regionFilter}
            onChange={e => setRegionFilter(e.target.value)}
            style={{ ...inputStyle, width: 'auto', padding: '7px 10px' }}
          >
            <option value="ALL">All Regions</option>
            {regions.map(r => <option key={r} value={r}>Region {r}</option>)}
          </select>
          <select
            value={payorFilter}
            onChange={e => setPayorFilter(e.target.value)}
            style={{ ...inputStyle, width: 'auto', padding: '7px 10px' }}
          >
            <option value="ALL">All Payors</option>
            {payorGroups.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            value={activeFilter}
            onChange={e => setActiveFilter(e.target.value)}
            style={{ ...inputStyle, width: 'auto', padding: '7px 10px' }}
          >
            <option value="all">All</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginLeft: 'auto' }}>
            {filtered.length} of {stats.total} shown
          </div>
        </div>

        {/* Table */}
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--border)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '120px 80px 1.5fr 1fr 1fr 80px 90px',
            padding: '10px 16px', background: 'var(--bg)',
            borderBottom: '1px solid var(--border)',
            fontSize: 10, fontWeight: 700, color: 'var(--gray)',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            <span>Abbreviation</span>
            <span>Region</span>
            <span>Insurance Name</span>
            <span>Payor Group</span>
            <span>Category</span>
            <span>Active</span>
            <span></span>
          </div>

          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>
              Loading abbreviations…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>
              No matches. Try clearing filters or adjusting search.
            </div>
          ) : (
            filtered.map((r, i) => (
              <div key={r.id} style={{
                display: 'grid', gridTemplateColumns: '120px 80px 1.5fr 1fr 1fr 80px 90px',
                padding: '10px 16px', borderBottom: '1px solid var(--border)',
                background: i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg)',
                alignItems: 'center', fontSize: 13,
                opacity: r.is_active ? 1 : 0.55,
              }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, color: 'var(--black)' }}>
                  {r.abbreviation}
                </span>
                <span style={{ fontWeight: 600, color: 'var(--gray)' }}>{r.region || '—'}</span>
                <span style={{ color: 'var(--black)' }}>{r.insurance_name}</span>
                <span style={{ color: 'var(--gray)', fontSize: 12 }}>{r.payor_group || '—'}</span>
                <span style={{ color: 'var(--gray)', fontSize: 12 }}>{r.category || '—'}</span>
                <span>
                  {r.is_active
                    ? <span style={{ fontSize: 10, color: '#065F46', background: '#ECFDF5', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>ACTIVE</span>
                    : <span style={{ fontSize: 10, color: '#92400E', background: '#FEF3C7', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>INACTIVE</span>}
                </span>
                <span>
                  {canEdit && (
                    <button onClick={() => setEditing(r)} style={{
                      padding: '4px 10px', border: '1px solid var(--border)',
                      borderRadius: 5, fontSize: 11, background: 'var(--card-bg)',
                      cursor: 'pointer', color: 'var(--black)', fontWeight: 600,
                    }}>Edit</button>
                  )}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Footnote */}
        <div style={{
          marginTop: 12, padding: '10px 14px', background: '#EFF6FF',
          border: '1px solid #BFDBFE', borderRadius: 8, fontSize: 11, color: '#1E40AF',
        }}>
          <strong>How this is used:</strong> When a Pariox upload arrives, the system looks
          up each row's <code style={{ background: '#fff', padding: '1px 5px', borderRadius: 3 }}>Ref Source</code> value
          against this table and stores the resolved <strong>Insurance Name</strong> on the patient record.
          To add a brand-new payor or correct a misclassification, edit the row here — changes apply to all future uploads immediately. Historical records keep whatever insurance was resolved at the time of their upload.
        </div>
      </div>

      {editing && (
        <AbbreviationModal
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          coordinatorId={profile?.id}
        />
      )}
    </div>
  );
}
