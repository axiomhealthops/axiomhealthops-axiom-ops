import React, { useState } from 'react';
import DashboardLayout from '../layouts/DashboardLayout';
import OverviewPage from './dashboard/OverviewPage';
import UploadsPage from './dashboard/UploadsPage';
import VisitSchedulePage from './dashboard/VisitSchedulePage';
import PatientCensusPage from './dashboard/PatientCensusPage';
import AuthTrackerPage from './dashboard/AuthTrackerPage';
import ActionListPage from './dashboard/ActionListPage';

const PAGE_COMPONENTS = {
  overview: OverviewPage,
  uploads: UploadsPage,
  visits: VisitSchedulePage,
  census: PatientCensusPage,
  auth: AuthTrackerPage,
  actions: ActionListPage,
};

function ComingSoon({ page }) {
  return (
    <div style={{ padding: 40, fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)', marginBottom: 8 }}>Coming Soon</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--black)', textTransform: 'capitalize' }}>
        {page?.replace(/-/g, ' ')}
      </div>
      <div style={{ marginTop: 12, fontSize: 14, color: 'var(--gray)' }}>This page is being built and will be available shortly.</div>
    </div>
  );
}

export default function Dashboard() {
  const [activePage, setActivePage] = useState('overview');
  const PageComponent = PAGE_COMPONENTS[activePage] || (() => <ComingSoon page={activePage} />);
  return (
    <DashboardLayout activePage={activePage} onNavigate={setActivePage}>
      <PageComponent />
    </DashboardLayout>
  );
}
