import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import type { ProcessingArtifact } from "@/types/processing-artifact";
import type { ProcessingJob, TranscribeJobResult } from "@/types/processing-job";
import { DevelopmentTranscriptRepository } from "@/data/transcripts/development-transcript-repository";
import {
  LocalWhisperSpeechToTextProvider,
  defaultModelDirectory,
} from "@/server/transcription/providers/local-whisper-provider";
import { createProviderRegistry } from "@/server/transcription/speech-to-text-provider-registry";
import { TranscriptionService } from "@/server/transcription/transcription-service";
import type { StageRunContext } from "@/server/processing/processing-service";

/**
 * Real transcription with the local self-hosted model.
 *
 * Runs the actual Whisper model over a real speech recording — no mocks. Both
 * the model files and the speech fixture come from `npm run setup:stt` and are
 * never committed; when either is missing these tests are skipped, and a skip
 * is reported as a skip, never as a pass.
 */

const modelDirectory = defaultModelDirectory();
const speechFixture =
  process.env.AIDUB_STT_TEST_AUDIO ??
  path.join(modelDirectory, "..", "fixtures", "speech.wav");

const modelsPresent = [
  path.join(modelDirectory, "whisper", "encoder.onnx"),
  path.join(modelDirectory, "whisper", "decoder.onnx"),
  path.join(modelDirectory, "whisper", "tokens.txt"),
  path.join(modelDirectory, "silero_vad.onnx"),
].every((file) => existsSync(file));
const fixturePresent = existsSync(speechFixture);

if (!modelsPresent || !fixturePresent) {
  console.warn(
    `[aidub tests] Skipping local speech-to-text integration: models=${modelsPresent}, fixture=${fixturePresent}. Run "npm run setup:stt".`,
  );
}

const artifact: ProcessingArtifact = {
  id: "artifact-real",
  projectId: "project-1",
  sourceMediaId: "media-1",
  jobId: "job-real",
  type: "extracted_audio",
  filename: "extracted-audio.wav",
  mimeType: "audio/wav",
  sizeBytes: 352_078,
  sampleRate: 16_000,
  channels: 1,
  durationSeconds: 11,
  createdAt: "2026-08-26T10:00:00.000Z",
};

const job: ProcessingJob = {
  id: "job-real",
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
  providerId: "local-whisper",
  languageHint: "en",
  audioArtifactId: null,
  parameters: null,
};

describe.skipIf(!modelsPresent || !fixturePresent)(
  "local Whisper provider (real model)",
  () => {
    let provider: LocalWhisperSpeechToTextProvider;

    beforeAll(() => {
      provider = new LocalWhisperSpeechToTextProvider();
    });

    it("reports itself available when the runtime and models are present", async () => {
      await expect(provider.isAvailable()).resolves.toBe(true);
    });

    it("transcribes real speech into timestamped segments", async () => {
      const stages: string[] = [];
      const result = await provider.transcribe(
        {
          projectId: "project-1",
          sourceMediaId: "media-1",
          audioArtifactId: artifact.id,
          audio: {
            path: speechFixture,
            mimeType: "audio/wav",
            durationSeconds: 11,
          },
        },
        {
          onProgress: ({ stage }) => {
            if (stage) stages.push(stage);
          },
        },
      );

      expect(result.provider.id).toBe("local-whisper");
      expect(result.segments.length).toBeGreaterThan(0);
      expect(stages).toContain("Recognising speech");

      for (const segment of result.segments) {
        expect(segment.startTime).toBeGreaterThanOrEqual(0);
        expect(segment.endTime).toBeGreaterThanOrEqual(segment.startTime);
        expect(segment.endTime).toBeLessThanOrEqual(12);
        expect(segment.text.trim().length).toBeGreaterThan(0);
        // Whisper reports no calibrated confidence — it must not be invented.
        expect(segment.confidence).toBeNull();
        expect(segment.metadata).toMatchObject({ model: expect.any(String) });
      }

      // The fixture is the well-known JFK line; check recognisable content
      // without demanding an exact transcription from a tiny model.
      const transcriptText = result.segments
        .map((segment) => segment.text)
        .join(" ")
        .toLowerCase();

      expect(transcriptText).toContain("country");
    }, 120_000);

    it("runs end to end through the transcription service and persists", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "aidub-real-stt-"));
      const transcripts = new DevelopmentTranscriptRepository(root);
      const service = new TranscriptionService({
        registry: createProviderRegistry([provider], provider.id),
        transcripts,
        logger: () => {},
      });

      const context: StageRunContext = {
        job,
        signal: new AbortController().signal,
        ensureAudio: async () => ({
          artifact,
          path: speechFixture,
          mimeType: "audio/wav",
          durationSeconds: 11,
        }),
        onProgress: () => {},
      };

      const result = (await service.run(context)) as TranscribeJobResult;

      expect(result.kind).toBe("transcribe");
      expect(result.segmentCount).toBeGreaterThan(0);
      expect(result.providerId).toBe("local-whisper");

      const saved = await transcripts.getByProject("project-1", "media-1");

      expect(saved).toMatchObject({
        id: result.transcriptId,
        projectId: "project-1",
        sourceMediaId: "media-1",
        audioArtifactId: artifact.id,
        status: "completed",
      });
      expect(saved?.segments.length).toBe(result.segmentCount);
      expect(
        saved?.segments.every(
          (segment) =>
            typeof segment.id === "string" &&
            segment.id.length > 0 &&
            Number.isFinite(segment.startTime) &&
            Number.isFinite(segment.endTime),
        ),
      ).toBe(true);

      // Segments come back in timeline order.
      const starts = saved!.segments.map((segment) => segment.startTime);
      expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    }, 120_000);
  },
);
