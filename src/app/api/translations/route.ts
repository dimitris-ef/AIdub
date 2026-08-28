import type { NextRequest } from "next/server";

import { isLanguageCode } from "@/lib/languages";
import { translationService } from "@/server/translation/translation-service";
import { errorResponse } from "@/app/api/processing/_shared";

/**
 * The stored translation for one source, dialogue revision and language pair.
 *
 * Read-only. Translations are *produced* by a `translate` processing job — the
 * same job architecture every other backend stage uses — because translation
 * costs provider credits and takes long enough to need progress, cancellation
 * and a retry story. This endpoint only reads what that job persisted.
 *
 * The language pair is an explicit query parameter rather than something the
 * server infers: it is part of a translation's identity, and the project record
 * lives in browser storage in development.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  const mediaId = request.nextUrl.searchParams.get("mediaId");
  const sourceLanguage = request.nextUrl.searchParams.get("sourceLanguage");
  const targetLanguage = request.nextUrl.searchParams.get("targetLanguage");

  if (!projectId || !mediaId) {
    return errorResponse(
      "INVALID_REQUEST",
      "A project and source media are required.",
      400,
    );
  }

  if (!isLanguageCode(sourceLanguage) || !isLanguageCode(targetLanguage)) {
    return errorResponse(
      "INVALID_REQUEST",
      "A source and target language are required.",
      400,
    );
  }

  try {
    // Every id is part of the lookup: a translation is only ever served to the
    // project, source media, dialogue revision and language pair it belongs to.
    const resolution = await translationService.resolveCurrent(
      projectId,
      mediaId,
      { sourceLanguage, targetLanguage },
    );

    return Response.json(resolution);
  } catch {
    return errorResponse(
      "INTERNAL_ERROR",
      "The translation could not be loaded.",
      500,
    );
  }
}
