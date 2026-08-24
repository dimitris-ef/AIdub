import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = {
  title: "Projects",
};

export default function ProjectsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-8">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <PageHeader
          title="Projects"
          description="A dubbing project holds one piece of media and everything derived from it: transcript, translation, voices, mix and exports."
        />

        <div className="flex min-h-80 items-center justify-center rounded-lg border border-dashed border-border bg-card/30 p-8">
          <div className="max-w-md space-y-4 text-center">
            <span
              aria-hidden
              className="mx-auto grid size-10 place-items-center rounded-md bg-muted text-muted-foreground"
            >
              <FolderOpen className="size-5" />
            </span>
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold tracking-tight">
                No projects yet
              </h2>
              <p className="text-sm text-muted-foreground">
                Creating, storing and listing projects arrives in a later part.
                The workspace shell already renders for any project id, so you
                can walk through its sections today.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/projects/demo/media">
                Open the demo workspace
                <ChevronRight aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
