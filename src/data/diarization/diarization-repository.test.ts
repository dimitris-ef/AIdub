import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { DiarizationResult } from "@/types/diarization";
import {
  DIARIZATION_SCHEMA_VERSION,
  DevelopmentDiarizationRepository,
} from "@/data/diarization/development-diarization-repository";
import {
  DiarizationStorageError,
  parseStoredDiarization,
} from "@/data/diarization/diarization-repository";

function buildResult(
  overrides: Partial<DiarizationResult> = {},
): DiarizationResult {
  return {
    id: "diar-1",
    projectId: "project-a",
    sourceMediaId: "media-a",
    audioArtifactId: "artifact-a",
    providerId: "mock",
    providerModel: "mock-diarizer-1",
    status: "completed",
    speakers: [
      {
        id: "speaker_1",
        label: "Speaker 1",
        confidence: null,
        providerMetadata: { rawSpeakerLabel: "B" },
      },
      {
        id: "speaker_2",
        label: "Speaker 2",
        confidence: 0.9,
        providerMetadata: { rawSpeakerLabel: "A" },
      },
    ],
    regions: [
      {
        id: "region-1",
        speakerId: "speaker_1",
        startTime: 0,
        endTime: 3,
        confidence: 0.93,
        overlap: false,
      },
      {
        id: "region-2",
        speakerId: "speaker_2",
        startTime: 3,
        endTime: 6.5,
        confidence: null,
        overlap: true,
      },
    ],
    createdAt: "2026-08-26T10:00:00.000Z",
    updatedAt: "2026-08-26T10:00:00.000Z",
    ...overrides,
  };
}

describe("DevelopmentDiarizationRepository", () => {
  let root: string;
  let repository: DevelopmentDiarizationRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aidub-diar-"));
    repository = new DevelopmentDiarizationRepository(root);
  });

  it("round-trips a result with its speakers and regions intact", async () => {
    const saved = buildResult();
    await repository.save(saved);

    const loaded = await repository.getByProjectAndSource(
      "project-a",
      "media-a",
    );

    expect(loaded).toEqual(saved);
  });

  it("keeps speaker and region ids stable across a reload", async () => {
    const saved = buildResult();
    await repository.save(saved);

    // A fresh repository instance: nothing is cached, everything is re-read.
    const reloaded = await new DevelopmentDiarizationRepository(
      root,
    ).getByProjectAndSource("project-a", "media-a");

    expect(reloaded?.speakers.map((speaker) => speaker.id)).toEqual([
      "speaker_1",
      "speaker_2",
    ]);
    expect(reloaded?.regions.map((region) => region.id)).toEqual([
      "region-1",
      "region-2",
    ]);
    expect(reloaded?.regions.map((region) => region.speakerId)).toEqual([
      "speaker_1",
      "speaker_2",
    ]);
    // Ids are read back, never regenerated on load.
    expect(reloaded).toEqual(saved);
  });

  it("only returns a result for the exact source media it belongs to", async () => {
    await repository.save(buildResult());

    await expect(
      repository.getByProjectAndSource("project-a", "media-b"),
    ).resolves.toBeNull();
    await expect(
      repository.getByProjectAndSource("project-b", "media-a"),
    ).resolves.toBeNull();
  });

  it("isolates projects from each other", async () => {
    await repository.save(buildResult());
    await repository.save(
      buildResult({ id: "diar-2", projectId: "project-b", sourceMediaId: "media-b" }),
    );

    const a = await repository.getByProjectAndSource("project-a", "media-a");
    const b = await repository.getByProjectAndSource("project-b", "media-b");

    expect(a?.id).toBe("diar-1");
    expect(b?.id).toBe("diar-2");

    await repository.deleteByProject("project-a");

    expect(await repository.getByProjectAndSource("project-a", "media-a")).toBeNull();
    // Deleting one project leaves the other untouched.
    expect((await repository.getByProjectAndSource("project-b", "media-b"))?.id).toBe(
      "diar-2",
    );
  });

  it("returns the newest result when several exist for one source", async () => {
    await repository.save(buildResult());
    await repository.save(
      buildResult({ id: "diar-new", updatedAt: "2026-08-26T12:00:00.000Z" }),
    );

    const active = await repository.getByProjectAndSource(
      "project-a",
      "media-a",
    );

    expect(active?.id).toBe("diar-new");
  });

  it("deletes by id, by media and by project", async () => {
    await repository.save(buildResult());
    await repository.delete("diar-1");
    expect(await repository.getById("diar-1")).toBeNull();

    await repository.save(buildResult());
    await repository.deleteByMedia("project-a", "media-a");
    expect(await repository.getByProjectAndSource("project-a", "media-a")).toBeNull();

    await repository.save(buildResult());
    await repository.deleteByProject("project-a");
    expect(await repository.listByProject("project-a")).toEqual([]);
  });

  it("writes under a versioned path so the schema can evolve", async () => {
    const versioned = new DevelopmentDiarizationRepository(
      path.join(root, DIARIZATION_SCHEMA_VERSION),
    );
    await versioned.save(buildResult());

    const entries = await readdir(path.join(root, DIARIZATION_SCHEMA_VERSION));

    expect(entries).toContain("project-a");
    expect(DIARIZATION_SCHEMA_VERSION).toBe("v1");
  });

  it("skips a corrupt file instead of failing the whole lookup", async () => {
    await repository.save(buildResult());
    await writeFile(path.join(root, "project-a", "broken.json"), "{ not json");

    const results = await repository.listByProject("project-a");

    expect(results.map((result) => result.id)).toEqual(["diar-1"]);
  });

  it("refuses identifiers that could escape the store", async () => {
    // A write is rejected outright; a read simply finds nothing, so a crafted
    // id can neither reach nor create a file outside the store.
    await expect(
      repository.save(buildResult({ projectId: "../escape" })),
    ).rejects.toBeInstanceOf(DiarizationStorageError);
    await expect(
      repository.getByProjectAndSource("../escape", "media-a"),
    ).resolves.toBeNull();
    await expect(repository.listByProject("../escape")).resolves.toEqual([]);
  });
});

describe("parseStoredDiarization", () => {
  it("accepts a well-formed record", () => {
    expect(parseStoredDiarization(buildResult())).toEqual(buildResult());
  });

  it.each([
    ["a missing project", { projectId: undefined }],
    ["a missing source media", { sourceMediaId: undefined }],
    ["an unknown status", { status: "weird" }],
    ["non-array speakers", { speakers: "nope" }],
    ["non-array regions", { regions: "nope" }],
  ])("rejects %s", (_label, overrides) => {
    expect(
      parseStoredDiarization({ ...buildResult(), ...overrides }),
    ).toBeNull();
  });

  it("rejects a record whose speaker id is a raw provider label", () => {
    const record = buildResult();
    record.speakers[0].id = "SPEAKER_00";

    expect(parseStoredDiarization(record)).toBeNull();
  });

  it("rejects a region that points at a speaker that does not exist", () => {
    const record = buildResult();
    record.regions[0].speakerId = "speaker_9";

    expect(parseStoredDiarization(record)).toBeNull();
  });

  it.each([
    ["a negative start", { startTime: -1 }],
    ["an end before its start", { startTime: 5, endTime: 2 }],
    ["a non-finite time", { endTime: Number.NaN }],
    ["a missing id", { id: "" }],
  ])("rejects a region with %s", (_label, overrides) => {
    const record = buildResult();
    record.regions[0] = { ...record.regions[0], ...overrides };

    expect(parseStoredDiarization(record)).toBeNull();
  });
});
