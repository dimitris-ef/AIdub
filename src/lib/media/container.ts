import type { MediaContainer } from "@/types/media";

/**
 * Pragmatic container detection from the filename extension and the MIME type
 * the browser reports. Aidub does not parse the binary container in Part 3, so
 * an undetermined format is reported as `null` ("Unknown") rather than guessed.
 */

const EXTENSION_CONTAINERS: Readonly<Record<string, MediaContainer>> = {
  mp4: "MP4",
  m4v: "MP4",
  mov: "MOV",
  qt: "MOV",
  webm: "WebM",
};

const MIME_CONTAINERS: Readonly<Record<string, MediaContainer>> = {
  "video/mp4": "MP4",
  "video/x-m4v": "MP4",
  "video/quicktime": "MOV",
  "video/webm": "WebM",
};

/** File input `accept` value — a UI hint only; selections are still validated. */
export const SOURCE_VIDEO_ACCEPT =
  "video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm";

export function getFileExtension(filename: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : null;
}

export function containerFromExtension(
  filename: string,
): MediaContainer | null {
  const extension = getFileExtension(filename);
  return extension ? (EXTENSION_CONTAINERS[extension] ?? null) : null;
}

export function containerFromMimeType(
  mimeType: string | undefined | null,
): MediaContainer | null {
  if (!mimeType) {
    return null;
  }

  const normalized = mimeType.split(";")[0].trim().toLowerCase();
  return MIME_CONTAINERS[normalized] ?? null;
}

/**
 * Extension first (the most reliable signal across operating systems), then
 * the reported MIME type. Neither is trusted on its own.
 */
export function detectContainer(
  filename: string,
  mimeType: string | undefined | null,
): MediaContainer | null {
  return containerFromExtension(filename) ?? containerFromMimeType(mimeType);
}
