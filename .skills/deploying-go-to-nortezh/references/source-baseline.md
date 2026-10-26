# Delivery source baseline

## Evidence

- Reference: Olufy-API, commit `01731b564d56dfb72755fe9421515aafc894b3dc`, inspected read-only on 2026-10-22.
- Docker evidence: `build/{user,admin,worker,cron}/Dockerfile`. These are source examples, not mandatory target application names.
- Workflow evidence: `.github/workflows/{user,admin,worker,cron}-{staging,prod}.yaml`.
- The source builds from module root, targets Linux amd64, pushes to GHCR, passes an image job output to a dependent Nortezh deployment job, and uses main/manual staging versus published-release production.
- The source uses `WebService` for API applications and `Worker` for worker and scheduled applications. Its application names, destination identifiers, and GitHub secret names are not portable defaults.
- Action contract checked directly at [Nortezh action v1.0.5](https://github.com/Nortezh/nortezh-action/tree/v1.0.5), including `action.yml` and README. The action uses Node 20 and `deployment.create-revision` may create a target if absent.

## Verified action pins

Resolved public tag refs on 2026-10-22. These pins establish which code a template references, not a security audit or proof that GitHub/Nortezh execution succeeded.

| Action tag | Commit |
|---|---|
| `actions/checkout@v4` | `11d5960a326750d5838078e36cf38b85af677262` |
| `actions/setup-go@v5` | `40f1582b2485089dde7abd97c1529aa768e1baff` |
| `docker/setup-buildx-action@v3` | `8d2750c68a42422c14e847fe6c8ac0403b4cbd6f` |
| `docker/login-action@v3` | `c94ce9fb468520275223c153574b00df6fe4bcc9` |
| `docker/build-push-action@v6` | `10e90e3645eae34f1e60eeb005ba3a3d33f178e8` |
| `Nortezh/nortezh-action@v1.0.5` | `ec5808f79fa5cfc74514e8631a0013315a79475f` |

## Deliberate differences from source

- Generic application names and per-app/stage environment configuration, not copied source destinations or secrets.
- Shared reusable delivery logic with per-app staging/production callers instead of eight nearly identical full pipelines.
- Production caller excludes prereleases unless the target explicitly chooses another release policy.
- Tests/build/vet before publishing; source workflows did not themselves establish this gate.
- Explicit schema/context/workflow path filters and target-specific asset additions.
- Run-specific full-commit tags plus recorded digest rather than short-SHA-only tags.
- Job-scoped token permissions, environment-protected deployment credentials, input checks, and explicit WebService ports.
- Non-root distroless runtime, no unnecessary QEMU for native Linux amd64 builds, pinned actions and Swagger generator, and an explicit `.dockerignore`.

## Verification boundaries

The local Docker CLI exists, but both the selected Desktop Linux engine and default local engine were unavailable during authoring. No image build or container smoke succeeded on this basis. No registry push, GitHub workflow run, secret provisioning, or live Nortezh deployment was performed. Static template checks are separate evidence and must not be described as deployment readiness.
