import { mkdtemp, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { Transcript } from "@/types/transcript";
import { DevelopmentTranscriptRepository } from "@/data/transcripts/development-transcript-repository";
import { parseStoredTranscript } from "@/data/transcripts/transcript-repository";

function transcript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    id: "transcript-1",
    projectId: "project-a",
    sourceMediaId: "media-1",
    audioArtifactId: "artifact-1",
    providerId: "mock",
    providerModel: "mock-1",
    language: "en",
    status: "completed",
    segments: [
      {
        id: "segment-1",
        startTime: 0,
        endTime: 1.5,
        originalText: "Hello world.",
        status: "completed",
        confidence: 0.95,
        providerMetadata: { model: "mock-1" },
      },
      {
        id: "segment-2",
        startTime: 1.5,
        endTime: 3.2,
        originalText: "This is a test.",
        status: "completed",
        confidence: null,
      },
    ],
    createdAt: "2026-08-26T10:00:00.000Z",
    updatedAt: "2026-08-26T10:00:00.000Z",
    ...overrides,
  };
}

describe("DevelopmentTranscriptRepository", () => {
  let root: string;
  let repository: DevelopmentTranscriptRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aidub-transcripts-"));
    repository = new DevelopmentTranscriptRepository(root);
  });

  it("returns null before anything is saved", async () => {
    await expect(
      repository.getByProject("project-a", "media-1"),
    ).resolves.toBeNull();
  });

  it("saves and reloads a transcript through a fresh repository instance", async () => {
    const saved = transcript();
    await repository.save(saved);

    // A new instance reads from storage, not from memory.
    const reloaded = new DevelopmentTranscriptRepository(root);
    const found = await reloaded.getByProject("project-a", "media-1");

    expect(found).toEqual(saved);
    // Segment ids, timings and text survive the round trip unchanged.
    expect(found?.segments.map((segment) => segment.id)).toEqual([
      "segment-1",
      "segment-2",
    ]);
    expect(found?.segments[0]).toMatchObject({
      startTime: 0,
      endTime: 1.5,
      originalText: "Hello world.",
      confidence: 0.95,
    });
  });

  it("finds a transcript by id", async () => {
    await repository.save(transcript());

    await expect(repository.getById("transcript-1")).resolves.toMatchObject({
      id: "transcript-1",
    });
    await expect(repository.getById("nope")).resolves.toBeNull();
  });

  it("keeps transcripts of different source versions apart", async () => {
    await repository.save(transcript({ id: "t-v1", sourceMediaId: "media-1" }));
    await repository.save(transcript({ id: "t-v2", sourceMediaId: "media-2" }));

    await expect(
      repository.getByProject("project-a", "media-1"),
    ).resolves.toMatchObject({ id: "t-v1" });
    await expect(
      repository.getByProject("project-a", "media-2"),
    ).resolves.toMatchObject({ id: "t-v2" });
  });

  it("never returns another project's transcript", async () => {
    await repository.save(transcript({ id: "t-a", projectId: "project-a" }));
    await repository.save(
      transcript({ id: "t-b", projectId: "project-b", sourceMediaId: "media-1" }),
    );

    await expect(
      repository.getByProject("project-b", "media-1"),
    ).resolves.toMatchObject({ id: "t-b" });
    await expect(repository.listByProject("project-a")).resolves.toHaveLength(1);
  });

  it("prefers the most recently updated transcript for a source", async () => {
    await repository.save(transcript({ id: "older" }));
    await repository.save(
      transcript({ id: "newer", updatedAt: "2026-08-26T12:00:00.000Z" }),
    );

    await expect(
      repository.getByProject("project-a", "media-1"),
    ).resolves.toMatchObject({ id: "newer" });
  });

  it("deletes one transcript, a source's transcripts, or a whole project", async () => {
    await repository.save(transcript({ id: "t-1", sourceMediaId: "media-1" }));
    await repository.save(transcript({ id: "t-2", sourceMediaId: "media-2" }));
    await repository.save(transcript({ id: "t-3", projectId: "project-b" }));

    await repository.delete("t-1");
    await expect(repository.getById("t-1")).resolves.toBeNull();

    await repository.deleteByMedia("project-a", "media-2");
    await expect(repository.listByProject("project-a")).resolves.toEqual([]);

    await repository.deleteByProject("project-b");
    await expect(repository.listByProject("project-b")).resolves.toEqual([]);
  });

  it("writes under a versioned, project-scoped layout", async () => {
    await repository.save(transcript());

    await expect(readdir(root)).resolves.toEqual(["project-a"]);
    await expect(readdir(path.join(root, "project-a"))).resolves.toEqual([
      "transcript-1.json",
    ]);
  });

  it("skips malformed stored data instead of crashing", async () => {
    await repository.save(transcript());
    await mkdir(path.join(root, "project-a"), { recursive: true });
    await writeFile(path.join(root, "project-a", "broken.json"), "{not json");
    await writeFile(
      path.join(root, "project-a", "invalid.json"),
      JSON.stringify({ id: "x", projectId: "project-a" }),
    );

    await expect(repository.listByProject("project-a")).resolves.toHaveLength(1);
    await expect(
      repository.getByProject("project-a", "media-1"),
    ).resolves.toMatchObject({ id: "transcript-1" });
  });

  it("rejects unsafe identifiers", async () => {
    await expect(
      repository.save(transcript({ projectId: "../escape" })),
    ).rejects.toThrowError();
  });
});

describe("parseStoredTranscript", () => {
  it("accepts a well-formed transcript", () => {
    expect(parseStoredTranscript(transcript())).toEqual(transcript());
  });

  it.each([
    ["null", null],
    ["a missing id", { ...transcript(), id: "" }],
    ["a missing project", { ...transcript(), projectId: "" }],
    ["a missing source media", { ...transcript(), sourceMediaId: "" }],
    ["an unknown status", { ...transcript(), status: "weird" }],
    ["segments that are not an array", { ...transcript(), segments: {} }],
    [
      "a segment without an id",
      {
        ...transcript(),
        segments: [
          { startTime: 0, endTime: 1, originalText: "x", status: "completed" },
        ],
      },
    ],
    [
      "a segment with a broken timestamp",
      {
        ...transcript(),
        segments: [
          {
            id: "s",
            startTime: Number.NaN,
            endTime: 1,
            originalText: "x",
            status: "completed",
            confidence: null,
          },
        ],
      },
    ],
    [
      "a segment whose text is not a string",
      {
        ...transcript(),
        segments: [
          {
            id: "s",
            startTime: 0,
            endTime: 1,
            originalText: 5,
            status: "completed",
            confidence: null,
          },
        ],
      },
    ],
  ])("rejects %s", (_label, value) => {
    expect(parseStoredTranscript(value)).toBeNull();
  });
});
