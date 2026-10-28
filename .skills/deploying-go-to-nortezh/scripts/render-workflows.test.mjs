import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderWorkflows, makePlan, applyPlan } from './render-workflows.mjs';

const script = fileURLToPath(new URL('./render-workflows.mjs', import.meta.url));
const clone = value => structuredClone(value);
const entry = (app = 'catalog', environment = 'production', kind = 'push') => ({
  file: `${app}-${environment === 'production' ? 'prod' : environment}.yaml`,
  name: `Deploy ${app[0].toUpperCase() + app.slice(1)} Service To ${environment[0].toUpperCase() + environment.slice(1)}`,
  app, environment, imageSuffix: `${app}-${environment}`, outputId: `${app}_api`, dockerfile: `./build/${app}/Dockerfile`,
  trigger: { kind, ...kind === 'push' ? { branch: 'main' } : {}, manual: kind !== 'release' },
  ...kind === 'push' ? { paths: [`.github/workflows/${app}-${environment === 'production' ? 'prod' : environment}.yaml`, `${app}/**`, `build/${app}/**`, 'pkg/**', `cmd/${app}/**`, 'go.mod', 'go.sum'] } : {},
  nortezh: { project: environment === 'production' ? 'example-production' : 'example-staging', location: 'example-0', name: `${app}-api`, type: 'WebService' },
  secrets: { email: environment === 'production' ? 'NTZ_SVA_EMAIL_PROD' : 'NTZ_SVA_EMAIL', key: environment === 'production' ? 'NTZ_SVA_KEY_PROD' : 'NTZ_SVA_KEY' },
});
function project(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nick-nortezh-test-'));
  try { return fn(root); } finally {
    const real = fs.realpathSync(root);
    assert.equal(path.dirname(real), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(real).startsWith('nick-nortezh-test-'));
    fs.rmSync(real, { recursive: true, force: true });
  }
}
function prepare(root, entries) {
  for (const item of entries) {
    const file = path.resolve(root, item.dockerfile);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '# synthetic Dockerfile fixture\n');
  }
}

const apiStaging = entry('catalog', 'staging'); apiStaging.nortezh.name = 'example-catalog-api-stg';
const apiProduction = entry('catalog', 'production', 'release'); apiProduction.nortezh.name = 'example-catalog-api';
const worker = entry('processor', 'staging'); worker.name = 'Deploy Processor To Staging'; worker.outputId = 'processor'; worker.paths.splice(1, 1); worker.nortezh = { ...worker.nortezh, name: 'example-processor-stg', type: 'Worker' };
const goldenEntries = [apiStaging, apiProduction, worker];
const goldens = [
  ['catalog-staging.yaml', apiStaging, 'c798fce076a65750a634f6842ef8e8b663878f923ff40c1e626f28a9a6b29b66'],
  ['catalog-prod.yaml', apiProduction, '8ea91849d7c6397e21c98b4b8dfd844e2742cf7ba0d29c6274935c283f7a4929'],
  ['processor-staging.yaml', worker, 'b9cd7e495d7ac972a7f65aa56af4cf987a60ab3a4a39cb06df837a15976836c0'],
];
test('first-use instructions require an explicit PR-test CI decision; templates never enable it by default', () => {
  const firstUse = fs.readFileSync(new URL('../references/first-use-and-confirmation.md', import.meta.url), 'utf8');
  assert.ok(firstUse.includes('Should CI run tests when a pull request is opened or updated?'));
  assert.ok(firstUse.includes('Do not interpret silence as either enable or disable'));
  assert.ok(firstUse.includes('automatic GitHub PR test execution'));
  assert.ok(firstUse.includes('Preserve existing checks'));
  for (const item of goldenEntries) {
    assert.doesNotMatch(renderWorkflows({ workflows: [item] })[0].content, /^  pull_request(?:_target)?:/m);
  }
});
for (const [filename, item, expected] of goldens) test(`golden: ${filename} matches the sanitized portable workflow shape`, () => {
  const result = renderWorkflows({ workflows: [item] })[0];
  assert.equal(createHash('sha256').update(result.content).digest('hex'), expected);
});

test('synthetic golden fixtures preserve the approved action order and output wiring', () => {
  for (const item of goldenEntries) {
    const content = renderWorkflows({ workflows: [item] })[0].content;
    const uses = [...content.matchAll(/^\s+- uses: ([^\n]+)|^\s+uses: ([^\n]+)/gm)].map(match => match[1] ?? match[2]);
    assert.deepEqual(uses, ['actions/checkout@v3', 'docker/setup-qemu-action@v2', 'docker/setup-buildx-action@v2', 'docker/login-action@v2', 'ASzc/change-string-case-action@v5', 'docker/build-push-action@v4', 'Nortezh/nortezh-action@v1.0.5']);
    assert.deepEqual([...content.matchAll(/^  ([a-z_]+):$/gm)].map(match => match[1]).filter(name => !['workflow_dispatch', 'push', 'release'].includes(name)), ['dockerize_n_push', 'deploy']);
    assert.ok(content.includes('image: ${{ needs.dockerize_n_push.outputs.image_name }}'));
    assert.ok(content.includes(`image_name: \${{ steps.${item.outputId}.outputs.image_name}}`));
    assert.doesNotMatch(content, /olufy-|workflows-example\//);
  }
});

test('prod-only, staging-only, and additional environments have no hardcoded trigger policy', () => {
  for (const env of ['production', 'staging', 'qa', 'preview']) {
    const item = entry('catalog', env); item.trigger.branch = `deploy/${env}`;
    const text = renderWorkflows({ workflows: [item] })[0].content;
    assert.ok(text.includes(`- deploy/${env}`)); assert.ok(!text.includes('workflow_call:'));
    assert.ok(!text.includes('  verify:')); assert.ok(!/__\w+__/.test(text));
  }
});
test('multiple applications and environments generate a full workflow per confirmed pair', () => {
  const entries = [entry('catalog'), entry('catalog', 'staging'), entry('processor', 'qa')];
  entries[2].nortezh.project = 'example-qa';
  assert.equal(renderWorkflows({ workflows: entries }).length, 3);
});
test('manual-only and no-manual push are explicit', () => {
  const item = entry(); item.trigger.manual = false;
  assert.ok(!renderWorkflows({ workflows: [item] })[0].content.includes('workflow_dispatch'));
  const manual = entry('catalog', 'production', 'manual');
  const text = renderWorkflows({ workflows: [manual] })[0].content;
  assert.ok(text.includes('workflow_dispatch:')); assert.doesNotMatch(text, /^  push:/m);
});
test('release/manual branch filters are rejected instead of silently pretending to restrict refs', () => {
  for (const kind of ['release', 'manual']) {
    const item = entry('catalog', 'production', kind); item.trigger.branch = 'main';
    assert.throws(() => renderWorkflows({ workflows: [item] }), /branch\/path filtering/);
  }
});
test('WebService optional confirmed port; Worker never receives port', () => {
  const item = entry(); item.nortezh.port = 8787;
  assert.ok(renderWorkflows({ workflows: [item] })[0].content.includes('          port: 8787'));
  for (const port of [0, 65536, '8080', null]) {
    item.nortezh.port = port; assert.throws(() => renderWorkflows({ workflows: [item] }), /port/);
  }
  item.nortezh.type = 'Worker'; item.nortezh.port = 80;
  assert.throws(() => renderWorkflows({ workflows: [item] }), /port/);
});
test('colliding filenames, app/env pairs, targets, and image suffixes fail closed', () => {
  for (const mode of ['file', 'pair', 'target', 'image']) {
    const a = entry(), b = entry('catalog', 'staging');
    if (mode === 'file') b.file = a.file;
    if (mode === 'pair') b.environment = a.environment;
    if (mode === 'target') b.nortezh = clone(a.nortezh);
    if (mode === 'image') b.imageSuffix = a.imageSuffix;
    assert.throws(() => renderWorkflows({ workflows: [a, b] }));
  }
});
test('invalid or secret-value-shaped fields, injection, path escape, and unknown keys fail', () => {
  for (const change of [
    x => x.file = '../prod.yaml', x => x.name = 'Bad\non: push', x => x.outputId = 'repository',
    x => x.dockerfile = '../Dockerfile', x => x.secrets.key = 'secret-value-goes-here',
    x => x.nortezh.type = 'Anything', x => x.trigger.branch = '*', x => delete x.trigger.manual,
    x => x.paths = ['../outside'], x => x.nortezh.token = 'not-allowed', x => x.trigger.kind = 'pull_request_target',
  ]) { const item = entry(); change(item); assert.throws(() => renderWorkflows({ workflows: [item] })); }
});
test('dry-run writes nothing, approved apply creates files, repeat is zero-write', () => project(root => {
  const config = { workflows: [entry()] }; prepare(root, config.workflows);
  const plan = makePlan(root, config); assert.ok(!fs.existsSync(path.join(root, '.github')));
  assert.throws(() => applyPlan(plan, false), /approved/);
  assert.deepEqual(applyPlan(plan, true), ['.github/workflows/catalog-prod.yaml']);
  assert.deepEqual(applyPlan(makePlan(root, config), true), []);
}));
test('missing Dockerfile, existing conflicts, and post-plan modifications preserve files', () => project(root => {
  const config = { workflows: [entry()] };
  assert.throws(() => makePlan(root, config), /Missing/); prepare(root, config.workflows);
  applyPlan(makePlan(root, config), true);
  const plan = makePlan(root, config), target = path.join(root, '.github/workflows/catalog-prod.yaml');
  fs.appendFileSync(target, '\n# local work\n');
  assert.throws(() => applyPlan(plan, true), /changed after/);
  assert.throws(() => applyPlan(makePlan(root, config), true), /conflict/);
  assert.ok(fs.readFileSync(target, 'utf8').endsWith('# local work\n'));
}));
test('workflow appearing after dry-run is never overwritten', () => project(root => {
  const config = { workflows: [entry()] }; prepare(root, config.workflows);
  const plan = makePlan(root, config), target = path.join(root, '.github/workflows/catalog-prod.yaml');
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, 'owned by another task\n');
  assert.throws(() => applyPlan(plan, true), /appeared after/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'owned by another task\n');
}));
test('all targets are preflighted before creating any workflow', () => project(root => {
  const entries = [entry(), entry('processor')]; prepare(root, entries);
  const target = path.join(root, '.github/workflows/processor-prod.yaml');
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, '# preserve custom workflow\n');
  const plan = makePlan(root, { workflows: entries });
  assert.throws(() => applyPlan(plan, true), /conflict/);
  assert.ok(!fs.existsSync(path.join(root, '.github/workflows/catalog-prod.yaml')));
}));
test('hardlinked workflow cannot edit an outside file', () => project(root => project(outside => {
  const config = { workflows: [entry()] }; prepare(root, config.workflows);
  const original = path.join(outside, 'original.yaml'), target = path.join(root, '.github/workflows/catalog-prod.yaml');
  fs.writeFileSync(original, '# unrelated data\n'); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.linkSync(original, target);
  assert.throws(() => makePlan(root, config), /hardlinked/);
  assert.equal(fs.readFileSync(original, 'utf8'), '# unrelated data\n');
})));
test('symlink/junction escape is refused before writes', t => project(root => project(outside => {
  const config = { workflows: [entry()] }; prepare(root, config.workflows);
  try { fs.symlinkSync(outside, path.join(root, '.github'), 'junction'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip(error.code); return; } throw error; }
  assert.throws(() => makePlan(root, config), /symlink\/junction/); assert.deepEqual(fs.readdirSync(outside), []);
})));
test('CLI approval creates actual workflows, not merely a proposed model/name table', () => project(root => {
  const config = { workflows: [entry()] }; prepare(root, config.workflows);
  const filename = path.join(root, 'plan.json'); fs.writeFileSync(filename, JSON.stringify(config));
  const args = [script, '--project', root, '--config', filename];
  const denied = spawnSync(process.execPath, [...args, '--apply'], { encoding: 'utf8', timeout: 15000 });
  assert.notEqual(denied.status, 0); assert.ok(!fs.existsSync(path.join(root, '.github')));
  const result = spawnSync(process.execPath, [...args, '--apply', '--approved'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).written.length, 1);
  assert.ok(fs.existsSync(path.join(root, '.github/workflows/catalog-prod.yaml')));
}));
