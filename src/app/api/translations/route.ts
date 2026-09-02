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

/**
 * Rewrites one line's translated text.
 *
 * Applied server-side against the stored record — the same shape as Part 8's
 * dialogue edits — so validation, the duration recomputation and the revision
 * check live in one place, and a browser can never write a document it derived
 * from a stale copy.
 *
 * Only `translatedText` is editable here. The original line belongs to the
 * dialogue and is corrected in the Transcript workspace; Translate never keeps
 * a second copy of it.
 */
export async function PATCH(request: NextRequest) {
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "The edit could not be read.", 400);
  }

  const record = (typeof body === "object" && body !== null ? body : {}) as {
    segmentId?: unknown;
    translatedText?: unknown;
    expectedRevision?: unknown;
  };

  if (
    typeof record.segmentId !== "string" ||
    record.segmentId.trim().length === 0 ||
    typeof record.translatedText !== "string"
  ) {
    return errorResponse("INVALID_REQUEST", "That edit is not supported.", 400);
  }

  try {
    const outcome = await translationService.editSegmentText(
      projectId,
      mediaId,
      { sourceLanguage, targetLanguage },
      record.segmentId,
      record.translatedText,
      Number.isInteger(record.expectedRevision)
        ? (record.expectedRevision as number)
        : null,
    );

    if (!outcome.ok) {
      return Response.json(
        { error: { code: outcome.code, message: outcome.message } },
        {
          status:
            outcome.code === "TRANSLATION_NOT_FOUND" ||
            outcome.code === "TRANSLATION_SEGMENT_NOT_FOUND"
              ? 404
              : outcome.code === "TRANSLATION_REVISION_CONFLICT"
                ? 409
                : 400,
        },
      );
    }

    return Response.json({ translation: outcome.translation });
  } catch {
    return errorResponse(
      "INTERNAL_ERROR",
      "The change could not be saved.",
      500,
    );
  }
}
