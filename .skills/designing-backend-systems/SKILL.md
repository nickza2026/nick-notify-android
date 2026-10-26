---
name: designing-backend-systems
description: Designs backend systems and PostgreSQL databases through detailed requirements discovery, normalized reusable data modeling, simple application boundaries, and collaborative DB diagram review. Considers Redis caching for justified high-RPS read paths rather than every system. Use when gathering backend requirements, discussing schema/ERD/DB diagrams, planning extensible data models, or evaluating backend design alternatives before implementation.
---

# Design Backend Systems and Databases

On first project use, follow [agent setup](../initializing-agent-teams/SKILL.md) when available. The parent asks once before configuration/model changes; delegated children do not initialize again. Missing, declined, or non-interactive setup does not block the task or force delegation.

Design **simple systems with strong data integrity, efficient access, and clear extension paths**. Prefer PostgreSQL as the authoritative store. Start from detailed requirements, not a favorite schema or framework. Add Redis caching only for a justified high-RPS access pattern with an acceptable consistency contract.

## Boundaries

- Author this skill bundle in English. Communicate and write target deliverables in the language requested for that project.
- Treat design discussion, implementation, migrations, external diagram sharing, and deployment as separate scopes. A request for design does not authorize creating a live database, executing DDL, provisioning Redis, or uploading private schema/data to an external service.
- Follow explicit target-project constraints. Do not assume a Go project, fixed application names, microservices, or a fixed application count. Use the simplest architecture meeting actual requirements.
- Preserve confirmed task logic. Propose better alternatives proactively, but do not silently change business rules or invent acceptance criteria.
- Distinguish confirmed facts, explicit assumptions, open questions, and human decisions. Never mark user/team approval on their behalf.

## Load by stage

| Stage | Reference |
|---|---|
| Requirements discovery and proposing improvements | [Requirements](references/requirements-discovery.md) |
| Entities, normalization, constraints, and evolution | [PostgreSQL modeling](references/postgresql-modeling.md) |
| High-RPS paths and cache trade-offs | [Redis and access patterns](references/redis-and-access-patterns.md) |
| Diagram construction, discussion, and team handoff | [Diagram review](references/diagram-review.md) |
| Checking the skill/design workflow | [Acceptance scenarios](references/acceptance-scenarios.md) |

## Workflow

### 1. Discover requirements in focused rounds

Read supplied requirements, tasks, existing diagrams/schema, and relevant repository constraints first. Ask targeted questions to clarify business vocabulary, actors, entity relationships, lifecycle, permissions, invariants, history, query patterns, scale, and credible future changes. Follow [requirements discovery](references/requirements-discovery.md).

Ask a manageable group of related questions per round rather than dumping a generic questionnaire or re-asking answered questions. Go deep where an answer changes relationships, integrity, ownership, or extension cost. Do not fabricate load numbers just to fill a template.

### 2. Summarize and challenge constructively

Summarize the confirmed requirements, scope/non-goals, important flows, invariants, expected evolution, workload assumptions, and remaining questions. If an existing process creates duplication, unnecessary coupling, unsafe behavior, or expensive future changes, recommend a simpler/better alternative with its trade-offs and ask whether that behavior is acceptable.

Resolve core data-shape and business-rule blockers and ask the user to confirm or correct the summary **before treating a physical schema or DB diagram as the proposed final design**. Draft exploration is allowed when requested, but label assumptions and unresolved questions clearly. Do not mistake silence for confirmation.

### 3. Model PostgreSQL first

Identify canonical entities/facts and their lifecycle/ownership. Normalize repeated facts and relationships, define keys/cardinalities/nullability, and choose constraints, transaction boundaries, and indexes from actual invariants and access patterns. Use [PostgreSQL modeling](references/postgresql-modeling.md).

Keep canonical data useful across applications and processing/reporting consumers through clear keys, shared operations, queries/views, and documented semantics. Do not duplicate an authoritative table for every screen or processor. Do not confuse fewer tables with less conceptual complexity.

Design for credible extensions with low migration impact, not every imaginable future. Avoid a universal EAV/JSON schema, excessive indirection, speculative service layers, or infrastructure chosen only for fashion. Explain any deliberate denormalization or historical snapshot separately from canonical mutable facts.

### 4. Plan efficient access and optional caching

Map critical reads/writes to queries, indexes, filters, validated sorting, and workload-appropriate pagination. Exact totals are optional; large lists may need count-free next-page navigation.

Evaluate Redis for specifically identified high-RPS read paths after considering PostgreSQL query/index efficiency, repeated keys, freshness, and cache hit potential. High RPS alone does not make every request cacheable. Document cache keys, scope, TTL, invalidation, concurrency, failure behavior, and source-of-truth boundaries. Read [Redis and access patterns](references/redis-and-access-patterns.md).

### 5. Prepare a shareable DB design and discuss it

After the requirements checkpoint, prepare an editable diagram in the team's format, with DBML as a portable text option when none is established. Use [the DBML wrapper](assets/schema.dbml.tmpl) only as a starting point, not a predetermined schema. Pair the diagram with a concise dictionary and decisions using [the design brief](assets/design-brief.md.tmpl).

Review it with the user/team: missing entities, wrong cardinalities, duplicated facts, lifecycle/history, integrity, future changes, and query/caching trade-offs. Present concrete questions, recommend improvements, and revise the diagram/dictionary/decisions together. Follow [diagram review](references/diagram-review.md).

Prepare local shareable artifacts without automatically publishing them externally. If the team has not reviewed the design, mark it **ready for review**, not approved. Record requested changes and who must decide; do not proceed as though a team checkpoint happened.

### 6. Hand off an honest implementation plan

Deliver requirements summary, schema/diagram, field/relationship dictionary, invariants, query/index plans, cache decisions, extension/migration strategy, and open decisions. Separate required validation from already executed evidence; a diagram does not prove query performance or race safety.

Do not start implementation merely because the design looks complete. When implementation is requested, apply the approved design and relevant project conventions. For a new Go backend, use [bootstrapping-go-backends](../bootstrapping-go-backends/SKILL.md) without reopening settled requirements or forcing source-example app names. Follow the project's verification rules and explicitly track any unapproved design assumptions.
