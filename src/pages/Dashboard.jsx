import React, { useState, useEffect } from 'react';
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
import AssociateDirectorDashboard from './dashboard/AssociateDirectorDashboard';
import HospitalizationTrackerPage from './dashboard/HospitalizationTrackerPage';
// 2026-05-17: Restored — Reports Export has an XLSX-only version, but Liam
// needs the interactive viewer with sorting, regional/clinician breakdowns,
// and live filters. Director Dashboard's "Missed" tile links here.
import MissedCancelledReportPage from './dashboard/MissedCancelledReportPage';
import MyRegionPage from './dashboard/MyRegionPage';
import MedicareTrackerPage from './dashboard/MedicareTrackerPage';
import MarketingCRMPage from './dashboard/MarketingCRMPage';
import MarketingTeamDirectoryPage from './dashboard/MarketingTeamDirectoryPage';
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
import ClinicianSchedulePage from './dashboard/ClinicianSchedulePage';
import InsuranceSettingsPage from './dashboard/InsuranceSettingsPage';
import OperationsManagerDashboard from './dashboard/OperationsManagerDashboard';
import AuthAuditImportPage from './dashboard/AuthAuditImportPage';
import HighRiskPatientsPage from './dashboard/HighRiskPatientsPage';
import AuthOverLimitPage from './dashboard/AuthOverLimitPage';
import AuthPendingCoveragePage from './dashboard/AuthPendingCoveragePage';
import VisitRunwayPage from './dashboard/VisitRunwayPage';
import AuthExpiryTimelinePage from './dashboard/AuthExpiryTimelinePage';
import StuckAuthsPage from './dashboard/StuckAuthsPage';
import MyDayPage from './dashboard/MyDayPage';
// 2026-06-02 Phase 2A: Payroll Review & Audit (docs/Payroll_Review_Design.md rev 2)
import PayrollReviewPage from './dashboard/PayrollReviewPage';
import PayrollSettingsPage from './dashboard/PayrollSettingsPage';
// DepartmentReportsPage merged into ReportsExportPage 2026-05-17 (consolidation)
// import DepartmentReportsPage from './dashboard/DepartmentReportsPage';

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
  'ad-dashboard':       AssociateDirectorDashboard,
  hospitalizations:     HospitalizationTrackerPage,
  'missed-cancelled':       MissedCancelledReportPage,
  'my-region':              MyRegionPage,
  'medicare-tracker':       MedicareTrackerPage,
  'marketing-crm':          MarketingCRMPage,
  'marketing-team-directory': MarketingTeamDirectoryPage,
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
  'clinician-schedule':      ClinicianSchedulePage,
  'insurance-settings':      InsuranceSettingsPage,
  'ops-dashboard':           OperationsManagerDashboard,
  'audit-import':            AuthAuditImportPage,
  'high-risk-patients':      HighRiskPatientsPage,
  'auth-over-limit':         AuthOverLimitPage,
  'auth-pending-coverage':   AuthPendingCoveragePage,
  'visit-runway':            VisitRunwayPage,
  'auth-expiry-timeline':    AuthExpiryTimelinePage,
  'stuck-auths':             StuckAuthsPage,
  'my-day':                  MyDayPage,
  'payroll-review':          PayrollReviewPage,
  'payroll-settings':        PayrollSettingsPage,
  // 'dept-reports':         DepartmentReportsPage,  // moved into ReportsExportPage
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
    if (r === 'auth_coordinator')   return 'my-day';
    if (r === 'intake_coordinator') return 'intake-queue';
    if (r === 'care_coordinator')   return 'care-coord-patients';
    if (r === 'assoc_director')      return 'ad-dashboard';
    if (r === 'admin')               return 'ops-dashboard';
    if (r === 'pod_leader')          return 'ops-dashboard';
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

  // Listen for navigation events from global components (e.g. MentionsBell)
  useEffect(() => {
    function handleNav(e) {
      if (e.detail?.page) navigate(e.detail.page, e.detail.intent || null);
    }
    window.addEventListener('axiom-navigate', handleNav);
    return () => window.removeEventListener('axiom-navigate', handleNav);
  }, []);

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
