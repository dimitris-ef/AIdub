import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { ProcessingError } from "@/server/processing/processing-errors";
import { LocalTemporaryFileManager } from "@/server/processing/temporary-file-manager";

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

describe("LocalTemporaryFileManager", () => {
  let root: string;
  let manager: LocalTemporaryFileManager;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aidub-temp-"));
    manager = new LocalTemporaryFileManager(root);
  });

  it("creates a directory scoped to the job id", async () => {
    const directory = await manager.createJobDirectory("job-1");

    expect(directory).toBe(path.join(root, "jobs", "job-1"));
    await expect(exists(directory)).resolves.toBe(true);
  });

  it("builds paths inside the job directory", async () => {
    const filePath = await manager.createPath("job-1", "extracted-audio.wav");

    expect(filePath).toBe(
      path.join(root, "jobs", "job-1", "extracted-audio.wav"),
    );
  });

  it("removes everything in the job directory on cleanup", async () => {
    const filePath = await manager.createPath("job-1", "source.mp4");
    await writeFile(filePath, "bytes");

    await manager.cleanupJob("job-1");

    await expect(exists(filePath)).resolves.toBe(false);
    await expect(exists(path.join(root, "jobs", "job-1"))).resolves.toBe(false);
  });

  it("cleans up jobs independently", async () => {
    await manager.createPath("job-1", "source.mp4");
    const kept = await manager.createPath("job-2", "source.mp4");
    await writeFile(kept, "bytes");

    await manager.cleanupJob("job-1");

    await expect(exists(path.join(root, "jobs", "job-1"))).resolves.toBe(false);
    await expect(exists(kept)).resolves.toBe(true);
  });

  it("is safe to clean a job that never ran", async () => {
    await expect(manager.cleanupJob("never-created")).resolves.toBeUndefined();
  });

  it.each([
    ["..", ".."],
    ["path traversal", "../../etc"],
    ["a slash", "a/b"],
    ["an empty name", ""],
  ])("refuses %s as a job id", async (_label, jobId) => {
    await expect(manager.createJobDirectory(jobId)).rejects.toBeInstanceOf(
      ProcessingError,
    );
  });

  it.each([
    ["path traversal", "../escape.wav"],
    ["an absolute path", "/etc/passwd"],
    ["a nested path", "sub/dir.wav"],
  ])("refuses %s as a filename", async (_label, filename) => {
    await expect(manager.createPath("job-1", filename)).rejects.toBeInstanceOf(
      ProcessingError,
    );
  });
});
