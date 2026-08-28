import type { UnifiedDialogue } from "@/types/dialogue";
import type { TranslatedDialogueSegment } from "@/types/translation";
import {
  isTranslatableText,
  normalizeConfidence,
  type ProviderSegmentAnswer,
} from "@/lib/translation/validate-translation";

/**
 * Turns validated provider answers into stored translation segments.
 *
 * Pure, and the single place where a translation record takes its shape. Three
 * properties are guaranteed here rather than trusted from a provider:
 *
 * - **Order** comes from the dialogue, not the response. Providers may answer
 *   in any order; the stored translation is always in timeline order.
 * - **Structure** comes from the dialogue: one translated segment per dialogue
 *   segment, no more and no fewer, each carrying the speaker and timing it was
 *   given. A provider cannot add, drop, split or merge a line.
 * - **Empty stays empty**: a line with no source text is preserved with empty
 *   translated text rather than dropped, so the 1:1 relationship holds.
 */
export function buildTranslatedSegments(
  dialogue: UnifiedDialogue,
  answers: ReadonlyMap<string, ProviderSegmentAnswer>,
  {
    sourceLanguage,
    targetLanguage,
    createId,
  }: {
    sourceLanguage: string;
    targetLanguage: string;
    createId: () => string;
  },
): TranslatedDialogueSegment[] {
  // Iterating the dialogue — not the answers — is what makes the output order
  // and structure the dialogue's, whatever the provider did.
  return dialogue.segments.map((segment) => {
    const answer = answers.get(segment.id);
    const translatable = isTranslatableText(segment.originalText);

    return {
      id: createId(),
      dialogueSegmentId: segment.id,
      // Copied, never decided here: translation has no opinion about who
      // speaks or when.
      speakerId: segment.speakerId,
      startTime: segment.startTime,
      endTime: segment.endTime,
      sourceText: segment.originalText,
      translatedText: translatable ? (answer?.translatedText ?? "") : "",
      sourceLanguage,
      targetLanguage,
      confidence: normalizeConfidence(answer?.confidence),
      ...(answer?.metadata ? { providerMetadata: answer.metadata } : {}),
    };
  });
}

/**
 * Merges per-batch usage into one total.
 *
 * Absent measurements stay absent: if no batch reported input tokens, the total
 * has no input tokens rather than zero, because zero would read as "this cost
 * nothing" instead of "this was never measured". A translation whose provider
 * reports nothing at all ends up with `usage: null`.
 */
export function mergeUsage(
  parts: readonly (
    | {
        inputCharacters?: number;
        outputCharacters?: number;
        inputTokens?: number;
        outputTokens?: number;
        requestCount?: number;
        providerMetadata?: Record<string, unknown>;
      }
    | null
    | undefined
  )[],
): {
  inputCharacters?: number;
  outputCharacters?: number;
  inputTokens?: number;
  outputTokens?: number;
  requestCount?: number;
} | null {
  const present = parts.filter(
    (part): part is NonNullable<(typeof parts)[number]> => Boolean(part),
  );

  if (present.length === 0) {
    return null;
  }

  const sum = (
    key: "inputCharacters" | "outputCharacters" | "inputTokens" | "outputTokens" | "requestCount",
  ): number | undefined => {
    const values = present
      .map((part) => part[key])
      .filter((value): value is number => typeof value === "number");

    return values.length > 0
      ? values.reduce((total, value) => total + value, 0)
      : undefined;
  };

  const totals = {
    inputCharacters: sum("inputCharacters"),
    outputCharacters: sum("outputCharacters"),
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    requestCount: sum("requestCount"),
  };

  const reported = Object.entries(totals).filter(
    ([, value]) => value !== undefined,
  );

  return reported.length > 0 ? Object.fromEntries(reported) : null;
}
