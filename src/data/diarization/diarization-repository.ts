import {
  isDiarizationStatus,
  type DiarizationResult,
  type DiarizedSpeaker,
  type SpeakerRegion,
} from "@/types/diarization";
import { isCanonicalSpeakerId } from "@/lib/diarization/speaker-ids";

/**
 * Diarization persistence contract.
 *
 * The UI reads results through an HTTP client, never through a storage
 * implementation, so replacing the development store with PostgreSQL, another
 * database or a document store changes nothing above this layer.
 */
export interface DiarizationRepository {
  /** The active result for one exact source media version. */
  getByProjectAndSource(
    projectId: string,
    sourceMediaId: string,
  ): Promise<DiarizationResult | null>;
  getById(id: string): Promise<DiarizationResult | null>;
  listByProject(projectId: string): Promise<DiarizationResult[]>;
  save(result: DiarizationResult): Promise<DiarizationResult>;
  delete(id: string): Promise<void>;
  deleteByMedia(projectId: string, sourceMediaId: string): Promise<void>;
  deleteByProject(projectId: string): Promise<void>;
}

export class DiarizationStorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DiarizationStorageError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalMetadata(
  value: unknown,
): { providerMetadata: Record<string, unknown> } | Record<string, never> {
  return typeof value === "object" && value !== null
    ? { providerMetadata: value as Record<string, unknown> }
    : {};
}

function parseSpeaker(value: unknown): DiarizedSpeaker | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  // Canonical ids are what Part 7 will join on; a stored record using a raw
  // provider label is not usable and is rejected rather than repaired.
  if (!isCanonicalSpeakerId(record.id) || !isNonEmptyString(record.label)) {
    return null;
  }

  return {
    id: record.id,
    label: record.label,
    confidence:
      typeof record.confidence === "number" &&
      Number.isFinite(record.confidence)
        ? record.confidence
        : null,
    ...optionalMetadata(record.providerMetadata),
  };
}

function parseRegion(
  value: unknown,
  speakerIds: ReadonlySet<string>,
): SpeakerRegion | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    !isNonEmptyString(record.id) ||
    !isNonEmptyString(record.speakerId) ||
    !speakerIds.has(record.speakerId) ||
    typeof record.startTime !== "number" ||
    typeof record.endTime !== "number" ||
    !Number.isFinite(record.startTime) ||
    !Number.isFinite(record.endTime) ||
    record.startTime < 0 ||
    record.endTime < record.startTime
  ) {
    return null;
  }

  return {
    id: record.id,
    speakerId: record.speakerId,
    startTime: record.startTime,
    endTime: record.endTime,
    confidence:
      typeof record.confidence === "number" &&
      Number.isFinite(record.confidence)
        ? record.confidence
        : null,
    overlap: record.overlap === true,
    ...optionalMetadata(record.providerMetadata),
  };
}

/**
 * Defensive parse of a stored diarization result. Development data can be
 * stale or hand-edited; a structurally broken record is rejected so the
 * workspace reports a recoverable error instead of crashing on it — or worse,
 * handing Part 7 a region that points at a speaker that does not exist.
 */
export function parseStoredDiarization(
  value: unknown,
): DiarizationResult | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    !isNonEmptyString(record.id) ||
    !isNonEmptyString(record.projectId) ||
    !isNonEmptyString(record.sourceMediaId) ||
    !isNonEmptyString(record.providerId) ||
    !isDiarizationStatus(record.status) ||
    !Array.isArray(record.speakers) ||
    !Array.isArray(record.regions) ||
    !isNonEmptyString(record.createdAt) ||
    !isNonEmptyString(record.updatedAt)
  ) {
    return null;
  }

  const speakers: DiarizedSpeaker[] = [];

  for (const rawSpeaker of record.speakers) {
    const speaker = parseSpeaker(rawSpeaker);

    if (!speaker) {
      return null;
    }

    speakers.push(speaker);
  }

  const speakerIds = new Set(speakers.map((speaker) => speaker.id));
  const regions: SpeakerRegion[] = [];

  for (const rawRegion of record.regions) {
    const region = parseRegion(rawRegion, speakerIds);

    // One broken region invalidates the record: a speaker timeline with
    // silently missing turns is worse than a reported error.
    if (!region) {
      return null;
    }

    regions.push(region);
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
    status: record.status,
    speakers,
    regions,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...optionalMetadata(record.providerMetadata),
  };
}
