# Onto integration handoff: Offer Sample Management

## Mission

Make `onto-ui` useful for the `offer-sample-management` vertical slice without attempting to model the entire `enterprise-offer-ui` repository at first.

The desired result is an evidence-backed graph that connects:

```text
offer-sample-management screen/workflow
  -> frontend API call
  -> supplier-response-bff endpoint
  -> BFF application service
  -> downstream client/operation
  -> downstream service, data store, event, or external platform
```

The graph must preserve the source repository, revision, file, line, environment, and confidence for every discovered assertion.

## Repositories in scope

### Frontend

Local repository:

```text
/Users/m0b0f2w/dev/enterprise-offer-ui
```

Only inspect and model:

```text
apps/offer-sample-management
```

This is a React 18 + TypeScript Nx/Webpack Module Federation remote named
`offer_sample_management`. It uses Living Design components, React Router, AG Grid,
and typed Axios service modules.

Important frontend locations:

- `apps/offer-sample-management/project.json`
  - Nx targets and build configuration.
- `apps/offer-sample-management/module-federation.config.js`
  - remote name and exposed `./Module` entry.
- `apps/offer-sample-management/src/main.tsx`
  - standalone entry.
- `apps/offer-sample-management/src/bootstrap.tsx`
  - bootstrap boundary.
- `apps/offer-sample-management/src/remote-entry.ts`
  - Module Federation entry.
- `apps/offer-sample-management/src/app/app.tsx`
  - application composition.
- `apps/offer-sample-management/src/app/routes.tsx`
  - route and workflow inventory.
- `apps/offer-sample-management/src/services/sample-management-api/`
  - primary BFF client modules.
- `apps/offer-sample-management/src/services/offer-sample-api.ts`
  - additional same-origin product/DDL calls.
- `apps/offer-sample-management/src/components/models/`
  - frontend DTOs and domain types.
- `apps/offer-sample-management/src/app/bootstrap/runtime/`
  - runtime environment and Axios initialization.
- `apps/offer-sample-management/kitt.yml`
  - deployment/environment metadata.
- `apps/offer-sample-management-e2e/`
  - dedicated Playwright project.

The canonical frontend routes include:

- `/products`
- `/products/my-offers`
- `/products/:productId`
- `/products/:productId/offers`
- `/products/:productId/offers/new`
- `/products/:productId/offers/:offerId`
- `/products/:productId/samples`
- `/products/:productId/samples/new`
- `/products/:productId/sample-requests/:requestId`
- `/products/:productId/sample-responses`
- `/products/:productId/sample-responses/:sampleId`

The frontend BFF base URL behavior is environment-dependent:

- Development uses a direct `gst-supplier-response-bff-dev.walmart.com` URL.
- Stage/production use same-origin `/api/sample-management/v1/supplier-response-bff/...`
  routing through the host shell.
- Webpack dev proxy and runtime environment configuration define the routing behavior.

Several frontend DTO files refer to a generated `models/swagger.json`, but that
Swagger file was not present in the repository. The typed DTOs, service functions,
tests, route definitions, and runtime configuration are therefore important
contract evidence.

Primary frontend service modules:

- `offers-api.ts`
  - offer CRUD, submit, clone, costs, assets, factories, agreements, supplier
    offers, and logistics metadata.
- `samples-api.ts`
  - sample search, draft/save, rounds, statuses, decisions, and comments.
- `supplier-api.ts`
  - supplier/product data, sample requests, hierarchy, brands, colors, sizes,
    projects, and submission-related operations.
- `bom-api.ts`
  - offer BOM data and dropdowns.
- `assets-api.ts`
  - asset upload, download, metadata, and deletion.
- `sample-management-api.ts`
  - legacy and broader sample-management operations.

### Backend

Local repository:

```text
/Users/m0b0f2w/dev/gst-supplier-response-bff
```

This is a Java 25, Spring Boot 4.0.7, Maven multi-module BFF with a hexagonal
structure. The tracked README may contain older Spring Boot version information;
prefer current build files and source.

Important backend locations:

- `api-spec.yaml`
  - frontend-facing OpenAPI contract.
- `primary-port-adapters/src/main/java/.../controllers/impl/`
  - controller implementations.
- `application-services/src/main/java/.../services/impl/`
  - orchestration and business workflows.
- `secondary-port-adapters/src/main/java/.../clients/impl/`
  - downstream HTTP clients.
- `domain/src/main/java/.../model/mapper/`
  - MapStruct/manual mapping boundaries.
- `ccm/NON-PROD-1.0-ccm.yml`
  - non-production downstream configuration.
- `boot-app/src/main/java/.../boot/Startup.java`
  - application entry point.
- `secondary-port-adapters/.../VaultConfig.java`
  - secret/config loading boundary.
- `systems-tests/`
  - integration, functional, and end-to-end evidence.

Frontend-facing route prefixes:

- Legacy/direct: `/v1/supplier-response-bff/...`
- Gateway/host-shell: `/api/sample-management/v1/supplier-response-bff/...`

Relevant BFF workflows:

#### Offer create, update, and submit

```text
OffersApiControllerImpl
  -> OffersServiceImpl
  -> EspQuoteClientImpl
  -> ESP-QUOTE-ESP-QUOTE
```

The BFF maps frontend offer DTOs to ESP Quote DTOs, injects/validates supplier
identity, applies defaults, checks ownership, and maps the response back.
Submission stamps `submittedDate` and persists through ESP Quote.

#### Offer listing and enrichment

```text
frontend offer list
  -> supplier-response-bff
  -> Uber search/index
  -> parallel ESP Quote reads
  -> enriched offer list
```

Offer deletion and cloning can also involve ESP Quote, Uber/BOM, and asset
operations.

#### Sample CRUD and submission

```text
SamplesApiControllerImpl
  -> SamplesServiceImpl
  -> SampleManagementClientImpl
  -> GST-SOURCING-SOURCING-SAMPLE-MANAGEMENT
```

The BFF maps `SampleDTO` to the Sample Management service model. Sample creation
and submission include status translation and ownership checks. The current
submission behavior should be extracted from source rather than inferred from
endpoint names.

#### Sample request detail and enrichment

```text
SampleRequestsApiControllerImpl
  -> SampleRequestsServiceImpl
  -> Sample Management service
  -> Uber product/measurement APIs
  -> SupplierSampleResponseDTO
```

This is a high-value example of BFF aggregation: one frontend-facing operation
combines ownership-scoped sample data with product or measurement enrichment.

#### Supporting downstream services

Model these as downstream dependencies when they are reached by an in-scope
offer/sample workflow:

- `GST-SOURCING-SOURCING-SAMPLE-MANAGEMENT`
  - samples, requests, assets, tags, and tech packs.
- `ESP-QUOTE-ESP-QUOTE`
  - offer persistence, attachments, and offer metadata.
- `ESP-PLUM-UBER-API`
  - offer search/index, product data, BOM, colors, and measurements.
- GST Cost Service.
- Supplier Profile and Supplier Hub Application API.
- SC Facility Service.
- GST Reference Data.
- MSO Buyplan.
- Spine hierarchy.
- ESP CCB where used by the offer workflow.

Do not treat every configured downstream as a dependency of every workflow.
Relationships must be tied to evidence from the specific controller, service,
client, test, or configuration path.

## Current Onto baseline

Relevant existing code:

- `packages/domain/src/index.ts`
  - Zod-validated Fact IR, ontology, graph, evidence, and layout contracts.
- `packages/extractor-sdk/src/index.ts`
  - extractor/plugin boundary.
- `packages/extractors-openapi/src/index.ts`
  - deterministic OpenAPI and system-manifest extraction.
- `apps/api/src/store.ts`
  - ingestion, fact projection, bounded graph queries, evidence lookup, and
    in-memory project state.
- `apps/api/src/server.ts`
  - REST ingestion, graph, entity, relationship, search, ontology, and layout
    endpoints.
- `apps/web/src/App.tsx`
  - React Flow explorer, system/ontology modes, filters, inspector, and layout
    saving.

Current limitations:

- Only OpenAPI and system-manifest artifacts are supported by the extractor.
- The ingestion API accepts artifact contents, not repository paths.
- The store is in memory and resets on API restart.
- There is no repository revision synchronization.
- Source-code extraction, runtime evidence, authentication, and durable storage
  are planned but not implemented.
- The Onto web app currently uses custom CSS; new UI work should use Living Design
  components consistently with the source application.

## Target graph model

The first useful graph should support these conceptual layers:

```text
Workflow/Screen
  -> Frontend API Call
  -> BFF Endpoint
  -> BFF Application Service
  -> Downstream Operation
  -> Downstream Service
```

Attach schemas and business concepts to the edges or nodes:

```text
Frontend DTO
  -> BFF request/response DTO
  -> downstream DTO
```

Recommended entity concepts:

- `FrontendApplication`
- `FrontendRoute`
- `Workflow`
- `FrontendApiCall`
- `Service`
- `BffEndpoint`
- `ApplicationService`
- `DownstreamOperation`
- `Schema`
- `Offer`
- `Sample`
- `SampleRequest`
- `Domain`
- `Configuration`
- `AuthPolicy`

Recommended relationship concepts:

- `EXPOSES`
- `ROUTES_TO`
- `CALLS`
- `ENRICHES`
- `TRANSFORMS`
- `ACCEPTS`
- `RETURNS`
- `READS_FROM`
- `WRITES_TO`
- `AUTHORIZES`
- `USES_CONFIGURATION`
- `DEPLOYED_AS`

Reuse existing relationship names where they already fit. Add new ontology
types/relationships only when the distinction is needed for useful traversal.

Every generated entity and relationship should carry:

- project ID
- stable ID
- source repository
- source revision/commit
- source artifact path
- source file and line/column when available
- extractor name/version
- environment, if environment-specific
- confidence
- evidence IDs
- deterministic or configured origin

Stable IDs must include enough context to avoid collisions between similarly
named endpoints or services in different repositories.

## Implementation work packages

### 1. Add repository-aware artifacts

Extend the artifact model without breaking existing OpenAPI/system-manifest
ingestion.

Candidate artifact kinds:

- `typescript-source`
- `frontend-config`
- `java-source`
- `bff-config`
- `test-evidence`
- `openapi`
- `system-manifest`

Add source metadata for repository, revision, environment, and relative path.
The extractor must receive source as data and must never execute repository
code.

For the first local workflow, support a directory or file inventory generated
from the two local repositories. A future adapter may read internal GitHub
directly, but the graph format should not depend on a specific Git provider.

### 2. Implement the frontend extractor

Create a deterministic extractor for the scoped app:

```text
enterprise-offer-ui/apps/offer-sample-management
```

It should discover, with evidence:

- route paths and route-to-component relationships
- offer/sample/sample-request workflows
- API service module and function names
- HTTP method and path templates
- BFF base URL and proxy path behavior
- request/response DTO references
- Module Federation remote metadata
- environment-specific routing
- relevant tests that assert endpoint paths

Start with the typed service modules and route definitions. Use a TypeScript AST
approach where practical; do not rely only on broad regular expressions for
endpoint extraction. If a fallback parser is required, emit lower confidence
and explicit evidence.

The extractor should emit facts only. It must not mutate graph or ontology state.

### 3. Implement the Java/Spring BFF extractor

Create a deterministic extractor for:

```text
gst-supplier-response-bff
```

It should discover, with evidence:

- OpenAPI operations and route prefixes
- controller implementation to operation relationships
- controller to application-service calls
- application-service to downstream-client calls
- downstream client to configured service identity
- DTO and mapper relationships
- ownership/auth-policy checks
- status and field transformations
- CCM/Tunr configuration keys and environment mappings
- client timeouts/retry or partial-failure behavior when statically visible
- relevant unit/integration/E2E test evidence

Use `api-spec.yaml` as the initial contract source, then enrich it with source
relationships. The extractor must distinguish a declared API contract from a
source-observed client call.

### 4. Add a scoped offer/sample system manifest

Add a safe fixture or checked-in manifest for the in-scope graph. Do not copy
secrets, vault values, tokens, private keys, or full repository source into the
fixture.

The manifest should declare:

- frontend application and owner/domain
- BFF service and owner/domain
- primary downstream service identities
- known environment routing
- known cross-service relationships that cannot be derived confidently
  statically
- artifact repository and revision references

Keep explicit configuration relationships separate from deterministic source
observations. Onto should be able to show both when they disagree.

### 5. Add workflow-focused graph queries and UI

Support focus/search/filter dimensions for:

- repository
- environment
- workflow
- frontend route
- BFF endpoint
- downstream service
- evidence origin
- confidence

Useful initial focus examples:

- sample request detail
- sample creation/submission
- offer listing
- offer creation/update/submission
- offer cloning

The existing bounded graph behavior should remain. Do not return an unbounded
enterprise graph to the browser by default.

If the Onto UI is extended, use Living Design components and preserve the current
system/ontology distinction. Add a workflow/dependency view only where it makes
the graph easier to inspect.

### 6. Add persistence and synchronization after the first graph works

Move beyond the current in-memory store by adding:

- PostgreSQL/PGlite persistence
- project-level access control
- append-only/versioned facts and evidence
- repository revision records
- incremental extraction and invalidation
- graph diffs between revisions

This is required for ongoing usefulness but should not block proving the first
OSM/BFF graph with deterministic fixtures.

## Security requirements

- Never execute source code, build scripts, or repository hooks during ingestion.
- Never retain Vault files, private keys, access tokens, or raw CCM secrets.
- Redact secret-looking values before storing/displaying evidence.
- Store service/configuration identifiers separately from secret values.
- Preserve project boundaries on every fact, entity, relationship, and evidence
  record.
- Treat internal repository URLs and source contents as access-controlled data.
- Do not infer that a configured endpoint is reachable or authorized without
  evidence.

## Testing requirements

Add tests for:

- stable IDs across repeated extraction
- duplicate fact merging
- exact file/line evidence
- route and endpoint extraction
- frontend environment URL extraction
- BFF controller/service/client call extraction
- downstream service alias resolution
- DTO mapping/transformation facts
- auth-policy relationships
- ingestion failure isolation
- graph focus and bounded limits
- no secret values appearing in stored evidence

Use small committed fixtures rather than requiring network access or live Walmart
services. Existing checks must continue to pass:

```bash
npm run typecheck
npm test
npm run build
```

The root test script currently covers the domain, OpenAPI extractor, and API
packages; add explicit coverage for new extractor packages and web behavior as
appropriate.

## Acceptance criteria for the first useful version

The implementation is ready for review when a local fixture or artifact inventory
can demonstrate all of the following:

1. A sample-request frontend route is connected to its frontend API call.
2. That call is connected to the correct BFF operation.
3. The BFF operation is connected to Sample Management and, where applicable,
   Uber enrichment.
4. An offer workflow shows the ESP Quote and Uber relationships.
5. Selecting any important node or edge shows source file/revision evidence.
6. Development versus stage/production routing is visible as configuration
   evidence.
7. Ownership/auth checks are represented separately from business calls.
8. Re-running extraction produces stable IDs and no duplicate graph objects.
9. A bounded focus query can explore one workflow without loading the full graph.
10. No credentials or secret configuration values are included in artifacts or
    evidence.

## Suggested delivery order

1. Extend shared source/artifact metadata and add fixtures.
2. Ingest the BFF OpenAPI contract and a manually authored system manifest.
3. Add frontend service/route extraction.
4. Add Java/Spring controller-service-client extraction.
5. Add workflow/domain types and relationship projection.
6. Add evidence-aware workflow filters and inspector details.
7. Add deterministic extractor and API tests.
8. Add persistent storage, repository synchronization, and graph diffs.
9. Add runtime traces and contradiction detection later.

Do not start with LLM inference, whole-repository indexing, or live downstream
calls. The first goal is a deterministic, reviewable map of the
offer-sample-management frontend and its supplier-response BFF.
