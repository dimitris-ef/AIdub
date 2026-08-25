"use client";

import { AudioLines, ScanSearch, TriangleAlert, X } from "lucide-react";

import type { ProjectMedia } from "@/types/media";
import type { Project } from "@/types/project";
import type { ProcessingJob, ProcessingJobType } from "@/types/processing-job";
import { formatRelativeTime } from "@/lib/dates";
import {
  describeJobProgress,
  getJobTypeLabel,
  isJobCancellable,
} from "@/lib/processing";
import { useProcessingJobs } from "@/hooks/use-processing-jobs";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ProcessingErrorMessage,
  ProcessingJobStatusBadge,
  ProcessingProgress,
} from "@/components/processing/processing-job-status";
import { ProcessingJobResultDetails } from "@/components/processing/processing-job-result";

/**
 * Backend processing for the current source video.
 *
 * The panel triggers application-level jobs and renders their state; it knows
 * nothing about FFmpeg, temporary files or where the work runs.
 */
export function ProcessingPanel({
  project,
  media,
}: {
  project: Project;
  media: ProjectMedia;
}) {
  const {
    jobs,
    isLoading,
    error,
    capabilities,
    pendingType,
    startJob,
    cancelJob,
    artifactUrl,
  } = useProcessingJobs(project, media);

  const processingUnavailable =
    capabilities !== null &&
    (!capabilities.ffmpegAvailable || !capabilities.ffprobeAvailable);

  const actions: { type: ProcessingJobType; icon: React.ReactNode }[] = [
    { type: "probe_media", icon: <ScanSearch aria-hidden /> },
    { type: "extract_audio", icon: <AudioLines aria-hidden /> },
  ];

  return (
    <section
      aria-labelledby="processing-heading"
      className="space-y-4 rounded-lg border border-border bg-card/40 p-4 lg:p-5"
    >
      <div className="space-y-1">
        <h3
          id="processing-heading"
          className="text-sm font-semibold tracking-tight"
        >
          Processing
        </h3>
        <p className="text-sm text-muted-foreground">
          Server-side inspection and audio extraction for this source video.
          Later dubbing stages reuse the same job pipeline.
        </p>
      </div>

      {processingUnavailable ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          FFmpeg is not available on the processing server, so media jobs cannot
          run here.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {actions.map(({ type, icon }) => (
          <Button
            key={type}
            variant="outline"
            size="sm"
            // One job at a time from this panel: a second click cannot launch
            // a duplicate while creation is in flight.
            disabled={pendingType !== null || processingUnavailable}
            onClick={() => void startJob(type)}
          >
            {icon}
            {pendingType === type ? "Starting…" : getJobTypeLabel(type)}
          </Button>
        ))}
      </div>

      {error ? <ProcessingErrorMessage message={error} /> : null}

      <Separator />

      <div className="space-y-3">
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Recent jobs
        </h4>

        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : jobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No processing jobs have run for this source video yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((job) => (
              <li key={job.id}>
                <ProcessingJobRow
                  job={job}
                  onCancel={() => void cancelJob(job.id)}
                  artifactUrl={artifactUrl}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ProcessingJobRow({
  job,
  onCancel,
  artifactUrl,
}: {
  job: ProcessingJob;
  onCancel: () => void;
  artifactUrl: (artifactId: string) => string;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-background/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">
            {getJobTypeLabel(job.type)}
          </span>
          <ProcessingJobStatusBadge status={job.status} />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {job.status === "processing"
              ? describeJobProgress(job)
              : formatRelativeTime(job.updatedAt)}
          </span>
          {isJobCancellable(job) ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onCancel}
            >
              <X aria-hidden />
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      {job.status === "processing" ? (
        <ProcessingProgress
          progress={job.progress}
          indeterminate={job.indeterminate}
        />
      ) : null}

      {job.error ? <ProcessingErrorMessage message={job.error.message} /> : null}

      {job.status === "completed" ? (
        <ProcessingJobResultDetails
          result={job.result}
          artifactUrl={artifactUrl}
        />
      ) : null}
    </div>
  );
}
