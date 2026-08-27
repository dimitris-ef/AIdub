import type { DialogueMergeConfigSnapshot } from "@/types/dialogue";

/**
 * Merge thresholds, in one place.
 *
 * These are deliberate defaults, not universal truths: they are recorded on
 * every generated dialogue (`mergeMetadata.config`) alongside the algorithm
 * version, so a result made with different tuning stays explainable and a
 * future version can retune without losing the ability to interpret old data.
 */

export interface DialogueMergeConfig extends DialogueMergeConfigSnapshot {
  /**
   * Minimum share of a transcript segment one speaker must cover before the
   * assignment is treated as solid. Below this the speaker is still assigned
   * — the text has to belong to someone — but the segment is flagged
   * uncertain rather than silently presented as confident.
   */
  minSpeakerCoverage: number;
  /**
   * Share of the attributed speech the leading speaker needs when another
   * speaker also has a material presence. Below it the segment is ambiguous
   * and left unassigned rather than guessed.
   */
  dominantSpeakerRatio: number;
  /**
   * How much exclusive speech a second speaker needs before it counts as a
   * real competing turn rather than boundary jitter. Also the minimum a
   * word-timestamp split would have to produce, hence the name.
   */
  splitMinimumDuration: number;
  /**
   * Largest gap that may be bridged by the nearest-region fallback. Sized for
   * timing drift between two independent models, never for real silence.
   */
  nearestRegionMaxGap: number;
}

/**
 * Chosen deliberately:
 *
 * - `minSpeakerCoverage` 0.5 — a speaker covering less than half a segment is
 *   plausible but not solid, so the assignment is kept and flagged.
 * - `dominantSpeakerRatio` 0.75 — a 3:1 majority is a clear winner; anything
 *   nearer an even split cannot be resolved without word timings.
 * - `splitMinimumDuration` 0.2 s — shorter than this is boundary noise between
 *   two models, not a turn. Part 6 preserves genuinely short turns, and this
 *   keeps them meaningful without letting a 0.05 s sliver create ambiguity.
 * - `nearestRegionMaxGap` 0.4 s — comfortably covers observed drift between
 *   VAD-derived transcript boundaries and diarization turn boundaries, while
 *   staying far below any real pause.
 */
export const DEFAULT_MERGE_CONFIG: DialogueMergeConfig = {
  minSpeakerCoverage: 0.5,
  dominantSpeakerRatio: 0.75,
  splitMinimumDuration: 0.2,
  nearestRegionMaxGap: 0.4,
};

/**
 * The merge logic's identity. Bump this whenever assignment behaviour changes,
 * so a stored dialogue can always be traced to the rules that made it.
 */
export const MERGE_ALGORITHM_VERSION = "dialogue-merge-v1";

/** Persisted shape version for stored dialogues. */
export const DIALOGUE_SCHEMA_VERSION = 1;

export function resolveMergeConfig(
  overrides: Partial<DialogueMergeConfig> = {},
): DialogueMergeConfig {
  return { ...DEFAULT_MERGE_CONFIG, ...overrides };
}

export function toConfigSnapshot(
  config: DialogueMergeConfig,
): DialogueMergeConfigSnapshot {
  return {
    minSpeakerCoverage: config.minSpeakerCoverage,
    dominantSpeakerRatio: config.dominantSpeakerRatio,
    splitMinimumDuration: config.splitMinimumDuration,
    nearestRegionMaxGap: config.nearestRegionMaxGap,
  };
}
