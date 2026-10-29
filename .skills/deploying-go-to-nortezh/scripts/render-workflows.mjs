import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const template = fs.readFileSync(new URL('../assets/workflow-service.yaml.tmpl', import.meta.url), 'utf8');
const fail = message => { throw new Error(message); };
const object = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`Unknown ${label} key: ${key}`);
};
const scalar = value => /^[A-Za-z_./][A-Za-z0-9_ ./&()-]*$/.test(value) && !/^(true|false|null|yes|no|on|off)$/i.test(value) ? value : JSON.stringify(value);
const text = (value, pattern, label) => {
  if (typeof value !== 'string' || value.length > 180 || !pattern.test(value)) fail(`Invalid ${label}`);
  return value;
};
const slug = (value, label) => text(value, /^[a-z][a-z0-9-]*$/, label);
const relative = (value, label) => {
  if (typeof value !== 'string' || !value || /[\\\x00-\x1f\x7f:]/.test(value) || value.includes('${{') || value.startsWith('/') || value.split('/').includes('..')) fail(`Invalid ${label}: use a project-relative path`);
  return value;
};

export function renderWorkflows(config) {
  object(config, ['workflows'], 'config');
  if (!Array.isArray(config.workflows) || config.workflows.length === 0 || config.workflows.length > 50) fail('Provide 1-50 approved workflow entries');
  const files = new Set(), pairs = new Set(), targets = new Set(), images = new Set();
  return config.workflows.map(entry => {
    object(entry, ['file', 'name', 'app', 'environment', 'imageSuffix', 'outputId', 'dockerfile', 'trigger', 'paths', 'nortezh', 'secrets'], 'workflow');
    const app = slug(entry.app, 'app'), environment = slug(entry.environment, 'environment');
    const file = text(entry.file, /^[a-z][a-z0-9-]*\.ya?ml$/, 'workflow filename');
    const pair = `${app}/${environment}`;
    if (files.has(file) || pairs.has(pair)) fail('Duplicate workflow filename or app/environment pair');
    files.add(file); pairs.add(pair);
    const name = text(entry.name, /^[A-Za-z][A-Za-z0-9 /&()-]*$/, 'workflow name');
    const imageSuffix = slug(entry.imageSuffix, 'image suffix');
    if (images.has(imageSuffix)) fail('Each app/environment needs a distinct image suffix');
    images.add(imageSuffix);
    const outputId = text(entry.outputId, /^[a-z][a-z0-9_]*$/, 'output step ID');
    if (['repository', 'short_sha'].includes(outputId)) fail('Output step ID conflicts with a fixed step');
    const dockerfile = relative(entry.dockerfile, 'Dockerfile');
    if (!/^(\.\/)?build\/[a-z][a-z0-9-]*\/Dockerfile$/.test(dockerfile) || dockerfile.replace(/^\.\//, '') !== `build/${app}/Dockerfile`) fail('Dockerfile must match build/<app>/Dockerfile');
    object(entry.trigger, ['kind', 'branch', 'manual'], 'trigger');
    const { kind, branch, manual } = entry.trigger;
    if (typeof manual !== 'boolean') fail('Confirm manual dispatch explicitly');
    let triggers;
    if (kind === 'push') {
      text(branch, /^[A-Za-z0-9][A-Za-z0-9_./-]*$/, 'exact push branch');
      if (branch.includes('..') || branch.includes('//') || branch.endsWith('/') || branch.endsWith('.lock')) fail('Invalid exact push branch');
      if (!Array.isArray(entry.paths) || !entry.paths.length || !entry.paths.includes(`.github/workflows/${file}`)) fail('Push filters must include this workflow file');
      const paths = entry.paths.map(p => relative(p, 'path filter'));
      triggers = `${manual ? '  workflow_dispatch:\n' : ''}  push:\n    branches:\n      - ${scalar(branch)}\n    paths:\n${paths.map(p => `      - ${JSON.stringify(p)}`).join('\n')}`;
    } else if (kind === 'release' || kind === 'manual') {
      if (branch !== undefined || entry.paths !== undefined) fail('Release/manual does not provide push-branch/path filtering; approve a separate guard or use push');
      if (kind === 'manual' && !manual) fail('Manual-only workflow must enable manual dispatch');
      triggers = kind === 'manual' ? '  workflow_dispatch:' : `${manual ? '  workflow_dispatch:\n' : ''}  release:\n    types:\n      - published`;
    } else fail('Trigger kind must be push, release, or manual');
    object(entry.nortezh, ['project', 'location', 'name', 'type', 'port'], 'Nortezh');
    const project = slug(entry.nortezh.project, 'Nortezh project'), location = slug(entry.nortezh.location, 'Nortezh location');
    const deployment = slug(entry.nortezh.name, 'deployment name'), { type, port } = entry.nortezh;
    if (!['WebService', 'Worker'].includes(type)) fail('Target type must be WebService or Worker');
    if (port !== undefined && (type !== 'WebService' || !Number.isInteger(port) || port < 1 || port > 65535)) fail('Only WebService accepts a numeric port 1-65535');
    const target = `${project}/${location}/${deployment}`;
    if (targets.has(target)) fail('Two entries would deploy to the same Nortezh target; resolve the collision');
    targets.add(target);
    object(entry.secrets, ['email', 'key'], 'secrets');
    const secretEmail = text(entry.secrets.email, /^[A-Z_][A-Z0-9_]*$/, 'email secret NAME (not value)');
    const secretKey = text(entry.secrets.key, /^[A-Z_][A-Z0-9_]*$/, 'key secret NAME (not value)');
    const values = {
      WORKFLOW_NAME: scalar(name), TRIGGERS: triggers, IMAGE_SUFFIX: imageSuffix, OUTPUT_ID: outputId,
      DOCKERFILE: scalar(dockerfile), PROJECT: scalar(project), LOCATION: scalar(location), DEPLOYMENT: scalar(deployment), TYPE: type,
      PORT_SUFFIX: port === undefined ? '' : `\n          port: ${port}`, SECRET_EMAIL: secretEmail, SECRET_KEY: secretKey,
    };
    const content = template.replace(/__([A-Z_]+?)__/g, (_, key) => values[key] ?? fail(`Unknown template token: ${key}`));
    return { path: `.github/workflows/${file}`, content, app, environment, dockerfile };
  });
}

function safeTarget(root, relativePath) {
  if (fs.lstatSync(root).isSymbolicLink()) fail('Project root changed to symlink; replan');
  const target = path.resolve(root, relativePath), rel = path.relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) fail('Target escapes project');
  let current = root;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code === 'ENOENT') break; throw error; }
    if (stat.isSymbolicLink()) fail('Refusing workflow path through symlink/junction');
    if (current === target ? !stat.isFile() || stat.nlink > 1 : !stat.isDirectory()) fail('Refusing non-regular/hardlinked target or parent');
  }
  return target;
}

export function makePlan(project, config) {
  if (!project) fail('Specify --project explicitly');
  if (fs.lstatSync(path.resolve(project)).isSymbolicLink()) fail('Refusing a symlink project root');
  const root = fs.realpathSync(path.resolve(project));
  if (!fs.statSync(root).isDirectory() || root === path.parse(root).root || root === fs.realpathSync(os.homedir())) fail('Select a project directory, not root/home');
  const files = renderWorkflows(config).map(file => {
    const dockerfile = safeTarget(root, file.dockerfile);
    if (!fs.existsSync(dockerfile)) fail(`Missing ${file.dockerfile}; prepare the approved container file first`);
    const target = safeTarget(root, file.path);
    return { ...file, status: !fs.existsSync(target) ? 'create' : fs.readFileSync(target, 'utf8') === file.content ? 'unchanged' : 'conflict' };
  });
  return { root, files };
}

export function applyPlan(plan, approved) {
  if (approved !== true) fail('Apply requires --approved after first-use confirmation');
  if (plan.files.some(file => file.status === 'conflict')) fail('Existing workflow conflict; nothing written');
  for (const file of plan.files) {
    const target = safeTarget(plan.root, file.path);
    if (file.status === 'create' && fs.existsSync(target)) fail('Workflow appeared after planning; replan');
    if (file.status === 'unchanged' && fs.readFileSync(target, 'utf8') !== file.content) fail('Workflow changed after planning; replan');
  }
  const written = [];
  try {
    for (const file of plan.files.filter(file => file.status === 'create')) {
      const target = safeTarget(plan.root, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content, { flag: 'wx' });
      written.push(file.path);
    }
  } catch (error) { fail(`Partial write: ${written.join(', ') || 'none'}. ${error.message}`); }
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = {};
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (['--project', '--config'].includes(arg)) {
        if (!args[i + 1] || args[i + 1].startsWith('--')) fail(`Missing value for ${arg}`);
        options[arg.slice(2)] = args[++i];
      } else if (['--apply', '--approved'].includes(arg)) options[arg.slice(2)] = true;
      else fail(`Unknown option: ${arg}`);
    }
    if (!options.config) fail('Specify --config with the confirmed non-secret workflow matrix');
    const plan = makePlan(options.project, JSON.parse(fs.readFileSync(options.config, 'utf8')));
    const written = options.apply ? applyPlan(plan, options.approved) : [];
    console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', files: plan.files, written, liveDeployment: 'not run', approval: 'caller attestation, not runtime proof' }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
