import { invalidQuery, guard, upstream } from '@/lib/backend';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const rejected = guard(request); if (rejected) return rejected;
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return invalidQuery();
  return upstream(request, `/v1/dashboard/alerts/${encodeURIComponent(id)}`);
}
