import type { NextRequest } from "next/server";

import {
  isProcessingJobType,
  jobTypeNeedsSourceMedia,
} from "@/types/processing-job";
import { processingService } from "@/server/processing";
import { ProcessingError } from "@/server/processing/processing-errors";
import {
  MAX_UPLOAD_BYTES,
  errorResponse,
  jobResponse,
  parseJobParameters,
  readRequiredParam,
} from "@/app/api/processing/_shared";

/**
 * Application-level processing jobs. Nothing here is FFmpeg-specific: the
 * frontend asks for a job type and reads back a job model.
 *
 * Node runtime is required — the processing layer spawns child processes and
 * writes to a temporary directory, neither of which exists on Edge.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Creates a job. The multipart `source` part is the **development transport**
 * for browser-held media (Part 3 keeps source video in IndexedDB); production
 * resolves `sourceMediaId` from object storage instead, with no upload here.
 */
export async function POST(request: NextRequest) {
  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "The processing request could not be read.",
      400,
    );
  }

  const projectId = readRequiredParam(form.get("projectId"));
  const sourceMediaId = readRequiredParam(form.get("sourceMediaId"));
  const type = readRequiredParam(form.get("type"));
  const providerId = readRequiredParam(form.get("providerId"));
  const languageHint = readRequiredParam(form.get("language"));
  const source = form.get("source");

  if (!projectId || !sourceMediaId || !type) {
    return errorResponse(
      "INVALID_REQUEST",
      "The processing request was incomplete.",
      400,
    );
  }

  // Only the stages that consume the video carry it. A translation works from
  // the stored dialogue, so it arrives without a `source` part at all.
  const needsMedia = !isProcessingJobType(type) || jobTypeNeedsSourceMedia(type);

  if (needsMedia && (!(source instanceof File) || source.size === 0)) {
    return errorResponse(
      "SOURCE_MEDIA_NOT_FOUND",
      "The source media could not be read for processing.",
      400,
    );
  }

  if (source instanceof File && source.size > MAX_UPLOAD_BYTES) {
    return errorResponse(
      "INVALID_REQUEST",
      "This video is too large for development processing.",
      413,
    );
  }

  const parameters = parseJobParameters(form.get("parameters"));

  try {
    const uploadedSource =
      source instanceof File && source.size > 0
        ? {
            bytes: new Uint8Array(await source.arrayBuffer()),
            filename: source.name,
          }
        : undefined;

    const job = await processingService.createJob({
      projectId,
      sourceMediaId,
      type,
      providerId,
      languageHint,
      parameters,
      uploadedSource,
    });

    // Development execution: run in this process and let the client poll.
    // A queue implementation would enqueue here instead; the response is the
    // same queued job either way.
    void processingService.runJob(job.id, uploadedSource);

    return jobResponse(job, 201);
  } catch (cause) {
    if (cause instanceof ProcessingError) {
      return errorResponse(cause.code, cause.message, 400);
    }

    return errorResponse(
      "INTERNAL_ERROR",
      "The processing job could not be created.",
      500,
    );
  }
}

/** Job history for a project, optionally narrowed to one source media. */
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  const mediaId = request.nextUrl.searchParams.get("mediaId") ?? undefined;

  if (!projectId) {
    return errorResponse("INVALID_REQUEST", "A project is required.", 400);
  }

  const jobs = await processingService.listJobs(projectId, mediaId);

  return Response.json({ jobs });
}

/**
 * Cancels active jobs and drops generated artifacts for a project, or for one
 * source media within it. Used when source media is removed or a project is
 * deleted.
 */
export async function DELETE(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  const mediaId = request.nextUrl.searchParams.get("mediaId") ?? undefined;

  if (!projectId) {
    return errorResponse("INVALID_REQUEST", "A project is required.", 400);
  }

  const cancelled = await processingService.cancelAndPurge(projectId, mediaId);

  return Response.json({ cancelled });
}
