# Delivery contracts

## Exact example workflow shape

Render [the standalone template](../assets/workflow-service.yaml.tmpl) as one full workflow for each confirmed app/environment. Keep `dockerize_n_push` and its `image_name` job output, then `deploy.needs: dockerize_n_push` consuming that exact output. Preserve these steps in order:

1. `actions/checkout@v3`.
2. `short_sha` output from checked-out `git rev-parse --short HEAD`.
3. `docker/setup-qemu-action@v2`.
4. `docker/setup-buildx-action@v2`.
5. `docker/login-action@v2`, GHCR, `github.actor`, `secrets.GITHUB_TOKEN`.
6. `ASzc/change-string-case-action@v5`, lowercasing `github.repository/<app-environment-suffix>`.
7. `docker/build-push-action@v4`, `linux/amd64`, GHA cache, `pull: true`, `push: true`, context `.`, the approved app Dockerfile, and short-SHA image tag.
8. The approved app output-step ID exporting that image as `image_name`.
9. Nortezh deployment job using `Nortezh/nortezh-action@v1.0.5` and `deployment.create-revision`.

Retain example permissions `contents: read`, `packages: write`, and `attestations: write` on the publishing job; their presence is not proof of artifact attestation. Do not add reusable callers, automatic verification jobs, branch guards, GitHub Environment configuration, concurrency, new image tag schemes, or updated/SHA-pinned action versions without explicit agreement. If target policy requires a change, explain it before adapting; “exact example” does not authorize ignoring higher-priority safety/project rules.

These are the supplied example's versions, **not a current security or runner-compatibility recommendation**. Validate availability/runner support before a live use. An unavailable/deprecated action needs a reported blocker and an approved correction, not an invented successful run or a silent alternate pipeline.

## Target values and credential scope

| Field | Where | Confirmed value |
|---|---|---|
| project, location, name | Nortezh action `with` | Literal non-secret identifiers approved per app/environment |
| image | Nortezh action `with` | `${{ needs.dockerize_n_push.outputs.image_name }}` |
| type | Nortezh action `with` | `WebService` or `Worker` |
| port | Optional `with` for WebService only | Actual approved numeric port; omission requires confirmed compatible action/platform behavior |
| SA_AUTH_EMAIL | Nortezh action `env` | Reference the approved email secret **name** |
| SA_AUTH_KEY | Nortezh action `env` | Reference the approved key secret **name** |

Never request/print the secret values or grant a browser privileged provider credentials. GitHub Environment secrets do not resolve merely because the plan labels a stage; adding `deploy.environment` requires explicit configuration/approval outside the exact helper. Confirm private GHCR pull access on Nortezh separately: logging GitHub Actions into GHCR does not configure Nortezh runtime pulls.

## Source, triggers, and honest limitations

- Ask first about prod-only/staging-only/both/more and branch/event selection. Preserve `workflow_dispatch + push` or `release: published` only if the user selects those policies. Release/manual has no push branch/path filter; dispatch allows selectable refs unless a separately approved guard prevents it.
- Do not add `pull_request_target` or PR-controlled code running with deployment secrets. The exact example has no PR event.
- Ask whether to run tests on PR open/update before adding or enabling any PR-test CI. Preserve existing approved checks; do not decide to enable or disable them silently. If enabled, approve a separate test-only workflow with explicit base-branch/event/path filters and safe test commands, without GHCR publication, deployment, or production secrets. This does not waive ordinary authorized local tests or mandatory existing verification.
- Confirm source identity from checkout, image tag, and job output. The example has **no test gate**; do not claim it tests before publishing. Run approved safe target checks separately or propose an explicit pipeline change if requested.
- Short-SHA tags and `type=gha` cache options are retained for fidelity. Short tags are mutable; retries may overwrite them, short SHAs can collide, and shared GHA caches/concurrent runs may interfere. There is no concurrency or freshness guard. Explain material risks before real use; any stronger tag/cache/serialization policy is an approved deviation, not a silent default.
- Audit app/shared/schema/runtime/context dependencies and show missing path filters for approval. The original samples omit some such filters; exact reproduction alone does not prove all necessary changes trigger a build.
- Source examples use production releases without excluding prereleases. Do not pretend a release is automatically production-branch-only.

## Containers, schema, and assets

Read [the complete Dockerfile examples](dockerfile-examples.md) and choose API + Swagger, Worker, or the minimal no-generator template before materializing `build/<app>/Dockerfile`. Their synthetic app names, Go image version, and ports are not approved target configuration. Keep reference-only inputs out of publication unless explicitly authorized.

Build from one module root using `build/<app>/Dockerfile`; choose actual app names and module-compatible Go versions. The Docker template cross-compiles CGO-free code for the target platform and uses a non-root distroless runtime. If CGO/platform/runtime assets require something different, propose it. A successful Go binary build does not prove external templates/assets were copied or that non-root permissions are correct.

When generated Swagger imports are required, use a verified pinned generator before compilation, e.g. `github.com/swaggo/swag/cmd/swag@v1.16.6` with the correct `cmd/<app>/main.go`, output directory, and instance name. Workers do not need Swagger for symmetry. If approved separate tests compile generated imports, generate there too, not only inside Docker.

Review `.dockerignore` and explicitly copy only required non-secret runtime assets. Do not pass credentials as Docker build args or copy whole source/env/test data into runtime. Confirm migration ownership and rollout order per database; two independent workflows do not coordinate multi-app migrations. Preserve applied migration history and compatibility with still-running binaries.

## Validation and rollout evidence

Run renderer regressions and parse generated YAML; use actionlint if available. Node tests include sanitized golden hashes and explicit action-order/output assertions, policy variations, actual isolated CLI file creation, and no-overwrite/path guards. Raw user examples are not required or published. Dockerfile checks cover build/output/entrypoint/Swagger layout and compile synthetic entrypoints with an available local Go toolchain; they do not execute the external Swagger generator or Docker build/runtime. The helper's approval flag is an attestation, not a consent/security boundary; use stable trusted projects without hostile concurrent filesystem edits.

Inspect tests/scripts before running them. Keep checks isolated from production/shared DBs, real money/credits, and live providers. Build/smoke-test containers only within authorized scope. After a separately approved live deployment, verify the actual image/revision, pull access, configuration, health/logs, and safe application behavior. Nortezh may create a target if its name is absent; never treat an API revision/public URL as readiness proof.

Report separately: files generated, static checks/lint, project tests, Docker build/smoke, GitHub execution, registry publication, and Nortezh rollout. Missing/blocked layers stay missing/blocked; no automatic commit/push/secret provisioning/deploy follows file generation.
