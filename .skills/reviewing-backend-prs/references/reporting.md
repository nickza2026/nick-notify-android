# Review report

Put actionable correctness and safety findings first, ordered by severity. Avoid style-only blockers or unconditional approval.

Report fewer, well-supported findings rather than filling a quota. Accept varied correct techniques. Omit trivial preference comments when they add noise; if a suggestion is useful, mark it optional and separate it from merge-blocking defects. Exact supplied task logic, safety, and meaningful performance remain non-optional.

## Findings

For each finding include:

- **Severity and short title:** Critical for reachable catastrophic loss/security exposure; High for major financial, authorization, data-integrity, or availability failures; Medium for meaningful bounded incorrect behavior; Low for minor functional defects. Base severity on demonstrated impact and likelihood, not topic alone.
- **Evidence:** changed file and narrow line range at the reviewed head; relevant directly connected caller/schema/test evidence when needed. Do not invent line numbers. Distinguish PR-introduced behavior from pre-existing conditions.
- **Trigger and impact:** concrete input, execution sequence, or safe reproduction; expected versus actual result and affected invariant. Do not claim a reproduction was run when it was only reasoned statically.
- **Confidence:** established defect versus hypothesis, with the missing fact needed to confirm a hypothesis. Keep questions and optional style suggestions separate from correctness blockers.
- **Recommendation:** describe the needed behavior without modifying code unless authorized.

For a performance finding, name the reachable workload and meaningful cost or termination failure, with structural or measured evidence. Do not present hypothetical CPU/query slowness as proven, or claim measurements that were not run. Unfamiliar syntax or a different abstraction is not evidence of a defect.

When an isolated comparison was run, attach its original/alternative identities, semantic checks, environment/workload, exact commands, repeated results/variability, and limitations. Use [the comparison report](../assets/comparison-report.md.tmpl) when useful. Separate microbenchmark results from endpoint/production behavior, and discuss implementation complexity as well as speed. Report an inconclusive result as inconclusive rather than selecting a winner by preference.

## Verification and scope

Record:

- PR identifier, base SHA, head SHA, diff basis, and whether the head remained unchanged.
- Changed paths reviewed and directly relevant supporting scope; exclusions such as frontend completeness, unrelated modules, inaccessible files, or unreviewed changes.
- Task source and criteria checked, or status: pending user response, inaccessible/requested pasted content, or skipped after explicit confirmation that none exists. Do not present missing requirements as an automatic defect or claim business-flow conformance in correctness-only mode.
- Each actual test command, tested SHA, exit code and final result; list failures, missing tests, blocked checks, and unrun checks explicitly. Redact secrets, not relevant failure evidence. Identify static inspection separately from executed tests.
- CI job/result/SHA separately from locally executed evidence. Do not describe a command as passing before it finishes, or a review as complete while relevant tests remain failed, blocked, or unrun.

## Verdict

Use one of these scoped outcomes:

- **Findings:** list confirmed defects and distinguish unresolved hypotheses; state whether verification is complete or still incomplete/non-passing.
- **No findings within checked scope:** use only for the inspected scope, name exclusions, and claim completed verification only when related safe tests finished successfully. This is not an unconditional approval or guarantee.
- **Blocked:** identify the missing revision, requirements decision, safe environment, permission, or test evidence that prevents the requested review from completing. If useful static review was possible, include its findings without implying completion.

Keep the next action specific: provide criteria, resolve a defect, authorize safe verification, or rerun a named check. Do not manufacture success to close the review.
