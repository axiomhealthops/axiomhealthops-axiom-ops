import React from 'react';
import TopBar from '../../components/TopBar';
import StatCard from '../../components/StatCard';
import { useAuth } from '../../hooks/useAuth.jsx';
import { METRICS } from '../../lib/constants';

export default function OverviewPage() {
  const { profile } = useAuth();

  const visits = (() => {
    try { return JSON.parse(localStorage.getItem('axiom_pariox_data') || '[]'); } catch { return []; }
  })();

  const census = (() => {
    try { return JSON.parse(localStorage.getItem('axiom_census') || '[]'); } catch { return []; }
  })();

  const completedVisits = visits.filter(v =>
    v.status?.toLowerCase().includes('completed')
  ).length;

  const scheduledVisits = visits.filter(v =>
    v.status?.toLowerCase().includes('scheduled')
  ).length;

  const totalVisits = visits.length;
  const pct = Math.round((totalVisits / METRICS.WEEKLY_VISIT_TARGET) * 100);
  const estRevenue = completedVisits * METRICS.AVG_REIMBURSEMENT;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Operations Overview"
        subtitle={`Welcome back, ${profile?.full_name?.split(' ')[0] || 'Director'}`}
      />

      <div style={{ padding: '28px',
