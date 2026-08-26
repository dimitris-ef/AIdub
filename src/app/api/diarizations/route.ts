import type { NextRequest } from "next/server";

import { diarizationRepository } from "@/data/diarization";
import { errorResponse } from "@/app/api/processing/_shared";

/**
 * Diarization reads for the workspace. Persistence lives behind
 * `DiarizationRepository`, so this route stays the same when the development
 * store becomes a database and when the model moves to an external worker.
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
    // Both ids are part of the lookup: a diarization is only ever served to
    // the project and the exact source media version it belongs to.
    const diarization = await diarizationRepository.getByProjectAndSource(
      projectId,
      mediaId,
    );

    return Response.json({ diarization });
  } catch {
    return errorResponse(
      "INTERNAL_ERROR",
      "The speaker analysis could not be loaded.",
      500,
    );
  }
}
