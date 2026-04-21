import React, { useState, useEffect, useMemo, useCallback } from 'react';
import TopBar from '../../components/TopBar';
import { supabase, fetchAllPages } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useRealtimeTable } from '../../hooks/useRealtimeTable';

const BLENDED_RATE = 230;

function fmt$(n) { return '$' + Math.round(n).toLocaleString(); }
function daysAgo(d) {
  if (!d) return null;
  return Math.floor((new Date() - new Date(d + 'T00:00:00')) / 86400000);
}

const CATEGORY_META = {
  auth_expiring:     { icon: '🔐', label: 'Auth Expiring',       color: '#DC2626', bg: '#FEF2F2' },
  inactive_patients: { icon: '🚨', label: 'Inactive Patients',   color: '#B91C1C', bg: '#FFF5F5' },
  pipeline_stall:    { icon: '🔀', label: 'Pipeline Stall',      color: '#D97706', bg: '#FEF3C7' },
  underutilized:     { icon: '👤', label: 'Clinician Utilization', color: '#7C3AED', bg: '#F5F3FF' },
  on_hold_overdue:   { icon: '⏸',  label: 'On-Hold Overdue',     color: '#1565C0', bg: '#EFF6FF' },
  intake_pending:    { icon: '📥', label: 'Intake Pending',      color: '#0D9488', bg: '#F0FDFA' },
  cancelled_visits:  { icon: '📉', label: 'Cancel Rate',         color: '#DC2626', bg: '#FEF2F2' },
  coord_inactive:    { icon: '⚡', label: 'Staff Inactive',      color: '#DC2626', bg: '#FEF2F2' },
  manual:            { icon: '📌', label: 'Follow-Up',           color: '#374151', bg: '#F3F4F6' },
};

// ── Auto-generated revenue actions from live data ───────────────────────────
function buildAutoActions(data) {
  const actions = [];
  const { census, visits, authRenewals, onHold, waitlist, clinicians, coordinators, activityLog } = data;

  const active = census.filter(p => /active/i.test(p.status || ''));
  const inactiveActive = active.filter(p => (p.days_overdue || 0) > 0);

  // Week boundaries
  const now = new Date();
  const dow = now.getDay();
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  const monDate = new Date(now); monDate.setDate(now.getDate() - daysFromMon);
  const weekStart = `${monDate.getFullYear()}-${String(monDate.getMonth()+1).padStart(2,'0')}-${String(monDate.getDate()).padStart(2,'0')}`;
  const sunDate = new Date(monDate); sunDate.setDate(monDate.getDate() + 6);
  const weekEnd = `${sunDate.getFullYear()}-${String(sunDate.getMonth()+1).padStart(2,'0')}-${String(sunDate.getDate()).padStart(2,'0')}`;

  const isCancelled = v => /cancel/i.test(v.event_type || '') || /cancel/i.test(v.status || '');
  const isCompleted = v => /completed/i.test(v.status || '') && !isCancelled(v) && !/attempted/i.test(v.event_type || '');
  const rawCompleted = visits.filter(isCompleted);

  // Clinician visit map
  const visitMap = {};
  rawCompleted.forEach(v => { const k = (v.staff_name||'').toLowerCase().trim(); visitMap[k] = (visitMap[k]||0) + 1; });

  // ─── 1. Auth coordinators with expiring auths ───
  const urgentAuths = authRenewals.filter(a => a.priority === 'urgent');
  if (urgentAuths.length > 0) {
    // Group by region to identify which auth coordinator to follow up with
    const authCoords = coordinators.filter(c => c.role === 'auth_coordinator' && c.is_active);
    const coordNames = authCoords.map(c => c.full_name).join(', ');
    actions.push({
      id: 'auto_auth_urgent',
      category: 'auth_expiring',
      priority: 'critical',
      title: `${urgentAuths.length} authorizations expiring within 7 days`,
      description: `Follow up with Auth team (${coordNames}) — each lapsed auth = patient can't be seen = $0 revenue until renewed`,
      staff_name: coordNames,
      revenue_impact: urgentAuths.length * BLENDED_RATE * 4,
      auto: true,
    });
  }

  // ─── 2. Inactive active patients by region ───
  if (inactiveActive.length > 20) {
    // Group by region, find worst regions
    const byRegion = {};
    inactiveActive.forEach(p => { const r = p.region || '?'; byRegion[r] = (byRegion[r]||0) + 1; });
    const worstRegions = Object.entries(byRegion).sort((a,b) => b[1] - a[1]).slice(0, 3);
    const regionStr = worstRegions.map(([r, c]) => `Rgn ${r}: ${c}`).join(', ');

    // Find RMs for those regions
    actions.push({
      id: 'auto_inactive_patients',
      category: 'inactive_patients',
      priority: 'critical',
      title: `${inactiveActive.length} active patients overdue for visits`,
      description: `Worst regions: ${regionStr}. Follow up with Regional Managers — these patients are generating $0 despite active status`,
      staff_name: 'Regional Managers',
      revenue_impact: inactiveActive.length * BLENDED_RATE * 2,
      auto: true,
    });
  }

  // ─── 3. Pipeline stall — SOC/Eval pending ───
  const pending = census.filter(p => /soc.?pending|eval.?pending/i.test(p.status || ''));
  if (pending.length > 5) {
    const careCoords = coordinators.filter(c => c.role === 'care_coordinator' && c.is_active);
    actions.push({
      id: 'auto_pipeline_stall',
      category: 'pipeline_stall',
      priority: 'high',
      title: `${pending.length} accepted patients haven't started care yet`,
      description: `Follow up with Care Coordination (${careCoords.map(c=>c.full_name).join(', ')}) — patients accepted but no first visit scheduled. Every week without a start = lost revenue`,
      staff_name: careCoords.map(c => c.full_name).join(', '),
      revenue_impact: pending.length * BLENDED_RATE * 2,
      auto: true,
    });
  }

  // ─── 4. Underutilized clinicians ───
  const underutilized = clinicians.filter(cl => {
    const done = visitMap[(cl.full_name||'').toLowerCase().trim()] || 0;
    const pct = cl.weekly_visit_target > 0 ? (done / cl.weekly_visit_target) * 100 : 0;
    return pct < 60 && cl.weekly_visit_target >= 10;
  });
  if (underutilized.length > 0) {
    const missedVisits = underutilized.reduce((sum, cl) => {
      const done = visitMap[(cl.full_name||'').toLowerCase().trim()] || 0;
      return sum + (cl.weekly_visit_target - done);
    }, 0);
    actions.push({
      id: 'auto_underutilized',
      category: 'underutilized',
      priority: 'high',
      title: `${underutilized.length} clinicians below 60% visit target`,
      description: `${missedVisits} potential visits not happening this week. Follow up with RMs: ${underutilized.slice(0,4).map(c=>c.full_name).join(', ')}${underutilized.length>4?' +more':''}`,
      staff_name: 'Regional Managers',
      revenue_impact: missedVisits * BLENDED_RATE,
      auto: true,
    });
  }

  // ─── 5. On-hold patients overdue ───
  const onHoldOverdue = onHold.filter(p => (p.days_on_hold || 0) > 21);
  if (onHoldOverdue.length > 0) {
    actions.push({
      id: 'auto_onhold_overdue',
      category: 'on_hold_overdue',
      priority: 'high',
      title: `${onHoldOverdue.length} patients on hold 21+ days without recovery`,
      description: `Follow up with Care Coordination & Pod Leader (Hervylie) — extended holds without recovery calls = patients that will discharge and never return`,
      staff_name: 'Care Coordinators, Hervylie Senica',
      revenue_impact: onHoldOverdue.length * BLENDED_RATE * 4,
      auto: true,
    });
  }

  // ─── 6. Waitlist unassigned ───
  const unassigned = waitlist.filter(w => w.assignment_status === 'pending' && !w.assigned_clinician);
  if (unassigned.length > 0) {
    actions.push({
      id: 'auto_intake_pending',
      category: 'intake_pending',
      priority: 'medium',
      title: `${unassigned.length} waitlisted patients without a clinician`,
      description: `Follow up with Kiarra (Intake) and RMs — patients waiting for assignment are referrals we've already won but aren't monetizing`,
      staff_name: 'Kiarra Arabejo, Regional Managers',
      revenue_impact: unassigned.length * BLENDED_RATE * 2,
      auto: true,
    });
  }

  // ─── 7. Coordinator inactivity ───
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const activeCoords = coordinators.filter(c => c.is_active && !['super_admin','admin','regional_manager','assoc_director'].includes(c.role));
  // Check activity log for today
  const todayActivity = activityLog.filter(a => a.action_date === todayStr);
  const activeToday = new Set(todayActivity.map(a => (a.coordinator_name||'').toLowerCase()));
  const inactiveCoords = activeCoords.filter(c => !activeToday.has((c.full_name||'').toLowerCase()));

  if (inactiveCoords.length > 0 && now.getHours() >= 10) { // Only flag after 10am
    actions.push({
      id: 'auto_coord_inactive',
      category: 'coord_inactive',
      priority: inactiveCoords.length > 3 ? 'critical' : 'medium',
      title: `${inactiveCoords.length} coordinators with no dashboard activity today`,
      description: `Staff not working in the system: ${inactiveCoords.map(c=>c.full_name).join(', ')}. Follow up directly — if they're not in the dashboard, tasks aren't getting done`,
      staff_name: inactiveCoords.map(c => c.full_name).join(', '),
      revenue_impact: 0,
      auto: true,
    });
  }

  // ─── 8. High cancel rate ───
  const cancelledThisWeek = visits.filter(isCancelled);
  const totalVisits = rawCompleted.length + cancelledThisWeek.length;
  const cancelRate = totalVisits > 0 ? Math.round((cancelledThisWeek.length / totalVisits) * 100) : 0;
  if (cancelRate > 10 && cancelledThisWeek.length > 15) {
    actions.push({
      id: 'auto_cancel_rate',
      category: 'cancelled_visits',
      priority: 'high',
      title: `${cancelRate}% cancel rate this week (${cancelledThisWeek.length} cancelled)`,
      description: `Follow up with RMs — high cancellation rates directly reduce revenue. Identify patterns: specific clinicians, regions, or days with concentrated cancellations`,
      staff_name: 'Regional Managers',
      revenue_impact: cancelledThisWeek.length * BLENDED_RATE,
      auto: true,
    });
  }

  // Sort by revenue impact descending
  actions.sort((a, b) => (b.revenue_impact || 0) - (a.revenue_impact || 0));
  return actions;
}

// ── Priority pill component ─────────────────────────────────────────────────
function PriorityPill({ priority }) {
  const config = {
    critical: { bg: '#DC2626', color: '#fff' },
    high: { bg: '#FEF2F2', color: '#991B1B' },
    medium: { bg: '#FEF3C7', color: '#92400E' },
    low: { bg: '#EFF6FF', color: '#1E40AF' },
  }[priority] || { bg: '#F3F4F6', color: '#374151' };
  return (
    <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', background: config.bg, color: config.color }}>
      {priority}
    </span>
  );
}

// ── Revenue impact badge ────────────────────────────────────────────────────
function RevenueBadge({ amount }) {
  if (!amount) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 800, fontFamily: 'DM Mono, monospace', color: '#DC2626' }}>
      <span style={{ fontSize: 9, color: '#991B1B', fontWeight: 600, fontFamily: 'Arial, sans-serif' }}>AT RISK</span>
      {fmt$(amount)}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function ActionListPage({ onNavigate }) {
  const go = (page) => { if (typeof onNavigate === 'function') onNavigate(page); };
  const { profile } = useAuth();

  // Manual items from DB
  const [manualItems, setManualItems] = useState([]);
  const [loadingManual, setLoadingManual] = useState(true);

  // Live data for auto-generated actions
  const [liveData, setLiveData] = useState(null);
  const [loadingLive, setLoadingLive] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  // UI
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [form, setForm] = useState({ title: '', description: '', priority: 'high', due_date: '', staff_name: '', category: 'manual', revenue_impact: '' });

  // Fetch manual items
  async function fetchManual() {
    const { data } = await supabase.from('action_items').select('*').order('created_at', { ascending: false });
    setManualItems(data || []);
    setLoadingManual(false);
  }

  // Fetch live data for auto-generation
  const loadLive = useCallback(async () => {
    const now = new Date();
    const dow = now.getDay();
    const daysFromMon = dow === 0 ? 6 : dow - 1;
    const monDate = new Date(now); monDate.setDate(now.getDate() - daysFromMon);
    const weekStart = `${monDate.getFullYear()}-${String(monDate.getMonth()+1).padStart(2,'0')}-${String(monDate.getDate()).padStart(2,'0')}`;
    const sunDate = new Date(monDate); sunDate.setDate(monDate.getDate() + 6);
    const weekEnd = `${sunDate.getFullYear()}-${String(sunDate.getMonth()+1).padStart(2,'0')}-${String(sunDate.getDate()).padStart(2,'0')}`;
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    const [census, visits, authRenewals, oh, wl, cl, coords, actLog] = await Promise.all([
      fetchAllPages(supabase.from('census_data').select('patient_name,region,status,last_visit_date,days_since_last_visit,inferred_frequency,days_overdue')),
      fetchAllPages(supabase.from('visit_schedule_data').select('patient_name,staff_name,visit_date,status,event_type,region').gte('visit_date', weekStart).lte('visit_date', weekEnd)),
      fetchAllPages(supabase.from('auth_renewal_tasks').select('patient_name,region,priority,task_status,days_until_expiry,visits_remaining').not('task_status', 'in', '("approved","denied","closed")')),
      fetchAllPages(supabase.from('on_hold_recovery').select('patient_name,region,hold_type,days_on_hold')),
      fetchAllPages(supabase.from('waitlist_assignments').select('patient_name,region,assignment_status,assigned_clinician')),
      fetchAllPages(supabase.from('clinicians').select('full_name,region,discipline,weekly_visit_target,is_active').eq('is_active', true)),
      fetchAllPages(supabase.from('coordinators').select('full_name,role,is_active')),
      fetchAllPages(supabase.from('coordinator_activity_log').select('coordinator_name,action_date').eq('action_date', todayStr)),
    ]);

    setLiveData({ census, visits, authRenewals, onHold: oh, waitlist: wl, clinicians: cl, coordinators: coords, activityLog: actLog });
    setLastRefresh(new Date());
    setLoadingLive(false);
  }, []);

  useEffect(() => { fetchManual(); loadLive(); }, [loadLive]);
  useRealtimeTable('action_items', fetchManual);

  // Build auto actions from live data
  const autoActions = useMemo(() => {
    if (!liveData) return [];
    return buildAutoActions(liveData);
  }, [liveData]);

  // Combined list
  const allItems = useMemo(() => {
    const manualOpen = manualItems.filter(i => i.status !== 'completed').map(i => ({ ...i, auto: false }));
    const combined = [...autoActions, ...manualOpen];
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    combined.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 2;
      const pb = priorityOrder[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return (b.revenue_impact || 0) - (a.revenue_impact || 0);
    });
    return combined;
  }, [autoActions, manualItems]);

  const completedItems = manualItems.filter(i => i.status === 'completed');

  // Filtered
  const filtered = activeTab === 'all' ? allItems
    : activeTab === 'auto' ? allItems.filter(i => i.auto)
    : activeTab === 'manual' ? allItems.filter(i => !i.auto)
    : allItems;

  const totalRevAtRisk = autoActions.reduce((s, a) => s + (a.revenue_impact || 0), 0);

  // Form handlers
  async function handleSubmit(e) {
    e.preventDefault();
    await supabase.from('action_items').insert([{
      title: form.title,
      description: form.description,
      priority: form.priority,
      due_date: form.due_date || null,
      staff_name: form.staff_name || null,
      category: form.category,
      revenue_impact: form.revenue_impact ? parseFloat(form.revenue_impact) : 0,
      follow_up_type: 'manual',
      created_by: profile?.id,
    }]);
    setForm({ title: '', description: '', priority: 'high', due_date: '', staff_name: '', category: 'manual', revenue_impact: '' });
    setShowForm(false);
    fetchManual();
  }

  async function toggleComplete(id, current) {
    await supabase.from('action_items').update({
      status: current === 'completed' ? 'open' : 'completed',
      completed_at: current === 'completed' ? null : new Date().toISOString(),
      resolved_at: current === 'completed' ? null : new Date().toISOString(),
    }).eq('id', id);
    fetchManual();
  }

  async function deleteItem(id) {
    await supabase.from('action_items').delete().eq('id', id);
    fetchManual();
  }

  const loading = loadingManual || loadingLive;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Revenue Actions"
        subtitle="High-priority follow-ups to drive revenue"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {lastRefresh && <span style={{ fontSize: 10, color: 'var(--gray)' }}>Live data {lastRefresh.toLocaleTimeString()}</span>}
            <button onClick={() => { setLoadingLive(true); loadLive(); }} style={S.refreshBtn}>↻ Refresh</button>
            <button onClick={() => setShowForm(!showForm)} style={S.addBtn}>+ Add Follow-Up</button>
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Revenue at Risk Banner */}
        {!loading && totalRevAtRisk > 0 && (
          <div style={{ background: '#0F1117', borderRadius: 12, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Total Weekly Revenue at Risk</div>
              <div style={{ fontSize: 32, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: '#F87171', marginTop: 4 }}>{fmt$(totalRevAtRisk)}</div>
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: '#FBBF24' }}>{autoActions.filter(a => a.priority === 'critical').length}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>CRITICAL</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: '#fff' }}>{autoActions.length}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>TOTAL ACTIONS</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: '#34D399' }}>{completedItems.length}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>RESOLVED</div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Filter */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { key: 'all', label: `All (${allItems.length})` },
            { key: 'auto', label: `Live Alerts (${autoActions.length})` },
            { key: 'manual', label: `My Follow-Ups (${allItems.filter(i => !i.auto).length})` },
          ].map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              style={{ padding: '6px 14px', fontSize: 12, fontWeight: activeTab === tab.key ? 700 : 400, color: activeTab === tab.key ? '#fff' : 'var(--gray)', background: activeTab === tab.key ? '#0F1117' : 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer' }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Add Follow-Up Form */}
        {showForm && (
          <div style={S.formCard}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--black)' }}>New Revenue Follow-Up</div>
            <form onSubmit={handleSubmit}>
              <div style={S.formGrid}>
                <input required placeholder="What needs to happen? (e.g., Follow up with Kaylee on Region B inactive patients)" value={form.title} onChange={e => setForm({...form, title: e.target.value})} style={{...S.input, gridColumn: '1 / -1'}} />
                <input placeholder="Additional context or notes" value={form.description} onChange={e => setForm({...form, description: e.target.value})} style={{...S.input, gridColumn: '1 / -1'}} />
                <input placeholder="Staff member to follow up with" value={form.staff_name} onChange={e => setForm({...form, staff_name: e.target.value})} style={S.input} />
                <select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})} style={S.input}>
                  <option value="critical">Critical — Revenue Blocker</option>
                  <option value="high">High — Direct Revenue Impact</option>
                  <option value="medium">Medium — Operational Efficiency</option>
                  <option value="low">Low — Good to Address</option>
                </select>
                <input type="date" value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} style={S.input} placeholder="Due date" />
                <input type="number" placeholder="$ Revenue impact (optional)" value={form.revenue_impact} onChange={e => setForm({...form, revenue_impact: e.target.value})} style={S.input} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button type="submit" style={S.submitBtn}>Save Follow-Up</button>
                <button type="button" onClick={() => setShowForm(false)} style={S.cancelBtn}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {/* Action Items */}
        {loading ? (
          <div style={S.empty}>
            <div style={{ fontSize: 28, marginBottom: 8, animation: 'spin 1s linear infinite' }}>⚡</div>
            <div style={{ fontWeight: 600 }}>Analyzing live data for revenue actions...</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map((item, idx) => {
              const cat = CATEGORY_META[item.category] || CATEGORY_META.manual;
              return (
                <div key={item.id || `auto-${idx}`} style={{ background: 'var(--card-bg)', border: `1px solid ${item.priority === 'critical' ? '#FECACA' : 'var(--border)'}`, borderLeft: `4px solid ${cat.color}`, borderRadius: 10, padding: '14px 18px', transition: 'box-shadow 0.15s ease' }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
                  {/* Top row: category + priority + revenue */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>{cat.icon}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: cat.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{cat.label}</span>
                      {item.auto && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: '#E0F2FE', color: '#0369A1', fontWeight: 600 }}>LIVE</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <RevenueBadge amount={item.revenue_impact} />
                      <PriorityPill priority={item.priority} />
                    </div>
                  </div>

                  {/* Title + description */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    {!item.auto && (
                      <button onClick={() => toggleComplete(item.id, item.status)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2, flexShrink: 0 }}>
                        <span style={{ fontSize: 16 }}>○</span>
                      </button>
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--black)', lineHeight: 1.4 }}>{item.title}</div>
                      {item.description && <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 4, lineHeight: 1.5 }}>{item.description}</div>}
                    </div>
                  </div>

                  {/* Bottom meta row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--gray)' }}>
                      {item.staff_name && <span style={{ fontWeight: 500 }}>👤 {item.staff_name}</span>}
                      {item.due_date && <span>Due: {item.due_date}</span>}
                      {item.revenue_impact > 0 && <span style={{ color: '#DC2626', fontWeight: 600 }}>{fmt$(item.revenue_impact)}/wk at risk</span>}
                    </div>
                    {!item.auto && (
                      <button onClick={() => deleteItem(item.id)} style={{ background: 'none', border: 'none', color: 'var(--light-gray)', cursor: 'pointer', fontSize: 11 }}>✕ remove</button>
                    )}
                  </div>
                </div>
              );
            })}

            {filtered.length === 0 && (
              <div style={S.empty}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                <div style={{ fontWeight: 600 }}>No actions in this view</div>
                <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 4 }}>All clear — revenue operations are running smoothly</div>
              </div>
            )}
          </div>
        )}

        {/* Completed Manual Items */}
        {completedItems.length > 0 && activeTab !== 'auto' && (
          <div style={{ marginTop: 8 }}>
            <div style={S.sectionLabel}>Completed Follow-Ups ({completedItems.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {completedItems.map(item => (
                <div key={item.id} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: 0.5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button onClick={() => toggleComplete(item.id, item.status)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      <span style={{ fontSize: 14, color: 'var(--green)' }}>✓</span>
                    </button>
                    <span style={{ textDecoration: 'line-through', color: 'var(--gray)', fontSize: 13 }}>{item.title}</span>
                    {item.staff_name && <span style={{ fontSize: 11, color: 'var(--light-gray)' }}>— {item.staff_name}</span>}
                  </div>
                  <button onClick={() => deleteItem(item.id)} style={{ background: 'none', border: 'none', color: 'var(--light-gray)', cursor: 'pointer', fontSize: 11 }}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const S = {
  addBtn: { padding: '7px 14px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  refreshBtn: { padding: '7px 14px', background: '#0F1117', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  formCard: { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 },
  input: { padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--bg)', color: 'var(--black)', outline: 'none' },
  submitBtn: { padding: '9px 18px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  cancelBtn: { padding: '9px 18px', background: 'none', color: 'var(--gray)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer' },
  sectionLabel: { fontSize: 11, fontWeight: 600, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--black)' },
};
