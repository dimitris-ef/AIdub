import { cn } from "@/lib/utils";
import { getJobStatusPresentation } from "@/lib/processing";
import type { ProcessingJobStatus } from "@/types/processing-job";

/** Single source of truth for how a processing job status looks. */
export function ProcessingJobStatusBadge({
  status,
  className,
}: {
  status: ProcessingJobStatus | string;
  className?: string;
}) {
  const { label, className: statusClassName } =
    getJobStatusPresentation(status);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        statusClassName,
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Determinate bar, or a slim indeterminate track when progress is unknown. */
export function ProcessingProgress({
  progress,
  indeterminate,
  className,
}: {
  progress: number;
  indeterminate: boolean;
  className?: string;
}) {
  const value = Math.min(Math.max(progress, 0), 100);

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : value}
      aria-valuetext={indeterminate ? "Processing" : `${value}%`}
      className={cn(
        "h-1 w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full bg-primary transition-[width] duration-300",
          indeterminate && "animate-pulse",
        )}
        style={{ width: indeterminate ? "35%" : `${value}%` }}
      />
    </div>
  );
}

/** Concise, user-safe failure text — never raw command output. */
export function ProcessingErrorMessage({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <p className={cn("text-xs text-destructive", className)} role="alert">
      {message}
    </p>
  );
}
