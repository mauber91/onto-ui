import { describe, expect, it } from "vitest";
import { openApiExtractor, systemManifestExtractor } from "./index";

describe("OpenAPI extractor", () => {
  it("emits endpoint and schema facts with evidence", async () => {
    const content = `openapi: 3.0.0\ninfo:\n  title: Orders\n  x-service-id: orders\npaths:\n  /orders:\n    post:\n      operationId: createOrder\n      requestBody:\n        content:\n          application/json:\n            schema:\n              $ref: '#/components/schemas/CreateOrder'\n      responses:\n        '201':\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/Order'\ncomponents:\n  schemas:\n    CreateOrder:\n      type: object\n    Order:\n      type: object\n`;
    const facts = await openApiExtractor.extract({ id: "a", projectId: "p", kind: "openapi", path: "orders.yaml", content }, { projectId: "p", artifact: { id: "a", projectId: "p", kind: "openapi", path: "orders.yaml", content } });
    expect(facts.some((fact) => fact.kind === "http_endpoint")).toBe(true);
    expect(facts.some((fact) => fact.predicate === "ACCEPTS_SCHEMA")).toBe(true);
    expect(facts.every((fact) => fact.evidence.length > 0)).toBe(true);
  });

  it("redacts secret-looking system manifest configuration", async () => {
    const content = "configurations:\n  - id: client-secret\n    name: Client secret\n    key: clientSecret\n    value: do-not-store\n";
    const artifact = { id: "manifest", projectId: "p", kind: "system-manifest" as const, path: "system.yaml", content };
    const facts = await systemManifestExtractor.extract(artifact, { projectId: "p", artifact });
    expect(JSON.stringify(facts)).not.toContain("do-not-store");
    expect(JSON.stringify(facts)).toContain("[REDACTED]");
  });
});
