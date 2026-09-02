import {
  estimateSegmentDuration,
  type SpeechDurationEstimate,
} from "@/lib/translation/duration-estimator";

/**
 * Whether a translated line is likely to overrun the slot it has.
 *
 * Three levels, not a number, because the underlying estimate is not precise
 * enough to justify more. The thresholds live here alone: a component that
 * decided for itself what "too long" meant would drift from the badge next to
 * it, and from whatever Part 11 eventually does with the same signal.
 */

export const TRANSLATION_DURATION_WARNINGS = [
  "none",
  "slightly_long",
  "likely_too_long",
] as const;

export type TranslationDurationWarning =
  (typeof TRANSLATION_DURATION_WARNINGS)[number];

/**
 * Chosen deliberately:
 *
 * - up to 1.15 — a sixth over is comfortably inside both the estimator's error
 *   and the slack a real delivery has; flagging it would cry wolf.
 * - 1.15 to 1.35 — plausibly recoverable by speaking a little faster or by a
 *   small rewrite. Worth mentioning, not worth interrupting for.
 * - above 1.35 — a third longer than the slot is past what delivery can absorb;
 *   the line needs a shorter phrasing, which is why this is where the
 *   "Make shorter" action becomes prominent.
 */
export const DURATION_RATIO_THRESHOLDS = {
  slightlyLong: 1.15,
  likelyTooLong: 1.35,
} as const;

/**
 * A null ratio means there was nothing to compare against — an empty line, or a
 * segment with no usable duration. That is not a warning; it is an absence of
 * information, and reporting it as "fits" would be a claim we cannot make.
 */
export function durationWarningForRatio(
  ratio: number | null,
): TranslationDurationWarning {
  if (ratio === null || !Number.isFinite(ratio)) {
    return "none";
  }

  if (ratio > DURATION_RATIO_THRESHOLDS.likelyTooLong) {
    return "likely_too_long";
  }

  if (ratio > DURATION_RATIO_THRESHOLDS.slightlyLong) {
    return "slightly_long";
  }

  return "none";
}

export interface DurationAssessment extends SpeechDurationEstimate {
  warning: TranslationDurationWarning;
}

/**
 * The one place a translated line's duration metadata is produced.
 *
 * Every path that changes translated text — initial generation, regeneration,
 * shortening, a manual edit — goes through here, so a line's warning can never
 * describe text it no longer has.
 */
export function assessTranslationDuration(
  translatedText: string,
  targetLanguage: string,
  sourceDurationSeconds: number,
): DurationAssessment {
  const estimate = estimateSegmentDuration(
    translatedText,
    targetLanguage,
    sourceDurationSeconds,
  );

  return { ...estimate, warning: durationWarningForRatio(estimate.ratio) };
}

/** Short label for the badge. Never colour alone. */
export const DURATION_WARNING_LABELS: Record<
  TranslationDurationWarning,
  string
> = {
  none: "Fits",
  slightly_long: "Slightly long",
  likely_too_long: "Likely too long",
};

export function isTranslationDurationWarning(
  value: unknown,
): value is TranslationDurationWarning {
  return (
    typeof value === "string" &&
    (TRANSLATION_DURATION_WARNINGS as readonly string[]).includes(value)
  );
}
