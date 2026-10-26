# Acceptance scenarios

Use these cases to evaluate skill behavior. A plan or dry-run is behavioral review, not proof that a generated application builds or runs.

## 1. One named application

**Prompt:** Create an inventory API at the specified path/module with an items feature and PostgreSQL. No other applications are requested.

**Expect:** One root module, `cmd/inventory/main.go`, `inventory/handler.go`, `inventory/item`, required shared helpers, schema, real implementation/tests/specification. Use arpc/httpmux/parapet and database/sql/libpq/pgsql. Do not reopen framework selection or add a second API, worker, scheduler, or cloud setup.

**Reject:** A forced user/admin pair, renamed source business domains, unrelated modules/go.work, empty scaffold claims, private-source imports, or an unrequested stack switch.

## 2. Several applications with different responsibilities

**Prompt:** Create inventory and reporting HTTP applications plus a dispatch job processor and a reconciliation scheduler. Share the required catalog contracts and database operations.

**Expect:** `cmd/inventory`, `cmd/reporting`, `cmd/dispatch`, and `cmd/reconciliation` in one module. Give each its own composition root and role-appropriate dependencies. Put shared contracts/operations in `pkg/catalog` rather than cross-importing application packages. Give only the HTTP applications route tables/specifications. Select a migration owner by responsibility, not an assumed source app name.

**Reject:** A fixed four-app template with source names, forced HTTP servers in non-HTTP apps, one module per app, or shared access credentials merely because the repository is shared.

## 3. Transactional job

**Prompt:** Persist an item and enqueue a River job atomically for a processor with the requested application name.

**Expect:** One lib/pq-backed pool used by pgctx and `riverdatabasesql.New(db)` in the producer. SQL and `InsertTx` share the callback context/physical transaction. Give the selected processor proper registration, migration rollout, retry/idempotency, and shutdown behavior. Test rollback; do not claim exactly-once.

**Reject:** Enqueue after committing business state, a second transaction/pool presented as atomic, or automatic request transactions attributed to pgctx middleware.

## 4. Source unavailable / explicit override

**Prompt:** Use the skill on a machine without the reference repository and without permission to clone it.

**Expect:** Use bundled references and implement local adapters without private imports, absolute source paths, or business seeds. Disclose missing downloads/toolchain instead of inventing test success.

**Adjacent prompt:** Fix a feature in an existing Gin/GORM repository while preserving its stack.

**Expect:** Preserve that repository and authorized scope; do not restructure it using new-project defaults.

## 5. Mounted HTTP contract

**Prompt:** Test invalid parameters, unauthorized access, and empty lists through the real application router.

**Expect:** Validation 400/code VALIDATION; typed unauthorized 200/ok:false under the baseline; clients inspect envelopes. Verify no-result output and absence of raw DB diagnostics. Keep pagination fields consistent with the endpoint's selected mode.

## 6. Count-free large list with sorting

**Prompt:** List a very large dataset without total counts, while supporting a requested allowlisted sort and next-page navigation.

**Expect:** Select a count-free mode, fetch at most limit + 1 matching rows, compute the chosen next-page flag, return at most limit rows, and omit unavailable totals rather than inventing zeros. Do not execute a full COUNT. Apply default/selected SQL sort with a stable unique tie-breaker before fetching. Use an appropriate indexed cursor when deep offsets are unsuitable; bind the cursor to the selected sort/filter context.

**Cases:** Empty, fewer than limit, exactly limit, and limit + 1 rows; alternate and default sort; equal primary sort keys; invalid sort; page-size boundaries. Verify returned order and next-page state. Cursor changes must not silently mix incompatible ordering.

## 7. Counted list when explicitly needed

**Prompt:** Build a manageable list whose client explicitly needs an exact total and page-number navigation.

**Expect:** Implement the documented counted contract and an authorized, filter-consistent count query. Retain sorting and tie-breaker behavior. Do not force the count-free mode everywhere, make up totalPages, or add an exact count to unrelated endpoints.

## 8. Migrations and safe tests

**Prompt:** Initialize DB tests on Windows and add a fresh-project migration.

**Expect:** Start at 01.sql with a project-specific lock/ledger; use isolated UTF-8 PostgreSQL, lazy TestMain cleanup, per-test databases, and explicitly test-only external mode. Do not copy source accounts, Redis settings, production dotenv, or migration history.

**Reject:** Guessing a baseline, dropping databases the harness did not create, silently skipping unsupported names such as 100.sql, or claiming whole-upgrade rollback.

## Completion criteria for a generated project

- Verify application/import/dependency ownership, not just a proposed tree.
- Exercise actual routers and isolated databases; validate each selected pagination/sort contract.
- Run formatting/build/vet/tests and separate passed, blocked, and unrun checks.
- Check specifications, configuration placeholders, secret exclusions, and application-specific launch instructions.
- Do not commit, push, deploy, or expand product scope without authorization.
