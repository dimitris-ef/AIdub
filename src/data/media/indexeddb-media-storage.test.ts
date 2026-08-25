import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import type { ProjectMedia } from "@/types/media";
import { IndexedDbMediaStorage } from "@/data/media/indexeddb-media-storage";
import {
  MediaStorageError,
  parseStoredMedia,
} from "@/data/media/media-storage";

function media(overrides: Partial<ProjectMedia> = {}): ProjectMedia {
  return {
    id: "media-1",
    projectId: "project-1",
    kind: "video",
    filename: "interview.mp4",
    mimeType: "video/mp4",
    container: "MP4",
    sizeBytes: 1_234_567,
    durationSeconds: 92.5,
    width: 1920,
    height: 1080,
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
    ...overrides,
  };
}

const blob = (content = "video-bytes") =>
  new Blob([content], { type: "video/mp4" });

describe("IndexedDbMediaStorage", () => {
  let storage: IndexedDbMediaStorage;

  beforeEach(() => {
    // A fresh in-memory IndexedDB per test.
    const factory = new IDBFactory();
    storage = new IndexedDbMediaStorage(() => factory);
  });

  it("stores and reads back metadata and bytes", async () => {
    const record = media();
    await storage.save(record, blob());

    await expect(storage.getMetadata(record.id)).resolves.toEqual(record);

    const stored = await storage.getBlob(record.id);
    expect(stored).toBeInstanceOf(Blob);
    await expect(stored?.text()).resolves.toBe("video-bytes");
  });

  it("returns null for unknown media", async () => {
    await expect(storage.getMetadata("nope")).resolves.toBeNull();
    await expect(storage.getBlob("nope")).resolves.toBeNull();
  });

  it("keeps projects isolated", async () => {
    await storage.save(media({ id: "a", projectId: "project-a" }), blob("a"));
    await storage.save(media({ id: "b", projectId: "project-b" }), blob("b"));

    await expect(storage.listByProject("project-a")).resolves.toMatchObject([
      { id: "a" },
    ]);
    await expect(storage.listByProject("project-b")).resolves.toMatchObject([
      { id: "b" },
    ]);
  });

  it("deletes metadata and bytes together", async () => {
    const record = media();
    await storage.save(record, blob());

    await storage.delete(record.id);

    await expect(storage.getMetadata(record.id)).resolves.toBeNull();
    await expect(storage.getBlob(record.id)).resolves.toBeNull();
  });

  it("deletes every record for one project only", async () => {
    await storage.save(media({ id: "a1", projectId: "project-a" }), blob("a1"));
    await storage.save(media({ id: "a2", projectId: "project-a" }), blob("a2"));
    await storage.save(media({ id: "b1", projectId: "project-b" }), blob("b1"));

    await storage.deleteByProject("project-a");

    await expect(storage.listByProject("project-a")).resolves.toEqual([]);
    await expect(storage.getBlob("a1")).resolves.toBeNull();
    await expect(storage.getBlob("a2")).resolves.toBeNull();
    await expect(storage.listByProject("project-b")).resolves.toHaveLength(1);
    await expect(storage.getBlob("b1")).resolves.toBeInstanceOf(Blob);
  });

  it("purging a project with no media is a no-op", async () => {
    await expect(storage.deleteByProject("empty")).resolves.toBeUndefined();
  });

  it("replaces a record when saved again with the same id", async () => {
    await storage.save(media(), blob("first"));
    await storage.save(media({ filename: "second.mp4" }), blob("second"));

    await expect(storage.getMetadata("media-1")).resolves.toMatchObject({
      filename: "second.mp4",
    });
    await expect((await storage.getBlob("media-1"))?.text()).resolves.toBe(
      "second",
    );
  });

  it("creates its stores when the database exists without them", async () => {
    const factory = new IDBFactory();

    // Something else created "aidub" at version 1 with no object stores.
    await new Promise<void>((resolve, reject) => {
      const request = factory.open("aidub", 1);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    const recovered = new IndexedDbMediaStorage(() => factory);
    const record = media();

    await recovered.save(record, blob());

    await expect(recovered.getMetadata(record.id)).resolves.toEqual(record);
  });

  it("works against a database another build already moved forward", async () => {
    const factory = new IDBFactory();

    // Stores present, but at a higher version than this code declares.
    await new Promise<void>((resolve, reject) => {
      const request = factory.open("aidub", 5);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("mediaMetadata", { keyPath: "id" }).createIndex(
          "byProjectId",
          "projectId",
        );
        db.createObjectStore("mediaBlobs", { keyPath: "mediaId" }).createIndex(
          "byProjectId",
          "projectId",
        );
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    const forwardCompatible = new IndexedDbMediaStorage(() => factory);
    const record = media();

    await forwardCompatible.save(record, blob());

    await expect(forwardCompatible.getMetadata(record.id)).resolves.toEqual(
      record,
    );
  });

  it("reports unavailable storage instead of crashing", async () => {
    const unavailable = new IndexedDbMediaStorage(() => undefined);

    await expect(unavailable.getMetadata("media-1")).rejects.toBeInstanceOf(
      MediaStorageError,
    );
  });
});

describe("parseStoredMedia", () => {
  it("accepts a well-formed record", () => {
    expect(parseStoredMedia(media())).toEqual(media());
  });

  it.each([
    ["null", null],
    ["a string", "media"],
    ["a record without an id", { ...media(), id: "" }],
    ["a record without a project", { ...media(), projectId: "" }],
    ["a record with the wrong kind", { ...media(), kind: "audio" }],
    ["a record without a filename", { ...media(), filename: "  " }],
    ["a record with no size", { ...media(), sizeBytes: 0 }],
    ["a record with a broken timestamp", { ...media(), createdAt: "today" }],
  ])("rejects %s", (_label, value) => {
    expect(parseStoredMedia(value)).toBeNull();
  });

  it("degrades unusable optional fields instead of failing", () => {
    const parsed = parseStoredMedia({
      ...media(),
      container: "AVI",
      durationSeconds: Number.NaN,
      width: -1,
      height: null,
      mimeType: 42,
    });

    expect(parsed).toMatchObject({
      container: null,
      durationSeconds: null,
      width: null,
      height: null,
      mimeType: "",
    });
  });
});
