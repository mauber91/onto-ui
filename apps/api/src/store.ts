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
  initialOntology,
  stableId
} from "@onto/domain";
import type { ArtifactInput } from "@onto/extractor-sdk";
import { extractArtifact } from "@onto/extractors-openapi";

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
const fixtureFiles = ["orders.openapi.yaml", "checkout.openapi.yaml", "payments.openapi.yaml", "suppliers.openapi.yaml", "sap.openapi.yaml"];

const now = () => new Date().toISOString();

const entityId = (type: string, value: string) => `entity_${stableId(type, value)}`;
const relationId = (type: string, source: string, target: string) => `edge_${stableId(type, source, target)}`;

const humanize = (value: string) => value
  .replace(/[-_]+/g, " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const originFor = (fact: Fact): GraphEntity["origin"] => fact.evidence[0]?.kind === "human" ? "human" : fact.evidence[0]?.kind === "configuration" ? "configuration" : "deterministic";

export class LocalProjectStore {
  private projects = new Map<string, ProjectState>();

  async initialize(): Promise<void> {
    if (this.projects.size > 0) return;
    const project = this.createProject("commerce");
    this.projects.set(project.summary.id, project);
    await this.ingestFixture(project.summary.id);
  }

  private createProject(id: string): ProjectState {
    return {
      summary: {
        id,
        name: "Commerce & Sourcing World",
        description: "A deterministic discovery snapshot of commerce, payments, suppliers, and fulfillment.",
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

  async ingest(projectId: string, artifacts: ArtifactInput[]): Promise<IngestionRun> {
    const project = this.mustGet(projectId);
    const run: IngestionRun = { id: `run_${Date.now()}`, projectId, status: "running", artifactCount: artifacts.length, factCount: 0, startedAt: now() };
    project.runs.unshift(run);
    try {
      const allFacts: Fact[] = [];
      for (const artifact of artifacts) {
        const facts = await extractArtifact(artifact, projectId, now());
        allFacts.push(...facts);
        for (const fact of facts) {
          project.facts.set(fact.id, fact);
          for (const evidence of fact.evidence) project.evidence.set(evidence.id, evidence);
        }
      }
      this.projectFacts(project);
      run.status = "completed";
      run.factCount = allFacts.length;
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

  private projectFacts(project: ProjectState): void {
    project.entities.clear();
    project.relationships.clear();
    const facts = [...project.facts.values()];
    const factsByEntity = new Map<string, Fact[]>();
    const addEntity = (type: string, value: string, fact: Fact, overrides: Partial<GraphEntity> = {}) => {
      if (!type || type === "Literal") return;
      const id = entityId(type, value);
      const current = project.entities.get(id);
      const next: GraphEntity = {
        id,
        projectId: project.summary.id,
        type,
        name: fact.subject.value === value ? (fact.subject.label ?? humanize(value)) : (fact.object.label ?? humanize(value)),
        description: undefined,
        domain: undefined,
        owner: undefined,
        properties: {},
        confidence: fact.confidence,
        origin: originFor(fact),
        evidenceIds: []
      };
      const merged = current ? {
        ...current,
        ...overrides,
        name: overrides.name ?? current.name,
        description: overrides.description ?? current.description,
        domain: overrides.domain ?? current.domain,
        owner: overrides.owner ?? current.owner,
        properties: { ...current.properties, ...(overrides.properties ?? {}) },
        confidence: Math.max(current.confidence, fact.confidence),
        evidenceIds: [...new Set([...current.evidenceIds, ...fact.evidence.map((item) => item.id)])]
      } : {
        ...next,
        ...overrides,
        evidenceIds: [...new Set(fact.evidence.map((item) => item.id))]
      };
      project.entities.set(id, merged);
      const list = factsByEntity.get(id) ?? [];
      list.push(fact);
      factsByEntity.set(id, list);
    };
    for (const fact of facts) {
      addEntity(fact.subject.typeHint ?? "", fact.subject.value, fact, { name: fact.subject.label ?? humanize(fact.subject.value) });
      addEntity(fact.object.typeHint ?? "", fact.object.value, fact, { name: fact.object.label ?? humanize(fact.object.value) });
      if (fact.kind === "service_metadata") {
        const id = entityId("Service", fact.subject.value);
        const current = project.entities.get(id);
        if (current) project.entities.set(id, { ...current, owner: String(fact.metadata.owner ?? "Unassigned"), domain: String(fact.metadata.domain ?? "Unmapped"), description: String(fact.metadata.description ?? "") });
      }
      if (fact.kind === "service_declared") {
        const id = entityId("Service", fact.subject.value);
        const current = project.entities.get(id);
        if (current) project.entities.set(id, { ...current, owner: String(fact.metadata.owner ?? current.owner ?? "Unassigned"), domain: String(fact.metadata.domain ?? current.domain ?? "Unmapped") });
      }
      if (fact.kind.endsWith("_declared") && fact.subject.typeHint) {
        const id = entityId(fact.subject.typeHint, fact.subject.value);
        const current = project.entities.get(id);
        if (current && fact.metadata.domain) project.entities.set(id, { ...current, domain: String(fact.metadata.domain) });
      }
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
        evidenceIds: [...new Set([...(current?.evidenceIds ?? []), ...fact.evidence.map((item) => item.id)])],
        supportFactIds: [...new Set([...(current?.supportFactIds ?? []), fact.id])]
      });
    };

    for (const fact of facts) {
      if (fact.predicate === "EXPOSED_BY") addRelationship("EXPOSES", "Service", fact.object.value, "APIEndpoint", fact.subject.value, fact);
      if (fact.predicate === "ACCEPTS_SCHEMA") addRelationship("ACCEPTS", "APIEndpoint", fact.subject.value, "Schema", fact.object.value, fact);
      if (fact.predicate === "RETURNS_SCHEMA") addRelationship("RETURNS", "APIEndpoint", fact.subject.value, "Schema", fact.object.value, fact);
      if (fact.kind === "relationship_observed") addRelationship(fact.predicate, fact.subject.typeHint ?? "Service", fact.subject.value, fact.object.typeHint ?? "Service", fact.object.value, fact);
    }

    for (const entity of project.entities.values()) {
      if (!entity.domain || entity.type === "Domain") continue;
      const domainId = entityId("Domain", entity.domain);
      if (!project.entities.has(domainId)) {
        project.entities.set(domainId, { id: domainId, projectId: project.summary.id, type: "Domain", name: entity.domain, description: `${entity.domain} domain`, domain: entity.domain, properties: {}, confidence: 0.92, origin: "configuration", evidenceIds: [] });
      }
      const edge = relationId("CONTAINS", domainId, entity.id);
      project.relationships.set(edge, { id: edge, projectId: project.summary.id, type: "CONTAINS", source: domainId, target: entity.id, confidence: entity.confidence, origin: entity.origin, evidenceIds: entity.evidenceIds, supportFactIds: [] });
    }
  }

  getGraph(projectId: string, mode: GraphMode, filters: GraphFilters = {}): GraphPayload {
    const project = this.mustGet(projectId);
    if (mode === "ontology") return this.getOntologyGraph(project);
    let entities = [...project.entities.values()];
    let relationships = [...project.relationships.values()];
    if (filters.type) entities = entities.filter((entity) => entity.type.toLowerCase() === filters.type?.toLowerCase());
    if (filters.domain) entities = entities.filter((entity) => entity.domain?.toLowerCase() === filters.domain?.toLowerCase());
    if (filters.source) {
      const source = filters.source.toLowerCase();
      const matchingIds = new Set(entities.filter((entity) => entity.name.toLowerCase().includes(source) || entity.type.toLowerCase().includes(source)).map((entity) => entity.id));
      entities = entities.filter((entity) => matchingIds.has(entity.id));
    }
    if (filters.search) {
      const search = filters.search.toLowerCase();
      entities = entities.filter((entity) => `${entity.name} ${entity.type} ${entity.domain ?? ""} ${entity.owner ?? ""}`.toLowerCase().includes(search));
    }
    if (filters.confidence !== undefined) entities = entities.filter((entity) => entity.confidence >= filters.confidence!);
    const allowed = new Set(entities.map((entity) => entity.id));
    relationships = relationships.filter((edge) => allowed.has(edge.source) && allowed.has(edge.target));
    if (filters.relation) relationships = relationships.filter((edge) => edge.type.toLowerCase() === filters.relation?.toLowerCase());

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
    const entities: GraphEntity[] = project.ontology.entityTypes.map((type) => ({ id: `ontology_${type.id}`, projectId: project.summary.id, type: "OntologyType", name: type.name, description: type.description, properties: { definition: type.id, aliases: type.aliases }, confidence: 1, origin: "human", evidenceIds: [] }));
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
    if (relationship) return relationship.evidenceIds.map((evidenceId) => project.evidence.get(evidenceId)).filter(Boolean) as EvidenceRef[];
    const entity = project.entities.get(id);
    return entity?.evidenceIds.map((evidenceId) => project.evidence.get(evidenceId)).filter(Boolean) as EvidenceRef[] ?? [];
  }

  search(projectId: string, query: string): GraphEntity[] {
    const project = this.mustGet(projectId);
    const needle = query.toLowerCase();
    return [...project.entities.values()].filter((entity) => `${entity.name} ${entity.type} ${entity.domain ?? ""} ${entity.owner ?? ""}`.toLowerCase().includes(needle)).slice(0, 20);
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
