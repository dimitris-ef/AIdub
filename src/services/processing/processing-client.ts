import {
  isProcessingJobStatus,
  isProcessingJobType,
  type ProcessingJob,
  type ProcessingJobType,
} from "@/types/processing-job";

/**
 * The frontend's view of backend processing.
 *
 * Components call these methods; they never call `fetch` for processing, and
 * they never learn how the work is executed. Replacing HTTP polling with a
 * realtime transport, or the development upload with an object-storage
 * reference, is a change inside this module.
 */

export interface CreateProcessingJobRequest {
  projectId: string;
  sourceMediaId: string;
  type: ProcessingJobType;
  /**
   * Development transport: the browser holds the source bytes (Part 3), so it
   * hands them to the backend with the request. Production drops this and lets
   * the backend resolve `sourceMediaId` from object storage.
   */
  source: Blob;
  sourceFilename: string;
  signal?: AbortSignal;
}

export interface ProcessingClient {
  createJob(request: CreateProcessingJobRequest): Promise<ProcessingJob>;
  getJob(
    jobId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<ProcessingJob>;
  cancelJob(jobId: string, projectId: string): Promise<ProcessingJob>;
  listJobs(
    projectId: string,
    sourceMediaId?: string,
    signal?: AbortSignal,
  ): Promise<ProcessingJob[]>;
  /** Cancels active jobs and drops artifacts for a project or one media. */
  purge(projectId: string, sourceMediaId?: string): Promise<void>;
  getCapabilities(signal?: AbortSignal): Promise<{
    ffmpegAvailable: boolean;
    ffprobeAvailable: boolean;
  }>;
  artifactUrl(artifactId: string, projectId: string): string;
}

export class ProcessingRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProcessingRequestError";
  }
}

const GENERIC_ERROR = "The processing service is unavailable.";

/** Validates the shape of a job coming off the wire before it reaches the UI. */
export function parseProcessingJob(value: unknown): ProcessingJob {
  const job = value as Partial<ProcessingJob> | null;

  if (
    !job ||
    typeof job.id !== "string" ||
    typeof job.projectId !== "string" ||
    typeof job.sourceMediaId !== "string" ||
    !isProcessingJobType(job.type) ||
    !isProcessingJobStatus(job.status) ||
    typeof job.progress !== "number" ||
    typeof job.createdAt !== "string" ||
    typeof job.updatedAt !== "string"
  ) {
    throw new ProcessingRequestError(
      "INVALID_RESPONSE",
      "The processing service returned an unexpected response.",
    );
  }

  return {
    ...(job as ProcessingJob),
    indeterminate: Boolean(job.indeterminate),
    startedAt: job.startedAt ?? null,
    completedAt: job.completedAt ?? null,
    error: job.error ?? null,
    result: job.result ?? null,
  };
}

async function readError(response: Response): Promise<never> {
  let code = "REQUEST_FAILED";
  let message = GENERIC_ERROR;

  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };

    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
  } catch {
    // Non-JSON error body: keep the generic message.
  }

  throw new ProcessingRequestError(code, message);
}

export class HttpProcessingClient implements ProcessingClient {
  constructor(private readonly baseUrl = "/api/processing") {}

  async createJob({
    projectId,
    sourceMediaId,
    type,
    source,
    sourceFilename,
    signal,
  }: CreateProcessingJobRequest): Promise<ProcessingJob> {
    const form = new FormData();
    form.set("projectId", projectId);
    form.set("sourceMediaId", sourceMediaId);
    form.set("type", type);
    form.set("source", source, sourceFilename);

    const response = await fetch(`${this.baseUrl}/jobs`, {
      method: "POST",
      body: form,
      signal,
    });

    if (!response.ok) {
      await readError(response);
    }

    const body = (await response.json()) as { job: unknown };

    return parseProcessingJob(body.job);
  }

  async getJob(
    jobId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<ProcessingJob> {
    const response = await fetch(
      `${this.baseUrl}/jobs/${encodeURIComponent(jobId)}?projectId=${encodeURIComponent(projectId)}`,
      { signal, cache: "no-store" },
    );

    if (!response.ok) {
      await readError(response);
    }

    const body = (await response.json()) as { job: unknown };

    return parseProcessingJob(body.job);
  }

  async cancelJob(jobId: string, projectId: string): Promise<ProcessingJob> {
    const response = await fetch(
      `${this.baseUrl}/jobs/${encodeURIComponent(jobId)}/cancel?projectId=${encodeURIComponent(projectId)}`,
      { method: "POST" },
    );

    if (!response.ok) {
      await readError(response);
    }

    const body = (await response.json()) as { job: unknown };

    return parseProcessingJob(body.job);
  }

  async listJobs(
    projectId: string,
    sourceMediaId?: string,
    signal?: AbortSignal,
  ): Promise<ProcessingJob[]> {
    const query = new URLSearchParams({ projectId });

    if (sourceMediaId) {
      query.set("mediaId", sourceMediaId);
    }

    const response = await fetch(`${this.baseUrl}/jobs?${query.toString()}`, {
      signal,
      cache: "no-store",
    });

    if (!response.ok) {
      await readError(response);
    }

    const body = (await response.json()) as { jobs?: unknown };

    return Array.isArray(body.jobs) ? body.jobs.map(parseProcessingJob) : [];
  }

  async purge(projectId: string, sourceMediaId?: string): Promise<void> {
    const query = new URLSearchParams({ projectId });

    if (sourceMediaId) {
      query.set("mediaId", sourceMediaId);
    }

    const response = await fetch(`${this.baseUrl}/jobs?${query.toString()}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      await readError(response);
    }
  }

  async getCapabilities(signal?: AbortSignal) {
    const response = await fetch(`${this.baseUrl}/capabilities`, {
      signal,
      cache: "no-store",
    });

    if (!response.ok) {
      await readError(response);
    }

    const body = (await response.json()) as {
      capabilities?: { ffmpegAvailable?: boolean; ffprobeAvailable?: boolean };
    };

    return {
      ffmpegAvailable: Boolean(body.capabilities?.ffmpegAvailable),
      ffprobeAvailable: Boolean(body.capabilities?.ffprobeAvailable),
    };
  }

  artifactUrl(artifactId: string, projectId: string): string {
    return `${this.baseUrl}/artifacts/${encodeURIComponent(artifactId)}?projectId=${encodeURIComponent(projectId)}`;
  }
}

export const processingClient: ProcessingClient = new HttpProcessingClient();
