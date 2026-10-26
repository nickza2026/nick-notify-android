import { invalidQuery, invalidOrigin, upstream } from '@/lib/backend';
import { localDashboardRequest } from '@/lib/protocol';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!localDashboardRequest(request)) return invalidOrigin();
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return invalidQuery();
  return upstream(`/v1/alerts/${encodeURIComponent(id)}`);
}
