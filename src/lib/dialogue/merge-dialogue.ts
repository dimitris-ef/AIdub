import type { DiarizationResult, SpeakerRegion } from "@/types/diarization";
import type { Transcript, TranscriptSegment } from "@/types/transcript";
import type {
  AssignmentReason,
  DialogueSegment,
  DialogueSpeakerCandidate,
  SpeakerAssignmentMetadata,
  SpeakerAssignmentMethod,
} from "@/types/dialogue";
import {
  DEFAULT_MERGE_CONFIG,
  type DialogueMergeConfig,
} from "@/lib/dialogue/merge-config";
import {
  duration,
  exclusiveOverlapDuration,
  gapBetween,
  isValidInterval,
  overlapDuration,
  type Interval,
} from "@/lib/dialogue/interval";

/**
 * The merge: align Part 5 transcript segments with Part 6 speaker regions and
 * decide who said what.
 *
 * Pure and deterministic — no I/O, no persistence, no provider knowledge. It
 * consumes only the normalised domain models, which is what lets any STT
 * provider pair with any diarization provider, and what makes every edge case
 * cheap to test.
 *
 * The rules, in order, for each transcript segment:
 *
 *  1. Aggregate overlapping speech **per speaker** — several regions from the
 *     same speaker are one candidate, not several.
 *  2. No overlap at all → fall back to the nearest region within
 *     `nearestRegionMaxGap` (timing drift), otherwise leave it unassigned.
 *     A real silence gap is never bridged.
 *  3. One candidate → assign it. Coverage below `minSpeakerCoverage` keeps the
 *     assignment but flags it uncertain rather than overstating it.
 *  4. Several candidates → a competing speaker only counts when it has at
 *     least `splitMinimumDuration` of speech the leading speaker was *not*
 *     also producing. That distinction is what separates a real second turn
 *     from boundary jitter, and it is what keeps a speaker talking over
 *     another from being mistaken for a turn change.
 *  5. With a real competitor, the leader needs `dominantSpeakerRatio` of the
 *     attributed speech to win; otherwise the segment is ambiguous and left
 *     unassigned. An exact tie is always ambiguous — never broken by array
 *     order or id.
 *
 * Text is never divided. Without word-level timings there is no honest way to
 * say which words fall on which side of a speaker boundary, so a segment that
 * spans two speakers keeps its full text, names the dominant speaker if there
 * is one, and says so through `assignment.uncertain` and its reason.
 */

export interface MergeDialogueDraft {
  segments: DialogueSegment[];
  ambiguousSegmentCount: number;
  overlappingSegmentCount: number;
  unassignedSegmentCount: number;
}

export type MergeDialogueOutcome =
  | { ok: true; draft: MergeDialogueDraft }
  | { ok: false; code: "DIALOGUE_INVALID_INPUT"; message: string; details: string };

export interface MergeDialogueOptions {
  config?: DialogueMergeConfig;
}

interface SpeakerCandidate extends DialogueSpeakerCandidate {
  regions: SpeakerRegion[];
}

/** A microsecond: below this, two timeline distances are the same distance. */
const GAP_EPSILON = 1e-6;

export function mergeDialogue(
  transcript: Transcript,
  diarization: DiarizationResult,
  { config = DEFAULT_MERGE_CONFIG }: MergeDialogueOptions = {},
): MergeDialogueOutcome {
  // Defensive: Part 5 and Part 6 both validate before persisting, but a merge
  // must never turn corrupt stored data into a plausible-looking dialogue.
  for (const segment of transcript.segments) {
    if (!isValidInterval(segment)) {
      return invalid(
        `transcript segment ${segment.id} has invalid timing`,
      );
    }
  }

  for (const region of diarization.regions) {
    if (!isValidInterval(region)) {
      return invalid(`speaker region ${region.id} has invalid timing`);
    }
  }

  const knownSpeakers = new Set(
    diarization.speakers.map((speaker) => speaker.id),
  );

  for (const region of diarization.regions) {
    if (!knownSpeakers.has(region.speakerId)) {
      return invalid(
        `speaker region ${region.id} references unknown speaker ${region.speakerId}`,
      );
    }
  }

  const segments = transcript.segments.map((segment) =>
    buildSegment(segment, transcript, diarization, config),
  );

  // Ordering is established here, not inherited: start time, then end time,
  // then the stable segment id as a deterministic tie-breaker.
  segments.sort(
    (a, b) =>
      a.startTime - b.startTime ||
      a.endTime - b.endTime ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  return {
    ok: true,
    draft: {
      segments,
      ambiguousSegmentCount: segments.filter(
        (segment) => segment.assignment.uncertain,
      ).length,
      overlappingSegmentCount: segments.filter(
        (segment) => segment.diarization.overlap,
      ).length,
      unassignedSegmentCount: segments.filter(
        (segment) => segment.speakerId === null,
      ).length,
    },
  };
}

function invalid(details: string): MergeDialogueOutcome {
  return {
    ok: false,
    code: "DIALOGUE_INVALID_INPUT",
    message: "The transcript and speaker analysis could not be combined.",
    details,
  };
}

function buildSegment(
  segment: TranscriptSegment,
  transcript: Transcript,
  diarization: DiarizationResult,
  config: DialogueMergeConfig,
): DialogueSegment {
  const segmentDuration = duration(segment);
  const candidates = collectCandidates(segment, diarization.regions, segmentDuration);

  const decision = candidates.length
    ? decideFromOverlap(segment, candidates, config)
    : decideFromProximity(segment, diarization.regions, config);

  const contributingRegions = decision.regions;
  const overlap = hasOverlappingSpeech(contributingRegions, segment);

  const assignment: SpeakerAssignmentMetadata = {
    ...decision.assignment,
    // Overlapping speech is always worth flagging: even a confident dominant
    // speaker may have had their words interleaved with someone else's.
    uncertain: decision.assignment.uncertain || overlap,
    reason:
      decision.assignment.reason ?? (overlap ? "overlapping_speech" : null),
  };

  const assignedSpeaker = decision.speakerId
    ? diarization.speakers.find(
        (speaker) => speaker.id === decision.speakerId,
      )
    : undefined;

  return {
    // Stable identity derived from the transcript segment: regenerating the
    // dialogue from the same transcript yields the same segment ids, so state
    // future parts attach to a segment survives a rebuild.
    id: segment.id,
    speakerId: decision.speakerId,
    // Unsplit segments keep Part 5's timing exactly; nothing here rewrites a
    // raw timestamp.
    startTime: segment.startTime,
    endTime: segment.endTime,
    originalText: segment.originalText,
    transcription: {
      transcriptId: transcript.id,
      transcriptSegmentId: segment.id,
      confidence: segment.confidence,
      status: segment.status,
      providerId: transcript.providerId,
      providerModel: transcript.providerModel,
    },
    diarization: {
      diarizationId: diarization.id,
      regionIds: contributingRegions.map((region) => region.id),
      confidence: assignedSpeaker?.confidence ?? null,
      overlap,
      candidateSpeakers: candidates.map((candidate) => ({
        speakerId: candidate.speakerId,
        overlapDuration: candidate.overlapDuration,
        overlapRatio: candidate.overlapRatio,
      })),
      providerId: diarization.providerId,
      providerModel: diarization.providerModel,
    },
    assignment,
  };
}

/** Aggregates overlap per speaker, so repeated turns are one candidate. */
function collectCandidates(
  segment: Interval,
  regions: readonly SpeakerRegion[],
  segmentDuration: number,
): SpeakerCandidate[] {
  const bySpeaker = new Map<string, SpeakerCandidate>();

  for (const region of regions) {
    const seconds = overlapDuration(segment, region);

    if (seconds <= 0) {
      continue;
    }

    const existing = bySpeaker.get(region.speakerId);

    if (existing) {
      existing.overlapDuration += seconds;
      existing.regions.push(region);
      continue;
    }

    bySpeaker.set(region.speakerId, {
      speakerId: region.speakerId,
      overlapDuration: seconds,
      overlapRatio: 0,
      regions: [region],
    });
  }

  const candidates = [...bySpeaker.values()];

  for (const candidate of candidates) {
    candidate.overlapRatio =
      segmentDuration > 0 ? candidate.overlapDuration / segmentDuration : 0;
  }

  // Sorted by overlap, with the speaker id as a deterministic tie-breaker so
  // the *order* never decides anything — an exact tie is caught explicitly.
  candidates.sort(
    (a, b) =>
      b.overlapDuration - a.overlapDuration ||
      (a.speakerId < b.speakerId ? -1 : a.speakerId > b.speakerId ? 1 : 0),
  );

  return candidates;
}

interface Decision {
  speakerId: string | null;
  regions: SpeakerRegion[];
  assignment: SpeakerAssignmentMetadata;
}

function decideFromOverlap(
  segment: Interval,
  candidates: SpeakerCandidate[],
  config: DialogueMergeConfig,
): Decision {
  const leader = candidates[0];
  const contributingRegions = candidates.flatMap(
    (candidate) => candidate.regions,
  );
  const totalOverlap = candidates.reduce(
    (total, candidate) => total + candidate.overlapDuration,
    0,
  );

  // An exact tie is never broken — not by array order, not by speaker id, and
  // not by whether the tied speakers happen to overlap each other.
  if (
    candidates.length > 1 &&
    leader.overlapDuration === candidates[1].overlapDuration
  ) {
    return unassigned(contributingRegions, "ambiguous_tie", leader.overlapRatio);
  }

  // A competitor only counts when it holds speech the leader was not also
  // producing: a speaker talking *over* the leader is overlap, not a turn.
  const leaderRegions = leader.regions;
  const competitors = candidates.slice(1).filter(
    (candidate) =>
      exclusiveOverlapDuration(candidate.regions, segment, leaderRegions) >=
      config.splitMinimumDuration,
  );

  if (competitors.length === 0) {
    const belowCoverage = leader.overlapRatio < config.minSpeakerCoverage;

    return {
      speakerId: leader.speakerId,
      regions: contributingRegions,
      assignment: {
        method:
          candidates.length === 1 ? "single_overlap" : "dominant_overlap",
        confidence: share(leader.overlapDuration, totalOverlap),
        overlapRatio: leader.overlapRatio,
        uncertain: belowCoverage,
        reason: belowCoverage ? "low_speaker_coverage" : null,
      },
    };
  }

  const dominance = share(leader.overlapDuration, totalOverlap);

  if (dominance !== null && dominance >= config.dominantSpeakerRatio) {
    return {
      speakerId: leader.speakerId,
      regions: contributingRegions,
      assignment: {
        method: "dominant_overlap",
        confidence: dominance,
        overlapRatio: leader.overlapRatio,
        // The segment genuinely spans more than one speaker and there are no
        // word timings, so which words belong to whom is not known.
        uncertain: true,
        reason: "multiple_speakers_without_word_timestamps",
      },
    };
  }

  return unassigned(
    contributingRegions,
    "ambiguous_speakers",
    leader.overlapRatio,
  );
}

/** No region overlaps: bridge timing drift only, never real silence. */
function decideFromProximity(
  segment: Interval,
  regions: readonly SpeakerRegion[],
  config: DialogueMergeConfig,
): Decision {
  if (regions.length === 0) {
    return unassigned([], "no_speaker_regions", null);
  }

  let nearest: SpeakerRegion | null = null;
  let nearestGap = Number.POSITIVE_INFINITY;

  for (const region of regions) {
    const gap = gapBetween(segment, region);

    // Compared with a tolerance: two gaps that differ only by floating-point
    // noise are the same distance, and must not silently pick a winner.
    if (gap < nearestGap - GAP_EPSILON) {
      nearest = region;
      nearestGap = gap;
      continue;
    }

    // A speaker equally near on the other side gives no reason to prefer
    // either one.
    if (
      Math.abs(gap - nearestGap) <= GAP_EPSILON &&
      nearest &&
      nearest.speakerId !== region.speakerId
    ) {
      nearest = null;
    }
  }

  if (!nearest || nearestGap > config.nearestRegionMaxGap) {
    return unassigned([], "no_nearby_speaker", null);
  }

  return {
    speakerId: nearest.speakerId,
    regions: [nearest],
    assignment: {
      method: "nearest_region",
      // Nothing overlapped, so there is no alignment to measure.
      confidence: null,
      overlapRatio: 0,
      uncertain: true,
      reason: "timing_gap",
    },
  };
}

function unassigned(
  regions: SpeakerRegion[],
  reason: AssignmentReason,
  overlapRatio: number | null,
): Decision {
  const method: SpeakerAssignmentMethod = "unassigned";

  return {
    speakerId: null,
    regions,
    assignment: {
      method,
      confidence: null,
      overlapRatio,
      uncertain: true,
      reason,
    },
  };
}

/** True when two different speakers share time inside this segment. */
function hasOverlappingSpeech(
  regions: readonly SpeakerRegion[],
  segment: Interval,
): boolean {
  for (let i = 0; i < regions.length; i += 1) {
    for (let j = i + 1; j < regions.length; j += 1) {
      if (regions[i].speakerId === regions[j].speakerId) {
        continue;
      }

      const shared = overlapDuration(regions[i], regions[j]);

      if (shared > 0 && overlapDuration(segment, {
        startTime: Math.max(regions[i].startTime, regions[j].startTime),
        endTime: Math.min(regions[i].endTime, regions[j].endTime),
      }) > 0) {
        return true;
      }
    }
  }

  return false;
}

function share(part: number, total: number): number | null {
  return total > 0 ? Math.min(1, Math.max(0, part / total)) : null;
}
