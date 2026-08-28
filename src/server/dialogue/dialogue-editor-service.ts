import { randomUUID } from "node:crypto";

import type { UnifiedDialogue } from "@/types/dialogue";
import { dialogueRepository } from "@/data/dialogue";
import type { UnifiedDialogueRepository } from "@/data/dialogue";
import { defaultSpeakerName } from "@/data/dialogue/dialogue-repository";
import {
  mergeSegments,
  mergeSpeakers,
  newlyOverlappingSegmentIds,
  reassignSpeaker,
  renameSpeaker,
  splitSegment,
  updateSegmentText,
  updateSegmentTiming,
  type DialogueEditResult,
  type EditContext,
} from "@/lib/dialogue/dialogue-edit-operations";

/**
 * Applies human corrections to the stored dialogue.
 *
 * The domain logic lives in pure functions; this adds exactly two things:
 * loading the current document and writing the result. Nothing is mutated in
 * place — an operation derives a complete new dialogue, that dialogue is
 * validated by the operation itself, and only then is it persisted. A
 * structural correction therefore either lands whole or not at all, which is
 * what keeps a failed speaker merge from leaving half the segments moved.
 *
 * It has no access to the transcript or diarization stores, which is the
 * simplest possible guarantee that editing cannot touch raw results.
 */

export type DialogueEditOperation =
  | { type: "update_text"; segmentId: string; text: string }
  | { type: "rename_speaker"; speakerId: string; name: string }
  | {
      type: "reassign_speaker";
      segmentId: string;
      speakerId: string | null;
    }
  | {
      type: "merge_speakers";
      sourceSpeakerId: string;
      targetSpeakerId: string;
    }
  | {
      type: "split_segment";
      segmentId: string;
      splitTime: number;
      firstText: string;
      secondText: string;
      firstSpeakerId?: string | null;
      secondSpeakerId?: string | null;
    }
  | {
      type: "merge_segments";
      firstSegmentId: string;
      secondSegmentId: string;
    }
  | {
      type: "update_timing";
      segmentId: string;
      startTime: number;
      endTime: number;
      mediaDuration?: number | null;
    };

export type DialogueEditOutcome =
  | {
      ok: true;
      dialogue: UnifiedDialogue;
      /** Segments that now overlap another line and did not before. */
      newOverlaps: string[];
    }
  | { ok: false; code: string; message: string };

export interface DialogueEditorServiceOptions {
  dialogues?: UnifiedDialogueRepository;
  createId?: () => string;
  now?: () => Date;
  logger?: (message: string, detail?: Record<string, unknown>) => void;
}

function defaultLogger(
  message: string,
  detail: Record<string, unknown> = {},
): void {
  // Identifiers and operation kinds only — never dialogue text.
  console.info(`[aidub:dialogue-editor] ${message}`, detail);
}

export class DialogueEditorService {
  private readonly dialogues: UnifiedDialogueRepository;
  private readonly context: EditContext;
  private readonly logger: (
    message: string,
    detail?: Record<string, unknown>,
  ) => void;

  constructor(options: DialogueEditorServiceOptions = {}) {
    this.dialogues = options.dialogues ?? dialogueRepository;
    this.context = {
      createId: options.createId ?? randomUUID,
      now: options.now ?? (() => new Date()),
    };
    this.logger = options.logger ?? defaultLogger;
  }

  async applyEdit(
    projectId: string,
    sourceMediaId: string,
    operation: DialogueEditOperation,
  ): Promise<DialogueEditOutcome> {
    const current = await this.dialogues
      .getByProjectAndSource(projectId, sourceMediaId)
      .catch(() => null);

    if (!current) {
      return {
        ok: false,
        code: "DIALOGUE_NOT_FOUND",
        message: "There is no dialogue to edit for this source.",
      };
    }

    const result = this.derive(current, operation);

    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message };
    }

    // Nothing actually changed (a blur that retyped the same text): skip the
    // write rather than churning the stored document.
    if (result.dialogue === current) {
      return { ok: true, dialogue: current, newOverlaps: [] };
    }

    try {
      await this.dialogues.save(result.dialogue);
    } catch (cause) {
      this.logger("edit could not be saved", {
        projectId,
        operation: operation.type,
        details: cause instanceof Error ? cause.name : "unknown",
      });

      // The stored document is untouched, so the caller can safely tell the
      // user the correction did not land rather than pretending it did.
      return {
        ok: false,
        code: "DIALOGUE_SAVE_FAILED",
        message: "The change could not be saved. Please try again.",
      };
    }

    this.logger("edit applied", {
      projectId,
      dialogueId: result.dialogue.id,
      operation: operation.type,
      revision: result.dialogue.editMetadata.revision,
    });

    return {
      ok: true,
      dialogue: result.dialogue,
      newOverlaps:
        operation.type === "update_timing"
          ? newlyOverlappingSegmentIds(current, result.dialogue)
          : [],
    };
  }

  private derive(
    dialogue: UnifiedDialogue,
    operation: DialogueEditOperation,
  ): DialogueEditResult {
    switch (operation.type) {
      case "update_text":
        return updateSegmentText(
          dialogue,
          operation.segmentId,
          operation.text,
          this.context,
        );

      case "rename_speaker":
        return renameSpeaker(
          dialogue,
          operation.speakerId,
          operation.name,
          defaultSpeakerName(operation.speakerId),
          this.context,
        );

      case "reassign_speaker":
        return reassignSpeaker(
          dialogue,
          operation.segmentId,
          operation.speakerId,
          this.context,
        );

      case "merge_speakers":
        return mergeSpeakers(
          dialogue,
          operation.sourceSpeakerId,
          operation.targetSpeakerId,
          this.context,
        );

      case "split_segment":
        return splitSegment(
          dialogue,
          operation.segmentId,
          {
            splitTime: operation.splitTime,
            firstText: operation.firstText,
            secondText: operation.secondText,
            firstSpeakerId: operation.firstSpeakerId,
            secondSpeakerId: operation.secondSpeakerId,
          },
          this.context,
        );

      case "merge_segments":
        return mergeSegments(
          dialogue,
          operation.firstSegmentId,
          operation.secondSegmentId,
          this.context,
        );

      case "update_timing":
        return updateSegmentTiming(
          dialogue,
          operation.segmentId,
          { startTime: operation.startTime, endTime: operation.endTime },
          this.context,
          { mediaDuration: operation.mediaDuration },
        );
    }
  }
}

export const dialogueEditorService = new DialogueEditorService();

/** Reads an operation off the wire; anything unrecognised is refused. */
export function parseEditOperation(
  value: unknown,
): DialogueEditOperation | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const body = value as Record<string, unknown>;
  const text = (key: string) =>
    typeof body[key] === "string" ? (body[key] as string) : null;
  const number = (key: string) =>
    typeof body[key] === "number" && Number.isFinite(body[key])
      ? (body[key] as number)
      : null;

  switch (body.type) {
    case "update_text": {
      const segmentId = text("segmentId");
      return segmentId !== null && typeof body.text === "string"
        ? { type: "update_text", segmentId, text: body.text }
        : null;
    }

    case "rename_speaker": {
      const speakerId = text("speakerId");
      const name = text("name");
      return speakerId && name !== null
        ? { type: "rename_speaker", speakerId, name }
        : null;
    }

    case "reassign_speaker": {
      const segmentId = text("segmentId");
      const speakerId =
        body.speakerId === null ? null : text("speakerId");
      return segmentId && speakerId !== undefined
        ? { type: "reassign_speaker", segmentId, speakerId }
        : null;
    }

    case "merge_speakers": {
      const sourceSpeakerId = text("sourceSpeakerId");
      const targetSpeakerId = text("targetSpeakerId");
      return sourceSpeakerId && targetSpeakerId
        ? { type: "merge_speakers", sourceSpeakerId, targetSpeakerId }
        : null;
    }

    case "split_segment": {
      const segmentId = text("segmentId");
      const splitTime = number("splitTime");
      return segmentId &&
        splitTime !== null &&
        typeof body.firstText === "string" &&
        typeof body.secondText === "string"
        ? {
            type: "split_segment",
            segmentId,
            splitTime,
            firstText: body.firstText,
            secondText: body.secondText,
            ...(body.firstSpeakerId !== undefined
              ? { firstSpeakerId: body.firstSpeakerId as string | null }
              : {}),
            ...(body.secondSpeakerId !== undefined
              ? { secondSpeakerId: body.secondSpeakerId as string | null }
              : {}),
          }
        : null;
    }

    case "merge_segments": {
      const firstSegmentId = text("firstSegmentId");
      const secondSegmentId = text("secondSegmentId");
      return firstSegmentId && secondSegmentId
        ? { type: "merge_segments", firstSegmentId, secondSegmentId }
        : null;
    }

    case "update_timing": {
      const segmentId = text("segmentId");
      const startTime = number("startTime");
      const endTime = number("endTime");
      return segmentId && startTime !== null && endTime !== null
        ? {
            type: "update_timing",
            segmentId,
            startTime,
            endTime,
            mediaDuration: number("mediaDuration"),
          }
        : null;
    }

    default:
      return null;
  }
}
