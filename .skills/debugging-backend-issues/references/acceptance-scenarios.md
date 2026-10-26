# Debugging acceptance scenarios

Use these as behavioral checks, not evidence that a real application bug or runtime test was executed while authoring this skill.

## Existing test catches the bug

Reproduce its failure against the unmodified behavior, identify the cause, make the smallest scoped fix, rerun that exact test and directly related checks, and record completed results. Do not add a duplicate test solely to satisfy a file-count ritual.

## Missing regression coverage

Add a focused case asserting intended behavior. It must fail on the original code for the reported defect, pass after the fix, and remain in the appropriate project test suite. A missing library/database is not the intended red assertion.

## Reproduction is unavailable or unsafe

For unavailable prerequisites, request the specific missing artifact/environment and mark verification blocked. For production financial/destructive behavior, use synthetic isolated evidence instead of reproducing harm. Do not claim verified success from static reasoning alone.

## Intermittent/concurrent behavior

Use controlled scheduling/input and bounded repeats where practical. Explain what actually reproduced and what remains uncertain. Do not call one lucky pass a confirmed permanent fix, or run unbounded loops/load on the user's machine.

## Read-only PR review

Report the defect and authorized safe evidence without modifying reviewed source or adding project tests. Obtain fix authorization before switching to this skill's editing workflow. An isolated review harness is not permission to commit a patch.

## Failed verification after a candidate patch

Return to the hypothesis/reproduction loop, preserve actual error evidence, and correct the cause within scope. Do not relax expected business behavior, remove assertions, skip the case, or declare success after compilation alone.

## Task logic and scope

Preserve the exact supplied requirement and accept different sound implementation techniques. Ask before a necessary business/contract/schema change; do not refactor unrelated modules or publish the fix merely because tests passed.
