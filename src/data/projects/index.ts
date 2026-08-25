import { LocalProjectRepository } from "@/data/projects/local-project-repository";
import type { ProjectRepository } from "@/data/projects/project-repository";

export {
  ProjectNotFoundError,
  ProjectStorageError,
  ProjectValidationError,
  sortProjectsByRecency,
  type ProjectRepository,
} from "@/data/projects/project-repository";
export {
  LocalProjectRepository,
  PROJECTS_STORAGE_KEY,
} from "@/data/projects/local-project-repository";

/**
 * The repository the application uses. Part 2 persists to the browser only;
 * swapping this binding for a database- or API-backed implementation is the
 * intended upgrade path and requires no UI changes.
 */
export const projectRepository: ProjectRepository = new LocalProjectRepository();
