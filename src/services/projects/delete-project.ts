import { projectRepository, type ProjectRepository } from "@/data/projects";
import {
  projectMediaService,
  type ProjectMediaService,
} from "@/services/media/project-media-service";

/**
 * Deleting a project also disposes of the development media it owns, so no
 * orphaned blobs are left in browser storage. Project cards and dialogs call
 * this coordinator instead of touching media storage themselves.
 */

export interface DeleteProjectResult {
  /** True when the project was deleted but its media could not be cleaned up. */
  mediaCleanupFailed: boolean;
}

export interface DeleteProjectOptions {
  repository?: ProjectRepository;
  media?: ProjectMediaService;
  logger?: (message: string, cause: unknown) => void;
}

function defaultLogger(message: string, cause: unknown): void {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[aidub] ${message}`, cause);
  }
}

export async function deleteProjectWithMedia(
  projectId: string,
  {
    repository = projectRepository,
    media = projectMediaService,
    logger = defaultLogger,
  }: DeleteProjectOptions = {},
): Promise<DeleteProjectResult> {
  let mediaCleanupFailed = false;

  // Media first: a failure here is reported, but must not block the deletion
  // the user asked for.
  try {
    await media.purgeProjectMedia(projectId);
  } catch (cause) {
    mediaCleanupFailed = true;
    logger("Could not purge media while deleting a project", cause);
  }

  await repository.delete(projectId);

  return { mediaCleanupFailed };
}
