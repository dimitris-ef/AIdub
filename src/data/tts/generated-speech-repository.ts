import {
  isGeneratedSpeechStatus,
  isTtsGenerationWarning,
  type GeneratedSpeechSegment,
  type TtsGenerationSettings,
  type TtsUsage,
} from "@/types/tts";
import { DEFAULT_TTS_SETTINGS } from "@/types/tts";
import { TTS_SCHEMA_VERSION } from "@/lib/tts/tts-config";

/**
 * Generated-speech metadata persistence.
 *
 * Metadata only — the audio bytes live in the shared artifact storage behind
 * `artifactId`. Keeping them apart means the workspace can list a hundred
 * generated lines without moving a hundred audio files, and it means a record
 * can outlive its bytes: development artifact storage is temp-directory backed,
 * so a record whose artifact is gone must read back as a record with no audio
 * rather than as a crash.
 *
 * One record per dialogue segment per language. Generating a line again
 * replaces its record rather than appending, so there is never a set of rival
 * takes whose winner depends on a timestamp.
 */
export interface GeneratedSpeechIdentity {
  projectId: string;
  sourceMediaId: string;
  dialogueId: string;
  targetLanguage: string;
}

export interface GeneratedSpeechRepository {
  /** Every generated line for one dialogue and language. */
  listByIdentity(
    identity: GeneratedSpeechIdentity,
  ): Promise<GeneratedSpeechSegment[]>;
  getBySegment(
    identity: GeneratedSpeechIdentity,
    dialogueSegmentId: string,
  ): Promise<GeneratedSpeechSegment | null>;
  getById(id: string): Promise<GeneratedSpeechSegment | null>;
  save(segment: GeneratedSpeechSegment): Promise<GeneratedSpeechSegment>;
  /** Replaces a whole run's records in one go. */
  saveAll(
    segments: readonly GeneratedSpeechSegment[],
  ): Promise<GeneratedSpeechSegment[]>;
  delete(
    identity: GeneratedSpeechIdentity,
    dialogueSegmentId: string,
  ): Promise<void>;
  deleteByMedia(projectId: string, sourceMediaId: string): Promise<void>;
  deleteByProject(projectId: string): Promise<void>;
}

export class GeneratedSpeechStorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GeneratedSpeechStorageError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseSettings(value: unknown): TtsGenerationSettings {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_TTS_SETTINGS };
  }

  const record = value as Record<string, unknown>;

  return {
    speakingRate: finiteNumber(record.speakingRate) ? record.speakingRate : null,
    pitch: finiteNumber(record.pitch) ? record.pitch : null,
    volumeGain: finiteNumber(record.volumeGain) ? record.volumeGain : null,
    style: isNonEmptyString(record.style) ? record.style : null,
  };
}

function parseUsage(value: unknown): TtsUsage | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const usage: TtsUsage = {};

  for (const key of [
    "characters",
    "inputTokens",
    "audioSeconds",
    "requestCount",
  ] as const) {
    if (finiteNumber(record[key])) {
      usage[key] = record[key];
    }
  }

  if (typeof record.providerMetadata === "object" && record.providerMetadata) {
    usage.providerMetadata = record.providerMetadata as Record<string, unknown>;
  }

  // An object with nothing measured in it is no usage at all; storing `{}`
  // would later read as "the provider reported something".
  return Object.keys(usage).length > 0 ? usage : null;
}

/**
 * Validates a stored generated-speech record.
 *
 * A record that cannot be read is skipped, not repaired. Generated audio is
 * derived: the translation and the assignment can always produce it again, and
 * a half-understood record claiming to be current audio is worse than a line
 * the workspace offers to generate.
 */
export function parseStoredGeneratedSpeech(
  value: unknown,
): GeneratedSpeechSegment | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    !isNonEmptyString(record.id) ||
    !isNonEmptyString(record.projectId) ||
    !isNonEmptyString(record.sourceMediaId) ||
    !isNonEmptyString(record.dialogueId) ||
    !isNonEmptyString(record.dialogueSegmentId) ||
    !isNonEmptyString(record.translationId) ||
    !isNonEmptyString(record.targetLanguage) ||
    !isNonEmptyString(record.providerId) ||
    !isNonEmptyString(record.voiceId) ||
    !isNonEmptyString(record.fingerprint) ||
    !isGeneratedSpeechStatus(record.status) ||
    !finiteNumber(record.segmentDurationSeconds)
  ) {
    return null;
  }

  return {
    id: record.id,
    projectId: record.projectId,
    sourceMediaId: record.sourceMediaId,
    dialogueId: record.dialogueId,
    dialogueSegmentId: record.dialogueSegmentId,
    speakerId: isNonEmptyString(record.speakerId) ? record.speakerId : null,
    translationId: record.translationId,
    translationRevision: Number.isInteger(record.translationRevision)
      ? (record.translationRevision as number)
      : 0,
    translatedSegmentRevision: Number.isInteger(record.translatedSegmentRevision)
      ? (record.translatedSegmentRevision as number)
      : 0,
    targetLanguage: record.targetLanguage,
    providerId: record.providerId,
    providerModel: isNonEmptyString(record.providerModel)
      ? record.providerModel
      : null,
    voiceId: record.voiceId,
    artifactId: isNonEmptyString(record.artifactId) ? record.artifactId : null,
    mimeType: isNonEmptyString(record.mimeType) ? record.mimeType : null,
    status: record.status,
    durationSeconds: finiteNumber(record.durationSeconds)
      ? record.durationSeconds
      : null,
    segmentDurationSeconds: record.segmentDurationSeconds,
    generationSettings: parseSettings(record.generationSettings),
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter(isTtsGenerationWarning)
      : [],
    fingerprint: record.fingerprint,
    // An unversioned record predates versioning; treating it as the current
    // version would let old audio pass the staleness check.
    version: Number.isInteger(record.version)
      ? (record.version as number)
      : TTS_SCHEMA_VERSION - 1,
    createdAt: isNonEmptyString(record.createdAt) ? record.createdAt : "",
    updatedAt: isNonEmptyString(record.updatedAt) ? record.updatedAt : "",
    ...(typeof record.providerMetadata === "object" && record.providerMetadata
      ? {
          providerMetadata: record.providerMetadata as Record<string, unknown>,
        }
      : {}),
    usage: parseUsage(record.usage),
  };
}

export function matchesGeneratedSpeechIdentity(
  segment: GeneratedSpeechSegment,
  identity: GeneratedSpeechIdentity,
): boolean {
  return (
    segment.projectId === identity.projectId &&
    segment.sourceMediaId === identity.sourceMediaId &&
    segment.dialogueId === identity.dialogueId &&
    segment.targetLanguage === identity.targetLanguage
  );
}

/**
 * A deterministic record id, for the same reason as voice assignments: one
 * dialogue segment in one language has one current take, so regenerating
 * replaces rather than accumulates.
 */
export function generatedSpeechId(
  identity: GeneratedSpeechIdentity,
  dialogueSegmentId: string,
): string {
  return [identity.dialogueId, identity.targetLanguage, dialogueSegmentId]
    .map((part) => part.replace(/[^A-Za-z0-9._-]/g, "_"))
    .join("__");
}
