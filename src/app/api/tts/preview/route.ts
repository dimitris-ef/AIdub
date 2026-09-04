import type { NextRequest } from "next/server";

import { isLanguageCode } from "@/lib/languages";
import { TtsError } from "@/server/tts/tts-errors";
import { ttsGenerationService } from "@/server/processing";
import { errorResponse } from "@/app/api/processing/_shared";

/**
 * Auditions a voice.
 *
 * A preview is not a job: it is one short line, it is not stored, and nobody
 * needs progress or a retry story for it. It also never touches project
 * content — the text is fixed and neutral, so an audition cannot be mistaken
 * for a generated take, and previewing costs nothing in dialogue.
 *
 * The audio is returned directly rather than saved as an artifact, precisely
 * because it is not part of the project.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "The preview request could not be read.",
      400,
    );
  }

  const record = (typeof body === "object" && body !== null ? body : {}) as {
    providerId?: unknown;
    voiceId?: unknown;
    targetLanguage?: unknown;
  };

  if (
    typeof record.providerId !== "string" ||
    record.providerId.trim().length === 0 ||
    typeof record.voiceId !== "string" ||
    record.voiceId.trim().length === 0 ||
    !isLanguageCode(record.targetLanguage)
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "A voice and a target language are required.",
      400,
    );
  }

  try {
    const preview = await ttsGenerationService.previewVoice(
      { type: "standard", providerId: record.providerId, voiceId: record.voiceId },
      record.targetLanguage,
      undefined,
      request.signal,
    );

    return new Response(new Uint8Array(preview.data), {
      headers: {
        "Content-Type": preview.mimeType,
        "Content-Length": String(preview.data.byteLength),
        "Content-Disposition": "inline",
        "Cache-Control": "no-store",
      },
    });
  } catch (cause) {
    if (cause instanceof TtsError) {
      return errorResponse(
        cause.code,
        cause.message,
        cause.code === "TTS_PROVIDER_UNAVAILABLE"
          ? 503
          : cause.code === "TTS_VOICE_NOT_FOUND"
            ? 404
            : 400,
      );
    }

    return errorResponse(
      "TTS_GENERATION_FAILED",
      "The voice could not be previewed.",
      500,
    );
  }
}
