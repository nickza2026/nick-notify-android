import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authDTO, publicConfig, sessionToken } from './security';
import { callBackend } from './backend';
export async function requirePageSession(temporary = false) {
  const h=await headers();
  const config=publicConfig();
  if(h.get('host')!==config.host || (h.get('origin')!==null && h.get('origin')!==config.origin))throw Error('ไม่อนุญาตต้นทางคำขอ');
  const token=sessionToken(h.get('cookie'));if(!token)redirect('/login');
  const result=await callBackend('/v1/dashboard/session',token);
  if(result.status===401 && (result.data as {error?:{code?:string}})?.error?.code==='session_required')redirect('/login');
  if(result.status!==200)throw Error('ระบบยืนยันตัวตนไม่พร้อมใช้งาน');
  const session=authDTO(result.data);
  if(session.user.must_change_password&&!temporary)redirect('/change-password');
  return session;
}
