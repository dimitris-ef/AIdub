import { randomUUID } from "node:crypto";

import type { DiarizationJobResult } from "@/types/processing-job";
import type { DiarizationResult } from "@/types/diarization";
import { diarizationRepository } from "@/data/diarization";
import type { DiarizationRepository } from "@/data/diarization";
import { normalizeDiarizationRegions } from "@/lib/diarization/normalize-diarization";
import { ProcessingError } from "@/server/processing/processing-errors";
import type { StageRunContext, StageRunner } from "@/server/processing/processing-service";
import {
  DiarizationError,
  diarizationError,
} from "@/server/diarization/diarization-errors";
import { speakerDiarizationProviderRegistry } from "@/server/diarization/speaker-diarization-provider-registry";
import type { SpeakerDiarizationProviderRegistry } from "@/server/diarization/speaker-diarization-provider-registry";

/**
 * Orchestrates one diarization: pick the provider, make sure canonical audio
 * exists, run the provider, normalise and validate what comes back, persist
 * the result, and only then let the job complete.
 *
 * It knows nothing about FFmpeg (audio comes from the processing layer's
 * `ensureAudio`) and nothing about any model (speakers come from a provider
 * behind `SpeakerDiarizationProvider`). Moving execution to an external CPU or
 * GPU worker means calling this same service there.
 *
 * It also knows nothing about transcripts. Diarization answers "who spoke and
 * when" on its own; Part 7 merges the two timelines.
 *
 * Progress is mapped to one documented scale:
 *   1–10   preparing / reusing audio
 *   10–30  extracting audio when it has to be produced
 *   30–90  provider work (real percentage when the provider reports one)
 *   95     saving the result
 *   100    completed
 */

const PROGRESS_AUDIO_READY = 30;
const PROGRESS_PROVIDER_SPAN = 60;
const PROGRESS_SAVING = 95;

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export interface DiarizationServiceOptions {
  registry?: SpeakerDiarizationProviderRegistry;
  diarizations?: DiarizationRepository;
  createId?: () => string;
  now?: () => Date;
  timeoutMs?: number;
  logger?: (message: string, detail?: Record<string, unknown>) => void;
}

function defaultLogger(
  message: string,
  detail: Record<string, unknown> = {},
): void {
  // Job/provider identifiers and counts only — never audio, speaker regions or
  // credentials.
  console.info(`[aidub:diarization] ${message}`, detail);
}

/** Diarization failures reach the job layer as structured processing errors. */
function toProcessingError(cause: unknown): ProcessingError {
  if (cause instanceof DiarizationError) {
    if (cause.code === "DIARIZATION_CANCELLED") {
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
    "Speaker analysis failed unexpectedly. Please try again.",
    { cause },
  );
}

export class DiarizationService implements StageRunner {
  private readonly registry: SpeakerDiarizationProviderRegistry;
  private readonly diarizations: DiarizationRepository;
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly logger: (
    message: string,
    detail?: Record<string, unknown>,
  ) => void;

  constructor(options: DiarizationServiceOptions = {}) {
    this.registry = options.registry ?? speakerDiarizationProviderRegistry;
    this.diarizations = options.diarizations ?? diarizationRepository;
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs =
      options.timeoutMs ??
      Number(process.env.AIDUB_DIARIZATION_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    this.logger = options.logger ?? defaultLogger;
  }

  async run(context: StageRunContext): Promise<DiarizationJobResult> {
    try {
      return await this.diarize(context);
    } catch (cause) {
      throw toProcessingError(cause);
    }
  }

  private async diarize(
    context: StageRunContext,
  ): Promise<DiarizationJobResult> {
    const { job, signal, onProgress } = context;
    const provider = this.registry.get(job.providerId);

    if (!(await provider.isAvailable())) {
      throw diarizationError("DIARIZATION_PROVIDER_UNAVAILABLE", {
        details: `provider ${provider.id} is not configured on this server`,
      });
    }

    onProgress(5, "Preparing audio");

    // The canonical audio artifact is produced (or reused) by the processing
    // layer — diarization never runs FFmpeg itself, and never extracts audio
    // a second time when transcription already produced it.
    let audio;
    try {
      audio = await context.ensureAudio();
    } catch (cause) {
      if (cause instanceof ProcessingError && cause.code === "CANCELLED") {
        throw cause;
      }

      throw diarizationError("DIARIZATION_AUDIO_FAILED", { cause });
    }

    this.throwIfAborted(signal);
    onProgress(PROGRESS_AUDIO_READY, "Analysing speakers");

    const started = Date.now();
    const result = await this.callProvider(provider, context, audio);

    // A result that arrives after cancellation is discarded: nothing is saved
    // and the job stays cancelled.
    this.throwIfAborted(signal);

    const normalized = normalizeDiarizationRegions(result.regions, {
      durationSeconds: audio.durationSeconds,
      createId: this.createId,
      speakers: result.speakers,
    });

    if (!normalized.ok) {
      throw diarizationError(normalized.code, {
        details: normalized.details,
        message: normalized.message,
      });
    }

    onProgress(PROGRESS_SAVING, "Saving speaker analysis");

    const timestamp = this.now().toISOString();
    const diarization: DiarizationResult = {
      id: this.createId(),
      projectId: job.projectId,
      sourceMediaId: job.sourceMediaId,
      audioArtifactId: audio.artifact.id,
      providerId: result.provider.id,
      providerModel: result.provider.model,
      status: "completed",
      speakers: normalized.speakers,
      regions: normalized.regions,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(result.provider.metadata
        ? { providerMetadata: result.provider.metadata }
        : {}),
    };

    const previous = await this.diarizations
      .getByProjectAndSource(job.projectId, job.sourceMediaId)
      .catch(() => null);

    try {
      await this.diarizations.save(diarization);
    } catch (cause) {
      throw diarizationError("DIARIZATION_SAVE_FAILED", { cause });
    }

    // Rediarization replaces the previous result only once the new one is
    // safely stored: a failed rerun leaves the working result untouched.
    if (previous && previous.id !== diarization.id) {
      await this.diarizations.delete(previous.id).catch(() => {
        // An orphaned old result is harmless; the new one is active.
      });
    }

    this.logger("diarization completed", {
      jobId: job.id,
      projectId: job.projectId,
      providerId: provider.id,
      model: result.provider.model,
      speakerCount: diarization.speakers.length,
      regionCount: diarization.regions.length,
      duplicatesRemoved: normalized.duplicatesRemoved,
      clamped: normalized.clamped,
      durationMs: Date.now() - started,
    });

    return {
      kind: "diarize",
      diarizationId: diarization.id,
      speakerCount: diarization.speakers.length,
      regionCount: diarization.regions.length,
      providerId: diarization.providerId,
      providerModel: diarization.providerModel,
    };
  }

  /** Runs the provider under the job's signal plus a timeout of our own. */
  private async callProvider(
    provider: ReturnType<SpeakerDiarizationProviderRegistry["get"]>,
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
      return await provider.diarize(
        {
          projectId: context.job.projectId,
          sourceMediaId: context.job.sourceMediaId,
          audioArtifactId: audio.artifact.id,
          audio: {
            path: audio.path,
            mimeType: audio.mimeType,
            durationSeconds: audio.durationSeconds,
          },
          // No speaker count is imposed: the user is never asked how many
          // people are in the recording, so the model infers it.
          expectedSpeakerCount: null,
          minSpeakers: null,
          maxSpeakers: null,
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
        throw diarizationError("DIARIZATION_TIMEOUT");
      }
      if (context.signal.aborted) {
        throw diarizationError("DIARIZATION_CANCELLED");
      }
      if (cause instanceof DiarizationError) {
        throw cause;
      }

      throw diarizationError("DIARIZATION_REQUEST_FAILED", { cause });
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener("abort", abort);
    }
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw diarizationError("DIARIZATION_CANCELLED");
    }
  }
}
