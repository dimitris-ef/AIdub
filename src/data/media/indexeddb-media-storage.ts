import type { ProjectMedia, StoredMediaBlob } from "@/types/media";
import {
  MediaStorageError,
  STORAGE_QUOTA_MESSAGE,
  STORAGE_UNAVAILABLE_MESSAGE,
  parseStoredMedia,
  type MediaStorage,
} from "@/data/media/media-storage";

/**
 * Temporary development media storage.
 *
 * IndexedDB is the only browser API that can hold multi-gigabyte Blobs, so it
 * is where Part 3 keeps source videos. This file is the *only* place that
 * knows IndexedDB exists — see `src/data/media/index.ts` for the binding the
 * rest of the application uses.
 *
 * Schema (versioned so future migrations are possible):
 *   database `aidub`, version 1
 *     - `mediaMetadata` keyPath "id", index "byProjectId"
 *     - `mediaBlobs`    keyPath "mediaId", index "byProjectId"
 */

export const MEDIA_DB_NAME = "aidub";
export const MEDIA_DB_VERSION = 1;
export const MEDIA_METADATA_STORE = "mediaMetadata";
export const MEDIA_BLOB_STORE = "mediaBlobs";
export const MEDIA_PROJECT_INDEX = "byProjectId";

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

function hasRequiredStores(db: IDBDatabase): boolean {
  return (
    db.objectStoreNames.contains(MEDIA_METADATA_STORE) &&
    db.objectStoreNames.contains(MEDIA_BLOB_STORE)
  );
}

function createStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(MEDIA_METADATA_STORE)) {
    const store = db.createObjectStore(MEDIA_METADATA_STORE, {
      keyPath: "id",
    });
    store.createIndex(MEDIA_PROJECT_INDEX, "projectId", { unique: false });
  }

  if (!db.objectStoreNames.contains(MEDIA_BLOB_STORE)) {
    const store = db.createObjectStore(MEDIA_BLOB_STORE, {
      keyPath: "mediaId",
    });
    store.createIndex(MEDIA_PROJECT_INDEX, "projectId", { unique: false });
  }
}

/** Opens at `version`, or at the database's current version when omitted. */
function openDatabase(
  factory: IDBFactory,
  version?: number,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request =
      version === undefined
        ? factory.open(MEDIA_DB_NAME)
        : factory.open(MEDIA_DB_NAME, version);

    request.onupgradeneeded = () => createStores(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new MediaStorageError("unavailable", STORAGE_UNAVAILABLE_MESSAGE, {
          cause: request.error,
        }),
      );
    request.onblocked = () =>
      reject(new MediaStorageError("unavailable", STORAGE_UNAVAILABLE_MESSAGE));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export class IndexedDbMediaStorage implements MediaStorage {
  private connection: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: () => IDBFactory | undefined = () =>
      typeof indexedDB === "undefined" ? undefined : indexedDB,
  ) {}

  async save(media: ProjectMedia, blob: Blob): Promise<void> {
    const db = await this.open();

    try {
      const transaction = db.transaction(
        [MEDIA_METADATA_STORE, MEDIA_BLOB_STORE],
        "readwrite",
      );
      const record: StoredMediaBlob = {
        mediaId: media.id,
        projectId: media.projectId,
        blob,
      };

      transaction.objectStore(MEDIA_METADATA_STORE).put(media);
      transaction.objectStore(MEDIA_BLOB_STORE).put(record);

      await transactionDone(transaction);
    } catch (cause) {
      throw new MediaStorageError(
        isQuotaError(cause) ? "quota" : "write",
        isQuotaError(cause)
          ? STORAGE_QUOTA_MESSAGE
          : "The video could not be saved to local storage.",
        { cause },
      );
    }
  }

  async getMetadata(mediaId: string): Promise<ProjectMedia | null> {
    const db = await this.open();

    try {
      const transaction = db.transaction(MEDIA_METADATA_STORE, "readonly");
      const stored = await requestToPromise(
        transaction.objectStore(MEDIA_METADATA_STORE).get(mediaId),
      );

      return parseStoredMedia(stored);
    } catch (cause) {
      throw new MediaStorageError(
        "read",
        "Stored media could not be read.",
        { cause },
      );
    }
  }

  async getBlob(mediaId: string): Promise<Blob | null> {
    const db = await this.open();

    try {
      const transaction = db.transaction(MEDIA_BLOB_STORE, "readonly");
      const stored = (await requestToPromise(
        transaction.objectStore(MEDIA_BLOB_STORE).get(mediaId),
      )) as StoredMediaBlob | undefined;

      return stored?.blob instanceof Blob ? stored.blob : null;
    } catch (cause) {
      throw new MediaStorageError(
        "read",
        "The stored video could not be read.",
        { cause },
      );
    }
  }

  async listByProject(projectId: string): Promise<ProjectMedia[]> {
    const db = await this.open();

    try {
      const transaction = db.transaction(MEDIA_METADATA_STORE, "readonly");
      const stored = await requestToPromise(
        transaction
          .objectStore(MEDIA_METADATA_STORE)
          .index(MEDIA_PROJECT_INDEX)
          .getAll(projectId),
      );

      return (stored as unknown[])
        .map(parseStoredMedia)
        .filter((media): media is ProjectMedia => media !== null);
    } catch (cause) {
      throw new MediaStorageError(
        "read",
        "Stored media could not be read.",
        { cause },
      );
    }
  }

  async delete(mediaId: string): Promise<void> {
    const db = await this.open();

    try {
      const transaction = db.transaction(
        [MEDIA_METADATA_STORE, MEDIA_BLOB_STORE],
        "readwrite",
      );

      transaction.objectStore(MEDIA_METADATA_STORE).delete(mediaId);
      transaction.objectStore(MEDIA_BLOB_STORE).delete(mediaId);

      await transactionDone(transaction);
    } catch (cause) {
      throw new MediaStorageError(
        "delete",
        "The stored video could not be removed.",
        { cause },
      );
    }
  }

  async deleteByProject(projectId: string): Promise<void> {
    const db = await this.open();

    try {
      // Keys are collected first so the write transaction contains no awaits.
      const metadataKeys = await this.keysForProject(
        db,
        MEDIA_METADATA_STORE,
        projectId,
      );
      const blobKeys = await this.keysForProject(
        db,
        MEDIA_BLOB_STORE,
        projectId,
      );

      if (metadataKeys.length === 0 && blobKeys.length === 0) {
        return;
      }

      const transaction = db.transaction(
        [MEDIA_METADATA_STORE, MEDIA_BLOB_STORE],
        "readwrite",
      );

      const metadataStore = transaction.objectStore(MEDIA_METADATA_STORE);
      const blobStore = transaction.objectStore(MEDIA_BLOB_STORE);

      for (const key of metadataKeys) {
        metadataStore.delete(key);
      }
      for (const key of blobKeys) {
        blobStore.delete(key);
      }

      await transactionDone(transaction);
    } catch (cause) {
      throw new MediaStorageError(
        "delete",
        "Stored media for this project could not be removed.",
        { cause },
      );
    }
  }

  private keysForProject(
    db: IDBDatabase,
    storeName: string,
    projectId: string,
  ): Promise<IDBValidKey[]> {
    const transaction = db.transaction(storeName, "readonly");

    return requestToPromise(
      transaction
        .objectStore(storeName)
        .index(MEDIA_PROJECT_INDEX)
        .getAllKeys(projectId),
    );
  }

  private open(): Promise<IDBDatabase> {
    if (this.connection) {
      return this.connection;
    }

    const factory = this.factory();

    if (!factory) {
      return Promise.reject(
        new MediaStorageError("unavailable", STORAGE_UNAVAILABLE_MESSAGE),
      );
    }

    // Open at whatever version exists (creating the database at
    // MEDIA_DB_VERSION when it does not), then upgrade only if this code's
    // stores are missing. Opening at a fixed version would fail outright
    // against a database another build already moved forward.
    this.connection = openDatabase(factory).then((db) => {
      if (db.version >= MEDIA_DB_VERSION && hasRequiredStores(db)) {
        return db;
      }

      const target = Math.max(MEDIA_DB_VERSION, db.version + 1);
      db.close();

      return openDatabase(factory, target).then((upgraded) => {
        if (!hasRequiredStores(upgraded)) {
          upgraded.close();
          throw new MediaStorageError(
            "unavailable",
            STORAGE_UNAVAILABLE_MESSAGE,
          );
        }

        return upgraded;
      });
    });

    // A failed connection must not be cached, so a retry can succeed.
    this.connection.catch(() => {
      this.connection = null;
    });

    return this.connection;
  }
}
