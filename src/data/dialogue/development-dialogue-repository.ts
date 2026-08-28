import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { UnifiedDialogue } from "@/types/dialogue";
import { defaultTempRoot } from "@/server/processing/temporary-file-manager";
import {
  DialogueStorageError,
  parseStoredDialogue,
  type UnifiedDialogueRepository,
} from "@/data/dialogue/dialogue-repository";

/**
 * Development dialogue persistence: one JSON file per dialogue under
 * `<os temp>/aidub/dialogues/v1/<projectId>/<dialogueId>.json`.
 *
 * The same convention as Part 5 transcripts and Part 6 diarizations, and for
 * the same reason: the raw inputs and the merge both live server-side, so the
 * server owns this store and can guarantee a dialogue is only written after
 * the merge validates. Reopening a project reads this file rather than
 * merging again.
 *
 * The `v1` path segment is the storage schema version, separate from the merge
 * algorithm version recorded inside each record. Part 8 will add edited text,
 * revisions and manual speaker corrections; that means writing `v2` alongside
 * this and migrating on read, not discarding existing dialogues.
 *
 * Limitations, deliberately accepted: this is the OS temp directory, so the
 * platform may reclaim it, and it is local to one machine. Production replaces
 * it with a database behind the same `UnifiedDialogueRepository` interface.
 */

export const DIALOGUE_STORAGE_VERSION = "v1";
export const DIALOGUES_DIRECTORY_NAME = "dialogues";

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function assertSafeSegment(value: string): string {
  if (!SAFE_SEGMENT.test(value) || value === "." || value === "..") {
    throw new DialogueStorageError("Invalid dialogue identifier.");
  }

  return value;
}

export class DevelopmentDialogueRepository
  implements UnifiedDialogueRepository
{
  constructor(
    private readonly rootDirectory: string = path.join(
      defaultTempRoot(),
      DIALOGUES_DIRECTORY_NAME,
      DIALOGUE_STORAGE_VERSION,
    ),
  ) {}

  private projectDirectory(projectId: string): string {
    return path.join(this.rootDirectory, assertSafeSegment(projectId));
  }

  private dialoguePath(projectId: string, dialogueId: string): string {
    return path.join(
      this.projectDirectory(projectId),
      `${assertSafeSegment(dialogueId)}.json`,
    );
  }

  async save(dialogue: UnifiedDialogue): Promise<UnifiedDialogue> {
    try {
      await mkdir(this.projectDirectory(dialogue.projectId), {
        recursive: true,
      });
      await writeFile(
        this.dialoguePath(dialogue.projectId, dialogue.id),
        JSON.stringify(dialogue, null, 2),
        "utf8",
      );
    } catch (cause) {
      throw new DialogueStorageError("The dialogue could not be saved.", {
        cause,
      });
    }

    return dialogue;
  }

  async getById(id: string): Promise<UnifiedDialogue | null> {
    for (const dialogue of await this.readAll()) {
      if (dialogue.id === id) {
        return dialogue;
      }
    }

    return null;
  }

  async getByProjectAndSource(
    projectId: string,
    sourceMediaId: string,
  ): Promise<UnifiedDialogue | null> {
    const matches = (await this.listByProject(projectId)).filter(
      // Both ids must match: a dialogue belongs to one project *and* one exact
      // source media version.
      (dialogue) => dialogue.sourceMediaId === sourceMediaId,
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

  async listByProject(projectId: string): Promise<UnifiedDialogue[]> {
    return this.readProject(projectId);
  }

  async delete(id: string): Promise<void> {
    for (const projectId of await this.listProjectIds()) {
      for (const dialogue of await this.readProject(projectId)) {
        if (dialogue.id === id) {
          await rm(this.dialoguePath(projectId, id), { force: true });
          return;
        }
      }
    }
  }

  async deleteByMedia(
    projectId: string,
    sourceMediaId: string,
  ): Promise<void> {
    for (const dialogue of await this.readProject(projectId)) {
      if (dialogue.sourceMediaId === sourceMediaId) {
        await rm(this.dialoguePath(projectId, dialogue.id), { force: true });
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

  private async readProject(projectId: string): Promise<UnifiedDialogue[]> {
    let files: string[];

    try {
      files = await readdir(this.projectDirectory(projectId));
    } catch {
      return [];
    }

    const dialogues: UnifiedDialogue[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      try {
        const raw = await readFile(
          path.join(this.projectDirectory(projectId), file),
          "utf8",
        );
        const parsed = parseStoredDialogue(JSON.parse(raw));

        // Unreadable or malformed development data is skipped rather than
        // crashing the workspace; the raw inputs can always regenerate it.
        if (parsed && parsed.projectId === projectId) {
          dialogues.push(parsed);
        }
      } catch {
        continue;
      }
    }

    return dialogues;
  }

  private async readAll(): Promise<UnifiedDialogue[]> {
    const all: UnifiedDialogue[] = [];

    for (const projectId of await this.listProjectIds()) {
      all.push(...(await this.readProject(projectId)));
    }

    return all;
  }
}
