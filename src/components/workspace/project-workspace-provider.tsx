"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { projectRepository, type ProjectRepository } from "@/data/projects";
import type { Project } from "@/types/project";

export interface ProjectWorkspaceValue {
  projectId: string;
  /** null once loading finished and no project with this id exists. */
  project: Project | null;
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

interface Resolution {
  projectId: string;
  project: Project | null;
  error: string | null;
}

const ProjectWorkspaceContext = createContext<ProjectWorkspaceValue | null>(
  null,
);

/**
 * Resolves `[projectId]` once for the whole workspace.
 *
 * Section pages never load the project themselves — they read this context —
 * so a future player, timeline and playback state can share the same single
 * source of project truth at the shared layout level.
 */
export function ProjectWorkspaceProvider({
  projectId,
  children,
  repository = projectRepository,
}: {
  projectId: string;
  children: ReactNode;
  repository?: ProjectRepository;
}) {
  /**
   * Holds the project id the result belongs to, so a result for a previous id
   * is never shown for the current one: while they differ, we are loading.
   */
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    repository.getById(projectId).then(
      (project) => {
        if (!cancelled) {
          setResolution({ projectId, project, error: null });
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setResolution({
            projectId,
            project: null,
            error:
              cause instanceof Error
                ? cause.message
                : "Could not load this project.",
          });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [projectId, repository, reloadToken]);

  const reload = useCallback(async () => {
    setResolution(null);
    setReloadToken((token) => token + 1);
  }, []);

  const isLoading = resolution === null || resolution.projectId !== projectId;

  return (
    <ProjectWorkspaceContext.Provider
      value={{
        projectId,
        project: isLoading ? null : resolution.project,
        isLoading,
        error: isLoading ? null : resolution.error,
        reload,
      }}
    >
      {children}
    </ProjectWorkspaceContext.Provider>
  );
}

export function useProjectWorkspace(): ProjectWorkspaceValue {
  const value = useContext(ProjectWorkspaceContext);

  if (!value) {
    throw new Error(
      "useProjectWorkspace must be used inside a ProjectWorkspaceProvider.",
    );
  }

  return value;
}
