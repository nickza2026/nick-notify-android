// Background-only browser regression: real Go/PostgreSQL, synthetic sender,
// temporary TLS termination and a fresh browser profile. Never reads real secrets.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { cdpClient, freshScreenshot, waitFor } from './dashboard-browser-support.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = mkdtempSync(join(tmpdir(), 'notify-dashboard-browser-'));
const runID = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const evidence = join(repo, 'artifacts', 'dashboard-auth-check', runID);
mkdirSync(evidence, { recursive: true });
const report = { run_id: runID, started_at: new Date().toISOString(), passed: false, synthetic_only: true, real_fcm: false, cases: [], screenshots: [], cleanup: false };
const cleanEnv = { ...process.env };
for (const name of ['DATABASE_URL','TEST_DB_URL','GOOGLE_APPLICATION_CREDENTIALS','FCM_DEVICE_TOKEN','ALERT_API_KEY','BACKEND_API_KEY_FILE','BACKEND_API_KEY','DASHBOARD_BOOTSTRAP_PASSWORD','NODE_OPTIONS']) delete cleanEnv[name];
let fixture, web, browser, manifest, cdp, browserCDP;
const children = [];
function owned(exe, args, options = {}) {
  const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore','ignore','ignore'], env: cleanEnv, ...options });
  const ended = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  const item = { child, ended, exited: () => child.exitCode !== null || child.signalCode !== null };
  children.push(item); return item;
}
function localRequest(value, options = {}) {
  const url = new URL(value);
  if (url.hostname !== '127.0.0.1' || !['http:','https:'].includes(url.protocol)) throw Error('Fixture network must remain on loopback');
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    // The self-signed certificate exception is limited to this owned loopback
    // fixture request, never NODE_TLS_REJECT_UNAUTHORIZED or real services.
    const req = send(url, { method: options.method ?? (body ? 'POST' : 'GET'), rejectUnauthorized: false, headers: { ...(body ? { 'Content-Type':'application/json' } : {}), ...options.headers } }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 1048576) req.destroy(Error('Fixture response too large')); else chunks.push(chunk); });
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let data; try { data = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, data, text }); });
    });
    req.setTimeout(15000, () => req.destroy(Error('Fixture request timeout'))); req.on('error', reject);
    if (body) req.write(body); req.end();
  });
}
async function control(path, body = {}) {
  return localRequest(`${manifest.api_url}/__fixture/${path}`, { body, headers: { 'X-Fixture-Control': manifest.control } });
}
async function pageRequest(path, { token, method, body, headers } = {}) {
  return localRequest(new URL(path, manifest.web_url), { method, body, headers: { ...(token ? { Cookie:`__Host-notify_session=${token}` } : {}), ...(body || method === 'POST' ? { Origin:manifest.web_url, 'Content-Type':'application/json','X-Notify-Request':'dashboard' } : {}), ...headers } });
}
const check = name => report.cases.push(name);
const statsPath = '/api/stats?from=2020-01-01T00%3A00%3A00Z&to=2030-01-01T00%3A00%3A00Z';
async function navigate(path) {
  await cdp.send('Page.navigate', { url: new URL(path, manifest.web_url).href });
  await waitFor(async () => (await cdp.evaluate('location.origin')) === manifest.web_url && await cdp.evaluate('document.readyState === "complete"'), `navigation ${path}`);
}
async function screenshot(name, expectedText) {
  const path = join(evidence, `${name}.png`);
  await freshScreenshot(path, async () => {
    assert.ok(await cdp.evaluate(`document.body.innerText.includes(${JSON.stringify(expectedText)})`), `Screenshot semantic state: ${name}`);
    return Buffer.from((await cdp.send('Page.captureScreenshot', { format:'png' })).data, 'base64');
  });
  report.screenshots.push(`${name}.png`);
}
async function checkLayout(width, label, expectedText = 'ประวัติ') {
  const metrics = await cdp.evaluate(`(() => {
    const width=${width};
    const boxes=Array.from(document.querySelectorAll('.console,.site-header,.header-inner,.workspace,.account-controls,.shell,.filter-panel,.summary-grid,.history-section,.table-wrap,.composer-grid,.auth-card')).map(el=>{
      const b=el.getBoundingClientRect();return {element:el.className,left:Math.round(b.left),right:Math.round(b.right),width:Math.round(b.width)};
    });
    const escaped=Array.from(document.querySelectorAll('body *')).map(el=>{const b=el.getBoundingClientRect(),p=el.parentElement,c=getComputedStyle(el);return {element:el.tagName+'.'+el.className,left:Math.round(b.left),right:Math.round(b.right),width:Math.round(b.width),overflow:c.overflowX,min_width:c.minWidth,parent:p?.tagName+'.'+p?.className,parent_overflow:p?getComputedStyle(p).overflowX:null};}).filter(b=>b.width>0&&(b.left < -1 || b.right>width+1)).slice(0,35);
    return {inner_width:innerWidth,visual_width:visualViewport?.width,root_scroll:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,boxes,escaped,overflow:boxes.filter(b=>b.left < -1 || b.right > width+1)};
  })()`);
  (report.layout ??= []).push({ label, expected_width:width, ...metrics });
  if (metrics.root_scroll > width+1 || metrics.overflow.length) {
    await screenshot(`layout-failure-${label}`, expectedText);
    throw Error(`Layout overflow or clipped content at ${label}; see report layout metrics`);
  }
}
async function cookieToken() {
  const result = await cdp.send('Network.getCookies', { urls:[manifest.web_url] });
  const cookie = result.cookies.find(c => c.name === '__Host-notify_session');
  assert.ok(Boolean(cookie), 'HTTPS session cookie exists');
  assert.equal(cookie.httpOnly, true); assert.equal(cookie.secure, true); assert.equal(cookie.sameSite, 'Lax'); assert.equal(cookie.path, '/');
  assert.ok(!(await cdp.evaluate('document.cookie')).includes('notify_session'));
  report.cookie_flags = { name:cookie.name, httpOnly:cookie.httpOnly, secure:cookie.secure, sameSite:cookie.sameSite, path:cookie.path };
  return cookie.value; // Remains in this private test process, never report/log.
}
async function textWait(expression, label) { return waitFor(() => cdp.evaluate(expression), label); }
async function clickButton(text) { await cdp.click(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)})`); }
async function chooseTheme(value) {
  // Native select setup uses the supported setter/change path; form buttons
  // and password/text entry below use native Input events.
  await cdp.evaluate(`(() => { const el=document.querySelector('select[aria-label="รูปแบบสี"]'); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await textWait(`document.documentElement.dataset.theme === ${JSON.stringify(value)}`, `theme ${value}`);
  await textWait('!document.getAnimations().some(a => a instanceof CSSTransition && a.playState === "running")', 'theme transitions settled');
}
async function checkContrast(theme) {
  const values=await cdp.evaluate(`(() => {
    const rgb=value=>value.match(/[\\d.]+/g).slice(0,3).map(Number);
    const lum=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const ratio=(a,b)=>{a=lum(rgb(a));b=lum(rgb(b));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    const body=getComputedStyle(document.body),muted=getComputedStyle(document.querySelector('.page-header p')),button=getComputedStyle(document.querySelector('.primary-button:not(:disabled)')),input=getComputedStyle(document.querySelector('.filter-fields input'));
    return {body_text:ratio(body.color,body.backgroundColor),muted_text:ratio(muted.color,body.backgroundColor),primary_label:ratio(button.color,button.backgroundColor),input_border:ratio(input.borderTopColor,input.backgroundColor)};
  })()`);
  (report.contrast ??= []).push({theme,...values});
  for(const key of ['body_text','muted_text','primary_label'])assert.ok(values[key]>=4.5,`${theme} representative ${key} contrast`);
  assert.ok(values.input_border>=3,`${theme} representative input boundary contrast`);
}
async function checkFieldFamily(scope, label) {
  const fields = await cdp.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(scope)})).filter(el=>el.matches('input:not([type=radio]),select,textarea')).map(el=>{
    const style=getComputedStyle(el),box=el.getBoundingClientRect();
    return {tag:el.tagName,type:el.type,height:box.height,width:box.width,background:style.backgroundColor,border_color:style.borderTopColor,border_width:style.borderTopWidth,border_style:style.borderTopStyle};
  })`);
  assert.ok(fields.length >= 2, `${label}: mounted field family exists`);
  assert.ok(fields.every(field => field.height >= 44 && field.width > 0), `${label}: visible usable field shells`);
  const paint = ({ background, border_color, border_width, border_style }) => ({ background, border_color, border_width, border_style });
  for (const field of fields) assert.deepEqual(paint(field), paint(fields[0]), `${label}: field shell paint is consistent`);
  (report.field_families ??= []).push({ label, fields });
}
async function checkMinimalShell() {
  const shell = await cdp.evaluate(`(() => {
    const nav=document.querySelector('nav[aria-label="เมนูหลัก"]');
    return {sidebar:!!document.querySelector('.sidebar'),header:!!nav?.closest('header'),links:nav?.querySelectorAll('a').length,decorative_tagline:document.body.innerText.includes('OPERATIONS CONSOLE')};
  })()`);
  assert.deepEqual(shell, { sidebar:false, header:true, links:2, decorative_tagline:false }, 'Minimal header replaces the sidebar without losing navigation');
  report.minimal_shell = shell;
}
async function checkCompactMobileHeader() {
  const header = await cdp.evaluate(`(() => {
    const brand=document.querySelector('.brand').getBoundingClientRect(),account=document.querySelector('.account-controls').getBoundingClientRect(),nav=document.querySelector('.main-nav').getBoundingClientRect(),shell=document.querySelector('.site-header').getBoundingClientRect();
    return {brand_top:brand.top,account_top:account.top,nav_top:nav.top,height:shell.height};
  })()`);
  assert.ok(Math.abs(header.brand_top-header.account_top)<=2 && header.nav_top>header.account_top && header.height<=128, 'Representative 360px header uses two readable rows, not three');
  report.compact_mobile_header=header;
}
async function checkTableKeyboard() {
  const before = await cdp.evaluate(`(() => {
    const table=document.querySelector('.table-wrap');
    if(!table || table.tabIndex!==0 || !table.getAttribute('aria-label'))throw Error('Named keyboard scroll region required');
    table.focus();return {left:table.scrollLeft,scrollable:table.scrollWidth>table.clientWidth};
  })()`);
  assert.ok(before.scrollable, 'Narrow viewport exercises the real scrolling table');
  await cdp.key('ArrowRight','ArrowRight',39);
  await textWait(`document.querySelector('.table-wrap').scrollLeft > ${before.left}`, 'native keyboard table scroll');
  report.table_keyboard_scroll = true;
  await cdp.evaluate('document.querySelector(".table-wrap").scrollLeft=0');
}
async function checkDialogViewport(label) {
  const box = await cdp.evaluate(`(() => {
    const dialog=document.querySelector('dialog[open]');if(!dialog)throw Error('Open dialog required');
    const b=dialog.getBoundingClientRect();return {left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:innerWidth,height:innerHeight,focus_inside:dialog.contains(document.activeElement)};
  })()`);
  assert.ok(box.left>=-1 && box.top>=-1 && box.right<=box.width+1 && box.bottom<=box.height+1, `${label}: dialog stays inside viewport`);
  assert.ok(box.focus_inside, `${label}: focus stays in modal`);
  (report.dialogs ??= []).push({ label, ...box });
}
async function checkRadioControls(label) {
  const metrics=await cdp.evaluate(`Array.from(document.querySelectorAll('.radio-card,.importance-option')).map(card=>{const i=card.querySelector('input').getBoundingClientRect(),d=card.querySelector('span').getBoundingClientRect(),c=card.getBoundingClientRect();return {input_width:i.width,description_width:d.width,description_right:d.right,card_right:c.right};})`);
  (report.radio_controls ??= []).push({label,metrics});
  assert.equal(metrics.length,2,'Both notification modes visible');
  assert.ok(metrics.every(m=>m.input_width<=32&&m.description_width>=100&&m.description_right<=m.card_right+1),'Compact radio controls must not squeeze or clip mode descriptions');
}
function removeOwnedRoot() {
  const rel = relative(tmpdir(), root);
  assert.ok(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && root.includes('notify-dashboard-browser-'));
  // Remove links themselves without following their targets before recursive
  // deletion. The only intentional junction points to read-only dependencies.
  function unlinkLinks(path) { for (const entry of readdirSync(path, { withFileTypes:true })) { const child = join(path, entry.name); const stat=lstatSync(child); if (stat.isSymbolicLink()) unlinkSync(child); else if (stat.isDirectory()) unlinkLinks(child); } }
  unlinkLinks(root); rmSync(root, { recursive:true, maxRetries:10, retryDelay:200 });
}

try {
  const sources = ['globals.css','console-shell.tsx','auth-form.tsx','dashboard.tsx','test/test-composer.tsx','layout.tsx','error.tsx'].map(name => join(repo,'dashboard','app',name));
  const buildFile = join(repo,'dashboard','.next','BUILD_ID');
  assert.ok(statSync(buildFile).mtimeMs >= Math.max(...sources.map(file => statSync(file).mtimeMs)), 'Build must be newer than all changed UI sources');
  report.source = { commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(), ui_sha256:createHash('sha256').update(sources.map(file => readFileSync(file)).reduce((a,b)=>Buffer.concat([a,b]),Buffer.alloc(0))).digest('hex'), build_id:readFileSync(buildFile,'utf8').trim() };
  const binary = join(root, process.platform === 'win32' ? 'fixture.exe' : 'fixture');
  execFileSync('go', ['build','-o',binary,join(repo,'tools','fixtures','dashboard-server.go')], { cwd:join(repo,'backend'), env:{...cleanEnv,GOTOOLCHAIN:'local',GOPROXY:'off',GOSUMDB:'off'}, timeout:120000, stdio:'pipe' });
  fixture = owned(binary, ['--root',root]);
  manifest = await waitFor(() => { const path=join(root,'private-fixture.json'); return existsSync(path) && JSON.parse(readFileSync(path,'utf8')); }, 'owned PostgreSQL fixture', 90000);
  assert.equal(new URL(manifest.api_url).hostname, '127.0.0.1'); assert.equal(new URL(manifest.web_url).hostname, '127.0.0.1');
  assert.equal(manifest.database_encoding,'UTF8');report.database={encoding:manifest.database_encoding,version:manifest.database_version};
  const port = await new Promise((resolve,reject) => { const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',() => { const port=server.address().port;server.close(()=>resolve(port)); }); });
  const standalone = join(repo,'dashboard','.next','standalone'); const runtime=join(root,'web'); mkdirSync(runtime);
  for (const name of ['server.js','package.json','.next']) cpSync(join(standalone,name),join(runtime,name),{recursive:true});
  symlinkSync(join(standalone,'node_modules'),join(runtime,'node_modules'),process.platform === 'win32' ? 'junction' : 'dir');
  cpSync(join(repo,'dashboard','.next','static'),join(runtime,'.next','static'),{recursive:true});
  if (existsSync(join(repo,'dashboard','public'))) cpSync(join(repo,'dashboard','public'),join(runtime,'public'),{recursive:true});
  web=owned(process.execPath,[join(runtime,'server.js')],{cwd:runtime,env:{...cleanEnv,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),NEXT_TELEMETRY_DISABLED:'1',DASHBOARD_PUBLIC_URL:manifest.web_url,BACKEND_URL:manifest.api_url,BACKEND_API_KEY:manifest.api_key,BACKEND_ALLOWED_HTTP_ORIGINS:'',DASHBOARD_DEMO_MODE:'true'}});
  assert.equal((await control('proxy',{url:`http://127.0.0.1:${port}`})).status,200);
  await waitFor(async () => (await pageRequest('/login')).status===200,'production standalone login');
  assert.equal((await pageRequest(statsPath)).status,401);
  assert.equal((await pageRequest(statsPath,{headers:{Host:'attacker.invalid','X-Forwarded-Host':new URL(manifest.web_url).host}})).status,403);
  assert.equal((await pageRequest('/api/auth/login',{body:{username:'admin',password:'synthetic'},headers:{Origin:'https://attacker.invalid'}})).status,403);
  check('anonymous API denied; forged Host/forwarded Host and cross-origin login denied');

  const candidates = process.platform === 'win32' ? [join(process.env['ProgramFiles(x86)']??'','Microsoft','Edge','Application','msedge.exe'),join(process.env.ProgramFiles??'','Google','Chrome','Application','chrome.exe')] : ['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'];
  const browserPath=candidates.find(existsSync); assert.ok(Boolean(browserPath),'Installed browser required; no automatic download');
  const profile=join(root,'browser-profile');
  browser=owned(browserPath,['--headless=new','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1440,900','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--disable-component-update','about:blank']);
  const debug=await waitFor(() => { const path=join(profile,'DevToolsActivePort');return existsSync(path)&&readFileSync(path,'utf8').trim().split('\n'); },'fresh private browser');
  const debugURL=`http://127.0.0.1:${Number(debug[0])}`;
  const version=await (await fetch(`${debugURL}/json/version`)).json(); browserCDP=await cdpClient(version.webSocketDebuggerUrl);
  const targets=await (await fetch(`${debugURL}/json/list`)).json(); const target=targets.find(t=>t.type==='page'&&t.url==='about:blank'); assert.ok(Boolean(target)); cdp=await cdpClient(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Network.enable');await cdp.send('Security.enable');await cdp.send('Security.setIgnoreCertificateErrors',{ignore:true});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await navigate('/login');await textWait('Boolean(document.querySelector("input[name=username]"))','login form');await checkFieldFamily('.stack-form input','login-dark');await screenshot('login-dark','เข้าสู่ระบบ');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:360,height:844,deviceScaleFactor:1,mobile:true});await checkLayout(360,'login-mobile-360','เข้าสู่ระบบ');await screenshot('login-dark-mobile-360','เข้าสู่ระบบ');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await cdp.fill('input[name=username]','admin');await cdp.fill('input[name=password]',manifest.bootstrap_password);await cdp.click('document.querySelector("form button")');
  await textWait('location.pathname === "/change-password" && Boolean(document.querySelector("input[name=new_password]"))','first login forced password change');
  const firstLimited=await cookieToken();const restricted=await pageRequest(statsPath,{token:firstLimited});assert.equal(restricted.status,403);assert.equal(restricted.data.code,'password_change_required');
  await checkFieldFamily('.stack-form input','forced-password-change');await screenshot('first-password-change','ตั้งรหัสผ่านใหม่');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:360,height:844,deviceScaleFactor:1,mobile:true});await checkLayout(360,'password-mobile-360','ตั้งรหัสผ่านใหม่');await screenshot('first-password-change-mobile-360','ตั้งรหัสผ่านใหม่');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await clickButton('ออกจากระบบ');await textWait('location.pathname === "/login"','restricted-session logout escape');assert.equal((await pageRequest(statsPath,{token:firstLimited})).status,401);
  await cdp.fill('input[name=username]','admin');await cdp.fill('input[name=password]',manifest.bootstrap_password);await cdp.click('document.querySelector("form button")');await textWait('location.pathname === "/change-password" && Boolean(document.querySelector("input[name=new_password]"))','restricted login again');
  const limited=await cookieToken();
  const nextPassword=`Synthetic new passphrase ${randomUUID()}`;
  await cdp.fill('input[name=current_password]',manifest.bootstrap_password);await cdp.fill('input[name=new_password]',nextPassword);await cdp.fill('input[name=confirm]',nextPassword);await cdp.click('document.querySelector("form button")');
  await textWait('location.pathname === "/" && Boolean(document.querySelector("nav[aria-label=เมนูหลัก]"))','password changed and history loaded');
  await checkMinimalShell();
  await textWait('document.body.innerText.includes("ยังไม่มีประวัติในช่วงเวลานี้")','initial empty history');await screenshot('history-empty','ยังไม่มีประวัติในช่วงเวลานี้');
  const full=await cookieToken();assert.ok(full!==limited,'Password change must rotate the opaque cookie');assert.equal((await pageRequest(statsPath,{token:limited})).status,401);
  check('real browser first-login gate; password change rotates secure cookie and revokes limited session');
  await navigate('/test');await textWait('Boolean(document.querySelector("input[name=title]"))','test composer');
  await checkFieldFamily('.stack-form input,.stack-form textarea','composer-dark');await checkRadioControls('composer-desktop');await screenshot('composer-dark-desktop','ธรรมดา · เงียบ');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:360,height:844,deviceScaleFactor:1,mobile:true});await checkCompactMobileHeader();await checkRadioControls('composer-mobile-360');await checkLayout(360,'composer-mobile-360');await screenshot('composer-dark-mobile-360','ธรรมดา · เงียบ');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  assert.equal(await cdp.evaluate('document.querySelector("input[name=importance]").checked'),true);
  await cdp.fill('input[name=title]','ทดสอบเงียบจาก browser จำลอง');await cdp.fill('textarea[name=message]','ข้อมูลสังเคราะห์เท่านั้น <b>ไม่ใช่ HTML</b> ไม่มีการส่ง FCM จริง');assert.equal((await control('fail-create-response')).status,200);await cdp.click('document.querySelector("form button")');
  await textWait('document.body.innerText.includes("ระบบไม่พร้อมใช้งานชั่วคราว")','lost create receipt is unknown, not a new send');
  assert.equal((await control('inspect')).data.send_calls,1);await screenshot('uncertain-send-before-retry','ตรวจสอบประวัติ');
  await cdp.click('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("คำขอเดิม"))');
  await waitFor(async()=> (await control('inspect')).data.create_requests===2,'same attempt actually retried through BFF');
  await textWait('document.body.innerText.includes("ผู้ให้บริการรับคำขอแล้ว — ยังไม่ยืนยัน")','synthetic normal acceptance');
  const normalReceipt=await control('inspect');assert.equal(normalReceipt.data.send_calls,1);assert.deepEqual(Object.values(normalReceipt.data.importance),['normal']);
  check('unknown create outcome retries the same attempt through real BFF/Go without a second synthetic provider call');
  await screenshot('normal-awaiting-ack','ผลผู้ให้บริการ / รายงานแตะ');
  await cdp.click('Array.from(document.querySelectorAll("label")).find(e=>e.textContent.includes("วิกฤต · ปลุก"))');
  await cdp.fill('input[name=title]','ทดสอบวิกฤตจำลอง ไม่มีเสียงจริง');await cdp.click('document.querySelector("form button")');
  await textWait('Boolean(document.querySelector("dialog[open]"))','critical confirmation');assert.equal((await control('inspect')).data.send_calls,1);
  await screenshot('critical-confirmation','TTL ไม่ใช่เวลาหยุดเสียง');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:360,height:844,deviceScaleFactor:1,mobile:true});await checkDialogViewport('critical-mobile-360');await screenshot('critical-confirmation-mobile-360','ยืนยันส่งแบบวิกฤต?');
  await cdp.key('Escape','Escape',27);await textWait('!document.querySelector("dialog[open]")','cancel critical confirmation');assert.equal((await control('inspect')).data.send_calls,1);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await cdp.click('document.querySelector("form button")');await textWait('Boolean(document.querySelector("dialog[open]"))','critical confirmation again');
  await cdp.click('Array.from(document.querySelector("dialog[open]").querySelectorAll("button")).find(e=>e.textContent.includes("ยืนยัน"))');
  await waitFor(async()=> (await control('inspect')).data.send_calls===2,'synthetic critical accepted');
  const sent=(await control('inspect')).data;assert.deepEqual(Object.values(sent.importance).sort(),['critical','normal']);
  const action=randomUUID(), clientAt=new Date().toISOString();
  for(const id of Object.keys(sent.importance)) {assert.equal((await control('ack',{alert_id:id,client_action_id:action,client_acked_at:clientAt})).status,200);assert.equal((await control('ack',{alert_id:id,client_action_id:action,client_acked_at:clientAt})).status,200);}
  await textWait('Boolean(document.querySelector(".receipt-panel .timeline li"))','Ack timeline after actual capability API report');
  const stats=await pageRequest(statsPath,{token:full});assert.equal(stats.status,200);assert.equal(stats.data.total_alerts,2);assert.equal(stats.data.acknowledged,2);assert.equal(stats.data.ack_action_count,1);
  await screenshot('synthetic-ack-received','เซิร์ฟเวอร์รับครั้งแรก');
  check('normal default, critical confirmation/cancel, real Go reservation + synthetic sender only');check('normal/critical capability Ack and duplicate retries persist through PostgreSQL; shared action counted once');
  await navigate('/');await textWait('document.body.innerText.includes("ทดสอบเงียบจาก browser จำลอง")','history after Ack');await checkLayout(1440,'desktop');await checkFieldFamily('.filter-fields input,.filter-fields select','filters-dark');await checkContrast('dark');await screenshot('history-dark-desktop','ประวัติ');
  await chooseTheme('light');await checkFieldFamily('.filter-fields input,.filter-fields select','filters-light');await checkContrast('light');await screenshot('history-light-desktop','ประวัติ');await navigate('/');assert.equal(await cdp.evaluate('document.documentElement.dataset.theme'),'light');
  await chooseTheme('system');await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});await screenshot('history-system-dark','ประวัติ');await chooseTheme('dark');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});await checkLayout(1024,'desktop-1024');await screenshot('history-dark-desktop-1024','ประวัติ');
  for(const width of [390,360]) {await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await cdp.evaluate('window.scrollTo(0,0)');await checkLayout(width,`mobile-${width}`);await screenshot(`history-dark-mobile-${width}`,'ประวัติ');await cdp.evaluate('document.querySelector(".history-section").scrollIntoView({block:"start"})');await screenshot(`history-dark-mobile-list-${width}`,'รายการแจ้งเตือน');}
  await chooseTheme('system');await cdp.evaluate('window.scrollTo(0,0)');await checkCompactMobileHeader();await screenshot('history-system-dark-mobile-360','ประวัติ');await chooseTheme('dark');
  await checkTableKeyboard();
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:720,height:450,deviceScaleFactor:2,mobile:false});await checkLayout(720,'200pct-equivalent');await screenshot('history-200pct-equivalent','ประวัติ');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await cdp.click('Array.from(document.querySelectorAll("button")).find(e=>e.textContent.includes("รายละเอียด"))');await textWait('Boolean(document.querySelector("dialog[open] .detail-fields"))','loaded detail dialog');await checkDialogViewport('detail-desktop');await screenshot('alert-detail-timeline','รายละเอียด');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:360,height:844,deviceScaleFactor:1,mobile:true});await checkDialogViewport('detail-mobile-360');await screenshot('alert-detail-mobile-360','รายละเอียด');
  await cdp.key('Escape','Escape',27);await textWait('!document.querySelector("dialog[open]")','detail Escape');await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  check('dark/light/system persistence, desktop/mobile and 200%-equivalent reflow, native detail dialog keyboard Escape');
  assert.equal((await control('seed-history')).data.seeded,26);
  await navigate('/');await textWait('Boolean(Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="โหลดเพิ่มเติม"))','real PostgreSQL cursor page');
  assert.equal((await control('fail-pagination')).status,200);await clickButton('โหลดเพิ่มเติม');
  await textWait('document.body.innerText.includes("ระบบไม่พร้อมใช้งานชั่วคราว")','pagination failure state');
  await screenshot('pagination-error-retains-history','แสดงรายการเดิมซึ่งอาจไม่เป็นปัจจุบัน');
  assert.equal((await control('inspect')).data.cursor_calls,1);
  // Retry the same failed page through the actual enabled UI control.
  await cdp.click('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("โหลดเพิ่มเติม") || b.textContent.includes("ลองโหลดเพิ่มเติม"))');
  await waitFor(async()=> (await control('inspect')).data.cursor_calls===2,'pagination retry actually performs another request');
  await textWait('document.body.innerText.includes("โหลดแล้ว 28 รายการ")','pagination retry appends actual remaining rows');
  await screenshot('pagination-retry-recovered','โหลดแล้ว 28 รายการ');check('cursor-page transport error can be retried without duplicate rows or changed filters');
  await clickButton('ออกจากระบบ');await textWait('location.pathname === "/login"','logout navigation');assert.equal((await pageRequest(statsPath,{token:full})).status,401);assert.equal((await pageRequest(statsPath)).status,401);
  await cdp.fill('input[name=username]','admin');await cdp.fill('input[name=password]',manifest.bootstrap_password);await cdp.click('document.querySelector("form button")');await textWait('document.body.innerText.includes("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")','bootstrap credential no longer logs in');
  await cdp.fill('input[name=password]',nextPassword);await cdp.click('document.querySelector("form button")');await textWait('location.pathname === "/"','new password works after logout');
  check('logout revokes old cookie; original bootstrap fails; new password succeeds');
  report.runtime_errors=cdp.errors;assert.deepEqual(cdp.errors,[],'No unhandled browser runtime/console errors');report.passed=true;
} catch (error) {
  report.error = error instanceof Error ? error.message : 'Browser regression failed';
  process.exitCode=1;
} finally {
  try {
    if(browserCDP){await browserCDP.send('Browser.close').catch(()=>{});browserCDP.close();}
    cdp?.close();
    if(browser)await waitFor(()=>browser.exited(),'owned browser exit',15000);
    if(web&&!web.exited()){web.child.kill();await waitFor(()=>web.exited(),'owned Node exit',15000);}
    if(fixture&&!fixture.exited()){if(!manifest)throw Error('Fixture still initializing; preserve owned root');await control('stop');await waitFor(()=>fixture.exited(),'owned PostgreSQL fixture exit',30000);}
    if(fixture){const ended=await fixture.ended;assert.equal(ended.code,0,'Fixture cleanup must succeed');}
    assert.ok(children.every(c=>c.exited()),'All owned processes exited before removal');removeOwnedRoot();report.cleanup=true;
  }catch(error){report.passed=false;report.cleanup_error=error instanceof Error?error.message:'Owned cleanup blocked';report.owned_root=root;process.exitCode=1;}
  report.completed_at=new Date().toISOString();writeFileSync(join(evidence,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,cases:report.cases,cleanup:report.cleanup,error:report.error,cleanup_error:report.cleanup_error,evidence},null,2));
}
