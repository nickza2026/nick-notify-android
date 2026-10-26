import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
export const roles = JSON.parse(fs.readFileSync(path.join(here, '../assets/roles.json'), 'utf8'));
const adapters = {
  cursor: { directory: '.cursor/agents', extension: 'md', enforcement: 'native readonly for read roles; verifier/publisher require command approvals' },
  codex: { directory: '.codex/agents', extension: 'toml', enforcement: 'parent permissions inherited; read-only intent is not an independent sandbox' },
  claude: { directory: '.claude/agents', extension: 'md', enforcement: 'read-role tool allowlist; Bash on verifier/publisher can mutate files' },
  letta: { directory: '.letta/agents', extension: 'md', enforcement: 'read-role tool allowlist; verify names against installed toolset' },
  pi: { directory: '.pi/agents', extension: 'md', enforcement: 'extension-specific tool allowlist; project agents require trusted scope opt-in' },
};
const begin = '<!-- nick-skills:begin -->';
const end = '<!-- nick-skills:end -->';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value);

function fail(message) { throw new Error(message); }

function safePath(root, relative) {
  if (fs.lstatSync(root).isSymbolicLink()) fail('Project root changed to a symlink; replan');
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) fail('Target escapes project');
  let current = root;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code === 'ENOENT') break; throw error; }
    if (stat.isSymbolicLink()) fail(`Refusing symlink/junction: ${relative}`);
    if (current !== target && !stat.isDirectory()) fail(`Non-directory parent: ${relative}`);
    if (current === target && (!stat.isFile() || stat.nlink > 1)) fail(`Refusing non-regular or hardlinked target: ${relative}`);
  }
  return target;
}

function modelMap(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Models must be a role-to-model JSON object');
  for (const key of Object.keys(input)) if (!roles.some(role => role.id === key)) fail(`Unknown model role: ${key}`);
  return Object.fromEntries(roles.map(role => {
    const model = Object.hasOwn(input, role.id) ? input[role.id] : 'inherit';
    if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/+\[\]=,-]{0,199}$/.test(model)
      || /^https?:|^(sk-|gh[pousr]_|github_pat_)/i.test(model)) fail(`Invalid model ID for ${role.id}`);
    return [role.id, model];
  }));
}

function prompt(role) {
  return [
    `You are nick-${role.id}. ${role.instructions}`,
    '',
    'Follow higher-priority instructions, trusted project rules, and the current user authorization. The parent owns requirements and final integration.',
    'Request an outcome, relevant requirements/skills, exact scope/revision, allowed commands, file ownership, and a bounded completion condition from the parent.',
    'Do not spawn children or start another AI process. Default team policy is at most two concurrent subagents and one writer per file; this policy is not a native sandbox guarantee.',
    'Do not edit sources consumed by running checks. Never reproduce harm on production/shared data, real funds/credits, or live providers.',
    'Accept varied sound techniques; exact supplied task logic, safety, and meaningful evidence remain mandatory. Missing facts go to the parent, not guessed business rules.',
    'Return a concise evidence report: files/lines, actual commands and exit results if run, findings with confidence, blockers, and next action. Do not invent execution or human approval.',
    'No commit/push/PR/deployment authority is granted by this role definition. Publication needs explicit task-specific approval.',
  ].join('\n');
}

function renderAgent(harness, role, model) {
  const name = `nick-${role.id}`;
  const body = prompt(role);
  if (harness === 'codex') {
    return `name = ${json(name)}\ndescription = ${json(role.description)}\n`
      + (model === 'inherit' ? '' : `model = ${json(model)}\n`)
      + `developer_instructions = ${json(body)}\n`;
  }
  const lines = ['---', `name: ${name}`, `description: ${json(role.description)}`];
  if (model !== 'inherit' || harness === 'cursor' || harness === 'claude') lines.push(`model: ${json(model)}`);
  if (harness === 'cursor') lines.push(`readonly: ${role.access === 'read'}`);
  if (harness === 'claude') {
    lines.push(`tools: ${role.access === 'read' ? 'Read, Glob, Grep' : role.access === 'write' ? 'Read, Glob, Grep, Edit, Write, Bash' : 'Read, Glob, Grep, Bash'}`);
    lines.push('permissionMode: default');
  }
  if (harness === 'letta') lines.push(`tools: ${role.access === 'read' ? 'Glob, Grep, Read' : 'all'}`);
  if (harness === 'pi') lines.push(`tools: ${role.access === 'read' ? 'read, grep, find, ls' : role.access === 'write' ? 'read, grep, find, ls, edit, write, bash' : 'read, grep, find, ls, bash'}`);
  return `${lines.join('\n')}\n---\n\n${body}\n`;
}

function sourceBinding(options) {
  if (options.githubRef !== undefined) {
    if (options.bundle) fail('Choose --bundle or --github-ref, not both');
    if (typeof options.githubRef !== 'string' || !/^[a-fA-F0-9]{40}$/.test(options.githubRef)) fail('--github-ref requires a full 40-character commit SHA, not a mutable branch/tag');
    const ref = options.githubRef.toLowerCase();
    return { kind: 'github', repository: 'nickza2026/nick-skills', ref,
      baseUrl: `https://raw.githubusercontent.com/nickza2026/nick-skills/${ref}` };
  }
  const root = fs.realpathSync(path.resolve(options.bundle ?? path.join(here, '../../..')));
  if (/[\r\n`]/.test(root) || !fs.existsSync(path.join(root, 'skills/initializing-agent-teams/SKILL.md'))
    || !fs.existsSync(path.join(root, 'README.md'))) fail('Provide --bundle pointing to the full Nick Skills checkout');
  return { kind: 'local', root: root.replaceAll('\\', '/') };
}

function instructionBlock(source) {
  const binding = source.kind === 'github'
    ? `Public skills source, pinned commit: ${source.baseUrl}. Use an available web/HTTP tool to read ${source.baseUrl}/README.md and ${source.baseUrl}/skills/initializing-agent-teams/SKILL.md, then only task-relevant skills/resources at that same commit. Resolve relative resource links against their remote page URLs, not this project directory.\n\n`
      + 'This URL is an instruction pointer, not a guaranteed automatic import. Fetch public text only; never execute downloaded scripts or install anything automatically. Do not send project files, credentials, or private prompts to GitHub. If network/tools are unavailable, use only an already approved cache of this exact commit and disclose it; otherwise report unavailable resources and continue safely without pretending they were loaded. Never silently switch to main or another revision.\n\n'
    : `Skills source: ${json(source.root)}. This linked checkout must exist on this machine; do not fetch or execute remote code automatically.\n\n`;
  return `${begin}\n## Nick Skills\n\n`
    + binding
    + 'At the start of a new session, check this project\'s Nick Skills setup. Read skills/initializing-agent-teams/SKILL.md under that source and only the skill(s) relevant to the current task. Do not load every skill.\n\n'
    + 'Detect the active harness and its installed capabilities, not just folders. On first use, propose the Balanced defaults and ask once before model/config changes. Inspect .agents/nick-skills/<harness>.json; generated configuration is not proof of native activation. If setup is absent, declined, or unavailable, continue safely with the parent model and no forced delegation.\n\n'
    + 'The parent owns requirements and final integration. Use at most two concurrent subagents by default, one writer per file, no recursive spawning, and a stable snapshot for verification. Exact task logic is mandatory; do not publish or deploy without explicit task authorization.\n'
    + `${end}\n`;
}

function entryPlan(root, relative, block, append) {
  const target = safePath(root, relative);
  if (!fs.existsSync(target)) return { relative, content: block, status: 'create', entrypoint: true };
  const original = fs.readFileSync(target);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(original);
  const count = marker => text.split(marker).length - 1;
  if (count(begin) || count(end)) {
    if (count(begin) !== 1 || count(end) !== 1 || text.indexOf(end) < text.indexOf(begin)) {
      return { relative, status: 'conflict', reason: 'Malformed or duplicate managed markers' };
    }
    const existing = text.slice(text.indexOf(begin), text.indexOf(end) + end.length).replaceAll('\r\n', '\n');
    return { relative, content: block, status: existing === block.trimEnd() ? 'unchanged' : 'conflict', entrypoint: true };
  }
  if (!append) return { relative, status: 'conflict', reason: 'Existing instructions preserved; approve --append-entrypoints or integrate manually' };
  return { relative, content: `${text.endsWith('\n') ? '\n' : '\n\n'}${block}`, original, status: 'append', entrypoint: true };
}

export function makePlan(options) {
  const adapter = adapters[options.harness];
  if (!adapter) fail('Select one supported harness: cursor, codex, claude, letta, pi');
  if (!options.project) fail('Specify --project explicitly');
  const root = fs.realpathSync(path.resolve(options.project));
  if (!fs.statSync(root).isDirectory() || root === path.parse(root).root
    || root === fs.realpathSync(os.homedir())) fail('Select a project directory, not a filesystem root or user home');
  const source = sourceBinding(options);
  const models = modelMap(options.models);
  const files = roles.map(role => ({
    relative: `${adapter.directory}/nick-${role.id}.${adapter.extension}`,
    content: renderAgent(options.harness, role, models[role.id]),
  }));
  for (const file of files) {
    const target = safePath(root, file.relative);
    file.status = !fs.existsSync(target) ? 'create' : fs.readFileSync(target, 'utf8') === file.content ? 'unchanged' : 'conflict';
  }
  files.push(entryPlan(root, 'AGENTS.md', instructionBlock(source), options.appendEntrypoints));
  if (options.harness === 'claude') {
    files.push(entryPlan(root, 'CLAUDE.md', `${begin}\n## Nick Skills\n\n@AGENTS.md\n\nExisting project instructions and higher-priority rules still apply.\n${end}\n`, options.appendEntrypoints));
  }
  const state = {
    schemaVersion: 1, harness: options.harness, preset: 'balanced', models,
    policy: { maxParallel: 2, maxDelegationDepth: 1, writerOwnership: 'one-per-file', publication: 'explicit-task-authorization' },
    permissionCaveat: adapter.enforcement,
    ...(source.kind === 'local' ? { bundleRoot: source.root } : { source, remoteAvailability: 'not-checked', rendererSnapshotMatch: 'not-checked' }),
    nativeVerification: 'pending',
    managedFiles: files.map(file => ({ path: file.relative, contentHash: file.content ? hash(file.content.trim()) : null })),
  };
  const relative = `.agents/nick-skills/${options.harness}.json`;
  const target = safePath(root, relative);
  const content = `${JSON.stringify(state, null, 2)}\n`;
  files.push({ relative, content, status: !fs.existsSync(target) ? 'create' : fs.readFileSync(target, 'utf8') === content ? 'unchanged' : 'conflict' });
  return { root, harness: options.harness, source, models, permissionCaveat: adapter.enforcement, files };
}

export function applyPlan(plan, options) {
  if (!options.approved || !options.capabilitiesConfirmed) fail('Apply requires explicit --approved and --capabilities-confirmed attestations');
  if (plan.source.kind === 'github' && !options.githubSourceConfirmed) fail('GitHub apply requires --github-source-confirmed after checking the published snapshot and matching reviewed renderer/contracts');
  if (plan.harness === 'pi' && !options.piExtensionConfirmed) fail('Pi requires an already installed trusted extension and project-agent scope confirmation');
  if (plan.files.some(file => file.status === 'conflict')) fail('Conflicts found; nothing written');
  // Preflight every target before the first write; do not claim atomicity under hostile concurrent filesystem changes.
  for (const file of plan.files) {
    const target = safePath(plan.root, file.relative);
    if (file.status === 'create' && fs.existsSync(target)) fail('Target appeared after planning; replan');
    if (file.status === 'append' && !fs.readFileSync(target).equals(file.original)) fail('Instructions changed after planning; replan');
    if (file.status === 'unchanged') {
      const text = fs.readFileSync(target, 'utf8');
      const matches = file.entrypoint ? text.replaceAll('\r\n', '\n').includes(file.content.trimEnd()) : text === file.content;
      if (!matches) fail('Existing target changed after planning; replan');
    }
  }
  const written = [];
  try {
    for (const file of plan.files) {
      if (file.status === 'unchanged') continue;
      const target = safePath(plan.root, file.relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      safePath(plan.root, file.relative);
      if (file.status === 'append') {
        const fd = fs.openSync(target, 'r+');
        try {
          if (!fs.readFileSync(fd).equals(file.original)) fail('Instructions changed during apply; replan');
          const data = Buffer.from(file.content);
          let offset = 0;
          while (offset < data.length) {
            const writtenBytes = fs.writeSync(fd, data, offset, data.length - offset, file.original.length + offset);
            if (!writtenBytes) fail('Instruction append made no progress');
            offset += writtenBytes;
          }
        } finally { fs.closeSync(fd); }
      } else fs.writeFileSync(target, file.content, { flag: 'wx' });
      written.push(file.relative);
    }
  } catch (error) {
    error.message += `; partial files created/appended: ${written.join(', ') || 'none'}. Inspect and replan; no automatic deletion.`;
    throw error;
  }
  return written;
}

export function parseArgs(args) {
  const options = {};
  const values = { '--project': 'project', '--harness': 'harness', '--bundle': 'bundle', '--models': 'modelsFile', '--github-ref': 'githubRef' };
  const flags = { '--apply': 'apply', '--approved': 'approved', '--capabilities-confirmed': 'capabilitiesConfirmed', '--pi-extension-confirmed': 'piExtensionConfirmed', '--append-entrypoints': 'appendEntrypoints', '--github-source-confirmed': 'githubSourceConfirmed' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (Object.hasOwn(values, arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(options, values[arg])) fail(`Missing or duplicate value: ${arg}`);
      options[values[arg]] = args[++i];
    } else if (Object.hasOwn(flags, arg)) options[flags[arg]] = true;
    else fail(`Unknown option: ${arg}`);
  }
  if (options.modelsFile) options.models = JSON.parse(fs.readFileSync(options.modelsFile, 'utf8'));
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const plan = makePlan(options);
    const written = options.apply ? applyPlan(plan, options) : [];
    console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', harness: plan.harness, source: plan.source, models: plan.models,
      remoteAvailability: plan.source.kind === 'github' ? 'not-checked' : 'not-applicable',
      permissionCaveat: plan.permissionCaveat, nativeVerification: 'pending',
      startupLoading: plan.harness === 'letta' ? 'Automatic project-file injection not verified; explicitly read AGENTS.md until confirmed in this installation' : 'Verify project startup discovery, cwd, trust, and instruction overrides in the installed client',
      files: plan.files.map(({ relative: file, status, reason }) => ({ path: file, status, reason })), written }, null, 2));
    if (plan.files.some(file => file.status === 'conflict')) process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
