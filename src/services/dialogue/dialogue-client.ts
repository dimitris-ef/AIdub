import {
  isAssignmentReason,
  isDialogueStatus,
  isSpeakerAssignmentMethod,
  type DialogueSegment,
  type UnifiedDialogue,
} from "@/types/dialogue";

/**
 * The frontend's view of the unified dialogue.
 *
 * This is the stable contract future features consume: a component asks for
 * "who said what, and when" and gets it, without ever loading a transcript and
 * a diarization and correlating them itself, and without knowing which
 * providers produced either.
 */

export const DIALOGUE_STATES = [
  "ready",
  "transcript_required",
  "diarization_required",
  "source_mismatch",
  "failed",
] as const;

export type DialogueState = (typeof DIALOGUE_STATES)[number];

export interface DialogueResponse {
  state: DialogueState;
  dialogue: UnifiedDialogue | null;
  regenerated: boolean;
}

export class DialogueRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DialogueRequestError";
  }
}

export interface DialogueClient {
  getDialogue(
    projectId: string,
    sourceMediaId: string,
    signal?: AbortSignal,
  ): Promise<DialogueResponse>;
}

function invalid(): never {
  throw new DialogueRequestError(
    "INVALID_RESPONSE",
    "The stored dialogue could not be read.",
  );
}

function isDialogueState(value: unknown): value is DialogueState {
  return (
    typeof value === "string" &&
    (DIALOGUE_STATES as readonly string[]).includes(value)
  );
}

function parseSegment(value: unknown): DialogueSegment {
  const segment = value as Partial<DialogueSegment> | null;

  if (
    !segment ||
    typeof segment.id !== "string" ||
    typeof segment.originalText !== "string" ||
    typeof segment.startTime !== "number" ||
    typeof segment.endTime !== "number" ||
    !Number.isFinite(segment.startTime) ||
    !Number.isFinite(segment.endTime) ||
    (segment.speakerId !== null && typeof segment.speakerId !== "string") ||
    !segment.transcription ||
    !segment.diarization ||
    !segment.assignment ||
    !isSpeakerAssignmentMethod(segment.assignment.method)
  ) {
    invalid();
  }

  return {
    id: segment.id,
    speakerId: segment.speakerId ?? null,
    startTime: segment.startTime,
    endTime: segment.endTime,
    originalText: segment.originalText,
    transcription: {
      transcriptId: segment.transcription.transcriptId ?? "",
      transcriptSegmentId: segment.transcription.transcriptSegmentId ?? "",
      confidence:
        typeof segment.transcription.confidence === "number"
          ? segment.transcription.confidence
          : null,
      status: segment.transcription.status ?? "completed",
      providerId: segment.transcription.providerId ?? "",
      providerModel: segment.transcription.providerModel ?? null,
    },
    diarization: {
      diarizationId: segment.diarization.diarizationId ?? "",
      regionIds: Array.isArray(segment.diarization.regionIds)
        ? segment.diarization.regionIds
        : [],
      confidence:
        typeof segment.diarization.confidence === "number"
          ? segment.diarization.confidence
          : null,
      overlap: segment.diarization.overlap === true,
      candidateSpeakers: Array.isArray(segment.diarization.candidateSpeakers)
        ? segment.diarization.candidateSpeakers
        : [],
      providerId: segment.diarization.providerId ?? "",
      providerModel: segment.diarization.providerModel ?? null,
    },
    assignment: {
      method: segment.assignment.method,
      confidence:
        typeof segment.assignment.confidence === "number"
          ? segment.assignment.confidence
          : null,
      overlapRatio:
        typeof segment.assignment.overlapRatio === "number"
          ? segment.assignment.overlapRatio
          : null,
      uncertain: segment.assignment.uncertain === true,
      reason: isAssignmentReason(segment.assignment.reason)
        ? segment.assignment.reason
        : null,
    },
  };
}

/** Validates a dialogue coming off the wire before the UI renders it. */
export function parseDialogue(value: unknown): UnifiedDialogue {
  const dialogue = value as Partial<UnifiedDialogue> | null;

  if (
    !dialogue ||
    typeof dialogue.id !== "string" ||
    typeof dialogue.projectId !== "string" ||
    typeof dialogue.sourceMediaId !== "string" ||
    typeof dialogue.transcriptId !== "string" ||
    typeof dialogue.diarizationId !== "string" ||
    typeof dialogue.version !== "number" ||
    !isDialogueStatus(dialogue.status) ||
    !Array.isArray(dialogue.segments) ||
    !dialogue.mergeMetadata
  ) {
    invalid();
  }

  return {
    id: dialogue.id,
    projectId: dialogue.projectId,
    sourceMediaId: dialogue.sourceMediaId,
    transcriptId: dialogue.transcriptId,
    diarizationId: dialogue.diarizationId,
    version: dialogue.version,
    status: dialogue.status,
    segments: dialogue.segments.map(parseSegment),
    createdAt: dialogue.createdAt ?? "",
    updatedAt: dialogue.updatedAt ?? "",
    mergeMetadata: dialogue.mergeMetadata,
  };
}

export class HttpDialogueClient implements DialogueClient {
  constructor(private readonly baseUrl = "/api/dialogue") {}

  async getDialogue(
    projectId: string,
    sourceMediaId: string,
    signal?: AbortSignal,
  ): Promise<DialogueResponse> {
    const query = new URLSearchParams({ projectId, mediaId: sourceMediaId });
    const response = await fetch(`${this.baseUrl}?${query.toString()}`, {
      signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new DialogueRequestError(
        "REQUEST_FAILED",
        "The dialogue could not be loaded.",
      );
    }

    const body = (await response.json()) as {
      state?: unknown;
      dialogue?: unknown;
      regenerated?: unknown;
    };

    if (!isDialogueState(body.state)) {
      invalid();
    }

    return {
      state: body.state,
      dialogue: body.dialogue ? parseDialogue(body.dialogue) : null,
      regenerated: body.regenerated === true,
    };
  }
}

export const dialogueClient: DialogueClient = new HttpDialogueClient();
