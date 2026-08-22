import type { Fact } from "@onto/domain";

export type ArtifactKind = "openapi" | "system-manifest" | "source" | "documentation";

export interface ArtifactInput {
  id: string;
  projectId: string;
  kind: ArtifactKind;
  path: string;
  content: string;
  revision?: string;
}

export interface ExtractionContext {
  projectId: string;
  artifact: ArtifactInput;
  now?: string;
}

export interface Extractor {
  id: string;
  version: string;
  supports(artifact: ArtifactInput): boolean;
  extract(artifact: ArtifactInput, context: ExtractionContext): Promise<Fact[]>;
}

export interface ArtifactStore {
  put(artifact: ArtifactInput): Promise<ArtifactInput>;
  get(id: string): Promise<ArtifactInput | undefined>;
}
