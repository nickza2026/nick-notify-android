export type FirebaseWebConfig = {apiKey:string; authDomain:string; projectId:string; appId:string};
export type BackendAuthConfig = {mode:'password'|'google'; firebase_project_id:string|null};
export type PublicAuthConfig = BackendAuthConfig & {firebase:FirebaseWebConfig|null};

function record(value:unknown):Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_response');
  return value as Record<string,unknown>;
}
export function backendAuthConfig(value:unknown):BackendAuthConfig {
  const v=record(value);
  if (Object.keys(v).length!==2 || Object.keys(v).some(k=>!['mode','firebase_project_id'].includes(k))) throw Error('invalid_response');
  if (v.mode==='password' && v.firebase_project_id===null) return {mode:'password',firebase_project_id:null};
  if (v.mode==='google' && typeof v.firebase_project_id==='string' && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(v.firebase_project_id)) return {mode:'google',firebase_project_id:v.firebase_project_id};
  throw Error('invalid_response');
}
export function firebaseWebConfig(value:unknown):FirebaseWebConfig {
  const v=record(value);
  if (Object.keys(v).length!==4 || Object.keys(v).some(k=>!['apiKey','authDomain','projectId','appId'].includes(k)) ||
      ['apiKey','authDomain','projectId','appId'].some(k=>typeof v[k]!=='string' || !(v[k] as string).length || (v[k] as string).length>256 || /[\s\x00-\x1f\x7f]/.test(v[k] as string))) throw Error('server_configuration');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(v.projectId as string)) throw Error('server_configuration');
  const domain=v.authDomain as string;
  if (domain.length>253 || !/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(domain)) throw Error('server_configuration');
  return {apiKey:v.apiKey as string,authDomain:domain,projectId:v.projectId as string,appId:v.appId as string};
}
export function publicAuthConfig(value:unknown):PublicAuthConfig {
  const v=record(value);
  if (Object.keys(v).length!==3 || !Object.hasOwn(v,'firebase')) throw Error('invalid_response');
  const base=backendAuthConfig({mode:v.mode,firebase_project_id:v.firebase_project_id});
  if (base.mode==='password') {
    if (v.firebase!==null) throw Error('invalid_response');
    return {...base,firebase:null};
  }
  const firebase=firebaseWebConfig(v.firebase);
  if (firebase.projectId!==base.firebase_project_id) throw Error('server_configuration');
  return {...base,firebase};
}
export function googleLoginBody(value:unknown):{id_token:string} {
  const v=record(value);
  if (Object.keys(v).length!==1 || typeof v.id_token!=='string' || v.id_token.length>8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v.id_token)) throw Error('invalid_schema');
  return {id_token:v.id_token};
}
