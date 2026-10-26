# Pagination and sorting

Treat these as two related contracts: **how the client orders a list** and **how it navigates that ordered result**. Choose the pagination mode per endpoint; do not require exact totals on every list.

## Select the contract from the workload

| Need | Suitable approach | Cost/behavior |
|---|---|---|
| Exact totals and numbered pages on a manageable result | Counted offset pagination | Filter-consistent total query plus the page query |
| Next-page navigation without totals | Count-free offset pagination | Fetch at most limit + 1 matching rows; no full count |
| Large/changing datasets or expensive deep offsets | Count-free keyset/cursor pagination | Indexed seek using the chosen ordering; fetch limit + 1 |

Counted versus count-free and offset versus cursor are separate choices. Removing COUNT does not make deep OFFSET inexpensive. Do not automatically introduce cursor navigation when a supplied contract requires numbered pages; explain the trade-off if the workload makes that contract problematic.

Use exact totals only when the task/client actually needs them and the query cost is acceptable. Otherwise prefer next-page metadata for large lists. Do not silently execute a full count to satisfy a reusable DTO or helper's total fields.

## Count-free next-page detection

For a validated page size `limit`:

1. Apply authorization, tenant scope, filters, and deterministic ordering in the authoritative query.
2. Apply the selected offset or cursor boundary.
3. Request at most `limit + 1` matching rows, guarding input bounds/overflow.
4. Set the chosen next-page flag to whether more than `limit` rows were fetched.
5. Return only the first `limit` rows. The extra row is a probe, not part of the response.
6. For cursor mode, derive the next boundary from the **last returned row**, not the discarded extra row, so the probe row is not skipped. Emit continuation metadata consistently with the documented flag.

Use the target's chosen wire name, such as `hasNext`, `hasNextPage`, or an established `next`; do not treat these as interchangeable API keys. Preserve the user's example when supplied and document one consistent shape per endpoint. The source wrapper's actual key is `next`, not proof that it uses a target's proposed `hasNext` key or avoids full counts.

Omit unavailable `totalItems`/`totalPages` or represent them only as explicitly documented optional values. Never return fake zero totals, misleading last-page numbers, or silently estimated totals as exact. If an exact count is offered separately or by opt-in, define its permission scope, filters, cost, and freshness.

## Sorting is part of every browsable list

Support explicit client sort for new browsable lists by default. Skip selectable sort only when the domain deliberately mandates a fixed order, and document that exception. Pagination mode does not remove the sorting requirement.

- Define allowed public sort fields and map each to a trusted SQL expression. Do not expose every database column automatically.
- Validate both field and direction (`asc`/`desc`) for HTTP decoding and direct function/constructor calls. Reject invalid input; do not silently fall back to a different sort.
- Define omitted-sort behavior and a deterministic unique tie-breaker, such as creation time plus ID. A timestamp alone is not unique.
- Apply sort before LIMIT/OFFSET or cursor selection. Sorting only a fetched page produces incorrect cross-page results.
- Keep filters/count/page authorization aligned. A metadata query must not leak counts from data the caller cannot access.
- Document nullable sort keys, NULLS FIRST/LAST, collation/case rules, and allowed multi-key sorting when relevant.
- Use useful matching indexes and verify plans/workload rather than claiming every allowed sort is equally cheap.

The source exposes `sort.column` and `sort.order` through `pkg/rest.Sort`. Concrete examples exist in `admin/audit/audit.go` and `admin/user/user.go`. Their presence does not prove all source endpoints support sort or already have a unique tie-breaker. A target may preserve that wire shape or use the user's supplied contract; do not rename fields silently.

## Cursor and sort compatibility

For keyset pagination, order and boundary predicates must use the same complete key tuple, including tie-breakers and the direction of each component. Handle nulls and forward/backward traversal deliberately; reversing a single comparison is not a universal cursor implementation.

Validate cursor types and versions. Bind continuation state to the selected sort and relevant filter context, or reject/restart pagination when those change. Reapply authorization/tenant scope on every request; an opaque cursor is not an authorization token.

Use opaque or integrity-protected cursors when appropriate, without embedding secrets. Do not promise snapshot consistency across writes unless the implementation actually provides it.

## Required checks

- Empty results; fewer than limit; exactly limit; limit + 1: verify returned length and next-page flag, without returning the probe row.
- Default sort, every supported alternate field/direction, invalid field/order, and ties on the primary sort key.
- Positive/bounded page size, overflow, cursor validation, changed sort/filter context, and absence of skipped probe rows.
- Correct query ordering and pagination boundaries; no post-page in-memory sorting.
- No full COUNT for the count-free mode; counted mode uses the same effective filters/authorization as the data query.
- Clearly document response fields, default ordering, nullability, and the selected pagination mode in spec and integration handoff.
