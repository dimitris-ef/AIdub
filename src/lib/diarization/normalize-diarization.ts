import type { DiarizedSpeaker, SpeakerRegion } from "@/types/diarization";
import {
  assignSpeakerIds,
  speakerLabelForIndex,
} from "@/lib/diarization/speaker-ids";

/**
 * Turns provider output into Aidub speaker regions.
 *
 * Pure and provider-agnostic: adapters map their own response into
 * `RawSpeakerRegion` first, and this decides what is trustworthy enough to
 * persist. Nothing here invents data — an unusable confidence becomes `null`,
 * overlap is only claimed where it can be seen in the timeline itself, and
 * clearly invalid timing fails the whole result rather than quietly entering
 * a stored diarization.
 *
 * What it deliberately does *not* do: drop short regions, merge neighbouring
 * regions, or fill silence with a placeholder speaker. Part 7 merges these
 * regions with transcript segments and benefits from the model's own
 * segmentation detail, so only exact duplicates are collapsed.
 */

export interface RawSpeakerRegion {
  /** The provider's own label; never persisted as an Aidub speaker id. */
  speakerLabel: string;
  startTime: number;
  endTime: number;
  confidence?: number | null;
  /** Set only when the provider itself reports overlapping speech. */
  overlap?: boolean;
  metadata?: Record<string, unknown>;
}

/** Optional per-speaker information, when a provider reports any. */
export interface RawSpeaker {
  speakerLabel: string;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
}

export type NormalizeDiarizationErrorCode =
  | "DIARIZATION_INVALID_RESPONSE"
  | "DIARIZATION_TIMESTAMP_INVALID";

export type NormalizeDiarizationResult =
  | {
      ok: true;
      speakers: DiarizedSpeaker[];
      regions: SpeakerRegion[];
      /** Exact duplicate regions that were collapsed into one. */
      duplicatesRemoved: number;
      /** Regions whose end time was pulled back to the media duration. */
      clamped: number;
    }
  | {
      ok: false;
      code: NormalizeDiarizationErrorCode;
      message: string;
      details?: string;
    };

export interface NormalizeDiarizationOptions {
  /** Media duration, when known, used to sanity-check and clamp overshoot. */
  durationSeconds?: number | null;
  createId?: () => string;
  /** Per-speaker information the provider reported, keyed by its own label. */
  speakers?: readonly RawSpeaker[];
}

/** Models commonly overshoot the final region by a fraction of a second. */
const CLAMP_TOLERANCE_SECONDS = 1;
/** Tiny negative starts are rounding noise; anything larger is a real error. */
const NEGATIVE_TOLERANCE_SECONDS = 0.05;

function defaultCreateId(): string {
  return crypto.randomUUID();
}

function normalizeConfidence(value: unknown): number | null {
  // Only a value already comparable on a 0–1 scale is kept; anything else
  // stays in provider metadata rather than being reshaped into a number that
  // looks more meaningful than it is.
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : null;
}

function invalid(
  code: NormalizeDiarizationErrorCode,
  details: string,
): NormalizeDiarizationResult {
  return {
    ok: false,
    code,
    message:
      code === "DIARIZATION_TIMESTAMP_INVALID"
        ? "The diarization provider returned invalid speaker timestamps."
        : "The diarization provider returned an invalid result.",
    details,
  };
}

interface ValidatedRegion {
  speakerLabel: string;
  startTime: number;
  endTime: number;
  confidence: number | null;
  providerOverlap: boolean;
  metadata?: Record<string, unknown>;
}

export function normalizeDiarizationRegions(
  rawRegions: unknown,
  options: NormalizeDiarizationOptions = {},
): NormalizeDiarizationResult {
  if (!Array.isArray(rawRegions)) {
    return invalid("DIARIZATION_INVALID_RESPONSE", "regions is not an array");
  }

  const createId = options.createId ?? defaultCreateId;
  const duration =
    typeof options.durationSeconds === "number" &&
    Number.isFinite(options.durationSeconds) &&
    options.durationSeconds > 0
      ? options.durationSeconds
      : null;

  const validated: ValidatedRegion[] = [];
  let clamped = 0;

  for (const raw of rawRegions as RawSpeakerRegion[]) {
    if (typeof raw !== "object" || raw === null) {
      return invalid("DIARIZATION_INVALID_RESPONSE", "region is not an object");
    }

    if (typeof raw.speakerLabel !== "string" || raw.speakerLabel.length === 0) {
      return invalid(
        "DIARIZATION_INVALID_RESPONSE",
        "region has no speaker label",
      );
    }

    if (!Number.isFinite(raw.startTime) || !Number.isFinite(raw.endTime)) {
      return invalid(
        "DIARIZATION_TIMESTAMP_INVALID",
        "non-finite region timestamp",
      );
    }

    let startTime = raw.startTime;
    let endTime = raw.endTime;

    if (startTime < 0) {
      if (startTime < -NEGATIVE_TOLERANCE_SECONDS) {
        return invalid(
          "DIARIZATION_TIMESTAMP_INVALID",
          "negative region start time",
        );
      }
      startTime = 0;
    }

    if (endTime < startTime) {
      return invalid(
        "DIARIZATION_TIMESTAMP_INVALID",
        "region ends before it starts",
      );
    }

    if (duration !== null) {
      if (startTime > duration + CLAMP_TOLERANCE_SECONDS) {
        return invalid(
          "DIARIZATION_TIMESTAMP_INVALID",
          "region starts after the audio ends",
        );
      }

      if (endTime > duration) {
        if (endTime > duration + CLAMP_TOLERANCE_SECONDS) {
          return invalid(
            "DIARIZATION_TIMESTAMP_INVALID",
            "region ends after the audio ends",
          );
        }
        endTime = duration;
        clamped += 1;
      }

      startTime = Math.min(startTime, endTime);
    }

    validated.push({
      speakerLabel: raw.speakerLabel,
      startTime,
      endTime,
      confidence: normalizeConfidence(raw.confidence),
      providerOverlap: raw.overlap === true,
      metadata: raw.metadata,
    });
  }

  // Provider ordering is not trusted. The tie-breaker on the provider label
  // keeps the result deterministic when two speakers start at the same instant.
  validated.sort(
    (a, b) =>
      a.startTime - b.startTime ||
      a.endTime - b.endTime ||
      (a.speakerLabel < b.speakerLabel ? -1 : a.speakerLabel > b.speakerLabel ? 1 : 0),
  );

  const deduplicated: ValidatedRegion[] = [];
  let duplicatesRemoved = 0;

  for (const region of validated) {
    const previous = deduplicated[deduplicated.length - 1];
    const isExactDuplicate =
      previous !== undefined &&
      previous.speakerLabel === region.speakerLabel &&
      previous.startTime === region.startTime &&
      previous.endTime === region.endTime;

    if (isExactDuplicate) {
      duplicatesRemoved += 1;
      continue;
    }

    deduplicated.push(region);
  }

  // Canonical ids come from first appearance, which the sort above has now
  // established — never from the provider's own naming or ordering.
  const idsByLabel = assignSpeakerIds(
    deduplicated.map((region) => region.speakerLabel),
  );

  const regions: SpeakerRegion[] = deduplicated.map((region, index) => ({
    id: createId(),
    speakerId: idsByLabel.get(region.speakerLabel)!,
    startTime: region.startTime,
    endTime: region.endTime,
    confidence: region.confidence,
    // Either the provider said so, or two different speakers demonstrably
    // share time on the normalised timeline. Nothing is assumed beyond that.
    overlap:
      region.providerOverlap || overlapsAnotherSpeaker(deduplicated, index),
    ...(region.metadata && Object.keys(region.metadata).length > 0
      ? { providerMetadata: region.metadata }
      : {}),
  }));

  const reported = new Map(
    (options.speakers ?? []).map((speaker) => [speaker.speakerLabel, speaker]),
  );

  const speakers: DiarizedSpeaker[] = [...idsByLabel.entries()].map(
    ([rawLabel, id], index) => {
      const extra = reported.get(rawLabel);

      return {
        id,
        label: speakerLabelForIndex(index),
        confidence: normalizeConfidence(extra?.confidence),
        providerMetadata: {
          // The provider's own label is kept for debugging only; no Aidub
          // logic and no Part 7 merge may depend on it.
          rawSpeakerLabel: rawLabel,
          ...(extra?.metadata ?? {}),
        },
      };
    },
  );

  return { ok: true, speakers, regions, duplicatesRemoved, clamped };
}

/**
 * Whether this region shares time with a *different* speaker. Two regions from
 * the same speaker touching or overlapping is segmentation detail, not
 * overlapping speech.
 */
function overlapsAnotherSpeaker(
  regions: readonly ValidatedRegion[],
  index: number,
): boolean {
  const region = regions[index];

  return regions.some(
    (other, otherIndex) =>
      otherIndex !== index &&
      other.speakerLabel !== region.speakerLabel &&
      other.startTime < region.endTime &&
      region.startTime < other.endTime,
  );
}
