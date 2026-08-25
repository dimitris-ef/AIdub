"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";

import type { ProjectMedia } from "@/types/media";

/**
 * Native playback surface for the stored source video.
 *
 * Deliberately plain: Aidub's transport controls and timeline arrive later,
 * and the player is kept free of storage concerns so it can be promoted into
 * the persistent workspace player without changes.
 */
export function SourceVideoPlayer({
  media,
  previewUrl,
}: {
  media: ProjectMedia;
  /** Ephemeral object URL created by the media layer. */
  previewUrl: string;
}) {
  const [failed, setFailed] = useState(false);

  // Reserve the real aspect ratio up front so the layout does not jump once
  // metadata loads.
  const aspectRatio =
    media.width && media.height ? `${media.width} / ${media.height}` : "16 / 9";

  if (failed) {
    return (
      <div
        role="alert"
        className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-black/60 p-6 text-center"
        style={{ aspectRatio }}
      >
        <TriangleAlert className="size-5 text-muted-foreground" aria-hidden />
        <p className="max-w-sm text-sm text-muted-foreground">
          This video is stored in the project, but your browser cannot preview
          its codec. The file itself is unchanged — you can replace it or remove
          it below.
        </p>
      </div>
    );
  }

  return (
    <video
      key={previewUrl}
      src={previewUrl}
      controls
      playsInline
      preload="metadata"
      // No autoplay: playback is always started by the user.
      className="w-full max-w-full rounded-lg border border-border bg-black"
      style={{ aspectRatio }}
      aria-label={`Source video preview: ${media.filename}`}
      onError={() => setFailed(true)}
    >
      Your browser cannot play this video.
    </video>
  );
}
