export const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
export function publicConfig(value = process.env.DASHBOARD_PUBLIC_URL) {
  if (!value) throw Error('server_configuration');
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback.has(url.hostname)))) throw Error('server_configuration');
  const secure = url.protocol === 'https:';
  return { origin: url.origin, host: url.host, secure, cookie: secure ? '__Host-notify_session' : 'notify_session_local' };
}
export function trustedRequest(request: Request, mutation = false): boolean {
  const config = publicConfig();
  if (request.headers.get('host') !== config.host) return false;
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== config.origin) return false;
  return !mutation || (origin === config.origin && request.headers.get('x-notify-request') === 'dashboard' && request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json');
}
export function sessionToken(cookie: string | null): string | undefined {
  const name = publicConfig().cookie;
  const matches = (cookie ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${name}=`));
  if (matches.length !== 1) return;
  const token = matches[0].slice(name.length + 1);
  return tokenPattern.test(token) ? token : undefined;
}
export function authDTO(value: unknown) {
  const data = value as { user?: { username?: unknown; must_change_password?: unknown }; expires_at?: unknown };
  if (!data || typeof data.user?.username !== 'string' || data.user.username.length > 128 || typeof data.user.must_change_password !== 'boolean' || typeof data.expires_at !== 'string' || !Number.isFinite(Date.parse(data.expires_at))) throw Error('invalid_response');
  return { user: { username: data.user.username, must_change_password: data.user.must_change_password }, expires_at: data.expires_at };
}
export function backendURL(path: string) {
  try {
  if (!/^\/v1\/dashboard\/(?:login|session|change-password|logout|history|stats|alerts(?:\/[A-Za-z0-9_-]{1,100})?)$/.test(path)) throw Error('server_configuration');
  const base = new URL(process.env.BACKEND_URL ?? 'http://127.0.0.1:8791');
  const allow = (process.env.BACKEND_ALLOWED_HTTP_ORIGINS ?? '').split(',').filter(Boolean).map(v => {
    const u = new URL(v.trim());
    if (u.protocol !== 'http:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash || u.hostname.includes('*')) throw Error('server_configuration');
    return u.origin;
  });
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' || !['http:', 'https:'].includes(base.protocol) || (base.protocol === 'http:' && !loopback.has(base.hostname) && !allow.includes(base.origin))) throw Error('server_configuration');
  return new URL(path, base);
  } catch {throw Error('server_configuration');}
}
export function alertBody(value: unknown) {
  const v = value as Record<string, unknown>;
  if (!v || Array.isArray(v) || typeof v !== 'object' || Object.keys(v).some(k => !['alert_id','title','message','ttl_seconds','importance'].includes(k)) || typeof v.alert_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(v.alert_id) || typeof v.title !== 'string' || !v.title.trim() || [...v.title].length > 120 || typeof v.message !== 'string' || !v.message.trim() || [...v.message].length > 2000 || !Number.isInteger(v.ttl_seconds) || (v.ttl_seconds as number) < 30 || (v.ttl_seconds as number) > 10800 || !['normal','critical'].includes(v.importance as string)) throw Error('invalid_schema');
  return { alert_id: v.alert_id, title: v.title, message: v.message, ttl_seconds: v.ttl_seconds, importance: v.importance };
}
export async function boundedJSON(request:Request,max:number):Promise<unknown>{
  const reader=request.body?.getReader();if(!reader)throw Error('invalid_schema');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const result=await reader.read();if(result.done)break;size+=result.value.byteLength;if(size>max){await reader.cancel();throw Error('invalid_schema');}chunks.push(result.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
