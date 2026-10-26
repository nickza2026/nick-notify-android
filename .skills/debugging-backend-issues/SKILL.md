---
name: debugging-backend-issues
description: Systematically debugs backend bugs and failing behavior by reproducing the issue safely, identifying its root cause, adding or extending missing regression coverage, applying a minimal authorized fix, and rerunning the original reproduction and related tests to completion. Use for bug reports, regressions, failing tests, incorrect API/database/job behavior, or intermittent backend failures. Does not authorize changing code during read-only PR review or publishing changes.
---

# Systematically Debug Backend Issues

On first project use, follow [agent setup](../initializing-agent-teams/SKILL.md) when available. The parent asks once before configuration/model changes; delegated children do not initialize again. Missing, declined, or non-interactive setup does not block the task or force delegation.

Use an evidence-driven loop: **reproduce → explain the cause → capture a failing regression → fix → rerun the reproduction and related checks**. Prefer proving the defect before changing code and proving the correction afterward, not guessing at patches or stopping when compilation succeeds.

## Scope and safety

- Follow the current task and repository instructions. Preserve dirty files and unrelated work. Use the target stack and test conventions rather than replacing them with a preferred framework.
- Treat a bug-fix request as authority for the scoped fix and necessary regression tests, not unrelated refactoring, changed business rules, deployment, commits, or pushes.
- A read-only PR review remains read-only. Reproduce/report within its authorized safe scope; obtain fix authorization before modifying the reviewed source or adding project tests.
- Inspect commands, test/setup code, dependency hooks, configuration, and reachable side effects before execution. Never reproduce harm using production/shared data, real credits/money, live provider calls, or destructive operations.
- Use synthetic data, mocks, or an approved disposable database. Bound time, concurrency, retries, and resource use; do not execute an apparent infinite loop or uncontrolled load merely to prove it exists.
- Keep credentials out of code, fixtures, logs, and reports. Author this skill in English and follow the requested language for target-project deliverables.

## Workflow

### 1. Establish the failure and expected behavior

Recover the exact repository/revision, affected operation, steps/input, observed result, expected result, relevant configuration, and available error/test evidence. Read supplied task requirements; ask only for missing facts that change the next investigation. Do not infer a business rule merely from the broken implementation.

Inspect changed/directly relevant code and existing tests first. Follow [reproduction and regression](references/reproduction-and-regression.md) to distinguish a product failure from a broken environment or test harness.

### 2. Reproduce safely before patching

Run the smallest relevant existing test or controlled reproduction against the unmodified behavior. Record its command, revision, inputs, actual assertion/error, and exit result. Use the real route/middleware or database boundary when the defect depends on it; a simplified function test is not proof of every integration layer.

If reproduction is unsafe, unavailable, or unsuccessful, state that limitation. Gather a specific missing artifact or isolate the mechanism further; do not claim the bug was reproduced or corrected. Do not turn a production-only report into permission to contact production.

### 3. Identify the cause and capture regression coverage

Trace the failing input through directly relevant validation, authorization, control flow, state/SQL/transactions, jobs/events, and response/error handling. Form a specific hypothesis and test it, changing one explanatory variable at a time. Separate the trigger/symptom from the causal defect.

Reuse an existing regression test if it already detects this failure. Otherwise add a focused test/case with the required correct behavior and confirm it **fails on the original code for the intended reason before the fix**. A compile error, missing dependency, or unreachable DB is not a valid red regression for the reported logic bug. Do not duplicate an adequate test merely to create another file.

### 4. Apply the smallest sufficient authorized fix

Correct the demonstrated cause, preserving task semantics and unrelated behavior. Accept varied sound techniques; do not rewrite the surrounding architecture to match personal taste. Do not hide the failure with swallowed errors, arbitrary sleeps, weakened assertions, skipped tests, unsafe defaults, or unbounded retries.

If a broader contract/schema/business change is necessary, explain the consequence and obtain agreement before expanding scope. Use an isolated equivalent-code comparison for a material performance uncertainty when useful, without inventing timing evidence or making benchmarks mandatory for every fix.

### 5. Rerun the same case, then related checks

Rerun the original reproduction and regression under the same relevant conditions after the patch. Confirm expected behavior, not just disappearance of an exception. Then complete directly related unit/integration tests, relevant negative/boundary/concurrency cases, and repository-required build/lint/vet checks where applicable.

Wait for commands to finish and record actual results. A background process, one lucky flaky pass, successful build, or green unrelated test is not proof of the fix. If a check fails, return to the evidence/hypothesis loop; stop for genuine scope/safety/environment blockers, not merely because the first patch was written.

### 6. Report only demonstrated outcomes

Report the cause, scoped changes, before/after reproduction evidence, added/reused tests, exact commands/results, and remaining limits using [the report template](assets/debugging-report.md.tmpl) when useful. Distinguish fixed-and-verified from candidate-fix, not-reproduced, failed, and blocked states. Do not claim all possible bugs are eliminated.

Check [acceptance scenarios](references/acceptance-scenarios.md) for safe reproduction, red/green evidence, intermittent failures, and read-only boundaries. Do not commit, push, open a PR, or deploy without the corresponding task authorization.
