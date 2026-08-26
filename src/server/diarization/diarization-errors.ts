/**
 * Application-level diarization errors.
 *
 * Provider failures — HTTP codes, missing model files, native runtime
 * exceptions, GPU worker timeouts — are mapped into these codes by the adapter
 * or the service, so the UI never sees vendor internals or a model stack trace,
 * and the same failure reads the same way whichever provider produced it.
 */

export const DIARIZATION_ERROR_CODES = [
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
] as const;

export type DiarizationErrorCode = (typeof DIARIZATION_ERROR_CODES)[number];

export class DiarizationError extends Error {
  readonly code: DiarizationErrorCode;
  readonly details?: string;

  constructor(
    code: DiarizationErrorCode,
    message: string,
    options: { details?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "DiarizationError";
    this.code = code;
    this.details = options.details;
  }
}

/** Short, actionable text for each failure. Technical detail stays in logs. */
export const DIARIZATION_ERROR_MESSAGES: Record<DiarizationErrorCode, string> = {
  DIARIZATION_PROVIDER_UNAVAILABLE:
    "The speaker diarization provider is unavailable.",
  DIARIZATION_AUTHENTICATION_FAILED:
    "The diarization provider rejected the configured credentials.",
  DIARIZATION_REQUEST_FAILED: "The diarization provider could not be reached.",
  DIARIZATION_TIMEOUT: "Speaker analysis took too long and was stopped.",
  DIARIZATION_INVALID_RESPONSE:
    "The diarization provider returned an invalid result.",
  DIARIZATION_TIMESTAMP_INVALID:
    "The diarization provider returned invalid speaker timestamps.",
  DIARIZATION_AUDIO_MISSING: "The extracted source audio could not be found.",
  DIARIZATION_AUDIO_FAILED:
    "Speaker analysis could not start because audio extraction failed.",
  DIARIZATION_UNSUPPORTED_AUDIO:
    "Speaker analysis failed while processing this audio.",
  DIARIZATION_SAVE_FAILED: "The speaker analysis could not be saved.",
  DIARIZATION_CANCELLED: "Speaker analysis was cancelled.",
};

export function diarizationError(
  code: DiarizationErrorCode,
  options: { details?: string; cause?: unknown; message?: string } = {},
): DiarizationError {
  return new DiarizationError(
    code,
    options.message ?? DIARIZATION_ERROR_MESSAGES[code],
    options,
  );
}

/** Maps an HTTP status from any remote provider onto a normalised code. */
export function errorCodeForHttpStatus(status: number): DiarizationErrorCode {
  if (status === 401 || status === 403) {
    return "DIARIZATION_AUTHENTICATION_FAILED";
  }
  if (status === 408 || status === 504) {
    return "DIARIZATION_TIMEOUT";
  }
  if (status === 415 || status === 422) {
    return "DIARIZATION_UNSUPPORTED_AUDIO";
  }

  return "DIARIZATION_REQUEST_FAILED";
}
