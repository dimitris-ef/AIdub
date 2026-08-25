import {
  INITIAL_PROJECT_STATUS,
  type CreateProjectInput,
  type Project,
  type UpdateProjectInput,
} from "@/types/project";
import { isProjectStatus } from "@/lib/project-status";
import { parseTimestamp } from "@/lib/dates";
import {
  validateLanguageSelection,
  validateProjectName,
} from "@/lib/project-input";
import {
  ProjectNotFoundError,
  ProjectStorageError,
  ProjectValidationError,
  sortProjectsByRecency,
  type ProjectRepository,
} from "@/data/projects/project-repository";

/**
 * Versioned key: a future schema change ships under `aidub.projects.v2` and can
 * migrate or ignore this one instead of colliding with it.
 */
export const PROJECTS_STORAGE_KEY = "aidub.projects.v1";

/** The slice of the Web Storage API this repository needs. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalProjectRepositoryOptions {
  storage?: KeyValueStorage | (() => KeyValueStorage);
  /** Injectable for tests. */
  now?: () => Date;
  /** Injectable for tests. */
  createId?: () => string;
}

function browserStorage(): KeyValueStorage {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new ProjectStorageError(
      "Project storage is only available in the browser.",
    );
  }

  return window.localStorage;
}

function defaultCreateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  throw new ProjectStorageError(
    "A secure random id generator is not available in this environment.",
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && parseTimestamp(value) !== null;
}

/**
 * Defensive parse of one stored record. Development data can be stale or
 * hand-edited, so anything structurally broken is dropped rather than trusted.
 * A record whose status is not recognised keeps its other data and falls back
 * to the initial status instead of being discarded.
 */
export function parseStoredProject(value: unknown): Project | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    !isNonEmptyString(record.id) ||
    !isNonEmptyString(record.name) ||
    !isIsoTimestamp(record.createdAt) ||
    !isIsoTimestamp(record.updatedAt) ||
    !isNonEmptyString(record.sourceLanguage) ||
    !isNonEmptyString(record.targetLanguage)
  ) {
    return null;
  }

  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sourceLanguage: record.sourceLanguage,
    targetLanguage: record.targetLanguage,
    status: isProjectStatus(record.status)
      ? record.status
      : INITIAL_PROJECT_STATUS,
  };
}

/**
 * Temporary, browser-local project persistence for Part 2.
 *
 * It owns ids, timestamps, the initial status, serialization and validation.
 * Nothing outside this file touches `localStorage`; replacing it with a
 * database-backed `ProjectRepository` requires no UI changes.
 */
export class LocalProjectRepository implements ProjectRepository {
  private readonly resolveStorage: () => KeyValueStorage;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(options: LocalProjectRepositoryOptions = {}) {
    const { storage, now = () => new Date(), createId = defaultCreateId } =
      options;

    this.resolveStorage =
      typeof storage === "function"
        ? storage
        : storage
          ? () => storage
          : browserStorage;
    this.now = now;
    this.createId = createId;
  }

  async list(): Promise<Project[]> {
    return sortProjectsByRecency(this.read());
  }

  async getById(id: string): Promise<Project | null> {
    return this.read().find((project) => project.id === id) ?? null;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const name = this.requireValidName(input.name);
    this.requireValidLanguages(input.sourceLanguage, input.targetLanguage);

    const timestamp = this.now().toISOString();
    const project: Project = {
      id: this.createId(),
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      status: INITIAL_PROJECT_STATUS,
    };

    this.write([...this.read(), project]);

    return project;
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const projects = this.read();
    const index = projects.findIndex((project) => project.id === id);

    if (index === -1) {
      throw new ProjectNotFoundError(id);
    }

    const current = projects[index];
    const name =
      input.name === undefined ? current.name : this.requireValidName(input.name);
    const sourceLanguage = input.sourceLanguage ?? current.sourceLanguage;
    const targetLanguage = input.targetLanguage ?? current.targetLanguage;

    if (
      input.sourceLanguage !== undefined ||
      input.targetLanguage !== undefined
    ) {
      this.requireValidLanguages(sourceLanguage, targetLanguage);
    }

    if (input.status !== undefined && !isProjectStatus(input.status)) {
      throw new ProjectValidationError("Unknown project status.");
    }

    const updated: Project = {
      ...current,
      name,
      sourceLanguage,
      targetLanguage,
      status: input.status ?? current.status,
      updatedAt: this.now().toISOString(),
    };

    const next = [...projects];
    next[index] = updated;
    this.write(next);

    return updated;
  }

  async delete(id: string): Promise<void> {
    const projects = this.read();
    const next = projects.filter((project) => project.id !== id);

    if (next.length === projects.length) {
      throw new ProjectNotFoundError(id);
    }

    this.write(next);
  }

  private requireValidName(rawName: string): string {
    const result = validateProjectName(rawName ?? "");

    if (!result.ok) {
      throw new ProjectValidationError(result.error);
    }

    return result.value;
  }

  private requireValidLanguages(
    sourceLanguage: string,
    targetLanguage: string,
  ): void {
    const result = validateLanguageSelection(sourceLanguage, targetLanguage);

    if (!result.ok) {
      throw new ProjectValidationError(result.error);
    }
  }

  private read(): Project[] {
    const raw = this.readRaw();

    if (raw === null) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Unreadable development data must never break the app.
      return [];
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(parseStoredProject)
      .filter((project): project is Project => project !== null);
  }

  private readRaw(): string | null {
    try {
      return this.resolveStorage().getItem(PROJECTS_STORAGE_KEY);
    } catch (cause) {
      if (cause instanceof ProjectStorageError) {
        throw cause;
      }
      throw new ProjectStorageError("Could not read stored projects.", {
        cause,
      });
    }
  }

  private write(projects: readonly Project[]): void {
    try {
      this.resolveStorage().setItem(
        PROJECTS_STORAGE_KEY,
        JSON.stringify(projects),
      );
    } catch (cause) {
      if (cause instanceof ProjectStorageError) {
        throw cause;
      }
      throw new ProjectStorageError("Could not save projects.", { cause });
    }
  }
}
