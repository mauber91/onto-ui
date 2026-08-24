import { createHash } from "node:crypto";
import ts from "typescript";
import YAML from "yaml";
import type { Fact, FactTerm, SourceMetadata } from "@onto/domain";
import type { ArtifactInput, Extractor, ExtractionContext } from "@onto/extractor-sdk";

type AnyRecord = Record<string, any>;
type SourceNode = ts.Node | number;

const VERSION = "0.1.0";
const hash = (value: string) => createHash("sha1").update(value).digest("hex").slice(0, 14);
const secretKey = /(secret|token|password|passwd|private[_-]?key|credential|authorization|vault|client[_-]?secret)/i;
const parseYaml = (content: string): unknown => (YAML as { parse: (value: string) => unknown }).parse(content);

const sourceFor = (artifact: ArtifactInput): SourceMetadata => ({
  repository: artifact.source?.repository ?? artifact.repository,
  revision: artifact.source?.revision ?? artifact.revision,
  environment: artifact.source?.environment ?? artifact.environment,
  path: artifact.source?.path ?? artifact.path
});

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

const safeMetadata = (metadata: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, redactValue(key, value)]));

const lineFor = (content: string, position: number): number => content.slice(0, Math.max(position, 0)).split("\n").length;
const lineText = (content: string, line: number): string => content.split("\n")[line - 1] ?? "";
const nodeLine = (content: string, node: SourceNode): number => typeof node === "number" ? lineFor(content, node) : lineFor(content, node.getStart());

const entity = (value: string, typeHint: string, label?: string): FactTerm => ({ kind: "entity", value, typeHint, ...(label ? { label } : {}) });
const literal = (value: string, label?: string): FactTerm => ({ kind: "literal", value, ...(label ? { label } : {}) });

const makeFact = (
  context: ExtractionContext,
  extractorId: string,
  kind: string,
  subject: FactTerm,
  predicate: string,
  object: FactTerm,
  node: SourceNode,
  label: string,
  confidence = 0.9,
  metadata: Record<string, unknown> = {},
  evidenceKind: "deterministic" | "configuration" | "documentation" = "deterministic"
): Fact => {
  const source = sourceFor(context.artifact);
  const line = nodeLine(context.artifact.content, node);
  const safeLabel = redactText(label);
  const fingerprint = hash(JSON.stringify([extractorId, kind, subject, predicate, object, source.repository, source.path, line, source.environment]));
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
      label: safeLabel,
      artifactId: context.artifact.id,
      repository: source.repository,
      revision: source.revision,
      environment: source.environment,
      location: { file: source.path ?? context.artifact.path, line, excerpt: safeLabel },
      excerpt: safeLabel
    }],
    extractor: { id: extractorId, version: VERSION },
    observedAt: context.now ?? new Date().toISOString(),
    repositoryRevision: source.revision,
    source,
    confidence,
    metadata: safeMetadata(metadata),
    fingerprint
  };
};

const stringValue = (node: ts.Expression | undefined): string | undefined => {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) value += `{${span.expression.getText()}}${span.literal.text}`;
    return value;
  }
  return undefined;
};

const normalizePath = (value: string): string => value
  .replace(/\$\{([^}]+)\}/g, (_match, expression: string) => `{${expression.split(".").pop()?.replace(/[^A-Za-z0-9_]/g, "") ?? "param"}}`)
  .replace(/\/+/g, "/");

const normalizeBffPath = (value: string): string => {
  const normalized = normalizePath(value);
  const marker = "/v1/supplier-response-bff";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex >= 0) return normalized.slice(markerIndex);
  const gatewayMarker = "/api/sample-management/v1/supplier-response-bff";
  const gatewayIndex = normalized.indexOf(gatewayMarker);
  if (gatewayIndex >= 0) return normalized.slice(gatewayIndex + "/api/sample-management".length);
  if (normalized.startsWith("/")) return `${marker}${normalized}`.replace(/\/+/g, "/");
  return `${marker}/${normalized}`.replace(/\/+/g, "/");
};

const frontendId = (artifact: ArtifactInput): string => artifact.path.includes("offer-sample-management") ? "offer-sample-management-frontend" : `frontend:${artifact.source?.repository ?? artifact.repository ?? artifact.path}`;
const bffId = "supplier-response-bff";

const workflowFor = (value: string): { id: string; label: string } => {
  const text = value.toLowerCase();
  if (text.includes("sample-request") || text.includes("sample request")) return { id: "sample-request-detail", label: "Sample request detail" };
  if (text.includes("sample-response") || text.includes("sample response") || text.includes("/samples")) return { id: "sample-creation-submission", label: "Sample creation and submission" };
  if (text.includes("clone")) return { id: "offer-cloning", label: "Offer cloning" };
  if (text.includes("offer") && (text.includes("list") || text.includes("search") || text.includes("my-offers") || text.includes("my offers"))) return { id: "offer-listing", label: "Offer listing and enrichment" };
  if (text.includes("offer")) return { id: "offer-creation-update-submission", label: "Offer creation, update, and submission" };
  if (text.includes("sample")) return { id: "sample-creation-submission", label: "Sample creation and submission" };
  return { id: "offer-sample-management", label: "Offer and sample management" };
};

const componentName = (node: ts.Expression | undefined): string | undefined => {
  if (!node) return undefined;
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) return node.getText();
  return undefined;
};

const objectProperty = (object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined => object.properties.find((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && property.name.getText().replace(/["']/g, "") === name);

const environmentFrom = (content: string, line: number): string | undefined => {
  const lines = content.split("\n");
  const start = Math.max(0, line - 4);
  const nearby = lines.slice(start, line).join(" ").toLowerCase();
  const matches = [...nearby.matchAll(/\b(development|dev|stage|staging|production|prod)\b/g)];
  const last = matches.at(-1)?.[1];
  if (!last) return undefined;
  if (last === "dev") return "development";
  if (last === "staging") return "stage";
  if (last === "prod") return "production";
  return last;
};

const functionContracts = (sourceFile: ts.SourceFile): Map<string, { requestDto?: string; responseDto?: string }> => {
  const result = new Map<string, { requestDto?: string; responseDto?: string }>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
      const name = node.name?.getText();
      if (name) result.set(name, { requestDto: node.parameters[0]?.type?.getText(), responseDto: node.type?.getText()?.replace(/^Promise<|>$/g, "") });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
};

const callParts = (node: ts.CallExpression): { method?: string; path?: string; receiver?: string } => {
  if (ts.isPropertyAccessExpression(node.expression)) {
    const method = node.expression.name.text.toLowerCase();
    if (["get", "post", "put", "patch", "delete", "head", "options"].includes(method)) return { method: method.toUpperCase(), path: stringValue(node.arguments[0]), receiver: node.expression.expression.getText() };
  }
  if (node.expression.getText() === "fetch") {
    const methodArgument = node.arguments[1];
    let method = "GET";
    if (methodArgument && ts.isObjectLiteralExpression(methodArgument)) {
      const methodProperty = objectProperty(methodArgument, "method");
      method = stringValue(methodProperty?.initializer)?.toUpperCase() ?? method;
    }
    return { method, path: stringValue(node.arguments[0]), receiver: "fetch" };
  }
  return {};
};

const routeFact = (
  context: ExtractionContext,
  facts: Fact[],
  sourceFile: ts.SourceFile,
  path: string,
  component: string | undefined,
  node: ts.Node,
  seen: Set<string>
) => {
  const key = `${path}:${nodeLine(context.artifact.content, node)}`;
  if (seen.has(key)) return;
  seen.add(key);
  const workflow = workflowFor(`${path} ${component ?? ""}`);
  const app = frontendId(context.artifact);
  const routeId = `${app}:route:${path}`;
  const workflowId = `${app}:workflow:${workflow.id}`;
  const componentId = component ? `${app}:component:${component}` : undefined;
  facts.push(makeFact(context, "typescript-frontend", "workflow_declared", entity(workflowId, "Workflow", workflow.label), "DECLARES_WORKFLOW", literal(workflow.label), node, `${workflow.label} workflow`, 0.94, { workflowKey: workflow.id, routePath: path, component }));
  facts.push(makeFact(context, "typescript-frontend", "frontend_route", entity(app, "FrontendApplication", "Offer Sample Management"), "EXPOSES", entity(routeId, "FrontendRoute", path), node, `${app} exposes ${path}`, 0.96, { routePath: path, workflow: workflow.id, component }));
  facts.push(makeFact(context, "typescript-frontend", "route_workflow", entity(routeId, "FrontendRoute", path), "PART_OF", entity(workflowId, "Workflow", workflow.label), node, `${path} is part of ${workflow.label}`, 0.93, { routePath: path, workflow: workflow.id }));
  if (component) facts.push(makeFact(context, "typescript-frontend", "route_component", entity(routeId, "FrontendRoute", path), "ROUTES_TO", entity(componentId!, "FrontendComponent", component), node, `${path} routes to ${component}`, 0.93, { routePath: path, component }));
};

export class TypeScriptFrontendExtractor implements Extractor {
  id = "typescript-frontend";
  version = VERSION;

  supports(artifact: ArtifactInput): boolean {
    return ["typescript-source", "frontend-config", "test-evidence"].includes(artifact.kind) && /\.(tsx?|jsx?|mjs|cjs)$/i.test(artifact.path);
  }

  async extract(artifact: ArtifactInput, context: ExtractionContext): Promise<Fact[]> {
    const scriptKind = /\.tsx?$/i.test(artifact.path) ? ts.ScriptKind.TSX : ts.ScriptKind.JS;
    const sourceFile = ts.createSourceFile(artifact.path, artifact.content, ts.ScriptTarget.Latest, true, scriptKind);
    const facts: Fact[] = [];
    const app = frontendId(artifact);
    const contracts = functionContracts(sourceFile);
    const routeSeen = new Set<string>();
    const emittedConfigurations = new Set<string>();
    const testAssertionSeen = new Set<string>();

    facts.push(makeFact(context, this.id, "frontend_application", entity(app, "FrontendApplication", "Offer Sample Management"), "HAS_METADATA", literal("Offer Sample Management"), sourceFile, "Offer Sample Management frontend application", 0.9, { repository: sourceFor(artifact).repository, appPath: "apps/offer-sample-management" }));

    const visit = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && node.name.getText().replace(/["']/g, "") === "path") {
        const path = stringValue(node.initializer);
        const object = node.parent;
        const element = ts.isObjectLiteralExpression(object) ? objectProperty(object, "element")?.initializer ?? objectProperty(object, "component")?.initializer : undefined;
        if (path?.startsWith("/")) routeFact(context, facts, sourceFile, normalizePath(path), componentName(element), node, routeSeen);
      }
      if (ts.isJsxAttribute(node) && node.name.text === "path") {
        const path = stringValue(node.initializer && ts.isStringLiteral(node.initializer) ? node.initializer : undefined);
        if (path?.startsWith("/")) {
          const opening = node.parent.parent;
          const elementAttribute = ts.isJsxOpeningLikeElement(opening) ? opening.attributes.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.text === "element") : undefined;
          const elementExpression = elementAttribute && elementAttribute.initializer && ts.isJsxExpression(elementAttribute.initializer) ? elementAttribute.initializer.expression : undefined;
          routeFact(context, facts, sourceFile, normalizePath(path), componentName(elementExpression), node, routeSeen);
        }
      }
      if (ts.isCallExpression(node)) {
        const parts = callParts(node);
        if (parts.method && parts.path) {
          const path = normalizeBffPath(parts.path);
          const functionName = (() => {
            let parent: ts.Node | undefined = node.parent;
            while (parent) {
              if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent)) return parent.name?.getText();
              if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
              parent = parent.parent;
            }
            return undefined;
          })();
          const workflow = workflowFor(`${artifact.path} ${functionName ?? ""} ${path}`);
          const callId = `${app}:api-call:${parts.method}:${path}:${functionName ?? "anonymous"}`;
          const endpointId = `${bffId}:${parts.method} ${path}`;
          const workflowId = `${app}:workflow:${workflow.id}`;
          const contract = functionName ? contracts.get(functionName) : undefined;
          facts.push(makeFact(context, this.id, "frontend_api_call", entity(callId, "FrontendApiCall", `${parts.method} ${path}`), "CALLS", entity(endpointId, "BffEndpoint", `${parts.method} ${path}`), node, `${parts.method} ${path} from ${artifact.path}`, 0.95, {
            method: parts.method,
            path,
            originalPath: parts.path,
            receiver: parts.receiver,
            functionName,
            module: artifact.path.split("/").pop(),
            workflow: workflow.id,
            requestDto: contract?.requestDto,
            responseDto: contract?.responseDto,
            sourceObserved: true
          }));
          facts.push(makeFact(context, this.id, "api_call_workflow", entity(callId, "FrontendApiCall", `${parts.method} ${path}`), "PART_OF", entity(workflowId, "Workflow", workflow.label), node, `${parts.method} ${path} is part of ${workflow.label}`, 0.91, { workflow: workflow.id }));
          if (contract?.requestDto) {
            const schemaId = `${app}:schema:${contract.requestDto}`;
            facts.push(makeFact(context, this.id, "frontend_dto_reference", entity(callId, "FrontendApiCall", `${parts.method} ${path}`), "TRANSFORMS", entity(schemaId, "Schema", contract.requestDto), node, `${functionName ?? "API call"} accepts ${contract.requestDto}`, 0.84, { direction: "request", dto: contract.requestDto }));
          }
          if (contract?.responseDto) {
            const schemaId = `${app}:schema:${contract.responseDto}`;
            facts.push(makeFact(context, this.id, "frontend_dto_reference", entity(callId, "FrontendApiCall", `${parts.method} ${path}`), "TRANSFORMS", entity(schemaId, "Schema", contract.responseDto), node, `${functionName ?? "API call"} returns ${contract.responseDto}`, 0.84, { direction: "response", dto: contract.responseDto }));
          }
        }
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const value = node.text;
        if (/supplier-response-bff|api\/sample-management|offer_sample_management|\.\/Module/.test(value)) {
          const line = nodeLine(artifact.content, node);
          const environment = environmentFrom(artifact.content, line);
          const isRemoteName = /offer_sample_management/.test(value);
          const isExpose = /\.\/Module/.test(value);
          const isRouting = /supplier-response-bff|api\/sample-management/.test(value);
          if (isRemoteName || isExpose) {
            const configId = `${app}:configuration:module-federation`;
            if (!emittedConfigurations.has(`${configId}:${line}`)) {
              emittedConfigurations.add(`${configId}:${line}`);
              facts.push(makeFact(context, this.id, "module_federation_metadata", entity(app, "FrontendApplication", "Offer Sample Management"), "DEPLOYED_AS", entity(configId, "Configuration", "Module Federation remote"), node, `Module Federation metadata for ${app}`, 0.9, { remoteName: isRemoteName ? value : undefined, exposedModule: isExpose ? value : undefined, environment }, "configuration"));
            }
          }
          if (isRouting) {
            const environmentName = environment ?? "unspecified";
            const configId = `${app}:configuration:bff-routing:${environmentName}`;
            if (!emittedConfigurations.has(configId)) {
              emittedConfigurations.add(configId);
              facts.push(makeFact(context, this.id, "frontend_routing_configuration", entity(app, "FrontendApplication", "Offer Sample Management"), "USES_CONFIGURATION", entity(configId, "Configuration", `BFF routing · ${environmentName}`), node, `${environmentName} supplier-response-bff routing`, 0.96, { environment: environmentName, baseUrl: value, routingMode: value.startsWith("http") ? "direct" : "same-origin" }, "configuration"));
            }
          }
          if (artifact.kind === "test-evidence") {
            const assertedPath = normalizeBffPath(value);
            const endpointId = `${bffId}:GET ${assertedPath}`;
            const assertionKey = `${endpointId}:${line}`;
            if (!testAssertionSeen.has(assertionKey)) {
              testAssertionSeen.add(assertionKey);
              facts.push(makeFact(context, this.id, "frontend_test_assertion", entity(endpointId, "BffEndpoint", `GET ${assertedPath}`), "HAS_METADATA", literal("endpoint path assertion"), node, `${artifact.path} asserts ${assertedPath}`, 0.93, { assertionType: "endpoint-path", expectedPath: assertedPath, testFile: sourceFor(artifact).path, workflow: workflowFor(`${artifact.path} ${assertedPath}`).id }));
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    const moduleFederationName = artifact.path.includes("module-federation") ? artifact.content.match(/\bname\s*:\s*["']([^"']+)["']/)?.[1] : undefined;
    const exposedModule = artifact.path.includes("module-federation") ? artifact.content.match(/\.?["']\.\/Module["']\s*:\s*["']([^"']+)["']/)?.[1] : undefined;
    if (moduleFederationName || exposedModule) {
      const configId = `${app}:configuration:module-federation`;
      facts.push(makeFact(context, this.id, "module_federation_metadata", entity(app, "FrontendApplication", "Offer Sample Management"), "DEPLOYED_AS", entity(configId, "Configuration", "Module Federation remote"), sourceFile, `Module Federation remote ${moduleFederationName ?? app}`, 0.96, { remoteName: moduleFederationName, exposedModule: exposedModule ? `./Module -> ${exposedModule}` : undefined }, "configuration"));
    }
    return facts;
  }
}

const matchingClass = (content: string): { name: string; start: number; end: number; body: string } | undefined => {
  const match = /\bclass\s+(\w+)/.exec(content);
  if (!match || match.index === undefined) return undefined;
  const start = match.index;
  const open = content.indexOf("{", start);
  if (open < 0) return { name: match[1], start, end: content.length, body: content.slice(open + 1) };
  let depth = 0;
  for (let index = open; index < content.length; index += 1) {
    if (content[index] === "{") depth += 1;
    if (content[index] === "}") {
      depth -= 1;
      if (depth === 0) return { name: match[1], start, end: index + 1, body: content.slice(open + 1, index) };
    }
  }
  return { name: match[1], start, end: content.length, body: content.slice(open + 1) };
};

const javaFields = (body: string): Map<string, string> => {
  const fields = new Map<string, string>();
  const fieldPattern = /(?:private|protected|public)\s+(?:final\s+)?([A-Za-z_$][\w$]*(?:<[^;=]+>)?)\s+([A-Za-z_$][\w$]*)\s*(?:=|;)/g;
  for (const match of body.matchAll(fieldPattern)) fields.set(match[2], match[1]);
  return fields;
};

const javaMethodMappings = (content: string, classStart: number, classBody: string): Array<{ httpMethod: string; path: string; methodName: string; start: number; body: string; signature: string }> => {
  const prefixMatch = content.slice(0, classStart).match(/@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g);
  const classPrefix = prefixMatch?.at(-1)?.match(/["']([^"']+)["']/)?.[1] ?? "";
  const mappings: Array<{ httpMethod: string; path: string; methodName: string; start: number; body: string; signature: string }> = [];
  const pattern = /@(Get|Post|Put|Patch|Delete|Request)Mapping\s*(?:\(([^)]*)\))?\s*([\s\S]{0,360}?)\b([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  for (const match of classBody.matchAll(pattern)) {
    const httpMethod = match[1].toUpperCase() === "REQUEST" ? (match[2]?.match(/method\s*=\s*RequestMethod\.(\w+)/)?.[1] ?? "GET") : match[1].toUpperCase();
    const path = match[2]?.match(/(?:value|path)?\s*=\s*["']([^"']+)["']|["']([^"']+)["']/)?.[1] ?? match[2]?.match(/(?:value|path)?\s*=\s*["']([^"']+)["']|["']([^"']+)["']/)?.[2] ?? "";
    const methodName = match[4];
    const methodStart = (match.index ?? 0) + match[0].indexOf(methodName);
    const open = classBody.indexOf("{", methodStart);
    let end = open + 1;
    let depth = 1;
    while (end < classBody.length && depth > 0) {
      if (classBody[end] === "{") depth += 1;
      if (classBody[end] === "}") depth -= 1;
      end += 1;
    }
    mappings.push({ httpMethod, path: `${classPrefix}/${path}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/", methodName, start: methodStart, body: classBody.slice(open + 1, end - 1), signature: match[0] });
  }
  return mappings;
};

const workflowForJava = (className: string, pathOrBody: string) => workflowFor(`${className} ${pathOrBody}`);

export class JavaSpringBffExtractor implements Extractor {
  id = "java-spring-bff";
  version = VERSION;

  supports(artifact: ArtifactInput): boolean {
    return ["java-source", "test-evidence"].includes(artifact.kind) && /\.java$/i.test(artifact.path);
  }

  async extract(artifact: ArtifactInput, context: ExtractionContext): Promise<Fact[]> {
    const facts: Fact[] = [];
    const clazz = matchingClass(artifact.content);
    if (!clazz) return facts;
    const fields = javaFields(clazz.body);
    const bodyOffset = Math.max(artifact.content.indexOf("{", clazz.start) + 1, 0);
    const classLine = lineFor(artifact.content, clazz.start);
    const className = clazz.name;
    const appServiceId = `${bffId}:service:${className}`;
    const isController = /Controller/.test(className) || /@RestController/.test(artifact.content);
    const isClient = /Client/.test(className);
    const isService = /Service/.test(className) && !isController;
    const workflow = workflowForJava(className, artifact.content);
    const sourceObservedConfidence = 0.88;

    if (isController) {
      for (const mapping of javaMethodMappings(artifact.content, clazz.start, clazz.body)) {
        const endpointId = `${bffId}:${mapping.httpMethod} ${mapping.path}`;
        const workflowForEndpoint = workflowForJava(className, mapping.path);
        facts.push(makeFact(context, this.id, "bff_controller_operation", entity(endpointId, "BffEndpoint", `${mapping.httpMethod} ${mapping.path}`), "IMPLEMENTED_BY", entity(`${bffId}:controller:${className}`, "Service", className), bodyOffset + mapping.start, `${mapping.httpMethod} ${mapping.path} is implemented by ${className}`, sourceObservedConfidence, { method: mapping.httpMethod, path: mapping.path, controller: className, operationMethod: mapping.methodName, declaredContract: false }));
        facts.push(makeFact(context, this.id, "bff_endpoint_workflow", entity(endpointId, "BffEndpoint", `${mapping.httpMethod} ${mapping.path}`), "PART_OF", entity(`${bffId}:workflow:${workflowForEndpoint.id}`, "Workflow", workflowForEndpoint.label), bodyOffset + mapping.start, `${mapping.httpMethod} ${mapping.path} participates in ${workflowForEndpoint.label}`, 0.86, { workflow: workflowForEndpoint.id }));
        for (const [field, fieldType] of fields) {
          if (!/Service/.test(fieldType) || !new RegExp(`\\b${field}\\s*\\.`).test(mapping.body)) continue;
          const implementationType = fieldType.endsWith("Impl") ? fieldType : `${fieldType}Impl`;
          facts.push(makeFact(context, this.id, "controller_service_call", entity(endpointId, "BffEndpoint", `${mapping.httpMethod} ${mapping.path}`), "HANDLED_BY", entity(`${bffId}:service:${implementationType}`, "ApplicationService", implementationType), bodyOffset + mapping.start, `${className} delegates ${mapping.httpMethod} ${mapping.path} to ${implementationType}`, sourceObservedConfidence, { controller: className, serviceField: field, serviceType: fieldType, implementationType }));
        }
        const authMatch = mapping.body.match(/(?:authorize|ownership|assert[A-Za-z]*Owner|supplier\w*Id|isOwner)/i);
        if (authMatch) {
          const policyId = `${bffId}:auth:${className}:${mapping.methodName}`;
          facts.push(makeFact(context, this.id, "auth_policy_observed", entity(policyId, "AuthPolicy", `${className}.${mapping.methodName} ownership check`), "AUTHORIZES", entity(endpointId, "BffEndpoint", `${mapping.httpMethod} ${mapping.path}`), bodyOffset + mapping.start, `${className}.${mapping.methodName} applies an ownership or authorization check`, 0.9, { controller: className, method: mapping.methodName, check: authMatch[0] }));
        }
        const dtoTypes = [...mapping.signature.matchAll(/\b([A-Z][A-Za-z0-9]*(?:DTO|Request|Response|Command|Query))\b/g)].map((match) => match[1]);
        for (const dto of [...new Set(dtoTypes)]) facts.push(makeFact(context, this.id, "bff_dto_mapping", entity(endpointId, "BffEndpoint", `${mapping.httpMethod} ${mapping.path}`), "TRANSFORMS", entity(`${bffId}:schema:${dto}`, "Schema", dto), bodyOffset + mapping.start, `${endpointId} references ${dto}`, 0.82, { dto, controller: className }));
      }
    }

    if (isService) {
      facts.push(makeFact(context, this.id, "application_service_declared", entity(appServiceId, "ApplicationService", className), "HAS_METADATA", literal(className), clazz.start, `${className} orchestrates BFF workflow calls`, 0.9, { className, workflow: workflow.id, staticParser: "line-anchored" }));
      facts.push(makeFact(context, this.id, "application_service_workflow", entity(appServiceId, "ApplicationService", className), "PART_OF", entity(`${bffId}:workflow:${workflow.id}`, "Workflow", workflow.label), clazz.start, `${className} participates in ${workflow.label}`, 0.84, { workflow: workflow.id }));
      for (const [field, fieldType] of fields) {
        if (!/Client/.test(fieldType)) continue;
        const calls = [...clazz.body.matchAll(new RegExp(`\\b${field}\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`, "g"))];
        for (const call of calls) {
          const method = call[1];
          const operationId = `${bffId}:operation:${fieldType}:${method}`;
          const operationLabel = `${fieldType}.${method}`;
          facts.push(makeFact(context, this.id, "application_client_call", entity(appServiceId, "ApplicationService", className), "CALLS", entity(operationId, "DownstreamOperation", operationLabel), bodyOffset + (call.index ?? 0), `${className} calls ${operationLabel}`, sourceObservedConfidence, { clientField: field, clientType: fieldType, method, workflow: workflow.id }));
          if (/uber|enrich|measurement|product/i.test(`${fieldType} ${method}`)) facts.push(makeFact(context, this.id, "enrichment_observed", entity(appServiceId, "ApplicationService", className), "ENRICHES", entity(operationId, "DownstreamOperation", operationLabel), bodyOffset + (call.index ?? 0), `${className} enriches its response with ${operationLabel}`, 0.83, { clientType: fieldType, method }));
        }
      }
    }

    if (isClient) {
      const downstream = artifact.content.match(/@DownstreamService\s*\(\s*["']([^"']+)["']\s*\)/)?.[1] ?? artifact.content.match(/SERVICE_ID\s*=\s*["']([^"']+)["']/)?.[1];
      for (const method of artifact.content.matchAll(/\b(?:public|protected)\s+[\w<>?,. ]+\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g)) {
        const methodName = method[1];
        if (["if", "for", "while", "switch"].includes(methodName)) continue;
        const operationId = `${bffId}:operation:${className}:${methodName}`;
        facts.push(makeFact(context, this.id, "downstream_operation_declared", entity(operationId, "DownstreamOperation", `${className}.${methodName}`), "HAS_METADATA", literal(`${className}.${methodName}`), bodyOffset + (method.index ?? 0), `${className}.${methodName} is a downstream operation`, 0.87, { client: className, method: methodName, downstreamService: downstream, staticParser: "line-anchored" }));
        if (downstream) facts.push(makeFact(context, this.id, "downstream_service_resolution", entity(operationId, "DownstreamOperation", `${className}.${methodName}`), "RESOLVES_TO", entity(downstream, "Service", downstream), bodyOffset + (method.index ?? 0), `${className}.${methodName} resolves to ${downstream}`, 0.9, { downstreamService: downstream, client: className, method: methodName }));
      }
    }

    return facts;
  }
}

export class BffConfigExtractor implements Extractor {
  id = "bff-config";
  version = VERSION;

  supports(artifact: ArtifactInput): boolean {
    return artifact.kind === "bff-config";
  }

  async extract(artifact: ArtifactInput, context: ExtractionContext): Promise<Fact[]> {
    const document = parseYaml(artifact.content) as AnyRecord;
    if (!document || typeof document !== "object") throw new Error(`${artifact.path} is not a configuration document`);
    const facts: Fact[] = [];
    const visit = (value: unknown, path: string[], environment: string | undefined) => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, [...path, String(index)], environment));
        return;
      }
      if (!value || typeof value !== "object") {
        const key = path.at(-1) ?? "value";
        if (secretKey.test(key)) return;
        const keyPath = path.join(".");
        const configId = `${bffId}:configuration:${keyPath}`;
        const evidencePosition = Math.max(artifact.content.indexOf(key), 0);
        facts.push(makeFact(context, this.id, "bff_configuration", entity(configId, "Configuration", keyPath), "HAS_METADATA", literal(String(value)), evidencePosition, `${keyPath} configuration`, 0.92, { key: keyPath, value: String(value), environment }, "configuration"));
        facts.push(makeFact(context, this.id, "bff_configuration_usage", entity(bffId, "Service", "Supplier Response BFF"), "USES_CONFIGURATION", entity(configId, "Configuration", keyPath), evidencePosition, `Supplier Response BFF uses ${keyPath}`, 0.9, { key: keyPath, environment }, "configuration"));
        return;
      }
      for (const [key, child] of Object.entries(value as AnyRecord)) {
        const nextEnvironment = path.length === 0 && /^(development|dev|stage|staging|production|prod)$/i.test(key) ? key.replace(/^dev$/, "development").replace(/^staging$/, "stage").replace(/^prod$/, "production") : environment;
        visit(child, [...path, key], nextEnvironment);
      }
    };
    visit(document, [], undefined);
    return facts;
  }
}

export const typescriptFrontendExtractor = new TypeScriptFrontendExtractor();
export const javaSpringBffExtractor = new JavaSpringBffExtractor();
export const bffConfigExtractor = new BffConfigExtractor();
export const sourceExtractors: Extractor[] = [typescriptFrontendExtractor, javaSpringBffExtractor, bffConfigExtractor];

export const extractSourceArtifact = async (artifact: ArtifactInput, projectId: string, now?: string): Promise<Fact[]> => {
  const extractor = sourceExtractors.find((candidate) => candidate.supports(artifact));
  if (!extractor) throw new Error(`No source extractor supports ${artifact.path}`);
  return extractor.extract(artifact, { artifact, projectId, now });
};
