import { authRoute } from '@/lib/backend';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => authRoute(request, 'session');
