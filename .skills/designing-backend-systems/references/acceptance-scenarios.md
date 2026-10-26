# Design workflow acceptance scenarios

These are behavioral checks for the skill, not executed DB performance tests or human approval.

## Requirements before final schema

**Request:** Design a system whose entity ownership, lifecycle, or money rules are incomplete.

**Expect:** Read supplied material, ask focused detailed questions, summarize answers, propose relevant improvements, and seek confirmation of core rules before finalizing schema/diagram. Label any explicitly requested exploratory model as provisional. Do not fabricate requirements to finish.

## Normalize and reuse

**Request:** Several applications and reporting/processing flows use the same mutable entity facts and many-to-many relationships.

**Expect:** Canonical PostgreSQL entities, meaningful keys/constraints/junction relationships, and shared query/processing semantics. Avoid per-consumer authoritative copies, delimited ID fields, and unnecessary extra services. Distinguish immutable historical snapshots from accidental duplicate mutable facts.

## Flexible without universal abstraction

**Request:** The user expects a few concrete future features but wants the system simple and easy to write.

**Expect:** Evaluate those extension scenarios and document realistic migration costs. Prefer a comprehensible normalized model over speculative EAV/all-JSON schemas, a table for every scalar, or infrastructure for imaginary scale. Propose a better approach and obtain agreement if it changes intended business behavior.

## Ordinary traffic and high-RPS reads

**Request:** An ordinary CRUD workload meets latency targets in PostgreSQL; another route has very high repeated-read RPS and accepts bounded staleness.

**Expect:** No mandatory Redis for the ordinary route. Evaluate a cache for the hot read using key repetition, query/index quality, hit potential, TTL, invalidation, access scope, stampede/fallback behavior, and real or explicitly estimated workload. Do not invent a global RPS threshold.

**Adjacent case:** High RPS with mostly unique keys, frequent writes, or strict authoritative freshness. Explain why caching may be ineffective/unsafe and recommend an appropriate alternative rather than automatically introducing Redis.

## Financial and tenant safety

**Request:** Read caching is considered for balances or tenant-specific records.

**Expect:** PostgreSQL remains authoritative for debit/allocation/integrity decisions. Separate stale display data from authoritative mutation, preserve authorization on cache hits, and scope keys correctly. Never rely on a stale cached balance to permit a debit or expose one tenant's data to another.

## Collaborative diagram review

**Request:** Core requirements are confirmed and the user wants a diagram to share with the team.

**Expect:** Editable diagram plus summary/dictionary/decisions, explicit relationships and constraints, targeted walkthrough questions, and feedback-driven revisions. Do not upload private data externally without permission. If the team has not responded, status is ready for review, not approved.

## Proposals and design-only scope

**Request:** A requirement suggests duplicated data or avoidable coupling; the task asks only for a design.

**Expect:** Explain the issue, recommend a simpler flexible alternative with trade-offs, and ask whether the changed behavior is acceptable. Do not silently change the requirement, execute migrations, provision Redis/PostgreSQL, start coding, or claim unrun benchmark results.
