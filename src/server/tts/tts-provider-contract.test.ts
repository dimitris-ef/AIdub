import { describe, expect, it } from "vitest";

import { DEFAULT_TTS_SETTINGS } from "@/types/tts";
import { MockTtsProvider } from "@/server/tts/providers/mock-provider";
import { LocalVitsTtsProvider } from "@/server/tts/providers/local-vits-provider";
import {
  applicableSettings,
  NO_TTS_CAPABILITIES,
  voiceSupportsLanguage,
  type TtsProvider,
} from "@/server/tts/tts-provider";
import { createTtsProviderRegistry } from "@/server/tts/tts-provider-registry";

/**
 * The speech boundary itself.
 *
 * Part 11's central promise is that no provider detail reaches the rest of
 * Aidub, and that swapping providers is a registry change. These tests hold
 * both ends of that: every adapter answers the same questions in the same
 * shapes, and the registry is the only place a provider is chosen.
 */

const PROVIDERS: TtsProvider[] = [
  new MockTtsProvider(),
  new LocalVitsTtsProvider(),
];

describe.each(PROVIDERS.map((provider) => [provider.id, provider] as const))(
  "TtsProvider contract: %s",
  (_id, provider) => {
    it("identifies itself without leaking how it works", () => {
      expect(provider.id).toMatch(/^[a-z0-9-]+$/);
      expect(provider.displayName.length).toBeGreaterThan(0);

      const described = JSON.stringify({
        id: provider.id,
        displayName: provider.displayName,
        capabilities: provider.capabilities,
      });

      // No endpoint, no credential, no model path in anything the app may show.
      expect(described).not.toMatch(/https?:\/\//);
      expect(described).not.toMatch(/key|token|secret/i);
    });

    it("declares every capability explicitly", () => {
      for (const capability of Object.keys(NO_TTS_CAPABILITIES)) {
        expect(typeof provider.capabilities[
          capability as keyof typeof NO_TTS_CAPABILITIES
        ]).toBe("boolean");
      }
    });

    it("answers availability without throwing", async () => {
      expect(typeof (await provider.isAvailable())).toBe("boolean");
    });

    it("returns normalised voices, or none", async () => {
      for (const voice of await provider.listVoices()) {
        expect(voice.providerId).toBe(provider.id);
        expect(voice.id.length).toBeGreaterThan(0);
        expect(voice.name.length).toBeGreaterThan(0);
        expect(voice.languageCodes.length).toBeGreaterThan(0);
        // Aidub never infers a speaker attribute, so an adapter may only pass
        // one on if its provider genuinely publishes it.
        expect(voice.gender === null || typeof voice.gender === "string").toBe(
          true,
        );
      }
    });
  },
);

describe("applicableSettings", () => {
  it("drops settings a provider does not honour", () => {
    const requested = {
      speakingRate: 1.2,
      pitch: 3,
      volumeGain: -2,
      style: "cheerful",
    };

    // Passing an unsupported value on would leave a record claiming a setting
    // that never applied.
    expect(applicableSettings(requested, NO_TTS_CAPABILITIES)).toEqual({
      speakingRate: null,
      pitch: null,
      volumeGain: null,
      style: null,
    });

    expect(
      applicableSettings(requested, {
        ...NO_TTS_CAPABILITIES,
        supportsSpeakingRate: true,
      }),
    ).toEqual({
      speakingRate: 1.2,
      pitch: null,
      volumeGain: null,
      style: null,
    });
  });
});

describe("voiceSupportsLanguage", () => {
  const voice = {
    id: "v",
    providerId: "p",
    name: "Voice",
    languageCodes: ["en-US"],
  };

  it("matches on the primary subtag", () => {
    // Refusing en-US for a project targeting "en" would empty every voice list
    // for no reason a person could act on.
    expect(voiceSupportsLanguage(voice, "en")).toBe(true);
    expect(voiceSupportsLanguage(voice, "en-GB")).toBe(true);
    expect(voiceSupportsLanguage(voice, "EN")).toBe(true);
    expect(voiceSupportsLanguage(voice, "pl")).toBe(false);
  });
});

describe("createTtsProviderRegistry", () => {
  const mock = new MockTtsProvider();
  const registry = createTtsProviderRegistry([mock], mock.id);

  it("resolves the default when none is named", () => {
    expect(registry.get(null).id).toBe(mock.id);
    expect(registry.get("  ").id).toBe(mock.id);
    expect(registry.defaultProviderId()).toBe(mock.id);
  });

  it("fails clearly for a provider this server does not have", () => {
    expect(() => registry.get("nonexistent")).toThrowError(
      expect.objectContaining({ code: "TTS_PROVIDER_UNAVAILABLE" }),
    );
  });

  it("lists providers without exposing an instance", () => {
    expect(registry.list()).toEqual([
      {
        id: mock.id,
        displayName: mock.displayName,
        capabilities: mock.capabilities,
      },
    ]);
  });
});

describe("MockTtsProvider", () => {
  it("is deterministic in the text it is given", async () => {
    const provider = new MockTtsProvider();
    const request = {
      projectId: "p",
      dialogueId: "d",
      dialogueSegmentId: "s",
      translationId: "t",
      translationRevision: 1,
      translatedSegmentRevision: 1,
      speakerId: "speaker_1",
      targetLanguage: "pl",
      text: "Dzień dobry.",
      voice: {
        type: "standard" as const,
        providerId: "mock",
        voiceId: "mock-voice-a",
      },
      settings: { ...DEFAULT_TTS_SETTINGS },
    };

    const first = await provider.synthesize(request);
    const second = await provider.synthesize(request);

    expect(Array.from(first.audio.data)).toEqual(Array.from(second.audio.data));
    // And different voices really do sound different, so a test can tell them
    // apart the way a person would.
    const other = await provider.synthesize({
      ...request,
      voice: { ...request.voice, voiceId: "mock-voice-b" },
    });
    expect(Array.from(other.audio.data)).not.toEqual(
      Array.from(first.audio.data),
    );
  });
});
