# Install Nick Skills and initialize project agents

Follow this guide when a user points to the public Nick Skills repository and asks to install its skills into the project currently open in an AI harness. A repository URL is not an installation command or permission to configure global agents. Installation of skill directories and creation of native subagent definitions are **two separate tasks**; complete both when requested. Do not claim success from a URL, a plan, an AGENTS.md pointer, or generated files alone.

## 1. Establish the target and source

Verify the active project root, harness and version, existing instructions, installed skills/agents, working-tree status, and the native project-scoped skill discovery mechanism. If the target project is ambiguous, ask for the one missing directory; do not install into the Nick Skills source repository by accident.

Use a public revision that actually contains all required skill directories and the initialization resources. Resolve one Git commit SHA from the requested repository/version, record it, and keep every skill/resource at that same revision. Inspect the full skill files, scripts, and dependencies before executing anything. Never run a remote script through a shell pipeline; obtaining text is not authorization to execute it. If the GitHub source is unavailable, disclose the blocker instead of mixing files from different revisions.

## 2. Install complete skills into the target project

Use the installed harness's **verified project-local** skill location and registration mechanism. Copy each `skills/<name>/` directory as a unit, including SKILL.md, references, assets, and scripts; do not copy only SKILL.md or assume every harness discovers the same directory. Keep the bundle available if the startup instructions point to its resources. Do not copy secret files, Git metadata, generated artifacts, or author-machine paths. Do not modify user-global skill stores or model/provider settings.

If the user said to replace duplicate skills, compare each destination by exact skill name and replace only that previously installed same-name skill directory. Inspect local differences first and disclose which same-name copies will be replaced; preserve unrelated skills, custom files, project rules, and uncommitted work. The user's duplicate-skill permission is **not** permission to overwrite AGENTS.md, CLAUDE.md, user-made agents, credentials, or arbitrary project files. If local skill edits might be unique work rather than an installed duplicate, surface that specific ambiguity before destruction. Preserve native hooks and validations.

Verify that every installed skill and its referenced resources can be discovered/read by the actual harness (restart/reload only when its documented behavior requires it). Record the source commit and exact destination paths. If no project-local skill loader is supported, report the limitation and use a verified supported alternative with approval; do not rename a mere pointer to "installed."

## 3. Propose models once, then create the agents

Read [the first-use workflow](../SKILL.md), [adapter limitations](native-adapters.md), and [the canonical seven roles](../assets/roles.json). Check actual available models, costs/permission differences, and native agent support. Offer one quickly confirmable recommendation for scout, implementer, verifier, advisor, git-publisher, db-reviewer, and security-reviewer; choose `inherit` where availability is unknown. Present a dry-run with source commit, files, append/conflict decisions, and capability caveats. Ask once for model/configuration approval; prior permission to overwrite duplicate **skills** is not permission to change models or install Pi extensions.

**After confirmation, perform the authorized setup immediately.** Use the reviewed local or pinned helper `scripts/init-agent-team.mjs` when compatible, or create equivalent verified native definitions if the helper cannot safely handle an existing project. Specify the target `--project` and exactly one `--harness`; use `--github-ref <verified-40-character-commit>` for a public pointer. Pass apply attestations only after the real approval and checks they represent. Preserve existing AGENTS.md/CLAUDE.md; request/confirm an append or integrate their instructions rather than overwriting them.

The helper deliberately refuses conflicting agent definitions and has **no force option**. If a same-named agent already exists, inspect ownership and diff; do not treat duplicate-skill replacement permission as authority to replace the agent. Resolve the conflict with a targeted decision or retain the existing agent and report the remaining work. Pi requires an already installed trusted compatible extension with project-agent scope before its adapter can be activated; if absent, report unavailable native activation rather than claiming success.

Create the seven *definitions* only for the currently active harness: `.cursor/agents/nick-*.md`, `.codex/agents/nick-*.toml`, `.claude/agents/nick-*.md`, `.letta/agents/nick-*.md`, or `.pi/agents/nick-*.md` **if the compatible Pi extension is verified**. These are examples of adapter destinations, not a request to write all five directories. Keep parent ownership of requirements/integration; call reviewer roles only as needed, not all seven at once. Do not assume a prompt-level "read-only" request enforces shell access in every client.

## 4. Verify and finish

Check the actual project files and native registration with the installed client, model/tool configuration, the project instruction entrypoint in a fresh session where feasible, and a safe bounded subagent invocation when authorized. Report what is verified and what remains untested; generated files, structural tests, and `nativeVerification: pending` are not proof the harness loaded them. In Letta, explicitly read AGENTS.md when automatic startup injection is unverified. Never install an extension or switch a paid model silently to make the smoke test pass.

Finish with the installed skill names, source SHA, created/replaced files, confirmed model choices, native checks/results, and exact blockers. Continue the user's original task if within scope instead of ending at a setup plan. Do not commit, push, open a PR, or deploy without separate task-specific authorization.
