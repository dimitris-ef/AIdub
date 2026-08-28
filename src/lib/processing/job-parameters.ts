import { isLanguageCode } from "@/lib/languages";
import type { ProcessingJobParameters } from "@/types/processing-job";

/**
 * Reads job-type-specific inputs off a request.
 *
 * Pure, and deliberately not part of the `server-only` route helpers: it is the
 * boundary where untrusted browser input becomes domain data, which is exactly
 * the thing that should be directly testable.
 *
 * Nothing is trusted. A translate job's dialogue id, revision and language pair
 * decide what the backend will translate and what the result is considered
 * valid for, so every field is checked and anything malformed becomes no
 * parameters at all — the service then rejects the job rather than translating
 * something the request did not actually specify. Unrecognised fields are
 * dropped rather than carried along.
 */
export function parseJobParameters(
  value: unknown,
): ProcessingJobParameters | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  const record = (
    typeof parsed === "object" && parsed !== null ? parsed : {}
  ) as Record<string, unknown>;

  if (record.kind !== "translate") {
    return null;
  }

  if (
    typeof record.dialogueId !== "string" ||
    record.dialogueId.trim().length === 0 ||
    !Number.isInteger(record.dialogueRevision) ||
    (record.dialogueRevision as number) < 0 ||
    !isLanguageCode(record.sourceLanguage) ||
    !isLanguageCode(record.targetLanguage)
  ) {
    return null;
  }

  return {
    kind: "translate",
    dialogueId: record.dialogueId,
    dialogueRevision: record.dialogueRevision as number,
    sourceLanguage: record.sourceLanguage,
    targetLanguage: record.targetLanguage,
  };
}
