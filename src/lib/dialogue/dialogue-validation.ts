import type { UnifiedDialogue } from "@/types/dialogue";

/**
 * Invariants every persisted dialogue must satisfy, checked after each edit
 * before it is written.
 *
 * The edit operations are pure and individually tested, but this runs anyway:
 * a structural correction touches several parts of the document at once, and
 * it is far cheaper to reject a bad derivation here than to discover a broken
 * dialogue later from something downstream that trusted it.
 */

export const DIALOGUE_VALIDATION_CODES = [
  "DUPLICATE_SEGMENT_ID",
  "DUPLICATE_SPEAKER_ID",
  "UNKNOWN_SPEAKER_REFERENCE",
  "INVALID_TIMING",
  "INVALID_TEXT",
  "INVALID_ORDER",
  "EMPTY_SPEAKER_NAME",
  "IDENTITY_CHANGED",
] as const;

export type DialogueValidationCode =
  (typeof DIALOGUE_VALIDATION_CODES)[number];

export type DialogueValidation =
  | { ok: true }
  | { ok: false; code: DialogueValidationCode; message: string };

function invalid(
  code: DialogueValidationCode,
  message: string,
): DialogueValidation {
  return { ok: false, code, message };
}

export function validateDialogue(
  dialogue: UnifiedDialogue,
  /** The document being edited, to prove its identity did not drift. */
  baseline?: UnifiedDialogue,
): DialogueValidation {
  if (baseline) {
    // An edit corrects content; it never re-points a dialogue at another
    // project, source or set of raw inputs.
    if (
      dialogue.id !== baseline.id ||
      dialogue.projectId !== baseline.projectId ||
      dialogue.sourceMediaId !== baseline.sourceMediaId ||
      dialogue.transcriptId !== baseline.transcriptId ||
      dialogue.diarizationId !== baseline.diarizationId
    ) {
      return invalid(
        "IDENTITY_CHANGED",
        "An edit may not change which project, source or raw results a dialogue belongs to.",
      );
    }
  }

  const speakerIds = new Set<string>();

  for (const speaker of dialogue.speakers) {
    if (speakerIds.has(speaker.id)) {
      return invalid(
        "DUPLICATE_SPEAKER_ID",
        `Speaker ${speaker.id} appears more than once.`,
      );
    }

    if (speaker.name.trim().length === 0) {
      return invalid(
        "EMPTY_SPEAKER_NAME",
        "A speaker must have a name.",
      );
    }

    speakerIds.add(speaker.id);
  }

  const segmentIds = new Set<string>();
  let previous: { startTime: number; endTime: number; id: string } | null = null;

  for (const segment of dialogue.segments) {
    if (segmentIds.has(segment.id)) {
      return invalid(
        "DUPLICATE_SEGMENT_ID",
        `Segment ${segment.id} appears more than once.`,
      );
    }
    segmentIds.add(segment.id);

    if (typeof segment.originalText !== "string") {
      return invalid("INVALID_TEXT", "Segment text must be text.");
    }

    if (
      !Number.isFinite(segment.startTime) ||
      !Number.isFinite(segment.endTime) ||
      segment.startTime < 0 ||
      segment.endTime <= segment.startTime
    ) {
      return invalid(
        "INVALID_TIMING",
        "A segment must start at or after zero and end after it starts.",
      );
    }

    // No orphaned speaker references: every assignment resolves to a speaker
    // this dialogue owns.
    if (segment.speakerId !== null && !speakerIds.has(segment.speakerId)) {
      return invalid(
        "UNKNOWN_SPEAKER_REFERENCE",
        `Segment ${segment.id} refers to a speaker that does not exist.`,
      );
    }

    if (previous) {
      const ordered =
        previous.startTime < segment.startTime ||
        (previous.startTime === segment.startTime &&
          (previous.endTime < segment.endTime ||
            (previous.endTime === segment.endTime &&
              previous.id <= segment.id)));

      if (!ordered) {
        return invalid(
          "INVALID_ORDER",
          "Segments must be stored in timeline order.",
        );
      }
    }

    previous = {
      startTime: segment.startTime,
      endTime: segment.endTime,
      id: segment.id,
    };
  }

  return { ok: true };
}
