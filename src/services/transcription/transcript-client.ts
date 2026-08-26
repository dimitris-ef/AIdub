import {
  isTranscriptSegmentStatus,
  isTranscriptStatus,
  type Transcript,
  type TranscriptSegment,
} from "@/types/transcript";

/**
 * The frontend's view of transcripts.
 *
 * The workspace never fetches transcripts itself and never learns where they
 * are stored; swapping the development store for a database changes nothing
 * above this module.
 */

export class TranscriptRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TranscriptRequestError";
  }
}

export interface TranscriptClient {
  getTranscript(
    projectId: string,
    sourceMediaId: string,
    signal?: AbortSignal,
  ): Promise<Transcript | null>;
}

function parseSegment(value: unknown): TranscriptSegment {
  const segment = value as Partial<TranscriptSegment> | null;

  if (
    !segment ||
    typeof segment.id !== "string" ||
    typeof segment.originalText !== "string" ||
    typeof segment.startTime !== "number" ||
    typeof segment.endTime !== "number" ||
    !Number.isFinite(segment.startTime) ||
    !Number.isFinite(segment.endTime)
  ) {
    throw new TranscriptRequestError(
      "INVALID_RESPONSE",
      "The stored transcript could not be read.",
    );
  }

  return {
    id: segment.id,
    startTime: segment.startTime,
    endTime: segment.endTime,
    originalText: segment.originalText,
    status: isTranscriptSegmentStatus(segment.status)
      ? segment.status
      : "completed",
    confidence:
      typeof segment.confidence === "number" ? segment.confidence : null,
    ...(segment.providerMetadata
      ? { providerMetadata: segment.providerMetadata }
      : {}),
  };
}

/** Validates a transcript coming off the wire before the UI renders it. */
export function parseTranscript(value: unknown): Transcript {
  const transcript = value as Partial<Transcript> | null;

  if (
    !transcript ||
    typeof transcript.id !== "string" ||
    typeof transcript.projectId !== "string" ||
    typeof transcript.sourceMediaId !== "string" ||
    typeof transcript.providerId !== "string" ||
    !isTranscriptStatus(transcript.status) ||
    !Array.isArray(transcript.segments)
  ) {
    throw new TranscriptRequestError(
      "INVALID_RESPONSE",
      "The stored transcript could not be read.",
    );
  }

  return {
    id: transcript.id,
    projectId: transcript.projectId,
    sourceMediaId: transcript.sourceMediaId,
    audioArtifactId: transcript.audioArtifactId ?? null,
    providerId: transcript.providerId,
    providerModel: transcript.providerModel ?? null,
    language: transcript.language ?? null,
    status: transcript.status,
    segments: transcript.segments.map(parseSegment),
    createdAt: transcript.createdAt ?? "",
    updatedAt: transcript.updatedAt ?? "",
  };
}

export class HttpTranscriptClient implements TranscriptClient {
  constructor(private readonly baseUrl = "/api/transcripts") {}

  async getTranscript(
    projectId: string,
    sourceMediaId: string,
    signal?: AbortSignal,
  ): Promise<Transcript | null> {
    const query = new URLSearchParams({ projectId, mediaId: sourceMediaId });
    const response = await fetch(`${this.baseUrl}?${query.toString()}`, {
      signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new TranscriptRequestError(
        "REQUEST_FAILED",
        "The transcript could not be loaded.",
      );
    }

    const body = (await response.json()) as { transcript?: unknown };

    return body.transcript ? parseTranscript(body.transcript) : null;
  }
}

export const transcriptClient: TranscriptClient = new HttpTranscriptClient();
