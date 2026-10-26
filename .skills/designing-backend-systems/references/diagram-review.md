# DB diagram and team review

Prepare a shared understanding of the data, not just a picture of table names. Follow the requirements checkpoint before presenting a final proposed physical schema. Requested early exploration must remain clearly labeled as a draft with assumptions.

## Prepare editable artifacts

Use the team's established diagram format. If none is specified, DBML is a portable text source that can be reviewed/versioned; Mermaid ER or another approved format is also acceptable. Do not force a SaaS account or upload a private schema to an external renderer.

Produce a high-level relationship overview and a detailed view when one dense diagram would obscure the model. Use clear names and grouping rather than collapsing distinct entities solely to reduce the number of boxes.

Include or accompany the diagram with:

- Table/entity purpose and grain; distinguish canonical, historical, and derived data.
- Primary keys, foreign keys, cardinality/optionality, required fields, and important unique relationships.
- Field dictionary: meaning, type/units, null semantics, ownership, defaults, and validation/invariants.
- Important indexes, delete/update policy, and constraints not expressible in the diagram format.
- Critical write/transaction boundaries and read/processing consumers of shared facts.
- Credible extension scenarios, open decisions, and cache/read-model distinctions when relevant.

Use [the DBML wrapper](../assets/schema.dbml.tmpl) only after choosing actual entities. Replace every token and use valid identifiers/escaped strings. Validate with an available approved parser/renderer when possible; state when only text/static checks or human walkthroughs were performed. A rendered diagram does not prove SQL constraints, performance, or business correctness.

Use [the design brief](../assets/design-brief.md.tmpl) for the paired summary. Do not leave template placeholders or fabricated figures in a final deliverable; explicitly record unknowns and their owners instead.

## Discuss the diagram

Walk through concrete user flows with the user/team:

1. Do the entities and names match the agreed vocabulary? Is any important fact or relationship missing?
2. Are cardinalities and optional values right? Can realistic records be represented without duplication or invalid combinations?
3. Which values are canonical, derived, or intentional historical snapshots? Could multiple processors reuse the same facts without maintaining conflicting copies?
4. What happens on create/update/delete, concurrent operations, retries, cancellation, and corrections? Which constraints/transactions enforce invariants?
5. Do history, privacy, tenant isolation, and retention work without accidental cascade loss or disclosure?
6. Can the likely next features be added with understandable migrations, rather than invasive redesign or a universal untyped schema?
7. Do critical queries, sort/pagination, indexing, and optional Redis behavior match the access pattern and freshness needs?
8. What is unnecessarily complex? Recommend simplifications while explaining any integrity or performance trade-off.

Ask specific questions and recommend improvements, not merely "does this look good?" Record disagreement and alternatives accurately. Do not change a business requirement just to simplify a diagram without approval.

## Iterate and hand off

Maintain a short decision log linking requirement → table/relationship/invariant → decision/evidence. Update diagram, dictionary, access/cache plan, and migration notes together after feedback; do not let them become contradictory versions of the design.

Use explicit statuses such as draft, ready for review, changes requested, and approved by the responsible human. Only record approval when that human actually supplies it. If team review has not occurred, deliver a shareable ready-for-review package rather than claiming approval. Record an explicit user waiver of a team checkpoint if one is given, without inventing team agreement.

Final handoff should name unresolved assumptions, blockers, migration/extension risks, and the next decision/implementation step. Separate planned checks from executed results. Do not provision databases, publish artifacts externally, or start implementation just because a diagram is available.
