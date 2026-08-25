import type { ProjectMedia } from "@/types/media";
import type { ProjectStatus } from "@/types/project";
import { projectRepository, type ProjectRepository } from "@/data/projects";
import {
  MediaStorageError,
  mediaStorage,
  type MediaStorage,
} from "@/data/media";
import { detectContainer } from "@/lib/media/container";
import { validateSourceVideoFile } from "@/lib/media/validate-video";
import {
  VideoMetadataError,
  extractVideoMetadata,
  type ExtractVideoMetadata,
} from "@/lib/media/extract-video-metadata";
import { processingClient } from "@/services/processing/processing-client";

/**
 * Coordinates the source-video lifecycle across the project repository and the
 * media storage layer, so React components never orchestrate several stores by
 * hand and never touch storage directly.
 *
 * Part 3 status semantics (see README):
 *   no source media            → "draft"
 *   source imported/replaced   → "ready"
 *   source removed             → "draft"
 * "processing", "completed" and "error" are reserved for the processing
 * pipeline that later parts introduce.
 */

export const STATUS_WITH_SOURCE_MEDIA: ProjectStatus = "ready";
export const STATUS_WITHOUT_SOURCE_MEDIA: ProjectStatus = "draft";

/** A problem the user can act on; its message is safe to display. */
export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaValidationError";
  }
}

/** The project was detached from its media, but the local copy remains. */
export class MediaCleanupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MediaCleanupError";
  }
}

export interface ProjectMediaService {
  /** Metadata for the project's current source video, if any. */
  getSourceMedia(projectId: string): Promise<ProjectMedia | null>;
  importSourceVideo(projectId: string, file: File): Promise<ProjectMedia>;
  replaceSourceVideo(projectId: string, file: File): Promise<ProjectMedia>;
  removeSourceVideo(projectId: string): Promise<void>;
  /** Bytes for playback; null when the stored copy is gone. */
  getPlayableSource(mediaId: string): Promise<Blob | null>;
  /** Deletes every media record for a project without touching the project. */
  purgeProjectMedia(projectId: string): Promise<void>;
}

/**
 * Lets media changes tell the processing layer to stop work and drop
 * artifacts, without this service knowing anything about jobs or FFmpeg.
 */
export interface ProcessingCleanup {
  purge(projectId: string, sourceMediaId?: string): Promise<void>;
}

export interface ProjectMediaServiceOptions {
  repository?: ProjectRepository;
  storage?: MediaStorage;
  extractMetadata?: ExtractVideoMetadata;
  createId?: () => string;
  now?: () => Date;
  processing?: ProcessingCleanup;
  /** Technical detail sink; user-facing messages never include stack traces. */
  logger?: (message: string, cause: unknown) => void;
}

function defaultCreateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  throw new Error("A secure random id generator is not available.");
}

function defaultLogger(message: string, cause: unknown): void {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[aidub] ${message}`, cause);
  }
}

export function createProjectMediaService({
  repository = projectRepository,
  storage = mediaStorage,
  extractMetadata = extractVideoMetadata,
  createId = defaultCreateId,
  now = () => new Date(),
  processing = processingClient,
  logger = defaultLogger,
}: ProjectMediaServiceOptions = {}): ProjectMediaService {
  /** Best effort: processing cleanup must never block a media operation. */
  async function purgeProcessing(projectId: string, sourceMediaId?: string) {
    try {
      await processing.purge(projectId, sourceMediaId);
    } catch (cause) {
      logger("Could not clean up processing jobs for this media", cause);
    }
  }

  async function requireProject(projectId: string) {
    const project = await repository.getById(projectId);

    if (!project) {
      throw new MediaValidationError("This project no longer exists.");
    }

    return project;
  }

  /** Validates, reads browser metadata and stores the file. Nothing else. */
  async function stageMedia(
    projectId: string,
    file: File,
  ): Promise<ProjectMedia> {
    const validation = validateSourceVideoFile(file);

    if (!validation.ok) {
      throw new MediaValidationError(validation.error);
    }

    // Metadata extraction doubles as a decodability check, and runs before any
    // storage write or project change.
    const metadata = await extractMetadata(file);

    const timestamp = now().toISOString();
    const media: ProjectMedia = {
      id: createId(),
      projectId,
      kind: "video",
      filename: file.name,
      mimeType: file.type ?? "",
      container: detectContainer(file.name, file.type),
      sizeBytes: file.size,
      durationSeconds: metadata.durationSeconds,
      width: metadata.width,
      height: metadata.height,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await storage.save(media, file);

    return media;
  }

  /** Points the project at freshly stored media, cleaning up if that fails. */
  async function associate(projectId: string, media: ProjectMedia) {
    try {
      await repository.update(projectId, {
        sourceMediaId: media.id,
        status: STATUS_WITH_SOURCE_MEDIA,
      });
    } catch (cause) {
      // Never leave an orphaned blob behind a failed association.
      try {
        await storage.delete(media.id);
      } catch (cleanupCause) {
        logger("Could not remove media after a failed import", cleanupCause);
      }
      throw cause;
    }
  }

  return {
    async getSourceMedia(projectId) {
      const project = await requireProject(projectId);

      if (!project.sourceMediaId) {
        return null;
      }

      const media = await storage.getMetadata(project.sourceMediaId);

      // Guard against ever showing another project's media.
      if (!media || media.projectId !== projectId) {
        return null;
      }

      return media;
    },

    async importSourceVideo(projectId, file) {
      await requireProject(projectId);

      const media = await stageMedia(projectId, file);
      await associate(projectId, media);

      return media;
    },

    async replaceSourceVideo(projectId, file) {
      const project = await requireProject(projectId);
      const previousMediaId = project.sourceMediaId;

      // The previous source stays untouched until the new one is stored and
      // associated, so a failed replacement leaves the project usable.
      const media = await stageMedia(projectId, file);
      await associate(projectId, media);

      if (previousMediaId && previousMediaId !== media.id) {
        try {
          await storage.delete(previousMediaId);
        } catch (cause) {
          logger("Could not remove the replaced source video", cause);
        }

        // Jobs stay in history against the media they processed; their
        // generated artifacts go, and anything still running is stopped.
        await purgeProcessing(projectId, previousMediaId);
      }

      return media;
    },

    async removeSourceVideo(projectId) {
      const project = await requireProject(projectId);
      const mediaId = project.sourceMediaId;

      // Detach first: the project is then consistent even if the local copy
      // cannot be deleted.
      await repository.update(projectId, {
        sourceMediaId: null,
        status: STATUS_WITHOUT_SOURCE_MEDIA,
      });

      if (!mediaId) {
        return;
      }

      // Stop any processing that is still running against this media.
      await purgeProcessing(projectId, mediaId);

      try {
        await storage.delete(mediaId);
      } catch (cause) {
        logger("Could not delete stored media after removal", cause);
        throw new MediaCleanupError(
          "The video was removed from the project, but its locally stored copy could not be deleted.",
          { cause },
        );
      }
    },

    async getPlayableSource(mediaId) {
      return storage.getBlob(mediaId);
    },

    async purgeProjectMedia(projectId) {
      await storage.deleteByProject(projectId);
    },
  };
}

export const projectMediaService: ProjectMediaService =
  createProjectMediaService();

const GENERIC_MEDIA_ERROR =
  "Something went wrong while handling this video. Please try again.";

/**
 * Maps an error to a message that is safe to show. Raw exceptions and stack
 * traces never reach the UI.
 */
export function toMediaErrorMessage(error: unknown): string {
  if (
    error instanceof MediaValidationError ||
    error instanceof VideoMetadataError ||
    error instanceof MediaStorageError ||
    error instanceof MediaCleanupError
  ) {
    return error.message;
  }

  return GENERIC_MEDIA_ERROR;
}
