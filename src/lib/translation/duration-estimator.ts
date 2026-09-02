/**
 * How long a translated line would probably take to say.
 *
 * This is an **estimate from text**, not a measurement. Aidub has not
 * synthesised anything yet, so it cannot know how long a line actually takes:
 * that depends on the voice, the speaking rate, the pauses and the emphasis a
 * Part 11 TTS engine chooses. What this gives is an early, cheap signal that a
 * translation is likely far longer than the slot it has to fit — enough to
 * flag a line for a human, and nowhere near enough to claim synchronisation.
 *
 * Deliberately pure and provider-independent: the same text and language always
 * produce the same number, no provider is consulted, and nothing here knows how
 * a translation was generated. That makes it testable, and it means the
 * estimate can be recomputed at any time — after a manual edit, after a
 * regeneration, or after this file gets better.
 */

/**
 * Bumped whenever the estimate for the same text would change.
 *
 * Stored alongside every estimate so a later, better estimator can be told
 * apart from this one, and old metadata can be recomputed rather than being
 * silently mixed with new numbers.
 */
export const DURATION_ESTIMATOR_VERSION = "v1";

export interface LanguageSpeechRate {
  language: string;
  /**
   * Characters of written text per second of speech, excluding pause time.
   *
   * Characters rather than words because it degrades gracefully: it stays
   * meaningful for languages Aidub has no specific figure for, and for
   * languages that do not put spaces between words at all.
   */
  charactersPerSecond: number;
}

/**
 * Approximate speaking rates, chosen conservatively.
 *
 * These are rough averages for conversational delivery, not linguistic
 * measurements, and they exist only to make the ratio between languages
 * sensible — Spanish and Japanese genuinely differ enough that one rate for
 * everything would flag half of one language and none of the other. A value
 * being approximate is exactly why the output is a warning rather than a
 * constraint.
 */
export const LANGUAGE_SPEECH_RATES: readonly LanguageSpeechRate[] = [
  { language: "en", charactersPerSecond: 14.5 },
  { language: "es", charactersPerSecond: 16.5 },
  { language: "fr", charactersPerSecond: 15.5 },
  { language: "de", charactersPerSecond: 14.0 },
  { language: "it", charactersPerSecond: 16.0 },
  { language: "pt", charactersPerSecond: 16.0 },
  { language: "nl", charactersPerSecond: 14.5 },
  { language: "pl", charactersPerSecond: 14.0 },
  { language: "el", charactersPerSecond: 14.5 },
  { language: "tr", charactersPerSecond: 14.0 },
  { language: "ru", charactersPerSecond: 13.5 },
  { language: "uk", charactersPerSecond: 13.5 },
  { language: "ar", charactersPerSecond: 13.0 },
  { language: "hi", charactersPerSecond: 13.0 },
  // Logographic and syllabary scripts pack far more meaning per character, so
  // the same character count takes much longer to say.
  { language: "zh", charactersPerSecond: 5.5 },
  { language: "ja", charactersPerSecond: 7.5 },
  { language: "ko", charactersPerSecond: 8.0 },
];

/** Used for a language with no specific figure. Mid-range on purpose. */
export const DEFAULT_CHARACTERS_PER_SECOND = 14.5;

/**
 * Pause added for sentence-ending punctuation, in seconds.
 *
 * A full stop or a question mark is a beat a speaker actually takes, and
 * ignoring it makes short punchy exchanges read as far quicker than they are.
 */
const SENTENCE_PAUSE_SECONDS = 0.25;
/** A comma or similar is a shorter beat. */
const CLAUSE_PAUSE_SECONDS = 0.1;

const RATE_BY_LANGUAGE = new Map(
  LANGUAGE_SPEECH_RATES.map((rate) => [rate.language, rate]),
);

export interface SpeechDurationEstimate {
  estimatedSeconds: number;
  sourceDurationSeconds: number;
  /** `estimatedSeconds / sourceDurationSeconds`, or null when unknowable. */
  ratio: number | null;
  estimatorVersion: string;
}

export function charactersPerSecondFor(language: string): number {
  return (
    RATE_BY_LANGUAGE.get(language)?.charactersPerSecond ??
    DEFAULT_CHARACTERS_PER_SECOND
  );
}

/**
 * Estimated seconds of speech for a piece of text.
 *
 * Pure and deterministic. Counts the characters a speaker actually voices —
 * whitespace collapsed, since spaces are not spoken — divides by the language's
 * approximate rate, and adds a small pause per sentence and clause boundary.
 * Empty text takes no time at all rather than a floor value: an empty line is
 * genuinely silent, and pretending otherwise would flag every blank line.
 */
export function estimateSpeechDuration(
  text: string,
  targetLanguage: string,
): number {
  const normalized = text.trim().replace(/\s+/g, " ");

  if (normalized.length === 0) {
    return 0;
  }

  // Spaces separate words but are not themselves spoken.
  const spokenCharacters = normalized.replace(/\s/g, "").length;

  if (spokenCharacters === 0) {
    return 0;
  }

  const sentenceBreaks = (normalized.match(/[.!?…]+/g) ?? []).length;
  const clauseBreaks = (normalized.match(/[,;:—–]/g) ?? []).length;

  const seconds =
    spokenCharacters / charactersPerSecondFor(targetLanguage) +
    sentenceBreaks * SENTENCE_PAUSE_SECONDS +
    clauseBreaks * CLAUSE_PAUSE_SECONDS;

  // Three decimals: the same precision timeline values carry, and far more
  // than the estimate itself deserves.
  return Math.round(seconds * 1000) / 1000;
}

/**
 * The estimate for one translated line against the slot it has to fit.
 *
 * A non-positive source duration yields a null ratio rather than Infinity or a
 * fabricated number — that would be a broken dialogue segment, and inventing a
 * comparison for it would produce a warning nobody could act on.
 */
export function estimateSegmentDuration(
  translatedText: string,
  targetLanguage: string,
  sourceDurationSeconds: number,
): SpeechDurationEstimate {
  const estimatedSeconds = estimateSpeechDuration(translatedText, targetLanguage);
  const usableSource =
    Number.isFinite(sourceDurationSeconds) && sourceDurationSeconds > 0
      ? sourceDurationSeconds
      : null;

  return {
    estimatedSeconds,
    sourceDurationSeconds: Number.isFinite(sourceDurationSeconds)
      ? sourceDurationSeconds
      : 0,
    ratio:
      usableSource === null
        ? null
        : Math.round((estimatedSeconds / usableSource) * 1000) / 1000,
    estimatorVersion: DURATION_ESTIMATOR_VERSION,
  };
}

/** The slot a dialogue segment gives a line, in seconds. */
export function segmentDurationSeconds(segment: {
  startTime: number;
  endTime: number;
}): number {
  const duration = segment.endTime - segment.startTime;

  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}
