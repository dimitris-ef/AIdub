import "server-only";

import type { ProcessingErrorCode, ProcessingJob } from "@/types/processing-job";

// Re-exported so route handlers keep one import for request helpers; the
// parsing itself is a pure library function, and therefore directly testable.
export { parseJobParameters } from "@/lib/processing/job-parameters";

/**
 * Shared helpers for the processing API. The `_shared` folder name keeps this
 * out of the route table.
 */

/**
 * Development upload ceiling for the browser→backend source transport.
 *
 * This is a development limit, not a product decision: production resolves
 * source media from object storage instead of routing bytes through the web
 * app, and platform request limits (Vercel functions cap request bodies at a
 * few MB) are exactly why that transport is temporary.
 */
export const MAX_UPLOAD_BYTES = Number(
  process.env.PROCESSING_MAX_UPLOAD_BYTES ?? 512 * 1024 * 1024,
);

export function readRequiredParam(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function jobResponse(job: ProcessingJob, status = 200) {
  return Response.json({ job }, { status });
}

export function errorResponse(
  code: ProcessingErrorCode,
  message: string,
  status: number,
) {
  return Response.json({ error: { code, message } }, { status });
}
