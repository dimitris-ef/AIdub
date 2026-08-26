import type {
  ProcessingArtifact,
  ProcessingArtifactType,
} from "@/types/processing-artifact";

/**
 * Storage for *generated* processing output, kept deliberately separate from
 * Part 3's source-media storage: different producer, different lifecycle,
 * different retention. Source video belongs to the project; artifacts belong
 * to the job that produced them.
 */

export interface SaveArtifactInput {
  projectId: string;
  sourceMediaId: string;
  jobId: string;
  type: ProcessingArtifactType;
  filename: string;
  mimeType: string;
  /** Path of the generated file inside the job's temporary directory. */
  sourcePath: string;
  sampleRate?: number | null;
  channels?: number | null;
  durationSeconds?: number | null;
}

export interface ArtifactQuery {
  projectId: string;
  sourceMediaId?: string;
  type?: ProcessingArtifactType;
}

export interface ProcessingArtifactStorage {
  save(input: SaveArtifactInput): Promise<ProcessingArtifact>;
  get(artifactId: string): Promise<ProcessingArtifact | null>;
  /** Artifacts matching a scope, newest first. */
  list(query: ArtifactQuery): Promise<ProcessingArtifact[]>;
  /** Bytes for download; null when the artifact is gone. */
  read(artifactId: string): Promise<Uint8Array | null>;
  delete(artifactId: string): Promise<void>;
  deleteByProject(projectId: string): Promise<void>;
  deleteByMedia(sourceMediaId: string): Promise<void>;
}
