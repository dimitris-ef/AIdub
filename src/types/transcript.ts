/**
 * Transcript domain model.
 *
 * A transcript answers "what was said, and when" for one exact source media
 * version. It deliberately carries no speaker information — diarization is a
 * later part that will attach speakers to these stable segment ids — and no
 * translated text: `originalText` is the original-language transcription and
 * must never be overwritten by a translation.
 */

export const TRANSCRIPT_STATUSES = [
  "processing",
  "completed",
  "failed",
] as const;

export type TranscriptStatus = (typeof TRANSCRIPT_STATUSES)[number];

export const TRANSCRIPT_SEGMENT_STATUSES = [
  "completed",
  "low_confidence",
] as const;

export type TranscriptSegmentStatus =
  (typeof TRANSCRIPT_SEGMENT_STATUSES)[number];

export interface TranscriptSegment {
  /** Stable id: later parts attach speakers, translations and audio to it. */
  id: string;
  /** Seconds from the start of the media. Canonical unit everywhere. */
  startTime: number;
  endTime: number;
  /** The original-language transcription, as the provider returned it. */
  originalText: string;
  status: TranscriptSegmentStatus;
  /** Normalised 0–1, or null when the provider reports nothing comparable. */
  confidence: number | null;
  /** Provider-specific extras; never secrets, never a whole raw response. */
  providerMetadata?: Record<string, unknown>;
}

export interface Transcript {
  id: string;
  projectId: string;
  /** The exact source media version this transcript describes. */
  sourceMediaId: string;
  /** The Part 4 extracted-audio artifact that was transcribed. */
  audioArtifactId: string | null;
  providerId: string;
  providerModel: string | null;
  /** Detected or hinted language; never written back to the project. */
  language: string | null;
  status: TranscriptStatus;
  segments: TranscriptSegment[];
  createdAt: string;
  updatedAt: string;
}

/** Below this, a segment is flagged rather than hidden. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

export function isTranscriptStatus(value: unknown): value is TranscriptStatus {
  return (
    typeof value === "string" &&
    (TRANSCRIPT_STATUSES as readonly string[]).includes(value)
  );
}

export function isTranscriptSegmentStatus(
  value: unknown,
): value is TranscriptSegmentStatus {
  return (
    typeof value === "string" &&
    (TRANSCRIPT_SEGMENT_STATUSES as readonly string[]).includes(value)
  );
}
