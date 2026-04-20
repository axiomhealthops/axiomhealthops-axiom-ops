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
import MyRegionPage from './dashboard/MyRegionPage';
import MedicareTrackerPage from './dashboard/MedicareTrackerPage';
import MarketingCRMPage from './dashboard/MarketingCRMPage';
import WaitlistPage from './dashboard/WaitlistPage';
import AuthRenewalsPage from './dashboard/AuthRenewalsPage';
import DirectorDashboard from './dashboard/DirectorDashboard';
import ClinicianAccountabilityPage from './dashboard/ClinicianAccountabilityPage';
import ClinicianAssignmentPage from './dashboard/ClinicianAssignmentPage';
import PipelineTrackerPage from './dashboard/PipelineTrackerPage';
import AuthCoordDashboard from './dashboard/AuthCoordDashboard';
import CareCoordMyPatients from './dashboard/CareCoordMyPatients';
import IntakeCoordQueue from './dashboard/IntakeCoordQueue';
import RMDailyDashboard from './dashboard/RMDailyDashboard';
import SchedulingAlertsPage from './dashboard/SchedulingAlertsPage';
import SwiftTeamDashboard from './dashboard/SwiftTeamDashboard';
import DischargeTrackerPage from './dashboard/DischargeTrackerPage';
import ClinicalProgressionPage from './dashboard/ClinicalProgressionPage';
import StaleFrequencyPage from './dashboard/StaleFrequencyPage';
import FrequencyReviewPage from './dashboard/FrequencyReviewPage';
import OpsReportsPage from './dashboard/OpsReportsPage';

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
  'missed-cancelled':       MissedCancelledReportPage,
  'my-region':              MyRegionPage,
  'medicare-tracker':       MedicareTrackerPage,
  'marketing-crm':          MarketingCRMPage,
  'waitlist':                WaitlistPage,
  'director':                DirectorDashboard,
  'clinician-accountability': ClinicianAccountabilityPage,
  'clinician-assignment':     ClinicianAssignmentPage,
  'pipeline':                PipelineTrackerPage,
  'auth-coordinator':        AuthCoordDashboard,
  'care-coord-patients':     CareCoordMyPatients,
  'intake-queue':            IntakeCoordQueue,
  'rm-daily':                RMDailyDashboard,
  'scheduling-alerts':       SchedulingAlertsPage,
  'swift-team':              SwiftTeamDashboard,
  'auth-renewals':           AuthRenewalsPage,
  'discharges':              DischargeTrackerPage,
  'clinical-progression':   ClinicalProgressionPage,
  'stale-frequency':        StaleFrequencyPage,
  'frequency-review':       FrequencyReviewPage,
  'ops-reports':             OpsReportsPage,
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
  const { canAccess, profile } = useAuth();
  const defaultPage = (() => {
    const r = profile?.role;
    if (r === 'regional_manager')   return 'rm-daily';
    if (r === 'auth_coordinator')   return 'auth-coordinator';
    if (r === 'intake_coordinator') return 'intake-queue';
    if (r === 'care_coordinator')   return 'care-coord-patients';
    if (r === 'assoc_director')      return 'overview';
    if (r === 'telehealth')          return 'visits';
    if (r === 'pod_leader')         return 'intake-queue';
    if (r === 'clinician')          return 'visits';
    if (r === 'super_admin')        return 'director';
    return 'overview';
  })();
  const [activePage, setActivePage] = useState(defaultPage);
  const [pageIntent, setPageIntent] = useState(null);
  const navigate = (page, intent = null) => {
    setActivePage(page);
    setPageIntent(intent);
  };

  const PageComponent = PAGE_COMPONENTS[activePage];

  function renderPage() {
    if (!canAccess(activePage)) return <AccessDenied />;
    // Pages receive:
    //   - onNavigate(page, intent?) — switch page and optionally pass pre-filter state
    //   - intent — optional initial-state hint from the caller (e.g. "filter to overdue")
    // The intent is consumed once on page mount via lazy useState initializer, so
    // subsequent re-renders don't force the filter back.
    if (PageComponent) {
      return <PageComponent onNavigate={navigate} intent={pageIntent} />;
    }
    return <ComingSoon page={activePage} />;
  }

  return (
    <DashboardLayout activePage={activePage} onNavigate={setActivePage}>
      {renderPage()}
    </DashboardLayout>
  );
}
