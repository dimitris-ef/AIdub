import { describe, expect, it } from "vitest";

import type {
  GeneratedSpeechSegment,
  SpeakerVoiceAssignment,
} from "@/types/tts";
import { DEFAULT_TTS_SETTINGS } from "@/types/tts";
import {
  assessGeneratedDuration,
  GENERATED_DURATION_THRESHOLDS,
  wavDurationSeconds,
} from "@/lib/tts/generated-duration";
import {
  fingerprintFor,
  generationFingerprint,
  hashText,
} from "@/lib/tts/generation-fingerprint";
import { hasSpeakableText, TTS_SCHEMA_VERSION } from "@/lib/tts/tts-config";
import { generatedSpeechCurrency } from "@/lib/tts/tts-staleness";

/**
 * The pure Part 11 libraries: what makes audio go stale, what counts as
 * speakable, and how a generated line compares with the window it has.
 *
 * These are the pieces the whole part rests on — every one of them decides
 * whether a person is shown audio that matches what their project currently
 * says, or audio that quietly does not.
 */

const ASSIGNMENT: SpeakerVoiceAssignment = {
  id: "assignment-1",
  projectId: "p1",
  sourceMediaId: "m1",
  dialogueId: "d1",
  speakerId: "speaker_1",
  voice: { type: "standard", providerId: "prov", voiceId: "voice-a" },
  targetLanguage: "pl",
  settings: { ...DEFAULT_TTS_SETTINGS },
  createdAt: "2026-08-28T10:00:00.000Z",
  updatedAt: "2026-08-28T10:00:00.000Z",
};

const SEGMENT = {
  dialogueSegmentId: "seg-1",
  speakerId: "speaker_1" as string | null,
  translatedText: "Dzień dobry.",
  editRevision: 3,
};

const TRANSLATION = {
  translationId: "tr-1",
  translationRevision: 2,
  targetLanguage: "pl",
};

function generated(
  overrides: Partial<GeneratedSpeechSegment> = {},
): GeneratedSpeechSegment {
  return {
    id: "gen-1",
    projectId: "p1",
    sourceMediaId: "m1",
    dialogueId: "d1",
    dialogueSegmentId: "seg-1",
    speakerId: "speaker_1",
    translationId: "tr-1",
    translationRevision: 2,
    translatedSegmentRevision: 3,
    targetLanguage: "pl",
    providerId: "prov",
    providerModel: "model-x",
    voiceId: "voice-a",
    artifactId: "artifact-1",
    mimeType: "audio/wav",
    status: "completed",
    durationSeconds: 1.5,
    segmentDurationSeconds: 2,
    generationSettings: { ...DEFAULT_TTS_SETTINGS },
    warnings: [],
    fingerprint: fingerprintFor(SEGMENT, SEGMENT.speakerId, ASSIGNMENT),
    version: TTS_SCHEMA_VERSION,
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
    usage: null,
    ...overrides,
  };
}

describe("hasSpeakableText", () => {
  it("treats letters and digits as speech and nothing else", () => {
    expect(hasSpeakableText("Dzień dobry")).toBe(true);
    expect(hasSpeakableText("42")).toBe(true);
    // Non-Latin scripts are speech too; a Latin-only test would silently
    // refuse to dub most of the world's languages.
    expect(hasSpeakableText("こんにちは")).toBe(true);

    expect(hasSpeakableText("")).toBe(false);
    expect(hasSpeakableText("   ")).toBe(false);
    expect(hasSpeakableText("…")).toBe(false);
    expect(hasSpeakableText("-- ...!?")).toBe(false);
  });
});

describe("generationFingerprint", () => {
  it("changes when anything that would change the audio changes", () => {
    const base = {
      dialogueSegmentId: "seg-1",
      translatedSegmentRevision: 1,
      translatedText: "Dzień dobry.",
      speakerId: "speaker_1",
      targetLanguage: "pl",
      voice: ASSIGNMENT.voice,
      settings: ASSIGNMENT.settings,
    };
    const original = generationFingerprint(base);

    expect(generationFingerprint(base)).toBe(original);

    for (const changed of [
      { ...base, translatedText: "Dobry wieczór." },
      { ...base, translatedSegmentRevision: 2 },
      { ...base, speakerId: "speaker_2" },
      { ...base, targetLanguage: "en" },
      { ...base, voice: { ...base.voice, voiceId: "voice-b" } },
      { ...base, voice: { ...base.voice, providerId: "other" } },
      { ...base, settings: { ...base.settings, speakingRate: 1.2 } },
    ]) {
      expect(generationFingerprint(changed)).not.toBe(original);
    }
  });

  it("distinguishes an unset setting from an explicit one", () => {
    const withNull = generationFingerprint({
      dialogueSegmentId: "s",
      translatedSegmentRevision: 1,
      translatedText: "x",
      speakerId: null,
      targetLanguage: "pl",
      voice: ASSIGNMENT.voice,
      settings: { ...DEFAULT_TTS_SETTINGS },
    });
    const withOne = generationFingerprint({
      dialogueSegmentId: "s",
      translatedSegmentRevision: 1,
      translatedText: "x",
      speakerId: null,
      targetLanguage: "pl",
      voice: ASSIGNMENT.voice,
      settings: { ...DEFAULT_TTS_SETTINGS, speakingRate: 1 },
    });

    // A provider default is a different configuration from an explicit value
    // that happens to match it today.
    expect(withNull).not.toBe(withOne);
  });

  it("does not put dialogue text in the fingerprint", () => {
    const fingerprint = generationFingerprint({
      dialogueSegmentId: "s",
      translatedSegmentRevision: 1,
      translatedText: "A very secret line of dialogue",
      speakerId: null,
      targetLanguage: "pl",
      voice: ASSIGNMENT.voice,
      settings: ASSIGNMENT.settings,
    });

    // Fingerprints are compared and logged; dialogue must end up in neither.
    expect(fingerprint).not.toContain("secret");
    expect(fingerprint).toContain(hashText("A very secret line of dialogue"));
  });
});

describe("generatedSpeechCurrency", () => {
  it("is current when nothing has moved", () => {
    expect(
      generatedSpeechCurrency(generated(), SEGMENT, TRANSLATION, ASSIGNMENT),
    ).toEqual({ current: true });
  });

  it("names why it is stale", () => {
    const cases: [GeneratedSpeechSegment, string][] = [
      [generated({ version: TTS_SCHEMA_VERSION - 1 }), "schema_changed"],
      [generated({ targetLanguage: "en" }), "language_changed"],
      [generated({ translationId: "tr-2" }), "translation_changed"],
      [generated({ speakerId: "speaker_2" }), "speaker_changed"],
      [generated({ status: "failed" }), "generation_failed"],
      [generated({ status: "pending", artifactId: null }), "no_audio"],
      [
        generated({
          translatedSegmentRevision: 2,
          fingerprint: "different",
        }),
        "segment_text_changed",
      ],
      [generated({ voiceId: "voice-b", fingerprint: "different" }), "voice_changed"],
      [
        generated({
          generationSettings: { ...DEFAULT_TTS_SETTINGS, speakingRate: 1.4 },
          fingerprint: "different",
        }),
        "settings_changed",
      ],
    ];

    for (const [record, reason] of cases) {
      expect(
        generatedSpeechCurrency(record, SEGMENT, TRANSLATION, ASSIGNMENT),
      ).toEqual({ current: false, reason });
    }
  });

  it("is stale when the speaker has no voice at all", () => {
    expect(
      generatedSpeechCurrency(generated(), SEGMENT, TRANSLATION, null),
    ).toEqual({ current: false, reason: "voice_changed" });
  });

  it("counts a recorded silence as current for an unspeakable line", () => {
    const silent = { ...SEGMENT, translatedText: "…" };

    expect(
      generatedSpeechCurrency(
        generated({ status: "skipped_empty", artifactId: null }),
        silent,
        TRANSLATION,
        ASSIGNMENT,
      ),
    ).toEqual({ current: true });

    // But audio recorded for a line that is now silent is not.
    expect(
      generatedSpeechCurrency(generated(), silent, TRANSLATION, ASSIGNMENT),
    ).toEqual({ current: false, reason: "segment_text_changed" });
  });
});

describe("assessGeneratedDuration", () => {
  it("warns in two steps as speech overruns its window", () => {
    expect(assessGeneratedDuration(2, 2).warnings).toEqual([]);
    expect(assessGeneratedDuration(2 * 1.1, 2).warnings).toEqual([]);
    expect(
      assessGeneratedDuration(2 * (GENERATED_DURATION_THRESHOLDS.longer + 0.05), 2)
        .warnings,
    ).toEqual(["generated_audio_longer_than_segment"]);
    expect(
      assessGeneratedDuration(
        2 * (GENERATED_DURATION_THRESHOLDS.muchLonger + 0.05),
        2,
      ).warnings,
    ).toEqual(["generated_audio_much_longer_than_segment"]);
  });

  it("reports nothing rather than guessing when a duration is unusable", () => {
    for (const [duration, span] of [
      [null, 2],
      [0, 2],
      [1.5, 0],
      [Number.NaN, 2],
    ] as [number | null, number][]) {
      const assessment = assessGeneratedDuration(duration, span);

      // Absence of information is not a clean bill of health, so it produces
      // no warning either way.
      expect(assessment.ratio).toBeNull();
      expect(assessment.warnings).toEqual([]);
    }
  });

  it("never shortens audio to fit — it only measures", () => {
    const assessment = assessGeneratedDuration(5, 2);

    expect(assessment.durationSeconds).toBe(5);
    expect(assessment.segmentDurationSeconds).toBe(2);
    expect(assessment.ratio).toBe(2.5);
  });
});

describe("wavDurationSeconds", () => {
  it("reads a canonical PCM header", () => {
    expect(wavDurationSeconds(wav(22_050, 22_050))).toBe(1);
    expect(wavDurationSeconds(wav(22_050, 11_025))).toBe(0.5);
  });

  it("walks past chunks a writer inserted before the data", () => {
    expect(wavDurationSeconds(wav(22_050, 22_050, true))).toBe(1);
  });

  it("returns null rather than a number it cannot justify", () => {
    expect(wavDurationSeconds(new Uint8Array(10))).toBeNull();
    expect(wavDurationSeconds(new Uint8Array(200))).toBeNull();
  });
});

/** A minimal 16-bit mono PCM WAV, optionally with a LIST chunk in the way. */
function wav(sampleRate: number, frames: number, extraChunk = false): Uint8Array {
  const listBytes = extraChunk ? 12 : 0;
  const dataBytes = frames * 2;
  const bytes = new Uint8Array(44 + listBytes + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + listBytes + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  let offset = 36;

  if (extraChunk) {
    ascii(offset, "LIST");
    view.setUint32(offset + 4, 4, true);
    offset += 12;
  }

  ascii(offset, "data");
  view.setUint32(offset + 4, dataBytes, true);

  return bytes;
}
