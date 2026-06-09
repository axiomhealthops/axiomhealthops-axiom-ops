// =====================================================================
// MarketingReferralsPage.jsx
//
// Marketing-only view of intake referrals. The marketing team needs to
// know how their region's referral pipeline is performing (acceptance
// rate, denial reasons, source mix) but should NOT see the operational
// Intake Dashboard — different scope, different action surface.
//
// What this page does:
//   - Per-region summary table: Accepted / Denied / Pending counts +
//     acceptance rate, with the Regional Manager's name attached.
//   - Click any count to open the drill-down panel with the patient
//     list for that region + status combination.
//   - Click any patient to expand the full referral detail (read-only).
//
// What this page deliberately does NOT do:
//   - No Accept/Decline action buttons (that's Intake's job)
//   - No edit / chart status fields
//   - No bulk operations
//   - No referral_document downloads (keep PHI surface minimal)
//
// Built 2026-06-09 — Liam (Director of Ops).
// =====================================================================

import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';
import { REGIONS } from '../../lib/constants';

const ALL_REGIONS = ['A','B','C','G','H','J','M','N','T','V'];
const STATUS_BUCKETS = ['Accepted', 'Denied', 'Pending'];

// ─── Date helpers (Sun-Sat work week per project convention) ─────────────
function daysAgo(n) {
  const d = new Date();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function today() {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString().slice(0, 10);
}
function fmtDate(s) {
  if (!s) return '';
  try {
    return new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return s; }
}

// ─── Status normalization (handles Pariox label variants) ────────────────
function bucketOf(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'accepted')      return 'Accepted';
  if (s === 'denied')        return 'Denied';
  if (s === 'pending' || s === 'on hold') return 'Pending';
  return 'Other';
}

const BUCKET_COLORS = {
  Accepted: { color: '#065F46', bg: '#ECFDF5', border: '#10B981' },
  Denied:   { color: '#9C0006', bg: '#FEF2F2', border: '#DC2626' },
  Pending:  { color: '#9C5700', bg: '#FFFBEB', border: '#F59E0B' },
};

// ─── Main page ───────────────────────────────────────────────────────────
export default function MarketingReferralsPage() {
  const { profile } = useAuth();
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(daysAgo(30));
  const [dateTo, setDateTo] = useState(today());
  const [regionFilter, setRegionFilter] = useState('ALL');
  const [drillDown, setDrillDown] = useState(null); // { region, bucket }
  const [selectedPatient, setSelectedPatient] = useState(null);

  function loadData() {
    fetchAllPages(supabase.from('intake_referrals').select('*').order('date_received', { ascending: false }))
      .then(rows => {
        setReferrals(Array.isArray(rows) ? rows : []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load referrals', err);
        setLoading(false);
      });
  }
  useEffect(() => { loadData(); }, []);
  useRealtimeTable(['intake_referrals'], loadData);

  // ─── Apply date + region filter ────────────────────────────────────────
  const filtered = useMemo(() => {
    return referrals.filter(r => {
      const d = r.date_received || '';
      if (dateFrom && d && d < dateFrom) return false;
      if (dateTo && d && d > dateTo) return false;
      if (regionFilter !== 'ALL' && r.region !== regionFilter) return false;
      return true;
    });
  }, [referrals, dateFrom, dateTo, regionFilter]);

  // ─── Aggregate by region ───────────────────────────────────────────────
  const byRegion = useMemo(() => {
    const acc = {};
    ALL_REGIONS.forEach(r => {
      acc[r] = { Accepted: 0, Denied: 0, Pending: 0, Other: 0, total: 0 };
    });
    filtered.forEach(r => {
      const region = r.region || 'UNKNOWN';
      if (!acc[region]) acc[region] = { Accepted: 0, Denied: 0, Pending: 0, Other: 0, total: 0 };
      const b = bucketOf(r.referral_status);
      acc[region][b]++;
      acc[region].total++;
    });
    return acc;
  }, [filtered]);

  // ─── Headline totals ───────────────────────────────────────────────────
  const totals = useMemo(() => {
    const t = { Accepted: 0, Denied: 0, Pending: 0, total: filtered.length };
    filtered.forEach(r => {
      const b = bucketOf(r.referral_status);
      if (t[b] != null) t[b]++;
    });
    return t;
  }, [filtered]);

  const acceptanceRate = totals.total > 0 ? Math.round(totals.Accepted / totals.total * 100) : 0;

  // ─── Drill-down list ───────────────────────────────────────────────────
  const drillRows = useMemo(() => {
    if (!drillDown) return [];
    return filtered.filter(r => {
      if (drillDown.region !== 'ALL' && r.region !== drillDown.region) return false;
      return bucketOf(r.referral_status) === drillDown.bucket;
    }).sort((a, b) => (b.date_received || '').localeCompare(a.date_received || ''));
  }, [filtered, drillDown]);

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Marketing Referrals" subtitle="Loading..." />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading...</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar
        title="Marketing - Referrals by Region"
        subtitle={`${totals.total} referrals in window - ${totals.Accepted} accepted, ${totals.Denied} denied, ${totals.Pending} pending`}
      />
      <div style={{ flex:1, overflow:'auto', padding:20, display:'flex', flexDirection:'column', gap:16 }}>

        {/* Filter bar */}
        <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, padding:16 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
            <FilterCell label="Date From">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
            </FilterCell>
            <FilterCell label="Date To">
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
            </FilterCell>
            <FilterCell label="Region">
              <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} style={inputStyle}>
                <option value="ALL">All Regions</option>
                {ALL_REGIONS.map(r => <option key={r} value={r}>Region {r} - {REGIONS[r] || ''}</option>)}
              </select>
            </FilterCell>
          </div>
          <div style={{ marginTop:10, display:'flex', gap:6 }}>
            <QuickPill label="Last 7 days" active={dateFrom === daysAgo(7) && dateTo === today()} onClick={() => { setDateFrom(daysAgo(7)); setDateTo(today()); }} />
            <QuickPill label="Last 30 days" active={dateFrom === daysAgo(30) && dateTo === today()} onClick={() => { setDateFrom(daysAgo(30)); setDateTo(today()); }} />
            <QuickPill label="Last 90 days" active={dateFrom === daysAgo(90) && dateTo === today()} onClick={() => { setDateFrom(daysAgo(90)); setDateTo(today()); }} />
          </div>
        </div>

        {/* Headline cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12 }}>
          <Stat label="Total Referrals" value={totals.total} accent="#1F4E78" />
          <Stat label="Accepted" value={totals.Accepted} accent="#065F46" sub={`${acceptanceRate}% acceptance rate`} />
          <Stat label="Denied" value={totals.Denied} accent="#9C0006" sub={totals.total > 0 ? `${Math.round(totals.Denied / totals.total * 100)}% denial rate` : ''} />
          <Stat label="Pending" value={totals.Pending} accent="#9C5700" sub="awaiting decision" />
        </div>

        {/* Region table */}
        <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
          <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ fontSize:14, fontWeight:700, color:'var(--black)' }}>Region Breakdown</div>
            <div style={{ fontSize:12, color:'var(--gray)' }}>Click any number to drill into the patient list</div>
          </div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#FAFAFA', borderBottom:'2px solid var(--border)' }}>
                <th style={th}>Region</th>
                <th style={th}>Regional Manager</th>
                <th style={{ ...th, textAlign:'right' }}>Accepted</th>
                <th style={{ ...th, textAlign:'right' }}>Denied</th>
                <th style={{ ...th, textAlign:'right' }}>Pending</th>
                <th style={{ ...th, textAlign:'right' }}>Total</th>
                <th style={{ ...th, textAlign:'right' }}>Acceptance %</th>
              </tr>
            </thead>
            <tbody>
              {ALL_REGIONS.map(region => {
                const r = byRegion[region];
                const rate = r.total > 0 ? Math.round(r.Accepted / r.total * 100) : 0;
                return (
                  <tr key={region} style={{ borderBottom:'1px solid var(--border)' }}>
                    <td style={{ ...td, fontWeight:700, color:'var(--black)' }}>{region}</td>
                    <td style={{ ...td, color:'var(--gray)' }}>{REGIONS[region] || '-'}</td>
                    {STATUS_BUCKETS.map(bucket => (
                      <td key={bucket} style={{ ...td, textAlign:'right' }}>
                        <CountButton
                          count={r[bucket]}
                          bucket={bucket}
                          onClick={() => setDrillDown({ region, bucket })}
                          active={drillDown?.region === region && drillDown?.bucket === bucket}
                        />
                      </td>
                    ))}
                    <td style={{ ...td, textAlign:'right', fontWeight:700, color:'var(--black)' }}>{r.total}</td>
                    <td style={{ ...td, textAlign:'right', color: rate >= 60 ? '#065F46' : rate >= 40 ? '#9C5700' : '#9C0006', fontWeight:600 }}>
                      {r.total > 0 ? `${rate}%` : '-'}
                    </td>
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr style={{ background:'#FAFAFA', fontWeight:700 }}>
                <td style={td} colSpan={2}>All Regions</td>
                {STATUS_BUCKETS.map(bucket => (
                  <td key={bucket} style={{ ...td, textAlign:'right' }}>
                    <CountButton
                      count={totals[bucket]}
                      bucket={bucket}
                      onClick={() => setDrillDown({ region: 'ALL', bucket })}
                      active={drillDown?.region === 'ALL' && drillDown?.bucket === bucket}
                    />
                  </td>
                ))}
                <td style={{ ...td, textAlign:'right' }}>{totals.total}</td>
                <td style={{ ...td, textAlign:'right' }}>{acceptanceRate}%</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Drill-down panel */}
        {drillDown && (
          <div style={{ background:'var(--card-bg)', border:`1px solid ${BUCKET_COLORS[drillDown.bucket].border}`, borderRadius:12, overflow:'hidden' }}>
            <div style={{
              padding:'14px 18px',
              background: BUCKET_COLORS[drillDown.bucket].bg,
              borderBottom:`1px solid ${BUCKET_COLORS[drillDown.bucket].border}`,
              display:'flex', alignItems:'center', justifyContent:'space-between',
            }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color: BUCKET_COLORS[drillDown.bucket].color }}>
                  {drillRows.length} {drillDown.bucket} - {drillDown.region === 'ALL' ? 'All Regions' : `Region ${drillDown.region}`}
                </div>
                <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>Click any patient row to expand details</div>
              </div>
              <button onClick={() => { setDrillDown(null); setSelectedPatient(null); }}
                style={{ background:'transparent', border:'1px solid var(--border)', padding:'6px 12px', borderRadius:6, fontSize:12, cursor:'pointer', color:'var(--gray)' }}>
                Close
              </button>
            </div>

            {drillRows.length === 0 ? (
              <div style={{ padding:30, textAlign:'center', color:'var(--gray)', fontSize:13 }}>
                No referrals in this region for this status in the selected date window.
              </div>
            ) : (
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:'#FAFAFA', borderBottom:'1px solid var(--border)' }}>
                    <th style={th}>Date</th>
                    <th style={th}>Patient</th>
                    <th style={th}>Region</th>
                    <th style={th}>Insurance</th>
                    <th style={th}>Source</th>
                    <th style={th}>PCP</th>
                    {drillDown.bucket === 'Denied' && <th style={th}>Denial Reason</th>}
                  </tr>
                </thead>
                <tbody>
                  {drillRows.map(r => {
                    const isSelected = selectedPatient?.id === r.id;
                    return (
                      <>
                        <tr key={r.id}
                          onClick={() => setSelectedPatient(isSelected ? null : r)}
                          style={{
                            borderBottom: isSelected ? 'none' : '1px solid var(--border)',
                            cursor:'pointer',
                            background: isSelected ? '#EFF6FF' : 'transparent',
                          }}>
                          <td style={td}>{fmtDate(r.date_received)}</td>
                          <td style={{ ...td, fontWeight:600, color:'var(--black)' }}>{r.patient_name || '-'}</td>
                          <td style={td}>{r.region || '-'}</td>
                          <td style={td}>{r.insurance || '-'}</td>
                          <td style={td}>{r.referral_source || '-'}</td>
                          <td style={td}>{r.pcp_name || '-'}</td>
                          {drillDown.bucket === 'Denied' && <td style={{ ...td, fontSize:11, color:'#9C0006' }}>{r.denial_reason || '-'}</td>}
                        </tr>
                        {isSelected && (
                          <tr key={r.id + '-detail'} style={{ background:'#F8FAFC', borderBottom:'1px solid var(--border)' }}>
                            <td colSpan={drillDown.bucket === 'Denied' ? 7 : 6} style={{ padding:'12px 18px' }}>
                              <PatientDetail referral={r} />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Component helpers ───────────────────────────────────────────────────

function Stat({ label, value, sub, accent }) {
  return (
    <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderLeft:`4px solid ${accent}`, borderRadius:10, padding:'14px 16px' }}>
      <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', textTransform:'uppercase', letterSpacing:0.4, marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:26, fontWeight:700, color: accent, lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'var(--gray)', marginTop:4 }}>{sub}</div>}
    </div>
  );
}

function CountButton({ count, bucket, onClick, active }) {
  const c = BUCKET_COLORS[bucket];
  if (count === 0) return <span style={{ color:'var(--gray)', fontSize:13 }}>-</span>;
  return (
    <button onClick={onClick}
      style={{
        background: active ? c.color : c.bg,
        color: active ? '#fff' : c.color,
        border:`1px solid ${c.border}`,
        borderRadius:6,
        padding:'4px 12px',
        fontSize:13,
        fontWeight:700,
        cursor:'pointer',
        minWidth:48,
      }}>
      {count}
    </button>
  );
}

function FilterCell({ label, children }) {
  return (
    <div>
      <div style={{ fontSize:11, fontWeight:600, color:'var(--gray)', marginBottom:4 }}>{label}</div>
      {children}
    </div>
  );
}

function QuickPill({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      style={{
        background: active ? '#1565C0' : 'var(--bg)',
        color: active ? '#fff' : 'var(--gray)',
        border: '1px solid var(--border)',
        borderRadius: 999,
        padding: '4px 12px',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
      }}>
      {label}
    </button>
  );
}

function PatientDetail({ referral }) {
  const r = referral;
  const fields = [
    ['Patient Name', r.patient_name],
    ['DOB', fmtDate(r.dob)],
    ['Phone', r.phone || r.contact_number],
    ['Address', [r.location, r.city, r.zip_code].filter(Boolean).join(', ')],
    ['County', r.county],
    ['Region', r.region],
    ['Date Received', fmtDate(r.date_received)],
    ['Referral Status', r.referral_status],
    ['Referral Type', r.referral_type],
    ['Insurance (Primary)', r.insurance],
    ['Policy Number', r.policy_number],
    ['Secondary Insurance', r.secondary_insurance],
    ['Secondary ID', r.secondary_id],
    ['Medicare Type', r.medicare_type],
    ['Diagnosis', r.diagnosis_clean || r.diagnosis],
    ['PCP Name', r.pcp_name],
    ['PCP Phone', r.pcp_phone],
    ['PCP Fax', r.pcp_fax],
    ['Referral Source', r.referral_source],
    ['Referral Source Phone', r.referral_source_phone],
    ['Referral Source Fax', r.referral_source_fax],
    ['Chart Status', r.chart_status],
    ['Welcome Call', r.welcome_call],
    ['First Appt', fmtDate(r.first_appt)],
    ['Denial Reason', r.denial_reason],
    ['Notes', r.notes],
  ];
  return (
    <div>
      <div style={{ fontSize:12, fontWeight:700, color:'var(--black)', marginBottom:10 }}>Full Referral Detail</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'10px 24px' }}>
        {fields.filter(([_, v]) => v && String(v).trim()).map(([label, value]) => (
          <div key={label}>
            <div style={{ fontSize:10, color:'var(--gray)', fontWeight:600, textTransform:'uppercase', letterSpacing:0.3 }}>{label}</div>
            <div style={{ fontSize:13, color:'var(--black)', marginTop:2 }}>{String(value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────
const inputStyle = {
  width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, outline:'none', background:'var(--bg)', boxSizing:'border-box',
};
const th = { textAlign:'left', padding:'10px 14px', fontSize:11, color:'var(--gray)', fontWeight:600, textTransform:'uppercase', letterSpacing:0.3 };
const td = { padding:'10px 14px', verticalAlign:'top' };
