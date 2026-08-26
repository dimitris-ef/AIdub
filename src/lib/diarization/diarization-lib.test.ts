import { describe, expect, it } from "vitest";

import {
  assignSpeakerIds,
  isCanonicalSpeakerId,
  speakerIdForIndex,
  speakerLabelForIndex,
} from "@/lib/diarization/speaker-ids";
import { normalizeDiarizationRegions } from "@/lib/diarization/normalize-diarization";
import { formatTimeRange, formatTimecode } from "@/lib/timecode";
import { speakerSpeechSeconds } from "@/types/diarization";

/** Deterministic ids keep expectations readable. */
function sequentialIds() {
  let next = 0;
  return () => `region-${++next}`;
}

function normalize(
  regions: unknown,
  options: Parameters<typeof normalizeDiarizationRegions>[1] = {},
) {
  return normalizeDiarizationRegions(regions, {
    createId: sequentialIds(),
    ...options,
  });
}

function expectOk(result: ReturnType<typeof normalizeDiarizationRegions>) {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.code}: ${result.details}`);
  }

  return result;
}

describe("speaker ids", () => {
  it("uses 1-based canonical ids and labels", () => {
    expect(speakerIdForIndex(0)).toBe("speaker_1");
    expect(speakerIdForIndex(2)).toBe("speaker_3");
    expect(speakerLabelForIndex(0)).toBe("Speaker 1");
  });

  it("recognises canonical ids and rejects provider labels", () => {
    expect(isCanonicalSpeakerId("speaker_1")).toBe(true);
    expect(isCanonicalSpeakerId("speaker_12")).toBe(true);
    expect(isCanonicalSpeakerId("SPEAKER_00")).toBe(false);
    expect(isCanonicalSpeakerId("speaker_0")).toBe(false);
    expect(isCanonicalSpeakerId("A")).toBe(false);
    expect(isCanonicalSpeakerId(null)).toBe(false);
  });

  it("assigns ids in first-appearance order, not label order", () => {
    const assigned = assignSpeakerIds(["SPEAKER_05", "SPEAKER_02", "SPEAKER_05"]);

    expect([...assigned]).toEqual([
      ["SPEAKER_05", "speaker_1"],
      ["SPEAKER_02", "speaker_2"],
    ]);
  });
});

describe("normalizeDiarizationRegions", () => {
  it("normalises provider labels by first appearance on the timeline", () => {
    const result = expectOk(
      normalize([
        { speakerLabel: "A", startTime: 4, endTime: 8, confidence: 0.9 },
        { speakerLabel: "B", startTime: 0, endTime: 4, confidence: 0.8 },
        { speakerLabel: "B", startTime: 8, endTime: 10, confidence: 0.85 },
      ]),
    );

    // B speaks first, so B — not the alphabetically first label — is speaker_1.
    expect(result.regions.map((region) => region.speakerId)).toEqual([
      "speaker_1",
      "speaker_2",
      "speaker_1",
    ]);
    expect(result.speakers.map((speaker) => speaker.id)).toEqual([
      "speaker_1",
      "speaker_2",
    ]);
    expect(result.speakers[0].providerMetadata).toMatchObject({
      rawSpeakerLabel: "B",
    });
  });

  it("normalises SPEAKER_NN style labels the same way", () => {
    const result = expectOk(
      normalize([
        { speakerLabel: "SPEAKER_05", startTime: 0, endTime: 2 },
        { speakerLabel: "SPEAKER_02", startTime: 2, endTime: 4 },
      ]),
    );

    expect(result.regions.map((r) => r.speakerId)).toEqual([
      "speaker_1",
      "speaker_2",
    ]);
    // Raw labels never become Aidub identities.
    expect(JSON.stringify(result.regions)).not.toContain("SPEAKER_05");
  });

  it("gives every region a stable id and references a known speaker", () => {
    const result = expectOk(
      normalize([
        { speakerLabel: "A", startTime: 0, endTime: 1 },
        { speakerLabel: "A", startTime: 1, endTime: 2 },
      ]),
    );

    const ids = result.regions.map((region) => region.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);

    const speakerIds = new Set(result.speakers.map((speaker) => speaker.id));
    expect(
      result.regions.every((region) => speakerIds.has(region.speakerId)),
    ).toBe(true);
  });

  it("sorts regions into timeline order regardless of provider ordering", () => {
    const result = expectOk(
      normalize([
        { speakerLabel: "A", startTime: 9, endTime: 10 },
        { speakerLabel: "B", startTime: 1, endTime: 2 },
        { speakerLabel: "A", startTime: 4, endTime: 6 },
      ]),
    );

    expect(result.regions.map((region) => region.startTime)).toEqual([1, 4, 9]);
  });

  it("keeps overlapping speech instead of forcing regions apart", () => {
    const result = expectOk(
      normalize([
        { speakerLabel: "A", startTime: 0, endTime: 4 },
        { speakerLabel: "B", startTime: 3, endTime: 5 },
      ]),
    );

    expect(result.regions).toHaveLength(2);
    expect(result.regions.map((r) => [r.startTime, r.endTime])).toEqual([
      [0, 4],
      [3, 5],
    ]);
    // Overlap is derived from the timeline itself, so both sides are marked.
    expect(result.regions.every((region) => region.overlap)).toBe(true);
  });

  it("does not mark consecutive turns by the same speaker as overlap", () => {
    const result = expectOk(
      normalize([
        { speakerLabel: "A", startTime: 0, endTime: 4 },
        { speakerLabel: "A", startTime: 3, endTime: 6 },
      ]),
    );

    expect(result.regions.every((region) => region.overlap === false)).toBe(
      true,
    );
  });

  it("honours overlap a provider reports explicitly", () => {
    const result = expectOk(
      normalize([
        { speakerLabel: "A", startTime: 0, endTime: 2, overlap: true },
        { speakerLabel: "B", startTime: 5, endTime: 6 },
      ]),
    );

    expect(result.regions[0].overlap).toBe(true);
    expect(result.regions[1].overlap).toBe(false);
  });

  it("leaves silence as a gap rather than inventing a speaker", () => {
    const result = expectOk(
      normalize([
        { speakerLabel: "A", startTime: 0, endTime: 2 },
        { speakerLabel: "B", startTime: 5, endTime: 7 },
      ]),
    );

    expect(result.regions).toHaveLength(2);
    expect(result.speakers).toHaveLength(2);
    expect(
      result.regions.some((region) => region.startTime === 2 && region.endTime === 5),
    ).toBe(false);
  });

  it("keeps short but valid regions", () => {
    const result = expectOk(
      normalize([{ speakerLabel: "A", startTime: 2.05, endTime: 2.21 }]),
    );

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].startTime).toBeCloseTo(2.05);
    expect(result.regions[0].endTime).toBeCloseTo(2.21);
  });

  it("accepts a valid empty result", () => {
    const result = expectOk(normalize([]));

    expect(result.regions).toEqual([]);
    expect(result.speakers).toEqual([]);
  });

  it.each([
    [1, ["A"]],
    [2, ["A", "B"]],
    [4, ["A", "B", "C", "D"]],
  ])("supports %i speakers", (expected, labels) => {
    const result = expectOk(
      normalize(
        labels.map((speakerLabel, index) => ({
          speakerLabel,
          startTime: index,
          endTime: index + 1,
        })),
      ),
    );

    expect(result.speakers).toHaveLength(expected);
  });

  it("collapses exact duplicate regions only", () => {
    const result = expectOk(
      normalize([
        { speakerLabel: "A", startTime: 0, endTime: 2 },
        { speakerLabel: "A", startTime: 0, endTime: 2 },
        { speakerLabel: "A", startTime: 0, endTime: 2.5 },
      ]),
    );

    expect(result.duplicatesRemoved).toBe(1);
    expect(result.regions).toHaveLength(2);
  });

  it("keeps only a confidence already on a 0–1 scale", () => {
    const result = expectOk(
      normalize([
        { speakerLabel: "A", startTime: 0, endTime: 1, confidence: 0.42 },
        { speakerLabel: "A", startTime: 1, endTime: 2, confidence: 12 },
        { speakerLabel: "A", startTime: 2, endTime: 3, confidence: Number.NaN },
        { speakerLabel: "A", startTime: 3, endTime: 4 },
      ]),
    );

    expect(result.regions.map((region) => region.confidence)).toEqual([
      0.42,
      null,
      null,
      null,
    ]);
  });

  it("keeps per-speaker detail a provider reports without inventing any", () => {
    const result = expectOk(
      normalize(
        [{ speakerLabel: "X", startTime: 0, endTime: 1 }],
        { speakers: [{ speakerLabel: "X", confidence: 0.7, metadata: { turns: 3 } }] },
      ),
    );

    expect(result.speakers[0]).toMatchObject({
      id: "speaker_1",
      label: "Speaker 1",
      confidence: 0.7,
      providerMetadata: { rawSpeakerLabel: "X", turns: 3 },
    });
  });

  it("reports no speaker confidence when the provider reports none", () => {
    const result = expectOk(
      normalize([{ speakerLabel: "X", startTime: 0, endTime: 1 }]),
    );

    expect(result.speakers[0].confidence).toBeNull();
  });

  it("clamps a small overshoot past the audio duration", () => {
    const result = expectOk(
      normalize([{ speakerLabel: "A", startTime: 0, endTime: 10.4 }], {
        durationSeconds: 10,
      }),
    );

    expect(result.regions[0].endTime).toBe(10);
    expect(result.clamped).toBe(1);
  });

  it.each([
    ["not an array", "nope", "DIARIZATION_INVALID_RESPONSE"],
    ["a non-object region", [null], "DIARIZATION_INVALID_RESPONSE"],
    [
      "a missing speaker label",
      [{ startTime: 0, endTime: 1 }],
      "DIARIZATION_INVALID_RESPONSE",
    ],
    [
      "an empty speaker label",
      [{ speakerLabel: "", startTime: 0, endTime: 1 }],
      "DIARIZATION_INVALID_RESPONSE",
    ],
    [
      "a NaN timestamp",
      [{ speakerLabel: "A", startTime: Number.NaN, endTime: 1 }],
      "DIARIZATION_TIMESTAMP_INVALID",
    ],
    [
      "an infinite timestamp",
      [{ speakerLabel: "A", startTime: 0, endTime: Number.POSITIVE_INFINITY }],
      "DIARIZATION_TIMESTAMP_INVALID",
    ],
    [
      "a negative start time",
      [{ speakerLabel: "A", startTime: -5, endTime: 1 }],
      "DIARIZATION_TIMESTAMP_INVALID",
    ],
    [
      "an end before its start",
      [{ speakerLabel: "A", startTime: 5, endTime: 1 }],
      "DIARIZATION_TIMESTAMP_INVALID",
    ],
  ])("rejects %s", (_label, regions, code) => {
    const result = normalize(regions);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe(code);
  });

  it("rejects timestamps well beyond the known audio duration", () => {
    const result = normalize([{ speakerLabel: "A", startTime: 0, endTime: 900 }], {
      durationSeconds: 10,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe(
      "DIARIZATION_TIMESTAMP_INVALID",
    );
  });

  it("clamps rounding-noise negative starts rather than failing", () => {
    const result = expectOk(
      normalize([{ speakerLabel: "A", startTime: -0.01, endTime: 1 }]),
    );

    expect(result.regions[0].startTime).toBe(0);
  });
});

describe("speakerSpeechSeconds", () => {
  it("totals only the requested speaker's regions", () => {
    const regions = expectOk(
      normalize([
        { speakerLabel: "A", startTime: 0, endTime: 2 },
        { speakerLabel: "B", startTime: 2, endTime: 6 },
        { speakerLabel: "A", startTime: 6, endTime: 6.5 },
      ]),
    ).regions;

    expect(speakerSpeechSeconds(regions, "speaker_1")).toBeCloseTo(2.5);
    expect(speakerSpeechSeconds(regions, "speaker_2")).toBeCloseTo(4);
    expect(speakerSpeechSeconds(regions, "speaker_9")).toBe(0);
  });
});

describe("timecode", () => {
  it("formats seconds identically for transcripts and speaker regions", () => {
    expect(formatTimecode(3.24)).toBe("00:03.240");
    expect(formatTimecode(3734.82)).toBe("1:02:14.820");
    expect(formatTimecode(-1)).toBe("--:--.---");
    expect(formatTimeRange(0, 4.82)).toBe("00:00.000 – 00:04.820");
  });
});
