import { describe, expect, it } from "vitest";

import type { DialogueTranslation } from "@/types/translation";
import { TRANSLATION_SCHEMA_VERSION } from "@/lib/translation/translation-config";
import {
  migrateTranslation,
  needsDurationRefresh,
} from "@/lib/translation/translation-migrations";

/**
 * Part 9 translations cost provider credits to produce. Loading one after
 * Part 10 must therefore fill in what is missing rather than discard it — and
 * the defaults have to say what is actually known, not what would look tidy.
 */

/** A Part 9 record: no dubbing metadata, no edit metadata, no revision. */
function partNineTranslation(): DialogueTranslation {
  return {
    id: "translation-1",
    projectId: "project-a",
    sourceMediaId: "media-a",
    dialogueId: "dialogue-a",
    dialogueRevision: 2,
    sourceLanguage: "en",
    targetLanguage: "pl",
    providerId: "openai-compatible",
    providerModel: "gpt-4o-mini",
    version: 1,
    status: "completed",
    createdAt: "2026-08-28T12:00:00.000Z",
    updatedAt: "2026-08-28T12:00:00.000Z",
    usage: { inputTokens: 40, requestCount: 1 },
    segments: [
      {
        id: "ts-1",
        dialogueSegmentId: "d-1",
        speakerId: "speaker_1",
        startTime: 0,
        endTime: 4,
        sourceText: "Thanks for coming today.",
        translatedText: "Dziękuję, że przyszedłeś.",
        sourceLanguage: "en",
        targetLanguage: "pl",
        confidence: null,
      },
    ],
  } as unknown as DialogueTranslation;
}

describe("migrateTranslation", () => {
  it("brings a Part 9 record to the current schema without losing its text", () => {
    const migrated = migrateTranslation(partNineTranslation());

    expect(migrated.version).toBe(TRANSLATION_SCHEMA_VERSION);
    expect(migrated.segments[0].translatedText).toBe("Dziękuję, że przyszedłeś.");
    expect(migrated.segments[0].dialogueSegmentId).toBe("d-1");
    expect(migrated.usage).toEqual({ inputTokens: 40, requestCount: 1 });
  });

  it("keeps the provenance the old record already carried", () => {
    const metadata = migrateTranslation(partNineTranslation()).segments[0]
      .translationMetadata;

    expect(metadata.providerId).toBe("openai-compatible");
    expect(metadata.providerModel).toBe("gpt-4o-mini");
    expect(metadata.generatedAt).toBe("2026-08-28T12:00:00.000Z");
  });

  it("claims no context, because none was used", () => {
    expect(
      migrateTranslation(partNineTranslation()).segments[0].translationMetadata
        .contextSegmentIds,
    ).toEqual([]);
  });

  it("records the line as machine-generated and unedited", () => {
    const segment = migrateTranslation(partNineTranslation()).segments[0];

    expect(segment.translationMetadata.generationMode).toBe("initial");
    expect(segment.editMetadata).toEqual({
      manuallyEdited: false,
      revision: 0,
      editedAt: null,
    });
  });

  it("computes the duration estimate rather than defaulting it", () => {
    // The estimate depends only on text and language, so it is just as valid
    // for old text as for new.
    const metadata = migrateTranslation(partNineTranslation()).segments[0]
      .translationMetadata;

    expect(metadata.sourceDurationSeconds).toBe(4);
    expect(metadata.estimatedDurationSeconds).toBeGreaterThan(0);
    expect(metadata.durationRatio).toBeGreaterThan(0);
    expect(metadata.durationWarning).toBe("none");
    expect(metadata.durationEstimatorVersion).toBe("v1");
  });

  it("starts the translation revision at zero", () => {
    expect(migrateTranslation(partNineTranslation()).revision).toBe(0);
  });

  it("is idempotent", () => {
    const once = migrateTranslation(partNineTranslation());
    const twice = migrateTranslation(once);

    expect(twice).toEqual(once);
  });

  it("leaves a current record untouched", () => {
    const current = migrateTranslation(partNineTranslation());

    expect(migrateTranslation(current)).toBe(current);
  });
});

describe("needsDurationRefresh", () => {
  it("is false for metadata from the current estimator", () => {
    expect(
      needsDurationRefresh(migrateTranslation(partNineTranslation()).segments[0]),
    ).toBe(false);
  });

  it("is true once the estimator moves on", () => {
    const segment = migrateTranslation(partNineTranslation()).segments[0];

    expect(
      needsDurationRefresh({
        ...segment,
        translationMetadata: {
          ...segment.translationMetadata,
          durationEstimatorVersion: "v0",
        },
      }),
    ).toBe(true);
  });
});
