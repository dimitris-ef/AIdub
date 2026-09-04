/**
 * Application-level speech-generation errors.
 *
 * Provider failures — HTTP statuses, missing model files, unsupported
 * languages, native runtime exceptions, GPU worker timeouts — are mapped into
 * these codes by the adapter or the service, so the UI never sees a vendor
 * exception or a model stack trace, and the same failure reads the same way
 * whichever provider produced it.
 *
 * Several codes describe *state* rather than transport: a line whose
 * translation moved on, a speaker with no voice, an assignment that changed
 * mid-run. Those are the ones that keep a result from being stored as current
 * when it no longer describes the project.
 */

export const TTS_ERROR_CODES = [
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
] as const;

export type TtsErrorCode = (typeof TTS_ERROR_CODES)[number];

export class TtsError extends Error {
  readonly code: TtsErrorCode;
  readonly details?: string;

  constructor(
    code: TtsErrorCode,
    message: string,
    options: { details?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "TtsError";
    this.code = code;
    this.details = options.details;
  }
}

/** Short, actionable text for each failure. Technical detail stays in logs. */
export const TTS_ERROR_MESSAGES: Record<TtsErrorCode, string> = {
  TTS_PROVIDER_UNAVAILABLE:
    "The speech provider is not configured on this server.",
  TTS_AUTHENTICATION_FAILED:
    "The speech provider rejected the configured credentials.",
  TTS_RATE_LIMITED:
    "The speech provider is rate limiting requests. Please try again shortly.",
  TTS_REQUEST_FAILED: "The speech provider could not be reached.",
  TTS_TIMEOUT: "Speech generation took too long and was stopped.",
  TTS_UNSUPPORTED_LANGUAGE:
    "The selected voice does not support this project's target language.",
  TTS_VOICE_NOT_FOUND: "The assigned voice is no longer available.",
  TTS_INVALID_REQUEST: "This line cannot be generated as it stands.",
  TTS_GENERATION_FAILED:
    "Speech generation failed. Your previous generated audio has been kept.",
  TTS_INVALID_AUDIO_RESPONSE:
    "The speech provider returned audio that could not be read.",
  TTS_STORAGE_FAILED: "The generated audio could not be saved.",
  TTS_SOURCE_CHANGED:
    "The translation changed while this audio was being generated, so the result was discarded.",
  TTS_TRANSLATION_REQUIRED:
    "Complete the translation before generating voices.",
  TTS_TRANSLATION_STALE:
    "The translation is out of date. Update it before generating speech.",
  TTS_VOICE_ASSIGNMENT_REQUIRED:
    "Assign a voice to every speaker before generating speech.",
  TTS_SPEAKER_UNASSIGNED:
    "Some lines have no speaker. Assign them in Transcript before generating speech.",
  TTS_SEGMENT_NOT_FOUND: "That line is not part of the current translation.",
  TTS_CANCELLED: "Speech generation was cancelled.",
};

export function ttsError(
  code: TtsErrorCode,
  options: { details?: string; cause?: unknown; message?: string } = {},
): TtsError {
  return new TtsError(code, options.message ?? TTS_ERROR_MESSAGES[code], options);
}

/** Maps an HTTP status from any remote provider onto a normalised code. */
export function errorCodeForHttpStatus(status: number): TtsErrorCode {
  if (status === 401 || status === 403) {
    return "TTS_AUTHENTICATION_FAILED";
  }
  if (status === 429) {
    return "TTS_RATE_LIMITED";
  }
  if (status === 404) {
    return "TTS_VOICE_NOT_FOUND";
  }
  if (status === 408 || status === 504) {
    return "TTS_TIMEOUT";
  }

  return "TTS_REQUEST_FAILED";
}
