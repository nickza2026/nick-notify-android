import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { renderWorkflows } from '../.skills/deploying-go-to-nortezh/scripts/render-workflows.mjs';

const read = name => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
const matrix = JSON.parse(readFileSync(new URL('../docs/deployment/nortezh-workflows.json', import.meta.url), 'utf8'));
// Explicit human-approved compatibility exceptions; do not loosen the installed
// skill template/goldens or allow arbitrary action/version changes.
const approvedOverrides = {
  'actions/checkout@v3': 'actions/checkout@v4',
  'docker/setup-qemu-action@v2': 'docker/setup-qemu-action@v3',
  'docker/setup-buildx-action@v2': 'docker/setup-buildx-action@v3',
  'docker/login-action@v2': 'docker/login-action@v3',
  'docker/build-push-action@v4': 'docker/build-push-action@v6',
  'ASzc/change-string-case-action@v5': 'ASzc/change-string-case-action@v6',
};
const block = (text, key, indent = '') => {
  const match = text.match(new RegExp(`^${indent}${key}:\\r?\\n([\\s\\S]*?)(?=^${indent}[^\\s#]|$(?![\\s\\S]))`, 'm'));
  assert.ok(match, `missing ${key}`);
  return match[1];
};
const job = (text, key) => block(text, key, '  ');
const scriptOf = (text, jobName, stepName) => {
  const name = stepName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const step = job(text, jobName).match(new RegExp(`^      - name: ${name}\\r?\\n([\\s\\S]*?)(?=^      - |^    [a-zA-Z_][a-zA-Z0-9_]*:|$(?![\\s\\S]))`, 'm'));
  assert.ok(step, `missing step ${stepName}`);
  const run = step[1].match(/^(\s*)run: \|\r?\n([\s\S]*)/m);
  assert.ok(run, `missing script ${stepName}`);
  return run[2].split('\n').map(line => line.slice(run[1].length + 2)).join('\n');
};
const gitExecPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
const bash = process.platform === 'win32' ? resolve(gitExecPath, '../../../usr/bin/bash.exe') : 'bash';
// A non-login Git Bash may omit mingw64/bin. Select the real Git executable
// for read-only revision checks; do not alter host PATH or Git configuration.
const runShell = (script, env = {}) => spawnSync(bash, ['-s'], {
  input: process.platform === 'win32' ? 'git() { "$TEST_GIT_BINARY" "$@"; }\n' + script : script,
  encoding: 'utf8', timeout: 5000,
  env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE, TEST_GIT_BINARY: resolve(gitExecPath, '../../bin/git.exe'), ...env },
});
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const mainGuard = "github.event_name == 'push' && github.ref == 'refs/heads/main'";

test('recorded matrix retains approved destinations, production/main, no PR tests and manual build-only', () => {
  assert.equal(matrix.templateCommit, '4a70d2fa56ad0257b0f728fa594e86da468d8f6f');
  assert.equal(matrix.policy.prTests, false);
  assert.equal(matrix.policy.manual, 'build-only');
  assert.deepEqual(matrix.workflows.map(w => [w.app, w.nortezh.name, w.nortezh.port]), [
    ['api', 'notify-alarm-api', 8787], ['web', 'notify-alarm-web', 3010],
  ]);
  for (const w of matrix.workflows) {
    assert.equal(w.nortezh.project, 'internal-tools');
    assert.equal(w.nortezh.location, 'olufy-0');
    assert.equal(w.nortezh.type, 'WebService');
    assert.deepEqual(w.trigger, { kind: 'push', branch: 'main', manual: true });
    assert.equal(w.environment, 'production');
    assert.ok(existsSync(new URL(`../${w.dockerfile}`, import.meta.url)));
  }
});

test('approved action runtime overrides are exact and no obsolete template versions remain active', () => {
  assert.deepEqual(matrix.actionVersionOverrides, approvedOverrides);
  for (const w of matrix.workflows) {
    const actions = new Set([...read(w.file).matchAll(/uses: (\S+)/g)].map(m => m[1]));
    for (const [obsolete, approved] of Object.entries(approvedOverrides)) {
      assert.ok(actions.has(approved), `${w.app}: missing approved compatibility action ${approved}`);
      assert.ok(!actions.has(obsolete), `${w.app}: obsolete runtime remains active ${obsolete}`);
    }
    assert.ok(actions.has('Nortezh/nortezh-action@v1.0.5'));
  }
});

for (const w of matrix.workflows) {
  test(`${w.app}: standalone two-job layout, template action order, approved paths and outputs`, () => {
    assert.ok(existsSync(new URL(`../.github/workflows/${w.file}`, import.meta.url)), `${w.app}: standalone workflow must replace caller/reusable layout`);
    const text = read(w.file);
    assert.deepEqual([...block(text, 'jobs').matchAll(/^  ([a-z_]+):/gm)].map(m => m[1]), ['dockerize_n_push', 'deploy']);
    assert.deepEqual([...block(text, 'on').matchAll(/^  ([a-z_]+):/gm)].map(m => m[1]).sort(), ['push', 'workflow_dispatch']);
    assert.match(text, /push:\s+branches:\s+- main/);
    for (const path of w.paths) assert.ok(block(text, 'on').includes(JSON.stringify(path)), path);
    assert.doesNotMatch(text, /pull_request|workflow_call|secrets: inherit|uses: \.\/\.github/);
    assert.match(block(text, 'concurrency'), /cancel-in-progress: \$\{\{ github\.event_name != 'push' \|\| github\.ref != 'refs\/heads\/main' \}\}/);
    const build = job(text, 'dockerize_n_push');
    const deploy = job(text, 'deploy');
    assert.match(build, /attestations: write/);
    assert.match(build, /ref: \$\{\{ github\.sha \}\}/);
    assert.match(build, /persist-credentials: false/);
    assert.doesNotMatch(build, /secrets\.NTZ_|environment:/);
    assert.ok(deploy.includes(`if: ${mainGuard}`));
    assert.match(deploy, /needs: dockerize_n_push/);
    assert.ok(deploy.includes(`environment: ${w.githubEnvironment}`));
    assert.ok(text.includes(`image_name: \${{ steps.${w.outputId}.outputs.image_name}}`));
    assert.match(deploy, /image: \$\{\{ needs\.dockerize_n_push\.outputs\.image_name \}\}/);
    assert.ok(deploy.includes(`project: ${w.nortezh.project}`));
    assert.ok(deploy.includes(`location: ${w.nortezh.location}`));
    assert.ok(deploy.includes(`name: ${w.nortezh.name}`));
    assert.ok(deploy.includes(`port: ${w.nortezh.port}`));
    assert.ok(deploy.includes(`SA_AUTH_EMAIL: \${{ secrets.${w.secrets.email} }}`));
    assert.ok(deploy.includes(`SA_AUTH_KEY: \${{ secrets.${w.secrets.key} }}`));
    assert.doesNotMatch(text, /vars\.NTZ_|NTZ_RUNTIME_READY|approve-target/);
    // The portable renderer only accepts build/<app>/Dockerfile. Test the exact
    // canonical skeleton with a synthetic path, not by moving production files.
    const { githubEnvironment, context, ...portable } = w;
    const baseline = renderWorkflows({ workflows: [{ ...portable, dockerfile: `./build/${w.app}/Dockerfile` }] })[0].content;
    const canonical = [...baseline.matchAll(/uses: (\S+)/g)].map(m => m[1]);
    let previous = -1;
    for (const action of canonical) {
      const approved = approvedOverrides[action] ?? action;
      const at = text.indexOf(`uses: ${approved}`, previous + 1);
      assert.ok(at > previous, `${w.app}: preserve template action/order ${approved}`);
      previous = at;
    }
    assert.ok(build.includes(`string: \${{ github.repository }}/${w.imageSuffix}`));
    assert.match(build, /git rev-parse --short HEAD/);
    assert.ok(build.includes(`context: ${w.context}`));
    assert.ok(build.includes(`file: ${w.dockerfile}`));
    assert.ok(build.includes(`push: \${{ ${mainGuard} }}`));
    assert.match(build, /load: true/);
    assert.ok(build.indexOf('Test workflow contracts') < build.indexOf('Log in to GitHub Docker Registry'));
    const login = build.slice(build.indexOf('- name: Log in'), build.indexOf('- name: lowercase'));
    assert.ok(login.includes(`if: ${mainGuard}`));
    assert.ok(build.indexOf('Verify application container') < build.indexOf('Set output variables'));
  });
}

test('source guard rejects topic pushes, PR/release events and mismatched source revisions', () => {
  for (const w of matrix.workflows) {
    const script = scriptOf(read(w.file), 'dockerize_n_push', 'Validate source event');
    const base = { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: head };
    const valid = runShell(script, base);
    assert.equal(valid.status, 0, valid.stderr + valid.stdout);
    assert.equal(runShell(script, { ...base, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/topic' }).status, 0);
    for (const bad of [{ GITHUB_REF: 'refs/heads/topic' }, { GITHUB_EVENT_NAME: 'pull_request' },
      { GITHUB_EVENT_NAME: 'release', GITHUB_REF: 'refs/tags/v1' }, { GITHUB_SHA: 'b'.repeat(40) }]) {
      assert.notEqual(runShell(script, { ...base, ...bad }).status, 0);
    }
  }
});

test('credential validation names missing environment secrets without logging values', () => {
  for (const w of matrix.workflows) {
    const script = scriptOf(read(w.file), 'deploy', 'Validate Nortezh secrets');
    const valid = { NTZ_SA_EMAIL: 'synthetic@example.invalid', NTZ_SA_KEY: 'synthetic-not-for-logs' };
    assert.equal(runShell(script, valid).status, 0);
    for (const name of Object.keys(valid)) {
      const result = runShell(script, { ...valid, [name]: '' });
      assert.notEqual(result.status, 0);
      const output = result.stdout + result.stderr;
      assert.ok(output.includes(name));
      assert.ok(!output.includes(valid.NTZ_SA_EMAIL));
      assert.ok(!output.includes(valid.NTZ_SA_KEY));
    }
  }
});

test('job image output follows short-SHA template; manual is not publication and bad digests fail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notify-standalone-test-'));
  const output = join(dir, 'output'), summary = join(dir, 'summary');
  try {
    for (const w of matrix.workflows) {
      const script = scriptOf(read(w.file), 'dockerize_n_push', 'Set output variables')
        .replace(/\$\{\{\s*steps\.repository\.outputs\.lowercase\s*\}\}/g, `example/notify/${w.imageSuffix}`)
        .replace(/\$\{\{\s*steps\.short_sha\.outputs\.sha_short\s*\}\}/g, 'abcdef0');
      const env = { PUBLISHED: 'true', DIGEST: `sha256:${'c'.repeat(64)}`, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary };
      assert.equal(runShell(script, env).status, 0);
      assert.ok(readFileSync(output, 'utf8').includes(`image_name=ghcr.io/example/notify/${w.imageSuffix}:abcdef0`));
      assert.ok(readFileSync(summary, 'utf8').includes(env.DIGEST));
      unlinkSync(output); unlinkSync(summary);
      assert.equal(runShell(script, { ...env, PUBLISHED: 'false', DIGEST: '' }).status, 0);
      assert.ok(readFileSync(summary, 'utf8').includes('not published'));
      unlinkSync(output); unlinkSync(summary);
      assert.notEqual(runShell(script, { ...env, DIGEST: 'invalid' }).status, 0);
      assert.equal(existsSync(output), false);
    }
  } finally {
    for (const file of [output, summary]) if (existsSync(file)) unlinkSync(file);
    rmdirSync(dir);
  }
});

test('application tests precede build/push, Web smoke rejects foreign Host and retains runtime pins', () => {
  const api = job(read('api-production.yaml'), 'dockerize_n_push');
  const web = job(read('web-production.yaml'), 'dockerize_n_push');
  assert.match(api, /go test \.\/\.\.\. -count=1 -timeout=8m/);
  assert.match(api, /go vet \.\/\.\.\./);
  assert.match(web, /pnpm exec next typegen/);
  assert.match(web, /pnpm typecheck/);
  assert.match(web, /pnpm test/);
  assert.match(web, /pnpm build/);
  assert.match(web, /127\.0\.0\.1:3010:3010/);
  assert.match(web, /test "\$status" = 403/);
  for (const text of [api, web]) assert.match(text, /node-version: 22\.23\.4/);
  for (const path of ['api-ci.yaml', 'web-ci.yaml', 'deliver-go.yml', 'deliver-notify-api-nortezh.yml']) {
    assert.equal(existsSync(new URL(`../.github/workflows/${path}`, import.meta.url)), false);
  }
});

test('Web container smoke checks login and denies unauthenticated reads/send without backend secrets', () => {
  const script = scriptOf(read('web-production.yaml'), 'dockerize_n_push', 'Verify application container');
  assert.match(script, /DASHBOARD_PUBLIC_URL=http:\/\/127\.0\.0\.1:3010/);
  assert.match(script, /curl --fail --silent http:\/\/127\.0\.0\.1:3010\/login/);
  assert.ok((script.match(/test "\$status" = 401/g) ?? []).length >= 2);
  assert.match(script, /X-Notify-Request: dashboard/);
  assert.match(script, /\/api\/test-alerts/);
  assert.doesNotMatch(script, /BACKEND_API_KEY|FCM_DEVICE_TOKEN|GOOGLE_APPLICATION_CREDENTIALS/);
});

test('APK stays manual-only with signed main job and signer verification unchanged', () => {
  const text = read('android-apk.yaml');
  assert.deepEqual([...block(text, 'on').matchAll(/^  ([a-z_]+):/gm)].map(m => m[1]), ['workflow_dispatch']);
  assert.match(text, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
  assert.match(text, /79c26a1c9329aa69933eada6c5e13b7718d43ae1da90120de639fe23f10cc9d4/);
  assert.match(text, /NOTIFY_CI_DEBUG_KEYSTORE/);
});

test('all run steps parse as Bash without executing containers/providers', () => {
  let count = 0;
  for (const name of [...matrix.workflows.map(w => w.file), 'android-apk.yaml']) {
    const lines = read(name).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(\s*)run:\s*(.*)$/);
      if (!match) continue;
      let script = match[2];
      if (script === '|') {
        const part = [];
        while (i + 1 < lines.length) {
          const line = lines[i + 1];
          if (line.trim() && line.match(/^\s*/)[0].length <= match[1].length) break;
          part.push(line.slice(match[1].length + 2)); i++;
        }
        script = part.join('\n');
      }
      const result = spawnSync(bash, ['-n'], { input: script, encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 0, `${name}: ${result.stderr}`);
      count++;
    }
  }
  assert.ok(count >= 15);
});
