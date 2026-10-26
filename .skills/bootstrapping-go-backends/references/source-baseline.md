# Source baseline and adaptation boundaries

## Snapshot

- Reference: Olufy-API, explicitly selected by the user for new Go projects' structure, stack, and database libraries.
- Inspected source commit: `01731b564d56dfb72755fe9421515aafc894b3dc`.
- Inspection date: 2026-10-22, Asia/Bangkok.
- Source working tree was clean at inspection. Source research was read-only; no source application or source database was run.
- Deliverable: distilled guidance, not copied source code, business SQL/seeds, credentials, or private runtime configuration.

The user's clarified architecture is **one Go module supporting multiple applications**. The source's application names and count illustrate this pattern; they do not define the target project's applications. Its concrete paths below are evidence locations, not runtime dependencies or instructions to reproduce those names.

## Evidence map

| Claim | Source file / anchor |
|---|---|
| Language/dependency pins | `go.mod:3-18`, direct dependency block around `87-112` |
| Application roots, domain ownership, shared packages | `.cursor/rules/ai-behavior.mdc`, sections 11.1-11.8 |
| Meaningful function extraction and formatting/tests | Same rule file, sections 3-4 |
| SQL builder and explicit list sorting | Same rule file, sections 10 and 12 |
| Source example of API composition/config/pool/migrations | `cmd/user/main.go:47-99`, `147-227` |
| Actual SQL driver selection | `pkg/ops/sql.go:7-17` |
| Optional cloud observability | `pkg/ops/ops.go:30-108` |
| Typed feature functions and authorization | `admin/role/role.go`: List/Get/Create/Update/Delete |
| Mount/auth group and context patterns | `admin/handler.go:34-47`, `186-207`; `user/handler.go`: apiMiddleware |
| Opaque session generation/hash/validation | `admin/auth/token.go`: generateToken/HashToken/ValidateToken |
| Runtime error encoder | `admin/rest.go:55-84`; `user/rest.go`: EncodeError |
| Two pagination contracts | `pkg/rest/paginate.go:11-73`; `pkg/api/paginate.go:9-148` |
| Sort wire shape and validation | `pkg/rest/sort.go`: Sort/UnmarshalJSON/ValidateSort/Do |
| Lists with client-selected sort | `admin/audit/audit.go:31-45`, `215-221`; `admin/user/user.go:26`, `114-120` |
| Full count in one source endpoint, not a universal requirement | `admin/audit/audit.go:184-192` |
| Custom embedded SQL migrations | `schema/schema.go`: Migrate/loadMigrationFiles/verifyChecksums/applyOne/Seed |
| Source deployment order/migration owner | `docs/db-auto-migration.md:3-19` |
| Embedded PostgreSQL mode/UTF-8/cleanup | `pkg/tu/postgres.go:20-204` |
| Per-test DB lifecycle | `pkg/tu/tu.go`: Setup/Env.Context/Env.Teardown |
| TestMain lifecycle | `schema/testmain_test.go`; `user/account/testmain_test.go` |
| Explicit transaction callback | `user/account/account.go:195`: pgctx.RunInTx |
| Transactional enqueue | `pkg/emailjobs/broadcast.go:26-35` |
| Source processor lifecycle example | `cmd/worker/main.go:84-113` |
| River's database/sql transaction support | `riverdriver/riverdatabasesql@v0.32.0/river_database_sql_driver.go`: New/UnwrapExecutor/ExecutorTx |
| Source scheduled-app example | `cmd/cron/main.go`: cron.New/cron.SkipIfStillRunning |
| Specification generation/build examples | `build/user/Dockerfile`; `build/admin/Dockerfile` |
| Local commands and bounded package concurrency | `Makefile`; README PostgreSQL testing section |
| Source-local Thai FE handoff requirements | Rule file section 9; `docs/fe-admin-audit-log.md` for document shape, not runtime contract proof |

## Deliberate adaptations

- **Preserved:** one module, multiple possible composition roots, application-owned features, shared pkg packages, database/sql + pgctx/pgstmt, explicit validation/auth/transactions, embedded migrations, and isolated real PostgreSQL tests.
- **Generalized:** derive application names, count, kinds, and migration ownership from the target system. Separate binaries do not imply nested modules or a fixed audience split.
- **Pagination by workload:** retain awareness of both source wrappers, but do not require exact totals on every list. Allow count-free next-page detection and cursor pagination where appropriate. Source wire key `next` is evidence; a new key such as `hasNext` is a target-contract choice, not a claim about existing endpoints.
- **Sorting:** support allowlisted client sort on browsable lists unless a fixed domain order is explicitly required; add a deterministic tie-breaker. Existing source examples do not prove that every endpoint already meets this policy.
- **Optionalized:** additional applications, River, cloud observability, and provider/infrastructure integrations. Do not require configuration for unselected modules.
- **Safer lifecycle:** bounded readiness/cleanup, safe missing-context behavior, trusted-proxy policy, and startup configuration validation.
- **Decoupled tests:** no global mutable DB name, seeded source identity, business sequence setup, production dotenv selection, or remote Redis fixture.
- **Version discipline:** record exact versions, then check compatibility/security before deliberate changes; do not inherit unpinned install commands.
- **Language:** author this skill bundle in English; follow target-task/repository language requirements for generated documentation.

When refreshing the baseline, inspect relevant source/diffs and record the new revision/date. Do not silently track remote changes and promote them into personal preferences.

## Local compatibility verification

A separate temporary loopback cluster was tested on Windows with Go 1.25.0 and PostgreSQL 15.13.0 on 2026-10-22. It did not load source app dotenv or connect to a source database.

- Ran River v0.32.0 migrations through `riverdatabasesql.New(db)` with a lib/pq v1.12.0 pool.
- Used pgsql v0.16.0 `pgctx.RunInTx`, a business insert, and `InsertTx` sharing `pgctx.GetTx`.
- Verified rollback retained neither the business row nor the job; commit retained both.
- Verified non-ASCII round-trip data and server encoding UTF8.
- Local compatibility command: `go test -v -count=1 -timeout 3m ./...` passed.

This evidence covers the pinned migration/enqueue/transaction combination, not worker execution, provider delivery, production rollout, new pagination implementations, or future generated applications. Re-run the target project's own acceptance tests.
