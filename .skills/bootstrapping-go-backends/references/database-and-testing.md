# PostgreSQL, migrations, and isolated tests

## Contents

- [Database access](#database-access)
- [Transactions](#transactions)
- [Embedded migration runner](#embedded-migration-runner)
- [Test database lifecycle](#test-database-lifecycle)
- [Verification matrix](#verification-matrix)

## Database access

Default to database/sql + lib/pq. Inject a DB with `pgctx.Middleware(db)` for HTTP requests or `pgctx.NewContext(ctx, db)` for jobs/tests, and propagate context through every operation.

Use `pgctx.QueryRow(ctx, query, args...).Scan(...)`, `pgctx.Exec(ctx, query, args...)`, or pgstmt as appropriate. Bind values; allowlist dynamic identifiers rather than treating them as bindable values. Close rows and check iteration errors, or use the verified `pgstmt.IterWith` API.

Map `sql.ErrNoRows` with `errors.Is` and driver errors such as `*pq.Error` with `errors.As` into stable application errors. For example, PostgreSQL `23505` is a unique violation, not an arbitrary internal failure.

Configure the pool explicitly. Source starters are max open 10, idle 5, and lifetime five minutes, not capacity guarantees. Keep `db_conn_max_lifetime` mapped to `SetConnMaxLifetime` and `db_conn_max_idle_time` to `SetConnMaxIdleTime`; do not inherit the source's misleading idle-time key for lifetime.

Use bounded `PingContext` before declaring readiness. `sql.Open` alone does not prove connectivity. Keep DSNs in environment/secret configuration and never log credential-bearing URLs.

For list queries, select counted or count-free pagination per endpoint. Use bounded `limit + 1` fetching for next-page detection where totals are unnecessary; do not introduce an unconditional full `COUNT(*)`. Apply allowlisted, deterministic sorting before the page boundary. See [API contracts](api-contracts.md) for cursor and offset constraints.

## Transactions

A DB in context does **not** automatically open a request transaction. Define atomic boundaries for coupled writes, audit/outbox records, and state changes plus enqueue.

```go
err := pgctx.RunInTx(ctx, func(txctx context.Context) error {
    _, err := pgctx.Exec(txctx,
        "update items set name = $1 where id = $2", name, id)
    return err
})
```

This illustrates the API shape, not a complete endpoint: implement schema, validation, authorization, and rows-affected semantics. Use the callback context for every transactional query, not the outer context or pool. Return an error to roll back; commit only on success.

Use row locks, constraints, conditional updates, and isolation according to invariants, not `FOR UPDATE` on every read. Keep transactions short and avoid copying domain-specific network calls under row locks without a requirement.

For atomic River enqueue, create the client from `riverdatabasesql.New(db)` using the same lib/pq-backed pool injected into pgctx. Call `InsertTx(txctx, pgctx.GetTx(txctx), args, opts)` with the **same physical transaction** as the business write. Check `pgctx.IsInTx` before `GetTx`, which panics outside a transaction.

A second pool or transaction against the same URL does not create shared atomicity. Do not retry external side effects without an idempotency design.

## Embedded migration runner

Preserve the custom embedded SQL migration approach rather than silently introducing Goose or golang-migrate. Implement and test it locally; it is not supplied by pgsql.

1. Embed SQL using `schema/schema.go` and `//go:embed *.sql`; distinguish numbered migrations from explicit `seed.sql`.
2. Start a new project's history at `01.sql`. Sort numerically and reject duplicate, gapped, or unsupported version names; do not continue the source project's migration count.
3. Acquire a PostgreSQL advisory lock on a dedicated `*sql.Conn` using a project-specific key. Lock and unlock on the same connection.
4. Use bounded startup and cleanup contexts. Do not return a pooled connection that still holds a session lock to normal use after an unlock failure.
5. Keep a ledger such as `schema_migrations` with version, SHA-256 checksum, and applied time. Reject missing or modified applied migration bytes.
6. Apply **one transaction per migration file**, including its ledger insert. Earlier files remain committed if a later file fails; do not claim whole-upgrade atomicity.
7. Run seed explicitly for tests/development, not as automatic production-account creation.
8. Select one app/job as migration owner **per shared database**, independent of its name. Start dependent apps after schema readiness. For multiple databases, model separate ownership/migration scopes.

**Migration authoring granularity:** Default to **one numbered SQL migration file per delivery commit** for a coherent schema change; do not create a fresh numbered file for each additional statement or each iteration before publication. Inspect the latest migration, Git/index history, and known application status first. If `schema/42.sql` is an **uncommitted draft** and has **not been applied to any persistent/shared database**, add the new SQL to `42.sql` instead of inventing `43.sql`. It is fine to include application code, tests, and docs in the same commit; "one migration file" does not mean "one file total." Rerun migration tests against a disposable database from a clean schema after editing a draft; a checksum ledger in an already-migrated disposable test DB may need a safe reset of that **test-only** database, not a checksum bypass.

**Git status is not deployment evidence.** An uncommitted migration might have been run manually or by another worker. Do not query or mutate production/shared databases without authorization; use available rollout records or an authorized ledger inspection, and ask when application status is uncertain. Once a migration is committed/shared as an immutable contract **or applied to a persistent/shared database**, preserve its bytes and add a new numbered migration for later changes. If safe compatibility requires separate expand/backfill/contract releases, nontransactional SQL, or independently rolled-out databases, explain the necessary extra files/commits rather than mechanically enforcing one file.

Never rewrite released/applied migration files; add the next migration. Preserve historical bytes and line endings because checksums are not normalized across LF/CRLF.

The source recognizes exactly two-digit names, `01.sql` through `99.sql`. A new implementation must fail on unsupported numeric names rather than silently ignoring `100.sql`, or deliberately introduce a wider naming policy with matching tests.

Baseline mode is unnecessary for a fresh database. If supporting an existing database, require an operator-verified schema/history before recording baseline rows. Baseline bookkeeping does not validate schema objects. Do not transfer the source's `public.users` existence guard as a universal database-emptiness check.

Do not claim down migrations or automatic rollback if unimplemented; recovery must account for previously committed files.

## Test database lifecycle

Use real PostgreSQL through `embedded-postgres v1.34.0` as the default DB integration harness. The source pins binary `15.13.0`; pin a supported test version explicitly and align with the target production major when known. This is a snapshot, not a permanent server-version recommendation.

Implement `pkg/tu` with these responsibilities:

- Capture explicit process test configuration before application dotenv loading. Never select the test server from production/application `.env`.
- Lazily start a loopback-only cluster with a random port/password and temporary runtime/data directories per package process.
- Explicitly select UTF-8 during initdb, especially on Windows; do not inherit an unsuitable host encoding.
- Separate reusable binary archive cache from disposable runtime/data. First use may download a platform binary from the configured trusted Maven repository; disclose cache/network prerequisites.
- Create an independently named database per test, migrate, optionally seed synthetic data, and inject its context. Do not substitute one surrounding rollback transaction for all isolation requirements.
- Register error-safe cleanup as resources are acquired, using `testing.T.Cleanup` or an equivalent lifecycle. Close handles and drop only databases the harness created, including partial-setup failures.
- Stop package-level PostgreSQL before exiting through TestMain:

```go
func TestMain(m *testing.M) {
    os.Exit(tu.Run(m))
}
```

Implement `tu.Run` so cleanup precedes its returned exit code and cleanup failure fails the test process. A defer after directly calling `os.Exit` will not run.

| Test setting | Contract |
|---|---|
| `TEST_DB_MODE` | `auto`, `embedded`, or `external`; auto uses embedded when no explicit external URL exists |
| `TEST_DB_URL` | Explicit test-only server template with exactly one `%s` database-name placeholder; used by external or auto opt-in |
| `TEST_POSTGRES_CACHE_DIR` | Binary archive cache, not a production data directory |
| `TEST_POSTGRES_REPOSITORY_URL` | Optional trusted Maven mirror, not an application DB endpoint |

Embedded mode ignores external URLs; external mode fails without one. Validate URL structure and override parameters. Replace only `%s` rather than using `fmt.Sprintf` and corrupting percent-encoded credentials. External mode creates/drops databases, so require an explicitly authorized test-only server, never production.

On Windows, stop the server before deleting runtime files, retry deletion with a deadline, and refuse deletion while the process remains active. Validate deletion targets and avoid cross-shell recursive deletion. Forced termination can bypass cleanup; report leftovers rather than sweeping unrelated temp directories.

Do not inherit mutable global test DB names, source-seeded identities/tokens, business sequence initialization, remote Redis settings, or application dotenv loading.

## Verification matrix

Test at least:

- Fresh migration, rerun idempotence, applied checksum mismatch/missing files, invalid/gapped names, file transaction failure, and seed separation.
- CRUD success/not-found/unique conflicts, validation/auth/permission failures, and atomic rollback of coupled writes.
- Mounted HTTP envelopes/statuses, including validation 400 versus typed domain-error 200, separately from direct function tests.
- Required list sorting, stable tie-breakers, and each endpoint's selected pagination mode. Verify count-free endpoints use no full count query and return the correct next-page flag without leaking the extra row.
- Independent databases, partial-setup cleanup, and unit-only selections that do not start PostgreSQL.
- UTF-8 encoding and non-ASCII round trips where supported.
- Queue enqueue rollback with the business transaction when River is selected. Do not contact real providers without explicit test opt-in.

Use `go test -p 4 ./...` to bound package processes starting embedded databases; add race checks when supported. Record real commands/results and distinguish prerequisites from executed verification.
