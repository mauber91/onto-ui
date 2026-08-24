import { describe, expect, it } from "vitest";
import { store } from "./store.js";

describe("local graph store", () => {
  it("answers a bounded system graph query", async () => {
    await store.initialize();
    const graph = store.getGraph("commerce", "system", { focus: "Checkout Service", depth: 2 });
    expect(graph.entities.length).toBeGreaterThan(1);
    expect(graph.relationships.some((edge) => edge.type === "CALLS")).toBe(true);
  });

  it("keeps ontology mode separate from instance mode", async () => {
    await store.initialize();
    const graph = store.getGraph("commerce", "ontology");
    expect(graph.entities.every((entity) => entity.type === "OntologyType")).toBe(true);
    expect(graph.relationships.some((edge) => edge.type === "EXPOSES")).toBe(true);
  });

  it("projects the offer/sample workflow from frontend through the BFF to downstream operations", async () => {
    await store.initialize();
    const graph = store.getGraph("offer-sample-management", "system", { workflow: "sample-request-detail", depth: 3, limit: 250 });
    expect(graph.entities.some((entity) => entity.type === "FrontendRoute" && entity.name.includes("sample-requests"))).toBe(true);
    expect(graph.entities.some((entity) => entity.type === "FrontendApiCall" && entity.name.includes("sample-requests"))).toBe(true);
    expect(graph.entities.some((entity) => entity.type === "BffEndpoint" && entity.name.includes("sample-requests"))).toBe(true);
    expect(graph.entities.some((entity) => entity.type === "ApplicationService" && entity.name.includes("SampleRequestsService"))).toBe(true);
    expect(graph.entities.some((entity) => entity.type === "DownstreamOperation" && entity.name.includes("SampleManagementClientImpl.getRequest"))).toBe(true);
    expect(graph.entities.some((entity) => entity.name === "ESP-QUOTE-ESP-QUOTE")).toBe(false);
    expect(graph.relationships.some((edge) => edge.type === "ENRICHES")).toBe(true);
  });

  it("projects offer calls to ESP Quote and Uber dependencies", async () => {
    await store.initialize();
    const graph = store.getGraph("offer-sample-management", "system", { workflow: "offer-creation-update-submission", depth: 3, limit: 250 });
    expect(graph.entities.some((entity) => entity.type === "ApplicationService" && entity.name === "OffersServiceImpl")).toBe(true);
    expect(graph.entities.some((entity) => entity.type === "DownstreamOperation" && entity.name.includes("EspQuoteClientImpl.create"))).toBe(true);
    expect(graph.entities.some((entity) => entity.type === "Service" && entity.name === "ESP-QUOTE-ESP-QUOTE")).toBe(true);
    expect(graph.entities.some((entity) => entity.type === "Service" && entity.name === "ESP-PLUM-UBER-API")).toBe(true);
    expect(graph.relationships.some((edge) => edge.type === "RESOLVES_TO" && graph.entities.find((entity) => entity.id === edge.target)?.name === "ESP-QUOTE-ESP-QUOTE")).toBe(true);
  });

  it("exposes environment-specific routing and test assertions", async () => {
    await store.initialize();
    const graph = store.getGraph("offer-sample-management", "system", { environment: "stage", search: "supplier-response-bff", limit: 250 });
    expect(graph.entities.some((entity) => entity.type === "Configuration" && entity.properties.environment === "stage")).toBe(true);
    const endpoint = graph.entities.find((entity) => entity.type === "BffEndpoint" && entity.name.includes("sample-requests"));
    expect(endpoint).toBeDefined();
    const evidence = endpoint ? store.getEvidence("offer-sample-management", endpoint.id) : [];
    expect(evidence.some((item) => item.label.includes("asserts") && item.location?.file.endsWith("sample-request.spec.ts"))).toBe(true);
  });

  it("keeps repository, revision, environment, and source-line evidence on important entities", async () => {
    await store.initialize();
    const graph = store.getGraph("offer-sample-management", "system", { search: "sample-requests", limit: 50 });
    const route = graph.entities.find((entity) => entity.type === "FrontendRoute");
    expect(route?.source?.repository).toBe("enterprise-offer-ui");
    expect(route?.source?.revision).toBe("fixture-2026-08-24");
    const evidence = route ? store.getEvidence("offer-sample-management", route.id) : [];
    expect(evidence.some((item) => item.location?.file.endsWith("routes.tsx") && item.location?.line)).toBe(true);
    expect(evidence.every((item) => !JSON.stringify(item).match(/clientSecret|should-not-appear|privateKey/i))).toBe(true);
  });

  it("re-ingests the fixture without duplicating facts, entities, or relationships", async () => {
    await store.initialize();
    const before = store.getGraph("offer-sample-management", "system", { limit: 250 });
    await store.ingestOfferSampleManagementFixture("offer-sample-management");
    const after = store.getGraph("offer-sample-management", "system", { limit: 250 });
    expect(after.totalEntities).toBe(before.totalEntities);
    expect(after.totalRelationships).toBe(before.totalRelationships);
    expect(new Set(after.entities.map((entity) => entity.id)).size).toBe(after.entities.length);
    expect(new Set(after.relationships.map((edge) => edge.id)).size).toBe(after.relationships.length);
  });

  it("does not partially apply a failed ingestion", async () => {
    await store.initialize();
    const before = store.getGraph("offer-sample-management", "system", { limit: 250 });
    const run = await store.ingest("offer-sample-management", [{ id: "bad", projectId: "offer-sample-management", kind: "openapi", path: "bad.openapi.yaml", content: "not a valid OpenAPI document" }]);
    const after = store.getGraph("offer-sample-management", "system", { limit: 250 });
    expect(run.status).toBe("failed");
    expect(after.totalEntities).toBe(before.totalEntities);
    expect(after.totalRelationships).toBe(before.totalRelationships);
  });
});
