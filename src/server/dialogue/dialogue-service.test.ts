import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DiarizationResult, SpeakerRegion } from "@/types/diarization";
import type { Transcript, TranscriptSegment } from "@/types/transcript";
import { DevelopmentTranscriptRepository } from "@/data/transcripts/development-transcript-repository";
import type { TranscriptRepository } from "@/data/transcripts";
import { DevelopmentDiarizationRepository } from "@/data/diarization/development-diarization-repository";
import type { DiarizationRepository } from "@/data/diarization";
import { DevelopmentDialogueRepository } from "@/data/dialogue/development-dialogue-repository";
import { DialogueService } from "@/server/dialogue/dialogue-service";
import {
  DIALOGUE_SCHEMA_VERSION,
  MERGE_ALGORITHM_VERSION,
} from "@/lib/dialogue/merge-config";

/**
 * The dialogue service: prerequisites, persistence, staleness, regeneration
 * and the promise that raw inputs are never touched.
 */

const PROJECT = "project-a";
const MEDIA = "media-a";

function segment(
  id: string,
  startTime: number,
  endTime: number,
  originalText: string,
): TranscriptSegment {
  return {
    id,
    startTime,
    endTime,
    originalText,
    status: "completed",
    confidence: null,
  };
}

function region(
  id: string,
  speakerId: string,
  startTime: number,
  endTime: number,
): SpeakerRegion {
  return {
    id,
    speakerId,
    startTime,
    endTime,
    confidence: null,
    overlap: false,
  };
}

function transcript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    id: "transcript-a",
    projectId: PROJECT,
    sourceMediaId: MEDIA,
    audioArtifactId: "artifact-a",
    providerId: "stt",
    providerModel: "stt-model",
    language: "en",
    status: "completed",
    segments: [
      segment("t-1", 0, 3, "Hello and welcome."),
      segment("t-2", 3.7, 7.2, "Thanks for having me."),
    ],
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z",
    ...overrides,
  };
}

function diarization(
  overrides: Partial<DiarizationResult> = {},
): DiarizationResult {
  return {
    id: "diarization-a",
    projectId: PROJECT,
    sourceMediaId: MEDIA,
    audioArtifactId: "artifact-a",
    providerId: "diarizer",
    providerModel: "diarizer-model",
    status: "completed",
    speakers: [
      { id: "speaker_1", label: "Speaker 1", confidence: null },
      { id: "speaker_2", label: "Speaker 2", confidence: null },
    ],
    regions: [
      region("r-1", "speaker_1", 0, 3.5),
      region("r-2", "speaker_2", 3.7, 7.2),
    ],
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z",
    ...overrides,
  };
}

/** A repository that serves one fixed record, for feeding the merge directly. */
function stubTranscripts(record: Transcript): TranscriptRepository {
  return {
    getByProject: async () => record,
    getById: async () => record,
    listByProject: async () => [record],
    save: async (value) => value,
    delete: async () => {},
    deleteByMedia: async () => {},
    deleteByProject: async () => {},
  };
}

function stubDiarizations(record: DiarizationResult): DiarizationRepository {
  return {
    getByProjectAndSource: async () => record,
    getById: async () => record,
    listByProject: async () => [record],
    save: async (value) => value,
    delete: async () => {},
    deleteByMedia: async () => {},
    deleteByProject: async () => {},
  };
}

describe("DialogueService", () => {
  let root: string;
  let transcripts: DevelopmentTranscriptRepository;
  let diarizations: DevelopmentDiarizationRepository;
  let dialogues: DevelopmentDialogueRepository;
  let ids: number;

  function createService(options: { now?: string } = {}) {
    return new DialogueService({
      transcripts,
      diarizations,
      dialogues,
      createId: () => `dialogue-${++ids}`,
      now: () => new Date(options.now ?? "2026-08-27T11:00:00.000Z"),
      logger: () => {},
    });
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aidub-dialogue-"));
    transcripts = new DevelopmentTranscriptRepository(
      path.join(root, "transcripts"),
    );
    diarizations = new DevelopmentDiarizationRepository(
      path.join(root, "diarizations"),
    );
    dialogues = new DevelopmentDialogueRepository(path.join(root, "dialogues"));
    ids = 0;
  });

  describe("prerequisites", () => {
    it("reports a missing transcript instead of inventing dialogue", async () => {
      await diarizations.save(diarization());

      const result = await createService().getCurrentDialogue(PROJECT, MEDIA);

      expect(result).toMatchObject({
        state: "transcript_required",
        dialogue: null,
      });
      expect(await dialogues.listByProject(PROJECT)).toEqual([]);
    });

    it("reports missing diarization instead of assigning everything to one speaker", async () => {
      await transcripts.save(transcript());

      const result = await createService().getCurrentDialogue(PROJECT, MEDIA);

      expect(result).toMatchObject({
        state: "diarization_required",
        dialogue: null,
      });
      expect(await dialogues.listByProject(PROJECT)).toEqual([]);
    });

    it("reports both missing", async () => {
      const result = await createService().getCurrentDialogue(PROJECT, MEDIA);

      expect(result.state).toBe("transcript_required");
    });

    it("ignores a transcript that has not completed", async () => {
      await transcripts.save(transcript({ status: "failed" }));
      await diarizations.save(diarization());

      expect(
        (await createService().getCurrentDialogue(PROJECT, MEDIA)).state,
      ).toBe("transcript_required");
    });

    it("refuses to combine results describing different sources", async () => {
      await transcripts.save(transcript());
      // A diarization stored under this source but claiming another one.
      await diarizations.save(
        diarization({ id: "diarization-x", sourceMediaId: "media-other" }),
      );

      const service = new DialogueService({
        transcripts,
        diarizations: stubDiarizations(
          diarization({ id: "diarization-x", sourceMediaId: "media-other" }),
        ),
        dialogues,
        logger: () => {},
      });

      const result = await service.getCurrentDialogue(PROJECT, MEDIA);

      expect(result.state).toBe("source_mismatch");
      expect(result.dialogue).toBeNull();
      expect(await dialogues.listByProject(PROJECT)).toEqual([]);
    });
  });

  describe("generation and persistence", () => {
    beforeEach(async () => {
      await transcripts.save(transcript());
      await diarizations.save(diarization());
    });

    it("generates, persists and references the exact raw inputs", async () => {
      const result = await createService().getCurrentDialogue(PROJECT, MEDIA);

      expect(result.state).toBe("ready");
      expect(result.state === "ready" && result.regenerated).toBe(true);

      const dialogue = result.dialogue!;

      expect(dialogue).toMatchObject({
        projectId: PROJECT,
        sourceMediaId: MEDIA,
        transcriptId: "transcript-a",
        diarizationId: "diarization-a",
        version: DIALOGUE_SCHEMA_VERSION,
        status: "completed",
      });
      expect(dialogue.mergeMetadata).toMatchObject({
        algorithmVersion: MERGE_ALGORITHM_VERSION,
        transcriptId: "transcript-a",
        diarizationId: "diarization-a",
      });
      expect(dialogue.mergeMetadata.config).toMatchObject({
        minSpeakerCoverage: 0.5,
        dominantSpeakerRatio: 0.75,
      });
      expect(dialogue.segments.map((s) => s.speakerId)).toEqual([
        "speaker_1",
        "speaker_2",
      ]);
      expect(dialogue.segments.map((s) => s.originalText)).toEqual([
        "Hello and welcome.",
        "Thanks for having me.",
      ]);
    });

    it("reuses the stored dialogue while its inputs are unchanged", async () => {
      const first = await createService().getCurrentDialogue(PROJECT, MEDIA);
      const second = await createService().getCurrentDialogue(PROJECT, MEDIA);

      expect(first.state === "ready" && first.regenerated).toBe(true);
      expect(second.state === "ready" && second.regenerated).toBe(false);
      expect(second.dialogue!.id).toBe(first.dialogue!.id);
      // Reusing must not accumulate records.
      expect(await dialogues.listByProject(PROJECT)).toHaveLength(1);
    });

    it("keeps dialogue and segment ids stable across a reload", async () => {
      const generated = (
        await createService().getCurrentDialogue(PROJECT, MEDIA)
      ).dialogue!;

      // A fresh repository instance: nothing cached, everything re-read.
      const reloaded = await new DevelopmentDialogueRepository(
        path.join(root, "dialogues"),
      ).getByProjectAndSource(PROJECT, MEDIA);

      expect(reloaded?.id).toBe(generated.id);
      expect(reloaded?.segments.map((s) => s.id)).toEqual(
        generated.segments.map((s) => s.id),
      );
      expect(reloaded?.segments.map((s) => s.speakerId)).toEqual(
        generated.segments.map((s) => s.speakerId),
      );
      expect(reloaded).toEqual(generated);
    });

    it("derives segment ids from the transcript segments", async () => {
      const dialogue = (
        await createService().getCurrentDialogue(PROJECT, MEDIA)
      ).dialogue!;

      expect(dialogue.segments.map((s) => s.id)).toEqual(["t-1", "t-2"]);
      expect(
        dialogue.segments.map((s) => s.transcription.transcriptSegmentId),
      ).toEqual(["t-1", "t-2"]);
    });

    it("reports a failure rather than persisting a broken dialogue", async () => {
      // The transcript store rejects corrupt records itself, so this feeds the
      // merge directly — the defensive check exists for exactly the case where
      // something upstream hands it values that never should have survived.
      const corrupt = transcript({
        id: "transcript-bad",
        segments: [segment("t-bad", Number.NaN, 5, "corrupt")],
      });

      const service = new DialogueService({
        transcripts: stubTranscripts(corrupt),
        diarizations,
        dialogues,
        logger: () => {},
      });

      const result = await service.getCurrentDialogue(PROJECT, MEDIA);

      expect(result.state).toBe("failed");
      expect(await dialogues.listByProject(PROJECT)).toEqual([]);
    });

    it("reports a failure when the dialogue cannot be saved", async () => {
      vi.spyOn(dialogues, "save").mockRejectedValueOnce(new Error("disk full"));

      const result = await createService().getCurrentDialogue(PROJECT, MEDIA);

      expect(result).toMatchObject({ state: "failed", dialogue: null });
    });
  });

  describe("staleness and regeneration", () => {
    beforeEach(async () => {
      await transcripts.save(transcript());
      await diarizations.save(diarization());
    });

    it("regenerates when the active transcript changes", async () => {
      const before = (await createService().getCurrentDialogue(PROJECT, MEDIA))
        .dialogue!;

      // Retranscription: a new transcript record replaces the old one.
      await transcripts.delete("transcript-a");
      await transcripts.save(
        transcript({ id: "transcript-b", updatedAt: "2026-08-27T12:00:00.000Z" }),
      );

      const after = await createService().getCurrentDialogue(PROJECT, MEDIA);

      expect(after.state === "ready" && after.regenerated).toBe(true);
      expect(after.dialogue!.id).not.toBe(before.id);
      expect(after.dialogue!.transcriptId).toBe("transcript-b");
      expect(after.dialogue!.diarizationId).toBe("diarization-a");
      expect(await dialogues.listByProject(PROJECT)).toHaveLength(1);
    });

    it("regenerates when the active diarization changes", async () => {
      const before = (await createService().getCurrentDialogue(PROJECT, MEDIA))
        .dialogue!;

      await diarizations.delete("diarization-a");
      await diarizations.save(
        diarization({
          id: "diarization-b",
          updatedAt: "2026-08-27T12:00:00.000Z",
        }),
      );

      const after = await createService().getCurrentDialogue(PROJECT, MEDIA);

      expect(after.state === "ready" && after.regenerated).toBe(true);
      expect(after.dialogue!.id).not.toBe(before.id);
      expect(after.dialogue!.diarizationId).toBe("diarization-b");
      expect(after.dialogue!.transcriptId).toBe("transcript-a");
    });

    it("regenerates when the merge algorithm version moves on", async () => {
      const generated = (
        await createService().getCurrentDialogue(PROJECT, MEDIA)
      ).dialogue!;

      // Simulate a dialogue written by older merge logic.
      await dialogues.save({
        ...generated,
        mergeMetadata: {
          ...generated.mergeMetadata,
          algorithmVersion: "dialogue-merge-v0",
        },
      });

      const after = await createService().getCurrentDialogue(PROJECT, MEDIA);

      expect(after.state === "ready" && after.regenerated).toBe(true);
      expect(after.dialogue!.mergeMetadata.algorithmVersion).toBe(
        MERGE_ALGORITHM_VERSION,
      );
    });

    it("leaves the raw transcript and diarization untouched by regeneration", async () => {
      const rawTranscriptBefore = await transcripts.getByProject(
        PROJECT,
        MEDIA,
      );
      const rawDiarizationBefore = await diarizations.getByProjectAndSource(
        PROJECT,
        MEDIA,
      );

      await createService().getCurrentDialogue(PROJECT, MEDIA);
      await createService().getCurrentDialogue(PROJECT, MEDIA);

      expect(await transcripts.getByProject(PROJECT, MEDIA)).toEqual(
        rawTranscriptBefore,
      );
      expect(
        await diarizations.getByProjectAndSource(PROJECT, MEDIA),
      ).toEqual(rawDiarizationBefore);
    });
  });

  describe("isolation and cleanup", () => {
    beforeEach(async () => {
      await transcripts.save(transcript());
      await diarizations.save(diarization());
      await transcripts.save(
        transcript({
          id: "transcript-b",
          projectId: "project-b",
          sourceMediaId: "media-b",
        }),
      );
      await diarizations.save(
        diarization({
          id: "diarization-b",
          projectId: "project-b",
          sourceMediaId: "media-b",
        }),
      );
    });

    it("keeps projects isolated in both directions", async () => {
      const service = createService();
      const a = await service.getCurrentDialogue(PROJECT, MEDIA);
      const b = await service.getCurrentDialogue("project-b", "media-b");

      expect(a.dialogue!.id).not.toBe(b.dialogue!.id);
      expect(
        (await dialogues.getByProjectAndSource(PROJECT, "media-b")),
      ).toBeNull();
      expect(
        await dialogues.getByProjectAndSource("project-b", MEDIA),
      ).toBeNull();
    });

    it("does not serve one source's dialogue for another", async () => {
      await createService().getCurrentDialogue(PROJECT, MEDIA);

      expect(
        await dialogues.getByProjectAndSource(PROJECT, "media-replaced"),
      ).toBeNull();
    });

    it("removes a project's dialogue without touching another project's", async () => {
      const service = createService();
      await service.getCurrentDialogue(PROJECT, MEDIA);
      const b = await service.getCurrentDialogue("project-b", "media-b");

      await service.deleteByProject(PROJECT);

      expect(await dialogues.listByProject(PROJECT)).toEqual([]);
      expect(
        (await dialogues.getByProjectAndSource("project-b", "media-b"))?.id,
      ).toBe(b.dialogue!.id);
    });

    it("removes a source's dialogue when its media goes away", async () => {
      const service = createService();
      await service.getCurrentDialogue(PROJECT, MEDIA);

      await service.deleteByMedia(PROJECT, MEDIA);

      expect(await dialogues.getByProjectAndSource(PROJECT, MEDIA)).toBeNull();
    });
  });

  describe("edge cases end to end", () => {
    it("produces an empty dialogue when neither input found speech", async () => {
      await transcripts.save(transcript({ segments: [] }));
      await diarizations.save(diarization({ speakers: [], regions: [] }));

      const result = await createService().getCurrentDialogue(PROJECT, MEDIA);

      expect(result.state).toBe("ready");
      expect(result.dialogue!.segments).toEqual([]);
      expect(result.dialogue!.status).toBe("completed");
    });

    it("keeps transcript text when diarization found no speakers", async () => {
      await transcripts.save(transcript());
      await diarizations.save(diarization({ speakers: [], regions: [] }));

      const dialogue = (
        await createService().getCurrentDialogue(PROJECT, MEDIA)
      ).dialogue!;

      expect(dialogue.segments).toHaveLength(2);
      expect(dialogue.segments.every((s) => s.speakerId === null)).toBe(true);
      expect(dialogue.mergeMetadata.unassignedSegmentCount).toBe(2);
      expect(dialogue.segments.map((s) => s.originalText)).toEqual([
        "Hello and welcome.",
        "Thanks for having me.",
      ]);
    });
  });
});
