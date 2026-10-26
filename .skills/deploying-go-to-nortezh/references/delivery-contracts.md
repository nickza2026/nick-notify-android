# Delivery contracts

## Application and image boundaries

Build from the root Go module using `build/<app>/Dockerfile`. Keep one output binary per image unless the task explicitly calls for a multi-process container. A separate image does not require a separate Go module.

The default Dockerfile builds on `$BUILDPLATFORM`, cross-compiles using `$TARGETOS`/`$TARGETARCH`, and uses a non-root distroless runtime. The workflow targets `linux/amd64`, matching the inspected source. Add other architectures only after checking Nortezh/runtime/dependency support; CGO-free Go cross-compilation does not require QEMU just for compilation.

Pin selected base images by version and preferably verified digest under the project's update policy. The template's base tags are not a claim of immutable bytes. Do not disable CA verification or copy a shell into distroless simply to run an unsuitable health-check command.

## Swagger and assets

When the application imports generated docs, generate them before compiling. Add a native-builder step such as the following after source copy, replacing placeholders and verifying the selected instance name:

```dockerfile
RUN go install github.com/swaggo/swag/cmd/swag@v1.16.6
RUN swag init -g cmd/__APP__/main.go -o __APP__/docs --instanceName __SWAGGER_INSTANCE__ --parseDependency --parseInternal
```

Use appropriate excludes for other applications if parsing collides. Match the generated instance with the application's `swag.ReadDoc` lookup. Do not apply a source-specific default instance to all applications.

If generated docs are not committed, add the same pinned generation command before `go build` in the verification job as well. Generating files only inside Docker cannot satisfy an earlier CI compile that imports them.

Explicitly copy only required runtime assets into known `/app/...` paths, and include their source paths in staging triggers. Validate readability as UID 65532 and relative-path behavior under `WORKDIR /app`. Some persistent mounts need ownership configuration; non-root containers do not automatically fix filesystem permissions.

The `.dockerignore` template deliberately excludes secrets and agent state, not SQL/schema or all JSON files. Review real filenames before sending a context to a local or remote builder. Never use build args to pass credentials; use approved build secrets only when necessary.

## GitHub environment configuration

The reusable workflow selects environment `<app>-<stage>`, where stage is staging or production. This permits different target names and credentials for each application/environment without hardcoding the reference system.

| Name | Kind | Meaning |
|---|---|---|
| `NTZ_PROJECT` | Environment variable | Approved Nortezh project identifier |
| `NTZ_LOCATION` | Environment variable | Approved location identifier |
| `NTZ_DEPLOYMENT` | Environment variable | Exact existing deployment name, or explicitly approved creation target |
| `NTZ_TYPE` | Environment variable | `WebService` or `Worker` |
| `NTZ_PORT` | Environment variable | Required numeric listening port for WebService; must match app/platform config |
| `NTZ_SA_EMAIL` | Environment secret | Nortezh service-account email, supplied only to the deployment action |
| `NTZ_SA_KEY` | Environment secret | Nortezh service-account key, supplied only to the deployment action |
| `GITHUB_TOKEN` | Built-in job token | GHCR publication, restricted to the publishing job |

The workflow does not pass environment secrets through caller `secrets: inherit`; the deployment job obtains its selected environment's secrets. Configure/protect those environments deliberately. Do not assume typing an environment name automatically creates the intended approval rules.

Nortezh receives `SA_AUTH_EMAIL` and `SA_AUTH_KEY`, not the GitHub secret names themselves. The action contract accepts `action`, `project`, `location`, `name`, `image`, optional `port`, and `type`. The WebService step supplies an explicit port; the Worker step omits it. Do not rely on the action's default port 80 when the process listens elsewhere.

Configure image pull access on Nortezh separately for private GHCR packages. A successful registry login/push in GitHub does not give Nortezh's runtime the same credentials.

## Triggers, revision identity, and gates

- Preserve main/manual staging and published-release production only when that matches the requested release policy. The template excludes prereleases from production; adapt that guard only to an explicit policy. Do not enable real deployment while merely authoring templates.
- Staging filters include the app tree, composition root, build files, shared pkg, schema, module files, `.dockerignore`, and reusable/caller workflows. Add runtime assets and other dependency paths actually used by that app. Shared changes may rebuild several apps correctly.
- Verification and publishing check out the same `github.sha`. Do not test one branch head and build another mutable ref.
- The tag includes full commit SHA plus run ID/attempt. Pass the exact published reference through a job output; never deploy `latest` or recalculate a different image name in the deploy job.
- Record the build digest for traceability. Registry tags remain mutable without a registry policy; a unique tag is not a proof of cryptographic immutability. Use digest deployment only after confirming platform support.
- Least-privilege job permissions separate contents-read verification, packages-write publishing, and credentialed deployment. Third-party actions are commit-pinned to verified source tags, not automatically refreshed.
- Serialize per-app/stage delivery without cancelling an in-flight deployment. GitHub concurrency is not a guarantee of chronological promotion; review stale releases and approved target state.
- Do not run tests under production environment credentials. Do not add `pull_request_target` that executes a contributor's code with secrets.

## Migration and runtime acceptance

Choose migration ownership per database. A per-app workflow does not establish safe multi-app rollout order. Ensure pending migrations are backward-compatible with still-running binaries or define an explicit coordinated deployment plan.

Confirm deployment existence/configuration before using `deployment.create-revision`: the action can create a deployment if missing. It does not itself prove the correct database credentials, resources, scaling, volumes, network, health checks, or registry pulls were configured.

After an authorized deployment, inspect revision/image, health/logs, startup/shutdown, and the application's relevant endpoints/job processing. A revision API response or `public_url` output alone is not success evidence. Do not perform real financial mutations as a smoke test.

## Verification checklist

- Replace every template token; verify application paths and all required runtime assets.
- Parse YAML and run workflow lint if available; check input validation, needs/outputs, source revision, per-app/stage concurrency, and protected environments.
- Inspect tests before executing; complete safe related checks before claiming readiness.
- Build the intended Docker context/platform and test runtime behavior when Docker is available.
- Report independently: static checks, project tests, image build, local container smoke, GitHub execution, image publication, and Nortezh rollout. Never collapse unrun layers into one "passed" status.
