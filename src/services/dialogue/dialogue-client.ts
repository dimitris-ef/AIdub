import {
  isAssignmentReason,
  isDialogueStatus,
  isSpeakerAssignmentMethod,
  type DialogueSegment,
  type DialogueSpeaker,
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
  /**
   * Present when the active dialogue carries manual corrections but was built
   * from raw results that have since been replaced. The edited document is
   * still served — never overwritten — and the caller can say so.
   */
  staleBaseline?: {
    reason: string;
    currentTranscriptId: string;
    currentDiarizationId: string;
  };
}

/** One human correction, applied server-side against the current document. */
export type DialogueEdit =
  | { type: "update_text"; segmentId: string; text: string }
  | { type: "rename_speaker"; speakerId: string; name: string }
  | { type: "reassign_speaker"; segmentId: string; speakerId: string | null }
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
  | { type: "merge_segments"; firstSegmentId: string; secondSegmentId: string }
  | {
      type: "update_timing";
      segmentId: string;
      startTime: number;
      endTime: number;
      mediaDuration?: number | null;
    };

export interface DialogueEditResponse {
  dialogue: UnifiedDialogue;
  /** Segments that now overlap another line and did not before. */
  newOverlaps: string[];
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
  applyEdit(
    projectId: string,
    sourceMediaId: string,
    edit: DialogueEdit,
    signal?: AbortSignal,
  ): Promise<DialogueEditResponse>;
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
      ...(segment.assignment.automatic
        ? { automatic: segment.assignment.automatic }
        : {}),
    },
    editMetadata: {
      manuallyEditedText: segment.editMetadata?.manuallyEditedText === true,
      manuallyEditedSpeaker:
        segment.editMetadata?.manuallyEditedSpeaker === true,
      manuallyEditedTiming: segment.editMetadata?.manuallyEditedTiming === true,
      manuallyChangedStructure:
        segment.editMetadata?.manuallyChangedStructure === true,
      parentSegmentIds: Array.isArray(segment.editMetadata?.parentSegmentIds)
        ? segment.editMetadata.parentSegmentIds
        : [],
    },
  };
}

function parseSpeaker(value: unknown): DialogueSpeaker {
  const speaker = value as Partial<DialogueSpeaker> | null;

  if (
    !speaker ||
    typeof speaker.id !== "string" ||
    typeof speaker.name !== "string"
  ) {
    invalid();
  }

  return {
    id: speaker.id,
    name: speaker.name,
    sourceSpeakerIds: Array.isArray(speaker.sourceSpeakerIds)
      ? speaker.sourceSpeakerIds
      : [speaker.id],
    createdManually: speaker.createdManually === true,
    createdAt: speaker.createdAt ?? "",
    updatedAt: speaker.updatedAt ?? "",
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
    !Array.isArray(dialogue.speakers) ||
    !dialogue.mergeMetadata ||
    !dialogue.editMetadata
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
    speakers: dialogue.speakers.map(parseSpeaker),
    createdAt: dialogue.createdAt ?? "",
    updatedAt: dialogue.updatedAt ?? "",
    mergeMetadata: dialogue.mergeMetadata,
    editMetadata: dialogue.editMetadata,
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
      staleBaseline?: unknown;
    };

    if (!isDialogueState(body.state)) {
      invalid();
    }

    return {
      state: body.state,
      ...(body.staleBaseline
        ? {
            staleBaseline: body.staleBaseline as NonNullable<
              DialogueResponse["staleBaseline"]
            >,
          }
        : {}),
      dialogue: body.dialogue ? parseDialogue(body.dialogue) : null,
      regenerated: body.regenerated === true,
    };
  }

  async applyEdit(
    projectId: string,
    sourceMediaId: string,
    edit: DialogueEdit,
    signal?: AbortSignal,
  ): Promise<DialogueEditResponse> {
    const query = new URLSearchParams({ projectId, mediaId: sourceMediaId });
    const response = await fetch(`${this.baseUrl}?${query.toString()}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(edit),
      signal,
      cache: "no-store",
    });

    const body = (await response.json().catch(() => null)) as {
      dialogue?: unknown;
      newOverlaps?: unknown;
      error?: { code?: string; message?: string };
    } | null;

    if (!response.ok || !body?.dialogue) {
      // The server reports why in plain language; nothing here invents a
      // success the store did not actually record.
      throw new DialogueRequestError(
        body?.error?.code ?? "REQUEST_FAILED",
        body?.error?.message ?? "The change could not be saved.",
      );
    }

    return {
      dialogue: parseDialogue(body.dialogue),
      newOverlaps: Array.isArray(body.newOverlaps)
        ? (body.newOverlaps as string[])
        : [],
    };
  }
}

export const dialogueClient: DialogueClient = new HttpDialogueClient();
