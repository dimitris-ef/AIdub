import { processingService } from "@/server/processing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reports whether the processing backend can run media work at all, so the UI
 * can explain an unavailable environment instead of failing job by job.
 */
export async function GET() {
  const capabilities = await processingService.getCapabilities();

  return Response.json({
    capabilities: {
      ffmpegAvailable: capabilities.ffmpegAvailable,
      ffprobeAvailable: capabilities.ffprobeAvailable,
    },
  });
}
