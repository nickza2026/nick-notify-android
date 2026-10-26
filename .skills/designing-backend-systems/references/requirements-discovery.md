# Requirements discovery

Use the actual task and existing material as the starting point. Gather detailed answers that affect the data model, not an indiscriminate list of every possible enterprise requirement.

## Establish the decision context

Record the problem, scope/non-goals, stakeholders, existing systems/data, hard constraints, and the decisions this design must enable. Reuse prior answers and identify conflicting requirements. Do not derive business rules solely from an existing implementation when the intended behavior differs or is unknown.

Ask focused rounds of related questions and explain why a question changes the design. Summarize answers as they arrive. Do not make the user repeat material already supplied or invent answers to reach a premature schema.

## Questions that shape the database

| Topic | Clarify when relevant |
|---|---|
| Vocabulary and identity | What is each real-world entity? Which facts identify it? Which labels/codes can change? Are two similar concepts genuinely the same? |
| Actors and ownership | Who creates/reads/updates/deletes data? Is ownership personal, shared, organizational, or tenant-scoped? Can it transfer? |
| Relationships | One-to-one, one-to-many, or many-to-many? Required or optional? Can relationships change over time or have their own attributes/history? |
| Lifecycle and rules | Valid states/transitions, triggering events, prerequisites, ordering, cancellation, expiry, and forbidden combinations? |
| Integrity and concurrency | Which facts must remain unique/consistent? What must commit together? What happens with duplicate requests, simultaneous writes, retries, or provider timeouts? |
| History | Current value only, effective dates, audit log, immutable transaction snapshots, corrections, or full change history? |
| Data reuse | Which applications, reports, exports, workers, or integrations process the same facts? Who owns writes and which meanings must stay consistent? |
| Access patterns | Important detail/list/search/report queries, filters, sorting, pagination, joins, and exact-total requirements? |
| Workload | Expected data growth, endpoint-specific peak RPS/concurrency, read/write mix, hot keys, latency budget, and acceptable staleness? |
| Retention and privacy | Delete/archive/anonymize rules, regulated/sensitive fields, audit retention, and cascade consequences? |
| Plausible evolution | Which concrete features or relationship changes are likely next, and which are explicitly out of scope? |
| Operational limits | Availability expectations, deployment topology, shared databases, migration windows, recovery needs, and team operating capacity? |

Do not require exact production traffic figures that the user cannot know. Label estimates and uncertainty, identify which decision depends on them, and plan how to validate them. There is no universal RPS number that automatically requires Redis.

## Propose better alternatives

When requirements imply unnecessary complexity, duplicate canonical data, brittle coupling, or an unsafe process:

1. Restate the user's intended outcome and the concrete problem with the proposed mechanism.
2. Recommend a simpler alternative, explain integrity/performance/extension trade-offs, and show one credible future scenario.
3. Ask a specific acceptance question, such as whether a relationship may be modeled separately instead of copying a record into each consumer's table.
4. Record the human decision; do not silently replace the requirement with the preferred solution.

Avoid making every choice an open-ended menu. Recommend a direction, but distinguish recommendations from approved business changes. Flexibility does not justify weakening invariants or treating important fields as unvalidated metadata.

## Requirements checkpoint

Before proposing the final physical schema/diagram, summarize:

- Confirmed actors, terminology, flows, relationships, and lifecycle rules.
- Invariants, history/snapshot requirements, ownership, and permission scope.
- Critical query patterns, scale assumptions, and credible future changes.
- Accepted alternatives, rejected approaches, constraints, and non-goals.
- Open questions, assumptions, and which are blocking versus safely provisional.

Ask the user to confirm/correct this summary. Resolve blockers that change cardinality, ownership, financial rules, or authoritative facts before finalizing the schema. Unknown future load may justify a provisional index/cache plan rather than blocking all modeling. Label requested exploratory drafts; do not claim all requirements are complete or approved without evidence.
