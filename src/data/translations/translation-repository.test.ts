import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type {
  DialogueTranslation,
  TranslationIdentity,
} from "@/types/translation";
import { TRANSLATION_SCHEMA_VERSION } from "@/lib/translation/translation-config";
import { DevelopmentTranslationRepository } from "@/data/translations/development-translation-repository";
import { parseStoredTranslation } from "@/data/translations/translation-repository";

/**
 * Translation persistence.
 *
 * The important properties are that a translation survives a restart, that it
 * is only ever found by its exact identity — project, source, dialogue,
 * revision and language pair — and that unreadable stored data is skipped
 * rather than surfaced as a half-translated result.
 */

function translation(
  overrides: Partial<DialogueTranslation> = {},
): DialogueTranslation {
  return {
    id: "translation-1",
    projectId: "project-a",
    sourceMediaId: "media-a",
    dialogueId: "dialogue-a",
    dialogueRevision: 2,
    sourceLanguage: "en",
    targetLanguage: "pl",
    providerId: "mock",
    providerModel: "deterministic-v1",
    version: TRANSLATION_SCHEMA_VERSION,
    status: "completed",
    segments: [
      {
        id: "ts-1",
        dialogueSegmentId: "d-1",
        speakerId: "speaker_1",
        startTime: 0,
        endTime: 2,
        sourceText: "Hello.",
        translatedText: "[pl] Hello.",
        sourceLanguage: "en",
        targetLanguage: "pl",
        confidence: null,
        translationMetadata: {
          providerId: "mock",
          providerModel: "deterministic-v1",
          generationMode: "initial",
          generatedAt: "2026-08-28T12:00:00.000Z",
          contextSegmentIds: [],
          estimatedDurationSeconds: 0.7,
          sourceDurationSeconds: 2,
          durationRatio: 0.35,
          durationWarning: "none",
          durationEstimatorVersion: "v1",
          confidence: null,
        },
        editMetadata: { manuallyEdited: false, revision: 0, editedAt: null },
      },
    ],
    createdAt: "2026-08-28T12:00:00.000Z",
    updatedAt: "2026-08-28T12:00:00.000Z",
    revision: 0,
    usage: { inputCharacters: 6, requestCount: 1 },
    ...overrides,
  };
}

const identity: TranslationIdentity = {
  projectId: "project-a",
  sourceMediaId: "media-a",
  dialogueId: "dialogue-a",
  dialogueRevision: 2,
  sourceLanguage: "en",
  targetLanguage: "pl",
};

describe("DevelopmentTranslationRepository", () => {
  let root: string;
  let repository: DevelopmentTranslationRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aidub-translations-"));
    repository = new DevelopmentTranslationRepository(root);
  });

  it("stores and reads a translation back by identity", async () => {
    await repository.save(translation());

    expect(await repository.getByIdentity(identity)).toEqual(translation());
  });

  it("survives a new repository instance over the same directory", async () => {
    await repository.save(translation());

    const reopened = new DevelopmentTranslationRepository(root);

    expect(await reopened.getByIdentity(identity)).toEqual(translation());
  });

  it("does not return a translation of another dialogue revision", async () => {
    await repository.save(translation());

    expect(
      await repository.getByIdentity({ ...identity, dialogueRevision: 3 }),
    ).toBeNull();
  });

  it("does not return a translation for another target language", async () => {
    await repository.save(translation());

    expect(
      await repository.getByIdentity({ ...identity, targetLanguage: "fr" }),
    ).toBeNull();
  });

  it("does not return a translation for another source language", async () => {
    await repository.save(translation());

    expect(
      await repository.getByIdentity({ ...identity, sourceLanguage: "de" }),
    ).toBeNull();
  });

  it("keeps several target languages for the same dialogue side by side", async () => {
    await repository.save(translation());
    await repository.save(
      translation({
        id: "translation-2",
        targetLanguage: "fr",
        segments: [],
      }),
    );

    const polish = await repository.getByIdentity(identity);
    const french = await repository.getByIdentity({
      ...identity,
      targetLanguage: "fr",
    });

    expect(polish?.id).toBe("translation-1");
    expect(french?.id).toBe("translation-2");
  });

  it("keeps projects isolated", async () => {
    await repository.save(translation());
    await repository.save(
      translation({ id: "translation-b", projectId: "project-b" }),
    );

    expect((await repository.listByProject("project-a")).map((t) => t.id)).toEqual(
      ["translation-1"],
    );
    expect((await repository.listByProject("project-b")).map((t) => t.id)).toEqual(
      ["translation-b"],
    );
  });

  it("deleting one project leaves the other alone", async () => {
    await repository.save(translation());
    await repository.save(
      translation({ id: "translation-b", projectId: "project-b" }),
    );

    await repository.deleteByProject("project-a");

    expect(await repository.listByProject("project-a")).toEqual([]);
    expect(await repository.listByProject("project-b")).toHaveLength(1);
  });

  it("deletes by source media without touching other sources", async () => {
    await repository.save(translation());
    await repository.save(
      translation({ id: "translation-2", sourceMediaId: "media-b" }),
    );

    await repository.deleteByMedia("project-a", "media-a");

    const remaining = await repository.listByProject("project-a");

    expect(remaining.map((t) => t.sourceMediaId)).toEqual(["media-b"]);
  });

  it("lists every translation of one dialogue across revisions", async () => {
    await repository.save(translation());
    await repository.save(
      translation({ id: "translation-2", dialogueRevision: 3 }),
    );

    const all = await repository.listByDialogue("project-a", "dialogue-a");

    expect(all.map((t) => t.dialogueRevision).sort()).toEqual([2, 3]);
  });

  it("skips unreadable stored files instead of crashing", async () => {
    await repository.save(translation());
    await mkdir(path.join(root, "project-a"), { recursive: true });
    await writeFile(
      path.join(root, "project-a", "broken.json"),
      "{ not json",
      "utf8",
    );

    expect(await repository.listByProject("project-a")).toHaveLength(1);
  });
});

describe("parseStoredTranslation", () => {
  it("rejects a record whose segment has lost its dialogue segment id", () => {
    const broken = translation();
    // A translated line with no dialogue behind it cannot be joined to
    // anything, so the whole record is treated as unusable.
    const record = JSON.parse(JSON.stringify(broken)) as Record<string, unknown>;
    (record.segments as Record<string, unknown>[])[0].dialogueSegmentId = "";

    expect(parseStoredTranslation(record)).toBeNull();
  });

  it("drops a usage object with nothing measurable in it", () => {
    const parsed = parseStoredTranslation({
      ...JSON.parse(JSON.stringify(translation())),
      usage: {},
    });

    expect(parsed?.usage).toBeNull();
  });

  it("never keeps an out-of-range confidence", () => {
    const record = JSON.parse(
      JSON.stringify(translation()),
    ) as Record<string, unknown>;
    (record.segments as Record<string, unknown>[])[0].confidence = 4;

    expect(parseStoredTranslation(record)?.segments[0].confidence).toBeNull();
  });

  it("migrates a Part 9 record on read rather than discarding it", () => {
    const partNine = JSON.parse(
      JSON.stringify(translation()),
    ) as Record<string, unknown>;
    partNine.version = 1;
    delete partNine.revision;
    const segments = partNine.segments as Record<string, unknown>[];
    delete segments[0].translationMetadata;
    delete segments[0].editMetadata;

    const parsed = parseStoredTranslation(partNine);

    expect(parsed?.version).toBe(TRANSLATION_SCHEMA_VERSION);
    expect(parsed?.segments[0].translatedText).toBe("[pl] Hello.");
    expect(parsed?.segments[0].translationMetadata.generationMode).toBe(
      "initial",
    );
    expect(parsed?.segments[0].translationMetadata.contextSegmentIds).toEqual([]);
    expect(parsed?.segments[0].editMetadata.manuallyEdited).toBe(false);
    expect(parsed?.revision).toBe(0);
  });

  it("keeps Part 10 metadata that is already stored", () => {
    const parsed = parseStoredTranslation(
      JSON.parse(JSON.stringify(translation({ revision: 3 }))),
    );

    expect(parsed?.revision).toBe(3);
    expect(parsed?.segments[0].translationMetadata.durationRatio).toBe(0.35);
  });

  it("rejects a record with no dialogue revision", () => {
    const record = JSON.parse(
      JSON.stringify(translation()),
    ) as Record<string, unknown>;
    delete record.dialogueRevision;

    expect(parseStoredTranslation(record)).toBeNull();
  });
});
