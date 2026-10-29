---
name: deploying-go-to-nortezh
description: Prepares Go Dockerfiles and standalone GitHub Actions workflows matching Nick's Nortezh examples, with dockerize_n_push followed by deploy. On first use asks which environments exist, each trigger/branch, Nortezh project/location, proposed deployment names, and whether tests should run when PRs open/update. Never enables PR-test CI without approval. After confirmation creates actual workflow files, not just a plan. Uses GHCR and Nortezh/nortezh-action for WebService or Worker. Use for CI/container/Nortezh workflow creation or changes. Does not authorize Git publication, secret provisioning, or live deployment.
---

# Prepare Go Delivery to Nortezh

On first project use, follow [agent setup](../initializing-agent-teams/SKILL.md) when available; do not let missing/declined setup block the delivery task or force delegation.

Use the **standalone workflow layout in the supplied examples**: one full `.github/workflows/<app>-<environment>.yaml` per approved application/environment, with **`dockerize_n_push` then `deploy`**. Preserve step order, job/output wiring, action versions, GHCR login/lowercasing, build options, and Nortezh secret mapping in [the template](assets/workflow-service.yaml.tmpl). Do not substitute a reusable workflow, caller files, or a verify/publish/deploy redesign without approval. Source application names/targets are examples, never universal values.

## Authority and first-use confirmation

- Author this skill in English; use the requested language in the target conversation. Inspect project instructions, source roots, existing workflows, Dockerfiles, and dirty state before changing files. Preserve unrelated/custom work.
- Read [first-use questions and confirmation](references/first-use-and-confirmation.md) before generating files. Ask whether production, staging, both, or additional environments are needed. **Do not default production to releases or staging to main.** Confirm each environment's exact branch/trigger, project/location, deployment type, and secret **names**, and propose deployment names for user approval.
- Ask explicitly whether tests should run when a pull request is opened or updated. **Do not add or enable PR-test CI without the user's approval**, and do not disable/alter existing PR checks without approval either. An unanswered question is not consent or a decision to disable tests. Keep this CI-trigger choice separate from ordinary authorized local verification.
- Recover already supplied/approved answers instead of asking again. If the accepted matrix is unchanged, proceed; changed destinations or trigger policies need a targeted new decision.
- After approval, **create the actual workflows in that turn** using the reviewed helper or equivalent inspected edits. Do not stop at proposed names, an example table, or a dry run. If required answers/approval are absent, ask and stop before writing active workflows.
- Writing templates/workflows grants no commit, push, registry publication, external credential setup, or live deployment authority. Explain that publishing these active workflows to their selected trigger can deploy automatically. Never ask for credential values in chat or copy them into files.

## Workflow

### 1. Inspect and propose the deployment matrix

Identify actual `cmd/<app>` applications, HTTP/Worker role, module-compatible Go version, Docker paths/context, runtime assets, Swagger needs, and migration ownership/order. Do not force user/admin apps. Read [delivery contracts](references/delivery-contracts.md) and [the source baseline](references/source-baseline.md), including deliberate limits of the exact example pattern.

Show the confirmation table from the first-use reference. Recommend concrete names from the target repository/app/environment, clearly marked as proposals, not existing Nortezh targets. Resolve all required rows before creating files. User-supplied workflows/Dockerfiles are reference-only inputs: do not include raw reference directories in a commit/push without explicit permission to publish those artifacts. Use synthetic examples bundled inside the skill instead.

### 2. Prepare approved container inputs

Read [the complete Dockerfile examples](references/dockerfile-examples.md) **before** creating container files. Use the [API + Swagger example](assets/dockerfiles/api-swagger.Dockerfile.example) when generated imports require it, the [Worker example](assets/dockerfiles/worker.Dockerfile.example) for non-HTTP processes, or [the minimal template](assets/Dockerfile.tmpl) when neither generator nor special assets are needed. App names are synthetic, not required applications.

If container authoring is approved, materialize the matching file at `build/<app>/Dockerfile`, using the actual app paths, module-compatible Go version, Swagger output/instance, binary/entrypoint, confirmed port, and required runtime asset copies. Inspect/merge [context exclusions](assets/dockerignore.tmpl) without erasing rules. Never copy `.env`, credentials, test databases, or all source into runtime; `EXPOSE` alone does not configure the app/platform port. Report unsupported CGO/runtime requirements instead of guessing.

### 3. Preview, confirm, then create full workflows

Start the non-secret matrix from [the config example](assets/workflow-plan.example.json), replacing every synthetic destination and selecting **only** approved app/environment pairs. Record it using the target project's established location, or `docs/deployment/nortezh-workflows.json` when none exists. The example is production-only on main to demonstrate one valid choice, not a default to apply without asking.

Preview with the local Node 20+ helper (replace paths):

```text
node "<nick-skills>/skills/deploying-go-to-nortezh/scripts/render-workflows.mjs" --project "<project>" --config "<confirmed-workflow-plan.json>"
```

After the user confirms the matrix and file changes, create files:

```text
node "<nick-skills>/skills/deploying-go-to-nortezh/scripts/render-workflows.mjs" --project "<project>" --config "<confirmed-workflow-plan.json>" --apply --approved
```

The helper renders one **complete** workflow per row; `--approved` attests to prior human approval, not proof of it. It uses no network, Git, package installs, Docker builds, or Nortezh calls. Existing conflicting workflows, missing Dockerfiles, symlink/hardlink escapes, duplicate targets/images, and unknown fields stop creation rather than overwrite work. Existing identical workflows produce zero writes. For intentional changes to existing workflows, review an explicit edit with the parent/user; there is no force flag.

### 4. Validate and report separate evidence layers

- Reconcile generated files with the confirmed matrix and examples: exact two-job wiring, all selected environments/apps, correct branch/release/manual triggers, paths, secrets, targets, image names, type, and confirmed port behavior. Do not leave template tokens or copy Olufy identities into a different project.
- Run `node --test "<skill>/scripts/render-workflows.test.mjs" "<skill>/scripts/dockerfile-examples.test.mjs"`; synthetic golden fixtures preserve the supplied workflow structure without publishing raw references. Parse generated YAML and use actionlint when available. Parsing/text/compiler-only checks do not prove external Swagger generation, an image build, runner/action compatibility, or successful deployment.
- Inspect commands/tests and side effects before execution. Complete relevant safe target-project tests; use isolated synthetic DB/provider configuration. Do not add a new verification job or change action versions silently to satisfy this check.
- Build/smoke-test the actual image/context when Docker is available and authorized. Otherwise report blocked/unrun layers. Workflow generation is not an executed GitHub run, published image, configured Nortezh target, or healthy revision.
- Report created `.github/workflows/...` paths, confirmed branch/target matrix, checks, missing secret configuration by **name**, and remaining blockers. Do not commit/push/deploy without separate authorization.

Read [acceptance scenarios](references/acceptance-scenarios.md) before claiming completion. Existing installed copies or pinned bundle commits must be updated deliberately; editing this skill alone does not configure another project.
