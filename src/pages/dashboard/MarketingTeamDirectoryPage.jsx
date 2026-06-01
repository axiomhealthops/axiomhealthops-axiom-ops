// Marketing Team Directory
//
// Phase 2a build (2026-05-30). Single canonical source for the marketing
// org structure: who's on the marketing team, what role they play, what
// territory they cover, and who they work alongside.
//
// Backed by:
//   marketing_territories       — 8 named territories with counties + region_group
//   marketing_team_assignments  — coordinator → territory with assignment_role
//   v_marketing_team_directory  — denormalized active view
//
// Role split per v5 design (CLINICAL_PRIMARY_ROLES vs. MARKETING_PRIMARY_ROLES
// in constants.js). HAEs are marketing-primary, ADCs + RMs are clinical-primary
// with marketing as secondary contribution.
//
// Standard Duties block on the right is a static reference from constants.
// Click any person card to deep-link to Marketing CRM filtered to them.

import { useState, useEffect, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import {
  CLINICAL_PRIMARY_ROLES,
  MARKETING_PRIMARY_ROLES,
  MARKETING_STANDARD_DUTIES,
  ASSIGNMENT_ROLE_LABELS,
  ASSIGNMENT_ROLE_COLORS,
  isMarketingPrimary,
} from '../../lib/constants';

const REGION_GROUPS = ['North FL', 'Central FL', 'South FL', 'Georgia'];
const STATES = ['FL', 'GA'];
const PRIMARY_FILTER_OPTIONS = [
  { key: 'ALL',       label: 'All Team Members' },
  { key: 'MARKETING', label: 'Marketing Primary' },
  { key: 'CLINICAL',  label: 'Clinical Primary + Marketing Secondary' },
];

function classify(codeRole) {
  if (MARKETING_PRIMARY_ROLES.includes(codeRole)) return 'MARKETING';
  if (CLINICAL_PRIMARY_ROLES.includes(codeRole))  return 'CLINICAL';
  return 'OTHER';
}

function roleDisplayShort(codeRole) {
  if (codeRole === 'healthcare_account_executive') return 'HAE';
  if (codeRole === 'assoc_director')               return 'ADC';
  if (codeRole === 'regional_manager')             return 'RM';
  if (codeRole === 'admin' || codeRole === 'super_admin') return 'Admin';
  return codeRole || '';
}

function roleDisplayFull(codeRole) {
  if (codeRole === 'healthcare_account_executive') return 'Healthcare Account Executive';
  if (codeRole === 'assoc_director')               return 'Associate Clinical Director';
  if (codeRole === 'regional_manager')             return 'Regional Manager';
  if (codeRole === 'admin')                        return 'Administrator';
  if (codeRole === 'super_admin')                  return 'Director';
  return codeRole || '';
}

function AssignmentBadge({ assignmentRole }) {
  const c = ASSIGNMENT_ROLE_COLORS[assignmentRole] || ASSIGNMENT_ROLE_COLORS.partner;
  const label = ASSIGNMENT_ROLE_LABELS[assignmentRole] || assignmentRole;
  return (
    <span style={{
      display:'inline-block', padding:'2px 8px', borderRadius:999,
      fontSize:10, fontWeight:700, color:c.fg, background:c.bg,
      border:`1px solid ${c.border}`, letterSpacing:'0.02em',
    }}>{label}</span>
  );
}

function PrimaryBadge({ kind }) {
  if (kind === 'MARKETING') {
    return (
      <span style={{
        display:'inline-block', padding:'2px 8px', borderRadius:999,
        fontSize:10, fontWeight:700, color:'#9A3412', background:'#FFF7ED',
        border:'1px solid #FED7AA', letterSpacing:'0.02em',
      }}>Marketing Primary</span>
    );
  }
  if (kind === 'CLINICAL') {
    return (
      <span style={{
        display:'inline-block', padding:'2px 8px', borderRadius:999,
        fontSize:10, fontWeight:700, color:'#1E40AF', background:'#EFF6FF',
        border:'1px solid #BFDBFE', letterSpacing:'0.02em',
      }}>Clinical Primary + Marketing Secondary</span>
    );
  }
  return (
    <span style={{
      display:'inline-block', padding:'2px 8px', borderRadius:999,
      fontSize:10, fontWeight:700, color:'#374151', background:'#F3F4F6',
      border:'1px solid #D1D5DB', letterSpacing:'0.02em',
    }}>Administrative</span>
  );
}

function PersonCard({ person, otherAssignmentsInTerritory, onOpenCRM }) {
  const kind = classify(person.code_role);
  return (
    <div style={{
      background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:12,
      padding:16, display:'flex', flexDirection:'column', gap:10,
      boxShadow:'0 1px 2px rgba(0,0,0,0.03)',
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
        <div style={{ minWidth:0, flex:1 }}>
          <div style={{ fontSize:15, fontWeight:700, color:'var(--black)', lineHeight:1.2 }}>
            {person.full_name}
          </div>
          <div style={{ fontSize:11, color:'var(--gray)', marginTop:2 }}>
            {roleDisplayFull(person.code_role)} {person.job_title && person.job_title !== roleDisplayFull(person.code_role) ? `· ${person.job_title}` : ''}
          </div>
        </div>
        <span style={{
          flexShrink:0, fontSize:10, fontWeight:700, color:'#fff', background:'#0F1117',
          padding:'3px 7px', borderRadius:6, letterSpacing:'0.04em',
        }}>{roleDisplayShort(person.code_role)}</span>
      </div>

      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        <PrimaryBadge kind={kind} />
        {person.assignment_roles.map(ar => (
          <AssignmentBadge key={ar} assignmentRole={ar} />
        ))}
      </div>

      <div style={{ fontSize:12, color:'var(--black)', borderTop:'1px solid var(--border)', paddingTop:8 }}>
        <div style={{ fontWeight:600, marginBottom:2 }}>
          {person.territory_name}
        </div>
        <div style={{ fontSize:10, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em' }}>
          {person.region_group} · {person.state}
        </div>
        {person.counties?.length > 0 && (
          <div style={{ fontSize:11, color:'var(--gray)', marginTop:4 }}>
            Counties: {person.counties.join(', ')}
          </div>
        )}
      </div>

      {otherAssignmentsInTerritory.length > 0 && (
        <div style={{ fontSize:11, color:'var(--gray)', borderTop:'1px solid var(--border)', paddingTop:8 }}>
          <div style={{ fontWeight:600, color:'var(--gray)', textTransform:'uppercase', fontSize:9, letterSpacing:'0.06em', marginBottom:4 }}>
            Working with
          </div>
          {otherAssignmentsInTerritory.map((o, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'2px 0' }}>
              <span style={{ color:'var(--black)' }}>{o.full_name}</span>
              <span style={{ fontSize:10, color:'var(--gray)' }}>
                {roleDisplayShort(o.code_role)} · {ASSIGNMENT_ROLE_LABELS[o.assignment_role] || o.assignment_role}
              </span>
            </div>
          ))}
        </div>
      )}

      {person.notes && (
        <div style={{
          fontSize:10, color:'#9A3412', background:'#FFF7ED',
          border:'1px solid #FED7AA', borderRadius:6, padding:'6px 8px',
          fontStyle:'italic', lineHeight:1.4,
        }}>
          {person.notes}
        </div>
      )}

      {!person.coordinator_active && (
        <div style={{
          fontSize:10, color:'#92400E', background:'#FEF3C7',
          border:'1px solid #FDE68A', borderRadius:6, padding:'6px 8px',
          fontWeight:600,
        }}>
          Pending onboarding — not yet active
        </div>
      )}

      <button onClick={() => onOpenCRM(person.coordinator_id)} style={{
        marginTop:'auto', alignSelf:'flex-start', fontSize:11, fontWeight:600,
        color:'#1565C0', background:'none', border:'none', cursor:'pointer', padding:0,
      }}>
        View in Marketing CRM →
      </button>
    </div>
  );
}

function TerritoryRow({ territory, assignments }) {
  return (
    <tr style={{ borderTop:'1px solid var(--border)' }}>
      <td style={{ padding:'10px 12px', verticalAlign:'top' }}>
        <div style={{ fontSize:13, fontWeight:700, color:'var(--black)' }}>{territory.name}</div>
        <div style={{ fontSize:10, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', marginTop:2 }}>
          {territory.region_group} · {territory.state}
        </div>
        {territory.counties?.length > 0 && (
          <div style={{ fontSize:11, color:'var(--gray)', marginTop:4 }}>
            {territory.counties.join(', ')}
          </div>
        )}
        {territory.legacy_region_letters?.length > 0 && (
          <div style={{ fontSize:9, color:'var(--gray)', marginTop:2 }}>
            Legacy: {territory.legacy_region_letters.map(l => `Region ${l}`).join(' · ')}
          </div>
        )}
      </td>
      <td style={{ padding:'10px 12px', verticalAlign:'top' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {assignments.map(a => (
            <div key={a.coordinator_id + a.assignment_role} style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <AssignmentBadge assignmentRole={a.assignment_role} />
              <span style={{ fontSize:12, fontWeight:600, color:'var(--black)' }}>{a.full_name}</span>
              <span style={{ fontSize:10, color:'var(--gray)' }}>{roleDisplayShort(a.code_role)}</span>
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
}

export default function MarketingTeamDirectoryPage({ onNavigate }) {
  const { profile } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const [filterState, setFilterState]         = useState('ALL');
  const [filterRegionGroup, setFilterRegionGroup] = useState('ALL');
  const [filterPrimary, setFilterPrimary]     = useState('ALL');
  const [searchQ, setSearchQ]                 = useState('');

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        // fetchAllPages returns the rows array directly (Promise<any[]>),
        // NOT a { data, error } object. Bug-fix 2026-05-30: prior version
        // destructured as { data, error } which silently set data=undefined
        // and rendered "0 team members" even though the DB had all 16 rows.
        const rowsArr = await fetchAllPages(
          supabase.from('v_marketing_team_directory').select('*')
        );
        if (!mounted) return;
        setRows(Array.isArray(rowsArr) ? rowsArr : []);
      } catch (err) {
        console.error('Marketing Team Directory load error:', err);
        if (mounted) setRows([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  // Aggregate one card per (person, territory) — collapse multiple assignment roles
  // for the same person/territory into a single card with multiple badges.
  const cards = useMemo(() => {
    const grouped = new Map();
    rows.forEach(r => {
      const key = `${r.coordinator_id}::${r.territory_id}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          ...r,
          assignment_roles: [r.assignment_role],
        });
      } else {
        grouped.get(key).assignment_roles.push(r.assignment_role);
      }
    });
    return Array.from(grouped.values());
  }, [rows]);

  // For each card, find OTHER people active in the same territory.
  const territoryCoverage = useMemo(() => {
    const byTerritory = new Map();
    rows.forEach(r => {
      if (!byTerritory.has(r.territory_id)) byTerritory.set(r.territory_id, []);
      byTerritory.get(r.territory_id).push(r);
    });
    return byTerritory;
  }, [rows]);

  function otherWorkersInTerritory(person) {
    const all = territoryCoverage.get(person.territory_id) || [];
    return all.filter(r => r.coordinator_id !== person.coordinator_id);
  }

  // Filtering
  const visibleCards = useMemo(() => cards.filter(c => {
    if (filterState !== 'ALL' && c.state !== filterState) return false;
    if (filterRegionGroup !== 'ALL' && c.region_group !== filterRegionGroup) return false;
    if (filterPrimary !== 'ALL') {
      const kind = classify(c.code_role);
      if (filterPrimary === 'MARKETING' && kind !== 'MARKETING') return false;
      if (filterPrimary === 'CLINICAL'  && kind !== 'CLINICAL')  return false;
    }
    if (searchQ) {
      const hay = `${c.full_name} ${c.territory_name} ${c.region_group} ${(c.counties||[]).join(' ')}`.toLowerCase();
      if (!hay.includes(searchQ.toLowerCase())) return false;
    }
    return true;
  }), [cards, filterState, filterRegionGroup, filterPrimary, searchQ]);

  // Territories grouped by region for the bottom section
  const territoriesView = useMemo(() => {
    const byTerritory = new Map();
    rows.forEach(r => {
      if (!byTerritory.has(r.territory_id)) {
        byTerritory.set(r.territory_id, {
          territory: {
            id: r.territory_id,
            name: r.territory_name,
            state: r.state,
            region_group: r.region_group,
            counties: r.counties,
            legacy_region_letters: r.legacy_region_letters || [],
          },
          assignments: [],
        });
      }
      byTerritory.get(r.territory_id).assignments.push(r);
    });

    // Order: by region_group then sort by primary first
    const ROLE_RANK = { primary:0, oversight:1, supervisor:2, partner:3 };
    const all = Array.from(byTerritory.values());
    all.forEach(t => t.assignments.sort((a,b) => (ROLE_RANK[a.assignment_role]||9) - (ROLE_RANK[b.assignment_role]||9)));

    return all.sort((a,b) => {
      const rg = REGION_GROUPS.indexOf(a.territory.region_group) - REGION_GROUPS.indexOf(b.territory.region_group);
      if (rg !== 0) return rg;
      return a.territory.name.localeCompare(b.territory.name);
    });
  }, [rows]);

  // KPI strip
  const summary = useMemo(() => {
    const uniqPeople = new Set(rows.map(r => r.coordinator_id));
    const marketing  = new Set(rows.filter(r => isMarketingPrimary(r.code_role)).map(r => r.coordinator_id));
    const clinical   = new Set(rows.filter(r => CLINICAL_PRIMARY_ROLES.includes(r.code_role)).map(r => r.coordinator_id));
    const territories = new Set(rows.map(r => r.territory_id));
    return {
      totalPeople: uniqPeople.size,
      marketingPrimary: marketing.size,
      clinicalPrimary: clinical.size,
      territories: territories.size,
    };
  }, [rows]);

  function openInCRM(coordinatorId) {
    // Phase 2b will wire the CRM filter to this query param.
    if (onNavigate) {
      onNavigate('marketing-crm', { rep: coordinatorId });
    }
  }

  if (loading) {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
        <TopBar title="Marketing Team Directory" subtitle="Loading..." />
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>
          Loading directory...
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100%' }}>
      <TopBar
        title="Marketing Team Directory"
        subtitle={`${summary.totalPeople} team members · ${summary.territories} territories · ${summary.marketingPrimary} marketing-primary · ${summary.clinicalPrimary} clinical-primary contributors`}
      />

      <div style={{ padding:20, display:'grid', gridTemplateColumns:'1fr 280px', gap:20 }}>
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

          {/* KPI strip */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:12 }}>
            {[
              { label:'Team Members',        val:summary.totalPeople,      color:'var(--black)' },
              { label:'Marketing Primary',   val:summary.marketingPrimary, color:'#9A3412', bg:'#FFF7ED' },
              { label:'Clinical Primary',    val:summary.clinicalPrimary,  color:'#1E40AF', bg:'#EFF6FF' },
              { label:'Territories',         val:summary.territories,      color:'#065F46', bg:'#ECFDF5' },
            ].map(c => (
              <div key={c.label} style={{ background:c.bg||'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:10, fontWeight:600, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.04em' }}>{c.label}</div>
                <div style={{ fontSize:22, fontWeight:900, fontFamily:'DM Mono, monospace', color:c.color, marginTop:4 }}>{c.val}</div>
              </div>
            ))}
          </div>

          {/* Filter bar */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'10px 14px', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search name, territory, county..."
              style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)', width:240 }} />
            <select value={filterState} onChange={e => setFilterState(e.target.value)}
              style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)' }}>
              <option value="ALL">All States</option>
              {STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterRegionGroup} onChange={e => setFilterRegionGroup(e.target.value)}
              style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)' }}>
              <option value="ALL">All Regions</option>
              {REGION_GROUPS.map(rg => <option key={rg} value={rg}>{rg}</option>)}
            </select>
            <select value={filterPrimary} onChange={e => setFilterPrimary(e.target.value)}
              style={{ padding:'6px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, outline:'none', background:'var(--bg)' }}>
              {PRIMARY_FILTER_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <span style={{ marginLeft:'auto', fontSize:11, color:'var(--gray)' }}>
              Showing {visibleCards.length} of {cards.length}
            </span>
          </div>

          {/* Card grid */}
          {visibleCards.length === 0 ? (
            <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:30, textAlign:'center', color:'var(--gray)' }}>
              No team members match the current filters.
            </div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:14 }}>
              {visibleCards.map(c => (
                <PersonCard
                  key={c.coordinator_id + c.territory_id}
                  person={c}
                  otherAssignmentsInTerritory={otherWorkersInTerritory(c)}
                  onOpenCRM={openInCRM}
                />
              ))}
            </div>
          )}

          {/* Territories section */}
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:'16px 20px', marginTop:8 }}>
            <div style={{ fontSize:14, fontWeight:700, color:'var(--black)', marginBottom:4 }}>Territories</div>
            <div style={{ fontSize:11, color:'var(--gray)', marginBottom:12 }}>
              Inverse view — who covers what. Sorted by region group, primary listed first.
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'var(--bg)' }}>
                  <th style={{ textAlign:'left', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', padding:'8px 12px', borderBottom:'1px solid var(--border)' }}>Territory</th>
                  <th style={{ textAlign:'left', fontSize:10, fontWeight:700, color:'var(--gray)', textTransform:'uppercase', letterSpacing:'0.05em', padding:'8px 12px', borderBottom:'1px solid var(--border)' }}>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {territoriesView.map(t => (
                  <TerritoryRow key={t.territory.id} territory={t.territory} assignments={t.assignments} />
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize:11, color:'var(--gray)', textAlign:'center', padding:'8px 0 4px' }}>
            EdemaCare is a service of AxiomHealth Management LLC
          </div>
        </div>

        {/* Right rail — Standard Duties */}
        <aside style={{ position:'sticky', top:20, alignSelf:'flex-start', maxHeight:'calc(100vh - 40px)', overflow:'auto' }}>
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:16 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--black)', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:10 }}>
              Standard Marketing Duties
            </div>
            <div style={{ fontSize:11, color:'var(--gray)', marginBottom:10 }}>
              All marketing team members are accountable for the following 10 duties in their assigned territories.
            </div>
            <ol style={{ paddingLeft:18, margin:0, fontSize:12, color:'var(--black)', lineHeight:1.5 }}>
              {MARKETING_STANDARD_DUTIES.map((d, i) => (
                <li key={i} style={{ marginBottom:8 }}>{d}</li>
              ))}
            </ol>
          </div>

          <div style={{ background:'var(--card-bg)', border:'1px solid var(--border)', borderRadius:10, padding:14, marginTop:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--black)', marginBottom:6 }}>Role Legend</div>
            <div style={{ fontSize:11, color:'var(--gray)', lineHeight:1.6 }}>
              <div><strong style={{ color:'#9A3412' }}>Marketing Primary</strong> — HAE. Full-volume marketing scorecard.</div>
              <div><strong style={{ color:'#1E40AF' }}>Clinical Primary</strong> — ADC, RM. Marketing is a secondary contribution; not held to HAE volume.</div>
              <div style={{ marginTop:6 }}>
                <strong>Primary</strong> = day-to-day outreach owner ·
                <strong> Oversight</strong> = clinical-primary marketing-secondary in own territory ·
                <strong> Supervisor</strong> = ADC clinical oversight
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
