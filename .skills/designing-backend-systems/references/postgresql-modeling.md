# PostgreSQL modeling

Use PostgreSQL as the primary authoritative store unless the current task explicitly selects otherwise. Favor a clear relational model whose facts can be reused by multiple applications and processing paths.

## Normalize canonical facts

- Identify stable entities, functional dependencies, lifecycle, and relationship cardinality before choosing table names.
- Prefer a practical normalized design, commonly through third normal form where applicable. Store one authoritative fact in the right owner rather than copying it into every screen, workflow, or application table.
- Separate independent entities and use explicit foreign keys. Represent many-to-many relationships through junction entities when needed; give relationships their own attributes/history when the domain requires them.
- Use atomic typed values rather than delimited ID strings, repeating column groups, or arrays/JSON standing in for relationships that need relational integrity.
- Do not split every value into its own table or chase a normal-form label at the expense of a comprehensible model. Normalization concerns dependencies and update anomalies, not maximizing table count.
- Distinguish mutable master data from historical facts. An immutable transaction-time address/price snapshot can be legitimate history, not an accidental duplicate that should always follow current data.
- Define canonical versus derived/projected data and ownership explicitly. Use queries, views, shared domain operations, or justified read models to reuse data; do not make consumers maintain independent authoritative copies.

## Make integrity explicit

Document each table's purpose and grain, primary identity, business key/uniqueness scope, nullable fields, and relationship meaning. Pick surrogate/natural keys according to stability and use; do not tie durable identity to a mutable label without a requirement.

Use suitable PostgreSQL types and database constraints: NOT NULL, CHECK, UNIQUE, foreign keys, and deliberate update/delete actions. Explain tenant-scoped uniqueness and ensure relationships cannot accidentally cross tenants. PostgreSQL does not automatically index the referencing side of every FK; add indexes where access/delete patterns justify them, not blindly on every column.

For optional unique values, clarify PostgreSQL null semantics and version-dependent features rather than assuming null behaves like an ordinary duplicate. Define case/collation rules when they affect identifiers or search.

Use timestamp semantics appropriate to the fact: commonly timestamptz for instants, explicit business timezone when schedules depend on local time, and date for calendar dates. Do not convert every temporal concept into a string.

For money/credits, define units, currency, scale, rounding, bounds, ledger/balance invariants, and idempotency before choosing numeric precision or integer minor units. Never default to floating-point balances or assume every currency uses two decimals. Keep authoritative mutations in safe PostgreSQL transactions/constraints, not a Redis cache.

## Transactions and application boundaries

Identify operations that must commit together, concurrent writer conflicts, uniqueness/deduplication, and side effects requiring post-commit coordination. Choose constraints, conditional writes, locking, or isolation to protect the actual invariant, not every possible lock at once.

Keep the application architecture simple: a modular application with shared domain code is often sufficient. Multiple binaries may share the same canonical database without requiring separate schemas/copies for each. Define write ownership and common invariants across all writers. Do not add microservices, queues, event sourcing, CQRS, or repository layers without a concrete benefit that justifies their cost.

## Plan access, then indexes

Map important use cases to representative query shapes: predicates, joins, ordering, result size, pagination, and latency/workload assumptions. Support validated sorting on browsable lists and select counted versus count-free pagination per workload.

Choose indexes aligned with actual filtering/ordering/join patterns, including tenant scope and stable pagination tie-breakers. Explain write/storage costs, selectivity assumptions, and how a query plan or representative test would validate the choice. Do not claim an index guarantees performance without relevant evidence.

Prefer efficient PostgreSQL queries/indexes before adding caches or complicated read infrastructure. For justified denormalization/materialized projections, record source facts, update/rebuild owner, consistency/staleness, and recovery; do not make duplicated values silently authoritative.

## Design for plausible evolution

Test concrete extension scenarios against the schema: another category/type, a relationship gaining attributes, a future application/report, historical revisions, or an evolving permission/ownership rule. Identify the actual migration cost and trade-offs; do not promise zero changes for all future requirements.

Avoid speculative universal entity tables, EAV, or unconstrained JSONB as a shortcut to "maximum flexibility." JSONB is appropriate for bounded heterogeneous metadata when its validation/query/integrity trade-offs are explicit, not as an untyped replacement for the core relational model.

Choose enum, CHECK, or reference tables according to lifecycle and administration needs rather than a universal rule. Do not hardcode a closed set when users must create new values, or create a management table for every constant without a need.

For existing systems, propose backward-compatible migrations, backfill/validation, and an expand/contract rollout when required. Do not rewrite applied migrations, silently discard old facts, or execute destructive DDL as part of the design conversation.
