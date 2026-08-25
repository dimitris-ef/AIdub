import { IndexedDbMediaStorage } from "@/data/media/indexeddb-media-storage";
import type { MediaStorage } from "@/data/media/media-storage";

export {
  MediaStorageError,
  STORAGE_QUOTA_MESSAGE,
  STORAGE_UNAVAILABLE_MESSAGE,
  parseStoredMedia,
  type MediaStorage,
  type MediaStorageErrorCode,
} from "@/data/media/media-storage";
export {
  IndexedDbMediaStorage,
  MEDIA_BLOB_STORE,
  MEDIA_DB_NAME,
  MEDIA_DB_VERSION,
  MEDIA_METADATA_STORE,
  MEDIA_PROJECT_INDEX,
} from "@/data/media/indexeddb-media-storage";

/**
 * The media storage the application uses. Part 3 keeps bytes in the visitor's
 * browser; pointing this binding at an object-storage/backend implementation
 * of `MediaStorage` is the intended upgrade path and requires no UI changes.
 */
export const mediaStorage: MediaStorage = new IndexedDbMediaStorage();
