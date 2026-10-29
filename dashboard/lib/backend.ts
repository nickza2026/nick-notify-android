import 'server-only';
import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { parseHistory, parseStats, parseDetail, validUtc } from './protocol';
import { authDTO, backendURL, boundedJSON, publicConfig, sessionToken, tokenPattern, trustedRequest } from './security';

const messages: Record<string,string> = { session_required:'กรุณาเข้าสู่ระบบ', password_change_required:'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน', invalid_credentials:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', invalid_schema:'ข้อมูลคำขอไม่ถูกต้อง', invalid_password:'รหัสผ่านต้องมีอย่างน้อย 15 ตัวอักษร และไม่เกิน 128 ไบต์', password_unchanged:'รหัสผ่านใหม่ต้องต่างจากเดิม', rate_limited:'คำขอมากเกินไป กรุณารอแล้วลองใหม่', dashboard_not_configured:'ระบบยังไม่พร้อมใช้งาน', temporarily_unavailable:'ระบบไม่พร้อมใช้งานชั่วคราว', server_configuration:'การตั้งค่าเซิร์ฟเวอร์ไม่ถูกต้อง', invalid_origin:'ไม่อนุญาตคำขอจากต้นทางนี้', upstream_error:'ไม่สามารถยืนยันผลจากเซิร์ฟเวอร์ได้ โปรดตรวจสอบประวัติก่อนส่งอีกครั้ง' };
Object.assign(messages, { invalid_message:'หัวข้อหรือข้อความไม่ถูกต้อง',invalid_alert_id:'รหัสเหตุการณ์ไม่ถูกต้อง',invalid_ttl:'TTL ไม่ถูกต้อง',invalid_importance:'ระดับแจ้งเตือนไม่ถูกต้อง',payload_too_large:'ข้อความมีขนาดไบต์เกินกำหนด',idempotency_key_required:'ต้องระบุรหัสคำขอ',idempotency_conflict:'รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว',alert_id_conflict:'รหัสเหตุการณ์ถูกใช้แล้ว',not_found:'ไม่พบเหตุการณ์',provider_delivery_unknown:'ไม่ทราบผลส่ง โปรดตรวจสอบประวัติ',delivery_state_unavailable:'ไม่สามารถยืนยันผลบันทึกการส่งได้ โปรดตรวจสอบประวัติ',expired_before_send:'หมดช่วงเวลาเริ่มแจ้งเตือนก่อนส่ง',provider_unavailable:'ผู้ให้บริการไม่พร้อมใช้งาน',provider_rejected:'ผู้ให้บริการปฏิเสธคำขอ' });
Object.assign(messages,{fcm_not_configured:'ระบบส่งแจ้งเตือนยังไม่พร้อม',database_unavailable:'ระบบข้อมูลไม่พร้อมชั่วคราว',delivery_unknown_or_in_progress:'ยังไม่ทราบผลหรือคำขอกำลังดำเนินการ โปรดตรวจประวัติ',json_required:'ต้องใช้ข้อมูล JSON',body_too_large:'คำขอมีขนาดเกินกำหนด',request_interrupted:'คำขอถูกขัดจังหวะ',invalid_from:'วันเริ่มไม่ถูกต้อง',invalid_to:'วันสิ้นสุดไม่ถูกต้อง',invalid_range:'ช่วงเวลาไม่ถูกต้อง',invalid_status:'สถานะไม่ถูกต้อง',invalid_limit:'จำนวนรายการไม่ถูกต้อง',invalid_cursor:'ตำแหน่งหน้าถัดไปไม่ถูกต้อง'});
messages.provider_authentication_failed='ระบบผู้ให้บริการไม่สามารถยืนยันตัวตนได้';
export function failure(code: string, status: number) { return NextResponse.json({ error: messages[code] ?? messages.upstream_error, code }, { status, headers: {'Cache-Control':'no-store'} }); }
export const invalidQuery = () => failure('invalid_schema',400);
export const invalidOrigin = () => failure('invalid_origin',403);
export function guard(request: Request, mutation = false): Response | null {
  try { return trustedRequest(request,mutation) ? null : invalidOrigin(); } catch { return failure('server_configuration',503); }
}
export function cookie(response: NextResponse, token?: string, expiry?: string) {
  const config = publicConfig();
  response.cookies.set(config.cookie, token ?? '', { httpOnly:true, secure:config.secure, sameSite:'lax', path:'/', maxAge: token && expiry ? Math.max(0,Math.min(86400,Math.floor((Date.parse(expiry)-Date.now())/1000))) : 0 });
  return response;
}
export async function callBackend(path: string, token?: string, body?: unknown, idempotency?: string, method = body === undefined ? 'GET' : 'POST', query?:URLSearchParams): Promise<{data:unknown; status:number; retry:string|null}> {
  const url = backendURL(path); if(query)url.search=query.toString();
  let key:string|undefined;
  try {key = process.env.BACKEND_API_KEY_FILE ? (await readFile(process.env.BACKEND_API_KEY_FILE,'utf8')).trim() : process.env.BACKEND_API_KEY;} catch {throw Error('server_configuration');}
  if (!key || /[\r\n]/.test(key)) throw Error('server_configuration');
  const response = await fetch(url,{method,headers:{Accept:'application/json',Authorization:`Bearer ${key}`,...(token ? {'X-Dashboard-Session':token}:{}),...(body !== undefined ? {'Content-Type':'application/json'}:{}),...(idempotency ? {'Idempotency-Key':idempotency}:{})},body:body === undefined ? undefined : JSON.stringify(body),cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(10000)});
  const reader = response.body?.getReader(); if (!reader) throw Error('upstream_error');
  const chunks: Uint8Array[]=[]; let size=0;
  try { while(true) { const r=await reader.read(); if(r.done) break; size+=r.value.length; if(size>1048576){await reader.cancel();throw Error('upstream_error');} chunks.push(r.value); } } finally {reader.releaseLock();}
  return {data:JSON.parse(Buffer.concat(chunks).toString('utf8')),status:response.status,retry:response.headers.get('retry-after')};
}
function backendError(result: {data:unknown;status:number;retry:string|null}) {
  const code=(result.data as {error?:{code?:string}})?.error?.code;
  const known = code && Object.hasOwn(messages,code) && !['server_configuration','invalid_origin','upstream_error'].includes(code);
  const response=failure(code === 'unauthorized' ? 'server_configuration' : known ? code : 'upstream_error',code === 'unauthorized' ? 503 : known ? result.status : 502);
  if(result.status===401 && code !== 'unauthorized') cookie(response);
  if(result.status===429 && result.retry && /^\d{1,6}$/.test(result.retry)) response.headers.set('Retry-After',result.retry);
  return response;
}
export async function authRoute(request: Request, action: 'login'|'session'|'change-password'|'logout') {
  const rejected=guard(request,action!=='session'); if(rejected)return rejected;
  try {
    const token=sessionToken(request.headers.get('cookie'));
    let body: unknown;
    if(action==='login'||action==='change-password') {
      if(Number(request.headers.get('content-length')??0)>4096) return invalidQuery();
      try { body=await boundedJSON(request,4096); } catch {return invalidQuery();}
      const v=body as Record<string,unknown>; const keys=action==='login'?['username','password']:['current_password','new_password'];
      if(!v || typeof v!=='object' || Array.isArray(v) || Object.keys(v).length!==2 || keys.some(k=>typeof v[k]!=='string' || (v[k] as string).length>1024) || Object.keys(v).some(k=>!keys.includes(k)))return invalidQuery();
    }
    if(action!=='login'&&action!=='logout'&&!token)return cookie(failure('session_required',401));
    const result=await callBackend(`/v1/dashboard/${action}`,token,body,undefined,action==='session'?'GET':'POST');
    if(result.status!==200){const response=backendError(result);return action==='logout'?cookie(response):response;}
    if(action==='logout')return cookie(NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}}));
    const dto=authDTO(result.data); const response=NextResponse.json(dto,{headers:{'Cache-Control':'no-store'}});
    if(action!=='session') {const newToken=(result.data as {session_token?:string}).session_token;if(!newToken || !tokenPattern.test(newToken))throw Error('upstream_error');cookie(response,newToken,dto.expires_at);}
    return response;
  } catch(e) {const response=failure(e instanceof Error && e.message==='server_configuration'?'server_configuration':'upstream_error',e instanceof Error && e.message==='server_configuration'?503:502);return action==='logout'?cookie(response):response;}
}
export async function upstream(request: Request,path: '/v1/dashboard/history'|'/v1/dashboard/stats'|`/v1/dashboard/alerts/${string}`|'/v1/dashboard/alerts',query?:URLSearchParams,body?:unknown,idempotency?:string) {
  const rejected=guard(request,body!==undefined);if(rejected)return rejected;
  try {
    const token=sessionToken(request.headers.get('cookie')); if(!token)return cookie(failure('session_required',401));
    const result=await callBackend(path,token,body,idempotency,body===undefined?'GET':'POST',query);
    if(result.status<200||result.status>=300)return backendError(result);
    const data=path.endsWith('/history')?parseHistory(result.data):path.endsWith('/stats')?parseStats(result.data):body!==undefined?projectReceipt(result.data,body):parseDetail(result.data,decodeURIComponent(path.split('/').at(-1)!));
    return NextResponse.json(data,{status:result.status,headers:{'Cache-Control':'no-store'}});
  } catch(e){return failure(e instanceof Error && e.message==='server_configuration'?'server_configuration':'upstream_error',e instanceof Error && e.message==='server_configuration'?503:502);}
}
function projectReceipt(raw:unknown, expected:unknown) {
  const v=raw as Record<string,unknown>;
  const sent=expected as Record<string,unknown>;
  if(!v || !sent || typeof v.alert_id!=='string' || v.alert_id!==sent.alert_id || v.status!=='provider_accepted' || typeof v.expires_at!=='string' || !validUtc(v.expires_at) || v.acknowledged!==false || v.delivery_verified!==false || !['normal','critical'].includes(v.importance as string) || v.importance!==sent.importance)throw Error('upstream_error');
  return {alert_id:v.alert_id,status:v.status,expires_at:v.expires_at,acknowledged:false,delivery_verified:false,importance:v.importance};
}
