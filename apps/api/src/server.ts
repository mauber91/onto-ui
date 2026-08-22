import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { CanvasLayout, GraphMode } from "@onto/domain";
import type { ArtifactInput } from "@onto/extractor-sdk";
import { store } from "./store.js";

const app = Fastify({ logger: false });

await app.register(cors, { origin: true });
await store.initialize();

app.get("/health", async () => ({ ok: true, service: "onto-api", time: new Date().toISOString() }));

app.get("/api/v1/projects", async () => ({ projects: store.listProjects() }));

app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId", async (request, reply) => {
  const project = store.getProject(request.params.projectId);
  if (!project) return reply.code(404).send({ error: "Project not found" });
  return project;
});

app.get<{ Params: { projectId: string }; Querystring: Record<string, string | undefined> }>("/api/v1/projects/:projectId/graph", async (request, reply) => {
  const query = request.query;
  const modeResult = GraphMode.safeParse(query.mode ?? "system");
  if (!modeResult.success) return reply.code(400).send({ error: "mode must be system or ontology" });
  try {
    return store.getGraph(request.params.projectId, modeResult.data, {
      type: query.type,
      relation: query.relation,
      domain: query.domain,
      source: query.source,
      search: query.search,
      focus: query.focus,
      depth: query.depth ? Number(query.depth) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      confidence: query.confidence ? Number(query.confidence) : undefined
    });
  } catch (error) {
    return reply.code(404).send({ error: error instanceof Error ? error.message : "Graph unavailable" });
  }
});

app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/ontology", async (request, reply) => {
  const ontology = store.getOntology(request.params.projectId);
  if (!ontology) return reply.code(404).send({ error: "Project not found" });
  return ontology;
});

app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/runs", async (request) => ({ runs: store.getRuns(request.params.projectId) }));

const IngestionRequest = z.object({
  fixture: z.boolean().optional(),
  artifacts: z.array(z.object({ path: z.string().min(1).max(500), content: z.string().min(1).max(2_000_000), kind: z.enum(["openapi", "system-manifest"]).default("openapi") })).max(20).optional()
});

app.post<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/ingestion-runs", async (request, reply) => {
  try {
    const parsed = IngestionRequest.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    let run;
    if (parsed.data.artifacts?.length) {
      const artifacts: ArtifactInput[] = parsed.data.artifacts.map((artifact, index) => ({
        id: `uploaded_${Date.now()}_${index}`,
        projectId: request.params.projectId,
        kind: artifact.kind,
        path: artifact.path,
        content: artifact.content,
        revision: `upload-${Date.now()}`
      }));
      run = await store.ingest(request.params.projectId, artifacts);
    } else {
      run = await store.ingestFixture(request.params.projectId);
    }
    return reply.code(202).send(run);
  } catch (error) {
    return reply.code(404).send({ error: error instanceof Error ? error.message : "Unable to start ingestion" });
  }
});

app.get<{ Params: { projectId: string; id: string } }>("/api/v1/projects/:projectId/entities/:id", async (request, reply) => {
  const entity = store.getEntity(request.params.projectId, request.params.id);
  if (!entity) return reply.code(404).send({ error: "Entity not found" });
  return { entity, evidence: store.getEvidence(request.params.projectId, entity.id) };
});

app.get<{ Params: { projectId: string; id: string } }>("/api/v1/projects/:projectId/relationships/:id", async (request, reply) => {
  const relationship = store.getRelationship(request.params.projectId, request.params.id);
  if (!relationship) return reply.code(404).send({ error: "Relationship not found" });
  return { relationship, evidence: store.getEvidence(request.params.projectId, relationship.id) };
});

app.get<{ Params: { projectId: string }; Querystring: { q?: string } }>("/api/v1/projects/:projectId/search", async (request) => ({ results: store.search(request.params.projectId, request.query.q ?? "") }));

app.get<{ Params: { projectId: string }; Querystring: { mode?: string } }>("/api/v1/projects/:projectId/layout", async (request) => {
  const mode = GraphMode.safeParse(request.query.mode ?? "system");
  if (!mode.success) return { layout: null };
  return { layout: store.getLayout(request.params.projectId, mode.data) ?? null };
});

app.put<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/layout", async (request, reply) => {
  const parsed = CanvasLayout.safeParse({ ...(request.body as object), projectId: request.params.projectId });
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  return store.saveLayout(request.params.projectId, parsed.data);
});

app.setErrorHandler((error, _request, reply) => {
  reply.code(500).send({ error: error instanceof Error ? error.message : "Unexpected server error" });
});

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
console.log(`Onto API listening on http://localhost:${port}`);

export { app };
