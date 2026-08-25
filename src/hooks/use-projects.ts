"use client";

import { useCallback, useEffect, useState } from "react";

import { projectRepository } from "@/data/projects";
import type { ProjectRepository } from "@/data/projects";
import {
  deleteProjectWithMedia,
  type DeleteProjectResult,
} from "@/services/projects/delete-project";
import type {
  CreateProjectInput,
  Project,
  UpdateProjectInput,
} from "@/types/project";

interface ProjectsSnapshot {
  projects: Project[];
  error: string | null;
}

export interface UseProjectsResult {
  projects: Project[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<Project>;
  updateProject: (id: string, input: UpdateProjectInput) => Promise<Project>;
  deleteProject: (id: string) => Promise<DeleteProjectResult>;
}

export interface UseProjectsOptions {
  repository?: ProjectRepository;
  /** Deletion is coordinated so a project's stored media is cleaned up too. */
  deleteProject?: (id: string) => Promise<DeleteProjectResult>;
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Dashboard data access. Everything goes through the injected repository, so
 * the dashboard has no idea where projects are stored.
 */
export function useProjects({
  repository = projectRepository,
  deleteProject: deleteProjectFn = (id) => deleteProjectWithMedia(id),
}: UseProjectsOptions = {}): UseProjectsResult {
  // `null` until the first load resolves, which is what drives the loading UI.
  const [snapshot, setSnapshot] = useState<ProjectsSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    repository.list().then(
      (projects) => {
        if (!cancelled) {
          setSnapshot({ projects, error: null });
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setSnapshot({
            projects: [],
            error: toMessage(cause, "Could not load your projects."),
          });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [repository]);

  const refresh = useCallback(async () => {
    try {
      setSnapshot({ projects: await repository.list(), error: null });
    } catch (cause) {
      setSnapshot({
        projects: [],
        error: toMessage(cause, "Could not load your projects."),
      });
    }
  }, [repository]);

  const createProject = useCallback(
    async (input: CreateProjectInput) => {
      const project = await repository.create(input);
      await refresh();
      return project;
    },
    [repository, refresh],
  );

  const updateProject = useCallback(
    async (id: string, input: UpdateProjectInput) => {
      const project = await repository.update(id, input);
      await refresh();
      return project;
    },
    [repository, refresh],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      const result = await deleteProjectFn(id);
      await refresh();
      return result;
    },
    [deleteProjectFn, refresh],
  );

  return {
    projects: snapshot?.projects ?? [],
    isLoading: snapshot === null,
    error: snapshot?.error ?? null,
    reload: refresh,
    createProject,
    updateProject,
    deleteProject,
  };
}
