import type { NextRequest } from "next/server";

import { transcriptRepository } from "@/data/transcripts";
import { errorResponse } from "@/app/api/processing/_shared";

/**
 * Transcript reads for the workspace. Persistence lives behind
 * `TranscriptRepository`, so this route stays the same when the development
 * store becomes a database.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  const mediaId = request.nextUrl.searchParams.get("mediaId");

  if (!projectId || !mediaId) {
    return errorResponse(
      "INVALID_REQUEST",
      "A project and source media are required.",
      400,
    );
  }

  try {
    // Both ids are part of the lookup: a transcript is only ever served to the
    // project and the exact source media version it belongs to.
    const transcript = await transcriptRepository.getByProject(
      projectId,
      mediaId,
    );

    return Response.json({ transcript });
  } catch {
    return errorResponse(
      "INTERNAL_ERROR",
      "The transcript could not be loaded.",
      500,
    );
  }
}
