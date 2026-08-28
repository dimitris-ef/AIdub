import type { NextRequest } from "next/server";

import { dialogueService } from "@/server/dialogue/dialogue-service";
import {
  dialogueEditorService,
  parseEditOperation,
} from "@/server/dialogue/dialogue-editor-service";
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

/**
 * Applies one human correction to the stored dialogue.
 *
 * Corrections are applied server-side against the current document rather than
 * having the browser send back a whole dialogue: that keeps validation and
 * atomicity in one place, and means a client can never write a document it
 * derived from a stale copy.
 */
export async function PATCH(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  const mediaId = request.nextUrl.searchParams.get("mediaId");

  if (!projectId || !mediaId) {
    return errorResponse(
      "INVALID_REQUEST",
      "A project and source media are required.",
      400,
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "The edit could not be read.", 400);
  }

  const operation = parseEditOperation(body);

  if (!operation) {
    return errorResponse(
      "INVALID_REQUEST",
      "That edit is not supported.",
      400,
    );
  }

  try {
    const outcome = await dialogueEditorService.applyEdit(
      projectId,
      mediaId,
      operation,
    );

    if (!outcome.ok) {
      return Response.json(
        { error: { code: outcome.code, message: outcome.message } },
        { status: outcome.code === "DIALOGUE_NOT_FOUND" ? 404 : 400 },
      );
    }

    return Response.json({
      state: "ready",
      dialogue: outcome.dialogue,
      regenerated: false,
      newOverlaps: outcome.newOverlaps,
    });
  } catch {
    return errorResponse(
      "INTERNAL_ERROR",
      "The change could not be saved.",
      500,
    );
  }
}
