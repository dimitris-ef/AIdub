"use client";

import Link from "next/link";
import { Captions, FileVideo, Mic, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import type { ProcessingJob } from "@/types/processing-job";
import { getLanguageLabel } from "@/lib/languages";
import { workspaceSectionHref } from "@/lib/navigation";
import { formatRelativeTime } from "@/lib/dates";
import { useProcessingJobs } from "@/hooks/use-processing-jobs";
import { useSourceMedia } from "@/hooks/use-source-media";
import { useTranscript } from "@/hooks/use-transcript";
import { useProjectWorkspace } from "@/components/workspace/project-workspace-provider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ProcessingErrorMessage } from "@/components/processing/processing-job-status";
import { SpeakerAnalysisPanel } from "@/components/diarization/speaker-analysis-panel";
import { DialoguePreview } from "@/components/dialogue/dialogue-preview";
import { TranscriptMessage } from "@/components/transcript/transcript-empty-state";
import { TranscriptSegmentRow } from "@/components/transcript/transcript-segment-row";
import { TranscriptionStatus } from "@/components/transcript/transcription-status";

/**
 * The Transcript section: turn the project's speech into timestamped text and
 * show what is already stored.
 *
 * It knows nothing about speech models, providers or credentials — it starts a
 * `transcribe` processing job and reads the persisted transcript back through
 * `TranscriptClient`.
 *
 * Speaker Analysis (Part 6) shares this section because speaker work is part
 * of preparing a transcript, but the raw layers remain independent: transcript
 * rows carry no speaker information, and the diarization panel carries no
 * text. Part 7's Dialogue preview is the layer above both — it shows the two
 * timelines combined without replacing either, so the raw outputs stay
 * inspectable.
 */
export function TranscriptWorkspace() {
  const { project, isLoading: isProjectLoading } = useProjectWorkspace();
  // Metadata only: the Transcript section never needs the video bytes for
  // preview, just the identity of the current source.
  const { status: mediaStatus, media } = useSourceMedia(project, {
    preview: false,
  });
  const { jobs, error: jobError, pendingType, startJob, cancelJob } =
    useProcessingJobs(project, media);

  const transcriptionJobs = jobs.filter((job) => job.type === "transcribe");
  const activeJob = transcriptionJobs.find(
    (job) => job.status === "queued" || job.status === "processing",
  );
  const latestJob: ProcessingJob | undefined = transcriptionJobs[0];
  const completedJobId = transcriptionJobs.find(
    (job) => job.status === "completed",
  )?.id;

  // The dialogue is derived from both raw layers, so it is refetched whenever
  // either of them produces a new result.
  const completedDiarizationJobId = jobs.find(
    (job) => job.type === "diarize" && job.status === "completed",
  )?.id;
  const dialogueRevision = `${completedJobId ?? ""}::${completedDiarizationJobId ?? ""}`;

  const {
    status: transcriptStatus,
    transcript,
    error: transcriptError,
    reload: reloadTranscript,
  } = useTranscript(project?.id ?? null, media?.id ?? null, {
    // A completed job means there is a new transcript to read.
    revision: completedJobId ?? "",
  });

  async function handleTranscribe() {
    if (await startJob("transcribe")) {
      toast.success("Transcription started");
    }
  }

  if (isProjectLoading || !project || mediaStatus === "loading") {
    return <TranscriptSkeleton />;
  }

  if (!media) {
    return (
      <section className="space-y-4">
        <TranscriptHeader />
        <TranscriptMessage
          icon={<FileVideo className="size-5" aria-hidden />}
          title="No source video yet"
          description="Add a source video before creating a transcript. Transcription runs on the audio extracted from it."
          actions={
            <Button asChild size="sm">
              <Link href={workspaceSectionHref(project.id, "media")}>
                Go to Media
              </Link>
            </Button>
          }
        />
        <SpeakerAnalysisPanel
          projectId={project.id}
          media={null}
          jobs={jobs}
          pendingType={pendingType}
          startJob={startJob}
          cancelJob={cancelJob}
        />
        <DialoguePreview
          projectId={project.id}
          sourceMediaId={null}
          revision={dialogueRevision}
        />
      </section>
    );
  }

  const isBusy = Boolean(activeJob) || pendingType === "transcribe";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TranscriptHeader />

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Source language: {getLanguageLabel(project.sourceLanguage)}
          </span>
          <Button
            size="sm"
            disabled={isBusy}
            onClick={() => void handleTranscribe()}
          >
            <Mic aria-hidden />
            {pendingType === "transcribe"
              ? "Starting…"
              : transcript
                ? "Retranscribe"
                : "Transcribe source"}
          </Button>
        </div>
      </div>

      {jobError ? <ProcessingErrorMessage message={jobError} /> : null}

      {activeJob ? (
        <TranscriptionStatus
          job={activeJob}
          onCancel={() => void cancelJob(activeJob.id)}
        />
      ) : null}

      {!activeJob && latestJob && latestJob.status === "failed" ? (
        <TranscriptMessage
          icon={<TriangleAlert className="size-5" aria-hidden />}
          title="Transcription failed"
          description={
            latestJob.error?.message ??
            "Transcription failed while processing the source audio."
          }
          actions={
            <Button
              size="sm"
              variant="outline"
              disabled={isBusy}
              onClick={() => void handleTranscribe()}
            >
              <RotateCcw aria-hidden />
              Try again
            </Button>
          }
        />
      ) : null}

      {!activeJob && latestJob && latestJob.status === "cancelled" && !transcript ? (
        <p className="text-sm text-muted-foreground">
          The last transcription was cancelled. Nothing was saved.
        </p>
      ) : null}

      {transcriptStatus === "loading" ? (
        <TranscriptSkeleton />
      ) : transcriptStatus === "error" ? (
        <TranscriptMessage
          icon={<TriangleAlert className="size-5" aria-hidden />}
          title="The transcript could not be loaded"
          description={transcriptError ?? "Please try again."}
          actions={
            <Button variant="outline" size="sm" onClick={reloadTranscript}>
              <RotateCcw aria-hidden />
              Try again
            </Button>
          }
        />
      ) : transcript ? (
        <div className="space-y-3 rounded-lg border border-border bg-card/40 p-4 lg:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {transcript.segments.length}{" "}
              {transcript.segments.length === 1 ? "segment" : "segments"}
              {transcript.language
                ? ` · detected ${getLanguageLabel(transcript.language)}`
                : ""}{" "}
              · {transcript.providerModel ?? transcript.providerId} · updated{" "}
              {formatRelativeTime(transcript.updatedAt)}
            </p>
          </div>

          <Separator />

          {transcript.segments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No speech was detected in this source.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {transcript.segments.map((segment) => (
                <TranscriptSegmentRow key={segment.id} segment={segment} />
              ))}
            </div>
          )}
        </div>
      ) : activeJob ? null : (
        <TranscriptMessage
          icon={<Captions className="size-5" aria-hidden />}
          title="No transcript yet"
          description="Transcribe the source to turn its speech into timestamped text. The audio extracted for processing is reused when it already exists."
          actions={
            <Button
              size="sm"
              disabled={isBusy}
              onClick={() => void handleTranscribe()}
            >
              <Mic aria-hidden />
              Transcribe source
            </Button>
          }
        />
      )}

      <SpeakerAnalysisPanel
        projectId={project.id}
        media={media}
        jobs={jobs}
        pendingType={pendingType}
        startJob={startJob}
        cancelJob={cancelJob}
      />

      <DialoguePreview
        projectId={project.id}
        sourceMediaId={media.id}
        revision={dialogueRevision}
      />

      <p className="text-xs text-muted-foreground">
        Transcripts and speaker analysis stay attached to the source video they
        were made from, and are stored on the processing server during
        development.
      </p>
    </section>
  );
}

function TranscriptHeader() {
  return (
    <div className="space-y-1">
      <h2 className="text-base font-semibold tracking-tight">Transcript</h2>
      <p className="text-sm text-muted-foreground">
        Convert the source speech into timestamped text. Translation comes in a
        later part.
      </p>
    </div>
  );
}

function TranscriptSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <span className="sr-only">Loading transcript…</span>
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
