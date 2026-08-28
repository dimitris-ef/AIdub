"use client";

import Link from "next/link";
import { Captions, FileVideo, Mic, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import type { ProcessingJob } from "@/types/processing-job";
import { getLanguageLabel } from "@/lib/languages";
import { workspaceSectionHref } from "@/lib/navigation";
import { formatRelativeTime } from "@/lib/dates";
import { useDialogue } from "@/hooks/use-dialogue";
import { useProcessingJobs } from "@/hooks/use-processing-jobs";
import { useSourceMedia } from "@/hooks/use-source-media";
import { useTranscript } from "@/hooks/use-transcript";
import { useProjectWorkspace } from "@/components/workspace/project-workspace-provider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ProcessingErrorMessage } from "@/components/processing/processing-job-status";
import { SpeakerAnalysisPanel } from "@/components/diarization/speaker-analysis-panel";
import { ProjectVideoPlayer } from "@/components/player/project-video-player";
import { TranscriptEditor } from "@/components/transcript/transcript-editor";
import { TranscriptMessage } from "@/components/transcript/transcript-empty-state";
import { TranscriptSegmentRow } from "@/components/transcript/transcript-segment-row";
import { TranscriptionStatus } from "@/components/transcript/transcription-status";

/**
 * The Transcript section — Aidub's review and correction workspace.
 *
 * Three layers live here, deliberately stacked rather than merged:
 *
 *  - the **raw** transcript and speaker analysis, still separately visible and
 *    still produced by provider-agnostic processing jobs;
 *  - the **derived** unified dialogue that combines them;
 *  - the **editable** document a person corrects, which is what every later
 *    stage will consume.
 *
 * Corrections are applied to the dialogue alone. Nothing here can reach the
 * transcript or diarization stores, so reviewing can never damage the results
 * the models produced.
 */
export function TranscriptWorkspace() {
  const { project, isLoading: isProjectLoading } = useProjectWorkspace();
  // The editor needs the video itself, not just the source's identity.
  const { status: mediaStatus, media, previewUrl } = useSourceMedia(project);
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

  const {
    status: dialogueStatus,
    state: dialogueState,
    dialogue,
    staleBaseline,
    error: dialogueError,
    reload: reloadDialogue,
  } = useDialogue(project?.id ?? null, media?.id ?? null, {
    revision: dialogueRevision,
  });

  async function handleTranscribe() {
    if (await startJob("transcribe")) {
      toast.success("Transcription started");
    }
  }

  if (isProjectLoading || !project || mediaStatus === "loading") {
    return <TranscriptSkeleton />;
  }

  const isBusy = Boolean(activeJob) || pendingType === "transcribe";

  const speakerPanel = (
    <SpeakerAnalysisPanel
      projectId={project.id}
      media={media}
      jobs={jobs}
      pendingType={pendingType}
      startJob={startJob}
      cancelJob={cancelJob}
    />
  );

  if (!media) {
    return (
      <section className="space-y-4">
        <TranscriptHeader />
        <TranscriptMessage
          icon={<FileVideo className="size-5" aria-hidden />}
          title="No source video yet"
          description="Add a source video before editing the transcript. Transcription runs on the audio extracted from it."
          actions={
            <Button asChild size="sm">
              <Link href={workspaceSectionHref(project.id, "media")}>
                Go to Media
              </Link>
            </Button>
          }
        />
        {speakerPanel}
      </section>
    );
  }

  const player = previewUrl ? (
    <ProjectVideoPlayer media={media} previewUrl={previewUrl} />
  ) : (
    <p className="rounded-lg border border-border bg-card/40 p-4 text-sm text-muted-foreground">
      The stored video could not be loaded for playback. The dialogue can still
      be reviewed.
    </p>
  );

  const rawTranscriptPanel = (
    <RawTranscriptPanel
      status={transcriptStatus}
      transcript={transcript}
      error={transcriptError}
      onReload={reloadTranscript}
    />
  );

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

      {dialogueStatus === "loading" ? (
        <TranscriptSkeleton />
      ) : dialogueStatus === "error" ? (
        <TranscriptMessage
          icon={<TriangleAlert className="size-5" aria-hidden />}
          title="The dialogue could not be loaded"
          description={dialogueError ?? "Please try again."}
          actions={
            <Button variant="outline" size="sm" onClick={reloadDialogue}>
              <RotateCcw aria-hidden />
              Try again
            </Button>
          }
        />
      ) : dialogue ? (
        <TranscriptEditor
          projectId={project.id}
          media={media}
          dialogue={dialogue}
          onReload={reloadDialogue}
          staleBaseline={staleBaseline}
          playerSlot={player}
          sidebarSlot={
            <>
              {rawTranscriptPanel}
              {speakerPanel}
            </>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
          <div className="space-y-4">
            {player}
            {rawTranscriptPanel}
            {speakerPanel}
          </div>

          <PrerequisiteState
            state={dialogueState}
            isBusy={isBusy}
            onTranscribe={() => void handleTranscribe()}
          />
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Corrections are stored with the dialogue for this source video. The
        transcription and speaker analysis they were built from are never
        changed.
      </p>
    </section>
  );
}

/** What is still missing before there is anything to review. */
function PrerequisiteState({
  state,
  isBusy,
  onTranscribe,
}: {
  state: string | null;
  isBusy: boolean;
  onTranscribe: () => void;
}) {
  if (state === "diarization_required") {
    return (
      <TranscriptMessage
        icon={<Captions className="size-5" aria-hidden />}
        title="Speaker analysis is required"
        description="Run speaker analysis to find out who is speaking. The dialogue is assembled once both the transcript and the speakers are known."
      />
    );
  }

  if (state === "source_mismatch") {
    return (
      <TranscriptMessage
        icon={<TriangleAlert className="size-5" aria-hidden />}
        title="These results describe different sources"
        description="The transcript and speaker analysis belong to different source videos, so they were not combined."
      />
    );
  }

  return (
    <TranscriptMessage
      icon={<Captions className="size-5" aria-hidden />}
      title="Transcription is required"
      description="Complete transcription and speaker analysis before reviewing dialogue. The audio extracted for processing is reused when it already exists."
      actions={
        <Button size="sm" disabled={isBusy} onClick={onTranscribe}>
          <Mic aria-hidden />
          Transcribe source
        </Button>
      }
    />
  );
}

/**
 * The raw Part 5 transcript, kept visible alongside the editor.
 *
 * Editing changes the dialogue, not this — so being able to see what the model
 * actually produced remains useful for judging a correction.
 */
function RawTranscriptPanel({
  status,
  transcript,
  error,
  onReload,
}: {
  status: string;
  transcript: ReturnType<typeof useTranscript>["transcript"];
  error: string | null;
  onReload: () => void;
}) {
  if (status === "loading") {
    return <Skeleton className="h-24 w-full" />;
  }

  if (status === "error") {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-card/40 p-4">
        <p role="alert" className="text-sm text-destructive">
          {error ?? "The transcript could not be loaded."}
        </p>
        <Button variant="outline" size="sm" onClick={onReload}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
      </div>
    );
  }

  if (!transcript) {
    return null;
  }

  // A transcription that found no speech is an outcome, not a detail: it says
  // why there is nothing to review, and it is what distinguishes silence from
  // a failure. It stays on screen rather than behind a disclosure.
  if (transcript.segments.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/40 p-4">
        <p className="text-sm font-medium">Raw transcript</p>
        <p className="mt-2 text-sm text-muted-foreground">
          No speech was detected in this source.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {transcript.providerModel ?? transcript.providerId} · updated{" "}
          {formatRelativeTime(transcript.updatedAt)}
        </p>
      </div>
    );
  }

  return (
    <details className="rounded-lg border border-border bg-card/40 p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Raw transcript
      </summary>

      <p className="mt-2 text-xs text-muted-foreground">
        {transcript.segments.length}{" "}
        {transcript.segments.length === 1 ? "segment" : "segments"}
        {transcript.language
          ? ` · detected ${getLanguageLabel(transcript.language)}`
          : ""}{" "}
        · {transcript.providerModel ?? transcript.providerId} · updated{" "}
        {formatRelativeTime(transcript.updatedAt)}
      </p>

      <Separator className="my-2" />

      <div className="max-h-72 divide-y divide-border/60 overflow-y-auto">
        {transcript.segments.map((segment) => (
          <TranscriptSegmentRow key={segment.id} segment={segment} />
        ))}
      </div>
    </details>
  );
}

function TranscriptHeader() {
  return (
    <div className="space-y-1">
      <h2 className="text-base font-semibold tracking-tight">Transcript</h2>
      <p className="text-sm text-muted-foreground">
        Review the video and correct who said what, and when. Translation comes
        in a later part.
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
