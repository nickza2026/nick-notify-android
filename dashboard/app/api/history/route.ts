import { historyQuery, localDashboardRequest } from '@/lib/protocol';
import { invalidQuery, invalidOrigin, upstream } from '@/lib/backend';

export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  if (!localDashboardRequest(request)) return invalidOrigin();
  const query = historyQuery(new URL(request.url).searchParams);
  return query ? upstream('/v1/history', query) : invalidQuery();
}
