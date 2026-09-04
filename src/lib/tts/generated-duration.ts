import type { TtsGenerationWarning } from "@/types/tts";

/**
 * How the generated speech compares with the slot it has to fit.
 *
 * Part 10 estimated this from text before anything was synthesised. Part 11 has
 * the real thing: an actual measured duration of actual audio. Both are kept —
 * they answer different questions, and overwriting the estimate would lose the
 * record of what was predicted before generation.
 *
 * What this still is **not** is a synchronisation claim. Knowing a line runs
 * 5.8 seconds in a 4.0 second window says the line will not fit; it says
 * nothing about how to make it fit, and Part 11 deliberately does nothing about
 * it. No stretching, no compressing, no rate adjustment, no moved timestamps.
 */

/**
 * Chosen to mirror Part 10's text-estimate thresholds, so a line does not
 * change its warning level purely because the measurement got better:
 *
 * - up to 1.15 — inside the slack a real delivery and a mix can absorb.
 * - 1.15 to 1.35 — over, but plausibly recoverable later.
 * - above 1.35 — a third longer than the window; this needs a shorter line,
 *   which is Part 10's "Make shorter", not an audio transformation.
 */
export const GENERATED_DURATION_THRESHOLDS = {
  longer: 1.15,
  muchLonger: 1.35,
} as const;

export interface GeneratedDurationAssessment {
  durationSeconds: number | null;
  segmentDurationSeconds: number;
  /** `generated / available`, or null when either side is unusable. */
  ratio: number | null;
  warnings: TtsGenerationWarning[];
}

/**
 * A null ratio means there was nothing to compare — no duration was reported or
 * measured, or the dialogue segment has no usable span. That is an absence of
 * information rather than a clean bill of health, so it produces no warning
 * either way.
 */
export function assessGeneratedDuration(
  durationSeconds: number | null,
  segmentDurationSeconds: number,
): GeneratedDurationAssessment {
  const usableDuration =
    typeof durationSeconds === "number" &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0
      ? durationSeconds
      : null;
  const usableSegment =
    Number.isFinite(segmentDurationSeconds) && segmentDurationSeconds > 0
      ? segmentDurationSeconds
      : null;

  if (usableDuration === null || usableSegment === null) {
    return {
      durationSeconds: usableDuration,
      segmentDurationSeconds: Number.isFinite(segmentDurationSeconds)
        ? segmentDurationSeconds
        : 0,
      ratio: null,
      warnings: [],
    };
  }

  const ratio = Math.round((usableDuration / usableSegment) * 1000) / 1000;
  const warnings: TtsGenerationWarning[] = [];

  if (ratio > GENERATED_DURATION_THRESHOLDS.muchLonger) {
    warnings.push("generated_audio_much_longer_than_segment");
  } else if (ratio > GENERATED_DURATION_THRESHOLDS.longer) {
    warnings.push("generated_audio_longer_than_segment");
  }

  return {
    durationSeconds: usableDuration,
    segmentDurationSeconds: usableSegment,
    ratio,
    warnings,
  };
}

/** Plain wording for the workspace; never a code shown to a person. */
export const TTS_WARNING_LABELS: Record<TtsGenerationWarning, string> = {
  generated_audio_longer_than_segment:
    "Generated speech is a little longer than the dialogue window.",
  generated_audio_much_longer_than_segment:
    "Generated speech is longer than the dialogue window.",
  provider_warning: "The speech provider reported a problem with this line.",
};

/**
 * Duration of a PCM WAV file, from its header.
 *
 * Providers do not always report how long the audio they produced is, and
 * fabricating a number would be worse than having none. Reading the header is
 * cheap, exact for uncompressed audio, and needs no media processing.
 *
 * Returns null for anything that is not a WAV this can read — a compressed
 * format's real duration needs a decoder, which is the media-processing layer's
 * job, not this one's.
 */
export function wavDurationSeconds(bytes: Uint8Array): number | null {
  // "RIFF" .... "WAVE"
  if (bytes.byteLength < 44) {
    return null;
  }

  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const tag = (offset: number) =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );

  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    return null;
  }

  let offset = 12;
  let byteRate = 0;
  let dataBytes = 0;

  // Walk the chunks rather than assuming the canonical 44-byte layout: writers
  // legitimately insert LIST or fact chunks before the data.
  while (offset + 8 <= view.byteLength) {
    const chunkId = tag(offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (chunkId === "fmt " && body + 16 <= view.byteLength) {
      byteRate = view.getUint32(body + 8, true);
    } else if (chunkId === "data") {
      dataBytes = Math.min(chunkSize, view.byteLength - body);
      break;
    }

    // Chunks are word-aligned.
    offset = body + chunkSize + (chunkSize % 2);
  }

  if (byteRate <= 0 || dataBytes <= 0) {
    return null;
  }

  return Math.round((dataBytes / byteRate) * 1000) / 1000;
}
