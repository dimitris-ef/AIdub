import type { ProbeMediaResult } from "@/types/processing-job";

/**
 * The backend-facing media operation contract.
 *
 * Everything above this line (jobs, API routes, UI) speaks in these terms;
 * everything below it (FFmpeg arguments, spawned processes, stderr parsing)
 * lives in an adapter. Swapping the adapter — a different binary, a remote
 * worker, a cloud transcoding API — does not change any caller.
 */

export interface ProcessingContext {
  /** Cancellation. Adapters must terminate their child process on abort. */
  signal?: AbortSignal;
  /** Normalised 0–100 progress; omitted when it cannot be determined. */
  onProgress?: (progress: number) => void;
}

export interface ProbeMediaInput {
  inputPath: string;
}

export interface ExtractAudioInput {
  inputPath: string;
  outputPath: string;
  /** Total duration, used to turn FFmpeg's time output into a percentage. */
  durationSeconds?: number | null;
  sampleRate?: number;
  channels?: number;
}

export interface ExtractAudioResult {
  outputPath: string;
  sampleRate: number;
  channels: number;
  sizeBytes: number;
  durationSeconds: number | null;
}

export interface ConvertMediaInput {
  inputPath: string;
  outputPath: string;
  durationSeconds?: number | null;
  /** Audio-only conversions are all Part 4 needs so far. */
  audio?: {
    codec: string;
    sampleRate?: number;
    channels?: number;
  };
  /** Input-side FFmpeg arguments, e.g. rate limiting. Array, never a string. */
  inputArgs?: readonly string[];
  /** Output-side FFmpeg arguments, supplied as an array — never a string. */
  extraArgs?: readonly string[];
}

export interface ConvertMediaResult {
  outputPath: string;
  sizeBytes: number;
}

export interface ProcessingCapabilities {
  ffmpegAvailable: boolean;
  ffprobeAvailable: boolean;
  ffmpegVersion: string | null;
  ffprobeVersion: string | null;
}

export interface MediaProcessor {
  /** Cheap capability/version check; cached, not run per job. */
  getCapabilities(): Promise<ProcessingCapabilities>;
  probe(
    input: ProbeMediaInput,
    context?: ProcessingContext,
  ): Promise<ProbeMediaResult>;
  extractAudio(
    input: ExtractAudioInput,
    context?: ProcessingContext,
  ): Promise<ExtractAudioResult>;
  convert(
    input: ConvertMediaInput,
    context?: ProcessingContext,
  ): Promise<ConvertMediaResult>;
}

/**
 * Canonical speech-processing audio format.
 *
 * Mono 16 kHz PCM s16le WAV: the format transcription and diarization systems
 * accept without resampling, small enough to move around cheaply, and lossless
 * relative to what those models actually consume. Later stages that need a
 * different rate or channel layout convert from the source again rather than
 * upsampling this artifact.
 */
export const CANONICAL_AUDIO = {
  sampleRate: 16_000,
  channels: 1,
  codec: "pcm_s16le",
  extension: "wav",
  mimeType: "audio/wav",
} as const;
