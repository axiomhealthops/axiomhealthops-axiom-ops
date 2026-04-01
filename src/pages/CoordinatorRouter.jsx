import React, { useState } from 'react';
import CoordinatorPage from './CoordinatorPage';
 
var COORDINATORS = [
  { name: 'Gypsy Renos',       regions: ['A'],             role: 'Care Coordinator' },
  { name: 'Mary Imperio',      regions: ['B', 'C', 'G'],   role: 'Care Coordinator' },
  { name: 'Audrey Sarmiento',  regions: ['H', 'J', 'M', 'N'], role: 'Care Coordinator' },
  { name: 'April Manalo',      regions: ['T', 'V'],        role: 'Care Coordinator' },
];
 
export default function CoordinatorRouter() {
  var [selected, setSelected] = useState(null);
 
  if (selected) {
    return (
      <div>
        <div style={{ background: '#1F2937', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={function() { setSelected(null); }}
            style={{ background: 'none', border: '1px solid #4B5563', color: '#D1D5DB', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}>
            ← Switch Coordinator
          </button>
          <span style={{ fontSize: 12, color: '#9CA3AF' }}>
            Viewing as: <strong style={{ color: '#fff' }}>{selected.name}</strong> &mdash; Regions {selected.regions.join(', ')}
          </span>
        </div>
        <CoordinatorPage coordName={selected.name} />
      </div>
    );
  }
 
  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 560, padding: 24 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 52, height: 52, borderRadius: 12, background: '#D94F2B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700, color: '#fff', margin: '0 auto 16px' }}>A</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>Care Coordinator Portal</div>
          <div style={{ fontSize: 14, color: '#6B7280', marginTop: 6 }}>Select a coordinator to preview their view</div>
        </div>
 
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {COORDINATORS.map(function(coord) {
            var initials = coord.name.split(' ').map(function(n) { return n[0]; }).join('');
            return (
              <button key={coord.name} onClick={function() { setSelected(coord); }}
                style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'border-color 0.15s, box-shadow 0.15s' }}
                onMouseEnter={function(e) { e.currentTarget.style.borderColor = '#D94F2B'; e.currentTarget.style.boxShadow = '0 0 0 3px #D94F2B20'; }}
                onMouseLeave={function(e) { e.currentTarget.style.borderColor = '#E5E7EB'; e.currentTarget.style.boxShadow = 'none'; }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: '#0F1117', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                  {initials}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{coord.name}</div>
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                    {coord.role} &mdash; Regions {coord.regions.join(', ')}
                  </div>
                </div>
                <span style={{ color: '#9CA3AF', fontSize: 18 }}>&#8594;</span>
              </button>
            );
          })}
        </div>
 
        <div style={{ marginTop: 24, padding: '12px 16px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, fontSize: 12, color: '#1E40AF' }}>
          <strong>Preview Mode</strong> &mdash; You are viewing coordinator pages as the Director. In production, each coordinator will log in and see only their own regions and tasks.
        </div>
      </div>
    </div>
  );
}
 
