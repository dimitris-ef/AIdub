import {
  isTranscriptSegmentStatus,
  isTranscriptStatus,
  type Transcript,
  type TranscriptSegment,
} from "@/types/transcript";

/**
 * Transcript persistence contract.
 *
 * The UI reads transcripts through an HTTP client, never through a storage
 * implementation, so replacing the development store with PostgreSQL, another
 * database or a document store changes nothing above this layer.
 */
export interface TranscriptRepository {
  /** The active transcript for one exact source media version. */
  getByProject(
    projectId: string,
    sourceMediaId: string,
  ): Promise<Transcript | null>;
  getById(id: string): Promise<Transcript | null>;
  listByProject(projectId: string): Promise<Transcript[]>;
  save(transcript: Transcript): Promise<Transcript>;
  delete(id: string): Promise<void>;
  deleteByMedia(projectId: string, sourceMediaId: string): Promise<void>;
  deleteByProject(projectId: string): Promise<void>;
}

export class TranscriptStorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TranscriptStorageError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseSegment(value: unknown): TranscriptSegment | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

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

  const confidence =
    typeof record.confidence === "number" && Number.isFinite(record.confidence)
      ? record.confidence
      : null;

  return {
    id: record.id,
    startTime: record.startTime,
    endTime: record.endTime,
    originalText: record.originalText,
    status: isTranscriptSegmentStatus(record.status)
      ? record.status
      : "completed",
    confidence,
    ...(typeof record.providerMetadata === "object" &&
    record.providerMetadata !== null
      ? {
          providerMetadata: record.providerMetadata as Record<string, unknown>,
        }
      : {}),
  };
}

/**
 * Defensive parse of a stored transcript. Development data can be stale or
 * hand-edited; a structurally broken record is rejected so the workspace can
 * report a recoverable error instead of crashing on it.
 */
export function parseStoredTranscript(value: unknown): Transcript | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    !isNonEmptyString(record.id) ||
    !isNonEmptyString(record.projectId) ||
    !isNonEmptyString(record.sourceMediaId) ||
    !isNonEmptyString(record.providerId) ||
    !isTranscriptStatus(record.status) ||
    !Array.isArray(record.segments) ||
    !isNonEmptyString(record.createdAt) ||
    !isNonEmptyString(record.updatedAt)
  ) {
    return null;
  }

  const segments: TranscriptSegment[] = [];

  for (const rawSegment of record.segments) {
    const segment = parseSegment(rawSegment);

    // One broken segment invalidates the record: a transcript with silently
    // missing lines is worse than a reported error.
    if (!segment) {
      return null;
    }

    segments.push(segment);
  }

  return {
    id: record.id,
    projectId: record.projectId,
    sourceMediaId: record.sourceMediaId,
    audioArtifactId: isNonEmptyString(record.audioArtifactId)
      ? record.audioArtifactId
      : null,
    providerId: record.providerId,
    providerModel: isNonEmptyString(record.providerModel)
      ? record.providerModel
      : null,
    language: isNonEmptyString(record.language) ? record.language : null,
    status: record.status,
    segments,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
