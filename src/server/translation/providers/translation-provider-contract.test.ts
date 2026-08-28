import { describe, expect, it, vi } from "vitest";

import type { TranslationRequest } from "@/types/translation";
import { TranslationError } from "@/server/translation/translation-errors";
import type { TranslationProvider } from "@/server/translation/translation-provider";
import { MockTranslationProvider } from "@/server/translation/providers/mock-provider";
import { OpenAiCompatibleTranslationProvider } from "@/server/translation/providers/openai-compatible-provider";

/**
 * One contract, every provider.
 *
 * The whole point of the provider abstraction is that Aidub can pair any
 * translation backend with the rest of the pipeline. That only holds if every
 * adapter behaves identically at the boundary, so the same suite runs against
 * each one — the deterministic test double and the real OpenAI-compatible
 * adapter driven by a stubbed transport.
 */

function request(overrides: Partial<TranslationRequest> = {}): TranslationRequest {
  return {
    projectId: "project-1",
    sourceMediaId: "media-1",
    dialogueId: "dialogue-1",
    dialogueRevision: 0,
    sourceLanguage: "en",
    targetLanguage: "pl",
    segments: [
      {
        segmentId: "d-1",
        speakerId: "speaker_1",
        startTime: 0,
        endTime: 2,
        sourceText: "Hello.",
      },
      {
        segmentId: "d-2",
        speakerId: "speaker_2",
        startTime: 2,
        endTime: 4,
        sourceText: "How are you?",
      },
    ],
    ...overrides,
  };
}

/** A chat-completions response echoing the ids it was given. */
function chatResponse(
  segments: { segmentId: string; translatedText: string }[],
  extra: Record<string, unknown> = {},
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: "req-1",
      model: "gpt-4o-mini",
      choices: [{ message: { content: JSON.stringify({ segments }) } }],
      usage: { prompt_tokens: 40, completion_tokens: 12 },
      ...extra,
    }),
  } as unknown as Response;
}

function openAiProvider(fetchImpl: typeof fetch) {
  return new OpenAiCompatibleTranslationProvider({
    apiKey: "test-key",
    baseUrl: "https://example.invalid/v1",
    model: "gpt-4o-mini",
    fetchImpl,
    delay: async () => {},
  });
}

const cases: {
  name: string;
  create: () => TranslationProvider;
}[] = [
  { name: "MockTranslationProvider", create: () => new MockTranslationProvider() },
  {
    name: "OpenAiCompatibleTranslationProvider",
    create: () =>
      openAiProvider(
        vi.fn(async () =>
          chatResponse([
            { segmentId: "d-1", translatedText: "Cześć." },
            { segmentId: "d-2", translatedText: "Jak się masz?" },
          ]),
        ) as unknown as typeof fetch,
      ),
  },
];

describe.each(cases)("$name satisfies the provider contract", ({ create }) => {
  it("has a stable id and a display name", () => {
    const provider = create();

    expect(provider.id).toMatch(/\S/);
    expect(provider.displayName).toMatch(/\S/);
    expect(create().id).toBe(provider.id);
  });

  it("declares its capabilities", () => {
    const { capabilities } = create();

    expect(typeof capabilities.supportsBatchTranslation).toBe("boolean");
    expect(typeof capabilities.supportsContext).toBe("boolean");
    expect(typeof capabilities.supportsGlossary).toBe("boolean");
    expect(typeof capabilities.supportsConfidence).toBe("boolean");
    expect(typeof capabilities.reportsUsage).toBe("boolean");
  });

  it("returns exactly the requested segment ids", async () => {
    const result = await create().translate(request());

    expect(result.segments.map((s) => s.segmentId).sort()).toEqual([
      "d-1",
      "d-2",
    ]);
  });

  it("returns text for every line", async () => {
    const result = await create().translate(request());

    for (const segment of result.segments) {
      expect(typeof segment.translatedText).toBe("string");
      expect(segment.translatedText.trim().length).toBeGreaterThan(0);
    }
  });

  it("reports the language pair it was asked for", async () => {
    const result = await create().translate(request());

    expect(result.sourceLanguage).toBe("en");
    expect(result.targetLanguage).toBe("pl");
  });

  it("identifies itself and its model", async () => {
    const provider = create();
    const result = await provider.translate(request());

    expect(result.provider.id).toBe(provider.id);
    expect(
      result.provider.model === null || typeof result.provider.model === "string",
    ).toBe(true);
  });

  it("never fabricates a confidence", async () => {
    const provider = create();
    const result = await provider.translate(request());

    if (!provider.capabilities.supportsConfidence) {
      for (const segment of result.segments) {
        expect(segment.confidence).toBeNull();
      }
    }
  });

  it("does not mutate the request it was given", async () => {
    const input = request();
    const before = JSON.stringify(input);

    await create().translate(input);

    expect(JSON.stringify(input)).toBe(before);
  });

  it("refuses to run once its signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      create().translate(request(), { signal: controller.signal }),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe("MockTranslationProvider", () => {
  it("is deterministic", async () => {
    const first = await new MockTranslationProvider().translate(request());
    const second = await new MockTranslationProvider().translate(request());

    expect(first.segments).toEqual(second.segments);
  });

  it("preserves ids while deliberately answering out of order", async () => {
    const result = await new MockTranslationProvider().translate(request());

    // Reversed on purpose: nothing downstream may depend on provider order.
    expect(result.segments.map((s) => s.segmentId)).toEqual(["d-2", "d-1"]);
  });

  it("marks its output so it can never be mistaken for a translation", async () => {
    const result = await new MockTranslationProvider().translate(request());

    expect(result.segments.find((s) => s.segmentId === "d-1")?.translatedText).toBe(
      "[pl] Hello.",
    );
  });

  it("reports usage it actually measured", async () => {
    const result = await new MockTranslationProvider().translate(request());

    expect(result.usage?.inputCharacters).toBe("Hello.".length + "How are you?".length);
    expect(result.usage?.requestCount).toBe(1);
  });
});

describe("OpenAiCompatibleTranslationProvider", () => {
  it("is unavailable without a key, rather than failing mid-run", async () => {
    const provider = new OpenAiCompatibleTranslationProvider({
      apiKey: undefined,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    expect(await provider.isAvailable()).toBe(false);
    await expect(provider.translate(request())).rejects.toMatchObject({
      code: "TRANSLATION_PROVIDER_UNAVAILABLE",
    });
  });

  it("sends the segment ids and the language pair to the model", async () => {
    const fetchImpl = vi.fn(async () =>
      chatResponse([
        { segmentId: "d-1", translatedText: "Cześć." },
        { segmentId: "d-2", translatedText: "Jak się masz?" },
      ]),
    ) as unknown as typeof fetch;

    await openAiProvider(fetchImpl).translate(request());

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      messages: { role: string; content: string }[];
      response_format: { type: string };
      temperature: number;
    };
    const prompt = body.messages[1].content;

    expect(url).toBe("https://example.invalid/v1/chat/completions");
    expect(body.response_format.type).toBe("json_object");
    expect(body.temperature).toBe(0);
    expect(prompt).toContain("d-1");
    expect(prompt).toContain("d-2");
    expect(prompt).toContain("Polish");
    expect(prompt).toContain("English");
  });

  it("never puts the credential anywhere but the Authorization header", async () => {
    const fetchImpl = vi.fn(async () =>
      chatResponse([
        { segmentId: "d-1", translatedText: "Cześć." },
        { segmentId: "d-2", translatedText: "Jak się masz?" },
      ]),
    ) as unknown as typeof fetch;

    const result = await openAiProvider(fetchImpl).translate(request());
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];

    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key",
    );
    expect(init.body as string).not.toContain("test-key");
    expect(JSON.stringify(result)).not.toContain("test-key");
  });

  it("normalises usage from the provider", async () => {
    const result = await openAiProvider(
      vi.fn(async () =>
        chatResponse([
          { segmentId: "d-1", translatedText: "Cześć." },
          { segmentId: "d-2", translatedText: "Jak się masz?" },
        ]),
      ) as unknown as typeof fetch,
    ).translate(request());

    expect(result.usage).toEqual({
      inputTokens: 40,
      outputTokens: 12,
      requestCount: 1,
    });
  });

  it("reports no usage when the provider reports none", async () => {
    const response = {
      ok: true,
      status: 200,
      json: async () => ({
        model: "m",
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: [
                  { segmentId: "d-1", translatedText: "A" },
                  { segmentId: "d-2", translatedText: "B" },
                ],
              }),
            },
          },
        ],
      }),
    } as unknown as Response;

    const result = await openAiProvider(
      vi.fn(async () => response) as unknown as typeof fetch,
    ).translate(request());

    expect(result.usage).toBeNull();
  });

  it.each([
    [401, "TRANSLATION_AUTHENTICATION_FAILED"],
    [403, "TRANSLATION_AUTHENTICATION_FAILED"],
    [429, "TRANSLATION_RATE_LIMITED"],
    [504, "TRANSLATION_TIMEOUT"],
    [500, "TRANSLATION_REQUEST_FAILED"],
  ])("maps HTTP %i onto %s", async (status, code) => {
    const fetchImpl = vi.fn(
      async () => ({ ok: false, status }) as unknown as Response,
    ) as unknown as typeof fetch;

    await expect(
      openAiProvider(fetchImpl).translate(request()),
    ).rejects.toMatchObject({ code });
  });

  it("retries a rate limit once, then gives up", async () => {
    const fetchImpl = vi.fn(
      async () => ({ ok: false, status: 429 }) as unknown as Response,
    ) as unknown as typeof fetch;

    await expect(
      openAiProvider(fetchImpl).translate(request()),
    ).rejects.toMatchObject({ code: "TRANSLATION_RATE_LIMITED" });

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(
      2,
    );
  });

  it("does not retry a rejected credential", async () => {
    const fetchImpl = vi.fn(
      async () => ({ ok: false, status: 401 }) as unknown as Response,
    ) as unknown as typeof fetch;

    await expect(
      openAiProvider(fetchImpl).translate(request()),
    ).rejects.toMatchObject({ code: "TRANSLATION_AUTHENTICATION_FAILED" });

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(
      1,
    );
  });

  it("recovers when a transient failure clears on the retry", async () => {
    let attempt = 0;
    const fetchImpl = vi.fn(async () => {
      attempt += 1;

      return attempt === 1
        ? ({ ok: false, status: 429 } as unknown as Response)
        : chatResponse([
            { segmentId: "d-1", translatedText: "Cześć." },
            { segmentId: "d-2", translatedText: "Jak się masz?" },
          ]);
    }) as unknown as typeof fetch;

    const result = await openAiProvider(fetchImpl).translate(request());

    expect(result.segments).toHaveLength(2);
  });

  it("rejects a response that is not JSON", async () => {
    const response = {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "Here you go: Cześć." } }],
      }),
    } as unknown as Response;

    await expect(
      openAiProvider(
        vi.fn(async () => response) as unknown as typeof fetch,
      ).translate(request()),
    ).rejects.toMatchObject({ code: "TRANSLATION_INVALID_RESPONSE" });
  });

  it("rejects a response with no segments array", async () => {
    const response = {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ result: "ok" }) } }],
      }),
    } as unknown as Response;

    await expect(
      openAiProvider(
        vi.fn(async () => response) as unknown as typeof fetch,
      ).translate(request()),
    ).rejects.toMatchObject({ code: "TRANSLATION_INVALID_RESPONSE" });
  });

  it("maps a transport failure onto a normalised error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;

    const failure = await openAiProvider(fetchImpl)
      .translate(request())
      .catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(TranslationError);
    expect((failure as TranslationError).code).toBe(
      "TRANSLATION_REQUEST_FAILED",
    );
  });
});
