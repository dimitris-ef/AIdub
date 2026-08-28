import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { ProcessingArtifact } from "@/types/processing-artifact";
import type { ProcessingJob } from "@/types/processing-job";
import { DevelopmentTranscriptRepository } from "@/data/transcripts/development-transcript-repository";
import { DevelopmentDiarizationRepository } from "@/data/diarization/development-diarization-repository";
import type { StageRunContext } from "@/server/processing/processing-service";
import { MockSpeechToTextProvider } from "@/server/transcription/providers/mock-provider";
import { createProviderRegistry } from "@/server/transcription/speech-to-text-provider-registry";
import { TranscriptionService } from "@/server/transcription/transcription-service";
import { MockSpeakerDiarizationProvider } from "@/server/diarization/providers/mock-provider";
import { createDiarizationProviderRegistry } from "@/server/diarization/speaker-diarization-provider-registry";
import { DiarizationService } from "@/server/diarization/diarization-service";

/**
 * Part 6's contract with Part 5 and Part 7.
 *
 * Transcription and diarization are two independent systems that happen to
 * describe the same audio. These tests pin that down: running one must not
 * touch the other's data, and Part 7 must be able to fetch both for the same
 * project and source media on a shared timebase — without Part 6 having done
 * any merging itself.
 */

const PROJECT = "project-1";
const MEDIA = "media-1";

const artifact: ProcessingArtifact = {
  id: "artifact-1",
  projectId: PROJECT,
  sourceMediaId: MEDIA,
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

function job(type: ProcessingJob["type"], providerId: string): ProcessingJob {
  return {
    id: `job-${type}`,
    projectId: PROJECT,
    sourceMediaId: MEDIA,
    type,
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
    providerId,
    languageHint: "en",
    audioArtifactId: null,
    parameters: null,
  };
}

describe("transcript and diarization independence", () => {
  let root: string;
  let transcripts: DevelopmentTranscriptRepository;
  let diarizations: DevelopmentDiarizationRepository;

  function context(type: ProcessingJob["type"]): StageRunContext {
    return {
      job: job(type, "mock"),
      signal: new AbortController().signal,
      ensureAudio: async () => ({
        artifact,
        path: path.join(root, "audio.wav"),
        mimeType: "audio/wav",
        durationSeconds: 30,
      }),
      onProgress: () => {},
    };
  }

  function transcription() {
    const provider = new MockSpeechToTextProvider();
    return new TranscriptionService({
      registry: createProviderRegistry([provider], provider.id),
      transcripts,
      logger: () => {},
    });
  }

  function diarization() {
    const provider = new MockSpeakerDiarizationProvider();
    return new DiarizationService({
      registry: createDiarizationProviderRegistry([provider], provider.id),
      diarizations,
      logger: () => {},
    });
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aidub-part7-"));
    transcripts = new DevelopmentTranscriptRepository(
      path.join(root, "transcripts"),
    );
    diarizations = new DevelopmentDiarizationRepository(
      path.join(root, "diarizations"),
    );
  });

  it("leaves the transcript byte-for-byte unchanged after diarizing", async () => {
    await transcription().run(context("transcribe"));

    const before = await transcripts.getByProject(PROJECT, MEDIA);
    expect(before).not.toBeNull();

    await diarization().run(context("diarize"));

    const after = await transcripts.getByProject(PROJECT, MEDIA);

    // Ids, text and timings are all identical: diarization writes nothing here.
    expect(after).toEqual(before);
  });

  it("injects no speaker information into transcript segments", async () => {
    await transcription().run(context("transcribe"));
    await diarization().run(context("diarize"));

    const transcript = await transcripts.getByProject(PROJECT, MEDIA);

    for (const segment of transcript!.segments) {
      expect(Object.keys(segment)).not.toContain("speakerId");
      expect(Object.keys(segment)).not.toContain("speaker");
      expect(JSON.stringify(segment)).not.toContain("speaker_");
    }
  });

  it("does not require a transcript in order to diarize", async () => {
    const result = await diarization().run(context("diarize"));

    expect(result).toMatchObject({ kind: "diarize" });
    // Diarization stands alone: no transcript was ever created.
    expect(await transcripts.getByProject(PROJECT, MEDIA)).toBeNull();
  });

  it("does not require a diarization in order to transcribe", async () => {
    await transcription().run(context("transcribe"));

    expect(await transcripts.getByProject(PROJECT, MEDIA)).not.toBeNull();
    expect(
      await diarizations.getByProjectAndSource(PROJECT, MEDIA),
    ).toBeNull();
  });

  it("hands Part 7 both timelines for the same project and source", async () => {
    await transcription().run(context("transcribe"));
    await diarization().run(context("diarize"));

    // Exactly what a Part 7 merge would load: two independent lookups keyed by
    // the same project and the same exact source media version.
    const transcript = await transcripts.getByProject(PROJECT, MEDIA);
    const speakers = await diarizations.getByProjectAndSource(PROJECT, MEDIA);

    expect(transcript?.projectId).toBe(PROJECT);
    expect(speakers?.projectId).toBe(PROJECT);
    expect(transcript?.sourceMediaId).toBe(MEDIA);
    expect(speakers?.sourceMediaId).toBe(MEDIA);

    // One timebase: finite numeric seconds on both sides.
    const times = [
      ...transcript!.segments.flatMap((s) => [s.startTime, s.endTime]),
      ...speakers!.regions.flatMap((r) => [r.startTime, r.endTime]),
    ];
    expect(times.every((value) => typeof value === "number")).toBe(true);
    expect(times.every(Number.isFinite)).toBe(true);

    // Stable ids on both sides, which is what a merge would reference.
    expect(
      transcript!.segments.every((segment) => segment.id.length > 0),
    ).toBe(true);
    expect(speakers!.regions.every((region) => region.id.length > 0)).toBe(true);
    expect(
      speakers!.regions.every((region) =>
        speakers!.speakers.some((speaker) => speaker.id === region.speakerId),
      ),
    ).toBe(true);

    // Both arrays arrive in timeline order, so a merge can walk them together.
    const starts = (values: number[]) =>
      expect([...values].sort((a, b) => a - b)).toEqual(values);
    starts(transcript!.segments.map((segment) => segment.startTime));
    starts(speakers!.regions.map((region) => region.startTime));
  });

  it("keeps the two stores separate when one source is discarded", async () => {
    await transcription().run(context("transcribe"));
    await diarization().run(context("diarize"));

    await diarizations.deleteByMedia(PROJECT, MEDIA);

    // Dropping the speaker analysis leaves the transcript intact.
    expect(await transcripts.getByProject(PROJECT, MEDIA)).not.toBeNull();
    expect(
      await diarizations.getByProjectAndSource(PROJECT, MEDIA),
    ).toBeNull();
  });
});
