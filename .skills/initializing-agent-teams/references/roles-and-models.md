# Roles, models, and bounded delegation

Use the seven contracts in [roles.json](../assets/roles.json). Prefix generated names with `nick-` so they do not override built-ins such as general-purpose, init, memory, or reflection.

| Role | Use | Access intent |
|---|---|---|
| scout | Narrow repository/documentation navigation | Read only; ask parent for unavailable tools |
| implementer | Scoped implementation and necessary regression tests | Assigned source/test files only |
| verifier | Independent exact-task and completed-check verification | Execute approved checks; no implementation edits |
| advisor | Difficult architecture/requirement trade-offs | Read/propose; no implicit business changes |
| git-publisher | Authorized delivery or a non-mutating delivery plan | Git mutation only after explicit publication approval |
| db-reviewer | Normalization/reuse, constraints, transactions, indexes, migration/data integrity | Read/propose, no SQL/DDL execution |
| security-reviewer | Auth, tenant/resource boundaries, injection, secrets exposure, webhook/provider trust | Read/propose, no live scanning/exploitation |

Only scout, implementer, and verifier form the initial workflow vocabulary; even these need not run for a tiny task. Advisors and specialized reviewers are on demand. Do not add a UI-review requirement to backend-only work. Do not add the optional performance/API/operations roles without a task need.

## Model selection

The helper's portable fallback is inheritance, not a claim that one model is optimal. Before first apply, the parent recommends actual available IDs and displays them for approval. Prefer a suitable fast tier for bounded navigation and adequate coding/reasoning for implementation, ambiguous DB rules, security, and financial invariants. Reusing a model for several roles is valid; independent scoped context can matter more than using a different brand.

Do not fabricate a live model list from screenshots, prior defaults, or configured-but-unavailable profiles. Use the actual client/catalog or ask for the user's available choices. If unavailable, explain inheritance rather than inventing a model or silently selecting a paid/provider-changing fallback. Native model parameters differ; do not append a universal "medium" suffix or write unsupported effort settings.

Ask once with a recommended preset rather than seven separate questions. Store confirmed choices in the generated per-harness manifest. A later unavailable model, changed preset, or conflicting config needs a specific decision; do not auto-upgrade or rewrite the file.

## Efficient task handoffs

Give each child: outcome, relevant requirements/skills, exact revision/path scope, allowed commands and data, file ownership, return format, budget/stop condition, and prerequisites. Preload only relevant skills where supported; do not assume a fresh child sees the parent's conversation or every skill.

The parent owns exact task logic, consolidates questions, resolves disagreement, and checks evidence. Divide by independent files/components or read-only questions. Keep one writer per file and freeze sources while tests/builds consume them. Do not force extra worktrees; use one checkout safely by default and seek approval when isolation is genuinely required.

Default policy: at most two concurrent children, depth one, no external AI subprocess spawning, bounded runs, and no repeated delegation without new evidence. These are coordination policies, not universally enforceable config fields. A simple task may be cheaper and faster with no child at all.

Return concise findings with files/lines, actual commands/results, confidence, and blockers. Separate exact requirement failures from hypotheses/preferences. Do not pass a review while required relevant checks remain failed, blocked, or unrun. Measure correctness, rework, elapsed time, and available cost/token evidence before claiming a more elaborate team is better.
