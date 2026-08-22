# Onto

Evidence-first ontology discovery for distributed software systems.

This repository contains the first local vertical slice: deterministic OpenAPI and system-manifest ingestion, immutable-style Fact IR, a small ontology-backed knowledge graph, and a graph-dominant React workspace for exploring the resulting model.

## Run locally

Requires Node 20+.

```bash
npm install
npm run dev
```

The web app runs on `http://localhost:5173` and the API on `http://localhost:4000`. The API uses an in-memory local adapter for this first slice so no Docker or external credentials are required; the repository boundaries are ready for the planned PostgreSQL/PGlite adapter.

## First slice

- OpenAPI and system-manifest extractors emit evidence-backed Fact IR.
- The graph projection keeps ontology definitions separate from system instances.
- System and ontology graph modes share the same bounded query surface.
- Evidence, confidence, provenance, filters, path focus, and canvas layout are visible in the workspace.
- Semantic mutations and LLM proposals are intentionally staged for the next phase.
