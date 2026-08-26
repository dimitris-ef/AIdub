"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

import type { SpeakerRegion } from "@/types/diarization";
import { formatTimeRange } from "@/lib/timecode";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * The raw speaker timeline, collapsed by default.
 *
 * This is an inspection view for validating diarization, not the Part 7
 * dialogue editor: it shows speaker regions on their own, never transcript
 * text attributed to a speaker. The two timelines are still separate.
 */
export function SpeakerRegionList({
  regions,
}: {
  regions: readonly SpeakerRegion[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (regions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronRight
          aria-hidden
          className={cn("transition-transform", expanded && "rotate-90")}
        />
        {expanded ? "Hide speaker regions" : "Show speaker regions"}
      </Button>

      {expanded ? (
        <ol
          className="divide-y divide-border/60 overflow-x-auto"
          aria-label="Speaker regions"
        >
          {regions.map((region) => (
            <li
              key={region.id}
              className="flex items-baseline gap-3 px-3 py-1.5 text-xs"
            >
              <span className="w-20 shrink-0 font-mono text-foreground">
                {region.speakerId}
              </span>
              <span className="font-mono whitespace-nowrap text-muted-foreground tabular-nums">
                {formatTimeRange(region.startTime, region.endTime)}
              </span>
              {region.overlap ? (
                <span
                  className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  title="This region shares time with another speaker."
                >
                  overlap
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
