import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const VERSION_CODE = 10;
export const VERSION_NAME = '0.9.1-google-setup';
export const APK_ASSET = `notify-alarm-${VERSION_NAME}-debug.apk`;
export const DESCRIPTOR_ASSET = 'notify-alarm-update.json';
export const SIGNER = '79c26a1c9329aa69933eada6c5e13b7718d43ae1da90120de639fe23f10cc9d4';
export const MAX_SIZE = 128 * 1024 * 1024;

function inspect(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Android SDK verification failed: ${basename(executable)}`);
  return result.stdout;
}

export function descriptorFromApk(apk, aapt, apksigner, execute = inspect) {
  assert.equal(basename(apk), APK_ASSET, 'unexpected APK asset name');
  const size = statSync(apk).size;
  assert.ok(Number.isSafeInteger(size) && size > 0 && size <= MAX_SIZE, 'APK exceeds size bounds');
  const hash = () => {
    const bytes = readFileSync(apk);
    assert.equal(bytes.length, size, 'APK changed during verification');
    return createHash('sha256').update(bytes).digest('hex');
  };
  const before = hash();
  const badging = execute(aapt, ['dump', 'badging', apk]);
  const packageLine = badging.split(/\r?\n/).find(line => line.startsWith('package: '));
  assert.match(packageLine ?? '', /^package: name='dev\.notifyalarm' versionCode='10' versionName='0\.9\.1-google-setup'(?: |$)/, 'unexpected APK package/version');
  const certificates = execute(apksigner, ['verify', '--print-certs', apk]);
  const digests = [...certificates.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})$/gm)];
  assert.equal(digests.length, 1, 'expected exactly one APK signer');
  assert.equal(digests[0][1], SIGNER, 'APK signer does not match existing installs');
  const apk_sha256 = hash();
  assert.equal(apk_sha256, before, 'APK changed during verification');
  return {
    schema_version: 1, application_id: 'dev.notifyalarm', version_code: VERSION_CODE,
    version_name: VERSION_NAME, apk_asset: APK_ASSET, apk_sha256,
    apk_size: size, signing_cert_sha256: SIGNER,
  };
}

export function run(command, apk, aapt, apksigner, execute = inspect) {
  if (!['create', 'verify'].includes(command) || !apk || !aapt || !apksigner) throw new Error('usage: android-update-release.mjs create|verify APK AAPT APKSIGNER');
  const descriptor = join(dirname(apk), DESCRIPTOR_ASSET);
  // Retire this producer's old output before acquisition, not just after success.
  // Failed SDK checks must not leave a valid descriptor that looks newly generated.
  if (command === 'create') rmSync(descriptor, { force: true });
  const actual = descriptorFromApk(apk, aapt, apksigner, execute);
  if (command === 'create') {
    const temporary = join(dirname(apk), `.notify-update-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, `${JSON.stringify(actual, null, 2)}\n`, { flag: 'wx' });
      renameSync(temporary, descriptor);
    } finally { rmSync(temporary, { force: true }); }
  } else {
    const published = JSON.parse(readFileSync(descriptor, 'utf8'));
    assert.deepEqual(published, actual, 'descriptor differs from verified APK');
  }
  return actual;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    run(...process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
