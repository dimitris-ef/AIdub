import {
  LOW_CONFIDENCE_THRESHOLD,
  type TranscriptSegment,
} from "@/types/transcript";

/**
 * Turns provider output into Aidub transcript segments.
 *
 * Pure and provider-agnostic: adapters normalise their own JSON into
 * `RawTranscriptSegment` first, and this decides what is trustworthy enough to
 * persist. Nothing here invents data — an unusable confidence becomes `null`,
 * and clearly invalid timing fails the whole result rather than quietly
 * entering the transcript.
 */

export interface RawTranscriptSegment {
  startTime: number;
  endTime: number;
  text: string;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
}

export type NormalizeTranscriptErrorCode =
  | "STT_INVALID_RESPONSE"
  | "STT_TIMESTAMP_INVALID";

export type NormalizeTranscriptResult =
  | {
      ok: true;
      segments: TranscriptSegment[];
      /** Blank/whitespace-only segments that were dropped. */
      discardedEmpty: number;
      /** Segments whose end time was pulled back to the media duration. */
      clamped: number;
    }
  | {
      ok: false;
      code: NormalizeTranscriptErrorCode;
      message: string;
      details?: string;
    };

export interface NormalizeTranscriptOptions {
  /** Media duration, when known, used to sanity-check and clamp overshoot. */
  durationSeconds?: number | null;
  createId?: () => string;
}

/** Providers commonly overshoot the final segment by a few hundred ms. */
const CLAMP_TOLERANCE_SECONDS = 1;
/** Tiny negative starts are rounding noise; anything larger is a real error. */
const NEGATIVE_TOLERANCE_SECONDS = 0.05;

function defaultCreateId(): string {
  return crypto.randomUUID();
}

function normalizeConfidence(value: unknown): number | null {
  // Only a value that is already comparable on a 0–1 scale is kept; anything
  // else stays in provider metadata instead of being reshaped into a number
  // that looks more meaningful than it is.
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : null;
}

export function normalizeTranscriptSegments(
  rawSegments: unknown,
  options: NormalizeTranscriptOptions = {},
): NormalizeTranscriptResult {
  if (!Array.isArray(rawSegments)) {
    return {
      ok: false,
      code: "STT_INVALID_RESPONSE",
      message: "The transcription provider returned an invalid result.",
      details: "segments is not an array",
    };
  }

  const createId = options.createId ?? defaultCreateId;
  const duration =
    typeof options.durationSeconds === "number" &&
    Number.isFinite(options.durationSeconds) &&
    options.durationSeconds > 0
      ? options.durationSeconds
      : null;

  const segments: TranscriptSegment[] = [];
  let discardedEmpty = 0;
  let clamped = 0;

  for (const raw of rawSegments as RawTranscriptSegment[]) {
    if (typeof raw !== "object" || raw === null) {
      return {
        ok: false,
        code: "STT_INVALID_RESPONSE",
        message: "The transcription provider returned an invalid result.",
        details: "segment is not an object",
      };
    }

    if (typeof raw.text !== "string") {
      return {
        ok: false,
        code: "STT_INVALID_RESPONSE",
        message: "The transcription provider returned an invalid result.",
        details: "segment text is not a string",
      };
    }

    const text = raw.text.trim();

    if (text.length === 0) {
      // Silence and filler produce empty rows that are not worth persisting;
      // the timeline gap itself is preserved because timestamps are untouched.
      discardedEmpty += 1;
      continue;
    }

    if (!Number.isFinite(raw.startTime) || !Number.isFinite(raw.endTime)) {
      return {
        ok: false,
        code: "STT_TIMESTAMP_INVALID",
        message: "The transcription provider returned invalid timings.",
        details: "non-finite timestamp",
      };
    }

    let startTime = raw.startTime;
    let endTime = raw.endTime;

    if (startTime < 0) {
      if (startTime < -NEGATIVE_TOLERANCE_SECONDS) {
        return {
          ok: false,
          code: "STT_TIMESTAMP_INVALID",
          message: "The transcription provider returned invalid timings.",
          details: "negative start time",
        };
      }
      startTime = 0;
    }

    if (endTime < startTime) {
      return {
        ok: false,
        code: "STT_TIMESTAMP_INVALID",
        message: "The transcription provider returned invalid timings.",
        details: "end time before start time",
      };
    }

    if (duration !== null) {
      if (startTime > duration + CLAMP_TOLERANCE_SECONDS) {
        return {
          ok: false,
          code: "STT_TIMESTAMP_INVALID",
          message: "The transcription provider returned invalid timings.",
          details: "segment starts after the media ends",
        };
      }

      if (endTime > duration) {
        if (endTime > duration + CLAMP_TOLERANCE_SECONDS) {
          return {
            ok: false,
            code: "STT_TIMESTAMP_INVALID",
            message: "The transcription provider returned invalid timings.",
            details: "segment ends after the media ends",
          };
        }
        endTime = duration;
        clamped += 1;
      }

      startTime = Math.min(startTime, endTime);
    }

    const confidence = normalizeConfidence(raw.confidence);

    segments.push({
      id: createId(),
      startTime,
      endTime,
      originalText: text,
      status:
        confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD
          ? "low_confidence"
          : "completed",
      confidence,
      ...(raw.metadata && Object.keys(raw.metadata).length > 0
        ? { providerMetadata: raw.metadata }
        : {}),
    });
  }

  // Providers do not guarantee order. Overlaps are left intact: speech
  // recognisers legitimately produce them, and the timeline handles that later.
  segments.sort(
    (a, b) => a.startTime - b.startTime || a.endTime - b.endTime,
  );

  return { ok: true, segments, discardedEmpty, clamped };
}
