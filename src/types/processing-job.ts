/**
 * Processing job domain model.
 *
 * A job is the frontend's only view of backend media work: it never sees
 * FFmpeg commands, process ids or server file paths. The same model is meant
 * to survive the move from "run it in this server process" to "enqueue it for
 * an external worker".
 */

export const PROCESSING_JOB_TYPES = [
  "probe_media",
  "extract_audio",
  "convert_media",
] as const;

export type ProcessingJobType = (typeof PROCESSING_JOB_TYPES)[number];

export const PROCESSING_JOB_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ProcessingJobStatus = (typeof PROCESSING_JOB_STATUSES)[number];

/** Structured, frontend-safe error information. Never a raw stack trace. */
export interface ProcessingJobError {
  code: ProcessingErrorCode;
  message: string;
  /** Short technical hint. Long FFmpeg output stays in server logs. */
  details?: string;
}

export const PROCESSING_ERROR_CODES = [
  "FFMPEG_NOT_AVAILABLE",
  "FFPROBE_NOT_AVAILABLE",
  "SOURCE_MEDIA_NOT_FOUND",
  "INVALID_REQUEST",
  "UNSUPPORTED_JOB_TYPE",
  "PROBE_FAILED",
  "NO_AUDIO_STREAM",
  "AUDIO_EXTRACTION_FAILED",
  "CONVERSION_FAILED",
  "TEMP_STORAGE_ERROR",
  "ARTIFACT_STORAGE_ERROR",
  "CANCELLED",
  "INTERNAL_ERROR",
] as const;

export type ProcessingErrorCode = (typeof PROCESSING_ERROR_CODES)[number];

/** Technical metadata read from the source file by FFprobe. */
export interface ProbeMediaResult {
  durationSeconds: number | null;
  container: string | null;
  sizeBytes: number | null;
  video: {
    codec: string | null;
    width: number | null;
    height: number | null;
    frameRate: number | null;
  } | null;
  audio: {
    codec: string | null;
    sampleRate: number | null;
    channels: number | null;
  } | null;
}

export interface ProbeJobResult {
  kind: "probe_media";
  metadata: ProbeMediaResult;
}

export interface ExtractedAudioSummary {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sampleRate: number | null;
  channels: number | null;
  durationSeconds: number | null;
}

export interface ExtractAudioJobResult {
  kind: "extract_audio";
  artifact: ExtractedAudioSummary;
}

export interface ConvertMediaJobResult {
  kind: "convert_media";
  artifact: ExtractedAudioSummary;
}

export type ProcessingJobResult =
  | ProbeJobResult
  | ExtractAudioJobResult
  | ConvertMediaJobResult
  | null;

export interface ProcessingJob {
  id: string;
  projectId: string;
  sourceMediaId: string;
  type: ProcessingJobType;
  status: ProcessingJobStatus;
  /** Normalised 0–100. See PROGRESS rules below. */
  progress: number;
  /** True while the backend cannot compute a real percentage. */
  indeterminate: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: ProcessingJobError | null;
  result: ProcessingJobResult;
}

/**
 * Progress policy, applied identically to every job type:
 * - `queued` is always 0
 * - `processing` is 1–99; when a real percentage is unavailable the job is
 *   flagged `indeterminate` and steps through a documented coarse progression
 * - `completed` is always 100
 * - `failed` / `cancelled` keep the last meaningful progress value
 */
export const PROGRESS_QUEUED = 0;
export const PROGRESS_STARTED = 1;
export const PROGRESS_COMPLETED = 100;
export const PROGRESS_MAX_IN_FLIGHT = 99;

const TERMINAL_STATUSES: readonly ProcessingJobStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export function isTerminalStatus(status: ProcessingJobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isProcessingJobType(value: unknown): value is ProcessingJobType {
  return (
    typeof value === "string" &&
    (PROCESSING_JOB_TYPES as readonly string[]).includes(value)
  );
}

export function isProcessingJobStatus(
  value: unknown,
): value is ProcessingJobStatus {
  return (
    typeof value === "string" &&
    (PROCESSING_JOB_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Allowed status transitions. A retry creates a new job — terminal states are
 * final, so `completed → processing` or `failed → completed` never happen.
 */
const ALLOWED_TRANSITIONS: Record<
  ProcessingJobStatus,
  readonly ProcessingJobStatus[]
> = {
  queued: ["processing", "cancelled", "failed"],
  processing: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(
  from: ProcessingJobStatus,
  to: ProcessingJobStatus,
): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}
