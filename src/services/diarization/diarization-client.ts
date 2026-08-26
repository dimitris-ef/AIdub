import {
  isDiarizationStatus,
  type DiarizationResult,
  type DiarizedSpeaker,
  type SpeakerRegion,
} from "@/types/diarization";

/**
 * The frontend's view of speaker diarization.
 *
 * The workspace never fetches results itself and never learns where they are
 * stored or which model produced them; swapping the development store for a
 * database, or the local model for a GPU worker, changes nothing above this
 * module.
 */

export class DiarizationRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DiarizationRequestError";
  }
}

export interface DiarizationClient {
  getDiarization(
    projectId: string,
    sourceMediaId: string,
    signal?: AbortSignal,
  ): Promise<DiarizationResult | null>;
}

function invalid(): never {
  throw new DiarizationRequestError(
    "INVALID_RESPONSE",
    "The stored speaker analysis could not be read.",
  );
}

function parseSpeaker(value: unknown): DiarizedSpeaker {
  const speaker = value as Partial<DiarizedSpeaker> | null;

  if (
    !speaker ||
    typeof speaker.id !== "string" ||
    typeof speaker.label !== "string"
  ) {
    invalid();
  }

  return {
    id: speaker.id,
    label: speaker.label,
    confidence:
      typeof speaker.confidence === "number" ? speaker.confidence : null,
    ...(speaker.providerMetadata
      ? { providerMetadata: speaker.providerMetadata }
      : {}),
  };
}

function parseRegion(value: unknown): SpeakerRegion {
  const region = value as Partial<SpeakerRegion> | null;

  if (
    !region ||
    typeof region.id !== "string" ||
    typeof region.speakerId !== "string" ||
    typeof region.startTime !== "number" ||
    typeof region.endTime !== "number" ||
    !Number.isFinite(region.startTime) ||
    !Number.isFinite(region.endTime)
  ) {
    invalid();
  }

  return {
    id: region.id,
    speakerId: region.speakerId,
    startTime: region.startTime,
    endTime: region.endTime,
    confidence:
      typeof region.confidence === "number" ? region.confidence : null,
    overlap: region.overlap === true,
    ...(region.providerMetadata
      ? { providerMetadata: region.providerMetadata }
      : {}),
  };
}

/** Validates a result coming off the wire before the UI renders it. */
export function parseDiarization(value: unknown): DiarizationResult {
  const result = value as Partial<DiarizationResult> | null;

  if (
    !result ||
    typeof result.id !== "string" ||
    typeof result.projectId !== "string" ||
    typeof result.sourceMediaId !== "string" ||
    typeof result.providerId !== "string" ||
    !isDiarizationStatus(result.status) ||
    !Array.isArray(result.speakers) ||
    !Array.isArray(result.regions)
  ) {
    invalid();
  }

  return {
    id: result.id,
    projectId: result.projectId,
    sourceMediaId: result.sourceMediaId,
    audioArtifactId: result.audioArtifactId ?? null,
    providerId: result.providerId,
    providerModel: result.providerModel ?? null,
    status: result.status,
    speakers: result.speakers.map(parseSpeaker),
    regions: result.regions.map(parseRegion),
    createdAt: result.createdAt ?? "",
    updatedAt: result.updatedAt ?? "",
    ...(result.providerMetadata
      ? { providerMetadata: result.providerMetadata }
      : {}),
  };
}

export class HttpDiarizationClient implements DiarizationClient {
  constructor(private readonly baseUrl = "/api/diarizations") {}

  async getDiarization(
    projectId: string,
    sourceMediaId: string,
    signal?: AbortSignal,
  ): Promise<DiarizationResult | null> {
    const query = new URLSearchParams({ projectId, mediaId: sourceMediaId });
    const response = await fetch(`${this.baseUrl}?${query.toString()}`, {
      signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new DiarizationRequestError(
        "REQUEST_FAILED",
        "The speaker analysis could not be loaded.",
      );
    }

    const body = (await response.json()) as { diarization?: unknown };

    return body.diarization ? parseDiarization(body.diarization) : null;
  }
}

export const diarizationClient: DiarizationClient = new HttpDiarizationClient();
