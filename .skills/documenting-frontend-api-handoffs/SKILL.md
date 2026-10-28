---
name: documenting-frontend-api-handoffs
description: Creates or updates frontend-facing Markdown API handoffs whenever endpoints are added or modified, including behavior changes from shared types, validation, permissions, or error encoders. Covers every affected method/path with change summaries, request/body and response examples, field references, error examples, and FE integration responsibilities only. Use during API implementation or bug fixes, or when asked for FE docs, API integration guides, or frontend handoffs. Does not authorize frontend implementation, backend changes, production calls, or Git publication.
---

# Document API Changes for Frontend Integration

Treat a frontend-facing API change as incomplete until its `.md` handoff is created or updated alongside the authorized implementation. Include **every new and modified endpoint**, not just the main route or a link to Swagger. Produce a client integration contract, not a backend implementation report.

## Scope and output

- Follow higher-priority instructions, the approved task, and target repository conventions. Preserve unrelated and existing uncommitted work. In a read-only review, assess documentation and report gaps only; do not write files or require a frontend PR/UI implementation.
- Read existing FE documentation examples before writing. Prefer updating the existing feature handoff; otherwise use `docs/fe-<feature>.md` or the established project directory. Group related endpoints coherently and link split documents from one endpoint inventory. Do not create a new file for every tiny iteration.
- Write generated handoffs in Thai for Nick's Thai FE workflow unless the user or target repository specifies another language. Keep this portable skill and its bundled template/references in English. Preserve exact wire keys, enums, permission names, and error codes in every language.
- Include only FE-owned responsibilities and client-observable constraints. Exclude SQL, migrations, table/column design, worker/queue/lease/reconciliation internals, backend algorithms, Go types/source paths, configuration/deployment commands, and backend test/commit history. Do not copy backend implementation explanations from repository examples.
- Never expose secrets, real access tokens, customer data, credential-bearing URLs, or privileged service credentials to FE. Use unmistakably synthetic examples; do not upload private sources to external services. Documentation work grants no production calls, database execution, UI coding, commits, pushes, or deployment authority.

Read [the contract checklist](references/contract-checklist.md) for field/error/UI detail. Start from [the handoff template](assets/frontend-api-handoff.md.tmpl); expand it rather than shipping empty placeholders. Consult [acceptance scenarios](references/acceptance-scenarios.md) before reporting completion.

## Workflow

### 1. Build the complete endpoint inventory

Establish the delivery scope from the approved task, actual changed files, and an identified base/current diff when available. Inspect mounted routes, shared request/result types, validation, auth/permissions, serializers/error encoders, and directly relevant tests. Follow callers of changed shared contracts: one shared field or middleware change can affect several unchanged route files. Do not infer coverage solely from a handler filename or a stale API specification.

List each affected **method + full client-visible path**, audience, new/modified/removed status, change summary, and FE action. Include response-only changes, validation/default changes, changed permission/error behavior, route aliases/replacements, and newly constrained actions. For modified routes, give explicit old-to-new wire/behavior differences, compatibility implications, and what FE must change; clearly say when existing FE usage remains compatible.

If a changed endpoint is internal, provider-only, or service-to-service and FE must not call it, mark that scope explicitly with a brief client-facing reason; do not fabricate a browser integration or expose its credentials. Unchanged endpoints needed to complete a flow may be referenced as dependencies, clearly labeled unchanged. Do not pretend an unknown base or unavailable route proves a complete inventory; report the limitation and recover the missing scope through the parent/user.

### 2. Establish the actual wire contract

Verify the contract from runtime-facing code and safe existing tests, not Go structs or Swagger alone. Distinguish HTTP status from application success/error envelopes; preserve actual casing, omission, nullability, and no-result behavior. Document transport/auth wrappers once when truly shared, with precise per-route exceptions. Do not impose Bearer/JWT, REST statuses, RPC envelopes, `hasNext`, or a pagination schema from another project.

For **each** affected route supply its purpose/FE trigger, audience/auth/permission/state eligibility, request headers/path/query/body, request field table, successful response JSON, response field table, relevant errors with exact HTTP statuses and JSON examples, and FE handling. For requests without a body explicitly say so and show the actual query/path/header example; do not invent a JSON body. Include minimal and fuller valid examples where optional combinations materially differ. Explain every relevant nested key and array item, not only fields present in one happy-path example.

### 3. Describe FE integration, not BE execution

Map endpoints and permissions to existing screens/actions without inventing product/UI requirements. Separate mandatory API constraints from optional presentation suggestions. Cover loading, empty, unavailable, validation, unauthorized/forbidden, conflict/stale state, success refresh/navigation, and disabled/hidden action conditions as applicable. Hiding a button is not authorization; FE must handle server rejection and state changes between render and click.

Include list controls, upload/download behavior, targeting, time units/timezone, polling/async outcomes, retries, idempotency, and fake/demo limitations only when applicable and verified. Explain what FE sends/displays/waits for, not how backend workers or database transactions implement it. Mark uncertain or unimplemented contracts as blockers instead of inventing endpoints, retry rules, timers, or fields.

### 4. Reconcile coverage and verify the handoff

Compare the final endpoint inventory with the changed routes and shared-contract impact. Give every new/modified entry a complete endpoint section or an exact link to an updated section; do not leave a response-only change undocumented. Verify example JSON and key tables agree with each other, the implementation, and relevant safe contract checks. Check error examples against actual mounted status/envelope behavior; an illustrative document alone is not executed API evidence.

Use existing safe tests or approved isolated checks to resolve contract uncertainty. Do not call production or unsafe mutation endpoints merely to obtain examples. Keep implementation sources stable during running checks. If runtime verification is blocked, disclose that in the task report and mark the uncertain client contract clearly; do not embed backend test logs in the FE handoff or claim all routes are verified.

Finish with a concrete FE integration checklist and, for modified APIs, a client adoption checklist. Remove unused template sections or state a verified not-applicable condition. Report output `.md` paths, covered endpoint count/list, and unresolved contract questions to the parent/user. Authoring this skill does not automatically install it into every project or update an existing pinned source revision.
