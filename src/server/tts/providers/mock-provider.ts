import { hashText } from "@/lib/tts/generation-fingerprint";
import { ttsError } from "@/server/tts/tts-errors";
import {
  applicableSettings,
  voiceSupportsLanguage,
  type TtsProvider,
  type TtsProviderCapabilities,
  type TtsProviderContext,
} from "@/server/tts/tts-provider";
import type {
  TtsProviderResult,
  TtsSynthesisRequest,
  TtsVoice,
} from "@/types/tts";

/**
 * A deterministic speech provider for development and tests.
 *
 * It produces real, playable WAV audio — a quiet tone whose length follows the
 * text — so the whole path can be exercised end to end without a model
 * download, a GPU or an API key: generation, artifact storage, duration
 * measurement, over-length warnings, staleness, regeneration.
 *
 * It is **not** speech. Nothing it returns is a rendering of the words, and no
 * result from it should ever be presented as dubbed audio. It exists so the
 * plumbing can be tested honestly, which is the opposite of pretending a
 * provider ran.
 *
 * Registered only when explicitly named by `AIDUB_TTS_PROVIDER`, so it can
 * never become a silent fallback for a misconfigured real provider.
 */

export const MOCK_TTS_PROVIDER_ID = "mock";

const SAMPLE_RATE = 22_050;

/**
 * A pace in the same range as the estimator's, so mock audio lands near the
 * durations Part 10 predicted and over-length warnings are exercised rather
 * than always or never firing.
 */
const CHARACTERS_PER_SECOND = 14;

const MOCK_VOICES: TtsVoice[] = [
  {
    id: "mock-voice-a",
    providerId: MOCK_TTS_PROVIDER_ID,
    name: "Mock voice A",
    // Deliberately broad: the mock must never be the reason a language cannot
    // be exercised.
    languageCodes: ["en", "pl", "es", "fr", "de", "it", "pt", "ja", "zh"],
    gender: null,
    description: "Deterministic test tone. Not speech.",
    previewUrl: null,
  },
  {
    id: "mock-voice-b",
    providerId: MOCK_TTS_PROVIDER_ID,
    name: "Mock voice B",
    languageCodes: ["en", "pl", "es", "fr", "de", "it", "pt", "ja", "zh"],
    gender: null,
    description: "Deterministic test tone at a different pitch. Not speech.",
    previewUrl: null,
  },
];

export class MockTtsProvider implements TtsProvider {
  readonly id = MOCK_TTS_PROVIDER_ID;
  readonly displayName = "Deterministic mock (development)";
  readonly capabilities: TtsProviderCapabilities = {
    reportsDuration: true,
    supportsSpeakingRate: true,
    supportsPitch: false,
    supportsVolumeGain: false,
    supportsStyle: false,
    supportsVoicePreviewUrl: false,
    reportsUsage: true,
  };

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async listVoices(languageCode?: string): Promise<TtsVoice[]> {
    if (!languageCode) {
      return MOCK_VOICES.map((voice) => ({ ...voice }));
    }

    return MOCK_VOICES.filter((voice) =>
      voiceSupportsLanguage(voice, languageCode),
    ).map((voice) => ({ ...voice }));
  }

  async synthesize(
    request: TtsSynthesisRequest,
    context: TtsProviderContext = {},
  ): Promise<TtsProviderResult> {
    if (context.signal?.aborted) {
      throw ttsError("TTS_CANCELLED");
    }

    const voice = MOCK_VOICES.find((entry) => entry.id === request.voice.voiceId);

    if (!voice) {
      throw ttsError("TTS_VOICE_NOT_FOUND", {
        details: `unknown mock voice ${request.voice.voiceId}`,
      });
    }

    const settings = applicableSettings(request.settings, this.capabilities);
    const rate =
      typeof settings.speakingRate === "number" && settings.speakingRate > 0
        ? settings.speakingRate
        : 1;

    // Deterministic in the text, so re-running a line produces byte-identical
    // audio and a test can assert on it.
    const seconds =
      Math.max(0.4, request.text.length / CHARACTERS_PER_SECOND / rate);
    const frequency = voice.id === "mock-voice-b" ? 180 : 120;
    const wav = encodeTone(seconds, frequency);

    context.onProgress?.({ percent: 100, stage: "Speech generated" });

    return {
      audio: {
        data: wav,
        mimeType: "audio/wav",
        sampleRate: SAMPLE_RATE,
        channels: 1,
      },
      durationSeconds: Math.round(seconds * 1000) / 1000,
      provider: {
        id: this.id,
        model: "mock-tone-v1",
        voiceId: voice.id,
        metadata: {
          note: "Deterministic tone, not speech.",
          textDigest: hashText(request.text),
        },
      },
      usage: {
        characters: request.text.length,
        audioSeconds: Math.round(seconds * 1000) / 1000,
        requestCount: 1,
      },
    };
  }
}

/** A quiet sine, encoded as the same 16-bit PCM WAV a real provider returns. */
function encodeTone(seconds: number, frequency: number): Uint8Array {
  const frames = Math.max(1, Math.round(seconds * SAMPLE_RATE));
  const dataBytes = frames * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);

  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let frame = 0; frame < frames; frame += 1) {
    // Quiet on purpose: this gets played by mistake sooner or later.
    const sample = Math.sin((2 * Math.PI * frequency * frame) / SAMPLE_RATE) * 0.15;
    view.setInt16(44 + frame * 2, Math.round(sample * 32767), true);
  }

  return bytes;
}
