# Delivery source baseline

## Current workflow authority

On 2026-10-28 the user supplied three local reference workflows and requested their standalone two-job shape instead of the previous reusable-workflow redesign. Later they explicitly requested removal of the raw reference directory and addition of Dockerfile examples inside the skill. Reference inputs are not publication deliverables; do not restore or re-upload the deleted raw files.

The portable workflow template and **synthetic** golden fixtures preserve step order/action tags, two-job output wiring, secret-name mapping, short-SHA tags, and optional port behavior. Fixtures use `catalog`/`processor`, `example-production`/`example-staging`, and `example-0`, not the reference system's real destinations. Event/branch choices remain proposals to confirm, not forced production/staging defaults.

Golden hashes now describe these sanitized fixtures; they no longer claim byte equality to the original private/project-specific inputs. Explicit action-order/output tests protect the approved shape without needing raw files. Deletion from the current tree does not remove already-published historical blobs; history rewriting and its impact require separate approval and cannot guarantee deletion of other clones/caches.

## Portable Dockerfile examples

Read [Dockerfile examples](dockerfile-examples.md) for complete generic API + Swagger and Worker assets, matching workflow build context, output/entrypoint paths, runtime assets, and ports. They adapt the reference's root-module/multi-stage/distroless approach with pinned host-native Swagger generation and an explicit non-root runtime. Example Go image versions/app names are illustrative; inspect and confirm the actual target requirements before generating Dockerfiles.

## Earlier evidence retained only where applicable

- Olufy-API commit `01731b564d56dfb72755fe9421515aafc894b3dc`, inspected read-only on 2026-10-22, informed the per-app Dockerfiles and root-module build approach.
- [Nortezh action v1.0.5](https://github.com/Nortezh/nortezh-action/tree/v1.0.5) action.yml/README were inspected for inputs: action, project, location, name, image, type, optional port, and `SA_AUTH_EMAIL`/`SA_AUTH_KEY`. `deployment.create-revision` may create a target if absent. Historical inspection is not current platform/runtime readiness evidence.
- The old shared verify/publish/deploy pipeline, main/manual-staging default, release-only-production default, env-variable destination mapping, run-unique tags, and action SHA pins are **not** the current template. Do not reintroduce them silently.

## Verification boundaries

Golden/renderer/YAML checks establish static fidelity and project-local file creation only. Dockerfile static checks and local compilation of synthetic Go entrypoints do not execute external Swagger generation, Docker image construction, or runtime asset reads. No example test validates account credentials, action availability, GHCR publication/pulls, protected environments, GitHub runs, or Nortezh deployments.
