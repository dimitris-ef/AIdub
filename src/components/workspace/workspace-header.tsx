"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { formatLanguagePair } from "@/lib/languages";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { WorkspaceSectionNav } from "@/components/workspace/workspace-section-nav";
import { useProjectWorkspace } from "@/components/workspace/project-workspace-provider";

/**
 * Shared workspace chrome. It lives in the project layout, so it is not
 * re-mounted when the user moves between workspace sections.
 */
export function WorkspaceHeader() {
  const { projectId, project, isLoading } = useProjectWorkspace();

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-3 lg:px-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              variant="ghost"
              size="icon"
              aria-label="Back to projects"
            >
              <Link href="/projects">
                <ArrowLeft aria-hidden />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Back to projects</TooltipContent>
        </Tooltip>

        {isLoading || !project ? (
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-28" />
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="truncate text-sm font-semibold tracking-tight">
              {project.name}
            </h1>
            <p className="text-xs text-muted-foreground">
              {formatLanguagePair(
                project.sourceLanguage,
                project.targetLanguage,
              )}
            </p>
            <ProjectStatusBadge status={project.status} />
          </div>
        )}
      </div>

      <WorkspaceSectionNav projectId={projectId} />
    </header>
  );
}
