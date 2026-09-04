import type {
  TtsGenerationSettings,
  TtsProviderResult,
  TtsSynthesisRequest,
  TtsVoice,
} from "@/types/tts";

/**
 * The speech-generation boundary.
 *
 * Everything above it — the generation service, the `generate_speech` job, the
 * Voices workspace — speaks only in these terms. Everything below it (model
 * names, API endpoints, authentication headers, audio container choices, SSML
 * dialects, native model runtimes, per-provider retries) lives inside one
 * adapter.
 *
 * Deliberately *not* HTTP-shaped. A provider may call a hosted synthesis API,
 * run a VITS model on this machine, or hand the work to a GPU worker; the
 * abstraction has to survive all three so that adding one never reaches the UI.
 *
 * A provider speaks one line. It never decides which voice a character has,
 * never merges or splits lines, never moves a timestamp, and never sees the
 * project's dialogue — it is given text, a voice and settings, and returns
 * audio. Everything relational is preserved around the provider, not by it.
 *
 * **No voice cloning here.** Part 11 uses voices a provider already publishes.
 * `VoiceSource` carries a discriminant so Part 12 can add a cloned variant, but
 * nothing in this interface accepts a reference recording or a speaker sample.
 */

export interface TtsProviderCapabilities {
  /** Whether the provider reports how long the audio it returned is. */
  reportsDuration: boolean;
  /** Whether `speakingRate` is honoured rather than ignored. */
  supportsSpeakingRate: boolean;
  /** Whether `pitch` is honoured rather than ignored. */
  supportsPitch: boolean;
  /** Whether `volumeGain` is honoured rather than ignored. */
  supportsVolumeGain: boolean;
  /** Whether a named delivery style can be requested. */
  supportsStyle: boolean;
  /**
   * Whether the provider publishes ready-made voice previews. When false the
   * workspace previews a voice by synthesising a short sample instead.
   */
  supportsVoicePreviewUrl: boolean;
  /** Whether the provider reports character or audio-second usage. */
  reportsUsage: boolean;
}

/**
 * The neutral capability set: honour nothing beyond the text and the voice.
 *
 * A provider spreads this and overrides what it actually supports, so adding a
 * capability later cannot silently claim support in existing adapters.
 */
export const NO_TTS_CAPABILITIES: TtsProviderCapabilities = {
  reportsDuration: false,
  supportsSpeakingRate: false,
  supportsPitch: false,
  supportsVolumeGain: false,
  supportsStyle: false,
  supportsVoicePreviewUrl: false,
  reportsUsage: false,
};

export interface TtsProgress {
  /** 0–100 within the provider's own work, when it can be determined. */
  percent?: number;
  /** Short human-readable stage, e.g. "Synthesising line 4 of 52". */
  stage?: string;
}

export interface TtsProviderContext {
  signal?: AbortSignal;
  onProgress?: (progress: TtsProgress) => void;
}

export interface TtsProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: TtsProviderCapabilities;
  /**
   * Whether this provider can run right now — credentials configured, model
   * files present, native runtime installed. Checked before a job starts so a
   * misconfigured provider produces one clear message rather than the same
   * failure repeated once per line.
   */
  isAvailable(): Promise<boolean>;
  /**
   * The voices this provider can speak with, optionally narrowed to a language.
   *
   * Some providers publish a voice-list API; others (a local model directory,
   * for instance) have no such endpoint and answer from a configured static
   * catalog. Which of the two it is stays inside the adapter.
   */
  listVoices(languageCode?: string): Promise<TtsVoice[]>;
  /**
   * Synthesises exactly one line.
   *
   * One line per call rather than a batch: a failure then costs one line rather
   * than a run, cancellation lands between lines, and progress is real. Batching
   * is an optimisation a future provider can do internally if its API rewards
   * it — the service does not depend on it.
   */
  synthesize(
    request: TtsSynthesisRequest,
    context?: TtsProviderContext,
  ): Promise<TtsProviderResult>;
}

export interface TtsProviderDescriptor {
  id: string;
  displayName: string;
  capabilities: TtsProviderCapabilities;
}

/**
 * Drops settings the provider does not honour.
 *
 * Passing an unsupported value on would either be ignored — leaving a record
 * claiming a rate that never applied — or rejected by a vendor as an unknown
 * field. Adapters call this so what they send is what they support.
 */
export function applicableSettings(
  settings: TtsGenerationSettings,
  capabilities: TtsProviderCapabilities,
): TtsGenerationSettings {
  return {
    speakingRate: capabilities.supportsSpeakingRate
      ? (settings.speakingRate ?? null)
      : null,
    pitch: capabilities.supportsPitch ? (settings.pitch ?? null) : null,
    volumeGain: capabilities.supportsVolumeGain
      ? (settings.volumeGain ?? null)
      : null,
    style: capabilities.supportsStyle ? (settings.style ?? null) : null,
  };
}

/**
 * Whether a voice claims a language.
 *
 * Compared on the primary subtag: a voice published as `en-US` legitimately
 * speaks a project whose target language is `en`, and refusing that would make
 * every voice list look empty for no reason a person could act on.
 */
export function voiceSupportsLanguage(
  voice: TtsVoice,
  languageCode: string,
): boolean {
  const wanted = primarySubtag(languageCode);

  if (wanted.length === 0) {
    return true;
  }

  return voice.languageCodes.some((code) => primarySubtag(code) === wanted);
}

function primarySubtag(languageCode: string): string {
  return languageCode.trim().toLowerCase().split(/[-_]/)[0] ?? "";
}
