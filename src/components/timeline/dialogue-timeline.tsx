"use client";

import { useCallback, useRef, useState } from "react";

import type { DialogueSegment, DialogueSpeaker } from "@/types/dialogue";
import { speakerDisplayName } from "@/types/dialogue";
import { formatTimeRange, formatTimecode } from "@/lib/timecode";
import { speakerToneClasses } from "@/lib/dialogue/speaker-tone";
import { cn } from "@/lib/utils";
import {
  usePlaybackTime,
  useProjectEditor,
} from "@/components/workspace/project-editor-provider";

/**
 * The dialogue timeline.
 *
 * Deliberately one track of dialogue, not the multitrack mixing timeline that
 * Mix and Export will need: it exists to show where lines sit, follow
 * playback, and let a person drag a boundary. It renders the editable dialogue
 * directly — there is no second segment store — and identifies segments by the
 * same stable ids the transcript uses.
 *
 * Position is proportional to media duration. Very short lines are given a
 * minimum visual width so they stay clickable; that affects only what is
 * drawn, never the timestamps themselves.
 */

const MINIMUM_VISUAL_WIDTH_PERCENT = 0.6;

export function DialogueTimeline({
  segments,
  speakers,
  onResize,
}: {
  segments: readonly DialogueSegment[];
  speakers: readonly DialogueSpeaker[];
  /** Commits a dragged boundary. Rejected values never reach the store. */
  onResize: (segmentId: string, startTime: number, endTime: number) => void;
}) {
  const { selectedSegmentId, activeSegmentId, selectSegment, seek } =
    useProjectEditor();
  const { duration } = usePlaybackTime();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{
    segmentId: string;
    edge: "start" | "end";
    startTime: number;
    endTime: number;
  } | null>(null);

  // Until the video reports a duration, fall back to the dialogue's own extent
  // so the timeline is still usable.
  const span =
    duration > 0
      ? duration
      : Math.max(1, ...segments.map((segment) => segment.endTime));

  const timeAt = useCallback(
    (clientX: number) => {
      const track = trackRef.current;

      if (!track) {
        return null;
      }

      const bounds = track.getBoundingClientRect();
      const ratio = (clientX - bounds.left) / bounds.width;

      return Math.min(Math.max(ratio, 0), 1) * span;
    },
    [span],
  );

  const beginDrag = useCallback(
    (
      event: React.PointerEvent,
      segment: DialogueSegment,
      edge: "start" | "end",
    ) => {
      event.preventDefault();
      event.stopPropagation();
      (event.target as Element).setPointerCapture?.(event.pointerId);
      setDrag({
        segmentId: segment.id,
        edge,
        startTime: segment.startTime,
        endTime: segment.endTime,
      });
    },
    [],
  );

  const moveDrag = useCallback(
    (event: React.PointerEvent) => {
      if (!drag) {
        return;
      }

      const time = timeAt(event.clientX);

      if (time === null) {
        return;
      }

      setDrag((current) =>
        current
          ? {
              ...current,
              ...(current.edge === "start"
                ? { startTime: Math.min(time, current.endTime - 0.05) }
                : { endTime: Math.max(time, current.startTime + 0.05) }),
            }
          : current,
      );
    },
    [drag, timeAt],
  );

  const endDrag = useCallback(() => {
    if (drag) {
      onResize(drag.segmentId, drag.startTime, drag.endTime);
    }

    setDrag(null);
  }, [drag, onResize]);

  if (segments.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="dialogue-timeline-heading"
      className="space-y-2 rounded-lg border border-border bg-card/40 p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3
          id="dialogue-timeline-heading"
          className="text-sm font-semibold tracking-tight"
        >
          Timeline
        </h3>
        <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {formatTimecode(span)}
        </p>
      </div>

      <div
        ref={trackRef}
        className="relative h-16 w-full overflow-hidden rounded-md border border-border bg-muted/30"
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {segments.map((segment) => {
          const dragging = drag?.segmentId === segment.id ? drag : null;
          const startTime = dragging?.startTime ?? segment.startTime;
          const endTime = dragging?.endTime ?? segment.endTime;
          const left = (startTime / span) * 100;
          const width = Math.max(
            ((endTime - startTime) / span) * 100,
            MINIMUM_VISUAL_WIDTH_PERCENT,
          );
          const selected = segment.id === selectedSegmentId;
          const active = segment.id === activeSegmentId;
          const tone = speakerToneClasses(segment.speakerId);

          return (
            <div
              key={segment.id}
              className="absolute top-2 bottom-2"
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              <button
                type="button"
                data-segment-id={segment.id}
                data-selected={selected || undefined}
                data-active={active || undefined}
                onClick={() => {
                  selectSegment(segment.id);
                  seek(segment.startTime);
                }}
                title={`${speakerDisplayName(speakers, segment.speakerId)} · ${formatTimeRange(startTime, endTime)}`}
                aria-label={`${speakerDisplayName(speakers, segment.speakerId)}, ${formatTimeRange(startTime, endTime)}`}
                aria-pressed={selected}
                className={cn(
                  "size-full overflow-hidden rounded-sm border px-1 text-left text-[10px] leading-tight outline-none transition-colors",
                  tone.block,
                  active && "ring-1 ring-ring/50",
                  selected && "ring-2 ring-ring",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <span className="block truncate font-mono">
                  {segment.speakerId ?? "—"}
                </span>
              </button>

              {selected ? (
                <>
                  <ResizeHandle
                    edge="start"
                    onPointerDown={(event) => beginDrag(event, segment, "start")}
                  />
                  <ResizeHandle
                    edge="end"
                    onPointerDown={(event) => beginDrag(event, segment, "end")}
                  />
                </>
              ) : null}
            </div>
          );
        })}

        <TimelinePlayhead span={span} />
      </div>

      <p className="text-[11px] text-muted-foreground">
        Click a block to select it and jump the video there. Drag a selected
        block&apos;s edges to correct its timing.
      </p>
    </section>
  );
}

function ResizeHandle({
  edge,
  onPointerDown,
}: {
  edge: "start" | "end";
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  return (
    <span
      role="presentation"
      onPointerDown={onPointerDown}
      aria-label={edge === "start" ? "Adjust start time" : "Adjust end time"}
      className={cn(
        "absolute inset-y-0 w-2 cursor-ew-resize rounded-sm bg-primary/70 hover:bg-primary",
        edge === "start" ? "-left-1" : "-right-1",
      )}
    />
  );
}

/**
 * The playhead subscribes to playback time on its own, so the surrounding
 * timeline and the transcript below it do not re-render on every frame.
 */
function TimelinePlayhead({ span }: { span: number }) {
  const { currentTime } = usePlaybackTime();
  const left = span > 0 ? Math.min(Math.max(currentTime / span, 0), 1) * 100 : 0;

  return (
    <div
      data-testid="timeline-playhead"
      aria-hidden
      className="pointer-events-none absolute inset-y-0 w-px bg-primary"
      style={{ left: `${left}%` }}
    />
  );
}
