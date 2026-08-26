"use client";

import { RotateCcw, Users } from "lucide-react";
import { toast } from "sonner";

import type { ProjectMedia } from "@/types/media";
import type { ProcessingJob, ProcessingJobType } from "@/types/processing-job";
import { formatRelativeTime } from "@/lib/dates";
import { useDiarization } from "@/hooks/use-diarization";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { StageJobStatus } from "@/components/processing/stage-job-status";
import { SpeakerRegionList } from "@/components/diarization/speaker-region-list";
import { SpeakerSummary } from "@/components/diarization/speaker-summary";

/**
 * Speaker Analysis: who spoke, and when.
 *
 * It knows nothing about diarization models, GPUs, credentials or provider
 * speaker labels — it starts a `diarize` processing job and reads the persisted
 * result back through `DiarizationClient`.
 *
 * It deliberately does *not* attribute transcript text to a speaker. Part 5's
 * transcript and Part 6's speaker regions are two independent timelines shown
 * side by side; merging them into a single dialogue view is Part 7.
 */
export function SpeakerAnalysisPanel({
  projectId,
  media,
  jobs,
  pendingType,
  startJob,
  cancelJob,
}: {
  projectId: string;
  /** Null while the project has no source video. */
  media: ProjectMedia | null;
  jobs: readonly ProcessingJob[];
  pendingType: ProcessingJobType | null;
  startJob: (type: ProcessingJobType) => Promise<boolean>;
  cancelJob: (jobId: string) => Promise<void>;
}) {
  const diarizationJobs = jobs.filter((job) => job.type === "diarize");
  const activeJob = diarizationJobs.find(
    (job) => job.status === "queued" || job.status === "processing",
  );
  const latestJob: ProcessingJob | undefined = diarizationJobs[0];
  const completedJobId = diarizationJobs.find(
    (job) => job.status === "completed",
  )?.id;

  const {
    status,
    diarization,
    error: loadError,
    reload,
  } = useDiarization(projectId, media?.id ?? null, {
    // A completed job means there is a new result to read.
    revision: completedJobId ?? "",
  });

  const isPending = pendingType === "diarize";
  const isBusy = Boolean(activeJob) || isPending;

  async function handleDiarize() {
    if (await startJob("diarize")) {
      toast.success("Speaker analysis started");
    }
  }

  return (
    <section
      aria-labelledby="speaker-analysis-heading"
      className="space-y-3 rounded-lg border border-border bg-card/40 p-4 lg:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3
            id="speaker-analysis-heading"
            className="text-sm font-semibold tracking-tight"
          >
            Speaker Analysis
          </h3>
          <p className="text-sm text-muted-foreground">
            Detect distinct speakers and determine when each person speaks.
            Speakers stay anonymous until a later part lets you name them.
          </p>
        </div>

        {media ? (
          <Button
            size="sm"
            variant={diarization ? "outline" : "default"}
            disabled={isBusy}
            onClick={() => void handleDiarize()}
          >
            <Users aria-hidden />
            {isPending
              ? "Starting…"
              : diarization
                ? "Rediarize"
                : "Diarize Speakers"}
          </Button>
        ) : null}
      </div>

      {!media ? (
        <p className="text-sm text-muted-foreground">
          Add a source video before running speaker diarization.
        </p>
      ) : (
        <>
          {activeJob ? (
            <StageJobStatus
              job={activeJob}
              title="Speaker diarization"
              onCancel={() => void cancelJob(activeJob.id)}
            />
          ) : null}

          {!activeJob && latestJob?.status === "failed" ? (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <p role="alert" className="text-sm text-destructive">
                {latestJob.error?.message ??
                  "Speaker analysis failed while processing this audio."}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={isBusy}
                onClick={() => void handleDiarize()}
              >
                <RotateCcw aria-hidden />
                Try again
              </Button>
              {diarization ? (
                <p className="text-xs text-muted-foreground">
                  The previous speaker analysis is still available below.
                </p>
              ) : null}
            </div>
          ) : null}

          {!activeJob && latestJob?.status === "cancelled" && !diarization ? (
            <p className="text-sm text-muted-foreground">
              The last speaker analysis was cancelled. Nothing was saved.
            </p>
          ) : null}

          {status === "loading" ? (
            <Skeleton className="h-16 w-full" />
          ) : status === "error" ? (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                {loadError ?? "The speaker analysis could not be loaded."}
              </p>
              <Button variant="outline" size="sm" onClick={reload}>
                <RotateCcw aria-hidden />
                Try again
              </Button>
            </div>
          ) : diarization ? (
            <div className="space-y-3">
              <Separator />
              <p className="text-xs text-muted-foreground">
                {diarization.speakers.length === 0
                  ? "No speakers were detected in this source."
                  : `${diarization.speakers.length} ${diarization.speakers.length === 1 ? "speaker" : "speakers"} detected · ${diarization.regions.length} ${diarization.regions.length === 1 ? "speaker region" : "speaker regions"}`}
                {" · "}
                {diarization.providerModel ?? diarization.providerId} · updated{" "}
                {formatRelativeTime(diarization.updatedAt)}
              </p>

              <SpeakerSummary
                speakers={diarization.speakers}
                regions={diarization.regions}
              />
              <SpeakerRegionList regions={diarization.regions} />
            </div>
          ) : activeJob ? null : (
            <p className="text-sm text-muted-foreground">
              This source has not been analysed for speakers yet.
            </p>
          )}
        </>
      )}
    </section>
  );
}
