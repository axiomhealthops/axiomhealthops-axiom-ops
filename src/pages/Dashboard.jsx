import React, { useState } from 'react';
import DashboardLayout from '../layouts/DashboardLayout';
import { useAuth } from '../hooks/useAuth';

import OverviewPage from './dashboard/OverviewPage';
import LiveAlertsPage from './dashboard/LiveAlertsPage';
import UploadsPage from './dashboard/UploadsPage';
import VisitSchedulePage from './dashboard/VisitSchedulePage';
import PatientCensusPage from './dashboard/PatientCensusPage';
import AuthTrackerPage from './dashboard/AuthTrackerPage';
import ActionListPage from './dashboard/ActionListPage';
import OnHoldRecoveryPage from './dashboard/OnHoldRecoveryPage';
import UserManagementPage from './dashboard/UserManagementPage';
import DailyReportsPage from './dashboard/DailyReportsPage';
import ExecutiveReportPage from './dashboard/ExecutiveReportPage';
import ProductivityPage from './dashboard/ProductivityPage';
import IntakeDashboardPage from './dashboard/IntakeDashboardPage';
import CoordinatorRouter from './CoordinatorRouter';
import RevenuePage from './dashboard/RevenuePage';
import GrowthTrackerPage from './dashboard/GrowthTrackerPage';
import ScorecardPage from './dashboard/ScorecardPage';
import SettingsPage from './dashboard/SettingsPage';
import StaffDirectoryPage from './dashboard/StaffDirectoryPage';
import RegionsPage from './dashboard/RegionsPage';
import ExpansionPage from './dashboard/ExpansionPage';
import ReportsExportPage from './dashboard/ReportsExportPage';
import RegionalManagerDashboard from './dashboard/RegionalManagerDashboard';
import HospitalizationTrackerPage from './dashboard/HospitalizationTrackerPage';
import MissedCancelledReportPage from './dashboard/MissedCancelledReportPage';

const PAGE_COMPONENTS = {
  overview:             OverviewPage,
  alerts:               LiveAlertsPage,
  uploads:              UploadsPage,
  visits:               VisitSchedulePage,
  census:               PatientCensusPage,
  auth:                 AuthTrackerPage,
  actions:              ActionListPage,
  'on-hold':            OnHoldRecoveryPage,
  users:                UserManagementPage,
  'daily-reports':      DailyReportsPage,
  'exec-report':        ExecutiveReportPage,
  productivity:         ProductivityPage,
  intake:               IntakeDashboardPage,
  'coordinator-portal': CoordinatorRouter,
  revenue:              RevenuePage,
  growth:               GrowthTrackerPage,
  scorecard:            ScorecardPage,
  settings:             SettingsPage,
  staff:                StaffDirectoryPage,
  regions:              RegionsPage,
  expansion:            ExpansionPage,
  reports:              ReportsExportPage,
  'rm-dashboard':       RegionalManagerDashboard,
  hospitalizations:     HospitalizationTrackerPage,
  'missed-cancelled':   MissedCancelledReportPage,
};

function AccessDenied() {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--black)', marginBottom: 8 }}>Access Restricted</div>
      <div style={{ fontSize: 14, color: 'var(--gray)' }}>You don't have permission to view this page. Contact your administrator.</div>
    </div>
  );
}

function ComingSoon({ page }) {
  return (
    <div style={{ padding: 40 }}>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)', marginBottom: 8 }}>Coming Soon</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--black)', textTransform: 'capitalize' }}>{(page || '').replace(/-/g, ' ')}</div>
    </div>
  );
}

export default function Dashboard() {
  const [activePage, setActivePage] = useState('overview');
  const { canAccess } = useAuth();

  const PageComponent = PAGE_COMPONENTS[activePage];

  function renderPage() {
    if (!canAccess(activePage)) return <AccessDenied />;
    if (PageComponent) return <PageComponent />;
    return <ComingSoon page={activePage} />;
  }

  return (
    <DashboardLayout activePage={activePage} onNavigate={setActivePage}>
      {renderPage()}
    </DashboardLayout>
  );
}
