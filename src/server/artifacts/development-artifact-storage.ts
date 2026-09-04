import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ProcessingArtifact } from "@/types/processing-artifact";
import { ProcessingError } from "@/server/processing/processing-errors";
import { defaultTempRoot } from "@/server/processing/temporary-file-manager";
import type {
  ArtifactQuery,
  ProcessingArtifactStorage,
  SaveArtifactBytesInput,
  SaveArtifactInput,
} from "@/server/artifacts/processing-artifact-storage";

/**
 * Development artifact storage.
 *
 * Metadata lives in this process; bytes live under
 * `<os temp>/aidub/artifacts/<artifactId>/<filename>` — outside the job
 * directories, which are wiped when a job ends. Both are development-session
 * scoped: a server restart drops the metadata, and the OS may reclaim the temp
 * directory. Production replaces this with object storage behind the same
 * interface.
 */
export const ARTIFACTS_DIRECTORY_NAME = "artifacts";

export class DevelopmentArtifactStorage implements ProcessingArtifactStorage {
  private readonly artifacts = new Map<string, ProcessingArtifact>();

  constructor(
    private readonly rootDirectory: string = path.join(
      defaultTempRoot(),
      ARTIFACTS_DIRECTORY_NAME,
    ),
    private readonly options: {
      createId?: () => string;
      now?: () => Date;
    } = {},
  ) {}

  private artifactDirectory(artifactId: string): string {
    return path.join(this.rootDirectory, artifactId);
  }

  async save(input: SaveArtifactInput): Promise<ProcessingArtifact> {
    return this.store(input, (destination) =>
      // Copy out of the job directory before that directory is cleaned up.
      copyFile(input.sourcePath, destination),
    );
  }

  async saveBytes(input: SaveArtifactBytesInput): Promise<ProcessingArtifact> {
    return this.store(input, (destination) =>
      writeFile(destination, input.data),
    );
  }

  private async store(
    input: Omit<SaveArtifactInput, "sourcePath">,
    write: (destination: string) => Promise<void>,
  ): Promise<ProcessingArtifact> {
    const id = (this.options.createId ?? randomUUID)();
    const directory = this.artifactDirectory(id);
    const destination = path.join(directory, input.filename);

    try {
      await mkdir(directory, { recursive: true });
      await write(destination);
    } catch (cause) {
      throw new ProcessingError(
        "ARTIFACT_STORAGE_ERROR",
        "The generated file could not be stored.",
        { cause },
      );
    }

    const { size } = await stat(destination);
    const artifact: ProcessingArtifact = {
      id,
      projectId: input.projectId,
      sourceMediaId: input.sourceMediaId,
      jobId: input.jobId,
      type: input.type,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: size,
      sampleRate: input.sampleRate ?? null,
      channels: input.channels ?? null,
      durationSeconds: input.durationSeconds ?? null,
      createdAt: (this.options.now ?? (() => new Date()))().toISOString(),
    };

    this.artifacts.set(id, artifact);

    return artifact;
  }

  async get(artifactId: string): Promise<ProcessingArtifact | null> {
    return this.artifacts.get(artifactId) ?? null;
  }

  async list(query: ArtifactQuery): Promise<ProcessingArtifact[]> {
    return [...this.artifacts.values()]
      .filter(
        (artifact) =>
          artifact.projectId === query.projectId &&
          (query.sourceMediaId === undefined ||
            artifact.sourceMediaId === query.sourceMediaId) &&
          (query.type === undefined || artifact.type === query.type),
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async read(artifactId: string): Promise<Uint8Array | null> {
    const artifact = this.artifacts.get(artifactId);

    if (!artifact) {
      return null;
    }

    try {
      return await readFile(
        path.join(this.artifactDirectory(artifactId), artifact.filename),
      );
    } catch {
      // The OS may have reclaimed the temp directory.
      return null;
    }
  }

  async delete(artifactId: string): Promise<void> {
    this.artifacts.delete(artifactId);
    await rm(this.artifactDirectory(artifactId), {
      recursive: true,
      force: true,
    });
  }

  async deleteByProject(projectId: string): Promise<void> {
    await this.deleteWhere((artifact) => artifact.projectId === projectId);
  }

  async deleteByMedia(sourceMediaId: string): Promise<void> {
    await this.deleteWhere(
      (artifact) => artifact.sourceMediaId === sourceMediaId,
    );
  }

  private async deleteWhere(
    predicate: (artifact: ProcessingArtifact) => boolean,
  ): Promise<void> {
    const doomed = [...this.artifacts.values()].filter(predicate);

    await Promise.all(doomed.map((artifact) => this.delete(artifact.id)));
  }
}
