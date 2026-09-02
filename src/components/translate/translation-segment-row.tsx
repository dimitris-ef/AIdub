"use client";

import { PencilLine, RefreshCw, Scissors } from "lucide-react";

import type { DialogueSpeaker } from "@/types/dialogue";
import { speakerDisplayName } from "@/types/dialogue";
import type { TranslatedDialogueSegment } from "@/types/translation";
import { formatTimeRange } from "@/lib/timecode";
import { speakerToneClasses } from "@/lib/dialogue/speaker-tone";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DurationWarningBadge } from "@/components/translate/duration-warning-badge";
import { TranslatedTextEditor } from "@/components/translate/translated-text-editor";

/**
 * One line of the translation review: the original beside the translation.
 *
 * The original is **read-only**. Correcting what was actually said belongs to
 * the Transcript workspace, and a second editable copy here would give the same
 * sentence two homes and no answer to which one wins. Only the target text is
 * editable.
 *
 * The speaker name is resolved from the *current dialogue*, not stored on the
 * translation, so renaming a speaker in Transcript shows through immediately
 * and never justifies retranslating anything.
 */
export function TranslationSegmentRow({
  segment,
  speakers,
  selected,
  busy,
  disabled,
  onSelect,
  onCommitText,
  onRegenerate,
  onShorten,
}: {
  segment: TranslatedDialogueSegment;
  speakers: readonly DialogueSpeaker[];
  selected: boolean;
  /** A generation operation is running against this very line. */
  busy: boolean;
  /** Something else is running, or the translation is stale. */
  disabled: boolean;
  onSelect: () => void;
  onCommitText: (text: string) => void;
  onRegenerate: () => void;
  onShorten: () => void;
}) {
  const tone = speakerToneClasses(segment.speakerId);
  const { translationMetadata: metadata, editMetadata } = segment;
  const emptySource = segment.sourceText.trim().length === 0;
  const tooLong = metadata.durationWarning === "likely_too_long";
  const slightlyLong = metadata.durationWarning === "slightly_long";

  return (
    <article
      data-segment-id={segment.dialogueSegmentId}
      data-selected={selected || undefined}
      data-generation-mode={metadata.generationMode}
      data-manually-edited={editMetadata.manuallyEdited || undefined}
      onClick={onSelect}
      className={cn(
        "grid gap-3 py-3 lg:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_minmax(0,1fr)]",
        selected && "bg-muted/40",
      )}
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
        {editMetadata.manuallyEdited ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <PencilLine className="size-3" aria-hidden />
            Edited
          </span>
        ) : metadata.generationMode !== "initial" ? (
          <span className="text-[11px] text-muted-foreground">
            {metadata.generationMode === "shorter" ? "Shortened" : "Regenerated"}
          </span>
        ) : null}
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Original
        </p>
        <p className="text-sm leading-6 text-muted-foreground">
          {emptySource ? <span className="italic">No text</span> : segment.sourceText}
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Translation
          </p>
          <DurationWarningBadge metadata={metadata} />
        </div>

        {emptySource ? (
          // An empty source line stays a line — the structure is 1:1 — but
          // there is nothing to translate or to edit.
          <p className="text-sm leading-6 text-muted-foreground italic">
            Nothing to translate
          </p>
        ) : (
          <>
            <TranslatedTextEditor
              value={segment.translatedText}
              label={`Translation for the line at ${segment.startTime.toFixed(2)} seconds`}
              disabled={busy || disabled}
              onCommit={onCommitText}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={busy || disabled}
                aria-label="Regenerate this translation"
                onClick={(event) => {
                  event.stopPropagation();
                  onRegenerate();
                }}
              >
                <RefreshCw aria-hidden />
                Regenerate
              </Button>

              {/* Prominent only where it is actually needed. A slightly long
                  line can still be shortened; a line that fits should not be
                  nagged about. */}
              {tooLong || slightlyLong ? (
                <Button
                  variant={tooLong ? "default" : "ghost"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={busy || disabled}
                  aria-label="Make this translation shorter"
                  onClick={(event) => {
                    event.stopPropagation();
                    onShorten();
                  }}
                >
                  <Scissors aria-hidden />
                  Make shorter
                </Button>
              ) : null}

              {busy ? (
                <span role="status" className="text-[11px] text-muted-foreground">
                  Regenerating translation…
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
    </article>
  );
}
