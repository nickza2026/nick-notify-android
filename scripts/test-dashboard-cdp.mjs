// Read-only UI smoke against the explicit synthetic Go/PostgreSQL demo, not real FCM.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const port = Number(process.env.DASHBOARD_CDP_PORT ?? 9223);
const origin = process.env.DASHBOARD_ORIGIN ?? 'http://127.0.0.1:3010';
const apiOrigin = process.env.DASHBOARD_API_ORIGIN ?? 'http://127.0.0.1:8791';
for (const value of [origin, apiOrigin]) {
  const url = new URL(value);
  assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.origin === value,
    'UI smoke only targets exact loopback origins');
}
const out = resolve('artifacts');
await mkdir(out, { recursive: true });
const apiDeadline = Date.now() + 45000;
let apiReady = false;
while (Date.now() < apiDeadline) {
  try {
    const response = await fetch(`${apiOrigin}/health`, { signal: AbortSignal.timeout(1000) });
    const health = await response.json();
    if (response.ok && health.status === 'configuration_only') { apiReady = true; break; }
  } catch { /* Local server may still be initializing its owned embedded database. */ }
  await new Promise(done => setTimeout(done, 500));
}
assert.ok(apiReady, 'Synthetic local Go API did not become available');
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(t => t.type === 'page' && (t.url === 'about:blank' || t.url.startsWith(origin)));
assert.ok(target, 'Dedicated test page missing');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((done, reject) => { ws.onopen = done; ws.onerror = reject; });
let serial = 0;
const pending = new Map();
const runtimeErrors = [];
ws.onmessage = event => {
  const message = JSON.parse(String(event.data));
  if (!message.id) {
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push('Uncaught browser exception');
    return;
  }
  const item = pending.get(message.id);
  if (!item) return;
  pending.delete(message.id);
  clearTimeout(item.timer);
  message.error ? item.reject(Error(`CDP ${item.method} failed (${message.error.code}): ${message.error.message}`)) : item.done(message.result);
};
ws.onclose = () => {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('CDP disconnected')); }
  pending.clear();
};
function send(method, params = {}) {
  return new Promise((done, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { done, reject, timer, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.ok(!result.exceptionDetails, 'Browser expression failed');
  return result.result.value;
}
async function waitFor(expression, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise(done => setTimeout(done, 150));
  }
  throw Error('Expected rendered state did not appear');
}
async function click(expression) {
  const point = await evaluate(`(() => {
    const el = ${expression}; if (!el) return null;
    el.scrollIntoView({block:'center',inline:'center'});
    const r = el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  assert.ok(point, 'Accessible target missing');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
}
const button = text => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
async function setDates(from, to) {
  for (const [index, value] of [[0, from], [1, to]]) {
    // Separate browser tasks let React commit each controlled input before the next one.
    await evaluate(`(() => {
      const el=document.querySelectorAll('input[type="date"]')[${index}];
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
  }
  await click(button('ใช้ตัวกรอง'));
}
async function shot(name) {
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(resolve(out, name), Buffer.from(image.data, 'base64'));
}

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: origin });
  await waitFor(`document.querySelector('.demo-banner')?.textContent.includes('ไม่ใช่ประวัติการส่งจริง')`);
  const dates = await evaluate(`(() => {
    const f=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'});
    return {from:f.format(Date.now()-86400000),to:f.format(Date.now())};
  })()`);
  // Fixtures can cross Bangkok midnight; use a visible, explicit two-day filter, not fake dates.
  await setDates(dates.from, dates.to);
  await waitFor(`document.querySelectorAll('tbody tr').length===6 && document.querySelectorAll('.error').length===0`);
  const snapshot = await evaluate(`JSON.stringify({
    total:[...document.querySelectorAll('.summary-card')][0]?.querySelector('.metric')?.textContent.trim(),
    actions:[...document.querySelectorAll('.summary-card')].at(-1)?.querySelector('.metric')?.textContent.trim(),
    rowActions:[...document.querySelectorAll('td[data-label="จำนวนแตะ"]')].map(e=>Number(e.textContent)),
    noOverflow:document.documentElement.scrollWidth<=innerWidth,
    mutations:[...document.querySelectorAll('button')].some(b=>/ส่งแจ้งเตือน|รับทราบทั้งหมด/.test(b.textContent))
  })`);
  const values = JSON.parse(snapshot);
  assert.equal(values.total, '6'); assert.equal(values.actions, '2');
  assert.equal(values.rowActions.reduce((a, b) => a + b, 0), 3, 'Batched actions must not be summed as global taps');
  assert.ok(values.noOverflow); assert.equal(values.mutations, false);
  assert.ok(await evaluate(`document.querySelector('tbody [data-importance="normal"]')?.textContent.includes('ธรรมดา')`), 'Normal importance must have a silent text badge');
  assert.ok(await evaluate(`document.querySelector('tbody [data-importance="critical"]')?.textContent.includes('วิกฤต')`), 'Critical importance must remain distinct');
  await shot('dashboard-desktop.png');

  await click(`[...document.querySelectorAll('tbody tr')].find(r=>r.querySelector('td[data-label="จำนวนแตะ"]')?.textContent.trim()==='2')?.querySelector('button')`);
  await waitFor(`document.querySelector('dialog[open]') && document.querySelectorAll('.timeline li').length===2`);
  await shot('dashboard-detail.png');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(`!document.querySelector('dialog[open]')`);
  assert.ok(await evaluate(`document.activeElement?.textContent.includes('ดูรายละเอียด')`), 'Dialog must restore focus');

  await click(`[...document.querySelectorAll('tbody tr')].find(r=>r.querySelector('[data-importance="normal"]'))?.querySelector('button')`);
  await waitFor(`document.querySelector('dialog[open] .detail-body [data-importance="normal"]')`);
  await shot('dashboard-normal-detail.png');
  await click(`document.querySelector('button[aria-label="ปิดรายละเอียด"]')`);
  await waitFor(`!document.querySelector('dialog[open]')`);

  await evaluate(`(() => {
    const el=document.querySelector('select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'acknowledged');
    el.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await click(button('ใช้ตัวกรอง'));
  await waitFor(`document.querySelectorAll('tbody tr').length===2 && document.querySelectorAll('.error').length===0`);
  assert.equal(await evaluate(`document.querySelector('.summary-card .metric').textContent.trim()`), '6', 'Status filter must not relabel date-range totals');
  await click(button('ล้างตัวกรอง'));
  await waitFor(`document.querySelector('select')?.value==='all'`);
  await setDates(dates.from, dates.to);
  await waitFor(`document.querySelectorAll('tbody tr').length===6`);

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate('scrollTo(0,0)');
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Mobile page overflows horizontally');
  assert.ok(await evaluate(`Boolean(document.querySelector('tbody [data-importance="normal"]') && document.querySelector('tbody [data-importance="critical"]'))`), 'Mobile cards must retain both importance levels');
  await shot('dashboard-mobile.png');
  await click(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('ดูรายละเอียด'))`);
  await waitFor(`document.querySelector('dialog[open]') && document.querySelector('.detail-body')`);
  assert.ok(await evaluate(`document.querySelector('dialog').getBoundingClientRect().width<=innerWidth`));
  await shot('dashboard-mobile-detail.png');
  await click(`document.querySelector('button[aria-label="ปิดรายละเอียด"]')`);
  await waitFor(`!document.querySelector('dialog[open]')`);

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Network.setBlockedURLs', { urls: [`${origin}/api/history*`, `${origin}/api/stats*`] });
  await click(button('รีเฟรชข้อมูล'));
  await waitFor(`document.querySelectorAll('.error').length>=2`);
  assert.equal(await evaluate(`document.querySelectorAll('tbody tr').length`), 6, 'Failed refresh must preserve stale rows, not fake empty/success');
  await evaluate('scrollTo(0,0)'); await shot('dashboard-network-error.png');
  await send('Network.setBlockedURLs', { urls: [] });
  await click(button('รีเฟรชข้อมูล'));
  await waitFor(`document.querySelectorAll('.error').length===0 && document.querySelectorAll('tbody tr').length===6`);
  assert.equal(runtimeErrors.length, 0, 'Unexpected browser JavaScript exception');
  await writeFile(resolve(out, 'dashboard-ui-report.json'), JSON.stringify({
    passed: true, source: 'synthetic Go API + actual embedded PostgreSQL + Next BFF', apiOrigin, dashboardOrigin: origin,
    desktop: '1440x1000', responsive: '390x844', alerts: 6, reportedActions: 2, perAlertActionSum: 3,
    checks: ['live API render', 'provider vs acknowledgement', 'batched retry-safe count', 'drawer and Escape focus return',
      'normal silent and critical importance badges/details', 'server-side status filter', 'responsive no horizontal overflow', 'simulated browser network failure preserves stale data', 'refresh recovery'],
    limitations: ['synthetic data only', 'no real Pixel HTTPS Ack tested', 'screenshot/DOM smoke is not human visual acceptance']
  }, null, 2));
  console.log('PASS dashboard live local UI, 6 alerts/2 distinct reported taps, filters, details/focus, mobile viewport, simulated network error/recovery');
} finally { ws.close(); }
