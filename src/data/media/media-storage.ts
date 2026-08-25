import type { ProjectMedia } from "@/types/media";
import { SUPPORTED_CONTAINERS } from "@/types/media";
import { parseTimestamp } from "@/lib/dates";

/**
 * Binary media persistence contract.
 *
 * Consumers never learn where the bytes live. Today that is IndexedDB in the
 * visitor's browser; later it is object storage behind a backend API, reached
 * through this same interface.
 */
export interface MediaStorage {
  save(media: ProjectMedia, blob: Blob): Promise<void>;
  getMetadata(mediaId: string): Promise<ProjectMedia | null>;
  getBlob(mediaId: string): Promise<Blob | null>;
  listByProject(projectId: string): Promise<ProjectMedia[]>;
  delete(mediaId: string): Promise<void>;
  /** Removes every media record belonging to a project (used on delete). */
  deleteByProject(projectId: string): Promise<void>;
}

export type MediaStorageErrorCode =
  | "unavailable"
  | "quota"
  | "read"
  | "write"
  | "delete";

export class MediaStorageError extends Error {
  constructor(
    readonly code: MediaStorageErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "MediaStorageError";
  }
}

export const STORAGE_UNAVAILABLE_MESSAGE =
  "Local media storage is unavailable in this browser. Private browsing modes may block it.";

export const STORAGE_QUOTA_MESSAGE =
  "The browser could not store this video locally. Available browser storage may be insufficient.";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && parseTimestamp(value) !== null;
}

function optionalPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * Defensive parse of a stored metadata record. Browser storage can be cleared
 * partially or hand-edited, so records are validated instead of trusted; an
 * unusable record is dropped so the workspace can recover rather than crash.
 */
export function parseStoredMedia(value: unknown): ProjectMedia | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    !isNonEmptyString(record.id) ||
    !isNonEmptyString(record.projectId) ||
    record.kind !== "video" ||
    !isNonEmptyString(record.filename) ||
    typeof record.sizeBytes !== "number" ||
    !Number.isFinite(record.sizeBytes) ||
    record.sizeBytes <= 0 ||
    !isIsoTimestamp(record.createdAt) ||
    !isIsoTimestamp(record.updatedAt)
  ) {
    return null;
  }

  const container = (SUPPORTED_CONTAINERS as readonly string[]).includes(
    record.container as string,
  )
    ? (record.container as ProjectMedia["container"])
    : null;

  return {
    id: record.id,
    projectId: record.projectId,
    kind: "video",
    filename: record.filename,
    mimeType: typeof record.mimeType === "string" ? record.mimeType : "",
    container,
    sizeBytes: record.sizeBytes,
    durationSeconds: optionalPositiveNumber(record.durationSeconds),
    width: optionalPositiveNumber(record.width),
    height: optionalPositiveNumber(record.height),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
