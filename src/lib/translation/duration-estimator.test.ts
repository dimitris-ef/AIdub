import { describe, expect, it } from "vitest";

import {
  DURATION_ESTIMATOR_VERSION,
  charactersPerSecondFor,
  estimateSegmentDuration,
  estimateSpeechDuration,
  segmentDurationSeconds,
} from "@/lib/translation/duration-estimator";
import {
  DURATION_RATIO_THRESHOLDS,
  assessTranslationDuration,
  durationWarningForRatio,
} from "@/lib/translation/duration-warning";

/**
 * The estimator is a rough signal, and these tests pin the properties that make
 * it usable rather than pretending it is accurate: it is deterministic, it
 * scales with the amount of text, it differs by language, and it never invents
 * a comparison it cannot make.
 */

describe("estimateSpeechDuration", () => {
  it("is deterministic", () => {
    const text = "Thanks for coming in today, I appreciate it.";

    expect(estimateSpeechDuration(text, "en")).toBe(
      estimateSpeechDuration(text, "en"),
    );
  });

  it("treats empty text as taking no time", () => {
    expect(estimateSpeechDuration("", "en")).toBe(0);
    expect(estimateSpeechDuration("   \n\t ", "en")).toBe(0);
  });

  it("grows with the amount of text", () => {
    const short = estimateSpeechDuration("Yes.", "en");
    const long = estimateSpeechDuration(
      "Yes, and I think we should talk about that in more detail tomorrow.",
      "en",
    );

    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
  });

  it("adds a beat for sentence punctuation", () => {
    const flowing = estimateSpeechDuration("one two three four", "en");
    const punctuated = estimateSpeechDuration("one. two. three. four.", "en");

    expect(punctuated).toBeGreaterThan(flowing);
  });

  it("adds a shorter beat for clause punctuation than for sentences", () => {
    const clauses = estimateSpeechDuration("one, two, three, four", "en");
    const sentences = estimateSpeechDuration("one. two. three. four", "en");

    expect(clauses).toBeGreaterThan(estimateSpeechDuration("one two three four", "en"));
    expect(sentences).toBeGreaterThan(clauses);
  });

  it("does not count whitespace as spoken", () => {
    expect(estimateSpeechDuration("hello world", "en")).toBe(
      estimateSpeechDuration("hello    world", "en"),
    );
  });

  it("differs by language, because speaking rates do", () => {
    const text = "これはテストです";

    // The same characters take much longer in a logographic script.
    expect(estimateSpeechDuration(text, "ja")).toBeGreaterThan(
      estimateSpeechDuration(text, "en"),
    );
  });

  it("falls back to a mid-range rate for an unknown language", () => {
    expect(charactersPerSecondFor("xx")).toBe(charactersPerSecondFor("en"));
  });
});

describe("estimateSegmentDuration", () => {
  it("reports the ratio against the slot the line has", () => {
    const estimate = estimateSegmentDuration("Hello there.", "en", 4);

    expect(estimate.estimatorVersion).toBe(DURATION_ESTIMATOR_VERSION);
    expect(estimate.sourceDurationSeconds).toBe(4);
    expect(estimate.ratio).toBeCloseTo(estimate.estimatedSeconds / 4, 3);
  });

  it("has no ratio when there is nothing to compare against", () => {
    // A broken segment: inventing Infinity here would produce a warning nobody
    // could act on.
    expect(estimateSegmentDuration("Hello.", "en", 0).ratio).toBeNull();
    expect(estimateSegmentDuration("Hello.", "en", -2).ratio).toBeNull();
    expect(estimateSegmentDuration("Hello.", "en", Number.NaN).ratio).toBeNull();
  });
});

describe("segmentDurationSeconds", () => {
  it("is the slot a dialogue segment gives a line", () => {
    expect(segmentDurationSeconds({ startTime: 1.5, endTime: 4 })).toBe(2.5);
  });

  it("is zero for an impossible span rather than negative", () => {
    expect(segmentDurationSeconds({ startTime: 4, endTime: 1 })).toBe(0);
  });
});

describe("durationWarningForRatio", () => {
  it("does not warn about a line that fits", () => {
    expect(durationWarningForRatio(0.8)).toBe("none");
    expect(durationWarningForRatio(1)).toBe("none");
    expect(durationWarningForRatio(DURATION_RATIO_THRESHOLDS.slightlyLong)).toBe(
      "none",
    );
  });

  it("flags a line slightly over its slot", () => {
    expect(durationWarningForRatio(1.2)).toBe("slightly_long");
    expect(durationWarningForRatio(DURATION_RATIO_THRESHOLDS.likelyTooLong)).toBe(
      "slightly_long",
    );
  });

  it("flags a line well over its slot", () => {
    expect(durationWarningForRatio(1.4)).toBe("likely_too_long");
    expect(durationWarningForRatio(3)).toBe("likely_too_long");
  });

  it("says nothing when there is no ratio", () => {
    expect(durationWarningForRatio(null)).toBe("none");
    expect(durationWarningForRatio(Number.NaN)).toBe("none");
  });
});

describe("assessTranslationDuration", () => {
  /**
   * The worked examples from the specification, expressed as ratios so they do
   * not depend on the exact characters-per-second figure.
   */
  it.each([
    [3.6, 4, "none"],
    [4.8, 4, "slightly_long"],
    [6.2, 4, "likely_too_long"],
  ])(
    "an estimate of %ss against %ss is %s",
    (estimated, available, expected) => {
      expect(durationWarningForRatio(estimated / available)).toBe(expected);
    },
  );

  it("assesses real text end to end", () => {
    const assessment = assessTranslationDuration("Cześć.", "pl", 4);

    expect(assessment.warning).toBe("none");
    expect(assessment.estimatedSeconds).toBeGreaterThan(0);
    expect(assessment.ratio).toBeLessThan(1);
  });

  it("flags a line far too long for its slot", () => {
    const assessment = assessTranslationDuration(
      "This is a very much longer sentence than the original could possibly have been, going on well past the point where it would still fit.",
      "en",
      2,
    );

    expect(assessment.warning).toBe("likely_too_long");
  });

  it("does not warn about an empty line", () => {
    const assessment = assessTranslationDuration("", "pl", 4);

    expect(assessment.estimatedSeconds).toBe(0);
    expect(assessment.warning).toBe("none");
  });
});
