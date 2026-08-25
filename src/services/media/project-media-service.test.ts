import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectMedia } from "@/types/media";
import type { Project } from "@/types/project";
import {
  LocalProjectRepository,
  type KeyValueStorage,
} from "@/data/projects/local-project-repository";
import { MediaStorageError, type MediaStorage } from "@/data/media";
import { VideoMetadataError } from "@/lib/media/extract-video-metadata";
import {
  MediaCleanupError,
  MediaValidationError,
  createProjectMediaService,
  toMediaErrorMessage,
} from "@/services/media/project-media-service";
import { deleteProjectWithMedia } from "@/services/projects/delete-project";

class MemoryKeyValueStorage implements KeyValueStorage {
  private readonly entries = new Map<string, string>();

  getItem(key: string) {
    return this.entries.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.entries.set(key, value);
  }
  removeItem(key: string) {
    this.entries.delete(key);
  }
}

/** In-memory `MediaStorage` with injectable failures. */
class FakeMediaStorage implements MediaStorage {
  readonly metadata = new Map<string, ProjectMedia>();
  readonly blobs = new Map<string, Blob>();
  failSave: Error | null = null;
  failDelete: Error | null = null;

  async save(media: ProjectMedia, blob: Blob) {
    if (this.failSave) throw this.failSave;
    this.metadata.set(media.id, media);
    this.blobs.set(media.id, blob);
  }
  async getMetadata(mediaId: string) {
    return this.metadata.get(mediaId) ?? null;
  }
  async getBlob(mediaId: string) {
    return this.blobs.get(mediaId) ?? null;
  }
  async listByProject(projectId: string) {
    return [...this.metadata.values()].filter(
      (media) => media.projectId === projectId,
    );
  }
  async delete(mediaId: string) {
    if (this.failDelete) throw this.failDelete;
    this.metadata.delete(mediaId);
    this.blobs.delete(mediaId);
  }
  async deleteByProject(projectId: string) {
    if (this.failDelete) throw this.failDelete;
    for (const media of await this.listByProject(projectId)) {
      this.metadata.delete(media.id);
      this.blobs.delete(media.id);
    }
  }
}

const videoFile = (name = "interview.mp4", type = "video/mp4", size = 2_000) =>
  new File([new Uint8Array(size)], name, { type });

function createHarness() {
  const storage = new FakeMediaStorage();
  const repository = new LocalProjectRepository({
    storage: new MemoryKeyValueStorage(),
    createId: (() => {
      let counter = 0;
      return () => `project-${++counter}`;
    })(),
  });

  let clock = Date.parse("2026-08-25T10:00:00.000Z");
  let mediaCounter = 0;

  const extractMetadata = vi.fn(async () => ({
    durationSeconds: 92.5,
    width: 1920,
    height: 1080,
  }));

  const service = createProjectMediaService({
    repository,
    storage,
    extractMetadata,
    createId: () => `media-${++mediaCounter}`,
    now: () => new Date(clock),
    logger: () => {},
  });

  return {
    storage,
    repository,
    service,
    extractMetadata,
    advance: (ms: number) => {
      clock += ms;
    },
    async createProject(name = "Travel Documentary"): Promise<Project> {
      return repository.create({
        name,
        sourceLanguage: "en",
        targetLanguage: "pl",
      });
    },
  };
}

describe("ProjectMediaService", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  describe("import", () => {
    it("stores media, associates it and marks the project ready", async () => {
      const project = await harness.createProject();
      expect(project.status).toBe("draft");
      harness.advance(60_000);

      const media = await harness.service.importSourceVideo(
        project.id,
        videoFile(),
      );

      expect(media).toMatchObject({
        id: "media-1",
        projectId: project.id,
        kind: "video",
        filename: "interview.mp4",
        mimeType: "video/mp4",
        container: "MP4",
        sizeBytes: 2_000,
        durationSeconds: 92.5,
        width: 1920,
        height: 1080,
      });

      const updated = await harness.repository.getById(project.id);
      expect(updated).toMatchObject({
        sourceMediaId: "media-1",
        status: "ready",
      });
      expect(Date.parse(updated!.updatedAt)).toBeGreaterThan(
        Date.parse(project.updatedAt),
      );
      expect(harness.storage.blobs.get("media-1")).toBeInstanceOf(Blob);
    });

    it("detects the container from a MOV file with no MIME type", async () => {
      const project = await harness.createProject();

      const media = await harness.service.importSourceVideo(
        project.id,
        videoFile("interview.mov", ""),
      );

      expect(media.container).toBe("MOV");
    });

    it("accepts WebM", async () => {
      const project = await harness.createProject();

      const media = await harness.service.importSourceVideo(
        project.id,
        videoFile("screen.webm", "video/webm"),
      );

      expect(media.container).toBe("WebM");
    });

    it("rejects an unsupported file without touching storage or project", async () => {
      const project = await harness.createProject();

      await expect(
        harness.service.importSourceVideo(
          project.id,
          videoFile("notes.txt", "text/plain"),
        ),
      ).rejects.toBeInstanceOf(MediaValidationError);

      expect(harness.storage.metadata.size).toBe(0);
      await expect(
        harness.repository.getById(project.id),
      ).resolves.toMatchObject({ sourceMediaId: null, status: "draft" });
    });

    it("rejects a zero-byte file", async () => {
      const project = await harness.createProject();

      await expect(
        harness.service.importSourceVideo(
          project.id,
          videoFile("clip.mp4", "video/mp4", 0),
        ),
      ).rejects.toBeInstanceOf(MediaValidationError);
      expect(harness.extractMetadata).not.toHaveBeenCalled();
    });

    it("rejects a file the browser cannot decode", async () => {
      const project = await harness.createProject();
      harness.extractMetadata.mockRejectedValueOnce(
        new VideoMetadataError("unreadable", "unreadable"),
      );

      await expect(
        harness.service.importSourceVideo(project.id, videoFile()),
      ).rejects.toBeInstanceOf(VideoMetadataError);

      expect(harness.storage.metadata.size).toBe(0);
      await expect(
        harness.repository.getById(project.id),
      ).resolves.toMatchObject({ sourceMediaId: null, status: "draft" });
    });

    it("surfaces a storage quota failure and stores nothing", async () => {
      const project = await harness.createProject();
      harness.storage.failSave = new MediaStorageError("quota", "no room");

      await expect(
        harness.service.importSourceVideo(project.id, videoFile()),
      ).rejects.toBeInstanceOf(MediaStorageError);

      await expect(
        harness.repository.getById(project.id),
      ).resolves.toMatchObject({ sourceMediaId: null, status: "draft" });
    });

    it("removes the stored media when the project update fails", async () => {
      const project = await harness.createProject();
      vi.spyOn(harness.repository, "update").mockRejectedValueOnce(
        new Error("write failed"),
      );

      await expect(
        harness.service.importSourceVideo(project.id, videoFile()),
      ).rejects.toThrow("write failed");

      // No orphaned blob left behind.
      expect(harness.storage.metadata.size).toBe(0);
      expect(harness.storage.blobs.size).toBe(0);
    });

    it("refuses to import into a project that does not exist", async () => {
      await expect(
        harness.service.importSourceVideo("missing", videoFile()),
      ).rejects.toBeInstanceOf(MediaValidationError);
    });
  });

  describe("replace", () => {
    it("swaps the media, keeps status ready and deletes the old copy", async () => {
      const project = await harness.createProject();
      const first = await harness.service.importSourceVideo(
        project.id,
        videoFile(),
      );

      const second = await harness.service.replaceSourceVideo(
        project.id,
        videoFile("second.webm", "video/webm"),
      );

      expect(second.id).not.toBe(first.id);
      await expect(
        harness.repository.getById(project.id),
      ).resolves.toMatchObject({ sourceMediaId: second.id, status: "ready" });
      expect(harness.storage.metadata.has(first.id)).toBe(false);
      expect(harness.storage.blobs.has(first.id)).toBe(false);
      expect(harness.storage.blobs.has(second.id)).toBe(true);
    });

    it("keeps the previous source when the new file is invalid", async () => {
      const project = await harness.createProject();
      const first = await harness.service.importSourceVideo(
        project.id,
        videoFile(),
      );

      await expect(
        harness.service.replaceSourceVideo(
          project.id,
          videoFile("notes.txt", "text/plain"),
        ),
      ).rejects.toBeInstanceOf(MediaValidationError);

      await expect(
        harness.repository.getById(project.id),
      ).resolves.toMatchObject({ sourceMediaId: first.id, status: "ready" });
      expect(harness.storage.blobs.has(first.id)).toBe(true);
      await expect(
        harness.service.getSourceMedia(project.id),
      ).resolves.toMatchObject({ id: first.id });
    });

    it("keeps the previous source when storing the new file fails", async () => {
      const project = await harness.createProject();
      const first = await harness.service.importSourceVideo(
        project.id,
        videoFile(),
      );
      harness.storage.failSave = new MediaStorageError("quota", "no room");

      await expect(
        harness.service.replaceSourceVideo(project.id, videoFile("new.mp4")),
      ).rejects.toBeInstanceOf(MediaStorageError);

      await expect(
        harness.repository.getById(project.id),
      ).resolves.toMatchObject({ sourceMediaId: first.id, status: "ready" });
      expect(harness.storage.blobs.has(first.id)).toBe(true);
    });

    it("still succeeds when the old copy cannot be deleted", async () => {
      const project = await harness.createProject();
      await harness.service.importSourceVideo(project.id, videoFile());
      harness.storage.failDelete = new MediaStorageError("delete", "locked");

      const second = await harness.service.replaceSourceVideo(
        project.id,
        videoFile("second.mp4"),
      );

      await expect(
        harness.repository.getById(project.id),
      ).resolves.toMatchObject({ sourceMediaId: second.id, status: "ready" });
    });

    it("imports when the project has no previous source", async () => {
      const project = await harness.createProject();

      const media = await harness.service.replaceSourceVideo(
        project.id,
        videoFile(),
      );

      await expect(
        harness.repository.getById(project.id),
      ).resolves.toMatchObject({ sourceMediaId: media.id, status: "ready" });
    });
  });

  describe("remove", () => {
    it("detaches the project, resets status and deletes the media", async () => {
      const project = await harness.createProject();
      const media = await harness.service.importSourceVideo(
        project.id,
        videoFile(),
      );

      await harness.service.removeSourceVideo(project.id);

      await expect(
        harness.repository.getById(project.id),
      ).resolves.toMatchObject({ sourceMediaId: null, status: "draft" });
      expect(harness.storage.metadata.has(media.id)).toBe(false);
      expect(harness.storage.blobs.has(media.id)).toBe(false);
      await expect(
        harness.service.getSourceMedia(project.id),
      ).resolves.toBeNull();
    });

    it("detaches the project even when the stored copy cannot be deleted", async () => {
      const project = await harness.createProject();
      await harness.service.importSourceVideo(project.id, videoFile());
      harness.storage.failDelete = new MediaStorageError("delete", "locked");

      await expect(
        harness.service.removeSourceVideo(project.id),
      ).rejects.toBeInstanceOf(MediaCleanupError);

      await expect(
        harness.repository.getById(project.id),
      ).resolves.toMatchObject({ sourceMediaId: null, status: "draft" });
    });

    it("is a no-op for a project with no source", async () => {
      const project = await harness.createProject();

      await expect(
        harness.service.removeSourceVideo(project.id),
      ).resolves.toBeUndefined();
    });
  });

  describe("reading the source", () => {
    it("returns null when the project has no media", async () => {
      const project = await harness.createProject();

      await expect(
        harness.service.getSourceMedia(project.id),
      ).resolves.toBeNull();
    });

    it("returns null when the stored metadata is gone", async () => {
      const project = await harness.createProject();
      const media = await harness.service.importSourceVideo(
        project.id,
        videoFile(),
      );
      harness.storage.metadata.delete(media.id);

      await expect(
        harness.service.getSourceMedia(project.id),
      ).resolves.toBeNull();
    });

    it("returns null when the bytes are gone but keeps the metadata", async () => {
      const project = await harness.createProject();
      const media = await harness.service.importSourceVideo(
        project.id,
        videoFile(),
      );
      harness.storage.blobs.delete(media.id);

      await expect(
        harness.service.getSourceMedia(project.id),
      ).resolves.toMatchObject({ id: media.id });
      await expect(
        harness.service.getPlayableSource(media.id),
      ).resolves.toBeNull();
    });

    it("never returns media belonging to another project", async () => {
      const projectA = await harness.createProject("A");
      const projectB = await harness.createProject("B");
      const mediaA = await harness.service.importSourceVideo(
        projectA.id,
        videoFile("a.mp4"),
      );
      // Point B at A's media as if storage were tampered with.
      await harness.repository.update(projectB.id, {
        sourceMediaId: mediaA.id,
        status: "ready",
      });

      await expect(
        harness.service.getSourceMedia(projectB.id),
      ).resolves.toBeNull();
      await expect(
        harness.service.getSourceMedia(projectA.id),
      ).resolves.toMatchObject({ id: mediaA.id });
    });
  });

  describe("project isolation", () => {
    it("keeps each project's media separate through import and removal", async () => {
      const projectA = await harness.createProject("A");
      const projectB = await harness.createProject("B");

      const mediaA = await harness.service.importSourceVideo(
        projectA.id,
        videoFile("a.mp4"),
      );
      const mediaB = await harness.service.importSourceVideo(
        projectB.id,
        videoFile("b.webm", "video/webm"),
      );

      await expect(
        harness.service.getSourceMedia(projectA.id),
      ).resolves.toMatchObject({ id: mediaA.id, filename: "a.mp4" });
      await expect(
        harness.service.getSourceMedia(projectB.id),
      ).resolves.toMatchObject({ id: mediaB.id, filename: "b.webm" });

      await harness.service.removeSourceVideo(projectA.id);

      await expect(
        harness.service.getSourceMedia(projectB.id),
      ).resolves.toMatchObject({ id: mediaB.id });
      expect(harness.storage.blobs.has(mediaB.id)).toBe(true);
    });

    it("keeps the association through a rename", async () => {
      const project = await harness.createProject();
      const media = await harness.service.importSourceVideo(
        project.id,
        videoFile(),
      );

      await harness.repository.update(project.id, { name: "Renamed" });

      await expect(
        harness.service.getSourceMedia(project.id),
      ).resolves.toMatchObject({ id: media.id });
      await expect(
        harness.repository.getById(project.id),
      ).resolves.toMatchObject({
        name: "Renamed",
        sourceMediaId: media.id,
        status: "ready",
      });
    });
  });
});

describe("deleteProjectWithMedia", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it("deletes the project and its stored media", async () => {
    const projectA = await harness.createProject("A");
    const projectB = await harness.createProject("B");
    const mediaA = await harness.service.importSourceVideo(
      projectA.id,
      videoFile("a.mp4"),
    );
    const mediaB = await harness.service.importSourceVideo(
      projectB.id,
      videoFile("b.mp4"),
    );

    const result = await deleteProjectWithMedia(projectA.id, {
      repository: harness.repository,
      media: harness.service,
      logger: () => {},
    });

    expect(result.mediaCleanupFailed).toBe(false);
    await expect(harness.repository.getById(projectA.id)).resolves.toBeNull();
    expect(harness.storage.metadata.has(mediaA.id)).toBe(false);
    expect(harness.storage.blobs.has(mediaA.id)).toBe(false);

    // The other project is untouched.
    await expect(
      harness.repository.getById(projectB.id),
    ).resolves.toMatchObject({ sourceMediaId: mediaB.id });
    expect(harness.storage.blobs.has(mediaB.id)).toBe(true);
  });

  it("still deletes the project and reports a failed media cleanup", async () => {
    const project = await harness.createProject();
    await harness.service.importSourceVideo(project.id, videoFile());
    harness.storage.failDelete = new MediaStorageError("delete", "locked");

    const result = await deleteProjectWithMedia(project.id, {
      repository: harness.repository,
      media: harness.service,
      logger: () => {},
    });

    expect(result.mediaCleanupFailed).toBe(true);
    await expect(harness.repository.getById(project.id)).resolves.toBeNull();
  });
});

describe("toMediaErrorMessage", () => {
  it("passes through actionable messages", () => {
    expect(toMediaErrorMessage(new MediaValidationError("Use MP4."))).toBe(
      "Use MP4.",
    );
    expect(
      toMediaErrorMessage(new MediaStorageError("quota", "No room left.")),
    ).toBe("No room left.");
    expect(
      toMediaErrorMessage(new VideoMetadataError("unreadable", "Broken file.")),
    ).toBe("Broken file.");
  });

  it("hides unexpected technical errors", () => {
    expect(toMediaErrorMessage(new TypeError("x.y is not a function"))).toBe(
      "Something went wrong while handling this video. Please try again.",
    );
  });
});
