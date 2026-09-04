import { describe, expect, it } from "vitest";

import { parseJobParameters } from "@/lib/processing/job-parameters";

/**
 * Job parameters arrive from the browser, and for a translation they decide
 * what the backend will translate and what the result counts as valid for. So
 * nothing is trusted: anything malformed becomes no parameters at all, and the
 * service then refuses the job rather than translating something the request
 * never actually specified.
 */

const valid = {
  kind: "translate",
  operation: "full",
  dialogueId: "dialogue-1",
  dialogueRevision: 3,
  sourceLanguage: "en",
  targetLanguage: "pl",
  segmentId: null,
  expectedTranslationRevision: null,
};

const encode = (value: unknown) => JSON.stringify(value);

describe("parseJobParameters", () => {
  it("accepts a well-formed translate request", () => {
    expect(parseJobParameters(encode(valid))).toEqual(valid);
  });

  it("returns null when absent", () => {
    expect(parseJobParameters(null)).toBeNull();
    expect(parseJobParameters("")).toBeNull();
    expect(parseJobParameters("   ")).toBeNull();
  });

  it("returns null for anything that is not JSON", () => {
    expect(parseJobParameters("{ not json")).toBeNull();
  });

  it("rejects an unknown kind", () => {
    expect(
      parseJobParameters(encode({ ...valid, kind: "synthesize" })),
    ).toBeNull();
  });

  it("rejects a missing or empty dialogue id", () => {
    expect(parseJobParameters(encode({ ...valid, dialogueId: "" }))).toBeNull();
    expect(
      parseJobParameters(encode({ ...valid, dialogueId: undefined })),
    ).toBeNull();
  });

  it("rejects a revision that is not a whole number", () => {
    expect(
      parseJobParameters(encode({ ...valid, dialogueRevision: 1.5 })),
    ).toBeNull();
    expect(
      parseJobParameters(encode({ ...valid, dialogueRevision: "3" })),
    ).toBeNull();
    expect(
      parseJobParameters(encode({ ...valid, dialogueRevision: -1 })),
    ).toBeNull();
  });

  it("accepts revision zero, which a freshly generated dialogue has", () => {
    expect(
      parseJobParameters(encode({ ...valid, dialogueRevision: 0 })),
    ).toEqual({ ...valid, dialogueRevision: 0 });
  });

  it("defaults to a full run when no operation is named", () => {
    // A Part 9 client had no operations to name; its request is a full run.
    expect(
      parseJobParameters(encode({ ...valid, operation: undefined })),
    ).toEqual(valid);
  });

  it("accepts a segment operation that names its line", () => {
    expect(
      parseJobParameters(
        encode({
          ...valid,
          operation: "regenerate_segment",
          segmentId: "d-1",
          expectedTranslationRevision: 4,
        }),
      ),
    ).toEqual({
      ...valid,
      operation: "regenerate_segment",
      segmentId: "d-1",
      expectedTranslationRevision: 4,
    });
  });

  it("rejects a segment operation with no line to act on", () => {
    // The backend must never pick a line for itself.
    expect(
      parseJobParameters(
        encode({ ...valid, operation: "shorten_segment", segmentId: null }),
      ),
    ).toBeNull();
  });

  it("rejects an operation it does not know", () => {
    expect(
      parseJobParameters(encode({ ...valid, operation: "rewrite_everything" })),
    ).toBeNull();
  });

  it("rejects languages Aidub does not know", () => {
    expect(
      parseJobParameters(encode({ ...valid, targetLanguage: "xx" })),
    ).toBeNull();
    expect(
      parseJobParameters(encode({ ...valid, sourceLanguage: "" })),
    ).toBeNull();
  });

  it("keeps only the fields it recognises", () => {
    const parsed = parseJobParameters(
      encode({ ...valid, providerId: "sneaky", apiKey: "secret" }),
    );

    expect(parsed).toEqual(valid);
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });
});

describe("parseJobParameters (generate_speech)", () => {
  const speech = {
    kind: "generate_speech",
    operation: "full_project",
    dialogueId: "dialogue-1",
    translationId: "translation-1",
    translationRevision: 4,
    targetLanguage: "pl",
    dialogueSegmentId: null,
    regenerateAll: false,
  };

  it("accepts a well-formed speech request", () => {
    expect(parseJobParameters(encode(speech))).toEqual(speech);
  });

  it("requires the translation the audio will be bound to", () => {
    for (const broken of [
      { ...speech, translationId: "" },
      { ...speech, translationRevision: "4" },
      { ...speech, translationRevision: -1 },
      { ...speech, dialogueId: "" },
    ]) {
      // Without both the id and the revision, a slow run could file audio of a
      // line that has since been rewritten.
      expect(parseJobParameters(encode(broken))).toBeNull();
    }
  });

  it("refuses a single-segment run that names no line", () => {
    expect(
      parseJobParameters(
        encode({ ...speech, operation: "single_segment", dialogueSegmentId: null }),
      ),
    ).toBeNull();

    expect(
      parseJobParameters(
        encode({
          ...speech,
          operation: "single_segment",
          dialogueSegmentId: "seg-2",
        }),
      ),
    ).toMatchObject({ operation: "single_segment", dialogueSegmentId: "seg-2" });
  });

  it("rejects an operation it does not know", () => {
    expect(parseJobParameters(encode({ ...speech, operation: "everything" }))).toBeNull();
    // Unlike translate, there is no default: a speech run always says its scope.
    expect(
      parseJobParameters(encode({ ...speech, operation: undefined })),
    ).toBeNull();
  });

  it("rejects a language Aidub does not know", () => {
    expect(
      parseJobParameters(encode({ ...speech, targetLanguage: "xx" })),
    ).toBeNull();
  });

  it("keeps only the fields it recognises", () => {
    const parsed = parseJobParameters(
      encode({ ...speech, providerId: "sneaky", apiKey: "secret" }),
    );

    expect(parsed).toEqual(speech);
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });
});
