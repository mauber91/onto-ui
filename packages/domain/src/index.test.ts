import { describe, expect, it } from "vitest";
import { FactSchema, initialOntology, slugify } from "./index";

describe("domain contracts", () => {
  it("creates a stable ontology baseline", () => {
    const ontology = initialOntology("demo");
    expect(ontology.entityTypes.map((item) => item.id)).toContain("Service");
    expect(ontology.relations.map((item) => item.id)).toContain("CALLS");
  });

  it("normalizes identifiers without losing readability", () => {
    expect(slugify("POST /orders/{id}")).toBe("post-orders-id");
  });

  it("rejects facts without evidence", () => {
    expect(() => FactSchema.parse({
      id: "fact",
      projectId: "demo",
      kind: "endpoint",
      subject: { kind: "entity", value: "orders" },
      predicate: "EXPOSES",
      object: { kind: "entity", value: "orders" },
      evidence: [],
      extractor: { id: "test", version: "1" },
      observedAt: new Date().toISOString(),
      confidence: 1,
      metadata: {},
      fingerprint: "fact"
    })).toThrow();
  });
});
