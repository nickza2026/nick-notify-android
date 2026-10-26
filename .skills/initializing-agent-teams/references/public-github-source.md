# Pinned public GitHub source

Keep a small local AGENTS.md (and Claude's CLAUDE.md import when needed), but point its resource instructions to public `nickza2026/nick-skills` rather than a workstation checkout. A URL in instructions is not a native remote import: the agent needs web/HTTP tools, network access, and applicable permission to read it. Startup-file loading limitations still apply.

## Quick setup

From an already reviewed local copy of the helper, preview:

```text
node "<nick-skills>/skills/initializing-agent-teams/scripts/init-agent-team.mjs" --project "<project>" --harness cursor --github-ref "3c7f5279f5978bd67ed8f98b0218eef8379e11b8"
```

The copy-ready example uses the published snapshot `3c7f5279f5978bd67ed8f98b0218eef8379e11b8`, the latest main revision verified when the example was updated. Its source base is `https://raw.githubusercontent.com/nickza2026/nick-skills/3c7f5279f5978bd67ed8f98b0218eef8379e11b8`. Every README, skill, reference, asset, and relative link must resolve at that same revision. Model/tool/file approval requirements remain unchanged.

For setup without running a helper, copy the bundled `examples/new-project/AGENTS.md` into the target project and, for Claude, the adjacent CLAUDE.md import file. These small files instruct an agent to retrieve public guidance and ask before configuration; they do not themselves install skills, execute code, or guarantee instruction loading. Preserve existing project rules. The example is added after the pinned skill snapshot, so its files are read from the current bundle while the guidance URLs point to the prior published snapshot.

Before apply, check that the **published** revision includes the README, initialization skill, required resources, and the reviewed generator/roles being used locally. Compare the renderer/contracts or use the reviewed helper from that same snapshot; a newer local generator plus an older public instructions pointer is not a coherent release. If the files are not published yet, stop rather than invent a working URL.

After that check and the normal confirmation, apply with `--apply --approved --capabilities-confirmed --github-source-confirmed`. This extra flag is a caller attestation, not actual HTTP verification. The helper performs no network requests, downloads, package installation, remote script execution, Git operations, or automatic update. Manifest fields deliberately retain `remoteAvailability: not-checked` and `rendererSnapshotMatch: not-checked`; record actual inspection evidence separately.

## Revisions and updates

Use the complete commit SHA, not `main`, a short SHA, or a movable tag. This keeps each project on one reviewed version and makes cached content identifiable. Upgrades are deliberate reviewed changes; do not resolve a new main head every chat or silently combine files from different versions. Existing managed blocks/source manifests conflict rather than being automatically replaced.

The generated pointer contains no author-machine skill checkout path. Its native role files are local project definitions, not dynamically executed GitHub files. Another machine still needs the compatible client and a way to retrieve approved public instructions; remote pointers do not guarantee offline availability.

Fetch public text only. Never pipe a remote response into a shell or run a downloaded helper without inspecting it and obtaining execution approval. Do not send private project content, credentials, API keys, or prompts to the public repository. A public repository does not itself establish trust or grant extra tool/config/publication authority.

If the network is unavailable, use only a previously approved cache bound to the same commit, clearly identifying that limitation. No compatible cache means disclose unavailable instructions and continue the original task safely with parent/default behavior; do not pretend the skill was loaded or silently fetch another version. GitHub deletion, access/rate limits, or client restrictions can still prevent retrieval of a pinned commit.
