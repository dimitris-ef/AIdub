import type { DiarizationResult } from "@/types/diarization";
import type { Transcript } from "@/types/transcript";
import type { UnifiedDialogue } from "@/types/dialogue";
import {
  DIALOGUE_SCHEMA_VERSION,
  MERGE_ALGORITHM_VERSION,
} from "@/lib/dialogue/merge-config";

/**
 * A unified dialogue is derived, so it is only valid for the exact inputs and
 * rules that produced it: this project, this source media version, this
 * transcript, this diarization, this schema and this merge algorithm.
 *
 * Change any of them — retranscribe, rediarize, replace the source, ship new
 * merge logic — and the stored dialogue describes something that no longer
 * exists. It is then stale and must be regenerated rather than served.
 */

export const DIALOGUE_STALE_REASONS = [
  "project_mismatch",
  "source_mismatch",
  "transcript_changed",
  "diarization_changed",
  "algorithm_changed",
  "schema_changed",
] as const;

export type DialogueStaleReason = (typeof DIALOGUE_STALE_REASONS)[number];

export type DialogueCurrency =
  | { current: true }
  | { current: false; reason: DialogueStaleReason };

export function dialogueCurrency(
  dialogue: UnifiedDialogue,
  transcript: Transcript,
  diarization: DiarizationResult,
): DialogueCurrency {
  if (
    dialogue.projectId !== transcript.projectId ||
    dialogue.projectId !== diarization.projectId
  ) {
    return { current: false, reason: "project_mismatch" };
  }

  if (
    dialogue.sourceMediaId !== transcript.sourceMediaId ||
    dialogue.sourceMediaId !== diarization.sourceMediaId
  ) {
    return { current: false, reason: "source_mismatch" };
  }

  if (dialogue.transcriptId !== transcript.id) {
    return { current: false, reason: "transcript_changed" };
  }

  if (dialogue.diarizationId !== diarization.id) {
    return { current: false, reason: "diarization_changed" };
  }

  if (dialogue.mergeMetadata.algorithmVersion !== MERGE_ALGORITHM_VERSION) {
    return { current: false, reason: "algorithm_changed" };
  }

  if (dialogue.version !== DIALOGUE_SCHEMA_VERSION) {
    return { current: false, reason: "schema_changed" };
  }

  return { current: true };
}

export function isDialogueCurrent(
  dialogue: UnifiedDialogue,
  transcript: Transcript,
  diarization: DiarizationResult,
): boolean {
  return dialogueCurrency(dialogue, transcript, diarization).current;
}
