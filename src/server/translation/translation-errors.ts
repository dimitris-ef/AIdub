/**
 * Application-level translation errors.
 *
 * Provider failures — HTTP statuses, rate limits, malformed JSON, model
 * refusals, worker timeouts — are mapped into these codes by the adapter or the
 * service, so the UI never sees a vendor exception class and the same failure
 * reads the same way whichever provider produced it.
 *
 * Several codes describe *contract* failures rather than transport ones: a
 * provider that skips a line, repeats one, or invents one it was never asked
 * about has produced an unusable result, and Part 9 fails the job instead of
 * persisting a translation with holes in it.
 */

export const TRANSLATION_ERROR_CODES = [
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
] as const;

export type TranslationErrorCode = (typeof TRANSLATION_ERROR_CODES)[number];

export class TranslationError extends Error {
  readonly code: TranslationErrorCode;
  readonly details?: string;

  constructor(
    code: TranslationErrorCode,
    message: string,
    options: { details?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "TranslationError";
    this.code = code;
    this.details = options.details;
  }
}

/** Short, actionable text for each failure. Technical detail stays in logs. */
export const TRANSLATION_ERROR_MESSAGES: Record<TranslationErrorCode, string> = {
  TRANSLATION_PROVIDER_UNAVAILABLE:
    "The translation provider is not configured on this server.",
  TRANSLATION_AUTHENTICATION_FAILED:
    "The translation provider rejected the configured credentials.",
  TRANSLATION_REQUEST_FAILED: "The translation provider could not be reached.",
  TRANSLATION_RATE_LIMITED:
    "The translation provider is rate limiting requests. Please try again shortly.",
  TRANSLATION_TIMEOUT: "Translation took too long and was stopped.",
  TRANSLATION_INVALID_RESPONSE:
    "The translation provider returned an invalid result.",
  TRANSLATION_INCOMPLETE_RESPONSE:
    "Translation failed because the provider returned an incomplete result.",
  TRANSLATION_DUPLICATE_SEGMENT:
    "The translation provider returned the same line twice.",
  TRANSLATION_UNKNOWN_SEGMENT:
    "The translation provider returned a line that was never requested.",
  TRANSLATION_EMPTY_RESULT:
    "The translation provider returned no text for one or more lines.",
  TRANSLATION_SAVE_FAILED: "The translation could not be saved.",
  TRANSLATION_SOURCE_CHANGED:
    "The dialogue changed while translation was running, so the result was discarded.",
  TRANSLATION_SOURCE_REQUIRED:
    "Complete transcript review before translating this project.",
  TRANSLATION_SAME_LANGUAGE:
    "The source and target languages are the same, so there is nothing to translate.",
  TRANSLATION_UNSUPPORTED_LANGUAGE:
    "This language pair is not supported by the configured translation provider.",
  TRANSLATION_CONTEXT_BUILD_FAILED:
    "The surrounding dialogue for this line could not be assembled.",
  TRANSLATION_REGENERATION_FAILED:
    "This line could not be translated again. The previous translation is unchanged.",
  TRANSLATION_SHORTEN_FAILED:
    "A shorter version of this line could not be produced. The previous translation is unchanged.",
  TRANSLATION_SEGMENT_NOT_FOUND:
    "That line is not part of the current translation.",
  TRANSLATION_REVISION_CONFLICT:
    "This translation changed while that request was running, so the result was discarded.",
  TRANSLATION_NOT_FOUND: "There is no translation to change yet.",
  TRANSLATION_CANCELLED: "Translation was cancelled.",
};

export function translationError(
  code: TranslationErrorCode,
  options: { details?: string; cause?: unknown; message?: string } = {},
): TranslationError {
  return new TranslationError(
    code,
    options.message ?? TRANSLATION_ERROR_MESSAGES[code],
    options,
  );
}

/** Maps an HTTP status from any remote provider onto a normalised code. */
export function errorCodeForHttpStatus(status: number): TranslationErrorCode {
  if (status === 401 || status === 403) {
    return "TRANSLATION_AUTHENTICATION_FAILED";
  }
  if (status === 429) {
    return "TRANSLATION_RATE_LIMITED";
  }
  if (status === 408 || status === 504) {
    return "TRANSLATION_TIMEOUT";
  }

  return "TRANSLATION_REQUEST_FAILED";
}

/**
 * Whether retrying the same request could plausibly succeed.
 *
 * Rate limits and transient transport failures are worth one more attempt; a
 * rejected credential, an unsupported language or a malformed response are not
 * — repeating them only wastes provider quota and delays the error the user
 * actually needs to see.
 */
export function isRetryableTranslationError(
  code: TranslationErrorCode,
): boolean {
  return (
    code === "TRANSLATION_RATE_LIMITED" || code === "TRANSLATION_REQUEST_FAILED"
  );
}
