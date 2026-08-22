# Implementation roadmap

## Complete: deterministic vertical slice

- Shared Fact IR and ontology contracts.
- OpenAPI and system-manifest extractor plugins.
- Commerce fixture with services, APIs, schemas, events, databases, and domain concepts.
- Graph projection with evidence, confidence, provenance, domains, and bounded focus queries.
- React graph workspace with system/ontology modes, filters, selection, inspector, evidence, and layout persistence.

## Next: semantic review

- Provider-neutral structured LLM adapter.
- Evidence-constrained semantic induction.
- Proposal diffs with accept/edit/reject, version history, and undo.
- Discovery inbox and contradiction signals.

## Then: source and continuous discovery

- Java/Spring extractor worker for controllers, calls, repositories, and database access.
- Repository revisions, source retention policy, and incremental fact invalidation.
- Runtime topology and trace evidence.
- AI graph navigation and operation previews.

## Risks to measure

- Entity identity and duplicate merging across extractors.
- Confidence calibration across deterministic, documentation, runtime, human, and LLM evidence.
- Postgres traversal latency at high edge counts.
- Dense graph readability and bounded client payloads.
- Secret leakage through retained source or model context.
