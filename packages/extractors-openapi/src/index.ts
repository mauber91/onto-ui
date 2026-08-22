import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import type { Fact } from "@onto/domain";
import { stableId } from "@onto/domain";
import type { ArtifactInput, Extractor, ExtractionContext } from "@onto/extractor-sdk";

type AnyRecord = Record<string, any>;

const hash = (value: string) => createHash("sha1").update(value).digest("hex").slice(0, 12);

const makeFact = (
  context: ExtractionContext,
  kind: string,
  subject: Fact["subject"],
  predicate: string,
  object: Fact["object"],
  line: number,
  label: string,
  confidence = 0.98,
  metadata: Record<string, unknown> = {}
): Fact => {
  const fingerprint = hash(JSON.stringify([kind, subject, predicate, object, context.artifact.path, line]));
  const evidenceId = `evidence_${fingerprint}`;
  return {
    id: `fact_${fingerprint}`,
    projectId: context.projectId,
    kind,
    subject,
    predicate,
    object,
    evidence: [{
      id: evidenceId,
      kind: "deterministic",
      label,
      artifactId: context.artifact.id,
      location: { file: context.artifact.path, line },
      excerpt: label
    }],
    extractor: { id: "openapi", version: "0.1.0" },
    observedAt: context.now ?? new Date().toISOString(),
    repositoryRevision: context.artifact.revision,
    confidence,
    metadata,
    fingerprint
  };
};

const schemaName = (ref: string): string => ref.split("/").pop() ?? ref;

const lineFor = (content: string, needle: string, fallback: number): number => {
  const index = content.indexOf(needle);
  return index < 0 ? fallback : content.slice(0, index).split("\n").length;
};

export class OpenApiExtractor implements Extractor {
  id = "openapi";
  version = "0.1.0";

  supports(artifact: ArtifactInput): boolean {
    return artifact.kind !== "system-manifest" && (artifact.kind === "openapi" || /\.(ya?ml|json)$/i.test(artifact.path));
  }

  async extract(artifact: ArtifactInput, context: ExtractionContext): Promise<Fact[]> {
    const document = parseYaml(artifact.content) as AnyRecord;
    if (!document || typeof document !== "object" || !document.openapi && !document.swagger) {
      throw new Error(`${artifact.path} is not a valid OpenAPI document`);
    }

    const serviceId = String(document["x-service-id"] ?? document.info?.["x-service-id"] ?? document.info?.title ?? artifact.path.split("/").pop()?.split(".")[0] ?? "service");
    const serviceLabel = String(document.info?.title ?? serviceId);
    const facts: Fact[] = [];
    facts.push(makeFact(
      context,
      "service_declared",
      { kind: "entity", value: serviceId, label: serviceLabel, typeHint: "Service" },
      "DECLARES_SERVICE",
      { kind: "literal", value: serviceLabel },
      lineFor(artifact.content, serviceLabel, 1),
      `${serviceLabel} is declared by ${artifact.path}`,
      0.99,
      { owner: document["x-owner"] ?? document.info?.["x-owner"], domain: document["x-domain"] ?? document.info?.["x-domain"] }
    ));

    const paths = document.paths ?? {};
    let operationIndex = 0;
    for (const [path, pathItem] of Object.entries(paths) as [string, AnyRecord][]) {
      for (const method of ["get", "post", "put", "patch", "delete", "options", "head"] as const) {
        const operation = pathItem?.[method];
        if (!operation) continue;
        operationIndex += 1;
        const operationId = String(operation.operationId ?? `${method}_${path.replace(/[^a-z0-9]+/gi, "_")}`);
        const endpointId = `${serviceId}:${method.toUpperCase()} ${path}`;
        const endpointLabel = `${method.toUpperCase()} ${path}`;
        facts.push(makeFact(
          context,
          "http_endpoint",
          { kind: "entity", value: endpointId, label: endpointLabel, typeHint: "APIEndpoint" },
          "EXPOSED_BY",
          { kind: "entity", value: serviceId, label: serviceLabel, typeHint: "Service" },
          lineFor(artifact.content, path, operationIndex),
          `${endpointLabel} is exposed by ${serviceLabel}`,
          0.99,
          { method: method.toUpperCase(), path, operationId, tags: operation.tags ?? [] }
        ));

        const requestSchema = operation.requestBody?.content && Object.values(operation.requestBody.content as AnyRecord)[0] as AnyRecord | undefined;
        const requestRef = requestSchema?.schema?.$ref;
        if (requestRef) {
          const name = schemaName(requestRef);
          facts.push(makeFact(
            context,
            "endpoint_request_schema",
            { kind: "entity", value: endpointId, label: endpointLabel, typeHint: "APIEndpoint" },
            "ACCEPTS_SCHEMA",
            { kind: "entity", value: `${serviceId}:${name}`, label: name, typeHint: "Schema" },
            lineFor(artifact.content, name, operationIndex),
            `${endpointLabel} accepts ${name}`,
            0.96
          ));
        }

        for (const response of Object.values(operation.responses ?? {}) as AnyRecord[]) {
          const responseSchema = response?.content && Object.values(response.content as AnyRecord)[0] as AnyRecord | undefined;
          const responseRef = responseSchema?.schema?.$ref;
          if (!responseRef) continue;
          const name = schemaName(responseRef);
          facts.push(makeFact(
            context,
            "endpoint_response_schema",
            { kind: "entity", value: endpointId, label: endpointLabel, typeHint: "APIEndpoint" },
            "RETURNS_SCHEMA",
            { kind: "entity", value: `${serviceId}:${name}`, label: name, typeHint: "Schema" },
            lineFor(artifact.content, name, operationIndex),
            `${endpointLabel} returns ${name}`,
            0.96
          ));
        }
      }
    }

    for (const [name, schema] of Object.entries(document.components?.schemas ?? {}) as [string, AnyRecord][]) {
      facts.push(makeFact(
        context,
        "schema_declared",
        { kind: "entity", value: `${serviceId}:${name}`, label: name, typeHint: "Schema" },
        "DECLARES_SCHEMA",
        { kind: "entity", value: serviceId, label: serviceLabel, typeHint: "Service" },
        lineFor(artifact.content, name, 1),
        `${name} schema is declared by ${serviceLabel}`,
        0.97,
        { fields: Object.keys(schema?.properties ?? {}), required: schema?.required ?? [] }
      ));
    }

    return facts;
  }
}

export class SystemManifestExtractor implements Extractor {
  id = "system-manifest";
  version = "0.1.0";

  supports(artifact: ArtifactInput): boolean {
    return artifact.kind === "system-manifest" || artifact.path.endsWith("system.yaml") || artifact.path.endsWith("system.yml");
  }

  async extract(artifact: ArtifactInput, context: ExtractionContext): Promise<Fact[]> {
    const document = parseYaml(artifact.content) as AnyRecord;
    const facts: Fact[] = [];
    const add = (kind: string, subject: string, subjectType: string, predicate: string, object: string, objectType: string, label: string, metadata: Record<string, unknown> = {}) => {
      facts.push(makeFact(context, kind, { kind: "entity", value: subject, typeHint: subjectType }, predicate, { kind: "entity", value: object, typeHint: objectType }, 1, label, 0.93, metadata));
    };
    for (const service of (document.services ?? []) as AnyRecord[]) {
      facts.push(makeFact(context, "service_metadata", { kind: "entity", value: String(service.id), label: String(service.name ?? service.id), typeHint: "Service" }, "HAS_METADATA", { kind: "literal", value: String(service.name ?? service.id) }, 1, `${service.name ?? service.id} metadata`, 0.94, { owner: service.owner, domain: service.domain, description: service.description }));
    }
    for (const database of (document.databases ?? []) as AnyRecord[]) {
      facts.push(makeFact(context, "database_declared", { kind: "entity", value: String(database.id), label: String(database.name ?? database.id), typeHint: "Database" }, "DECLARES_DATABASE", { kind: "literal", value: String(database.name ?? database.id) }, 1, `${database.name ?? database.id} database`, 0.95, { domain: database.domain }));
    }
    for (const event of (document.events ?? []) as AnyRecord[]) {
      facts.push(makeFact(context, "event_declared", { kind: "entity", value: String(event.id), label: String(event.name ?? event.id), typeHint: "Event" }, "DECLARES_EVENT", { kind: "literal", value: String(event.name ?? event.id) }, 1, `${event.name ?? event.id} event`, 0.95, { domain: event.domain }));
    }
    for (const entity of (document.domainEntities ?? []) as AnyRecord[]) {
      facts.push(makeFact(context, "domain_entity_declared", { kind: "entity", value: String(entity.id), label: String(entity.name ?? entity.id), typeHint: "DomainEntity" }, "DECLARES_DOMAIN_ENTITY", { kind: "literal", value: String(entity.name ?? entity.id) }, 1, `${entity.name ?? entity.id} domain entity`, 0.9, { domain: entity.domain }));
    }
    for (const relation of (document.relationships ?? []) as AnyRecord[]) {
      const from = String(relation.from);
      const to = String(relation.to);
      const type = String(relation.type);
      const typeMap: Record<string, [string, string]> = {
        CALLS: ["Service", "Service"],
        READS_FROM: ["Service", "Database"],
        WRITES_TO: ["Service", "Database"],
        PUBLISHES: ["Service", "Event"],
        CONSUMES: ["Service", "Event"],
        OPERATES_ON: ["Service", "DomainEntity"]
      };
      const [fromType, toType] = typeMap[type] ?? ["Service", "Service"];
      add("relationship_observed", from, fromType, type, to, toType, `${from} ${type} ${to}`, { source: relation.source, domain: relation.domain });
    }
    return facts;
  }
}

export const openApiExtractor = new OpenApiExtractor();
export const systemManifestExtractor = new SystemManifestExtractor();
export const extractors: Extractor[] = [openApiExtractor, systemManifestExtractor];

export const extractArtifact = async (artifact: ArtifactInput, projectId: string, now?: string): Promise<Fact[]> => {
  const extractor = extractors.find((candidate) => candidate.supports(artifact));
  if (!extractor) throw new Error(`No extractor supports ${artifact.path}`);
  return extractor.extract(artifact, { artifact, projectId, now });
};

export const entityKey = (type: string, value: string) => `${type}:${stableId(value)}`;
