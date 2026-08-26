/**
 * Canonical speaker identity.
 *
 * Providers name their clusters however they like — `SPEAKER_00`, `A`, `3`,
 * a UUID. None of that reaches Aidub's domain model: every provider label is
 * replaced by a canonical id assigned in order of first appearance on the
 * timeline, so the ids are predictable and comparable regardless of which
 * model produced them.
 *
 * These ids are stable *within* one persisted diarization result. They say
 * nothing about who a person is, and `speaker_1` from one run is not promised
 * to be the same voice as `speaker_1` from a separately recomputed run.
 */

export const SPEAKER_ID_PREFIX = "speaker_";

/** 1-based: the first speaker heard is `speaker_1`. */
export function speakerIdForIndex(index: number): string {
  return `${SPEAKER_ID_PREFIX}${index + 1}`;
}

/** Display text for a canonical id. Never a person's name. */
export function speakerLabelForIndex(index: number): string {
  return `Speaker ${index + 1}`;
}

export function isCanonicalSpeakerId(value: unknown): value is string {
  return typeof value === "string" && /^speaker_[1-9]\d*$/.test(value);
}

/**
 * Assigns canonical ids to provider labels in first-appearance order.
 *
 * Input must already be sorted by start time; the caller owns ordering so the
 * rule stays a single, testable statement: earlier speech wins the lower id.
 */
export function assignSpeakerIds(
  labelsInTimelineOrder: readonly string[],
): Map<string, string> {
  const assigned = new Map<string, string>();

  for (const label of labelsInTimelineOrder) {
    if (!assigned.has(label)) {
      assigned.set(label, speakerIdForIndex(assigned.size));
    }
  }

  return assigned;
}
