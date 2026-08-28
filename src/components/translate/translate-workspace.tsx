"use client";

import Link from "next/link";
import {
  Captions,
  FileVideo,
  Languages,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import type { ProcessingJob } from "@/types/processing-job";
import { formatLanguagePair, getLanguageLabel } from "@/lib/languages";
import { workspaceSectionHref } from "@/lib/navigation";
import { TRANSLATION_STALE_MESSAGES } from "@/lib/translation/translation-staleness";
import type { TranslationStaleReason } from "@/lib/translation/translation-staleness";
import { useDialogue } from "@/hooks/use-dialogue";
import { useProcessingJobs } from "@/hooks/use-processing-jobs";
import { useSourceMedia } from "@/hooks/use-source-media";
import { useTranslation } from "@/hooks/use-translation";
import { useProjectWorkspace } from "@/components/workspace/project-workspace-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProcessingErrorMessage } from "@/components/processing/processing-job-status";
import { StageJobStatus } from "@/components/processing/stage-job-status";
import { TranslationMessage } from "@/components/translate/translation-empty-state";
import { TranslationPreview } from "@/components/translate/translation-preview";

/**
 * The Translate section.
 *
 * It answers one question — what is the translated text for each line of
 * dialogue? — and it knows nothing about how that happens: not which provider
 * runs, not whether the provider is a hosted API or a self-hosted model, not
 * how the work is batched, and not what it cost. It starts a `translate`
 * processing job and reads the persisted translation back.
 *
 * The input is the **current editable dialogue** from Parts 7 and 8, which is
 * why this page requires the Transcript step rather than offering to translate
 * a raw transcript: corrections a person made are the thing worth translating.
 *
 * Part 9 keeps the result read-only. Editing translated text, alternate takes,
 * and fitting a line to its original delivery are Part 10.
 */
export function TranslateWorkspace() {
  const { project, isLoading: isProjectLoading } = useProjectWorkspace();
  const { status: mediaStatus, media } = useSourceMedia(project);
  const { jobs, error: jobError, pendingType, startJob, cancelJob } =
    useProcessingJobs(project, media);

  const translationJobs = jobs.filter((job) => job.type === "translate");
  const activeJob = translationJobs.find(
    (job) => job.status === "queued" || job.status === "processing",
  );
  const latestJob: ProcessingJob | undefined = translationJobs[0];
  const completedJobId = translationJobs.find(
    (job) => job.status === "completed",
  )?.id;

  // The dialogue is what gets translated, and its speaker names are what the
  // preview resolves ids against.
  const {
    status: dialogueStatus,
    state: dialogueState,
    dialogue,
  } = useDialogue(project?.id ?? null, media?.id ?? null);

  const languages = project
    ? {
        sourceLanguage: project.sourceLanguage,
        targetLanguage: project.targetLanguage,
      }
    : null;

  const {
    status: translationStatus,
    state: translationState,
    translation,
    staleReason,
    error: translationError,
    reload: reloadTranslation,
  } = useTranslation(project?.id ?? null, media?.id ?? null, languages, {
    // A completed job means there is a new translation to read; the dialogue
    // revision is in the key too, so correcting the transcript re-asks.
    revision: `${completedJobId ?? ""}::${dialogue?.editMetadata.revision ?? ""}`,
  });

  if (isProjectLoading || !project || mediaStatus === "loading") {
    return <TranslateSkeleton />;
  }

  const { sourceLanguage, targetLanguage } = project;
  const sameLanguage = sourceLanguage === targetLanguage;
  const isPending = pendingType === "translate";
  const isBusy = Boolean(activeJob) || isPending;

  async function handleTranslate() {
    if (!dialogue) {
      return;
    }

    const started = await startJob("translate", {
      kind: "translate",
      // The job names the exact dialogue revision it was created for, so a
      // result produced against text that has since changed can be rejected
      // rather than stored as current.
      dialogueId: dialogue.id,
      dialogueRevision: dialogue.editMetadata.revision,
      sourceLanguage,
      targetLanguage,
    });

    if (started) {
      toast.success("Translation started");
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TranslateHeader />

        {dialogue && !sameLanguage ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {formatLanguagePair(
                project.sourceLanguage,
                project.targetLanguage,
              )}
            </span>
            <Button
              size="sm"
              variant={translation ? "outline" : "default"}
              disabled={isBusy}
              onClick={() => void handleTranslate()}
            >
              <Languages aria-hidden />
              {isPending
                ? "Starting…"
                : translation
                  ? "Retranslate"
                  : "Translate"}
            </Button>
          </div>
        ) : null}
      </div>

      {jobError ? <ProcessingErrorMessage message={jobError} /> : null}

      {!media ? (
        <TranslationMessage
          icon={<FileVideo className="size-5" aria-hidden />}
          title="No source video yet"
          description="Add a source video and review its transcript before translating this project."
          actions={
            <Button asChild size="sm">
              <Link href={workspaceSectionHref(project.id, "media")}>
                Go to Media
              </Link>
            </Button>
          }
        />
      ) : sameLanguage ? (
        // Refused rather than run: translating a language into itself would
        // spend provider credits to reproduce text we already have.
        <TranslationMessage
          icon={<TriangleAlert className="size-5" aria-hidden />}
          title="Source and target languages match"
          description={`This project translates ${getLanguageLabel(project.sourceLanguage)} into ${getLanguageLabel(project.targetLanguage)}. Choose a different target language to translate the dialogue.`}
        />
      ) : dialogueStatus === "loading" ? (
        <TranslateSkeleton />
      ) : !dialogue ? (
        <TranslationMessage
          icon={<Captions className="size-5" aria-hidden />}
          title="Transcript review is required"
          description={
            dialogueState === "diarization_required"
              ? "Run speaker analysis in the Transcript section. Translation works from the reviewed dialogue, not from raw transcription."
              : "Complete transcript review before translating this project. Translation works from the reviewed dialogue, including your corrections."
          }
          actions={
            <Button asChild size="sm">
              <Link href={workspaceSectionHref(project.id, "transcript")}>
                Go to Transcript
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          {activeJob ? (
            <StageJobStatus
              job={activeJob}
              title="Translating dialogue"
              onCancel={() => void cancelJob(activeJob.id)}
            />
          ) : null}

          {!activeJob && latestJob?.status === "failed" ? (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <p role="alert" className="text-sm text-destructive">
                {latestJob.error?.message ??
                  "Translation failed while processing this dialogue."}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={isBusy}
                onClick={() => void handleTranslate()}
              >
                <RotateCcw aria-hidden />
                Try again
              </Button>
              {translation ? (
                <p className="text-xs text-muted-foreground">
                  The previous translation is still available below.
                </p>
              ) : null}
            </div>
          ) : null}

          {!activeJob && latestJob?.status === "cancelled" && !translation ? (
            <p className="text-sm text-muted-foreground">
              The last translation was cancelled. Nothing was saved.
            </p>
          ) : null}

          {translationState === "stale" && translation ? (
            <p
              role="status"
              className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {staleMessage(staleReason)} This translation was made from
                revision {translation.dialogueRevision} and is shown as it was —
                nothing was discarded. Retranslate to bring it up to date.
              </span>
            </p>
          ) : null}

          {translationStatus === "loading" ? (
            <Skeleton className="h-32 w-full" />
          ) : translationStatus === "error" ? (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                {translationError ?? "The translation could not be loaded."}
              </p>
              <Button variant="outline" size="sm" onClick={reloadTranslation}>
                <RotateCcw aria-hidden />
                Try again
              </Button>
            </div>
          ) : translation ? (
            <TranslationPreview
              translation={translation}
              speakers={dialogue.speakers}
            />
          ) : activeJob ? null : (
            <TranslationMessage
              icon={<Languages className="size-5" aria-hidden />}
              title="Translate Dialogue"
              description={`${formatLanguagePair(project.sourceLanguage, project.targetLanguage)} · ${dialogue.segments.length} ${dialogue.segments.length === 1 ? "dialogue segment" : "dialogue segments"}. The reviewed dialogue is translated line by line; the original text is kept.`}
              actions={
                <Button
                  size="sm"
                  disabled={isBusy}
                  onClick={() => void handleTranslate()}
                >
                  <Languages aria-hidden />
                  Translate
                </Button>
              }
            />
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Translations are stored for this dialogue revision and language pair.
        Correcting the transcript makes an existing translation out of date
        rather than deleting it.
      </p>
    </section>
  );
}

function staleMessage(reason: string | undefined): string {
  return (
    TRANSLATION_STALE_MESSAGES[reason as TranslationStaleReason] ??
    "The dialogue has changed since this translation was created."
  );
}

function TranslateHeader() {
  return (
    <div className="space-y-1">
      <h2 className="text-base font-semibold tracking-tight">Translate</h2>
      <p className="text-sm text-muted-foreground">
        Translate the reviewed dialogue into the target language. Speech
        synthesis and timing come in later parts.
      </p>
    </div>
  );
}

function TranslateSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <span className="sr-only">Loading translation…</span>
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
