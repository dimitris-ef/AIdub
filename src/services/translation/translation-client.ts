import type {
  DialogueTranslation,
  DubbingTranslationMetadata,
  TranslatedDialogueSegment,
  TranslationEditMetadata,
} from "@/types/translation";
import { isTranslationStatus } from "@/types/translation";
import { isTranslationDurationWarning } from "@/lib/translation/duration-warning";
import { DURATION_ESTIMATOR_VERSION } from "@/lib/translation/duration-estimator";

/**
 * The frontend's view of dialogue translation.
 *
 * Components ask "is there a translation for this dialogue and language pair?"
 * and get an answer. They never learn which provider produced it, whether it
 * ran locally or against a hosted API, how it was batched, or what it cost.
 *
 * Starting a translation is deliberately *not* here: that goes through the
 * shared `ProcessingClient`, because a translation is a processing job like any
 * other and Part 9 adds no second job system. This client only reads back the
 * record that job persisted.
 */

export const TRANSLATION_STATES = [
  "ready",
  "stale",
  "not_translated",
  "dialogue_required",
  "same_language",
] as const;

export type TranslationState = (typeof TRANSLATION_STATES)[number];

export interface TranslationDialogueSummary {
  id: string;
  revision: number;
  segmentCount: number;
}

export interface TranslationResponse {
  state: TranslationState;
  translation: DialogueTranslation | null;
  dialogue: TranslationDialogueSummary | null;
  /** Why a stored translation is no longer current, when it isn't. */
  staleReason?: string;
}

export class TranslationRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TranslationRequestError";
  }
}

export interface EditTranslatedSegmentRequest {
  segmentId: string;
  translatedText: string;
  /**
   * The translation revision the edit was composed against. The server refuses
   * the write if the translation has moved on, so a slow save can never
   * overwrite a newer change it never saw.
   */
  expectedRevision?: number | null;
}

export interface TranslationClient {
  getTranslation(
    projectId: string,
    sourceMediaId: string,
    languages: { sourceLanguage: string; targetLanguage: string },
    signal?: AbortSignal,
  ): Promise<TranslationResponse>;
  /**
   * Rewrites one line's translated text.
   *
   * Only the target text: the original stays in the dialogue and is corrected
   * in the Transcript workspace, never here.
   */
  editSegment(
    projectId: string,
    sourceMediaId: string,
    languages: { sourceLanguage: string; targetLanguage: string },
    edit: EditTranslatedSegmentRequest,
    signal?: AbortSignal,
  ): Promise<DialogueTranslation>;
}

function invalid(): never {
  throw new TranslationRequestError(
    "INVALID_RESPONSE",
    "The stored translation could not be read.",
  );
}

function isTranslationState(value: unknown): value is TranslationState {
  return (
    typeof value === "string" &&
    (TRANSLATION_STATES as readonly string[]).includes(value)
  );
}

/**
 * Dubbing metadata as it comes off the wire.
 *
 * The server migrates Part 9 records before serving them, so this should
 * always be present; the defaults exist so a UI still renders rather than
 * throwing if it ever isn't, and they say "unknown" rather than "fine".
 */
function parseTranslationMetadata(value: unknown): DubbingTranslationMetadata {
  const record = (typeof value === "object" && value !== null
    ? value
    : {}) as Partial<DubbingTranslationMetadata>;

  return {
    providerId: typeof record.providerId === "string" ? record.providerId : "",
    providerModel:
      typeof record.providerModel === "string" ? record.providerModel : null,
    generationMode:
      record.generationMode === "regenerate" || record.generationMode === "shorter"
        ? record.generationMode
        : "initial",
    generatedAt: typeof record.generatedAt === "string" ? record.generatedAt : "",
    contextSegmentIds: Array.isArray(record.contextSegmentIds)
      ? record.contextSegmentIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    estimatedDurationSeconds:
      typeof record.estimatedDurationSeconds === "number"
        ? record.estimatedDurationSeconds
        : null,
    sourceDurationSeconds:
      typeof record.sourceDurationSeconds === "number"
        ? record.sourceDurationSeconds
        : 0,
    durationRatio:
      typeof record.durationRatio === "number" ? record.durationRatio : null,
    durationWarning: isTranslationDurationWarning(record.durationWarning)
      ? record.durationWarning
      : "none",
    durationEstimatorVersion:
      typeof record.durationEstimatorVersion === "string"
        ? record.durationEstimatorVersion
        : DURATION_ESTIMATOR_VERSION,
    confidence: typeof record.confidence === "number" ? record.confidence : null,
    ...(record.providerMetadata
      ? { providerMetadata: record.providerMetadata }
      : {}),
  };
}

function parseEditMetadata(value: unknown): TranslationEditMetadata {
  const record = (typeof value === "object" && value !== null
    ? value
    : {}) as Partial<TranslationEditMetadata>;

  return {
    manuallyEdited: record.manuallyEdited === true,
    revision: Number.isInteger(record.revision) ? (record.revision as number) : 0,
    editedAt: typeof record.editedAt === "string" ? record.editedAt : null,
  };
}

function parseSegment(value: unknown): TranslatedDialogueSegment {
  const segment = value as Partial<TranslatedDialogueSegment> | null;

  if (
    !segment ||
    typeof segment.id !== "string" ||
    typeof segment.dialogueSegmentId !== "string" ||
    typeof segment.sourceText !== "string" ||
    typeof segment.translatedText !== "string" ||
    typeof segment.startTime !== "number" ||
    typeof segment.endTime !== "number" ||
    !Number.isFinite(segment.startTime) ||
    !Number.isFinite(segment.endTime) ||
    (segment.speakerId !== null && typeof segment.speakerId !== "string")
  ) {
    invalid();
  }

  return {
    id: segment.id,
    dialogueSegmentId: segment.dialogueSegmentId,
    speakerId: segment.speakerId ?? null,
    startTime: segment.startTime,
    endTime: segment.endTime,
    sourceText: segment.sourceText,
    translatedText: segment.translatedText,
    sourceLanguage: segment.sourceLanguage ?? "",
    targetLanguage: segment.targetLanguage ?? "",
    confidence:
      typeof segment.confidence === "number" ? segment.confidence : null,
    translationMetadata: parseTranslationMetadata(segment.translationMetadata),
    editMetadata: parseEditMetadata(segment.editMetadata),
    ...(segment.providerMetadata
      ? { providerMetadata: segment.providerMetadata }
      : {}),
  };
}

/** Validates a translation coming off the wire before the UI renders it. */
export function parseTranslation(value: unknown): DialogueTranslation {
  const translation = value as Partial<DialogueTranslation> | null;

  if (
    !translation ||
    typeof translation.id !== "string" ||
    typeof translation.projectId !== "string" ||
    typeof translation.sourceMediaId !== "string" ||
    typeof translation.dialogueId !== "string" ||
    typeof translation.dialogueRevision !== "number" ||
    typeof translation.sourceLanguage !== "string" ||
    typeof translation.targetLanguage !== "string" ||
    typeof translation.providerId !== "string" ||
    typeof translation.version !== "number" ||
    !isTranslationStatus(translation.status) ||
    !Array.isArray(translation.segments)
  ) {
    invalid();
  }

  return {
    id: translation.id,
    projectId: translation.projectId,
    sourceMediaId: translation.sourceMediaId,
    dialogueId: translation.dialogueId,
    dialogueRevision: translation.dialogueRevision,
    sourceLanguage: translation.sourceLanguage,
    targetLanguage: translation.targetLanguage,
    providerId: translation.providerId,
    providerModel: translation.providerModel ?? null,
    version: translation.version,
    status: translation.status,
    segments: translation.segments.map(parseSegment),
    createdAt: translation.createdAt ?? "",
    updatedAt: translation.updatedAt ?? "",
    revision:
      typeof translation.revision === "number" &&
      Number.isInteger(translation.revision)
        ? translation.revision
        : 0,
    ...(translation.providerMetadata
      ? { providerMetadata: translation.providerMetadata }
      : {}),
    usage: translation.usage ?? null,
  };
}

export class HttpTranslationClient implements TranslationClient {
  constructor(private readonly baseUrl = "/api/translations") {}

  async getTranslation(
    projectId: string,
    sourceMediaId: string,
    languages: { sourceLanguage: string; targetLanguage: string },
    signal?: AbortSignal,
  ): Promise<TranslationResponse> {
    const query = new URLSearchParams({
      projectId,
      mediaId: sourceMediaId,
      sourceLanguage: languages.sourceLanguage,
      targetLanguage: languages.targetLanguage,
    });

    const response = await fetch(`${this.baseUrl}?${query.toString()}`, {
      signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new TranslationRequestError(
        "REQUEST_FAILED",
        "The translation could not be loaded.",
      );
    }

    const body = (await response.json()) as {
      state?: unknown;
      translation?: unknown;
      dialogue?: unknown;
      staleReason?: unknown;
    };

    if (!isTranslationState(body.state)) {
      invalid();
    }

    return {
      state: body.state,
      translation: body.translation ? parseTranslation(body.translation) : null,
      dialogue: (body.dialogue as TranslationDialogueSummary | null) ?? null,
      ...(typeof body.staleReason === "string"
        ? { staleReason: body.staleReason }
        : {}),
    };
  }

  async editSegment(
    projectId: string,
    sourceMediaId: string,
    languages: { sourceLanguage: string; targetLanguage: string },
    edit: EditTranslatedSegmentRequest,
    signal?: AbortSignal,
  ): Promise<DialogueTranslation> {
    const query = new URLSearchParams({
      projectId,
      mediaId: sourceMediaId,
      sourceLanguage: languages.sourceLanguage,
      targetLanguage: languages.targetLanguage,
    });

    const response = await fetch(`${this.baseUrl}?${query.toString()}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(edit),
      signal,
      cache: "no-store",
    });

    const body = (await response.json().catch(() => null)) as {
      translation?: unknown;
      error?: { code?: string; message?: string };
    } | null;

    if (!response.ok || !body?.translation) {
      // The server says why in plain language; nothing here invents a success
      // the store did not actually record.
      throw new TranslationRequestError(
        body?.error?.code ?? "REQUEST_FAILED",
        body?.error?.message ?? "The change could not be saved.",
      );
    }

    return parseTranslation(body.translation);
  }
}

export const translationClient: TranslationClient = new HttpTranslationClient();
