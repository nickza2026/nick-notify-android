import { existsSync, unlinkSync, writeFileSync, renameSync } from 'node:fs';

export async function waitFor(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result; } catch { /* Retry observable startup state only. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error(`Timed out: ${label}`);
}

export async function freshScreenshot(path, acquire) {
  // Fail closed even when a previous successful acquisition used this path.
  if (existsSync(path)) unlinkSync(path);
  const pending = `${path}.pending`;
  if (existsSync(pending)) unlinkSync(pending);
  try {
    const bytes = await acquire();
    if (!Buffer.isBuffer(bytes) || bytes.length < 1000 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('Invalid screenshot acquisition');
    writeFileSync(pending, bytes);
    renameSync(pending, path);
  } finally { if (existsSync(pending)) unlinkSync(pending); }
}

export async function cdpClient(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(Error('CDP connection failed')); });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') errors.push('runtime_exception');
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push('console_error');
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id); clearTimeout(call.timer);
    message.error ? call.reject(Error(`CDP command failed: ${call.method}`)) : call.resolve(message.result);
  };
  ws.onclose = () => { for (const call of pending.values()) { clearTimeout(call.timer); call.reject(Error('CDP closed')); } pending.clear(); };
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 20000);
      pending.set(id, { resolve, reject, timer, method }); ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error('Browser evaluation failed');
    return result.result.value;
  }
  async function click(expression) {
    const position = await evaluate(`(() => { const el=${expression}; if(!el) return null; el.scrollIntoView({block:'center'}); const b=el.getBoundingClientRect(); return {x:b.left+b.width/2,y:b.top+b.height/2}; })()`);
    if (!position) throw Error(`Missing UI target: ${expression}`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'left', buttons: 0, clickCount: 1 });
  }
  async function key(name, code, number, modifiers = 0) {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: name, code, windowsVirtualKeyCode: number, modifiers });
  }
  async function fill(selector, text) {
    await click(`document.querySelector(${JSON.stringify(selector)})`);
    await key('a', 'KeyA', 65, 2);
    await send('Input.insertText', { text });
  }
  return { send, evaluate, click, fill, key, errors, close: () => ws.close() };
}
