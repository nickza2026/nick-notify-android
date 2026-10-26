# Money and safety checks

Prioritize plausible data loss, service failure, privilege escalation, and financial harm over style. Trace these statically first; never reproduce harm on live systems.

## Destructive and system-failure paths

- Check deletion/update filters, tenant boundaries, migration reversibility, schema compatibility, cascading effects, and bounded batch sizes. Identify accidental full-table changes, irreversible deletion, and unsafe default behavior.
- Check authentication, per-resource authorization, untrusted input, injection, secrets in logs/responses, and webhook authenticity. Validate before mutation; do not trust client-provided user IDs, amounts, or balances.
- Check unbounded loops, recursive retries, expensive queries, resource leaks, partial failure handling, and jobs/events published before a transaction commits. Establish a concrete failure path, not merely a theoretical warning.

## Material performance risks

- Prioritize nonterminating/busy loops, missing retry bounds/backoff/cancellation, explosive work at reachable input sizes, and changes that substantially increase CPU time, query work, lock duration, or latency on the relevant workload.
- Do not classify a technique as dangerous just because it is unusual, new to the reviewer, nested, recursive, or expressed through a complex SQL feature. Check its bounds, semantics, execution path, and expected scale first.
- Support a performance blocker with a convincing structural argument or targeted safe measurements/query-plan evidence. State assumptions and expected impact; if workload information is missing, label the concern or ask a narrow question instead of asserting a proven severe regression.
- Avoid micro-optimization demands without material impact or a stated task requirement. Do not require benchmarking every valid implementation as a condition of acceptance.
- Never stress production to prove a point. `EXPLAIN ANALYZE` executes its query and can be expensive or mutating; use only approved disposable test data and safe commands. A clearly reachable infinite loop does not need to be executed to demonstrate its risk.

## Credits, balances, charges, refunds

- Trace amount and currency units end-to-end. Check decimal/integer precision, rounding policy, conversion boundaries, overflow, finite values, signs, minimum/maximum bounds, zero, negative inputs, and currency mismatches. Do not infer a rounding policy absent from requirements; identify ambiguity separately.
- Confirm the actor can access and change the specific account, wallet, balance, or ledger. Derive trusted prices and ownership server-side. Check insufficient-funds guards, refund limits, and invariants between ledger entries and balances.
- Verify related mutations are atomic. Look for read-check-write races, lost updates, missing conditional updates/locks, isolation assumptions, and partial commits. Consider two simultaneous requests and a crash between each side effect.
- Trace idempotency scope, persistence, uniqueness, payload binding, and retention. Verify retries, duplicate jobs/webhooks, out-of-order events, and network timeouts cannot double-charge, double-credit, or double-refund. A frontend button lock is not a backend safeguard.
- Distinguish provider acceptance from local success. Check durable operation IDs, reconciliation of unknown outcomes, deduplication, signed webhook verification, and recovery when the provider succeeds but local persistence fails. Do not recommend blind retries after ambiguous payment outcomes.
- Prefer deterministic mocked tests for duplicates, concurrent requests, insufficient balance, precision boundaries, rollback, timeout-after-provider-success, and reconciliation. Do not send real provider requests or move actual money/credits to prove a finding.

For each risk, state the reachable preconditions, changed code location, violated invariant, impact, and evidence. Label unresolved concurrency or provider assumptions as hypotheses requiring confirmation rather than asserting proven loss.
