# API contracts and feature conventions

Apply this reference to each application that exposes an HTTP API, not to every executable in the repository.

## Routing and function shape

Register method + path with httpmux and adapt typed functions through `arpc.Manager`. Use a shape such as `func Get(ctx context.Context, p *GetParams) (*GetResult, error)`, with JSON tags and `Valid() error` on request types.

Use `validator.New()`, `v.Must(condition, "message")`, and `v.Error()`. Explicit validation in a domain function can support direct invocation; arpc v2.2.0 also validates requests before invocation by default. Keep validation idempotent and free of database writes or other side effects.

Register endpoints with `mux.Handle("POST /item.get", am.Handler(item.Get))`. Use `POST /<resource>.<action>` as the RPC baseline. This is not JSON-RPC 2.0: the request body contains parameters directly, not a `jsonrpc`/`method`/`id` envelope.

Place `Mount(mux *httpmux.Mux, am *arpc.Manager)` in `<app>/handler.go`. Separate public routes from protected groups, for example `mux.Group("/", am.Middleware(apiMiddleware))`. Determine application boundaries from requirements rather than assuming two audiences or fixed application names.

## Identity and authorization

- Read `Authorization: Bearer <access_token>` in middleware, validate the session, and install identity/token using typed context keys.
- Check permissions and resource ownership/tenant scope at the domain boundary. Successful authentication does not authorize every operation.
- Preserve the idea of an explicit authorization function, but define permissions for the new domain. Do not copy source accounts, permission catalogs, or privileged bypasses.
- Do not infer JWT from Swagger examples. The source uses opaque random session tokens with SHA-256 hashes stored in PostgreSQL; define expiry, refresh rotation, and revocation deliberately.
- Handle missing identity safely rather than copying unchecked type assertions and treating recovery as an authorization response.
- Separate audiences when required. Frontend visibility is not backend authorization.

## Response contract

Configure adapters explicitly before writing the client specification. The RPC success baseline uses HTTP 200:

```json
{"ok":true,"result":{"id":"example-id","name":"Example"}}
```

Typed application/domain/auth errors use HTTP 200:

```json
{"ok":false,"error":{"code":"UNAUTHORIZED","message":"auth: unauthorized"}}
```

Validation errors from the custom encoder use **HTTP 400**, code **`VALIDATION`**, and optional `items` when details exist:

```json
{"ok":false,"error":{"code":"VALIDATION","message":"validation error","items":["id is required"]}}
```

The inspected encoder masks unknown errors as `INTERNAL_SERVER_ERROR` with a generic message and HTTP 200. The rate limiter has its own 429 path. Do not expose raw SQL/internal diagnostics.

Do not interpret HTTP 200 alone as business success or claim every response uses 200. Normalize typed codes to stable `UPPER_SNAKE_CASE`. If the user selects conventional REST statuses, record that contract change and update tests/specifications together.

Implement `<app>/rest.go` and wire `am.WrapError`, `am.ErrorEncoder`, `am.OnOK`, and `am.OnError`. Returning an error alone does not establish the baseline envelope. Test mounted handlers, including no-result functions; do not infer `{ok:true}` versus `result:null` from documentation types alone.

## Lists, pagination, and updates

The source contains two incompatible pagination contracts:

| Source-local wrapper | Input | Output |
|---|---|---|
| `pkg/rest.Paginate` | `page`, `limit` | `page`, `limit`, `totalItems`, `totalPages`, `firstPage`, `lastPage` |
| `pkg/api.Paginate` | `page`, `perPage` | `page`, `perPage`, `next`, optional `totalCount` after `CountTotal` |

Select pagination per endpoint and workload using [pagination and sorting](pagination-and-sorting.md). Neither source wrapper is mandatory for every new list. Counted page-number navigation is appropriate when exact totals are actually required; count-free next-page navigation is appropriate when totals are unnecessary or expensive. Preserve a supplied target-contract example rather than choosing incompatible keys or metadata automatically.

- Define whether `paginate` is required or has defaults. Reject invalid/nonpositive values, bound page size, and guard overflow and division by zero.
- For count-free lists, fetch at most limit + 1 rows, return at most limit, expose the chosen next-page flag, and omit unavailable totals. Do not add a full COUNT query or manufacture totalItems/totalPages.
- Choose a workload-appropriate cap and document it. The source's `pkg/api` has default 50/cap 1000; `pkg/rest` does not establish those defaults or that cap.
- Return `items: []` when the contract promises an array. Define actual nullability rather than banning nil slices throughout Go code.
- Expose allowlisted sort fields/directions for browsable lists unless an explicitly documented fixed domain order forbids selectable sorting. In either case, use a deterministic tie-breaker when applicable and apply ordering in SQL before pagination, not in memory after fetching a page.
- Test default/alternate/invalid sort and pagination boundaries. Never concatenate unchecked client identifiers or sort directions into SQL.
- Distinguish omitted, null, empty, false, and zero for updates. Use pointers/custom types when needed; zero values do not automatically mean "not supplied."
- Use pgstmt for suitable dynamic filters/updates or readable parameterized SQL. Do not generate arbitrary column maps from client input.

## Specifications and integration handoff

For each new/modified frontend-facing endpoint, create or update a `.md` using [documenting-frontend-api-handoffs](../../documenting-frontend-api-handoffs/SKILL.md), with a complete changed-route inventory and before/after adoption notes. Include request/response and error examples verified against actual runtime-facing code; omit SQL/migrations, backend internals, deployment commands, and backend test/commit history. Do not mistake a Swagger update for the FE handoff.

Inspect validation, serialization, route registration, and permission checks before documenting behavior. Generate a specification per exposed API application; a worker does not need a Swagger document merely for symmetry.

- Document method/path, auth, permissions, envelopes, nullability, optionality, defaults, and enums. Preserve accurate `required`, descriptions, and examples when changing schemas.
- Align Swagger status declarations with runtime encoders; do not copy contradictory source `401` annotations over HTTP-200 typed errors.
- Follow the requested or repository-established documentation language. Source-specific Thai FE handoff rules do not make every new project's output Thai; this skill bundle itself remains English.
- For integration handoffs, include request/response JSON and key-reference tables covering nested example fields, relevant targeting/timing/error semantics, and a checklist.
- For multiple screens, include endpoint-to-screen and permission-to-action mappings, navigation, and loading/empty/error behavior as backend integration guidance, not permission to implement the frontend.
