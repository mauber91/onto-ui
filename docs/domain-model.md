# Domain model

| Concept | Meaning | First-slice state |
| --- | --- | --- |
| Artifact | A source document or manifest with a content identity | OpenAPI and system manifest |
| Fact | Directly observed subject/predicate/object with evidence | Immutable-style map keyed by fingerprint |
| Evidence | A source reference, location, kind, and optional excerpt | File paths and line references |
| Ontology | Definitions of types and allowed relations | Published version 1 |
| Entity | A system instance typed by the ontology | Services, endpoints, schemas, events, databases, concepts, domains |
| Assertion | A relationship between entities with provenance | Deterministic or configuration-origin edges |
| Proposal | Reviewable semantic diff | Contract reserved for next phase |
| Layout | User-facing positions and viewport | Saved separately from graph state |

## Fact IR shape

```ts
type Fact = {
  id: string;
  projectId: string;
  kind: string;
  subject: FactTerm;
  predicate: string;
  object: FactTerm;
  evidence: EvidenceRef[];
  extractor: { id: string; version: string };
  observedAt: string;
  repositoryRevision?: string;
  confidence: number;
  metadata: Record<string, unknown>;
  fingerprint: string;
};
```

`FactSchema` and the ontology schemas in `packages/domain/src/index.ts` are the runtime source of truth for API and extractor validation.
