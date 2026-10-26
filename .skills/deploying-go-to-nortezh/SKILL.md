---
name: deploying-go-to-nortezh
description: Authors Dockerfiles and GitHub Actions workflows for Go applications deployed to Nortezh through GHCR and Nortezh/nortezh-action. Supports named applications within one Go module, separate staging/production triggers, WebService or Worker targets, and explicit deployment configuration. Use when preparing container builds, CI workflows, or Nortezh deployment files. Does not authorize live image publication, deployment, secret provisioning, or changes to an existing platform target.
---

# Prepare Go Delivery to Nortezh

On first project use, follow [agent setup](../initializing-agent-teams/SKILL.md) when available. The parent asks once before configuration/model changes; delegated children do not initialize again. Missing, declined, or non-interactive setup does not block the task or force delegation.

Use the Olufy-derived delivery pattern: test the selected source revision, build a per-application image from the module root, publish to GHCR, and pass that exact image reference to Nortezh. Derive application names from the target project; do not copy the source application's identity or environment settings.

## Boundaries and inputs

- Author all skill artifacts in English. Follow the target repository's instructions and current request before this baseline.
- Treat pipeline preparation, image publication, and live deployment as separate permissions. Templates in this bundle are inert assets, not active workflows.
- Inspect the target module, application roots, runtime assets, migrations, and existing workflows before replacing anything. Preserve dirty/unrelated work.
- Establish application names, target platform/architecture, Go version, runtime assets, Swagger needs, GitHub environments, and whether the Nortezh target is `WebService` or `Worker`.
- Obtain non-secret project/location/deployment identifiers through the approved configuration channel. Reference secret names, never ask for key values in chat or commit them.
- Read [delivery contracts](references/delivery-contracts.md) for environment setup, security, rollout, and validation. Read [source baseline](references/source-baseline.md) for verified action inputs, source facts, and deliberate differences.

## Workflow

### 1. Map source and runtime dependencies

Select `cmd/<app>` and its local/shared packages. Include embedded schema and required runtime assets; a successful binary build does not prove external templates/static assets were copied. Select the schema migration owner and deployment order before enabling several applications against one database.

### 2. Materialize container files

Create `build/<app>/Dockerfile` from [the base template](assets/Dockerfile.tmpl), and create or carefully merge [the context exclusions](assets/dockerignore.tmpl) into the target `.dockerignore`.

Replace `__APP__` and `__GO_VERSION__` with validated target values. Use the selected module-compatible Go version, not a universal fixed toolchain. The template assumes Linux and CGO-free dependencies; adapt deliberately if those assumptions are false.

For an HTTP application requiring generated Swagger, add the pinned generation step described in delivery contracts before `go build`, using that application's output/instance name. Do not add Swagger to workers or copy the source's unpinned generator.

Copy required non-secret runtime assets explicitly and document their paths. The template has no business assets by default. Do not copy environment files, credentials, test databases, or the whole source tree into the runtime stage.

### 3. Materialize CI and environment callers

- Copy [the reusable pipeline](assets/workflow-deliver.yml.tmpl) to `.github/workflows/deliver-go.yml`.
- Render [the staging caller](assets/workflow-staging.yml.tmpl) and [production caller](assets/workflow-production.yml.tmpl) per selected application, replacing `__APP__`. Do not generate callers for nonexistent apps.
- Staging supports manual dispatch and main-branch path-filtered changes. Production follows published releases. Adapt triggers only to the user's requested release policy.
- Expand path filters for shared code, module files, migrations, Docker context rules, workflow definitions, and actual runtime assets. Do not inherit a source filter that misses `schema` changes.
- Configure the `<app>-staging` and `<app>-production` GitHub environments and their required Nortezh variables/secrets before enabling live runs. Protect production with the intended approval policy.

The reusable pipeline tests before publication, uses per-app/environment build caches, publishes a run-specific commit tag, records the digest, then deploys the exact published tag. It uses no PR-with-secrets trigger and does not infer registry pull access for Nortezh.

### 4. Validate without overstating evidence

- Render placeholders and parse workflow YAML; validate jobs, inputs, outputs, needs, path filters, and environment names. Use actionlint when available, without claiming a YAML parser replaces it.
- Inspect the test harness and selected scripts before executing them. Use isolated test configuration and never production credentials, credit mutations, or live provider calls.
- Run target project checks and a Docker build with the actual context/application/assets when the engine is available. Validate startup, declared port, non-root permissions, signal handling, and required asset reads in an isolated smoke run.
- If Docker/runner/platform access is unavailable, report the blocked layers. Static validation is not a successful image build, GitHub run, or deployment.
- Creating a Nortezh revision is not readiness proof. Only after explicit deployment approval, verify the actual revision/image, pull access, runtime configuration, health/logs, and migration compatibility before reporting rollout success.

## Template limitations

The included files are a tested-as-text starting point, not universal deployment configuration. Existing platform env/secrets, scaling, storage, database access, health checks, and migration rollout must be configured for the target. The Nortezh action may create a new deployment when the name does not exist; confirm identity before a live run.
