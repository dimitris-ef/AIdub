import { randomUUID } from "node:crypto";

import {
  PROGRESS_QUEUED,
  type ProcessingJob,
} from "@/types/processing-job";
import {
  ProcessingJobNotFoundError,
  applyJobUpdate,
  sortJobsByRecency,
  type CreateProcessingJobInput,
  type ProcessingJobRepository,
  type UpdateProcessingJobInput,
} from "@/server/processing/processing-job-repository";

/**
 * Development job store: an in-process map.
 *
 * Limitations, deliberately accepted for Part 4:
 * - job history is lost when the server process restarts;
 * - it is not shared between server instances, so it suits local development
 *   and a single long-lived process, not a serverless deployment.
 *
 * Production replaces this with a database- or queue-backed implementation of
 * `ProcessingJobRepository`; nothing above this layer changes.
 */
export class InMemoryProcessingJobRepository
  implements ProcessingJobRepository
{
  private readonly jobs = new Map<string, ProcessingJob>();

  constructor(
    private readonly options: {
      createId?: () => string;
      now?: () => Date;
    } = {},
  ) {}

  private get createId(): () => string {
    return this.options.createId ?? randomUUID;
  }

  private get now(): () => Date {
    return this.options.now ?? (() => new Date());
  }

  async create(input: CreateProcessingJobInput): Promise<ProcessingJob> {
    const timestamp = this.now().toISOString();
    const job: ProcessingJob = {
      id: this.createId(),
      projectId: input.projectId,
      sourceMediaId: input.sourceMediaId,
      type: input.type,
      status: "queued",
      progress: PROGRESS_QUEUED,
      indeterminate: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
      error: null,
      result: null,
    };

    this.jobs.set(job.id, job);

    return job;
  }

  async getById(id: string): Promise<ProcessingJob | null> {
    return this.jobs.get(id) ?? null;
  }

  async listByProject(projectId: string): Promise<ProcessingJob[]> {
    return sortJobsByRecency(
      [...this.jobs.values()].filter((job) => job.projectId === projectId),
    );
  }

  async listByMedia(sourceMediaId: string): Promise<ProcessingJob[]> {
    return sortJobsByRecency(
      [...this.jobs.values()].filter(
        (job) => job.sourceMediaId === sourceMediaId,
      ),
    );
  }

  async update(
    id: string,
    input: UpdateProcessingJobInput,
  ): Promise<ProcessingJob> {
    const job = this.jobs.get(id);

    if (!job) {
      throw new ProcessingJobNotFoundError(id);
    }

    const updated = applyJobUpdate(job, input, this.now());
    this.jobs.set(id, updated);

    return updated;
  }

  async deleteByProject(projectId: string): Promise<void> {
    for (const [id, job] of this.jobs) {
      if (job.projectId === projectId) {
        this.jobs.delete(id);
      }
    }
  }
}
