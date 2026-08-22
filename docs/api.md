# API surface

All routes are prefixed with `/api/v1`.

| Route | Purpose |
| --- | --- |
| `GET /projects` | List project snapshots |
| `GET /projects/:id/graph` | Bounded system or ontology graph; supports mode, focus, depth, type, domain, search, relation, confidence, and limit |
| `GET /projects/:id/ontology` | Current ontology version |
| `GET /projects/:id/runs` | Ingestion history |
| `POST /projects/:id/ingestion-runs` | Re-run the built-in fixture ingestion |
| `GET /projects/:id/entities/:id` | Entity plus evidence |
| `GET /projects/:id/relationships/:id` | Relationship plus evidence |
| `GET /projects/:id/search?q=` | Compact entity search for command bars and agents |
| `GET/PUT /projects/:id/layout` | Presentation-only canvas state |

Graph responses include `totalEntities`, `totalRelationships`, `truncated`, `focus`, and `generatedAt`. Responses are capped at 250 visible entities and a maximum traversal depth of 3.

The agent surface intentionally reuses compact REST responses first. Dedicated tool schemas, semantic command previews, and graph-operation proposals are next-phase additions.
