/**
 * Generated processing artifacts.
 *
 * An artifact is produced *by* a job from a source media file — extracted
 * audio today; isolated vocals, transcripts, dubbed audio and renders later.
 * Artifacts are deliberately a separate concept from Part 3's source media:
 * different lifecycle, different storage, different ownership.
 */

export const PROCESSING_ARTIFACT_TYPES = [
  "extracted_audio",
  "converted_media",
] as const;

export type ProcessingArtifactType =
  (typeof PROCESSING_ARTIFACT_TYPES)[number];

export interface ProcessingArtifact {
  id: string;
  projectId: string;
  sourceMediaId: string;
  jobId: string;
  type: ProcessingArtifactType;
  /** Backend-generated name; never derived from the user's filename. */
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sampleRate: number | null;
  channels: number | null;
  durationSeconds: number | null;
  createdAt: string;
}
