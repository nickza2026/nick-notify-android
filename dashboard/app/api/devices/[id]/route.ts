import { devicesRoute } from '@/lib/backend';

export const dynamic = 'force-dynamic';
export async function DELETE(request: Request, context: { params: Promise<{id: string}> }) {
  return devicesRoute(request, (await context.params).id);
}
