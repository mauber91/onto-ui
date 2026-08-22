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
});
