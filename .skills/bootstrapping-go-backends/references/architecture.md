# Single-module, multi-application architecture

Model the project as **one repository and one Go module containing one or more application binaries**. This is a monorepo-style application layout, not a requirement for multiple Go modules or separate microservices. Applications may share code and a database while retaining separate entrypoints, configuration, and lifecycles.

## Layout template

```text
<project>/
  go.mod                       # one module for the repository
  go.sum
  .gitignore
  .env.example                 # placeholders only
  Makefile                     # optional; also document direct Go commands
  .air.toml                    # optional; target the selected application
  cmd/
    <app-a>/main.go            # independent composition root
    <app-b>/main.go            # create only when required
    <job-app>/main.go          # optional worker/scheduler executable
  <app-a>/                    # application-owned packages when needed
    handler.go                 # Mount/routes for an HTTP application
    rest.go                    # HTTP/RPC error adapters
    swagger.go                 # optional specification serving
    docs/                      # generated API specification
    <domain>/
      <domain>.go              # typed operations, inputs/results, validation
      <domain>_test.go
      testmain_test.go          # only for packages requiring managed DB tests
  <app-b>/                    # same ownership rule; not necessarily another API
    <domain>/
  <job-app>/                  # optional app-local scheduled/job operations
    <domain>/
  pkg/
    api/                       # shared request metadata, when needed
    rest/                      # transport helpers/pagination, when needed
    codes/                     # shared stable application errors
    auth/                      # shared identity/session primitives, when needed
    config/                    # typed configuration helpers
    ops/                       # optional observability adapters
    tu/                        # reusable isolated DB test infrastructure
    <shared-domain>/           # contracts/operations reused across applications
    <job-domain>/              # reusable job args, enqueue and worker code
  schema/
    schema.go                  # embed + migration runner for a shared DB
    01.sql                     # this project's own schema
    seed.sql                   # optional explicit test/development seed
  docs/                        # integration and operational documentation
  build/<app>/Dockerfile       # only when container delivery is requested
```

The placeholders are roles, not literal folder names or a mandatory application count. Create only the packages needed by the first vertical slice. An application can be named for a product, domain, audience, or operational responsibility; do not automatically create a user/admin pair.

## Ownership rules

- Keep startup in `cmd/<app>/main.go`: load configuration, construct dependencies, choose migration responsibility, mount routes or register jobs, and manage lifecycle. Keep business SQL out of `main`.
- Keep application-local features under `<app>/<domain>`. For HTTP, prefer typed plain functions with a readable validate → authorize → operation/query → result flow. SQL may live in a domain function; extra layers are not mandatory.
- Move genuinely reused operations, clients, DTOs, and helpers into `pkg/<domain-or-purpose>`. Do not import one application's package from another just to reuse a type or helper. For example, reporting should import `pkg/catalog`, not the inventory application's handler package.
- Keep application-specific types near their owner. Do not create a catch-all `pkg/types` or `pkg/utils` by default.
- Use constructor/dependency structs for lifecycle-bearing workers and clients; use pgctx for database request contexts. Do not add mutable globals simply because some source helpers use them.
- Extract functions for meaningful reuse, test seams, or separate concerns, not pointless passthroughs.
- Use camelCase JSON and resource-scoped `id` when the method already identifies the resource. Define omitted/null/zero semantics before choosing pointer fields.
- Sharing a Go module does not require every application to share credentials, audiences, a process, a network port, or a database. When multiple databases are required, define their owners and migration boundaries explicitly rather than assuming one global `schema` fits all.

## Application types

- **HTTP API:** keep its route table, transport adapter, domain functions, and specification at its application boundary. Use the selected HTTP stack.
- **Durable job processor:** register workers in its own composition root. Put reusable enqueue/worker implementations in `pkg/<job-domain>`; a top-level application package is unnecessary if it would be empty.
- **Scheduled application:** register schedules in its composition root and keep app-local operations under `<app>/<domain>` or reusable operations under `pkg`.
- **Other executable:** follow the same composition-root and sharing rules. Do not initialize an HTTP server, queue, or database without a requirement.

One application may have several responsibilities if that is the requested deployment model. Do not split binaries merely for symmetry or collapse explicitly separate applications into one process.

## Module and tests

Keep one root `go.mod` by default. Separate binaries are not separate modules. Introduce nested modules or `go.work` only when explicitly justified and authorized.

Pair source and primary tests, such as `item.go` and `item_test.go`. Keep feature setup close to its tests; use external test packages when useful or needed to avoid import cycles.

Separate package lifecycle from feature helpers: one `testmain_test.go` may call `tu.Run(m)` to stop a package's embedded DB server before exit. Put reusable DB infrastructure in `pkg/tu`, not a growing central feature-test helper file.

## Do not transfer business inventory

Rename all module/import paths. Do not transfer source business tables, seeded accounts, permission catalogs, infrastructure bootstrap, or scheduled tasks. Preserve the ownership model and library choices, not the reference project's feature list.
