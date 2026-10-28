import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const read = name => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
const section = (text, key) => {
  const match = text.match(new RegExp(`^${key}:\\r?\\n([\\s\\S]*?)(?=^[^\\s#]|$(?![\\s\\S]))`, 'm'));
  assert.ok(match, `missing section ${key}`);
  return match[1];
};
const job = (text, name) => {
  const match = text.match(new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|$(?![\\s\\S]))`, 'm'));
  assert.ok(match, `missing job ${name}`);
  return match[1];
};

test('APK is manual-only; original signer/Firebase validation remains separate', () => {
  const text = read('android-apk.yaml');
  assert.match(section(text, 'on'), /^  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(section(text, 'on'), /^  (push|pull_request|release|workflow_call):/m);
  assert.match(job(text, 'device-apk'), /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
  assert.match(text, /79c26a1c9329aa69933eada6c5e13b7718d43ae1da90120de639fe23f10cc9d4/);
  assert.match(text, /NOTIFY_CI_DEBUG_KEYSTORE/);
});

for (const app of ['api', 'web']) {
  test(`${app}: main build then delivery, no PR runs, manual remains build-only`, () => {
    const text = read(`${app}-ci.yaml`);
    assert.match(section(text, 'on'), /push:\s+branches:\s+- main/);
    assert.doesNotMatch(section(text, 'on'), /^  pull_request(?:_target)?:/m);
    assert.deepEqual([...section(text, 'on').matchAll(/^  ([a-z_]+):/gm)]
      .map(match => match[1]).sort(), ['push', 'workflow_dispatch']);
    assert.match(section(text, 'on'), /workflow_dispatch:/);
    assert.match(section(text, 'permissions'), /^  contents: read/m);
    assert.doesNotMatch(section(text, 'permissions'), /packages: write/);
    assert.doesNotMatch(section(text, 'on'), /pull_request_target|release:/);
    assert.match(text, /tools\/test-delivery-workflows\.mjs/);
    assert.match(job(text, 'dockerize'), /needs: test/);
    assert.match(job(text, 'dockerize'), /push: false/);
    assert.match(job(text, 'dockerize'), /load: true/);
    assert.match(job(text, 'dockerize'), /docker save/);
    assert.match(job(text, 'dockerize'), /actions\/upload-artifact@/);
    assert.match(job(text, 'dockerize'), /overwrite: true/);
    const delivery = job(text, 'deliver');
    assert.match(delivery, /needs: dockerize/);
    assert.match(delivery, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
    assert.match(delivery, /packages: write/);
    assert.match(delivery, /uses: \.\/\.github\/workflows\/deliver-notify-api-nortezh\.yml/);
    assert.match(delivery, new RegExp(`app: ${app}\\s*$`, 'm'));
    assert.doesNotMatch(text, /secrets: inherit|secrets\./);
    assert.doesNotMatch(job(text, 'test') + job(text, 'dockerize'), /environment:|packages: write|docker\/login-action@/);
    assert.match(section(text, 'concurrency'), /cancel-in-progress: \$\{\{ github\.event_name != 'push' \|\| github\.ref != 'refs\/heads\/main' \}\}/);
    if (app === 'web') assert.match(job(text, 'dockerize'), /Smoke test non-root container and localhost guard/);
  });
}

test('shared delivery only accepts main pushes and allowlisted apps; no release guard', () => {
  const text = read('deliver-notify-api-nortezh.yml');
  const on = section(text, 'on');
  assert.match(on, /workflow_call:/);
  assert.doesNotMatch(on, /^  (push|pull_request|release|workflow_dispatch):/m);
  const source = job(text, 'source');
  assert.match(source, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(source, /\[\[ "\$GITHUB_EVENT_NAME" == push && "\$GITHUB_REF" == refs\/heads\/main \]\]/);
  assert.match(source, /api\)/);
  assert.match(source, /web\)/);
  assert.match(source, /\*\) exit 1/);
  assert.match(source, /notify-alarm-api/);
  assert.match(source, /notify-alarm-web/);
  assert.match(source, /8787/);
  assert.match(source, /3010/);
  assert.match(source, /environment=notify-%s-production/);
  assert.match(source, /GITHUB_SHA.*GITHUB_RUN_ID.*GITHUB_RUN_ATTEMPT/);
  assert.doesNotMatch(text, /refs\/tags|RELEASE_TAG|github\.event\.release/);
  assert.match(section(text, 'concurrency'), /cancel-in-progress: false/);
});

test('target/runtime and Web access checks precede publishing and repeat before deploy', () => {
  const text = read('deliver-notify-api-nortezh.yml');
  const approve = job(text, 'approve-target');
  const deploy = job(text, 'deploy');
  assert.match(approve, /needs: source/);
  assert.match(job(text, 'publish'), /needs: \[source, approve-target\]/);
  assert.match(deploy, /needs: \[source, publish\]/);
  for (const guarded of [approve, deploy]) {
    assert.match(guarded, /environment: \$\{\{ needs\.source\.outputs\.environment \}\}/);
    assert.match(guarded, /\[\[ "\$NTZ_PROJECT" == internal-tools \]\]/);
    assert.match(guarded, /\[\[ "\$NTZ_LOCATION" == olufy-0 \]\]/);
    assert.match(guarded, /\[\[ "\$NTZ_DEPLOYMENT" == "\$EXPECTED_TARGET" \]\]/);
    assert.match(guarded, /\[\[ "\$NTZ_PORT" == "\$EXPECTED_PORT" \]\]/);
    assert.match(guarded, /NTZ_EXISTING_TARGET_CONFIRMED.*== true/);
    assert.match(guarded, /NTZ_RUNTIME_READY.*== true/);
    assert.match(guarded, /if \[\[ "\$APP" == web \]\]; then/);
    assert.match(guarded, /NTZ_WEB_ACCESS_PROTECTED.*== true/);
  }
});

test('publish loads current run tested artifact, never rebuilds, and deploys exact tag', () => {
  const text = read('deliver-notify-api-nortezh.yml');
  const publish = job(text, 'publish');
  assert.match(publish, /actions\/download-artifact@/);
  assert.match(publish, /name: \$\{\{ needs\.source\.outputs\.artifact \}\}/);
  assert.doesNotMatch(publish, /run-id:|github-token:|docker build|docker\/build-push-action@/);
  assert.match(publish, /docker load --input/);
  assert.match(publish, /docker tag "\$LOCAL_IMAGE" "\$IMAGE"/);
  assert.match(publish, /docker push "\$IMAGE"/);
  assert.match(publish, /DIGEST|digest/);
  assert.match(job(text, 'deploy'), /image: \$\{\{ needs\.publish\.outputs\.image \}\}/);
  assert.doesNotMatch(job(text, 'source') + job(text, 'publish'), /secrets\.NTZ_/);
  assert.doesNotMatch(text, /secrets\.(DATABASE_URL|FCM_DEVICE_TOKEN|BACKEND_API_KEY)/);
  assert.equal(existsSync(new URL('../deploy/nortezh/notify-api-production.yml.example', import.meta.url)), false);
});

// Execute only the built-in-shell source/preflight steps, never Docker/registry/Nortezh.
const bash = process.platform === 'win32'
  ? resolve(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), '../../../usr/bin/bash.exe')
  : 'bash';
const scriptOf = (text, name) => {
  const body = job(text, name);
  const match = body.match(/^(\s*)run: \|\r?\n([\s\S]*?)(?=^      - |$(?![\s\S]))/m);
  assert.ok(match, `run script missing in ${name}`);
  return match[2].split('\n').map(line => line.slice(match[1].length + 2)).join('\n');
};
const syntheticSHA = 'a'.repeat(40);
const runShell = (script, env) => spawnSync(bash, ['-s'], {
  input: script, encoding: 'utf8', timeout: 5000,
  env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, ...env },
});

test('source shell accepts only main push and maps API/Web artifact, image and target', () => {
  const script = scriptOf(read('deliver-notify-api-nortezh.yml'), 'source');
  const dir = mkdtempSync(join(tmpdir(), 'notify-ci-source-'));
  const output = join(dir, 'output');
  try {
    for (const app of ['api', 'web']) {
      const result = runShell(script, { APP: app, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main',
        GITHUB_SHA: syntheticSHA, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2',
        GITHUB_REPOSITORY: 'Example/Notify', GITHUB_OUTPUT: output });
      assert.equal(result.status, 0, result.stderr);
      const text = readFileSync(output, 'utf8');
      assert.match(text, new RegExp(`target=notify-alarm-${app}`));
      assert.match(text, new RegExp(`environment=notify-${app}-production`));
      assert.ok(text.includes(`image=ghcr.io/example/notify/notify-${app}:${syntheticSHA}-123-2`));
      assert.match(text, new RegExp(`port=${app === 'api' ? 8787 : 3010}`));
      unlinkSync(output);
    }
    for (const [event, ref, app] of [['pull_request', 'refs/heads/main', 'api'],
      ['workflow_dispatch', 'refs/heads/main', 'api'], ['push', 'refs/heads/topic', 'web'],
      ['push', 'refs/heads/main', 'unknown']]) {
      const result = runShell(script, { APP: app, GITHUB_EVENT_NAME: event, GITHUB_REF: ref,
        GITHUB_SHA: syntheticSHA, GITHUB_OUTPUT: output });
      assert.notEqual(result.status, 0, `${event}/${ref}/${app} must not deliver`);
      assert.equal(existsSync(output), false, 'rejected source must not produce delivery outputs');
    }
  } finally {
    if (existsSync(output)) unlinkSync(output);
    rmdirSync(dir);
  }
});

test('source and preflight scripts parse; synthetic runtime/target/Web protection failures stop', () => {
  const text = read('deliver-notify-api-nortezh.yml');
  const script = scriptOf(text, 'approve-target');
  const env = { APP: 'api', EXPECTED_TARGET: 'notify-alarm-api', EXPECTED_PORT: '8787',
    NTZ_PROJECT: 'internal-tools', NTZ_LOCATION: 'olufy-0', NTZ_DEPLOYMENT: 'notify-alarm-api',
    NTZ_TYPE: 'WebService', NTZ_PORT: '8787', NTZ_EXISTING_TARGET_CONFIRMED: 'true',
    NTZ_RUNTIME_READY: 'true', NTZ_SA_EMAIL: 'synthetic@example.invalid', NTZ_SA_KEY: 'synthetic-not-a-key' };
  assert.equal(runShell(script, env).status, 0);
  for (const overrides of [{ NTZ_RUNTIME_READY: '' }, { NTZ_EXISTING_TARGET_CONFIRMED: '' },
    { NTZ_PROJECT: 'other' }, { NTZ_LOCATION: 'other' }, { NTZ_DEPLOYMENT: 'other' },
    { NTZ_PORT: '80' }, { NTZ_SA_KEY: '' }]) {
    assert.notEqual(runShell(script, { ...env, ...overrides }).status, 0);
  }
  const web = { ...env, APP: 'web', EXPECTED_TARGET: 'notify-alarm-web', EXPECTED_PORT: '3010',
    NTZ_DEPLOYMENT: 'notify-alarm-web', NTZ_PORT: '3010', NTZ_WEB_ACCESS_PROTECTED: 'false' };
  assert.notEqual(runShell(script, web).status, 0);
  assert.equal(runShell(script, { ...web, NTZ_WEB_ACCESS_PROTECTED: 'true' }).status, 0);
});

test('every API/Web/delivery/APK run step has valid Bash syntax (not executed)', () => {
  let checked = 0;
  for (const name of ['api-ci.yaml', 'web-ci.yaml', 'deliver-notify-api-nortezh.yml', 'android-apk.yaml']) {
    const lines = read(name).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(\s*)run:\s*(.*)$/);
      if (!match) continue;
      let script = match[2];
      if (script === '|') {
        const block = [];
        const indent = match[1].length;
        while (i + 1 < lines.length) {
          const next = lines[i + 1];
          if (next.trim() && next.match(/^\s*/)[0].length <= indent) break;
          block.push(next.slice(indent + 2));
          i++;
        }
        script = block.join('\n');
      }
      const result = spawnSync(bash, ['-n'], { input: script, encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 0, `${name}: ${result.stderr}`);
      checked++;
    }
  }
  assert.ok(checked >= 20, `expected all scripts, checked ${checked}`);
});

test('Node application images and Web CI use the verified Node 22 security patch', () => {
  const version = '22.23.4';
  const base = `node:${version}-bookworm-slim`;
  for (const [path, expectedStages] of [['Dockerfile', 1], ['dashboard/Dockerfile', 2]]) {
    const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const from = [...text.matchAll(/^FROM\s+(\S+)/gm)].map(match => match[1]);
    assert.equal(from.length, expectedStages);
    assert.deepEqual(from, Array(expectedStages).fill(base), `${path}: all stages must use the security patch`);
  }
  assert.ok(read('web-ci.yaml').includes(`node-version: ${version}`));
});
