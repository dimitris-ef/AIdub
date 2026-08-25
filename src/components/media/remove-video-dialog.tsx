"use client";

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

export function RemoveVideoDialog({
  open,
  filename,
  isRemoving,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  filename: string | null;
  isRemoving: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isRemoving) return;
        onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove source video?</AlertDialogTitle>
          <AlertDialogDescription>
            {filename ? `“${filename}” ` : "This video "}
            will be detached from the project and its copy stored in this
            browser will be deleted. The project itself is kept, and you can
            import another video afterwards.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRemoving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isRemoving}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {isRemoving ? "Removing…" : "Remove video"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
