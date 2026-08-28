import { describe, expect, it } from "vitest";

import type { DiarizationResult } from "@/types/diarization";
import type { Transcript } from "@/types/transcript";
import type { UnifiedDialogue } from "@/types/dialogue";
import {
  dialogueCurrency,
  isDialogueCurrent,
} from "@/lib/dialogue/dialogue-staleness";
import {
  DEFAULT_MERGE_CONFIG,
  DIALOGUE_SCHEMA_VERSION,
  MERGE_ALGORITHM_VERSION,
} from "@/lib/dialogue/merge-config";

const transcript = {
  id: "transcript-a",
  projectId: "project-a",
  sourceMediaId: "media-a",
} as Transcript;

const diarization = {
  id: "diarization-a",
  projectId: "project-a",
  sourceMediaId: "media-a",
} as DiarizationResult;

function dialogue(overrides: Partial<UnifiedDialogue> = {}): UnifiedDialogue {
  return {
    id: "dialogue-a",
    projectId: "project-a",
    sourceMediaId: "media-a",
    transcriptId: "transcript-a",
    diarizationId: "diarization-a",
    version: DIALOGUE_SCHEMA_VERSION,
    status: "completed",
    segments: [],
    speakers: [],
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z",
    mergeMetadata: {
      algorithmVersion: MERGE_ALGORITHM_VERSION,
      transcriptId: "transcript-a",
      diarizationId: "diarization-a",
      generatedAt: "2026-08-27T10:00:00.000Z",
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

describe("dialogue staleness", () => {
  it("treats a dialogue built from the current inputs as current", () => {
    expect(isDialogueCurrent(dialogue(), transcript, diarization)).toBe(true);
  });

  it.each([
    [
      "the transcript was replaced",
      { transcriptId: "transcript-b" },
      "transcript_changed",
    ],
    [
      "the diarization was replaced",
      { diarizationId: "diarization-b" },
      "diarization_changed",
    ],
    [
      "the source media was replaced",
      { sourceMediaId: "media-b" },
      "source_mismatch",
    ],
    ["it belongs to another project", { projectId: "project-b" }, "project_mismatch"],
    ["the storage schema moved on", { version: 0 }, "schema_changed"],
  ])("marks it stale when %s", (_label, overrides, reason) => {
    const currency = dialogueCurrency(
      dialogue(overrides),
      transcript,
      diarization,
    );

    expect(currency.current).toBe(false);
    expect(currency.current === false && currency.reason).toBe(reason);
  });

  it("marks it stale when the merge algorithm moved on", () => {
    const stale = dialogue();
    stale.mergeMetadata.algorithmVersion = "dialogue-merge-v0";

    const currency = dialogueCurrency(stale, transcript, diarization);

    expect(currency.current).toBe(false);
    expect(currency.current === false && currency.reason).toBe(
      "algorithm_changed",
    );
  });
});
