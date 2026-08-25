import type { ProjectMedia } from "@/types/media";

/**
 * The boundary where future media/AI processing will connect.
 *
 * Nothing here is implemented, and nothing here performs I/O: Part 3 contains
 * no transcoding, waveform, transcription, diarization, translation or speech
 * work, and no job runner. This file exists so that when those arrive they
 * attach at a documented seam instead of leaking into components.
 *
 * How it is expected to work:
 *
 *   Aidub web app (Vercel)
 *     → MediaProcessingClient (this contract)
 *       → backend media/job API
 *         → external workers (FFmpeg, GPU inference, …)
 *
 * Jobs will reference stable ids — `projectId` and `mediaId` — never object
 * URLs, blobs or filenames, because the worker reads the bytes from production
 * object storage, not from the browser.
 */

export type MediaProcessingKind =
  | "audio-extraction"
  | "waveform"
  | "transcription"
  | "diarization"
  | "translation"
  | "speech-synthesis"
  | "render";

export interface MediaProcessingRequest {
  projectId: string;
  mediaId: string;
  kind: MediaProcessingKind;
}

export type MediaProcessingJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export interface MediaProcessingJob {
  id: string;
  request: MediaProcessingRequest;
  status: MediaProcessingJobStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * The future client contract. No implementation exists in Part 3 — adding a
 * fake one would create the illusion of a pipeline that is not there.
 */
export interface MediaProcessingClient {
  submit(request: MediaProcessingRequest): Promise<MediaProcessingJob>;
  getJob(jobId: string): Promise<MediaProcessingJob | null>;
}

/**
 * Documents the media a processing job would be submitted for. Kept as a pure
 * mapping so it can be reused when the client is implemented.
 */
export function describeProcessingTarget(media: ProjectMedia): {
  projectId: string;
  mediaId: string;
} {
  return { projectId: media.projectId, mediaId: media.id };
}
