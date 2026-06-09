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
import {
  TERRITORIES, TERRITORY_LETTERS,
  GA_TERRITORIES, GA_TERRITORY_LETTERS,
  isGeorgiaRegion,
} from '../../lib/constants';

const ALL_REGIONS = TERRITORY_LETTERS;
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

  // ─── Apply date + region filter (FL + GA, both on this page) ──
  // The region filter dropdown lets the user narrow to a specific
  // Florida territory letter OR a specific GA sub-territory.
  const filtered = useMemo(() => {
    return referrals.filter(r => {
      const d = r.date_received || '';
      if (dateFrom && d && d < dateFrom) return false;
      if (dateTo && d && d > dateTo) return false;
      if (regionFilter !== 'ALL' && r.region !== regionFilter) return false;
      return true;
    });
  }, [referrals, dateFrom, dateTo, regionFilter]);

  // Florida rows (everything that's NOT GA)
  const filteredFL = useMemo(() => filtered.filter(r => !isGeorgiaRegion(r.region)), [filtered]);
  // Georgia rows
  const filteredGA = useMemo(() => filtered.filter(r => isGeorgiaRegion(r.region)),  [filtered]);

  // ─── Aggregate FL by territory letter ──────────────────────────────────
  const byRegion = useMemo(() => {
    const acc = {};
    ALL_REGIONS.forEach(r => { acc[r] = { Accepted: 0, Denied: 0, Pending: 0, Other: 0, total: 0 }; });
    filteredFL.forEach(r => {
      const region = r.region || 'UNKNOWN';
      if (!acc[region]) acc[region] = { Accepted: 0, Denied: 0, Pending: 0, Other: 0, total: 0 };
      const b = bucketOf(r.referral_status);
      acc[region][b]++;
      acc[region].total++;
    });
    return acc;
  }, [filteredFL]);

  // ─── Aggregate GA by sub-territory ─────────────────────────────────────
  const byRegionGA = useMemo(() => {
    const acc = {};
    GA_TERRITORY_LETTERS.forEach(r => { acc[r] = { Accepted: 0, Denied: 0, Pending: 0, Other: 0, total: 0 }; });
    filteredGA.forEach(r => {
      const region = String(r.region || '').toUpperCase();
      if (!acc[region]) acc[region] = { Accepted: 0, Denied: 0, Pending: 0, Other: 0, total: 0 };
      const b = bucketOf(r.referral_status);
      acc[region][b]++;
      acc[region].total++;
    });
    return acc;
  }, [filteredGA]);

  // ─── Headline totals (FL + GA combined) + per-state breakdown ──────────
  function sumStatuses(rows) {
    const t = { Accepted: 0, Denied: 0, Pending: 0, total: rows.length };
    rows.forEach(r => {
      const b = bucketOf(r.referral_status);
      if (t[b] != null) t[b]++;
    });
    return t;
  }
  const totals   = useMemo(() => sumStatuses(filtered),   [filtered]);
  const totalsFL = useMemo(() => sumStatuses(filteredFL), [filteredFL]);
  const totalsGA = useMemo(() => sumStatuses(filteredGA), [filteredGA]);

  const acceptanceRate = totals.total > 0 ? Math.round(totals.Accepted / totals.total * 100) : 0;

  // ─── Drill-down list ───────────────────────────────────────────────────
  // drillDown.scope: 'FL_ALL' | 'GA_ALL' | 'TERRITORY'. 'TERRITORY' uses
  // drillDown.region (the letter / 'GA' value).
  const drillRows = useMemo(() => {
    if (!drillDown) return [];
    return filtered.filter(r => {
      if (drillDown.scope === 'FL_ALL') {
        if (isGeorgiaRegion(r.region)) return false;
      } else if (drillDown.scope === 'GA_ALL') {
        if (!isGeorgiaRegion(r.region)) return false;
      } else {
        // specific territory
        if (String(r.region || '').toUpperCase() !== String(drillDown.region || '').toUpperCase()) return false;
      }
      return bucketOf(r.referral_status) === drillDown.bucket;
    }).sort((a, b) => (b.date_received || '').localeCompare(a.date_received || ''));
  }, [filtered, drillDown]);

  function drillLabel(d) {
    if (!d) return '';
    if (d.scope === 'FL_ALL') return 'All Florida Territories';
    if (d.scope === 'GA_ALL') return 'All Georgia';
    const fl = TERRITORIES[d.region];
    const ga = GA_TERRITORIES[d.region];
    if (fl) return `Territory ${d.region} (${fl.counties})`;
    if (ga) return `Georgia${d.region === 'GA' ? '' : ' - ' + d.region}`;
    return `Region ${d.region}`;
  }

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar title="Marketing Referrals" subtitle="Loading..." />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>Loading...</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <TopBar
        title="Marketing - Referrals by Territory"
        subtitle={`${totals.total} referrals in window (FL ${totalsFL.total} / GA ${totalsGA.total}) - ${totals.Accepted} accepted, ${totals.Denied} denied, ${totals.Pending} pending`}
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
            <FilterCell label="Territory">
              <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} style={inputStyle}>
                <option value="ALL">All Territories (FL + GA)</option>
                <optgroup label="Florida">
                  {ALL_REGIONS.map(r => {
                    const t = TERRITORIES[r];
                    return <option key={r} value={r}>Territory {r} ({t.counties}) - {t.marketingLead}</option>;
                  })}
                </optgroup>
                <optgroup label="Georgia">
                  {GA_TERRITORY_LETTERS.map(r => {
                    const t = GA_TERRITORIES[r];
                    return <option key={r} value={r}>{r === 'GA' ? 'Georgia (all)' : r} - {t.marketingLead}</option>;
                  })}
                </optgroup>
              </select>
            </FilterCell>
          </div>
          <div style={{ marginTop:10, display:'flex', gap:6 }}>
            <QuickPill label="Last 7 days" active={dateFrom === daysAgo(7) && dateTo === today()} onClick={() => { setDateFrom(daysAgo(7)); setDateTo(today()); }} />
            <QuickPill label="Last 30 days" active={dateFrom === daysAgo(30) && dateTo === today()} onClick={() => { setDateFrom(daysAgo(30)); setDateTo(today()); }} />
            <QuickPill label="Last 90 days" active={dateFrom === daysAgo(90) && dateTo === today()} onClick={() => { setDateFrom(daysAgo(90)); setDateTo(today()); }} />
          </div>
        </div>

        {/* Headline cards (combined) */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12 }}>
          <Stat label="Total Referrals" value={totals.total} accent="#1F4E78" sub={`FL ${totalsFL.total} - GA ${totalsGA.total}`} />
          <Stat label="Accepted" value={totals.Accepted} accent="#065F46" sub={`${acceptanceRate}% acceptance rate`} />
          <Stat label="Denied" value={totals.Denied} accent="#9C0006" sub={totals.total > 0 ? `${Math.round(totals.Denied / totals.total * 100)}% denial rate` : ''} />
          <Stat label="Pending" value={totals.Pending} accent="#9C5700" sub="awaiting decision" />
        </div>

        {/* Region table */}
        {/* ── Florida table ── */}
        <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
          <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ fontSize:14, fontWeight:700, color:'var(--black)' }}>Florida Territories</div>
            <span style={{ fontSize:10, fontWeight:700, color:'#0369A1', background:'#EFF6FF', padding:'2px 8px', borderRadius:999, textTransform:'uppercase', letterSpacing:0.3 }}>FL</span>
            <div style={{ fontSize:12, color:'var(--gray)' }}>Click any number to drill into the patient list</div>
          </div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#FAFAFA', borderBottom:'2px solid var(--border)' }}>
                <th style={th}>Territory</th>
                <th style={th}>Counties</th>
                <th style={th}>Marketing Lead</th>
                <th style={th}>Clinical Lead</th>
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
                const t = TERRITORIES[region];
                const rate = r.total > 0 ? Math.round(r.Accepted / r.total * 100) : 0;
                return (
                  <tr key={region} style={{ borderBottom:'1px solid var(--border)' }}>
                    <td style={{ ...td, fontWeight:700, color:'var(--black)', whiteSpace:'nowrap' }}>
                      Territory {region}
                    </td>
                    <td style={{ ...td, color:'var(--gray)', fontSize:12 }}>{t?.counties || '-'}</td>
                    <td style={{ ...td, color:'var(--black)' }}>
                      {t?.marketingLead || '-'}
                      {t?.marketingLeadRole && (
                        <span style={{
                          marginLeft:6, fontSize:10, fontWeight:600,
                          color: '#9A3412', background: '#FFF7ED',
                          padding:'1px 6px', borderRadius:999,
                        }}>
                          {t.marketingLeadRole}
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, color:'var(--black)' }}>
                      {t?.manager || '-'}
                      {t?.managerRole && (
                        <span style={{
                          marginLeft:6, fontSize:10, fontWeight:600,
                          color: t.managerRole === 'AD' ? '#7C3AED' : '#1565C0',
                          background: t.managerRole === 'AD' ? '#F5F3FF' : '#EFF6FF',
                          padding:'1px 6px', borderRadius:999,
                        }}>
                          {t.managerRole}
                        </span>
                      )}
                    </td>
                    {STATUS_BUCKETS.map(bucket => (
                      <td key={bucket} style={{ ...td, textAlign:'right' }}>
                        <CountButton
                          count={r[bucket]}
                          bucket={bucket}
                          onClick={() => setDrillDown({ scope:'TERRITORY', region, bucket })}
                          active={drillDown?.scope === 'TERRITORY' && drillDown?.region === region && drillDown?.bucket === bucket}
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
              {/* Totals row for Florida */}
              <tr style={{ background:'#FAFAFA', fontWeight:700 }}>
                <td style={td} colSpan={4}>All Florida Territories</td>
                {STATUS_BUCKETS.map(bucket => (
                  <td key={bucket} style={{ ...td, textAlign:'right' }}>
                    <CountButton
                      count={totalsFL[bucket]}
                      bucket={bucket}
                      onClick={() => setDrillDown({ scope:'FL_ALL', bucket })}
                      active={drillDown?.scope === 'FL_ALL' && drillDown?.bucket === bucket}
                    />
                  </td>
                ))}
                <td style={{ ...td, textAlign:'right' }}>{totalsFL.total}</td>
                <td style={{ ...td, textAlign:'right' }}>{totalsFL.total > 0 ? `${Math.round(totalsFL.Accepted / totalsFL.total * 100)}%` : '-'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── Georgia table ── */}
        <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
          <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ fontSize:14, fontWeight:700, color:'var(--black)' }}>Georgia (Expansion)</div>
            <span style={{ fontSize:10, fontWeight:700, color:'#9A3412', background:'#FFF7ED', padding:'2px 8px', borderRadius:999, textTransform:'uppercase', letterSpacing:0.3 }}>GA</span>
            <div style={{ fontSize:12, color:'var(--gray)' }}>Walter Holston - HAE for all Georgia coverage</div>
          </div>
          {totalsGA.total === 0 && (
            <div style={{ padding:'16px 18px', background:'#FFFBEB', borderBottom:'1px solid var(--border)', fontSize:12, color:'#92400E' }}>
              <strong>No Georgia referrals yet.</strong> When Walter starts bringing them in, intake should tag <code style={{ background:'#fff', padding:'1px 4px', borderRadius:3 }}>region = 'GA'</code> (or GA-N / GA-C / GA-S for future sub-territories) and they will appear here automatically.
            </div>
          )}
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#FAFAFA', borderBottom:'2px solid var(--border)' }}>
                <th style={th}>Coverage</th>
                <th style={th}>Counties</th>
                <th style={th}>Marketing Lead</th>
                <th style={th}>Clinical Lead</th>
                <th style={{ ...th, textAlign:'right' }}>Accepted</th>
                <th style={{ ...th, textAlign:'right' }}>Denied</th>
                <th style={{ ...th, textAlign:'right' }}>Pending</th>
                <th style={{ ...th, textAlign:'right' }}>Total</th>
                <th style={{ ...th, textAlign:'right' }}>Acceptance %</th>
              </tr>
            </thead>
            <tbody>
              {GA_TERRITORY_LETTERS.map(region => {
                const r = byRegionGA[region] || { Accepted:0, Denied:0, Pending:0, total:0 };
                const t = GA_TERRITORIES[region];
                const rate = r.total > 0 ? Math.round(r.Accepted / r.total * 100) : 0;
                return (
                  <tr key={region} style={{ borderBottom:'1px solid var(--border)' }}>
                    <td style={{ ...td, fontWeight:700, color:'var(--black)', whiteSpace:'nowrap' }}>
                      {region === 'GA' ? 'All Georgia' : `Territory ${region}`}
                    </td>
                    <td style={{ ...td, color:'var(--gray)', fontSize:12 }}>{t?.counties || '-'}</td>
                    <td style={{ ...td, color:'var(--black)' }}>
                      {t?.marketingLead || '-'}
                      {t?.marketingLeadRole && (
                        <span style={{ marginLeft:6, fontSize:10, fontWeight:600, color:'#9A3412', background:'#FFF7ED', padding:'1px 6px', borderRadius:999 }}>
                          {t.marketingLeadRole}
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, color:'var(--gray)' }}>—</td>
                    {STATUS_BUCKETS.map(bucket => (
                      <td key={bucket} style={{ ...td, textAlign:'right' }}>
                        <CountButton
                          count={r[bucket]}
                          bucket={bucket}
                          onClick={() => setDrillDown({ scope:'TERRITORY', region, bucket })}
                          active={drillDown?.scope === 'TERRITORY' && drillDown?.region === region && drillDown?.bucket === bucket}
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
              {/* Totals row for Georgia */}
              <tr style={{ background:'#FAFAFA', fontWeight:700 }}>
                <td style={td} colSpan={4}>All Georgia</td>
                {STATUS_BUCKETS.map(bucket => (
                  <td key={bucket} style={{ ...td, textAlign:'right' }}>
                    <CountButton
                      count={totalsGA[bucket]}
                      bucket={bucket}
                      onClick={() => setDrillDown({ scope:'GA_ALL', bucket })}
                      active={drillDown?.scope === 'GA_ALL' && drillDown?.bucket === bucket}
                    />
                  </td>
                ))}
                <td style={{ ...td, textAlign:'right' }}>{totalsGA.total}</td>
                <td style={{ ...td, textAlign:'right' }}>{totalsGA.total > 0 ? `${Math.round(totalsGA.Accepted / totalsGA.total * 100)}%` : '-'}</td>
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
                  {drillRows.length} {drillDown.bucket} - {drillLabel(drillDown)}
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
                    <th style={th}>Territory</th>
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
                          <td style={td}>{r.region ? `Territory ${r.region}` : '-'}</td>
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
    ['Territory', r.region ? `${r.region} - ${TERRITORIES[r.region]?.counties || ''}` : ''],
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
