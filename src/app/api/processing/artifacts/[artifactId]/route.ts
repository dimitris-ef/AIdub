import type { NextRequest } from "next/server";

import { processingService } from "@/server/processing";
import { errorResponse } from "@/app/api/processing/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Downloads a generated artifact. Artifacts are scoped to their project, and
 * the response never exposes a backend filesystem path.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  const { artifactId } = await params;
  const projectId = request.nextUrl.searchParams.get("projectId");

  if (!projectId) {
    return errorResponse("INVALID_REQUEST", "A project is required.", 400);
  }

  const found = await processingService.getArtifact(artifactId, projectId);

  if (!found) {
    return errorResponse(
      "ARTIFACT_STORAGE_ERROR",
      "This generated file is no longer available.",
      404,
    );
  }

  return new Response(new Uint8Array(found.bytes), {
    headers: {
      "Content-Type": found.artifact.mimeType,
      "Content-Length": String(found.bytes.byteLength),
      "Content-Disposition": `attachment; filename="${found.artifact.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
