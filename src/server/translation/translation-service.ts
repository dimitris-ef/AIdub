import { randomUUID } from "node:crypto";

import type { UnifiedDialogue } from "@/types/dialogue";
import { speakerDisplayName } from "@/types/dialogue";
import type {
  TranslateJobParameters,
  TranslateJobResult,
} from "@/types/processing-job";
import {
  DEFAULT_DUBBING_OPTIONS,
  type DialogueTranslation,
  type TranslatedDialogueSegment,
  type TranslationGenerationMode,
  type TranslationIdentity,
  type TranslationRequest,
  type TranslationRequestSegment,
  type TranslationUsage,
} from "@/types/translation";
import { translationRepository } from "@/data/translations";
import type { TranslationRepository } from "@/data/translations";
import {
  TRANSLATION_SCHEMA_VERSION,
  batchSegments,
  resolveTranslationConfig,
  type TranslationConfig,
} from "@/lib/translation/translation-config";
import { buildTranslatedSegments, mergeUsage } from "@/lib/translation/normalize-translation";
import {
  isTranslatableText,
  matchProviderResults,
  normalizeConfidence,
  toRequestSegments,
  validateTranslationRequest,
  type ProviderSegmentAnswer,
} from "@/lib/translation/validate-translation";
import { translationCurrency } from "@/lib/translation/translation-staleness";
import {
  buildBatchContext,
  buildSegmentContext,
  contextSegmentIds,
  resolveTranslationContextConfig,
  validateContext,
  type TranslationContextConfig,
} from "@/lib/translation/translation-context-builder";
import { assessTranslationDuration } from "@/lib/translation/duration-warning";
import { segmentDurationSeconds } from "@/lib/translation/duration-estimator";
import { ProcessingError } from "@/server/processing/processing-errors";
import type {
  StageRunContext,
  StageRunner,
} from "@/server/processing/processing-service";
import { dialogueService } from "@/server/dialogue/dialogue-service";
import type { DialogueService } from "@/server/dialogue/dialogue-service";
import {
  TranslationError,
  translationError,
} from "@/server/translation/translation-errors";
import { translationProviderRegistry } from "@/server/translation/translation-provider-registry";
import type { TranslationProviderRegistry } from "@/server/translation/translation-provider-registry";
import type { TranslationProvider } from "@/server/translation/translation-provider";

/**
 * Orchestrates one translation: resolve the current editable dialogue, check it
 * is the one the job was created for, pick the provider, translate in batches,
 * validate the contract, persist, and only then let the job complete.
 *
 * What it deliberately does **not** do:
 *
 * - It never reads the raw Part 5 transcript. Translation input is the current
 *   `UnifiedDialogue`, so every Part 8 correction — rewritten text, reassigned
 *   speaker, retimed or split line — is what reaches the provider.
 * - It never writes to the dialogue. `originalText`, speakers, timings and
 *   segment ids are read and copied; the translation is a separate record.
 * - It knows nothing about any vendor. Prompts, credentials, payload shapes and
 *   retries live inside a `TranslationProvider`.
 *
 * Moving translation onto an external worker means calling this same service
 * there: it takes a job context and a repository, not an HTTP request.
 *
 * Progress is mapped to one documented scale:
 *   1–5     preparing the dialogue
 *   5–90    translating, advancing by completed batch
 *   95      saving
 *   100     completed
 */

const PROGRESS_PREPARED = 5;
const PROGRESS_TRANSLATION_SPAN = 85;
const PROGRESS_SAVING = 95;

/**
 * Why the workspace is showing what it is showing.
 *
 * `stale` is deliberately distinct from `not_translated`: a translation that
 * exists but no longer matches the dialogue must be presented as out of date,
 * never hidden (which loses work) and never shown as current (which is a lie
 * about text the user may act on).
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

export interface TranslationResolution {
  state: TranslationState;
  translation: DialogueTranslation | null;
  dialogue: TranslationDialogueSummary | null;
  staleReason?: string;
  /** Short technical detail; never a stack trace or a backend path. */
  details?: string;
}

export interface TranslationServiceOptions {
  registry?: TranslationProviderRegistry;
  translations?: TranslationRepository;
  dialogues?: DialogueService;
  config?: Partial<TranslationConfig>;
  contextConfig?: Partial<TranslationContextConfig>;
  createId?: () => string;
  now?: () => Date;
  logger?: (message: string, detail?: Record<string, unknown>) => void;
}

function defaultLogger(
  message: string,
  detail: Record<string, unknown> = {},
): void {
  // Identifiers, counts and totals only — never dialogue text, translated text
  // or credentials.
  console.info(`[aidub:translation] ${message}`, detail);
}

/** Translation failures reach the job layer as structured processing errors. */
function toProcessingError(cause: unknown): ProcessingError {
  if (cause instanceof TranslationError) {
    if (cause.code === "TRANSLATION_CANCELLED") {
      return new ProcessingError("CANCELLED", "The job was cancelled.");
    }

    return new ProcessingError(cause.code, cause.message, {
      details: cause.details,
      cause,
    });
  }

  if (cause instanceof ProcessingError) {
    return cause;
  }

  if (cause instanceof Error && cause.name === "AbortError") {
    return new ProcessingError("CANCELLED", "The job was cancelled.");
  }

  return new ProcessingError(
    "INTERNAL_ERROR",
    "Translation failed unexpectedly. Please try again.",
    { cause },
  );
}

export class TranslationService implements StageRunner {
  private readonly registry: TranslationProviderRegistry;
  private readonly translations: TranslationRepository;
  private readonly dialogues: DialogueService;
  private readonly config: TranslationConfig;
  private readonly contextConfig: TranslationContextConfig;
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly logger: (
    message: string,
    detail?: Record<string, unknown>,
  ) => void;

  constructor(options: TranslationServiceOptions = {}) {
    this.registry = options.registry ?? translationProviderRegistry;
    this.translations = options.translations ?? translationRepository;
    this.dialogues = options.dialogues ?? dialogueService;
    this.config = resolveTranslationConfig(options.config);
    this.contextConfig = resolveTranslationContextConfig(options.contextConfig);
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? defaultLogger;
  }

  /**
   * Everything the Translate workspace needs to decide what to show, resolved
   * server-side so the browser never has to reason about identity itself.
   *
   * The language pair comes from the caller because the project record lives in
   * browser storage in development — but it is always explicit, never inferred
   * and never left to a provider.
   */
  async resolveCurrent(
    projectId: string,
    sourceMediaId: string,
    languages: { sourceLanguage: string; targetLanguage: string },
  ): Promise<TranslationResolution> {
    if (languages.sourceLanguage === languages.targetLanguage) {
      return { state: "same_language", translation: null, dialogue: null };
    }

    const resolution = await this.dialogues.getCurrentDialogue(
      projectId,
      sourceMediaId,
    );

    if (resolution.state !== "ready" || !resolution.dialogue) {
      return {
        state: "dialogue_required",
        translation: null,
        dialogue: null,
        details: resolution.state,
      };
    }

    const dialogue = resolution.dialogue;
    const found = await this.getCurrentTranslation(dialogue, languages);
    const summary = {
      id: dialogue.id,
      revision: dialogue.editMetadata.revision,
      segmentCount: dialogue.segments.length,
    };

    if (!found.translation) {
      return { state: "not_translated", translation: null, dialogue: summary };
    }

    return {
      state: found.current ? "ready" : "stale",
      translation: found.translation,
      dialogue: summary,
      ...(found.staleReason ? { staleReason: found.staleReason } : {}),
    };
  }

  /**
   * The current translation into one target language, whatever it came from.
   *
   * Speech generation knows what language it is dubbing into but has no
   * business knowing which source language a translation was made from — that
   * is recorded on the translation itself. Resolving by target alone keeps
   * translation staleness reasoning here, in the layer that owns it, rather
   * than being re-derived by every consumer.
   */
  async resolveForTarget(
    projectId: string,
    sourceMediaId: string,
    targetLanguage: string,
  ): Promise<TranslationResolution> {
    const resolution = await this.dialogues.getCurrentDialogue(
      projectId,
      sourceMediaId,
    );

    if (resolution.state !== "ready" || !resolution.dialogue) {
      return {
        state: "dialogue_required",
        translation: null,
        dialogue: null,
        details: resolution.state,
      };
    }

    const dialogue = resolution.dialogue;
    const summary = {
      id: dialogue.id,
      revision: dialogue.editMetadata.revision,
      segmentCount: dialogue.segments.length,
    };
    const candidates = (
      await this.translations
        .listByDialogue(projectId, dialogue.id)
        .catch(() => [])
    ).filter((translation) => translation.targetLanguage === targetLanguage);

    if (candidates.length === 0) {
      return { state: "not_translated", translation: null, dialogue: summary };
    }

    // `listByDialogue` is newest first, so the first exact-revision match is
    // the current one; falling back to the newest lets the caller present a
    // stale translation *as* stale rather than as nothing at all.
    const exact = candidates.find(
      (translation) =>
        translation.dialogueRevision === dialogue.editMetadata.revision,
    );

    if (exact) {
      return { state: "ready", translation: exact, dialogue: summary };
    }

    const previous = candidates[0];
    const currency = translationCurrency(previous, dialogue, {
      sourceLanguage: previous.sourceLanguage,
      targetLanguage,
    });

    return {
      state: currency.current ? "ready" : "stale",
      translation: previous,
      dialogue: summary,
      ...(currency.current ? {} : { staleReason: currency.reason }),
    };
  }

  /**
   * The translation to show for this dialogue and language pair right now.
   *
   * Returns the stored record plus whether it is still current, so the caller
   * can present a stale translation *as* stale rather than either hiding it or
   * passing it off as up to date. Never runs a provider.
   */
  async getCurrentTranslation(
    dialogue: UnifiedDialogue,
    languages: { sourceLanguage: string; targetLanguage: string },
  ): Promise<{
    translation: DialogueTranslation | null;
    current: boolean;
    staleReason?: string;
  }> {
    const identity = this.identityFor(dialogue, languages);
    const exact = await this.translations
      .getByIdentity(identity)
      .catch(() => null);

    if (exact) {
      return { translation: exact, current: true };
    }

    // No exact match: look for one of this dialogue in the same language pair
    // made at an earlier revision, so the workspace can say "this exists but
    // the dialogue has moved on" instead of pretending nothing was translated.
    const previous = (
      await this.translations
        .listByDialogue(dialogue.projectId, dialogue.id)
        .catch(() => [])
    ).filter(
      (translation) =>
        translation.sourceLanguage === languages.sourceLanguage &&
        translation.targetLanguage === languages.targetLanguage,
    )[0];

    if (!previous) {
      return { translation: null, current: false };
    }

    const currency = translationCurrency(previous, dialogue, languages);

    return {
      translation: previous,
      current: currency.current,
      ...(currency.current ? {} : { staleReason: currency.reason }),
    };
  }

  /**
   * All three translation operations run through one job type.
   *
   * They share a lifecycle, a provider, a cancellation story and an error
   * model, and differ only in scope: `full` replaces the whole translation,
   * while the segment operations replace exactly one line and leave every other
   * one byte-identical.
   */
  async run(context: StageRunContext): Promise<TranslateJobResult> {
    try {
      const parameters = context.job.parameters;

      if (!parameters || parameters.kind !== "translate") {
        throw translationError("TRANSLATION_SOURCE_REQUIRED", {
          details: "translate job created without translation parameters",
        });
      }

      return parameters.operation === "full"
        ? await this.translate(context, parameters)
        : await this.translateSegment(context, parameters);
    } catch (cause) {
      throw toProcessingError(cause);
    }
  }

  private async translate(
    context: StageRunContext,
    parameters: TranslateJobParameters,
  ): Promise<TranslateJobResult> {
    const { job, signal, onProgress } = context;
    const { sourceLanguage, targetLanguage } = parameters;

    // Refused before a provider is touched: translating a language into itself
    // spends credits to produce the text we already have.
    if (sourceLanguage === targetLanguage) {
      throw translationError("TRANSLATION_SAME_LANGUAGE");
    }

    onProgress(1, "Preparing dialogue");

    const dialogue = await this.resolveDialogue(job.projectId, job.sourceMediaId);

    // The job named a dialogue revision when it was created. If the dialogue
    // has moved on since, translating it now would produce a result for text
    // nobody asked about.
    this.assertMatchesJob(dialogue, parameters);

    const provider = this.registry.get(job.providerId);

    if (!(await provider.isAvailable())) {
      throw translationError("TRANSLATION_PROVIDER_UNAVAILABLE", {
        details: `provider ${provider.id} is not configured on this server`,
      });
    }

    const allSegments = toRequestSegments(dialogue);
    const request: TranslationRequest = {
      projectId: job.projectId,
      sourceMediaId: job.sourceMediaId,
      dialogueId: dialogue.id,
      dialogueRevision: dialogue.editMetadata.revision,
      sourceLanguage,
      targetLanguage,
      segments: allSegments,
      operation: "full",
      options: DEFAULT_DUBBING_OPTIONS,
    };

    const validation = validateTranslationRequest(request);

    if (!validation.ok) {
      throw translationError("TRANSLATION_INVALID_RESPONSE", {
        details: validation.details,
        message: "This dialogue cannot be translated as it stands.",
      });
    }

    // Empty lines are preserved but never sent: there is nothing to translate,
    // and asking a model to translate emptiness invites it to invent dialogue.
    const translatable = allSegments.filter((segment) =>
      isTranslatableText(segment.sourceText),
    );

    onProgress(PROGRESS_PREPARED, "Translating");

    const started = Date.now();
    const run = await this.runBatches(
      provider,
      request,
      translatable,
      context,
      dialogue,
    );
    const { answers, usageParts, batchCount } = run;

    // A result that arrives after cancellation is discarded: nothing is saved
    // and the job stays cancelled.
    this.throwIfAborted(signal);

    const matched = matchProviderResults(translatable, answers);

    if (!matched.ok) {
      throw translationError(matched.code, { details: matched.details });
    }

    onProgress(PROGRESS_SAVING, "Saving translation");

    // Re-read immediately before persisting. Someone may have corrected the
    // dialogue while the provider was working, and a translation of superseded
    // text must never be stored as the current one.
    const currentDialogue = await this.resolveDialogue(
      job.projectId,
      job.sourceMediaId,
    );
    this.assertMatchesJob(currentDialogue, parameters);

    if (currentDialogue.id !== dialogue.id) {
      throw translationError("TRANSLATION_SOURCE_CHANGED", {
        details: "the dialogue was replaced while translation was running",
      });
    }

    const timestamp = this.now().toISOString();
    const usage = mergeUsage(usageParts);
    const providerModel = run.providerModel;

    const translation: DialogueTranslation = {
      id: this.createId(),
      projectId: dialogue.projectId,
      sourceMediaId: dialogue.sourceMediaId,
      dialogueId: dialogue.id,
      dialogueRevision: dialogue.editMetadata.revision,
      sourceLanguage,
      targetLanguage,
      providerId: provider.id,
      providerModel,
      version: TRANSLATION_SCHEMA_VERSION,
      status: "completed",
      segments: buildTranslatedSegments(dialogue, matched.bySegmentId, {
        sourceLanguage,
        targetLanguage,
        createId: this.createId,
        providerId: provider.id,
        providerModel,
        generatedAt: timestamp,
        generationMode: "initial",
        contextSegmentIdsFor: (segmentId) =>
          run.contextBySegmentId.get(segmentId) ?? [],
      }),
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 0,
      ...(run.providerMetadata
        ? { providerMetadata: run.providerMetadata }
        : {}),
      usage,
    };

    const previous = await this.translations
      .getByIdentity(this.identityFor(dialogue, { sourceLanguage, targetLanguage }))
      .catch(() => null);

    try {
      await this.translations.save(translation);
    } catch (cause) {
      throw translationError("TRANSLATION_SAVE_FAILED", { cause });
    }

    // Retranslating replaces the previous result for the same identity only
    // once the new one is safely stored: a failed rerun leaves the working
    // translation in place.
    if (previous && previous.id !== translation.id) {
      await this.translations.delete(previous.id).catch(() => {
        // An orphaned old record is harmless; the new one is current.
      });
    }

    this.logger("translation completed", {
      jobId: job.id,
      projectId: job.projectId,
      dialogueId: dialogue.id,
      dialogueRevision: translation.dialogueRevision,
      providerId: provider.id,
      model: providerModel,
      sourceLanguage,
      targetLanguage,
      segmentCount: translation.segments.length,
      translatedCount: translatable.length,
      batchCount,
      usage: usage ?? null,
      durationMs: Date.now() - started,
    });

    return {
      kind: "translate",
      translationId: translation.id,
      dialogueId: translation.dialogueId,
      dialogueRevision: translation.dialogueRevision,
      segmentCount: translation.segments.length,
      sourceLanguage,
      targetLanguage,
      providerId: translation.providerId,
      providerModel,
    };
  }

  /**
   * Regenerates or shortens exactly one line.
   *
   * The whole point is that it is surgical: every other line comes through
   * byte-identical, and the line being worked on keeps its current translation
   * until a new one has been validated and stored. If anything fails — the
   * provider, the contract check, the dialogue moving underneath, a concurrent
   * edit — the existing text is what remains.
   *
   * The two operations differ only in what the provider is asked for, so they
   * share this path rather than duplicating the guards that make it safe.
   */
  private async translateSegment(
    context: StageRunContext,
    parameters: TranslateJobParameters,
  ): Promise<TranslateJobResult> {
    const { job, signal, onProgress } = context;
    const { sourceLanguage, targetLanguage, segmentId } = parameters;
    const shortening = parameters.operation === "shorten_segment";
    const failureCode = shortening
      ? ("TRANSLATION_SHORTEN_FAILED" as const)
      : ("TRANSLATION_REGENERATION_FAILED" as const);

    if (!segmentId) {
      throw translationError(failureCode, {
        details: "no segment was named",
      });
    }

    if (sourceLanguage === targetLanguage) {
      throw translationError("TRANSLATION_SAME_LANGUAGE");
    }

    onProgress(5, shortening ? "Shortening line" : "Regenerating translation");

    const dialogue = await this.resolveDialogue(job.projectId, job.sourceMediaId);
    // A single line may only be worked on against the dialogue it was requested
    // for. Regenerating against a dialogue that has since changed would produce
    // a line translated from text nobody is looking at.
    this.assertMatchesJob(dialogue, parameters);

    const dialogueSegment = dialogue.segments.find(
      (segment) => segment.id === segmentId,
    );

    if (!dialogueSegment) {
      throw translationError("TRANSLATION_SEGMENT_NOT_FOUND", {
        details: `segment ${segmentId} is not in this dialogue`,
      });
    }

    const identity = this.identityFor(dialogue, {
      sourceLanguage,
      targetLanguage,
    });
    const translation = await this.translations
      .getByIdentity(identity)
      .catch(() => null);

    if (!translation) {
      throw translationError("TRANSLATION_NOT_FOUND", {
        details: "there is no current translation for this dialogue",
      });
    }

    this.assertExpectedRevision(translation, parameters);

    const existing = translation.segments.find(
      (segment) => segment.dialogueSegmentId === segmentId,
    );

    if (!existing) {
      throw translationError("TRANSLATION_SEGMENT_NOT_FOUND", {
        details: `segment ${segmentId} is not in this translation`,
      });
    }

    // Nothing to say, nothing to shorten, nothing to regenerate.
    if (!isTranslatableText(dialogueSegment.originalText)) {
      throw translationError(failureCode, {
        details: "this line has no source text",
      });
    }

    const provider = this.registry.get(job.providerId);

    if (!(await provider.isAvailable())) {
      throw translationError("TRANSLATION_PROVIDER_UNAVAILABLE", {
        details: `provider ${provider.id} is not configured on this server`,
      });
    }

    // Neighbouring lines, including what they currently read as in the target
    // language — that is what keeps a regenerated line consistent with the
    // conversation it sits in.
    const segmentContext = provider.capabilities.supportsContext
      ? buildSegmentContext(dialogue, segmentId, {
          config: this.contextConfig,
          translation,
        })
      : null;

    if (provider.capabilities.supportsContext && !segmentContext) {
      throw translationError("TRANSLATION_CONTEXT_BUILD_FAILED", {
        details: `context could not be built for segment ${segmentId}`,
      });
    }

    const contextCheck = validateContext(dialogue, segmentContext);

    if (!contextCheck.ok) {
      throw translationError("TRANSLATION_CONTEXT_BUILD_FAILED", {
        details: contextCheck.details,
      });
    }

    const sourceDuration = segmentDurationSeconds(dialogueSegment);
    const requestSegment: TranslationRequestSegment = {
      segmentId,
      speakerId: dialogueSegment.speakerId,
      speakerName: speakerDisplayName(
        dialogue.speakers,
        dialogueSegment.speakerId,
      ),
      startTime: dialogueSegment.startTime,
      endTime: dialogueSegment.endTime,
      durationSeconds: sourceDuration,
      sourceText: dialogueSegment.originalText,
      currentTranslation: existing.translatedText,
      ...(segmentContext ? { context: segmentContext } : {}),
    };

    const request: TranslationRequest = {
      projectId: job.projectId,
      sourceMediaId: job.sourceMediaId,
      dialogueId: dialogue.id,
      dialogueRevision: dialogue.editMetadata.revision,
      sourceLanguage,
      targetLanguage,
      segments: [requestSegment],
      operation: shortening ? "shorter" : "regenerate",
      options: DEFAULT_DUBBING_OPTIONS,
    };

    onProgress(40, shortening ? "Shortening line" : "Regenerating translation");

    const started = Date.now();
    const result = await this.callProvider(provider, request, context, {
      done: 0,
      total: 1,
    });

    // A result that arrives after cancellation is discarded: the line keeps the
    // translation it already had.
    this.throwIfAborted(signal);

    // The provider was given context lines; answering for one of them would
    // silently overwrite a neighbour. Matching against the single requested
    // segment rejects that outright.
    const matched = matchProviderResults([requestSegment], result.segments);

    if (!matched.ok) {
      throw translationError(matched.code, { details: matched.details });
    }

    const answer = matched.bySegmentId.get(segmentId);

    if (!answer) {
      throw translationError(failureCode, {
        details: "the provider returned nothing for this line",
      });
    }

    onProgress(PROGRESS_SAVING, "Saving translation");

    // Everything is re-checked immediately before the write: the dialogue may
    // have been corrected, and the translation may have been edited elsewhere,
    // while the provider was working.
    const currentDialogue = await this.resolveDialogue(
      job.projectId,
      job.sourceMediaId,
    );
    this.assertMatchesJob(currentDialogue, parameters);

    const currentTranslation = await this.translations
      .getByIdentity(identity)
      .catch(() => null);

    if (!currentTranslation || currentTranslation.id !== translation.id) {
      throw translationError("TRANSLATION_REVISION_CONFLICT", {
        details: "the translation was replaced while this line was running",
      });
    }

    this.assertExpectedRevision(currentTranslation, parameters);

    const mode: TranslationGenerationMode = shortening
      ? "shorter"
      : "regenerate";
    const timestamp = this.now().toISOString();
    const updated = this.replaceSegment(currentTranslation, segmentId, (segment) =>
      this.withNewTranslation(segment, answer.translatedText, {
        targetLanguage,
        sourceDurationSeconds: sourceDuration,
        providerId: provider.id,
        providerModel: result.provider.model,
        generationMode: mode,
        generatedAt: timestamp,
        contextSegmentIds: contextSegmentIds(segmentContext),
        confidence: normalizeConfidence(answer.confidence),
        providerMetadata: answer.metadata,
      }),
    );

    const saved: DialogueTranslation = {
      ...updated,
      updatedAt: timestamp,
      revision: currentTranslation.revision + 1,
      usage: mergeUsage([currentTranslation.usage, result.usage]),
    };

    try {
      await this.translations.save(saved);
    } catch (cause) {
      // Nothing was written, so the line keeps the text it had.
      throw translationError("TRANSLATION_SAVE_FAILED", { cause });
    }

    const after = saved.segments.find(
      (segment) => segment.dialogueSegmentId === segmentId,
    );

    this.logger(`translation segment ${mode}`, {
      jobId: job.id,
      projectId: job.projectId,
      dialogueId: dialogue.id,
      dialogueRevision: saved.dialogueRevision,
      translationRevision: saved.revision,
      providerId: provider.id,
      model: result.provider.model,
      contextSegments: contextSegmentIds(segmentContext).length,
      durationWarning: after?.translationMetadata.durationWarning,
      durationMs: Date.now() - started,
    });

    return {
      kind: "translate",
      translationId: saved.id,
      dialogueId: saved.dialogueId,
      dialogueRevision: saved.dialogueRevision,
      segmentCount: saved.segments.length,
      sourceLanguage,
      targetLanguage,
      providerId: provider.id,
      providerModel: result.provider.model,
    };
  }

  /**
   * A person's rewrite of one translated line.
   *
   * Applied server-side against the stored record, like Part 8's dialogue
   * edits, so validation and the revision check live in one place and a browser
   * can never write a document it derived from a stale copy. The duration
   * estimate is recomputed here, so a warning can never describe text the line
   * no longer has.
   *
   * Provenance is deliberately kept: the provider and model that produced the
   * original wording stay on the segment, and only the generation timestamp
   * story changes — the text is now the person's.
   */
  async editSegmentText(
    projectId: string,
    sourceMediaId: string,
    languages: { sourceLanguage: string; targetLanguage: string },
    segmentId: string,
    translatedText: string,
    expectedRevision?: number | null,
  ): Promise<
    | { ok: true; translation: DialogueTranslation }
    | { ok: false; code: string; message: string }
  > {
    try {
      const dialogue = await this.resolveDialogue(projectId, sourceMediaId);
      const identity = this.identityFor(dialogue, languages);
      const translation = await this.translations.getByIdentity(identity);

      if (!translation) {
        throw translationError("TRANSLATION_NOT_FOUND");
      }

      const existing = translation.segments.find(
        (segment) => segment.dialogueSegmentId === segmentId,
      );

      if (!existing) {
        throw translationError("TRANSLATION_SEGMENT_NOT_FOUND");
      }

      if (
        expectedRevision !== undefined &&
        expectedRevision !== null &&
        expectedRevision !== translation.revision
      ) {
        throw translationError("TRANSLATION_REVISION_CONFLICT", {
          details: `expected revision ${expectedRevision}, found ${translation.revision}`,
        });
      }

      // Nothing changed: return the document as it stands rather than inflating
      // the revision, which segment operations use for their conflict check.
      if (existing.translatedText === translatedText) {
        return { ok: true, translation };
      }

      const timestamp = this.now().toISOString();
      const sourceDuration = Math.max(0, existing.endTime - existing.startTime);
      const updated = this.replaceSegment(translation, segmentId, (segment) => {
        const assessment = assessTranslationDuration(
          translatedText,
          translation.targetLanguage,
          sourceDuration,
        );

        return {
          ...segment,
          translatedText,
          translationMetadata: {
            ...segment.translationMetadata,
            // Recomputed on every change to the text, never left stale.
            estimatedDurationSeconds: assessment.estimatedSeconds,
            sourceDurationSeconds: assessment.sourceDurationSeconds,
            durationRatio: assessment.ratio,
            durationWarning: assessment.warning,
            durationEstimatorVersion: assessment.estimatorVersion,
          },
          editMetadata: {
            manuallyEdited: true,
            revision: segment.editMetadata.revision + 1,
            editedAt: timestamp,
          },
        };
      });

      const saved: DialogueTranslation = {
        ...updated,
        updatedAt: timestamp,
        revision: translation.revision + 1,
      };

      await this.translations.save(saved).catch((cause: unknown) => {
        throw translationError("TRANSLATION_SAVE_FAILED", { cause });
      });

      return { ok: true, translation: saved };
    } catch (cause) {
      if (cause instanceof TranslationError) {
        return { ok: false, code: cause.code, message: cause.message };
      }

      return {
        ok: false,
        code: "TRANSLATION_SAVE_FAILED",
        message: "The change could not be saved.",
      };
    }
  }

  /** Replaces exactly one line, leaving every other one untouched. */
  private replaceSegment(
    translation: DialogueTranslation,
    segmentId: string,
    update: (segment: TranslatedDialogueSegment) => TranslatedDialogueSegment,
  ): DialogueTranslation {
    return {
      ...translation,
      segments: translation.segments.map((segment) =>
        segment.dialogueSegmentId === segmentId ? update(segment) : segment,
      ),
    };
  }

  /** A newly generated translation for one line, with fresh derived metadata. */
  private withNewTranslation(
    segment: TranslatedDialogueSegment,
    translatedText: string,
    details: {
      targetLanguage: string;
      sourceDurationSeconds: number;
      providerId: string;
      providerModel: string | null;
      generationMode: TranslationGenerationMode;
      generatedAt: string;
      contextSegmentIds: string[];
      confidence: number | null;
      providerMetadata?: Record<string, unknown>;
    },
  ): TranslatedDialogueSegment {
    const assessment = assessTranslationDuration(
      translatedText,
      details.targetLanguage,
      details.sourceDurationSeconds,
    );

    return {
      ...segment,
      translatedText,
      confidence: details.confidence,
      translationMetadata: {
        providerId: details.providerId,
        providerModel: details.providerModel,
        generationMode: details.generationMode,
        generatedAt: details.generatedAt,
        contextSegmentIds: details.contextSegmentIds,
        estimatedDurationSeconds: assessment.estimatedSeconds,
        sourceDurationSeconds: assessment.sourceDurationSeconds,
        durationRatio: assessment.ratio,
        durationWarning: assessment.warning,
        durationEstimatorVersion: assessment.estimatorVersion,
        confidence: details.confidence,
        ...(details.providerMetadata
          ? { providerMetadata: details.providerMetadata }
          : {}),
      },
      // Newly generated text is the machine's again: a person can edit it, but
      // this particular wording is not theirs.
      editMetadata: {
        manuallyEdited: false,
        revision: segment.editMetadata.revision + 1,
        editedAt: segment.editMetadata.editedAt,
      },
    };
  }

  private assertExpectedRevision(
    translation: DialogueTranslation,
    parameters: TranslateJobParameters,
  ): void {
    const expected = parameters.expectedTranslationRevision;

    if (
      expected !== undefined &&
      expected !== null &&
      expected !== translation.revision
    ) {
      throw translationError("TRANSLATION_REVISION_CONFLICT", {
        details: `job expected revision ${expected}, translation is at ${translation.revision}`,
      });
    }
  }

  /**
   * Drives the provider batch by batch.
   *
   * Batching is the service's job, not a provider's: it gives real progress
   * (completed lines over total lines rather than a fabricated percentage), it
   * keeps one payload limit from becoming a rule inside every adapter, and it
   * means a provider that cannot batch is simply driven one line at a time.
   *
   * Cancellation is checked between batches as well as inside them, so a
   * cancelled job stops before spending another provider call.
   *
   * Each batch carries **boundary context**: the lines just before the first
   * and just after the last. A batch is already internally consecutive, so only
   * its edges need filling in — which is what keeps a reply at the start of one
   * batch consistent with the question at the end of the previous one.
   */
  private async runBatches(
    provider: TranslationProvider,
    request: TranslationRequest,
    translatable: readonly TranslationRequestSegment[],
    context: StageRunContext,
    dialogue: UnifiedDialogue,
  ): Promise<{
    answers: ProviderSegmentAnswer[];
    usageParts: (TranslationUsage | null | undefined)[];
    batchCount: number;
    providerModel: string | null;
    providerMetadata: Record<string, unknown> | undefined;
    contextBySegmentId: Map<string, string[]>;
  }> {
    const batchSize = provider.capabilities.supportsBatchTranslation
      ? this.config.batchSize
      : 1;
    const batches = batchSegments(translatable, batchSize);
    const answers: ProviderSegmentAnswer[] = [];
    const usageParts: (TranslationUsage | null | undefined)[] = [];
    const contextBySegmentId = new Map<string, string[]>();
    // Per-run state stays local: this service is a singleton shared by every
    // concurrent job, so nothing about one translation may live on `this`.
    let providerModel: string | null = null;
    let providerMetadata: Record<string, unknown> | undefined;
    let done = 0;

    for (const batch of batches) {
      this.throwIfAborted(context.signal);

      const batchIds = batch.map((segment) => segment.segmentId);
      // A provider that ignores context still receives none rather than a
      // half-honoured request, and the recorded context matches what was sent.
      const batchContext = provider.capabilities.supportsContext
        ? buildBatchContext(dialogue, batchIds, {
            config: this.contextConfig,
          })
        : null;
      const usedContextIds = contextSegmentIds(batchContext);

      for (const id of batchIds) {
        contextBySegmentId.set(id, usedContextIds);
      }

      const result = await this.callProvider(
        provider,
        {
          ...request,
          segments: batch.map((segment, index) => ({
            ...segment,
            // The batch shares one boundary context; attaching it to the first
            // segment is the shape the adapter reads.
            ...(index === 0 && batchContext ? { context: batchContext } : {}),
          })),
        },
        context,
        { done, total: translatable.length },
      );

      answers.push(...result.segments);
      usageParts.push(result.usage);
      providerModel = result.provider.model;

      if (result.provider.metadata) {
        providerMetadata = result.provider.metadata;
      }

      done += batch.length;

      // Real progress: lines finished over lines to do.
      const fraction = translatable.length > 0 ? done / translatable.length : 1;
      context.onProgress(
        Math.round(PROGRESS_PREPARED + fraction * PROGRESS_TRANSLATION_SPAN),
        describeBatchStage(done, translatable.length),
      );
    }

    return {
      answers,
      usageParts,
      batchCount: batches.length,
      providerModel,
      providerMetadata,
      contextBySegmentId,
    };
  }

  /** Runs one provider call under the job's signal plus a per-request timeout. */
  private async callProvider(
    provider: TranslationProvider,
    request: TranslationRequest,
    context: StageRunContext,
    progress: { done: number; total: number },
  ) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    context.signal.addEventListener("abort", abort, { once: true });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.requestTimeoutMs);

    try {
      return await provider.translate(request, {
        signal: controller.signal,
        onProgress: ({ percent, stage }) => {
          // A provider's own percentage only describes the current batch, so
          // it is folded into the batch's share of the whole translation.
          const within =
            percent === undefined
              ? 0
              : (Math.min(Math.max(percent, 0), 100) / 100) *
                request.segments.length;
          const fraction =
            progress.total > 0
              ? (progress.done + within) / progress.total
              : 1;

          context.onProgress(
            Math.round(PROGRESS_PREPARED + fraction * PROGRESS_TRANSLATION_SPAN),
            stage ?? describeBatchStage(progress.done, progress.total),
          );
        },
      });

    } catch (cause) {
      if (timedOut) {
        throw translationError("TRANSLATION_TIMEOUT");
      }
      if (context.signal.aborted) {
        throw translationError("TRANSLATION_CANCELLED");
      }
      if (cause instanceof TranslationError) {
        throw cause;
      }

      throw translationError("TRANSLATION_REQUEST_FAILED", { cause });
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener("abort", abort);
    }
  }

  /**
   * The current editable dialogue for this source.
   *
   * Goes through `DialogueService` so translation sees exactly what the
   * Transcript workspace shows — including a manually corrected document that
   * is deliberately kept over newer raw results.
   */
  private async resolveDialogue(
    projectId: string,
    sourceMediaId: string,
  ): Promise<UnifiedDialogue> {
    const resolution = await this.dialogues.getCurrentDialogue(
      projectId,
      sourceMediaId,
    );

    if (resolution.state !== "ready" || !resolution.dialogue) {
      throw translationError("TRANSLATION_SOURCE_REQUIRED", {
        details: `dialogue state ${resolution.state}`,
      });
    }

    return resolution.dialogue;
  }

  private assertMatchesJob(
    dialogue: UnifiedDialogue,
    parameters: { dialogueId: string; dialogueRevision: number },
  ): void {
    if (
      dialogue.id !== parameters.dialogueId ||
      dialogue.editMetadata.revision !== parameters.dialogueRevision
    ) {
      throw translationError("TRANSLATION_SOURCE_CHANGED", {
        details: `job targeted revision ${parameters.dialogueRevision}, dialogue is at ${dialogue.editMetadata.revision}`,
      });
    }
  }

  private identityFor(
    dialogue: UnifiedDialogue,
    languages: { sourceLanguage: string; targetLanguage: string },
  ): TranslationIdentity {
    return {
      projectId: dialogue.projectId,
      sourceMediaId: dialogue.sourceMediaId,
      dialogueId: dialogue.id,
      dialogueRevision: dialogue.editMetadata.revision,
      sourceLanguage: languages.sourceLanguage,
      targetLanguage: languages.targetLanguage,
    };
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw translationError("TRANSLATION_CANCELLED");
    }
  }
}

/** "Translating 14 of 52 lines" — real counts, never a fabricated percentage. */
export function describeBatchStage(done: number, total: number): string {
  if (total === 0) {
    return "Translating";
  }

  return `Translating ${Math.min(done + 1, total)} of ${total} lines`;
}

export const translationService = new TranslationService();
