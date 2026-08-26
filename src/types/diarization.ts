/**
 * Speaker diarization domain model.
 *
 * Answers "who spoke, and when" — nothing else. Diarization is deliberately
 * independent of the Part 5 transcript: a project may have a transcript, a
 * diarization, both or neither, and neither model references the other. Part 7
 * merges the two timelines; until then they stay separate.
 *
 * Speaker identities here are anonymous clusters produced by a model. They are
 * not people: `speaker_1` means "the first voice heard in this recording", not
 * a name, an account or a recognised individual.
 */

export const DIARIZATION_STATUSES = [
  "processing",
  "completed",
  "failed",
] as const;

export type DiarizationStatus = (typeof DIARIZATION_STATUSES)[number];

/**
 * One anonymous speaker cluster within a single diarization result.
 *
 * `id` is canonical (`speaker_1`, `speaker_2`, …) and assigned by first
 * appearance on the timeline, never taken from the provider. Ids are stable
 * inside one persisted result; they carry no meaning across separate runs.
 */
export interface DiarizedSpeaker {
  id: string;
  /** Display text, e.g. "Speaker 1". Never a person's name. */
  label: string;
  /** Only when the provider reports something comparable on a 0–1 scale. */
  confidence: number | null;
  providerMetadata?: Record<string, unknown>;
}

/** A contiguous stretch of one speaker's speech, in seconds. */
export interface SpeakerRegion {
  id: string;
  speakerId: string;
  startTime: number;
  endTime: number;
  confidence: number | null;
  /** True when this region is known to overlap another speaker's region. */
  overlap: boolean;
  providerMetadata?: Record<string, unknown>;
}

export interface DiarizationResult {
  id: string;
  projectId: string;
  /** The exact source version this describes; never migrated to another. */
  sourceMediaId: string;
  /** The canonical audio artifact that was analysed. */
  audioArtifactId: string | null;
  providerId: string;
  providerModel: string | null;
  status: DiarizationStatus;
  /** Ordered by canonical id, i.e. by first appearance on the timeline. */
  speakers: DiarizedSpeaker[];
  /** Ordered by start time; gaps are silence and overlaps are preserved. */
  regions: SpeakerRegion[];
  createdAt: string;
  updatedAt: string;
  providerMetadata?: Record<string, unknown>;
}

export function isDiarizationStatus(value: unknown): value is DiarizationStatus {
  return (
    typeof value === "string" &&
    (DIARIZATION_STATUSES as readonly string[]).includes(value)
  );
}

/** Total speech time attributed to one speaker, in seconds. */
export function speakerSpeechSeconds(
  regions: readonly SpeakerRegion[],
  speakerId: string,
): number {
  return regions
    .filter((region) => region.speakerId === speakerId)
    .reduce((total, region) => total + (region.endTime - region.startTime), 0);
}
