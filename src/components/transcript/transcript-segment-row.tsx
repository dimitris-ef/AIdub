import type { TranscriptSegment } from "@/types/transcript";
import { formatTranscriptRange } from "@/lib/transcript/format-timestamp";
import { cn } from "@/lib/utils";

/**
 * One transcript line: timing plus the original-language text.
 *
 * Deliberately a per-segment component keyed by a stable segment id — later
 * parts hang speaker labels, translations and generated audio off these same
 * rows, and the timeline will scrub to `startTime`.
 */
export function TranscriptSegmentRow({
  segment,
}: {
  segment: TranscriptSegment;
}) {
  return (
    <article className="grid gap-1 rounded-md px-3 py-2.5 transition-colors hover:bg-accent/40 sm:grid-cols-[10.5rem_1fr] sm:gap-4">
      <p className="font-mono text-xs leading-6 text-muted-foreground tabular-nums">
        {formatTranscriptRange(segment.startTime, segment.endTime)}
      </p>
      <p
        className={cn(
          "text-sm leading-6",
          segment.status === "low_confidence" && "text-muted-foreground",
        )}
        title={
          segment.status === "low_confidence"
            ? "The provider reported low confidence for this line."
            : undefined
        }
      >
        {segment.originalText}
      </p>
    </article>
  );
}
