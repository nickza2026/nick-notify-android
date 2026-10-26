# Redis and high-RPS access patterns

Use Redis as an optional cache beside PostgreSQL for appropriate high-RPS reads. PostgreSQL remains authoritative; high RPS is a reason to evaluate caching, not a universal rule to cache every request.

## Decide per path

Establish endpoint/query RPS and concurrency assumptions, read/write ratio, key cardinality, repeated-key distribution, payload size, latency budget, freshness tolerance, and likely hit rate. Separate supplied measurements from estimates. Do not invent thresholds or claim a cache is required without a plausible benefit.

First examine query shape, indexes, pagination, batching, and bounded result size. A cache cannot fix an unbounded operation, a broken query, or a write-heavy path with little reusable data. Large cold-key populations may produce low hit rates despite high total RPS.

Prefer no cache for ordinary traffic when PostgreSQL already meets the requirement. For a high-RPS repeated read where bounded staleness is acceptable, a cache-aside read can be a simple starting point. Do not introduce Redis as a source of truth, primary financial ledger, or correctness-critical coordination mechanism merely because it is available.

## Cache contract

For every selected cached path, record:

| Concern | Required decision |
|---|---|
| Source and owner | Authoritative PostgreSQL facts, eligible projections, writer/invalidation owners |
| Key | Namespace/version, tenant/authorization scope, normalized parameters, filters/sort/page or cursor as needed |
| Freshness | TTL, acceptable stale window, read-after-write expectations, negative-cache behavior |
| Write behavior | When to invalidate/update, transaction ordering, concurrent stale-fill prevention or explicitly bounded risk |
| Load control | Miss coalescing, expiry jitter, timeouts, bounded payloads, and fallback capacity |
| Failure | Redis timeout/down behavior, PostgreSQL pressure controls, error policy, and recovery |
| Operations | Memory/eviction limits, access/security, metrics, and complexity cost |

Do not put credentials or unnecessary personal data in keys. Partition cached data by actual access scope, or cache only shared data safe for all consumers. Authentication and authorization must not disappear on a cache hit.

## Consistency and concurrency

- For cache-aside reads, read authoritative data on a miss and cache only an eligible result. Define whether missing-record results are cached and for how long.
- Invalidate/update based on committed writes, not uncommitted state. However, invalidation after commit alone does not guarantee freshness: a concurrent reader can refill stale data. Choose an appropriate version/invalidation protocol or explicitly accept a bounded TTL risk.
- Account for all writers, including other applications, workers, imports, or administrative tools. If reliable cross-writer invalidation needs extra coordination, explain the trade-off instead of silently adding an event platform.
- Use local request coalescing/singleflight for appropriate miss bursts; it is process-local, not cross-replica coordination. Add distributed coordination only when its benefit warrants its failure/ownership complexity.
- Avoid making every expiry synchronize into a stampede. Use bounded timeouts, TTL jitter, and workload-appropriate concurrency controls.
- On Redis failure, a PostgreSQL fallback must have capacity/rate limits/backpressure; blindly moving peak cache traffic to the DB can cause an outage. Do not fail open on authorization, money, or integrity checks.

Strong financial/stock/security decisions must enforce authoritative invariants in PostgreSQL at the operation boundary. A displayed cached balance/count may be acceptable if explicitly allowed to be stale; it is not permission to authorize a debit or allocation from stale cached state.

## Validate the decision

Plan representative hit/miss tests, expiry/invalidation races, cross-tenant isolation, update/delete behavior, Redis outage, and fallback load. Measure relevant hit rate, latency, backend query rate, memory/evictions, and stale-result behavior when implementation/testing is authorized.

A design note containing a target RPS or a Redis diagram is not a benchmark. Label these checks as planned until actually executed with safe data and the approved environment.
