import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){if(specifier==='server-only')return {url:new URL('./server-marker.mjs',import.meta.url).href,shortCircuit:true};return next(specifier,context);}});
const backend=import('../lib/backend');
const bearer='S'.repeat(43);
const idToken='synthetic-header.synthetic-payload.synthetic-signature';
const expires=new Date(Date.now()+3600000).toISOString();
function setup(){
  process.env.DASHBOARD_PUBLIC_URL='https://console.example';process.env.BACKEND_URL='http://127.0.0.1:8791';process.env.BACKEND_API_KEY='SYNTHETIC_MASTER_KEY';delete process.env.BACKEND_API_KEY_FILE;
  process.env.FIREBASE_WEB_API_KEY='SYNTHETIC_PUBLIC_CLIENT_KEY';process.env.FIREBASE_WEB_AUTH_DOMAIN='synthetic-owner.firebaseapp.com';process.env.FIREBASE_WEB_PROJECT_ID='synthetic-owner';process.env.FIREBASE_WEB_APP_ID='1:123456789:web:synthetic';process.env.FIREBASE_OWNER_UID='NEVER_FORWARD_OWNER_UID';
}
function request(path:string,body?:unknown,origin='https://console.example'){
  return new Request('http://0.0.0.0:3010'+path,{method:body===undefined?'GET':'POST',headers:{host:'console.example',origin,'content-type':'application/json','x-notify-request':'dashboard',cookie:`__Host-notify_session=${bearer}`},body:body===undefined?undefined:JSON.stringify(body)});
}
test('Google BFF exchanges only Firebase ID token and projects only the HttpOnly session',async(t)=>{
  setup();const {authRoute}=await backend;const oldFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=oldFetch;});let calls=0;
  globalThis.fetch=async(input,options)=>{
    calls++;assert.equal(new URL(String(input)).pathname,'/v1/dashboard/google-login');assert.deepEqual(JSON.parse(String(options?.body)),{id_token:idToken});
    const headers=new Headers(options?.headers);assert.equal(headers.get('authorization'),'Bearer SYNTHETIC_MASTER_KEY');assert.equal(headers.get('cookie'),null);assert.equal(headers.get('x-dashboard-session'),null);
    return Response.json({session_token:bearer,expires_at:expires,user:{username:'admin',must_change_password:false},firebase_token:idToken,owner_uid:'NEVER_FORWARD_OWNER_UID'});
  };
  const response=await authRoute(request('/api/auth/google-login',{id_token:idToken}),'google-login');
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{expires_at:expires,user:{username:'admin',must_change_password:false}});
  const cookie=response.headers.get('set-cookie')!;assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=lax/);assert.ok(!cookie.includes(idToken));assert.equal(calls,1);
  for(const input of [{id_token:idToken,uid:'fake'},{id_token:null},{id_token:'bad'},{id_token:'h.p.'+'s'.repeat(8200)}])assert.equal((await authRoute(request('/api/auth/google-login',input),'google-login')).status,400);
  assert.equal((await authRoute(request('/api/auth/google-login',{id_token:idToken},'https://evil.example'),'google-login')).status,403);assert.equal(calls,1);
});
test('Google config exposes only public Firebase client settings and never falls back on incomplete Google mode',async(t)=>{
  setup();const {authConfigRoute}=await backend;const oldFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=oldFetch;});
  globalThis.fetch=async()=>Response.json({mode:'google',firebase_project_id:'synthetic-owner'});
  let response=await authConfigRoute(request('/api/auth/config'));assert.equal(response.status,200);const data=await response.json();assert.equal(data.firebase.projectId,'synthetic-owner');assert.ok(!JSON.stringify(data).includes('NEVER_FORWARD'));assert.ok(!JSON.stringify(data).includes('SYNTHETIC_MASTER_KEY'));
  delete process.env.FIREBASE_WEB_APP_ID;response=await authConfigRoute(request('/api/auth/config'));assert.equal(response.status,503);assert.equal((await response.json()).code,'server_configuration');
  setup();process.env.FIREBASE_WEB_PROJECT_ID='different-project';assert.equal((await authConfigRoute(request('/api/auth/config'))).status,503);
  setup();globalThis.fetch=async()=>Response.json({mode:'password',firebase_project_id:null});response=await authConfigRoute(request('/api/auth/config'));assert.deepEqual(await response.json(),{mode:'password',firebase_project_id:null,firebase:null});
  globalThis.fetch=async()=>Response.json({error:{code:'google_auth_unavailable'},owner_uid:'NEVER_FORWARD'},{status:503});response=await authConfigRoute(request('/api/auth/config'));assert.equal(response.status,503);assert.equal((await response.json()).code,'google_auth_unavailable');
});
test('Google exchange does not invent success or forward raw provider errors',async(t)=>{
  setup();const {authRoute}=await backend;const oldFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=oldFetch;});
  globalThis.fetch=async()=>Response.json({session_token:bearer,expires_at:expires,user:{username:'admin',must_change_password:true}});assert.equal((await authRoute(request('/api/auth/google-login',{id_token:idToken}),'google-login')).status,502);
  globalThis.fetch=async()=>Response.json({error:{code:'google_account_not_allowed'},debug:idToken},{status:403});const denied=await authRoute(request('/api/auth/google-login',{id_token:idToken}),'google-login');assert.equal(denied.status,403);assert.equal((await denied.json()).code,'google_account_not_allowed');
});
test('UID preparation projects only public config without contacting backend, claiming owner or issuing cookie',async(t)=>{
  setup();const {googleSetupConfigRoute}=await backend;const oldFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=oldFetch;});let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('backend must not be contacted');};
  process.env.BACKEND_API_KEY_FILE='MUST_NOT_READ_PRIVATE_BACKEND_KEY';
  const response=await googleSetupConfigRoute(request('/api/auth/google-setup'));assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);const data=await response.json();assert.deepEqual(Object.keys(data),['firebase']);assert.deepEqual(Object.keys(data.firebase).sort(),['apiKey','appId','authDomain','projectId']);assert.ok(!JSON.stringify(data).includes('NEVER_FORWARD'));assert.equal(calls,0);
  assert.equal((await googleSetupConfigRoute(request('/api/auth/google-setup',undefined,'https://evil.example'))).status,403);delete process.env.FIREBASE_WEB_APP_ID;assert.equal((await googleSetupConfigRoute(request('/api/auth/google-setup'))).status,503);
  setup();
});
