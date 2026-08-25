import {
  PROGRESS_COMPLETED,
  PROGRESS_MAX_IN_FLIGHT,
  PROGRESS_QUEUED,
  canTransition,
  isTerminalStatus,
  type ProcessingJob,
  type ProcessingJobError,
  type ProcessingJobResult,
  type ProcessingJobStatus,
  type ProcessingJobType,
} from "@/types/processing-job";

/**
 * Job persistence contract. The frontend never touches it — it talks to the
 * processing API — so replacing the development store with a database or a
 * queue-backed store changes nothing above this layer.
 */

export interface CreateProcessingJobInput {
  projectId: string;
  sourceMediaId: string;
  type: ProcessingJobType;
}

export interface UpdateProcessingJobInput {
  status?: ProcessingJobStatus;
  progress?: number;
  indeterminate?: boolean;
  error?: ProcessingJobError | null;
  result?: ProcessingJobResult;
}

export interface ProcessingJobRepository {
  create(input: CreateProcessingJobInput): Promise<ProcessingJob>;
  getById(id: string): Promise<ProcessingJob | null>;
  listByProject(projectId: string): Promise<ProcessingJob[]>;
  listByMedia(sourceMediaId: string): Promise<ProcessingJob[]>;
  update(
    id: string,
    input: UpdateProcessingJobInput,
  ): Promise<ProcessingJob>;
  /** Used when a project or its source media goes away. */
  deleteByProject(projectId: string): Promise<void>;
}

export class ProcessingJobNotFoundError extends Error {
  constructor(readonly jobId: string) {
    super(`Processing job not found: ${jobId}`);
    this.name = "ProcessingJobNotFoundError";
  }
}

export class InvalidJobTransitionError extends Error {
  constructor(
    readonly from: ProcessingJobStatus,
    readonly to: ProcessingJobStatus,
  ) {
    super(`Invalid processing job transition: ${from} → ${to}`);
    this.name = "InvalidJobTransitionError";
  }
}

/** Newest first. */
export function sortJobsByRecency(
  jobs: readonly ProcessingJob[],
): ProcessingJob[] {
  return [...jobs].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

/** Applies the shared progress policy documented in types/processing-job.ts. */
export function normalizeProgress(
  status: ProcessingJobStatus,
  requested: number | undefined,
  current: number,
): number {
  if (status === "completed") {
    return PROGRESS_COMPLETED;
  }
  if (status === "queued") {
    return PROGRESS_QUEUED;
  }

  if (requested === undefined || !Number.isFinite(requested)) {
    return current;
  }

  if (isTerminalStatus(status)) {
    // failed / cancelled keep the last meaningful value.
    return Math.min(Math.max(Math.round(requested), 0), PROGRESS_COMPLETED);
  }

  // processing never reports 0 or 100 — those mean queued and completed.
  const clamped = Math.min(
    Math.max(Math.round(requested), 1),
    PROGRESS_MAX_IN_FLIGHT,
  );

  // Progress never goes backwards during a run.
  return Math.max(clamped, current);
}

/**
 * Applies an update to a job, enforcing legal transitions and the timestamp
 * rules (`startedAt` on first processing, `completedAt` on any terminal
 * state, `updatedAt` always).
 */
export function applyJobUpdate(
  job: ProcessingJob,
  input: UpdateProcessingJobInput,
  now: Date,
): ProcessingJob {
  const status = input.status ?? job.status;

  if (input.status && !canTransition(job.status, input.status)) {
    throw new InvalidJobTransitionError(job.status, input.status);
  }

  const timestamp = now.toISOString();

  return {
    ...job,
    status,
    progress: normalizeProgress(status, input.progress, job.progress),
    indeterminate: input.indeterminate ?? job.indeterminate,
    error: input.error === undefined ? job.error : input.error,
    result: input.result === undefined ? job.result : input.result,
    startedAt:
      status === "processing" && !job.startedAt ? timestamp : job.startedAt,
    completedAt: isTerminalStatus(status) ? timestamp : job.completedAt,
    updatedAt: timestamp,
  };
}
