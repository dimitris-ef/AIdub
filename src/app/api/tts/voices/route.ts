import type { NextRequest } from "next/server";

import { isLanguageCode } from "@/lib/languages";
import { ttsGenerationService } from "@/server/processing";
import { errorResponse } from "@/app/api/processing/_shared";

/**
 * The voices this server can speak a language with.
 *
 * Read-only, and deliberately thin: a voice catalog is whatever the configured
 * provider publishes, so the browser never learns which provider is in use
 * beyond its id, and never sees an endpoint, a model path or a credential.
 *
 * `available: false` with an empty list is a real answer, not an error — it is
 * how the workspace tells someone the provider is not set up on this server
 * rather than that they have no voices to choose from.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const targetLanguage = request.nextUrl.searchParams.get("targetLanguage");
  const providerId = request.nextUrl.searchParams.get("providerId");

  if (!isLanguageCode(targetLanguage)) {
    return errorResponse(
      "INVALID_REQUEST",
      "A target language is required.",
      400,
    );
  }

  try {
    return Response.json(
      await ttsGenerationService.listVoices(targetLanguage, providerId),
    );
  } catch {
    return errorResponse(
      "TTS_PROVIDER_UNAVAILABLE",
      "The available voices could not be loaded.",
      503,
    );
  }
}
