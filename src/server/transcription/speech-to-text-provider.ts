/**
 * The speech-to-text boundary.
 *
 * Everything above it — the transcription service, the processing job, the
 * Transcript workspace — speaks only in these terms. Everything below it (HTTP
 * calls, credentials, model files, inference runtimes, vendor JSON shapes)
 * lives inside one adapter. Adding a provider must never require touching the
 * transcript model or the UI.
 *
 * The contract is intentionally not HTTP-shaped: a provider may run a local
 * model on this machine, shell out to a GPU worker, or call a remote API that
 * uploads a file and polls for a result.
 */

export interface SpeechToTextProviderCapabilities {
  /** Whether a source-language hint is useful to this provider. */
  supportsLanguageHint: boolean;
  supportsSegmentTimestamps: boolean;
  supportsWordTimestamps: boolean;
  reportsConfidence: boolean;
}

export interface SpeechToTextAudio {
  /** Local path — used by providers that read the file directly. */
  path?: string;
  /** In-memory bytes — used by providers that upload or stream. */
  bytes?: Uint8Array;
  mimeType: string;
  /** Known duration, used for progress and timestamp validation. */
  durationSeconds?: number | null;
}

export interface SpeechToTextInput {
  projectId: string;
  sourceMediaId: string;
  audioArtifactId: string | null;
  audio: SpeechToTextAudio;
  /** Optional hint from the project's source language. */
  language?: string | null;
}

export interface SpeechToTextProgress {
  /** 0–100 within the provider's own work, when it can be determined. */
  percent?: number;
  /** Short human-readable stage, e.g. "Recognising speech". */
  stage?: string;
}

export interface SpeechToTextContext {
  signal?: AbortSignal;
  onProgress?: (progress: SpeechToTextProgress) => void;
}

/** One segment as the adapter normalised it — not yet an Aidub segment. */
export interface SpeechToTextSegmentResult {
  startTime: number;
  endTime: number;
  text: string;
  /** Normalised 0–1, or null when the provider reports nothing comparable. */
  confidence: number | null;
  metadata?: Record<string, unknown>;
}

export interface SpeechToTextResult {
  /** Detected or confirmed language, when the provider reports one. */
  language: string | null;
  segments: SpeechToTextSegmentResult[];
  provider: {
    id: string;
    model: string | null;
    metadata?: Record<string, unknown>;
  };
}

export interface SpeechToTextProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: SpeechToTextProviderCapabilities;
  /**
   * Whether this provider can run right now (model files present, credentials
   * configured, runtime installed). Checked before a job starts so the user
   * gets one clear message instead of a provider-specific failure.
   */
  isAvailable(): Promise<boolean>;
  transcribe(
    input: SpeechToTextInput,
    context?: SpeechToTextContext,
  ): Promise<SpeechToTextResult>;
}

export interface SpeechToTextProviderInfo {
  id: string;
  displayName: string;
  capabilities: SpeechToTextProviderCapabilities;
}
