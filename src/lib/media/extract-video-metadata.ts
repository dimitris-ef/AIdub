/**
 * Browser-native media metadata extraction.
 *
 * This is deliberately *not* codec inspection: no FFmpeg, no WASM demuxer, no
 * container parser. It asks the browser to load the file's metadata and reads
 * back what the platform exposes, which also proves the browser can decode the
 * file at all.
 */

export interface ExtractedVideoMetadata {
  /** null when the browser could not report a finite duration. */
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
}

export type VideoMetadataErrorCode = "unreadable" | "timeout";

export class VideoMetadataError extends Error {
  constructor(
    readonly code: VideoMetadataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VideoMetadataError";
  }
}

export const UNREADABLE_VIDEO_MESSAGE =
  "The selected file could not be read as a video. It may be corrupted, or it may use a codec your browser cannot decode.";

const METADATA_TIMEOUT_MS = 30_000;

export type ExtractVideoMetadata = (
  file: Blob,
) => Promise<ExtractedVideoMetadata>;

export async function extractVideoMetadata(
  file: Blob,
): Promise<ExtractedVideoMetadata> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new VideoMetadataError(
      "unreadable",
      "Video metadata can only be read in a browser.",
    );
  }

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;

  try {
    const metadata = await new Promise<ExtractedVideoMetadata>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(
            new VideoMetadataError(
              "timeout",
              "Reading this video took too long. Try a different file.",
            ),
          );
        }, METADATA_TIMEOUT_MS);

        function cleanup() {
          clearTimeout(timeout);
          video.removeEventListener("loadedmetadata", onLoaded);
          video.removeEventListener("error", onError);
          video.removeAttribute("src");
          video.load();
        }

        function onLoaded() {
          const durationSeconds =
            Number.isFinite(video.duration) && video.duration > 0
              ? video.duration
              : null;
          const width = video.videoWidth > 0 ? video.videoWidth : null;
          const height = video.videoHeight > 0 ? video.videoHeight : null;

          cleanup();

          // No usable duration *and* no dimensions means the browser did not
          // really decode a video track.
          if (durationSeconds === null && width === null) {
            reject(
              new VideoMetadataError("unreadable", UNREADABLE_VIDEO_MESSAGE),
            );
            return;
          }

          resolve({ durationSeconds, width, height });
        }

        function onError() {
          cleanup();
          reject(
            new VideoMetadataError("unreadable", UNREADABLE_VIDEO_MESSAGE),
          );
        }

        video.addEventListener("loadedmetadata", onLoaded);
        video.addEventListener("error", onError);
        video.src = objectUrl;
      },
    );

    return metadata;
  } finally {
    // Object URLs are ephemeral: always release the temporary one.
    URL.revokeObjectURL(objectUrl);
  }
}
