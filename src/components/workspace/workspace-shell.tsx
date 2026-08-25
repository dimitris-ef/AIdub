"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { MediaStageSlot } from "@/components/workspace/media-stage-slot";
import { TimelineSlot } from "@/components/workspace/timeline-slot";
import { useProjectWorkspace } from "@/components/workspace/project-workspace-provider";

/**
 * Composes the workspace once for every section:
 *
 *   WorkspaceHeader (project context + section navigation)
 *   MediaStageSlot  (reserved for the future persistent player)
 *   children        (the active workspace section)
 *   TimelineSlot    (reserved for the future dubbing timeline)
 */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { project, isLoading, error, reload } = useProjectWorkspace();

  if (error) {
    return (
      <WorkspaceMessage
        title="Could not open this project"
        description={error}
        action={
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            <RotateCcw aria-hidden />
            Try again
          </Button>
        }
      />
    );
  }

  if (!isLoading && !project) {
    return (
      <WorkspaceMessage
        icon={<SearchX className="size-5" aria-hidden />}
        title="Project not found"
        description="This project does not exist in this browser. It may have been deleted, or the link was created in a different browser — Part 2 stores projects locally."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/projects">
              <ArrowLeft aria-hidden />
              Back to projects
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <WorkspaceHeader />

      <div className="flex flex-1 flex-col gap-5 p-4 lg:p-6 xl:flex-row xl:gap-6">
        <MediaStageSlot className="xl:w-[24rem] xl:shrink-0" />
        <div className="min-w-0 flex-1">{children}</div>
      </div>

      <TimelineSlot />
    </div>
  );
}

function WorkspaceMessage({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md space-y-4 text-center">
        {icon ? (
          <span className="mx-auto grid size-10 place-items-center rounded-md bg-muted text-muted-foreground">
            {icon}
          </span>
        ) : null}
        <div className="space-y-1.5">
          <h1 className="text-base font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
    </div>
  );
}
