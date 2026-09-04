import { describe, expect, it } from "vitest";

import type { TtsSynthesisRequest } from "@/types/tts";
import { DEFAULT_TTS_SETTINGS } from "@/types/tts";
import { wavDurationSeconds } from "@/lib/tts/generated-duration";
import { LocalVitsTtsProvider } from "@/server/tts/providers/local-vits-provider";

/**
 * The real local speech provider, against the real model.
 *
 * This is the only Part 11 test that actually synthesises speech with a model
 * rather than a double, so it is the only one that can prove the provider
 * contract is satisfiable by something real: that a request in Aidub's terms
 * comes back as playable audio of a length the app can measure, and that
 * cancelling one stops it.
 *
 * It skips when the native runtime or the model files are missing — they are a
 * 250 MB optional download (`npm run setup:tts`), and Aidub is meant to build
 * and run without them. A skip is reported as a skip: it is never treated as a
 * pass, and nothing elsewhere claims a provider ran when this did not.
 */

const provider = new LocalVitsTtsProvider();
const installed = await provider.isAvailable();

function request(
  overrides: Partial<TtsSynthesisRequest> = {},
): TtsSynthesisRequest {
  return {
    projectId: "project-a",
    dialogueId: "dialogue-a",
    dialogueSegmentId: "seg-1",
    translationId: "tr-1",
    translationRevision: 1,
    translatedSegmentRevision: 1,
    speakerId: "speaker_1",
    targetLanguage: "en",
    text: "Hello there. This line is being spoken by a real local model.",
    voice: {
      type: "standard",
      providerId: "local-vits",
      voiceId: "vits-piper-en_US-libritts_r-medium:79",
    },
    settings: { ...DEFAULT_TTS_SETTINGS },
    ...overrides,
  };
}

describe.skipIf(!installed)("LocalVitsTtsProvider (integration)", () => {
  it("synthesises playable audio whose reported length is the real one", async () => {
    const result = await provider.synthesize(request());

    expect(result.audio.mimeType).toBe("audio/wav");
    expect(result.audio.data.byteLength).toBeGreaterThan(1000);
    expect(result.audio.sampleRate).toBeGreaterThan(0);

    // The provider claims a duration; the file itself has to agree with it.
    // A number that does not match the bytes would make every over-length
    // warning in Part 11 meaningless.
    expect(wavDurationSeconds(result.audio.data)).toBeCloseTo(
      result.durationSeconds as number,
      2,
    );
    expect(result.durationSeconds).toBeGreaterThan(1);
  }, 120_000);

  it("reports no usage rather than inventing a figure", async () => {
    const result = await provider.synthesize(request({ text: "Short line." }));

    // Nothing is metered locally, so nothing honest can be reported.
    expect(result.usage).toBeNull();
    expect(result.provider.id).toBe("local-vits");
  }, 120_000);

  it("offers voices for the languages whose models are installed", async () => {
    const english = await provider.listVoices("en");

    expect(english.length).toBeGreaterThan(0);
    for (const voice of english) {
      // Aidub never publishes an inferred attribute of a voice.
      expect(voice.gender).toBeNull();
    }

    // A language with no installed model is an empty list, not an error.
    expect(await provider.listVoices("xh")).toEqual([]);
  });

  it("refuses a voice that does not speak the requested language", async () => {
    await expect(
      provider.synthesize(request({ targetLanguage: "pl" })),
    ).rejects.toMatchObject({ code: "TTS_UNSUPPORTED_LANGUAGE" });
  });

  it("refuses a voice it does not have", async () => {
    await expect(
      provider.synthesize(
        request({
          voice: {
            type: "standard",
            providerId: "local-vits",
            voiceId: "no-such-voice",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "TTS_VOICE_NOT_FOUND" });
  });

  it("cancels without waiting for the model", async () => {
    const controller = new AbortController();
    const promise = provider.synthesize(request(), {
      signal: controller.signal,
    });

    controller.abort();

    // The native call cannot be interrupted, so cancellation detaches the
    // worker rather than killing it — the caller is freed immediately and the
    // abandoned result is never read.
    await expect(promise).rejects.toMatchObject({ code: "TTS_CANCELLED" });
  }, 60_000);
});

describe.skipIf(installed)("LocalVitsTtsProvider (integration, skipped)", () => {
  it("reports itself unavailable without the runtime or models", async () => {
    // The honest outcome when the optional download is absent: the provider
    // says so, and the workspace tells the user rather than failing per line.
    expect(await provider.isAvailable()).toBe(false);
    expect(await provider.listVoices("en")).toEqual([]);
  });
});
