import { randomUUID } from "node:crypto";

import type { UnifiedDialogue } from "@/types/dialogue";
import type { TranslateJobResult } from "@/types/processing-job";
import type {
  DialogueTranslation,
  TranslationIdentity,
  TranslationRequest,
  TranslationRequestSegment,
  TranslationUsage,
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
  toRequestSegments,
  validateTranslationRequest,
  type ProviderSegmentAnswer,
} from "@/lib/translation/validate-translation";
import { translationCurrency } from "@/lib/translation/translation-staleness";
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

  async run(context: StageRunContext): Promise<TranslateJobResult> {
    try {
      return await this.translate(context);
    } catch (cause) {
      throw toProcessingError(cause);
    }
  }

  private async translate(
    context: StageRunContext,
  ): Promise<TranslateJobResult> {
    const { job, signal, onProgress } = context;
    const parameters = job.parameters;

    if (!parameters || parameters.kind !== "translate") {
      throw translationError("TRANSLATION_SOURCE_REQUIRED", {
        details: "translate job created without translation parameters",
      });
    }

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
    const run = await this.runBatches(provider, request, translatable, context);
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
      }),
      createdAt: timestamp,
      updatedAt: timestamp,
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
   * Drives the provider batch by batch.
   *
   * Batching is the service's job, not a provider's: it gives real progress
   * (completed lines over total lines rather than a fabricated percentage), it
   * keeps one payload limit from becoming a rule inside every adapter, and it
   * means a provider that cannot batch is simply driven one line at a time.
   *
   * Cancellation is checked between batches as well as inside them, so a
   * cancelled job stops before spending another provider call.
   */
  private async runBatches(
    provider: TranslationProvider,
    request: TranslationRequest,
    translatable: readonly TranslationRequestSegment[],
    context: StageRunContext,
  ): Promise<{
    answers: ProviderSegmentAnswer[];
    usageParts: (TranslationUsage | null | undefined)[];
    batchCount: number;
    providerModel: string | null;
    providerMetadata: Record<string, unknown> | undefined;
  }> {
    const batchSize = provider.capabilities.supportsBatchTranslation
      ? this.config.batchSize
      : 1;
    const batches = batchSegments(translatable, batchSize);
    const answers: ProviderSegmentAnswer[] = [];
    const usageParts: (TranslationUsage | null | undefined)[] = [];
    // Per-run state stays local: this service is a singleton shared by every
    // concurrent job, so nothing about one translation may live on `this`.
    let providerModel: string | null = null;
    let providerMetadata: Record<string, unknown> | undefined;
    let done = 0;

    for (const batch of batches) {
      this.throwIfAborted(context.signal);

      const result = await this.callProvider(
        provider,
        { ...request, segments: batch },
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
