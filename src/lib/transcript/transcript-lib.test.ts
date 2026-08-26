import { describe, expect, it } from "vitest";

import {
  formatTranscriptRange,
  formatTranscriptTimestamp,
} from "@/lib/transcript/format-timestamp";
import { normalizeTranscriptSegments } from "@/lib/transcript/normalize-transcript";

function ids() {
  let counter = 0;
  return () => `segment-${++counter}`;
}

const normalize = (segments: unknown, durationSeconds?: number | null) =>
  normalizeTranscriptSegments(segments, {
    createId: ids(),
    durationSeconds,
  });

describe("formatTranscriptTimestamp", () => {
  it.each([
    [0, "00:00.000"],
    [3.24, "00:03.240"],
    [72.56, "01:12.560"],
    [3734.82, "1:02:14.820"],
  ])("formats %s seconds", (input, expected) => {
    expect(formatTranscriptTimestamp(input)).toBe(expected);
  });

  it("does not crash on unusable values", () => {
    expect(formatTranscriptTimestamp(Number.NaN)).toBe("--:--.---");
    expect(formatTranscriptTimestamp(-1)).toBe("--:--.---");
  });

  it("formats a range", () => {
    expect(formatTranscriptRange(0, 4.82)).toBe("00:00.000 – 00:04.820");
  });
});

describe("normalizeTranscriptSegments", () => {
  it("assigns stable ids and keeps the provider's text", () => {
    const result = normalize([
      { startTime: 0, endTime: 1.5, text: "Hello world.", confidence: 0.95 },
      { startTime: 1.5, endTime: 3.2, text: "This is a test.", confidence: 0.9 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.segments).toMatchObject([
      {
        id: "segment-1",
        startTime: 0,
        endTime: 1.5,
        originalText: "Hello world.",
        status: "completed",
        confidence: 0.95,
      },
      { id: "segment-2", originalText: "This is a test." },
    ]);
    // Ids are not positional: every segment gets its own identity.
    expect(new Set(result.segments.map((s) => s.id)).size).toBe(2);
  });

  it("preserves punctuation and casing, trimming only outer whitespace", () => {
    const result = normalize([
      { startTime: 0, endTime: 1, text: "  Well, THAT was odd!  " },
    ]);

    expect(result.ok && result.segments[0].originalText).toBe(
      "Well, THAT was odd!",
    );
  });

  it("sorts segments into timeline order", () => {
    const result = normalize([
      { startTime: 5, endTime: 6, text: "third" },
      { startTime: 0, endTime: 1, text: "first" },
      { startTime: 2, endTime: 3, text: "second" },
    ]);

    expect(
      result.ok && result.segments.map((segment) => segment.originalText),
    ).toEqual(["first", "second", "third"]);
  });

  it("allows overlapping segments", () => {
    const result = normalize([
      { startTime: 0, endTime: 2.4, text: "one" },
      { startTime: 2.1, endTime: 4, text: "two" },
    ]);

    expect(result.ok && result.segments).toHaveLength(2);
  });

  it("drops blank and whitespace-only segments without moving timestamps", () => {
    const result = normalize([
      { startTime: 0, endTime: 1, text: "kept" },
      { startTime: 1, endTime: 2, text: "   " },
      { startTime: 2, endTime: 3, text: "" },
      { startTime: 6, endTime: 7, text: "also kept" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.discardedEmpty).toBe(2);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[1].startTime).toBe(6);
  });

  it("accepts a valid empty result", () => {
    const result = normalize([]);

    expect(result).toMatchObject({ ok: true, segments: [] });
  });

  it("normalises confidence and flags low-confidence lines", () => {
    const result = normalize([
      { startTime: 0, endTime: 1, text: "sure", confidence: 0.9 },
      { startTime: 1, endTime: 2, text: "unsure", confidence: 0.2 },
    ]);

    expect(result.ok && result.segments.map((s) => s.status)).toEqual([
      "completed",
      "low_confidence",
    ]);
  });

  it("never invents confidence for unusable provider values", () => {
    const result = normalize([
      { startTime: 0, endTime: 1, text: "a", confidence: -3.4 },
      { startTime: 1, endTime: 2, text: "b", confidence: Number.NaN },
      { startTime: 2, endTime: 3, text: "c" },
    ]);

    expect(result.ok && result.segments.map((s) => s.confidence)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("keeps provider metadata but only when there is any", () => {
    const result = normalize([
      { startTime: 0, endTime: 1, text: "a", metadata: { model: "tiny.en" } },
      { startTime: 1, endTime: 2, text: "b", metadata: {} },
    ]);

    expect(result.ok && result.segments[0].providerMetadata).toEqual({
      model: "tiny.en",
    });
    expect(result.ok && result.segments[1].providerMetadata).toBeUndefined();
  });

  it.each([
    ["a negative start", [{ startTime: -2, endTime: 1, text: "x" }]],
    ["end before start", [{ startTime: 4, endTime: 2, text: "x" }]],
    ["a NaN timestamp", [{ startTime: Number.NaN, endTime: 2, text: "x" }]],
    [
      "an infinite timestamp",
      [{ startTime: 0, endTime: Number.POSITIVE_INFINITY, text: "x" }],
    ],
  ])("rejects %s", (_label, segments) => {
    expect(normalize(segments)).toMatchObject({
      ok: false,
      code: "STT_TIMESTAMP_INVALID",
    });
  });

  it.each([
    ["a non-array response", { segments: [] }],
    ["a non-object segment", ["nope"]],
    ["missing text", [{ startTime: 0, endTime: 1 }]],
    ["non-string text", [{ startTime: 0, endTime: 1, text: 42 }]],
  ])("rejects %s as an invalid response", (_label, value) => {
    expect(normalize(value)).toMatchObject({
      ok: false,
      code: "STT_INVALID_RESPONSE",
    });
  });

  it("treats rounding noise before zero as zero", () => {
    const result = normalize([
      { startTime: -0.01, endTime: 1, text: "rounding" },
    ]);

    expect(result.ok && result.segments[0].startTime).toBe(0);
  });

  it("clamps a small overshoot past the media duration", () => {
    const result = normalize(
      [{ startTime: 8, endTime: 10.4, text: "tail" }],
      10,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.segments[0].endTime).toBe(10);
    expect(result.clamped).toBe(1);
  });

  it("rejects timings well beyond the media duration", () => {
    expect(
      normalize([{ startTime: 8, endTime: 45, text: "impossible" }], 10),
    ).toMatchObject({ ok: false, code: "STT_TIMESTAMP_INVALID" });
    expect(
      normalize([{ startTime: 30, endTime: 31, text: "impossible" }], 10),
    ).toMatchObject({ ok: false, code: "STT_TIMESTAMP_INVALID" });
  });
});
