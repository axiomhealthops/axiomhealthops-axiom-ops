import React, { useState, useMemo } from 'react';
import TopBar from '../../components/TopBar';
import { REGIONS } from '../../lib/constants';

export default function StaffDirectoryPage() {
  const visits = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('axiom_pariox_data') || '[]'); } catch { return []; }
  }, []);

  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('ALL');
  const [disciplineFilter, setDisciplineFilter] = useState('ALL');

  // Build staff directory from visit data
  const staff = useMemo(() => {
    const map = {};
    visits.forEach(v => {
      if (!v.staff_name) return;
      if (!map[v.staff_name]) {
        map[v.staff_name] = {
          name: v.staff_name,
          discipline: v.discipline || 'Unknown',
          regions: new Set(),
          totalVisits: 0,
          completed: 0,
          scheduled: 0,
          missed: 0,
        };
      }
      const s = map[v.staff_name];
      if (v.region) s.regions.add(v.region);
      s.totalVisits++;
      const status = v.status?.toLowerCase() || '';
      if (status.includes('completed')) s.completed++;
      else if (status.includes('scheduled')) s.scheduled++;
      else if (status.includes('missed')) s.missed++;
    });
    return Object.values(map).map(s => ({ ...s, regions: [...s.regions].sort() }))
      .sort((a, b) => b.totalVisits - a.totalVisits);
  }, [visits]);

  const disciplines = useMemo(() => ['ALL', ...new Set(staff.map(s => s.discipline)).values()].sort(), [staff]);
  const regions = useMemo(() => ['ALL', ...new Set(staff.flatMap(s => s.regions)).values()].sort(), [staff]);

  const filtered = useMemo(() => staff.filter(s => {
    if (regionFilter !== 'ALL' && !s.regions.includes(regionFilter)) return false;
    if (disciplineFilter !== 'ALL' && s.discipline !== disciplineFilter) return false;
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [staff, regionFilter, disciplineFilter, search]);

  const completionRate = (s) => s.totalVisits > 0 ? Math.round((s.completed / s.totalVisits) * 100) : 0;

  if (visits.length === 0) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Staff Directory" subtitle="Built from Pariox visit data" />
      <div style={styles.empty}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>👤</div>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No data loaded</div>
        <div style={{ color: 'var(--gray)', fontSize: 14 }}>Upload your Pariox visit schedule to build the staff directory</div>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="Staff Directory" subtitle={`${filtered.length} clinicians · built from Pariox`} />
      <div style={{ padding: '20px 28px', flex: 1, overflow: 'auto' }}>
        <div style={styles.filterRow}>
          <input placeholder="Search clinician..." value={search} onChange={e => setSearch(e.target.value)} style={styles.searchInput} />
          <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} style={styles.select}>
            {regions.map(r => <option key={r} value={r}>{r === 'ALL' ? 'All Regions' : `Region ${r}`}</option>)}
          </select>
          <select value={disciplineFilter} onChange={e => setDisciplineFilter(e.target.value)} style={styles.select}>
            {disciplines.map(d => <option key={d} value={d}>{d === 'ALL' ? 'All Disciplines' : d}</option>)}
          </select>
        </div>

        <div style={styles.grid}>
          {filtered.map((s, i) => (
            <div key={i} style={styles.card}>
              <div style={styles.cardTop}>
                <div style={styles.avatar}>{s.name.split(',')[0]?.[0] || '?'}</div>
                <div style={styles.nameBlock}>
                  <div style={styles.name}>{s.name}</div>
                  <div style={styles.discipline}>{s.discipline}</div>
                </div>
              </div>
              <div style={styles.regionTags}>
                {s.regions.map(r => (
                  <span key={r} style={styles.regionTag}>
                    R{r} · {REGIONS[r]?.split(' ')[0] || '?'}
                  </span>
                ))}
              </div>
              <div style={styles.stats}>
                <div style={styles.stat}>
                  <div style={styles.statVal}>{s.totalVisits}</div>
                  <div style={styles.statLbl}>Total</div>
                </div>
                <div style={styles.stat}>
                  <div style={{ ...styles.statVal, color: 'var(--green)' }}>{s.completed}</div>
                  <div style={styles.statLbl}>Done</div>
                </div>
                <div style={styles.stat}>
                  <div style={{ ...styles.statVal, color: 'var(--blue)' }}>{s.scheduled}</div>
                  <div style={styles.statLbl}>Sched</div>
                </div>
                <div style={styles.stat}>
                  <div style={{ ...styles.statVal, color: 'var(--danger)' }}>{s.missed}</div>
                  <div style={styles.statLbl}>Missed</div>
                </div>
              </div>
              <div style={styles.rateRow}>
                <span style={styles.rateLabel}>Completion</span>
                <span style={{ ...styles.rateVal, color: completionRate(s) >= 80 ? 'var(--green)' : completionRate(s) >= 60 ? 'var(--yellow)' : 'var(--danger)' }}>
                  {completionRate(s)}%
                </span>
              </div>
              <div style={styles.rateBar}>
                <div style={{ ...styles.rateBarFill, width: `${completionRate(s)}%`, background: completionRate(s) >= 80 ? 'var(--green)' : completionRate(s) >= 60 ? 'var(--yellow)' : 'var(--danger)' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  filterRow: { display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' },
  searchInput: { flex: 1, minWidth: 200, padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--card-bg)', outline: 'none' },
  select: { padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--card-bg)', color: 'var(--black)', outline: 'none' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 },
  card: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 },
  cardTop: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 },
  avatar: { width: 40, height: 40, borderRadius: '50%', background: 'var(--red)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, flexShrink: 0 },
  nameBlock: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: 600, color: 'var(--black)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  discipline: { fontSize: 12, color: 'var(--gray)', marginTop: 2 },
  regionTags: { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 },
  regionTag: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 500, color: 'var(--gray)' },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 },
  stat: { textAlign: 'center' },
  statVal: { fontSize: 18, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: 'var(--black)' },
  statLbl: { fontSize: 10, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 },
  rateRow: { display: 'flex', justifyContent: 'space-between', marginBottom: 6 },
  rateLabel: { fontSize: 12, color: 'var(--gray)' },
  rateVal: { fontSize: 12, fontWeight: 700, fontFamily: 'DM Mono, monospace' },
  rateBar: { height: 6, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' },
  rateBarFill: { height: '100%', borderRadius: 999, transition: 'width 0.3s ease' },
};
