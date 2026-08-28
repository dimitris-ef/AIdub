import {
  isAssignmentReason,
  isDialogueStatus,
  isSpeakerAssignmentMethod,
  type DialogueSegment,
  type DialogueSegmentEditMetadata,
  type DialogueSpeaker,
  type DialogueSpeakerCandidate,
  type UnifiedDialogue,
} from "@/types/dialogue";
import { DIALOGUE_SCHEMA_VERSION } from "@/lib/dialogue/merge-config";

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

/**
 * A speaker id the dialogue can own: a canonical Part 6 cluster id, or one a
 * person created here. Raw provider labels are never valid.
 */
export function isDialogueSpeakerId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (/^speaker_[1-9]\d*$/.test(value) || /^speaker_manual_[A-Za-z0-9-]+$/.test(value))
  );
}

function parseSegmentEditMetadata(
  value: unknown,
): DialogueSegmentEditMetadata {
  const record = (typeof value === "object" && value !== null
    ? value
    : {}) as Record<string, unknown>;

  return {
    manuallyEditedText: record.manuallyEditedText === true,
    manuallyEditedSpeaker: record.manuallyEditedSpeaker === true,
    manuallyEditedTiming: record.manuallyEditedTiming === true,
    manuallyChangedStructure: record.manuallyChangedStructure === true,
    parentSegmentIds: Array.isArray(record.parentSegmentIds)
      ? record.parentSegmentIds.filter(isNonEmptyString)
      : [],
  };
}

function parseSpeaker(value: unknown): DialogueSpeaker | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (!isDialogueSpeakerId(record.id) || !isNonEmptyString(record.name)) {
    return null;
  }

  return {
    id: record.id,
    name: record.name,
    sourceSpeakerIds: Array.isArray(record.sourceSpeakerIds)
      ? record.sourceSpeakerIds.filter(isNonEmptyString)
      : [record.id],
    createdManually: record.createdManually === true,
    createdAt: isNonEmptyString(record.createdAt) ? record.createdAt : "",
    updatedAt: isNonEmptyString(record.updatedAt) ? record.updatedAt : "",
  };
}

function parseCandidate(value: unknown): DialogueSpeakerCandidate | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    !isDialogueSpeakerId(record.speakerId) ||
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

  // A speaker id is either absent or one the dialogue can resolve — a raw
  // provider label stored here would break every downstream consumer that
  // joins on speaker identity.
  if (record.speakerId !== null && !isDialogueSpeakerId(record.speakerId)) {
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
      ...(typeof assignment.automatic === "object" && assignment.automatic !== null
        ? {
            automatic: assignment.automatic as NonNullable<
              DialogueSegment["assignment"]["automatic"]
            >,
          }
        : {}),
    },
    editMetadata: parseSegmentEditMetadata(record.editMetadata),
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

  const speakers: DialogueSpeaker[] = [];

  if (Array.isArray(record.speakers)) {
    for (const rawSpeaker of record.speakers) {
      const speaker = parseSpeaker(rawSpeaker);

      if (!speaker) {
        return null;
      }

      speakers.push(speaker);
    }
  } else if (record.version < DIALOGUE_SCHEMA_VERSION) {
    // v1 → v2 migration: a Part 7 dialogue predates editable speaker records,
    // so they are reconstructed from the segments themselves rather than
    // throwing the dialogue away for a schema addition.
    for (const speakerId of new Set(
      segments
        .map((segment) => segment.speakerId)
        .filter((id): id is string => id !== null),
    )) {
      speakers.push({
        id: speakerId,
        name: defaultSpeakerName(speakerId),
        sourceSpeakerIds: [speakerId],
        createdManually: false,
        createdAt: record.createdAt,
        updatedAt: record.createdAt,
      });
    }
  } else {
    return null;
  }

  // Every assigned segment must resolve to a speaker this dialogue owns.
  const speakerIds = new Set(speakers.map((speaker) => speaker.id));

  for (const segment of segments) {
    if (segment.speakerId !== null && !speakerIds.has(segment.speakerId)) {
      return null;
    }
  }

  const edit = record.editMetadata as Record<string, unknown> | undefined;

  return {
    id: record.id,
    projectId: record.projectId,
    sourceMediaId: record.sourceMediaId,
    transcriptId: record.transcriptId,
    diarizationId: record.diarizationId,
    version: record.version,
    status: record.status,
    segments,
    speakers,
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
    editMetadata: {
      hasManualEdits: edit?.hasManualEdits === true,
      revision:
        typeof edit?.revision === "number" && Number.isInteger(edit.revision)
          ? edit.revision
          : 0,
      editedAt: isNonEmptyString(edit?.editedAt) ? edit.editedAt : null,
      baselineAlgorithmVersion: isNonEmptyString(edit?.baselineAlgorithmVersion)
        ? edit.baselineAlgorithmVersion
        : merge.algorithmVersion,
    },
  };
}

/** "speaker_2" → "Speaker 2"; manual ids fall back to a generic label. */
export function defaultSpeakerName(speakerId: string): string {
  const match = /^speaker_([1-9]\d*)$/.exec(speakerId);

  return match ? `Speaker ${match[1]}` : "Speaker";
}
