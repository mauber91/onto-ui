import { describe, expect, it } from "vitest";
import type { ArtifactInput } from "@onto/extractor-sdk";
import { javaSpringBffExtractor, typescriptFrontendExtractor } from "./index";

const source = (path: string, kind: "typescript-source" | "java-source", content: string): ArtifactInput => ({
  id: path,
  projectId: "offer-sample-management",
  kind,
  path,
  content,
  source: { repository: kind === "typescript-source" ? "enterprise-offer-ui" : "gst-supplier-response-bff", revision: "fixture-1", environment: "stage", path }
});

describe("source extractors", () => {
  it("uses the TypeScript AST to connect routes and typed client calls", async () => {
    const artifact = source("apps/offer-sample-management/src/routes.tsx", "typescript-source", `
      const routes = [{ path: "/products/:productId/sample-requests/:requestId", element: <SampleRequestPage /> }];
      export async function getSampleRequest(requestId: string): Promise<SampleRequest> {
        return client.get<SampleRequest>("/v1/supplier-response-bff/sample-requests/\${requestId}");
      }
    `);
    const facts = await typescriptFrontendExtractor.extract(artifact, { projectId: artifact.projectId, artifact, now: "2026-08-24T00:00:00.000Z" });
    expect(facts.some((fact) => fact.kind === "frontend_route" && fact.metadata.workflow === "sample-request-detail")).toBe(true);
    expect(facts.some((fact) => fact.kind === "frontend_api_call" && fact.metadata.path === "/v1/supplier-response-bff/sample-requests/{requestId}")).toBe(true);
    expect(facts.every((fact) => fact.evidence[0]?.repository === "enterprise-offer-ui")).toBe(true);
  });

  it("connects Java controller, application service, downstream operation, and auth evidence", async () => {
    const artifact = source("primary-port-adapters/src/OffersController.java", "java-source", `
      @RestController
      @RequestMapping("/v1/supplier-response-bff/offers")
      class OffersController {
        private final OffersService offersService;
        @PostMapping
        public OfferDTO create(CreateOfferRequest request) {
          ownershipPolicy.assertSupplierOwns(request.supplierId());
          return offersService.create(request);
        }
      }
    `);
    const facts = await javaSpringBffExtractor.extract(artifact, { projectId: artifact.projectId, artifact, now: "2026-08-24T00:00:00.000Z" });
    expect(facts.some((fact) => fact.predicate === "HANDLED_BY" && fact.object.value.includes("OffersService"))).toBe(true);
    expect(facts.some((fact) => fact.predicate === "AUTHORIZES")).toBe(true);
    expect(facts.every((fact) => fact.evidence[0]?.revision === "fixture-1")).toBe(true);
  });

  it("does not retain secret-looking configuration values", async () => {
    const { bffConfigExtractor } = await import("./index");
    const artifact = {
      id: "config",
      projectId: "p",
      kind: "bff-config" as const,
      path: "ccm/NON-PROD.yml",
      content: "development:\n  apiBasePath: /v1/supplier-response-bff\n  clientSecret: should-not-appear\n"
    };
    const facts = await bffConfigExtractor.extract(artifact, { projectId: "p", artifact });
    expect(JSON.stringify(facts)).not.toContain("should-not-appear");
    expect(facts.some((fact) => fact.metadata.key === "development.apiBasePath")).toBe(true);
  });

  it("preserves endpoint assertions from test evidence", async () => {
    const artifact = source("apps/offer-sample-management-e2e/src/sample-request.spec.ts", "typescript-source", "");
    const testArtifact: ArtifactInput = { ...artifact, kind: "test-evidence", content: "expect(requestUrl).toContain(\"/v1/supplier-response-bff/sample-requests/\");" };
    const facts = await typescriptFrontendExtractor.extract(testArtifact, { projectId: testArtifact.projectId, artifact: testArtifact });
    expect(facts.some((fact) => fact.kind === "frontend_test_assertion" && fact.metadata.assertionType === "endpoint-path")).toBe(true);
  });
});
