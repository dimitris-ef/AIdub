/**
 * Unified dialogue domain model — "who said what, and when".
 *
 * This is a **derived** model. Part 5 produces `Transcript` (what was said and
 * when) and Part 6 produces `DiarizationResult` (who spoke and when); both stay
 * persisted, immutable and independently regenerable. Part 7 aligns them into
 * this single representation, which is the contract future features (editing,
 * translation, voice assignment, TTS, timing, mix, export) consume instead of
 * re-correlating the raw results themselves.
 *
 * Because it is derived, a dialogue is only valid for the exact transcript,
 * diarization and merge algorithm that produced it — see `mergeMetadata` and
 * the staleness rules in `@/lib/dialogue/dialogue-staleness`.
 */

export const DIALOGUE_STATUSES = ["completed", "failed"] as const;

export type DialogueStatus = (typeof DIALOGUE_STATUSES)[number];

/**
 * How a segment's speaker was decided.
 *
 * - `single_overlap`   one speaker overlaps the segment
 * - `dominant_overlap` several speakers overlap, one clearly dominates
 * - `nearest_region`   no overlap, but a region sits within the jitter gap
 * - `unassigned`       no defensible assignment; `speakerId` is null
 * - `split`            reserved for word-timestamp-driven splitting; never
 *                      produced today (see the Part 7 README section)
 */
export const SPEAKER_ASSIGNMENT_METHODS = [
  "single_overlap",
  "dominant_overlap",
  "split",
  "nearest_region",
  "unassigned",
] as const;

export type SpeakerAssignmentMethod =
  (typeof SPEAKER_ASSIGNMENT_METHODS)[number];

/** Why an assignment is uncertain, or why none could be made. */
export const ASSIGNMENT_REASONS = [
  "ambiguous_speakers",
  "ambiguous_tie",
  "multiple_speakers_without_word_timestamps",
  "overlapping_speech",
  "low_speaker_coverage",
  "timing_gap",
  "no_speaker_regions",
  "no_nearby_speaker",
] as const;

export type AssignmentReason = (typeof ASSIGNMENT_REASONS)[number];

/**
 * Speaker-assignment outcome for one dialogue segment.
 *
 * `confidence` here is a **merge** confidence — how cleanly the timelines
 * agreed — and is deliberately not a model confidence. Provider confidence,
 * where it exists at all, stays in `DialogueDiarizationMetadata.confidence`
 * and `DialogueTranscriptionMetadata.confidence`.
 */
export interface SpeakerAssignmentMetadata {
  method: SpeakerAssignmentMethod;
  /** Share of attributed speech belonging to the assigned speaker (0–1). */
  confidence: number | null;
  /** How much of the segment the assigned speaker covers (0–1). */
  overlapRatio: number | null;
  uncertain: boolean;
  reason: AssignmentReason | null;
}

/** One speaker that overlapped a segment, whether or not it was assigned. */
export interface DialogueSpeakerCandidate {
  speakerId: string;
  /** Seconds of this speaker's regions inside the segment. */
  overlapDuration: number;
  /** `overlapDuration` as a share of the segment duration (0–1). */
  overlapRatio: number;
}

/** Traceability back to the Part 5 transcript this text came from. */
export interface DialogueTranscriptionMetadata {
  transcriptId: string;
  transcriptSegmentId: string;
  /** Provider confidence, where the provider reported a comparable value. */
  confidence: number | null;
  status: string;
  providerId: string;
  providerModel: string | null;
}

/** Traceability back to the Part 6 regions that informed the assignment. */
export interface DialogueDiarizationMetadata {
  diarizationId: string;
  /** Ids of every region that overlapped (or was nearest to) the segment. */
  regionIds: string[];
  /** Provider confidence for the assigned speaker, where reported. */
  confidence: number | null;
  /** True when overlapping speech touches this segment. */
  overlap: boolean;
  candidateSpeakers: DialogueSpeakerCandidate[];
  providerId: string;
  providerModel: string | null;
}

export interface DialogueSegment {
  /** Stable across regeneration: derived from the transcript segment id. */
  id: string;
  /** Canonical Part 6 id (`speaker_1`, …), or null when unassigned. */
  speakerId: string | null;
  startTime: number;
  endTime: number;
  /** The Part 5 text, unchanged — never translated, rewritten or corrected. */
  originalText: string;
  transcription: DialogueTranscriptionMetadata;
  diarization: DialogueDiarizationMetadata;
  assignment: SpeakerAssignmentMetadata;
}

/** Configuration a merge ran with, recorded so results stay explainable. */
export interface DialogueMergeConfigSnapshot {
  minSpeakerCoverage: number;
  dominantSpeakerRatio: number;
  splitMinimumDuration: number;
  nearestRegionMaxGap: number;
}

export interface DialogueMergeMetadata {
  /** Which merge logic produced this dialogue. */
  algorithmVersion: string;
  transcriptId: string;
  diarizationId: string;
  generatedAt: string;
  config: DialogueMergeConfigSnapshot;
  ambiguousSegmentCount: number;
  overlappingSegmentCount: number;
  unassignedSegmentCount: number;
}

export interface UnifiedDialogue {
  id: string;
  projectId: string;
  sourceMediaId: string;
  /** The exact raw inputs this dialogue was derived from. */
  transcriptId: string;
  diarizationId: string;
  /** Persisted schema version, bumped when the stored shape changes. */
  version: number;
  status: DialogueStatus;
  /** Ordered by start time; see the merge ordering rule. */
  segments: DialogueSegment[];
  createdAt: string;
  updatedAt: string;
  mergeMetadata: DialogueMergeMetadata;
}

export function isDialogueStatus(value: unknown): value is DialogueStatus {
  return (
    typeof value === "string" &&
    (DIALOGUE_STATUSES as readonly string[]).includes(value)
  );
}

export function isSpeakerAssignmentMethod(
  value: unknown,
): value is SpeakerAssignmentMethod {
  return (
    typeof value === "string" &&
    (SPEAKER_ASSIGNMENT_METHODS as readonly string[]).includes(value)
  );
}

export function isAssignmentReason(value: unknown): value is AssignmentReason {
  return (
    typeof value === "string" &&
    (ASSIGNMENT_REASONS as readonly string[]).includes(value)
  );
}
