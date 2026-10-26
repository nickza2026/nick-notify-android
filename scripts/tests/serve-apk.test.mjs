import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDownloadServer } from '../serve-apk.mjs';

test('APK server exposes only a nonce page and one immutable APK', async () => {
  const { server, path, sha256 } = await createDownloadServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ['/', '/README.md', '/server/index.mjs', `${path}/.env`, '/app/google-services.json']) {
      assert.equal((await fetch(`${base}${route}`)).status, 404);
    }
    const page = await fetch(`${base}${path}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), new RegExp(sha256));
    const apk = await fetch(`${base}${path}/notify-alarm-0.6.0-safety-debug.apk`);
    assert.equal(apk.headers.get('content-type'), 'application/vnd.android.package-archive');
    assert.equal(apk.headers.get('content-disposition'), 'attachment; filename="notify-alarm-0.6.0-safety-debug.apk"');
    assert.ok((await apk.arrayBuffer()).byteLength > 0);
    const head = await fetch(`${base}${path}/notify-alarm-0.6.0-safety-debug.apk`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal((await fetch(`${base}${path}/`, { method: 'POST' })).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
