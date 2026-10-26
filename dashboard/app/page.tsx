import Dashboard from './dashboard';

export const dynamic = 'force-dynamic';
export default function Page() {
  return <Dashboard demo={process.env.DASHBOARD_DEMO_MODE === 'true'} />;
}
