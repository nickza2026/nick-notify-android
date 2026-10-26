# Reproduction and regression evidence

## Establish a trustworthy baseline

Record the tested revision/local changes, command, inputs, relevant runtime/configuration, and observed result. Keep secrets redacted. Do not overwrite prepared work or reset the checkout to recreate an old state; use an approved isolated reproduction when an old version is needed.

Verify the failure actually exercises the reported path. Examples include mounted HTTP validation/authorization, a PostgreSQL transaction boundary, queue retries, or pagination with the same filter/order. An environment/setup failure does not establish the reported application defect.

Reduce the case without deleting the precondition that makes it fail. Keep representative data types, boundaries, ordering, concurrency, and dependency behavior. State what a mocked or extracted reproduction omits.

## Reason about one cause at a time

Trace concrete data and state transitions through directly relevant code. Compare expected and actual values at the earliest divergence, including errors and rollback paths. Form a falsifiable hypothesis, perform a bounded check, and update the hypothesis from evidence.

Temporary instrumentation must be scoped, sanitized, and removed when no longer needed. Do not publish credentials or drown the investigation in unrelated logs. Avoid stacking speculative patches before knowing which one changes the failure.

For uncertain performance, compare original and alternative semantics first, then measure equivalent representative workloads repeatedly in isolation. Keep setup/caches/runtime conditions fair, state variability and extraction limits, and consider complexity as well as speed. Do not call elapsed time a measured CPU utilization result or invent a winner from one noisy run.

## Capture the failure as a regression

- Reuse the nearest appropriate test suite and existing isolated fixtures. Add a missing case/test when the existing coverage does not detect this bug.
- Assert the intended correct behavior from requirements/invariants, not the current wrong output. Confirm the test fails against the original implementation for the intended assertion before patching.
- Prefer the smallest layer that faithfully detects the mechanism. Add integration coverage when router/middleware, real SQL semantics, transactions, constraints, or jobs are part of the defect; do not present a mocked unit pass as DB verification.
- Include relevant empty/null/zero/boundary, invalid-input, permission/tenant, error/rollback, duplicate-request, or concurrency cases. Select cases related to the bug rather than creating an unrelated exhaustive suite.
- For financial state, test synthetic amounts, precision, duplicate effects, and atomicity without moving real funds/credits or contacting providers.
- Do not disable assertions, skip a failing case, add a sleep as a substitute for synchronization, or change expectations to match the bug.

## Intermittent and concurrent failures

Capture seeds, inputs, scheduling/state prerequisites, and failure frequency where available. Prefer deterministic barriers, controlled clocks, fault injection, and bounded repeated runs over timing guesses or endless retry loops.

A race that was not triggered is not disproven. Clearly distinguish a controlled successful reproduction from an unexplained one-time failure or a candidate fix. Do not report permanent resolution because the test happened to pass once.

For suspected nontermination or catastrophic side effects, prove the reachable unsafe path statically or use a bounded safe surrogate. Never execute an uncontrolled harmful path to satisfy a red-test ritual.

## Verify the correction

Rerun the same reproduction and regression after the fix with equivalent conditions, then finish related checks required by the changed behavior/repository. Wait for exit status; capture relevant assertion/output and disclose failed/blocked/unrun checks.

If safe execution is unavailable, label the hypothesis or patch unverified and request the specific missing input/permission/environment. Operator-approved mitigation is distinct from a verified root-cause fix; do not silently weaken requirements during an urgent incident.

Review the final diff for unrelated edits, leftover diagnostics, leaked secrets, and test weakening. Preserve explicit publication boundaries; reproducing and fixing a bug does not itself authorize GitHub or production operations.
