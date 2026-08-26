import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import {
  transcriptionError,
  type TranscriptionErrorCode,
} from "@/server/transcription/transcription-errors";
import type {
  SpeechToTextContext,
  SpeechToTextInput,
  SpeechToTextProvider,
  SpeechToTextProviderCapabilities,
  SpeechToTextResult,
  SpeechToTextSegmentResult,
} from "@/server/transcription/speech-to-text-provider";

/**
 * Local, self-hosted speech-to-text.
 *
 * Runs entirely on this machine: silero VAD splits the canonical 16 kHz mono
 * WAV into speech regions, and a Whisper model transcribes each one, so every
 * segment carries real start/end times taken from the audio rather than from a
 * model's guess. Nothing leaves the machine and no credentials are involved.
 *
 * The runtime (`sherpa-onnx-node`) and the model files are optional: both are
 * resolved at runtime, and `isAvailable()` reports false when either is
 * missing, so the app runs — and builds — without them. The same adapter shape
 * would host faster-whisper, whisper.cpp or a GPU worker binary.
 *
 * Expected model layout under AIDUB_STT_MODEL_DIR (see `npm run setup:stt`):
 *   whisper/encoder.onnx
 *   whisper/decoder.onnx
 *   whisper/tokens.txt
 *   silero_vad.onnx
 */

export const LOCAL_WHISPER_PROVIDER_ID = "local-whisper";

const SAMPLE_RATE = 16_000;
const VAD_WINDOW = 512;

export interface LocalWhisperProviderOptions {
  modelDirectory?: string;
  model?: string;
  numThreads?: number;
}

interface SherpaRecognizer {
  createStream(): SherpaStream;
  decode(stream: SherpaStream): void;
  getResult(stream: SherpaStream): SherpaResult;
}

interface SherpaModule {
  OfflineRecognizer: new (config: unknown) => SherpaRecognizer;
  Vad: new (
    config: unknown,
    bufferSizeInSeconds: number,
  ) => {
    acceptWaveform(samples: Float32Array): void;
    isEmpty(): boolean;
    front(): { start: number; samples: Float32Array };
    pop(): void;
    flush(): void;
  };
  readWave(filePath: string): { samples: Float32Array; sampleRate: number };
}

interface SherpaStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
}

interface SherpaResult {
  text?: string;
  lang?: string;
  ys_log_probs?: number[];
}

export function defaultModelDirectory(): string {
  return (
    process.env.AIDUB_STT_MODEL_DIR ?? path.join(process.cwd(), ".aidub", "stt-models")
  );
}

function loadSherpa(): SherpaModule | null {
  try {
    // Resolved from the project root at runtime so the web bundle never
    // hard-depends on the native runtime.
    const requireOptional = createRequire(
      path.join(process.cwd(), "package.json"),
    );

    return requireOptional("sherpa-onnx-node") as SherpaModule;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function averageLogProbability(result: SherpaResult): number | null {
  const values = result.ys_log_probs;

  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const usable = values.filter((value) => Number.isFinite(value));

  if (usable.length === 0) {
    return null;
  }

  const mean = usable.reduce((total, value) => total + value, 0) / usable.length;

  return Math.round(mean * 1000) / 1000;
}

export class LocalWhisperSpeechToTextProvider implements SpeechToTextProvider {
  readonly id = LOCAL_WHISPER_PROVIDER_ID;
  readonly displayName = "Local Whisper (self-hosted)";
  readonly capabilities: SpeechToTextProviderCapabilities = {
    supportsLanguageHint: false,
    supportsSegmentTimestamps: true,
    supportsWordTimestamps: false,
    // Whisper exposes token log probabilities, which are not a calibrated
    // 0–1 confidence; they are kept as metadata instead of being reshaped.
    reportsConfidence: false,
  };

  private readonly modelDirectory: string;
  private readonly model: string;
  private readonly numThreads: number;
  private recognizer: SherpaRecognizer | null = null;

  constructor(options: LocalWhisperProviderOptions = {}) {
    this.modelDirectory = options.modelDirectory ?? defaultModelDirectory();
    this.model = options.model ?? process.env.AIDUB_STT_MODEL ?? "whisper-tiny.en";
    this.numThreads = options.numThreads ?? 2;
  }

  private paths() {
    return {
      encoder: path.join(this.modelDirectory, "whisper", "encoder.onnx"),
      decoder: path.join(this.modelDirectory, "whisper", "decoder.onnx"),
      tokens: path.join(this.modelDirectory, "whisper", "tokens.txt"),
      vad: path.join(this.modelDirectory, "silero_vad.onnx"),
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!loadSherpa()) {
      return false;
    }

    const files = Object.values(this.paths());
    const present = await Promise.all(files.map(fileExists));

    return present.every(Boolean);
  }

  async transcribe(
    input: SpeechToTextInput,
    context: SpeechToTextContext = {},
  ): Promise<SpeechToTextResult> {
    const sherpa = loadSherpa();

    if (!sherpa || !(await this.isAvailable())) {
      throw transcriptionError("STT_PROVIDER_UNAVAILABLE", {
        details: `local model runtime or files missing in ${this.modelDirectory}`,
      });
    }

    if (!input.audio.path) {
      throw transcriptionError("STT_UNSUPPORTED_AUDIO", {
        details: "local provider requires an audio file path",
      });
    }

    context.onProgress?.({ percent: 5, stage: "Loading speech model" });

    const recognizer = this.getRecognizer(sherpa);
    const wave = this.readAudio(sherpa, input.audio.path);

    this.throwIfAborted(context);
    context.onProgress?.({ percent: 15, stage: "Detecting speech" });

    const speechRegions = this.detectSpeech(sherpa, wave.samples);

    if (speechRegions.length === 0) {
      // Valid audio with no speech: an empty transcript, not a failure.
      return {
        language: null,
        segments: [],
        provider: {
          id: this.id,
          model: this.model,
          metadata: { detectedSpeechRegions: 0 },
        },
      };
    }

    const segments: SpeechToTextSegmentResult[] = [];

    for (const [index, region] of speechRegions.entries()) {
      this.throwIfAborted(context);

      const stream = recognizer.createStream();
      stream.acceptWaveform({
        sampleRate: SAMPLE_RATE,
        samples: region.samples,
      });
      recognizer.decode(stream);

      const result = recognizer.getResult(stream);
      const text = (result.text ?? "").trim();

      if (text.length > 0) {
        const averageLogProb = averageLogProbability(result);

        segments.push({
          startTime: region.startTime,
          endTime: region.endTime,
          text,
          // Whisper reports no calibrated confidence; see capabilities.
          confidence: null,
          metadata: {
            model: this.model,
            ...(averageLogProb !== null
              ? { averageLogProbability: averageLogProb }
              : {}),
          },
        });
      }

      context.onProgress?.({
        percent: 20 + Math.round(((index + 1) / speechRegions.length) * 75),
        stage: "Recognising speech",
      });
    }

    return {
      language: null,
      segments,
      provider: {
        id: this.id,
        model: this.model,
        metadata: { speechRegions: speechRegions.length },
      },
    };
  }

  private getRecognizer(sherpa: SherpaModule): SherpaRecognizer {
    if (this.recognizer) {
      return this.recognizer;
    }

    const { encoder, decoder, tokens } = this.paths();

    try {
      this.recognizer = new sherpa.OfflineRecognizer({
        featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
        modelConfig: {
          whisper: { encoder, decoder },
          tokens,
          numThreads: this.numThreads,
          provider: "cpu",
          debug: false,
        },
      });
    } catch (cause) {
      throw transcriptionError("STT_PROVIDER_UNAVAILABLE", {
        details: "the local speech model could not be loaded",
        cause,
      });
    }

    return this.recognizer;
  }

  private readAudio(sherpa: SherpaModule, filePath: string) {
    let wave: { samples: Float32Array; sampleRate: number };

    try {
      wave = sherpa.readWave(filePath);
    } catch (cause) {
      throw transcriptionError("STT_UNSUPPORTED_AUDIO", {
        details: "the audio file could not be read",
        cause,
      });
    }

    if (wave.sampleRate !== SAMPLE_RATE) {
      // Part 4 always produces 16 kHz mono; anything else is a bug upstream.
      throw transcriptionError("STT_UNSUPPORTED_AUDIO", {
        details: `expected ${SAMPLE_RATE} Hz audio, received ${wave.sampleRate} Hz`,
      });
    }

    return wave;
  }

  /** Silero VAD: speech regions with real timings taken from the waveform. */
  private detectSpeech(sherpa: SherpaModule, samples: Float32Array) {
    const vad = new sherpa.Vad(
      {
        sileroVad: {
          model: this.paths().vad,
          threshold: 0.5,
          minSilenceDuration: 0.4,
          minSpeechDuration: 0.25,
          maxSpeechDuration: 20,
          windowSize: VAD_WINDOW,
        },
        sampleRate: SAMPLE_RATE,
        debug: false,
        numThreads: 1,
      },
      60,
    );

    const regions: {
      startTime: number;
      endTime: number;
      samples: Float32Array;
    }[] = [];

    const drain = () => {
      while (!vad.isEmpty()) {
        const region = vad.front();
        const startTime = region.start / SAMPLE_RATE;

        regions.push({
          startTime,
          endTime: startTime + region.samples.length / SAMPLE_RATE,
          samples: region.samples,
        });
        vad.pop();
      }
    };

    for (let offset = 0; offset + VAD_WINDOW < samples.length; offset += VAD_WINDOW) {
      vad.acceptWaveform(samples.subarray(offset, offset + VAD_WINDOW));
      drain();
    }

    vad.flush();
    drain();

    return regions;
  }

  private throwIfAborted(context: SpeechToTextContext): void {
    if (context.signal?.aborted) {
      const code: TranscriptionErrorCode = "TRANSCRIPTION_CANCELLED";
      throw transcriptionError(code);
    }
  }
}
