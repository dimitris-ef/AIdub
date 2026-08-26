import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProcessingArtifact } from "@/types/processing-artifact";
import type { ProcessingJob, TranscribeJobResult } from "@/types/processing-job";
import { DevelopmentTranscriptRepository } from "@/data/transcripts/development-transcript-repository";
import { ProcessingError } from "@/server/processing/processing-errors";
import type { StageRunContext } from "@/server/processing/processing-service";
import { MockSpeechToTextProvider } from "@/server/transcription/providers/mock-provider";
import { createProviderRegistry } from "@/server/transcription/speech-to-text-provider-registry";
import { TranscriptionService } from "@/server/transcription/transcription-service";
import { transcriptionError } from "@/server/transcription/transcription-errors";
import type {
  SpeechToTextProvider,
  SpeechToTextResult,
} from "@/server/transcription/speech-to-text-provider";

const artifact: ProcessingArtifact = {
  id: "artifact-1",
  projectId: "project-1",
  sourceMediaId: "media-1",
  jobId: "job-1",
  type: "extracted_audio",
  filename: "extracted-audio.wav",
  mimeType: "audio/wav",
  sizeBytes: 96_078,
  sampleRate: 16_000,
  channels: 1,
  durationSeconds: 11,
  createdAt: "2026-08-26T10:00:00.000Z",
};

function job(overrides: Partial<ProcessingJob> = {}): ProcessingJob {
  return {
    id: "job-1",
    projectId: "project-1",
    sourceMediaId: "media-1",
    type: "transcribe",
    status: "processing",
    progress: 1,
    indeterminate: false,
    stage: null,
    createdAt: "2026-08-26T10:00:00.000Z",
    updatedAt: "2026-08-26T10:00:00.000Z",
    startedAt: "2026-08-26T10:00:00.000Z",
    completedAt: null,
    error: null,
    result: null,
    providerId: "mock",
    languageHint: "en",
    audioArtifactId: null,
    ...overrides,
  };
}

function createHarness(
  root: string,
  provider: SpeechToTextProvider = new MockSpeechToTextProvider(),
) {
  const transcripts = new DevelopmentTranscriptRepository(root);
  let idCounter = 0;
  const service = new TranscriptionService({
    registry: createProviderRegistry([provider], provider.id),
    transcripts,
    createId: () => `id-${++idCounter}`,
    now: () => new Date("2026-08-26T10:05:00.000Z"),
    logger: () => {},
    timeoutMs: 5_000,
  });

  const progress: { progress: number; stage?: string }[] = [];
  const ensureAudio = vi.fn(async () => ({
    artifact,
    path: path.join(root, "audio.wav"),
    mimeType: "audio/wav",
    durationSeconds: 11,
  }));

  const context = (overrides: Partial<StageRunContext> = {}): StageRunContext => ({
    job: job({ providerId: provider.id }),
    signal: new AbortController().signal,
    ensureAudio,
    onProgress: (value, stage) => progress.push({ progress: value, stage }),
    ...overrides,
  });

  return { service, transcripts, ensureAudio, progress, context };
}

describe("TranscriptionService", () => {
  let root: string;
  let harness: ReturnType<typeof createHarness>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aidub-transcription-"));
    harness = createHarness(root);
  });

  describe("successful transcription", () => {
    it("persists a transcript tied to the project, source media and audio artifact", async () => {
      const result = (await harness.service.run(
        harness.context(),
      )) as TranscribeJobResult;

      expect(result).toMatchObject({
        kind: "transcribe",
        segmentCount: 2,
        providerId: "mock",
        providerModel: "mock-1",
      });

      const saved = await harness.transcripts.getByProject(
        "project-1",
        "media-1",
      );

      expect(saved).toMatchObject({
        id: result.transcriptId,
        projectId: "project-1",
        sourceMediaId: "media-1",
        audioArtifactId: "artifact-1",
        providerId: "mock",
        status: "completed",
      });
      expect(saved?.segments).toMatchObject([
        { startTime: 0, endTime: 1.5, originalText: "Hello world." },
        { startTime: 1.5, endTime: 3.2, originalText: "This is a test." },
      ]);
      // No speaker information exists in Part 5.
      expect(Object.keys(saved!.segments[0])).not.toContain("speakerId");
    });

    it("reuses the audio the processing layer prepared", async () => {
      await harness.service.run(harness.context());

      expect(harness.ensureAudio).toHaveBeenCalledTimes(1);
    });

    it("reports progress through preparing, transcribing and saving", async () => {
      await harness.service.run(harness.context());

      const stages = harness.progress.map((entry) => entry.stage);
      expect(stages).toContain("Preparing audio");
      expect(stages).toContain("Saving transcript");
      expect(
        harness.progress.every(
          (entry) => entry.progress >= 0 && entry.progress <= 99,
        ),
      ).toBe(true);
    });

    it("passes the language hint only to providers that accept one", async () => {
      const hinted = new MockSpeechToTextProvider();
      const spy = vi.spyOn(hinted, "transcribe");
      const withHint = createHarness(root, hinted);

      await withHint.service.run(withHint.context());

      expect(spy.mock.calls[0][0].language).toBe("en");
    });

    it("stores a valid empty transcript when no speech was found", async () => {
      const silent = new MockSpeechToTextProvider({ segments: [] });
      const quiet = createHarness(root, silent);

      const result = (await quiet.service.run(
        quiet.context(),
      )) as TranscribeJobResult;

      expect(result.segmentCount).toBe(0);
      await expect(
        quiet.transcripts.getByProject("project-1", "media-1"),
      ).resolves.toMatchObject({ status: "completed", segments: [] });
    });

    it("replaces the previous transcript only after the new one is saved", async () => {
      const first = (await harness.service.run(
        harness.context(),
      )) as TranscribeJobResult;
      const second = (await harness.service.run(
        harness.context(),
      )) as TranscribeJobResult;

      expect(second.transcriptId).not.toBe(first.transcriptId);
      await expect(
        harness.transcripts.getById(first.transcriptId),
      ).resolves.toBeNull();
      await expect(
        harness.transcripts.listByProject("project-1"),
      ).resolves.toHaveLength(1);
    });
  });

  describe("failures", () => {
    it("reports an unavailable provider without calling it", async () => {
      const unavailable = new MockSpeechToTextProvider();
      vi.spyOn(unavailable, "isAvailable").mockResolvedValue(false);
      const transcribeSpy = vi.spyOn(unavailable, "transcribe");
      const broken = createHarness(root, unavailable);

      await expect(broken.service.run(broken.context())).rejects.toMatchObject({
        code: "STT_PROVIDER_UNAVAILABLE",
      });
      expect(transcribeSpy).not.toHaveBeenCalled();
    });

    it("reports a prerequisite audio failure as an extraction failure", async () => {
      const failing = harness.context({
        ensureAudio: async () => {
          throw new ProcessingError(
            "AUDIO_EXTRACTION_FAILED",
            "Audio extraction failed.",
          );
        },
      });

      await expect(harness.service.run(failing)).rejects.toMatchObject({
        code: "AUDIO_EXTRACTION_FAILED",
        message:
          "Transcription could not start because audio extraction failed.",
      });
      await expect(
        harness.transcripts.getByProject("project-1", "media-1"),
      ).resolves.toBeNull();
    });

    it("maps a provider error to its normalised code and saves nothing", async () => {
      const failing = new MockSpeechToTextProvider({
        failWith: transcriptionError("STT_AUTHENTICATION_FAILED"),
      });
      const broken = createHarness(root, failing);

      await expect(broken.service.run(broken.context())).rejects.toMatchObject({
        code: "STT_AUTHENTICATION_FAILED",
      });
      await expect(
        broken.transcripts.getByProject("project-1", "media-1"),
      ).resolves.toBeNull();
    });

    it("maps an unexpected provider exception to a request failure", async () => {
      const failing = new MockSpeechToTextProvider({
        failWith: new TypeError("socket hang up"),
      });
      const broken = createHarness(root, failing);

      await expect(broken.service.run(broken.context())).rejects.toMatchObject({
        code: "STT_REQUEST_FAILED",
      });
    });

    it("rejects invalid provider timings and saves nothing", async () => {
      const bogus: SpeechToTextProvider = {
        id: "bogus",
        displayName: "Bogus",
        capabilities: {
          supportsLanguageHint: false,
          supportsSegmentTimestamps: true,
          supportsWordTimestamps: false,
          reportsConfidence: false,
        },
        isAvailable: async () => true,
        transcribe: async (): Promise<SpeechToTextResult> => ({
          language: null,
          segments: [
            { startTime: 5, endTime: 2, text: "backwards", confidence: null },
          ],
          provider: { id: "bogus", model: null },
        }),
      };
      const broken = createHarness(root, bogus);

      await expect(broken.service.run(broken.context())).rejects.toMatchObject({
        code: "STT_TIMESTAMP_INVALID",
      });
      await expect(
        broken.transcripts.getByProject("project-1", "media-1"),
      ).resolves.toBeNull();
    });

    it("rejects a malformed provider response", async () => {
      const malformed: SpeechToTextProvider = {
        id: "malformed",
        displayName: "Malformed",
        capabilities: {
          supportsLanguageHint: false,
          supportsSegmentTimestamps: true,
          supportsWordTimestamps: false,
          reportsConfidence: false,
        },
        isAvailable: async () => true,
        transcribe: async () =>
          ({ language: null, segments: "nope", provider: { id: "x", model: null } }) as unknown as SpeechToTextResult,
      };
      const broken = createHarness(root, malformed);

      await expect(broken.service.run(broken.context())).rejects.toMatchObject({
        code: "STT_INVALID_RESPONSE",
      });
    });

    it("reports a persistence failure instead of a completed transcription", async () => {
      vi.spyOn(harness.transcripts, "save").mockRejectedValueOnce(
        new Error("disk full"),
      );

      await expect(
        harness.service.run(harness.context()),
      ).rejects.toMatchObject({ code: "TRANSCRIPT_SAVE_FAILED" });
    });

    it("times out a provider that never finishes", async () => {
      const slow = new MockSpeechToTextProvider({ delayMs: 5_000 });
      const timing = createHarness(root, slow);
      const service = new TranscriptionService({
        registry: createProviderRegistry([slow], slow.id),
        transcripts: timing.transcripts,
        timeoutMs: 30,
        logger: () => {},
      });

      await expect(service.run(timing.context())).rejects.toMatchObject({
        code: "STT_TIMEOUT",
      });
    });
  });

  describe("cancellation", () => {
    it("aborts the provider and saves nothing", async () => {
      const slow = new MockSpeechToTextProvider({ delayMs: 2_000 });
      const cancelling = createHarness(root, slow);
      const controller = new AbortController();

      const running = cancelling.service.run(
        cancelling.context({ signal: controller.signal }),
      );

      await vi.waitFor(() =>
        expect(cancelling.ensureAudio).toHaveBeenCalledTimes(1),
      );
      controller.abort();

      await expect(running).rejects.toMatchObject({ code: "CANCELLED" });
      await expect(
        cancelling.transcripts.getByProject("project-1", "media-1"),
      ).resolves.toBeNull();
    });

    it("discards a result that arrives after cancellation", async () => {
      const controller = new AbortController();
      const late = new MockSpeechToTextProvider();
      // The provider finishes, but cancellation happened while it worked.
      vi.spyOn(late, "transcribe").mockImplementation(async () => {
        controller.abort();
        return {
          language: "en",
          segments: [
            { startTime: 0, endTime: 1, text: "too late", confidence: null },
          ],
          provider: { id: "mock", model: "mock-1" },
        };
      });
      const racing = createHarness(root, late);

      await expect(
        racing.service.run(racing.context({ signal: controller.signal })),
      ).rejects.toMatchObject({ code: "CANCELLED" });
      await expect(
        racing.transcripts.getByProject("project-1", "media-1"),
      ).resolves.toBeNull();
    });
  });
});
