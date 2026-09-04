import { isLanguageCode } from "@/lib/languages";
import {
  isSpeechJobOperation,
  isTranslationJobOperation,
  type ProcessingJobParameters,
} from "@/types/processing-job";

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

  if (record.kind === "generate_speech") {
    return parseSpeechParameters(record);
  }

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

  // A request with no operation is a Part 9 client asking for a full run.
  const operation =
    record.operation === undefined
      ? "full"
      : isTranslationJobOperation(record.operation)
        ? record.operation
        : null;

  if (!operation) {
    return null;
  }

  const segmentId =
    typeof record.segmentId === "string" && record.segmentId.trim().length > 0
      ? record.segmentId
      : null;

  // The segment operations act on exactly one line; naming none would leave
  // the backend to choose, which it must never do.
  if (operation !== "full" && !segmentId) {
    return null;
  }

  const expectedTranslationRevision = Number.isInteger(
    record.expectedTranslationRevision,
  )
    ? (record.expectedTranslationRevision as number)
    : null;

  return {
    kind: "translate",
    operation,
    dialogueId: record.dialogueId,
    dialogueRevision: record.dialogueRevision as number,
    sourceLanguage: record.sourceLanguage,
    targetLanguage: record.targetLanguage,
    segmentId,
    expectedTranslationRevision,
  };
}

/**
 * A speech job's inputs.
 *
 * The translation id and revision are what bind a run to exactly the text
 * someone reviewed: without both, a slow request could file audio of a line
 * that has since been rewritten. Anything malformed becomes no parameters at
 * all, and the service rejects the job rather than speaking something the
 * request did not actually name.
 */
function parseSpeechParameters(
  record: Record<string, unknown>,
): ProcessingJobParameters | null {
  if (
    typeof record.dialogueId !== "string" ||
    record.dialogueId.trim().length === 0 ||
    typeof record.translationId !== "string" ||
    record.translationId.trim().length === 0 ||
    !Number.isInteger(record.translationRevision) ||
    (record.translationRevision as number) < 0 ||
    !isLanguageCode(record.targetLanguage)
  ) {
    return null;
  }

  const operation = isSpeechJobOperation(record.operation)
    ? record.operation
    : null;

  if (!operation) {
    return null;
  }

  const dialogueSegmentId =
    typeof record.dialogueSegmentId === "string" &&
    record.dialogueSegmentId.trim().length > 0
      ? record.dialogueSegmentId
      : null;

  // A single-segment run acts on exactly one line; naming none would leave the
  // backend to choose, which it must never do.
  if (operation === "single_segment" && !dialogueSegmentId) {
    return null;
  }

  return {
    kind: "generate_speech",
    operation,
    dialogueId: record.dialogueId,
    translationId: record.translationId,
    translationRevision: record.translationRevision as number,
    targetLanguage: record.targetLanguage,
    dialogueSegmentId,
    regenerateAll: record.regenerateAll === true,
  };
}
