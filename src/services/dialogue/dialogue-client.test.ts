import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DialogueRequestError,
  HttpDialogueClient,
  parseDialogue,
} from "@/services/dialogue/dialogue-client";

const wireDialogue = {
  id: "dialogue-1",
  projectId: "project-1",
  sourceMediaId: "media-1",
  transcriptId: "transcript-1",
  diarizationId: "diarization-1",
  version: 1,
  status: "completed",
  segments: [
    {
      id: "t-1",
      speakerId: "speaker_1",
      startTime: 0,
      endTime: 3.5,
      originalText: "Hello and welcome.",
      transcription: {
        transcriptId: "transcript-1",
        transcriptSegmentId: "t-1",
        confidence: null,
        status: "completed",
        providerId: "stt",
        providerModel: "stt-model",
      },
      diarization: {
        diarizationId: "diarization-1",
        regionIds: ["r-1"],
        confidence: null,
        overlap: true,
        candidateSpeakers: [
          { speakerId: "speaker_1", overlapDuration: 3.5, overlapRatio: 1 },
        ],
        providerId: "diarizer",
        providerModel: "diarizer-model",
      },
      assignment: {
        method: "dominant_overlap",
        confidence: 0.8,
        overlapRatio: 1,
        uncertain: true,
        reason: "overlapping_speech",
      },
    },
  ],
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
  mergeMetadata: {
    algorithmVersion: "dialogue-merge-v1",
    transcriptId: "transcript-1",
    diarizationId: "diarization-1",
    generatedAt: "2026-08-27T10:00:00.000Z",
    config: {
      minSpeakerCoverage: 0.5,
      dominantSpeakerRatio: 0.75,
      splitMinimumDuration: 0.2,
      nearestRegionMaxGap: 0.4,
    },
    ambiguousSegmentCount: 1,
    overlappingSegmentCount: 1,
    unassignedSegmentCount: 0,
  },
};

function createClient(handler: (url: string) => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) =>
    handler(String(url)),
  );
  vi.stubGlobal("fetch", fetchImpl);

  return { client: new HttpDialogueClient(), fetchImpl };
}

describe("HttpDialogueClient", () => {
  // The stubbed fetch must never outlive this file.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for one project and one exact source media", async () => {
    const { client, fetchImpl } = createClient(
      () =>
        new Response(
          JSON.stringify({ state: "ready", dialogue: wireDialogue, regenerated: false }),
        ),
    );

    await client.getDialogue("project-1", "media-1");

    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "/api/dialogue?projectId=project-1&mediaId=media-1",
    );
  });

  it("returns a prerequisite state without a dialogue", async () => {
    const { client } = createClient(
      () =>
        new Response(
          JSON.stringify({ state: "diarization_required", dialogue: null }),
        ),
    );

    await expect(client.getDialogue("project-1", "media-1")).resolves.toEqual({
      state: "diarization_required",
      dialogue: null,
      regenerated: false,
    });
  });

  it("parses a dialogue with its assignment and overlap metadata", async () => {
    const { client } = createClient(
      () =>
        new Response(
          JSON.stringify({ state: "ready", dialogue: wireDialogue, regenerated: true }),
        ),
    );

    const response = await client.getDialogue("project-1", "media-1");
    const segment = response.dialogue!.segments[0];

    expect(response.regenerated).toBe(true);
    expect(response.dialogue).toMatchObject({
      transcriptId: "transcript-1",
      diarizationId: "diarization-1",
    });
    expect(segment.speakerId).toBe("speaker_1");
    expect(segment.diarization.overlap).toBe(true);
    expect(segment.assignment).toMatchObject({
      method: "dominant_overlap",
      uncertain: true,
      reason: "overlapping_speech",
    });
    // Times stay numeric seconds across the wire.
    expect(typeof segment.startTime).toBe("number");
    expect(typeof segment.endTime).toBe("number");
  });

  it("keeps a null speaker null rather than inventing one", async () => {
    const unassigned = {
      ...wireDialogue,
      segments: [
        {
          ...wireDialogue.segments[0],
          speakerId: null,
          assignment: {
            method: "unassigned",
            confidence: null,
            overlapRatio: null,
            uncertain: true,
            reason: "ambiguous_speakers",
          },
        },
      ],
    };

    const { client } = createClient(
      () =>
        new Response(JSON.stringify({ state: "ready", dialogue: unassigned })),
    );

    const response = await client.getDialogue("project-1", "media-1");

    expect(response.dialogue!.segments[0].speakerId).toBeNull();
  });

  it("reports a failed request without leaking backend detail", async () => {
    const { client } = createClient(
      () => new Response("boom", { status: 500 }),
    );

    await expect(
      client.getDialogue("project-1", "media-1"),
    ).rejects.toBeInstanceOf(DialogueRequestError);
  });

  it("rejects an unknown state", async () => {
    const { client } = createClient(
      () => new Response(JSON.stringify({ state: "weird", dialogue: null })),
    );

    await expect(
      client.getDialogue("project-1", "media-1"),
    ).rejects.toBeInstanceOf(DialogueRequestError);
  });
});

describe("parseDialogue", () => {
  it("rejects a malformed payload", () => {
    expect(() => parseDialogue(null)).toThrow(DialogueRequestError);
    expect(() => parseDialogue({ ...wireDialogue, status: "weird" })).toThrow(
      DialogueRequestError,
    );
    expect(() =>
      parseDialogue({ ...wireDialogue, segments: [{ id: "x" }] }),
    ).toThrow(DialogueRequestError);
  });
});
