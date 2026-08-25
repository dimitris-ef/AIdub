import Link from "next/link";
import { MoreHorizontal, PencilLine, Trash2 } from "lucide-react";

import type { Project } from "@/types/project";
import { formatLanguagePair } from "@/lib/languages";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/dates";
import { defaultWorkspaceSection, workspaceSectionHref } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";

/**
 * Displays one project and exposes open/rename/delete. It never reads or
 * writes storage — mutations are raised to the dashboard.
 */
export function ProjectCard({
  project,
  onRename,
  onDelete,
}: {
  project: Project;
  onRename: (project: Project) => void;
  onDelete: (project: Project) => void;
}) {
  const href = workspaceSectionHref(project.id, defaultWorkspaceSection);

  return (
    <article className="group relative flex w-full flex-col gap-3 rounded-lg border border-border bg-card/40 p-4 transition-colors hover:border-border/80 hover:bg-card/70 focus-within:border-ring/60">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-sm font-semibold tracking-tight">
          {/* Stretched link: the whole card opens the project. */}
          <Link
            href={href}
            className="block truncate rounded-sm outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {project.name}
          </Link>
        </h3>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative z-10 -mr-1.5 -mt-1.5 size-8 text-muted-foreground/70 transition-colors hover:text-foreground data-[state=open]:text-foreground"
              aria-label={`Project actions for ${project.name}`}
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => onRename(project)}>
              <PencilLine aria-hidden />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDelete(project)}
            >
              <Trash2 aria-hidden />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="text-xs text-muted-foreground">
        {formatLanguagePair(project.sourceLanguage, project.targetLanguage)}
      </p>

      <div className="mt-auto flex items-center justify-between gap-3 pt-1">
        <ProjectStatusBadge status={project.status} />
        <span
          className="truncate text-xs text-muted-foreground"
          title={`Created ${formatAbsoluteDateTime(project.createdAt)}`}
        >
          Updated {formatRelativeTime(project.updatedAt)}
        </span>
      </div>
    </article>
  );
}
