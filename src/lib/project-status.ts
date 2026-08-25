import { PROJECT_STATUSES, type ProjectStatus } from "@/types/project";

type StatusPresentation = {
  label: string;
  /** Token-based classes; see src/app/globals.css. */
  className: string;
};

const STATUS_PRESENTATION: Record<ProjectStatus, StatusPresentation> = {
  draft: {
    label: "Draft",
    className: "border-border bg-muted text-muted-foreground",
  },
  processing: {
    label: "Processing",
    className: "border-primary/30 bg-primary/10 text-primary",
  },
  ready: {
    label: "Ready",
    className: "border-primary/40 bg-primary/15 text-primary",
  },
  completed: {
    label: "Completed",
    className: "border-border bg-secondary text-secondary-foreground",
  },
  error: {
    label: "Error",
    className: "border-destructive/40 bg-destructive/15 text-destructive",
  },
};

const UNKNOWN_STATUS_PRESENTATION: StatusPresentation = {
  label: "Unknown",
  className: "border-border bg-muted text-muted-foreground",
};

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return (
    typeof value === "string" &&
    (PROJECT_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Presentation for a status value. Unknown values (e.g. data written by a
 * future version of Aidub) degrade to a neutral badge instead of crashing.
 */
export function getProjectStatusPresentation(
  status: ProjectStatus | string,
): StatusPresentation {
  return isProjectStatus(status)
    ? STATUS_PRESENTATION[status]
    : UNKNOWN_STATUS_PRESENTATION;
}

export function getProjectStatusLabel(status: ProjectStatus | string): string {
  return getProjectStatusPresentation(status).label;
}
