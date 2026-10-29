import { authRoute } from '@/lib/backend';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => authRoute(request, 'change-password');
