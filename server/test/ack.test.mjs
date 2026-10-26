import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../api.mjs';
import { AckStore } from '../store.mjs';

const API_KEY = 'synthetic-test-only-application-key-12345';
const base = 'https://example.invalid/bridge';
const body = { alert_id: 'incident-one', title: 'Alarm', message: 'Test', ttl_seconds: 30 };

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'notify-ack-test-'));
  const statePath = join(dir, 'idempotency.json');
  const calls = [];
  const bridgeOptions = { apiKey: API_KEY, ackBaseUrl: base, statePath,
    sender: async event => { calls.push(event); }, ...options };
  const server = await createBridge(bridgeOptions);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(done => server.close(done)); await rm(dir, { recursive: true, force: true }); });
  const post = async (input = body, key = 'key-one') => {
    const response = await fetch(`${url}/v1/alerts`, { method: 'POST', headers: {
      authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json', 'idempotency-key': key,
    }, body: JSON.stringify(input) });
    return { response, data: await response.json() };
  };
  const ack = async (id, token, input = {}) => {
    const response = await fetch(`${url}/v1/alerts/${id}/ack`, { method: 'POST', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json',
    }, body: JSON.stringify(input) });
    return { response, data: await response.json() };
  };
  const get = async (id, token = API_KEY) => {
    const response = await fetch(`${url}/v1/alerts/${id}`, { headers: { authorization: `Bearer ${token}` } });
    return { response, data: await response.json() };
  };
  return { ...bridgeOptions, server, statePath, dir, url, calls, post, ack, get };
}

test('enabled health, capability isolation, per-alert binding, canonical repeat, restart and expired TTL', async t => {
  let clock = Date.parse('2026-10-19T10:00:00.000Z');
  const f = await fixture(t, { now: () => clock });
  assert.equal((await (await fetch(`${f.url}/health`)).json()).ack_sync_supported, true);
  const first = await f.post();
  assert.equal(first.response.status, 202);
  const data = f.calls[0].data;
  assert.equal(data.ack_url, `${base}/v1/alerts/incident-one/ack`);
  assert.match(data.ack_token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await f.ack(body.alert_id, API_KEY)).response.status, 401);
  assert.equal((await f.ack('unknown', data.ack_token)).response.status, 401);
  assert.equal((await f.ack(body.alert_id, 'wrong')).response.status, 401);
  assert.equal((await f.get(body.alert_id, data.ack_token)).response.status, 401);
  assert.equal((await f.get('unknown')).response.status, 404);
  const second = await f.post({ ...body, alert_id: 'incident-two' }, 'key-two');
  assert.equal(second.response.status, 202);
  assert.equal((await f.ack('incident-two', data.ack_token)).response.status, 401);
  assert.equal((await f.post(body, 'different-key')).response.status, 409);
  assert.equal((await f.post(body)).response.headers.get('idempotency-replayed'), 'true');
  assert.equal(f.calls.length, 2);
  clock += 31_000; // TTL only limits the latest alarm start; Ack remains valid afterward.
  const timestamp = '2026-10-19T10:00:25.000Z';
  const accepted = await f.ack(body.alert_id, data.ack_token, { client_acked_at: timestamp });
  assert.equal(accepted.response.status, 200);
  assert.deepEqual(accepted.data, { alert_id: body.alert_id, status: 'acknowledged',
    acknowledged_at: new Date(clock).toISOString(), client_acked_at: timestamp });
  clock += 1000;
  assert.deepEqual((await f.ack(body.alert_id, data.ack_token, {})).data, accepted.data);
  const receipt = await f.get(body.alert_id);
  assert.equal(receipt.data.status, 'provider_accepted');
  assert.equal(receipt.data.delivery_verified, false);
  assert.equal(receipt.data.acknowledged_at, accepted.data.acknowledged_at);
  const state = await readFile(f.statePath, 'utf8');
  const ledger = await readFile(`${f.statePath}.acks.json`, 'utf8');
  for (const text of [state, ledger, JSON.stringify(first.data), JSON.stringify(receipt.data)]) {
    assert.ok(!text.includes(data.ack_token));
    assert.ok(!text.includes(API_KEY));
  }
  let sends = 0;
  const restarted = await createBridge({ ...f, sender: async () => { sends++; } });
  await new Promise(done => restarted.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => restarted.close(done)));
  const url = `http://127.0.0.1:${restarted.address().port}`;
  const repeated = await fetch(`${url}/v1/alerts/${body.alert_id}/ack`, { method: 'POST', headers: {
    authorization: `Bearer ${data.ack_token}`, 'content-type': 'application/json',
  }, body: '{}' });
  assert.deepEqual(await repeated.json(), accepted.data);
  assert.equal(sends, 0);
});

test('invalid URL, disabled Ack, byte budget and invalid telemetry', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'notify-ack-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const value of ['http://example.org', 'https://user@example.org', 'https://example.org?x=1',
    'https://example.org#f', 'https://example.org?', 'https://example.org#',
    'https://example.org/path%20with-space', 'https://example.org/base//path']) {
    await assert.rejects(createBridge({ apiKey: API_KEY, statePath: join(dir, 'bad.json'), ackBaseUrl: value }));
  }
  const disabled = await fixture(t, { ackBaseUrl: undefined });
  assert.equal((await disabled.post()).response.status, 202);
  assert.equal((await (await fetch(`${disabled.url}/health`)).json()).ack_sync_supported, false);
  assert.equal(Object.hasOwn(disabled.calls[0].data, 'ack_url'), false);
  assert.equal((await disabled.ack(body.alert_id, 'x')).response.status, 401);
  const f = await fixture(t);
  assert.equal((await f.post({ ...body, message: 'ก'.repeat(1350) })).response.status, 422);
  assert.equal(f.calls.length, 0);
  await f.post();
  assert.equal((await f.ack(body.alert_id, f.calls[0].data.ack_token, { client_acked_at: 'tomorrow' })).response.status, 422);
});

test('failed Ack reservation never sends and does not brick restart', async t => {
  const f = await fixture(t);
  const previous = AckStore.prototype.persist;
  AckStore.prototype.persist = async function () { throw new Error('synthetic reservation failure'); };
  try {
    assert.equal((await f.post()).response.status, 503);
    assert.equal(f.calls.length, 0);
  } finally { AckStore.prototype.persist = previous; }
  await new Promise(done => f.server.close(done));
  const restarted = await createBridge(f);
  restarted.close();
  assert.equal(f.calls.length, 0);
  const state = JSON.parse(await readFile(f.statePath, 'utf8'));
  assert.equal(state.entries[0][1].ackEnabled, false);
});

test('client action UUID is validated and retries keep the canonical original action', async t => {
  const f = await fixture(t);
  await f.post();
  const token = f.calls[0].data.ack_token;
  assert.equal((await f.ack(body.alert_id, token, { client_action_id: 'not-a-uuid' })).response.status, 422);
  const action = '11111111-1111-4111-8111-111111111111';
  const first = await f.ack(body.alert_id, token, { client_action_id: action });
  assert.equal(first.response.status, 200);
  assert.equal(first.data.client_action_id, action);
  assert.deepEqual((await f.ack(body.alert_id, token, { client_action_id: action })).data, first.data);
});

test('durability failures never claim Ack success, bounds apply to Ack', async t => {
  const f = await fixture(t, { requestsPerMinute: 2, unauthenticatedRequestsPerMinute: 2 });
  await f.post();
  const token = f.calls[0].data.ack_token;
  assert.equal((await f.ack(body.alert_id, 'incorrect')).response.status, 401);
  assert.equal((await f.ack(body.alert_id, 'incorrect')).response.status, 401);
  assert.equal((await f.ack(body.alert_id, 'incorrect')).response.status, 429);
  assert.equal((await f.ack(body.alert_id, token)).response.status, 200);
  assert.equal((await f.get(body.alert_id)).response.status, 429);
  const other = await fixture(t);
  await other.post();
  const previous = AckStore.prototype.persist;
  AckStore.prototype.persist = async function () { throw new Error('synthetic disk failure'); };
  try {
    const failure = await other.ack(body.alert_id, other.calls[0].data.ack_token);
    assert.equal(failure.response.status, 503);
    assert.equal((await other.get(body.alert_id)).data.acknowledged, false);
  } finally { AckStore.prototype.persist = previous; }
  assert.equal((await other.ack(body.alert_id, other.calls[0].data.ack_token)).response.status, 200);
});

test('GET cannot observe a tentative Ack when a concurrent disk write later fails', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  await f.post();
  let release;
  let started;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  const previous = AckStore.prototype.persist;
  AckStore.prototype.persist = async function () {
    started();
    await gate;
    throw new Error('synthetic delayed disk failure');
  };
  try {
    const ack = f.ack(body.alert_id, f.calls[0].data.ack_token);
    await entered;
    let statusFinished = false;
    const status = f.get(body.alert_id).then(result => { statusFinished = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(statusFinished, false);
    release();
    assert.equal((await ack).response.status, 503);
    assert.equal((await status).data.acknowledged, false);
  } finally { release(); AckStore.prototype.persist = previous; }
});

test('missing ledger fails closed on restart and full ledger cannot evict unacked records', async t => {
  const f = await fixture(t);
  await f.post();
  await rm(`${f.statePath}.acks.json`);
  await assert.rejects(createBridge({ apiKey: API_KEY, sender: async () => {}, statePath: f.statePath,
    ackBaseUrl: base }), /ack_store_unavailable/);
  await assert.rejects(createBridge({ apiKey: API_KEY, sender: async () => {}, statePath: f.statePath }),
    /ack_configuration_missing/);
  const limited = new AckStore(join(f.dir, 'limited.json'), { maxRecords: 1 });
  await limited.init();
  assert.equal(await limited.reserve('one', 'a'.repeat(64)), true);
  await assert.rejects(limited.reserve('two', 'b'.repeat(64)), /ack_capacity/);
  assert.ok(limited.get('one'));
});

test('normal mode survives idempotency retention pruning and restart in permanent ACK ledger', async t => {
  let clock = Date.parse('2026-10-19T10:00:00.000Z');
  const f = await fixture(t, { now: () => clock });
  const first = await f.post({ ...body, importance: 'normal' });
  assert.equal(first.response.status, 202);
  assert.equal((await f.get(body.alert_id)).data.importance, 'normal');
  clock += 86_400_001;
  assert.equal((await f.post({ ...body, alert_id: 'incident-later' }, 'later-key')).response.status, 202);
  const state = JSON.parse(await readFile(f.statePath, 'utf8'));
  assert.ok(!state.entries.some(([, entry]) => entry.alertId === body.alert_id));
  const retained = await f.get(body.alert_id);
  assert.equal(retained.response.status, 200);
  assert.equal(retained.data.importance, 'normal');
  assert.equal(retained.data.status, 'delivery_unknown_or_in_progress');
  const token = f.calls[0].data.ack_token;
  await new Promise(done => f.server.close(done));
  const server = await createBridge({ apiKey: API_KEY, ackBaseUrl: base, statePath: f.statePath,
    now: () => clock, sender: async () => { assert.fail('restart must not send'); } });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const detail = await fetch(`${url}/v1/alerts/${body.alert_id}`, { headers: { authorization: `Bearer ${API_KEY}` } });
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).importance, 'normal');
  const ack = await fetch(`${url}/v1/alerts/${body.alert_id}/ack`, { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(ack.status, 200);
  assert.equal(f.calls.length, 2);
});

test('legacy ACK ledger without importance remains critical after pruning and restart', async t => {
  let clock = Date.parse('2026-10-19T10:00:00.000Z');
  const f = await fixture(t, { now: () => clock });
  assert.equal((await f.post()).response.status, 202);
  await new Promise(done => f.server.close(done));
  const path = `${f.statePath}.acks.json`;
  const ledger = JSON.parse(await readFile(path, 'utf8'));
  delete ledger.entries[0][1].importance;
  await writeFile(path, JSON.stringify(ledger));
  const server = await createBridge({ apiKey: API_KEY, ackBaseUrl: base, statePath: f.statePath,
    now: () => clock, sender: async () => {} });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, id, key) => {
    const response = await fetch(`${url}/v1/alerts${id ? `/${id}` : ''}`, { method,
      headers: { authorization: `Bearer ${API_KEY}`, ...(key ? { 'content-type': 'application/json', 'idempotency-key': key } : {}) },
      ...(key ? { body: JSON.stringify({ ...body, alert_id: 'later' }) } : {}) });
    return { response, data: await response.json() };
  };
  clock += 86_400_001;
  assert.equal((await request('POST', '', 'later-key')).response.status, 202);
  const detail = await request('GET', body.alert_id);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.data.importance, 'critical');
  assert.equal(JSON.parse(await readFile(path, 'utf8')).entries[0][1].importance, undefined);
});

test('pre-mode normal ACK ledger is backfilled from durable idempotency metadata before pruning', async t => {
  let clock = Date.parse('2026-10-19T10:00:00.000Z');
  const f = await fixture(t, { now: () => clock });
  assert.equal((await f.post({ ...body, importance: 'normal' })).response.status, 202);
  await new Promise(done => f.server.close(done));
  const path = `${f.statePath}.acks.json`;
  const ledger = JSON.parse(await readFile(path, 'utf8'));
  delete ledger.entries[0][1].importance;
  await writeFile(path, JSON.stringify(ledger));
  const server = await createBridge({ apiKey: API_KEY, ackBaseUrl: base, statePath: f.statePath,
    now: () => clock, sender: async () => {} });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  assert.equal(JSON.parse(await readFile(path, 'utf8')).entries[0][1].importance, 'normal');
});

test('invalid permanent ACK importance fails startup closed', async t => {
  const f = await fixture(t);
  assert.equal((await f.post()).response.status, 202);
  await new Promise(done => f.server.close(done));
  const path = `${f.statePath}.acks.json`;
  const ledger = JSON.parse(await readFile(path, 'utf8'));
  ledger.entries[0][1].importance = 'unknown';
  await writeFile(path, JSON.stringify(ledger));
  await assert.rejects(createBridge({ apiKey: API_KEY, ackBaseUrl: base, statePath: f.statePath,
    sender: async () => {} }), /ack_store_unavailable/);
});
