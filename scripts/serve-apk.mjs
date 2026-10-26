import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const apkName = 'notify-alarm-0.6.0-safety-debug.apk';
const defaultApk = fileURLToPath(new URL(`../artifacts/${apkName}`, import.meta.url));

/** Serve an immutable APK snapshot only, never arbitrary filesystem paths. */
export async function createDownloadServer({ apkPath = defaultApk, token = randomBytes(18).toString('hex') } = {}) {
  if (!/^[a-f0-9]{36}$/.test(token)) throw new Error('invalid_download_token');
  const info = await stat(apkPath);
  if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error('invalid_apk_file');
  const apk = await readFile(apkPath);
  if (apk.length > 64 * 1024 * 1024) throw new Error('apk_too_large');
  const sha256 = createHash('sha256').update(apk).digest('hex');
  const base = `/${token}`;
  const downloadPath = `${base}/${apkName}`;
  const page = Buffer.from(`<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Notify Alarm APK</title><body style="font-family:system-ui;max-width:40rem;margin:2rem auto;padding:1rem"><h1>Notify Alarm APK</h1><p>ไฟล์ทดสอบ Android — ต้องอยู่ Wi-Fi/เครือข่ายเดียวกับคอมพิวเตอร์</p><p><a href="${downloadPath}">ดาวน์โหลด APK (${(apk.length / 1024 / 1024).toFixed(2)} MiB)</a></p><p>ติดตั้งอัปเดตทับแอปเดิม ไม่ต้องถอนการติดตั้ง</p><p>SHA-256: <code style="word-break:break-all">${sha256}</code></p><p>HTTP ชั่วคราวสำหรับ LAN ที่ไว้ใจเท่านั้น ห้ามเปิด port ออกอินเทอร์เน็ต</p></body></html>`);
  const server = http.createServer({ maxHeaderSize: 8192 }, (request, response) => {
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer' };
    const valid = (request.method === 'GET' || request.method === 'HEAD') &&
      (request.url === base || request.url === `${base}/` || request.url === downloadPath);
    if (!valid) { request.resume(); response.writeHead(404, headers); response.end(); return; }
    const isApk = request.url === downloadPath;
    const body = isApk ? apk : page;
    response.writeHead(200, { ...headers, 'content-type': isApk ? 'application/vnd.android.package-archive' : 'text/html; charset=utf-8',
      'content-length': body.length, ...(isApk ? { 'content-disposition': `attachment; filename="${apkName}"` } : {}) });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;
  server.timeout = 15_000;
  server.maxConnections = 10;
  return { server, path: base, sha256 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.APK_PORT ?? 8788);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid_port');
  const { server, path, sha256 } = await createDownloadServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', done); });
  console.log('Temporary APK-only LAN server (expires in 2 hours). No firewall/router settings were changed.');
  console.log(`SHA-256: ${sha256}`);
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) console.log(`${name}: http://${address.address}:${port}${path}/`);
    }
  }
  console.log(`Local: http://127.0.0.1:${port}${path}/`);
  const close = () => { server.close(); server.closeAllConnections(); };
  const timeout = setTimeout(close, 2 * 60 * 60 * 1000);
  timeout.unref();
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
