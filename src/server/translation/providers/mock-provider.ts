import type { TranslationRequest } from "@/types/translation";
import { translationError } from "@/server/translation/translation-errors";
import type {
  TranslationProvider,
  TranslationProviderCapabilities,
  TranslationProviderContext,
  TranslationProviderResult,
} from "@/server/translation/translation-provider";

/**
 * A deterministic translation provider for tests and local development.
 *
 * It performs no translation: every line comes back as `[<target>] <source>`,
 * which is stable, obviously not real output, and enough to exercise the whole
 * job → validation → persistence → workspace path without a network call or a
 * credential.
 *
 * It is **never a silent default**. The registry only offers it when
 * `AIDUB_TRANSLATION_PROVIDER` explicitly names it, so a misconfigured
 * production deployment fails loudly instead of quietly shipping placeholder
 * subtitles.
 *
 * Two behaviours are deliberate rather than incidental:
 *
 * - It answers in **reverse order**. Results are matched by segment id, never
 *   by array position, and returning them shuffled keeps that guarantee under
 *   test on every single run rather than only in the test that checks it.
 * - It **reports usage**, so the usage-persistence path is exercised by a
 *   provider that has some, alongside providers that report none.
 */

export const MOCK_TRANSLATION_PROVIDER_ID = "mock";

export interface MockTranslationProviderOptions {
  /** Simulated per-batch latency, so cancellation has something to interrupt. */
  latencyMs?: number;
}

export class MockTranslationProvider implements TranslationProvider {
  readonly id = MOCK_TRANSLATION_PROVIDER_ID;
  readonly displayName = "Deterministic test translator";
  readonly capabilities: TranslationProviderCapabilities = {
    supportsBatchTranslation: true,
    supportsContext: false,
    supportsGlossary: false,
    supportsConfidence: false,
    reportsUsage: true,
  };

  private readonly latencyMs: number;

  constructor(options: MockTranslationProviderOptions = {}) {
    this.latencyMs =
      options.latencyMs ??
      Number(process.env.AIDUB_TRANSLATION_MOCK_LATENCY_MS ?? 0);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async translate(
    request: TranslationRequest,
    context: TranslationProviderContext = {},
  ): Promise<TranslationProviderResult> {
    if (this.latencyMs > 0) {
      await this.wait(this.latencyMs, context.signal);
    }

    if (context.signal?.aborted) {
      throw translationError("TRANSLATION_CANCELLED");
    }

    context.onProgress?.({ percent: 100, stage: "Translating" });

    const inputCharacters = request.segments.reduce(
      (total, segment) => total + segment.sourceText.length,
      0,
    );

    const segments = [...request.segments].reverse().map((segment) => ({
      segmentId: segment.segmentId,
      translatedText: `[${request.targetLanguage}] ${segment.sourceText}`,
      confidence: null,
      metadata: { deterministic: true },
    }));

    return {
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      segments,
      provider: { id: this.id, model: "deterministic-v1" },
      usage: {
        inputCharacters,
        outputCharacters: segments.reduce(
          (total, segment) => total + segment.translatedText.length,
          0,
        ),
        requestCount: 1,
      },
    };
  }

  private wait(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);

      function onAbort() {
        clearTimeout(timer);
        reject(translationError("TRANSLATION_CANCELLED"));
      }

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
