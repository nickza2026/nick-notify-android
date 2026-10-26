import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ackLabel, count, dateBounds, formatTime, historyQuery, importanceLabel, providerLabel, statsQuery, parseHistory, parseDetail, parseStats, localDashboardRequest } from '../lib/protocol';

test('Bangkok local calendar dates become UTC midnight and exclusive next day', () => {
  assert.deepEqual(dateBounds('2026-10-19', '2026-10-20'), { from: '2026-10-18T17:00:00.000Z', to: '2026-10-20T17:00:00.000Z' });
  assert.equal(dateBounds('2026-02-30', '2026-03-01'), null);
  assert.equal(dateBounds('2026-10-20', '2026-10-19'), null);
  assert.match(formatTime('2026-10-18T17:00:00Z'), /2569/);
});

test('local BFF rejects DNS-rebinding Host and cross-origin requests', () => {
  const url = 'http://127.0.0.1:3010/api/stats';
  assert.equal(localDashboardRequest(new Request(url, { headers: { host: '127.0.0.1:3010' } })), true);
  assert.equal(localDashboardRequest(new Request(url, { headers: { host: 'attacker.example:3010' } })), false);
  assert.equal(localDashboardRequest(new Request(url, { headers: { host: '127.0.0.1:3010', origin: 'https://attacker.example' } })), false);
});

test('standalone bind-address metadata never authorizes a non-loopback client Host', () => {
  const url = 'http://0.0.0.0:3010/api/stats';
  for (const host of ['127.0.0.1:3010', 'localhost:3010', '[::1]:3010']) {
    assert.equal(localDashboardRequest(new Request(url, { headers: { host } })), true);
    assert.equal(localDashboardRequest(new Request(url, { headers: { host, origin: `http://${host}` } })), true);
    assert.equal(localDashboardRequest(new Request(url, { headers: { host, origin: 'https://attacker.example' } })), false);
  }
  for (const host of ['0.0.0.0:3010', 'backoffice.example:3010', '192.168.1.10:3010',
    'localhost.attacker.example:3010', 'user@localhost:3010', 'localhost:9999']) {
    assert.equal(localDashboardRequest(new Request(url, { headers: { host } })), false);
  }
  assert.equal(localDashboardRequest(new Request(url)), false);
  assert.equal(localDashboardRequest(new Request('http://attacker.example:3010/api/stats', { headers: { host: 'localhost:3010' } })), false);
});

test('safe response projection rejects broken data and never forwards unexpected credential fields', () => {
  const summary = { alert_id: 'test-one', title: 'ทดสอบ', message: '<b>plain text</b>', status: 'provider_accepted',
    created_at: '2026-10-19T10:00:00Z', provider_accepted_at: '2026-10-19T10:00:01Z', expires_at: null,
    acknowledged_at: null, ack_count: 0, last_ack_at: null, ack_token: 'must-not-reach-browser', api_key: 'must-not-reach-browser' };
  const history = parseHistory({ items: [summary], next_cursor: null, secret: 'drop' });
  assert.equal(ackLabel(history.items[0]), 'ยังไม่ยืนยันรับทราบ');
  assert.ok(!JSON.stringify(history).includes('must-not-reach-browser'));
  assert.throws(() => parseHistory({ items: 'wrong' }));
  assert.throws(() => parseHistory({ items: [{ ...summary, acknowledged_at: 'invalid' }] }));
  assert.throws(() => parseDetail({ ...summary, ack_actions: [] }, 'another-id'));
  assert.throws(() => parseStats({ total_alerts: -1 }));
  assert.equal(parseStats({ total_alerts: null }).total_alerts, null);
});
test('importance is projected for history and detail without changing provider and acknowledgement data', () => {
  const base = { alert_id: 'one', title: 'ทดสอบ', message: 'ข้อความ', status: 'provider_accepted',
    created_at: '2026-10-19T10:00:00Z', provider_accepted_at: '2026-10-19T10:00:01Z', expires_at: null,
    acknowledged_at: null, ack_count: 2, last_ack_at: '2026-10-19T11:00:00Z',
    api_key: 'secret', ack_token: 'secret' };
  const history = parseHistory({ items: [{ ...base, importance: 'normal' }, { ...base, alert_id: 'two', importance: 'critical' },
    { ...base, alert_id: 'legacy' }], next_cursor: null });
  assert.deepEqual(history.items.map((item) => item.importance), ['normal', 'critical', 'critical']);
  assert.equal(importanceLabel(history.items[0].importance), 'ธรรมดา · เงียบ');
  assert.equal(importanceLabel(history.items[1].importance), 'วิกฤต · ปลุก');
  assert.equal(history.items[0].status, base.status);
  assert.equal(history.items[0].provider_accepted_at, base.provider_accepted_at);
  assert.equal(history.items[0].last_ack_at, base.last_ack_at);
  assert.equal(history.items[0].ack_count, base.ack_count);
  assert.ok(!JSON.stringify(history).includes('secret'));
  const detail = parseDetail({ ...base, importance: 'normal', ack_actions: [] }, 'one');
  assert.equal(detail.importance, 'normal');
  assert.equal(detail.ack_count, 2);
  assert.ok(!JSON.stringify(detail).includes('secret'));
  assert.equal(parseDetail({ ...base, ack_actions: [] }, 'one').importance, 'critical');
  for (const invalid of [null, 'urgent', '', 0, undefined]) {
    assert.throws(() => parseHistory({ items: [{ ...base, importance: invalid }], next_cursor: null }), /invalid_response/);
    assert.throws(() => parseDetail({ ...base, importance: invalid, ack_actions: [] }, 'one'), /invalid_response/);
  }
});
test('null is unknown, not zero or delivery confirmation', () => {
  assert.equal(count(null), 'ไม่ทราบ');
  assert.equal(count(0), '0');
  const item = { status: 'acknowledged' as const, provider_accepted_at: null, acknowledged_at: null };
  assert.equal(providerLabel(item as never), 'ไม่ทราบสถานะผู้ให้บริการ');
  assert.equal(ackLabel(item as never), 'มีการรายงานแตะรับทราบ');
});
test('BFF query allowlist bounds, rejects duplicates and malformed UTC', () => {
  const valid = 'from=2026-10-18T17%3A00%3A00Z&to=2026-10-19T17%3A00%3A00Z';
  assert.equal(historyQuery(new URLSearchParams(valid))?.get('limit'), '25');
  assert.equal(statsQuery(new URLSearchParams(valid))?.get('to'), '2026-10-19T17:00:00Z');
  assert.equal(historyQuery(new URLSearchParams(`${valid}&status=all&status=pending_ack`)), null);
  assert.equal(historyQuery(new URLSearchParams(`${valid}&limit=100`)), null);
  assert.equal(historyQuery(new URLSearchParams(`${valid}&target=http://evil`)), null);
  assert.equal(historyQuery(new URLSearchParams(`${valid}&cursor=${'x'.repeat(2049)}`)), null);
  assert.equal(statsQuery(new URLSearchParams(`${valid}&status=all`)), null);
  assert.equal(historyQuery(new URLSearchParams('from=2026-10-19T00:00:00%2B07:00&to=2026-10-20T00:00:00Z')), null);
});
