import type { NextRequest } from "next/server";

import { isLanguageCode } from "@/lib/languages";
import { ttsGenerationService } from "@/server/processing";
import { errorResponse } from "@/app/api/processing/_shared";

/**
 * The generated speech for one source and target language.
 *
 * Read-only. Speech is *produced* by a `generate_speech` processing job — the
 * same job architecture every other backend stage uses — because synthesis
 * costs provider credits and takes long enough to need progress, cancellation
 * and a retry story. This endpoint only reads what that job persisted, plus the
 * staleness the server worked out.
 *
 * Staleness is resolved here rather than in the browser: whether a line's audio
 * still matches its text, speaker, voice and settings is one question with one
 * correct answer, and a page that got it wrong would confidently play the wrong
 * words.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  const mediaId = request.nextUrl.searchParams.get("mediaId");
  const targetLanguage = request.nextUrl.searchParams.get("targetLanguage");

  if (!projectId || !mediaId) {
    return errorResponse(
      "INVALID_REQUEST",
      "A project and source media are required.",
      400,
    );
  }

  if (!isLanguageCode(targetLanguage)) {
    return errorResponse(
      "INVALID_REQUEST",
      "A target language is required.",
      400,
    );
  }

  try {
    // Every id is part of the lookup: generated speech is only ever served to
    // the project, source media and language it belongs to.
    return Response.json(
      await ttsGenerationService.resolveCurrent(
        projectId,
        mediaId,
        targetLanguage,
      ),
    );
  } catch {
    return errorResponse(
      "INTERNAL_ERROR",
      "The generated speech could not be loaded.",
      500,
    );
  }
}
