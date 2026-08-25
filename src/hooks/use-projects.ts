"use client";

import { useCallback, useEffect, useState } from "react";

import { projectRepository } from "@/data/projects";
import type { ProjectRepository } from "@/data/projects";
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
  deleteProject: (id: string) => Promise<void>;
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Dashboard data access. Everything goes through the injected repository, so
 * the dashboard has no idea where projects are stored.
 */
export function useProjects(
  repository: ProjectRepository = projectRepository,
): UseProjectsResult {
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
      await repository.delete(id);
      await refresh();
    },
    [repository, refresh],
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
