"use client";

import { useCallback, useEffect, useRef } from "react";
import { Pause, Play } from "lucide-react";

import type { ProjectMedia } from "@/types/media";
import { formatTimecode } from "@/lib/timecode";
import {
  useIsPlaying,
  usePlaybackTime,
  useProjectEditor,
} from "@/components/workspace/project-editor-provider";
import { Button } from "@/components/ui/button";

/**
 * The editor's source-video player.
 *
 * It reads the same stored blob as the Media workspace through the same media
 * service — there is one video-storage path in Aidub, and this is not a second
 * one. Its only extra job is to keep the shared playback state in step with
 * the element, so the transcript and timeline can follow along.
 *
 * While playing, the element's own `timeupdate` fires a few times a second,
 * which is too coarse for a smooth playhead; an animation frame loop fills the
 * gaps and stops the moment playback does.
 */
export function ProjectVideoPlayer({
  media,
  previewUrl,
}: {
  media: ProjectMedia;
  /** Ephemeral object URL created by the media layer. */
  previewUrl: string;
}) {
  const { registerMedia, reportTime, togglePlay } = useProjectEditor();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const aspectRatio =
    media.width && media.height ? `${media.width} / ${media.height}` : "16 / 9";

  const attach = useCallback(
    (element: HTMLVideoElement | null) => {
      videoRef.current = element;
      registerMedia(element);
    },
    [registerMedia],
  );

  const stopFollowing = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const startFollowing = useCallback(() => {
    const step = () => {
      const video = videoRef.current;

      if (!video) {
        return;
      }

      reportTime({ currentTime: video.currentTime });
      frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
  }, [reportTime]);

  useEffect(() => stopFollowing, [stopFollowing]);

  return (
    <div className="space-y-2">
      <video
        ref={attach}
        key={previewUrl}
        src={previewUrl}
        controls
        playsInline
        preload="metadata"
        className="w-full max-w-full rounded-lg border border-border bg-black"
        style={{ aspectRatio }}
        aria-label={`Source video: ${media.filename}`}
        onLoadedMetadata={(event) =>
          reportTime({
            duration: event.currentTarget.duration,
            currentTime: event.currentTarget.currentTime,
          })
        }
        onTimeUpdate={(event) =>
          reportTime({ currentTime: event.currentTarget.currentTime })
        }
        onSeeked={(event) =>
          reportTime({ currentTime: event.currentTarget.currentTime })
        }
        onPlay={() => {
          reportTime({ isPlaying: true });
          stopFollowing();
          startFollowing();
        }}
        onPause={(event) => {
          reportTime({
            isPlaying: false,
            currentTime: event.currentTarget.currentTime,
          });
          stopFollowing();
        }}
        onEnded={() => {
          reportTime({ isPlaying: false });
          stopFollowing();
        }}
      >
        Your browser cannot play this video.
      </video>

      <PlayerStatus onToggle={togglePlay} />
    </div>
  );
}

/**
 * Transport readout. Split out so the frame-rate time updates re-render this
 * line alone rather than the player and everything around it.
 */
function PlayerStatus({ onToggle }: { onToggle: () => void }) {
  const { currentTime, duration } = usePlaybackTime();
  const isPlaying = useIsPlaying();

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={onToggle}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <Pause aria-hidden /> : <Play aria-hidden />}
        {isPlaying ? "Pause" : "Play"}
      </Button>
      <p
        className="font-mono text-xs text-muted-foreground tabular-nums"
        data-testid="playback-time"
      >
        {formatTimecode(currentTime)}
        {duration > 0 ? ` / ${formatTimecode(duration)}` : ""}
      </p>
    </div>
  );
}
