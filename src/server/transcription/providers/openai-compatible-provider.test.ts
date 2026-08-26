import { describe, expect, it, vi } from "vitest";

import { OpenAiCompatibleSpeechToTextProvider } from "@/server/transcription/providers/openai-compatible-provider";
import type { SpeechToTextInput } from "@/server/transcription/speech-to-text-provider";

const input: SpeechToTextInput = {
  projectId: "project-1",
  sourceMediaId: "media-1",
  audioArtifactId: "artifact-1",
  audio: {
    bytes: new Uint8Array([1, 2, 3, 4]),
    mimeType: "audio/wav",
    durationSeconds: 11,
  },
  language: "en",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function createProvider(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
    handler(String(url), init),
  );

  const provider = new OpenAiCompatibleSpeechToTextProvider({
    apiKey: "test-key",
    baseUrl: "https://stt.example/v1",
    model: "whisper-1",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });

  return { provider, fetchImpl };
}

const VERBOSE_JSON = {
  language: "english",
  text: "Hello world. This is a test.",
  segments: [
    {
      id: 0,
      start: 0,
      end: 1.5,
      text: " Hello world.",
      avg_logprob: -0.21,
      no_speech_prob: 0.01,
    },
    {
      id: 1,
      start: 1.5,
      end: 3.2,
      text: " This is a test.",
      avg_logprob: -0.35,
    },
  ],
};

describe("OpenAiCompatibleSpeechToTextProvider", () => {
  it("is unavailable without an API key", async () => {
    const provider = new OpenAiCompatibleSpeechToTextProvider({
      apiKey: undefined,
    });

    await expect(provider.isAvailable()).resolves.toBe(false);
  });

  it("posts multipart audio with the model and language hint", async () => {
    const { provider, fetchImpl } = createProvider(() =>
      jsonResponse(VERBOSE_JSON),
    );

    await provider.transcribe(input);

    const [url, init] = fetchImpl.mock.calls[0];
    const body = init?.body as FormData;

    expect(String(url)).toBe("https://stt.example/v1/audio/transcriptions");
    expect(init?.method).toBe("POST");
    expect(body.get("model")).toBe("whisper-1");
    expect(body.get("response_format")).toBe("verbose_json");
    expect(body.get("language")).toBe("en");
    expect(body.get("file")).toBeInstanceOf(File);
  });

  it("sends credentials only in the Authorization header", async () => {
    const { provider, fetchImpl } = createProvider(() =>
      jsonResponse(VERBOSE_JSON),
    );

    const result = await provider.transcribe(input);
    const headers = fetchImpl.mock.calls[0][1]?.headers as Record<
      string,
      string
    >;

    expect(headers.Authorization).toBe("Bearer test-key");
    // The key never reaches normalised output or metadata.
    expect(JSON.stringify(result)).not.toContain("test-key");
  });

  it("normalises the vendor response into Aidub segments", async () => {
    const { provider } = createProvider(() => jsonResponse(VERBOSE_JSON));

    const result = await provider.transcribe(input);

    expect(result.language).toBe("english");
    expect(result.provider).toEqual({
      id: "openai-compatible",
      model: "whisper-1",
    });
    expect(result.segments).toEqual([
      {
        startTime: 0,
        endTime: 1.5,
        text: " Hello world.",
        confidence: null,
        metadata: {
          model: "whisper-1",
          averageLogProbability: -0.21,
          noSpeechProbability: 0.01,
        },
      },
      {
        startTime: 1.5,
        endTime: 3.2,
        text: " This is a test.",
        confidence: null,
        metadata: { model: "whisper-1", averageLogProbability: -0.35 },
      },
    ]);
  });

  it("accepts a response that reports no speech", async () => {
    const { provider } = createProvider(() =>
      jsonResponse({ language: "english", text: "" }),
    );

    await expect(provider.transcribe(input)).resolves.toMatchObject({
      segments: [],
    });
  });

  it.each([
    [401, "STT_AUTHENTICATION_FAILED"],
    [403, "STT_AUTHENTICATION_FAILED"],
    [415, "STT_UNSUPPORTED_AUDIO"],
    [504, "STT_TIMEOUT"],
    [500, "STT_REQUEST_FAILED"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const { provider } = createProvider(() =>
      jsonResponse({ error: "nope" }, status),
    );

    await expect(provider.transcribe(input)).rejects.toMatchObject({ code });
  });

  it("maps a network failure to a request failure", async () => {
    const { provider } = createProvider(() => {
      throw new Error("ECONNREFUSED");
    });

    await expect(provider.transcribe(input)).rejects.toMatchObject({
      code: "STT_REQUEST_FAILED",
    });
  });

  it("rejects a response that is not JSON", async () => {
    const { provider } = createProvider(
      () => new Response("<html>", { status: 200 }),
    );

    await expect(provider.transcribe(input)).rejects.toMatchObject({
      code: "STT_INVALID_RESPONSE",
    });
  });

  it("rejects a response with text but no segments", async () => {
    const { provider } = createProvider(() =>
      jsonResponse({ text: "spoken words", language: "english" }),
    );

    await expect(provider.transcribe(input)).rejects.toMatchObject({
      code: "STT_INVALID_RESPONSE",
    });
  });

  it("reports cancellation rather than a request failure", async () => {
    const controller = new AbortController();
    const { provider } = createProvider(() => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });

    await expect(
      provider.transcribe(input, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "TRANSCRIPTION_CANCELLED" });
  });
});
