import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DiarizationResult } from "@/types/diarization";
import { defaultTempRoot } from "@/server/processing/temporary-file-manager";
import {
  DiarizationStorageError,
  parseStoredDiarization,
  type DiarizationRepository,
} from "@/data/diarization/diarization-repository";

/**
 * Development diarization persistence: one JSON file per result under
 * `<os temp>/aidub/diarizations/v1/<projectId>/<diarizationId>.json`.
 *
 * The same convention as Part 5 transcripts, and for the same reason: the
 * pipeline runs server-side, so the server owns the store and can guarantee a
 * result is only written after normalisation and validation succeed — which a
 * browser-side store could not. Reopening a project reads this file instead of
 * rerunning the model.
 *
 * The `v1` path segment is the schema version. Speaker names, embeddings,
 * manual reassignment, region edits and merge/split metadata will arrive in
 * later parts; adding them means writing `v2` alongside this and migrating on
 * read — existing results are never thrown away for a field addition.
 *
 * Limitations, deliberately accepted: this is the OS temp directory, so the
 * platform may reclaim it, and it is local to one machine. Production replaces
 * it with a database behind the same `DiarizationRepository` interface.
 */

export const DIARIZATION_SCHEMA_VERSION = "v1";
export const DIARIZATIONS_DIRECTORY_NAME = "diarizations";

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function assertSafeSegment(value: string): string {
  if (!SAFE_SEGMENT.test(value) || value === "." || value === "..") {
    throw new DiarizationStorageError("Invalid diarization identifier.");
  }

  return value;
}

export class DevelopmentDiarizationRepository implements DiarizationRepository {
  constructor(
    private readonly rootDirectory: string = path.join(
      defaultTempRoot(),
      DIARIZATIONS_DIRECTORY_NAME,
      DIARIZATION_SCHEMA_VERSION,
    ),
  ) {}

  private projectDirectory(projectId: string): string {
    return path.join(this.rootDirectory, assertSafeSegment(projectId));
  }

  private resultPath(projectId: string, diarizationId: string): string {
    return path.join(
      this.projectDirectory(projectId),
      `${assertSafeSegment(diarizationId)}.json`,
    );
  }

  async save(result: DiarizationResult): Promise<DiarizationResult> {
    try {
      await mkdir(this.projectDirectory(result.projectId), { recursive: true });
      await writeFile(
        this.resultPath(result.projectId, result.id),
        JSON.stringify(result, null, 2),
        "utf8",
      );
    } catch (cause) {
      throw new DiarizationStorageError(
        "The speaker analysis could not be saved.",
        { cause },
      );
    }

    return result;
  }

  async getById(id: string): Promise<DiarizationResult | null> {
    for (const result of await this.readAll()) {
      if (result.id === id) {
        return result;
      }
    }

    return null;
  }

  async getByProjectAndSource(
    projectId: string,
    sourceMediaId: string,
  ): Promise<DiarizationResult | null> {
    const matches = (await this.listByProject(projectId)).filter(
      // Both ids must match: a diarization belongs to one project *and* one
      // exact source media version.
      (result) => result.sourceMediaId === sourceMediaId,
    );

    if (matches.length === 0) {
      return null;
    }

    // Newest wins, with the id as a tie-breaker so two records written in the
    // same millisecond still resolve deterministically.
    return matches.sort(
      (a, b) =>
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    )[0];
  }

  async listByProject(projectId: string): Promise<DiarizationResult[]> {
    return this.readProject(projectId);
  }

  async delete(id: string): Promise<void> {
    for (const projectId of await this.listProjectIds()) {
      for (const result of await this.readProject(projectId)) {
        if (result.id === id) {
          await rm(this.resultPath(projectId, id), { force: true });
          return;
        }
      }
    }
  }

  async deleteByMedia(
    projectId: string,
    sourceMediaId: string,
  ): Promise<void> {
    for (const result of await this.readProject(projectId)) {
      if (result.sourceMediaId === sourceMediaId) {
        await rm(this.resultPath(projectId, result.id), { force: true });
      }
    }
  }

  async deleteByProject(projectId: string): Promise<void> {
    await rm(this.projectDirectory(projectId), {
      recursive: true,
      force: true,
    });
  }

  private async listProjectIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.rootDirectory, {
        withFileTypes: true,
      });

      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  private async readProject(projectId: string): Promise<DiarizationResult[]> {
    let files: string[];

    try {
      files = await readdir(this.projectDirectory(projectId));
    } catch {
      return [];
    }

    const results: DiarizationResult[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      try {
        const raw = await readFile(
          path.join(this.projectDirectory(projectId), file),
          "utf8",
        );
        const parsed = parseStoredDiarization(JSON.parse(raw));

        // Unreadable or malformed development data is skipped rather than
        // crashing the workspace.
        if (parsed && parsed.projectId === projectId) {
          results.push(parsed);
        }
      } catch {
        continue;
      }
    }

    return results;
  }

  private async readAll(): Promise<DiarizationResult[]> {
    const all: DiarizationResult[] = [];

    for (const projectId of await this.listProjectIds()) {
      all.push(...(await this.readProject(projectId)));
    }

    return all;
  }
}
