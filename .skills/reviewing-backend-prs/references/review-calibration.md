# Pragmatic review calibration

Accept diverse sound implementations. Require exact supplied business logic and protect correctness, safety, financial integrity, and meaningful performance. "Not too strict" relaxes taste-based gatekeeping, not requirements or verification.

## What should and should not block

| Situation | Review treatment |
|---|---|
| An unfamiliar or newer technique correctly implements the task and respects relevant constraints | Accept the technique; understand it using bounded relevant evidence if needed |
| A long-established pattern differs from the reviewer's preferred style | Accept it; do not require a stylistic rewrite |
| Two approaches are both correct with no meaningful cost difference | Do not block or manufacture an optimization requirement |
| A supplied task condition, boundary, permission, or required sequence is wrong | Report a correctness/requirements finding even if the code looks clean or follows a common pattern |
| A reachable loop cannot terminate, retries can run away, or workload growth causes substantial CPU/query degradation | Report the concrete risk and evidence; do not run a harmful demonstration |
| Performance concern depends on unknown data volume or execution frequency | State the assumption, inspect narrow relevant context, or ask; do not claim a proven massive regression |
| A concrete original-versus-alternative trade-off is uncertain and safely testable | Prefer an isolated equivalence check and repeated representative A/B measurements; do not decide by intuition alone |
| A style or maintainability suggestion is useful but not a defect | Mark optional and keep separate, or omit it to reduce noise |
| Requirements are unavailable | Apply the existing requirements-question gate; only confirmed absence enables correctness-only mode |

## Examples

### Unfamiliar but valid

An author uses a window function, CTE, established iterator, or library primitive that the reviewer has not used. Its behavior satisfies the task and its relevant cost is acceptable. Do not block because a loop, join, or manual implementation would be more familiar. Do not demand that the user already know the method.

This does not automatically pass the PR: still complete relevant safe tests, contracts, authorization, and failure-path checks.

### Nested does not automatically mean runaway

A nested loop over a small, explicitly bounded input is not inherently "loop hell." Check actual bounds and frequency. Conversely, an unbounded retry with no progress/cancellation or repeated scans over a realistically huge input can be a genuine blocker. Identify the reachable path rather than objecting to the visual nesting.

### Query cost must be grounded

Replacing bounded queries with repeated full scans or a per-row query at large reachable volumes may be significant. Show the changed access pattern, relevant scale, and expected cost or a safe plan/measurement. Do not call every extra query, CTE, or unfamiliar SQL construct a severe slowdown; do not require a blanket benchmark suite for an ordinary safe change.

### Task logic is exact

If a supplied task requires a credit to be applied once after a particular state transition, applying it twice, in the wrong state, or before the required condition is a defect even if the implementation uses a popular pattern. Do not accept "close enough" behavior, reinterpret requirements to match the code, or substitute an unstated policy.

For ambiguous criteria, ask about the ambiguity. With confirmed no task requirements, review technical correctness/order without inventing or claiming business-flow conformance.

## Behavioral acceptance checks

- Different sound technique + correct task behavior + completed relevant checks: no style blocker.
- New-to-reviewer technique: understand it; unfamiliarity alone does not produce a finding.
- Clean/idiomatic code + wrong task condition: report the actual logic defect.
- Bounded nested work on an appropriate small workload: no invented severe-performance finding.
- Reachable nontermination or materially worse CPU/query work: explain impact with evidence; do not weaken the finding in the name of flexibility.
- Unknown scale: distinguish a hypothesis/question from a demonstrated regression.
- Safely testable comparison uncertainty: extract original/alternative code, establish equivalent behavior, measure both fairly, and explain the evidence/trade-offs without changing PR source.
- Failed, blocked, or unrun required tests: preserve the verification limitation, even when the approach itself is acceptable.
