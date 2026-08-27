import {
  isAssignmentReason,
  isDialogueStatus,
  isSpeakerAssignmentMethod,
  type DialogueSegment,
  type DialogueSpeakerCandidate,
  type UnifiedDialogue,
} from "@/types/dialogue";
import { isCanonicalSpeakerId } from "@/lib/diarization/speaker-ids";

/**
 * Unified dialogue persistence contract.
 *
 * The UI reads dialogue through an HTTP client, never through a storage
 * implementation, so replacing the development store with PostgreSQL or
 * another database changes nothing above this layer.
 */
export interface UnifiedDialogueRepository {
  /** The active dialogue for one exact source media version. */
  getByProjectAndSource(
    projectId: string,
    sourceMediaId: string,
  ): Promise<UnifiedDialogue | null>;
  getById(id: string): Promise<UnifiedDialogue | null>;
  listByProject(projectId: string): Promise<UnifiedDialogue[]>;
  save(dialogue: UnifiedDialogue): Promise<UnifiedDialogue>;
  delete(id: string): Promise<void>;
  deleteByMedia(projectId: string, sourceMediaId: string): Promise<void>;
  deleteByProject(projectId: string): Promise<void>;
}

export class DialogueStorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DialogueStorageError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCandidate(value: unknown): DialogueSpeakerCandidate | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    !isCanonicalSpeakerId(record.speakerId) ||
    typeof record.overlapDuration !== "number" ||
    !Number.isFinite(record.overlapDuration) ||
    typeof record.overlapRatio !== "number" ||
    !Number.isFinite(record.overlapRatio)
  ) {
    return null;
  }

  return {
    speakerId: record.speakerId,
    overlapDuration: record.overlapDuration,
    overlapRatio: record.overlapRatio,
  };
}

function parseSegment(value: unknown): DialogueSegment | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const transcription = record.transcription as
    | Record<string, unknown>
    | undefined;
  const diarization = record.diarization as Record<string, unknown> | undefined;
  const assignment = record.assignment as Record<string, unknown> | undefined;

  if (
    !isNonEmptyString(record.id) ||
    typeof record.originalText !== "string" ||
    typeof record.startTime !== "number" ||
    typeof record.endTime !== "number" ||
    !Number.isFinite(record.startTime) ||
    !Number.isFinite(record.endTime) ||
    record.startTime < 0 ||
    record.endTime < record.startTime
  ) {
    return null;
  }

  // A speaker id is either absent or canonical — a raw provider label stored
  // here would break every downstream consumer that joins on speaker identity.
  if (record.speakerId !== null && !isCanonicalSpeakerId(record.speakerId)) {
    return null;
  }

  if (
    !transcription ||
    !isNonEmptyString(transcription.transcriptId) ||
    !isNonEmptyString(transcription.transcriptSegmentId) ||
    !isNonEmptyString(transcription.providerId)
  ) {
    return null;
  }

  if (
    !diarization ||
    !isNonEmptyString(diarization.diarizationId) ||
    !Array.isArray(diarization.regionIds) ||
    !diarization.regionIds.every(isNonEmptyString) ||
    !Array.isArray(diarization.candidateSpeakers) ||
    !isNonEmptyString(diarization.providerId)
  ) {
    return null;
  }

  if (
    !assignment ||
    !isSpeakerAssignmentMethod(assignment.method) ||
    typeof assignment.uncertain !== "boolean"
  ) {
    return null;
  }

  // An unassigned segment must not carry a speaker, and an assigned one must.
  if (
    (assignment.method === "unassigned") !==
    (record.speakerId === null)
  ) {
    return null;
  }

  const candidateSpeakers: DialogueSpeakerCandidate[] = [];

  for (const raw of diarization.candidateSpeakers) {
    const candidate = parseCandidate(raw);

    if (!candidate) {
      return null;
    }

    candidateSpeakers.push(candidate);
  }

  return {
    id: record.id,
    speakerId: record.speakerId as string | null,
    startTime: record.startTime,
    endTime: record.endTime,
    originalText: record.originalText,
    transcription: {
      transcriptId: transcription.transcriptId,
      transcriptSegmentId: transcription.transcriptSegmentId,
      confidence: finiteNumberOrNull(transcription.confidence),
      status: isNonEmptyString(transcription.status)
        ? transcription.status
        : "completed",
      providerId: transcription.providerId,
      providerModel: isNonEmptyString(transcription.providerModel)
        ? transcription.providerModel
        : null,
    },
    diarization: {
      diarizationId: diarization.diarizationId,
      regionIds: diarization.regionIds as string[],
      confidence: finiteNumberOrNull(diarization.confidence),
      overlap: diarization.overlap === true,
      candidateSpeakers,
      providerId: diarization.providerId,
      providerModel: isNonEmptyString(diarization.providerModel)
        ? diarization.providerModel
        : null,
    },
    assignment: {
      method: assignment.method,
      confidence: finiteNumberOrNull(assignment.confidence),
      overlapRatio: finiteNumberOrNull(assignment.overlapRatio),
      uncertain: assignment.uncertain,
      reason: isAssignmentReason(assignment.reason) ? assignment.reason : null,
    },
  };
}

/**
 * Defensive parse of a stored dialogue. Development data can be stale or
 * hand-edited; a structurally broken record is rejected so the workspace can
 * regenerate or report a recoverable state instead of crashing on it.
 */
export function parseStoredDialogue(value: unknown): UnifiedDialogue | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const merge = record.mergeMetadata as Record<string, unknown> | undefined;

  if (
    !isNonEmptyString(record.id) ||
    !isNonEmptyString(record.projectId) ||
    !isNonEmptyString(record.sourceMediaId) ||
    !isNonEmptyString(record.transcriptId) ||
    !isNonEmptyString(record.diarizationId) ||
    typeof record.version !== "number" ||
    !Number.isInteger(record.version) ||
    !isDialogueStatus(record.status) ||
    !Array.isArray(record.segments) ||
    !isNonEmptyString(record.createdAt) ||
    !isNonEmptyString(record.updatedAt)
  ) {
    return null;
  }

  if (
    !merge ||
    !isNonEmptyString(merge.algorithmVersion) ||
    !isNonEmptyString(merge.transcriptId) ||
    !isNonEmptyString(merge.diarizationId) ||
    typeof merge.config !== "object" ||
    merge.config === null
  ) {
    return null;
  }

  // The metadata must describe the same raw inputs the dialogue claims.
  if (
    merge.transcriptId !== record.transcriptId ||
    merge.diarizationId !== record.diarizationId
  ) {
    return null;
  }

  const config = merge.config as Record<string, unknown>;
  const segments: DialogueSegment[] = [];

  for (const rawSegment of record.segments) {
    const segment = parseSegment(rawSegment);

    // One broken segment invalidates the record: a dialogue with silently
    // missing lines is worse than a reported error, and it is cheap to
    // regenerate from the raw inputs that are still on disk.
    if (!segment) {
      return null;
    }

    if (segment.transcription.transcriptId !== record.transcriptId) {
      return null;
    }

    if (segment.diarization.diarizationId !== record.diarizationId) {
      return null;
    }

    segments.push(segment);
  }

  return {
    id: record.id,
    projectId: record.projectId,
    sourceMediaId: record.sourceMediaId,
    transcriptId: record.transcriptId,
    diarizationId: record.diarizationId,
    version: record.version,
    status: record.status,
    segments,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    mergeMetadata: {
      algorithmVersion: merge.algorithmVersion,
      transcriptId: merge.transcriptId,
      diarizationId: merge.diarizationId,
      generatedAt: isNonEmptyString(merge.generatedAt)
        ? merge.generatedAt
        : record.createdAt,
      config: {
        minSpeakerCoverage: Number(config.minSpeakerCoverage),
        dominantSpeakerRatio: Number(config.dominantSpeakerRatio),
        splitMinimumDuration: Number(config.splitMinimumDuration),
        nearestRegionMaxGap: Number(config.nearestRegionMaxGap),
      },
      ambiguousSegmentCount: Number(merge.ambiguousSegmentCount ?? 0),
      overlappingSegmentCount: Number(merge.overlappingSegmentCount ?? 0),
      unassignedSegmentCount: Number(merge.unassignedSegmentCount ?? 0),
    },
  };
}
