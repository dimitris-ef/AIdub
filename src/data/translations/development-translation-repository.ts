import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  DialogueTranslation,
  TranslationIdentity,
} from "@/types/translation";
import { defaultTempRoot } from "@/server/processing/temporary-file-manager";
import {
  TranslationStorageError,
  matchesIdentity,
  newestFirst,
  parseStoredTranslation,
  type TranslationRepository,
} from "@/data/translations/translation-repository";

/**
 * Development translation persistence: one JSON file per translation under
 * `<os temp>/aidub/translations/v1/<projectId>/<translationId>.json`.
 *
 * The same convention as Part 5 transcripts, Part 6 diarizations and Part 7
 * dialogues, and for the same reason: translation runs server-side (a provider
 * credential must never reach the browser), so the server owns the store and
 * can guarantee a translation is only written after it has been validated.
 * Reopening a project reads this file instead of paying a provider again.
 *
 * The `v1` path segment is the storage schema version, separate from the
 * provider and model recorded inside each record. Later parts adding alternate
 * takes, approved text or translation edits write `v2` alongside this and
 * migrate on read — a schema addition must never cost a user a translation
 * they paid for.
 *
 * Limitations, deliberately accepted: this is the OS temp directory, so the
 * platform may reclaim it, and it is local to one machine. Production replaces
 * it with a database behind the same `TranslationRepository` interface.
 */

export const TRANSLATION_STORAGE_VERSION = "v1";
export const TRANSLATIONS_DIRECTORY_NAME = "translations";

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function assertSafeSegment(value: string): string {
  if (!SAFE_SEGMENT.test(value) || value === "." || value === "..") {
    throw new TranslationStorageError("Invalid translation identifier.");
  }

  return value;
}

export class DevelopmentTranslationRepository implements TranslationRepository {
  constructor(
    private readonly rootDirectory: string = path.join(
      defaultTempRoot(),
      TRANSLATIONS_DIRECTORY_NAME,
      TRANSLATION_STORAGE_VERSION,
    ),
  ) {}

  private projectDirectory(projectId: string): string {
    return path.join(this.rootDirectory, assertSafeSegment(projectId));
  }

  private translationPath(projectId: string, translationId: string): string {
    return path.join(
      this.projectDirectory(projectId),
      `${assertSafeSegment(translationId)}.json`,
    );
  }

  async save(translation: DialogueTranslation): Promise<DialogueTranslation> {
    try {
      await mkdir(this.projectDirectory(translation.projectId), {
        recursive: true,
      });
      await writeFile(
        this.translationPath(translation.projectId, translation.id),
        JSON.stringify(translation, null, 2),
        "utf8",
      );
    } catch (cause) {
      throw new TranslationStorageError(
        "The translation could not be saved.",
        { cause },
      );
    }

    return translation;
  }

  async getById(id: string): Promise<DialogueTranslation | null> {
    for (const translation of await this.readAll()) {
      if (translation.id === id) {
        return translation;
      }
    }

    return null;
  }

  async getByIdentity(
    identity: TranslationIdentity,
  ): Promise<DialogueTranslation | null> {
    const matches = (await this.readProject(identity.projectId)).filter(
      (translation) => matchesIdentity(translation, identity),
    );

    return matches.length > 0 ? newestFirst(matches)[0] : null;
  }

  async listByProject(projectId: string): Promise<DialogueTranslation[]> {
    return newestFirst(await this.readProject(projectId));
  }

  async listByDialogue(
    projectId: string,
    dialogueId: string,
  ): Promise<DialogueTranslation[]> {
    return newestFirst(
      (await this.readProject(projectId)).filter(
        (translation) => translation.dialogueId === dialogueId,
      ),
    );
  }

  async delete(id: string): Promise<void> {
    for (const projectId of await this.listProjectIds()) {
      for (const translation of await this.readProject(projectId)) {
        if (translation.id === id) {
          await rm(this.translationPath(projectId, id), { force: true });
          return;
        }
      }
    }
  }

  async deleteByMedia(
    projectId: string,
    sourceMediaId: string,
  ): Promise<void> {
    for (const translation of await this.readProject(projectId)) {
      if (translation.sourceMediaId === sourceMediaId) {
        await rm(this.translationPath(projectId, translation.id), {
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

  private async readProject(projectId: string): Promise<DialogueTranslation[]> {
    let files: string[];

    try {
      files = await readdir(this.projectDirectory(projectId));
    } catch {
      return [];
    }

    const translations: DialogueTranslation[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      try {
        const raw = await readFile(
          path.join(this.projectDirectory(projectId), file),
          "utf8",
        );
        const parsed = parseStoredTranslation(JSON.parse(raw));

        // Unreadable development data is skipped rather than crashing the
        // workspace; the dialogue can always produce a new translation.
        if (parsed && parsed.projectId === projectId) {
          translations.push(parsed);
        }
      } catch {
        continue;
      }
    }

    return translations;
  }

  private async readAll(): Promise<DialogueTranslation[]> {
    const all: DialogueTranslation[] = [];

    for (const projectId of await this.listProjectIds()) {
      all.push(...(await this.readProject(projectId)));
    }

    return all;
  }
}
