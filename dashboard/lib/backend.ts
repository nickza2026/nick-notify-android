import 'server-only';
import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { parseHistory, parseStats, parseDetail } from './protocol';

const failure = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
export const invalidQuery = () => failure('พารามิเตอร์ไม่ถูกต้อง', 400);
export const invalidOrigin = () => failure('แดชบอร์ดนี้เปิดให้ใช้เฉพาะ localhost', 403);

export async function upstream(path: '/v1/history' | '/v1/stats' | `/v1/alerts/${string}`, query?: URLSearchParams): Promise<Response> {
  const base = process.env.BACKEND_URL ?? 'http://127.0.0.1:8791';
  let url: URL;
  try {
    const parsed = new URL(base);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw Error('Invalid backend URL');
    if (parsed.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw Error('HTTP only permitted on loopback');
    url = new URL(`${parsed.toString().replace(/\/$/, '')}${path}`);
    if (query) url.search = query.toString();
  } catch {
    return failure('ตั้งค่าเซิร์ฟเวอร์ไม่ถูกต้อง', 503);
  }
  let key: string | undefined;
  try {
    key = process.env.BACKEND_API_KEY_FILE ? (await readFile(process.env.BACKEND_API_KEY_FILE, 'utf8')).trim() : process.env.BACKEND_API_KEY;
  } catch {
    return failure('ไม่สามารถอ่านกุญแจ API ของเซิร์ฟเวอร์', 503);
  }
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(10000),
    });
    if (response.status >= 300 && response.status < 400) return failure('เซิร์ฟเวอร์ส่งต่อคำขอโดยไม่คาดคิด', 502);
    if (response.status === 401 || response.status === 403) return failure('ไม่มีสิทธิ์ดูประวัติ', 401);
    if (!response.ok) return failure('ไม่สามารถดึงข้อมูลจากเซิร์ฟเวอร์', 502);
    const reader = response.body?.getReader();
    if (!reader) return failure('รูปแบบข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง', 502);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > 1_048_576) { await reader.cancel(); throw Error('response_too_large'); }
        chunks.push(result.value);
      }
    } finally { reader.releaseLock(); }
    const raw: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    // Project an explicit safe DTO instead of forwarding unexpected backend fields to the browser.
    let json: unknown;
    try {
      json = path === '/v1/history' ? parseHistory(raw) : path === '/v1/stats' ? parseStats(raw)
        : parseDetail(raw, decodeURIComponent(path.slice('/v1/alerts/'.length)));
    } catch { return failure('รูปแบบข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง', 502); }
    return NextResponse.json(json, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return failure('เชื่อมต่อเซิร์ฟเวอร์ประวัติไม่ได้', 502);
  }
}
