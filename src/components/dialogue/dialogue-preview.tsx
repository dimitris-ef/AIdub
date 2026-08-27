"use client";

import { MessagesSquare, RotateCcw } from "lucide-react";

import { formatRelativeTime } from "@/lib/dates";
import { useDialogue } from "@/hooks/use-dialogue";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { DialogueSegmentRow } from "@/components/dialogue/dialogue-segment-row";

/**
 * Read-only preview of the unified dialogue — "who said what, and when".
 *
 * This is the first consumer of the Part 7 contract, and it consumes it the
 * way every later feature should: one request for the dialogue, no loading of
 * transcripts and diarizations to correlate by hand, no knowledge of which
 * providers produced either.
 *
 * Deliberately not an editor. Part 8 adds text editing, speaker reassignment
 * and split/merge; Part 7 stops at showing that the alignment is right and
 * where it is unsure.
 */
export function DialoguePreview({
  projectId,
  sourceMediaId,
  /** Changes when transcription or diarization finishes, forcing a refetch. */
  revision,
}: {
  projectId: string;
  sourceMediaId: string | null;
  revision: string;
}) {
  const { status, state, dialogue, error, reload } = useDialogue(
    projectId,
    sourceMediaId,
    { revision },
  );

  return (
    <section
      aria-labelledby="dialogue-heading"
      className="space-y-3 rounded-lg border border-border bg-card/40 p-4 lg:p-5"
    >
      <div className="space-y-1">
        <h3
          id="dialogue-heading"
          className="text-sm font-semibold tracking-tight"
        >
          Dialogue
        </h3>
        <p className="text-sm text-muted-foreground">
          The transcript and speaker analysis combined into who said what, and
          when. Editing arrives in a later part.
        </p>
      </div>

      {status === "loading" ? (
        <Skeleton className="h-24 w-full" />
      ) : status === "error" ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {error ?? "The dialogue could not be loaded."}
          </p>
          <Button variant="outline" size="sm" onClick={reload}>
            <RotateCcw aria-hidden />
            Try again
          </Button>
        </div>
      ) : state === "transcript_required" ? (
        <p className="text-sm text-muted-foreground">
          A completed transcript is required before dialogue can be assembled.
        </p>
      ) : state === "diarization_required" ? (
        <p className="text-sm text-muted-foreground">
          Speaker analysis is required before dialogue can be assembled.
        </p>
      ) : state === "source_mismatch" ? (
        <p role="alert" className="text-sm text-destructive">
          The transcript and speaker analysis describe different sources, so
          they were not combined.
        </p>
      ) : state === "failed" || !dialogue ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            The transcript and speaker analysis could not be combined.
          </p>
          <Button variant="outline" size="sm" onClick={reload}>
            <RotateCcw aria-hidden />
            Try again
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Separator />

          <p className="text-xs text-muted-foreground">
            {dialogue.segments.length}{" "}
            {dialogue.segments.length === 1 ? "line" : "lines"}
            {dialogue.mergeMetadata.unassignedSegmentCount > 0
              ? ` · ${dialogue.mergeMetadata.unassignedSegmentCount} unassigned`
              : ""}
            {dialogue.mergeMetadata.overlappingSegmentCount > 0
              ? ` · ${dialogue.mergeMetadata.overlappingSegmentCount} with overlap`
              : ""}{" "}
            · {dialogue.mergeMetadata.algorithmVersion} · updated{" "}
            {formatRelativeTime(dialogue.updatedAt)}
          </p>

          {dialogue.segments.length === 0 ? (
            <p className="flex items-center justify-center gap-2 py-6 text-center text-sm text-muted-foreground">
              <MessagesSquare className="size-4" aria-hidden />
              There is no speech to attribute in this source.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {dialogue.segments.map((segment) => (
                <DialogueSegmentRow key={segment.id} segment={segment} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
