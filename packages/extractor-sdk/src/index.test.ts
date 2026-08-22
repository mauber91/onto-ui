import { describe, expect, it } from "vitest";
import type { Extractor } from "./index";

describe("extractor contract", () => {
  it("keeps extraction behind a small plugin boundary", () => {
    const extractor: Extractor = {
      id: "fixture",
      version: "1.0.0",
      supports: (artifact) => artifact.kind === "openapi",
      extract: async () => []
    };
    expect(extractor.supports({ id: "a", projectId: "p", kind: "openapi", path: "a.yaml", content: "" })).toBe(true);
  });
});
