import { beforeEach, describe, expect, it } from "vitest";

import { canTransition, isTerminalStatus } from "@/types/processing-job";
import type { ProcessingJob } from "@/types/processing-job";
import {
  InvalidJobTransitionError,
  ProcessingJobNotFoundError,
  applyJobUpdate,
  normalizeProgress,
  sortJobsByRecency,
} from "@/server/processing/processing-job-repository";
import { InMemoryProcessingJobRepository } from "@/server/processing/development-job-repository";

const baseJob: ProcessingJob = {
  id: "job-1",
  projectId: "project-1",
  sourceMediaId: "media-1",
  type: "extract_audio",
  status: "queued",
  progress: 0,
  indeterminate: false,
  createdAt: "2026-08-25T10:00:00.000Z",
  updatedAt: "2026-08-25T10:00:00.000Z",
  startedAt: null,
  completedAt: null,
  error: null,
  result: null,
  stage: null,
  providerId: null,
  languageHint: null,
  audioArtifactId: null,
};

describe("job status transitions", () => {
  it.each([
    ["queued", "processing"],
    ["queued", "cancelled"],
    ["queued", "failed"],
    ["processing", "completed"],
    ["processing", "failed"],
    ["processing", "cancelled"],
  ] as const)("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["completed", "processing"],
    ["completed", "failed"],
    ["failed", "completed"],
    ["failed", "processing"],
    ["cancelled", "processing"],
    ["cancelled", "completed"],
    ["processing", "queued"],
  ] as const)("rejects %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("treats completed, failed and cancelled as terminal", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("queued")).toBe(false);
    expect(isTerminalStatus("processing")).toBe(false);
  });
});

describe("progress policy", () => {
  it("pins queued to 0 and completed to 100", () => {
    expect(normalizeProgress("queued", 42, 42)).toBe(0);
    expect(normalizeProgress("completed", 42, 42)).toBe(100);
  });

  it("keeps processing inside 1–99", () => {
    expect(normalizeProgress("processing", 0, 0)).toBe(1);
    expect(normalizeProgress("processing", 100, 4)).toBe(99);
    expect(normalizeProgress("processing", 63.4, 10)).toBe(63);
  });

  it("never moves backwards during a run", () => {
    expect(normalizeProgress("processing", 20, 55)).toBe(55);
  });

  it("keeps the last meaningful value on failure and cancellation", () => {
    expect(normalizeProgress("failed", undefined, 37)).toBe(37);
    expect(normalizeProgress("cancelled", undefined, 37)).toBe(37);
  });
});

describe("applyJobUpdate", () => {
  const now = new Date("2026-08-25T10:05:00.000Z");

  it("stamps startedAt when work begins", () => {
    const updated = applyJobUpdate(baseJob, { status: "processing" }, now);

    expect(updated).toMatchObject({
      status: "processing",
      startedAt: "2026-08-25T10:05:00.000Z",
      completedAt: null,
      updatedAt: "2026-08-25T10:05:00.000Z",
    });
  });

  it("keeps the original startedAt across later updates", () => {
    const started = applyJobUpdate(baseJob, { status: "processing" }, now);
    const progressed = applyJobUpdate(
      started,
      { progress: 40 },
      new Date("2026-08-25T10:06:00.000Z"),
    );

    expect(progressed.startedAt).toBe(started.startedAt);
    expect(progressed.progress).toBe(40);
    expect(progressed.updatedAt).toBe("2026-08-25T10:06:00.000Z");
  });

  it("stamps completedAt on every terminal state", () => {
    const started = applyJobUpdate(baseJob, { status: "processing" }, now);

    for (const status of ["completed", "failed", "cancelled"] as const) {
      const done = applyJobUpdate(started, { status }, now);
      expect(done.completedAt).toBe("2026-08-25T10:05:00.000Z");
    }
  });

  it("refuses an illegal transition", () => {
    const completed = applyJobUpdate(
      applyJobUpdate(baseJob, { status: "processing" }, now),
      { status: "completed" },
      now,
    );

    expect(() =>
      applyJobUpdate(completed, { status: "processing" }, now),
    ).toThrowError(InvalidJobTransitionError);
  });
});

describe("InMemoryProcessingJobRepository", () => {
  let repository: InMemoryProcessingJobRepository;
  let counter: number;

  beforeEach(() => {
    counter = 0;
    repository = new InMemoryProcessingJobRepository({
      createId: () => `job-${++counter}`,
      now: () => new Date(2026, 7, 25, 10, counter),
    });
  });

  it("creates queued jobs with zero progress", async () => {
    const job = await repository.create({
      projectId: "project-1",
      sourceMediaId: "media-1",
      type: "probe_media",
    });

    expect(job).toMatchObject({
      id: "job-1",
      status: "queued",
      progress: 0,
      startedAt: null,
      completedAt: null,
      error: null,
      result: null,
    });
  });

  it("lists by project and by media, newest first", async () => {
    const first = await repository.create({
      projectId: "project-1",
      sourceMediaId: "media-1",
      type: "probe_media",
    });
    const second = await repository.create({
      projectId: "project-1",
      sourceMediaId: "media-2",
      type: "extract_audio",
    });
    const other = await repository.create({
      projectId: "project-2",
      sourceMediaId: "media-3",
      type: "probe_media",
    });

    await expect(repository.listByProject("project-1")).resolves.toMatchObject([
      { id: second.id },
      { id: first.id },
    ]);
    await expect(repository.listByMedia("media-1")).resolves.toMatchObject([
      { id: first.id },
    ]);
    await expect(repository.listByProject("project-2")).resolves.toMatchObject([
      { id: other.id },
    ]);
  });

  it("throws for an unknown job", async () => {
    await expect(
      repository.update("nope", { status: "processing" }),
    ).rejects.toBeInstanceOf(ProcessingJobNotFoundError);
  });

  it("deletes every job for one project only", async () => {
    await repository.create({
      projectId: "project-1",
      sourceMediaId: "media-1",
      type: "probe_media",
    });
    await repository.create({
      projectId: "project-2",
      sourceMediaId: "media-2",
      type: "probe_media",
    });

    await repository.deleteByProject("project-1");

    await expect(repository.listByProject("project-1")).resolves.toEqual([]);
    await expect(repository.listByProject("project-2")).resolves.toHaveLength(1);
  });
});

describe("sortJobsByRecency", () => {
  it("puts the newest job first without mutating the input", () => {
    const older = { ...baseJob, id: "a" };
    const newer = { ...baseJob, id: "b", createdAt: "2026-08-25T11:00:00.000Z" };
    const input = [older, newer];

    expect(sortJobsByRecency(input).map((job) => job.id)).toEqual(["b", "a"]);
    expect(input.map((job) => job.id)).toEqual(["a", "b"]);
  });
});
