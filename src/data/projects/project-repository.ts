import type {
  CreateProjectInput,
  Project,
  UpdateProjectInput,
} from "@/types/project";

/**
 * The only contract the UI knows about.
 *
 * Every method is asynchronous even though today's implementation is a
 * synchronous browser store: a future database or HTTP-backed implementation
 * is naturally async, and swapping it in must not change a single component.
 */
export interface ProjectRepository {
  /** Projects sorted by `updatedAt`, most recently updated first. */
  list(): Promise<Project[]>;
  getById(id: string): Promise<Project | null>;
  create(input: CreateProjectInput): Promise<Project>;
  update(id: string, input: UpdateProjectInput): Promise<Project>;
  delete(id: string): Promise<void>;
}

export class ProjectNotFoundError extends Error {
  constructor(readonly projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

export class ProjectStorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProjectStorageError";
  }
}

/** Newest activity first. Centralised so every surface sorts identically. */
export function sortProjectsByRecency(projects: readonly Project[]): Project[] {
  return [...projects].sort((a, b) => {
    const diff = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    return Number.isNaN(diff) ? 0 : diff;
  });
}
