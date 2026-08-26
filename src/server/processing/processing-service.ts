import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { ProcessingArtifact } from "@/types/processing-artifact";
import {
  PROGRESS_STARTED,
  isProcessingJobType,
  isTerminalStatus,
  type ProbeMediaResult,
  type ProcessingJob,
  type ProcessingJobType,
} from "@/types/processing-job";
import {
  ProcessingError,
  toProcessingJobError,
} from "@/server/processing/processing-errors";
import {
  CANONICAL_AUDIO,
  type MediaProcessor,
  type ProcessingCapabilities,
} from "@/server/processing/media-processor";
import type {
  ProcessingJobRepository,
  UpdateProcessingJobInput,
} from "@/server/processing/processing-job-repository";
import type { TemporaryFileManager } from "@/server/processing/temporary-file-manager";
import type { ProcessingArtifactStorage } from "@/server/artifacts/processing-artifact-storage";
import type { TranscriptRepository } from "@/data/transcripts";
import type { DiarizationRepository } from "@/data/diarization";
import type {
  ProcessingMediaSource,
  MaterializeSourceRequest,
} from "@/server/processing/processing-media-source";

/**
 * The seam between media processing and any provider-driven stage that
 * consumes generated audio — transcription today, later AI stages tomorrow.
 * Keeping it an interface means this service never imports a provider, and the
 * stage never learns how audio is produced.
 */
export interface StageRunContext {
  job: ProcessingJob;
  signal: AbortSignal;
  /** Reuses the project's canonical audio, extracting it only if needed. */
  ensureAudio: () => Promise<PreparedAudio>;
  onProgress: (progress: number, stage?: string) => void;
}

export interface PreparedAudio {
  artifact: ProcessingArtifact;
  /** Local path inside the job workspace; cleaned up with the job. */
  path: string;
  mimeType: string;
  durationSeconds: number | null;
}

/**
 * Any provider-driven stage the processing layer can run. Transcription and
 * diarization implement the same seam and stay independent of each other.
 */
export interface StageRunner {
  run(context: StageRunContext): Promise<ProcessingJob["result"]>;
}

export type TranscriptionRunner = StageRunner;
export type DiarizationRunner = StageRunner;

/**
 * Orchestrates the job lifecycle: validation, state transitions, temporary
 * workspace, processor invocation, progress, artifacts, errors, cancellation
 * and cleanup. API route handlers stay thin — they parse a request, call this
 * service and serialise a job.
 *
 * The development implementation runs the work in this process immediately
 * after creating the job. Replacing that with "enqueue and let an external
 * worker claim it" changes only `startJob` — the job model, API contract and
 * UI are unaffected.
 */

/** Ids are client-supplied; keep them boring and never let them become paths. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface CreateJobRequest {
  projectId: string;
  sourceMediaId: string;
  type: string;
  /** Chooses the provider for provider-driven job types. */
  providerId?: string | null;
  /** Optional source-language hint for providers that accept one. */
  languageHint?: string | null;
  uploadedSource?: MaterializeSourceRequest["uploadedSource"];
}

export interface ProcessingServiceOptions {
  repository: ProcessingJobRepository;
  processor: MediaProcessor;
  temporaryFiles: TemporaryFileManager;
  artifacts: ProcessingArtifactStorage;
  mediaSource: ProcessingMediaSource;
  /** Handles "transcribe" jobs; absent means transcription is unavailable. */
  transcription?: TranscriptionRunner;
  /** Handles "diarize" jobs; absent means diarization is unavailable. */
  diarization?: DiarizationRunner;
  /** Lets project/media cleanup dispose of transcripts too. */
  transcripts?: TranscriptRepository;
  /** Lets project/media cleanup dispose of diarization results too. */
  diarizations?: DiarizationRepository;
  logger?: (message: string, cause?: unknown) => void;
}

function defaultLogger(message: string, cause?: unknown): void {
  console.warn(`[aidub:processing] ${message}`, cause ?? "");
}

export class ProcessingService {
  private readonly repository: ProcessingJobRepository;
  private readonly processor: MediaProcessor;
  private readonly temporaryFiles: TemporaryFileManager;
  private readonly artifacts: ProcessingArtifactStorage;
  private readonly mediaSource: ProcessingMediaSource;
  private readonly transcription?: TranscriptionRunner;
  private readonly diarization?: DiarizationRunner;
  private readonly transcripts?: TranscriptRepository;
  private readonly diarizations?: DiarizationRepository;
  private readonly logger: (message: string, cause?: unknown) => void;
  /** Live jobs, so they can be aborted. Never exposed to the frontend. */
  private readonly running = new Map<string, AbortController>();

  constructor(options: ProcessingServiceOptions) {
    this.repository = options.repository;
    this.processor = options.processor;
    this.temporaryFiles = options.temporaryFiles;
    this.artifacts = options.artifacts;
    this.mediaSource = options.mediaSource;
    this.transcription = options.transcription;
    this.diarization = options.diarization;
    this.transcripts = options.transcripts;
    this.diarizations = options.diarizations;
    this.logger = options.logger ?? defaultLogger;
  }

  getCapabilities(): Promise<ProcessingCapabilities> {
    return this.processor.getCapabilities();
  }

  /**
   * Validates the request and records a queued job. Nothing is executed yet,
   * which is what makes a future queue a drop-in change.
   */
  async createJob(request: CreateJobRequest): Promise<ProcessingJob> {
    const type = this.validateRequest(request);

    return this.repository.create({
      projectId: request.projectId,
      sourceMediaId: request.sourceMediaId,
      type,
      providerId: request.providerId ?? null,
      languageHint: request.languageHint ?? null,
    });
  }

  /** Development execution path: run the job in this process. */
  async runJob(
    jobId: string,
    source: MaterializeSourceRequest["uploadedSource"],
  ): Promise<ProcessingJob> {
    const job = await this.repository.getById(jobId);

    if (!job || job.status !== "queued") {
      // Already cancelled or finished — nothing to run.
      return job ?? Promise.reject(new Error(`Unknown job ${jobId}`));
    }

    const controller = new AbortController();
    this.running.set(jobId, controller);

    try {
      await this.repository.update(jobId, {
        status: "processing",
        progress: PROGRESS_STARTED,
        indeterminate: job.type === "probe_media",
        stage: isProviderStage(job.type) ? "Preparing audio" : null,
      });

      const result = await this.execute(job, controller.signal, source);

      return await this.repository.update(jobId, {
        status: "completed",
        indeterminate: false,
        // Provider-driven stages resolve their own provider (the request may
        // not have named one), so the job records which one actually ran.
        ...(result && "providerId" in result
          ? { providerId: result.providerId }
          : {}),
        result,
        error: null,
      });
    } catch (cause) {
      const error = toProcessingJobError(cause);
      const cancelled = error.code === "CANCELLED";

      if (!cancelled) {
        this.logger(`job ${jobId} failed (${error.code})`, cause);
      }

      const current = await this.repository.getById(jobId);

      if (current && isTerminalStatus(current.status)) {
        // Cancellation already recorded the terminal state.
        return current;
      }

      return await this.repository.update(jobId, {
        status: cancelled ? "cancelled" : "failed",
        indeterminate: false,
        error: cancelled ? null : error,
      });
    } finally {
      this.running.delete(jobId);
      // Cleanup always runs — success, failure or cancellation.
      await this.cleanup(jobId);
    }
  }

  async getJob(jobId: string, projectId: string): Promise<ProcessingJob | null> {
    const job = await this.repository.getById(jobId);

    // Project isolation: a job is only visible to its own project.
    if (!job || job.projectId !== projectId) {
      return null;
    }

    return job;
  }

  async listJobs(
    projectId: string,
    sourceMediaId?: string,
  ): Promise<ProcessingJob[]> {
    const jobs = await this.repository.listByProject(projectId);

    return sourceMediaId
      ? jobs.filter((job) => job.sourceMediaId === sourceMediaId)
      : jobs;
  }

  async cancelJob(
    jobId: string,
    projectId: string,
  ): Promise<ProcessingJob | null> {
    const job = await this.getJob(jobId, projectId);

    if (!job) {
      return null;
    }

    if (isTerminalStatus(job.status)) {
      return job;
    }

    // Ask the running process to stop; its own finally cleans up temp files.
    this.running.get(jobId)?.abort();

    return this.repository.update(jobId, {
      status: "cancelled",
      indeterminate: false,
    });
  }

  /**
   * Used when source media is replaced/removed or a project is deleted:
   * stop active work and drop generated artifacts for that scope.
   */
  async cancelAndPurge(
    projectId: string,
    sourceMediaId?: string,
  ): Promise<number> {
    const jobs = await this.listJobs(projectId, sourceMediaId);
    let cancelled = 0;

    for (const job of jobs) {
      if (!isTerminalStatus(job.status)) {
        await this.cancelJob(job.id, projectId);
        cancelled += 1;
      }
    }

    if (sourceMediaId) {
      await this.artifacts.deleteByMedia(sourceMediaId);
      // A transcript and a diarization each describe one source version; when
      // that source is gone they go with it rather than lingering as orphaned
      // data that could be mistaken for the new source's analysis.
      await this.transcripts?.deleteByMedia(projectId, sourceMediaId);
      await this.diarizations?.deleteByMedia(projectId, sourceMediaId);
    } else {
      await this.artifacts.deleteByProject(projectId);
      await this.repository.deleteByProject(projectId);
      await this.transcripts?.deleteByProject(projectId);
      await this.diarizations?.deleteByProject(projectId);
    }

    return cancelled;
  }

  async getArtifact(
    artifactId: string,
    projectId: string,
  ): Promise<{ artifact: ProcessingArtifact; bytes: Uint8Array } | null> {
    const artifact = await this.artifacts.get(artifactId);

    if (!artifact || artifact.projectId !== projectId) {
      return null;
    }

    const bytes = await this.artifacts.read(artifactId);

    return bytes ? { artifact, bytes } : null;
  }

  private validateRequest(request: CreateJobRequest): ProcessingJobType {
    if (!SAFE_ID.test(request.projectId ?? "")) {
      throw new ProcessingError("INVALID_REQUEST", "Invalid project.");
    }
    if (!SAFE_ID.test(request.sourceMediaId ?? "")) {
      throw new ProcessingError("INVALID_REQUEST", "Invalid source media.");
    }
    if (!isProcessingJobType(request.type)) {
      throw new ProcessingError(
        "UNSUPPORTED_JOB_TYPE",
        "This processing operation is not supported.",
      );
    }
    if (
      !request.uploadedSource ||
      request.uploadedSource.bytes.byteLength === 0
    ) {
      throw new ProcessingError(
        "SOURCE_MEDIA_NOT_FOUND",
        "The source media could not be read for processing.",
      );
    }

    return request.type;
  }

  /** Runs one job's pipeline inside its temporary workspace. */
  private async execute(
    job: ProcessingJob,
    signal: AbortSignal,
    source: MaterializeSourceRequest["uploadedSource"],
  ): Promise<ProcessingJob["result"]> {
    const sourcePath = await this.temporaryFiles.createPath(
      job.id,
      backendSourceFilename(source?.filename),
    );

    await this.mediaSource.materializeSource({
      projectId: job.projectId,
      sourceMediaId: job.sourceMediaId,
      targetPath: sourcePath,
      uploadedSource: source,
    });

    switch (job.type) {
      case "probe_media": {
        const metadata = await this.processor.probe({ inputPath: sourcePath }, {
          signal,
        });

        return { kind: "probe_media", metadata };
      }

      case "extract_audio": {
        const artifact = await this.produceAudio(job, sourcePath, signal);

        return { kind: "extract_audio", artifact: summarize(artifact) };
      }

      case "convert_media": {
        // The conversion primitive future stages reuse; Part 4 exposes it
        // internally as "normalise to canonical audio".
        const artifact = await this.produceAudio(job, sourcePath, signal, {
          via: "convert",
        });

        return { kind: "convert_media", artifact: summarize(artifact) };
      }

      case "transcribe": {
        if (!this.transcription) {
          throw new ProcessingError(
            "STT_PROVIDER_UNAVAILABLE",
            "Transcription is not available on this server.",
          );
        }

        return this.runStage(this.transcription, job, sourcePath, signal);
      }

      case "diarize": {
        if (!this.diarization) {
          throw new ProcessingError(
            "DIARIZATION_PROVIDER_UNAVAILABLE",
            "Speaker diarization is not available on this server.",
          );
        }

        return this.runStage(this.diarization, job, sourcePath, signal);
      }
    }
  }

  /**
   * Runs one provider-driven stage. Transcription and diarization share this
   * path — and therefore share audio reuse, progress and cancellation — while
   * remaining completely independent of one another.
   */
  private runStage(
    runner: StageRunner,
    job: ProcessingJob,
    sourcePath: string,
    signal: AbortSignal,
  ): Promise<ProcessingJob["result"]> {
    return runner.run({
      job,
      signal,
      ensureAudio: () => this.ensureCanonicalAudio(job, sourcePath, signal),
      onProgress: (progress, stage) => {
        void this.repository
          .update(job.id, {
            progress,
            indeterminate: false,
            ...(stage === undefined ? {} : { stage }),
          })
          .catch(() => {
            // A dropped progress tick must never fail the job.
          });
      },
    });
  }

  /**
   * Reuses the project's canonical audio when one exists for *this* source
   * media and its bytes are still there, and extracts it otherwise. The audio
   * is staged inside the job workspace, so it is cleaned up with the job while
   * the artifact itself survives.
   *
   * Every provider-driven stage goes through here, so transcription and
   * diarization of the same source share one extraction instead of each
   * running FFmpeg for themselves. Metadata without readable bytes is treated
   * as absent and regenerated rather than failing the job.
   */
  private async ensureCanonicalAudio(
    job: ProcessingJob,
    sourcePath: string,
    signal: AbortSignal,
  ): Promise<PreparedAudio> {
    const existing = await this.artifacts.list({
      projectId: job.projectId,
      sourceMediaId: job.sourceMediaId,
      type: "extracted_audio",
    });

    let artifact: ProcessingArtifact | null = null;
    let bytes: Uint8Array | null = null;

    for (const candidate of existing) {
      const stored = await this.artifacts.read(candidate.id);

      // Metadata without bytes is not reusable; fall through and regenerate.
      if (stored && stored.byteLength > 0) {
        artifact = candidate;
        bytes = stored;
        break;
      }
    }

    if (!artifact || !bytes) {
      artifact = await this.produceAudio(job, sourcePath, signal);
      bytes = await this.artifacts.read(artifact.id);

      if (!bytes) {
        throw new ProcessingError(
          "AUDIO_ARTIFACT_MISSING",
          "Processing could not start because the source audio is unavailable.",
        );
      }
    }

    await this.repository
      .update(job.id, { audioArtifactId: artifact.id })
      .catch(() => {
        // Recording the artifact reference is best effort.
      });

    const audioPath = await this.temporaryFiles.createPath(
      job.id,
      `stage-audio.${CANONICAL_AUDIO.extension}`,
    );
    await writeFile(audioPath, bytes);

    return {
      artifact,
      path: audioPath,
      mimeType: artifact.mimeType,
      durationSeconds: artifact.durationSeconds,
    };
  }

  private async produceAudio(
    job: ProcessingJob,
    sourcePath: string,
    signal: AbortSignal,
    options: { via?: "extract" | "convert" } = {},
  ): Promise<ProcessingArtifact> {
    // Probe first: it supplies the duration progress needs and proves an
    // audio track exists before any output file is created.
    const probe = await this.processor.probe({ inputPath: sourcePath }, {
      signal,
    });

    if (!probe.audio) {
      throw new ProcessingError(
        "NO_AUDIO_STREAM",
        "No audio track was found in this source video.",
      );
    }

    const outputPath = await this.temporaryFiles.createPath(
      job.id,
      `${job.type === "convert_media" ? "converted-audio" : "extracted-audio"}.${CANONICAL_AUDIO.extension}`,
    );

    const onProgress = (progress: number) => {
      void this.repository
        .update(job.id, { progress, indeterminate: false })
        .catch(() => {
          // A dropped progress tick must never fail the job.
        });
    };

    const duration = probe.durationSeconds;

    if (options.via === "convert") {
      await this.processor.convert(
        {
          inputPath: sourcePath,
          outputPath,
          durationSeconds: duration,
          audio: {
            codec: CANONICAL_AUDIO.codec,
            sampleRate: CANONICAL_AUDIO.sampleRate,
            channels: CANONICAL_AUDIO.channels,
          },
        },
        { signal, onProgress },
      );
    } else {
      await this.processor.extractAudio(
        {
          inputPath: sourcePath,
          outputPath,
          durationSeconds: duration,
          sampleRate: CANONICAL_AUDIO.sampleRate,
          channels: CANONICAL_AUDIO.channels,
        },
        { signal, onProgress },
      );
    }

    // Probe the generated file so reported metadata describes what was
    // actually produced rather than what was requested.
    const audioProbe = await this.safeProbe(outputPath, signal);

    return this.artifacts.save({
      projectId: job.projectId,
      sourceMediaId: job.sourceMediaId,
      jobId: job.id,
      type: job.type === "convert_media" ? "converted_media" : "extracted_audio",
      filename: path.basename(outputPath),
      mimeType: CANONICAL_AUDIO.mimeType,
      sourcePath: outputPath,
      sampleRate: audioProbe?.audio?.sampleRate ?? CANONICAL_AUDIO.sampleRate,
      channels: audioProbe?.audio?.channels ?? CANONICAL_AUDIO.channels,
      durationSeconds: audioProbe?.durationSeconds ?? duration,
    });
  }

  private async safeProbe(
    filePath: string,
    signal: AbortSignal,
  ): Promise<ProbeMediaResult | null> {
    try {
      return await this.processor.probe({ inputPath: filePath }, { signal });
    } catch (cause) {
      // Metadata about the artifact is a nice-to-have, not a reason to fail.
      this.logger("could not probe generated audio", cause);
      return null;
    }
  }

  /**
   * Cleanup policy: temporary files are always removed, and a cleanup failure
   * is logged rather than turning a successful job into a failed one. Nothing
   * sensitive stays behind — the same directory is removed again the next time
   * the job id is used, and the OS reclaims its temp directory.
   */
  private async cleanup(jobId: string): Promise<void> {
    try {
      await this.temporaryFiles.cleanupJob(jobId);
    } catch (cause) {
      this.logger(`temporary cleanup failed for job ${jobId}`, cause);
    }
  }
}

/** Job types that delegate to a pluggable provider rather than to FFmpeg. */
function isProviderStage(type: ProcessingJobType): boolean {
  return type === "transcribe" || type === "diarize";
}

/** Backend-generated filename: the user's filename never becomes a path. */
export function backendSourceFilename(originalFilename?: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(originalFilename ?? "");
  const extension = match ? match[1].toLowerCase() : "bin";

  return `source.${extension}`;
}

function summarize(artifact: ProcessingArtifact) {
  return {
    id: artifact.id,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    sampleRate: artifact.sampleRate,
    channels: artifact.channels,
    durationSeconds: artifact.durationSeconds,
  };
}

export type { UpdateProcessingJobInput };
