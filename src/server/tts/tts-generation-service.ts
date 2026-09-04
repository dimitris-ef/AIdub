import { randomUUID } from "node:crypto";

import type { DialogueTranslation, TranslatedDialogueSegment } from "@/types/translation";
import type {
  GenerateSpeechJobParameters,
  GenerateSpeechJobResult,
} from "@/types/processing-job";
import {
  DEFAULT_TTS_SETTINGS,
  type GeneratedSpeechSegment,
  type SpeakerVoiceAssignment,
  type TtsGenerationSettings,
  type TtsGenerationWarning,
  type TtsProviderResult,
  type TtsVoice,
  type VoiceSource,
} from "@/types/tts";
import {
  generatedSpeechRepository,
  voiceAssignmentRepository,
  type GeneratedSpeechIdentity,
  type GeneratedSpeechRepository,
  type VoiceAssignmentIdentity,
  type VoiceAssignmentRepository,
} from "@/data/tts";
import {
  generatedSpeechId,
} from "@/data/tts/generated-speech-repository";
import { voiceAssignmentId } from "@/data/tts/voice-assignment-repository";
import { fingerprintFor } from "@/lib/tts/generation-fingerprint";
import {
  assessGeneratedDuration,
  wavDurationSeconds,
} from "@/lib/tts/generated-duration";
import {
  generatedSpeechCurrency,
  toStalenessSegment,
  type GeneratedSpeechStaleReason,
} from "@/lib/tts/tts-staleness";
import {
  hasSpeakableText,
  resolveTtsConfig,
  TTS_SCHEMA_VERSION,
  VOICE_ASSIGNMENT_SCHEMA_VERSION,
  type TtsConfig,
} from "@/lib/tts/tts-config";
import { ProcessingError } from "@/server/processing/processing-errors";
import type { StageRunContext, StageRunner } from "@/server/processing/processing-service";
import type { ProcessingArtifactStorage } from "@/server/artifacts/processing-artifact-storage";
import { TtsError, ttsError } from "@/server/tts/tts-errors";
import {
  voiceSupportsLanguage,
  type TtsProvider,
} from "@/server/tts/tts-provider";
import { ttsProviderRegistry } from "@/server/tts/tts-provider-registry";
import type { TtsProviderRegistry } from "@/server/tts/tts-provider-registry";
import { translationService } from "@/server/translation/translation-service";
import type { TranslationService } from "@/server/translation/translation-service";

/**
 * Orchestrates speech generation: resolve the current translation, check every
 * speaker has a voice, synthesise line by line, store the audio, and record
 * exactly what produced each result.
 *
 * What it deliberately does **not** do:
 *
 * - It never reads the raw transcript, the diarization, or even the dialogue's
 *   own text. It speaks the **current translation**, which is what a person
 *   reviewed and edited in Part 10.
 * - It never writes to the translation, the dialogue, or anything upstream.
 *   Generated audio is derived; the things it derives from stay untouched, so a
 *   run can always be repeated.
 * - It never picks a voice. A voice comes from a `SpeakerVoiceAssignment` a
 *   person made; a speaker without one stops the run rather than being cast by
 *   this code from any property of the speaker, inferred or otherwise.
 * - It never changes a timestamp, stretches audio, or compresses it to fit.
 *   Where speech overruns its dialogue window that is recorded as a warning for
 *   a person to act on — Part 11 measures the problem and stops there.
 * - It knows nothing about any vendor. Model names, credentials, audio formats
 *   and retries live inside a `TtsProvider`.
 *
 * Moving generation onto an external worker means calling this same service
 * there: it takes a job context and repositories, not an HTTP request.
 *
 * Progress is mapped to one documented scale:
 *   1–5     preparing the translation and assignments
 *   5–90    generating, advancing by completed line
 *   95      saving
 *   100     completed
 */

const PROGRESS_PREPARED = 5;
const PROGRESS_GENERATION_SPAN = 85;
const PROGRESS_SAVING = 95;

/** A short, neutral line used to audition a voice. Never project content. */
export const VOICE_PREVIEW_TEXT =
  "This is how this voice sounds in your dubbed video.";

/**
 * Why the Voices workspace is showing what it is showing.
 *
 * `voices_required` is deliberately distinct from `not_generated`: one is a
 * decision waiting on a person, the other is work waiting on a button, and
 * conflating them would leave someone pressing Generate at a screen that cannot
 * generate anything.
 */
export const SPEECH_STATES = [
  "ready",
  "partial",
  "not_generated",
  "voices_required",
  "translation_required",
  "translation_stale",
] as const;

export type SpeechState = (typeof SPEECH_STATES)[number];

/** One line as the Voices workspace sees it: the text, the audio, the truth. */
export interface SpeechSegmentView {
  dialogueSegmentId: string;
  speakerId: string | null;
  translatedText: string;
  startTime: number;
  endTime: number;
  segmentDurationSeconds: number;
  generated: GeneratedSpeechSegment | null;
  /** False whenever the audio no longer describes the current line. */
  current: boolean;
  staleReason?: GeneratedSpeechStaleReason;
}

export interface SpeechResolution {
  state: SpeechState;
  targetLanguage: string;
  translationId: string | null;
  translationRevision: number | null;
  dialogueId: string | null;
  segments: SpeechSegmentView[];
  assignments: SpeakerVoiceAssignment[];
  /** Speakers in the translation with no voice assigned yet. */
  unassignedSpeakerIds: string[];
  /** True when at least one line has no speaker at all (a Part 8 problem). */
  hasUnassignedSegments: boolean;
  currentCount: number;
  staleCount: number;
  details?: string;
}

export interface TtsGenerationServiceOptions {
  registry?: TtsProviderRegistry;
  assignments?: VoiceAssignmentRepository;
  generated?: GeneratedSpeechRepository;
  translations?: TranslationService;
  artifacts?: ProcessingArtifactStorage;
  config?: Partial<TtsConfig>;
  createId?: () => string;
  now?: () => Date;
  logger?: (message: string, detail?: Record<string, unknown>) => void;
}

function defaultLogger(
  message: string,
  detail: Record<string, unknown> = {},
): void {
  // Identifiers, counts and durations only — never translated text, never a
  // credential, never a model path.
  console.info(`[aidub:tts] ${message}`, detail);
}

/** TTS failures reach the job layer as structured processing errors. */
function toProcessingError(cause: unknown): ProcessingError {
  if (cause instanceof TtsError) {
    if (cause.code === "TTS_CANCELLED") {
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
    "Speech generation failed unexpectedly. Please try again.",
    { cause },
  );
}

export class TtsGenerationService implements StageRunner {
  private readonly registry: TtsProviderRegistry;
  private readonly assignments: VoiceAssignmentRepository;
  private readonly generated: GeneratedSpeechRepository;
  private readonly translations: TranslationService;
  private readonly artifacts?: ProcessingArtifactStorage;
  private readonly config: TtsConfig;
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly logger: (
    message: string,
    detail?: Record<string, unknown>,
  ) => void;

  constructor(options: TtsGenerationServiceOptions = {}) {
    this.registry = options.registry ?? ttsProviderRegistry;
    this.assignments = options.assignments ?? voiceAssignmentRepository;
    this.generated = options.generated ?? generatedSpeechRepository;
    this.translations = options.translations ?? translationService;
    this.artifacts = options.artifacts;
    this.config = resolveTtsConfig(options.config);
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? defaultLogger;
  }

  // ---------------------------------------------------------------- voices

  /** Every voice this server can speak the target language with. */
  async listVoices(
    targetLanguage: string,
    providerId?: string | null,
  ): Promise<{ providerId: string; available: boolean; voices: TtsVoice[] }> {
    const provider = this.registry.get(providerId);
    const available = await provider.isAvailable();

    return {
      providerId: provider.id,
      available,
      voices: available ? await provider.listVoices(targetLanguage) : [],
    };
  }

  async listAssignments(
    identity: VoiceAssignmentIdentity,
  ): Promise<SpeakerVoiceAssignment[]> {
    return this.assignments.listByIdentity(identity);
  }

  /**
   * Casts one speaker.
   *
   * The voice is validated against the provider's catalog and the target
   * language *before* anything is stored: an assignment naming a voice that
   * cannot speak the language would fail later, once per line, in the middle of
   * a run someone is waiting on.
   */
  async assignVoice(
    identity: VoiceAssignmentIdentity,
    speakerId: string,
    voice: VoiceSource,
    settings: TtsGenerationSettings = DEFAULT_TTS_SETTINGS,
  ): Promise<SpeakerVoiceAssignment> {
    const provider = this.registry.get(voice.providerId);
    const catalog = await provider.listVoices();
    const found = catalog.find((entry) => entry.id === voice.voiceId);

    if (!found) {
      throw ttsError("TTS_VOICE_NOT_FOUND", {
        details: `voice ${voice.voiceId} is not offered by ${provider.id}`,
      });
    }

    if (!voiceSupportsLanguage(found, identity.targetLanguage)) {
      throw ttsError("TTS_UNSUPPORTED_LANGUAGE", {
        details: `voice ${voice.voiceId} does not speak ${identity.targetLanguage}`,
      });
    }

    const existing = await this.assignments.getBySpeaker(identity, speakerId);
    const timestamp = this.now().toISOString();

    return this.assignments.save({
      id: voiceAssignmentId(identity, speakerId),
      projectId: identity.projectId,
      sourceMediaId: identity.sourceMediaId,
      dialogueId: identity.dialogueId,
      speakerId,
      voice: { ...voice },
      targetLanguage: identity.targetLanguage,
      settings: { ...DEFAULT_TTS_SETTINGS, ...settings },
      // Re-casting a speaker keeps the record's original creation time: it is
      // the same decision being revised, not a new one.
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
  }

  async removeAssignment(
    identity: VoiceAssignmentIdentity,
    speakerId: string,
  ): Promise<void> {
    await this.assignments.delete(identity, speakerId);
  }

  /**
   * Synthesises a short sample of a voice.
   *
   * Uses fixed neutral text rather than a line from the project: previewing is
   * about hearing the voice, and spending a provider call on real dialogue
   * would blur the line between an audition and a generated take.
   */
  async previewVoice(
    voice: VoiceSource,
    targetLanguage: string,
    settings: TtsGenerationSettings = DEFAULT_TTS_SETTINGS,
    signal?: AbortSignal,
  ): Promise<{ data: Uint8Array; mimeType: string }> {
    const provider = this.registry.get(voice.providerId);

    if (!(await provider.isAvailable())) {
      throw ttsError("TTS_PROVIDER_UNAVAILABLE", {
        details: `provider ${provider.id} is not configured on this server`,
      });
    }

    const result = await this.callProvider(
      provider,
      {
        projectId: "preview",
        dialogueId: "preview",
        dialogueSegmentId: "preview",
        translationId: "preview",
        translationRevision: 0,
        translatedSegmentRevision: 0,
        speakerId: "preview",
        targetLanguage,
        text: VOICE_PREVIEW_TEXT,
        voice,
        settings: { ...DEFAULT_TTS_SETTINGS, ...settings },
      },
      signal,
    );

    return { data: result.audio.data, mimeType: result.audio.mimeType };
  }

  // --------------------------------------------------------------- reading

  /**
   * Everything the Voices workspace needs, resolved server-side so the browser
   * never has to reason about staleness itself.
   */
  async resolveCurrent(
    projectId: string,
    sourceMediaId: string,
    targetLanguage: string,
  ): Promise<SpeechResolution> {
    const empty = {
      targetLanguage,
      translationId: null,
      translationRevision: null,
      dialogueId: null,
      segments: [],
      assignments: [],
      unassignedSpeakerIds: [],
      hasUnassignedSegments: false,
      currentCount: 0,
      staleCount: 0,
    } satisfies Omit<SpeechResolution, "state">;

    const resolution = await this.translations.resolveForTarget(
      projectId,
      sourceMediaId,
      targetLanguage,
    );

    if (!resolution.translation) {
      return {
        ...empty,
        state: "translation_required",
        details: resolution.state,
      };
    }

    const translation = resolution.translation;
    const identity = this.identityFor(translation);
    const [assignments, stored] = await Promise.all([
      this.assignments.listByIdentity(identity),
      this.generated.listByIdentity(identity),
    ]);
    const byAssignment = new Map(
      assignments.map((assignment) => [assignment.speakerId, assignment]),
    );
    const byGenerated = new Map(
      stored.map((segment) => [segment.dialogueSegmentId, segment]),
    );

    const segments: SpeechSegmentView[] = translation.segments.map((segment) =>
      this.viewFor(segment, translation, byGenerated, byAssignment),
    );

    const speakerIds = new Set<string>();
    let hasUnassignedSegments = false;

    for (const segment of translation.segments) {
      if (segment.speakerId) {
        speakerIds.add(segment.speakerId);
      } else if (hasSpeakableText(segment.translatedText)) {
        // A silent line without a speaker is harmless — it was never going to
        // be spoken. An unassigned line *with* text is a real gap.
        hasUnassignedSegments = true;
      }
    }

    const unassignedSpeakerIds = [...speakerIds].filter(
      (speakerId) => !byAssignment.has(speakerId),
    );
    const currentCount = segments.filter((segment) => segment.current).length;
    const staleCount = segments.length - currentCount;

    // Reported in order of what a person has to do first: a stale translation
    // makes everything below it moot, and casting has to happen before
    // generating can mean anything.
    const state: SpeechState =
      resolution.state === "stale"
        ? "translation_stale"
        : unassignedSpeakerIds.length > 0
          ? "voices_required"
          : currentCount === 0
            ? "not_generated"
            : staleCount > 0
              ? "partial"
              : "ready";

    return {
      state,
      targetLanguage,
      translationId: translation.id,
      translationRevision: translation.revision,
      dialogueId: translation.dialogueId,
      segments,
      assignments,
      unassignedSpeakerIds,
      hasUnassignedSegments,
      currentCount,
      staleCount,
      ...(resolution.staleReason ? { details: resolution.staleReason } : {}),
    };
  }

  /**
   * One generated record, checked against the project that asked for it.
   *
   * The projectId is not decoration: without it, an artifact id from one
   * project would fetch audio from another simply by being guessed. Every read
   * path that reaches audio goes through a check of this shape.
   */
  async getGeneratedSegment(
    projectId: string,
    generatedId: string,
  ): Promise<GeneratedSpeechSegment | null> {
    const segment = await this.generated.getById(generatedId);

    return segment && segment.projectId === projectId ? segment : null;
  }

  // -------------------------------------------------------------- the job

  /**
   * Both speech operations run through one job type.
   *
   * They share a lifecycle, a provider, a cancellation story and an error
   * model, and differ only in scope: `full_project` speaks everything that
   * needs speaking, `single_segment` speaks exactly one line and leaves every
   * other record byte-identical.
   */
  async run(context: StageRunContext): Promise<GenerateSpeechJobResult> {
    try {
      const parameters = context.job.parameters;

      if (!parameters || parameters.kind !== "generate_speech") {
        throw ttsError("TTS_INVALID_REQUEST", {
          details: "generate_speech job created without speech parameters",
        });
      }

      return await this.generate(context, parameters);
    } catch (cause) {
      throw toProcessingError(cause);
    }
  }

  private async generate(
    context: StageRunContext,
    parameters: GenerateSpeechJobParameters,
  ): Promise<GenerateSpeechJobResult> {
    const { job, signal, onProgress } = context;

    onProgress(1, "Preparing translation");

    const resolution = await this.translations.resolveForTarget(
      job.projectId,
      job.sourceMediaId,
      parameters.targetLanguage,
    );

    if (!resolution.translation) {
      throw ttsError("TTS_TRANSLATION_REQUIRED", {
        details: `translation state ${resolution.state}`,
      });
    }

    if (resolution.state === "stale") {
      // Speaking a translation whose dialogue has moved on would file audio of
      // lines nobody currently has.
      throw ttsError("TTS_TRANSLATION_STALE", {
        details: resolution.staleReason,
      });
    }

    const translation = resolution.translation;

    // The job named a translation and a revision when it was created. If either
    // moved since, this run would produce audio for text nobody asked about.
    if (
      translation.id !== parameters.translationId ||
      translation.revision !== parameters.translationRevision
    ) {
      throw ttsError("TTS_SOURCE_CHANGED", {
        details: `job expected translation ${parameters.translationId}@${parameters.translationRevision}`,
      });
    }

    const identity = this.identityFor(translation);
    const assignments = await this.assignments.listByIdentity(identity);
    const byAssignment = new Map(
      assignments.map((assignment) => [assignment.speakerId, assignment]),
    );

    const targets = this.selectTargets(translation, parameters);

    if (targets.length === 0) {
      throw ttsError("TTS_SEGMENT_NOT_FOUND", {
        details: parameters.dialogueSegmentId
          ? `segment ${parameters.dialogueSegmentId} is not in translation ${translation.id}`
          : "the translation has no lines to speak",
      });
    }

    // Checked up front, across the whole run: discovering an uncast speaker at
    // line 80 of 100 wastes 79 provider calls and leaves a half-dubbed project.
    this.assertEveryVoiceAssigned(targets, byAssignment);

    const provider = this.registry.get(job.providerId);

    if (!(await provider.isAvailable())) {
      throw ttsError("TTS_PROVIDER_UNAVAILABLE", {
        details: `provider ${provider.id} is not configured on this server`,
      });
    }

    const existing = new Map(
      (await this.generated.listByIdentity(identity)).map((segment) => [
        segment.dialogueSegmentId,
        segment,
      ]),
    );

    onProgress(PROGRESS_PREPARED, "Generating speech");

    const records: GeneratedSpeechSegment[] = [];
    let generatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let providerModel: string | null = null;

    for (const [index, segment] of targets.entries()) {
      if (signal.aborted) {
        throw ttsError("TTS_CANCELLED");
      }

      const previous = existing.get(segment.dialogueSegmentId) ?? null;
      const assignment = segment.speakerId
        ? (byAssignment.get(segment.speakerId) ?? null)
        : null;

      // Nothing to say: recorded as intentionally silent so the structure stays
      // 1:1 with the translation, and no provider call is spent on punctuation.
      if (!hasSpeakableText(segment.translatedText)) {
        records.push(
          this.silentRecord(segment, translation, identity, assignment, previous),
        );
        skippedCount += 1;
      } else if (
        !parameters.regenerateAll &&
        previous &&
        this.isCurrent(previous, segment, translation, assignment)
      ) {
        // Already exactly this line, in this voice, at these settings.
        records.push(previous);
        generatedCount += 1;
      } else {
        const record = await this.generateOne(
          provider,
          segment,
          translation,
          identity,
          // `assertEveryVoiceAssigned` has already established this.
          assignment as SpeakerVoiceAssignment,
          previous,
          job.id,
          signal,
        );

        records.push(record);

        if (record.status === "completed") {
          generatedCount += 1;
          providerModel = record.providerModel ?? providerModel;
        } else {
          failedCount += 1;
        }
      }

      onProgress(
        PROGRESS_PREPARED +
          Math.round(((index + 1) / targets.length) * PROGRESS_GENERATION_SPAN),
        `Generating speech (${index + 1} of ${targets.length})`,
      );
    }

    if (signal.aborted) {
      throw ttsError("TTS_CANCELLED");
    }

    onProgress(PROGRESS_SAVING, "Saving generated speech");

    // Re-checked at the end as well as at the start: a full run takes minutes,
    // and a translation edited during it must not have audio of its old text
    // filed as current.
    await this.assertTranslationUnmoved(job, parameters, translation);

    try {
      await this.generated.saveAll(records);
    } catch (cause) {
      throw ttsError("TTS_STORAGE_FAILED", { cause });
    }

    this.logger("speech generated", {
      jobId: job.id,
      projectId: job.projectId,
      operation: parameters.operation,
      generatedCount,
      skippedCount,
      failedCount,
    });

    return {
      kind: "generate_speech",
      dialogueId: translation.dialogueId,
      translationId: translation.id,
      targetLanguage: parameters.targetLanguage,
      generatedCount,
      skippedCount,
      failedCount,
      providerId: provider.id,
      providerModel,
    };
  }

  /**
   * Speaks one line.
   *
   * A failure here is recorded, not thrown: one provider hiccup at line 40 must
   * not discard the 39 lines that worked. The previous audio is left in place
   * and its artifact is not deleted, so a failed regeneration costs nothing a
   * person already had.
   */
  private async generateOne(
    provider: TtsProvider,
    segment: TranslatedDialogueSegment,
    translation: DialogueTranslation,
    identity: GeneratedSpeechIdentity,
    assignment: SpeakerVoiceAssignment,
    previous: GeneratedSpeechSegment | null,
    jobId: string,
    signal: AbortSignal,
  ): Promise<GeneratedSpeechSegment> {
    const timestamp = this.now().toISOString();
    const duration = segmentSpan(segment);
    const base = {
      id: generatedSpeechId(identity, segment.dialogueSegmentId),
      projectId: identity.projectId,
      sourceMediaId: identity.sourceMediaId,
      dialogueId: identity.dialogueId,
      dialogueSegmentId: segment.dialogueSegmentId,
      speakerId: segment.speakerId,
      translationId: translation.id,
      translationRevision: translation.revision,
      translatedSegmentRevision: segment.editMetadata.revision,
      targetLanguage: translation.targetLanguage,
      providerId: assignment.voice.providerId,
      voiceId: assignment.voice.voiceId,
      segmentDurationSeconds: duration,
      generationSettings: { ...assignment.settings },
      fingerprint: fingerprintFor(
        toStalenessSegment(segment),
        segment.speakerId,
        assignment,
      ),
      version: TTS_SCHEMA_VERSION,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    let result: TtsProviderResult;

    try {
      result = await this.callProvider(
        provider,
        {
          projectId: identity.projectId,
          dialogueId: identity.dialogueId,
          dialogueSegmentId: segment.dialogueSegmentId,
          translationId: translation.id,
          translationRevision: translation.revision,
          translatedSegmentRevision: segment.editMetadata.revision,
          // Guaranteed by `assertEveryVoiceAssigned`.
          speakerId: segment.speakerId as string,
          targetLanguage: translation.targetLanguage,
          text: segment.translatedText,
          voice: assignment.voice,
          settings: assignment.settings,
        },
        signal,
      );
    } catch (cause) {
      if (cause instanceof TtsError && cause.code === "TTS_CANCELLED") {
        throw cause;
      }

      this.logger("line failed", {
        jobId,
        dialogueSegmentId: segment.dialogueSegmentId,
        code: cause instanceof TtsError ? cause.code : "unknown",
      });

      return {
        ...base,
        // The previous take stays exactly where it was: a failed regeneration
        // must never cost someone audio they already had.
        artifactId: previous?.artifactId ?? null,
        mimeType: previous?.mimeType ?? null,
        status: "failed",
        providerModel: previous?.providerModel ?? null,
        durationSeconds: previous?.durationSeconds ?? null,
        warnings: [],
        usage: null,
      };
    }

    const measured =
      result.durationSeconds ?? wavDurationSeconds(result.audio.data);
    const assessment = assessGeneratedDuration(measured, duration);
    const warnings: TtsGenerationWarning[] = [...assessment.warnings];

    let artifactId: string | null = null;

    try {
      artifactId = await this.storeAudio(identity, segment, result, jobId, assessment.durationSeconds);
    } catch (cause) {
      throw ttsError("TTS_STORAGE_FAILED", { cause });
    }

    // Only once the new audio is safely stored is the old one dropped — the
    // replacement has to commit before the thing it replaces goes away.
    if (previous?.artifactId && previous.artifactId !== artifactId) {
      await this.artifacts?.delete(previous.artifactId).catch(() => {});
    }

    return {
      ...base,
      artifactId,
      mimeType: result.audio.mimeType,
      status: "completed",
      durationSeconds: assessment.durationSeconds,
      warnings,
      providerModel: result.provider.model,
      ...(result.provider.metadata
        ? { providerMetadata: result.provider.metadata }
        : {}),
      usage: result.usage ?? null,
    };
  }

  /**
   * Stores the audio bytes as an artifact.
   *
   * The filename is built entirely from backend identifiers — never from a
   * user's filename, a speaker name or translated text — so nothing a person
   * typed can shape a path.
   */
  private async storeAudio(
    identity: GeneratedSpeechIdentity,
    segment: TranslatedDialogueSegment,
    result: TtsProviderResult,
    jobId: string,
    durationSeconds: number | null,
  ): Promise<string | null> {
    if (!this.artifacts) {
      // No artifact storage wired in (a unit-test service, say). The metadata
      // is still honest: a record with no artifact reads as having no audio.
      return null;
    }

    const artifact = await this.artifacts.saveBytes({
      projectId: identity.projectId,
      sourceMediaId: identity.sourceMediaId,
      jobId,
      type: "generated_speech",
      filename: `${safeName(segment.dialogueSegmentId)}-${this.createId()}${extensionFor(result.audio.mimeType)}`,
      mimeType: result.audio.mimeType,
      data: result.audio.data,
      sampleRate: result.audio.sampleRate ?? null,
      channels: result.audio.channels ?? null,
      durationSeconds,
    });

    return artifact.id;
  }

  /** A line with nothing to say, recorded as such rather than skipped. */
  private silentRecord(
    segment: TranslatedDialogueSegment,
    translation: DialogueTranslation,
    identity: GeneratedSpeechIdentity,
    assignment: SpeakerVoiceAssignment | null,
    previous: GeneratedSpeechSegment | null,
  ): GeneratedSpeechSegment {
    const timestamp = this.now().toISOString();
    const voice: Pick<
      SpeakerVoiceAssignment,
      "voice" | "settings" | "targetLanguage"
    > = assignment ?? {
      voice: {
        type: "standard",
        providerId: this.registry.defaultProviderId(),
        voiceId: "",
      },
      settings: DEFAULT_TTS_SETTINGS,
      targetLanguage: translation.targetLanguage,
    };

    return {
      id: generatedSpeechId(identity, segment.dialogueSegmentId),
      projectId: identity.projectId,
      sourceMediaId: identity.sourceMediaId,
      dialogueId: identity.dialogueId,
      dialogueSegmentId: segment.dialogueSegmentId,
      speakerId: segment.speakerId,
      translationId: translation.id,
      translationRevision: translation.revision,
      translatedSegmentRevision: segment.editMetadata.revision,
      targetLanguage: translation.targetLanguage,
      providerId: voice.voice.providerId,
      providerModel: null,
      voiceId: voice.voice.voiceId,
      artifactId: null,
      mimeType: null,
      status: "skipped_empty",
      durationSeconds: null,
      segmentDurationSeconds: segmentSpan(segment),
      generationSettings: { ...voice.settings },
      warnings: [],
      fingerprint: fingerprintFor(
        toStalenessSegment(segment),
        segment.speakerId,
        voice,
      ),
      version: TTS_SCHEMA_VERSION,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
      usage: null,
    };
  }

  private async callProvider(
    provider: TtsProvider,
    request: Parameters<TtsProvider["synthesize"]>[0],
    signal?: AbortSignal,
  ): Promise<TtsProviderResult> {
    // A per-line ceiling, not a per-run one: a long project legitimately takes
    // many minutes, and a timeout sized for the whole run would either be
    // useless or would kill healthy work.
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs);
    const combined = signal
      ? AbortSignal.any([signal, timeout])
      : timeout;

    try {
      return await provider.synthesize(request, { signal: combined });
    } catch (cause) {
      if (cause instanceof TtsError) {
        // A cancel that came from our own timeout is a timeout, not a user
        // pressing stop, and reads very differently to the person waiting.
        if (cause.code === "TTS_CANCELLED" && !signal?.aborted) {
          throw ttsError("TTS_TIMEOUT");
        }

        throw cause;
      }

      throw ttsError("TTS_GENERATION_FAILED", { cause });
    }
  }

  // ------------------------------------------------------------- helpers

  private selectTargets(
    translation: DialogueTranslation,
    parameters: GenerateSpeechJobParameters,
  ): TranslatedDialogueSegment[] {
    if (parameters.operation === "single_segment") {
      const wanted = parameters.dialogueSegmentId;
      const found = translation.segments.find(
        (segment) => segment.dialogueSegmentId === wanted,
      );

      return found ? [found] : [];
    }

    return [...translation.segments];
  }

  /**
   * Refuses a run that cannot be completed honestly.
   *
   * A line with text but no speaker is a Part 8 problem and is named as such;
   * a speaker with no voice is a casting decision this code will not make on
   * anyone's behalf.
   */
  private assertEveryVoiceAssigned(
    segments: readonly TranslatedDialogueSegment[],
    byAssignment: ReadonlyMap<string, SpeakerVoiceAssignment>,
  ): void {
    const speakable = segments.filter((segment) =>
      hasSpeakableText(segment.translatedText),
    );

    if (speakable.some((segment) => !segment.speakerId)) {
      throw ttsError("TTS_SPEAKER_UNASSIGNED");
    }

    const missing = [
      ...new Set(
        speakable
          .map((segment) => segment.speakerId as string)
          .filter((speakerId) => !byAssignment.has(speakerId)),
      ),
    ];

    if (missing.length > 0) {
      throw ttsError("TTS_VOICE_ASSIGNMENT_REQUIRED", {
        details: `${missing.length} speaker(s) without a voice`,
      });
    }
  }

  private async assertTranslationUnmoved(
    job: StageRunContext["job"],
    parameters: GenerateSpeechJobParameters,
    started: DialogueTranslation,
  ): Promise<void> {
    const now = await this.translations.resolveForTarget(
      job.projectId,
      job.sourceMediaId,
      parameters.targetLanguage,
    );

    if (
      !now.translation ||
      now.translation.id !== started.id ||
      now.translation.revision !== started.revision
    ) {
      throw ttsError("TTS_SOURCE_CHANGED");
    }
  }

  private isCurrent(
    generated: GeneratedSpeechSegment,
    segment: TranslatedDialogueSegment,
    translation: DialogueTranslation,
    assignment: SpeakerVoiceAssignment | null,
  ): boolean {
    return generatedSpeechCurrency(
      generated,
      toStalenessSegment(segment),
      {
        translationId: translation.id,
        translationRevision: translation.revision,
        targetLanguage: translation.targetLanguage,
      },
      assignment,
    ).current;
  }

  private viewFor(
    segment: TranslatedDialogueSegment,
    translation: DialogueTranslation,
    byGenerated: ReadonlyMap<string, GeneratedSpeechSegment>,
    byAssignment: ReadonlyMap<string, SpeakerVoiceAssignment>,
  ): SpeechSegmentView {
    const generated = byGenerated.get(segment.dialogueSegmentId) ?? null;
    const assignment = segment.speakerId
      ? (byAssignment.get(segment.speakerId) ?? null)
      : null;
    const base = {
      dialogueSegmentId: segment.dialogueSegmentId,
      speakerId: segment.speakerId,
      translatedText: segment.translatedText,
      startTime: segment.startTime,
      endTime: segment.endTime,
      segmentDurationSeconds: segmentSpan(segment),
      generated,
    };

    if (!generated) {
      return { ...base, current: false };
    }

    const currency = generatedSpeechCurrency(
      generated,
      toStalenessSegment(segment),
      {
        translationId: translation.id,
        translationRevision: translation.revision,
        targetLanguage: translation.targetLanguage,
      },
      assignment,
    );

    return currency.current
      ? { ...base, current: true }
      : { ...base, current: false, staleReason: currency.reason };
  }

  private identityFor(
    translation: DialogueTranslation,
  ): GeneratedSpeechIdentity & VoiceAssignmentIdentity {
    return {
      projectId: translation.projectId,
      sourceMediaId: translation.sourceMediaId,
      dialogueId: translation.dialogueId,
      targetLanguage: translation.targetLanguage,
    };
  }
}

function segmentSpan(segment: TranslatedDialogueSegment): number {
  return Math.max(0, Math.round((segment.endTime - segment.startTime) * 1000) / 1000);
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("wav")) return ".wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return ".mp3";
  if (mimeType.includes("ogg")) return ".ogg";
  if (mimeType.includes("opus")) return ".opus";

  return ".audio";
}

export { VOICE_ASSIGNMENT_SCHEMA_VERSION };
