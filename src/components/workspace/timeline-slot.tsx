import { PlaceholderBadge } from "@/components/layout/placeholder-badge";

/**
 * Reserved area for the future dubbing timeline (tracks, waveforms, speaker
 * segments, generated clips, playhead). Like the media stage it is owned by
 * the project layout so it can eventually stay mounted across sections.
 * Nothing here is interactive.
 */
export function TimelineSlot() {
  return (
    <section
      aria-labelledby="workspace-timeline-heading"
      className="border-t border-border bg-card/30 px-4 py-3 lg:px-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="workspace-timeline-heading"
          className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
        >
          Timeline
        </h2>
        <PlaceholderBadge />
      </div>

      <div className="mt-2 grid h-20 place-items-center rounded-md border border-dashed border-border px-4 text-center">
        <p className="text-xs text-muted-foreground">
          Reserved for the dubbing timeline — tracks, waveforms, speaker
          segments and playhead arrive in a later part.
        </p>
      </div>
    </section>
  );
}
