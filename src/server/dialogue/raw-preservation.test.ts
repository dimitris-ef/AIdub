import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { ProcessingArtifact } from "@/types/processing-artifact";
import type { ProcessingJob } from "@/types/processing-job";
import { DevelopmentTranscriptRepository } from "@/data/transcripts/development-transcript-repository";
import { DevelopmentDiarizationRepository } from "@/data/diarization/development-diarization-repository";
import { DevelopmentDialogueRepository } from "@/data/dialogue/development-dialogue-repository";
import type { StageRunContext } from "@/server/processing/processing-service";
import { MockSpeechToTextProvider } from "@/server/transcription/providers/mock-provider";
import { createProviderRegistry } from "@/server/transcription/speech-to-text-provider-registry";
import { TranscriptionService } from "@/server/transcription/transcription-service";
import { MockSpeakerDiarizationProvider } from "@/server/diarization/providers/mock-provider";
import { createDiarizationProviderRegistry } from "@/server/diarization/speaker-diarization-provider-registry";
import { DiarizationService } from "@/server/diarization/diarization-service";
import { DialogueService } from "@/server/dialogue/dialogue-service";

/**
 * The whole Part 5 → Part 6 → Part 7 chain, driven by the deterministic mock
 * providers.
 *
 * Two things are proven here. First, **provider independence**: the merge is
 * reached through normalised domain models only, and swapping either provider
 * changes nothing about the dialogue layer. Second, and more importantly,
 * **raw preservation**: merging is derivation, not transformation — the
 * transcript and diarization it reads must come out the other side identical,
 * so a better merge can always be run again later.
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
  createdAt: "2026-08-27T10:00:00.000Z",
};

function job(type: ProcessingJob["type"]): ProcessingJob {
  return {
    id: `job-${type}`,
    projectId: PROJECT,
    sourceMediaId: MEDIA,
    type,
    status: "processing",
    progress: 1,
    indeterminate: false,
    stage: null,
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z",
    startedAt: "2026-08-27T10:00:00.000Z",
    completedAt: null,
    error: null,
    result: null,
    providerId: "mock",
    languageHint: "en",
    audioArtifactId: null,
  };
}

describe("raw transcript and diarization are preserved by merging", () => {
  let root: string;
  let transcripts: DevelopmentTranscriptRepository;
  let diarizations: DevelopmentDiarizationRepository;
  let dialogues: DevelopmentDialogueRepository;

  function context(type: ProcessingJob["type"]): StageRunContext {
    return {
      job: job(type),
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

  async function produceRawInputs() {
    const stt = new MockSpeechToTextProvider();
    await new TranscriptionService({
      registry: createProviderRegistry([stt], stt.id),
      transcripts,
      logger: () => {},
    }).run(context("transcribe"));

    const diarizer = new MockSpeakerDiarizationProvider();
    await new DiarizationService({
      registry: createDiarizationProviderRegistry([diarizer], diarizer.id),
      diarizations,
      logger: () => {},
    }).run(context("diarize"));
  }

  function dialogueService() {
    return new DialogueService({
      transcripts,
      diarizations,
      dialogues,
      logger: () => {},
    });
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aidub-raw-"));
    transcripts = new DevelopmentTranscriptRepository(
      path.join(root, "transcripts"),
    );
    diarizations = new DevelopmentDiarizationRepository(
      path.join(root, "diarizations"),
    );
    dialogues = new DevelopmentDialogueRepository(path.join(root, "dialogues"));
    await produceRawInputs();
  });

  it("merges normalised provider output into a dialogue", async () => {
    const result = await dialogueService().getCurrentDialogue(PROJECT, MEDIA);

    expect(result.state).toBe("ready");

    const dialogue = result.dialogue!;
    const transcript = (await transcripts.getByProject(PROJECT, MEDIA))!;
    const diarization = (await diarizations.getByProjectAndSource(
      PROJECT,
      MEDIA,
    ))!;

    expect(dialogue.transcriptId).toBe(transcript.id);
    expect(dialogue.diarizationId).toBe(diarization.id);
    expect(dialogue.segments).toHaveLength(transcript.segments.length);

    // Every dialogue segment traces to a real transcript segment…
    const segmentIds = new Set(transcript.segments.map((s) => s.id));
    expect(
      dialogue.segments.every((s) =>
        segmentIds.has(s.transcription.transcriptSegmentId),
      ),
    ).toBe(true);

    // …every assigned speaker exists in the diarization…
    const speakerIds = new Set(diarization.speakers.map((s) => s.id));
    expect(
      dialogue.segments.every(
        (s) => s.speakerId === null || speakerIds.has(s.speakerId),
      ),
    ).toBe(true);

    // …and every referenced region is a real one.
    const regionIds = new Set(diarization.regions.map((r) => r.id));
    expect(
      dialogue.segments.every((s) =>
        s.diarization.regionIds.every((id) => regionIds.has(id)),
      ),
    ).toBe(true);
  });

  it("leaves both raw results byte-for-byte unchanged", async () => {
    const transcriptBefore = await transcripts.getByProject(PROJECT, MEDIA);
    const diarizationBefore = await diarizations.getByProjectAndSource(
      PROJECT,
      MEDIA,
    );

    const service = dialogueService();
    await service.getCurrentDialogue(PROJECT, MEDIA);
    await service.getCurrentDialogue(PROJECT, MEDIA);

    const transcriptAfter = await transcripts.getByProject(PROJECT, MEDIA);
    const diarizationAfter = await diarizations.getByProjectAndSource(
      PROJECT,
      MEDIA,
    );

    expect(transcriptAfter).toEqual(transcriptBefore);
    expect(diarizationAfter).toEqual(diarizationBefore);

    // Spelled out, because these are the guarantees later parts depend on.
    expect(transcriptAfter!.segments).toHaveLength(
      transcriptBefore!.segments.length,
    );
    expect(transcriptAfter!.segments.map((s) => s.id)).toEqual(
      transcriptBefore!.segments.map((s) => s.id),
    );
    expect(transcriptAfter!.segments.map((s) => s.originalText)).toEqual(
      transcriptBefore!.segments.map((s) => s.originalText),
    );
    expect(diarizationAfter!.speakers.map((s) => s.id)).toEqual(
      diarizationBefore!.speakers.map((s) => s.id),
    );
    expect(diarizationAfter!.regions.map((r) => r.id)).toEqual(
      diarizationBefore!.regions.map((r) => r.id),
    );
    expect(
      diarizationAfter!.regions.map((r) => [r.startTime, r.endTime]),
    ).toEqual(diarizationBefore!.regions.map((r) => [r.startTime, r.endTime]));
  });

  it("adds no speaker fields to the raw transcript", async () => {
    await dialogueService().getCurrentDialogue(PROJECT, MEDIA);

    const transcript = (await transcripts.getByProject(PROJECT, MEDIA))!;

    for (const segment of transcript.segments) {
      expect(Object.keys(segment)).not.toContain("speakerId");
      expect(JSON.stringify(segment)).not.toContain("speaker_");
    }
  });

  it("can rebuild the dialogue from the raw inputs after it is deleted", async () => {
    const service = dialogueService();
    const first = (await service.getCurrentDialogue(PROJECT, MEDIA)).dialogue!;

    await dialogues.delete(first.id);
    expect(await dialogues.getByProjectAndSource(PROJECT, MEDIA)).toBeNull();

    const rebuilt = await service.getCurrentDialogue(PROJECT, MEDIA);

    expect(rebuilt.state).toBe("ready");
    // A different record, but the same derived content and segment identities.
    expect(rebuilt.dialogue!.segments.map((s) => s.id)).toEqual(
      first.segments.map((s) => s.id),
    );
    expect(rebuilt.dialogue!.segments.map((s) => s.speakerId)).toEqual(
      first.segments.map((s) => s.speakerId),
    );
    expect(rebuilt.dialogue!.segments.map((s) => s.originalText)).toEqual(
      first.segments.map((s) => s.originalText),
    );
  });
});
