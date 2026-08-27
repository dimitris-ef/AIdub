import { describe, expect, it } from "vitest";

import type { DiarizationResult, SpeakerRegion } from "@/types/diarization";
import type { Transcript, TranscriptSegment } from "@/types/transcript";
import { mergeDialogue } from "@/lib/dialogue/merge-dialogue";
import { DEFAULT_MERGE_CONFIG } from "@/lib/dialogue/merge-config";
import {
  exclusiveOverlapDuration,
  gapBetween,
  overlapDuration,
  unionDuration,
} from "@/lib/dialogue/interval";

/**
 * The merge algorithm, exercised entirely through normalised Part 5 and Part 6
 * domain models. No provider adapter is imported anywhere in this file — that
 * is the point: any STT provider must pair with any diarization provider.
 */

let nextSegment = 0;

function segment(
  startTime: number,
  endTime: number,
  text = "spoken words",
  overrides: Partial<TranscriptSegment> = {},
): TranscriptSegment {
  nextSegment += 1;
  return {
    id: `t-${nextSegment}`,
    startTime,
    endTime,
    originalText: text,
    status: "completed",
    confidence: null,
    ...overrides,
  };
}

let nextRegion = 0;

function region(
  speakerId: string,
  startTime: number,
  endTime: number,
  overrides: Partial<SpeakerRegion> = {},
): SpeakerRegion {
  nextRegion += 1;
  return {
    id: `r-${nextRegion}`,
    speakerId,
    startTime,
    endTime,
    confidence: null,
    overlap: false,
    ...overrides,
  };
}

function transcript(segments: TranscriptSegment[]): Transcript {
  return {
    id: "transcript-1",
    projectId: "project-1",
    sourceMediaId: "media-1",
    audioArtifactId: "artifact-1",
    providerId: "stt-provider",
    providerModel: "stt-model",
    language: "en",
    status: "completed",
    segments,
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z",
  };
}

function diarization(regions: SpeakerRegion[]): DiarizationResult {
  const speakerIds = [...new Set(regions.map((r) => r.speakerId))].sort();

  return {
    id: "diarization-1",
    projectId: "project-1",
    sourceMediaId: "media-1",
    audioArtifactId: "artifact-1",
    providerId: "diarization-provider",
    providerModel: "diarization-model",
    status: "completed",
    speakers: speakerIds.map((id, index) => ({
      id,
      label: `Speaker ${index + 1}`,
      confidence: null,
    })),
    regions,
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z",
  };
}

function merge(segments: TranscriptSegment[], regions: SpeakerRegion[]) {
  const outcome = mergeDialogue(transcript(segments), diarization(regions));

  if (!outcome.ok) {
    throw new Error(`expected a successful merge: ${outcome.details}`);
  }

  return outcome.draft;
}

describe("interval arithmetic", () => {
  it("computes overlap, gaps and unions", () => {
    expect(
      overlapDuration({ startTime: 0, endTime: 10 }, { startTime: 4, endTime: 14 }),
    ).toBe(6);
    expect(
      overlapDuration({ startTime: 0, endTime: 3 }, { startTime: 3, endTime: 6 }),
    ).toBe(0);
    expect(
      gapBetween({ startTime: 3.01, endTime: 5 }, { startTime: 0, endTime: 3 }),
    ).toBeCloseTo(0.01);
    expect(
      gapBetween({ startTime: 0, endTime: 5 }, { startTime: 2, endTime: 6 }),
    ).toBe(0);
    // Overlapping intervals count their shared time once.
    expect(
      unionDuration([
        { startTime: 0, endTime: 4 },
        { startTime: 2, endTime: 6 },
        { startTime: 8, endTime: 9 },
      ]),
    ).toBe(7);
  });

  it("measures speech one speaker produced that another did not", () => {
    const bounds = { startTime: 0, endTime: 10 };

    // Fully nested: the challenger adds nothing exclusive.
    expect(
      exclusiveOverlapDuration(
        [{ startTime: 2, endTime: 6 }],
        bounds,
        [{ startTime: 0, endTime: 10 }],
      ),
    ).toBe(0);

    // Consecutive turns: all of the challenger's time is exclusive.
    expect(
      exclusiveOverlapDuration(
        [{ startTime: 8, endTime: 10 }],
        bounds,
        [{ startTime: 0, endTime: 8 }],
      ),
    ).toBe(2);

    // Partial: only the tail lies outside the leader.
    expect(
      exclusiveOverlapDuration(
        [{ startTime: 6, endTime: 10 }],
        bounds,
        [{ startTime: 0, endTime: 8 }],
      ),
    ).toBe(2);
  });
});

describe("mergeDialogue — direct assignment", () => {
  it("assigns a perfectly aligned single speaker with no uncertainty", () => {
    const draft = merge([segment(0, 3, "Hello")], [region("speaker_1", 0, 3)]);

    expect(draft.segments).toHaveLength(1);
    expect(draft.segments[0]).toMatchObject({
      speakerId: "speaker_1",
      startTime: 0,
      endTime: 3,
      originalText: "Hello",
    });
    expect(draft.segments[0].assignment).toMatchObject({
      method: "single_overlap",
      uncertain: false,
      reason: null,
    });
    expect(draft.segments[0].assignment.overlapRatio).toBeCloseTo(1);
    expect(draft.ambiguousSegmentCount).toBe(0);
    expect(draft.unassignedSegmentCount).toBe(0);
  });

  it("tolerates small timing drift between the two models", () => {
    const draft = merge([segment(1, 4)], [region("speaker_1", 0.96, 3.96)]);

    expect(draft.segments[0].speakerId).toBe("speaker_1");
    expect(draft.segments[0].assignment).toMatchObject({
      method: "single_overlap",
      uncertain: false,
    });
  });

  it("does not flag uncertainty when a speaker change sits near a boundary", () => {
    const draft = merge(
      [segment(0, 4, "First"), segment(4, 8, "Second")],
      [region("speaker_1", 0, 3.95), region("speaker_2", 4.02, 8)],
    );

    expect(draft.segments.map((s) => s.speakerId)).toEqual([
      "speaker_1",
      "speaker_2",
    ]);
    expect(draft.segments.every((s) => !s.assignment.uncertain)).toBe(true);
  });

  it("aggregates several regions from the same speaker into one candidate", () => {
    const draft = merge(
      [segment(0, 8)],
      [region("speaker_1", 0, 3), region("speaker_1", 5, 8)],
    );

    const [only] = draft.segments;

    expect(only.speakerId).toBe("speaker_1");
    expect(only.diarization.candidateSpeakers).toHaveLength(1);
    expect(only.diarization.candidateSpeakers[0].overlapDuration).toBe(6);
    expect(only.diarization.regionIds).toHaveLength(2);
    expect(only.assignment.method).toBe("single_overlap");
  });

  it("keeps a thin single-speaker assignment but marks it uncertain", () => {
    // Only 1s of a 10s segment is covered — plausible, not solid.
    const draft = merge([segment(0, 10)], [region("speaker_1", 0, 1)]);

    expect(draft.segments[0].speakerId).toBe("speaker_1");
    expect(draft.segments[0].assignment).toMatchObject({
      method: "single_overlap",
      uncertain: true,
      reason: "low_speaker_coverage",
    });
  });

  it("supports more than two speakers", () => {
    const draft = merge(
      [segment(0, 2, "one"), segment(2, 4, "two"), segment(4, 6, "three")],
      [
        region("speaker_1", 0, 2),
        region("speaker_2", 2, 4),
        region("speaker_3", 4, 6),
      ],
    );

    expect(draft.segments.map((s) => s.speakerId)).toEqual([
      "speaker_1",
      "speaker_2",
      "speaker_3",
    ]);
    expect(draft.ambiguousSegmentCount).toBe(0);
  });
});

describe("mergeDialogue — multiple speakers in one segment", () => {
  it("assigns a clearly dominant speaker but flags the unsplit text", () => {
    const draft = merge(
      [segment(0, 10, "Hello. Yes, I agree.")],
      [region("speaker_1", 0, 8), region("speaker_2", 8, 10)],
    );

    const [only] = draft.segments;

    expect(only.speakerId).toBe("speaker_1");
    expect(only.assignment).toMatchObject({
      method: "dominant_overlap",
      uncertain: true,
      reason: "multiple_speakers_without_word_timestamps",
    });
    expect(only.assignment.confidence).toBeCloseTo(0.8);
    // The text is never divided, and both speakers stay visible.
    expect(only.originalText).toBe("Hello. Yes, I agree.");
    expect(only.diarization.candidateSpeakers.map((c) => c.speakerId)).toEqual([
      "speaker_1",
      "speaker_2",
    ]);
    expect(draft.ambiguousSegmentCount).toBe(1);
  });

  it("does not let a sliver of a second speaker override a dominant one", () => {
    const draft = merge(
      [segment(0, 4.1)],
      [region("speaker_1", 0, 4), region("speaker_2", 4, 8)],
    );

    expect(draft.segments[0].speakerId).toBe("speaker_1");
    expect(draft.segments[0].assignment.uncertain).toBe(false);
  });

  it("leaves a near-even split unassigned rather than guessing", () => {
    const draft = merge(
      [segment(0, 10, "Hello. Yes, I agree.")],
      [region("speaker_1", 0, 5.1), region("speaker_2", 5.1, 10)],
    );

    const [only] = draft.segments;

    expect(only.speakerId).toBeNull();
    expect(only.assignment).toMatchObject({
      method: "unassigned",
      uncertain: true,
      reason: "ambiguous_speakers",
    });
    // The text survives for a human to correct later.
    expect(only.originalText).toBe("Hello. Yes, I agree.");
    expect(only.diarization.candidateSpeakers).toHaveLength(2);
    expect(draft.unassignedSegmentCount).toBe(1);
  });

  it("treats an exact tie as ambiguous, whichever order the regions arrive in", () => {
    const forwards = merge(
      [segment(0, 10)],
      [region("speaker_1", 0, 5), region("speaker_2", 5, 10)],
    );
    const backwards = merge(
      [segment(0, 10)],
      [region("speaker_2", 5, 10), region("speaker_1", 0, 5)],
    );

    for (const draft of [forwards, backwards]) {
      expect(draft.segments[0].speakerId).toBeNull();
      expect(draft.segments[0].assignment.reason).toBe("ambiguous_tie");
    }
  });

  it("does not resolve a tie between two speakers who talk over each other", () => {
    const draft = merge(
      [segment(0, 10)],
      [region("speaker_1", 0, 10), region("speaker_2", 0, 10)],
    );

    expect(draft.segments[0].speakerId).toBeNull();
    expect(draft.segments[0].assignment.reason).toBe("ambiguous_tie");
  });
});

describe("mergeDialogue — overlapping speech", () => {
  it("keeps a dominant speaker while recording the overlap", () => {
    const draft = merge(
      [segment(10, 14)],
      [region("speaker_1", 10, 14), region("speaker_2", 12, 14)],
    );

    const [only] = draft.segments;

    // speaker_2 talks over speaker_1 rather than taking a turn, so speaker_1
    // still owns the segment — but the overlap is not silently dropped.
    expect(only.speakerId).toBe("speaker_1");
    expect(only.diarization.overlap).toBe(true);
    expect(only.assignment.uncertain).toBe(true);
    expect(only.assignment.reason).toBe("overlapping_speech");
    expect(only.diarization.candidateSpeakers.map((c) => c.speakerId)).toEqual([
      "speaker_1",
      "speaker_2",
    ]);
    expect(draft.overlappingSegmentCount).toBe(1);
  });

  it("does not flag overlap for consecutive turns by different speakers", () => {
    const draft = merge(
      [segment(0, 10)],
      [region("speaker_1", 0, 8), region("speaker_2", 8, 10)],
    );

    expect(draft.segments[0].diarization.overlap).toBe(false);
    expect(draft.overlappingSegmentCount).toBe(0);
  });

  it("keeps nested overlap metadata on a long dominant turn", () => {
    const draft = merge(
      [segment(0, 20)],
      [region("speaker_1", 0, 20), region("speaker_2", 9, 10)],
    );

    const [only] = draft.segments;

    expect(only.speakerId).toBe("speaker_1");
    expect(only.diarization.overlap).toBe(true);
    expect(
      only.diarization.candidateSpeakers.find(
        (c) => c.speakerId === "speaker_2",
      ),
    ).toMatchObject({ overlapDuration: 1 });
  });
});

describe("mergeDialogue — gaps and silence", () => {
  it("bridges a tiny timing gap with the nearest region", () => {
    const draft = merge([segment(3.01, 5)], [region("speaker_1", 0, 3)]);

    expect(draft.segments[0].speakerId).toBe("speaker_1");
    expect(draft.segments[0].assignment).toMatchObject({
      method: "nearest_region",
      uncertain: true,
      reason: "timing_gap",
      confidence: null,
    });
    expect(draft.segments[0].diarization.regionIds).toHaveLength(1);
  });

  it("never bridges a real silence gap", () => {
    const draft = merge([segment(10, 12)], [region("speaker_1", 0, 3)]);

    expect(draft.segments[0].speakerId).toBeNull();
    expect(draft.segments[0].assignment).toMatchObject({
      method: "unassigned",
      reason: "no_nearby_speaker",
    });
  });

  it("does not pick a side when two speakers are equally near", () => {
    const draft = merge(
      [segment(4, 4.2)],
      [region("speaker_1", 0, 3.9), region("speaker_2", 4.3, 8)],
    );

    expect(draft.segments[0].speakerId).toBeNull();
    expect(draft.segments[0].assignment.reason).toBe("no_nearby_speaker");
  });

  it("leaves a lone speaker unassigned across a large diarization gap", () => {
    const draft = merge(
      [segment(0, 2, "near"), segment(30, 32, "far")],
      [region("speaker_1", 0, 2)],
    );

    expect(draft.segments[0].speakerId).toBe("speaker_1");
    expect(draft.segments[1].speakerId).toBeNull();
  });
});

describe("mergeDialogue — empty inputs", () => {
  it("produces an empty dialogue for an empty transcript", () => {
    const draft = merge([], [region("speaker_1", 0, 3)]);

    expect(draft.segments).toEqual([]);
    expect(draft.unassignedSegmentCount).toBe(0);
  });

  it("keeps transcript text when diarization found no speakers", () => {
    const draft = merge([segment(0, 3, "Hello"), segment(4, 6, "there")], []);

    expect(draft.segments).toHaveLength(2);
    expect(draft.segments.map((s) => s.originalText)).toEqual([
      "Hello",
      "there",
    ]);
    expect(draft.segments.every((s) => s.speakerId === null)).toBe(true);
    expect(draft.segments.every((s) => s.assignment.uncertain)).toBe(true);
    expect(draft.segments[0].assignment.reason).toBe("no_speaker_regions");
    expect(draft.unassignedSegmentCount).toBe(2);
  });

  it("produces an empty dialogue when neither input has content", () => {
    const draft = merge([], []);

    expect(draft.segments).toEqual([]);
  });
});

describe("mergeDialogue — structure and traceability", () => {
  it("derives stable segment ids from the transcript segments", () => {
    const segments = [segment(0, 2, "one"), segment(2, 4, "two")];
    const regions = [region("speaker_1", 0, 4)];

    const first = mergeDialogue(transcript(segments), diarization(regions));
    const second = mergeDialogue(transcript(segments), diarization(regions));

    if (!first.ok || !second.ok) throw new Error("expected success");

    expect(first.draft.segments.map((s) => s.id)).toEqual(
      segments.map((s) => s.id),
    );
    // Regenerating from the same inputs reproduces the same ids exactly.
    expect(second.draft.segments.map((s) => s.id)).toEqual(
      first.draft.segments.map((s) => s.id),
    );
  });

  it("traces every segment back to its raw inputs", () => {
    const speakerRegion = region("speaker_1", 0, 3);
    const draft = merge([segment(0, 3, "Hello")], [speakerRegion]);
    const [only] = draft.segments;

    expect(only.transcription).toMatchObject({
      transcriptId: "transcript-1",
      transcriptSegmentId: only.id,
      providerId: "stt-provider",
      providerModel: "stt-model",
    });
    expect(only.diarization).toMatchObject({
      diarizationId: "diarization-1",
      providerId: "diarization-provider",
      providerModel: "diarization-model",
    });
    expect(only.diarization.regionIds).toEqual([speakerRegion.id]);
  });

  it("orders segments by time regardless of input order", () => {
    const draft = merge(
      [segment(6, 8, "third"), segment(0, 2, "first"), segment(2, 4, "second")],
      [region("speaker_1", 0, 8)],
    );

    expect(draft.segments.map((s) => s.originalText)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("preserves transcript text exactly", () => {
    const text = "  Well… it's £5, isn't it?  ";
    const draft = merge([segment(0, 3, text)], [region("speaker_1", 0, 3)]);

    expect(draft.segments[0].originalText).toBe(text);
  });

  it("carries provider confidence separately from merge confidence", () => {
    const outcome = mergeDialogue(
      transcript([segment(0, 10, "text", { confidence: 0.42 })]),
      {
        ...diarization([region("speaker_1", 0, 8), region("speaker_2", 8, 10)]),
        speakers: [
          { id: "speaker_1", label: "Speaker 1", confidence: 0.9 },
          { id: "speaker_2", label: "Speaker 2", confidence: null },
        ],
      },
    );

    if (!outcome.ok) throw new Error("expected success");
    const [only] = outcome.draft.segments;

    // Provider values pass through untouched…
    expect(only.transcription.confidence).toBe(0.42);
    expect(only.diarization.confidence).toBe(0.9);
    // …while merge confidence is derived from the timeline alone.
    expect(only.assignment.confidence).toBeCloseTo(0.8);
  });

  it("counts ambiguous, overlapping and unassigned segments", () => {
    const draft = merge(
      [
        segment(0, 3, "clean"),
        segment(4, 8, "ambiguous"),
        segment(20, 24, "overlapped"),
        segment(40, 42, "orphaned"),
      ],
      [
        region("speaker_1", 0, 3),
        region("speaker_1", 4, 6),
        region("speaker_2", 6, 8),
        region("speaker_1", 20, 24),
        region("speaker_2", 22, 24),
      ],
    );

    expect(draft.unassignedSegmentCount).toBe(2);
    expect(draft.overlappingSegmentCount).toBe(1);
    expect(draft.ambiguousSegmentCount).toBe(3);
  });
});

describe("mergeDialogue — defensive validation", () => {
  it("rejects a transcript segment with corrupt timing", () => {
    const outcome = mergeDialogue(
      transcript([segment(Number.NaN, 4)]),
      diarization([region("speaker_1", 0, 4)]),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe("DIALOGUE_INVALID_INPUT");
  });

  it("rejects a speaker region with corrupt timing", () => {
    const outcome = mergeDialogue(
      transcript([segment(0, 4)]),
      diarization([region("speaker_1", 5, 1)]),
    );

    expect(outcome.ok).toBe(false);
  });

  it("rejects a region pointing at a speaker that does not exist", () => {
    const base = diarization([region("speaker_1", 0, 4)]);

    const outcome = mergeDialogue(transcript([segment(0, 4)]), {
      ...base,
      speakers: [],
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.details).toContain("speaker_1");
  });
});

describe("merge configuration", () => {
  it("documents deliberate defaults", () => {
    expect(DEFAULT_MERGE_CONFIG).toEqual({
      minSpeakerCoverage: 0.5,
      dominantSpeakerRatio: 0.75,
      splitMinimumDuration: 0.2,
      nearestRegionMaxGap: 0.4,
    });
  });

  it("changes behaviour when thresholds are retuned", () => {
    const segments = [segment(0, 10)];
    const regions = [region("speaker_1", 0, 6), region("speaker_2", 6, 10)];

    // 0.6 dominance is below the default threshold…
    const strict = mergeDialogue(transcript(segments), diarization(regions));
    // …but a looser configuration accepts it.
    const relaxed = mergeDialogue(transcript(segments), diarization(regions), {
      config: { ...DEFAULT_MERGE_CONFIG, dominantSpeakerRatio: 0.55 },
    });

    if (!strict.ok || !relaxed.ok) throw new Error("expected success");

    expect(strict.draft.segments[0].speakerId).toBeNull();
    expect(relaxed.draft.segments[0].speakerId).toBe("speaker_1");
  });

  it("honours a wider nearest-region tolerance", () => {
    const segments = [segment(3.6, 5)];
    const regions = [region("speaker_1", 0, 3)];

    const strict = mergeDialogue(transcript(segments), diarization(regions));
    const relaxed = mergeDialogue(transcript(segments), diarization(regions), {
      config: { ...DEFAULT_MERGE_CONFIG, nearestRegionMaxGap: 1 },
    });

    if (!strict.ok || !relaxed.ok) throw new Error("expected success");

    expect(strict.draft.segments[0].speakerId).toBeNull();
    expect(relaxed.draft.segments[0].speakerId).toBe("speaker_1");
  });
});
