import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProcessingArtifact } from "@/types/processing-artifact";
import type { DiarizationJobResult, ProcessingJob } from "@/types/processing-job";
import { DevelopmentDiarizationRepository } from "@/data/diarization/development-diarization-repository";
import { ProcessingError } from "@/server/processing/processing-errors";
import type { StageRunContext } from "@/server/processing/processing-service";
import { MockSpeakerDiarizationProvider } from "@/server/diarization/providers/mock-provider";
import { createDiarizationProviderRegistry } from "@/server/diarization/speaker-diarization-provider-registry";
import { DiarizationService } from "@/server/diarization/diarization-service";
import { diarizationError } from "@/server/diarization/diarization-errors";
import type { SpeakerDiarizationProvider } from "@/server/diarization/speaker-diarization-provider";

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
  durationSeconds: 30,
  createdAt: "2026-08-26T10:00:00.000Z",
};

function job(overrides: Partial<ProcessingJob> = {}): ProcessingJob {
  return {
    id: "job-1",
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
    providerId: "mock",
    languageHint: null,
    audioArtifactId: null,
    parameters: null,
    ...overrides,
  };
}

function createHarness(
  root: string,
  provider: SpeakerDiarizationProvider = new MockSpeakerDiarizationProvider(),
) {
  const diarizations = new DevelopmentDiarizationRepository(root);
  let idCounter = 0;
  const service = new DiarizationService({
    registry: createDiarizationProviderRegistry([provider], provider.id),
    diarizations,
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
    durationSeconds: 30,
  }));

  const context = (
    overrides: Partial<StageRunContext> = {},
  ): StageRunContext => ({
    job: job({ providerId: provider.id }),
    signal: new AbortController().signal,
    ensureAudio,
    onProgress: (value, stage) => progress.push({ progress: value, stage }),
    ...overrides,
  });

  return { service, diarizations, ensureAudio, progress, context };
}

describe("DiarizationService", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aidub-diarization-"));
  });

  it("diarizes, normalises labels and persists the result", async () => {
    const { service, diarizations, context } = createHarness(root);

    const result = (await service.run(context())) as DiarizationJobResult;

    expect(result).toMatchObject({
      kind: "diarize",
      speakerCount: 2,
      regionCount: 3,
      providerId: "mock",
      providerModel: "mock-diarizer-1",
    });

    const saved = await diarizations.getByProjectAndSource(
      "project-1",
      "media-1",
    );

    expect(saved).toMatchObject({
      id: result.diarizationId,
      projectId: "project-1",
      sourceMediaId: "media-1",
      audioArtifactId: "artifact-1",
      status: "completed",
    });
    // The mock's "B" speaks first, so it becomes speaker_1 — provider label
    // ordering never decides Aidub identity.
    expect(saved?.speakers.map((speaker) => speaker.id)).toEqual([
      "speaker_1",
      "speaker_2",
    ]);
    expect(saved?.regions.map((region) => region.speakerId)).toEqual([
      "speaker_1",
      "speaker_2",
      "speaker_1",
    ]);
    expect(saved?.regions.every((region) => region.id.length > 0)).toBe(true);
  });

  it("requests the canonical audio artifact rather than extracting its own", async () => {
    const { service, ensureAudio, context } = createHarness(root);

    await service.run(context());

    expect(ensureAudio).toHaveBeenCalledTimes(1);
  });

  it("reports progress through documented stages", async () => {
    const { service, progress, context } = createHarness(root);

    await service.run(context());

    expect(progress[0]).toEqual({ progress: 5, stage: "Preparing audio" });
    expect(progress.map((entry) => entry.stage)).toContain(
      "Analysing speaker turns",
    );
    expect(progress.at(-1)).toEqual({
      progress: 95,
      stage: "Saving speaker analysis",
    });
    // Progress never runs backwards or exceeds the in-flight ceiling.
    const values = progress.map((entry) => entry.progress);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(Math.max(...values)).toBeLessThanOrEqual(99);
  });

  it("persists a valid zero-speaker result instead of failing", async () => {
    const { service, diarizations, context } = createHarness(
      root,
      new MockSpeakerDiarizationProvider({ regions: [] }),
    );

    const result = (await service.run(context())) as DiarizationJobResult;

    expect(result.speakerCount).toBe(0);
    expect(result.regionCount).toBe(0);

    const saved = await diarizations.getByProjectAndSource(
      "project-1",
      "media-1",
    );

    expect(saved?.status).toBe("completed");
    expect(saved?.speakers).toEqual([]);
    expect(saved?.regions).toEqual([]);
  });

  it("keeps overlapping regions and marks them", async () => {
    const { service, diarizations, context } = createHarness(
      root,
      new MockSpeakerDiarizationProvider({
        regions: [
          { speakerLabel: "A", startTime: 0, endTime: 4, confidence: null },
          { speakerLabel: "B", startTime: 3, endTime: 5, confidence: null },
        ],
      }),
    );

    await service.run(context());
    const saved = await diarizations.getByProjectAndSource(
      "project-1",
      "media-1",
    );

    expect(saved?.regions).toHaveLength(2);
    expect(saved?.regions.every((region) => region.overlap)).toBe(true);
  });

  it("fails when the provider is unavailable and saves nothing", async () => {
    const { service, diarizations, context } = createHarness(
      root,
      new MockSpeakerDiarizationProvider({ available: false }),
    );

    await expect(service.run(context())).rejects.toMatchObject({
      code: "DIARIZATION_PROVIDER_UNAVAILABLE",
    });
    expect(
      await diarizations.getByProjectAndSource("project-1", "media-1"),
    ).toBeNull();
  });

  it("maps a thrown provider error to a request failure", async () => {
    const { service, diarizations, context } = createHarness(
      root,
      new MockSpeakerDiarizationProvider({ failWith: new Error("boom") }),
    );

    await expect(service.run(context())).rejects.toMatchObject({
      code: "DIARIZATION_REQUEST_FAILED",
    });
    expect(
      await diarizations.getByProjectAndSource("project-1", "media-1"),
    ).toBeNull();
  });

  it("passes a provider's own normalised error through", async () => {
    const { service, context } = createHarness(
      root,
      new MockSpeakerDiarizationProvider({
        failWith: diarizationError("DIARIZATION_UNSUPPORTED_AUDIO"),
      }),
    );

    await expect(service.run(context())).rejects.toMatchObject({
      code: "DIARIZATION_UNSUPPORTED_AUDIO",
    });
  });

  it("reports a timeout rather than a generic failure", async () => {
    const provider = new MockSpeakerDiarizationProvider({ delayMs: 5_000 });
    const diarizations = new DevelopmentDiarizationRepository(root);
    const service = new DiarizationService({
      registry: createDiarizationProviderRegistry([provider], provider.id),
      diarizations,
      logger: () => {},
      timeoutMs: 10,
    });

    await expect(
      service.run({
        job: job(),
        signal: new AbortController().signal,
        ensureAudio: async () => ({
          artifact,
          path: path.join(root, "audio.wav"),
          mimeType: "audio/wav",
          durationSeconds: 30,
        }),
        onProgress: () => {},
      }),
    ).rejects.toMatchObject({ code: "DIARIZATION_TIMEOUT" });
  });

  it("rejects invalid timestamps and saves nothing", async () => {
    const { service, diarizations, context } = createHarness(
      root,
      new MockSpeakerDiarizationProvider({
        regions: [
          { speakerLabel: "A", startTime: 5, endTime: 1, confidence: null },
        ],
      }),
    );

    await expect(service.run(context())).rejects.toMatchObject({
      code: "DIARIZATION_TIMESTAMP_INVALID",
    });
    expect(
      await diarizations.getByProjectAndSource("project-1", "media-1"),
    ).toBeNull();
  });

  it("rejects a malformed provider response", async () => {
    const provider = {
      id: "broken",
      displayName: "Broken",
      capabilities: {
        supportsKnownSpeakerCount: false,
        supportsSpeakerRange: false,
        supportsOverlappingSpeech: false,
        reportsConfidence: false,
      },
      isAvailable: async () => true,
      diarize: async () =>
        ({ regions: "not-an-array", provider: { id: "broken", model: null } }) as never,
    } satisfies SpeakerDiarizationProvider;

    const { service, context } = createHarness(root, provider);

    await expect(service.run(context())).rejects.toMatchObject({
      code: "DIARIZATION_INVALID_RESPONSE",
    });
  });

  it("fails the job when persistence fails", async () => {
    const { service, diarizations, context } = createHarness(root);
    vi.spyOn(diarizations, "save").mockRejectedValueOnce(new Error("disk full"));

    await expect(service.run(context())).rejects.toMatchObject({
      code: "DIARIZATION_SAVE_FAILED",
    });
  });

  it("reports audio failures as a diarization audio failure", async () => {
    const { service, context } = createHarness(root);

    await expect(
      service.run(
        context({
          ensureAudio: async () => {
            throw new ProcessingError("NO_AUDIO_STREAM", "no audio");
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "DIARIZATION_AUDIO_FAILED" });
  });

  it("cancels without persisting a completed result", async () => {
    const controller = new AbortController();
    const { service, diarizations, context } = createHarness(
      root,
      new MockSpeakerDiarizationProvider({ delayMs: 1_000 }),
    );

    const running = service.run(context({ signal: controller.signal }));
    controller.abort();

    await expect(running).rejects.toBeInstanceOf(ProcessingError);
    await expect(running).rejects.toMatchObject({ code: "CANCELLED" });
    expect(
      await diarizations.getByProjectAndSource("project-1", "media-1"),
    ).toBeNull();
  });

  it("discards a result that arrives after cancellation", async () => {
    const controller = new AbortController();
    const { service, diarizations, context } = createHarness(root);

    // The provider completes normally, but the job was cancelled while it ran.
    const running = service.run(
      context({
        signal: controller.signal,
        ensureAudio: async () => {
          controller.abort();
          return {
            artifact,
            path: path.join(root, "audio.wav"),
            mimeType: "audio/wav",
            durationSeconds: 30,
          };
        },
      }),
    );

    await expect(running).rejects.toMatchObject({ code: "CANCELLED" });
    expect(
      await diarizations.getByProjectAndSource("project-1", "media-1"),
    ).toBeNull();
  });

  it("replaces the previous result only after the new one is stored", async () => {
    const { service, diarizations, context } = createHarness(root);

    const first = (await service.run(context())) as DiarizationJobResult;
    const second = (await service.run(context())) as DiarizationJobResult;

    expect(second.diarizationId).not.toBe(first.diarizationId);

    const stored = await diarizations.listByProject("project-1");

    expect(stored.map((result) => result.id)).toEqual([second.diarizationId]);
  });

  it("keeps the previous result when a rerun fails", async () => {
    const { service, diarizations, context } = createHarness(root);
    const first = (await service.run(context())) as DiarizationJobResult;

    const failing = new DiarizationService({
      registry: createDiarizationProviderRegistry(
        [new MockSpeakerDiarizationProvider({ failWith: new Error("boom") })],
        "mock",
      ),
      diarizations,
      logger: () => {},
    });

    await expect(failing.run(context())).rejects.toMatchObject({
      code: "DIARIZATION_REQUEST_FAILED",
    });

    const active = await diarizations.getByProjectAndSource(
      "project-1",
      "media-1",
    );

    expect(active?.id).toBe(first.diarizationId);
  });

  it("does not ask the user for a speaker count", async () => {
    const provider = new MockSpeakerDiarizationProvider();
    const seen: (number | null | undefined)[] = [];
    const spy = vi
      .spyOn(provider, "diarize")
      .mockImplementation(async (input) => {
        seen.push(input.expectedSpeakerCount);
        return {
          regions: [
            { speakerLabel: "A", startTime: 0, endTime: 1, confidence: null },
          ],
          provider: { id: provider.id, model: "mock-diarizer-1" },
        };
      });

    const { service, context } = createHarness(root, provider);
    await service.run(context());

    expect(spy).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([null]);
  });

  it("fails clearly for an unknown provider id", async () => {
    const { service, context } = createHarness(root);

    await expect(
      service.run(context({ job: job({ providerId: "does-not-exist" }) })),
    ).rejects.toMatchObject({ code: "DIARIZATION_PROVIDER_UNAVAILABLE" });
  });
});
