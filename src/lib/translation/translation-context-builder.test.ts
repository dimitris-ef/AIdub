import { describe, expect, it } from "vitest";

import type { DialogueSegment, UnifiedDialogue } from "@/types/dialogue";
import type { DialogueTranslation } from "@/types/translation";
import { TRANSLATION_SCHEMA_VERSION } from "@/lib/translation/translation-config";
import {
  buildBatchContext,
  buildSegmentContext,
  contextSegmentIds,
  validateContext,
} from "@/lib/translation/translation-context-builder";

/**
 * Context is what lets a line be translated as dialogue rather than as an
 * isolated sentence. These tests pin the shape of it: which lines travel, in
 * what order, with whose name attached, and — most importantly — that the line
 * being translated is never itself presented as background.
 */

function segment(
  id: string,
  index: number,
  speakerId: string | null,
  originalText: string,
): DialogueSegment {
  return {
    id,
    speakerId,
    startTime: index * 2,
    endTime: index * 2 + 2,
    originalText,
    transcription: {
      transcriptId: "transcript-a",
      transcriptSegmentId: `t-${id}`,
      confidence: null,
      status: "completed",
      providerId: "stt",
      providerModel: null,
    },
    diarization: {
      diarizationId: "diarization-a",
      regionIds: [],
      confidence: null,
      overlap: false,
      candidateSpeakers: [],
      providerId: "diarizer",
      providerModel: null,
    },
    assignment: {
      method: "single_overlap",
      confidence: 1,
      overlapRatio: 1,
      uncertain: false,
      reason: null,
    },
    editMetadata: {
      manuallyEditedText: false,
      manuallyEditedSpeaker: false,
      manuallyEditedTiming: false,
      manuallyChangedStructure: false,
      parentSegmentIds: [],
    },
  };
}

/** The specification's worked example, plus enough lines to exercise a window. */
function dialogue(
  segments: DialogueSegment[] = [
    segment("seg1", 0, "speaker_1", "Did you call John?"),
    segment("seg2", 1, "speaker_2", "Yes, he said he'll come."),
    segment("seg3", 2, "speaker_1", "Good."),
    segment("seg4", 3, "speaker_2", "Anything else?"),
    segment("seg5", 4, "speaker_1", "Not for now."),
    segment("seg6", 5, "speaker_2", "See you tomorrow."),
    segment("seg7", 6, "speaker_1", "Bye."),
  ],
): UnifiedDialogue {
  return {
    id: "dialogue-a",
    projectId: "project-a",
    sourceMediaId: "media-a",
    transcriptId: "transcript-a",
    diarizationId: "diarization-a",
    version: 2,
    status: "completed",
    segments,
    speakers: [
      {
        id: "speaker_1",
        name: "Alice",
        sourceSpeakerIds: ["speaker_1"],
        createdManually: false,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "speaker_2",
        name: "Bob",
        sourceSpeakerIds: ["speaker_2"],
        createdManually: false,
        createdAt: "",
        updatedAt: "",
      },
    ],
    createdAt: "",
    updatedAt: "",
    mergeMetadata: {
      algorithmVersion: "dialogue-merge-v1",
      transcriptId: "transcript-a",
      diarizationId: "diarization-a",
      generatedAt: "",
      config: {
        minSpeakerCoverage: 0.5,
        dominantSpeakerRatio: 0.75,
        splitMinimumDuration: 0.2,
        nearestRegionMaxGap: 0.4,
      },
      ambiguousSegmentCount: 0,
      overlappingSegmentCount: 0,
      unassignedSegmentCount: 0,
    },
    editMetadata: {
      hasManualEdits: false,
      revision: 0,
      editedAt: null,
      baselineAlgorithmVersion: "dialogue-merge-v1",
    },
  };
}

function translationFor(
  texts: Record<string, string>,
): DialogueTranslation {
  return {
    id: "translation-a",
    projectId: "project-a",
    sourceMediaId: "media-a",
    dialogueId: "dialogue-a",
    dialogueRevision: 0,
    sourceLanguage: "en",
    targetLanguage: "pl",
    providerId: "mock",
    providerModel: "deterministic-v1",
    version: TRANSLATION_SCHEMA_VERSION,
    status: "completed",
    revision: 0,
    createdAt: "",
    updatedAt: "",
    usage: null,
    segments: Object.entries(texts).map(([dialogueSegmentId, translatedText]) => ({
      id: `ts-${dialogueSegmentId}`,
      dialogueSegmentId,
      speakerId: null,
      startTime: 0,
      endTime: 2,
      sourceText: "",
      translatedText,
      sourceLanguage: "en",
      targetLanguage: "pl",
      confidence: null,
      translationMetadata: {
        providerId: "mock",
        providerModel: null,
        generationMode: "initial",
        generatedAt: "",
        contextSegmentIds: [],
        estimatedDurationSeconds: 0,
        sourceDurationSeconds: 2,
        durationRatio: 0,
        durationWarning: "none",
        durationEstimatorVersion: "v1",
        confidence: null,
      },
      editMetadata: { manuallyEdited: false, revision: 0, editedAt: null },
    })),
  };
}

const window = {
  previousSegmentCount: 2,
  nextSegmentCount: 2,
  speakerHistoryCount: 0,
};

describe("buildSegmentContext", () => {
  it("carries the lines either side of the one being translated", () => {
    // The specification's example: translating seg2 needs seg1 to know who
    // "he" is, and seg3 to know it lands as an answer.
    const context = buildSegmentContext(dialogue(), "seg2", { config: window });

    expect(context?.previousSegments.map((s) => s.segmentId)).toEqual(["seg1"]);
    expect(context?.nextSegments.map((s) => s.segmentId)).toEqual([
      "seg3",
      "seg4",
    ]);
    expect(context?.previousSegments[0].sourceText).toBe("Did you call John?");
  });

  it("never includes the segment being translated", () => {
    const context = buildSegmentContext(dialogue(), "seg4", { config: window });

    expect(contextSegmentIds(context)).not.toContain("seg4");
  });

  it("keeps context in timeline order", () => {
    const context = buildSegmentContext(dialogue(), "seg4", { config: window });

    expect(context?.previousSegments.map((s) => s.segmentId)).toEqual([
      "seg2",
      "seg3",
    ]);
    expect(context?.nextSegments.map((s) => s.segmentId)).toEqual([
      "seg5",
      "seg6",
    ]);
  });

  it("has no previous context at the start of the dialogue", () => {
    const context = buildSegmentContext(dialogue(), "seg1", { config: window });

    expect(context?.previousSegments).toEqual([]);
    expect(context?.nextSegments.map((s) => s.segmentId)).toEqual([
      "seg2",
      "seg3",
    ]);
  });

  it("has no following context at the end of the dialogue", () => {
    const context = buildSegmentContext(dialogue(), "seg7", { config: window });

    expect(context?.nextSegments).toEqual([]);
    expect(context?.previousSegments.map((s) => s.segmentId)).toEqual([
      "seg5",
      "seg6",
    ]);
  });

  it("honours the configured window size", () => {
    const wide = buildSegmentContext(dialogue(), "seg4", {
      config: { previousSegmentCount: 3, nextSegmentCount: 1, speakerHistoryCount: 0 },
    });

    expect(wide?.previousSegments).toHaveLength(3);
    expect(wide?.nextSegments).toHaveLength(1);
  });

  it("carries each line's speaker name for prompting", () => {
    const context = buildSegmentContext(dialogue(), "seg2", { config: window });

    expect(context?.previousSegments[0].speakerName).toBe("Alice");
    expect(context?.previousSegments[0].speakerId).toBe("speaker_1");
  });

  it("resolves speaker names from the dialogue, so a rename shows through", () => {
    const renamed = dialogue();
    renamed.speakers[0] = { ...renamed.speakers[0], name: "Narrator" };

    const context = buildSegmentContext(renamed, "seg2", { config: window });

    expect(context?.previousSegments[0].speakerName).toBe("Narrator");
  });

  it("includes what neighbours already read as in the target language", () => {
    const context = buildSegmentContext(dialogue(), "seg2", {
      config: window,
      translation: translationFor({ seg1: "Dzwoniłeś do Johna?" }),
    });

    expect(context?.previousSegments[0].existingTranslation).toBe(
      "Dzwoniłeś do Johna?",
    );
    // Nothing is claimed for a neighbour that has no translation yet.
    expect(context?.nextSegments[0].existingTranslation).toBeUndefined();
  });

  it("adds earlier lines by the same speaker for register consistency", () => {
    const context = buildSegmentContext(dialogue(), "seg7", {
      config: { previousSegmentCount: 1, nextSegmentCount: 1, speakerHistoryCount: 2 },
    });

    // seg7 is Alice; seg1, seg3 and seg5 are hers, and seg6 is already in the
    // window, so the two nearest of her earlier lines come along.
    expect(context?.currentSpeakerRecentSegments?.map((s) => s.segmentId)).toEqual([
      "seg3",
      "seg5",
    ]);
  });

  it("adds no speaker history for an unassigned line", () => {
    const withUnassigned = dialogue();
    withUnassigned.segments[3] = {
      ...withUnassigned.segments[3],
      speakerId: null,
    };

    const context = buildSegmentContext(withUnassigned, "seg4", {
      config: { previousSegmentCount: 1, nextSegmentCount: 1, speakerHistoryCount: 2 },
    });

    expect(context?.currentSpeakerRecentSegments).toBeUndefined();
  });

  it("returns null for a segment that is not in this dialogue", () => {
    // Answering with an empty context would hide a caller's bug.
    expect(buildSegmentContext(dialogue(), "not-a-segment")).toBeNull();
  });

  it("trims the farthest lines first when the budget is tight", () => {
    const long = dialogue([
      segment("seg1", 0, "speaker_1", "A".repeat(200)),
      segment("seg2", 1, "speaker_2", "B".repeat(200)),
      segment("seg3", 2, "speaker_1", "C".repeat(200)),
      segment("seg4", 3, "speaker_2", "D".repeat(200)),
      segment("seg5", 4, "speaker_1", "E".repeat(200)),
    ]);

    const context = buildSegmentContext(long, "seg3", {
      config: {
        previousSegmentCount: 2,
        nextSegmentCount: 2,
        speakerHistoryCount: 0,
        maxContextCharacters: 400,
      },
    });

    const ids = contextSegmentIds(context);

    // The immediately adjacent lines survive; the outer ones are dropped.
    expect(ids).toContain("seg2");
    expect(ids).toContain("seg4");
    expect(ids).not.toContain("seg1");
    expect(ids).not.toContain("seg5");
  });

  it("never claims a scene summary it did not produce", () => {
    expect(buildSegmentContext(dialogue(), "seg2")?.sceneSummary).toBeNull();
  });
});

describe("buildBatchContext", () => {
  it("carries only the boundaries around the batch", () => {
    const context = buildBatchContext(dialogue(), ["seg3", "seg4", "seg5"], {
      config: window,
    });

    expect(context?.previousSegments.map((s) => s.segmentId)).toEqual([
      "seg1",
      "seg2",
    ]);
    expect(context?.nextSegments.map((s) => s.segmentId)).toEqual([
      "seg6",
      "seg7",
    ]);
  });

  it("never presents a batch member as its own context", () => {
    const batch = ["seg3", "seg4", "seg5"];
    const ids = contextSegmentIds(
      buildBatchContext(dialogue(), batch, { config: window }),
    );

    for (const id of batch) {
      expect(ids).not.toContain(id);
    }
  });

  it("has no boundary context for a batch covering the whole dialogue", () => {
    const all = dialogue().segments.map((s) => s.id);
    const context = buildBatchContext(dialogue(), all, { config: window });

    expect(contextSegmentIds(context)).toEqual([]);
  });

  it("returns null for an empty batch", () => {
    expect(buildBatchContext(dialogue(), [])).toBeNull();
  });
});

describe("validateContext", () => {
  it("accepts context built from this dialogue", () => {
    const context = buildSegmentContext(dialogue(), "seg2", { config: window });

    expect(validateContext(dialogue(), context)).toEqual({ ok: true });
  });

  it("rejects context naming a line this dialogue does not have", () => {
    // Project isolation, and stale-context detection, in one check.
    const foreign = buildSegmentContext(dialogue(), "seg2", { config: window });
    const other = dialogue([segment("other-1", 0, "speaker_1", "Different.")]);

    expect(validateContext(other, foreign)).toMatchObject({ ok: false });
  });

  it("rejects context whose text no longer matches the dialogue", () => {
    const context = buildSegmentContext(dialogue(), "seg2", { config: window });
    const edited = dialogue();
    edited.segments[0] = {
      ...edited.segments[0],
      originalText: "Did you call Jane?",
    };

    // Silently translating against a line the user has since rewritten is
    // exactly the failure this prevents.
    expect(validateContext(edited, context)).toMatchObject({ ok: false });
  });

  it("accepts an absent context", () => {
    expect(validateContext(dialogue(), null)).toEqual({ ok: true });
  });
});
