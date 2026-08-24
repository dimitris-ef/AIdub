import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { deriveProjectName } from "@/lib/project";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PlaceholderBadge } from "@/components/layout/placeholder-badge";
import { WorkspaceSectionNav } from "@/components/workspace/workspace-section-nav";

/**
 * Shared workspace chrome. It lives in the project layout, so it is not
 * re-mounted when the user moves between workspace sections.
 */
export function WorkspaceHeader({ projectId }: { projectId: string }) {
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

        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate text-sm font-semibold tracking-tight">
            {deriveProjectName(projectId)}
          </h1>
          <PlaceholderBadge>Placeholder project</PlaceholderBadge>
        </div>

        <p className="ml-auto hidden text-xs text-muted-foreground md:block">
          Name derived from the URL · nothing is saved yet
        </p>
      </div>

      <WorkspaceSectionNav projectId={projectId} />
    </header>
  );
}
