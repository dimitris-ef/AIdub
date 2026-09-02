import { describe, expect, it } from "vitest";

import {
  DEFAULT_DUBBING_OPTIONS,
  type TranslationRequest,
  type TranslationRequestSegment,
} from "@/types/translation";
import {
  isTranslatableText,
  matchProviderResults,
  normalizeConfidence,
  validateTranslationRequest,
  type ProviderSegmentAnswer,
} from "@/lib/translation/validate-translation";
import { batchSegments } from "@/lib/translation/translation-config";

/**
 * The provider contract, tested directly.
 *
 * Every rule here exists because the alternative is a translation that looks
 * complete and is not: a dropped line rendered blank, a duplicated line picked
 * at random, or an invented line that has no dialogue behind it.
 */

function requested(
  id: string,
  sourceText: string,
  overrides: Partial<TranslationRequestSegment> = {},
): TranslationRequestSegment {
  return {
    segmentId: id,
    speakerId: "speaker_1",
    startTime: 0,
    endTime: 2,
    durationSeconds: 2,
    sourceText,
    ...overrides,
  };
}

function answer(
  segmentId: string,
  translatedText: string,
): ProviderSegmentAnswer {
  return { segmentId, translatedText, confidence: null };
}

function request(
  segments: TranslationRequestSegment[],
): TranslationRequest {
  return {
    projectId: "p",
    sourceMediaId: "m",
    dialogueId: "d",
    dialogueRevision: 0,
    sourceLanguage: "en",
    targetLanguage: "pl",
    segments,
    operation: "full",
    options: DEFAULT_DUBBING_OPTIONS,
  };
}

describe("validateTranslationRequest", () => {
  it("accepts well-formed dialogue", () => {
    const outcome = validateTranslationRequest(
      request([
        requested("s-1", "Hello."),
        requested("s-2", "How are you?", { startTime: 2, endTime: 4 }),
      ]),
    );

    expect(outcome.ok).toBe(true);
  });

  it("rejects an empty dialogue", () => {
    const outcome = validateTranslationRequest(request([]));

    expect(outcome).toEqual({
      ok: false,
      details: "no dialogue segments to translate",
    });
  });

  it("rejects duplicate segment ids", () => {
    const outcome = validateTranslationRequest(
      request([requested("s-1", "One."), requested("s-1", "Two.")]),
    );

    expect(outcome.ok).toBe(false);
  });

  it("rejects invalid timing rather than sending it downstream", () => {
    const outcome = validateTranslationRequest(
      request([requested("s-1", "Hello.", { endTime: Number.NaN })]),
    );

    expect(outcome.ok).toBe(false);
  });

  it("rejects an end at or before the start", () => {
    const outcome = validateTranslationRequest(
      request([requested("s-1", "Hello.", { startTime: 4, endTime: 4 })]),
    );

    expect(outcome.ok).toBe(false);
  });

  it("accepts a null speaker", () => {
    const outcome = validateTranslationRequest(
      request([requested("s-1", "Hello.", { speakerId: null })]),
    );

    expect(outcome.ok).toBe(true);
  });
});

describe("matchProviderResults", () => {
  const two = [requested("s-1", "Hello."), requested("s-2", "Goodbye.")];

  it("maps answers back by id", () => {
    const outcome = matchProviderResults(two, [
      answer("s-1", "Cześć."),
      answer("s-2", "Do widzenia."),
    ]);

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(outcome.bySegmentId.get("s-1")?.translatedText).toBe("Cześć.");
      expect(outcome.bySegmentId.get("s-2")?.translatedText).toBe(
        "Do widzenia.",
      );
    }
  });

  it("does not care what order the provider answered in", () => {
    const forward = matchProviderResults(two, [
      answer("s-1", "A"),
      answer("s-2", "B"),
    ]);
    const reversed = matchProviderResults(two, [
      answer("s-2", "B"),
      answer("s-1", "A"),
    ]);

    expect(forward.ok && reversed.ok).toBe(true);

    if (forward.ok && reversed.ok) {
      expect([...reversed.bySegmentId].sort()).toEqual(
        [...forward.bySegmentId].sort(),
      );
    }
  });

  it("fails when a requested line is missing", () => {
    const outcome = matchProviderResults(two, [answer("s-1", "Cześć.")]);

    expect(outcome).toMatchObject({
      ok: false,
      code: "TRANSLATION_INCOMPLETE_RESPONSE",
    });
  });

  it("fails when a line is returned twice", () => {
    const outcome = matchProviderResults(two, [
      answer("s-1", "One"),
      answer("s-1", "Two"),
      answer("s-2", "B"),
    ]);

    expect(outcome).toMatchObject({
      ok: false,
      code: "TRANSLATION_DUPLICATE_SEGMENT",
    });
  });

  it("fails when the provider invents a line", () => {
    const outcome = matchProviderResults(two, [
      answer("s-1", "A"),
      answer("s-2", "B"),
      answer("s-99", "Where did this come from?"),
    ]);

    expect(outcome).toMatchObject({
      ok: false,
      code: "TRANSLATION_UNKNOWN_SEGMENT",
    });
  });

  it("fails when a line with text comes back empty", () => {
    const outcome = matchProviderResults(two, [
      answer("s-1", "A"),
      answer("s-2", "   "),
    ]);

    expect(outcome).toMatchObject({
      ok: false,
      code: "TRANSLATION_EMPTY_RESULT",
    });
  });

  it("rejects a non-string translation", () => {
    const outcome = matchProviderResults(two, [
      answer("s-1", "A"),
      { segmentId: "s-2", translatedText: 42 as unknown as string, confidence: null },
    ]);

    expect(outcome).toMatchObject({
      ok: false,
      code: "TRANSLATION_INVALID_RESPONSE",
    });
  });

  it("allows an empty answer for a line that had no text", () => {
    const outcome = matchProviderResults(
      [requested("s-1", "Hello."), requested("s-2", "  ")],
      [answer("s-1", "Cześć."), answer("s-2", "")],
    );

    expect(outcome.ok).toBe(true);
  });
});

describe("isTranslatableText", () => {
  it("treats blank text as nothing to translate", () => {
    expect(isTranslatableText("")).toBe(false);
    expect(isTranslatableText("   \n ")).toBe(false);
    expect(isTranslatableText("Hello")).toBe(true);
  });
});

describe("normalizeConfidence", () => {
  it("keeps a value already in range", () => {
    expect(normalizeConfidence(0.82)).toBe(0.82);
    expect(normalizeConfidence(0)).toBe(0);
    expect(normalizeConfidence(1)).toBe(1);
  });

  it("never invents one", () => {
    expect(normalizeConfidence(undefined)).toBeNull();
    expect(normalizeConfidence(null)).toBeNull();
    expect(normalizeConfidence("0.9")).toBeNull();
    expect(normalizeConfidence(Number.NaN)).toBeNull();
    // Out of range means the provider meant something else by it.
    expect(normalizeConfidence(1.4)).toBeNull();
    expect(normalizeConfidence(-0.2)).toBeNull();
  });
});

describe("batchSegments", () => {
  it("splits in order and keeps every item", () => {
    expect(batchSegments([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("never produces a zero-sized batch", () => {
    expect(batchSegments([1, 2], 0)).toEqual([[1], [2]]);
  });

  it("handles an empty input", () => {
    expect(batchSegments([], 10)).toEqual([]);
  });
});
