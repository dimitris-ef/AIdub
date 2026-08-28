"use client";

import { useMemo, useState } from "react";

import type { DialogueSegment, DialogueSpeaker } from "@/types/dialogue";
import { formatTimecode } from "@/lib/timecode";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SpeakerSelector } from "@/components/transcript/speaker-selector";

/**
 * Splits a line in two.
 *
 * Timing splits precisely at the playhead. **Text does not split itself** —
 * without word-level timings nothing knows which words fall on either side, so
 * this asks. The word boundaries are offered as buttons and both halves are
 * previewed, which makes the correction supervised rather than guessed.
 */
export function SplitSegmentDialog({
  segment,
  speakers,
  splitTime,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  segment: DialogueSegment | null;
  speakers: readonly DialogueSpeaker[];
  /** Where the playhead sits; must fall inside the segment. */
  splitTime: number;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: {
    firstText: string;
    secondText: string;
    firstSpeakerId: string | null;
    secondSpeakerId: string | null;
  }) => void;
}) {
  const words = useMemo(
    () => (segment?.originalText ?? "").split(/\s+/).filter(Boolean),
    [segment?.originalText],
  );

  // Default the text boundary to the middle word; the person moves it.
  const [boundary, setBoundary] = useState(() => Math.ceil(words.length / 2));
  const [firstSpeakerId, setFirstSpeakerId] = useState<string | null>(
    segment?.speakerId ?? null,
  );
  const [secondSpeakerId, setSecondSpeakerId] = useState<string | null>(
    segment?.speakerId ?? null,
  );

  // Remounting per segment keeps this state from leaking between lines.
  const key = `${segment?.id ?? ""}:${segment?.originalText ?? ""}`;

  const firstText = words.slice(0, boundary).join(" ");
  const secondText = words.slice(boundary).join(" ");

  const insideSegment =
    segment !== null &&
    splitTime > segment.startTime &&
    splitTime < segment.endTime;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent key={key} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Split this line</DialogTitle>
          <DialogDescription>
            {segment
              ? `The line runs ${formatTimecode(segment.startTime)} → ${formatTimecode(segment.endTime)} and will be cut at ${formatTimecode(splitTime)}.`
              : "Select a line to split."}
          </DialogDescription>
        </DialogHeader>

        {!insideSegment ? (
          <p role="alert" className="text-sm text-destructive">
            Move the playhead inside this line before splitting it.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Where does the text divide?</Label>
              <p className="text-xs text-muted-foreground">
                There are no word-level timings for this source, so the split
                point in the text is yours to choose — nothing is guessed.
              </p>

              <div className="flex flex-wrap items-center gap-x-1 gap-y-2 rounded-md border border-border p-2 text-sm">
                {words.map((word, index) => (
                  <span key={`${word}-${index}`} className="contents">
                    {index > 0 ? (
                      <button
                        type="button"
                        aria-label={`Split before "${word}"`}
                        aria-pressed={boundary === index}
                        onClick={() => setBoundary(index)}
                        className={
                          boundary === index
                            ? "h-5 w-1 rounded-full bg-primary"
                            : "h-5 w-1 rounded-full bg-border hover:bg-primary/60"
                        }
                      />
                    ) : null}
                    <span>{word}</span>
                  </span>
                ))}
                {words.length === 0 ? (
                  <span className="text-muted-foreground">
                    This line has no text.
                  </span>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <SplitHalf
                title="First line"
                text={firstText}
                speakers={speakers}
                speakerId={firstSpeakerId}
                onSpeakerChange={setFirstSpeakerId}
                range={
                  segment
                    ? `${formatTimecode(segment.startTime)} → ${formatTimecode(splitTime)}`
                    : ""
                }
              />
              <SplitHalf
                title="Second line"
                text={secondText}
                speakers={speakers}
                speakerId={secondSpeakerId}
                onSpeakerChange={setSecondSpeakerId}
                range={
                  segment
                    ? `${formatTimecode(splitTime)} → ${formatTimecode(segment.endTime)}`
                    : ""
                }
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!insideSegment || pending}
            onClick={() =>
              onConfirm({
                firstText,
                secondText,
                firstSpeakerId,
                secondSpeakerId,
              })
            }
          >
            {pending ? "Splitting…" : "Split line"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SplitHalf({
  title,
  text,
  range,
  speakers,
  speakerId,
  onSpeakerChange,
}: {
  title: string;
  text: string;
  range: string;
  speakers: readonly DialogueSpeaker[];
  speakerId: string | null;
  onSpeakerChange: (speakerId: string | null) => void;
}) {
  return (
    <div className="space-y-1.5 rounded-md border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium">{title}</p>
        <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {range}
        </p>
      </div>
      <SpeakerSelector
        speakers={speakers}
        value={speakerId}
        label={`Speaker for the ${title.toLowerCase()}`}
        onChange={onSpeakerChange}
      />
      <p className="min-h-10 text-sm leading-6">
        {text || (
          <span className="text-muted-foreground">(no text)</span>
        )}
      </p>
    </div>
  );
}
