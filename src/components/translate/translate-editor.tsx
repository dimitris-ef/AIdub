"use client";

import { useState } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

import type { DialogueSpeaker } from "@/types/dialogue";
import type { TranslationJobOperation } from "@/types/processing-job";
import type { DialogueTranslation } from "@/types/translation";
import { formatRelativeTime } from "@/lib/dates";
import { getLanguageLabel } from "@/lib/languages";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TranslationSegmentRow } from "@/components/translate/translation-segment-row";
import type { TranslationSaveStatus } from "@/hooks/use-translation-editor";

/**
 * The translation review editor.
 *
 * Original on one side, translation on the other, one row per dialogue line.
 * The original is read-only; the translation is where the work happens —
 * editing it by hand, regenerating a line that reads badly, or shortening one
 * that will not fit.
 *
 * Every action here is explicit. Nothing regenerates on its own and nothing
 * loops trying to hit a duration: a line that overruns is flagged and left for
 * a person to decide about, because automatic re-compression degrades meaning
 * quietly and spends provider credits doing it.
 */
export function TranslateEditor({
  translation,
  speakers,
  selectedSegmentId,
  stale,
  saveStatus,
  saveError,
  savingSegmentId,
  activeSegmentId,
  activeOperation,
  onSelect,
  onCommitText,
  onSegmentOperation,
  onDismissError,
}: {
  translation: DialogueTranslation;
  speakers: readonly DialogueSpeaker[];
  selectedSegmentId: string | null;
  /** The dialogue has moved on; generating against it is blocked. */
  stale: boolean;
  saveStatus: TranslationSaveStatus;
  saveError: string | null;
  savingSegmentId: string | null;
  /** The line a generation operation is currently running against. */
  activeSegmentId: string | null;
  activeOperation: TranslationJobOperation | null;
  onSelect: (segmentId: string) => void;
  onCommitText: (segmentId: string, text: string) => void;
  onSegmentOperation: (
    segmentId: string,
    operation: "regenerate_segment" | "shorten_segment",
  ) => void;
  onDismissError: () => void;
}) {
  // A regeneration replaces text a person wrote, so it is confirmed once rather
  // than silently discarding their work.
  const [confirming, setConfirming] = useState<{
    segmentId: string;
    operation: "regenerate_segment" | "shorten_segment";
  } | null>(null);

  const manualEdits = translation.segments.filter(
    (segment) => segment.editMetadata.manuallyEdited,
  ).length;
  const tooLong = translation.segments.filter(
    (segment) => segment.translationMetadata.durationWarning === "likely_too_long",
  ).length;
  // A full run and a segment operation must not write the same record at once.
  const anyOperationRunning = activeOperation !== null;

  function requestOperation(
    segmentId: string,
    operation: "regenerate_segment" | "shorten_segment",
  ) {
    const segment = translation.segments.find(
      (candidate) => candidate.dialogueSegmentId === segmentId,
    );

    if (segment?.editMetadata.manuallyEdited) {
      setConfirming({ segmentId, operation });
      return;
    }

    onSegmentOperation(segmentId, operation);
  }

  return (
    <section
      aria-labelledby="translation-heading"
      className="space-y-3 rounded-lg border border-border bg-card/40 p-4 lg:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3
            id="translation-heading"
            className="text-sm font-semibold tracking-tight"
          >
            Translated dialogue
          </h3>
          <p className="text-sm text-muted-foreground">
            {getLanguageLabel(translation.sourceLanguage)} →{" "}
            {getLanguageLabel(translation.targetLanguage)}. Edit the translation
            directly; the original belongs to the Transcript section.
          </p>
        </div>

        <SaveIndicator status={saveStatus} revision={translation.revision} />
      </div>

      <p className="text-xs text-muted-foreground">
        {translation.segments.length}{" "}
        {translation.segments.length === 1 ? "line" : "lines"}
        {manualEdits > 0 ? ` · ${manualEdits} edited by hand` : ""}
        {tooLong > 0 ? ` · ${tooLong} likely too long` : ""} · revision{" "}
        {translation.dialogueRevision}·{translation.revision} ·{" "}
        {translation.providerModel ?? translation.providerId} · updated{" "}
        {formatRelativeTime(translation.updatedAt)}
      </p>

      {saveError ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p role="alert" className="text-sm text-destructive">
            {saveError}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onDismissError}
          >
            <RotateCcw aria-hidden />
            Dismiss
          </Button>
        </div>
      ) : null}

      {stale ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            The dialogue has changed, so individual lines cannot be regenerated
            against it. Retranslate the dialogue to bring the whole translation
            up to date.
          </span>
        </p>
      ) : null}

      <Separator />

      {translation.segments.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          This dialogue has no lines to translate.
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {translation.segments.map((segment) => (
            <TranslationSegmentRow
              key={segment.id}
              segment={segment}
              speakers={speakers}
              selected={segment.dialogueSegmentId === selectedSegmentId}
              busy={
                activeSegmentId === segment.dialogueSegmentId ||
                savingSegmentId === segment.dialogueSegmentId
              }
              // While any operation runs, no other line accepts one either:
              // two writers on the same record is how a result gets lost.
              disabled={stale || anyOperationRunning}
              onSelect={() => onSelect(segment.dialogueSegmentId)}
              onCommitText={(text) =>
                onCommitText(segment.dialogueSegmentId, text)
              }
              onRegenerate={() =>
                requestOperation(segment.dialogueSegmentId, "regenerate_segment")
              }
              onShorten={() =>
                requestOperation(segment.dialogueSegmentId, "shorten_segment")
              }
            />
          ))}
        </div>
      )}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your edit?</AlertDialogTitle>
            <AlertDialogDescription>
              You edited this line by hand.{" "}
              {confirming?.operation === "shorten_segment"
                ? "Making it shorter"
                : "Regenerating it"}{" "}
              will replace your wording if the new version succeeds. If it fails,
              your text stays exactly as it is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirming) {
                  onSegmentOperation(confirming.segmentId, confirming.operation);
                }
                setConfirming(null);
              }}
            >
              {confirming?.operation === "shorten_segment"
                ? "Make shorter"
                : "Regenerate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function SaveIndicator({
  status,
  revision,
}: {
  status: TranslationSaveStatus;
  revision: number;
}) {
  const label =
    status === "saving"
      ? "Saving…"
      : status === "error"
        ? "Save failed"
        : status === "saved"
          ? "Saved"
          : revision > 0
            ? "Saved"
            : "No changes";

  return (
    <span
      data-testid="translation-save-status"
      role="status"
      className={cn(
        "text-xs",
        status === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}
