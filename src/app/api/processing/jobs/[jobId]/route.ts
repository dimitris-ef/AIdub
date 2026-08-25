import type { NextRequest } from "next/server";

import { processingService } from "@/server/processing";
import { errorResponse, jobResponse } from "@/app/api/processing/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reads one job. The project is part of the lookup, so a job is only ever
 * visible to the project that owns it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const projectId = request.nextUrl.searchParams.get("projectId");

  if (!projectId) {
    return errorResponse("INVALID_REQUEST", "A project is required.", 400);
  }

  const job = await processingService.getJob(jobId, projectId);

  if (!job) {
    return errorResponse("INVALID_REQUEST", "This job was not found.", 404);
  }

  return jobResponse(job);
}
