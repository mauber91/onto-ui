import { z } from "zod";

export const SourceMetadata = z.object({
  repository: z.string().optional(),
  revision: z.string().optional(),
  environment: z.string().optional(),
  path: z.string().optional()
});
export type SourceMetadata = z.infer<typeof SourceMetadata>;

export const EvidenceKind = z.enum([
  "deterministic",
  "documentation",
  "configuration",
  "runtime",
  "llm",
  "human"
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const SourceLocation = z.object({
  file: z.string(),
  line: z.number().int().positive().optional(),
  column: z.number().int().nonnegative().optional(),
  endLine: z.number().int().positive().optional(),
  excerpt: z.string().optional()
});
export type SourceLocation = z.infer<typeof SourceLocation>;

export const EvidenceRef = z.object({
  id: z.string(),
  kind: EvidenceKind,
  label: z.string(),
  artifactId: z.string().optional(),
  repository: z.string().optional(),
  revision: z.string().optional(),
  environment: z.string().optional(),
  location: SourceLocation.optional(),
  uri: z.string().optional(),
  excerpt: z.string().optional()
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

export const FactTerm = z.object({
  kind: z.enum(["entity", "literal"]),
  value: z.string(),
  label: z.string().optional(),
  typeHint: z.string().optional()
});
export type FactTerm = z.infer<typeof FactTerm>;

export const Fact = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: z.string(),
  subject: FactTerm,
  predicate: z.string(),
  object: FactTerm,
  evidence: z.array(EvidenceRef).min(1),
  extractor: z.object({ id: z.string(), version: z.string() }),
  observedAt: z.string(),
  repositoryRevision: z.string().optional(),
  source: SourceMetadata.optional(),
  confidence: z.number().min(0).max(1),
  metadata: z.record(z.unknown()).default({}),
  fingerprint: z.string()
});
export type Fact = z.infer<typeof Fact>;

export const OntologyEntityType = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  extends: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
  properties: z.record(z.unknown()).default({}),
  deprecated: z.boolean().default(false)
});
export type OntologyEntityType = z.infer<typeof OntologyEntityType>;

export const OntologyRelationType = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  from: z.array(z.string()),
  to: z.array(z.string()),
  cardinality: z.enum(["one", "many", "optional"]).optional(),
  transitive: z.boolean().default(false),
  symmetric: z.boolean().default(false),
  aliases: z.array(z.string()).default([]),
  deprecated: z.boolean().default(false)
});
export type OntologyRelationType = z.infer<typeof OntologyRelationType>;

export const OntologyDocument = z.object({
  id: z.string(),
  projectId: z.string(),
  version: z.number().int().positive(),
  status: z.enum(["draft", "published", "archived"]),
  entityTypes: z.array(OntologyEntityType),
  relations: z.array(OntologyRelationType),
  createdAt: z.string(),
  createdBy: z.string(),
  basedOn: z.string().optional()
});
export type OntologyDocument = z.infer<typeof OntologyDocument>;

export const AssertionOrigin = z.enum(["deterministic", "documentation", "configuration", "runtime", "llm", "human"]);
export type AssertionOrigin = z.infer<typeof AssertionOrigin>;

export const GraphEntity = z.object({
  id: z.string(),
  projectId: z.string(),
  type: z.string(),
  name: z.string(),
  description: z.string().optional(),
  domain: z.string().optional(),
  owner: z.string().optional(),
  properties: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1),
  origin: AssertionOrigin,
  evidenceIds: z.array(z.string()).default([]),
  source: SourceMetadata.optional()
});
export type GraphEntity = z.infer<typeof GraphEntity>;

export const GraphRelationship = z.object({
  id: z.string(),
  projectId: z.string(),
  type: z.string(),
  source: z.string(),
  target: z.string(),
  confidence: z.number().min(0).max(1),
  origin: AssertionOrigin,
  evidenceIds: z.array(z.string()).default([]),
  supportFactIds: z.array(z.string()).default([]),
  description: z.string().optional(),
  provenance: SourceMetadata.optional()
});
export type GraphRelationship = z.infer<typeof GraphRelationship>;

export const GraphMode = z.enum(["system", "ontology"]);
export type GraphMode = z.infer<typeof GraphMode>;

export const GraphPayload = z.object({
  mode: GraphMode,
  entities: z.array(GraphEntity),
  relationships: z.array(GraphRelationship),
  totalEntities: z.number().int().nonnegative(),
  totalRelationships: z.number().int().nonnegative(),
  focus: z.string().optional(),
  truncated: z.boolean(),
  generatedAt: z.string()
});
export type GraphPayload = z.infer<typeof GraphPayload>;

export const CanvasLayout = z.object({
  projectId: z.string(),
  mode: GraphMode,
  positions: z.record(z.object({ x: z.number(), y: z.number() })),
  collapsedDomains: z.array(z.string()).default([]),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
  updatedAt: z.string()
});
export type CanvasLayout = z.infer<typeof CanvasLayout>;

export const IngestionRun = z.object({
  id: z.string(),
  projectId: z.string(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  artifactCount: z.number().int().nonnegative(),
  factCount: z.number().int().nonnegative(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  error: z.string().optional()
});
export type IngestionRun = z.infer<typeof IngestionRun>;

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  artifactCount: number;
  factCount: number;
  entityCount: number;
  relationshipCount: number;
  updatedAt: string;
}

export const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unnamed";

export const stableId = (...parts: string[]): string => parts.map(slugify).join("_");

const now = "2026-08-22T00:00:00.000Z";

export const initialOntology = (projectId: string): OntologyDocument => ({
  id: `${projectId}_ontology_1`,
  projectId,
  version: 1,
  status: "published",
  createdAt: now,
  createdBy: "system",
  entityTypes: [
    { id: "Domain", name: "Domain", description: "Business or technical boundary that groups related capabilities.", extends: [], aliases: ["BusinessDomain"], properties: {}, deprecated: false },
    { id: "Service", name: "Service", description: "Independently deployable software service.", extends: [], aliases: ["Microservice", "BackendService"], properties: {}, deprecated: false },
    { id: "FrontendApplication", name: "Frontend application", description: "A browser application, remote, or independently deployed frontend boundary.", extends: [], aliases: ["WebApplication", "Frontend"], properties: {}, deprecated: false },
    { id: "FrontendComponent", name: "Frontend component", description: "A frontend route component or composed UI boundary.", extends: [], aliases: ["ReactComponent"], properties: {}, deprecated: false },
    { id: "FrontendRoute", name: "Frontend route", description: "A navigable frontend route associated with a screen or workflow.", extends: [], aliases: ["Route", "Screen"], properties: {}, deprecated: false },
    { id: "Workflow", name: "Workflow", description: "A user-facing capability that crosses frontend and service boundaries.", extends: [], aliases: ["UserJourney", "UseCase"], properties: {}, deprecated: false },
    { id: "FrontendApiCall", name: "Frontend API call", description: "A statically observed HTTP call made by frontend code.", extends: [], aliases: ["ClientCall"], properties: {}, deprecated: false },
    { id: "APIEndpoint", name: "API endpoint", description: "Network-accessible operation exposed by a service.", extends: [], aliases: ["Endpoint", "RESTEndpoint"], properties: {}, deprecated: false },
    { id: "BffEndpoint", name: "BFF endpoint", description: "A frontend-facing endpoint exposed by a backend-for-frontend.", extends: ["APIEndpoint"], aliases: ["GatewayEndpoint"], properties: {}, deprecated: false },
    { id: "ApplicationService", name: "Application service", description: "An application-layer orchestration service observed behind an endpoint.", extends: [], aliases: ["UseCaseService"], properties: {}, deprecated: false },
    { id: "DownstreamOperation", name: "Downstream operation", description: "A client operation invoked by an application service.", extends: [], aliases: ["ClientOperation"], properties: {}, deprecated: false },
    { id: "Schema", name: "Data schema", description: "Structured contract used by an interface or persisted boundary.", extends: [], aliases: ["DTO", "Model"], properties: {}, deprecated: false },
    { id: "Event", name: "Event", description: "Domain or integration event exchanged asynchronously.", extends: [], aliases: ["Message"], properties: {}, deprecated: false },
    { id: "Database", name: "Database", description: "Persistent data store used by one or more services.", extends: [], aliases: ["DataStore"], properties: {}, deprecated: false },
    { id: "DomainEntity", name: "Domain entity", description: "Business concept represented by the system.", extends: [], aliases: [], properties: {}, deprecated: false },
    { id: "Configuration", name: "Configuration", description: "A non-secret environment or routing configuration declaration.", extends: [], aliases: ["RuntimeConfig"], properties: {}, deprecated: false },
    { id: "AuthPolicy", name: "Authorization policy", description: "An ownership or authorization check observed at a boundary.", extends: [], aliases: ["OwnershipPolicy"], properties: {}, deprecated: false }
  ],
  relations: [
    { id: "CONTAINS", name: "contains", description: "Groups an entity within a domain.", from: ["Domain"], to: ["Service", "FrontendApplication", "Workflow", "APIEndpoint", "BffEndpoint", "ApplicationService", "DownstreamOperation", "Configuration", "AuthPolicy", "DomainEntity", "Database", "Event"], aliases: ["OWNS"], transitive: false, symmetric: false, deprecated: false },
    { id: "EXPOSES", name: "exposes", description: "Makes an API endpoint or frontend route available.", from: ["Service", "FrontendApplication"], to: ["APIEndpoint", "BffEndpoint", "FrontendRoute"], aliases: ["SERVES"], transitive: false, symmetric: false, deprecated: false },
    { id: "ROUTES_TO", name: "routes to", description: "Associates a frontend route with its component or workflow.", from: ["FrontendApplication", "FrontendRoute"], to: ["FrontendComponent", "Workflow"], aliases: ["NAVIGATES_TO"], transitive: false, symmetric: false, deprecated: false },
    { id: "PART_OF", name: "part of", description: "Associates an observed implementation detail with a workflow.", from: ["FrontendRoute", "FrontendApiCall", "BffEndpoint", "ApplicationService", "DownstreamOperation"], to: ["Workflow"], aliases: ["BELONGS_TO"], transitive: false, symmetric: false, deprecated: false },
    { id: "CALLS", name: "calls", description: "Invokes an endpoint, operation, or service.", from: ["Service", "FrontendApplication", "FrontendApiCall", "APIEndpoint", "BffEndpoint", "ApplicationService"], to: ["Service", "APIEndpoint", "BffEndpoint", "DownstreamOperation"], aliases: ["INVOKES", "REQUESTS"], transitive: false, symmetric: false, deprecated: false },
    { id: "HANDLED_BY", name: "handled by", description: "Connects a BFF endpoint to its application service.", from: ["BffEndpoint", "APIEndpoint"], to: ["ApplicationService"], aliases: ["DELEGATES_TO"], transitive: false, symmetric: false, deprecated: false },
    { id: "RESOLVES_TO", name: "resolves to", description: "Connects a downstream operation to the service identity it reaches.", from: ["DownstreamOperation"], to: ["Service"], aliases: ["TARGETS"], transitive: false, symmetric: false, deprecated: false },
    { id: "ACCEPTS", name: "accepts", description: "Accepts a request schema.", from: ["APIEndpoint", "BffEndpoint"], to: ["Schema"], aliases: ["REQUESTS_SCHEMA"], transitive: false, symmetric: false, deprecated: false },
    { id: "RETURNS", name: "returns", description: "Returns a response schema.", from: ["APIEndpoint", "BffEndpoint"], to: ["Schema"], aliases: ["RESPONDS_WITH"], transitive: false, symmetric: false, deprecated: false },
    { id: "TRANSFORMS", name: "transforms", description: "Maps or transforms one schema or DTO into another.", from: ["FrontendApiCall", "BffEndpoint", "ApplicationService", "DownstreamOperation", "Service"], to: ["Schema"], aliases: ["MAPS"], transitive: false, symmetric: false, deprecated: false },
    { id: "ENRICHES", name: "enriches", description: "Adds data from another service or operation to a workflow response.", from: ["ApplicationService", "DownstreamOperation", "Service"], to: ["Service", "DownstreamOperation", "Schema"], aliases: [], transitive: false, symmetric: false, deprecated: false },
    { id: "READS_FROM", name: "reads from", description: "Reads data from a persistent store.", from: ["Service"], to: ["Database"], aliases: [], transitive: false, symmetric: false, deprecated: false },
    { id: "WRITES_TO", name: "writes to", description: "Writes data to a persistent store.", from: ["Service"], to: ["Database"], aliases: [], transitive: false, symmetric: false, deprecated: false },
    { id: "PUBLISHES", name: "publishes", description: "Publishes an event.", from: ["Service"], to: ["Event"], aliases: ["EMITS"], transitive: false, symmetric: false, deprecated: false },
    { id: "CONSUMES", name: "consumes", description: "Consumes an event.", from: ["Service"], to: ["Event"], aliases: ["SUBSCRIBES_TO"], transitive: false, symmetric: false, deprecated: false },
    { id: "OPERATES_ON", name: "operates on", description: "Acts on a business concept.", from: ["Service", "APIEndpoint", "BffEndpoint", "ApplicationService"], to: ["DomainEntity"], aliases: ["DETERMINES"], transitive: false, symmetric: false, deprecated: false },
    { id: "USES_CONFIGURATION", name: "uses configuration", description: "Associates a source-observed component with non-secret configuration.", from: ["FrontendApplication", "FrontendApiCall", "Service", "BffEndpoint"], to: ["Configuration"], aliases: [], transitive: false, symmetric: false, deprecated: false },
    { id: "AUTHORIZES", name: "authorizes", description: "Represents an ownership or authorization policy applied to a boundary.", from: ["AuthPolicy"], to: ["FrontendRoute", "BffEndpoint", "ApplicationService", "Service"], aliases: ["CHECKS_OWNERSHIP"], transitive: false, symmetric: false, deprecated: false },
    { id: "DEPLOYED_AS", name: "deployed as", description: "Associates an application or service with a deployment/configuration identity.", from: ["FrontendApplication", "Service"], to: ["Configuration"], aliases: [], transitive: false, symmetric: false, deprecated: false }
  ]
});

export const FactSchema = Fact;
export const OntologyDocumentSchema = OntologyDocument;
