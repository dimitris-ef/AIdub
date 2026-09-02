import {
  isTranslationStatus,
  TRANSLATION_GENERATION_MODES,
  type DialogueTranslation,
  type DubbingTranslationMetadata,
  type TranslatedDialogueSegment,
  type TranslationEditMetadata,
  type TranslationGenerationMode,
  type TranslationIdentity,
  type TranslationUsage,
} from "@/types/translation";
import { isTranslationDurationWarning } from "@/lib/translation/duration-warning";
import { DURATION_ESTIMATOR_VERSION } from "@/lib/translation/duration-estimator";
import { migrateTranslation } from "@/lib/translation/translation-migrations";

/**
 * Translation persistence contract.
 *
 * The UI reads translations through an HTTP client, never through a storage
 * implementation, so replacing the development store with PostgreSQL or another
 * database changes nothing above this layer.
 *
 * The key space is deliberately wider than the current UI needs. A project has
 * one target language today, but the lookup is by the full
 * `TranslationIdentity`, so `Project A / Dialogue X / Polish` and
 * `Project A / Dialogue X / French` are independent records that can both
 * exist. Adding multi-language output later is then a UI change, not a
 * migration.
 */
export interface TranslationRepository {
  /** The stored translation for one exact identity, if there is one. */
  getByIdentity(
    identity: TranslationIdentity,
  ): Promise<DialogueTranslation | null>;
  getById(id: string): Promise<DialogueTranslation | null>;
  listByProject(projectId: string): Promise<DialogueTranslation[]>;
  /** Every translation of one dialogue, across revisions and languages. */
  listByDialogue(
    projectId: string,
    dialogueId: string,
  ): Promise<DialogueTranslation[]>;
  save(translation: DialogueTranslation): Promise<DialogueTranslation>;
  delete(id: string): Promise<void>;
  deleteByMedia(projectId: string, sourceMediaId: string): Promise<void>;
  deleteByProject(projectId: string): Promise<void>;
}

export class TranslationStorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TranslationStorageError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalMetadata(
  value: unknown,
): { providerMetadata: Record<string, unknown> } | Record<string, never> {
  return typeof value === "object" && value !== null
    ? { providerMetadata: value as Record<string, unknown> }
    : {};
}

function parseUsage(value: unknown): TranslationUsage | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const usage: TranslationUsage = {};

  for (const key of [
    "inputCharacters",
    "outputCharacters",
    "inputTokens",
    "outputTokens",
    "requestCount",
  ] as const) {
    if (finiteNumber(record[key])) {
      usage[key] = record[key];
    }
  }

  if (typeof record.providerMetadata === "object" && record.providerMetadata) {
    usage.providerMetadata = record.providerMetadata as Record<string, unknown>;
  }

  // An object with nothing measurable in it is no usage at all; storing `{}`
  // would later read as "the provider reported something".
  return Object.keys(usage).length > 0 ? usage : null;
}

function parseGenerationMode(value: unknown): TranslationGenerationMode | null {
  return typeof value === "string" &&
    (TRANSLATION_GENERATION_MODES as readonly string[]).includes(value)
    ? (value as TranslationGenerationMode)
    : null;
}

function parseConfidence(value: unknown): number | null {
  return finiteNumber(value) && value >= 0 && value <= 1 ? value : null;
}

/**
 * Part 10 metadata, when the stored record has it.
 *
 * Returns null for a Part 9 record so the migration can fill it in from what is
 * actually known, rather than this function inventing plausible-looking values
 * that would then be indistinguishable from measured ones.
 */
function parseTranslationMetadata(
  value: unknown,
): DubbingTranslationMetadata | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const generationMode = parseGenerationMode(record.generationMode);

  if (!isNonEmptyString(record.providerId) || !generationMode) {
    return null;
  }

  return {
    providerId: record.providerId,
    providerModel: isNonEmptyString(record.providerModel)
      ? record.providerModel
      : null,
    generationMode,
    generatedAt: isNonEmptyString(record.generatedAt) ? record.generatedAt : "",
    contextSegmentIds: Array.isArray(record.contextSegmentIds)
      ? record.contextSegmentIds.filter(isNonEmptyString)
      : [],
    estimatedDurationSeconds: finiteNumber(record.estimatedDurationSeconds)
      ? record.estimatedDurationSeconds
      : null,
    sourceDurationSeconds: finiteNumber(record.sourceDurationSeconds)
      ? record.sourceDurationSeconds
      : 0,
    durationRatio: finiteNumber(record.durationRatio)
      ? record.durationRatio
      : null,
    durationWarning: isTranslationDurationWarning(record.durationWarning)
      ? record.durationWarning
      : "none",
    durationEstimatorVersion: isNonEmptyString(record.durationEstimatorVersion)
      ? record.durationEstimatorVersion
      : DURATION_ESTIMATOR_VERSION,
    confidence: parseConfidence(record.confidence),
    ...optionalMetadata(record.providerMetadata),
  };
}

function parseEditMetadata(value: unknown): TranslationEditMetadata | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  return {
    manuallyEdited: record.manuallyEdited === true,
    revision: Number.isInteger(record.revision)
      ? (record.revision as number)
      : 0,
    editedAt: isNonEmptyString(record.editedAt) ? record.editedAt : null,
  };
}

function parseSegment(value: unknown): TranslatedDialogueSegment | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  // The dialogue segment id is the relationship everything downstream joins
  // on: a record without it is unusable, not repairable.
  if (
    !isNonEmptyString(record.id) ||
    !isNonEmptyString(record.dialogueSegmentId) ||
    typeof record.sourceText !== "string" ||
    typeof record.translatedText !== "string" ||
    !finiteNumber(record.startTime) ||
    !finiteNumber(record.endTime) ||
    !isNonEmptyString(record.sourceLanguage) ||
    !isNonEmptyString(record.targetLanguage) ||
    (record.speakerId !== null && !isNonEmptyString(record.speakerId))
  ) {
    return null;
  }

  return {
    id: record.id,
    dialogueSegmentId: record.dialogueSegmentId,
    speakerId: isNonEmptyString(record.speakerId) ? record.speakerId : null,
    startTime: record.startTime,
    endTime: record.endTime,
    sourceText: record.sourceText,
    translatedText: record.translatedText,
    sourceLanguage: record.sourceLanguage,
    targetLanguage: record.targetLanguage,
    confidence: parseConfidence(record.confidence),
    // Absent on a Part 9 record; the migration fills both in from what the
    // translation itself already records.
    translationMetadata: parseTranslationMetadata(
      record.translationMetadata,
    ) as DubbingTranslationMetadata,
    editMetadata: parseEditMetadata(
      record.editMetadata,
    ) as TranslationEditMetadata,
    ...optionalMetadata(record.providerMetadata),
  };
}

/**
 * Validates a stored translation before it re-enters the application.
 *
 * Development storage is a directory of JSON files that a person can edit and a
 * platform can truncate, so nothing is trusted on read. A record that cannot be
 * read is skipped rather than repaired — a translation is reproducible from the
 * dialogue that made it.
 */
export function parseStoredTranslation(
  value: unknown,
): DialogueTranslation | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    !isNonEmptyString(record.id) ||
    !isNonEmptyString(record.projectId) ||
    !isNonEmptyString(record.sourceMediaId) ||
    !isNonEmptyString(record.dialogueId) ||
    !Number.isInteger(record.dialogueRevision) ||
    !isNonEmptyString(record.sourceLanguage) ||
    !isNonEmptyString(record.targetLanguage) ||
    !isNonEmptyString(record.providerId) ||
    !finiteNumber(record.version) ||
    !isTranslationStatus(record.status) ||
    !Array.isArray(record.segments)
  ) {
    return null;
  }

  const segments: TranslatedDialogueSegment[] = [];

  for (const entry of record.segments) {
    const segment = parseSegment(entry);

    // One unreadable line makes the whole translation untrustworthy: a partial
    // translation presented as complete is exactly the failure Part 9 refuses
    // to persist in the first place.
    if (!segment) {
      return null;
    }

    segments.push(segment);
  }

  // Migrated on read, so a Part 9 record loads with Part 10 metadata filled in
  // from what it already knows rather than being discarded.
  return migrateTranslation({
    id: record.id,
    projectId: record.projectId,
    sourceMediaId: record.sourceMediaId,
    dialogueId: record.dialogueId,
    dialogueRevision: record.dialogueRevision as number,
    sourceLanguage: record.sourceLanguage,
    targetLanguage: record.targetLanguage,
    providerId: record.providerId,
    providerModel: isNonEmptyString(record.providerModel)
      ? record.providerModel
      : null,
    version: record.version,
    status: record.status,
    segments,
    createdAt: isNonEmptyString(record.createdAt) ? record.createdAt : "",
    updatedAt: isNonEmptyString(record.updatedAt) ? record.updatedAt : "",
    revision: Number.isInteger(record.revision) ? (record.revision as number) : 0,
    ...optionalMetadata(record.providerMetadata),
    usage: parseUsage(record.usage),
  });
}

/** True when a stored record is the translation for this exact identity. */
export function matchesIdentity(
  translation: DialogueTranslation,
  identity: TranslationIdentity,
): boolean {
  return (
    translation.projectId === identity.projectId &&
    translation.sourceMediaId === identity.sourceMediaId &&
    translation.dialogueId === identity.dialogueId &&
    translation.dialogueRevision === identity.dialogueRevision &&
    translation.sourceLanguage === identity.sourceLanguage &&
    translation.targetLanguage === identity.targetLanguage
  );
}

/**
 * Newest first, with the id as a tie-breaker so two records written in the same
 * millisecond still resolve deterministically.
 */
export function newestFirst(
  translations: readonly DialogueTranslation[],
): DialogueTranslation[] {
  return [...translations].sort(
    (a, b) =>
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
}
