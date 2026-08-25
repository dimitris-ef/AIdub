import type {
  ProcessingErrorCode,
  ProcessingJobError,
} from "@/types/processing-job";

/**
 * Processing failures carry a stable code and a short, user-safe message.
 * Raw FFmpeg output is kept in `details`/server logs, never rendered as-is.
 */
export class ProcessingError extends Error {
  readonly code: ProcessingErrorCode;
  readonly details?: string;

  constructor(
    code: ProcessingErrorCode,
    message: string,
    options: { details?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ProcessingError";
    this.code = code;
    this.details = options.details;
  }

  toJobError(): ProcessingJobError {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

const GENERIC_MESSAGE =
  "Processing failed unexpectedly. Please try again.";

/** Maps any thrown value to a structured, frontend-safe job error. */
export function toProcessingJobError(error: unknown): ProcessingJobError {
  if (error instanceof ProcessingError) {
    return error.toJobError();
  }

  return { code: "INTERNAL_ERROR", message: GENERIC_MESSAGE };
}

/** Absolute filesystem paths, POSIX or Windows. */
const ABSOLUTE_PATH = /(?:[A-Za-z]:)?(?:[\\/][\w .@+-]+){2,}/g;

/**
 * Backend paths never reach the frontend: a temp directory layout is an
 * implementation detail, and leaking it would also leak the server's
 * filesystem shape. Only the filename survives.
 */
export function redactPaths(text: string): string {
  return text.replace(ABSOLUTE_PATH, (match) => {
    const segments = match.split(/[\\/]/).filter(Boolean);
    return segments.at(-1) ?? "";
  });
}

/**
 * FFmpeg/FFprobe can print hundreds of lines. Keep a short, path-free tail for
 * diagnostics; the full output goes to the server log only.
 */
export function summarizeProcessOutput(output: string, maxLines = 3): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return redactPaths(lines.slice(-maxLines).join(" | ")).slice(0, 500);
}
