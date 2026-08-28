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
 *
 * From Part 8 it is also **editable**. Human corrections — text, speaker,
 * timing, structure, speaker names — are applied here and nowhere else: the
 * raw transcript and diarization stay untouched, and `editMetadata` records
 * that the document has diverged from its generated baseline so regeneration
 * can never silently discard someone's work.
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
 * - `manual`           a person chose this speaker; authoritative downstream
 */
export const SPEAKER_ASSIGNMENT_METHODS = [
  "single_overlap",
  "dominant_overlap",
  "split",
  "nearest_region",
  "unassigned",
  "manual",
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
  /**
   * What the merge decided before a person overrode it. Kept for provenance:
   * a manual assignment is authoritative, but why the algorithm disagreed is
   * still worth being able to look up.
   */
  automatic?: {
    method: SpeakerAssignmentMethod;
    speakerId: string | null;
    reason: AssignmentReason | null;
  };
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

/** What a person changed on one segment, relative to the merged baseline. */
export interface DialogueSegmentEditMetadata {
  manuallyEditedText: boolean;
  manuallyEditedSpeaker: boolean;
  manuallyEditedTiming: boolean;
  manuallyChangedStructure: boolean;
  /**
   * Dialogue segments this one came from when it was split or merged. Empty
   * for a segment that still maps one-to-one to its transcript segment.
   */
  parentSegmentIds: string[];
}

export interface DialogueSegment {
  /** Stable across regeneration: derived from the transcript segment id. */
  id: string;
  /** Canonical Part 6 id (`speaker_1`, …), or null when unassigned. */
  speakerId: string | null;
  startTime: number;
  endTime: number;
  /**
   * The reviewed original-language text. It starts as Part 5's text verbatim
   * and is the one field a person may rewrite; the raw transcript keeps its
   * own copy untouched. Never a translation.
   */
  originalText: string;
  transcription: DialogueTranscriptionMetadata;
  diarization: DialogueDiarizationMetadata;
  assignment: SpeakerAssignmentMetadata;
  editMetadata: DialogueSegmentEditMetadata;
}

/**
 * A speaker as the dialogue knows them: a stable id that downstream systems
 * join on, plus a display name a person may change freely.
 *
 * The name is dialogue metadata, never written back to Part 6. `id` stays
 * canonical (`speaker_1`) so renaming changes nothing structural, and
 * `sourceSpeakerIds` records which diarization clusters a person decided were
 * the same voice.
 */
export interface DialogueSpeaker {
  id: string;
  /** Display name. Editable; defaults to the Part 6 label. */
  name: string;
  /** Diarization speaker ids folded into this one, including its own. */
  sourceSpeakerIds: string[];
  createdManually: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Whether, and how much, this dialogue has diverged from its baseline. */
export interface DialogueEditMetadata {
  hasManualEdits: boolean;
  /** Bumped once per persisted correction, not per keystroke. */
  revision: number;
  editedAt: string | null;
  /** The merge algorithm the edited document was built on top of. */
  baselineAlgorithmVersion: string;
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
  /** Editable speaker records; every non-null `speakerId` resolves here. */
  speakers: DialogueSpeaker[];
  createdAt: string;
  updatedAt: string;
  mergeMetadata: DialogueMergeMetadata;
  editMetadata: DialogueEditMetadata;
}

/** A segment's speaker name, falling back to its id when unresolved. */
export function speakerDisplayName(
  speakers: readonly DialogueSpeaker[],
  speakerId: string | null,
): string {
  if (!speakerId) {
    return "Unassigned";
  }

  return speakers.find((speaker) => speaker.id === speakerId)?.name ?? speakerId;
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
