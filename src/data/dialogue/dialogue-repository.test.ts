import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { UnifiedDialogue } from "@/types/dialogue";
import {
  DIALOGUE_STORAGE_VERSION,
  DevelopmentDialogueRepository,
} from "@/data/dialogue/development-dialogue-repository";
import {
  DialogueStorageError,
  parseStoredDialogue,
} from "@/data/dialogue/dialogue-repository";
import {
  DIALOGUE_SCHEMA_VERSION,
  MERGE_ALGORITHM_VERSION,
  DEFAULT_MERGE_CONFIG,
} from "@/lib/dialogue/merge-config";

function buildDialogue(
  overrides: Partial<UnifiedDialogue> = {},
): UnifiedDialogue {
  return {
    id: "dialogue-1",
    projectId: "project-a",
    sourceMediaId: "media-a",
    transcriptId: "transcript-a",
    diarizationId: "diarization-a",
    version: DIALOGUE_SCHEMA_VERSION,
    status: "completed",
    segments: [
      {
        id: "t-1",
        speakerId: "speaker_1",
        startTime: 0,
        endTime: 3.5,
        originalText: "Hello and welcome.",
        transcription: {
          transcriptId: "transcript-a",
          transcriptSegmentId: "t-1",
          confidence: null,
          status: "completed",
          providerId: "stt",
          providerModel: "stt-model",
        },
        diarization: {
          diarizationId: "diarization-a",
          regionIds: ["r-1"],
          confidence: null,
          overlap: false,
          candidateSpeakers: [
            { speakerId: "speaker_1", overlapDuration: 3.5, overlapRatio: 1 },
          ],
          providerId: "diarizer",
          providerModel: "diarizer-model",
        },
        assignment: {
          method: "single_overlap",
          confidence: 1,
          overlapRatio: 1,
          uncertain: false,
          reason: null,
        },
      },
      {
        id: "t-2",
        speakerId: null,
        startTime: 4,
        endTime: 6,
        originalText: "Nobody could be matched to this.",
        transcription: {
          transcriptId: "transcript-a",
          transcriptSegmentId: "t-2",
          confidence: null,
          status: "completed",
          providerId: "stt",
          providerModel: "stt-model",
        },
        diarization: {
          diarizationId: "diarization-a",
          regionIds: [],
          confidence: null,
          overlap: false,
          candidateSpeakers: [],
          providerId: "diarizer",
          providerModel: "diarizer-model",
        },
        assignment: {
          method: "unassigned",
          confidence: null,
          overlapRatio: null,
          uncertain: true,
          reason: "no_nearby_speaker",
        },
      },
    ],
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z",
    mergeMetadata: {
      algorithmVersion: MERGE_ALGORITHM_VERSION,
      transcriptId: "transcript-a",
      diarizationId: "diarization-a",
      generatedAt: "2026-08-27T10:00:00.000Z",
      config: { ...DEFAULT_MERGE_CONFIG },
      ambiguousSegmentCount: 1,
      overlappingSegmentCount: 0,
      unassignedSegmentCount: 1,
    },
    ...overrides,
  };
}

describe("DevelopmentDialogueRepository", () => {
  let root: string;
  let repository: DevelopmentDialogueRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aidub-dialogue-store-"));
    repository = new DevelopmentDialogueRepository(root);
  });

  it("round-trips a dialogue with its segments and metadata intact", async () => {
    const saved = buildDialogue();
    await repository.save(saved);

    expect(
      await repository.getByProjectAndSource("project-a", "media-a"),
    ).toEqual(saved);
  });

  it("keeps segment ids and assignments stable across a reload", async () => {
    await repository.save(buildDialogue());

    const reloaded = await new DevelopmentDialogueRepository(
      root,
    ).getByProjectAndSource("project-a", "media-a");

    expect(reloaded?.segments.map((s) => s.id)).toEqual(["t-1", "t-2"]);
    expect(reloaded?.segments.map((s) => s.speakerId)).toEqual([
      "speaker_1",
      null,
    ]);
    expect(reloaded?.transcriptId).toBe("transcript-a");
    expect(reloaded?.diarizationId).toBe("diarization-a");
  });

  it("only returns a dialogue for the exact source it belongs to", async () => {
    await repository.save(buildDialogue());

    await expect(
      repository.getByProjectAndSource("project-a", "media-b"),
    ).resolves.toBeNull();
    await expect(
      repository.getByProjectAndSource("project-b", "media-a"),
    ).resolves.toBeNull();
  });

  it("isolates projects and deletes independently", async () => {
    await repository.save(buildDialogue());
    await repository.save(
      buildDialogue({
        id: "dialogue-2",
        projectId: "project-b",
        sourceMediaId: "media-b",
      }),
    );

    await repository.deleteByProject("project-a");

    expect(
      await repository.getByProjectAndSource("project-a", "media-a"),
    ).toBeNull();
    expect(
      (await repository.getByProjectAndSource("project-b", "media-b"))?.id,
    ).toBe("dialogue-2");
  });

  it("returns the newest dialogue when several exist for one source", async () => {
    await repository.save(buildDialogue());
    await repository.save(
      buildDialogue({
        id: "dialogue-new",
        updatedAt: "2026-08-27T12:00:00.000Z",
      }),
    );

    expect(
      (await repository.getByProjectAndSource("project-a", "media-a"))?.id,
    ).toBe("dialogue-new");
  });

  it("deletes by id and by media", async () => {
    await repository.save(buildDialogue());
    await repository.delete("dialogue-1");
    expect(await repository.getById("dialogue-1")).toBeNull();

    await repository.save(buildDialogue());
    await repository.deleteByMedia("project-a", "media-a");
    expect(
      await repository.getByProjectAndSource("project-a", "media-a"),
    ).toBeNull();
  });

  it("writes under a versioned path so the schema can evolve", async () => {
    const versioned = new DevelopmentDialogueRepository(
      path.join(root, DIALOGUE_STORAGE_VERSION),
    );
    await versioned.save(buildDialogue());

    expect(await readdir(path.join(root, DIALOGUE_STORAGE_VERSION))).toContain(
      "project-a",
    );
  });

  it("skips a corrupt file instead of failing the whole lookup", async () => {
    await repository.save(buildDialogue());
    await writeFile(path.join(root, "project-a", "broken.json"), "{ not json");

    expect(
      (await repository.listByProject("project-a")).map((d) => d.id),
    ).toEqual(["dialogue-1"]);
  });

  it("refuses identifiers that could escape the store", async () => {
    await expect(
      repository.save(buildDialogue({ projectId: "../escape" })),
    ).rejects.toBeInstanceOf(DialogueStorageError);
    await expect(
      repository.getByProjectAndSource("../escape", "media-a"),
    ).resolves.toBeNull();
  });
});

describe("parseStoredDialogue", () => {
  it("accepts a well-formed record", () => {
    expect(parseStoredDialogue(buildDialogue())).toEqual(buildDialogue());
  });

  it.each([
    ["a missing project", { projectId: undefined }],
    ["a missing transcript reference", { transcriptId: undefined }],
    ["a missing diarization reference", { diarizationId: undefined }],
    ["a non-integer version", { version: 1.5 }],
    ["an unknown status", { status: "weird" }],
    ["non-array segments", { segments: "nope" }],
    ["missing merge metadata", { mergeMetadata: undefined }],
  ])("rejects %s", (_label, overrides) => {
    expect(parseStoredDialogue({ ...buildDialogue(), ...overrides })).toBeNull();
  });

  it("rejects metadata that describes different raw inputs", () => {
    const record = buildDialogue();

    expect(
      parseStoredDialogue({
        ...record,
        mergeMetadata: {
          ...record.mergeMetadata,
          transcriptId: "transcript-other",
        },
      }),
    ).toBeNull();
  });

  it("rejects a segment whose speaker id is not canonical", () => {
    const record = buildDialogue();
    record.segments[0].speakerId = "SPEAKER_00";

    expect(parseStoredDialogue(record)).toBeNull();
  });

  it("rejects an assigned segment marked unassigned, and vice versa", () => {
    const assignedButUnassigned = buildDialogue();
    assignedButUnassigned.segments[0].assignment.method = "unassigned";

    expect(parseStoredDialogue(assignedButUnassigned)).toBeNull();

    const unassignedButAssigned = buildDialogue();
    unassignedButAssigned.segments[1].speakerId = "speaker_1";

    expect(parseStoredDialogue(unassignedButAssigned)).toBeNull();
  });

  it("rejects a segment that traces to a different transcript", () => {
    const record = buildDialogue();
    record.segments[0].transcription.transcriptId = "transcript-other";

    expect(parseStoredDialogue(record)).toBeNull();
  });

  it("rejects a segment that traces to a different diarization", () => {
    const record = buildDialogue();
    record.segments[0].diarization.diarizationId = "diarization-other";

    expect(parseStoredDialogue(record)).toBeNull();
  });

  it("rejects a segment with no transcript segment reference", () => {
    const record = buildDialogue();
    record.segments[0].transcription.transcriptSegmentId = "";

    expect(parseStoredDialogue(record)).toBeNull();
  });

  it("rejects a candidate speaker using a raw provider label", () => {
    const record = buildDialogue();
    record.segments[0].diarization.candidateSpeakers = [
      { speakerId: "cluster_2", overlapDuration: 1, overlapRatio: 0.5 },
    ];

    expect(parseStoredDialogue(record)).toBeNull();
  });

  it.each([
    ["a negative start", { startTime: -1 }],
    ["an end before its start", { startTime: 5, endTime: 2 }],
    ["a non-finite time", { endTime: Number.NaN }],
    ["a missing id", { id: "" }],
  ])("rejects a segment with %s", (_label, overrides) => {
    const record = buildDialogue();
    record.segments[0] = { ...record.segments[0], ...overrides };

    expect(parseStoredDialogue(record)).toBeNull();
  });
});
