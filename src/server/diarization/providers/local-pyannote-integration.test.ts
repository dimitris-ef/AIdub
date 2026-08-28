import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import type { ProcessingArtifact } from "@/types/processing-artifact";
import type { DiarizationJobResult, ProcessingJob } from "@/types/processing-job";
import { DevelopmentDiarizationRepository } from "@/data/diarization/development-diarization-repository";
import { isCanonicalSpeakerId } from "@/lib/diarization/speaker-ids";
import {
  LocalPyannoteDiarizationProvider,
  defaultModelDirectory,
} from "@/server/diarization/providers/local-pyannote-provider";
import { createDiarizationProviderRegistry } from "@/server/diarization/speaker-diarization-provider-registry";
import { DiarizationService } from "@/server/diarization/diarization-service";
import type { StageRunContext } from "@/server/processing/processing-service";

/**
 * Real diarization with the local self-hosted models.
 *
 * Runs the actual pyannote segmentation and speaker-embedding models over a
 * real multi-speaker recording — no mocks. Both the models and the fixture
 * come from `npm run setup:diarization` and are never committed; when either
 * is missing these tests are skipped, and a skip is reported as a skip, never
 * as a pass.
 */

const modelDirectory = defaultModelDirectory();
const speakersFixture =
  process.env.AIDUB_DIARIZATION_TEST_AUDIO ??
  path.join(modelDirectory, "..", "fixtures", "speakers.wav");

const modelsPresent = [
  path.join(modelDirectory, "segmentation.onnx"),
  path.join(modelDirectory, "embedding.onnx"),
].every((file) => existsSync(file));
const fixturePresent = existsSync(speakersFixture);

if (!modelsPresent || !fixturePresent) {
  console.warn(
    `[aidub tests] Skipping local diarization integration: models=${modelsPresent}, fixture=${fixturePresent}. Run "npm run setup:diarization".`,
  );
}

/** The fixture is a ~57 s recording with several distinct speakers. */
const FIXTURE_DURATION_SECONDS = 57;

const artifact: ProcessingArtifact = {
  id: "artifact-real",
  projectId: "project-1",
  sourceMediaId: "media-1",
  jobId: "job-real",
  type: "extracted_audio",
  filename: "extracted-audio.wav",
  mimeType: "audio/wav",
  sizeBytes: 1_819_586,
  sampleRate: 16_000,
  channels: 1,
  durationSeconds: FIXTURE_DURATION_SECONDS,
  createdAt: "2026-08-26T10:00:00.000Z",
};

const job: ProcessingJob = {
  id: "job-real",
  projectId: "project-1",
  sourceMediaId: "media-1",
  type: "diarize",
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
  providerId: "local-pyannote",
  languageHint: null,
  audioArtifactId: null,
  parameters: null,
};

describe.skipIf(!modelsPresent || !fixturePresent)(
  "local pyannote diarization provider (real models)",
  () => {
    let provider: LocalPyannoteDiarizationProvider;

    beforeAll(() => {
      provider = new LocalPyannoteDiarizationProvider();
    });

    it("reports itself available when the runtime and models are present", async () => {
      await expect(provider.isAvailable()).resolves.toBe(true);
    });

    it("finds several speakers in real multi-speaker audio", async () => {
      const stages: string[] = [];
      const result = await provider.diarize(
        {
          projectId: "project-1",
          sourceMediaId: "media-1",
          audioArtifactId: artifact.id,
          audio: {
            path: speakersFixture,
            mimeType: "audio/wav",
            durationSeconds: FIXTURE_DURATION_SECONDS,
          },
        },
        {
          onProgress: ({ stage }) => {
            if (stage) stages.push(stage);
          },
        },
      );

      expect(result.provider.id).toBe("local-pyannote");
      expect(stages).toContain("Analysing speaker turns");
      expect(result.regions.length).toBeGreaterThan(0);

      // The recording holds a conversation, so more than one voice must be
      // separated — a single cluster would mean diarization did nothing.
      const labels = new Set(result.regions.map((region) => region.speakerLabel));
      expect(labels.size).toBeGreaterThan(1);

      for (const region of result.regions) {
        expect(region.startTime).toBeGreaterThanOrEqual(0);
        expect(region.endTime).toBeGreaterThan(region.startTime);
        expect(region.endTime).toBeLessThanOrEqual(
          FIXTURE_DURATION_SECONDS + 1,
        );
        // Clustering distances are not calibrated; nothing is invented.
        expect(region.confidence).toBeNull();
      }
    }, 300_000);

    it("frees the caller on cancellation without taking the process down", async () => {
      const controller = new AbortController();
      const running = provider.diarize(
        {
          projectId: "project-1",
          sourceMediaId: "media-1",
          audioArtifactId: artifact.id,
          audio: {
            path: speakersFixture,
            mimeType: "audio/wav",
            durationSeconds: FIXTURE_DURATION_SECONDS,
          },
        },
        { signal: controller.signal },
      );

      controller.abort();

      await expect(running).rejects.toMatchObject({
        code: "DIARIZATION_CANCELLED",
      });

      // The abandoned analysis must not kill this process: a run started after
      // a cancellation still succeeds.
      const after = await provider.diarize({
        projectId: "project-1",
        sourceMediaId: "media-1",
        audioArtifactId: artifact.id,
        audio: {
          path: speakersFixture,
          mimeType: "audio/wav",
          durationSeconds: FIXTURE_DURATION_SECONDS,
        },
      });

      expect(after.regions.length).toBeGreaterThan(0);
    }, 300_000);

    it("runs end to end through the diarization service and persists", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "aidub-real-diar-"));
      const diarizations = new DevelopmentDiarizationRepository(root);
      const service = new DiarizationService({
        registry: createDiarizationProviderRegistry([provider], provider.id),
        diarizations,
        logger: () => {},
      });

      const context: StageRunContext = {
        job,
        signal: new AbortController().signal,
        ensureAudio: async () => ({
          artifact,
          path: speakersFixture,
          mimeType: "audio/wav",
          durationSeconds: FIXTURE_DURATION_SECONDS,
        }),
        onProgress: () => {},
      };

      const result = (await service.run(context)) as DiarizationJobResult;

      expect(result.kind).toBe("diarize");
      expect(result.speakerCount).toBeGreaterThan(1);
      expect(result.regionCount).toBeGreaterThan(0);
      expect(result.providerId).toBe("local-pyannote");

      const saved = await diarizations.getByProjectAndSource(
        "project-1",
        "media-1",
      );

      expect(saved).toMatchObject({
        id: result.diarizationId,
        projectId: "project-1",
        sourceMediaId: "media-1",
        audioArtifactId: artifact.id,
        status: "completed",
      });
      expect(saved?.speakers.length).toBe(result.speakerCount);
      expect(saved?.regions.length).toBe(result.regionCount);

      // Provider cluster numbers were replaced by canonical ids, assigned by
      // first appearance — the first region belongs to speaker_1.
      expect(saved?.speakers.map((speaker) => speaker.id)).toEqual(
        saved?.speakers.map((_, index) => `speaker_${index + 1}`),
      );
      expect(
        saved?.speakers.every((speaker) => isCanonicalSpeakerId(speaker.id)),
      ).toBe(true);
      expect(saved?.regions[0].speakerId).toBe("speaker_1");
      expect(
        saved?.regions.every(
          (region) =>
            typeof region.id === "string" &&
            region.id.length > 0 &&
            Number.isFinite(region.startTime) &&
            Number.isFinite(region.endTime),
        ),
      ).toBe(true);

      // Regions come back in timeline order.
      const starts = saved!.regions.map((region) => region.startTime);
      expect([...starts].sort((a, b) => a - b)).toEqual(starts);

      // The raw model labels survive only as debugging metadata.
      expect(saved?.speakers[0].providerMetadata).toMatchObject({
        rawSpeakerLabel: expect.any(String),
      });
    }, 300_000);
  },
);
