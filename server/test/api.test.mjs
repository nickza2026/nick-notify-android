import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../api.mjs';
import { SendFailure } from '../fcm.mjs';

const API_KEY = 'test-only-placeholder-key-not-a-secret-123456';
const normal = { title: 'ตู้หยุดทำงาน', message: 'เหตุการณ์ทดสอบ' };
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'notify-bridge-test-'));
  const statePath = join(directory, 'state.json');
  const calls = [];
  const server = await createBridge({ apiKey: API_KEY, statePath, sender: async message => { calls.push(message); }, ...options });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(done => server.close(done)); await rm(directory, { recursive: true, force: true }); });
  async function post(body = normal, { key = 'incident-001', authorization = `Bearer ${API_KEY}`, raw, ...rest } = {}) {
    const response = await fetch(`${url}/v1/alerts`, {
      method: 'POST', headers: { authorization, 'content-type': 'application/json', 'idempotency-key': key },
      body: raw ?? JSON.stringify(body), ...rest,
    });
    return { response, body: await response.json() };
  }
  return { server, url, post, calls, statePath };
}

test('health is configuration-only, not delivery, and includes no credentials', async t => {
  const f = await fixture(t);
  const response = await fetch(`${f.url}/health`);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(text), { ready: true, status: 'configuration_only', delivery_verified: false, ack_sync_supported: false });
  assert.ok(!text.includes(API_KEY));
});

test('rejects unauthorized request and never calls provider', async t => {
  const f = await fixture(t);
  const result = await f.post(normal, { authorization: 'Bearer wrong' });
  assert.equal(result.response.status, 401);
  assert.equal(f.calls.length, 0);
  assert.ok(!JSON.stringify(result.body).includes(API_KEY));
});

test('accepts only after provider accepted; FCM fields and default TTL are correct', async t => {
  const f = await fixture(t);
  const { response, body } = await f.post();
  assert.equal(response.status, 202);
  assert.equal(body.status, 'provider_accepted');
  assert.equal(body.delivery_verified, false);
  assert.equal(body.acknowledged, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].data.type, 'alert');
  assert.equal(f.calls[0].data.alert_id, body.alert_id);
  assert.equal(f.calls[0].data.message, normal.message);
  assert.ok(f.calls[0].ttlSeconds > 0 && f.calls[0].ttlSeconds <= 300);
  assert.ok(!Object.hasOwn(f.calls[0].data, 'ring_duration'));
});

test('schema, JSON and idempotency key validation', async t => {
  const f = await fixture(t);
  for (const value of [null, [], { title: 4, message: 'a' }, { title: '', message: 'a' }, { ...normal, unsupported: true }, { ...normal, alert_id: '../escape' }]) {
    const result = await f.post(value);
    assert.ok([400, 422].includes(result.response.status));
  }
  assert.equal((await f.post(normal, { raw: '{broken' })).response.status, 400);
  assert.equal((await f.post(normal, { key: '' })).body.error.code, 'idempotency_key_required');
  assert.equal(f.calls.length, 0);
});

test('rejects invalid TTL including noninteger, string and null handling', async t => {
  const f = await fixture(t);
  for (const ttl_seconds of [0, 29, 10_801, '300', 30.5, -1, null]) {
    const result = await f.post({ ...normal, ttl_seconds });
    assert.equal(result.response.status, 422);
    assert.equal(result.body.error.code, 'invalid_ttl');
  }
  assert.equal(f.calls.length, 0);
});

test('rejects body and UTF-8 payload overflow before provider', async t => {
  const f = await fixture(t);
  const bodyLarge = await f.post(normal, { raw: JSON.stringify({ ...normal, message: 'a'.repeat(20_000) }) });
  assert.equal(bodyLarge.response.status, 413);
  const thai = await f.post({ title: 'ทดสอบ', message: 'ก'.repeat(1800) });
  assert.equal(thai.response.status, 422);
  assert.equal(thai.body.error.code, 'payload_too_large');
  assert.equal(f.calls.length, 0);
});

test('same normalized request replays durable success; changed body is 409', async t => {
  const f = await fixture(t);
  const first = await f.post();
  const second = await f.post({ message: normal.message, title: normal.title, ttl_seconds: 300 });
  assert.deepEqual(second.body, first.body);
  assert.equal(second.response.headers.get('idempotency-replayed'), 'true');
  const mismatch = await f.post({ ...normal, message: 'different' });
  assert.equal(mismatch.response.status, 409);
  assert.equal(mismatch.body.error.code, 'idempotency_conflict');
  assert.equal(f.calls.length, 1);
  const state = await readFile(f.statePath, 'utf8');
  assert.ok(!state.includes(API_KEY));
  assert.ok(!state.includes(normal.message));
});

test('importance defaults critical; explicit critical replays, normal conflicts, and receipts retain mode', async t => {
  const f = await fixture(t);
  const first = await f.post();
  assert.equal(first.body.importance, 'critical');
  assert.equal(f.calls[0].data.importance, 'critical');
  assert.equal(f.calls[0].data.type, 'alert');
  const replay = await f.post({ ...normal, importance: 'critical' });
  assert.deepEqual(replay.body, first.body);
  assert.equal(replay.response.headers.get('idempotency-replayed'), 'true');
  assert.equal((await f.post({ ...normal, importance: 'normal' })).body.error.code, 'idempotency_conflict');
  assert.equal(f.calls.length, 1);
  const quiet = await f.post({ ...normal, alert_id: 'quiet', importance: 'normal' }, { key: 'quiet-key' });
  assert.equal(quiet.body.importance, 'normal');
  assert.equal(f.calls[1].data.importance, 'normal');
  assert.equal(f.calls[1].data.type, 'notice');
  const detail = await fetch(`${f.url}/v1/alerts/quiet`, { headers: { authorization: `Bearer ${API_KEY}` } });
  assert.equal((await detail.json()).importance, 'normal');
  for (const importance of [null, '', 'urgent', 1, false]) {
    const result = await f.post({ ...normal, importance }, { key: `invalid-${String(importance)}` });
    assert.ok([400, 422].includes(result.response.status));
  }
  assert.equal(f.calls.length, 2);
});

test('legacy persisted receipt remains critical without rewriting state and replay precedes changed payload budget', async t => {
  const f = await fixture(t);
  const first = await f.post();
  const state = JSON.parse(await readFile(f.statePath, 'utf8'));
  delete state.entries[0][1].importance;
  delete state.entries[0][1].response.importance;
  const { writeFile } = await import('node:fs/promises');
  await writeFile(f.statePath, JSON.stringify(state));
  const oldState = await readFile(f.statePath, 'utf8');
  const calls = [];
  const replayServer = await createBridge({ apiKey: API_KEY, statePath: f.statePath, sender: async v => calls.push(v) });
  await new Promise(done => replayServer.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => replayServer.close(done)));
  const base = `http://127.0.0.1:${replayServer.address().port}`;
  const headers = { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json', 'idempotency-key': 'incident-001' };
  const response = await fetch(`${base}/v1/alerts`, { method: 'POST', headers, body: JSON.stringify({ ...normal, importance: 'critical' }) });
  assert.equal(response.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(await response.json(), first.body);
  assert.equal(calls.length, 0);
  assert.equal(await readFile(f.statePath, 'utf8'), oldState);
});

test('unknown persisted importance fails closed on startup', async t => {
  const f = await fixture(t);
  await f.post();
  const state = JSON.parse(await readFile(f.statePath, 'utf8'));
  state.entries[0][1].importance = 'unexpected';
  const { writeFile } = await import('node:fs/promises');
  await writeFile(f.statePath, JSON.stringify(state));
  await assert.rejects(createBridge({ apiKey: API_KEY, statePath: f.statePath, sender: async () => {} }),
    { message: 'idempotency_store_unavailable' });
});

test('restart reads idempotency state and does not resend accepted request', async t => {
  const f = await fixture(t);
  const first = await f.post();
  let calls = 0;
  const server = await createBridge({ apiKey: API_KEY, statePath: f.statePath, sender: async () => { calls++; } });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/alerts`, {
    method: 'POST', headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json', 'idempotency-key': 'incident-001' },
    body: JSON.stringify(normal),
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), first.body);
  assert.equal(calls, 0);
});

test('known provider rejection is safe and not retried automatically', async t => {
  let calls = 0;
  const f = await fixture(t, { sender: async () => { calls++; throw new SendFailure('provider_rejected'); } });
  const first = await f.post();
  assert.equal(first.response.status, 502);
  assert.equal(first.body.status, 'provider_failed');
  assert.equal((await f.post()).response.status, 502);
  assert.equal(calls, 1);
});

test('unknown provider exception is ambiguous; never leaks raw exception or resends', async t => {
  let calls = 0;
  const secret = 'raw-provider-secret-FCM-TOKEN';
  const f = await fixture(t, { sender: async () => { calls++; throw new Error(secret); } });
  const first = await f.post();
  assert.equal(first.response.status, 502);
  assert.equal(first.body.status, 'delivery_unknown');
  assert.ok(!JSON.stringify(first.body).includes(secret));
  assert.ok(!(await readFile(f.statePath, 'utf8')).includes(secret));
  assert.equal((await f.post()).response.status, 502);
  assert.equal(calls, 1);
});

test('concurrent same key cannot send twice', async t => {
  let release;
  const hold = new Promise(done => { release = done; });
  let entered;
  const called = new Promise(done => { entered = done; });
  let calls = 0;
  const f = await fixture(t, { sender: async () => { calls++; entered(); await hold; } });
  const first = f.post();
  await called;
  const concurrent = await f.post();
  assert.equal(concurrent.response.status, 409);
  assert.equal(concurrent.body.error.code, 'delivery_unknown_or_in_progress');
  release();
  assert.equal((await first).response.status, 202);
  assert.equal(calls, 1);
});

test('unconfigured provider is explicit; rate limit and concurrency bound work', async t => {
  const missing = await fixture(t, { sender: undefined });
  assert.equal((await (await fetch(`${missing.url}/health`)).json()).ready, false);
  assert.equal((await missing.post()).response.status, 503);
  const limited = await fixture(t, { requestsPerMinute: 1 });
  assert.equal((await limited.post()).response.status, 202);
  const second = await limited.post(normal, { key: 'two' });
  assert.equal(second.response.status, 429);
  assert.equal(second.response.headers.get('retry-after'), '60');
});

test('global concurrent send cap prevents second incident from reaching sender', async t => {
  let release;
  const hold = new Promise(done => { release = done; });
  let entered;
  const called = new Promise(done => { entered = done; });
  const f = await fixture(t, { maxConcurrent: 1, sender: async () => { entered(); await hold; } });
  const first = f.post();
  await called;
  const second = await f.post(normal, { key: 'other-incident' });
  assert.equal(second.response.status, 429);
  release();
  assert.equal((await first).response.status, 202);
});
