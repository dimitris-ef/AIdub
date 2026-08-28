/**
 * Translation tuning, in one place.
 *
 * Batch size in particular must not be scattered: it exists because providers
 * have token, payload and rate limits, and the right value differs between a
 * hosted LLM and a self-hosted NMT model. One setting, read here, keeps that a
 * configuration decision rather than a rule baked into a component.
 */

export interface TranslationConfig {
  /**
   * How many dialogue lines go into one provider call.
   *
   * Chosen at 20: large enough that a normal scene costs a handful of requests
   * rather than one per line, small enough to stay well inside context and
   * payload limits and to give progress something to move on. Providers that
   * cannot batch are driven one line at a time regardless — see
   * `TranslationProviderCapabilities.supportsBatchTranslation`.
   */
  batchSize: number;
  /**
   * Per-request timeout. It applies to one provider call, not to the whole
   * project: a long dialogue legitimately takes many minutes, and a ceiling
   * sized for the whole job would either be uselessly large or would kill
   * healthy long translations.
   */
  requestTimeoutMs: number;
}

export const DEFAULT_TRANSLATION_CONFIG: TranslationConfig = {
  batchSize: 20,
  requestTimeoutMs: 2 * 60 * 1000,
};

/**
 * Persisted shape version for stored translations.
 *
 * v1 — Part 9: one translated line per dialogue line, no edits, no alternates.
 *
 * Later parts will add context-aware translation, alternate takes, approved
 * text, a timing-fitted variant and translation edit history. Those arrive as
 * v2 written alongside this and migrated on read — never by discarding Part 9
 * data, which is expensive to reproduce because it costs provider credits.
 */
export const TRANSLATION_SCHEMA_VERSION = 1;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

export function resolveTranslationConfig(
  overrides: Partial<TranslationConfig> = {},
): TranslationConfig {
  return {
    batchSize: positiveInteger(
      process.env.AIDUB_TRANSLATION_BATCH_SIZE,
      DEFAULT_TRANSLATION_CONFIG.batchSize,
    ),
    requestTimeoutMs: positiveInteger(
      process.env.AIDUB_TRANSLATION_TIMEOUT_MS,
      DEFAULT_TRANSLATION_CONFIG.requestTimeoutMs,
    ),
    ...overrides,
  };
}

/** Splits lines into provider-sized batches, preserving order. */
export function batchSegments<T>(
  segments: readonly T[],
  batchSize: number,
): T[][] {
  const size = Math.max(1, Math.floor(batchSize));
  const batches: T[][] = [];

  for (let index = 0; index < segments.length; index += size) {
    batches.push(segments.slice(index, index + size));
  }

  return batches;
}
