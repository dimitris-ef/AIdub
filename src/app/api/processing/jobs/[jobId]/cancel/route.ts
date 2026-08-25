import type { NextRequest } from "next/server";

import { processingService } from "@/server/processing";
import { errorResponse, jobResponse } from "@/app/api/processing/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cancels a queued or running job; terminal jobs are returned unchanged. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const projectId = request.nextUrl.searchParams.get("projectId");

  if (!projectId) {
    return errorResponse("INVALID_REQUEST", "A project is required.", 400);
  }

  const job = await processingService.cancelJob(jobId, projectId);

  if (!job) {
    return errorResponse("INVALID_REQUEST", "This job was not found.", 404);
  }

  return jobResponse(job);
}
