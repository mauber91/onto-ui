import type { CanvasLayout, GraphEntity, GraphMode, GraphPayload, GraphRelationship, IngestionRun, OntologyDocument, ProjectSummary, EvidenceRef } from "@onto/domain";

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, { headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, ...init });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `Request failed (${response.status})`);
  return response.json() as Promise<T>;
};

export const getProjects = () => request<{ projects: ProjectSummary[] }>("/api/v1/projects");

export const getGraph = (projectId: string, mode: GraphMode, params: Record<string, string | number | undefined> = {}) => {
  const search = new URLSearchParams({ mode });
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  return request<GraphPayload>(`/api/v1/projects/${projectId}/graph?${search.toString()}`);
};

export const getEntity = (projectId: string, id: string) => request<{ entity: GraphEntity; evidence: EvidenceRef[] }>(`/api/v1/projects/${projectId}/entities/${encodeURIComponent(id)}`);
export const getRelationship = (projectId: string, id: string) => request<{ relationship: GraphRelationship; evidence: EvidenceRef[] }>(`/api/v1/projects/${projectId}/relationships/${encodeURIComponent(id)}`);
export const getOntology = (projectId: string) => request<OntologyDocument>(`/api/v1/projects/${projectId}/ontology`);
export const getRuns = (projectId: string) => request<{ runs: IngestionRun[] }>(`/api/v1/projects/${projectId}/runs`);
export const searchEntities = (projectId: string, query: string) => request<{ results: GraphEntity[] }>(`/api/v1/projects/${projectId}/search?q=${encodeURIComponent(query)}`);
export const rerunIngestion = (projectId: string) => request<IngestionRun>(`/api/v1/projects/${projectId}/ingestion-runs`, { method: "POST", body: JSON.stringify({ fixture: true }) });
export const saveLayout = (projectId: string, layout: CanvasLayout) => request<CanvasLayout>(`/api/v1/projects/${projectId}/layout`, { method: "PUT", body: JSON.stringify(layout) });
