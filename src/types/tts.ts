/**
 * Text-to-speech domain model.
 *
 * Part 11 turns the reviewed translation into spoken audio. Three identities
 * meet here and are deliberately kept apart:
 *
 * - **`DialogueSpeaker.id`** — who is talking, decided by Parts 6–8. Stable,
 *   anonymous, and never a claim about a real person.
 * - **`TtsVoice.id`** — a voice a provider can speak with. Vendor-specific,
 *   and freely changeable.
 * - **`SpeakerVoiceAssignment`** — the link between them, which is the only
 *   thing that says "this character is spoken by that voice".
 *
 * Conflating the first two would mean a voice change looked like a speaker
 * change, and a speaker rename looked like a different voice. They are separate
 * records precisely so neither can happen.
 *
 * Generated audio is **derived**: it can always be produced again from the
 * translation and the assignment, so every generated record names exactly what
 * produced it — see `generationFingerprint` and `@/lib/tts/tts-staleness`.
 * Nothing here changes dialogue timing; a generated duration is metadata for a
 * later part to align with, not a licence to move a timestamp.
 */

/** A voice a provider can speak with. Provider-specific id, normalised shape. */
export interface TtsVoice {
  id: string;
  providerId: string;
  name: string;
  /** Language codes this voice can speak, as Aidub language codes. */
  languageCodes: string[];
  /**
   * A descriptor the provider itself publishes, when it does. Aidub never
   * infers one — see the note on `SpeakerVoiceAssignment`.
   */
  gender?: string | null;
  description?: string | null;
  previewUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TtsProviderInfo {
  id: string;
  displayName: string;
}

/**
 * Synthesis settings, normalised across providers.
 *
 * Deliberately minimal. Part 11 is about getting a first, honest pass of dubbed
 * speech; voice design is not in scope, and every value here is null by default
 * so a provider's own defaults are what actually run.
 */
export interface TtsGenerationSettings {
  /** Multiplier around 1.0, where the provider supports one. */
  speakingRate?: number | null;
  pitch?: number | null;
  volumeGain?: number | null;
  style?: string | null;
}

export const DEFAULT_TTS_SETTINGS: TtsGenerationSettings = {
  speakingRate: null,
  pitch: null,
  volumeGain: null,
  style: null,
};

/**
 * Where a voice comes from.
 *
 * A discriminated union with one member today. Part 12 adds cloned voices, and
 * having the discriminant here already means that arrives as a new variant
 * rather than a rewrite of every stored assignment.
 */
export type VoiceSource = {
  type: "standard";
  providerId: string;
  voiceId: string;
};

/**
 * Which voice speaks for one dialogue speaker.
 *
 * Keyed by the **stable** `speakerId`, so renaming a speaker in the Transcript
 * editor changes nothing here, and reassigning a line to another speaker
 * changes which voice speaks it without anyone re-picking anything.
 *
 * Aidub never chooses a voice from any inferred attribute of a speaker — not
 * from the audio, the name, the diarization or the transcript. A voice is
 * whatever a person picked.
 */
export interface SpeakerVoiceAssignment {
  id: string;
  projectId: string;
  sourceMediaId: string;
  dialogueId: string;
  /** Canonical Part 6/8 speaker id. */
  speakerId: string;
  voice: VoiceSource;
  targetLanguage: string;
  settings: TtsGenerationSettings;
  createdAt: string;
  updatedAt: string;
}

export const GENERATED_SPEECH_STATUSES = [
  "pending",
  "generating",
  "completed",
  "failed",
  /** Intentionally silent: the translated line has no text to speak. */
  "skipped_empty",
] as const;

export type GeneratedSpeechStatus =
  (typeof GENERATED_SPEECH_STATUSES)[number];

/**
 * Something worth telling a person about a generated line.
 *
 * Warnings never trigger an automatic fix. Part 11 reports that speech overruns
 * its slot; changing anything about the timing is a later part's decision.
 */
export const TTS_GENERATION_WARNINGS = [
  "generated_audio_longer_than_segment",
  "generated_audio_much_longer_than_segment",
  "provider_warning",
] as const;

export type TtsGenerationWarning = (typeof TTS_GENERATION_WARNINGS)[number];

export interface TtsUsage {
  characters?: number;
  inputTokens?: number;
  audioSeconds?: number;
  requestCount?: number;
  providerMetadata?: Record<string, unknown>;
}

/**
 * One generated line of dubbed speech.
 *
 * The audio bytes are **not** here: they live in the shared artifact storage
 * behind `artifactId`. This record owns identity, provenance and configuration;
 * the storage layer owns the file. Embedding audio in the metadata record would
 * make every read of the workspace pull megabytes of base64.
 *
 * The identity fields exist so `isGeneratedSpeechCurrent` can decide whether
 * this audio still describes what the project currently says: the translated
 * text and its revision, the speaker, the voice, the language, and the
 * settings — all folded into `fingerprint`.
 */
export interface GeneratedSpeechSegment {
  id: string;
  projectId: string;
  sourceMediaId: string;
  dialogueId: string;
  dialogueSegmentId: string;
  /** The speaker as the dialogue had them when this was generated. */
  speakerId: string | null;
  translationId: string;
  /** Whole-translation revision at generation time. */
  translationRevision: number;
  /** That line's own edit revision — so one edit stales one line, not all. */
  translatedSegmentRevision: number;
  targetLanguage: string;
  providerId: string;
  providerModel: string | null;
  voiceId: string;
  /** Artifact holding the audio bytes; null when nothing was generated. */
  artifactId: string | null;
  mimeType: string | null;
  status: GeneratedSpeechStatus;
  /** Measured or provider-reported. Never fabricated. */
  durationSeconds: number | null;
  /** The dialogue slot this line has, for comparison. Never changed here. */
  segmentDurationSeconds: number;
  generationSettings: TtsGenerationSettings;
  warnings: TtsGenerationWarning[];
  /** Everything that would change the audio, hashed — see the fingerprint. */
  fingerprint: string;
  /** Persisted schema version. */
  version: number;
  createdAt: string;
  updatedAt: string;
  providerMetadata?: Record<string, unknown>;
  usage?: TtsUsage | null;
}

/** One line handed to a provider. Never a vendor request shape. */
export interface TtsSynthesisRequest {
  projectId: string;
  dialogueId: string;
  dialogueSegmentId: string;
  translationId: string;
  translationRevision: number;
  translatedSegmentRevision: number;
  speakerId: string;
  targetLanguage: string;
  text: string;
  voice: VoiceSource;
  settings: TtsGenerationSettings;
}

export interface TtsProviderResult {
  audio: {
    data: Uint8Array;
    mimeType: string;
    sampleRate?: number | null;
    channels?: number | null;
  };
  /** Reported by the provider where it can; null otherwise. */
  durationSeconds: number | null;
  provider: {
    id: string;
    model: string | null;
    voiceId: string;
    metadata?: Record<string, unknown>;
  };
  usage?: TtsUsage | null;
}

export function isGeneratedSpeechStatus(
  value: unknown,
): value is GeneratedSpeechStatus {
  return (
    typeof value === "string" &&
    (GENERATED_SPEECH_STATUSES as readonly string[]).includes(value)
  );
}

export function isTtsGenerationWarning(
  value: unknown,
): value is TtsGenerationWarning {
  return (
    typeof value === "string" &&
    (TTS_GENERATION_WARNINGS as readonly string[]).includes(value)
  );
}

/** A voice's own identity, for comparison and display. */
export function voiceKey(voice: VoiceSource): string {
  return `${voice.type}:${voice.providerId}:${voice.voiceId}`;
}
