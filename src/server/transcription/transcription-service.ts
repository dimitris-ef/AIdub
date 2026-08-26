import { randomUUID } from "node:crypto";

import type { TranscribeJobResult } from "@/types/processing-job";
import type { Transcript } from "@/types/transcript";
import { transcriptRepository } from "@/data/transcripts";
import type { TranscriptRepository } from "@/data/transcripts";
import { normalizeTranscriptSegments } from "@/lib/transcript/normalize-transcript";
import { ProcessingError } from "@/server/processing/processing-errors";
import type {
  StageRunContext,
  TranscriptionRunner,
} from "@/server/processing/processing-service";
import {
  TranscriptionError,
  transcriptionError,
} from "@/server/transcription/transcription-errors";
import { speechToTextProviderRegistry } from "@/server/transcription/speech-to-text-provider-registry";
import type { SpeechToTextProviderRegistry } from "@/server/transcription/speech-to-text-provider-registry";

/**
 * Orchestrates one transcription: pick the provider, make sure canonical audio
 * exists, run the provider, normalise and validate what comes back, persist the
 * transcript, and only then let the job complete.
 *
 * It knows nothing about FFmpeg (audio comes from the processing layer's
 * `ensureAudio`) and nothing about any vendor (speech comes from a provider
 * behind `SpeechToTextProvider`). Moving execution to an external worker means
 * calling this same service there.
 *
 * Progress is mapped to one documented scale:
 *   1–10   preparing / reusing audio
 *   10–30  extracting audio when it has to be produced
 *   30–90  provider work (real percentage when the provider reports one)
 *   95     saving the transcript
 *   100    completed
 */

const PROGRESS_AUDIO_READY = 30;
const PROGRESS_PROVIDER_SPAN = 60;
const PROGRESS_SAVING = 95;

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

export interface TranscriptionServiceOptions {
  registry?: SpeechToTextProviderRegistry;
  transcripts?: TranscriptRepository;
  createId?: () => string;
  now?: () => Date;
  timeoutMs?: number;
  logger?: (message: string, detail?: Record<string, unknown>) => void;
}

function defaultLogger(
  message: string,
  detail: Record<string, unknown> = {},
): void {
  // Job/provider identifiers and counts only — never audio, transcripts or
  // credentials.
  console.info(`[aidub:transcription] ${message}`, detail);
}

/** Transcription failures reach the job layer as structured processing errors. */
function toProcessingError(cause: unknown): ProcessingError {
  if (cause instanceof TranscriptionError) {
    if (cause.code === "TRANSCRIPTION_CANCELLED") {
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
    "Transcription failed unexpectedly. Please try again.",
    { cause },
  );
}

export class TranscriptionService implements TranscriptionRunner {
  private readonly registry: SpeechToTextProviderRegistry;
  private readonly transcripts: TranscriptRepository;
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly logger: (
    message: string,
    detail?: Record<string, unknown>,
  ) => void;

  constructor(options: TranscriptionServiceOptions = {}) {
    this.registry = options.registry ?? speechToTextProviderRegistry;
    this.transcripts = options.transcripts ?? transcriptRepository;
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs =
      options.timeoutMs ??
      Number(process.env.AIDUB_STT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    this.logger = options.logger ?? defaultLogger;
  }

  async run(context: StageRunContext): Promise<TranscribeJobResult> {
    try {
      return await this.transcribe(context);
    } catch (cause) {
      throw toProcessingError(cause);
    }
  }

  private async transcribe(
    context: StageRunContext,
  ): Promise<TranscribeJobResult> {
    const { job, signal, onProgress } = context;
    const provider = this.registry.get(job.providerId);

    if (!(await provider.isAvailable())) {
      throw transcriptionError("STT_PROVIDER_UNAVAILABLE", {
        details: `provider ${provider.id} is not configured on this server`,
      });
    }

    onProgress(5, "Preparing audio");

    // The canonical audio artifact is produced (or reused) by the processing
    // layer — transcription never runs FFmpeg itself.
    let audio;
    try {
      audio = await context.ensureAudio();
    } catch (cause) {
      if (cause instanceof ProcessingError && cause.code === "CANCELLED") {
        throw cause;
      }

      throw transcriptionError("AUDIO_EXTRACTION_FAILED", { cause });
    }

    this.throwIfAborted(signal);
    onProgress(PROGRESS_AUDIO_READY, "Transcribing speech");

    const started = Date.now();
    const result = await this.callProvider(provider, context, audio);

    // A result that arrives after cancellation is discarded: nothing is saved
    // and the job stays cancelled.
    this.throwIfAborted(signal);

    const normalized = normalizeTranscriptSegments(result.segments, {
      durationSeconds: audio.durationSeconds,
      createId: this.createId,
    });

    if (!normalized.ok) {
      throw transcriptionError(normalized.code, {
        details: normalized.details,
        message: normalized.message,
      });
    }

    onProgress(PROGRESS_SAVING, "Saving transcript");

    const timestamp = this.now().toISOString();
    const transcript: Transcript = {
      id: this.createId(),
      projectId: job.projectId,
      sourceMediaId: job.sourceMediaId,
      audioArtifactId: audio.artifact.id,
      providerId: result.provider.id,
      providerModel: result.provider.model,
      language: result.language,
      status: "completed",
      segments: normalized.segments,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const previous = await this.transcripts
      .getByProject(job.projectId, job.sourceMediaId)
      .catch(() => null);

    try {
      await this.transcripts.save(transcript);
    } catch (cause) {
      throw transcriptionError("TRANSCRIPT_SAVE_FAILED", { cause });
    }

    // Retranscription replaces the previous transcript only once the new one
    // is safely stored.
    if (previous && previous.id !== transcript.id) {
      await this.transcripts.delete(previous.id).catch(() => {
        // An orphaned old transcript is harmless; the new one is active.
      });
    }

    this.logger("transcription completed", {
      jobId: job.id,
      projectId: job.projectId,
      providerId: provider.id,
      model: result.provider.model,
      segmentCount: transcript.segments.length,
      discardedEmpty: normalized.discardedEmpty,
      clamped: normalized.clamped,
      durationMs: Date.now() - started,
    });

    return {
      kind: "transcribe",
      transcriptId: transcript.id,
      segmentCount: transcript.segments.length,
      detectedLanguage: transcript.language,
      providerId: transcript.providerId,
      providerModel: transcript.providerModel,
    };
  }

  /** Runs the provider under the job's signal plus a timeout of our own. */
  private async callProvider(
    provider: ReturnType<SpeechToTextProviderRegistry["get"]>,
    context: StageRunContext,
    audio: Awaited<ReturnType<StageRunContext["ensureAudio"]>>,
  ) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    context.signal.addEventListener("abort", abort, { once: true });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      return await provider.transcribe(
        {
          projectId: context.job.projectId,
          sourceMediaId: context.job.sourceMediaId,
          audioArtifactId: audio.artifact.id,
          audio: {
            path: audio.path,
            mimeType: audio.mimeType,
            durationSeconds: audio.durationSeconds,
          },
          // Only providers that can use a hint receive one; the rest detect
          // the language themselves.
          language: provider.capabilities.supportsLanguageHint
            ? context.job.languageHint
            : null,
        },
        {
          signal: controller.signal,
          onProgress: ({ percent, stage }) => {
            if (percent === undefined) {
              context.onProgress(PROGRESS_AUDIO_READY, stage);
              return;
            }

            const mapped =
              PROGRESS_AUDIO_READY +
              (Math.min(Math.max(percent, 0), 100) / 100) *
                PROGRESS_PROVIDER_SPAN;

            context.onProgress(Math.round(mapped), stage);
          },
        },
      );
    } catch (cause) {
      if (timedOut) {
        throw transcriptionError("STT_TIMEOUT");
      }
      if (context.signal.aborted) {
        throw transcriptionError("TRANSCRIPTION_CANCELLED");
      }
      if (cause instanceof TranscriptionError) {
        throw cause;
      }

      throw transcriptionError("STT_REQUEST_FAILED", { cause });
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener("abort", abort);
    }
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw transcriptionError("TRANSCRIPTION_CANCELLED");
    }
  }
}
