# Example: Codex roles and reasoning

This **illustrative mapping** was adapted from a user-provided screenshot; the user later requested **high** reasoning for the Codex advisor, DB reviewer, and security reviewer. It is not a verified catalog or a measured optimum. Display names in the screenshot are **not universal model handles**. Before choosing a model, check the active harness, the account's accessible catalog, the exact wire ID, reasoning support for that ID, and cost/permissions; ask once with quickly confirmable defaults. Use `inherit` when an ID or effort cannot be verified. Never silently change providers or global model settings.

| Role | Screenshot display-name example | Reasoning example |
|---|---|---|
| `scout` | GPT-5.3 Codex Spark | medium |
| `implementer` | GPT-6.1 Sol | medium |
| `verifier` | GPT-6.1 Sol | high |
| `advisor` | GPT-6 Astra | high |
| `git-publisher` | GPT-5.3 Codex Spark | medium |
| `db-reviewer` | GPT-6 Astra | high |
| `security-reviewer` | GPT-6 Astra | high |

These are **role proposals**, not an instruction to run seven agents or to hardcode the screenshot's names. For financial/security/ambiguous DB work, confirm the chosen reasoning level is sufficient rather than assuming the example is universally safe. A lighter scout is a cost/latency choice to validate against actual task quality, not a hard guarantee.

## When Codex CLI is the active harness

Codex's project `.codex/agents/nick-<role>.toml` supports both `model` and `model_reasoning_effort`. First create a private project-local JSON file with seven **verified actual model IDs**, using [the inherit-only example](../assets/model-overrides.example.json) as a starting point. Do not pass human display labels such as `GPT-6.1 Sol` as model IDs. Separately use [the seven-role effort example](../assets/codex-reasoning.example.json) only after confirming that each selected/inherited model supports its proposed effort.

Preview the selected target project with the reviewed local helper:

```text
node "<nick-skills>/skills/initializing-agent-teams/scripts/init-agent-team.mjs" --project "<project>" --harness codex --models "<approved-models.json>" --reasoning "<approved-reasoning.json>"
```

After inspecting the dry-run and obtaining first-use approval, apply with the helper's normal approval/capability flags. Without `--reasoning`, the helper omits `model_reasoning_effort` so Codex inherits/defaults appropriately. An explicit effort is not guaranteed to work with an unavailable or unsupported model; check native discovery in the installed client. The helper validates the shape/known example levels, not account availability or per-model effort compatibility. A later model or effort change conflicts with an existing generated agent rather than overwriting it.

## When Letta is the active harness and can use a Codex model

Letta project agents are `.letta/agents/nick-<role>.md`, not `.codex/agents/*.toml`. Resolve each accessible Codex/OpenAI model to its **Letta model handle** before passing it in `--models`; the Letta generator emits `model: <verified-handle>` or omits the field for inheritance. Do not reuse Codex CLI IDs by assumption.

The documented Letta custom-subagent frontmatter has `model` and `tools`, but **no verified per-agent `model_reasoning_effort` field**. The helper rejects `--reasoning` with `--harness letta` rather than pretending to enforce the screenshot's effort column. Treat those levels as discussion/selection guidance only until the actual Letta version offers an inspected supported mechanism. Switching the parent model or using a Codex-backed worker does not convert Letta agent definitions into Codex TOML. If Letta launches a Codex CLI worker, check that worker's own documented startup/project scope separately; do not claim `.letta/agents` automatically configures it.

Sources: [Codex custom subagents](https://developers.openai.com/codex/subagents/) and [Letta project subagents](https://docs.letta.com/configuration/subagents/index.md). A successful fixture/parser test proves file generation only, not live model availability, accepted effort, tool execution, or native registration.
