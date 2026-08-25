import { CirclePlay } from "lucide-react";

import { cn } from "@/lib/utils";
import { PlaceholderBadge } from "@/components/layout/placeholder-badge";

/**
 * Reserved area for the future persistent video/audio player.
 *
 * It is rendered by the project layout rather than by a section page, so a
 * later part can mount a real player here and keep playback alive while the
 * user moves between Media, Transcript, Translate, Voices, Mix and Export.
 * No playback state exists yet.
 */
export function MediaStageSlot({ className }: { className?: string }) {
  return (
    <section
      aria-labelledby="workspace-media-stage-heading"
      className={cn("flex flex-col gap-3", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="workspace-media-stage-heading"
          className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
        >
          Media stage
        </h2>
        <PlaceholderBadge />
      </div>

      <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-border bg-card/40 p-6 text-center">
        <div className="space-y-2">
          <CirclePlay
            className="mx-auto size-6 text-muted-foreground"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">
            The persistent player will mount here.
          </p>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Source video preview lives in the Media section for now. Playback
        belongs to the project layout, not to individual sections, so it can
        survive section navigation once the persistent player exists.
      </p>
    </section>
  );
}
