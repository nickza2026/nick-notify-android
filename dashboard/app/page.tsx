import Dashboard from './dashboard';
import { requirePageSession } from '@/lib/page-auth';
import ConsoleShell from './console-shell';

export const dynamic = 'force-dynamic';
export default async function Page() {
  const session = await requirePageSession();
  return <ConsoleShell username={session.user.username}><Dashboard demo={process.env.DASHBOARD_DEMO_MODE === 'true'} /></ConsoleShell>;
}
