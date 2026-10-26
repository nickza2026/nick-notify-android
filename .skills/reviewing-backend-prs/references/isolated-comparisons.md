# Isolated code and performance comparisons

When a concrete design/performance question is safely testable, prefer evidence from an isolated original-versus-alternative experiment. Do not guess that the author's version is slow or the proposed rewrite is better. Do not demand a benchmark merely because a correct technique is unfamiliar.

## Establish the question and equivalence

Name the exact PR head/file/function/query being evaluated, the suspected cost, and the alternative hypothesis. Copy only the directly relevant logic and required context, preserving the reviewed version; describe any extraction, mocks, or omitted layers.

Check both implementations against the same required semantics before timing: outputs, ordering, error behavior, null/empty/boundary inputs, permissions, precision, side effects, and transaction/concurrency guarantees where relevant. An alternative that is faster only because it skips validation, changes task logic, or weakens guarantees is not an acceptable optimization.

## Isolate safely

- Inspect the copied logic, dependencies, setup/teardown, and reachable calls before executing. Never copy credentials or connect to production/shared services to make the reproduction convenient.
- Use an OS temporary workspace or an explicitly allowed verified ignored scratch directory. Do not edit the reviewed source, add committed tests, or change branches. Keep benchmark artifacts out of the delivery payload unless separately requested.
- Use synthetic data and mocks or approved disposable databases. Obtain authorization for external services/tool installation or additional risky execution; a review request is not unrestricted execution permission.
- Bound data size, concurrency, repetitions, time, and resource consumption. Do not run suspected infinite loops, uncontrolled retries, or open-ended load tests to reproduce harm. Static evidence may be sufficient for clearly dangerous paths.
- Clean up only resources created by the harness, using checked paths and safe shutdown. Preserve a concise reproducible method/result report; do not sweep unrelated files or processes.

## Compare fairly

1. Use identical input distributions, deterministic seeds where useful, result consumption, and appropriate representative sizes. Include relevant edge cases without scaling a desktop into an outage.
2. Match runtime/toolchain, hardware, dependency versions, configuration, concurrency, and setup boundaries. Do not count setup only for one candidate or compare real I/O with a stubbed alternative.
3. Account for warmup, compilation, connection pools, caches, prepared statements, and cold/warm behavior. Do not warm one candidate and call the other cold result proof of inferiority.
4. Repeat runs and inspect spread/noise, preferably varying/interleaving order where appropriate. A single result or tiny difference does not establish a meaningful regression.
5. Measure relevant dimensions: elapsed time/throughput/allocations, CPU profile, memory, query count/plan/rows/lock behavior, or latency distribution as appropriate. Do not call elapsed time alone a measured CPU utilization result.
6. Compare against the task's scale/latency needs and the clarity/maintenance cost of each approach. A small microbenchmark win may not justify a more complex system; report when evidence is inconclusive.

For a Go-only isolated harness, use language-native benchmarks when appropriate, for example:

```text
go test -run '^$' -bench '^BenchmarkCandidate' -benchmem -benchtime=200ms -count=5 -timeout=60s .
```

This is an example command to adapt, not a claim it was executed. Run semantic checks separately before timing. Choose bounded cases so the actual suite fits its deadline; the flags do not make arbitrary benchmark code safe.

For SQL, use the same approved disposable PostgreSQL version/schema/indexes, synthetic data distribution, transaction scope, and parameters. Compare plans and repeated execution where warranted. `EXPLAIN ANALYZE` executes the query and may mutate data or hold locks; do not run it on a live/shared database. State omitted network/cache/production effects.

## Report and decide

Record actual commands, exit status, original/alternative code identity, semantic checks, workload/environment, repetition method, observed values/variability, and extraction limitations. Distinguish a microbenchmark from an endpoint/system test. Never invent timing numbers or performance claims from a planned experiment.

Recommend the approach best fitting correctness, requirements, meaningful cost, and simplicity. Accept either sound implementation when measured differences are immaterial. If the experiment exposes a defect, tie it to the changed code and realistic impact. Do not silently implement the suggested alternative in the PR.

## Behavioral checks

- Equivalent original/alternative with repeatable meaningful differences: report the bounded evidence and trade-offs, not a universal speed claim.
- Faster alternative with wrong output or weaker safety: reject it as a valid replacement, regardless of timing.
- One noisy result or unrepresentative tiny input: report insufficient evidence; refine safely if warranted, not an invented winner.
- Unsafe dependencies or unavailable test resources: mark comparison blocked/unrun; retain useful static analysis without claiming measured proof.
- Original PR code remains unchanged and no real credits/provider requests are used during experiments.
