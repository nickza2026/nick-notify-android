export class ClientError extends Error {constructor(message:string,public code:string){super(message);}}
export async function clientJSON<T>(url:string, body?:unknown, headers?:HeadersInit, signal?:AbortSignal):Promise<T> {
  const response=await fetch(url,{method:body===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',signal,headers:{...(body===undefined?{}:{'Content-Type':'application/json','X-Notify-Request':'dashboard'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok){
    if(data.code==='session_required'){window.location.assign('/login');}
    if(data.code==='password_change_required'){window.location.assign('/change-password');}
    throw new ClientError(typeof data.error==='string'?data.error:'ไม่สามารถโหลดข้อมูลได้',data.code);
  }
  return data as T;
}
