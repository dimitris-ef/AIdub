import type { DialogueSpeaker } from "@/types/dialogue";
import { speakerDisplayName } from "@/types/dialogue";
import type { TranslatedDialogueSegment } from "@/types/translation";
import { formatTimeRange } from "@/lib/timecode";
import { speakerToneClasses } from "@/lib/dialogue/speaker-tone";
import { cn } from "@/lib/utils";

/**
 * One translated line: the source above, the translation below.
 *
 * Read-only in Part 9. Editing translated text, choosing between alternate
 * takes and fitting a line to its delivery are Part 10's job; showing both
 * languages side by side is enough to check that the backend preserved every
 * relationship it was supposed to.
 *
 * The speaker name is resolved from the *current dialogue*, not stored on the
 * translation. A translated segment keeps the stable `speakerId`; renaming a
 * speaker in the Transcript editor therefore shows through here immediately
 * rather than leaving a stale copy of a name behind.
 */
export function TranslationSegmentRow({
  segment,
  speakers,
}: {
  segment: TranslatedDialogueSegment;
  speakers: readonly DialogueSpeaker[];
}) {
  const tone = speakerToneClasses(segment.speakerId);
  const empty = segment.translatedText.trim().length === 0;

  return (
    <article
      data-segment-id={segment.dialogueSegmentId}
      className="grid gap-2 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"
    >
      <div className="space-y-1">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
            tone.block,
          )}
        >
          <span aria-hidden className={cn("size-2 rounded-full", tone.accent)} />
          {speakerDisplayName(speakers, segment.speakerId)}
        </span>
        <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {formatTimeRange(segment.startTime, segment.endTime)}
        </p>
      </div>

      <div className="space-y-1.5">
        <div>
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Original
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            {segment.sourceText.trim().length > 0 ? (
              segment.sourceText
            ) : (
              <span className="italic">No text</span>
            )}
          </p>
        </div>

        <div>
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Translation
          </p>
          <p className={cn("text-sm leading-6", empty && "text-muted-foreground")}>
            {empty ? (
              // An empty source line stays a line: the structure is 1:1, and
              // saying so is better than rendering a blank row.
              <span className="italic">Nothing to translate</span>
            ) : (
              segment.translatedText
            )}
          </p>
        </div>
      </div>
    </article>
  );
}
