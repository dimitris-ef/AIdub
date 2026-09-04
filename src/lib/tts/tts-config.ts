/**
 * Speech-generation tuning, in one place.
 *
 * Two settings that would otherwise be scattered: how many lines a full run
 * generates before it is considered pathological, and how long one provider
 * call may take. Both exist because synthesis is slow and paid for, and both
 * differ between a hosted API and a model running on this machine.
 */

export interface TtsConfig {
  /**
   * Per-line synthesis timeout.
   *
   * Applies to one line, not to a whole project: a hundred-line dialogue
   * legitimately takes many minutes, and a ceiling sized for the whole run
   * would either be uselessly large or would kill healthy long jobs.
   */
  requestTimeoutMs: number;
}

export const DEFAULT_TTS_CONFIG: TtsConfig = {
  requestTimeoutMs: 2 * 60 * 1000,
};

/**
 * Persisted shape versions.
 *
 * Separate numbers because the two records change for different reasons: Part
 * 12 will extend the voice source on assignments without touching generated
 * audio, and a change to what a generated record stores does not invalidate
 * anyone's voice picks.
 */
export const TTS_SCHEMA_VERSION = 1;
export const VOICE_ASSIGNMENT_SCHEMA_VERSION = 1;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

export function resolveTtsConfig(overrides: Partial<TtsConfig> = {}): TtsConfig {
  return {
    requestTimeoutMs: positiveInteger(
      process.env.AIDUB_TTS_TIMEOUT_MS,
      DEFAULT_TTS_CONFIG.requestTimeoutMs,
    ),
    ...overrides,
  };
}

/**
 * Whether a translated line has anything to say.
 *
 * Punctuation and whitespace alone are not speech: sending them to a provider
 * costs a call and returns either silence or an invented reading. Such a line
 * is recorded as intentionally silent instead — the structure stays 1:1 and no
 * silence file is generated for it.
 */
export function hasSpeakableText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}
