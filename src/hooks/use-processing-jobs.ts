"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProjectMedia } from "@/types/media";
import type { Project } from "@/types/project";
import {
  isTerminalStatus,
  type ProcessingJob,
  type ProcessingJobType,
} from "@/types/processing-job";
import {
  ProcessingRequestError,
  processingClient,
  type ProcessingClient,
} from "@/services/processing/processing-client";
import {
  projectMediaService,
  type ProjectMediaService,
} from "@/services/media/project-media-service";

/** Poll cadence while a job is queued or running. */
export const JOB_POLL_INTERVAL_MS = 1_500;

export interface ProcessingCapabilitiesState {
  ffmpegAvailable: boolean;
  ffprobeAvailable: boolean;
}

export interface UseProcessingJobsResult {
  jobs: ProcessingJob[];
  isLoading: boolean;
  error: string | null;
  capabilities: ProcessingCapabilitiesState | null;
  pendingType: ProcessingJobType | null;
  startJob: (type: ProcessingJobType) => Promise<boolean>;
  cancelJob: (jobId: string) => Promise<void>;
  clearError: () => void;
  artifactUrl: (artifactId: string) => string;
}

function toMessage(cause: unknown): string {
  return cause instanceof ProcessingRequestError
    ? cause.message
    : "The processing service could not be reached.";
}

function mergeJobs(
  previous: ProcessingJob[],
  updates: readonly ProcessingJob[],
): ProcessingJob[] {
  const byId = new Map(updates.map((job) => [job.id, job]));

  return previous.map((job) => byId.get(job.id) ?? job);
}

/**
 * Processing state for the Media workspace.
 *
 * Everything backend-facing goes through `ProcessingClient`; the hook owns
 * only UI concerns — history, polling of active jobs, and preventing a second
 * job from being launched by a double click. Polling stops on terminal states
 * and on unmount.
 */
export function useProcessingJobs(
  project: Project | null,
  media: ProjectMedia | null,
  {
    client = processingClient,
    mediaService = projectMediaService,
  }: {
    client?: ProcessingClient;
    mediaService?: ProjectMediaService;
  } = {},
): UseProcessingJobsResult {
  const projectId = project?.id ?? null;
  const mediaId = media?.id ?? null;

  const [loadedJobs, setLoadedJobs] = useState<ProcessingJob[] | null>(null);
  const [capabilities, setCapabilities] =
    useState<ProcessingCapabilitiesState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingType, setPendingType] = useState<ProcessingJobType | null>(
    null,
  );
  const pendingRef = useRef<ProcessingJobType | null>(null);

  const hasTarget = Boolean(projectId && mediaId);

  // Job history and backend capability, loaded once per source media.
  useEffect(() => {
    if (!projectId || !mediaId) {
      return;
    }

    let cancelled = false;

    Promise.all([
      client.listJobs(projectId, mediaId),
      client.getCapabilities().catch(() => null),
    ]).then(
      ([jobs, backendCapabilities]) => {
        if (!cancelled) {
          setLoadedJobs(jobs);
          setCapabilities(backendCapabilities);
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setLoadedJobs([]);
          setError(toMessage(cause));
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [projectId, mediaId, client]);

  const jobs = useMemo(
    () => (hasTarget ? (loadedJobs ?? []) : []),
    [hasTarget, loadedJobs],
  );

  // Poll only the jobs that can still change; the key stops the effect once
  // every job reaches a terminal state.
  const activeJobKey = jobs
    .filter((job) => !isTerminalStatus(job.status))
    .map((job) => job.id)
    .join(",");

  useEffect(() => {
    if (!projectId || !activeJobKey) {
      return;
    }

    const ids = activeJobKey.split(",");
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    // A chained timeout (not an interval) means requests never overlap.
    const tick = async () => {
      try {
        const updates = await Promise.all(
          ids.map((id) => client.getJob(id, projectId)),
        );

        if (!cancelled) {
          setLoadedJobs((previous) =>
            previous ? mergeJobs(previous, updates) : previous,
          );
        }
      } catch {
        // A transient network failure should not stop polling or surface as
        // a job error; the next tick retries.
      }

      if (!cancelled) {
        timer = setTimeout(() => void tick(), JOB_POLL_INTERVAL_MS);
      }
    };

    timer = setTimeout(() => void tick(), JOB_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, activeJobKey, client]);

  const startJob = useCallback(
    async (type: ProcessingJobType) => {
      if (!project || !media || pendingRef.current) {
        return false;
      }

      pendingRef.current = type;
      setPendingType(type);
      setError(null);

      try {
        // Development transport: hand the browser-held source to the backend.
        const source = await mediaService.getPlayableSource(media.id);

        if (!source) {
          setError(
            "The stored source video is unavailable, so it cannot be processed.",
          );
          return false;
        }

        const job = await client.createJob({
          projectId: project.id,
          sourceMediaId: media.id,
          type,
          source,
          sourceFilename: media.filename,
        });

        setLoadedJobs((previous) => [job, ...(previous ?? [])]);
        return true;
      } catch (cause) {
        setError(toMessage(cause));
        return false;
      } finally {
        pendingRef.current = null;
        setPendingType(null);
      }
    },
    [client, media, mediaService, project],
  );

  const cancelJob = useCallback(
    async (jobId: string) => {
      if (!projectId) {
        return;
      }

      try {
        const job = await client.cancelJob(jobId, projectId);
        setLoadedJobs((previous) =>
          previous ? mergeJobs(previous, [job]) : previous,
        );
      } catch (cause) {
        setError(toMessage(cause));
      }
    },
    [client, projectId],
  );

  const artifactUrl = useCallback(
    (artifactId: string) =>
      projectId ? client.artifactUrl(artifactId, projectId) : "",
    [client, projectId],
  );

  return {
    jobs,
    isLoading: hasTarget && loadedJobs === null,
    error,
    capabilities,
    pendingType,
    startJob,
    cancelJob,
    clearError: () => setError(null),
    artifactUrl,
  };
}
