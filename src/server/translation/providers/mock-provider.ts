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
 * It performs no translation. Output is a marked-up echo of the source, which
 * is stable, obviously not real output, and enough to exercise the whole
 * job → context → validation → persistence → workspace path without a network
 * call or a credential.
 *
 * It is **never a silent default**. The registry only offers it when
 * `AIDUB_TRANSLATION_PROVIDER` explicitly names it, so a misconfigured
 * production deployment fails loudly instead of quietly shipping placeholder
 * subtitles.
 *
 * Three behaviours are deliberate rather than incidental:
 *
 * - It answers in **reverse order**. Results are matched by segment id, never
 *   by array position, and returning them shuffled keeps that guarantee under
 *   test on every single run rather than only in the test that checks it.
 * - It **never answers for a context line**, even though it receives them —
 *   the same rule a real provider is held to.
 * - Each operation produces visibly different text, so a test can tell an
 *   initial translation from a regeneration from a shortening. `shorter`
 *   genuinely produces shorter text, which is what makes the duration
 *   recalculation after shortening meaningful.
 */

export const MOCK_TRANSLATION_PROVIDER_ID = "mock";

export interface MockTranslationProviderOptions {
  /** Simulated per-batch latency, so cancellation has something to interrupt. */
  latencyMs?: number;
}

/**
 * Drops roughly the second half of the words, keeping at least one.
 *
 * A crude stand-in for "say the same thing in fewer words", chosen because it
 * is deterministic and reliably shortens — the point is to exercise the
 * re-estimation and the warning update, not to model real concision.
 */
function shorten(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);

  if (words.length <= 1) {
    return text.trim();
  }

  return words.slice(0, Math.max(1, Math.ceil(words.length / 2))).join(" ");
}

export class MockTranslationProvider implements TranslationProvider {
  readonly id = MOCK_TRANSLATION_PROVIDER_ID;
  readonly displayName = "Deterministic test translator";
  readonly capabilities: TranslationProviderCapabilities = {
    supportsBatchTranslation: true,
    supportsContext: true,
    supportsDubbingConstraints: true,
    supportsStructuredOutput: true,
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

    // Only ever the lines it was asked about — context is background.
    const segments = [...request.segments].reverse().map((segment) => {
      const prefix = `[${request.targetLanguage}]`;
      const base = `${prefix} ${segment.sourceText}`;

      const translatedText =
        request.operation === "shorter"
          ? shorten(segment.currentTranslation ?? base)
          : request.operation === "regenerate"
            ? `${prefix} (v2) ${segment.sourceText}`
            : base;

      return {
        segmentId: segment.segmentId,
        translatedText,
        confidence: null,
        metadata: {
          deterministic: true,
          operation: request.operation,
          // Proof the context actually arrived, so a test can assert delivery
          // without reaching into a prompt string.
          contextBefore: segment.context?.previousSegments.length ?? 0,
          contextAfter: segment.context?.nextSegments.length ?? 0,
        },
      };
    });

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
