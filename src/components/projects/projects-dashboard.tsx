"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import type { CreateProjectInput, Project } from "@/types/project";
import { defaultWorkspaceSection, workspaceSectionHref } from "@/lib/navigation";
import { useProjects } from "@/hooks/use-projects";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { ProjectList } from "@/components/projects/project-list";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { RenameProjectDialog } from "@/components/projects/rename-project-dialog";
import { DeleteProjectDialog } from "@/components/projects/delete-project-dialog";

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/**
 * The dashboard is a Client Component because Part 2 persistence is
 * browser-local. It talks to the repository through `useProjects` and never
 * touches storage itself.
 */
export function ProjectsDashboard() {
  const router = useRouter();
  const {
    projects,
    isLoading,
    error,
    reload,
    createProject,
    updateProject,
    deleteProject,
  } = useProjects();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  async function handleCreate(input: CreateProjectInput) {
    try {
      const project = await createProject(input);
      setIsCreateOpen(false);
      toast.success(`Created “${project.name}”`);
      router.push(
        workspaceSectionHref(project.id, defaultWorkspaceSection),
      );
    } catch (cause) {
      toast.error(errorMessage(cause, "Could not create the project."));
    }
  }

  async function handleRename(project: Project, name: string) {
    try {
      await updateProject(project.id, { name });
      setRenameTarget(null);
      toast.success(`Renamed to “${name}”`);
    } catch (cause) {
      toast.error(errorMessage(cause, "Could not rename the project."));
    }
  }

  async function handleDelete(project: Project) {
    try {
      await deleteProject(project.id);
      setDeleteTarget(null);
      toast.success(`Deleted “${project.name}”`);
    } catch (cause) {
      toast.error(errorMessage(cause, "Could not delete the project."));
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        title="Projects"
        description="A dubbing project holds one piece of media and everything derived from it: transcript, translation, voices, mix and exports."
        actions={
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus aria-hidden />
            New project
          </Button>
        }
      />

      {error ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="space-y-1">
            <p className="text-sm font-medium">Could not load your projects</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            <RotateCcw aria-hidden />
            Try again
          </Button>
        </div>
      ) : isLoading ? (
        <ProjectsLoading />
      ) : projects.length === 0 ? (
        <ProjectsEmptyState onCreate={() => setIsCreateOpen(true)} />
      ) : (
        <ProjectList
          projects={projects}
          onRename={setRenameTarget}
          onDelete={setDeleteTarget}
        />
      )}

      <p className="text-xs text-muted-foreground">
        Projects are stored in this browser only. This temporary persistence is
        replaced by a real database in a later part.
      </p>

      <CreateProjectDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onCreate={handleCreate}
      />
      <RenameProjectDialog
        key={renameTarget?.id ?? "rename-closed"}
        project={renameTarget}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        onRename={handleRename}
      />
      <DeleteProjectDialog
        project={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onDelete={handleDelete}
      />
    </div>
  );
}

function ProjectsLoading() {
  return (
    <div
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading projects…</span>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="space-y-3 rounded-lg border border-border bg-card/40 p-4"
        >
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <div className="flex items-center justify-between pt-2">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ProjectsEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
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
            Create your first Aidub project to set up its language pair and open
            the dubbing workspace.
          </p>
        </div>
        <Button size="sm" onClick={onCreate}>
          <Plus aria-hidden />
          New project
        </Button>
      </div>
    </div>
  );
}
