---
name: initializing-agent-teams
description: Bootstraps first-use project agent teams for Cursor, Codex, Claude Code, Letta, and a compatible Pi subagent extension. Offers model defaults once, preserves project instructions, generates seven on-demand backend role definitions and small startup entrypoints through a dry-run-first tool, and distinguishes generated files from verified native activation. Use when first loading Nick Skills, initializing project agents, selecting per-role models, or setting up AGENTS.md/CLAUDE.md for new sessions.
---

# Initialize Project Agent Teams

Create a small reusable team, not seven running workers. Detect the active harness and its installed capabilities, ask once about concrete model defaults/configuration, then configure only the selected project/harness after approval. Keep all global settings, provider credentials, model subscriptions, and existing permissions unchanged.

## Load by task

| Need | Reference |
|---|---|
| Install the whole GitHub bundle into a project, then create its native agents | [Project installation and subagent setup](references/installing-in-project.md) |
| First-use confirmation and project startup files | [First use and entrypoints](references/first-use-and-entrypoints.md) |
| Public GitHub instructions instead of workstation paths | [Pinned public GitHub source](references/public-github-source.md) |
| Exact native formats and limitations | [Native adapters](references/native-adapters.md) |
| Seven role contracts, delegation, and model defaults | [Roles and models](references/roles-and-models.md), [canonical contracts](assets/roles.json) |
| Evidence/version boundaries | [Source baseline](references/source-baseline.md) |
| Verification cases | [Acceptance scenarios](references/acceptance-scenarios.md) |

## First-use workflow

1. Inspect trusted project instructions, Git/dirty state, existing agent definitions, and `.agents/nick-skills/<harness>.json` when present. Determine the actual running tool/version from runtime evidence, not folder names. Do not overwrite, reset, commit, or publish existing work.
2. Verify the installed native agent schema/tool names, model choices, project trust, and instruction loading. Pi requires an already installed compatible extension plus project-agent scope/trust; do not install or enable extensions automatically. If a capability cannot be verified, disclose it and use the parent agent rather than pretending setup succeeded.
3. Select a **Balanced** recommendation from actual accessible models: a suitable fast model for narrow scouting if available, a capable coding model/current parent for implementation, and sufficient reasoning for verification/DB/security work. Use logical `inherit` when availability cannot be established. Do not copy screenshot IDs across providers or assume the parent's plan covers another model's usage.
4. Ask one concise confirmation showing resolved model choices, seven available roles, project-only file paths, instruction append operations, permission caveats, and limits (two concurrent subagents, one writer per file, no child spawning). Existing accepted unchanged setup should not trigger another model questionnaire. Changes/conflicts need a targeted decision, not silent replacement.
5. Generate/review a dry-run plan with the helper below. **After the user approves**, and installed capabilities are verified, apply the plan to create the seven project-local role definitions; do not stop at model suggestions, an AGENTS.md pointer, or a dry-run. The approval/capability flags are caller attestations, not proof that a human approved or that a client loaded the config.
6. Inspect the generated definitions and verify actual discovery/model/tool behavior using the installed client's documented UI/commands. Configuration state says `nativeVerification: pending`; the helper does not perform native activation or record success on the user's behalf. A client restart/reload may be required. Do not keep rewriting unchanged files while waiting for it.
7. Continue the original task with on-demand delegation. The parent owns requirements/final integration; DB/security reviewers advise without editing. Freeze implementation during verification. Publish only with separate task-specific authority.

If setup is declined, non-interactive, blocked, or outside the task's edit authority, do not create files or switch models. Continue safely with the parent model and no forced delegation; report the setup limitation once. A Markdown skill is guidance, not an executable startup hook.

## Quick project setup helper

The helper uses only Node built-ins (Node 20+), reads local files, and writes no files in dry-run mode. It never starts agents, installs packages, connects providers, executes Git, or edits user-global configuration. Replace example paths/harness with the actual intended project. Do not guess the target from cwd.

```text
node "<nick-skills>/skills/initializing-agent-teams/scripts/init-agent-team.mjs" --project "<project>" --harness cursor
```

After the conversational confirmation and capability checks:

```text
node "<nick-skills>/skills/initializing-agent-teams/scripts/init-agent-team.mjs" --project "<project>" --harness cursor --apply --approved --capabilities-confirmed
```

Use `--models "<approved-model-map.json>"` for confirmed overrides, starting from [the model-map example](assets/model-overrides.example.json). `inherit` becomes an omitted model field where required by the adapter, not an invalid literal Codex model ID. Reasoning controls remain inherited unless configured separately through verified native settings; the helper does not invent cross-harness effort fields.

Existing AGENTS.md/CLAUDE.md content is preserved. If it needs a new pointer, review the plan and explicitly add `--append-entrypoints`; this appends a marked block without replacing existing text. Conflicting definitions, changed managed blocks, symlinks/junctions, hardlinks, and malformed markers stop the plan. No force/overwrite mode is provided.

For Pi, additionally require `--pi-extension-confirmed` only after verifying the compatible extension and trusted project scope. For a nonstandard installation location, pass `--bundle "<full-nick-skills-checkout>"`; this helper's quick entrypoints use an existing linked checkout, not a network install or automatic copy of every skill. See portability limits in the first-use reference.

For public GitHub pointers instead, use `--github-ref "<published-40-character-commit-sha>"` without `--bundle`. The helper does no HTTP requests and does not verify that the snapshot exists or matches its local renderer. Apply additionally requires `--github-source-confirmed` after checking the published README, bootstrap/resources, and matching reviewed helper/contracts at that exact commit. Unpublished local features cannot be read from a public URL yet. See the GitHub source reference before applying.

## Verify and report

Run `node --test "<skill>/scripts/init-agent-team.test.mjs"` for isolated generator tests. Those tests do not prove native client activation, model availability, universal startup injection, or agent task quality. Report generated paths/models, file/parse tests, actual native checks, pending limitations, and the next step separately.
