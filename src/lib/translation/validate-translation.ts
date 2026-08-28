import type { UnifiedDialogue } from "@/types/dialogue";
import type {
  TranslationRequest,
  TranslationRequestSegment,
} from "@/types/translation";

/**
 * The contract between Aidub and any translation provider, enforced in one
 * pure place so every provider is held to the same rules.
 *
 * The premise of Part 9 is that translation is **segment-preserving**: the
 * dialogue decides how many lines there are, who says them and when, and a
 * provider only supplies text for each one. Everything here exists to make
 * that true no matter how a provider behaves — including when it answers out
 * of order, skips a line, repeats one, or invents an id.
 *
 * Nothing is ever repaired by guessing. A provider that breaks the contract
 * fails the job, because a translation with a silently empty or wrong line is
 * worse than no translation at all: it looks finished.
 */

export type TranslationContractErrorCode =
  | "TRANSLATION_INVALID_RESPONSE"
  | "TRANSLATION_INCOMPLETE_RESPONSE"
  | "TRANSLATION_DUPLICATE_SEGMENT"
  | "TRANSLATION_UNKNOWN_SEGMENT"
  | "TRANSLATION_EMPTY_RESULT";

/** A provider's answer for one line, before it becomes stored data. */
export interface ProviderSegmentAnswer {
  segmentId: string;
  translatedText: string;
  confidence: number | null;
  metadata?: Record<string, unknown>;
}

export type MatchProviderResultsOutcome =
  | { ok: true; bySegmentId: Map<string, ProviderSegmentAnswer> }
  | { ok: false; code: TranslationContractErrorCode; details: string };

/**
 * A source segment worth sending to a provider.
 *
 * The dialogue may legitimately contain an empty line — Part 8 lets a person
 * clear text, and a split can leave one side blank. Sending empty text would
 * spend provider credits to receive nothing useful and invites a model to
 * invent dialogue, so those lines are held back and translated as empty. The
 * structure still stays 1:1: the segment is preserved either way.
 */
export function isTranslatableText(sourceText: string): boolean {
  return sourceText.trim().length > 0;
}

/**
 * Builds the normalised provider request from the current editable dialogue.
 *
 * This is the only place a dialogue turns into a translation request, which is
 * what guarantees Part 8's corrections are what gets translated: the text,
 * speaker, timing and segment structure all come from the stored document, not
 * from the raw Part 5 transcript.
 */
export function toRequestSegments(
  dialogue: UnifiedDialogue,
): TranslationRequestSegment[] {
  return dialogue.segments.map((segment) => ({
    segmentId: segment.id,
    speakerId: segment.speakerId,
    startTime: segment.startTime,
    endTime: segment.endTime,
    sourceText: segment.originalText,
  }));
}

export type ValidateRequestOutcome =
  | { ok: true }
  | { ok: false; details: string };

/**
 * Checks the domain data before it leaves for a provider.
 *
 * Malformed data must not reach a provider: it wastes a paid call, and a
 * provider asked to translate a NaN timestamp or a duplicated id will answer
 * something that cannot be mapped back.
 */
export function validateTranslationRequest(
  request: TranslationRequest,
): ValidateRequestOutcome {
  if (request.segments.length === 0) {
    return { ok: false, details: "no dialogue segments to translate" };
  }

  const seen = new Set<string>();

  for (const segment of request.segments) {
    if (typeof segment.segmentId !== "string" || segment.segmentId === "") {
      return { ok: false, details: "segment without an id" };
    }

    if (seen.has(segment.segmentId)) {
      return {
        ok: false,
        details: `duplicate segment id ${segment.segmentId}`,
      };
    }

    seen.add(segment.segmentId);

    if (typeof segment.sourceText !== "string") {
      return { ok: false, details: `segment ${segment.segmentId} has no text` };
    }

    if (
      !Number.isFinite(segment.startTime) ||
      !Number.isFinite(segment.endTime) ||
      segment.startTime < 0 ||
      segment.endTime <= segment.startTime
    ) {
      return {
        ok: false,
        details: `segment ${segment.segmentId} has invalid timing`,
      };
    }

    if (segment.speakerId !== null && typeof segment.speakerId !== "string") {
      return {
        ok: false,
        details: `segment ${segment.segmentId} has an invalid speaker`,
      };
    }
  }

  return { ok: true };
}

/**
 * Maps a provider's answers back onto the lines that were requested.
 *
 * Matching is by `segmentId` and never by array position, so a provider is free
 * to answer in any order. Four ways a provider can break the contract are
 * rejected here rather than persisted:
 *
 * - an id that was never requested (it would add a line that does not exist);
 * - the same id twice (there is no defensible way to pick one);
 * - a missing id (the line would silently lose its translation);
 * - empty text for a line that had source text (a translation that isn't one).
 */
export function matchProviderResults(
  requested: readonly TranslationRequestSegment[],
  results: readonly ProviderSegmentAnswer[],
): MatchProviderResultsOutcome {
  const expected = new Set(requested.map((segment) => segment.segmentId));
  const bySegmentId = new Map<string, ProviderSegmentAnswer>();

  for (const result of results) {
    if (typeof result?.segmentId !== "string" || result.segmentId === "") {
      return {
        ok: false,
        code: "TRANSLATION_INVALID_RESPONSE",
        details: "a result had no segment id",
      };
    }

    if (typeof result.translatedText !== "string") {
      return {
        ok: false,
        code: "TRANSLATION_INVALID_RESPONSE",
        details: `segment ${result.segmentId} returned non-text`,
      };
    }

    if (!expected.has(result.segmentId)) {
      return {
        ok: false,
        code: "TRANSLATION_UNKNOWN_SEGMENT",
        details: `segment ${result.segmentId} was never requested`,
      };
    }

    if (bySegmentId.has(result.segmentId)) {
      return {
        ok: false,
        code: "TRANSLATION_DUPLICATE_SEGMENT",
        details: `segment ${result.segmentId} was returned twice`,
      };
    }

    bySegmentId.set(result.segmentId, result);
  }

  for (const segment of requested) {
    const answer = bySegmentId.get(segment.segmentId);

    if (!answer) {
      return {
        ok: false,
        code: "TRANSLATION_INCOMPLETE_RESPONSE",
        details: `segment ${segment.segmentId} was not translated`,
      };
    }

    // Only lines that had something to translate are held to this: an empty
    // source line is expected to come back empty.
    if (
      isTranslatableText(segment.sourceText) &&
      answer.translatedText.trim().length === 0
    ) {
      return {
        ok: false,
        code: "TRANSLATION_EMPTY_RESULT",
        details: `segment ${segment.segmentId} came back empty`,
      };
    }
  }

  return { ok: true, bySegmentId };
}

/**
 * Normalises a provider confidence into 0–1, or null.
 *
 * Most translation providers report nothing comparable, and an invented number
 * would be read downstream as a quality signal it never was. Anything outside
 * the range, or not a finite number, becomes null rather than being clamped
 * into a value it did not mean.
 */
export function normalizeConfidence(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : null;
}
