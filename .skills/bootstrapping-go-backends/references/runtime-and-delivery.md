# Application runtime and delivery

## Composition roots

Implement each `cmd/<app>/main.go` according to that application's responsibility. A multi-application module does not require identical startup logic for every binary.

For an HTTP application:

1. Load development dotenv when appropriate and read typed configuration with configfile. Do not print secrets.
2. Initialize logging and optional observability without requiring cloud credentials for ordinary local work.
3. Open and configure its database dependencies and run bounded connectivity checks.
4. Migrate only if this application is the selected owner for that database. Otherwise depend on the declared migration readiness/rollout.
5. Construct parapet, httpmux, and arpc; configure the application's adapters.
6. Mount public/protected routes, DB/config context, request ID, recovery, metadata, and any limiter. Test actual middleware order rather than assuming it from registration order.
7. Listen on the application's configured address. Allocate distinct local ports when running multiple HTTP applications; do not inherit fixed audience-to-port mappings.
8. Handle termination, bounded shutdown, and resource cleanup, including startup-error paths. Do not expect deferred cleanup after `log.Fatal` or another immediate exit.

Validate required configuration during startup rather than deferring missing-config panics to the first request. This is a safety adjustment, not a claim that the source already validates all configuration at startup.

Define trusted proxy behavior before using forwarded client-IP headers for authorization, rate limiting, or audit. Define whether readiness checks process state, DB connectivity, schema readiness, or other dependencies; do not label untested components healthy.

## Durable job applications

Use River + riverdatabasesql only when durable asynchronous work is required. Choose the processor application's name from the task, not a mandatory `worker` name.

- Put reusable args, `Kind()`, enqueue helpers, worker implementations, and dependency structs in `pkg/<job-domain>`.
- Register consumers and queues in the selected `cmd/<job-app>/main.go`; do not start consumers in every API unless the deployment model explicitly requires it.
- Give producing applications insert-only clients when needed. `Queues: nil` does not make jobs execute without a running processor.
- Use `riverdatabasesql.New(db)` with the lib/pq-backed pool. Every process may own its own pool, but coupled writes/enqueue within one operation must share the same physical `*sql.Tx`.
- Manage River migrations through rivermigrate separately from the application's custom migration ledger; select owners and rollout order for both.
- Enqueue atomically with `InsertTx` when required by the business invariant.
- Choose concurrency, attempts, and timeouts for the workload. Make processing idempotent and describe delivery as at-least-once, not exactly-once.
- Do not put unnecessary credentials or bearer tokens in args/logs; pass identifiers and retrieve protected data through the appropriate store.
- Stop via `signal.NotifyContext` and a fresh bounded shutdown context for `client.Stop`.

## Scheduled applications

Register schedules in `cmd/<scheduled-app>/main.go` using robfig/cron. Keep application-local operations in `<scheduled-app>/<domain>` and genuinely reusable operations in pkg. An application need not be named `cron`.

Choose an explicit timezone for local-time schedules. Use timeouts/cancellation and prevent overlap when needed, for example with `cron.SkipIfStillRunning`. This prevents overlap within one process, not across replicas; use database coordination or a deliberate singleton deployment for cross-process requirements. Stop tickers during shutdown.

## Specifications and local commands

Pin swag `v1.16.6` consistently with the dependency snapshot; do not inherit the source container's unpinned `@latest` installation.

Generate specifications only for applications exposing an API, into their own docs packages. Keep generator entrypoint, output directory, registered instance name, and `swag.ReadDoc` lookup consistent for each application. Do not reuse an instance named after an unrelated source application.

The source's generation commands reside in its per-application Dockerfiles, not a Makefile generation target. Add a reproducible command/target appropriate to the new application names rather than copying its paths. If Swagger UI relies on a CDN, document the network requirement or bundle assets for offline use.

Document real commands for the created applications. These are templates; replace `<app>` with an actual selected name:

```text
go run ./cmd/<app>/.
go build ./cmd/<app>
go build ./...
go test -p 4 ./...
```

Do not run an application simply to check compilation when startup could migrate a database, enqueue jobs, or contact providers. Use isolated test configuration for runtime smoke checks.

Add Makefile/Air only when useful and document direct Go commands for Windows without make. Point Air at the selected application's entrypoint; do not carry over a source default binary. Use appropriate Windows executable paths rather than assuming Linux paths were tested.

## Container delivery when authorized

Use multi-stage builds: a Go toolchain matching the module, a per-application build, then a minimal runtime image. Set `CGO_ENABLED=0` only when selected dependencies support it; do not use that image-build choice to suppress race testing requirements.

Copy only actual runtime assets. Exclude environment secrets, caches, test fixtures, and unrelated source assets using `.dockerignore` before building, because build context can transmit files even if the Dockerfile never copies them.

Create deployment/CI only when requested. Do not copy the source's environment destinations or secret configuration, or infer image-push/deploy authorization from a scaffolding request.
