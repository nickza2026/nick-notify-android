import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){if(specifier==='server-only')return {url:new URL('./server-marker.mjs',import.meta.url).href,shortCircuit:true};return next(specifier,context);}});
const backend=import('../lib/backend');
const token='S'.repeat(43);const expires=new Date(Date.now()+3600000).toISOString();
const session={user:{username:'admin',must_change_password:false},expires_at:expires,session_token:token,api_key:'NEVER_FORWARD'};
function setup(){process.env.DASHBOARD_PUBLIC_URL='https://console.example';process.env.BACKEND_URL='http://127.0.0.1:8791';process.env.BACKEND_API_KEY='synthetic-test-key';delete process.env.BACKEND_API_KEY_FILE;}
function request(path:string,body?:unknown,withSession=true){return new Request(`http://0.0.0.0:3000${path}`,{method:body===undefined?'GET':'POST',headers:{host:'console.example',origin:'https://console.example','content-type':'application/json','x-notify-request':'dashboard',...(withSession?{cookie:`unrelated=PRIVATE; __Host-notify_session=${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});}
test('auth routes project tokens into secure host-only cookie only, rotate and clear logout',async()=>{
  const {authRoute}=await backend;
  setup();const original=globalThis.fetch;const calls:{path:string;init?:RequestInit}[]=[];
  globalThis.fetch=async(input,init)=>{calls.push({path:String(input),init});return Response.json(String(input).endsWith('/logout')?{ok:true,secret:'NEVER_FORWARD'}:session);};
  try{
    const response=await authRoute(request('/api/auth/login',{username:'admin',password:'synthetic'},false),'login');assert.equal(response.status,200);assert.deepEqual(await response.json(),{user:session.user,expires_at:expires});const cookie=response.headers.get('set-cookie')!;assert.match(cookie,/__Host-notify_session=/);for(const flag of ['Secure','HttpOnly','SameSite=lax','Path=/'])assert.ok(cookie.includes(flag));assert.ok(!cookie.includes('Domain='));
    const headers=new Headers(calls[0].init?.headers);assert.equal(headers.get('Authorization'),'Bearer synthetic-test-key');assert.equal(headers.get('cookie'),null);assert.equal(headers.get('x-dashboard-session'),null);
    const changed=await authRoute(request('/api/auth/change-password',{current_password:'old',new_password:'new synthetic long password'}),'change-password');assert.equal(changed.status,200);assert.ok(changed.headers.get('set-cookie'));assert.equal(new Headers(calls[1].init?.headers).get('x-dashboard-session'),token);
    const logged=await authRoute(request('/api/auth/logout',{},false),'logout');assert.deepEqual(await logged.json(),{ok:true});assert.match(logged.headers.get('set-cookie')!,/Max-Age=0/);assert.equal(calls[2].init?.body,undefined);
  }finally{globalThis.fetch=original;}
});
test('data gates missing session before fetch and preserves forced-change and session-expiry errors',async()=>{
  const {upstream}=await backend;
  setup();const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({error:{code:'password_change_required'},secret:'NEVER_FORWARD'},{status:403});};
  try{
    const missing=await upstream(request('/api/stats',undefined,false),'/v1/dashboard/stats');assert.equal(missing.status,401);assert.equal(calls,0);assert.match(missing.headers.get('set-cookie')!,/Max-Age=0/);
    const temporary=await upstream(request('/api/stats'),'/v1/dashboard/stats');assert.equal(temporary.status,403);assert.deepEqual(await temporary.json(),{error:'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน',code:'password_change_required'});
    globalThis.fetch=async()=>Response.json({error:{code:'session_required'},secret:'NEVER_FORWARD'},{status:401});const expired=await upstream(request('/api/stats'),'/v1/dashboard/stats');assert.equal(expired.status,401);assert.match(expired.headers.get('set-cookie')!,/Max-Age=0/);
    globalThis.fetch=async()=>Response.json({error:{code:'unauthorized'}},{status:401});const appKey=await upstream(request('/api/stats'),'/v1/dashboard/stats');assert.equal(appKey.status,503);assert.equal((await appKey.json()).code,'server_configuration');assert.equal(appKey.headers.get('set-cookie'),null);
  }finally{globalThis.fetch=original;}
});
test('fixed send path, explicit normal/critical, identical idempotency retry and no cookie forwarding',async()=>{
  const {upstream}=await backend;
  setup();const original=globalThis.fetch;const calls:{url:string;init?:RequestInit}[]=[];
  globalThis.fetch=async(input,init)=>{calls.push({url:String(input),init});const sent=JSON.parse(String(init?.body));return Response.json({alert_id:sent.alert_id,status:'provider_accepted',expires_at:'2026-10-29T08:00:00Z',acknowledged:false,delivery_verified:false,importance:sent.importance,ack_capability:'NEVER_FORWARD'},{status:202});};
  try{for(const importance of ['normal','critical']){const body={alert_id:'synthetic-one',title:'test',message:'synthetic',ttl_seconds:300,importance};for(let i=0;i<2;i++){const response=await upstream(request('/api/test-alerts',body),'/v1/dashboard/alerts',undefined,body,'synthetic-idempotency-key');assert.deepEqual(await response.json(),{alert_id:'synthetic-one',status:'provider_accepted',expires_at:'2026-10-29T08:00:00Z',acknowledged:false,delivery_verified:false,importance});}assert.equal(calls.at(-1)?.init?.body,calls.at(-2)?.init?.body);}
    for(const call of calls){assert.equal(call.url,'http://127.0.0.1:8791/v1/dashboard/alerts');const headers=new Headers(call.init?.headers);assert.equal(headers.get('cookie'),null);assert.equal(headers.get('idempotency-key'),'synthetic-idempotency-key');assert.equal(headers.get('x-dashboard-session'),token);assert.equal(call.init?.redirect,'manual');}
  }finally{globalThis.fetch=original;}
});
test('malformed success receipts reject mismatched identity, mode and invented delivery proof',async()=>{
  const {upstream}=await backend;setup();const original=globalThis.fetch;
  const body={alert_id:'synthetic-one',title:'test',message:'synthetic',ttl_seconds:300,importance:'normal'};
  const base={alert_id:body.alert_id,status:'provider_accepted',expires_at:'2026-10-29T08:00:00Z',importance:'normal',acknowledged:false,delivery_verified:false};
  try{for(const patch of [{alert_id:'wrong-id'},{importance:'critical'},{importance:null},{expires_at:'invalid'},{acknowledged:true},{delivery_verified:true},{status:'delivered'}]){
    globalThis.fetch=async()=>Response.json({...base,...patch,ack_token:'NEVER_FORWARD'},{status:202});
    const response=await upstream(request('/api/test-alerts',body),'/v1/dashboard/alerts',undefined,body,'synthetic-idempotency-key');
    assert.equal(response.status,502);assert.equal((await response.json()).code,'upstream_error');
  }}finally{globalThis.fetch=original;}
});
test('bad mutation headers, config and malformed upstream never expose raw body',async()=>{
  const {authRoute}=await backend;
  setup();const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response('PRIVATE_RAW_SECRET',{status:500});};
  try{
    const untrusted=new Request('http://0.0.0.0:3000/api/auth/login',{method:'POST',headers:{host:'console.example','content-type':'application/json'},body:'{}'});assert.equal((await authRoute(untrusted,'login')).status,403);assert.equal(calls,0);
    const response=await authRoute(request('/api/auth/login',{username:'admin',password:'synthetic'},false),'login');assert.equal(response.status,502);assert.ok(!JSON.stringify(await response.json()).includes('PRIVATE_RAW_SECRET'));
    delete process.env.DASHBOARD_PUBLIC_URL;assert.equal((await authRoute(request('/api/auth/login',{username:'admin',password:'synthetic'},false),'login')).status,503);
  }finally{globalThis.fetch=original;}
});
test('explicit HTTP loopback uses only local HttpOnly cookie; Retry-After survives normalized error',async()=>{
  const {authRoute}=await backend;setup();process.env.DASHBOARD_PUBLIC_URL='http://127.0.0.1:3010';const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json(session);
  const make=()=>new Request('http://0.0.0.0:3010/api/auth/login',{method:'POST',headers:{host:'127.0.0.1:3010',origin:'http://127.0.0.1:3010','content-type':'application/json','x-notify-request':'dashboard'},body:JSON.stringify({username:'admin',password:'synthetic'})});
  try{
    const response=await authRoute(make(),'login');assert.equal(response.status,200);const value=response.headers.get('set-cookie')!;assert.match(value,/notify_session_local=/);assert.match(value,/HttpOnly/);assert.ok(!value.includes('Secure'));assert.ok(!value.includes('Domain='));
    const age=Number(/Max-Age=(\d+)/.exec(value)?.[1]);assert.ok(age>=0&&age<=Math.floor((Date.parse(expires)-Date.now())/1000)+1);
    globalThis.fetch=async()=>Response.json({error:{code:'rate_limited'},debug:'NEVER_FORWARD'},{status:429,headers:{'Retry-After':'60'}});const limited=await authRoute(make(),'login');assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');assert.deepEqual(await limited.json(),{code:'rate_limited',error:'คำขอมากเกินไป กรุณารอแล้วลองใหม่'});
  }finally{globalThis.fetch=original;setup();}
});
test('history query projection uses dashboard namespace and drops upstream extras',async()=>{
  const {upstream}=await backend;setup();const original=globalThis.fetch;let target='';
  globalThis.fetch=async(input)=>{target=String(input);return Response.json({items:[],next_cursor:null,credential:'NEVER_FORWARD'});};
  try{const query=new URLSearchParams({from:'2026-10-28T00:00:00Z',to:'2026-10-29T00:00:00Z',status:'all',limit:'25'});const response=await upstream(request('/api/history'),'/v1/dashboard/history',query);assert.equal(response.status,200);assert.deepEqual(await response.json(),{items:[],next_cursor:null});const url=new URL(target);assert.equal(url.pathname,'/v1/dashboard/history');assert.equal(url.searchParams.get('from'),query.get('from'));}
  finally{globalThis.fetch=original;}
});
