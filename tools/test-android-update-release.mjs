import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { APK_ASSET, DESCRIPTOR_ASSET, MAX_SIZE, SIGNER, VERSION_CODE, VERSION_NAME, run } from './android-update-release.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'notify-update-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const apk = join(dir, APK_ASSET);
  const aapt = join(dir, 'aapt');
  const signer = join(dir, 'apksigner');
  writeFileSync(apk, 'synthetic fixture, not an installable APK');
  writeFileSync(aapt, 'synthetic tool');
  writeFileSync(signer, 'synthetic tool');
  return { dir, apk, aapt, signer, descriptor: join(dir, DESCRIPTOR_ASSET) };
}

function sdk(f, { packageName = 'dev.notifyalarm', versionCode = VERSION_CODE, versionName = VERSION_NAME, pin = SIGNER, fail = '' } = {}) {
  return (exe, args) => {
    assert.equal(args.at(-1), f.apk);
    if (exe === fail) throw new Error('tool failed');
    if (exe === f.aapt) {
      assert.deepEqual(args.slice(0, 2), ['dump', 'badging']);
      return `package: name='${packageName}' versionCode='${versionCode}' versionName='${versionName}'\n`;
    }
    assert.equal(exe, f.signer);
    assert.deepEqual(args.slice(0, 2), ['verify', '--print-certs']);
    return `Signer #1 certificate SHA-256 digest: ${pin}\n`;
  };
}

test('descriptor produced only from validated payload and exact schema', t => {
  const f = fixture(t);
  const actual = run('create', f.apk, f.aapt, f.signer, sdk(f));
  assert.deepEqual(JSON.parse(readFileSync(f.descriptor, 'utf8')), actual);
  assert.deepEqual(Object.keys(actual), ['schema_version', 'application_id', 'version_code', 'version_name', 'apk_asset', 'apk_sha256', 'apk_size', 'signing_cert_sha256']);
  assert.equal(actual.apk_sha256, createHash('sha256').update(readFileSync(f.apk)).digest('hex'));
  assert.equal(actual.apk_size, readFileSync(f.apk).length);
  assert.deepEqual(run('verify', f.apk, f.aapt, f.signer, sdk(f)), actual);
  assert.equal(MAX_SIZE, 134217728);
});

for (const [name, changes] of [
  ['wrong package', { packageName: 'dev.wrong' }],
  ['wrong version code', { versionCode: 7 }],
  ['wrong version name', { versionName: '0.7.0-device-login' }],
  ['wrong certificate', { pin: '0'.repeat(64) }],
]) {
  test(`rejects ${name} and retires a previously valid descriptor`, t => {
    const f = fixture(t);
    run('create', f.apk, f.aapt, f.signer, sdk(f));
    assert.ok(existsSync(f.descriptor));
    assert.throws(() => run('create', f.apk, f.aapt, f.signer, sdk(f, changes)));
    assert.equal(existsSync(f.descriptor), false, 'failed creation must not leave a valid stale output');
  });
}

test('failed SDK acquisition and stale metadata cannot produce a new descriptor', t => {
  const f = fixture(t);
  assert.throws(() => run('create', f.apk, join(f.dir, 'missing-aapt'), f.signer), /Android SDK verification failed/);
  for (const fail of [f.aapt, f.signer]) {
    run('create', f.apk, f.aapt, f.signer, sdk(f));
    assert.throws(() => run('create', f.apk, f.aapt, f.signer, sdk(f, { fail })));
    assert.equal(existsSync(f.descriptor), false);
  }
  run('create', f.apk, f.aapt, f.signer, sdk(f));
  writeFileSync(f.apk, 'modified APK');
  assert.throws(() => run('verify', f.apk, f.aapt, f.signer, sdk(f)), /descriptor differs/);
  writeFileSync(f.descriptor, JSON.stringify({ schema_version: 1 }));
  assert.throws(() => run('verify', f.apk, f.aapt, f.signer, sdk(f)), /descriptor differs/);
});

test('APK size limits reject zero and greater than 128 MiB', t => {
  const f = fixture(t);
  truncateSync(f.apk, 0);
  assert.throws(() => run('create', f.apk, f.aapt, f.signer, sdk(f)), /size bounds/);
  truncateSync(f.apk, MAX_SIZE + 1);
  assert.throws(() => run('create', f.apk, f.aapt, f.signer, sdk(f)), /size bounds/);
});

test('payload mutation during SDK inspection cannot acquire a fresh descriptor', t => {
  const f = fixture(t);
  run('create', f.apk, f.aapt, f.signer, sdk(f));
  const execute = sdk(f);
  assert.throws(() => run('create', f.apk, f.aapt, f.signer, (exe, args) => {
    const output = execute(exe, args);
    if (exe === f.signer) {
      const bytes = readFileSync(f.apk);
      bytes[0] ^= 1;
      writeFileSync(f.apk, bytes);
    }
    return output;
  }), /APK changed/);
  assert.equal(existsSync(f.descriptor), false);
});

test('release producer version remains aligned with the actual Gradle app version', () => {
  const gradle = readFileSync(new URL('../app/build.gradle.kts', import.meta.url), 'utf8');
  assert.equal(gradle.match(/versionCode\s*=\s*(\d+)/)[1], String(VERSION_CODE));
  assert.equal(gradle.match(/versionName\s*=\s*"([^"]+)"/)[1], VERSION_NAME);
});

test('workflow manual release has least privilege and no automatic publication', () => {
  const workflow = readFileSync(new URL('../.github/workflows/android-apk.yaml', import.meta.url), 'utf8');
  assert.match(workflow, /publish_update:[\s\S]*?default: false/);
  assert.match(workflow, /^permissions:\r?\n  contents: read/m);
  assert.match(workflow, /publish-update:[\s\S]*?if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && inputs\.publish_update == true\s+needs: device-apk/);
  assert.match(workflow, /publish-update:[\s\S]*?permissions:\s+contents: write/);
  const escapedAsset=APK_ASSET.slice(0,-4).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  assert.match(workflow, new RegExp(`actions/download-artifact@v4[\\s\\S]*?name: ${escapedAsset}-\\$\\{\\{ github\\.sha \\}\\}`));
  assert.match(workflow, /gh release create "\$tag"[\s\S]*?--target "\$GITHUB_SHA"/);
  assert.match(workflow, /git ls-remote --exit-code origin "refs\/tags\/\$tag"/);
  assert.match(workflow, /gh api --method POST "repos\/\$GITHUB_REPOSITORY\/git\/refs"[\s\S]*?-f "ref=refs\/tags\/\$tag" -f "sha=\$GITHUB_SHA"/);
  assert.match(workflow, /--target "\$GITHUB_SHA" --verify-tag/);
  assert.match(workflow, /concurrency:\s+group: android-update-release-\$\{\{ github\.repository \}\}\s+cancel-in-progress: false/);
  assert.doesNotMatch(workflow.match(/^on:\r?\n([\s\S]*?)(?=^permissions:)/m)[1], /^  (push|pull_request|release):/m);
});

for (const racing of [false, true]) {
  test(`actual publisher ${racing ? 'aborts when tag is concurrently reserved' : 'reserves exact SHA before creating release'}`, t => {
    const f = fixture(t);
    const workflow = readFileSync(new URL('../.github/workflows/android-apk.yaml', import.meta.url), 'utf8');
    const step = workflow.split('      - name: Create stable release only if tag is unused')[1];
    const script = step.match(/        run: \|\r?\n([\s\S]*)/)[1].split(/\r?\n/).map(line => line.slice(10)).join('\n');
    const gitExec = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
    const bash = process.platform === 'win32' ? resolve(gitExec, '../../../usr/bin/bash.exe') : 'bash';
    const prefix = `
git() { return 2; }
gh() {
  if [ "$1" = api ]; then
    printf '%s\\n' "$*" > "$RUNNER_TEMP/tag-attempt"
    if [ "$SYNTHETIC_TAG_RACE" = 1 ]; then return 1; fi
    return 0
  fi
  if [ "$1" = release ] && [ "$2" = create ]; then
    test -s "$RUNNER_TEMP/tag-attempt" || return 90
    printf '%s\\n' "$*" > "$RUNNER_TEMP/release-attempt"
    return 0
  fi
  return 91
}
`;
    const result = spawnSync(bash, ['-s'], {
      input: prefix + script, cwd: f.dir, encoding: 'utf8', timeout: 5000,
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE, RUNNER_TEMP: f.dir.replaceAll('\\', '/'),
        GITHUB_REPOSITORY: 'synthetic/repo', GITHUB_SHA: '1'.repeat(40),
        SYNTHETIC_TAG_RACE: racing ? '1' : '0' },
    });
    assert.ifError(result.error);
    assert.equal(result.status, racing ? 1 : 0, result.stdout + result.stderr);
    const tag = readFileSync(join(f.dir, 'tag-attempt'), 'utf8');
    assert.ok(tag.includes('--method POST repos/synthetic/repo/git/refs'));
    assert.ok(tag.includes(`ref=refs/tags/android-v${VERSION_NAME}`));
    assert.ok(tag.includes('sha=' + '1'.repeat(40)));
    assert.equal(existsSync(join(f.dir, 'release-attempt')), !racing);
    if (!racing) assert.ok(readFileSync(join(f.dir, 'release-attempt'), 'utf8').includes('--verify-tag'));
  });
}
