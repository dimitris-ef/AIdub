"use client";

import { useState } from "react";
import {
  FileVideo,
  Loader2,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectWorkspace } from "@/components/workspace/project-workspace-provider";
import { useSourceMedia } from "@/hooks/use-source-media";
import {
  SourceVideoDropzone,
  SourceVideoPicker,
} from "@/components/media/source-video-picker";
import { SourceVideoPlayer } from "@/components/media/source-video-player";
import { SourceVideoDetails } from "@/components/media/source-video-details";
import { RemoveVideoDialog } from "@/components/media/remove-video-dialog";

/**
 * The Media section: import, inspect, preview, replace and remove a project's
 * source video.
 *
 * It presents state and triggers workflows only. Validation, metadata
 * extraction, storage and project updates all live behind
 * `ProjectMediaService` — this component never touches IndexedDB.
 */
export function MediaWorkspace() {
  const { project, isLoading: isProjectLoading, reload } = useProjectWorkspace();
  const {
    status,
    media,
    previewUrl,
    loadError,
    actionError,
    pendingAction,
    isBusy,
    importVideo,
    replaceVideo,
    removeVideo,
    reload: reloadMedia,
  } = useSourceMedia(project, { onProjectChanged: reload });
  const [isRemoveOpen, setIsRemoveOpen] = useState(false);

  async function handleImport(file: File) {
    if (await importVideo(file)) {
      toast.success("Source video imported");
    }
  }

  async function handleReplace(file: File) {
    if (await replaceVideo(file)) {
      toast.success("Source video replaced");
    }
  }

  async function handleRemove() {
    const removed = await removeVideo();
    setIsRemoveOpen(false);

    if (removed) {
      toast.success("Source video removed");
    }
  }

  if (isProjectLoading || !project || status === "loading") {
    return <MediaSkeleton />;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold tracking-tight">
            Source video
          </h2>
          <p className="text-sm text-muted-foreground">
            The original video this project dubs. One source video per project.
          </p>
        </div>

        {status === "ready" && media ? (
          <div className="flex items-center gap-2">
            <SourceVideoPicker
              label={pendingAction === "replacing" ? "Replacing…" : "Replace"}
              inputLabel="Replace source video"
              variant="outline"
              size="sm"
              icon={<Upload aria-hidden />}
              disabled={isBusy}
              onSelect={handleReplace}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => setIsRemoveOpen(true)}
            >
              <Trash2 aria-hidden />
              Remove
            </Button>
          </div>
        ) : null}
      </div>

      {actionError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {actionError}
        </p>
      ) : null}

      {status === "error" ? (
        <MediaMessage
          icon={<TriangleAlert className="size-5" aria-hidden />}
          title="Could not load the source video"
          description={loadError ?? "Please try again."}
          actions={
            <Button variant="outline" size="sm" onClick={reloadMedia}>
              <RotateCcw aria-hidden />
              Try again
            </Button>
          }
        />
      ) : null}

      {status === "empty" ? (
        <EmptySourceVideo onSelect={handleImport} isBusy={isBusy} />
      ) : null}

      {status === "missing" ? (
        <MediaMessage
          icon={<TriangleAlert className="size-5" aria-hidden />}
          title="Source video unavailable"
          description="This project references a video that is no longer stored in this browser. Browser storage may have been cleared. Import a replacement, or remove the reference to start over."
          actions={
            <>
              <SourceVideoPicker
                label="Import replacement"
                inputLabel="Import replacement source video"
                size="sm"
                icon={<Upload aria-hidden />}
                disabled={isBusy}
                onSelect={handleReplace}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={isBusy}
                onClick={() => setIsRemoveOpen(true)}
              >
                <Trash2 aria-hidden />
                Remove reference
              </Button>
            </>
          }
        />
      ) : null}

      {status === "ready" && media && previewUrl ? (
        <div className="space-y-4 rounded-lg border border-border bg-card/40 p-4 lg:p-5">
          <SourceVideoPlayer media={media} previewUrl={previewUrl} />
          <Separator />
          <SourceVideoDetails media={media} />
        </div>
      ) : null}

      {isBusy ? (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {pendingAction === "removing"
            ? "Removing video…"
            : pendingAction === "replacing"
              ? "Replacing video…"
              : "Importing video…"}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Source video files are stored in this browser during development. They
        are not uploaded anywhere, are not synced between devices, and depend on
        the browser&apos;s storage quota.
      </p>

      <RemoveVideoDialog
        open={isRemoveOpen}
        filename={media?.filename ?? null}
        isRemoving={pendingAction === "removing"}
        onOpenChange={setIsRemoveOpen}
        onConfirm={handleRemove}
      />
    </section>
  );
}

function EmptySourceVideo({
  onSelect,
  isBusy,
}: {
  onSelect: (file: File) => void;
  isBusy: boolean;
}) {
  return (
    <SourceVideoDropzone onSelect={onSelect} disabled={isBusy}>
      <div className="flex min-h-64 flex-col items-center justify-center gap-4 p-8 text-center">
        <span
          aria-hidden
          className="grid size-10 place-items-center rounded-md bg-muted text-muted-foreground"
        >
          <FileVideo className="size-5" />
        </span>
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold tracking-tight">
            Add source video
          </h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Import the original video you want to dub. Drop a file here, or
            select one from your computer.
          </p>
        </div>
        <SourceVideoPicker
          label="Select video"
          inputLabel="Select source video"
          size="sm"
          icon={<Upload aria-hidden />}
          disabled={isBusy}
          onSelect={onSelect}
        />
        <p className="text-xs text-muted-foreground">
          MP4, MOV, or WebM — playback depends on the codecs your browser
          supports.
        </p>
      </div>
    </SourceVideoDropzone>
  );
}

function MediaMessage({
  icon,
  title,
  description,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actions: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card/40 p-8 text-center">
      <span className="grid size-10 place-items-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {actions}
      </div>
    </div>
  );
}

function MediaSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">Loading source video…</span>
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
