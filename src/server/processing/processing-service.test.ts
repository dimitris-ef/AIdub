import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ExtractedAudioSummary,
  ProbeMediaResult,
} from "@/types/processing-job";
import { InMemoryProcessingJobRepository } from "@/server/processing/development-job-repository";
import { ProcessingError } from "@/server/processing/processing-errors";
import {
  ProcessingService,
  backendSourceFilename,
} from "@/server/processing/processing-service";
import { LocalTemporaryFileManager } from "@/server/processing/temporary-file-manager";
import { UploadedProcessingMediaSource } from "@/server/processing/processing-media-source";
import { DevelopmentArtifactStorage } from "@/server/artifacts/development-artifact-storage";
import type {
  ConvertMediaInput,
  ConvertMediaResult,
  ExtractAudioInput,
  ExtractAudioResult,
  MediaProcessor,
  ProbeMediaInput,
  ProcessingContext,
} from "@/server/processing/media-processor";

const PROBE_WITH_AUDIO: ProbeMediaResult = {
  durationSeconds: 12,
  container: "mov,mp4,m4a",
  sizeBytes: 1000,
  video: { codec: "h264", width: 640, height: 360, frameRate: 25 },
  audio: { codec: "aac", sampleRate: 48000, channels: 2 },
};

const PROBE_WITHOUT_AUDIO: ProbeMediaResult = {
  ...PROBE_WITH_AUDIO,
  audio: null,
};

/** Scriptable processor: no FFmpeg, no child processes. */
class FakeMediaProcessor implements MediaProcessor {
  probeResult: ProbeMediaResult = PROBE_WITH_AUDIO;
  probeCalls = 0;
  probeError: Error | null = null;
  extractError: Error | null = null;
  /** Resolves only when released, so cancellation can be exercised. */
  holdExtraction = false;
  releaseExtraction: (() => void) | null = null;
  capabilities = {
    ffmpegAvailable: true,
    ffprobeAvailable: true,
    ffmpegVersion: "fake",
    ffprobeVersion: "fake",
  };
  extractCalls: ExtractAudioInput[] = [];
  convertCalls: ConvertMediaInput[] = [];

  async getCapabilities() {
    return this.capabilities;
  }

  async probe(input: ProbeMediaInput): Promise<ProbeMediaResult> {
    this.probeCalls += 1;

    if (this.probeError) {
      throw this.probeError;
    }
    // Generated WAVs report the canonical audio format.
    if (input.inputPath.endsWith(".wav")) {
      return {
        ...PROBE_WITH_AUDIO,
        video: null,
        audio: { codec: "pcm_s16le", sampleRate: 16000, channels: 1 },
      };
    }

    return this.probeResult;
  }

  async extractAudio(
    input: ExtractAudioInput,
    context: ProcessingContext = {},
  ): Promise<ExtractAudioResult> {
    this.extractCalls.push(input);

    if (this.extractError) {
      throw this.extractError;
    }

    context.onProgress?.(50);

    if (this.holdExtraction) {
      await new Promise<void>((resolve, reject) => {
        this.releaseExtraction = resolve;
        context.signal?.addEventListener("abort", () =>
          reject(new ProcessingError("CANCELLED", "The job was cancelled.")),
        );
      });
    }

    await writeFile(input.outputPath, Buffer.alloc(2048, 1));

    return {
      outputPath: input.outputPath,
      sampleRate: input.sampleRate ?? 16000,
      channels: input.channels ?? 1,
      sizeBytes: 2048,
      durationSeconds: input.durationSeconds ?? null,
    };
  }

  async convert(
    input: ConvertMediaInput,
    context: ProcessingContext = {},
  ): Promise<ConvertMediaResult> {
    this.convertCalls.push(input);
    context.onProgress?.(50);
    await writeFile(input.outputPath, Buffer.alloc(1024, 2));

    return { outputPath: input.outputPath, sizeBytes: 1024 };
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

const sourceBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

function createHarness(
  root: string,
  options: Partial<ConstructorParameters<typeof ProcessingService>[0]> = {},
) {
  const processor = new FakeMediaProcessor();
  const temporaryFiles = new LocalTemporaryFileManager(root);
  const artifacts = new DevelopmentArtifactStorage(
    path.join(root, "artifacts"),
  );
  const repository = new InMemoryProcessingJobRepository();
  const service = new ProcessingService({
    repository,
    processor,
    temporaryFiles,
    artifacts,
    mediaSource: new UploadedProcessingMediaSource(),
    logger: () => {},
    ...options,
  });

  return { processor, temporaryFiles, artifacts, repository, service, root };
}

describe("ProcessingService", () => {
  let root: string;
  let harness: ReturnType<typeof createHarness>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aidub-test-"));
    harness = createHarness(root);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const request = (overrides: Record<string, unknown> = {}) => ({
    projectId: "project-1",
    sourceMediaId: "media-1",
    type: "probe_media",
    uploadedSource: { bytes: sourceBytes, filename: "clip.mp4" },
    ...overrides,
  });

  describe("validation", () => {
    it("rejects an unsupported job type", async () => {
      await expect(
        harness.service.createJob(request({ type: "render_dub" })),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_JOB_TYPE" });
    });

    it("fails a translate job when no translation runner is wired in", async () => {
      const job = await harness.service.createJob(
        request({
          type: "translate",
          uploadedSource: undefined,
          parameters: {
            kind: "translate",
            dialogueId: "dialogue-1",
            dialogueRevision: 0,
            sourceLanguage: "en",
            targetLanguage: "pl",
          },
        }),
      );
      const finished = await harness.service.runJob(job.id, undefined);

      expect(finished).toMatchObject({
        status: "failed",
        error: { code: "TRANSLATION_PROVIDER_UNAVAILABLE" },
      });
    });

    it("fails a transcribe job when no transcription runner is wired in", async () => {
      const job = await harness.service.createJob(
        request({ type: "transcribe" }),
      );
      const finished = await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });

      expect(finished).toMatchObject({
        status: "failed",
        error: { code: "STT_PROVIDER_UNAVAILABLE" },
      });
    });

    it("fails a diarize job when no diarization runner is wired in", async () => {
      const job = await harness.service.createJob(request({ type: "diarize" }));
      const finished = await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });

      expect(finished).toMatchObject({
        status: "failed",
        error: { code: "DIARIZATION_PROVIDER_UNAVAILABLE" },
      });
    });

    it("rejects unsafe or empty identifiers", async () => {
      await expect(
        harness.service.createJob(request({ projectId: "../etc/passwd" })),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await expect(
        harness.service.createJob(request({ sourceMediaId: "" })),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    });

    it("rejects a request with no source bytes", async () => {
      await expect(
        harness.service.createJob(request({ uploadedSource: undefined })),
      ).rejects.toMatchObject({ code: "SOURCE_MEDIA_NOT_FOUND" });
      await expect(
        harness.service.createJob(
          request({
            uploadedSource: { bytes: new Uint8Array(), filename: "x.mp4" },
          }),
        ),
      ).rejects.toMatchObject({ code: "SOURCE_MEDIA_NOT_FOUND" });
    });

    it("accepts a translate job with no source bytes at all", async () => {
      // Translation reads the stored dialogue, so requiring an upload would
      // mean shipping a whole video across the network to translate text.
      const job = await harness.service.createJob(
        request({
          type: "translate",
          uploadedSource: undefined,
          parameters: {
            kind: "translate",
            dialogueId: "dialogue-1",
            dialogueRevision: 3,
            sourceLanguage: "en",
            targetLanguage: "pl",
          },
        }),
      );

      expect(job.status).toBe("queued");
      expect(job.parameters).toMatchObject({
        kind: "translate",
        dialogueRevision: 3,
      });
    });

    it("rejects a translate job created without translation parameters", async () => {
      await expect(
        harness.service.createJob(
          request({ type: "translate", uploadedSource: undefined }),
        ),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    });
  });

  describe("media-free stages", () => {
    it("runs a translate job without materialising or probing the source", async () => {
      const runner = {
        run: vi.fn(async () => ({
          kind: "translate" as const,
          translationId: "translation-1",
          dialogueId: "dialogue-1",
          dialogueRevision: 3,
          segmentCount: 2,
          sourceLanguage: "en",
          targetLanguage: "pl",
          providerId: "mock",
          providerModel: "deterministic-v1",
        })),
      };
      const local = createHarness(root, { translation: runner });

      const created = await local.service.createJob(
        request({
          type: "translate",
          uploadedSource: undefined,
          parameters: {
            kind: "translate",
            dialogueId: "dialogue-1",
            dialogueRevision: 3,
            sourceLanguage: "en",
            targetLanguage: "pl",
          },
        }),
      );
      const finished = await local.service.runJob(created.id, undefined);

      expect(finished.status).toBe("completed");
      expect(finished.result).toMatchObject({ kind: "translate" });
      // No FFmpeg ran: the stage never touched the media at all.
      expect(local.processor.probeCalls).toBe(0);
      expect(local.processor.extractCalls).toHaveLength(0);
    });

    it("gives a media-free stage no way to reach for audio", async () => {
      let audioError: unknown;
      const runner = {
        run: vi.fn(async (context: { ensureAudio: () => unknown }) => {
          try {
            context.ensureAudio();
          } catch (cause) {
            audioError = cause;
          }

          return null;
        }),
      };
      const service = createHarness(root, { translation: runner }).service;

      const created = await service.createJob(
        request({
          type: "translate",
          uploadedSource: undefined,
          parameters: {
            kind: "translate",
            dialogueId: "dialogue-1",
            dialogueRevision: 0,
            sourceLanguage: "en",
            targetLanguage: "pl",
          },
        }),
      );
      await service.runJob(created.id, undefined);

      expect(audioError).toBeInstanceOf(ProcessingError);
    });
  });

  describe("probe job", () => {
    it("runs queued → processing → completed and returns metadata", async () => {
      const created = await harness.service.createJob(request());
      expect(created.status).toBe("queued");
      expect(created.progress).toBe(0);

      const finished = await harness.service.runJob(created.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });

      expect(finished).toMatchObject({
        status: "completed",
        progress: 100,
        error: null,
        result: { kind: "probe_media", metadata: PROBE_WITH_AUDIO },
      });
      expect(finished.startedAt).not.toBeNull();
      expect(finished.completedAt).not.toBeNull();
    });

    it("removes the job's temporary directory afterwards", async () => {
      const job = await harness.service.createJob(request());
      await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });

      await expect(
        exists(path.join(root, "jobs", job.id)),
      ).resolves.toBe(false);
    });

    it("fails with a structured error when probing fails", async () => {
      harness.processor.probeError = new ProcessingError(
        "PROBE_FAILED",
        "The source media could not be inspected.",
      );

      const job = await harness.service.createJob(request());
      const finished = await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });

      expect(finished).toMatchObject({
        status: "failed",
        error: { code: "PROBE_FAILED" },
        result: null,
      });
      await expect(exists(path.join(root, "jobs", job.id))).resolves.toBe(false);
    });

    it("never leaks internal details for an unexpected error", async () => {
      harness.processor.probeError = new TypeError("x.y is not a function");

      const job = await harness.service.createJob(request());
      const finished = await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });

      expect(finished.error).toEqual({
        code: "INTERNAL_ERROR",
        message: "Processing failed unexpectedly. Please try again.",
      });
    });
  });

  describe("extract audio job", () => {
    const extractRequest = () => request({ type: "extract_audio" });

    it("produces a canonical WAV artifact and completes", async () => {
      const job = await harness.service.createJob(extractRequest());
      const finished = await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });

      expect(finished.status).toBe("completed");
      expect(finished.progress).toBe(100);
      expect(finished.result).toMatchObject({
        kind: "extract_audio",
        artifact: {
          filename: "extracted-audio.wav",
          mimeType: "audio/wav",
          sampleRate: 16000,
          channels: 1,
        },
      });

      // Extraction was asked for mono 16 kHz, with the probed duration for
      // progress.
      expect(harness.processor.extractCalls[0]).toMatchObject({
        sampleRate: 16000,
        channels: 1,
        durationSeconds: 12,
      });
    });

    it("stores the artifact outside the job directory so it survives cleanup", async () => {
      const job = await harness.service.createJob(extractRequest());
      const finished = await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });

      const artifactId = (
        finished.result as { artifact: ExtractedAudioSummary }
      ).artifact.id;
      const stored = await harness.service.getArtifact(artifactId, "project-1");

      expect(stored?.bytes.byteLength).toBe(2048);
      await expect(exists(path.join(root, "jobs", job.id))).resolves.toBe(false);
    });

    it("reports progress while running", async () => {
      const job = await harness.service.createJob(extractRequest());
      const seen: number[] = [];
      const originalUpdate = harness.repository.update.bind(harness.repository);

      vi.spyOn(harness.repository, "update").mockImplementation(
        async (id, input) => {
          if (typeof input.progress === "number") {
            seen.push(input.progress);
          }
          return originalUpdate(id, input);
        },
      );

      await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });

      expect(seen).toContain(50);
    });

    it("fails clearly when the source has no audio track", async () => {
      harness.processor.probeResult = PROBE_WITHOUT_AUDIO;

      const job = await harness.service.createJob(extractRequest());
      const finished = await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });

      expect(finished).toMatchObject({
        status: "failed",
        error: {
          code: "NO_AUDIO_STREAM",
          message: "No audio track was found in this source video.",
        },
      });
      // No output file was created and nothing was stored.
      expect(harness.processor.extractCalls).toHaveLength(0);
      await expect(exists(path.join(root, "jobs", job.id))).resolves.toBe(false);
    });

    it("cleans up after an extraction failure", async () => {
      harness.processor.extractError = new ProcessingError(
        "AUDIO_EXTRACTION_FAILED",
        "Audio extraction failed.",
      );

      const job = await harness.service.createJob(extractRequest());
      const finished = await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });

      expect(finished.error?.code).toBe("AUDIO_EXTRACTION_FAILED");
      await expect(exists(path.join(root, "jobs", job.id))).resolves.toBe(false);
    });
  });

  describe("convert job", () => {
    it("normalises audio through the conversion primitive", async () => {
      const job = await harness.service.createJob(
        request({ type: "convert_media" }),
      );
      const finished = await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });

      expect(finished.status).toBe("completed");
      expect(harness.processor.convertCalls[0]).toMatchObject({
        audio: { codec: "pcm_s16le", sampleRate: 16000, channels: 1 },
      });
      expect(finished.result).toMatchObject({
        kind: "convert_media",
        artifact: { filename: "converted-audio.wav" },
      });
    });
  });

  describe("cancellation", () => {
    it("cancels a queued job without running it", async () => {
      const job = await harness.service.createJob(request());

      const cancelled = await harness.service.cancelJob(job.id, "project-1");
      expect(cancelled?.status).toBe("cancelled");

      // A run request after cancellation is a no-op.
      const after = await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });
      expect(after.status).toBe("cancelled");
      expect(harness.processor.extractCalls).toHaveLength(0);
    });

    it("stops a running job, marks it cancelled and cleans up", async () => {
      harness.processor.holdExtraction = true;

      const job = await harness.service.createJob(
        request({ type: "extract_audio" }),
      );
      const running = harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });

      // Wait until the processor is actually inside extraction.
      await vi.waitFor(() =>
        expect(harness.processor.releaseExtraction).not.toBeNull(),
      );

      await harness.service.cancelJob(job.id, "project-1");
      const finished = await running;

      expect(finished.status).toBe("cancelled");
      expect(finished.error).toBeNull();
      await expect(exists(path.join(root, "jobs", job.id))).resolves.toBe(false);
    });

    it("leaves a completed job untouched", async () => {
      const job = await harness.service.createJob(request());
      await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });

      const cancelled = await harness.service.cancelJob(job.id, "project-1");

      expect(cancelled?.status).toBe("completed");
    });
  });

  describe("project isolation", () => {
    it("hides a job from other projects", async () => {
      const job = await harness.service.createJob(request());

      await expect(
        harness.service.getJob(job.id, "project-2"),
      ).resolves.toBeNull();
      await expect(
        harness.service.cancelJob(job.id, "project-2"),
      ).resolves.toBeNull();
      await expect(
        harness.service.getJob(job.id, "project-1"),
      ).resolves.toMatchObject({ id: job.id });
    });

    it("lists only the requested project's jobs, filtered by media", async () => {
      await harness.service.createJob(request());
      await harness.service.createJob(request({ sourceMediaId: "media-2" }));
      await harness.service.createJob(request({ projectId: "project-2" }));

      await expect(
        harness.service.listJobs("project-1"),
      ).resolves.toHaveLength(2);
      await expect(
        harness.service.listJobs("project-1", "media-1"),
      ).resolves.toMatchObject([{ sourceMediaId: "media-1" }]);
      await expect(
        harness.service.listJobs("project-2"),
      ).resolves.toHaveLength(1);
    });

    it("refuses to hand an artifact to another project", async () => {
      const job = await harness.service.createJob(
        request({ type: "extract_audio" }),
      );
      const finished = await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });
      const artifactId = (
        finished.result as { artifact: ExtractedAudioSummary }
      ).artifact.id;

      await expect(
        harness.service.getArtifact(artifactId, "project-2"),
      ).resolves.toBeNull();
    });
  });

  describe("cancelAndPurge", () => {
    it("drops artifacts for one source media and keeps job history", async () => {
      const job = await harness.service.createJob(
        request({ type: "extract_audio" }),
      );
      const finished = await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });
      const artifactId = (
        finished.result as { artifact: ExtractedAudioSummary }
      ).artifact.id;

      await harness.service.cancelAndPurge("project-1", "media-1");

      await expect(
        harness.service.getArtifact(artifactId, "project-1"),
      ).resolves.toBeNull();
      await expect(
        harness.service.listJobs("project-1", "media-1"),
      ).resolves.toHaveLength(1);
    });

    it("removes jobs and artifacts when a whole project goes away", async () => {
      const job = await harness.service.createJob(
        request({ type: "extract_audio" }),
      );
      await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });
      await harness.service.createJob(request({ projectId: "project-2" }));

      await harness.service.cancelAndPurge("project-1");

      await expect(harness.service.listJobs("project-1")).resolves.toEqual([]);
      await expect(
        harness.service.listJobs("project-2"),
      ).resolves.toHaveLength(1);
    });

    it("cancels active jobs for the purged scope", async () => {
      harness.processor.holdExtraction = true;
      const job = await harness.service.createJob(
        request({ type: "extract_audio" }),
      );
      const running = harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "clip.mp4",
      });

      await vi.waitFor(() =>
        expect(harness.processor.releaseExtraction).not.toBeNull(),
      );
      const cancelled = await harness.service.cancelAndPurge(
        "project-1",
        "media-1",
      );

      expect(cancelled).toBe(1);
      await expect(running).resolves.toMatchObject({ status: "cancelled" });
    });
  });

  describe("source materialisation", () => {
    it("writes the uploaded bytes into the job workspace", async () => {
      let capturedPath = "";
      harness.processor.probeError = null;
      vi.spyOn(harness.processor, "probe").mockImplementation(async (input) => {
        capturedPath = input.inputPath;
        return PROBE_WITH_AUDIO;
      });

      const job = await harness.service.createJob(request());
      await harness.service.runJob(job.id, {
        bytes: sourceBytes,
        filename: "holiday clip.MP4",
      });

      // Backend-generated name inside the job directory — never the user's.
      expect(path.basename(capturedPath)).toBe("source.mp4");
      expect(capturedPath.startsWith(path.join(root, "jobs", job.id))).toBe(
        true,
      );
    });
  });
});

describe("backendSourceFilename", () => {
  it("keeps only a safe extension from the original name", () => {
    expect(backendSourceFilename("holiday clip.MP4")).toBe("source.mp4");
    expect(backendSourceFilename("movie.webm")).toBe("source.webm");
  });

  it("never lets a user filename become a path", () => {
    expect(backendSourceFilename("../../etc/passwd")).toBe("source.bin");
    expect(backendSourceFilename("weird;name")).toBe("source.bin");
    expect(backendSourceFilename(undefined)).toBe("source.bin");
  });
});

describe("UploadedProcessingMediaSource", () => {
  it("writes bytes to the target path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aidub-source-"));
    const target = path.join(root, "source.mp4");

    await new UploadedProcessingMediaSource().materializeSource({
      projectId: "p",
      sourceMediaId: "m",
      targetPath: target,
      uploadedSource: { bytes: sourceBytes, filename: "clip.mp4" },
    });

    await expect(readFile(target)).resolves.toHaveLength(sourceBytes.length);
  });

  it("fails when no bytes were provided", async () => {
    await expect(
      new UploadedProcessingMediaSource().materializeSource({
        projectId: "p",
        sourceMediaId: "m",
        targetPath: "/tmp/does-not-matter",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_MEDIA_NOT_FOUND" });
  });
});
