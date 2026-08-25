/**
 * Media domain model.
 *
 * `ProjectMedia` is metadata only. The bytes live in the media storage layer
 * (`src/data/media/`) keyed by the media id and are never embedded in project
 * or media metadata records.
 */

export type MediaKind = "video";

/** Containers Aidub accepts as a source video in Part 3. */
export const SUPPORTED_CONTAINERS = ["MP4", "MOV", "WebM"] as const;

export type MediaContainer = (typeof SUPPORTED_CONTAINERS)[number];

export interface ProjectMedia {
  /** Stable, immutable id. Never an object URL — those are ephemeral. */
  id: string;
  /** The project this media belongs to. */
  projectId: string;
  kind: MediaKind;
  /** As reported by the browser. Rendered as text, never as markup. */
  filename: string;
  /** May be an empty string when the browser reports no type. */
  mimeType: string;
  /** Derived pragmatically from extension + MIME; null when undetermined. */
  container: MediaContainer | null;
  sizeBytes: number;
  /** From browser media metadata; null when the browser did not expose it. */
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

/** Binary payload, stored separately from the metadata record. */
export interface StoredMediaBlob {
  mediaId: string;
  projectId: string;
  blob: Blob;
}
