import type {
  SpeechToTextContext,
  SpeechToTextInput,
  SpeechToTextProvider,
  SpeechToTextProviderCapabilities,
  SpeechToTextResult,
} from "@/server/transcription/speech-to-text-provider";

/**
 * Deterministic provider for tests and offline development.
 *
 * It exists so the orchestration around transcription — job lifecycle,
 * prerequisite audio extraction, normalisation, persistence, cancellation —
 * can be exercised without a model, credentials or network. It is **not** a
 * production provider: the registry only exposes it when
 * `AIDUB_STT_PROVIDER=mock` is set explicitly.
 */

export const MOCK_PROVIDER_ID = "mock";

export const MOCK_TRANSCRIPT_SEGMENTS = [
  { startTime: 0, endTime: 1.5, text: "Hello world.", confidence: 0.95 },
  { startTime: 1.5, endTime: 3.2, text: "This is a test.", confidence: 0.91 },
] as const;

export class MockSpeechToTextProvider implements SpeechToTextProvider {
  readonly id = MOCK_PROVIDER_ID;
  readonly displayName = "Mock transcription (development)";
  readonly capabilities: SpeechToTextProviderCapabilities = {
    supportsLanguageHint: true,
    supportsSegmentTimestamps: true,
    supportsWordTimestamps: false,
    reportsConfidence: true,
  };

  constructor(
    private readonly options: {
      language?: string | null;
      /** Lets tests exercise failures and cancellation deterministically. */
      failWith?: Error;
      delayMs?: number;
      segments?: readonly {
        startTime: number;
        endTime: number;
        text: string;
        confidence?: number | null;
      }[];
    } = {},
  ) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async transcribe(
    input: SpeechToTextInput,
    context: SpeechToTextContext = {},
  ): Promise<SpeechToTextResult> {
    if (this.options.failWith) {
      throw this.options.failWith;
    }

    context.onProgress?.({ percent: 10, stage: "Preparing audio" });

    if (this.options.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.options.delayMs);
        context.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }

    context.onProgress?.({ percent: 80, stage: "Recognising speech" });

    const segments = (this.options.segments ?? MOCK_TRANSCRIPT_SEGMENTS).map(
      (segment) => ({
        startTime: segment.startTime,
        endTime: segment.endTime,
        text: segment.text,
        confidence: segment.confidence ?? null,
        metadata: { model: "mock-1" },
      }),
    );

    return {
      language: this.options.language ?? input.language ?? null,
      segments,
      provider: { id: this.id, model: "mock-1" },
    };
  }
}
