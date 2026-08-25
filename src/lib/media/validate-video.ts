import type { MediaContainer } from "@/types/media";
import {
  containerFromExtension,
  containerFromMimeType,
} from "@/lib/media/container";

/**
 * File-level validation, run before anything is written or associated with a
 * project. It uses the extension *and* the reported MIME type, because either
 * can be missing or wrong depending on the browser and operating system.
 *
 * Passing this check does not guarantee the browser can decode the file — that
 * is established afterwards by loading its metadata.
 */

export const UNSUPPORTED_FORMAT_MESSAGE =
  "This file type is not supported. Use MP4, MOV, or WebM.";

export type SourceVideoFileValidation =
  | { ok: true; container: MediaContainer }
  | { ok: false; error: string };

/** The subset of `File` this check needs, so it is testable without the DOM. */
export interface SelectedFileLike {
  name: string;
  type: string;
  size: number;
}

/** Generic types operating systems use when they cannot classify a file. */
const OPAQUE_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "application/x-octet-stream",
  "binary/octet-stream",
]);

export function validateSourceVideoFile(
  file: SelectedFileLike | null | undefined,
): SourceVideoFileValidation {
  if (!file) {
    return { ok: false, error: "Select a video file to import." };
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return {
      ok: false,
      error: "This file is empty. Select a video file with content.",
    };
  }

  const extensionContainer = containerFromExtension(file.name);
  const mimeContainer = containerFromMimeType(file.type);
  const mimeType = (file.type ?? "").split(";")[0].trim().toLowerCase();
  const mimeIsOpaque = OPAQUE_MIME_TYPES.has(mimeType);

  // A MIME type that is present, meaningful and clearly not video wins:
  // e.g. a PDF renamed to .mp4.
  if (!mimeIsOpaque && !mimeType.startsWith("video/")) {
    return { ok: false, error: UNSUPPORTED_FORMAT_MESSAGE };
  }

  const container = extensionContainer ?? mimeContainer;

  if (!container) {
    return { ok: false, error: UNSUPPORTED_FORMAT_MESSAGE };
  }

  // A recognised video MIME type that is not one of the supported containers
  // (e.g. video/x-msvideo for .avi) is rejected even if the extension lied.
  if (!mimeIsOpaque && !mimeContainer) {
    return { ok: false, error: UNSUPPORTED_FORMAT_MESSAGE };
  }

  return { ok: true, container };
}
