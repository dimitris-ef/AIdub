import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HttpTranscriptClient,
  TranscriptRequestError,
  parseTranscript,
} from "@/services/transcription/transcript-client";

const transcript = {
  id: "transcript-1",
  projectId: "project-1",
  sourceMediaId: "media-1",
  audioArtifactId: "artifact-1",
  providerId: "local-whisper",
  providerModel: "whisper-tiny.en",
  language: "en",
  status: "completed",
  segments: [
    {
      id: "segment-1",
      startTime: 0,
      endTime: 1.5,
      originalText: "Hello world.",
      status: "completed",
      confidence: null,
    },
  ],
  createdAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function mockFetch(handler: (url: string) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("parseTranscript", () => {
  it("accepts a well-formed transcript", () => {
    expect(parseTranscript(transcript)).toMatchObject({
      id: "transcript-1",
      segments: [{ id: "segment-1", originalText: "Hello world." }],
    });
  });

  it.each([
    ["null", null],
    ["a missing id", { ...transcript, id: undefined }],
    ["an unknown status", { ...transcript, status: "weird" }],
    ["segments that are not an array", { ...transcript, segments: null }],
    [
      "a segment with a broken timestamp",
      {
        ...transcript,
        segments: [{ ...transcript.segments[0], startTime: "0" }],
      },
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => parseTranscript(value)).toThrowError(TranscriptRequestError);
  });
});

describe("HttpTranscriptClient", () => {
  const client = new HttpTranscriptClient();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scopes the lookup to a project and source media", async () => {
    const spy = mockFetch(() => jsonResponse({ transcript }));

    const result = await client.getTranscript("project-1", "media-1");

    expect(spy.mock.calls[0][0]).toBe(
      "/api/transcripts?projectId=project-1&mediaId=media-1",
    );
    expect(result?.segments).toHaveLength(1);
  });

  it("returns null when no transcript exists", async () => {
    mockFetch(() => jsonResponse({ transcript: null }));

    await expect(
      client.getTranscript("project-1", "media-1"),
    ).resolves.toBeNull();
  });

  it("reports a failed request without leaking internals", async () => {
    mockFetch(() => jsonResponse({ error: { code: "INTERNAL_ERROR" } }, 500));

    await expect(
      client.getTranscript("project-1", "media-1"),
    ).rejects.toMatchObject({
      message: "The transcript could not be loaded.",
    });
  });
});
