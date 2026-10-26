# Stack baseline

Select dependencies from this snapshot rather than copying the source `go.mod` wholesale. See [source-baseline.md](source-baseline.md) for provenance. Keep one root module; include only the union of dependencies actually used by the requested applications.

## Defaults by application responsibility

| Responsibility | Package / tool | Observed source version |
|---|---|---|
| Language/module | Go; one module per repository | `go 1.25.0` |
| HTTP backend/lifecycle | `github.com/moonrhythm/parapet` | `v0.13.6` |
| HTTP route/method matching | `github.com/moonrhythm/httpmux` | `v1.2.0` |
| Typed RPC-style HTTP handlers | `github.com/acoshift/arpc/v2` | `v2.2.0` |
| Environment/dotenv reader | `github.com/acoshift/configfile` | `v1.9.0` |
| Database abstraction | `database/sql` | standard library |
| PostgreSQL application query driver | `github.com/lib/pq` | `v1.12.0` |
| Context SQL + statement builder | `github.com/acoshift/pgsql` (`pgctx`, `pgstmt`) | `v0.16.0` |
| Request validation | `github.com/moonrhythm/validator` | `v1.3.0` |
| Logging | `log/slog` | standard library |

Use the HTTP libraries for HTTP applications and PostgreSQL libraries for applications needing persistence. A scheduler or worker does not require an HTTP server simply because another binary uses one.

This snapshot does not select a production PostgreSQL server version. Do not infer that version from a driver or test fixture. Start from the listed dependency pins, check module/toolchain compatibility and advisories, and explain proposed changes instead of silently upgrading, downgrading, or using `@latest`.

## Add only when required

| Requirement | Package | Source version / constraint |
|---|---|---|
| DB integration tests | `github.com/fergusstrange/embedded-postgres` | `v1.34.0`; source test server `15.13.0` |
| Test assertions | `github.com/stretchr/testify` | `v1.11.1`; retain `testing`/`httptest` as the foundation |
| Movable pagination variant | `github.com/acoshift/paginate` | `v1.1.2`; only for the selected `page/perPage` wrapper |
| UUIDs | `github.com/google/uuid` | `v1.6.0` |
| Exact decimal amounts | `github.com/shopspring/decimal` | `v1.4.0`; avoid float arithmetic for exact monetary amounts |
| Password hashing | `github.com/moonrhythm/passwordtool` | `v1.4.0`; verify its API and the target security policy |
| Durable queue | `github.com/riverqueue/river`, `github.com/riverqueue/river/riverdriver/riverdatabasesql` | both `v0.32.0`; use `*sql.DB` |
| Alternative database/sql driver | `github.com/jackc/pgx/v5` | `v5.9.1`; present in the source, not a mandatory River driver switch |
| Scheduling | `github.com/robfig/cron/v3` | `v3.0.1` |
| WebSocket | `github.com/gorilla/websocket` | `v1.5.3` |
| OAuth | `golang.org/x/oauth2` | `v0.24.0` |
| Swagger generation | `github.com/swaggo/swag` | `v1.16.6`; pin the generator consistently |
| Collection helpers | `github.com/samber/lo` | `v1.50.0`; unnecessary for simple loops |

## Implement local adapters

`pkg/api`, `pkg/rest`, `pkg/codes`, `pkg/auth`, `pkg/config`, `pkg/ops`, and `pkg/tu` are source-local packages, not functionality supplied by `go get`. Implement only the local adapters the new applications need, with tests. Do not import the private reference module or call helpers that have not been created.

The source's `ops.PgDriver()` wraps registered lib/pq `postgres` through OpenCensus. Its `ops.WrapDriver()` separately wraps pgx stdlib. These do not imply two different database backends.

For a minimal application, use `sql.Open("postgres", dsn)` with lib/pq registration and explicitly omit the source-specific tracing adapter. Implement `pkg/ops` only if needed; do not import the entire cloud stack for cosmetic similarity.

When enabling River, keep the lib/pq-backed application pool and pass that **same `db`** to `riverdatabasesql.New(db)`. Use the same physical `*sql.Tx` for coupled business writes and `InsertTx`. Do not create an additional pgx pool and assume transactions span both pools. Driver v0.32.0 unwraps `*sql.Tx` directly, not a native pgx transaction.

## Exclude unrelated infrastructure

Do not add cloud logging/profiling, exporters, payment providers, SMTP/SMS, hypervisor clients, tunnels, remote consoles, Redis, or other infrastructure just because source documentation mentions them. Require a concrete use case and explicit configuration.

In particular, no Redis client was established as a core dependency in the inspected `go.mod`; a mention in test or operational documentation is not proof of a default stack choice.
