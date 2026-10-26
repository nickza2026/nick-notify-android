# Source baseline

Research date: 2026-10-22. These sources establish documented formats/behavior, not that every installed version/account supports them. No external extension was installed or executed.

- [Cursor subagents](https://cursor.com/docs/subagents.md): project agents, YAML model/readonly fields, model parameters, availability and billing caveats.
- [Cursor rules](https://cursor.com/docs/rules.md): root/nested AGENTS.md and alwaysApply MDC rules.
- [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents.md): standalone TOML, required fields, model/effort inheritance, inherited permissions.
- [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md.md): project instructions and precedence; verify installed discovery limits.
- [Claude subagents](https://code.claude.com/docs/en/sub-agents.md): model aliases/IDs, tool allowlists, permission controls, version caveats.
- [Claude memory](https://code.claude.com/docs/en/memory): CLAUDE.md imports and newer conditional AGENTS.md support; not a universal cross-version guarantee.
- [Letta subagents](https://docs.letta.com/configuration/subagents/index.md): project/global Markdown definitions, tool/model/memory fields; applies to local/cloud interfaces as labeled in the page.
- [Letta project prompt](https://github.com/letta-ai/letta-code/blob/main/src/agent/prompts/project.mdx): instruction to read project files early; not proof of deterministic startup injection.
- [Pi configuration](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/configuration.md) and [resource loader](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/resource-loader.ts): context-file discovery, priority, ancestor behavior, and SDK caveats. Follow repository redirects when inspecting a newer source location.
- [Pi subagent example](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent): extension requirement, project/user agent scope, schema, and inherited model behavior.
- [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system) and [Cursor scaling agents](https://cursor.com/blog/scaling-agents): delegation/context/coordination trade-offs, not proof that extra agents improve every backend task.

The helper is project-local and dependency-free; it does not execute native clients or look for credentials. Pending native verification and linked-checkout portability limits are deliberate. Two-worker/depth-one policy and the seven roles are this bundle's recommendations, not universal native defaults or benchmark results.
