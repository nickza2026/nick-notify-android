# FE contract coverage checklist

Use this while inspecting source and filling the handoff. Document only applicable behavior that the implementation or approved contract establishes; do not turn this list into invented API requirements.

## Endpoint and change inventory

- Show method, fully mounted path, audience, status (new/modified/removed), purpose, FE trigger, and a link to the detailed section.
- Include indirect impact from shared payload types, auth middleware, permissions, defaults, serialization, pagination wrappers, and error encoders. Label unchanged flow dependencies separately.
- For each modification state before/after keys, types, enums, defaults, status/error behavior, requiredness, compatibility, and the precise client action. Do not infer production rollout dates or a compatibility window from a local change.

## Auth and action eligibility

- Specify the actual authentication mechanism and client headers/cookies/content type. For browser cross-origin use, explain only verified client requirements such as credentials/CSRF handling; never prescribe a privileged backend API key in frontend code.
- Give exact permissions, tenant/resource visibility, allowed states, and permission-to-action mapping. Distinguish missing session, forbidden access, missing resource, and expired session behavior when the API distinguishes them.
- State how FE obtains prerequisite IDs/options through documented endpoints. Do not leak database lookup instructions or invent discovery endpoints.

## Request reference

| Key path/location | Type/format | Required/nullable | Default or omission meaning | Constraints | FE responsibility |
|---|---|---|---|---|---|
| Use actual paths such as `body.filter.status`, `query.cursor`, `header.Idempotency-Key` | Include array element types | Distinguish omission from explicit null | State only actual defaults | Allowed values, bounds, size/unit limits | Where input comes from; when to send it |

- Enumerate relevant nested objects/arrays; distinguish omitted, `null`, empty string, empty array, `false`, and `0`, especially for partial updates.
- Specify IDs as opaque identifiers or exact formats only when established. Cover string length/byte limits, precision/rounding, amount units, enum casing, mutually exclusive/dependent fields, and date range inclusivity as applicable.
- Show valid minimal and full request JSON where useful; a bodyless GET needs a path/query example instead. Label invalid input separately alongside its expected error, never as a valid request.

## Response reference

- Show the actual success HTTP status and complete envelope. Explicitly document empty body, missing `result`, or `result: null` rather than guessing from a language type.
- Explain nested field paths, types, nullability/omission, enum meanings, time/unit/precision rules, and relevant UI presentation/state consequences. Cover meaningful empty/optional variants and distinguish unknown/unavailable values from an actual zero measurement.
- For lists describe accepted filter/sort keys and directions, defaults and limits, pagination mode and exact wire keys. Include a real empty example. Explain opaque cursor reuse, expiry/filter binding, and when next navigation stops only if implemented. Never require totals or invent zero totals when absent.
- For async operations distinguish accepted, pending, succeeded, failed, canceled, or unavailable states actually exposed. Document the real polling/stream endpoint and verified interval/backoff guidance if defined; do not invent a completion signal.

## Errors and recovery

| HTTP status | Exact application code/envelope | Trigger | Example link | FE handling/retry |
|---|---|---|---|---|
| Keep transport status separate | Preserve exact casing and optional fields | Give a reproducible input/state category | Complete synthetic JSON or bodyless/non-JSON description | Inline message, auth flow, refetch, stop, or permitted retry |

- Cover reachable auth/permission, validation, not-found, conflict/state eligibility, duplicate/idempotency mismatch, rate limit, and server/unavailable cases relevant to the route. Do not assert every route returns every category.
- Provide concrete JSON examples for each distinct relevant status/envelope/error shape. Multiple codes sharing a shape can use a clearly mapped example plus a complete code/trigger/handling table. Do not offer only a list of codes. Preserve actual per-field validation detail shape, headers, and HTTP-200 domain failures where present.
- Reuse a common auth/error section only when the endpoint links it and states its applicability/exceptions. Do not use “see common errors” to omit route-specific failures.
- Define safe retry behavior only from the actual contract. Reuse a stable idempotency key/action ID for retries of the same human action when required; change it for a new action. Disable duplicate submission as UX, not a replacement for idempotency. Explain whether timed-out mutations require refetch/status reconciliation rather than blind retry.

## FE flow, limitations, and final scrub

- Map documented endpoints to existing screens, controls, and permission-visible actions. Describe form defaults, validations, confirm/submit, in-flight disabling, loading/empty/error states, and post-success refetch/cache invalidation where the contract requires it. Mark optional UX suggestions as optional.
- State targeting (which users/resources), eligibility, local-vs-UTC rendering, timing windows, cancellation, stale responses, and partial-success handling where they affect the client.
- Label fake/demo/simulated results and unsupported actions explicitly. Do not imply real provisioning, live notification delivery, or actual money movement from an accepted/demo response.
- For uploads/downloads include actual field names/content types/limits and client-visible expiry/access rules; use safe synthetic URLs, never private storage credentials.
- Remove BE internals: SQL/migrations/DB setup, worker/dispatch/leases, algorithms, package paths, deployment/server configuration commands, and backend test/commit history. Keep observed state/action/retry constraints even if their implementation is complex.
- Verify every inventory entry resolves to a complete section, every example field has the right meaning, errors agree with real handlers, examples are synthetic, and no unresolved placeholder remains. Finish with an actionable FE checklist; put backend verification evidence in the task report, not the client handoff.
