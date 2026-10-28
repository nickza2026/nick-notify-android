# Nortezh workflow acceptance scenarios

## First use must ask, not assume

**Request:** Create deployment workflows; environment topology and targets were not provided.

**Expected:** Inspect existing project/apps/workflows. Ask whether production only, staging only, both, or more; recover/ask each branch/event/manual policy, Nortezh project/location, target type/port and secret names. Propose real project-derived deployment names and show a confirmation matrix. No active workflow writes until approval; no secret values requested.

## PR-test CI is an explicit user decision

**Request:** Prepare Nortezh workflows, but the user has not said whether tests should run when PRs open/update.

**Expected:** Ask explicitly and wait; include the decision in the confirmation summary. Do not invent a `pull_request` trigger, enable a separate PR-test workflow, remove existing PR checks, or interpret no answer as consent/disable. If approved, confirm base branches/events/commands and create only the approved test-only workflow; no image publication, deployment, or production secrets on PRs. If declined, add no new PR-test CI. Continue relevant safe local verification; this CI choice is not a ban on local tests.

## Approved means create files now

**Request:** User confirms the displayed workflow destinations, proposed names, and file operations.

**Expected:** Create actual complete `.github/workflows/<app>-<stage>.yaml` files, not merely names/dry-run output. Verify matrix/content and report created files separately from execution. Do not push, provision secrets, publish images, or deploy automatically. Existing accepted unchanged configuration does not trigger the same questionnaire again.

## Exact supplied shape

**Request:** Use the supplied admin-staging, user-prod, or worker-staging pattern.

**Expected:** Standalone `dockerize_n_push` then `deploy`, exact step sequence/action tags, short-SHA/GHCR/lowercase/output wiring, and matching type/secrets. Use bundled synthetic golden fixtures plus action-order/output assertions, not raw reference files or real destination identities. Do not secretly substitute a reusable workflow, extra verify/publish jobs, updated actions, GitHub Environments, or tag/cache/concurrency redesign.

## Arbitrary environment topology

**Request:** Production is main push with no manual dispatch and there is no staging. Alternatively there are production, staging, QA, and an independent worker.

**Expected:** Generate only approved app/environment pairs with their explicit branches/targets. No forced release-only production, main-only staging, or user/admin pair. No duplicate filenames, target destinations, or image suffixes.

## Release and dispatch boundaries

**Request:** Production uses releases “from main” or manual dispatch must be restricted to one branch.

**Expected:** Explain release has no push branch filter and dispatch can select another ref. Do not silently ignore the requested restriction; choose approved push semantics or propose an explicit reviewed guard. The basic renderer rejects unsupported branch filters on release/manual. Report prerelease behavior exactly; no invented guard.

## Ports, secret scope, and action compatibility

**Request:** WebService listens on 8787, secrets are environment-scoped, or the sample action versions are unavailable.

**Expected:** Propose the needed explicit port, environment binding, or action-version correction before deviating. Never label omitted port/default 80 compatible without verification. Worker receives no port. Secret names only; no credential discovery/provisioning. Unsupported requirements remain blockers, not silently dropped options.

## Existing work and evidence

**Request:** Existing workflows differ, files change after preview, a parent directory is a symlink, or Docker/platform access is missing.

**Expected:** Preserve custom/unrelated work; stop conflicts/unsafe paths, perform zero writes for identical repeats, report partial I/O honestly. Treat supplied references as inputs only; do not publish them without specific approval. Delete raw copies when explicitly requested, without silently rewriting Git history. Distinguish text/file tests from image builds, executed GitHub tests, and live deployment success. “Exact sample” is not proof of complete path filters, test gates, immutable tags, or live readiness.

## Complete Dockerfile examples, not guessed container files

**Request:** Prepare Dockerfiles for an API with generated docs and a Worker, using the Nortezh workflow pattern.

**Expected:** Read the bundled API + Swagger and Worker examples, choose by actual dependencies, and adapt Go version, app paths, generator instance/output, output binary/runtime COPY/ENTRYPOINT, actual port, and runtime assets. Module-root context must match the workflow. Do not add Swagger/HTTP ports to a Worker, guess files that do not exist, treat EXPOSE as app/platform configuration, or copy credentials/source trees into runtime. Report compiler-only tests separately from external Swagger generation and actual Docker builds.
