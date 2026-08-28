"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Merge, Scissors } from "lucide-react";

import type { DialogueSegment, DialogueSpeaker } from "@/types/dialogue";
import { speakerToneClasses } from "@/lib/dialogue/speaker-tone";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SpeakerSelector } from "@/components/transcript/speaker-selector";
import { TimestampEditor } from "@/components/transcript/timestamp-editor";
import {
  OverlapBadge,
  SpeakerAssignmentBadge,
} from "@/components/dialogue/speaker-assignment-badge";

/**
 * One editable line of dialogue.
 *
 * Memoised on purpose: playback moves the active segment several times a
 * second, and without this every open textarea in a long transcript would
 * re-render with it. The row only re-renders when its own segment, its
 * selected/active flags, or the speaker list actually change.
 *
 * Text commits on blur rather than on every keystroke — one persisted
 * correction per edit, not one per character.
 *
 * `busy` (a save is in flight) gates the structural actions only. Splitting and
 * merging depend on the document's current shape, so they wait; the text,
 * timing and speaker fields do not. Disabling those mid-save would throw away
 * whatever is being typed at that moment — including the second timestamp of a
 * pair, whose save is triggered by the first one blurring. Edits that land
 * while a save is in flight are keyed to stable segment ids and compose
 * server-side, and the fields only resync from the store when they are not
 * focused, so a correction in progress is never overwritten by one arriving.
 */
export const EditableDialogueRow = memo(function EditableDialogueRow({
  segment,
  speakers,
  selected,
  active,
  busy,
  mediaDuration,
  canMergeWithPrevious,
  onSelect,
  onTextCommit,
  onSpeakerChange,
  onTimingChange,
  onSplit,
  onMergeWithPrevious,
}: {
  segment: DialogueSegment;
  speakers: readonly DialogueSpeaker[];
  selected: boolean;
  active: boolean;
  busy: boolean;
  mediaDuration: number;
  canMergeWithPrevious: boolean;
  onSelect: () => void;
  onTextCommit: (text: string) => void;
  onSpeakerChange: (speakerId: string | null) => void;
  onTimingChange: (startTime: number, endTime: number) => void;
  onSplit: () => void;
  onMergeWithPrevious: () => void;
}) {
  const [text, setText] = useState(segment.originalText);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const rowRef = useRef<HTMLElement | null>(null);

  // Follow the stored text when it changes underneath — a merge or a split
  // rewrites it — without clobbering what is being typed right now.
  useEffect(() => {
    if (document.activeElement !== textRef.current) {
      setText(segment.originalText);
    }
  }, [segment.originalText]);

  // A line chosen by a person is brought into view; playback alone never
  // steals the scroll position out from under an edit.
  useEffect(() => {
    if (selected && document.activeElement !== textRef.current) {
      rowRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

  const tone = speakerToneClasses(segment.speakerId);
  const edited =
    segment.editMetadata.manuallyEditedText ||
    segment.editMetadata.manuallyEditedSpeaker ||
    segment.editMetadata.manuallyEditedTiming ||
    segment.editMetadata.manuallyChangedStructure;

  return (
    <article
      ref={rowRef}
      data-segment-id={segment.id}
      data-selected={selected || undefined}
      data-active={active || undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === "Enter") {
          event.preventDefault();
          onSelect();
        }
      }}
      tabIndex={0}
      aria-current={active ? "true" : undefined}
      className={cn(
        "grid gap-2 rounded-md border-l-2 px-3 py-2.5 outline-none transition-colors sm:grid-cols-[13rem_1fr] sm:gap-4",
        selected ? "bg-accent/50" : active ? "bg-accent/25" : "hover:bg-accent/30",
        selected ? "border-l-primary" : "border-l-transparent",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-full", tone.accent)}
          />
          <SpeakerSelector
            speakers={speakers}
            value={segment.speakerId}
            label={`Speaker for the line at ${segment.startTime.toFixed(2)} seconds`}
            onChange={onSpeakerChange}
          />
        </div>

        <TimestampEditor
          startTime={segment.startTime}
          endTime={segment.endTime}
          mediaDuration={mediaDuration}
          onCommit={onTimingChange}
        />
      </div>

      <div className="space-y-1.5">
        <textarea
          ref={textRef}
          value={text}
          rows={Math.max(1, Math.ceil(text.length / 90))}
          aria-label={`Transcript text for the line at ${segment.startTime.toFixed(2)} seconds`}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => onTextCommit(text)}
          onKeyDown={(event) => {
            // Escape abandons the in-progress edit rather than committing it.
            if (event.key === "Escape") {
              setText(segment.originalText);
              event.currentTarget.blur();
            }
          }}
          className="w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 text-sm leading-6 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <SpeakerAssignmentBadge
            assignment={segment.assignment}
            speakerId={segment.speakerId}
          />
          {segment.diarization.overlap ? <OverlapBadge /> : null}
          {edited ? (
            <span
              title="This line has been corrected by hand."
              className="rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[10px] leading-none font-medium text-muted-foreground"
            >
              Edited
            </span>
          ) : null}

          <span className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px]"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                onSplit();
              }}
            >
              <Scissors aria-hidden />
              Split
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px]"
              disabled={busy || !canMergeWithPrevious}
              title={
                canMergeWithPrevious
                  ? "Join this line with the one above it"
                  : "Only adjacent lines from the same speaker can be merged"
              }
              onClick={(event) => {
                event.stopPropagation();
                onMergeWithPrevious();
              }}
            >
              <Merge aria-hidden />
              Merge up
            </Button>
          </span>
        </div>
      </div>
    </article>
  );
});
