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
  "transcribe",
  "diarize",
  "translate",
  "generate_speech",
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
  "STT_PROVIDER_UNAVAILABLE",
  "STT_AUTHENTICATION_FAILED",
  "STT_REQUEST_FAILED",
  "STT_TIMEOUT",
  "STT_INVALID_RESPONSE",
  "STT_TIMESTAMP_INVALID",
  "STT_UNSUPPORTED_AUDIO",
  "AUDIO_ARTIFACT_MISSING",
  "TRANSCRIPT_SAVE_FAILED",
  "TRANSCRIPTION_CANCELLED",
  "DIARIZATION_PROVIDER_UNAVAILABLE",
  "DIARIZATION_AUTHENTICATION_FAILED",
  "DIARIZATION_REQUEST_FAILED",
  "DIARIZATION_TIMEOUT",
  "DIARIZATION_INVALID_RESPONSE",
  "DIARIZATION_TIMESTAMP_INVALID",
  "DIARIZATION_AUDIO_MISSING",
  "DIARIZATION_AUDIO_FAILED",
  "DIARIZATION_UNSUPPORTED_AUDIO",
  "DIARIZATION_SAVE_FAILED",
  "DIARIZATION_CANCELLED",
  "TRANSLATION_PROVIDER_UNAVAILABLE",
  "TRANSLATION_AUTHENTICATION_FAILED",
  "TRANSLATION_REQUEST_FAILED",
  "TRANSLATION_RATE_LIMITED",
  "TRANSLATION_TIMEOUT",
  "TRANSLATION_INVALID_RESPONSE",
  "TRANSLATION_INCOMPLETE_RESPONSE",
  "TRANSLATION_DUPLICATE_SEGMENT",
  "TRANSLATION_UNKNOWN_SEGMENT",
  "TRANSLATION_EMPTY_RESULT",
  "TRANSLATION_SAVE_FAILED",
  "TRANSLATION_SOURCE_CHANGED",
  "TRANSLATION_SOURCE_REQUIRED",
  "TRANSLATION_SAME_LANGUAGE",
  "TRANSLATION_UNSUPPORTED_LANGUAGE",
  "TRANSLATION_CONTEXT_BUILD_FAILED",
  "TRANSLATION_REGENERATION_FAILED",
  "TRANSLATION_SHORTEN_FAILED",
  "TRANSLATION_SEGMENT_NOT_FOUND",
  "TRANSLATION_REVISION_CONFLICT",
  "TRANSLATION_NOT_FOUND",
  "TRANSLATION_CANCELLED",
  "TTS_PROVIDER_UNAVAILABLE",
  "TTS_AUTHENTICATION_FAILED",
  "TTS_RATE_LIMITED",
  "TTS_REQUEST_FAILED",
  "TTS_TIMEOUT",
  "TTS_UNSUPPORTED_LANGUAGE",
  "TTS_VOICE_NOT_FOUND",
  "TTS_INVALID_REQUEST",
  "TTS_GENERATION_FAILED",
  "TTS_INVALID_AUDIO_RESPONSE",
  "TTS_STORAGE_FAILED",
  "TTS_SOURCE_CHANGED",
  "TTS_TRANSLATION_REQUIRED",
  "TTS_TRANSLATION_STALE",
  "TTS_VOICE_ASSIGNMENT_REQUIRED",
  "TTS_SPEAKER_UNASSIGNED",
  "TTS_SEGMENT_NOT_FOUND",
  "TTS_CANCELLED",
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

/**
 * Transcription references the saved transcript rather than repeating it:
 * the transcript is persisted in its own store and outlives the job.
 */
export interface TranscribeJobResult {
  kind: "transcribe";
  transcriptId: string;
  segmentCount: number;
  detectedLanguage: string | null;
  providerId: string;
  providerModel: string | null;
}

/**
 * Diarization references the saved result rather than repeating it: speakers
 * and regions are persisted in their own store and outlive the job.
 */
export interface DiarizationJobResult {
  kind: "diarize";
  diarizationId: string;
  speakerCount: number;
  regionCount: number;
  providerId: string;
  providerModel: string | null;
}

/**
 * Translation references the saved translation rather than repeating it: the
 * translated lines are persisted in their own store and outlive the job.
 */
export interface TranslateJobResult {
  kind: "translate";
  translationId: string;
  dialogueId: string;
  dialogueRevision: number;
  segmentCount: number;
  sourceLanguage: string;
  targetLanguage: string;
  providerId: string;
  providerModel: string | null;
}

/**
 * Speech generation references the saved records rather than repeating them:
 * the generated lines are persisted in their own store, their audio lives in
 * artifact storage, and both outlive the job.
 *
 * The counts are what a person needs to know a run finished honestly: how many
 * lines were spoken, how many were intentionally silent, and how many failed. A
 * run that could not speak every line still completes — a partial result with
 * the failures named beats losing the lines that did work.
 */
export interface GenerateSpeechJobResult {
  kind: "generate_speech";
  dialogueId: string;
  translationId: string;
  targetLanguage: string;
  generatedCount: number;
  skippedCount: number;
  failedCount: number;
  providerId: string;
  providerModel: string | null;
}

export type ProcessingJobResult =
  | ProbeJobResult
  | ExtractAudioJobResult
  | ConvertMediaJobResult
  | TranscribeJobResult
  | DiarizationJobResult
  | TranslateJobResult
  | GenerateSpeechJobResult
  | null;

/**
 * Job-type-specific inputs that project and source media alone cannot express.
 *
 * A discriminated union rather than a widening list of nullable scalars on the
 * job: a translation needs to name a dialogue revision and a language pair,
 * and later stages will need their own inputs (a voice assignment, a mix
 * preset) without every job type growing fields it ignores.
 */
/**
 * What a translate job is being asked to do.
 *
 * All three share one job type rather than becoming separate systems: they
 * differ in scope, not in lifecycle. A full run replaces the whole translation;
 * the two segment operations replace exactly one line and leave every other one
 * byte-identical.
 */
export const TRANSLATION_JOB_OPERATIONS = [
  "full",
  "regenerate_segment",
  "shorten_segment",
] as const;

export type TranslationJobOperation =
  (typeof TRANSLATION_JOB_OPERATIONS)[number];

export interface TranslateJobParameters {
  kind: "translate";
  operation: TranslationJobOperation;
  /** The exact dialogue the job was created against. */
  dialogueId: string;
  /** The exact `editMetadata.revision` of that dialogue. */
  dialogueRevision: number;
  sourceLanguage: string;
  targetLanguage: string;
  /** The line to act on. Required by the segment operations, null for `full`. */
  segmentId?: string | null;
  /**
   * The translation revision the request was built against.
   *
   * A segment operation refuses to write if the translation has moved on since
   * — someone else's newer edit must not be silently overwritten by a slower
   * request that never saw it.
   */
  expectedTranslationRevision?: number | null;
}

export function isTranslationJobOperation(
  value: unknown,
): value is TranslationJobOperation {
  return (
    typeof value === "string" &&
    (TRANSLATION_JOB_OPERATIONS as readonly string[]).includes(value)
  );
}

/**
 * What a speech-generation job is being asked to do.
 *
 * Both share one job type rather than becoming separate systems: they differ in
 * scope, not in lifecycle. A full-project run replaces every line's audio; a
 * single-segment run replaces exactly one and leaves the rest untouched.
 */
export const SPEECH_JOB_OPERATIONS = ["full_project", "single_segment"] as const;

export type SpeechJobOperation = (typeof SPEECH_JOB_OPERATIONS)[number];

export interface GenerateSpeechJobParameters {
  kind: "generate_speech";
  operation: SpeechJobOperation;
  /** The exact dialogue the job was created against. */
  dialogueId: string;
  /** The exact translation whose text is being spoken. */
  translationId: string;
  /**
   * The translation revision the request was built against.
   *
   * The run refuses to store its result if the translation has moved on since —
   * audio of a line someone has already rewritten must never be filed as
   * current.
   */
  translationRevision: number;
  targetLanguage: string;
  /** The line to speak. Required by `single_segment`, null for a full run. */
  dialogueSegmentId?: string | null;
  /**
   * Speak every line again, including ones whose audio is still current.
   *
   * Default false, so a full run after a few edits pays for the few lines that
   * changed rather than re-synthesising a whole project.
   */
  regenerateAll?: boolean;
}

export function isSpeechJobOperation(
  value: unknown,
): value is SpeechJobOperation {
  return (
    typeof value === "string" &&
    (SPEECH_JOB_OPERATIONS as readonly string[]).includes(value)
  );
}

export type ProcessingJobParameters =
  | TranslateJobParameters
  | GenerateSpeechJobParameters;

/**
 * Job types that consume the source media itself. Everything else works from
 * data the backend already holds — a translation reads the stored dialogue and
 * speech generation reads the stored translation, so neither needs nor accepts
 * a video upload.
 */
export function jobTypeNeedsSourceMedia(type: ProcessingJobType): boolean {
  return type !== "translate" && type !== "generate_speech";
}

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
  /** Coarse phase label, e.g. "Recognising speech"; null when not reported. */
  stage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: ProcessingJobError | null;
  result: ProcessingJobResult;
  /** Set by jobs that use a pluggable provider (transcription, diarization). */
  providerId: string | null;
  /** Optional source-language hint for providers that accept one. */
  languageHint: string | null;
  /** The generated audio a job consumed, once it is known. */
  audioArtifactId: string | null;
  /** Job-type-specific inputs; null for types that need none. */
  parameters: ProcessingJobParameters | null;
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
