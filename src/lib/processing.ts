import type {
  ProcessingJob,
  ProcessingJobStatus,
  ProcessingJobType,
} from "@/types/processing-job";

/**
 * Presentation helpers for processing jobs, kept in one place so status
 * wording and styling never diverge between components.
 */

type StatusPresentation = {
  label: string;
  className: string;
};

const STATUS_PRESENTATION: Record<ProcessingJobStatus, StatusPresentation> = {
  queued: {
    label: "Queued",
    className: "border-border bg-muted text-muted-foreground",
  },
  processing: {
    label: "Processing",
    className: "border-primary/30 bg-primary/10 text-primary",
  },
  completed: {
    label: "Completed",
    className: "border-border bg-secondary text-secondary-foreground",
  },
  failed: {
    label: "Failed",
    className: "border-destructive/40 bg-destructive/15 text-destructive",
  },
  cancelled: {
    label: "Cancelled",
    className: "border-border bg-muted text-muted-foreground",
  },
};

const UNKNOWN_STATUS: StatusPresentation = {
  label: "Unknown",
  className: "border-border bg-muted text-muted-foreground",
};

export function getJobStatusPresentation(
  status: ProcessingJobStatus | string,
): StatusPresentation {
  return STATUS_PRESENTATION[status as ProcessingJobStatus] ?? UNKNOWN_STATUS;
}

const JOB_TYPE_LABELS: Record<ProcessingJobType, string> = {
  probe_media: "Inspect source",
  extract_audio: "Extract audio",
  convert_media: "Convert audio",
  transcribe: "Transcribe speech",
  diarize: "Analyse speakers",
  translate: "Translate dialogue",
};

export function getJobTypeLabel(type: ProcessingJobType | string): string {
  return JOB_TYPE_LABELS[type as ProcessingJobType] ?? "Processing";
}

export function isJobCancellable(job: ProcessingJob): boolean {
  return job.status === "queued" || job.status === "processing";
}

/** "Processing · 63%" · "Processing…" when no percentage is available. */
export function describeJobProgress(job: ProcessingJob): string {
  const { label } = getJobStatusPresentation(job.status);

  if (job.status !== "processing") {
    return label;
  }

  return job.indeterminate ? `${label}…` : `${label} · ${job.progress}%`;
}
