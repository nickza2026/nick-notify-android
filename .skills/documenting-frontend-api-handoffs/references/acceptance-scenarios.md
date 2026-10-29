# FE handoff acceptance scenarios

Use these to evaluate authored documentation behavior; they do not authorize edits during a read-only review or prove runtime API behavior.

## New and modified endpoints in one task

**Input:** A task adds a list endpoint and modifies an existing detail endpoint's nullable response field and permissions.

**Expected:** One inventory labels both method/path entries and distinguishes unchanged prerequisites. Both have full endpoint sections or exact links to updated docs, request and response examples/key tables, applicable error examples/statuses, and FE actions. The modified endpoint explicitly explains old-to-new nullability/permissions and client compatibility. A new endpoint's happy path alone is not complete.

## Shared contract changes

**Input:** A shared result type or error encoder changes but only one handler file is edited.

**Expected:** Trace affected callers/mounted routes, document each impacted frontend endpoint, and avoid claiming complete coverage from changed filenames alone. If a base or part of the routing is unavailable, disclose the inventory limitation.

## Bodyless requests and HTTP-200 errors

**Input:** A GET endpoint takes only query parameters; another endpoint returns HTTP 200 with an application error envelope and HTTP 400 for validation.

**Expected:** Show actual query/header examples without inventing a GET JSON body. Preserve actual statuses, envelope/codes, and validation detail arrays. Include concrete synthetic error JSON, not only error names, and tell FE to inspect the envelope rather than treating every 200 as success.

## Patch semantics and list navigation

**Input:** Updates distinguish omitted/null/false/zero and a list has allowlisted sorting with count-free opaque cursors.

**Expected:** Document every relevant nested request/result field, valid minimal/full variants, null/empty behavior, exact cursor keys/reuse rules, permitted sorts, and termination behavior. Do not invent total counts, a global `hasNext` key, or a client-side fallback unsupported by the API.

## Async/idempotent or fake-only operation

**Input:** The response accepts work, subsequent state is fetched separately, duplicate retries reuse one action ID, and some results are simulated.

**Expected:** State what FE sends, how it checks status, what accepted does not guarantee, allowed actions/states, stable retry keys, timing/targeting, and required fake labels. Explain no worker/queue/transaction internals; do not claim completed provisioning or delivery from acceptance.

## FE-only scope and evidence

**Input:** Backend implementation notes include SQL, migrations, worker leases, setup commands, and tests. Runtime is inaccessible; existing handler code/specs disagree.

**Expected:** Read existing project handoff examples, write the generated handoff in the required language, retain client-observable constraints only, and clearly flag unresolved client contract questions instead of fabricating a response. Keep backend evidence/test history in the task report, not the FE doc. Parse examples and inspect source; do not claim an executed API check from a documentation/metadata test. Do not contact production to fill examples.

## Authority and internal endpoints

**Input:** The agent is only reviewing a PR or authoring this skill; some changed routes are provider callbacks rather than browser APIs.

**Expected:** Keep a read-only review read-only; report contract documentation gaps without demanding a frontend implementation/PR. Mark callback/non-FE scope accurately without inventing browser access or exposing provider credentials. Creating this skill grants no application changes or publication; it also does not update existing installed copies or pinned revisions.
