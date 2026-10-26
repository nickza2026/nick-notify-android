# Initialization acceptance scenarios

- First use in an identified supported harness: show actual capability/model defaults and project-only plan; ask once, then apply only with approval. An absent user response is not consent.
- Non-interactive, declined, unsupported, or unverified setup: no writes/model changes/forced delegation; continue safely with the parent.
- Existing project instructions: preserve their bytes; require explicit append approval, use one marked block, never replace unrelated policy. Malformed/changed blocks or custom role files cause a conflict, not force overwrite.
- Repeated unchanged initialization: zero writes, no repeated model questionnaire. Partial missing files can be replanned without erasing matching user work; interrupted creation is not an atomic rollback.
- Models: use actual available IDs or inheritance; serialize inheritance correctly per adapter. Do not treat arbitrary screenshot IDs as valid across providers or silently install/connect/switch to paid models.
- GitHub source: require one full published commit for every resource, no workstation source paths in emitted pointers, no implicit network/execution, and separate source/snapshot attestation before apply. Mutable/malformed refs and mixed local/GitHub source options fail closed. An existing source change conflicts; fake test refs do not establish actual remote availability.
- Native formats: seven prefixed roles; Codex TOML with required fields; read-role restrictions where supported; explicit Codex and Bash-capable verifier/publisher caveats. Do not turn an instruction-only restriction into a security guarantee.
- Pi without a verified compatible trusted extension/project scope: refuse apply. Do not install extensions or disable confirmations automatically.
- Filesystem: reject path-escape attempts, observed symlink/junction or hardlinked targets, malformed paths, changed baselines, and existing conflicting definitions before writes. Run one initializer in a stable trusted project; report partial I/O failures honestly.
- Startup: small root AGENTS.md plus Claude's supported CLAUDE.md import, subject to actual client discovery. Letta auto-injection remains unverified until tested in that installation. Changed cwd/overrides, missing linked checkout, or disabled discovery cannot be called successful setup.
- Delegation: do not run all seven roles, recurse, or let multiple agents edit one file; freeze sources for verification. DB/security roles report grounded findings without editing/DDL/live exploitation. Git role never receives implicit publish approval.

`node --test scripts/init-agent-team.test.mjs` exercises isolated file-generation behavior. YAML/TOML syntax checks are separate. Native UI/CLI discovery, actual provider/model availability, and model behavioral quality require additional approved integration checks; do not claim them from these tests.
