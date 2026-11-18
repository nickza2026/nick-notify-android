import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {configuration,configure,network,authorizedWebDomain,preservedConfiguration,PROJECT,LOCATION,FIREBASE_PROJECT,API,WEB} from './google-runtime.mjs';

const web={apiKey:'AIza'+'s'.repeat(35),authDomain:FIREBASE_PROJECT+'.firebaseapp.com',projectId:FIREBASE_PROJECT,appId:'1:123456789:web:abcdef123'};
const owner={project_id:FIREBASE_PROJECT,owner_uid:'synthetic-owner-uid'};
function harness(phase='configure-web') {
  let current={project:PROJECT,location:LOCATION,name:phase==='activate-api'?'notify-alarm-api':'notify-alarm-web',
    image:'ghcr.io/synthetic:tested',revision:7,port:8787,type:'WebService',minReplica:1,maxReplica:1,internal:false,
    env:{ALERT_API_KEY:'synthetic-preserve-api-key',DEVICE_TOKEN_ENCRYPTION_KEY:'synthetic-encryption-key',DATABASE_URL:'postgres://synthetic.invalid/unused'},
    mountData:{'credentials.json':'synthetic-not-a-key'},resource:{limits:{cpu:'1',memory:'256Mi'}},command:[],args:[]};
  const calls=[],reports=[];
  const options={phase,web,owner,domainAllowed:async()=>true,sleep:async()=>{},report:r=>reports.push(r),
    rpc:async(method,body)=>{
      calls.push({method,body:structuredClone(body)});
      if(method==='deployment.deploy') {current={...current,revision:current.revision+1,env:{...current.env,...body.addEnv}};return {};}
      return structuredClone(current);
    },
    publicJSON:async url=>{
      if(url===WEB+'/api/auth/google-setup') return {firebase:web};
      assert.equal(url,API+'/v1/client/auth-config');return {mode:'google',firebase_project_id:FIREBASE_PROJECT};
    }};
  return {options,calls,reports,get:()=>current,set:d=>{current=d;}};
}

test('configuration has exactly the seven approved environment additions',()=>{
  const c=configuration(web,owner);assert.equal(Object.keys(c.web).length,4);assert.equal(Object.keys(c.api).length,3);
  assert.equal(c.api.AUTH_MODE,'google');assert.throws(()=>configuration({...web,secret:'unexpected'},owner));
  assert.throws(()=>configuration({...web,projectId:'other-project'},owner));
  assert.throws(()=>configuration(web,{...owner,owner_uid:'bad\nuid'}));
});

for(const phase of ['configure-web','activate-api']) test(phase+' adds only Google fields and preserves image/secrets/settings',async()=>{
  const h=harness(phase),before=structuredClone(h.get());await configure(h.options);
  const mutations=h.calls.filter(c=>c.method==='deployment.deploy');assert.equal(mutations.length,1);
  assert.deepEqual(Object.keys(mutations[0].body).sort(),['addEnv','image','location','name','project']);
  assert.equal(mutations[0].body.image,before.image);
  preservedConfiguration(before,h.get(),mutations[0].body.addEnv);
  assert.equal(h.reports[0].preserved_existing_configuration,true);
  const output=JSON.stringify(h.reports);for(const sensitive of [web.apiKey,owner.owner_uid,...Object.values(before.env)])assert.ok(!output.includes(sensitive));
});

test('preflight is read-only',async()=>{const h=harness();h.options.phase='preflight';await configure(h.options);assert.deepEqual(h.calls.map(c=>c.method),['deployment.get']);});

test('API cannot activate until the deployed Web config exactly matches',async()=>{
  const h=harness('activate-api');h.options.publicJSON=async()=>({firebase:{...web,projectId:'wrong'}});
  await assert.rejects(configure(h.options),/web_google_configuration_not_ready/);
  assert.equal(h.calls.filter(c=>c.method==='deployment.deploy').length,0);
});

test('existing different Google identity is never silently rebound',async()=>{
  const h=harness('activate-api');h.get().env={AUTH_MODE:'google',FIREBASE_OWNER_UID:'other-owner',FIREBASE_PROJECT_ID:FIREBASE_PROJECT};
  await assert.rejects(configure(h.options),/existing_google_identity_mismatch/);
  assert.equal(h.calls.filter(c=>c.method==='deployment.deploy').length,0);
});

test('API activation requires the exact authorized Web domain before mutation',async()=>{
  const h=harness('activate-api');h.options.domainAllowed=async()=>false;
  await assert.rejects(configure(h.options),/firebase_web_domain_not_authorized/);
  assert.equal(h.calls.filter(c=>c.method==='deployment.deploy').length,0);
});

test('public Firebase domain inspection has no management credentials and no redirects',async()=>{
  const calls=[];const fetcher=async(url,opts)=>{calls.push({url:new URL(url),opts});return new Response(JSON.stringify({authorizedDomains:[new URL(WEB).hostname]}));};
  assert.equal(await authorizedWebDomain(web.apiKey,fetcher),true);
  assert.equal(calls[0].url.origin,'https://identitytoolkit.googleapis.com');
  assert.equal(calls[0].url.pathname,'/v1/projects');assert.equal(calls[0].url.searchParams.get('key'),web.apiKey);
  assert.equal(calls[0].opts.headers.Authorization,undefined);assert.equal(calls[0].opts.redirect,'manual');
  assert.equal(await authorizedWebDomain(web.apiKey,async()=>new Response(JSON.stringify({authorizedDomains:['localhost']}))),false);
  await assert.rejects(authorizedWebDomain(web.apiKey,async()=>{throw Error('PRIVATE_ERROR');}),e=>e.message==='firebase_project_configuration_unavailable');
});

test('unknown deployment and changed revision stop before mutation',async()=>{
  const h=harness();h.get().name='other-service';await assert.rejects(configure(h.options),/invalid_deployment_snapshot/);
  const other=harness();let reads=0;const rpc=other.options.rpc;
  other.options.rpc=async(method,body)=>{const result=await rpc(method,body);if(method==='deployment.get'&&++reads===2)result.revision++;return result;};
  await assert.rejects(configure(other.options),/deployment_changed_before_update/);
  assert.equal(other.calls.filter(c=>c.method==='deployment.deploy').length,0);
});

test('failed mutation is never retried',async()=>{
  const h=harness();let writes=0;const rpc=h.options.rpc;
  h.options.rpc=async(method,body)=>{if(method==='deployment.deploy'){writes++;throw Error('synthetic timeout');}return rpc(method,body);};
  await assert.rejects(configure(h.options),/synthetic timeout/);assert.equal(writes,1);
});

test('existing secret loss or image change is detected after update',async()=>{
  for(const change of [d=>{delete d.env.ALERT_API_KEY;},d=>{d.image='changed';}]) {
    const h=harness(),rpc=h.options.rpc;
    h.options.rpc=async(method,body)=>{const r=await rpc(method,body);if(method==='deployment.deploy')change(h.get());return r;};
    await assert.rejects(configure(h.options),/existing_environment_changed|non_google_configuration_changed/);
  }
});

test('already-applied config is idempotent and does not create a revision',async()=>{
  const h=harness();Object.assign(h.get().env,configuration(web,owner).web);await configure(h.options);
  assert.equal(h.calls.filter(c=>c.method==='deployment.deploy').length,0);assert.equal(h.reports[0].changed,false);
});

test('unready public endpoint is bounded and never claims success',async()=>{
  const h=harness();let reads=0;h.options.publicJSON=async()=>{reads++;throw Error('synthetic503');};
  await assert.rejects(configure(h.options),/public_google_configuration_not_ready/);assert.equal(reads,12);assert.equal(h.reports.length,0);
});

test('management credentials are never sent to public hosts or redirects',async()=>{
  const calls=[];const n=network({email:'synthetic@example.invalid',key:'synthetic-key',fetcher:async(url,opts)=>{
    calls.push({url,opts});return new Response(JSON.stringify(url.startsWith('https://api.nortezh.com/')?{ok:true,result:{}}:{mode:'password'}));
  }});
  await n.rpc('deployment.get',{project:PROJECT,location:LOCATION,name:'notify-alarm-web'});
  await n.publicJSON(WEB+'/api/auth/google-setup');assert.ok(calls[0].opts.headers.Authorization.startsWith('Basic '));
  assert.equal(calls[1].opts.headers.Authorization,undefined);assert.equal(calls[0].opts.redirect,'manual');assert.equal(calls[1].opts.redirect,'manual');
  await assert.rejects(n.rpc('deployment.delete',{project:PROJECT,location:LOCATION,name:'notify-alarm-web'}),/unapproved/);
  await assert.rejects(n.publicJSON('http://unapproved.invalid'),/unapproved/);
});

test('network errors do not disclose provider error or credential data',async()=>{
  const n=network({email:'synthetic@example.invalid',key:'synthetic-key',fetcher:async()=>{throw Error('PRIVATE_CONTENT_MUST_NOT_LEAK');}});
  await assert.rejects(n.rpc('deployment.deploy',{project:PROJECT,location:LOCATION,name:'notify-alarm-web'}),error=>error.message==='mutation_outcome_unknown_no_retry');
});

test('runtime workflow remains main/manual-only with tests before identity use',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/google-runtime.yaml',import.meta.url),'utf8');
  assert.ok(yaml.includes('workflow_dispatch:'));assert.ok(!/\n\s*(push|pull_request|pull_request_target):/.test(yaml));
  assert.ok(yaml.includes("github.ref == 'refs/heads/main'"));assert.ok(yaml.includes('cancel-in-progress: false'));
  assert.ok(yaml.indexOf('node --test tools/test-google-runtime.mjs')<yaml.indexOf('SA_AUTH_KEY:'));
  assert.ok(!/secrets\.[A-Z_]*(DATABASE|ENCRYPTION)/.test(yaml));
});
