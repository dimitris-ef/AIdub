"use client";

import { Toaster as SonnerToaster } from "sonner";

/**
 * Toast host. Aidub is dark-first, so the toaster is pinned to the dark theme
 * and styled with the application's design tokens.
 */
export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "!bg-popover !text-popover-foreground !border-border !rounded-md !shadow-md",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
          cancelButton: "!bg-muted !text-muted-foreground",
          error: "!text-destructive",
        },
      }}
    />
  );
}
