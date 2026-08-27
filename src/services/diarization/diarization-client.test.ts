import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DiarizationRequestError,
  HttpDiarizationClient,
  parseDiarization,
} from "@/services/diarization/diarization-client";

const wireResult = {
  id: "diar-1",
  projectId: "project-1",
  sourceMediaId: "media-1",
  audioArtifactId: "artifact-1",
  providerId: "local-pyannote",
  providerModel: "pyannote-segmentation-3.0",
  status: "completed",
  speakers: [
    { id: "speaker_1", label: "Speaker 1", confidence: null },
    { id: "speaker_2", label: "Speaker 2", confidence: 0.8 },
  ],
  regions: [
    {
      id: "region-1",
      speakerId: "speaker_1",
      startTime: 0,
      endTime: 3.5,
      confidence: null,
      overlap: false,
    },
    {
      id: "region-2",
      speakerId: "speaker_2",
      startTime: 3.4,
      endTime: 6,
      confidence: null,
      overlap: true,
    },
  ],
  createdAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
};

function createClient(
  handler: (url: string) => Response | Promise<Response>,
) {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) =>
    handler(String(url)),
  );
  vi.stubGlobal("fetch", fetchImpl);

  return { client: new HttpDiarizationClient(), fetchImpl };
}

describe("HttpDiarizationClient", () => {
  // The stubbed fetch must never outlive this file.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for one project and one exact source media", async () => {
    const { client, fetchImpl } = createClient(
      () => new Response(JSON.stringify({ diarization: wireResult })),
    );

    await client.getDiarization("project-1", "media-1");

    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "/api/diarizations?projectId=project-1&mediaId=media-1",
    );
  });

  it("returns null when no result is stored", async () => {
    const { client } = createClient(
      () => new Response(JSON.stringify({ diarization: null })),
    );

    await expect(
      client.getDiarization("project-1", "media-1"),
    ).resolves.toBeNull();
  });

  it("parses a stored result with numeric seconds and stable ids", async () => {
    const { client } = createClient(
      () => new Response(JSON.stringify({ diarization: wireResult })),
    );

    const result = await client.getDiarization("project-1", "media-1");

    expect(result?.speakers.map((speaker) => speaker.id)).toEqual([
      "speaker_1",
      "speaker_2",
    ]);
    expect(result?.regions.map((region) => region.id)).toEqual([
      "region-1",
      "region-2",
    ]);
    expect(
      result?.regions.every(
        (region) =>
          typeof region.startTime === "number" &&
          typeof region.endTime === "number",
      ),
    ).toBe(true);
    // Overlap survives the round trip so Part 7 can see it.
    expect(result?.regions[1].overlap).toBe(true);
  });

  it("reports a failed request without leaking backend detail", async () => {
    const { client } = createClient(
      () => new Response("boom", { status: 500 }),
    );

    await expect(
      client.getDiarization("project-1", "media-1"),
    ).rejects.toBeInstanceOf(DiarizationRequestError);
  });
});

describe("parseDiarization", () => {
  it("rejects a malformed payload", () => {
    expect(() => parseDiarization(null)).toThrow(DiarizationRequestError);
    expect(() => parseDiarization({ ...wireResult, status: "weird" })).toThrow(
      DiarizationRequestError,
    );
    expect(() =>
      parseDiarization({ ...wireResult, regions: [{ id: "r" }] }),
    ).toThrow(DiarizationRequestError);
  });
});
