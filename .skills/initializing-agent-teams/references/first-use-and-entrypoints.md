# First use and quick project entrypoints

## What a new session reads

Use a small project entrypoint, not all skill bodies in every prompt. The helper creates root AGENTS.md and, for Claude, a CLAUDE.md block containing the supported `@AGENTS.md` import. It never modifies global instructions or disables native trust/policy settings.

- Cursor supports root/nested AGENTS.md. An always-applied `.cursor/rules/*.mdc` is another supported option, but the helper does not create a duplicate rule.
- Codex discovers AGENTS.md subject to instruction precedence, overrides, cwd, configured limits, and version. Verify the actual loaded instructions rather than promising an override cannot hide the pointer.
- Claude supports the CLAUDE.md import; newer versions also have conditional native AGENTS.md support. The import avoids relying on that newer fallback. Respect import approval/size/depth limits.
- Pi reads one applicable context file per directory, including ancestors. AGENTS.override.md can supersede AGENTS.md in the same directory, and SDK options can disable discovery. Context loading is independent of the optional subagent extension.
- Letta's inspected project prompt asks the agent to read AGENTS.md/CLAUDE.md/README early, but this did not establish deterministic automatic injection for every startup/version. Until actual loading is verified, explicitly ask Letta to read the project's AGENTS.md. Do not advertise a universal auto-loader.

Open the intended project/cwd in a fresh session and verify startup loading using the client's actual supported interface. If it fails, explain the specific override/trust/version/path issue rather than rewriting user rules or claiming success. No single filename guarantees loading in every AI interface.

## One confirmation

Show detected harness/version, existing setup, recommended resolved model IDs (or explicit inheritance), file operations, costs/availability caveats, tool restrictions, and limits. Ask whether to apply the displayed project-only plan; include any append operation in that approval. Non-interactive or declined setup writes nothing.

Approval flags and the native capability flag are caller attestations. The helper cannot prove that a human approved, models are available, or a native client accepted the files. State remains `nativeVerification: pending`; retain native check evidence separately and do not fabricate a "ready" flag.

Seven definitions do not mean seven agents are launched. No agent runs during generation. Reuse accepted setup without another model questionnaire; inspect differences or missing files before a targeted repair. Conflicts are not permission to overwrite existing or global definitions.

## Existing instructions and partial failures

Default dry-run shows conflicts for existing unmarked instruction files. With reviewed explicit `--append-entrypoints`, append only the Nick Skills marked block, preserving all prior bytes. Preserve unrelated rules even if they contradict this bundle's defaults. A changed/malformed managed block or agent definition stops application before planned writes; manual review is required.

The helper preflights all paths and uses exclusive creation for new files. It rejects observed symlinks/junctions/hardlinked targets and checks append baselines. It is not a filesystem sandbox against a hostile concurrent process, nor a multi-file transaction: run one initializer on a stable trusted workspace. A late I/O error reports partial paths; inspect/replan rather than deleting user work or claiming rollback/completion.

## Linked-checkout portability

Quick setup points to an existing full Nick Skills checkout and records its actual path, never a hardcoded author-machine path. This is fast locally, but a different machine/clone location may need rebinding. Do not claim the pointer vendors the skill bundle or works offline if its checkout is absent.

Alternatively use [pinned public GitHub mode](public-github-source.md) to remove the workstation path from generated pointers. This requires a published coherent snapshot and web/HTTP access (or an approved same-commit cache), not automatic URL imports or execution.

For shared reproducible projects, agree on a pinned vendored bundle/submodule or consistent checkout convention separately. Do not silently clone, install, modify Git tracking, or upload private instructions. Local paths may disclose workstation layout; review them before publication. Keep API keys in the native secret store, not models.json or generated prompts.

Generated `.letta/` files may be ignored by an existing project policy, as they are in this authoring repository. Do not unignore the entire directory to publish role files; review narrowly scoped tracking changes only when requested. The bundle ships its generator/contracts, not activated local configuration.
