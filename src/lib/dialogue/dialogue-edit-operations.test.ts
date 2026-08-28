import { describe, expect, it } from "vitest";

import type {
  DialogueSegment,
  DialogueSpeaker,
  UnifiedDialogue,
} from "@/types/dialogue";
import {
  mergeSegments,
  mergeSpeakers,
  newlyOverlappingSegmentIds,
  reassignSpeaker,
  renameSpeaker,
  splitSegment,
  updateSegmentText,
  updateSegmentTiming,
  type DialogueEditResult,
  type EditContext,
} from "@/lib/dialogue/dialogue-edit-operations";
import { validateDialogue } from "@/lib/dialogue/dialogue-validation";
import {
  DIALOGUE_SCHEMA_VERSION,
  DEFAULT_MERGE_CONFIG,
  MERGE_ALGORITHM_VERSION,
} from "@/lib/dialogue/merge-config";
import { parseTimecode, formatTimecode } from "@/lib/timecode";

/**
 * The correction operations, exercised as pure functions over a dialogue.
 * Nothing here touches a repository, so what is being tested is the domain
 * logic itself rather than any persistence around it.
 */

let clock = 0;

const context: EditContext = {
  now: () => new Date(Date.UTC(2026, 7, 28, 12, 0, ++clock)),
  createId: () => `generated-${clock}`,
};

function segment(
  id: string,
  startTime: number,
  endTime: number,
  speakerId: string | null,
  originalText: string,
  overrides: Partial<DialogueSegment> = {},
): DialogueSegment {
  return {
    id,
    speakerId,
    startTime,
    endTime,
    originalText,
    transcription: {
      transcriptId: "transcript-a",
      transcriptSegmentId: id,
      confidence: null,
      status: "completed",
      providerId: "stt",
      providerModel: "stt-model",
    },
    diarization: {
      diarizationId: "diarization-a",
      regionIds: [`r-${id}`],
      confidence: null,
      overlap: false,
      candidateSpeakers: [],
      providerId: "diarizer",
      providerModel: "diarizer-model",
    },
    assignment: {
      method: speakerId ? "single_overlap" : "unassigned",
      confidence: speakerId ? 1 : null,
      overlapRatio: speakerId ? 1 : null,
      uncertain: speakerId === null,
      reason: speakerId === null ? "no_nearby_speaker" : null,
    },
    editMetadata: {
      manuallyEditedText: false,
      manuallyEditedSpeaker: false,
      manuallyEditedTiming: false,
      manuallyChangedStructure: false,
      parentSegmentIds: [],
    },
    ...overrides,
  };
}

function speaker(id: string, name: string): DialogueSpeaker {
  return {
    id,
    name,
    sourceSpeakerIds: [id],
    createdManually: false,
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
  };
}

function dialogue(overrides: Partial<UnifiedDialogue> = {}): UnifiedDialogue {
  return {
    id: "dialogue-a",
    projectId: "project-a",
    sourceMediaId: "media-a",
    transcriptId: "transcript-a",
    diarizationId: "diarization-a",
    version: DIALOGUE_SCHEMA_VERSION,
    status: "completed",
    segments: [
      segment("t-1", 0, 4, "speaker_1", "Hello and welcome."),
      segment("t-2", 4, 8, "speaker_2", "Thanks for having me."),
      segment("t-3", 10, 18, "speaker_1", "Hello everyone, thanks for coming."),
    ],
    speakers: [speaker("speaker_1", "Speaker 1"), speaker("speaker_2", "Speaker 2")],
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
    mergeMetadata: {
      algorithmVersion: MERGE_ALGORITHM_VERSION,
      transcriptId: "transcript-a",
      diarizationId: "diarization-a",
      generatedAt: "2026-08-28T10:00:00.000Z",
      config: { ...DEFAULT_MERGE_CONFIG },
      ambiguousSegmentCount: 0,
      overlappingSegmentCount: 0,
      unassignedSegmentCount: 0,
    },
    editMetadata: {
      hasManualEdits: false,
      revision: 0,
      editedAt: null,
      baselineAlgorithmVersion: MERGE_ALGORITHM_VERSION,
    },
    ...overrides,
  };
}

function expectOk(result: DialogueEditResult): UnifiedDialogue {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.code}: ${result.message}`);
  }

  // Every operation must leave a document that passes validation.
  expect(validateDialogue(result.dialogue).ok).toBe(true);

  return result.dialogue;
}

const find = (d: UnifiedDialogue, id: string) =>
  d.segments.find((s) => s.id === id)!;

describe("updateSegmentText", () => {
  it("replaces the reviewed text and marks the segment edited", () => {
    const before = dialogue({
      segments: [segment("t-1", 0, 4, "speaker_1", "Helo world")],
    });

    const after = expectOk(
      updateSegmentText(before, "t-1", "Hello world", context),
    );

    expect(find(after, "t-1").originalText).toBe("Hello world");
    expect(find(after, "t-1").editMetadata.manuallyEditedText).toBe(true);
    expect(after.editMetadata.hasManualEdits).toBe(true);
    expect(after.editMetadata.revision).toBe(1);
    expect(after.editMetadata.editedAt).not.toBeNull();
    // The correction must not disturb provenance.
    expect(find(after, "t-1").transcription.transcriptSegmentId).toBe("t-1");
  });

  it("trims surrounding whitespace but leaves the wording alone", () => {
    const after = expectOk(
      updateSegmentText(dialogue(), "t-1", "  it's £5, isn't it?  ", context),
    );

    expect(find(after, "t-1").originalText).toBe("it's £5, isn't it?");
  });

  it("allows blanking a false-positive line", () => {
    const after = expectOk(updateSegmentText(dialogue(), "t-1", "", context));

    expect(find(after, "t-1").originalText).toBe("");
    expect(after.segments).toHaveLength(3);
  });

  it("does not bump the revision when nothing changed", () => {
    const before = dialogue();
    const after = expectOk(
      updateSegmentText(before, "t-1", "Hello and welcome.", context),
    );

    expect(after.editMetadata.revision).toBe(0);
    expect(after).toBe(before);
  });

  it("rejects an unknown segment", () => {
    const result = updateSegmentText(dialogue(), "nope", "x", context);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("SEGMENT_NOT_FOUND");
  });
});

describe("renameSpeaker", () => {
  it("changes the display name without changing the stable id", () => {
    const after = expectOk(
      renameSpeaker(dialogue(), "speaker_1", "Alice", "Speaker 1", context),
    );

    expect(after.speakers.find((s) => s.id === "speaker_1")?.name).toBe("Alice");
    // Every segment still references the canonical id.
    expect(after.segments.map((s) => s.speakerId)).toEqual([
      "speaker_1",
      "speaker_2",
      "speaker_1",
    ]);
    expect(after.speakers.map((s) => s.id)).toEqual([
      "speaker_1",
      "speaker_2",
    ]);
    expect(after.editMetadata.revision).toBe(1);
  });

  it("trims the name and falls back when it is blank", () => {
    const trimmed = expectOk(
      renameSpeaker(dialogue(), "speaker_1", "  Alice  ", "Speaker 1", context),
    );
    expect(trimmed.speakers[0].name).toBe("Alice");

    const blank = expectOk(
      renameSpeaker(dialogue(), "speaker_1", "   ", "Speaker 1", context),
    );
    expect(blank.speakers[0].name).toBe("Speaker 1");
  });

  it("caps an unreasonably long name", () => {
    const after = expectOk(
      renameSpeaker(dialogue(), "speaker_1", "A".repeat(500), "Speaker 1", context),
    );

    expect(after.speakers[0].name.length).toBe(80);
  });

  it("rejects an unknown speaker", () => {
    const result = renameSpeaker(dialogue(), "speaker_9", "X", "Speaker 9", context);

    expect(result.ok === false && result.code).toBe("SPEAKER_NOT_FOUND");
  });
});

describe("reassignSpeaker", () => {
  it("makes a manual assignment authoritative and keeps what the merge said", () => {
    const before = dialogue({
      segments: [
        segment("t-1", 0, 4, "speaker_1", "Hello", {
          assignment: {
            method: "dominant_overlap",
            confidence: 0.8,
            overlapRatio: 0.9,
            uncertain: true,
            reason: "multiple_speakers_without_word_timestamps",
          },
        }),
      ],
    });

    const after = expectOk(
      reassignSpeaker(before, "t-1", "speaker_2", context),
    );
    const updated = find(after, "t-1");

    expect(updated.speakerId).toBe("speaker_2");
    expect(updated.assignment.method).toBe("manual");
    expect(updated.assignment.uncertain).toBe(false);
    expect(updated.assignment.reason).toBeNull();
    // Provenance: what the algorithm had decided is still readable.
    expect(updated.assignment.automatic).toEqual({
      method: "dominant_overlap",
      speakerId: "speaker_1",
      reason: "multiple_speakers_without_word_timestamps",
    });
    expect(updated.editMetadata.manuallyEditedSpeaker).toBe(true);
  });

  it("resolves an unassigned segment", () => {
    const before = dialogue({
      segments: [segment("t-1", 0, 4, null, "Who said this?")],
    });

    const after = expectOk(reassignSpeaker(before, "t-1", "speaker_1", context));

    expect(find(after, "t-1").speakerId).toBe("speaker_1");
    expect(find(after, "t-1").assignment.method).toBe("manual");
  });

  it("can clear an assignment back to unassigned", () => {
    const after = expectOk(reassignSpeaker(dialogue(), "t-1", null, context));

    expect(find(after, "t-1").speakerId).toBeNull();
    expect(find(after, "t-1").assignment.method).toBe("unassigned");
  });

  it("never destroys overlap metadata", () => {
    const before = dialogue({
      segments: [
        segment("t-1", 0, 4, "speaker_1", "Hello", {
          diarization: {
            diarizationId: "diarization-a",
            regionIds: ["r-1", "r-2"],
            confidence: null,
            overlap: true,
            candidateSpeakers: [
              { speakerId: "speaker_1", overlapDuration: 4, overlapRatio: 1 },
              { speakerId: "speaker_2", overlapDuration: 2, overlapRatio: 0.5 },
            ],
            providerId: "diarizer",
            providerModel: "diarizer-model",
          },
        }),
      ],
    });

    const after = expectOk(reassignSpeaker(before, "t-1", "speaker_2", context));

    expect(find(after, "t-1").diarization.overlap).toBe(true);
    expect(find(after, "t-1").diarization.candidateSpeakers).toHaveLength(2);
    expect(find(after, "t-1").diarization.regionIds).toEqual(["r-1", "r-2"]);
  });

  it("rejects an unknown speaker", () => {
    const result = reassignSpeaker(dialogue(), "t-1", "speaker_9", context);

    expect(result.ok === false && result.code).toBe("SPEAKER_NOT_FOUND");
  });
});

describe("mergeSpeakers", () => {
  const threeSpeakers = () =>
    dialogue({
      segments: [
        segment("t-1", 0, 4, "speaker_1", "One"),
        segment("t-2", 4, 8, "speaker_3", "Two"),
        segment("t-3", 8, 12, "speaker_3", "Three"),
      ],
      speakers: [
        speaker("speaker_1", "John"),
        speaker("speaker_2", "Maria"),
        speaker("speaker_3", "Speaker 3"),
      ],
    });

  it("moves every segment to the target and keeps the target's id", () => {
    const after = expectOk(
      mergeSpeakers(threeSpeakers(), "speaker_3", "speaker_1", context),
    );

    expect(after.segments.map((s) => s.speakerId)).toEqual([
      "speaker_1",
      "speaker_1",
      "speaker_1",
    ]);
    expect(after.speakers.map((s) => s.id)).toEqual([
      "speaker_1",
      "speaker_2",
    ]);
    expect(after.speakers.find((s) => s.id === "speaker_1")?.name).toBe("John");
  });

  it("records both diarization clusters as the same voice", () => {
    const after = expectOk(
      mergeSpeakers(threeSpeakers(), "speaker_3", "speaker_1", context),
    );

    expect(
      after.speakers.find((s) => s.id === "speaker_1")?.sourceSpeakerIds,
    ).toEqual(["speaker_1", "speaker_3"]);
  });

  it("marks the moved segments as manually assigned", () => {
    const after = expectOk(
      mergeSpeakers(threeSpeakers(), "speaker_3", "speaker_1", context),
    );

    expect(find(after, "t-2").assignment.method).toBe("manual");
    expect(find(after, "t-2").editMetadata.manuallyEditedSpeaker).toBe(true);
    // A segment that already belonged to the target is untouched.
    expect(find(after, "t-1").assignment.method).toBe("single_overlap");
  });

  it("leaves no orphaned speaker references", () => {
    const after = expectOk(
      mergeSpeakers(threeSpeakers(), "speaker_3", "speaker_1", context),
    );
    const ids = new Set(after.speakers.map((s) => s.id));

    expect(
      after.segments.every((s) => s.speakerId === null || ids.has(s.speakerId)),
    ).toBe(true);
  });

  it("refuses to merge a speaker into itself", () => {
    const result = mergeSpeakers(
      threeSpeakers(),
      "speaker_1",
      "speaker_1",
      context,
    );

    expect(result.ok === false && result.code).toBe("SAME_SPEAKER");
  });

  it("rejects an unknown speaker on either side", () => {
    expect(
      mergeSpeakers(threeSpeakers(), "speaker_9", "speaker_1", context).ok,
    ).toBe(false);
    expect(
      mergeSpeakers(threeSpeakers(), "speaker_1", "speaker_9", context).ok,
    ).toBe(false);
  });
});

describe("splitSegment", () => {
  const at14 = () =>
    splitSegment(
      dialogue(),
      "t-3",
      {
        splitTime: 14,
        firstText: "Hello everyone,",
        secondText: "thanks for coming.",
      },
      context,
    );

  it("splits timing exactly and takes the text the caller supplied", () => {
    const after = expectOk(at14());
    const children = after.segments.filter((s) =>
      s.editMetadata.parentSegmentIds.includes("t-3"),
    );

    expect(children).toHaveLength(2);
    expect(children.map((s) => [s.startTime, s.endTime])).toEqual([
      [10, 14],
      [14, 18],
    ]);
    expect(children.map((s) => s.originalText)).toEqual([
      "Hello everyone,",
      "thanks for coming.",
    ]);
    // The combined range still covers the original.
    expect(Math.min(...children.map((s) => s.startTime))).toBe(10);
    expect(Math.max(...children.map((s) => s.endTime))).toBe(18);
  });

  it("gives both halves deterministic ids derived from the parent", () => {
    const after = expectOk(at14());

    expect(after.segments.map((s) => s.id)).toContain("t-3:a");
    expect(after.segments.map((s) => s.id)).toContain("t-3:b");
    expect(after.segments.map((s) => s.id)).not.toContain("t-3");
    expect(new Set(after.segments.map((s) => s.id)).size).toBe(
      after.segments.length,
    );
  });

  it("keeps provenance on both halves", () => {
    const after = expectOk(at14());
    const children = after.segments.filter((s) => s.id.startsWith("t-3:"));

    for (const child of children) {
      expect(child.transcription.transcriptSegmentId).toBe("t-3");
      expect(child.diarization.regionIds).toEqual(["r-t-3"]);
      expect(child.editMetadata.parentSegmentIds).toEqual(["t-3"]);
      expect(child.editMetadata.manuallyChangedStructure).toBe(true);
    }
  });

  it("inherits the speaker unless different ones are chosen", () => {
    const inherited = expectOk(at14());
    expect(
      inherited.segments
        .filter((s) => s.id.startsWith("t-3:"))
        .map((s) => s.speakerId),
    ).toEqual(["speaker_1", "speaker_1"]);

    const chosen = expectOk(
      splitSegment(
        dialogue(),
        "t-3",
        {
          splitTime: 14,
          firstText: "Hello everyone,",
          secondText: "thanks for coming.",
          secondSpeakerId: "speaker_2",
        },
        context,
      ),
    );

    expect(
      chosen.segments
        .filter((s) => s.id.startsWith("t-3:"))
        .map((s) => s.speakerId),
    ).toEqual(["speaker_1", "speaker_2"]);
    expect(find(chosen, "t-3:b").assignment.method).toBe("manual");
  });

  it("keeps the result in timeline order", () => {
    const after = expectOk(at14());
    const starts = after.segments.map((s) => s.startTime);

    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("stays unique when the same line is split repeatedly", () => {
    const once = expectOk(at14());
    const twice = expectOk(
      splitSegment(
        once,
        "t-3:b",
        { splitTime: 16, firstText: "thanks", secondText: "for coming." },
        context,
      ),
    );

    expect(new Set(twice.segments.map((s) => s.id)).size).toBe(
      twice.segments.length,
    );
    expect(
      twice.segments.find((s) => s.id === "t-3:b:a")?.editMetadata
        .parentSegmentIds,
    ).toEqual(["t-3", "t-3:b"]);
  });

  it.each([
    ["at the start", 10],
    ["at the end", 18],
    ["before the start", 5],
    ["after the end", 25],
    ["not a number", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("rejects a split %s", (_label, splitTime) => {
    const result = splitSegment(
      dialogue(),
      "t-3",
      { splitTime, firstText: "a", secondText: "b" },
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("INVALID_SPLIT_TIME");
  });

  it("leaves the dialogue untouched when a split is rejected", () => {
    const before = dialogue();
    const result = splitSegment(
      before,
      "t-3",
      { splitTime: 99, firstText: "a", secondText: "b" },
      context,
    );

    expect(result.ok).toBe(false);
    expect(before.segments).toHaveLength(3);
    expect(before.editMetadata.revision).toBe(0);
  });
});

describe("mergeSegments", () => {
  const sameSpeaker = () =>
    dialogue({
      segments: [
        segment("t-1", 0, 4, "speaker_1", "Hello and"),
        segment("t-2", 4, 8, "speaker_1", "welcome."),
        segment("t-3", 10, 14, "speaker_2", "Thanks."),
      ],
    });

  it("joins adjacent same-speaker lines and spans both", () => {
    const after = expectOk(mergeSegments(sameSpeaker(), "t-1", "t-2", context));

    expect(after.segments).toHaveLength(2);
    const merged = after.segments[0];
    expect(merged.startTime).toBe(0);
    expect(merged.endTime).toBe(8);
    expect(merged.originalText).toBe("Hello and welcome.");
    expect(merged.speakerId).toBe("speaker_1");
  });

  it("keeps provenance from both sides", () => {
    const after = expectOk(mergeSegments(sameSpeaker(), "t-1", "t-2", context));
    const merged = after.segments[0];

    expect(merged.diarization.regionIds.sort()).toEqual(["r-t-1", "r-t-2"]);
    expect(merged.editMetadata.parentSegmentIds.sort()).toEqual(["t-1", "t-2"]);
    expect(merged.editMetadata.manuallyChangedStructure).toBe(true);
  });

  it("carries overlap forward from either side", () => {
    const withOverlap = dialogue({
      segments: [
        segment("t-1", 0, 4, "speaker_1", "Hello"),
        segment("t-2", 4, 8, "speaker_1", "there", {
          diarization: {
            diarizationId: "diarization-a",
            regionIds: ["r-t-2"],
            confidence: null,
            overlap: true,
            candidateSpeakers: [],
            providerId: "diarizer",
            providerModel: "diarizer-model",
          },
        }),
      ],
    });

    const after = expectOk(mergeSegments(withOverlap, "t-1", "t-2", context));

    expect(after.segments[0].diarization.overlap).toBe(true);
  });

  it("works whichever order the two ids are given in", () => {
    const forwards = expectOk(mergeSegments(sameSpeaker(), "t-1", "t-2", context));
    const backwards = expectOk(mergeSegments(sameSpeaker(), "t-2", "t-1", context));

    expect(backwards.segments[0].originalText).toBe(
      forwards.segments[0].originalText,
    );
    expect(backwards.segments[0].startTime).toBe(0);
  });

  it("refuses non-adjacent lines", () => {
    const result = mergeSegments(sameSpeaker(), "t-1", "t-3", context);

    expect(result.ok === false && result.code).toBe("NOT_ADJACENT");
  });

  it("refuses to merge across different speakers", () => {
    const result = mergeSegments(sameSpeaker(), "t-2", "t-3", context);

    expect(result.ok === false && result.code).toBe("DIFFERENT_SPEAKERS");
  });

  it("rejects an unknown segment", () => {
    expect(mergeSegments(sameSpeaker(), "t-1", "nope", context).ok).toBe(false);
  });

  it("skips empty text rather than leaving a double space", () => {
    const withBlank = dialogue({
      segments: [
        segment("t-1", 0, 4, "speaker_1", ""),
        segment("t-2", 4, 8, "speaker_1", "welcome."),
      ],
    });

    const after = expectOk(mergeSegments(withBlank, "t-1", "t-2", context));

    expect(after.segments[0].originalText).toBe("welcome.");
  });
});

describe("updateSegmentTiming", () => {
  it("stores corrected numeric seconds", () => {
    const before = dialogue({
      segments: [segment("t-1", 12, 15, "speaker_1", "Hello")],
    });

    const after = expectOk(
      updateSegmentTiming(before, "t-1", { startTime: 12.2, endTime: 15.4 }, context),
    );

    expect(find(after, "t-1").startTime).toBeCloseTo(12.2);
    expect(find(after, "t-1").endTime).toBeCloseTo(15.4);
    expect(find(after, "t-1").editMetadata.manuallyEditedTiming).toBe(true);
  });

  it("re-sorts when a correction moves a line past its neighbour", () => {
    const after = expectOk(
      updateSegmentTiming(dialogue(), "t-1", { startTime: 20, endTime: 22 }, context),
    );

    expect(after.segments.map((s) => s.id)).toEqual(["t-2", "t-3", "t-1"]);
  });

  it.each([
    ["a negative start", { startTime: -1, endTime: 4 }],
    ["an end before the start", { startTime: 8, endTime: 4 }],
    ["zero duration", { startTime: 4, endTime: 4 }],
    ["a NaN value", { startTime: Number.NaN, endTime: 4 }],
    ["an infinite value", { startTime: 0, endTime: Number.POSITIVE_INFINITY }],
  ])("rejects %s", (_label, timing) => {
    const result = updateSegmentTiming(dialogue(), "t-1", timing, context);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("INVALID_TIMING");
  });

  it("rejects an end beyond the media duration", () => {
    const result = updateSegmentTiming(
      dialogue(),
      "t-1",
      { startTime: 0, endTime: 500 },
      context,
      { mediaDuration: 20 },
    );

    expect(result.ok === false && result.code).toBe("INVALID_TIMING");
  });

  it("allows ending exactly at the media duration", () => {
    const after = expectOk(
      updateSegmentTiming(
        dialogue(),
        "t-1",
        { startTime: 0, endTime: 20 },
        context,
        { mediaDuration: 20 },
      ),
    );

    expect(find(after, "t-1").endTime).toBe(20);
  });

  it("allows a gap and does not stretch neighbours", () => {
    const before = dialogue();
    const after = expectOk(
      updateSegmentTiming(before, "t-1", { startTime: 0, endTime: 2 }, context),
    );

    expect(find(after, "t-1").endTime).toBe(2);
    // The neighbour keeps its own timing; nothing ripples.
    expect(find(after, "t-2").startTime).toBe(4);
    expect(find(after, "t-2").endTime).toBe(8);
  });

  it("allows a new overlap and reports it rather than preventing it", () => {
    const before = dialogue();
    const after = expectOk(
      updateSegmentTiming(before, "t-1", { startTime: 0, endTime: 6 }, context),
    );

    expect(find(after, "t-1").endTime).toBe(6);
    expect(newlyOverlappingSegmentIds(before, after).sort()).toEqual([
      "t-1",
      "t-2",
    ]);
  });

  it("reports nothing when no new overlap was created", () => {
    const before = dialogue();
    const after = expectOk(
      updateSegmentTiming(before, "t-1", { startTime: 0, endTime: 3 }, context),
    );

    expect(newlyOverlappingSegmentIds(before, after)).toEqual([]);
  });
});

describe("validateDialogue", () => {
  it("accepts a well-formed document", () => {
    expect(validateDialogue(dialogue()).ok).toBe(true);
  });

  it("rejects duplicate segment ids", () => {
    const broken = dialogue({
      segments: [
        segment("t-1", 0, 4, "speaker_1", "a"),
        segment("t-1", 4, 8, "speaker_1", "b"),
      ],
    });

    expect(validateDialogue(broken).ok).toBe(false);
  });

  it("rejects an orphaned speaker reference", () => {
    const broken = dialogue({
      segments: [segment("t-1", 0, 4, "speaker_9", "a")],
    });

    const result = validateDialogue(broken);
    expect(result.ok === false && result.code).toBe(
      "UNKNOWN_SPEAKER_REFERENCE",
    );
  });

  it("rejects out-of-order segments", () => {
    const broken = dialogue({
      segments: [
        segment("t-2", 4, 8, "speaker_1", "b"),
        segment("t-1", 0, 4, "speaker_1", "a"),
      ],
    });

    expect(validateDialogue(broken).ok === false).toBe(true);
  });

  it("rejects an edit that re-points the dialogue at other inputs", () => {
    const baseline = dialogue();
    const drifted = dialogue({ transcriptId: "transcript-other" });

    const result = validateDialogue(drifted, baseline);
    expect(result.ok === false && result.code).toBe("IDENTITY_CHANGED");
  });

  it("rejects a nameless speaker", () => {
    const broken = dialogue({
      speakers: [{ ...speaker("speaker_1", "  ") }],
      segments: [segment("t-1", 0, 4, "speaker_1", "a")],
    });

    expect(validateDialogue(broken).ok === false).toBe(true);
  });
});

describe("timecode parsing", () => {
  it.each([
    ["12", 12],
    ["12.5", 12.5],
    ["1:02", 62],
    ["01:02.450", 62.45],
    ["1:02:14.820", 3734.82],
    ["00:00.000", 0],
    ["12,5", 12.5],
  ])("parses %s", (input, expected) => {
    expect(parseTimecode(input)).toBeCloseTo(expected, 3);
  });

  it.each(["", "   ", "abc", "1:2:3:4", "-5", "1:75", "12.", "NaN", "1e3"])(
    "rejects %s",
    (input) => {
      expect(parseTimecode(input)).toBeNull();
    },
  );

  it("round-trips what it formats", () => {
    for (const seconds of [0, 3.24, 62.45, 3734.82]) {
      expect(parseTimecode(formatTimecode(seconds))).toBeCloseTo(seconds, 3);
    }
  });
});
