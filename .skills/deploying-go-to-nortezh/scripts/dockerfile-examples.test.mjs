import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const api = read('../assets/dockerfiles/api-swagger.Dockerfile.example');
const worker = read('../assets/dockerfiles/worker.Dockerfile.example');
const guide = read('../references/dockerfile-examples.md');

test('API example generates the matching named Swagger docs before compiling', () => {
  assert.match(api, /RUN GOFLAGS="" GOOS="" GOARCH="" go install github\.com\/swaggo\/swag\/cmd\/swag@v1\.16\.6/);
  assert.match(api, /RUN swag init -g cmd\/catalog\/main\.go -o catalog\/docs --instanceName catalog/);
  assert.ok(api.indexOf('RUN swag init') < api.indexOf('RUN CGO_ENABLED'));
  assert.match(api, /EXPOSE 8080/);
});
test('Worker example has no Swagger generation or invented service port', () => {
  assert.doesNotMatch(worker, /^RUN .*swag|^EXPOSE |^HEALTHCHECK /m);
  assert.match(worker, /go build .* -o \/out\/processor \.\/cmd\/processor/);
});
test('examples align module-root context, builder output, runtime COPY, and ENTRYPOINT', () => {
  for (const [content, app] of [[api, 'catalog'], [worker, 'processor']]) {
    assert.ok(content.startsWith('# syntax=docker/dockerfile:1\n'));
    assert.match(content, /FROM --platform=\$BUILDPLATFORM golang:1\.25 AS builder/);
    assert.match(content, /ARG TARGETOS=linux\nARG TARGETARCH=amd64/);
    assert.ok(content.indexOf('COPY go.mod go.sum ./') < content.indexOf('RUN go mod download'));
    assert.ok(content.indexOf('RUN go mod download') < content.indexOf('COPY . .'));
    assert.ok(content.includes(`-o /out/${app} ./cmd/${app}`));
    const runtime = content.split('FROM gcr.io/distroless/static-debian12:nonroot\n')[1];
    assert.ok(runtime);
    assert.ok(runtime.includes(`COPY --from=builder --chown=65532:65532 /out/${app} /app/${app}`));
    assert.ok(runtime.includes(`ENTRYPOINT ["/app/${app}"]`));
    assert.match(runtime, /^USER 65532:65532$/m);
    assert.doesNotMatch(runtime, /^COPY \.|\.env|service-account|\/workspace\s+\/app|^RUN /m);
  }
});
test('guide covers actual assets/ports/toolchains and limits compiler-only evidence', () => {
  for (const required of ['Go image versions', 'module root', 'EXPOSE 8080', 'templates/mail', 'static/help', 'Distroless has no shell/curl', 'CGO/native libraries', 'not a latest/security recommendation', 'external Swagger generator', 'reference inputs, not publication payloads']) assert.ok(guide.includes(required), required);
  const skill = read('../SKILL.md');
  assert.ok(skill.includes('references/dockerfile-examples.md'));
  assert.ok(skill.includes('do not include raw reference directories'));
});
test('synthetic Dockerfile examples contain no real deployment destinations or credentials', () => {
  for (const content of [api, worker, guide]) {
    assert.doesNotMatch(content, /olufy-|SA_AUTH_KEY\s*=|BEGIN .*PRIVATE KEY|https?:\/\/[^\s/]+:[^\s/@]+@/);
  }
});
test('available local Go compiles both synthetic cmd entrypoints to Linux ELF (not a Docker/Swagger test)', t => {
  const available = spawnSync('go', ['version'], { encoding: 'utf8', timeout: 15000, windowsHide: true, env: { ...process.env, GOTOOLCHAIN: 'local' } });
  if (available.error?.code === 'ENOENT') { t.skip('Go toolchain unavailable; compiler-only check not run'); return; }
  assert.equal(available.status, 0, available.stderr);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nick-dockerfile-fixture-'));
  try {
    fs.writeFileSync(path.join(root, 'go.mod'), 'module example.invalid/dockerfile-fixture\n\ngo 1.20\n');
    fs.writeFileSync(path.join(root, 'go.sum'), '');
    for (const [content, app] of [[api, 'catalog'], [worker, 'processor']]) {
      const source = path.join(root, 'cmd', app);
      fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(source, 'main.go'), 'package main\nfunc main() {}\n');
      const pkg = content.match(/RUN CGO_ENABLED=0 GOOS=\$\{TARGETOS\} GOARCH=\$\{TARGETARCH\} go build -trimpath -ldflags="-w -s" -o \/out\/\w+ (\.\/cmd\/\w+)/)?.[1];
      assert.equal(pkg, `./cmd/${app}`);
      const binary = path.join(root, `${app}.elf`);
      const result = spawnSync('go', ['build', '-p', '2', '-trimpath', '-ldflags=-w -s', '-o', binary, pkg], {
        cwd: root, encoding: 'utf8', timeout: 90000, windowsHide: true,
        env: { ...process.env, GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0', GOMAXPROCS: '2', GOTOOLCHAIN: 'local', GOENV: 'off', GOFLAGS: '', GOPROXY: 'off', GOSUMDB: 'off', GOWORK: 'off', GOCACHE: path.join(root, 'cache'), GOPATH: path.join(root, 'gopath') },
      });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      assert.deepEqual([...fs.readFileSync(binary).subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46]);
    }
  } finally {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('nick-dockerfile-fixture-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
