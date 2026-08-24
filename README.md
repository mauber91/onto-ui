# Onto

Evidence-first ontology discovery for distributed software systems.

Onto helps teams understand systems that are spread across many repositories and boundaries: backend applications, microservices, API gateways, databases, event streams, infrastructure, and external platforms such as SAP or payment providers. It turns technical artifacts into a reviewable graph without pretending that an AI guess is the same thing as observed evidence.

The first slice is deliberately deterministic. OpenAPI documents and a small system manifest become Fact IR, then a typed ontology-backed knowledge graph that humans can explore in a graph workspace.

## What Onto models

Onto keeps four layers separate:

1. **Facts** — observations extracted from an artifact, such as “`POST /orders` is exposed by Orders Service”.
2. **Evidence** — the file, revision, source location, extractor, and confidence supporting that fact.
3. **Ontology** — definitions of types and allowed relationships, such as `Service`, `Database`, `Event`, `CALLS`, and `WRITES_TO`.
4. **Knowledge graph** — actual instances and relationships in the system being analyzed.

That separation matters when a system has conflicting sources. A README can document a dependency while a runtime trace or static extractor disagrees; Onto can retain both claims and show where each one came from.

## Use Onto with a multi-backend system

Onto is designed for systems composed of multiple backends, microservices, databases, and sources owned by different teams or even different organizations.

### 1. Collect artifacts by boundary

Treat every repository, service, database, or external integration as an artifact source. A typical input set might look like:

```text
system-input/
  checkout-repo/
    openapi.yaml
  orders-repo/
    openapi.yaml
  payments-repo/
    openapi.yaml
  supplier-platform-repo/
    openapi.yaml
  architecture/
    system.yaml
```

The current API accepts artifact contents as JSON. The artifact `path` should retain repository and boundary context, for example `orders-repo/openapi.yaml` or `sap-adapter/openapi.yaml`.

### 2. Describe cross-system relationships in a manifest

OpenAPI is excellent for service interfaces, but it cannot fully describe database ownership, event publishing, or a dependency on a separately managed system. Use a `system.yaml` manifest for those relationships:

```yaml
services:
  - id: checkout-service
    name: Checkout Service
    owner: Commerce Experience
    domain: Commerce
  - id: sap-adapter
    name: SAP Adapter
    owner: Enterprise Integrations
    domain: Fulfillment

databases:
  - id: orders-db
    name: Orders DB
    domain: Commerce

events:
  - id: order-created
    name: OrderCreated
    domain: Commerce

relationships:
  - from: checkout-service
    type: CALLS
    to: orders-service
    source: checkout-repo/src/clients/OrdersClient.java:31
  - from: orders-service
    type: WRITES_TO
    to: orders-db
    source: orders-repo/src/OrderRepository.java:87
  - from: orders-service
    type: PUBLISHES
    to: order-created
    source: orders-repo/src/events/OrderPublisher.java:84
  - from: orders-service
    type: CALLS
    to: sap-adapter
    source: orders-repo/src/clients/SapClient.java:105
```

This lets a graph span separate backend repositories, shared data stores, asynchronous events, and external systems while preserving the source reference for every relationship.

### 3. Ingest the artifacts

Start the local API and submit OpenAPI or manifest artifacts:

```bash
curl -X POST http://localhost:4000/api/v1/projects/commerce/ingestion-runs \
  -H 'content-type: application/json' \
  -d '{
    "artifacts": [
      {
        "path": "orders-repo/openapi.yaml",
        "kind": "openapi",
        "content": "<OpenAPI document>"
      },
      {
        "path": "architecture/system.yaml",
        "kind": "system-manifest",
        "content": "<system manifest>"
      }
    ]
  }'
```

For local evaluation, use the built-in Commerce & Sourcing fixture or select the **Offer Sample Management** snapshot in the workspace. The latter is a sanitized deterministic fixture that traces frontend routes and API calls through the supplier-response BFF to application services and downstream operations.

### 4. Explore the resulting world model

Open `http://localhost:5173` and use:

- **System mode** for concrete services, API endpoints, schemas, databases, events, and business concepts.
- **Ontology mode** for the smaller schema of entity types and allowed relationships.
- Search and explorer filters to isolate one domain, service type, repository, or confidence range.
- Node and relationship selection to inspect ownership, confidence, provenance, and source locations.
- Bounded graph focus to trace paths such as Checkout → Orders → SAP Adapter.
- Dragging to arrange the canvas; layout is stored separately from graph semantics.

The graph API is bounded by design. Queries support a focus entity, depth, relationship/type filters, search, and confidence threshold rather than returning an entire large system to the browser.

## Supported artifact types

| Artifact | Status | What it contributes |
| --- | --- | --- |
| OpenAPI / REST contracts | Implemented | Services, endpoints, request/response schemas, owner/domain metadata |
| System manifest | Implemented | Services, databases, events, domain concepts, cross-boundary relationships |
| Application source code | Implemented first slice | TypeScript frontend routes/client calls and line-anchored Java/Spring BFF controller/service/client relationships |
| Database schemas | Planned | Tables, ownership, read/write evidence, persistence concepts |
| Kafka/event definitions | Planned | Topics, producers, consumers, event schemas |
| Docker/Kubernetes/infrastructure | Planned | Deployment topology, environments, runtime boundaries |
| Git metadata, CODEOWNERS, Markdown | Planned | Ownership, revision history, documentation evidence |

The extractor contract is intentionally extensible. Each extractor emits Fact IR and cannot directly mutate ontology or graph semantics.

## Run locally

Requires Node 20+.

```bash
npm install
npm run dev
```

The web app runs on `http://localhost:5173` and the API on `http://localhost:4000`.

The first slice uses an in-memory local adapter, so Docker, PostgreSQL, and external credentials are not required. The repository boundaries are ready for the planned PostgreSQL/PGlite persistence adapter. Restarting the API resets the local demo snapshot.

Useful checks:

```bash
npm run typecheck
npm test
npm run build
```

## API quick reference

All routes are prefixed with `/api/v1`.

| Route | Purpose |
| --- | --- |
| `GET /projects` | List project snapshots |
| `GET /projects/:id/graph` | Bounded system or ontology graph |
| `GET /projects/:id/ontology` | Current ontology version |
| `GET /projects/:id/runs` | Ingestion history |
| `POST /projects/:id/ingestion-runs` | Ingest supplied artifacts or rerun the fixture |
| `GET /projects/:id/entities/:id` | Entity plus evidence |
| `GET /projects/:id/relationships/:id` | Relationship plus evidence |
| `GET /projects/:id/search?q=` | Compact entity search |
| `GET/PUT /projects/:id/layout` | Presentation-only canvas state |

Example bounded query:

```bash
curl 'http://localhost:4000/api/v1/projects/commerce/graph?mode=system&focus=Checkout%20Service&depth=2'
```

## Current boundaries

This is the deterministic vertical slice, not yet the complete production platform. LLM semantic induction, proposal review, ontology editing, authentication, runtime traces, contradiction detection, continuous synchronization, and durable PostgreSQL storage are staged next. The first Java/Spring parser is intentionally static and line-anchored; it does not execute source code. See [`docs/roadmap.md`](docs/roadmap.md) and [`docs/architecture.md`](docs/architecture.md).

## Repository map

```text
apps/web                  React + Vite graph workspace
apps/api                  Fastify API and local project store
packages/domain           Fact IR, ontology, graph, and layout contracts
packages/extractor-sdk    Extensible extractor interface
packages/extractors-openapi
                          OpenAPI and system-manifest extractors
packages/extractors-source
                          TypeScript frontend and Java/Spring BFF extractors
apps/api/src/fixtures     Commerce / sourcing and sanitized Offer Sample Management fixtures
docs                      Product, architecture, domain, API, and roadmap notes
```
