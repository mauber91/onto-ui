import { describe, expect, it } from "vitest";
import { openApiExtractor } from "./index";

describe("OpenAPI extractor", () => {
  it("emits endpoint and schema facts with evidence", async () => {
    const content = `openapi: 3.0.0\ninfo:\n  title: Orders\n  x-service-id: orders\npaths:\n  /orders:\n    post:\n      operationId: createOrder\n      requestBody:\n        content:\n          application/json:\n            schema:\n              $ref: '#/components/schemas/CreateOrder'\n      responses:\n        '201':\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/Order'\ncomponents:\n  schemas:\n    CreateOrder:\n      type: object\n    Order:\n      type: object\n`;
    const facts = await openApiExtractor.extract({ id: "a", projectId: "p", kind: "openapi", path: "orders.yaml", content }, { projectId: "p", artifact: { id: "a", projectId: "p", kind: "openapi", path: "orders.yaml", content } });
    expect(facts.some((fact) => fact.kind === "http_endpoint")).toBe(true);
    expect(facts.some((fact) => fact.predicate === "ACCEPTS_SCHEMA")).toBe(true);
    expect(facts.every((fact) => fact.evidence.length > 0)).toBe(true);
  });
});
