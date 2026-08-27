import type { SpeakerAssignmentMetadata } from "@/types/dialogue";
import { cn } from "@/lib/utils";

/**
 * Why a segment's speaker is what it is. Uncertainty is shown, never hidden —
 * Part 8's editor will let a person correct exactly these cases, and a silent
 * guess would give them nothing to correct.
 */

const REASON_TEXT: Record<string, string> = {
  ambiguous_speakers: "Speakers overlap too evenly to tell them apart",
  ambiguous_tie: "Two speakers cover this line equally",
  multiple_speakers_without_word_timestamps:
    "More than one speaker here; the text was not divided",
  overlapping_speech: "Speakers talk over each other here",
  low_speaker_coverage: "Only part of this line is covered by the speaker",
  timing_gap: "Matched to the nearest speaker across a small timing gap",
  no_speaker_regions: "No speakers were detected in this source",
  no_nearby_speaker: "No speaker was detected near this line",
};

export function SpeakerAssignmentBadge({
  assignment,
  speakerId,
}: {
  assignment: SpeakerAssignmentMetadata;
  speakerId: string | null;
}) {
  if (!assignment.uncertain) {
    return null;
  }

  const label = speakerId ? "Uncertain" : "Unassigned";
  const explanation = assignment.reason
    ? REASON_TEXT[assignment.reason]
    : undefined;

  return (
    <span
      title={explanation}
      className={cn(
        "rounded-sm border px-1.5 py-0.5 text-[10px] leading-none font-medium",
        speakerId
          ? "border-border bg-muted text-muted-foreground"
          : "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      {label}
    </span>
  );
}

export function OverlapBadge() {
  return (
    <span
      title="Another speaker is talking at the same time."
      className="rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[10px] leading-none font-medium text-muted-foreground"
    >
      Overlap
    </span>
  );
}
