# Dockerfile examples: choose, adapt, and verify

Use the complete, synthetic examples bundled **inside this skill**; no reference checkout or raw customer workflow directory is needed. These files are inert `.example` assets, not deployed services. Names, Go image versions, and ports illustrate a layout, not approved target settings.

## Choose the matching example before writing

| Application | Start from | Adapt after inspecting the target |
|---|---|---|
| API importing generated Swagger docs | [API + Swagger](../assets/dockerfiles/api-swagger.Dockerfile.example) | `cmd/catalog`, `catalog/docs`, registered instance `catalog`, Go version, and actual port |
| Worker or scheduled process without HTTP/Swagger | [Worker](../assets/dockerfiles/worker.Dockerfile.example) | `cmd/processor`, output/entrypoint name, Go version, and needed runtime assets |
| API with no generated Swagger imports | [Minimal template](../assets/Dockerfile.tmpl) | App/Go tokens; omit generator unless the source actually needs it |

Do not copy a raw application's identifiers, credentials, package paths, static resources, or `.env` files. Inspect real imports and startup behavior. Do not add Swagger to a Worker, create `catalog`/`processor` applications just to fit an example, or remove required generated imports merely to get a build through.

## Materialize one Dockerfile per actual application

After the user approves the workflow/container matrix:

1. Determine the required Go version from target `go.mod`/toolchain policy. The examples' `golang:1.25` is a source-shape illustration, not a latest/security recommendation. Use the target's supported patch/digest policy; do not silently lower its toolchain.
2. Create or deliberately edit `build/<actual-app>/Dockerfile`. Keep module-root `COPY go.mod go.sum ./`, `go mod download`, then source copy. Preserve required embedded schema/Go assets via the build context.
3. Keep the workflow context `.` and Dockerfile `./build/<actual-app>/Dockerfile` consistent. Run builds **from the repository's Go-module root**, not from `build/<app>`.
4. Match the Go package path, output binary path, runtime `COPY`, and JSON-form `ENTRYPOINT`. Do not produce `/out/catalog` and then start `/app/processor`.
5. For Swagger, match the actual generated-doc import/output and registered instance; a default instance and a named instance are not interchangeable. Keep generation before compilation, pin the generator, and run `go install` for the builder host architecture. Add target-specific parse/exclude flags only when required. The Swagger example requires a real Swagger-using application; the local example checks do not claim the external Swagger generator was executed.
6. Confirm HTTP listen address and port from actual app config. `EXPOSE 8080` is metadata: it neither configures the server nor makes Nortezh route to that port. Set the approved Nortezh WebService port accordingly. A Worker has no invented HTTP port or shell-based health check.
7. Inspect/merge [the context exclusions](../assets/dockerignore.tmpl); do not overwrite existing ignores or exclude embedded schema/required assets. Sending source to a remote builder still requires secret-free context.

For example, only after adapting the selected Dockerfile to an approved project:

```text
docker buildx build --platform linux/amd64 --load -f build/catalog/Dockerfile -t local/catalog:check .
docker buildx build --platform linux/amd64 --load -f build/processor/Dockerfile -t local/processor:check .
```

These commands create local images and may download base/toolchain/module artifacts. They are not executed merely by reading the example. Obtain the required scope and inspect build/test side effects before use; never substitute an actual production app run with credentials for a smoke fixture.

## Runtime assets are explicit, not automatic

`COPY . .` copies source into the **builder** only. The runtime image contains only its explicit `COPY --from=builder` paths. Generated docs/SQL embedded in the compiled binary need no separate runtime copy, but templates/static files opened from disk do.

When the target actually reads a synthetic path such as `templates/mail` or `static/help`, add the matching copies **before** `USER` in the runtime stage:

```dockerfile
COPY --from=builder --chown=65532:65532 /workspace/templates/mail /app/templates/mail
COPY --from=builder --chown=65532:65532 /workspace/static/help /app/static/help
```

Do not paste these optional lines if those directories do not exist or are not used. Match `WORKDIR /app`, application relative/absolute paths, read permissions, and workflow path filters. Writable mounts need separately confirmed ownership; do not solve a permission problem by silently switching to root. Distroless has no shell/curl: do not invent shell startup or health-check commands. CGO/native libraries or a required runtime utility need a reviewed different image/build plan.

## Verify layers separately

Check exact build paths, Go version, Swagger instance/order, asset copies, entrypoint, non-root permissions, listen address, and Nortezh port mapping. Run the skill's static/example regression tests, then a real image build/synthetic smoke when available and authorized. Report compiler-only/static success separately from Swagger generation, image construction, asset reads, Docker runtime, GHCR publication, and live Nortezh readiness. Missing Docker access is a reported limit, not a reason to invent a successful build.

User-supplied workflows/Dockerfiles are **reference inputs, not publication payloads**. Keep only approved synthetic templates/examples inside the skill by default. Publishing raw references or real deployment identities requires explicit permission for those artifacts; a broad commit/push request alone does not turn reference inputs into deliverables.
