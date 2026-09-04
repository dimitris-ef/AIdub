import type { NextRequest } from "next/server";

import { processingService, ttsGenerationService } from "@/server/processing";
import { errorResponse } from "@/app/api/processing/_shared";

/**
 * Plays one generated line.
 *
 * Served inline rather than as a download: this is audio a person auditions
 * against the original, dozens of times, inside the workspace.
 *
 * Access is checked **twice**, deliberately. The generated record must belong
 * to the project that asked for it, and the artifact must belong to that
 * project too. Either check alone would leave a hole: a guessed record id
 * without the first, a guessed artifact id without the second. Ids here are
 * derived from dialogue segment ids rather than random, so guessability is a
 * real property of the system, not a hypothetical.
 *
 * The response carries no filesystem path — only the bytes and their type.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ generatedId: string }> },
) {
  const { generatedId } = await params;
  const projectId = request.nextUrl.searchParams.get("projectId");

  if (!projectId) {
    return errorResponse("INVALID_REQUEST", "A project is required.", 400);
  }

  const generated = await ttsGenerationService.getGeneratedSegment(
    projectId,
    generatedId,
  );

  if (!generated?.artifactId) {
    return errorResponse(
      "TTS_STORAGE_FAILED",
      "There is no generated audio for this line.",
      404,
    );
  }

  const found = await processingService.getArtifact(
    generated.artifactId,
    projectId,
  );

  if (!found) {
    // Development artifact storage lives in a temp directory the OS may
    // reclaim, so a record outliving its bytes is expected, not exceptional.
    return errorResponse(
      "ARTIFACT_STORAGE_ERROR",
      "This generated audio is no longer available.",
      404,
    );
  }

  return new Response(new Uint8Array(found.bytes), {
    headers: {
      "Content-Type": generated.mimeType ?? found.artifact.mimeType,
      "Content-Length": String(found.bytes.byteLength),
      "Content-Disposition": "inline",
      // Generating a line again reuses this URL, so a cached response would
      // play the take the user just replaced.
      "Cache-Control": "no-store",
    },
  });
}
