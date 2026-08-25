"use client";

import { useState } from "react";

import type { Project } from "@/types/project";
import { validateProjectName } from "@/lib/project-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProjectNameField } from "@/components/projects/project-form-fields";

/**
 * Mount this with a key derived from the project id: the form state is seeded
 * from the project once, and remounting resets it without an effect.
 */
export function RenameProjectDialog({
  project,
  onOpenChange,
  onRename,
}: {
  /** The project being renamed, or null when the dialog is closed. */
  project: Project | null;
  onOpenChange: (open: boolean) => void;
  onRename: (project: Project, name: string) => Promise<void>;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project) return;

    const result = validateProjectName(name);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setIsSubmitting(true);
    try {
      await onRename(project, result.value);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={project !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isSubmitting) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
          <DialogDescription>
            Only the name changes — the project keeps its id, languages, status
            and history.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <ProjectNameField
            label="Project name"
            value={name}
            onChange={(value) => {
              setName(value);
              if (error) setError(undefined);
            }}
            error={error}
            autoFocus
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save name"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
