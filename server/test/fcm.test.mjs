import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFcmSender, SendFailure } from '../fcm.mjs';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = pair.privateKey.export({ format: 'pem', type: 'pkcs8' });
async function credentials(t) {
  const directory = await mkdtemp(join(tmpdir(), 'notify-fcm-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'fake-test-credentials.json');
  await writeFile(path, JSON.stringify({ type: 'service_account', project_id: 'fake-project-test', client_email: 'fake@fake-project-test.iam.gserviceaccount.com', private_key: privateKey }));
  return path;
}
function message() {
  return { ttlSeconds: 300, data: { type: 'alert', alert_id: 'test-1', title: 'Test', message: 'Test only', expires_at: new Date(Date.now() + 300_000).toISOString(), importance: 'critical' } };
}

test('FCM sender signs scoped JWT, uses HIGH data payload and caches OAuth token', async t => {
  const path = await credentials(t);
  let oauth = 0;
  let sends = 0;
  const sender = await createFcmSender({ credentialsPath: path, deviceToken: 'fake-device-token', fetchImpl: async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      oauth++;
      const jwt = init.body.get('assertion');
      const [header, payload, signature] = jwt.split('.');
      assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
      assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), pair.publicKey, Buffer.from(signature, 'base64url')));
      const claims = JSON.parse(Buffer.from(payload, 'base64url'));
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
      assert.equal(claims.aud, url);
      assert.equal(claims.exp - claims.iat, 3600);
      return Response.json({ access_token: 'fake-oauth-token', expires_in: 3600 });
    }
    sends++;
    assert.equal(url, 'https://fcm.googleapis.com/v1/projects/fake-project-test/messages:send');
    assert.equal(init.headers.authorization, 'Bearer fake-oauth-token');
    const body = JSON.parse(init.body).message;
    assert.equal(body.token, 'fake-device-token');
    assert.equal(body.android.priority, 'HIGH');
    assert.ok(parseInt(body.android.ttl, 10) > 0 && parseInt(body.android.ttl, 10) <= 300);
    assert.equal(body.data.type, 'alert');
    assert.equal(body.data.importance, 'critical');
    assert.equal(body.notification, undefined);
    return Response.json({ name: 'projects/fake-project-test/messages/test-id' });
  } });
  assert.deepEqual(await sender(message()), { accepted: true });
  await sender(message());
  assert.equal(oauth, 1);
  assert.equal(sends, 2);
});

test('normal mode uses NORMAL transport and preserves data mode', async t => {
  const path = await credentials(t);
  const sender = await createFcmSender({ credentialsPath: path, deviceToken: 'fake-device-token', fetchImpl: async (url, init) => {
    if (url.includes('oauth2')) return Response.json({ access_token: 'fake', expires_in: 3600 });
    const body = JSON.parse(init.body).message;
    assert.equal(body.data.importance, 'normal');
    assert.equal(body.android.priority, 'NORMAL');
    return Response.json({ name: 'synthetic' });
  } });
  const data = message();
  data.data.importance = 'normal';
  await sender(data);
});

test('OAuth failures are sanitized known pre-send failures', async t => {
  const path = await credentials(t);
  const sender = await createFcmSender({ credentialsPath: path, deviceToken: 'fake-device-token', fetchImpl: async () => { throw new Error('SECRET_BODY'); } });
  await assert.rejects(sender(message()), error => error instanceof SendFailure && error.code === 'provider_authentication_failed' && !error.ambiguous && !error.message.includes('SECRET_BODY'));
});

test('FCM transport interruption is ambiguous and provider bodies are never surfaced', async t => {
  const path = await credentials(t);
  for (const result of ['throw', 'reject', 'bad-success']) {
    const sender = await createFcmSender({ credentialsPath: path, deviceToken: 'fake-device-token', fetchImpl: async url => {
      if (url.includes('oauth2')) return Response.json({ access_token: 'fake', expires_in: 3600 });
      if (result === 'throw') throw new Error('SECRET');
      if (result === 'reject') return new Response('SECRET device token body', { status: 403 });
      return Response.json({ unexpected: 'SECRET' });
    } });
    await assert.rejects(sender(message()), error => {
      assert.ok(error instanceof SendFailure);
      assert.equal(error.ambiguous, result !== 'reject');
      assert.ok(!error.message.includes('SECRET'));
      return true;
    });
  }
});

test('expired message never reaches FCM after OAuth', async t => {
  const path = await credentials(t);
  const sender = await createFcmSender({ credentialsPath: path, deviceToken: 'fake-device-token', fetchImpl: async url => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    return Response.json({ access_token: 'fake', expires_in: 3600 });
  } });
  const expired = message();
  expired.data.expires_at = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(sender(expired), error => error.code === 'expired_before_send' && !error.ambiguous);
});

test('invalid credentials fail without returning path/private material', async () => {
  await assert.rejects(createFcmSender({ credentialsPath: 'does-not-exist', deviceToken: 'token' }), { message: 'invalid_fcm_configuration' });
});
