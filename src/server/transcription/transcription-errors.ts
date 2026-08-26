/**
 * Application-level transcription errors.
 *
 * Provider failures — HTTP codes, SDK exceptions, missing model files — are
 * mapped into these codes by the adapter or the service, so the UI never sees
 * vendor internals and the same failure reads the same way whichever provider
 * produced it.
 */

export const TRANSCRIPTION_ERROR_CODES = [
  "STT_PROVIDER_UNAVAILABLE",
  "STT_AUTHENTICATION_FAILED",
  "STT_REQUEST_FAILED",
  "STT_TIMEOUT",
  "STT_INVALID_RESPONSE",
  "STT_TIMESTAMP_INVALID",
  "STT_UNSUPPORTED_AUDIO",
  "AUDIO_ARTIFACT_MISSING",
  "AUDIO_EXTRACTION_FAILED",
  "TRANSCRIPT_SAVE_FAILED",
  "TRANSCRIPTION_CANCELLED",
] as const;

export type TranscriptionErrorCode =
  (typeof TRANSCRIPTION_ERROR_CODES)[number];

export class TranscriptionError extends Error {
  readonly code: TranscriptionErrorCode;
  readonly details?: string;

  constructor(
    code: TranscriptionErrorCode,
    message: string,
    options: { details?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "TranscriptionError";
    this.code = code;
    this.details = options.details;
  }
}

/** Short, actionable text for each failure. Technical detail stays in logs. */
export const TRANSCRIPTION_ERROR_MESSAGES: Record<
  TranscriptionErrorCode,
  string
> = {
  STT_PROVIDER_UNAVAILABLE:
    "The transcription provider is not available on this server.",
  STT_AUTHENTICATION_FAILED:
    "The transcription provider rejected the configured credentials.",
  STT_REQUEST_FAILED: "The transcription provider could not be reached.",
  STT_TIMEOUT: "Transcription took too long and was stopped.",
  STT_INVALID_RESPONSE:
    "The transcription provider returned an invalid result.",
  STT_TIMESTAMP_INVALID:
    "The transcription provider returned invalid timings.",
  STT_UNSUPPORTED_AUDIO:
    "The source audio could not be transcribed by this provider.",
  AUDIO_ARTIFACT_MISSING:
    "Transcription could not start because the source audio is unavailable.",
  AUDIO_EXTRACTION_FAILED:
    "Transcription could not start because audio extraction failed.",
  TRANSCRIPT_SAVE_FAILED: "The transcript could not be saved.",
  TRANSCRIPTION_CANCELLED: "Transcription was cancelled.",
};

export function transcriptionError(
  code: TranscriptionErrorCode,
  options: { details?: string; cause?: unknown; message?: string } = {},
): TranscriptionError {
  return new TranscriptionError(
    code,
    options.message ?? TRANSCRIPTION_ERROR_MESSAGES[code],
    options,
  );
}

/** Maps an HTTP status from any remote provider onto a normalised code. */
export function errorCodeForHttpStatus(status: number): TranscriptionErrorCode {
  if (status === 401 || status === 403) {
    return "STT_AUTHENTICATION_FAILED";
  }
  if (status === 408 || status === 504) {
    return "STT_TIMEOUT";
  }
  if (status === 415 || status === 422) {
    return "STT_UNSUPPORTED_AUDIO";
  }

  return "STT_REQUEST_FAILED";
}
