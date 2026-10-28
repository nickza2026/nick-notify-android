# First-use deployment questions and confirmation

Ask these for the **target application's workflow setup**, not for the skill repository itself. Inspect existing trusted files and recover task answers first. Ask once as a small structured set; offer a concrete recommendation rather than an empty questionnaire. Do not repeat accepted unchanged settings at every session.

## 1. Establish environment topology and triggers

Ask whether the project needs **production only, staging only, production + staging, or more environments** such as QA/preview. Do not invent a staging environment when the user only wants production. Ask which actual application(s) deploy in each environment; a Worker and API may have different matrices.

For each selected environment ask:

- Which exact branch deploys it? Inspect real branches; propose plausible defaults only as a recommendation to confirm. Production may follow main and staging another branch; do not force the supplied sample's main-staging/release-production mapping.
- Should deployment happen on **push to that branch**, **published releases**, **manual dispatch**, or an explicitly approved combination? If the user chooses a production branch and automatic branch deployment, use `push.branches`; do not silently convert it to releases.
- Is manual dispatch wanted? The supplied examples' manual runs can select another ref: a push branch filter **does not** constrain manual dispatch. If same-branch-only manual deployment is required, explain that an additional guard must be reviewed/approved; the basic renderer does not pretend to supply it.
- For releases, explain that `release: published` is repository-wide and has **no branch/path filter**, and the exact sample does not exclude prereleases. Ask whether that policy is acceptable. The helper rejects a release/manual config with `branch` rather than silently ignoring it. If branch ancestry/prerelease gating is required, propose the exact extra guard or choose branch-push deployment, then obtain approval for the deviation.

### Ask separately about tests on PRs

Ask explicitly: **"Should CI run tests when a pull request is opened or updated?"** Recover an existing approved project policy instead of re-asking it; otherwise wait for the answer. Do not add or enable `pull_request` test triggers, test jobs attached to PR events, or a separate PR-test workflow on the user's behalf. Do not interpret silence as either enable or disable, and do not remove existing PR checks/branch protections without explicit approval.

If yes, confirm target/base branches (GitHub `pull_request.branches` filters the PR **base**, not the source branch), events such as `opened`, `synchronize`, and `reopened`, path filters, test commands/runtime/database isolation, and any runner-cost constraints. Show the separate test-only workflow/file changes for approval; PRs must not publish images, deploy, or receive production secrets. Never use `pull_request_target` to execute contributor code with secrets. The standalone deployment renderer does not generate PR-test CI: create the approved separate test workflow through reviewed edits instead of silently dropping the requirement.

If no, record **no new PR-test CI** and keep deployment workflows on their approved push/release/manual triggers. Preserve existing checks unless their modification/removal was also approved. Record the accepted PR-test policy alongside the deployment matrix in project notes; the deployment renderer's JSON is deployment-only, not a PR-CI policy store. A request to author this skill is not itself a yes/no choice for another project's CI.

This question controls **automatic GitHub PR test execution**, not whether the agent should perform necessary safe local tests while implementing/verifying work. It does not authorize bypassing mandatory checks or declaring unrun tests passed.

## 2. Establish Nortezh destinations and propose names

Ask **project** and **location** per environment (or confirm explicitly that they are shared). Never copy a reference project's real deployment identifiers merely because they appear in a sample.

Propose a **deployment name** for every app/environment, derived from the target project, e.g. `<project>-<app>-api` for production and `<project>-<app>-api-stg` for staging. These strings are naming suggestions, not confirmed existing targets. Ask if the proposed names are OK and whether each target already exists or its creation is intended. Resolve collisions before writing; a mistaken name may create a new deployment on a live run.

Confirm `WebService` versus `Worker` for every app. For WebService confirm the actual listening port and platform/action port behavior. The exact samples omit `port`; do that **only after confirming** the effective platform/action setting matches the service. When a nondefault explicit port is needed, show the `port` line as an approved parameter adaptation. Worker omits port.

Confirm service-account secret **names and scope**, not their values. Examples use `NTZ_SVA_EMAIL`/`NTZ_SVA_KEY` for staging and `NTZ_SVA_EMAIL_PROD`/`NTZ_SVA_KEY_PROD` for production. Those are proposals, not mandates. The exact template uses repository/organization secret resolution without a GitHub `environment:` field. If credentials are environment-scoped or approval protection is required, propose the explicit deployment-job `environment:` change and confirm it; merely naming an environment in the plan does not enable GitHub Environment secrets/protections.

## 3. Show one approval table

Include all selected rows; illustrative values below are **not live defaults**:

| App | Stage | Trigger / exact branch | Nortezh project | Location | Proposed deployment name | Type / port | Secret names | File |
|---|---|---|---|---|---|---|---|---|
| catalog | production | push / main; no manual | example-production | example-0 | example-catalog-api | WebService / 8080 | NTZ_SVA_EMAIL_PROD + NTZ_SVA_KEY_PROD | .github/workflows/catalog-prod.yaml |
| catalog | staging (only if requested) | push / develop; manual only if approved | example-staging | example-0 | example-catalog-api-stg | WebService / 8080 | NTZ_SVA_EMAIL + NTZ_SVA_KEY | .github/workflows/catalog-staging.yaml |

Also show the GHCR suffix, Dockerfile/context, app-dependent path filters, optional port/guard/environment adaptations, any required new Dockerfiles, and existing-file conflicts. Include **PR-test CI: approved yes / approved no / unanswered**, plus the approved test-only filename/branches/events when enabled; unanswered needs a user decision, not a default. Inspect dependencies such as `schema/**`, `.dockerignore`, shared packages, and assets; propose missing filters explicitly rather than secretly changing the supplied pattern. Clarify which example-derived action versions/short-SHA/cache rules will be retained.

Ask one confirmation: approve the matrix/names and the creation/updates of the listed workflow/container files? Warn that a later authorized push to the configured branch/release can run real image publication/deployment. Do not provision secrets, create a live target, push, or trigger a run as part of this question.

If the user already supplied **and approved** the full matrix/file operations, do not demand the same confirmation again. If an answer is missing, ask only for that concrete missing item. In non-interactive setup without prior approval, produce a proposal but write no active workflows.

## 4. After approval, finish file creation

Write the approved non-secret config and create the actual `.github/workflows` files using the helper or equivalent reviewed edits. Do not end the turn with “I can create them” or just a dry-run. Preserve unrelated instructions/workflows; report conflicts rather than force-overwriting them. Verify generated content against the confirmed matrix and distinguish files-created from actually-run/deployed.

The renderer's `environment` is a plan label only. Its supported trigger kinds are `push`, `release`, and `manual`; `manual` is an explicit boolean. Extra guards, GitHub Environments, concurrency, updated/pinned actions, alternate platforms/contexts, or extra test jobs are **not** generated by the exact-example helper. Propose those changes transparently when needed and apply only within approved scope; never silently drop an unsupported requirement.
