import type { DialogueSegment } from "@/types/dialogue";
import { formatTimeRange } from "@/lib/timecode";
import { cn } from "@/lib/utils";
import {
  OverlapBadge,
  SpeakerAssignmentBadge,
} from "@/components/dialogue/speaker-assignment-badge";

/**
 * One line of dialogue: who said it, when, and what.
 *
 * Read-only by design. Editing text, reassigning speakers, splitting and
 * merging lines all belong to Part 8; this exists so Part 7's alignment can be
 * seen and trusted.
 */
export function DialogueSegmentRow({ segment }: { segment: DialogueSegment }) {
  return (
    <article className="grid gap-1 rounded-md px-3 py-2.5 transition-colors hover:bg-accent/40 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <div className="space-y-1">
        <p
          className={cn(
            "font-mono text-xs leading-6",
            segment.speakerId ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {segment.speakerId ?? "unassigned"}
        </p>
        <p className="font-mono text-[11px] leading-4 text-muted-foreground tabular-nums">
          {formatTimeRange(segment.startTime, segment.endTime)}
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm leading-6">{segment.originalText}</p>

        {segment.assignment.uncertain || segment.diarization.overlap ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <SpeakerAssignmentBadge
              assignment={segment.assignment}
              speakerId={segment.speakerId}
            />
            {segment.diarization.overlap ? <OverlapBadge /> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
