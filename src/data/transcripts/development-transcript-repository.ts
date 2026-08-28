import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Transcript } from "@/types/transcript";
import { defaultTempRoot } from "@/server/processing/temporary-file-manager";
import {
  TranscriptStorageError,
  parseStoredTranscript,
  type TranscriptRepository,
} from "@/data/transcripts/transcript-repository";

/**
 * Development transcript persistence: one JSON file per transcript under
 * `<os temp>/aidub/transcripts/v1/<projectId>/<transcriptId>.json`.
 *
 * Transcripts are small structured text, and the transcription pipeline runs
 * server-side, so the server owns this store: it can guarantee that a
 * transcript is only written after normalisation and validation succeed, which
 * a browser-side store could not.
 *
 * The `v1` path segment is the schema version. Adding speakers, translations,
 * edits or word timestamps later means writing `v2` alongside it and migrating
 * on read — existing transcripts are never thrown away for a field addition.
 *
 * Limitations, deliberately accepted: this is the OS temp directory, so the
 * platform may reclaim it, and it is local to one machine. Production replaces
 * it with a database behind the same `TranscriptRepository` interface.
 */

export const TRANSCRIPT_SCHEMA_VERSION = "v1";
export const TRANSCRIPTS_DIRECTORY_NAME = "transcripts";

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function assertSafeSegment(value: string): string {
  if (!SAFE_SEGMENT.test(value) || value === "." || value === "..") {
    throw new TranscriptStorageError("Invalid transcript identifier.");
  }

  return value;
}

export class DevelopmentTranscriptRepository implements TranscriptRepository {
  constructor(
    private readonly rootDirectory: string = path.join(
      defaultTempRoot(),
      TRANSCRIPTS_DIRECTORY_NAME,
      TRANSCRIPT_SCHEMA_VERSION,
    ),
  ) {}

  private projectDirectory(projectId: string): string {
    return path.join(this.rootDirectory, assertSafeSegment(projectId));
  }

  private transcriptPath(projectId: string, transcriptId: string): string {
    return path.join(
      this.projectDirectory(projectId),
      `${assertSafeSegment(transcriptId)}.json`,
    );
  }

  async save(transcript: Transcript): Promise<Transcript> {
    const directory = this.projectDirectory(transcript.projectId);

    try {
      await mkdir(directory, { recursive: true });
      await writeFile(
        this.transcriptPath(transcript.projectId, transcript.id),
        JSON.stringify(transcript, null, 2),
        "utf8",
      );
    } catch (cause) {
      throw new TranscriptStorageError("The transcript could not be saved.", {
        cause,
      });
    }

    return transcript;
  }

  async getById(id: string): Promise<Transcript | null> {
    for (const transcript of await this.readAll()) {
      if (transcript.id === id) {
        return transcript;
      }
    }

    return null;
  }

  async getByProject(
    projectId: string,
    sourceMediaId: string,
  ): Promise<Transcript | null> {
    const matches = (await this.listByProject(projectId)).filter(
      // Both ids must match: a transcript belongs to one project *and* one
      // exact source media version.
      (transcript) => transcript.sourceMediaId === sourceMediaId,
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

  async listByProject(projectId: string): Promise<Transcript[]> {
    return this.readProject(projectId);
  }

  async delete(id: string): Promise<void> {
    for (const projectId of await this.listProjectIds()) {
      for (const transcript of await this.readProject(projectId)) {
        if (transcript.id === id) {
          await rm(this.transcriptPath(projectId, id), { force: true });
          return;
        }
      }
    }
  }

  async deleteByMedia(
    projectId: string,
    sourceMediaId: string,
  ): Promise<void> {
    for (const transcript of await this.readProject(projectId)) {
      if (transcript.sourceMediaId === sourceMediaId) {
        await rm(this.transcriptPath(projectId, transcript.id), {
          force: true,
        });
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

  private async readProject(projectId: string): Promise<Transcript[]> {
    let files: string[];

    try {
      files = await readdir(this.projectDirectory(projectId));
    } catch {
      return [];
    }

    const transcripts: Transcript[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      try {
        const raw = await readFile(
          path.join(this.projectDirectory(projectId), file),
          "utf8",
        );
        const parsed = parseStoredTranscript(JSON.parse(raw));

        // Unreadable or malformed development data is skipped rather than
        // crashing the workspace.
        if (parsed && parsed.projectId === projectId) {
          transcripts.push(parsed);
        }
      } catch {
        continue;
      }
    }

    return transcripts;
  }

  private async readAll(): Promise<Transcript[]> {
    const all: Transcript[] = [];

    for (const projectId of await this.listProjectIds()) {
      all.push(...(await this.readProject(projectId)));
    }

    return all;
  }
}
