import type {
  TranslationRequest,
  TranslationUsage,
} from "@/types/translation";

/**
 * The translation boundary.
 *
 * Everything above it — the translation service, the processing job, the
 * Translate workspace — speaks only in these terms. Everything below it (model
 * names, prompt text, request field names, authentication headers, vendor
 * response shapes, token accounting, per-provider retries) lives inside one
 * adapter.
 *
 * Deliberately *not* HTTP-shaped. A provider may call a hosted machine
 * translation API, drive an LLM, run a self-hosted model on this machine, or
 * hand the work to an external worker; the abstraction has to survive all four
 * so that adding one never reaches the UI.
 *
 * A provider translates text. It never decides who is speaking, never moves a
 * timestamp, and never changes how many lines there are — those relationships
 * belong to the dialogue and are preserved around the provider, not by it.
 */

export interface TranslationProviderCapabilities {
  /** Whether several lines can be translated in one call. */
  supportsBatchTranslation: boolean;
  /** Whether surrounding lines can be supplied as context. Part 10 uses this. */
  supportsContext: boolean;
  /** Whether a terminology glossary can be supplied. */
  supportsGlossary: boolean;
  /** Whether the provider reports a meaningful per-line confidence. */
  supportsConfidence: boolean;
  /** Whether the provider reports token or character usage. */
  reportsUsage: boolean;
}

export interface TranslationProgress {
  /** 0–100 within the provider's own work, when it can be determined. */
  percent?: number;
  /** Short human-readable stage, e.g. "Translating 14 of 52 lines". */
  stage?: string;
}

export interface TranslationProviderContext {
  signal?: AbortSignal;
  onProgress?: (progress: TranslationProgress) => void;
}

/** One translated line as the adapter normalised it. */
export interface TranslationProviderSegmentResult {
  /** Must be one of the requested segment ids. Validated before persistence. */
  segmentId: string;
  translatedText: string;
  /** Normalised 0–1, or null when the provider reports nothing comparable. */
  confidence: number | null;
  metadata?: Record<string, unknown>;
}

export interface TranslationProviderResult {
  sourceLanguage: string;
  targetLanguage: string;
  segments: TranslationProviderSegmentResult[];
  provider: {
    id: string;
    model: string | null;
    metadata?: Record<string, unknown>;
  };
  /** Null when the provider reports nothing. Never estimated. */
  usage?: TranslationUsage | null;
}

export interface TranslationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: TranslationProviderCapabilities;
  /**
   * Whether this provider can run right now (credentials configured, model
   * present, runtime installed). Checked before a job starts so the user gets
   * one clear message instead of a provider-specific failure mid-run.
   */
  isAvailable(): Promise<boolean>;
  /**
   * Translates one batch. The service decides how the dialogue is divided; a
   * provider is handed a set of lines and must return one result per line,
   * keyed by the segment id it was given. Order is irrelevant — the caller
   * maps by id, never by position.
   */
  translate(
    request: TranslationRequest,
    context?: TranslationProviderContext,
  ): Promise<TranslationProviderResult>;
}

export interface TranslationProviderInfo {
  id: string;
  displayName: string;
  capabilities: TranslationProviderCapabilities;
}
