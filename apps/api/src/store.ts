import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CanvasLayout,
  type Fact,
  type GraphEntity,
  type GraphMode,
  type GraphPayload,
  type GraphRelationship,
  type IngestionRun,
  type OntologyDocument,
  type EvidenceRef,
  type AssertionOrigin,
  type SourceMetadata,
  initialOntology,
  stableId
} from "@onto/domain";
import type { ArtifactInput } from "@onto/extractor-sdk";
import { extractArtifact } from "@onto/extractors-openapi";
import { sourceExtractors } from "@onto/extractors-source";

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

export interface GraphFilters {
  type?: string;
  relation?: string;
  domain?: string;
  source?: string;
  confidence?: number;
  search?: string;
  depth?: number;
  limit?: number;
  focus?: string;
  repository?: string;
  environment?: string;
  workflow?: string;
  route?: string;
  endpoint?: string;
  downstream?: string;
  origin?: AssertionOrigin;
}

interface ProjectState {
  summary: ProjectSummary;
  ontology: OntologyDocument;
  facts: Map<string, Fact>;
  entities: Map<string, GraphEntity>;
  relationships: Map<string, GraphRelationship>;
  evidence: Map<string, EvidenceRef>;
  layouts: Map<GraphMode, CanvasLayout>;
  runs: IngestionRun[];
}

const fixtureRoot = fileURLToPath(new URL("./fixtures/commerce/", import.meta.url));
const offerFixtureRoot = fileURLToPath(new URL("./fixtures/offer-sample-management/", import.meta.url));
const fixtureFiles = ["orders.openapi.yaml", "checkout.openapi.yaml", "payments.openapi.yaml", "suppliers.openapi.yaml", "sap.openapi.yaml"];
const offerFixtureFiles: Array<{ file: string; kind: ArtifactInput["kind"]; repository: string; path: string; environment?: string }> = [
  { file: "system.yaml", kind: "system-manifest", repository: "onto-ui", path: "apps/api/src/fixtures/offer-sample-management/system.yaml" },
  { file: "bff.openapi.yaml", kind: "openapi", repository: "gst-supplier-response-bff", path: "api-spec.yaml" },
  { file: "frontend.routes.tsx", kind: "typescript-source", repository: "enterprise-offer-ui", path: "apps/offer-sample-management/src/app/routes.tsx" },
  { file: "frontend.offers-api.ts", kind: "typescript-source", repository: "enterprise-offer-ui", path: "apps/offer-sample-management/src/services/sample-management-api/offers-api.ts" },
  { file: "frontend.samples-api.ts", kind: "typescript-source", repository: "enterprise-offer-ui", path: "apps/offer-sample-management/src/services/sample-management-api/samples-api.ts" },
  { file: "frontend.sample-requests-api.ts", kind: "typescript-source", repository: "enterprise-offer-ui", path: "apps/offer-sample-management/src/services/sample-management-api/supplier-api.ts" },
  { file: "frontend.runtime.ts", kind: "frontend-config", repository: "enterprise-offer-ui", path: "apps/offer-sample-management/src/app/bootstrap/runtime/config.ts" },
  { file: "frontend.module-federation.js", kind: "frontend-config", repository: "enterprise-offer-ui", path: "apps/offer-sample-management/module-federation.config.js" },
  { file: "frontend.e2e.test.ts", kind: "test-evidence", repository: "enterprise-offer-ui", path: "apps/offer-sample-management-e2e/src/sample-request.spec.ts", environment: "stage" },
  { file: "OffersController.java", kind: "java-source", repository: "gst-supplier-response-bff", path: "primary-port-adapters/src/main/java/controllers/impl/OffersApiControllerImpl.java" },
  { file: "SamplesController.java", kind: "java-source", repository: "gst-supplier-response-bff", path: "primary-port-adapters/src/main/java/controllers/impl/SamplesApiControllerImpl.java" },
  { file: "SampleRequestsController.java", kind: "java-source", repository: "gst-supplier-response-bff", path: "primary-port-adapters/src/main/java/controllers/impl/SampleRequestsApiControllerImpl.java" },
  { file: "OffersServiceImpl.java", kind: "java-source", repository: "gst-supplier-response-bff", path: "application-services/src/main/java/services/impl/OffersServiceImpl.java" },
  { file: "SamplesServiceImpl.java", kind: "java-source", repository: "gst-supplier-response-bff", path: "application-services/src/main/java/services/impl/SamplesServiceImpl.java" },
  { file: "SampleRequestsServiceImpl.java", kind: "java-source", repository: "gst-supplier-response-bff", path: "application-services/src/main/java/services/impl/SampleRequestsServiceImpl.java" },
  { file: "EspQuoteClientImpl.java", kind: "java-source", repository: "gst-supplier-response-bff", path: "secondary-port-adapters/src/main/java/clients/impl/EspQuoteClientImpl.java" },
  { file: "SampleManagementClientImpl.java", kind: "java-source", repository: "gst-supplier-response-bff", path: "secondary-port-adapters/src/main/java/clients/impl/SampleManagementClientImpl.java" },
  { file: "UberClientImpl.java", kind: "java-source", repository: "gst-supplier-response-bff", path: "secondary-port-adapters/src/main/java/clients/impl/UberClientImpl.java" },
  { file: "bff.config.yaml", kind: "bff-config", repository: "gst-supplier-response-bff", path: "ccm/NON-PROD-1.0-ccm.yml" }
];

const fixtureRevision = "fixture-2026-08-24";

const now = () => new Date().toISOString();

const entityId = (type: string, value: string) => `entity_${stableId(type, value)}`;
const relationId = (type: string, source: string, target: string) => `edge_${stableId(type, source, target)}`;

const preferredSource = (current: SourceMetadata | undefined, next: SourceMetadata | undefined): SourceMetadata | undefined => {
  if (!current) return next;
  if (!next) return current;
  if (current.repository === "onto-ui" && next.repository && next.repository !== "onto-ui") return next;
  return current;
};

const humanize = (value: string) => value
  .replace(/[-_]+/g, " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const originFor = (fact: Fact): GraphEntity["origin"] => {
  const kind = fact.evidence[0]?.kind;
  if (kind === "human" || kind === "configuration" || kind === "runtime" || kind === "llm" || kind === "documentation") return kind;
  return "deterministic";
};

export class LocalProjectStore {
  private projects = new Map<string, ProjectState>();

  async initialize(): Promise<void> {
    if (this.projects.size > 0) return;
    const project = this.createProject("commerce", "Commerce & Sourcing World", "A deterministic discovery snapshot of commerce, payments, suppliers, and fulfillment.");
    this.projects.set(project.summary.id, project);
    await this.ingestFixture(project.summary.id);
    const offerProject = this.createProject("offer-sample-management", "Offer Sample Management", "Evidence-backed graph for the scoped offer-sample-management frontend and supplier-response-bff workflows.");
    this.projects.set(offerProject.summary.id, offerProject);
    await this.ingestOfferSampleManagementFixture(offerProject.summary.id);
  }

  private createProject(id: string, name: string, description: string): ProjectState {
    return {
      summary: {
        id,
        name,
        description,
        artifactCount: 0,
        factCount: 0,
        entityCount: 0,
        relationshipCount: 0,
        updatedAt: now()
      },
      ontology: initialOntology(id),
      facts: new Map(),
      entities: new Map(),
      relationships: new Map(),
      evidence: new Map(),
      layouts: new Map(),
      runs: []
    };
  }

  listProjects(): ProjectSummary[] {
    return [...this.projects.values()].map((project) => ({ ...project.summary }));
  }

  getProject(projectId: string): ProjectSummary | undefined {
    return this.projects.get(projectId)?.summary;
  }

  getOntology(projectId: string): OntologyDocument | undefined {
    return this.projects.get(projectId)?.ontology;
  }

  getRuns(projectId: string): IngestionRun[] {
    return this.projects.get(projectId)?.runs ?? [];
  }

  getLayout(projectId: string, mode: GraphMode): CanvasLayout | undefined {
    return this.projects.get(projectId)?.layouts.get(mode);
  }

  saveLayout(projectId: string, layout: CanvasLayout): CanvasLayout {
    const project = this.mustGet(projectId);
    const stored = { ...layout, projectId, updatedAt: now() };
    project.layouts.set(layout.mode, stored);
    return stored;
  }

  async ingestFixture(projectId: string): Promise<IngestionRun> {
    const artifacts: ArtifactInput[] = [];
    for (const path of fixtureFiles) {
      artifacts.push({
        id: `artifact_${path}`,
        projectId,
        kind: "openapi",
        path: `services/${path}`,
        content: await readFile(join(fixtureRoot, path), "utf8"),
        revision: "demo-revision-2026-08-22"
      });
    }
    artifacts.push({
      id: "artifact_system_manifest",
      projectId,
      kind: "system-manifest",
      path: "architecture/system.yaml",
      content: await readFile(join(fixtureRoot, "system.yaml"), "utf8"),
      revision: "demo-revision-2026-08-22"
    });
    return this.ingest(projectId, artifacts);
  }

  async ingestOfferSampleManagementFixture(projectId: string): Promise<IngestionRun> {
    const artifacts: ArtifactInput[] = [];
    for (const fixture of offerFixtureFiles) {
      artifacts.push({
        id: `artifact_offer_sample_management_${fixture.file}`,
        projectId,
        kind: fixture.kind,
        path: fixture.path,
        content: await readFile(join(offerFixtureRoot, fixture.file), "utf8"),
        revision: fixtureRevision,
        source: { repository: fixture.repository, revision: fixtureRevision, environment: fixture.environment, path: fixture.path }
      });
    }
    return this.ingest(projectId, artifacts);
  }

  async ingest(projectId: string, artifacts: ArtifactInput[]): Promise<IngestionRun> {
    const project = this.mustGet(projectId);
    const run: IngestionRun = { id: `run_${Date.now()}`, projectId, status: "running", artifactCount: artifacts.length, factCount: 0, startedAt: now() };
    project.runs.unshift(run);
    try {
      const allFacts: Fact[] = [];
      for (const artifact of artifacts) {
        if (artifact.projectId !== projectId) throw new Error(`Artifact ${artifact.path} belongs to project ${artifact.projectId}`);
        const sourceExtractor = sourceExtractors.find((candidate) => candidate.supports(artifact));
        const facts = sourceExtractor
          ? await sourceExtractor.extract(artifact, { projectId, artifact, now: now() })
          : await extractArtifact(artifact, projectId, now());
        allFacts.push(...facts);
      }
      const stagedFacts = new Map<string, Fact>();
      for (const fact of allFacts) {
        const current = stagedFacts.get(fact.id) ?? [...stagedFacts.values()].find((item) => item.fingerprint === fact.fingerprint) ?? project.facts.get(fact.id) ?? [...project.facts.values()].find((item) => item.fingerprint === fact.fingerprint);
        const merged = current ? this.mergeFacts(current, fact) : fact;
        stagedFacts.set(merged.id, merged);
      }
      for (const fact of stagedFacts.values()) {
        project.facts.set(fact.id, fact);
        for (const evidence of fact.evidence) project.evidence.set(evidence.id, evidence);
      }
      this.projectFacts(project);
      run.status = "completed";
      run.factCount = stagedFacts.size;
      run.completedAt = now();
      project.summary.artifactCount = artifacts.length;
      project.summary.factCount = project.facts.size;
      project.summary.entityCount = project.entities.size;
      project.summary.relationshipCount = project.relationships.size;
      project.summary.updatedAt = now();
      return run;
    } catch (error) {
      run.status = "failed";
      run.error = error instanceof Error ? error.message : "Ingestion failed";
      run.completedAt = now();
      return run;
    }
  }

  private mergeFacts(current: Fact, next: Fact): Fact {
    const evidence = new Map<string, EvidenceRef>(current.evidence.map((item: EvidenceRef) => [item.id, item]));
    for (const item of next.evidence) evidence.set(item.id, item);
    return {
      ...current,
      ...next,
      evidence: [...evidence.values()],
      metadata: { ...current.metadata, ...next.metadata },
      confidence: Math.max(current.confidence, next.confidence),
      source: next.source ?? current.source,
      repositoryRevision: next.repositoryRevision ?? current.repositoryRevision
    };
  }

  private projectFacts(project: ProjectState): void {
    project.entities.clear();
    project.relationships.clear();
    const facts = [...project.facts.values()];
    const addEntity = (type: string, value: string, fact: Fact, overrides: Partial<GraphEntity> = {}) => {
      if (!type || type === "Literal") return;
      const id = entityId(type, value);
      const source = fact.source ?? {
        repository: fact.evidence[0]?.repository,
        revision: fact.evidence[0]?.revision,
        environment: fact.evidence[0]?.environment,
        path: fact.evidence[0]?.location?.file
      };
      const current = project.entities.get(id);
      const next: GraphEntity = {
        id,
        projectId: project.summary.id,
        type,
        name: fact.subject.value === value ? (fact.subject.label ?? humanize(value)) : (fact.object.label ?? humanize(value)),
        description: undefined,
        domain: undefined,
        owner: undefined,
        properties: { ...fact.metadata },
        confidence: fact.confidence,
        origin: originFor(fact),
        evidenceIds: [],
        source
      };
      const merged = current ? {
        ...current,
        ...overrides,
        name: overrides.name ?? current.name,
        description: overrides.description ?? current.description,
        domain: overrides.domain ?? current.domain,
        owner: overrides.owner ?? current.owner,
        properties: { ...current.properties, ...fact.metadata, ...(overrides.properties ?? {}) },
        confidence: Math.max(current.confidence, fact.confidence),
        evidenceIds: [...new Set([...current.evidenceIds, ...fact.evidence.map((item: EvidenceRef) => item.id)])],
        source: preferredSource(current.source, source)
      } : {
        ...next,
        ...overrides,
        evidenceIds: [...new Set(fact.evidence.map((item: EvidenceRef) => item.id))]
      };
      project.entities.set(id, merged);
    };
    for (const fact of facts) {
      addEntity(fact.subject.typeHint ?? "", fact.subject.value, fact, { name: fact.subject.label ?? humanize(fact.subject.value) });
      addEntity(fact.object.typeHint ?? "", fact.object.value, fact, { name: fact.object.label ?? humanize(fact.object.value) });
      const subjectId = entityId(fact.subject.typeHint ?? "", fact.subject.value);
      const current = project.entities.get(subjectId);
      if (current) project.entities.set(subjectId, {
        ...current,
        owner: fact.metadata.owner ? String(fact.metadata.owner) : current.owner,
        domain: fact.metadata.domain ? String(fact.metadata.domain) : current.domain,
        description: fact.metadata.description ? String(fact.metadata.description) : current.description,
        properties: { ...current.properties, ...fact.metadata }
      });
    }

    const addRelationship = (type: string, sourceType: string, sourceValue: string, targetType: string, targetValue: string, fact: Fact) => {
      const source = entityId(sourceType, sourceValue);
      const target = entityId(targetType, targetValue);
      if (!project.entities.has(source) || !project.entities.has(target)) return;
      const id = relationId(type, source, target);
      const current = project.relationships.get(id);
      project.relationships.set(id, {
        id,
        projectId: project.summary.id,
        type,
        source,
        target,
        confidence: Math.max(current?.confidence ?? 0, fact.confidence),
        origin: originFor(fact),
        evidenceIds: [...new Set([...(current?.evidenceIds ?? []), ...fact.evidence.map((item: EvidenceRef) => item.id)])],
        supportFactIds: [...new Set([...(current?.supportFactIds ?? []), fact.id])],
        description: typeof fact.metadata.description === "string" ? fact.metadata.description : current?.description,
        provenance: current?.provenance ?? fact.source
      });
    };

    for (const fact of facts) {
      if (fact.predicate === "EXPOSED_BY") addRelationship("EXPOSES", fact.object.typeHint ?? "Service", fact.object.value, fact.subject.typeHint ?? "APIEndpoint", fact.subject.value, fact);
      else if (fact.predicate === "ACCEPTS_SCHEMA") addRelationship("ACCEPTS", fact.subject.typeHint ?? "APIEndpoint", fact.subject.value, "Schema", fact.object.value, fact);
      else if (fact.predicate === "RETURNS_SCHEMA") addRelationship("RETURNS", fact.subject.typeHint ?? "APIEndpoint", fact.subject.value, "Schema", fact.object.value, fact);
      else if (["EXPOSES", "ROUTES_TO", "PART_OF", "CALLS", "HANDLED_BY", "RESOLVES_TO", "TRANSFORMS", "ENRICHES", "READS_FROM", "WRITES_TO", "PUBLISHES", "CONSUMES", "OPERATES_ON", "USES_CONFIGURATION", "AUTHORIZES", "DEPLOYED_AS", "IMPLEMENTED_BY"].includes(fact.predicate)) {
        addRelationship(fact.predicate, fact.subject.typeHint ?? "Service", fact.subject.value, fact.object.typeHint ?? "Service", fact.object.value, fact);
      }
    }

    for (const entity of project.entities.values()) {
      if (!entity.domain || entity.type === "Domain") continue;
      const domainId = entityId("Domain", entity.domain);
      if (!project.entities.has(domainId)) {
        project.entities.set(domainId, { id: domainId, projectId: project.summary.id, type: "Domain", name: entity.domain, description: `${entity.domain} domain`, domain: entity.domain, properties: {}, confidence: 0.92, origin: "configuration", evidenceIds: [], source: entity.source });
      }
      const edge = relationId("CONTAINS", domainId, entity.id);
      project.relationships.set(edge, { id: edge, projectId: project.summary.id, type: "CONTAINS", source: domainId, target: entity.id, confidence: entity.confidence, origin: entity.origin, evidenceIds: entity.evidenceIds, supportFactIds: [], provenance: entity.source });
    }
  }

  getGraph(projectId: string, mode: GraphMode, filters: GraphFilters = {}): GraphPayload {
    const project = this.mustGet(projectId);
    if (mode === "ontology") return this.getOntologyGraph(project);
    let entities = [...project.entities.values()];
    let relationships = [...project.relationships.values()];
    const contains = (value: unknown, needle: string | undefined) => needle ? String(value ?? "").toLowerCase().includes(needle.toLowerCase()) : true;
    const propertyText = (entity: GraphEntity) => Object.entries(entity.properties).map(([key, value]) => `${key}:${String(value)}`).join(" ");
    const sourceText = (entity: GraphEntity) => `${entity.source?.repository ?? ""} ${entity.source?.revision ?? ""} ${entity.source?.environment ?? ""} ${entity.source?.path ?? ""}`;
    if (filters.type) entities = entities.filter((entity) => entity.type.toLowerCase() === filters.type?.toLowerCase());
    if (filters.domain) entities = entities.filter((entity) => entity.domain?.toLowerCase() === filters.domain?.toLowerCase());
    if (filters.source) {
      const source = filters.source.toLowerCase();
      const matchingIds = new Set(entities.filter((entity) => `${entity.name} ${entity.type} ${propertyText(entity)} ${sourceText(entity)}`.toLowerCase().includes(source)).map((entity) => entity.id));
      entities = entities.filter((entity) => matchingIds.has(entity.id));
    }
    if (filters.search) {
      const search = filters.search.toLowerCase();
      entities = entities.filter((entity) => `${entity.name} ${entity.type} ${entity.domain ?? ""} ${entity.owner ?? ""} ${propertyText(entity)} ${sourceText(entity)}`.toLowerCase().includes(search));
    }
    if (filters.repository) entities = entities.filter((entity) => contains(`${sourceText(entity)} ${propertyText(entity)}`, filters.repository));
    if (filters.environment) entities = entities.filter((entity) => contains(`${entity.source?.environment ?? ""} ${propertyText(entity)}`, filters.environment));
    if (filters.route) entities = entities.filter((entity) => contains(`${entity.name} ${propertyText(entity)}`, filters.route));
    if (filters.endpoint) entities = entities.filter((entity) => contains(`${entity.name} ${propertyText(entity)}`, filters.endpoint));
    if (filters.downstream) entities = entities.filter((entity) => contains(`${entity.name} ${propertyText(entity)}`, filters.downstream));
    if (filters.origin) entities = entities.filter((entity) => entity.origin === filters.origin);
    if (filters.confidence !== undefined) entities = entities.filter((entity) => entity.confidence >= filters.confidence!);

    if (filters.workflow) {
      const workflowNeedle = filters.workflow.toLowerCase();
      const workflowIds = new Set(entities.filter((entity) => entity.type === "Workflow" && `${entity.name} ${propertyText(entity)}`.toLowerCase().includes(workflowNeedle)).map((entity) => entity.id));
      const relatedIds = new Set([...workflowIds, ...entities.filter((entity) => propertyText(entity).toLowerCase().includes(workflowNeedle)).map((entity) => entity.id)]);
      const workflowRelations = new Set(["ROUTES_TO", "PART_OF", "CALLS", "HANDLED_BY", "IMPLEMENTED_BY", "RESOLVES_TO", "TRANSFORMS", "ENRICHES", "AUTHORIZES"]);
      for (let level = 0; level < 2; level += 1) {
        for (const edge of project.relationships.values()) {
          if (!workflowRelations.has(edge.type)) continue;
          if (relatedIds.has(edge.source)) relatedIds.add(edge.target);
          if (relatedIds.has(edge.target)) relatedIds.add(edge.source);
        }
      }
      entities = entities.filter((entity) => relatedIds.has(entity.id));
    }
    const allowed = new Set(entities.map((entity) => entity.id));
    relationships = relationships.filter((edge) => allowed.has(edge.source) && allowed.has(edge.target));
    if (filters.relation) relationships = relationships.filter((edge) => edge.type.toLowerCase() === filters.relation?.toLowerCase());
    if (filters.origin) relationships = relationships.filter((edge) => edge.origin === filters.origin);

    if (filters.focus) {
      const focus = this.resolveEntity(project, filters.focus);
      if (focus) {
        const depth = Math.min(filters.depth ?? 1, 3);
        const neighborhood = new Set([focus.id]);
        for (let level = 0; level < depth; level += 1) {
          for (const edge of project.relationships.values()) {
            if (neighborhood.has(edge.source)) neighborhood.add(edge.target);
            if (neighborhood.has(edge.target)) neighborhood.add(edge.source);
          }
        }
        entities = entities.filter((entity) => neighborhood.has(entity.id));
        const focused = new Set(entities.map((entity) => entity.id));
        relationships = relationships.filter((edge) => focused.has(edge.source) && focused.has(edge.target));
      }
    }
    const totalEntities = entities.length;
    const totalRelationships = relationships.length;
    const limit = Math.min(filters.limit ?? 250, 250);
    const truncated = entities.length > limit;
    entities = entities.slice(0, limit);
    const visible = new Set(entities.map((entity) => entity.id));
    relationships = relationships.filter((edge) => visible.has(edge.source) && visible.has(edge.target));
    return { mode, entities, relationships, totalEntities, totalRelationships, focus: filters.focus, truncated, generatedAt: now() };
  }

  private getOntologyGraph(project: ProjectState): GraphPayload {
    const entities: GraphEntity[] = project.ontology.entityTypes.map((type: { id: string; name: string; description: string; aliases: string[] }) => ({ id: `ontology_${type.id}`, projectId: project.summary.id, type: "OntologyType", name: type.name, description: type.description, properties: { definition: type.id, aliases: type.aliases }, confidence: 1, origin: "human", evidenceIds: [] }));
    const byType = new Map<string, string>();
    for (const type of project.ontology.entityTypes) {
      const entity = entities.find((item) => item.id === `ontology_${type.id}`);
      if (!entity) continue;
      byType.set(type.id, entity.id);
      byType.set(type.name, entity.id);
      for (const alias of type.aliases) byType.set(alias, entity.id);
    }
    const relationships: GraphRelationship[] = [];
    for (const relation of project.ontology.relations) {
      for (const from of relation.from) {
        for (const to of relation.to) {
          const source = byType.get(from);
          const target = byType.get(to);
          if (!source || !target) continue;
          relationships.push({ id: `ontology_edge_${stableId(relation.id, from, to)}`, projectId: project.summary.id, type: relation.id, source, target, confidence: 1, origin: "human", evidenceIds: [], supportFactIds: [] });
        }
      }
    }
    return { mode: "ontology", entities, relationships, totalEntities: entities.length, totalRelationships: relationships.length, truncated: false, generatedAt: now() };
  }

  getEntity(projectId: string, idOrName: string): GraphEntity | undefined {
    const project = this.mustGet(projectId);
    return project.entities.get(idOrName) ?? [...project.entities.values()].find((entity) => entity.name.toLowerCase() === idOrName.toLowerCase() || entity.id.toLowerCase() === idOrName.toLowerCase());
  }

  getRelationship(projectId: string, id: string): GraphRelationship | undefined {
    return this.mustGet(projectId).relationships.get(id);
  }

  getEvidence(projectId: string, id: string): EvidenceRef[] {
    const project = this.mustGet(projectId);
    const relationship = project.relationships.get(id);
    if (relationship) return relationship.evidenceIds.map((evidenceId: string) => project.evidence.get(evidenceId)).filter(Boolean) as EvidenceRef[];
    const entity = project.entities.get(id);
    return entity?.evidenceIds.map((evidenceId: string) => project.evidence.get(evidenceId)).filter(Boolean) as EvidenceRef[] ?? [];
  }

  search(projectId: string, query: string): GraphEntity[] {
    const project = this.mustGet(projectId);
    const needle = query.toLowerCase();
    return [...project.entities.values()].filter((entity) => `${entity.name} ${entity.type} ${entity.domain ?? ""} ${entity.owner ?? ""} ${Object.values(entity.properties).join(" ")} ${entity.source?.repository ?? ""} ${entity.source?.path ?? ""}`.toLowerCase().includes(needle)).slice(0, 20);
  }

  private resolveEntity(project: ProjectState, value: string): GraphEntity | undefined {
    return project.entities.get(value) ?? [...project.entities.values()].find((entity) => entity.name.toLowerCase() === value.toLowerCase() || entity.id.toLowerCase() === value.toLowerCase());
  }

  private mustGet(projectId: string): ProjectState {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    return project;
  }
}

export const store = new LocalProjectStore();
