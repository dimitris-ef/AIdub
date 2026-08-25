/**
 * The Aidub project domain model.
 *
 * A project is metadata about one dubbing job. It deliberately holds no media
 * asset data — media, transcripts, voices and renders get their own models in
 * later parts and reference a project by id.
 */

export const PROJECT_STATUSES = [
  "draft",
  "processing",
  "ready",
  "completed",
  "error",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface Project {
  /** Stable, URL-safe, immutable. Never changes, including on rename. */
  id: string;
  name: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp, refreshed by every mutation. */
  updatedAt: string;
  /** Language code from src/lib/languages.ts. */
  sourceLanguage: string;
  /** Language code from src/lib/languages.ts. */
  targetLanguage: string;
  status: ProjectStatus;
  /**
   * Reference to the project's source video (`ProjectMedia.id`), or null when
   * no source media has been imported. The media record and its bytes live in
   * the media layer — never inline in the project.
   */
  sourceMediaId: string | null;
}

export interface CreateProjectInput {
  name: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface UpdateProjectInput {
  name?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  status?: ProjectStatus;
  /** null detaches the source media reference. */
  sourceMediaId?: string | null;
}

/** Every project starts here; status progression is not implemented yet. */
export const INITIAL_PROJECT_STATUS: ProjectStatus = "draft";

export const PROJECT_NAME_MAX_LENGTH = 100;
