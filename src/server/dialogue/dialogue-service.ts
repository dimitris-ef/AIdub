import { randomUUID } from "node:crypto";

import type { DiarizationResult } from "@/types/diarization";
import type { Transcript } from "@/types/transcript";
import type { UnifiedDialogue } from "@/types/dialogue";
import { diarizationRepository } from "@/data/diarization";
import type { DiarizationRepository } from "@/data/diarization";
import { transcriptRepository } from "@/data/transcripts";
import type { TranscriptRepository } from "@/data/transcripts";
import { dialogueRepository } from "@/data/dialogue";
import type { UnifiedDialogueRepository } from "@/data/dialogue";
import { mergeDialogue } from "@/lib/dialogue/merge-dialogue";
import {
  DIALOGUE_SCHEMA_VERSION,
  MERGE_ALGORITHM_VERSION,
  resolveMergeConfig,
  toConfigSnapshot,
  type DialogueMergeConfig,
} from "@/lib/dialogue/merge-config";
import { dialogueCurrency } from "@/lib/dialogue/dialogue-staleness";

/**
 * Orchestrates the unified dialogue: fetch the current raw inputs, check they
 * describe the same source, reuse a stored dialogue while it is still current,
 * and otherwise merge and persist a new one.
 *
 * Generation is **lazy**: the dialogue is produced the first time it is asked
 * for once both prerequisites exist, and regenerated whenever its inputs
 * change. That keeps Part 5 and Part 6 completely unaware of each other — no
 * transcription or diarization service has to know that a merge exists — and
 * it needs no processing job, because merging is pure in-memory work measured
 * in milliseconds rather than model inference.
 *
 * Raw transcripts and diarizations are only ever read here. The merge never
 * writes to them, so the dialogue can always be thrown away and rebuilt.
 */

export const DIALOGUE_STATES = [
  "ready",
  "transcript_required",
  "diarization_required",
  "source_mismatch",
  "failed",
] as const;

export type DialogueState = (typeof DIALOGUE_STATES)[number];

export type DialogueResolution =
  | {
      state: "ready";
      dialogue: UnifiedDialogue;
      /** True when this call produced the dialogue rather than reusing one. */
      regenerated: boolean;
    }
  | {
      state: Exclude<DialogueState, "ready">;
      dialogue: null;
      /** Short technical detail; never a stack trace or a backend path. */
      details?: string;
    };

export interface DialogueServiceOptions {
  transcripts?: TranscriptRepository;
  diarizations?: DiarizationRepository;
  dialogues?: UnifiedDialogueRepository;
  config?: Partial<DialogueMergeConfig>;
  createId?: () => string;
  now?: () => Date;
  logger?: (message: string, detail?: Record<string, unknown>) => void;
}

function defaultLogger(
  message: string,
  detail: Record<string, unknown> = {},
): void {
  // Identifiers and counts only — never dialogue text.
  console.info(`[aidub:dialogue] ${message}`, detail);
}

export class DialogueService {
  private readonly transcripts: TranscriptRepository;
  private readonly diarizations: DiarizationRepository;
  private readonly dialogues: UnifiedDialogueRepository;
  private readonly config: DialogueMergeConfig;
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly logger: (
    message: string,
    detail?: Record<string, unknown>,
  ) => void;

  constructor(options: DialogueServiceOptions = {}) {
    this.transcripts = options.transcripts ?? transcriptRepository;
    this.diarizations = options.diarizations ?? diarizationRepository;
    this.dialogues = options.dialogues ?? dialogueRepository;
    this.config = resolveMergeConfig(options.config);
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? defaultLogger;
  }

  /**
   * The dialogue a caller should show for this source right now, generating or
   * regenerating it when needed. Missing prerequisites come back as a state,
   * never as a fabricated dialogue.
   */
  async getCurrentDialogue(
    projectId: string,
    sourceMediaId: string,
  ): Promise<DialogueResolution> {
    const [transcript, diarization] = await Promise.all([
      this.transcripts.getByProject(projectId, sourceMediaId),
      this.diarizations.getByProjectAndSource(projectId, sourceMediaId),
    ]);

    if (!transcript || transcript.status !== "completed") {
      return { state: "transcript_required", dialogue: null };
    }

    if (!diarization || diarization.status !== "completed") {
      return { state: "diarization_required", dialogue: null };
    }

    // Both records were fetched by project and source, but the check is made
    // explicit: an STT result from one source must never be combined with a
    // diarization from another, however compatible the timestamps look.
    const mismatch = describeSourceMismatch(
      projectId,
      sourceMediaId,
      transcript,
      diarization,
    );

    if (mismatch) {
      return { state: "source_mismatch", dialogue: null, details: mismatch };
    }

    const stored = await this.dialogues
      .getByProjectAndSource(projectId, sourceMediaId)
      .catch(() => null);

    if (stored) {
      const currency = dialogueCurrency(stored, transcript, diarization);

      if (currency.current) {
        return { state: "ready", dialogue: stored, regenerated: false };
      }

      this.logger("regenerating stale dialogue", {
        projectId,
        dialogueId: stored.id,
        reason: currency.reason,
      });
    }

    return this.regenerate(transcript, diarization, stored);
  }

  /**
   * Rebuilds the dialogue from raw inputs. Part 7 dialogue is purely derived,
   * so replacing the previous one is safe; Part 8 introduces manual edits and
   * will have to revisit this policy before overwriting anything a user
   * touched.
   */
  async regenerate(
    transcript: Transcript,
    diarization: DiarizationResult,
    previous?: UnifiedDialogue | null,
  ): Promise<DialogueResolution> {
    const outcome = mergeDialogue(transcript, diarization, {
      config: this.config,
    });

    if (!outcome.ok) {
      this.logger("merge rejected", {
        projectId: transcript.projectId,
        transcriptId: transcript.id,
        diarizationId: diarization.id,
        details: outcome.details,
      });

      return { state: "failed", dialogue: null, details: outcome.details };
    }

    const timestamp = this.now().toISOString();
    const dialogue: UnifiedDialogue = {
      id: this.createId(),
      projectId: transcript.projectId,
      sourceMediaId: transcript.sourceMediaId,
      transcriptId: transcript.id,
      diarizationId: diarization.id,
      version: DIALOGUE_SCHEMA_VERSION,
      status: "completed",
      segments: outcome.draft.segments,
      createdAt: timestamp,
      updatedAt: timestamp,
      mergeMetadata: {
        algorithmVersion: MERGE_ALGORITHM_VERSION,
        transcriptId: transcript.id,
        diarizationId: diarization.id,
        generatedAt: timestamp,
        config: toConfigSnapshot(this.config),
        ambiguousSegmentCount: outcome.draft.ambiguousSegmentCount,
        overlappingSegmentCount: outcome.draft.overlappingSegmentCount,
        unassignedSegmentCount: outcome.draft.unassignedSegmentCount,
      },
    };

    try {
      await this.dialogues.save(dialogue);
    } catch (cause) {
      this.logger("dialogue could not be saved", {
        projectId: dialogue.projectId,
        details: cause instanceof Error ? cause.name : "unknown",
      });

      return { state: "failed", dialogue: null, details: "save_failed" };
    }

    // The superseded dialogue is dropped only once the new one is stored.
    const stale =
      previous ??
      (await this.dialogues
        .getByProjectAndSource(dialogue.projectId, dialogue.sourceMediaId)
        .catch(() => null));

    if (stale && stale.id !== dialogue.id) {
      await this.dialogues.delete(stale.id).catch(() => {
        // An orphaned old dialogue is harmless; the new one is active.
      });
    }

    this.logger("dialogue generated", {
      projectId: dialogue.projectId,
      dialogueId: dialogue.id,
      transcriptId: dialogue.transcriptId,
      diarizationId: dialogue.diarizationId,
      segmentCount: dialogue.segments.length,
      unassigned: outcome.draft.unassignedSegmentCount,
      ambiguous: outcome.draft.ambiguousSegmentCount,
    });

    return { state: "ready", dialogue, regenerated: true };
  }

  /** Used by media/project cleanup; raw inputs are disposed of separately. */
  async deleteByMedia(
    projectId: string,
    sourceMediaId: string,
  ): Promise<void> {
    await this.dialogues.deleteByMedia(projectId, sourceMediaId);
  }

  async deleteByProject(projectId: string): Promise<void> {
    await this.dialogues.deleteByProject(projectId);
  }
}

function describeSourceMismatch(
  projectId: string,
  sourceMediaId: string,
  transcript: Transcript,
  diarization: DiarizationResult,
): string | null {
  if (
    transcript.projectId !== projectId ||
    diarization.projectId !== projectId
  ) {
    return "project mismatch";
  }

  if (
    transcript.sourceMediaId !== sourceMediaId ||
    diarization.sourceMediaId !== sourceMediaId
  ) {
    return "source media mismatch";
  }

  if (transcript.sourceMediaId !== diarization.sourceMediaId) {
    return "transcript and diarization describe different sources";
  }

  return null;
}

export const dialogueService = new DialogueService();
