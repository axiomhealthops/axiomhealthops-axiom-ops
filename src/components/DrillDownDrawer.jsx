// =====================================================================
// DrillDownDrawer.jsx
//
// Right-side slide-in drawer for drilling into a number on a report.
// Built 2026-06-05 for the Payer + Marketing Report so Yvonne can click
// any cell and see the underlying patients / referrals / visits.
//
// CONTRACT
//   open       — bool
//   onClose()  — close callback (X button, ESC, backdrop click)
//   title      — header text (e.g. "Accepted Referrals — Region A · June 2026")
//   subtitle   — small line under title (count, filters)
//   loading    — show spinner instead of table
//   columns    — [{ key, label, width?, align?, render?(row) }]
//   rows       — array of row objects keyed by column.key
//   emptyMessage — string shown when rows.length === 0
//
// VISUAL
//   ~560px desktop, 100vw mobile. Brand-red accent on header rule.
//   Backdrop is semi-transparent so context behind it stays visible.
// =====================================================================

import { useEffect } from 'react';

const BRAND_RED = '#D94F2B';

export default function DrillDownDrawer({
  open,
  onClose,
  title = '',
  subtitle = '',
  loading = false,
  columns = [],
  rows = [],
  emptyMessage = 'No rows match this selection.',
}) {
  // ESC to close
  useEffect(function() {
    if (!open) return;
    function onKey(e) { if (e.key === 'Escape' && typeof onClose === 'function') onClose(); }
    window.addEventListener('keydown', onKey);
    return function() { window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(15, 17, 23, 0.35)',
          zIndex: 200, animation: 'fadeIn 120ms ease-out',
        }} />

      {/* Drawer */}
      <aside role="dialog" aria-modal="true" aria-label={title}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(560px, 100vw)', background: '#fff',
          boxShadow: '-12px 0 30px rgba(0,0,0,0.15)',
          zIndex: 201, display: 'flex', flexDirection: 'column',
          animation: 'slideInRight 160ms ease-out',
        }}>

        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '2px solid ' + BRAND_RED,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 12, flexShrink: 0,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0F1117', letterSpacing: '-0.2px' }}>
              {title}
            </div>
            {subtitle && (
              <div style={{ fontSize: 11, color: '#6B7280', marginTop: 3 }}>{subtitle}</div>
            )}
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{
              background: 'none', border: 'none', fontSize: 20, lineHeight: 1,
              color: '#6B7280', cursor: 'pointer', padding: 4, marginTop: -2,
            }}>
            {'×'}
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', background: '#FBF7F6' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>
              {emptyMessage}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {columns.map(c => (
                    <th key={c.key} style={{
                      position: 'sticky', top: 0, zIndex: 1,
                      background: '#F9FAFB', textAlign: c.align || 'left',
                      padding: '8px 10px', fontWeight: 700, fontSize: 10,
                      color: '#374151', borderBottom: '1px solid var(--border)',
                      letterSpacing: '0.06em', textTransform: 'uppercase',
                      width: c.width,
                    }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody style={{ background: '#fff' }}>
                {rows.map((r, i) => (
                  <tr key={r.__id || i} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    {columns.map(c => (
                      <td key={c.key} style={{
                        padding: '8px 10px', textAlign: c.align || 'left',
                        color: '#1F2937', verticalAlign: 'top',
                      }}>
                        {c.render ? c.render(r) : (r[c.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer count */}
        {!loading && (
          <div style={{
            padding: '10px 20px', borderTop: '1px solid var(--border)',
            background: '#fff', fontSize: 11, color: '#6B7280',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            flexShrink: 0,
          }}>
            <span><strong style={{ color: '#0F1117' }}>{rows.length}</strong> {rows.length === 1 ? 'row' : 'rows'}</span>
            <span>EdemaCare</span>
          </div>
        )}
      </aside>

      {/* Animations — inline to avoid a separate CSS file */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideInRight { from { transform: translateX(20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
      `}</style>
    </>
  );
}
