import { devicesRoute } from '@/lib/backend';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return devicesRoute(request); }
