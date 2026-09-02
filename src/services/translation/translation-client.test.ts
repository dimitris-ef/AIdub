import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HttpTranslationClient,
  TranslationRequestError,
  parseTranslation,
} from "@/services/translation/translation-client";

/**
 * The client is the only place translation data crosses into the UI, so it is
 * where a malformed payload has to stop. A component must never be handed a
 * translation missing the dialogue segment ids everything downstream joins on.
 */

const translation = {
  id: "translation-1",
  projectId: "project-1",
  sourceMediaId: "media-1",
  dialogueId: "dialogue-1",
  dialogueRevision: 2,
  sourceLanguage: "en",
  targetLanguage: "pl",
  providerId: "mock",
  providerModel: "deterministic-v1",
  version: 1,
  status: "completed",
  segments: [
    {
      id: "ts-1",
      dialogueSegmentId: "d-1",
      speakerId: "speaker_1",
      startTime: 0,
      endTime: 2,
      sourceText: "Hello.",
      translatedText: "Cześć.",
      sourceLanguage: "en",
      targetLanguage: "pl",
      confidence: null,
      translationMetadata: {
        providerId: "mock",
        providerModel: "deterministic-v1",
        generationMode: "initial",
        generatedAt: "2026-08-28T12:00:00.000Z",
        contextSegmentIds: [],
        estimatedDurationSeconds: 0.7,
        sourceDurationSeconds: 2,
        durationRatio: 0.35,
        durationWarning: "none",
        durationEstimatorVersion: "v1",
        confidence: null,
      },
      editMetadata: { manuallyEdited: false, revision: 0, editedAt: null },
    },
  ],
  createdAt: "2026-08-28T12:00:00.000Z",
  updatedAt: "2026-08-28T12:00:00.000Z",
  revision: 0,
  usage: null,
};

function respond(body: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpTranslationClient", () => {
  it("asks for the exact source, dialogue and language pair", async () => {
    const fetchImpl = respond({
      state: "ready",
      translation,
      dialogue: { id: "dialogue-1", revision: 2, segmentCount: 1 },
    });
    vi.stubGlobal("fetch", fetchImpl);

    await new HttpTranslationClient().getTranslation("project-1", "media-1", {
      sourceLanguage: "en",
      targetLanguage: "pl",
    });

    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string];

    expect(url).toContain("projectId=project-1");
    expect(url).toContain("mediaId=media-1");
    expect(url).toContain("sourceLanguage=en");
    expect(url).toContain("targetLanguage=pl");
  });

  it("returns a parsed translation", async () => {
    vi.stubGlobal(
      "fetch",
      respond({
        state: "ready",
        translation,
        dialogue: { id: "dialogue-1", revision: 2, segmentCount: 1 },
      }),
    );

    const response = await new HttpTranslationClient().getTranslation(
      "project-1",
      "media-1",
      { sourceLanguage: "en", targetLanguage: "pl" },
    );

    expect(response.state).toBe("ready");
    expect(response.translation?.segments[0].dialogueSegmentId).toBe("d-1");
    expect(response.dialogue?.revision).toBe(2);
  });

  it("carries a stale reason through", async () => {
    vi.stubGlobal(
      "fetch",
      respond({
        state: "stale",
        translation,
        dialogue: { id: "dialogue-1", revision: 3, segmentCount: 1 },
        staleReason: "dialogue_revision_changed",
      }),
    );

    const response = await new HttpTranslationClient().getTranslation(
      "project-1",
      "media-1",
      { sourceLanguage: "en", targetLanguage: "pl" },
    );

    expect(response.state).toBe("stale");
    expect(response.staleReason).toBe("dialogue_revision_changed");
  });

  it("handles a state with no translation", async () => {
    vi.stubGlobal(
      "fetch",
      respond({ state: "not_translated", translation: null, dialogue: null }),
    );

    const response = await new HttpTranslationClient().getTranslation(
      "project-1",
      "media-1",
      { sourceLanguage: "en", targetLanguage: "pl" },
    );

    expect(response.state).toBe("not_translated");
    expect(response.translation).toBeNull();
  });

  it("reports a failed request rather than an empty translation", async () => {
    vi.stubGlobal("fetch", respond({}, false));

    await expect(
      new HttpTranslationClient().getTranslation("project-1", "media-1", {
        sourceLanguage: "en",
        targetLanguage: "pl",
      }),
    ).rejects.toBeInstanceOf(TranslationRequestError);
  });

  it("rejects an unrecognised state", async () => {
    vi.stubGlobal("fetch", respond({ state: "whatever", translation: null }));

    await expect(
      new HttpTranslationClient().getTranslation("project-1", "media-1", {
        sourceLanguage: "en",
        targetLanguage: "pl",
      }),
    ).rejects.toBeInstanceOf(TranslationRequestError);
  });
});

describe("parseTranslation", () => {
  it("rejects a segment with no dialogue segment id", () => {
    const broken = {
      ...translation,
      segments: [{ ...translation.segments[0], dialogueSegmentId: undefined }],
    };

    expect(() => parseTranslation(broken)).toThrow(TranslationRequestError);
  });

  it("rejects a translation with no dialogue revision", () => {
    const broken = { ...translation, dialogueRevision: undefined };

    expect(() => parseTranslation(broken)).toThrow(TranslationRequestError);
  });

  it("keeps an unassigned speaker as null", () => {
    const parsed = parseTranslation({
      ...translation,
      segments: [{ ...translation.segments[0], speakerId: null }],
    });

    expect(parsed.segments[0].speakerId).toBeNull();
  });
});
