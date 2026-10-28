# Example: Cursor advisory and review roles

For **Cursor** first-use recommendations, propose the following three roles with the user's requested display model and high reasoning. Keep the other four roles on the ordinary verified Balanced/inherit recommendation; this is not a request to run every role or switch the parent model.

| Role | Requested display model | Reasoning |
|---|---|---|
| `advisor` | Opus 5.5 | high |
| `db-reviewer` | Opus 5.5 | high |
| `security-reviewer` | Opus 5.5 | high |

**Do not treat `Opus 5.5` as a confirmed Cursor model ID.** Check the installed Cursor model picker/catalog, exact available ID, whether that model supports `high`, and account/cost implications before proposing the resolved IDs once for approval. If unavailable, propose `inherit` instead of silently substituting a different model or paid provider. Preserve task-specific business, financial, and security requirements; this is a preference, not evidence of review quality.

Cursor's documented per-agent option syntax is `model: <verified-model-id>[effort=high]` inside `.cursor/agents/nick-<role>.md`. The angle-bracket token is a placeholder: replace it with the actual verified Cursor ID **before** passing it to the helper. Do not copy a Codex or Letta model handle directly. Use [the inherit-only model map](../assets/model-overrides.example.json) as a starting point and set just these three JSON values to their approved `verified-id[effort=high]` strings. Pass the resulting file through `--models "<approved-model-map.json>"` with `--harness cursor`; inspect the default dry-run before approval/application. Existing agent definitions conflict rather than being overwritten automatically.

The Codex-only `--reasoning` JSON flag does **not** apply to Cursor; Cursor's effort travels with the `model` field. Check the actual Cursor client discovery and execution: generator/parser success cannot establish real model availability or applied reasoning.

Source: [Cursor custom subagents](https://cursor.com/docs/subagents.md) (documents square-bracket model options including `[effort=high]`).
