/**
 * The speaker-diarization boundary.
 *
 * Everything above it — the diarization service, the processing job, the
 * Speaker Analysis panel — speaks only in these terms. Everything below it
 * (model files, inference runtimes, GPU workers, credentials, vendor response
 * shapes, provider speaker labels) lives inside one adapter.
 *
 * Deliberately *not* HTTP-shaped, and deliberately separate from
 * `SpeechToTextProvider`: a provider may run a local model on this machine,
 * shell out to a GPU worker, or call a remote API. Aidub must stay free to
 * pair any transcription provider with any diarization provider, so even a
 * vendor that can do both in one request is adapted as two providers.
 */

export interface SpeakerDiarizationProviderCapabilities {
  /** Whether an exact expected speaker count can be supplied. */
  supportsKnownSpeakerCount: boolean;
  /** Whether min/max speaker bounds can be supplied. */
  supportsSpeakerRange: boolean;
  /** Whether the model itself detects simultaneous speech. */
  supportsOverlappingSpeech: boolean;
  reportsConfidence: boolean;
}

export interface SpeakerDiarizationAudio {
  /** Local path — used by providers that read the file directly. */
  path?: string;
  /** In-memory bytes — used by providers that upload or stream. */
  bytes?: Uint8Array;
  mimeType: string;
  /** Known duration, used for progress and timestamp validation. */
  durationSeconds?: number | null;
}

export interface SpeakerDiarizationInput {
  projectId: string;
  sourceMediaId: string;
  audioArtifactId: string | null;
  audio: SpeakerDiarizationAudio;
  /**
   * Optional hints. All are nullable and none is required: the default is to
   * let the provider infer how many people are speaking.
   */
  expectedSpeakerCount?: number | null;
  minSpeakers?: number | null;
  maxSpeakers?: number | null;
}

export interface SpeakerDiarizationProgress {
  /** 0–100 within the provider's own work, when it can be determined. */
  percent?: number;
  /** Short human-readable stage, e.g. "Analysing speaker turns". */
  stage?: string;
}

export interface SpeakerDiarizationContext {
  signal?: AbortSignal;
  onProgress?: (progress: SpeakerDiarizationProgress) => void;
}

/** One region as the adapter normalised it — not yet an Aidub speaker region. */
export interface SpeakerDiarizationRegionResult {
  /** The provider's own label; converted to a canonical id downstream. */
  speakerLabel: string;
  startTime: number;
  endTime: number;
  /** Normalised 0–1, or null when the provider reports nothing comparable. */
  confidence: number | null;
  /** Only set by providers that genuinely detect overlapping speech. */
  overlap?: boolean;
  metadata?: Record<string, unknown>;
}

/** Optional per-speaker detail, for providers that report any. */
export interface SpeakerDiarizationSpeakerResult {
  speakerLabel: string;
  confidence: number | null;
  metadata?: Record<string, unknown>;
}

export interface SpeakerDiarizationResult {
  regions: SpeakerDiarizationRegionResult[];
  speakers?: SpeakerDiarizationSpeakerResult[];
  provider: {
    id: string;
    model: string | null;
    metadata?: Record<string, unknown>;
  };
}

export interface SpeakerDiarizationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: SpeakerDiarizationProviderCapabilities;
  /**
   * Whether this provider can run right now (model files present, credentials
   * configured, runtime installed). Checked before a job starts so the user
   * gets one clear message instead of a provider-specific failure.
   */
  isAvailable(): Promise<boolean>;
  diarize(
    input: SpeakerDiarizationInput,
    context?: SpeakerDiarizationContext,
  ): Promise<SpeakerDiarizationResult>;
}

export interface SpeakerDiarizationProviderInfo {
  id: string;
  displayName: string;
  capabilities: SpeakerDiarizationProviderCapabilities;
}
