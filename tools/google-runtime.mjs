import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';

export const PROJECT='internal-tools';
export const LOCATION='olufy-0';
export const FIREBASE_PROJECT='notifyalarm-6804f';
export const API='https://notify-alarm-api-7496986423345747739.olufy-0.nortezh.com';
export const WEB='https://notify-alarm-web-7496986423345747739.olufy-0.nortezh.com';
const API_KEYS=['AUTH_MODE','FIREBASE_PROJECT_ID','FIREBASE_OWNER_UID'];
const WEB_KEYS=['FIREBASE_WEB_API_KEY','FIREBASE_WEB_AUTH_DOMAIN','FIREBASE_WEB_PROJECT_ID','FIREBASE_WEB_APP_ID'];
const preserved=['image','minReplica','maxReplica','type','port','protocol','internal','command','args','pullSecret','disk','schedule','mountData','resource'];
const fail=code=>{throw new Error(code);};

export function configuration(web,owner) {
  if(!web||!owner||Object.keys(web).sort().join(',')!=='apiKey,appId,authDomain,projectId'||
    Object.keys(owner).sort().join(',')!=='owner_uid,project_id') fail('invalid_configuration_shape');
  if(web.projectId!==FIREBASE_PROJECT||owner.project_id!==FIREBASE_PROJECT||
    web.authDomain!==`${FIREBASE_PROJECT}.firebaseapp.com`||
    typeof web.apiKey!=='string'||!/^AIza[A-Za-z0-9_-]{20,100}$/.test(web.apiKey)||
    typeof web.appId!=='string'||!/^1:\d+:web:[a-zA-Z0-9]+$/.test(web.appId)||
    typeof owner.owner_uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(owner.owner_uid)) fail('invalid_google_configuration');
  return {web:{FIREBASE_WEB_API_KEY:web.apiKey,FIREBASE_WEB_AUTH_DOMAIN:web.authDomain,
    FIREBASE_WEB_PROJECT_ID:web.projectId,FIREBASE_WEB_APP_ID:web.appId},
    api:{AUTH_MODE:'google',FIREBASE_PROJECT_ID:owner.project_id,FIREBASE_OWNER_UID:owner.owner_uid}};
}

function validateDeployment(d,name) {
  if(!d||d.project!==PROJECT||d.location!==LOCATION||d.name!==name||
    typeof d.image!=='string'||!d.image||!Number.isInteger(d.revision)||
    !d.env||typeof d.env!=='object'||Array.isArray(d.env)||
    Object.values(d.env).some(v=>typeof v!=='string')) fail('invalid_deployment_snapshot');
  return d;
}

export function preservedConfiguration(before,after,patch) {
  for(const field of preserved) if(!isDeepStrictEqual(before[field],after[field])) fail('non_google_configuration_changed');
  for(const [key,value] of Object.entries(before.env)) if(!(key in patch)&&after.env[key]!==value) fail('existing_environment_changed');
  for(const [key,value] of Object.entries(patch)) if(after.env[key]!==value) fail('google_environment_not_applied');
}

export async function configure({phase,web,owner,rpc,publicJSON,domainAllowed=async()=>false,sleep=ms=>new Promise(r=>setTimeout(r,ms)),report=()=>{}}) {
  if(!['preflight','configure-web','activate-api'].includes(phase)) fail('invalid_phase');
  const cfg=configuration(web,owner);
  const target=phase==='activate-api'?'notify-alarm-api':'notify-alarm-web';
  const identity={project:PROJECT,location:LOCATION,name:target};
  const get=async()=>validateDeployment(await rpc('deployment.get',identity),target);
  const initial=await get();
  if(phase==='preflight') {
    report({phase,target,revision:initial.revision,environment_count:Object.keys(initial.env).length});
    return;
  }
  if(phase==='activate-api') {
    const setup=await publicJSON(WEB+'/api/auth/google-setup');
    if(!isDeepStrictEqual(setup.firebase,web)) fail('web_google_configuration_not_ready');
    if(!await domainAllowed(web.apiKey)) fail('firebase_web_domain_not_authorized');
    if(initial.env.AUTH_MODE==='google'&&
      (initial.env.FIREBASE_OWNER_UID!==owner.owner_uid||initial.env.FIREBASE_PROJECT_ID!==FIREBASE_PROJECT)) fail('existing_google_identity_mismatch');
  }
  const patch=phase==='activate-api'?cfg.api:cfg.web;
  const keys=phase==='activate-api'?API_KEYS:WEB_KEYS;
  if(Object.keys(patch).sort().join(',')!==[...keys].sort().join(',')) fail('unexpected_patch_keys');
  const already=Object.entries(patch).every(([key,value])=>initial.env[key]===value);
  if(!already) {
    const fresh=await get();
    if(fresh.revision!==initial.revision||!isDeepStrictEqual(fresh.env,initial.env)||
      preserved.some(k=>!isDeepStrictEqual(fresh[k],initial[k]))) fail('deployment_changed_before_update');
    // Official v1.0.5 DTO: DeployNewRevisionRequest.addEnv. Never send env,
    // removeEnv, existing secrets, mountData, resources, port or a new image.
    // A failed mutation is outcome-unknown and must NOT be retried automatically.
    await rpc('deployment.deploy',{...identity,image:initial.image,addEnv:patch});
    let confirmed=false;
    for(let i=0;i<12;i++) {
      const current=await get();
      for(const field of preserved) if(!isDeepStrictEqual(initial[field],current[field])) fail('non_google_configuration_changed');
      for(const [key,value] of Object.entries(initial.env)) if(!(key in patch)&&current.env[key]!==value) fail('existing_environment_changed');
      if(current.revision>initial.revision&&Object.entries(patch).every(([key,value])=>current.env[key]===value)) {
        preservedConfiguration(initial,current,patch);confirmed=true;break;
      }
      if(i<11) await sleep(30000);
    }
    if(!confirmed) fail('runtime_update_confirmation_timeout');
  }
  const endpoint=phase==='activate-api'?API+'/v1/client/auth-config':WEB+'/api/auth/google-setup';
  let ready=false;
  for(let i=0;i<12;i++) {
    try {
      const body=await publicJSON(endpoint);
      ready=phase==='activate-api'?
        body.mode==='google'&&body.firebase_project_id===FIREBASE_PROJECT:
        isDeepStrictEqual(body.firebase,web);
    } catch {ready=false;}
    if(ready) break;
    if(i<11) await sleep(30000);
  }
  if(!ready) fail('public_google_configuration_not_ready');
  report({phase,target,changed:!already,updated_keys:keys,preserved_existing_configuration:true,public_configuration_verified:true});
}

/** The same read-only public project-config endpoint used by Firebase JS SDK. */
export async function authorizedWebDomain(apiKey,fetcher=fetch) {
  if(typeof apiKey!=='string'||!/^AIza[A-Za-z0-9_-]{20,100}$/.test(apiKey)) fail('invalid_public_firebase_key');
  const url=new URL('https://identitytoolkit.googleapis.com/v1/projects');
  url.searchParams.set('key',apiKey);
  try {
    const r=await fetcher(url,{redirect:'manual',headers:{Origin:WEB,Referer:WEB+'/'},signal:AbortSignal.timeout(15000)});
    if(!r.ok) fail('firebase_project_configuration_unavailable');
    const text=await r.text();if(text.length>65536) fail('firebase_project_configuration_unavailable');
    const data=JSON.parse(text);
    if(!Array.isArray(data.authorizedDomains)||data.authorizedDomains.some(d=>typeof d!=='string')) fail('firebase_project_configuration_unavailable');
    return data.authorizedDomains.includes(new URL(WEB).hostname);
  } catch {fail('firebase_project_configuration_unavailable');}
}

export function network({fetcher=fetch,email,key}) {
  if(typeof email!=='string'||!email||typeof key!=='string'||!key) fail('missing_ci_identity');
  const authorization='Basic '+Buffer.from(email+':'+key).toString('base64');
  const read=async(response)=>{
    if(!response.ok) fail('remote_request_failed');
    let size=0;const chunks=[];
    for await(const chunk of response.body) {
      size+=chunk.length;if(size>2*1024*1024) fail('remote_response_too_large');chunks.push(chunk);
    }
    try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {fail('invalid_remote_json');}
  };
  return {
    rpc:async(method,body)=>{
      if(!['deployment.get','deployment.deploy'].includes(method)||body.project!==PROJECT||body.location!==LOCATION||
        !['notify-alarm-api','notify-alarm-web'].includes(body.name)) fail('unapproved_management_target');
      let response;
      try {response=await fetcher('https://api.nortezh.com/user/'+method,{method:'POST',redirect:'manual',
        headers:{Authorization:authorization,'Content-Type':'application/json','User-Agent':'nortezh-action'},
        body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});} catch {fail(method==='deployment.deploy'?'mutation_outcome_unknown_no_retry':'management_request_failed');}
      const value=await read(response);
      if(value?.ok!==true) fail('nortezh_request_rejected');
      return value.result;
    },
    publicJSON:async(url)=>{
      if(![API+'/v1/client/auth-config',WEB+'/api/auth/google-setup'].includes(url)) fail('unapproved_public_target');
      let response;
      try {response=await fetcher(url,{redirect:'manual',headers:{'User-Agent':'NotifyAlarm-google-runtime-check'},signal:AbortSignal.timeout(15000)});} catch {fail('public_configuration_request_failed');}
      return read(response);
    },
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  // Do not print provider error objects: they may contain credentials or env.
  try {
    if(process.env.GITHUB_REF!=='refs/heads/main') fail('main_only');
    const decode=name=>{
      try {return JSON.parse(Buffer.from(process.env[name]??'','base64').toString('utf8'));}
      catch {fail('missing_or_invalid_google_config_secret');}
    };
    const client=network({email:process.env.SA_AUTH_EMAIL,key:process.env.SA_AUTH_KEY});
    await configure({phase:process.argv[2],web:decode('NOTIFY_FIREBASE_WEB_CONFIG_B64'),
      owner:decode('NOTIFY_FIREBASE_OWNER_CONFIG_B64'),...client,
      domainAllowed:key=>authorizedWebDomain(key),
      report:value=>console.log(JSON.stringify(value))});
  } catch(error) {
    const allowed=/^[a-z_]{1,100}$/;
    console.error(allowed.test(error?.message??'')?error.message:'google_runtime_operation_failed');
    process.exitCode=1;
  }
}
