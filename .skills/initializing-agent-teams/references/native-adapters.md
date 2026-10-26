# Native adapter boundaries

These formats were researched on 2026-10-22; verify the installed client before apply. A successful parser/generator test is not a native runtime test.

| Harness | Project definition | Model inheritance | Read-role restriction |
|---|---|---|---|
| Cursor | `.cursor/agents/nick-<role>.md`, YAML frontmatter | Explicit `model: inherit` | `readonly: true` for scout/advisor/DB/security |
| Codex | `.codex/agents/nick-<role>.toml` | Omit model/effort fields | Parent permissions inherited; role instructions alone are not a sandbox |
| Claude Code | `.claude/agents/nick-<role>.md`, YAML frontmatter | Explicit `model: inherit` | Read/Glob/Grep tool allowlist; default permission mode |
| Letta | `.letta/agents/nick-<role>.md`, YAML frontmatter | Omit model field | Glob/Grep/Read allowlist; verify tool names in installed toolset |
| Pi compatible example extension | `.pi/agents/nick-<role>.md`, YAML frontmatter | Omit model field | Extension tools read/grep/find/ls; project-scope opt-in required |

Codex standalone TOML requires name, description, and developer_instructions. Do not write a fake `readonly` or `sandbox_mode` field to claim separate permissions; custom agents inherit parent permissions/provider/MCP behavior in the researched client. Older Codex configuration layouts may differ.

Claude read-role allowlists omit shell/edit/write tools. Verifier/publisher include Bash for approved commands; denying Edit/Write does not prevent Bash from modifying source. The helper does not set bypassPermissions, acceptEdits, disable hooks, or grant new approvals. Model/tool availability still needs native checks.

Letta model selection and allowed tools are independent. Do not assume switching model automatically restricts tools. Its read-role tool names come from the documented schema; if an installed toolset uses different names, stop and adapt with approval rather than generating a zero-tool or unrestricted fallback role.

Pi itself does not supply subagents. This adapter targets the official example extension's schema, not every third-party package. Confirm installed trusted code, project scope, model inheritance, and tool names first. Never install the example, enable project scope, or disable project-agent confirmation silently.

Verifier is intentionally command-capable rather than labeled universally read-only: builds/tests may write approved artifacts and synthetic disposable data, while implementation edits remain forbidden by role contract. Publisher likewise needs Git commands but obtains no publication authority from generation. If hard technical source-write isolation is required, use a supported restricted session/sandbox or report the capability missing; do not mislabel prompt instructions as enforcement.
