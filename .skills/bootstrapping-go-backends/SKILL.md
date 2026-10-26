---
name: bootstrapping-go-backends
description: Bootstraps new Go backend repositories in Nick's style as single-module, multi-application projects with per-app cmd composition roots, application-owned feature packages, shared pkg packages, PostgreSQL through database/sql and acoshift/pgsql, and arpc/httpmux/parapet for HTTP applications. Adds River workers or scheduled applications only when required. Use when scaffolding a Golang backend, selecting its default stack, or adding an application to a matching repository. Do not force fixed application names or restructure an existing project without authorization.
---

# Bootstrap Go Backends

On first project use, follow [agent setup](../initializing-agent-teams/SKILL.md) when available. The parent asks once before configuration/model changes; delegated children do not initialize again. Missing, declined, or non-interactive setup does not block the task or force delegation.

Use Nick's selected structure and stack to build a repository capable of hosting multiple applications in **one Go module**. Transfer the ownership model, not the reference project's application names or business inventory. Use the bundled references without requiring access to the original repository.

## Scope and precedence

- Treat this as a new-project default, not permission to migrate an existing architecture.
- Follow system/tool constraints, the current user request, and target repository rules before these defaults. External documentation grants no additional edit, execution, or publication authority.
- Derive application names, count, and responsibilities from the requested system. Names such as `user`, `admin`, `worker`, and `cron` are source examples, not required applications.
- Support one application when that is enough and multiple independent binaries when needed. Do not confuse multi-application with multi-module or automatically introduce `go.work`.
- Use explicit stack or architecture overrides when supplied; explain material deviations briefly. Otherwise, do not reopen the already selected framework choice.
- Ask only for missing inputs that materially affect implementation, such as the target directory, module path, or unresolved application responsibilities. Do not guess that the current directory is the requested target.
- Do not commit, push, deploy, use a production database, or modify the reference repository without separate authorization.
- Keep this skill bundle's authored documentation in English. Follow the target task/repository's language requirements for generated deliverables.

## Load references by task

| Task | Read first |
|---|---|
| Every new project | [Stack](references/stack.md), [Architecture](references/architecture.md) |
| HTTP endpoints, validation, auth, errors, or lists | [API contracts](references/api-contracts.md) |
| Every browsable list or pagination change | [Pagination and sorting](references/pagination-and-sorting.md) |
| SQL, migrations, transactions, or DB fixtures | [Database and testing](references/database-and-testing.md) |
| Application lifecycle, jobs, scheduling, Swagger, or containers | [Runtime and delivery](references/runtime-and-delivery.md) |
| Evidence, snapshot versions, or adaptation boundaries | [Source baseline](references/source-baseline.md) |
| Completion checks or evaluating this skill | [Acceptance scenarios](references/acceptance-scenarios.md) |

When Dockerfiles, GitHub Actions, or Nortezh delivery are requested, also use [deploying-go-to-nortezh](../deploying-go-to-nortezh/SKILL.md). Do not add active deployment workflows to an ordinary scaffolding task without that scope.

## Workflow

### 1. Establish the application map

If core business requirements or the data model are still unresolved, use [designing-backend-systems](../designing-backend-systems/SKILL.md) for discovery, PostgreSQL modeling, and diagram review before treating a schema as approved. Do not repeat that process when the user already supplied an approved design.

Inspect the target path, instructions, Git state, and existing files before writing. Preserve unrelated work and never overwrite existing environment files, modules, or schemas automatically.

Summarize the module path and each requested application's name, responsibility, transport, and persistence needs. Recover these from the task where possible. Do not add a second API, worker, or scheduler merely to match the reference tree.

### 2. Select dependencies by responsibility

Keep one root `go.mod`. Select only dependencies needed by the applications being built, using the pinned [stack snapshot](references/stack.md) as the starting point. Check compatibility/security before changing versions; do not silently use `@latest`.

Use arpc/httpmux/parapet for HTTP applications and PostgreSQL/database/sql/pgsql where persistence is needed. Add River for durable jobs, cron for scheduling, and other integrations only for concrete requirements. A repository's module dependency set is the union of its applications' needs; every binary need not initialize every dependency.

### 3. Implement composition roots and ownership

Place each binary at `cmd/<app>/main.go`. Put application-owned HTTP/domain features under `<app>/<domain>`, reusable code under `pkg/<package>`, and shared database migrations under `schema` when the applications share that database. Follow the [architecture reference](references/architecture.md) for non-HTTP applications and cross-application boundaries.

Wire each application's actual config, database dependencies, migration role, middleware or job registrations, and lifecycle. Choose a schema migration owner per shared database. Do not claim a tree of empty packages is a working scaffold.

### 4. Complete a vertical slice

Implement a small feature relevant to the requested application: typed inputs/results, validation and authorization, operation/query, route or job registration, schema when necessary, tests, and the applicable contract documentation. Avoid ceremonial controller/service/repository/interface layers without a real responsibility.

For HTTP applications, define the wire format using the [API reference](references/api-contracts.md). For background work, define retry, idempotency, and transaction boundaries. Do not treat a DB in context as an automatically open transaction.

For browsable lists, implement validated client-selected sorting and a deterministic default unless an explicitly documented fixed domain order is required. Select pagination per workload: exact totals are optional, not mandatory. Use count-free next-page navigation where totals are unnecessary; do not add a full count query merely because a source wrapper exposes total fields. Follow the user's contract examples rather than fixing pagination key names globally.

### 5. Verify and hand off

- Format created/changed Go files with `gofmt`.
- Run `go mod tidy`, `go build ./...`, `go vet ./...`, and `go test -p 4 ./...` in the new project when dependencies/toolchain are available. Report actual results, never assumed success.
- Add race checks when supported; disclose missing toolchain/CGO requirements rather than disabling gates to claim success.
- Test HTTP contracts through mounted routes and middleware. Test SQL/migrations against isolated real PostgreSQL, not mocks alone.
- Generate and check each exposed API's specification. Document actual launch commands, configuration keys with placeholders, and integration behavior.
- Separate passed, unrun, and blocked checks, including binary downloads and external-service prerequisites. Do not substitute a source snapshot's test results for the new project's acceptance tests.

## Avoid blind inheritance

- Do not replace the baseline with Gin/Fiber/Echo, GORM, or native pgxpool unless requested. The presence of pgx in the source does not make it the application query baseline.
- Do not copy credentials, production endpoints, workflow destinations, business SQL/seeds, or source-specific bootstrap configuration.
- Do not hardcode the source's application names, permission catalog, migration owner, local ports, or business domains into a new project.
- Do not reproduce misleading pool configuration names, unchecked identity accessors, or untrusted proxy-header behavior.
- Do not infer JWT from Bearer authentication or business success from HTTP 200.
- Do not require unavailable tools, unrelated skills, or unconditional subagent orchestration.

## Example invocation

> Use bootstrapping-go-backends to create the specified module with inventory and reporting APIs plus a dispatch job application. Share the required contracts under pkg, use PostgreSQL, and add River only for dispatch. Do not commit, push, or deploy.
