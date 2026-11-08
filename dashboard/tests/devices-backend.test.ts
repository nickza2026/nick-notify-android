import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){if(specifier==='server-only')return {url:new URL('./server-marker.mjs',import.meta.url).href,shortCircuit:true};return next(specifier,context);}});
const backend = import('../lib/backend');
const id = '11111111-1111-4111-8111-111111111111';
const token = 'S'.repeat(43);
function setup() { process.env.DASHBOARD_PUBLIC_URL='https://console.example'; process.env.BACKEND_URL='http://127.0.0.1:8791'; process.env.BACKEND_API_KEY='synthetic-server-key'; delete process.env.BACKEND_API_KEY_FILE; }
function request(method='GET', authenticated=true, origin='https://console.example') {
  return new Request('http://0.0.0.0:3010/api/devices'+(method==='DELETE'?`/${id}`:''), {method,headers:{host:'console.example',origin,'content-type':'application/json','x-notify-request':'dashboard',...(authenticated?{cookie:`__Host-notify_session=${token}`}:{})}});
}
test('device BFF gates auth/origin and projects only public registration state', async (t) => {
  setup(); const {devicesRoute}=await backend; const fetchBefore=globalThis.fetch; t.after(()=>{globalThis.fetch=fetchBefore;});
  let calls=0;
  globalThis.fetch=async(url,options)=>{
    calls++; assert.equal(new URL(String(url)).pathname,'/v1/dashboard/devices');
    const headers=new Headers(options?.headers); assert.equal(headers.get('x-dashboard-session'),token); assert.equal(headers.get('cookie'),null);
    return Response.json({items:[{device_id:id,installation_id:id,device_name:'เครื่องจำลอง',key_ids:['primary'],active:true,created_at:'2026-11-08T10:00:00Z',updated_at:'2026-11-08T10:00:00Z',fcm_token:'NEVER_FORWARD',access_token:'NEVER_FORWARD'}]});
  };
  assert.equal((await devicesRoute(request('GET',false))).status,401); assert.equal(calls,0);
  assert.equal((await devicesRoute(request('DELETE',true,'https://evil.example'),id)).status,403); assert.equal(calls,0);
  const response=await devicesRoute(request()); assert.equal(response.status,200); assert.ok(!JSON.stringify(await response.json()).includes('NEVER_FORWARD')); assert.equal(calls,1);
});
test('device revocation uses DELETE with no body, rejects forged IDs and does not invent success', async(t)=>{
  setup(); const {devicesRoute}=await backend; const fetchBefore=globalThis.fetch; t.after(()=>{globalThis.fetch=fetchBefore;}); let calls=0;
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(new URL(String(url)).pathname,`/v1/dashboard/devices/${id}`);assert.equal(options?.method,'DELETE');assert.equal(options?.body,undefined);return Response.json({revoked:true,api_key:'NEVER_FORWARD'});};
  assert.equal((await devicesRoute(request('DELETE'),'bad')).status,400);assert.equal(calls,0);
  const response=await devicesRoute(request('DELETE'),id); assert.equal(response.status,200); assert.deepEqual(await response.json(),{revoked:true});
  globalThis.fetch=async()=>Response.json({revoked:false,internal:'NEVER_FORWARD'});
  assert.equal((await devicesRoute(request('DELETE'),id)).status,502);
  globalThis.fetch=async()=>Response.json({error:{code:'session_required'}},{status:401});
  const expired=await devicesRoute(request('DELETE'),id); assert.equal(expired.status,401); assert.match(expired.headers.get('set-cookie')??'',/Max-Age=0/);
});
