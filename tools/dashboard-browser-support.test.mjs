import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshScreenshot } from './dashboard-browser-support.mjs';

test('failed acquisition cannot reuse a previously valid screenshot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notify-screenshot-owned-'));
  try {
    const path = join(root, 'screenshot.png');
    const image = Buffer.alloc(1200); Buffer.from('89504e470d0a1a0a', 'hex').copy(image);
    writeFileSync(path, image);
    await assert.rejects(freshScreenshot(path, async () => { throw Error('synthetic capture failure'); }));
    assert.equal(existsSync(path), false);
    writeFileSync(path, image);
    await assert.rejects(freshScreenshot(path, async () => Buffer.from('not a screenshot')));
    assert.equal(existsSync(path), false);
    await freshScreenshot(path, async () => image);
    assert.deepEqual(readFileSync(path), image);
    assert.equal(existsSync(`${path}.pending`), false);
  } finally { rmSync(root, { recursive: true }); }
});
