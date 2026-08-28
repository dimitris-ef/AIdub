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
  dialogueId: "dialogue-1",
  dialogueRevision: 3,
  sourceLanguage: "en",
  targetLanguage: "pl",
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
