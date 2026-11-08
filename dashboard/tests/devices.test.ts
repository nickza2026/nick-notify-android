import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgementIdentity, parseDetail, parseDevices } from '../lib/protocol';
import { backendURL } from '../lib/security';

const one = '11111111-1111-4111-8111-111111111111';
const two = '22222222-2222-4222-8222-222222222222';
const action = '33333333-3333-4333-8333-333333333333';
const time = '2026-11-08T10:00:00Z';
const device = { device_id: one, installation_id: two, device_name: 'เครื่องจำลอง ไม่มี FCM จริง', key_ids: ['primary'], active: true, created_at: time, updated_at: time };
const alert = { alert_id: 'synthetic-shared', title: 'ทดสอบ', message: 'จำลองเท่านั้น', status: 'provider_accepted', created_at: time, importance: 'critical', ack_count: 2, acknowledged_at: time, ack_actions: [] };

test('device DTO drops FCM/session credentials and rejects malformed or duplicate identities', () => {
  const dto = parseDevices({ items: [{ ...device, fcm_token: 'PRIVATE_DEVICE_TOKEN', access_token: 'PRIVATE_SESSION', api_key: 'PRIVATE_KEY' }], secret: 'PRIVATE_KEY' });
  assert.deepEqual(dto, { items: [device] });
  assert.ok(!JSON.stringify(dto).includes('PRIVATE'));
  for (const invalid of [{device_id:'bad'}, {installation_id:'bad'}, {device_name:''}, {device_name:'😀'.repeat(81)}, {active:'true'}, {created_at:null}, {key_ids:['primary','primary']}, {key_ids:['bad/key']}]) {
    assert.throws(() => parseDevices({items:[{...device,...invalid}]}), /invalid_response/);
  }
  assert.throws(() => parseDevices({items:[device,device]}), /invalid_response/);
  assert.deepEqual(parseDevices({items:[]}), {items:[]});
});

test('two phones using the same client_action_id remain separate Ack actions and safe delivery DTOs', () => {
  const a = { client_action_id: action, client_acked_at: time, received_at: time, device_id: one, device_name: 'เครื่องหนึ่ง' };
  const b = { ...a, device_id: two, device_name: 'เครื่องสอง' };
  const delivery = { device_id: one, device_name: 'เครื่องหนึ่ง', status: 'provider_accepted', provider_accepted_at: time, acknowledged_at: time, ack_count: 1, last_ack_at: time };
  const dto = parseDetail({...alert, ack_actions:[{...a,ack_token:'PRIVATE'},b], deliveries:[{...delivery,fcm_token:'PRIVATE',capability_hash:'PRIVATE'}]}, alert.alert_id);
  assert.equal(new Set(dto.ack_actions.map(acknowledgementIdentity)).size, 2);
  assert.equal(dto.ack_actions[0].device_name, 'เครื่องหนึ่ง');
  assert.deepEqual(dto.deliveries,[delivery]);
  assert.ok(!JSON.stringify(dto).includes('PRIVATE'));
  assert.equal(acknowledgementIdentity(a),acknowledgementIdentity({...a}));
  assert.notEqual(acknowledgementIdentity(a),acknowledgementIdentity(b));
  assert.notEqual(acknowledgementIdentity(a),acknowledgementIdentity({client_action_id:action}));
  assert.throws(() => parseDetail({...alert,deliveries:[delivery,delivery]},alert.alert_id));
  assert.throws(() => parseDetail({...alert,ack_actions:[{...a,device_id:'forged'}]},alert.alert_id));
  assert.equal(parseDetail(alert,alert.alert_id).deliveries,undefined,'Old single-device servers remain readable');
});

test('device upstream paths are fixed dashboard paths, never client-auth or arbitrary target URLs', () => {
  const old = process.env.BACKEND_URL;
  process.env.BACKEND_URL = 'http://127.0.0.1:8791';
  try {
    assert.equal(backendURL('/v1/dashboard/devices').pathname,'/v1/dashboard/devices');
    assert.equal(backendURL(`/v1/dashboard/devices/${one}`).pathname,`/v1/dashboard/devices/${one}`);
    for (const path of ['/v1/client/devices','/v1/dashboard/devices/not-uuid','/v1/dashboard/devices/../logout','/v1/dashboard/devices?url=other','/V1/DASHBOARD/devices']) assert.throws(() => backendURL(path));
  } finally { if (old === undefined) delete process.env.BACKEND_URL; else process.env.BACKEND_URL=old; }
});
