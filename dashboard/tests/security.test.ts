import {test} from 'node:test';
import assert from 'node:assert/strict';
import {alertBody,authDTO,backendURL,boundedJSON,publicConfig,sessionToken,trustedRequest} from '../lib/security';
test('public canonical URL requires HTTPS except explicit exact loopback HTTP',()=>{
  for(const url of [undefined,'http://public.example','http://127.0.0.1.evil:3010','https://user:pass@console.example','https://console.example/path','https://console.example/?q=1','https://console.example/#x','file:///tmp'])assert.throws(()=>publicConfig(url));
  assert.equal(publicConfig('https://console.example').cookie,'__Host-notify_session');
  assert.equal(publicConfig('http://127.0.0.1:3010').cookie,'notify_session_local');
});
test('canonical Host and Origin checked independently of internal TLS termination scheme',()=>{
  process.env.DASHBOARD_PUBLIC_URL='https://console.example';
  const make=(h:Record<string,string>)=>new Request('http://0.0.0.0:3000/api/auth/login',{headers:h});
  const valid:Record<string,string>={host:'console.example',origin:'https://console.example','content-type':'application/json; charset=utf-8','x-notify-request':'dashboard'};
  assert.equal(trustedRequest(make(valid),true),true);
  for(const field of Object.keys(valid)){const altered={...valid};delete altered[field];assert.equal(trustedRequest(make(altered),true),false);}
  const badHeaders:Record<string,string>[]=[{host:'evil.example'},{origin:'https://evil.example'},{'content-type':'text/plain'},{'x-notify-request':'other'}];
  for(const overrides of badHeaders)assert.equal(trustedRequest(make({...valid,...overrides}),true),false);
  assert.equal(trustedRequest(make({host:'evil.example','x-forwarded-host':'console.example','x-forwarded-proto':'https'})),false);
  assert.equal(trustedRequest(make({host:'console.example'})),true);
});
test('only chosen own opaque cookie accepted; duplicate/malformed/other cookies rejected',()=>{
  process.env.DASHBOARD_PUBLIC_URL='https://console.example';const token='A'.repeat(43);
  assert.equal(sessionToken(`other=secret; __Host-notify_session=${token}`),token);
  for(const value of [null,`notify_session_local=${token}`,'__Host-notify_session=x',`__Host-notify_session=${token}; __Host-notify_session=${token}`,`__Host-notify_session=${'A'.repeat(42)}%41`])assert.equal(sessionToken(value),undefined);
});
test('authentication DTO strips token and all unrelated secrets',()=>{
  const dto={user:{username:'admin',must_change_password:true},expires_at:'2026-10-30T00:00:00Z'};
  assert.deepEqual(authDTO({...dto,session_token:'secret',api_key:'secret',user:{...dto.user,password:'secret'}}),dto);
  for(const value of [{},null,{...dto,user:{username:'admin',must_change_password:'false'}},{...dto,expires_at:'invalid'}])assert.throws(()=>authDTO(value));
});
test('backend paths fixed and operator internal HTTP origins exact',()=>{
  delete process.env.BACKEND_ALLOWED_HTTP_ORIGINS;
  process.env.BACKEND_URL='http://backend:8791';assert.throws(()=>backendURL('/v1/dashboard/history'));
  process.env.BACKEND_ALLOWED_HTTP_ORIGINS='http://backend:8791';assert.equal(backendURL('/v1/dashboard/history').href,'http://backend:8791/v1/dashboard/history');
  process.env.BACKEND_URL='http://backend:8792';assert.throws(()=>backendURL('/v1/dashboard/history'));
  process.env.BACKEND_URL='https://backend.example';
  for(const path of ['https://evil.example','/v1/alerts','/v1/dashboard/alerts/id/ack','/v1/dashboard/history?secret=x','/v1/dashboard/alerts/../logout'])assert.throws(()=>backendURL(path));
  for(const value of ['http://*.example','http://backend:8791/path','http://user:pass@backend:8791']){process.env.BACKEND_ALLOWED_HTTP_ORIGINS=value;assert.throws(()=>backendURL('/v1/dashboard/history'));}
  delete process.env.BACKEND_ALLOWED_HTTP_ORIGINS;delete process.env.BACKEND_URL;
});
test('test-alert allowlist requires explicit normal/critical and bounded Unicode/TTL',()=>{
  const body={alert_id:'synthetic-one',title:'ทดสอบ',message:'ข้อความ',ttl_seconds:300,importance:'normal'};
  assert.deepEqual(alertBody(body),body);assert.equal(alertBody({...body,importance:'critical'}).importance,'critical');
  for(const extra of [{importance:undefined},{importance:'urgent'},{ttl_seconds:29},{ttl_seconds:10801},{ttl_seconds:30.5},{title:'😀'.repeat(121)},{message:'ก'.repeat(2001)},{fcm_token:'forbidden'},{url:'http://evil'}])assert.throws(()=>alertBody({...body,...extra}));
  assert.equal(alertBody({...body,title:'😀'.repeat(120)}).title.length,240);
});
test('request reader bounds chunked payload independent of content-length',async()=>{
  assert.deepEqual(await boundedJSON(new Request('http://localhost',{method:'POST',body:'{"ok":true}'}),20),{ok:true});
  await assert.rejects(boundedJSON(new Request('http://localhost',{method:'POST',body:'x'.repeat(30)}),20));
  await assert.rejects(boundedJSON(new Request('http://localhost',{method:'POST',body:'not json'}),20));
});
