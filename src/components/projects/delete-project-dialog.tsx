"use client";

import { useState } from "react";

import type { Project } from "@/types/project";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function DeleteProjectDialog({
  project,
  onOpenChange,
  onDelete,
}: {
  /** The project being deleted, or null when the dialog is closed. */
  project: Project | null;
  onOpenChange: (open: boolean) => void;
  onDelete: (project: Project) => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleConfirm(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!project) return;

    setIsDeleting(true);
    try {
      await onDelete(project);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <AlertDialog
      open={project !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isDeleting) return;
        onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete “{project?.name ?? "project"}”?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the project, its settings and the copy of
            its source video stored in this browser. It cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isDeleting}>
            {isDeleting ? "Deleting…" : "Delete project"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
