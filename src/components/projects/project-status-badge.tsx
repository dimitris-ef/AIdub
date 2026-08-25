import { cn } from "@/lib/utils";
import { getProjectStatusPresentation } from "@/lib/project-status";
import type { ProjectStatus } from "@/types/project";

/** Single source of truth for how a project status looks. */
export function ProjectStatusBadge({
  status,
  className,
}: {
  status: ProjectStatus | string;
  className?: string;
}) {
  const { label, className: statusClassName } =
    getProjectStatusPresentation(status);

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
