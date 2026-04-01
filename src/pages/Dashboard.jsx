import React, { useState } from 'react';
import DashboardLayout from '../layouts/DashboardLayout';
import OverviewPage from './dashboard/OverviewPage';
import UploadsPage from './dashboard/UploadsPage';
import VisitSchedulePage from './dashboard/VisitSchedulePage';
import PatientCensusPage from './dashboard/PatientCensusPage';
import AuthTrackerPage from './dashboard/AuthTrackerPage';
import ActionListPage from './dashboard/ActionListPage';
import ExpansionPage from './dashboard/ExpansionPage';
import OnHoldRecoveryPage from './dashboard/OnHoldRecoveryPage';
import UserManagementPage from './dashboard/UserManagementPage';
import DailyReportsPage from './dashboard/DailyReportsPage';
import ExecutiveReportPage from './dashboard/ExecutiveReportPage';
import ProductivityPage from './dashboard/ProductivityPage';
 
var PAGE_COMPONENTS = {
  overview: OverviewPage,
  uploads: UploadsPage,
  visits: VisitSchedulePage,
  census: PatientCensusPage,
  auth: AuthTrackerPage,
  actions: ActionListPage,
  expansion: ExpansionPage,
  'on-hold': OnHoldRecoveryPage,
  users: UserManagementPage,
  'daily-reports': DailyReportsPage,
  'exec-report': ExecutiveReportPage,
  productivity: ProductivityPage,
};
 
function ComingSoon(props) {
  return (
    <div style={{ padding: 40 }}>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray)', marginBottom: 8 }}>Coming Soon</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--black)', textTransform: 'capitalize' }}>
        {(props.page || '').replace(/-/g, ' ')}
      </div>
      <div style={{ marginTop: 12, fontSize: 14, color: 'var(--gray)' }}>
        This page is being built and will be available shortly.
      </div>
    </div>
  );
}
 
export default function Dashboard() {
  var [activePage, setActivePage] = useState('overview');
  var PageComponent = PAGE_COMPONENTS[activePage] || function() { return React.createElement(ComingSoon, { page: activePage }); };
  return (
    React.createElement(DashboardLayout, { activePage: activePage, onNavigate: setActivePage },
      React.createElement(PageComponent, null)
    )
  );
}
 
