import { describe, expect, it } from "vitest";

import type { UnifiedDialogue } from "@/types/dialogue";
import type { DialogueTranslation } from "@/types/translation";
import { TRANSLATION_SCHEMA_VERSION } from "@/lib/translation/translation-config";
import {
  isTranslationCurrent,
  translationCurrency,
} from "@/lib/translation/translation-staleness";

/**
 * A translation is only valid for exactly what it translated. These tests pin
 * each part of that identity, because the failure they prevent — showing
 * translated text for a sentence the user has since rewritten — is silent.
 */

function dialogue(overrides: Partial<UnifiedDialogue> = {}): UnifiedDialogue {
  return {
    id: "dialogue-1",
    projectId: "project-1",
    sourceMediaId: "media-1",
    transcriptId: "transcript-1",
    diarizationId: "diarization-1",
    version: 2,
    status: "completed",
    segments: [],
    speakers: [],
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
    mergeMetadata: {
      algorithmVersion: "dialogue-merge-v1",
      transcriptId: "transcript-1",
      diarizationId: "diarization-1",
      generatedAt: "2026-08-28T10:00:00.000Z",
      config: {
        minSpeakerCoverage: 0.5,
        dominantSpeakerRatio: 0.75,
        splitMinimumDuration: 0.2,
        nearestRegionMaxGap: 0.4,
      },
      ambiguousSegmentCount: 0,
      overlappingSegmentCount: 0,
      unassignedSegmentCount: 0,
    },
    editMetadata: {
      hasManualEdits: true,
      revision: 3,
      editedAt: "2026-08-28T11:00:00.000Z",
      baselineAlgorithmVersion: "dialogue-merge-v1",
    },
    ...overrides,
  };
}

function translation(
  overrides: Partial<DialogueTranslation> = {},
): DialogueTranslation {
  return {
    id: "translation-1",
    projectId: "project-1",
    sourceMediaId: "media-1",
    dialogueId: "dialogue-1",
    dialogueRevision: 3,
    sourceLanguage: "en",
    targetLanguage: "pl",
    providerId: "mock",
    providerModel: "deterministic-v1",
    version: TRANSLATION_SCHEMA_VERSION,
    status: "completed",
    segments: [],
    createdAt: "2026-08-28T11:05:00.000Z",
    updatedAt: "2026-08-28T11:05:00.000Z",
    usage: null,
    ...overrides,
  };
}

const languages = { sourceLanguage: "en", targetLanguage: "pl" };

describe("translationCurrency", () => {
  it("is current for the exact dialogue revision and language pair", () => {
    expect(
      translationCurrency(translation(), dialogue(), languages),
    ).toEqual({ current: true });
    expect(isTranslationCurrent(translation(), dialogue(), languages)).toBe(
      true,
    );
  });

  it("goes stale when the dialogue revision moves on", () => {
    const edited = dialogue({
      editMetadata: {
        hasManualEdits: true,
        revision: 4,
        editedAt: "2026-08-28T12:00:00.000Z",
        baselineAlgorithmVersion: "dialogue-merge-v1",
      },
    });

    expect(translationCurrency(translation(), edited, languages)).toEqual({
      current: false,
      reason: "dialogue_revision_changed",
    });
  });

  it("goes stale when the dialogue is rebuilt under a new id", () => {
    expect(
      translationCurrency(translation(), dialogue({ id: "dialogue-2" }), languages),
    ).toEqual({ current: false, reason: "dialogue_changed" });
  });

  it("is not current for a different target language", () => {
    expect(
      translationCurrency(translation(), dialogue(), {
        sourceLanguage: "en",
        targetLanguage: "fr",
      }),
    ).toEqual({ current: false, reason: "target_language_changed" });
  });

  it("is not current for a different source language", () => {
    expect(
      translationCurrency(translation(), dialogue(), {
        sourceLanguage: "de",
        targetLanguage: "pl",
      }),
    ).toEqual({ current: false, reason: "source_language_changed" });
  });

  it("is not current for another source media version", () => {
    expect(
      translationCurrency(
        translation({ sourceMediaId: "media-0" }),
        dialogue(),
        languages,
      ),
    ).toEqual({ current: false, reason: "source_mismatch" });
  });

  it("is not current for another project", () => {
    expect(
      translationCurrency(
        translation({ projectId: "project-2" }),
        dialogue(),
        languages,
      ),
    ).toEqual({ current: false, reason: "project_mismatch" });
  });

  it("goes stale when the stored schema version changes", () => {
    expect(
      translationCurrency(translation({ version: 0 }), dialogue(), languages),
    ).toEqual({ current: false, reason: "schema_changed" });
  });
});
