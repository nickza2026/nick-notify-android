import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/android-apk.yaml', import.meta.url), 'utf8');
const gradle = readFileSync(new URL('../app/build.gradle.kts', import.meta.url), 'utf8');
const applicationId = gradle.match(/applicationId\s*=\s*"([^"]+)"/)[1];
const versionCode = gradle.match(/versionCode\s*=\s*(\d+)/)[1];
const versionName = gradle.match(/versionName\s*=\s*"([^"]+)"/)[1];
const artifact = `notify-alarm-${versionName}-debug.apk`;
// Public certificate pin of the existing Pixel build; no key is read or generated.
const approvedSigner = '79c26a1c9329aa69933eada6c5e13b7718d43ae1da90120de639fe23f10cc9d4';
const badging = `package: name='${applicationId}' versionCode='${versionCode}' versionName='${versionName}'`;
const step = workflow.split('      - name: Check version and matching certificate before upload')[1]?.split(/^      - /m)[0];
assert.ok(step, 'missing APK verification step');
const script = step.match(/^        run: \|\r?\n([\s\S]*)/m)[1].split(/\r?\n/).map(line => line.slice(10)).join('\n');
const gitExecPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
const bash = process.platform === 'win32' ? resolve(gitExecPath, '../../../usr/bin/bash.exe') : 'bash';
const slash = value => value.replaceAll('\\', '/');

function runGuard(t, options = {}) {
  // Each case owns a fresh directory and only synthetic tool/APK files.
  const root = mkdtempSync(join(tmpdir(), 'notify-apk-guard-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }));
  const tools = join(root, 'sdk/build-tools/36.0.0');
  const runner = join(root, 'runner');
  const apkDirectory = join(root, 'app/build/outputs/apk/debug');
  for (const dir of [tools, runner, apkDirectory]) mkdirSync(dir, { recursive: true });
  const content = 'SYNTHETIC APK FIXTURE, NOT AN INSTALLABLE APK';
  if (!options.missing) writeFileSync(join(apkDirectory, 'app-debug.apk'), content);
  writeFileSync(join(tools, 'aapt'), '#!/usr/bin/env bash\nprintf "%s\\n" "$SYNTHETIC_BADGING"\nexit "$SYNTHETIC_AAPT_EXIT"\n', { mode: 0o755 });
  writeFileSync(join(tools, 'apksigner'), '#!/usr/bin/env bash\nprintf "Signer #1 certificate SHA-256 digest: %s\\n" "$SYNTHETIC_SIGNER"\nexit "$SYNTHETIC_SIGNER_EXIT"\n', { mode: 0o755 });
  const result = spawnSync(bash, ['-s'], {
    // Git Bash launched from Windows can otherwise select the WSL bash stub
    // through /usr/bin/env in our synthetic SDK tools. Scope PATH to this child.
    input: 'export PATH="/usr/bin:/bin:$PATH"\n' + script,
    cwd: root, encoding: 'utf8', timeout: 5000,
    env: {
      PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT,
      HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
      ANDROID_HOME: slash(join(root, 'sdk')), RUNNER_TEMP: slash(runner),
      SYNTHETIC_BADGING: options.badging ?? badging,
      SYNTHETIC_SIGNER: options.signer ?? approvedSigner,
      SYNTHETIC_AAPT_EXIT: String(options.aaptExit ?? 0),
      SYNTHETIC_SIGNER_EXIT: String(options.signerExit ?? 0),
    },
  });
  assert.ifError(result.error);
  assert.doesNotMatch(result.stderr, /execvpe|command not found|Permission denied|WSL \(/i, 'fixture infrastructure must execute, not masquerade as rejection');
  return { ...result, runner, content };
}

test('current Gradle version and approved signer pass the actual upload gate', t => {
  const result = runGuard(t);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(result.runner, artifact), 'utf8'), result.content);
});

for (const [name, options] of [
  ['previous release', { badging: `package: name='${applicationId}' versionCode='6' versionName='0.6.0-safety-poc'` }],
  ['old version code', { badging: badging.replace(`versionCode='${versionCode}'`, "versionCode='6'") }],
  ['different version name', { badging: badging.replace(`versionName='${versionName}'`, "versionName='0.0.0-wrong'") }],
  ['different package', { badging: badging.replace(applicationId, 'dev.wrong.application') }],
  ['different signer', { signer: '0'.repeat(64) }],
  ['missing APK', { missing: true }],
  ['aapt failure even with plausible metadata', { aaptExit: 1 }],
  ['apksigner failure even with the approved digest', { signerExit: 1 }],
]) {
  test(`upload gate rejects ${name} without producing an artifact`, t => {
    const result = runGuard(t, options);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(result.runner, artifact)), false);
  });
}

test('artifact name/path agree with Gradle and only a successful guard can upload', () => {
  assert.ok(workflow.includes(`name: ${artifact.slice(0, -4)}-` + '${{ github.sha }}'));
  assert.ok(workflow.includes('path: ${{ runner.temp }}/' + artifact));
  const upload = workflow.split('      - uses: actions/upload-artifact@v4')[1]?.split(/^      - /m)[0];
  assert.ok(upload);
  assert.doesNotMatch(upload, /\bif:/, 'do not upload on a failed verification step');
  assert.match(upload, /if-no-files-found: error/);
});

test('APK remains manual-only, main-only for signing, and both certificate pins stay unchanged', () => {
  const events = workflow.match(/^on:\r?\n([\s\S]*?)(?=^\S)/m)[1];
  assert.deepEqual([...events.matchAll(/^  ([a-z_]+):/gm)].map(match => match[1]), ['workflow_dispatch']);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
  assert.equal(workflow.split(approvedSigner).length - 1, 2);
  assert.ok(workflow.includes(`if [ "$fingerprint" != '${approvedSigner}' ]`));
  assert.ok(workflow.includes(`if [ "$signer" != '${approvedSigner}' ]`));
  assert.match(workflow, /needs: verify/);
  assert.match(workflow, /NOTIFY_CI_DEBUG_KEYSTORE/);
  assert.match(workflow, /if: always\(\)/);
});

test('manual APK verification runs this regression suite before compiling or using signing secrets', () => {
  const verification = workflow.split(/^  verify:/m)[1]?.split(/^  device-apk:/m)[0];
  assert.ok(verification);
  const guard = verification.indexOf('node --test tools/test-android-apk-workflow.mjs');
  assert.ok(guard >= 0);
  assert.ok(guard < verification.indexOf('./gradlew'));
  assert.match(verification, /node-version: 22\.23\.4/);
  assert.doesNotMatch(verification, /secrets\./);
});
