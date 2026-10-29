import { statsQuery } from '@/lib/protocol';
import { invalidQuery, guard, upstream } from '@/lib/backend';

export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  const rejected = guard(request); if (rejected) return rejected;
  const query = statsQuery(new URL(request.url).searchParams);
  return query ? upstream(request, '/v1/dashboard/stats', query) : invalidQuery();
}
