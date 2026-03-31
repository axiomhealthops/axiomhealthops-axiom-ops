import { useState } from 'react';
import DashboardLayout from '../layouts/DashboardLayout';
import TopBar from '../components/TopBar';
import StatCard from '../components/StatCard';
import { useAuth } from '../hooks/useAuth';
import { METRICS } from '../lib/constants';

// Page stubs — will be filled in subsequent batches
import OverviewPage from './dashboard/OverviewPage';
import UploadsPage from './dashboard/UploadsPage';

const PAGE_COMPONENTS = {
  overview: OverviewPage,
  uploads: UploadsPage,
};

function ComingSoon({ page }) {
  return (
    <div style={{ padding: 40, color: 'var(--gray)', fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Coming Soon</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--black)', textTransform: 'capitalize' }}>
        {page?.replace(/-/g, ' ')}
      </div>
      <div style={{ marginTop: 12, fontSize: 14 }}>This page is being built and will be available shortly.</div>
    </div>
  );
}

export default function Dashboard() {
  const [activePage, setActivePage] = useState('overview');
  const { profile } = useAuth();

  const PageComponent = PAGE_COMPONENTS[activePage] || (() => <ComingSoon page={activePage} />);

  return (
    <DashboardLayout activePage={activePage} onNavigate={setActivePage}>
      <PageComponent />
    </DashboardLayout>
  );
}
