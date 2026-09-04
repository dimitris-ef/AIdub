import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { ttsError } from "@/server/tts/tts-errors";
import {
  applicableSettings,
  voiceSupportsLanguage,
  type TtsProvider,
  type TtsProviderCapabilities,
  type TtsProviderContext,
} from "@/server/tts/tts-provider";
import {
  findLocalVitsVoice,
  LOCAL_VITS_CATALOG,
  localVitsModelPaths,
  toTtsVoice,
  type LocalVitsVoiceDefinition,
} from "@/server/tts/providers/local-vits-catalog";
import {
  runTtsWorker,
  TtsWorkerAborted,
  TtsWorkerError,
  type TtsWorkerFailure,
} from "@/server/tts/providers/local-vits-worker";
import type {
  TtsProviderResult,
  TtsSynthesisRequest,
  TtsVoice,
} from "@/types/tts";

/**
 * Local, self-hosted text-to-speech.
 *
 * Runs entirely on this machine on CPU: a Piper VITS model turns a line of text
 * into 22.05 kHz PCM. No audio and no dialogue leaves the machine, no
 * credentials are involved, and there is nothing to bill — the ONNX exports are
 * fetched from a public release by `npm run setup:tts`.
 *
 * Synthesis runs on a worker thread (see `local-vits-worker`) because it is one
 * blocking native call per line. That worker boundary is also the seam a remote
 * CPU/GPU worker slots into later, when speech generation stops running inside
 * the web process.
 *
 * The runtime (`sherpa-onnx-node`) and the model files are optional: both are
 * resolved at runtime, and `isAvailable()` reports false when either is missing,
 * so Aidub runs — and builds — without them. The same adapter shape would host a
 * hosted synthesis API or a containerised GPU service; nothing above this file
 * would change.
 *
 * These are the model's own published voices. Nothing here clones a voice, and
 * no reference recording of the original speakers is used or accepted.
 */

export const LOCAL_VITS_PROVIDER_ID = "local-vits";

/**
 * The models publish no speed range, and Piper's own tooling treats values
 * outside roughly half to double speed as unusable. Clamping keeps a stored
 * setting from producing unintelligible audio rather than an error.
 */
const SPEED_RANGE = { min: 0.5, max: 2.0 } as const;

export interface LocalVitsProviderOptions {
  modelDirectory?: string;
  numThreads?: number;
}

export function defaultTtsModelDirectory(): string {
  return (
    process.env.AIDUB_TTS_MODEL_DIR ??
    path.join(process.cwd(), ".aidub", "tts-models")
  );
}

/**
 * Whether the optional native runtime is installed, without loading it: the web
 * process never needs the addon in memory, only the worker does.
 */
function runtimeInstalled(): boolean {
  try {
    createRequire(path.join(process.cwd(), "package.json")).resolve(
      "sherpa-onnx-node",
    );
    return true;
  } catch {
    return false;
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

const WORKER_FAILURE_CODES: Record<
  TtsWorkerFailure,
  Parameters<typeof ttsError>[0]
> = {
  runtime_unavailable: "TTS_PROVIDER_UNAVAILABLE",
  model_unavailable: "TTS_PROVIDER_UNAVAILABLE",
  synthesis_failed: "TTS_GENERATION_FAILED",
  empty_audio: "TTS_INVALID_AUDIO_RESPONSE",
};

export class LocalVitsTtsProvider implements TtsProvider {
  readonly id = LOCAL_VITS_PROVIDER_ID;
  readonly displayName = "Local Piper VITS (self-hosted)";
  readonly capabilities: TtsProviderCapabilities = {
    // Sample count over sample rate: exact, not an estimate.
    reportsDuration: true,
    supportsSpeakingRate: true,
    // VITS exposes no pitch, gain or style control through this binding, and
    // claiming otherwise would record settings that never applied.
    supportsPitch: false,
    supportsVolumeGain: false,
    supportsStyle: false,
    // Models on disk publish no previews; the workspace synthesises samples.
    supportsVoicePreviewUrl: false,
    // Nothing is metered locally, so nothing honest can be reported.
    reportsUsage: false,
  };

  private readonly modelDirectory: string;
  private readonly numThreads: number;

  constructor(options: LocalVitsProviderOptions = {}) {
    this.modelDirectory = options.modelDirectory ?? defaultTtsModelDirectory();
    this.numThreads = options.numThreads ?? 2;
  }

  async isAvailable(): Promise<boolean> {
    if (!runtimeInstalled()) {
      return false;
    }

    return (await this.installedVoices()).length > 0;
  }

  async listVoices(languageCode?: string): Promise<TtsVoice[]> {
    if (!runtimeInstalled()) {
      return [];
    }

    const voices = (await this.installedVoices()).map((definition) =>
      toTtsVoice(definition, this.id),
    );

    if (!languageCode) {
      return voices;
    }

    return voices.filter((voice) => voiceSupportsLanguage(voice, languageCode));
  }

  async synthesize(
    request: TtsSynthesisRequest,
    context: TtsProviderContext = {},
  ): Promise<TtsProviderResult> {
    this.throwIfAborted(context);

    const definition = findLocalVitsVoice(request.voice.voiceId);

    if (!definition) {
      throw ttsError("TTS_VOICE_NOT_FOUND", {
        details: `unknown local voice ${request.voice.voiceId}`,
      });
    }

    if (
      !definition.languageCodes.some(
        (code) =>
          code.toLowerCase().split(/[-_]/)[0] ===
          request.targetLanguage.toLowerCase().split(/[-_]/)[0],
      )
    ) {
      throw ttsError("TTS_UNSUPPORTED_LANGUAGE", {
        details: `${definition.id} does not speak ${request.targetLanguage}`,
      });
    }

    const paths = localVitsModelPaths(this.modelDirectory, definition);

    if (!(await this.definitionInstalled(definition))) {
      throw ttsError("TTS_PROVIDER_UNAVAILABLE", {
        details: `model files missing for ${definition.id}`,
      });
    }

    const settings = applicableSettings(request.settings, this.capabilities);
    const speed = clampSpeed(settings.speakingRate);

    context.onProgress?.({ percent: 10, stage: "Loading voice" });

    let result;
    try {
      result = await runTtsWorker(
        {
          projectRoot: process.cwd(),
          modelPath: paths.model,
          tokensPath: paths.tokens,
          dataDir: paths.dataDir,
          speakerId: definition.speakerId,
          text: request.text,
          speed,
          numThreads: this.numThreads,
        },
        context.signal,
      );
    } catch (cause) {
      if (cause instanceof TtsWorkerAborted) {
        throw ttsError("TTS_CANCELLED");
      }
      if (cause instanceof TtsWorkerError) {
        throw ttsError(WORKER_FAILURE_CODES[cause.kind], {
          details: cause.message,
        });
      }

      throw ttsError("TTS_GENERATION_FAILED", { cause });
    }

    context.onProgress?.({ percent: 100, stage: "Speech generated" });

    return {
      audio: {
        data: result.wav,
        mimeType: "audio/wav",
        sampleRate: result.sampleRate,
        channels: 1,
      },
      durationSeconds: result.durationSeconds,
      provider: {
        id: this.id,
        model: definition.modelDirectory,
        voiceId: definition.id,
        metadata: {
          speakerId: definition.speakerId,
          speed,
        },
      },
      // Nothing local is metered; an invented figure would be worse than none.
      usage: null,
    };
  }

  /** Catalog entries whose model files are actually on disk. */
  private async installedVoices(): Promise<LocalVitsVoiceDefinition[]> {
    const installed = await Promise.all(
      LOCAL_VITS_CATALOG.map(async (definition) =>
        (await this.definitionInstalled(definition)) ? definition : null,
      ),
    );

    return installed.filter(
      (definition): definition is LocalVitsVoiceDefinition =>
        definition !== null,
    );
  }

  private async definitionInstalled(
    definition: LocalVitsVoiceDefinition,
  ): Promise<boolean> {
    const paths = localVitsModelPaths(this.modelDirectory, definition);
    const present = await Promise.all([
      fileExists(paths.model),
      fileExists(paths.tokens),
    ]);

    return present.every(Boolean);
  }

  private throwIfAborted(context: TtsProviderContext): void {
    if (context.signal?.aborted) {
      throw ttsError("TTS_CANCELLED");
    }
  }
}

function clampSpeed(speakingRate: number | null | undefined): number {
  if (typeof speakingRate !== "number" || !Number.isFinite(speakingRate)) {
    return 1;
  }

  return Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, speakingRate));
}
