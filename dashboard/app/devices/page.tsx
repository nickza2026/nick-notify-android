import ConsoleShell from '../console-shell';
import { requirePageSession } from '@/lib/page-auth';
import Devices from './devices';

export const dynamic = 'force-dynamic';
export default async function Page() {
  const session = await requirePageSession();
  return <ConsoleShell username={session.user.username}><Devices demo={process.env.DASHBOARD_DEMO_MODE === 'true'} /></ConsoleShell>;
}
