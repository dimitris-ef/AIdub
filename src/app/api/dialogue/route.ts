import type { NextRequest } from "next/server";

import { dialogueService } from "@/server/dialogue/dialogue-service";
import { errorResponse } from "@/app/api/processing/_shared";

/**
 * The unified dialogue for one source.
 *
 * Generation is lazy and happens here rather than in a processing job: merging
 * is deterministic in-memory work, so the first read after both raw inputs
 * exist produces and persists the dialogue, and a later read reuses it until
 * one of its inputs changes.
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
    // Both ids are part of the lookup: a dialogue is only ever served to the
    // project and the exact source media version it belongs to.
    const resolution = await dialogueService.getCurrentDialogue(
      projectId,
      mediaId,
    );

    return Response.json(resolution);
  } catch {
    return errorResponse(
      "INTERNAL_ERROR",
      "The dialogue could not be loaded.",
      500,
    );
  }
}
