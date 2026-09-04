import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { GeneratedSpeechSegment } from "@/types/tts";
import { defaultTempRoot } from "@/server/processing/temporary-file-manager";
import {
  generatedSpeechId,
  GeneratedSpeechStorageError,
  matchesGeneratedSpeechIdentity,
  parseStoredGeneratedSpeech,
  type GeneratedSpeechIdentity,
  type GeneratedSpeechRepository,
} from "@/data/tts/generated-speech-repository";

/**
 * Development generated-speech persistence: one JSON file per line under
 * `<os temp>/aidub/generated-speech/v1/<projectId>/<recordId>.json`.
 *
 * Metadata only. The audio itself is an artifact, stored and served by the
 * artifact layer — so this directory stays small enough to read in full on
 * every workspace load, and losing it costs a regeneration rather than the
 * casting decisions next door in `voice-assignments`.
 *
 * The file name is the deterministic `generatedSpeechId`, so regenerating one
 * line overwrites one file. Production replaces this with a database behind the
 * same interface.
 */

export const GENERATED_SPEECH_STORAGE_VERSION = "v1";
export const GENERATED_SPEECH_DIRECTORY_NAME = "generated-speech";

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function assertSafeSegment(value: string): string {
  if (!SAFE_SEGMENT.test(value) || value === "." || value === "..") {
    throw new GeneratedSpeechStorageError("Invalid generated speech identifier.");
  }

  return value;
}

export class DevelopmentGeneratedSpeechRepository
  implements GeneratedSpeechRepository
{
  constructor(
    private readonly rootDirectory: string = path.join(
      defaultTempRoot(),
      GENERATED_SPEECH_DIRECTORY_NAME,
      GENERATED_SPEECH_STORAGE_VERSION,
    ),
  ) {}

  private projectDirectory(projectId: string): string {
    return path.join(this.rootDirectory, assertSafeSegment(projectId));
  }

  private segmentPath(projectId: string, recordId: string): string {
    return path.join(
      this.projectDirectory(projectId),
      `${assertSafeSegment(recordId)}.json`,
    );
  }

  async save(
    segment: GeneratedSpeechSegment,
  ): Promise<GeneratedSpeechSegment> {
    try {
      await mkdir(this.projectDirectory(segment.projectId), {
        recursive: true,
      });
      await writeFile(
        this.segmentPath(segment.projectId, segment.id),
        JSON.stringify(segment, null, 2),
        "utf8",
      );
    } catch (cause) {
      throw new GeneratedSpeechStorageError(
        "The generated speech record could not be saved.",
        { cause },
      );
    }

    return segment;
  }

  async saveAll(
    segments: readonly GeneratedSpeechSegment[],
  ): Promise<GeneratedSpeechSegment[]> {
    const saved: GeneratedSpeechSegment[] = [];

    // Sequential on purpose: these are small writes into one directory, and a
    // parallel burst of hundreds buys nothing but file-descriptor pressure.
    for (const segment of segments) {
      saved.push(await this.save(segment));
    }

    return saved;
  }

  async listByIdentity(
    identity: GeneratedSpeechIdentity,
  ): Promise<GeneratedSpeechSegment[]> {
    return (await this.readProject(identity.projectId)).filter((segment) =>
      matchesGeneratedSpeechIdentity(segment, identity),
    );
  }

  async getBySegment(
    identity: GeneratedSpeechIdentity,
    dialogueSegmentId: string,
  ): Promise<GeneratedSpeechSegment | null> {
    const segments = await this.listByIdentity(identity);

    return (
      segments.find(
        (segment) => segment.dialogueSegmentId === dialogueSegmentId,
      ) ?? null
    );
  }

  async getById(id: string): Promise<GeneratedSpeechSegment | null> {
    for (const projectId of await this.listProjectIds()) {
      for (const segment of await this.readProject(projectId)) {
        if (segment.id === id) {
          return segment;
        }
      }
    }

    return null;
  }

  async delete(
    identity: GeneratedSpeechIdentity,
    dialogueSegmentId: string,
  ): Promise<void> {
    await rm(
      this.segmentPath(
        identity.projectId,
        generatedSpeechId(identity, dialogueSegmentId),
      ),
      { force: true },
    );
  }

  async deleteByMedia(
    projectId: string,
    sourceMediaId: string,
  ): Promise<void> {
    for (const segment of await this.readProject(projectId)) {
      if (segment.sourceMediaId === sourceMediaId) {
        await rm(this.segmentPath(projectId, segment.id), { force: true });
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

  private async readProject(
    projectId: string,
  ): Promise<GeneratedSpeechSegment[]> {
    let files: string[];

    try {
      files = await readdir(this.projectDirectory(projectId));
    } catch {
      return [];
    }

    const segments: GeneratedSpeechSegment[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      try {
        const raw = await readFile(
          path.join(this.projectDirectory(projectId), file),
          "utf8",
        );
        const parsed = parseStoredGeneratedSpeech(JSON.parse(raw));

        if (parsed && parsed.projectId === projectId) {
          segments.push(parsed);
        }
      } catch {
        continue;
      }
    }

    return segments;
  }
}
