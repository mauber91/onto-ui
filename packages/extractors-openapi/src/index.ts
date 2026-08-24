import { createHash } from "node:crypto";
import YAML from "yaml";
import type { Fact } from "@onto/domain";
import { stableId } from "@onto/domain";
import type { ArtifactInput, Extractor, ExtractionContext } from "@onto/extractor-sdk";

type AnyRecord = Record<string, any>;

const parseYaml = (content: string): unknown => (YAML as { parse: (value: string) => unknown }).parse(content);

const hash = (value: string) => createHash("sha1").update(value).digest("hex").slice(0, 12);
const secretKey = /(secret|token|password|passwd|private[_-]?key|credential|authorization|vault|client[_-]?secret)/i;
const redactText = (value: string): string => value
  .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
  .replace(/((?:token|secret|password|private[_-]?key|authorization)\s*[:=]\s*["']?)[^,\s"'}]+/gi, "$1[REDACTED]");
const redactValue = (key: string, value: unknown): unknown => {
  if (secretKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(key, item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactValue(childKey, childValue)]));
  return value;
};
const safeMetadata = (metadata: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, redactValue(key, value)]));

const sourceFor = (artifact: ArtifactInput) => ({
  repository: artifact.source?.repository ?? artifact.repository,
  revision: artifact.source?.revision ?? artifact.revision,
  environment: artifact.source?.environment ?? artifact.environment,
  path: artifact.source?.path ?? artifact.path
});

const makeFact = (
  context: ExtractionContext,
  kind: string,
  subject: Fact["subject"],
  predicate: string,
  object: Fact["object"],
  line: number,
  label: string,
  confidence = 0.98,
  metadata: Record<string, unknown> = {},
  evidenceKind: "deterministic" | "configuration" | "documentation" = "deterministic",
  extractorId = "openapi"
): Fact => {
  const source = sourceFor(context.artifact);
  const fingerprint = hash(JSON.stringify([kind, subject, predicate, object, source.repository, source.path, line, source.environment]));
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
      kind: evidenceKind,
      label: redactText(label),
      artifactId: context.artifact.id,
      repository: source.repository,
      revision: source.revision,
      environment: source.environment,
      location: { file: source.path ?? context.artifact.path, line },
      excerpt: redactText(label)
    }],
    extractor: { id: extractorId, version: "0.1.0" },
    observedAt: context.now ?? new Date().toISOString(),
    repositoryRevision: source.revision,
    source,
    confidence,
    metadata: safeMetadata(metadata),
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
    return artifact.kind === "openapi" || (artifact.kind === "source" && /\.(ya?ml|json)$/i.test(artifact.path) && !/(^|\/)system\.ya?ml$/i.test(artifact.path));
  }

  async extract(artifact: ArtifactInput, context: ExtractionContext): Promise<Fact[]> {
    const document = parseYaml(artifact.content) as AnyRecord;
    if (!document || typeof document !== "object" || !document.openapi && !document.swagger) {
      throw new Error(`${artifact.path} is not a valid OpenAPI document`);
    }

    const serviceId = String(document["x-service-id"] ?? document.info?.["x-service-id"] ?? document.info?.title ?? artifact.path.split("/").pop()?.split(".")[0] ?? "service");
    const serviceLabel = String(document.info?.title ?? serviceId);
    const endpointType = document["x-service-role"] === "bff" ? "BffEndpoint" : "APIEndpoint";
    const serviceType = document["x-entity-type"] === "FrontendApplication" ? "FrontendApplication" : "Service";
    const facts: Fact[] = [];
    facts.push(makeFact(
      context,
      "service_declared",
      { kind: "entity", value: serviceId, label: serviceLabel, typeHint: serviceType },
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
          { kind: "entity", value: endpointId, label: endpointLabel, typeHint: endpointType },
          "EXPOSED_BY",
          { kind: "entity", value: serviceId, label: serviceLabel, typeHint: "Service" },
          lineFor(artifact.content, path, operationIndex),
          `${endpointLabel} is exposed by ${serviceLabel}`,
          0.99,
          { method: method.toUpperCase(), path, operationId, tags: operation.tags ?? [], serviceRole: document["x-service-role"], declaredContract: true }
        ));

        const requestSchema = operation.requestBody?.content && Object.values(operation.requestBody.content as AnyRecord)[0] as AnyRecord | undefined;
        const requestRef = requestSchema?.schema?.$ref;
        if (requestRef) {
          const name = schemaName(requestRef);
          facts.push(makeFact(
            context,
            "endpoint_request_schema",
            { kind: "entity", value: endpointId, label: endpointLabel, typeHint: endpointType },
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
            { kind: "entity", value: endpointId, label: endpointLabel, typeHint: endpointType },
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
    const entityKinds = new Map<string, string>();
    const register = (id: string, type: string) => entityKinds.set(id, type);
    const addDeclaration = (kind: string, id: string, type: string, name: string, metadata: Record<string, unknown>, confidence = 0.94) => {
      register(id, type);
      facts.push(makeFact(
        context,
        kind,
        { kind: "entity", value: id, label: name, typeHint: type },
        "HAS_METADATA",
        { kind: "literal", value: name },
        lineFor(artifact.content, id, 1),
        `${name} metadata`,
        confidence,
        metadata,
        "configuration",
        "system-manifest"
      ));
    };

    for (const application of (document.applications ?? []) as AnyRecord[]) {
      const id = String(application.id);
      addDeclaration("application_metadata", id, String(application.entityType ?? "FrontendApplication"), String(application.name ?? id), {
        owner: application.owner,
        domain: application.domain,
        description: application.description,
        repository: application.repository,
        revision: application.revision
      }, 0.96);
    }
    for (const service of (document.services ?? []) as AnyRecord[]) {
      const id = String(service.id);
      const type = String(service.entityType ?? (service.kind === "frontend" ? "FrontendApplication" : "Service"));
      addDeclaration("service_metadata", id, type, String(service.name ?? id), {
        owner: service.owner,
        domain: service.domain,
        description: service.description,
        repository: service.repository,
        revision: service.revision,
        environment: service.environment
      });
    }
    for (const database of (document.databases ?? []) as AnyRecord[]) {
      const id = String(database.id);
      addDeclaration("database_declared", id, "Database", String(database.name ?? id), { domain: database.domain }, 0.95);
    }
    for (const event of (document.events ?? []) as AnyRecord[]) {
      const id = String(event.id);
      addDeclaration("event_declared", id, "Event", String(event.name ?? id), { domain: event.domain }, 0.95);
    }
    for (const entity of (document.domainEntities ?? []) as AnyRecord[]) {
      const id = String(entity.id);
      addDeclaration("domain_entity_declared", id, "DomainEntity", String(entity.name ?? id), { domain: entity.domain }, 0.9);
    }
    for (const configuration of (document.configurations ?? []) as AnyRecord[]) {
      const id = String(configuration.id);
      const configurationKey = String(configuration.key ?? configuration.name ?? id);
      addDeclaration("configuration_declared", id, "Configuration", String(configuration.name ?? id), {
        environment: configuration.environment,
        key: configurationKey,
        value: secretKey.test(configurationKey) ? "[REDACTED]" : redactValue(configurationKey, configuration.value)
      }, 0.92);
    }

    for (const relation of (document.relationships ?? []) as AnyRecord[]) {
      const from = String(relation.from);
      const to = String(relation.to);
      const type = String(relation.type);
      const fromType = String(relation.fromType ?? entityKinds.get(from) ?? "Service");
      const toType = String(relation.toType ?? entityKinds.get(to) ?? "Service");
      facts.push(makeFact(
        context,
        "relationship_observed",
        { kind: "entity", value: from, typeHint: fromType },
        type,
        { kind: "entity", value: to, typeHint: toType },
        lineFor(artifact.content, from, 1),
        `${from} ${type} ${to}`,
        0.93,
        { source: relation.source, domain: relation.domain, configured: true, environment: relation.environment },
        "configuration",
        "system-manifest"
      ));
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
