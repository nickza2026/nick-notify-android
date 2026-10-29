import { requirePageSession } from '@/lib/page-auth';
import ConsoleShell from '../console-shell';
import TestComposer from './test-composer';
export const dynamic='force-dynamic';
export default async function TestPage(){const session=await requirePageSession();return <ConsoleShell username={session.user.username}><TestComposer/></ConsoleShell>;}
