import { alertBody, boundedJSON } from '@/lib/security';
import { guard, invalidQuery, upstream } from '@/lib/backend';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const rejected = guard(request,true); if(rejected)return rejected;
  const key=request.headers.get('idempotency-key');
  if(!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key) || Number(request.headers.get('content-length')??0)>20000)return invalidQuery();
  let body;try {body=alertBody(await boundedJSON(request,20000));}catch{return invalidQuery();}
  return upstream(request,'/v1/dashboard/alerts',undefined,body,key);
}
