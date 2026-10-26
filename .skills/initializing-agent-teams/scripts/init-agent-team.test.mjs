import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makePlan, applyPlan, parseArgs, roles } from './init-agent-team.mjs';

const script = fileURLToPath(new URL('./init-agent-team.mjs', import.meta.url));
const approved = { approved: true, capabilitiesConfirmed: true, piExtensionConfirmed: true };
function project(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nick-team-test-'));
  try { return run(root); } finally {
    const actual = fs.realpathSync(root);
    assert.equal(path.dirname(actual), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(actual).startsWith('nick-team-test-'));
    fs.rmSync(actual, { recursive: true, force: true });
  }
}
const options = (root, harness = 'cursor', extra = {}) => ({ project: root, harness, ...extra });
const read = (root, relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('exactly seven distinct prefixed backend roles, including DB/security', () => {
  assert.equal(roles.length, 7);
  assert.equal(new Set(roles.map(role => role.id)).size, 7);
  assert.equal(roles.find(role => role.id === 'db-reviewer').access, 'read');
  assert.equal(roles.find(role => role.id === 'security-reviewer').access, 'read');
});

for (const harness of ['cursor', 'codex', 'claude', 'letta', 'pi']) {
  test(`${harness}: dry-run renders selected adapter only and writes nothing`, () => project(root => {
    const plan = makePlan(options(root, harness));
    assert.equal(fs.readdirSync(root).length, 0);
    assert.equal(plan.files.length, harness === 'claude' ? 10 : 9);
    const definitions = plan.files.filter(file => file.relative.includes('/agents/'));
    assert.equal(definitions.length, 7);
    assert.ok(definitions.every(file => file.relative.startsWith(`.${harness}/agents/nick-`)));
    assert.ok(plan.files.every(file => file.status === 'create'));
    const scout = definitions.find(file => file.relative.includes('nick-scout.')).content;
    if (harness === 'codex') {
      assert.ok(scout.includes('developer_instructions = '));
      assert.ok(!scout.includes('model = "inherit"'));
      assert.ok(!scout.includes('sandbox_mode'));
    }
    if (harness === 'cursor') assert.ok(scout.includes('readonly: true'));
    if (harness === 'letta' || harness === 'pi') assert.ok(!scout.includes('\nmodel:'));
    if (harness === 'claude') assert.ok(plan.files.find(file => file.relative === 'CLAUDE.md').content.includes('@AGENTS.md'));
  }));

  test(`${harness}: approved apply is project-local and repeat is zero-write`, () => project(root => {
    const plan = makePlan(options(root, harness));
    assert.equal(applyPlan(plan, approved).length, plan.files.length);
    const contents = plan.files.map(file => read(root, file.relative));
    const repeat = makePlan(options(root, harness));
    assert.ok(repeat.files.every(file => file.status === 'unchanged'));
    assert.deepEqual(applyPlan(repeat, approved), []);
    assert.deepEqual(plan.files.map(file => read(root, file.relative)), contents);
    assert.equal(JSON.parse(read(root, `.agents/nick-skills/${harness}.json`)).nativeVerification, 'pending');
    for (const other of ['cursor', 'codex', 'claude', 'letta', 'pi']) {
      if (other !== harness) assert.ok(!fs.existsSync(path.join(root, `.${other}`)));
    }
  }));
}

test('apply requires both conversational approval and capability attestation', () => project(root => {
  const plan = makePlan(options(root));
  for (const flags of [{}, { approved: true }, { capabilitiesConfirmed: true }]) {
    assert.throws(() => applyPlan(plan, flags), /requires explicit/);
    assert.deepEqual(fs.readdirSync(root), []);
  }
}));

test('Pi apply refuses absent extension/trusted-scope confirmation', () => project(root => {
  assert.throws(() => applyPlan(makePlan(options(root, 'pi')), { approved: true, capabilitiesConfirmed: true }), /Pi requires/);
  assert.deepEqual(fs.readdirSync(root), []);
}));

test('a conflicting native definition prevents all planned writes', () => project(root => {
  fs.mkdirSync(path.join(root, '.cursor/agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.cursor/agents/nick-scout.md'), 'User-owned definition\n');
  const plan = makePlan(options(root));
  assert.throws(() => applyPlan(plan, approved), /Conflicts/);
  assert.equal(read(root, '.cursor/agents/nick-scout.md'), 'User-owned definition\n');
  assert.ok(!fs.existsSync(path.join(root, 'AGENTS.md')));
  assert.ok(!fs.existsSync(path.join(root, '.agents')));
}));

test('existing instructions require explicit append and keep original bytes', () => project(root => {
  const original = Buffer.from('\ufeff# Existing policy\r\nKeep my rules.\r\n');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), original);
  assert.throws(() => applyPlan(makePlan(options(root)), approved), /Conflicts/);
  assert.deepEqual(fs.readFileSync(path.join(root, 'AGENTS.md')), original);
  const opts = options(root, 'cursor', { appendEntrypoints: true });
  applyPlan(makePlan(opts), approved);
  assert.deepEqual(fs.readFileSync(path.join(root, 'AGENTS.md')).subarray(0, original.length), original);
  assert.equal(read(root, 'AGENTS.md').split('<!-- nick-skills:begin -->').length - 1, 1);
  assert.deepEqual(applyPlan(makePlan(opts), approved), []);
}));

test('Claude wrapper preserves existing instructions and uses actual import', () => project(root => {
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'Existing Claude policy.');
  const opts = options(root, 'claude', { appendEntrypoints: true });
  applyPlan(makePlan(opts), approved);
  assert.ok(read(root, 'CLAUDE.md').startsWith('Existing Claude policy.'));
  assert.ok(read(root, 'CLAUDE.md').includes('\n@AGENTS.md\n'));
  assert.deepEqual(applyPlan(makePlan(opts), approved), []);
}));

test('invalid models and unknown role keys are rejected without writes', () => project(root => {
  for (const models of [{ scout: null }, { scout: 'model\nreadonly: false' }, { scout: 'https://example.invalid' }, { scout: 'sk-fixture-not-a-secret' }, { stranger: 'inherit' }, []]) {
    assert.throws(() => makePlan(options(root, 'cursor', { models })));
    assert.deepEqual(fs.readdirSync(root), []);
  }
}));

test('explicit model IDs are serialized without pretending availability', () => project(root => {
  for (const harness of ['cursor', 'codex', 'claude', 'letta', 'pi']) {
    const plan = makePlan(options(root, harness, { models: { scout: 'fixture/model-v1' } }));
    const scout = plan.files.find(file => file.relative.includes('nick-scout.')).content;
    assert.ok(scout.includes('"fixture/model-v1"'));
    assert.equal(plan.models.implementer, 'inherit');
  }
}));

test('changed models conflict rather than silently replacing accepted choices', () => project(root => {
  applyPlan(makePlan(options(root)), approved);
  const original = read(root, '.cursor/agents/nick-scout.md');
  const plan = makePlan(options(root, 'cursor', { models: { scout: 'fixture/model-v2' } }));
  assert.throws(() => applyPlan(plan, approved), /Conflicts/);
  assert.equal(read(root, '.cursor/agents/nick-scout.md'), original);
}));

test('malformed or modified managed blocks are never overwritten', () => project(root => {
  for (const content of ['<!-- nick-skills:begin -->\n', '<!-- nick-skills:end -->\n<!-- nick-skills:begin -->\n', '<!-- nick-skills:begin -->\ncustom rules\n<!-- nick-skills:end -->\n']) {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), content);
    assert.throws(() => applyPlan(makePlan(options(root, 'cursor', { appendEntrypoints: true })), approved), /Conflicts/);
    assert.equal(read(root, 'AGENTS.md'), content);
    assert.ok(!fs.existsSync(path.join(root, '.cursor')));
  }
}));

test('native file changed after planning is detected before writes', () => project(root => {
  applyPlan(makePlan(options(root)), approved);
  const repeat = makePlan(options(root));
  fs.appendFileSync(path.join(root, '.cursor/agents/nick-scout.md'), '\nUnexpected new instructions.\n');
  assert.throws(() => applyPlan(repeat, approved), /changed after planning/);
}));

test('append baseline changed after planning is preserved', () => project(root => {
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Original\n');
  const plan = makePlan(options(root, 'cursor', { appendEntrypoints: true }));
  fs.appendFileSync(path.join(root, 'AGENTS.md'), 'New human work\n');
  assert.throws(() => applyPlan(plan, approved), /changed after planning/);
  assert.equal(read(root, 'AGENTS.md'), 'Original\nNew human work\n');
  assert.ok(!fs.existsSync(path.join(root, '.cursor')));
}));

test('target appearing after planning is preserved', () => project(root => {
  const plan = makePlan(options(root));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Another actor created this\n');
  assert.throws(() => applyPlan(plan, approved), /appeared after planning/);
  assert.ok(!fs.existsSync(path.join(root, '.cursor')));
}));

for (const directory of ['.cursor', '.agents']) {
  test(`junction/symlink escape through ${directory} is rejected`, t => project(root => project(outside => {
    try { fs.symlinkSync(outside, path.join(root, directory), 'junction'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip(error.code); return; } throw error; }
    assert.throws(() => makePlan(options(root)), /symlink\/junction/);
    assert.deepEqual(fs.readdirSync(outside), []);
  })));
}

test('hardlinked instruction target cannot modify a file outside project', t => project(root => project(outside => {
  const original = path.join(outside, 'policy.md');
  fs.writeFileSync(original, 'External policy\n');
  try { fs.linkSync(original, path.join(root, 'AGENTS.md')); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip(error.code); return; } throw error; }
  assert.throws(() => makePlan(options(root, 'cursor', { appendEntrypoints: true })), /hardlinked/);
  assert.equal(fs.readFileSync(original, 'utf8'), 'External policy\n');
})));

test('missing/unsupported target options fail closed', () => project(root => {
  assert.throws(() => makePlan({ harness: 'cursor' }), /--project/);
  assert.throws(() => makePlan(options(root, 'unknown')), /supported harness/);
  assert.throws(() => makePlan(options(os.homedir())), /user home/);
  assert.throws(() => parseArgs(['--project']), /Missing/);
  assert.throws(() => parseArgs(['--force']), /Unknown/);
  assert.throws(() => parseArgs(['--harness', 'cursor', '--harness', 'codex']), /duplicate/);
}));

test('real CLI dry-run writes nothing and reports native verification pending', () => project(root => {
  const result = spawnSync(process.execPath, [script, '--project', root, '--harness', 'letta'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.nativeVerification, 'pending');
  assert.ok(report.startupLoading.includes('not verified'));
  assert.deepEqual(report.written, []);
  assert.deepEqual(fs.readdirSync(root), []);
}));

test('real CLI apply without approval refuses writes', () => project(root => {
  const result = spawnSync(process.execPath, [script, '--project', root, '--harness', 'cursor', '--apply'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires explicit/);
  assert.deepEqual(fs.readdirSync(root), []);
}));

const fixtureRef = 'a'.repeat(40); // Syntax fixture, not a verified published commit.

test('GitHub source pins resources and emits no local checkout path', () => project(root => {
  const plan = makePlan(options(root, 'cursor', { githubRef: fixtureRef }));
  assert.equal(plan.source.kind, 'github');
  assert.equal(plan.source.ref, fixtureRef);
  const entry = plan.files.find(file => file.relative === 'AGENTS.md').content;
  assert.ok(entry.includes(`https://raw.githubusercontent.com/nickza2026/nick-skills/${fixtureRef}/README.md`));
  assert.ok(entry.includes('same commit'));
  assert.ok(entry.includes('not a guaranteed automatic import'));
  assert.ok(entry.includes('never execute downloaded scripts'));
  const state = JSON.parse(plan.files.find(file => file.relative.endsWith('.json')).content);
  assert.ok(!Object.hasOwn(state, 'bundleRoot'));
  assert.equal(state.remoteAvailability, 'not-checked');
  assert.equal(state.rendererSnapshotMatch, 'not-checked');
  const localBundle = path.resolve(path.dirname(script), '../../..').replaceAll('\\', '/');
  assert.ok(plan.files.every(file => !file.content.includes(localBundle)));
  assert.deepEqual(fs.readdirSync(root), []);
}));

test('GitHub apply requires separate published-source/snapshot attestation', () => project(root => {
  const plan = makePlan(options(root, 'cursor', { githubRef: fixtureRef }));
  assert.throws(() => applyPlan(plan, approved), /github-source-confirmed/);
  assert.deepEqual(fs.readdirSync(root), []);
  applyPlan(plan, { ...approved, githubSourceConfirmed: true });
  assert.deepEqual(applyPlan(makePlan(options(root, 'cursor', { githubRef: fixtureRef })), { ...approved, githubSourceConfirmed: true }), []);
}));

test('GitHub source rejects mutable, malformed, or mixed local references', () => project(root => {
  for (const githubRef of ['main', 'v1.0', 'abc123', '../other', fixtureRef + '\n']) {
    assert.throws(() => makePlan(options(root, 'cursor', { githubRef })), /40-character/);
  }
  assert.throws(() => makePlan(options(root, 'cursor', { githubRef: fixtureRef, bundle: root })), /not both/);
  assert.deepEqual(fs.readdirSync(root), []);
}));

test('changing an accepted local pointer to GitHub requires explicit conflict review', () => project(root => {
  applyPlan(makePlan(options(root)), approved);
  const original = read(root, 'AGENTS.md');
  const remote = makePlan(options(root, 'cursor', { githubRef: fixtureRef }));
  assert.throws(() => applyPlan(remote, { ...approved, githubSourceConfirmed: true }), /Conflicts/);
  assert.equal(read(root, 'AGENTS.md'), original);
}));

test('real GitHub CLI preview is dry-run and does not pretend to verify remote availability', () => project(root => {
  const result = spawnSync(process.execPath, [script, '--project', root, '--harness', 'codex', '--github-ref', fixtureRef], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.source.kind, 'github');
  assert.equal(report.remoteAvailability, 'not-checked');
  assert.deepEqual(report.written, []);
  assert.deepEqual(fs.readdirSync(root), []);
}));
