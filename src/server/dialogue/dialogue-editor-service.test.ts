import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DiarizationResult, SpeakerRegion } from "@/types/diarization";
import type { Transcript, TranscriptSegment } from "@/types/transcript";
import { DevelopmentTranscriptRepository } from "@/data/transcripts/development-transcript-repository";
import { DevelopmentDiarizationRepository } from "@/data/diarization/development-diarization-repository";
import { DevelopmentDialogueRepository } from "@/data/dialogue/development-dialogue-repository";
import { DialogueService } from "@/server/dialogue/dialogue-service";
import {
  DialogueEditorService,
  parseEditOperation,
} from "@/server/dialogue/dialogue-editor-service";

/**
 * The editor service end to end: real repositories, real merge, real
 * persistence.
 *
 * The point of these tests is the promise Part 8 rests on — that correcting
 * dialogue cannot damage the transcription or speaker analysis it was built
 * from — plus the atomicity that keeps a failed structural edit from leaving a
 * half-applied document behind.
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
  return { id, speakerId, startTime, endTime, confidence: null, overlap: false };
}

function transcript(): Transcript {
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
      segment("t-1", 0, 4, "Helo world"),
      segment("t-2", 4, 8, "Thanks for having me."),
      segment("t-3", 10, 18, "Hello everyone, thanks for coming."),
    ],
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
  };
}

function diarization(): DiarizationResult {
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
      { id: "speaker_3", label: "Speaker 3", confidence: null },
    ],
    regions: [
      region("r-1", "speaker_1", 0, 4),
      region("r-2", "speaker_2", 4, 8),
      region("r-3", "speaker_3", 10, 18),
    ],
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
  };
}

describe("DialogueEditorService", () => {
  let root: string;
  let transcripts: DevelopmentTranscriptRepository;
  let diarizations: DevelopmentDiarizationRepository;
  let dialogues: DevelopmentDialogueRepository;
  let editor: DialogueEditorService;

  async function generate() {
    const service = new DialogueService({
      transcripts,
      diarizations,
      dialogues,
      logger: () => {},
    });

    const result = await service.getCurrentDialogue(PROJECT, MEDIA);

    if (result.state !== "ready") {
      throw new Error(`expected a dialogue, got ${result.state}`);
    }

    return result.dialogue;
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aidub-editor-"));
    transcripts = new DevelopmentTranscriptRepository(
      path.join(root, "transcripts"),
    );
    diarizations = new DevelopmentDiarizationRepository(
      path.join(root, "diarizations"),
    );
    dialogues = new DevelopmentDialogueRepository(path.join(root, "dialogues"));
    editor = new DialogueEditorService({ dialogues, logger: () => {} });

    await transcripts.save(transcript());
    await diarizations.save(diarization());
    await generate();
  });

  const apply = async (
    operation: Parameters<DialogueEditorService["applyEdit"]>[2],
  ) => {
    const outcome = await editor.applyEdit(PROJECT, MEDIA, operation);

    if (!outcome.ok) {
      throw new Error(`expected success, got ${outcome.code}: ${outcome.message}`);
    }

    return outcome;
  };

  const stored = () => dialogues.getByProjectAndSource(PROJECT, MEDIA);

  describe("text", () => {
    it("persists a correction without touching the raw transcript", async () => {
      await apply({ type: "update_text", segmentId: "t-1", text: "Hello world" });

      const saved = await stored();
      expect(
        saved?.segments.find((s) => s.id === "t-1")?.originalText,
      ).toBe("Hello world");

      // The raw transcript still says what the model said.
      const raw = await transcripts.getByProject(PROJECT, MEDIA);
      expect(raw?.segments.find((s) => s.id === "t-1")?.originalText).toBe(
        "Helo world",
      );
    });

    it("bumps the revision and records that edits exist", async () => {
      const before = await stored();
      expect(before?.editMetadata.hasManualEdits).toBe(false);
      expect(before?.editMetadata.revision).toBe(0);

      await apply({ type: "update_text", segmentId: "t-1", text: "Hello world" });

      const after = await stored();
      expect(after?.editMetadata.hasManualEdits).toBe(true);
      expect(after?.editMetadata.revision).toBe(1);
      expect(after?.editMetadata.editedAt).not.toBeNull();
      // The dialogue id is stable — this is one document being edited.
      expect(after?.id).toBe(before?.id);
    });
  });

  describe("speakers", () => {
    it("renames without changing the id every line references", async () => {
      await apply({
        type: "rename_speaker",
        speakerId: "speaker_1",
        name: "Alice",
      });

      const saved = await stored();
      expect(saved?.speakers.find((s) => s.id === "speaker_1")?.name).toBe(
        "Alice",
      );
      expect(saved?.segments[0].speakerId).toBe("speaker_1");

      // Part 6's own speaker labels are untouched.
      const raw = await diarizations.getByProjectAndSource(PROJECT, MEDIA);
      expect(raw?.speakers.find((s) => s.id === "speaker_1")?.label).toBe(
        "Speaker 1",
      );
    });

    it("reassigns one line and leaves the others alone", async () => {
      await apply({
        type: "reassign_speaker",
        segmentId: "t-1",
        speakerId: "speaker_2",
      });

      const saved = await stored();
      expect(saved?.segments.map((s) => s.speakerId)).toEqual([
        "speaker_2",
        "speaker_2",
        "speaker_3",
      ]);
      expect(saved?.segments[0].assignment.method).toBe("manual");

      // The regions the assignment came from are unchanged.
      const raw = await diarizations.getByProjectAndSource(PROJECT, MEDIA);
      expect(raw?.regions.map((r) => r.speakerId)).toEqual([
        "speaker_1",
        "speaker_2",
        "speaker_3",
      ]);
    });

    it("merges duplicates atomically and keeps the target id", async () => {
      await apply({
        type: "merge_speakers",
        sourceSpeakerId: "speaker_3",
        targetSpeakerId: "speaker_1",
      });

      const saved = await stored();
      expect(saved?.segments.map((s) => s.speakerId)).toEqual([
        "speaker_1",
        "speaker_2",
        "speaker_1",
      ]);
      expect(saved?.speakers.map((s) => s.id)).toEqual([
        "speaker_1",
        "speaker_2",
      ]);
      expect(
        saved?.speakers.find((s) => s.id === "speaker_1")?.sourceSpeakerIds,
      ).toEqual(["speaker_1", "speaker_3"]);

      // Part 6 still knows about all three clusters.
      const raw = await diarizations.getByProjectAndSource(PROJECT, MEDIA);
      expect(raw?.speakers).toHaveLength(3);
    });

    it("leaves nothing half-merged when persistence fails", async () => {
      const before = await stored();
      vi.spyOn(dialogues, "save").mockRejectedValueOnce(new Error("disk full"));

      const outcome = await editor.applyEdit(PROJECT, MEDIA, {
        type: "merge_speakers",
        sourceSpeakerId: "speaker_3",
        targetSpeakerId: "speaker_1",
      });

      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.code).toBe("DIALOGUE_SAVE_FAILED");

      // The stored document is exactly as it was — not partly reassigned.
      expect(await stored()).toEqual(before);
    });
  });

  describe("structure", () => {
    it("splits a line and persists both halves", async () => {
      await apply({
        type: "split_segment",
        segmentId: "t-3",
        splitTime: 14,
        firstText: "Hello everyone,",
        secondText: "thanks for coming.",
      });

      const saved = await stored();
      const children = saved!.segments.filter((s) => s.id.startsWith("t-3:"));

      expect(saved?.segments).toHaveLength(4);
      expect(children.map((s) => [s.startTime, s.endTime])).toEqual([
        [10, 14],
        [14, 18],
      ]);
      expect(children.every((s) => s.transcription.transcriptSegmentId === "t-3")).toBe(
        true,
      );

      // Splitting the dialogue does not split the transcript.
      const raw = await transcripts.getByProject(PROJECT, MEDIA);
      expect(raw?.segments).toHaveLength(3);
      expect(raw?.segments.map((s) => s.id)).toEqual(["t-1", "t-2", "t-3"]);
    });

    it("refuses an invalid split without changing anything", async () => {
      const before = await stored();

      const outcome = await editor.applyEdit(PROJECT, MEDIA, {
        type: "split_segment",
        segmentId: "t-3",
        splitTime: 99,
        firstText: "a",
        secondText: "b",
      });

      expect(outcome.ok).toBe(false);
      expect(await stored()).toEqual(before);
    });

    it("merges adjacent same-speaker lines after a reassignment", async () => {
      await apply({
        type: "reassign_speaker",
        segmentId: "t-2",
        speakerId: "speaker_1",
      });
      await apply({
        type: "merge_segments",
        firstSegmentId: "t-1",
        secondSegmentId: "t-2",
      });

      const saved = await stored();
      expect(saved?.segments).toHaveLength(2);
      expect(saved?.segments[0].startTime).toBe(0);
      expect(saved?.segments[0].endTime).toBe(8);
      expect(saved?.segments[0].originalText).toBe(
        "Helo world Thanks for having me.",
      );
      expect(saved?.segments[0].diarization.regionIds.sort()).toEqual([
        "r-1",
        "r-2",
      ]);

      const raw = await transcripts.getByProject(PROJECT, MEDIA);
      expect(raw?.segments).toHaveLength(3);
    });

    it("refuses to merge lines from different speakers", async () => {
      const outcome = await editor.applyEdit(PROJECT, MEDIA, {
        type: "merge_segments",
        firstSegmentId: "t-1",
        secondSegmentId: "t-2",
      });

      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.code).toBe("DIFFERENT_SPEAKERS");
      expect((await stored())?.segments).toHaveLength(3);
    });
  });

  describe("timing", () => {
    it("persists corrected seconds and reports a new overlap", async () => {
      const outcome = await apply({
        type: "update_timing",
        segmentId: "t-1",
        startTime: 0.2,
        endTime: 5.4,
      });

      const saved = await stored();
      const updated = saved!.segments.find((s) => s.id === "t-1")!;

      expect(updated.startTime).toBeCloseTo(0.2);
      expect(updated.endTime).toBeCloseTo(5.4);
      expect(updated.editMetadata.manuallyEditedTiming).toBe(true);
      // The overlap it created with t-2 is reported, not prevented.
      expect(outcome.newOverlaps.sort()).toEqual(["t-1", "t-2"]);

      // Raw timings are untouched on both sides.
      const rawTranscript = await transcripts.getByProject(PROJECT, MEDIA);
      expect(rawTranscript?.segments[0].startTime).toBe(0);
      const rawDiarization = await diarizations.getByProjectAndSource(
        PROJECT,
        MEDIA,
      );
      expect(rawDiarization?.regions[0].endTime).toBe(4);
    });

    it("rejects invalid timing without persisting it", async () => {
      const before = await stored();

      const outcome = await editor.applyEdit(PROJECT, MEDIA, {
        type: "update_timing",
        segmentId: "t-1",
        startTime: 8,
        endTime: 4,
      });

      expect(outcome.ok).toBe(false);
      expect(await stored()).toEqual(before);
    });
  });

  describe("raw immutability across every operation", () => {
    it("leaves the transcript and diarization domain-equivalent", async () => {
      const rawTranscriptBefore = await transcripts.getByProject(PROJECT, MEDIA);
      const rawDiarizationBefore = await diarizations.getByProjectAndSource(
        PROJECT,
        MEDIA,
      );

      await apply({ type: "update_text", segmentId: "t-1", text: "Hello world" });
      await apply({
        type: "rename_speaker",
        speakerId: "speaker_1",
        name: "Alice",
      });
      await apply({
        type: "reassign_speaker",
        segmentId: "t-2",
        speakerId: "speaker_1",
      });
      await apply({
        type: "merge_speakers",
        sourceSpeakerId: "speaker_3",
        targetSpeakerId: "speaker_1",
      });
      await apply({
        type: "split_segment",
        segmentId: "t-3",
        splitTime: 14,
        firstText: "Hello everyone,",
        secondText: "thanks for coming.",
      });
      await apply({
        type: "merge_segments",
        firstSegmentId: "t-1",
        secondSegmentId: "t-2",
      });
      await apply({
        type: "update_timing",
        segmentId: "t-3:a",
        startTime: 10.5,
        endTime: 13.5,
      });

      expect(await transcripts.getByProject(PROJECT, MEDIA)).toEqual(
        rawTranscriptBefore,
      );
      expect(
        await diarizations.getByProjectAndSource(PROJECT, MEDIA),
      ).toEqual(rawDiarizationBefore);
    });
  });

  describe("persistence across a reload", () => {
    it("restores every correction from a fresh repository", async () => {
      await apply({ type: "update_text", segmentId: "t-1", text: "Hello world" });
      await apply({
        type: "rename_speaker",
        speakerId: "speaker_1",
        name: "Alice",
      });
      await apply({
        type: "split_segment",
        segmentId: "t-3",
        splitTime: 14,
        firstText: "Hello everyone,",
        secondText: "thanks for coming.",
      });
      await apply({
        type: "update_timing",
        segmentId: "t-2",
        startTime: 4.2,
        endTime: 8.4,
      });

      const reloaded = await new DevelopmentDialogueRepository(
        path.join(root, "dialogues"),
      ).getByProjectAndSource(PROJECT, MEDIA);

      expect(
        reloaded?.segments.find((s) => s.id === "t-1")?.originalText,
      ).toBe("Hello world");
      expect(reloaded?.speakers.find((s) => s.id === "speaker_1")?.name).toBe(
        "Alice",
      );
      expect(reloaded?.segments.map((s) => s.id)).toEqual([
        "t-1",
        "t-2",
        "t-3:a",
        "t-3:b",
      ]);
      expect(
        reloaded?.segments.find((s) => s.id === "t-2")?.startTime,
      ).toBeCloseTo(4.2);
      expect(reloaded?.editMetadata.revision).toBe(4);
      expect(reloaded?.editMetadata.hasManualEdits).toBe(true);
    });

    it("does not regenerate over manual edits when raw results change", async () => {
      await apply({ type: "update_text", segmentId: "t-1", text: "Hello world" });
      const edited = await stored();

      // Retranscription produces a new active transcript.
      await transcripts.delete("transcript-a");
      await transcripts.save({
        ...transcript(),
        id: "transcript-b",
        updatedAt: "2026-08-28T12:00:00.000Z",
      });

      const service = new DialogueService({
        transcripts,
        diarizations,
        dialogues,
        logger: () => {},
      });
      const result = await service.getCurrentDialogue(PROJECT, MEDIA);

      expect(result.state).toBe("ready");
      // The corrected document is served as-is…
      expect(result.dialogue?.id).toBe(edited?.id);
      expect(
        result.dialogue?.segments.find((s) => s.id === "t-1")?.originalText,
      ).toBe("Hello world");
      expect(result.dialogue?.transcriptId).toBe("transcript-a");
      // …and the caller is told its baseline has moved on.
      expect(
        result.state === "ready" && result.staleBaseline?.reason,
      ).toBe("transcript_changed");
      expect(
        result.state === "ready" && result.staleBaseline?.currentTranscriptId,
      ).toBe("transcript-b");

      // Nothing was overwritten on disk either.
      expect(await stored()).toEqual(edited);
    });

    it("still regenerates a dialogue nobody has edited", async () => {
      await diarizations.delete("diarization-a");
      await diarizations.save({
        ...diarization(),
        id: "diarization-b",
        updatedAt: "2026-08-28T12:00:00.000Z",
      });

      const service = new DialogueService({
        transcripts,
        diarizations,
        dialogues,
        logger: () => {},
      });
      const result = await service.getCurrentDialogue(PROJECT, MEDIA);

      expect(result.state === "ready" && result.regenerated).toBe(true);
      expect(result.dialogue?.diarizationId).toBe("diarization-b");
    });
  });

  describe("project isolation", () => {
    it("edits one project without touching another", async () => {
      await transcripts.save({
        ...transcript(),
        id: "transcript-b",
        projectId: "project-b",
        sourceMediaId: "media-b",
      });
      await diarizations.save({
        ...diarization(),
        id: "diarization-b",
        projectId: "project-b",
        sourceMediaId: "media-b",
      });

      const service = new DialogueService({
        transcripts,
        diarizations,
        dialogues,
        logger: () => {},
      });
      await service.getCurrentDialogue("project-b", "media-b");
      const otherBefore = await dialogues.getByProjectAndSource(
        "project-b",
        "media-b",
      );

      await apply({ type: "update_text", segmentId: "t-1", text: "Hello world" });
      await apply({
        type: "rename_speaker",
        speakerId: "speaker_1",
        name: "Alice",
      });

      expect(
        await dialogues.getByProjectAndSource("project-b", "media-b"),
      ).toEqual(otherBefore);
    });

    it("refuses to edit a source that has no dialogue", async () => {
      const outcome = await editor.applyEdit(PROJECT, "media-other", {
        type: "update_text",
        segmentId: "t-1",
        text: "x",
      });

      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.code).toBe("DIALOGUE_NOT_FOUND");
    });
  });
});

describe("parseEditOperation", () => {
  it.each([
    [{ type: "update_text", segmentId: "t-1", text: "hi" }],
    [{ type: "rename_speaker", speakerId: "speaker_1", name: "Alice" }],
    [{ type: "reassign_speaker", segmentId: "t-1", speakerId: "speaker_2" }],
    [{ type: "reassign_speaker", segmentId: "t-1", speakerId: null }],
    [
      {
        type: "merge_speakers",
        sourceSpeakerId: "speaker_2",
        targetSpeakerId: "speaker_1",
      },
    ],
    [
      {
        type: "split_segment",
        segmentId: "t-1",
        splitTime: 2,
        firstText: "a",
        secondText: "b",
      },
    ],
    [{ type: "merge_segments", firstSegmentId: "t-1", secondSegmentId: "t-2" }],
    [{ type: "update_timing", segmentId: "t-1", startTime: 0, endTime: 1 }],
  ])("accepts %j", (body) => {
    expect(parseEditOperation(body)).not.toBeNull();
  });

  it.each([
    [null],
    ["nope"],
    [{ type: "unknown" }],
    [{ type: "update_text", segmentId: "t-1" }],
    [{ type: "rename_speaker", speakerId: "speaker_1" }],
    [{ type: "update_timing", segmentId: "t-1", startTime: "0", endTime: 1 }],
    [
      {
        type: "split_segment",
        segmentId: "t-1",
        splitTime: Number.NaN,
        firstText: "a",
        secondText: "b",
      },
    ],
  ])("refuses %j", (body) => {
    expect(parseEditOperation(body)).toBeNull();
  });
});
