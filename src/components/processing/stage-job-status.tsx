"use client";

import { X } from "lucide-react";

import type { ProcessingJob } from "@/types/processing-job";
import { describeJobProgress, isJobCancellable } from "@/lib/processing";
import { Button } from "@/components/ui/button";
import {
  ProcessingErrorMessage,
  ProcessingJobStatusBadge,
  ProcessingProgress,
} from "@/components/processing/processing-job-status";

/**
 * Live state of one provider-driven job, built from the Part 4 job model and
 * its status components. Transcription and diarization share it: neither gets
 * its own job UI system, and only the title differs.
 */
export function StageJobStatus({
  job,
  title,
  onCancel,
}: {
  job: ProcessingJob;
  title: string;
  onCancel: () => void;
}) {
  const active = job.status === "queued" || job.status === "processing";

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          <ProcessingJobStatusBadge status={job.status} />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {describeJobProgress(job)}
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

      {active ? (
        <>
          <ProcessingProgress
            progress={job.progress}
            indeterminate={job.indeterminate}
          />
          {job.stage ? (
            <p className="text-xs text-muted-foreground">{job.stage}…</p>
          ) : null}
        </>
      ) : null}

      {job.error ? <ProcessingErrorMessage message={job.error.message} /> : null}
    </div>
  );
}
