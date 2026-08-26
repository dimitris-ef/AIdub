import type {
  SpeakerDiarizationContext,
  SpeakerDiarizationInput,
  SpeakerDiarizationProvider,
  SpeakerDiarizationProviderCapabilities,
  SpeakerDiarizationRegionResult,
  SpeakerDiarizationResult,
} from "@/server/diarization/speaker-diarization-provider";

/**
 * Deterministic provider for tests and offline development.
 *
 * It exists so the orchestration around diarization — job lifecycle,
 * prerequisite audio extraction, label normalisation, persistence,
 * cancellation — can be exercised without a model, credentials or a GPU. It is
 * **not** a production provider: the registry only exposes it when
 * `AIDUB_DIARIZATION_PROVIDER=mock` is set explicitly.
 *
 * The default regions deliberately use out-of-order provider labels so the
 * first-appearance rule is visible: `B` speaks first and becomes `speaker_1`.
 */

export const MOCK_DIARIZATION_PROVIDER_ID = "mock";

export const MOCK_DIARIZATION_REGIONS: readonly SpeakerDiarizationRegionResult[] =
  [
    { speakerLabel: "B", startTime: 0, endTime: 3, confidence: 0.93 },
    { speakerLabel: "A", startTime: 3, endTime: 6, confidence: 0.89 },
    { speakerLabel: "B", startTime: 6, endTime: 8, confidence: 0.95 },
  ];

export class MockSpeakerDiarizationProvider
  implements SpeakerDiarizationProvider
{
  readonly id = MOCK_DIARIZATION_PROVIDER_ID;
  readonly displayName = "Mock diarization (development)";
  readonly capabilities: SpeakerDiarizationProviderCapabilities = {
    supportsKnownSpeakerCount: true,
    supportsSpeakerRange: true,
    supportsOverlappingSpeech: true,
    reportsConfidence: true,
  };

  constructor(
    private readonly options: {
      /** Lets tests exercise failures and cancellation deterministically. */
      failWith?: Error;
      delayMs?: number;
      regions?: readonly SpeakerDiarizationRegionResult[];
      available?: boolean;
    } = {},
  ) {}

  async isAvailable(): Promise<boolean> {
    return this.options.available ?? true;
  }

  async diarize(
    input: SpeakerDiarizationInput,
    context: SpeakerDiarizationContext = {},
  ): Promise<SpeakerDiarizationResult> {
    if (this.options.failWith) {
      throw this.options.failWith;
    }

    context.onProgress?.({ percent: 10, stage: "Loading diarization model" });

    if (this.options.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.options.delayMs);
        context.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }

    context.onProgress?.({ percent: 80, stage: "Analysing speaker turns" });

    const regions = (this.options.regions ?? MOCK_DIARIZATION_REGIONS).map(
      (region) => ({ ...region, metadata: { model: "mock-diarizer-1" } }),
    );

    return {
      regions,
      provider: {
        id: this.id,
        model: "mock-diarizer-1",
        metadata: {
          requestedSpeakerCount: input.expectedSpeakerCount ?? null,
        },
      },
    };
  }
}
