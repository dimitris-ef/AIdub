"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ProjectMedia } from "@/types/media";
import type { Project } from "@/types/project";
import {
  projectMediaService,
  toMediaErrorMessage,
  type ProjectMediaService,
} from "@/services/media/project-media-service";

export type SourceMediaStatus =
  | "loading"
  | "empty"
  /** Metadata and bytes are available; `previewUrl` is playable. */
  | "ready"
  /** The project references media whose metadata or bytes are gone. */
  | "missing"
  | "error";

export type SourceMediaAction = "importing" | "replacing" | "removing";

export interface UseSourceMediaResult {
  status: SourceMediaStatus;
  media: ProjectMedia | null;
  /** Ephemeral object URL for the stored blob; never persisted anywhere. */
  previewUrl: string | null;
  /** Message for `status === "error"`. */
  loadError: string | null;
  /** Message for the most recent failed action. */
  actionError: string | null;
  pendingAction: SourceMediaAction | null;
  isBusy: boolean;
  /** Each resolves to true when the operation succeeded. */
  importVideo: (file: File) => Promise<boolean>;
  replaceVideo: (file: File) => Promise<boolean>;
  removeVideo: () => Promise<boolean>;
  clearActionError: () => void;
  reload: () => void;
}

interface Resolution {
  key: string;
  status: Exclude<SourceMediaStatus, "loading">;
  media: ProjectMedia | null;
  previewUrl: string | null;
  message: string | null;
}

function resolutionKey(project: Project | null, token: number): string {
  return `${project?.id ?? ""}::${project?.sourceMediaId ?? ""}::${token}`;
}

/**
 * Resolves and manages the project's source video for the Media workspace.
 *
 * All persistence goes through `ProjectMediaService`; this hook only owns UI
 * state and the object-URL lifecycle — the URL is created when the stored blob
 * is read and revoked when the media changes or the component unmounts.
 */
export function useSourceMedia(
  project: Project | null,
  {
    service = projectMediaService,
    onProjectChanged,
    preview = true,
  }: {
    service?: ProjectMediaService;
    /** Reloads the project so a changed `sourceMediaId` propagates. */
    onProjectChanged?: () => Promise<void> | void;
    /**
     * Loads the stored bytes and creates a preview URL. Sections that only
     * need metadata (Transcript, for example) pass false and skip the read.
     */
    preview?: boolean;
  } = {},
): UseSourceMediaResult {
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [pendingAction, setPendingAction] = useState<SourceMediaAction | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingRef = useRef<SourceMediaAction | null>(null);

  const projectId = project?.id ?? null;
  const sourceMediaId = project?.sourceMediaId ?? null;
  const key = resolutionKey(project, reloadToken);

  // Deliberately keyed on the identity that decides the outcome (project id,
  // source media id, reload token) rather than on the project object: a reload
  // that returns an equivalent project must not revoke the object URL the
  // player is currently showing.
  useEffect(() => {
    if (!projectId) {
      return;
    }

    let cancelled = false;
    let activeUrl: string | null = null;

    async function resolve(
      currentProjectId: string,
    ): Promise<Omit<Resolution, "key">> {
      if (!sourceMediaId) {
        return { status: "empty", media: null, previewUrl: null, message: null };
      }

      const media = await service.getSourceMedia(currentProjectId);

      if (!media) {
        return {
          status: "missing",
          media: null,
          previewUrl: null,
          message: null,
        };
      }

      if (!preview) {
        return { status: "ready", media, previewUrl: null, message: null };
      }

      const blob = await service.getPlayableSource(media.id);

      if (!blob) {
        return { status: "missing", media, previewUrl: null, message: null };
      }

      return {
        status: "ready",
        media,
        previewUrl: URL.createObjectURL(blob),
        message: null,
      };
    }

    resolve(projectId).then(
      (result) => {
        if (cancelled) {
          // Nothing will render this URL; release it immediately.
          if (result.previewUrl) {
            URL.revokeObjectURL(result.previewUrl);
          }
          return;
        }

        activeUrl = result.previewUrl;
        setResolution({ key, ...result });
      },
      (cause: unknown) => {
        if (!cancelled) {
          setResolution({
            key,
            status: "error",
            media: null,
            previewUrl: null,
            message: toMediaErrorMessage(cause),
          });
        }
      },
    );

    return () => {
      cancelled = true;
      if (activeUrl) {
        URL.revokeObjectURL(activeUrl);
      }
    };
  }, [projectId, sourceMediaId, key, service, preview]);

  const runAction = useCallback(
    async (
      action: SourceMediaAction,
      operation: () => Promise<void>,
    ): Promise<boolean> => {
      // One media operation at a time; the ref also blocks a double submit
      // inside a single render.
      if (pendingRef.current) {
        return false;
      }

      pendingRef.current = action;
      setPendingAction(action);
      setActionError(null);

      try {
        await operation();
        await onProjectChanged?.();
        return true;
      } catch (cause) {
        setActionError(toMediaErrorMessage(cause));
        // Removal can fail after the project was already detached, so refresh
        // the project either way.
        await onProjectChanged?.();
        return false;
      } finally {
        pendingRef.current = null;
        setPendingAction(null);
      }
    },
    [onProjectChanged],
  );

  const importVideo = useCallback(
    async (file: File) => {
      if (!project) return false;
      return runAction("importing", () =>
        service.importSourceVideo(project.id, file).then(() => undefined),
      );
    },
    [project, runAction, service],
  );

  const replaceVideo = useCallback(
    async (file: File) => {
      if (!project) return false;
      return runAction("replacing", () =>
        service.replaceSourceVideo(project.id, file).then(() => undefined),
      );
    },
    [project, runAction, service],
  );

  const removeVideo = useCallback(async () => {
    if (!project) return false;
    return runAction("removing", () => service.removeSourceVideo(project.id));
  }, [project, runAction, service]);

  const isCurrent = resolution?.key === key;

  return {
    status: isCurrent && resolution ? resolution.status : "loading",
    media: isCurrent && resolution ? resolution.media : null,
    previewUrl: isCurrent && resolution ? resolution.previewUrl : null,
    loadError: isCurrent && resolution ? resolution.message : null,
    actionError,
    pendingAction,
    isBusy: pendingAction !== null,
    importVideo,
    replaceVideo,
    removeVideo,
    clearActionError: () => setActionError(null),
    reload: () => setReloadToken((token) => token + 1),
  };
}
