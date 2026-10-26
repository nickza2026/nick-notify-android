# Git and credential safety

## Preserve work and history

- Inspect staged and unstaged changes before acting. Include other ready-to-publish work in the same delivery branch even when it is unrelated to the currently named task. Prefer one combined commit; a small split on the same branch is acceptable. Task labels alone are not an exclusion rule.
- Preserve excluded, unfinished, or ambiguously owned/intended changes. Do not reset, clean, stash, unstage, discard, or overwrite someone else's work automatically. Ask when publication intent/readiness is genuinely unclear or included and excluded edits cannot safely be separated, not merely because one ready change is a fix for a different feature.
- Prefer the primary checkout and a fresh topic branch. Starting from main is conditional on preserving the prepared changes and intended ancestry, not permission to lose them.
- A push-only request must not produce a fake commit. Establish the requested topic branch/base and review the existing outgoing history without silently rewriting it.
- Do not use interactive Git commands in a noninteractive tool session. Do not change Git identity, credential helpers, remotes, hooks, signing, or other configuration to bypass an error.
- Never automatically amend, rebase, squash existing commits, force-push, or skip hooks. Preserve required **commit-command input** trailers and attribution even if a hook or worker suggests omitting them. A trusted local guard may change the **stored** message; verify the actual result rather than assuming input and stored message must be identical.

## Inspect the payload, not the credential store

Secret inspection of the approved staged content/outgoing history is required. Searching the user's home directory, SSH folder, credential manager, environment, agent secrets, browser storage, shell history, or unrelated repositories for authentication material is prohibited. These are different activities.

Do not run token-revealing commands, enumerate candidate private keys, try discovered tokens, call an auth-login flow, change transport, or upload a key to repair a failed push. Existing Git credential handling may authenticate the authorized command; the agent must not extract its underlying secrets.

## Credential exclusion

Check at least:

- Populated `.env` variants, deployment/local configuration, `s.env`, private key files, service-account JSON, provider credentials, database passwords, access/refresh tokens, webhook secrets, and authentication cookies.
- Hardcoded values inside ordinary source, documentation, fixtures, workflow YAML, generated assets, or URLs; a safe-looking extension does not prove safe content.
- Binary/LFS additions and their real contents. If relevant content cannot be inspected, report that limitation rather than treating a pointer or binary diff summary as a scan.
- Already tracked sensitive files. `.gitignore` does not untrack them and does not prevent a previously staged secret from entering a commit.
- Every newly published ancestor commit, including a secret added and deleted before the latest commit. A clean final tree does not prove a clean push payload.

Use an approved local secret scanner when available and allowed by the current tool policy, plus targeted Git inspection. Do not install tools or run commands prohibited by the active harness. A scanner is supporting evidence, not a guarantee; placeholders and public identifiers still require context to distinguish them from credentials.

Keep example configuration truly synthetic. Do not whitelist `.env.example` merely by filename when it contains live values. GitHub `${{ secrets.NAME }}` references are not secret values, but do not echo or expand them to inspect credentials.

Report a potential leak by file/commit location and category, never the secret value. Stop publication until it is resolved. If already exposed, advise rotation and approved history remediation; do not claim either happened or rewrite history without authorization.

## Commit input, guards, and stored-message verification

Treat the command text sent to the commit tool and the message stored in Git as separate boundaries. Follow higher-priority command-input requirements (including attribution/trailers) exactly. A repository or harness may prohibit generated-by/co-author text in stored history and may provide a trusted guard that sanitizes an ordinary commit request **before** Git executes. Do not guess that such a guard exists from policy prose, an agent's inference, or missing stored attribution: inspect the relevant tool execution outcome, guard/hook metadata when available, and final Git message. Guard claims are not executed-hook proof.

Finish status, diff, staged-path, and secret checks in **earlier calls** if a verified tool-start guard requires the commit command string itself to begin `git commit`. Then send one normal direct `git commit -m '...'` in the repository cwd with the required input trailers and real newlines, without prefixes or helper wrappers. This exact-command shape is an environment-specific constraint, not a portable requirement for every Git checkout. Do not assume a denied compound command ran the earlier commands in it; check Git status and staged paths afterward.

On successful execution, verify the new HEAD, `git log -1 --format=%B`, and status. Where stored-message policy forbids generated attribution, check for generated-by text, Letta co-author lines, and a lone attribution marker; do not claim compliance only because the tool call included correct input. When the guard strips required input attribution, that can be the expected stored outcome if both policies actually apply. Do not amend a successful commit solely because stored attribution differs from required **input** without explicit approval.

If the direct attempt is denied by a tool-start guard or stores a forbidden message, stop agent-side attempts. Preserve and report the verified index/worktree/HEAD state and exact redacted error; ask for a human decision or give a context-grounded command for the human to run under their own policy. Do not swap executors, change tool invocation spelling, use a message file/`git -C`, disable guards, omit required command-input trailers, or skip hooks to force success. A tool-start denial is not a Git hook failure unless there is evidence that the hook ran. If a **Git pre-commit hook actually runs and fails**, repair an authorized issue, re-stage, and make a new commit attempt as required by the current task's higher-priority Git safety rules; do not amend or bypass the hook.

If a native commit specialist is delegated, provide the same input/stored-message rules and request its command/exit evidence plus resulting hash/status. A worker's narrative that a hook ran is not proof of executed behavior. After failure, inspect HEAD and staged paths before considering a manual fallback, and never run both paths when the first may already have created the commit. There is no assumption that a `git-commit` subagent exists in every harness.

## Commit and push gates

- Review staged paths/content, staged whitespace/check failures, and any project-required verification before committing. Distinguish failed, blocked, unrun, and passed checks.
- Follow the active command-input and stored-message requirements separately. Use real newlines and inspect `git log -1 --format=%B` after a commit attempt that may have succeeded.
- After a commit attempt, verify HEAD and exit/error evidence before deciding whether a commit exists. Fixing a hook does not authorize bypassing it or altering an older commit.
- Before push, confirm the destination and explicit ref update. Redact credential-bearing remote URLs in reports. Never add a new remote or guess a different target to evade a rejection.
- On push failure, stop with the local commit preserved. For auth problems, the next step is user-managed authentication through their normal process, not agent key discovery. For divergence, explain the rejection and request an approved resolution, not an automatic pull/rebase/force push.
- Preserve uncertainty when a remote update might have completed despite a connection error. Do not retry publication or claim remote state without evidence.

## Pull request gate

- In the authorized full publish workflow, attempt PR creation only after push succeeds. Preserve explicit commit-only, push-only, no-PR, base-branch, or existing-PR instructions.
- Use the same delivery branch for all included features/fixes and the PR. Inspect the complete base-to-branch scope; a second commit or unrelated ready fix must not disappear from the title/body.
- Prefer an already configured interface such as GitHub CLI when available. Tool absence, missing permissions/authentication, network errors, or API rejection require a stop/report, not client installation, credential search, account switching, or a login flow.
- Include actual changes, tests and unrun/blocked checks, compatibility/config/migration notes, and relevant risks without secret values. Do not fabricate a successful test or an existing task link to fill a template.
- Report a PR URL only when supported by the actual command/API response or read-only verification. A pushed branch is not an opened PR. An ambiguous creation result is not permission to blindly create duplicates.
- Do not auto-merge, deploy, bypass protections, or rewrite history to get the PR accepted.
