import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { diarizationError } from "@/server/diarization/diarization-errors";
import {
  DiarizationWorkerAborted,
  DiarizationWorkerError,
  runDiarizationWorker,
  type DiarizationWorkerFailure,
} from "@/server/diarization/providers/local-pyannote-worker";
import type {
  SpeakerDiarizationContext,
  SpeakerDiarizationInput,
  SpeakerDiarizationProvider,
  SpeakerDiarizationProviderCapabilities,
  SpeakerDiarizationRegionResult,
  SpeakerDiarizationResult,
} from "@/server/diarization/speaker-diarization-provider";

/**
 * Local, self-hosted speaker diarization.
 *
 * Runs entirely on this machine on CPU: a pyannote segmentation model finds
 * speech turns, a speaker-embedding model produces a vector per turn, and
 * agglomerative clustering groups the turns into speakers. No audio leaves the
 * machine, no credentials are involved and no Hugging Face token is needed —
 * the ONNX exports are fetched from a public release by
 * `npm run setup:diarization`.
 *
 * The analysis itself runs on a worker thread (see `local-pyannote-worker`),
 * because it is one blocking native call: on the main thread it would stall
 * the web process and make cancellation impossible. That worker boundary is
 * also the seam a remote CPU/GPU worker slots into later.
 *
 * The runtime (`sherpa-onnx-node`) and the model files are optional: both are
 * resolved at runtime, and `isAvailable()` reports false when either is
 * missing, so the app runs — and builds — without them. This same adapter
 * shape would host a Python pyannote worker, a containerised GPU service or a
 * hosted diarization API; nothing above this file would change.
 *
 * Expected model layout under AIDUB_DIARIZATION_MODEL_DIR:
 *   segmentation.onnx   (pyannote segmentation 3.0, ONNX export)
 *   embedding.onnx      (speaker embedding extractor)
 */

export const LOCAL_PYANNOTE_PROVIDER_ID = "local-pyannote";

const SAMPLE_RATE = 16_000;

/**
 * Clustering distance threshold. Larger merges more aggressively; smaller
 * splits one person into several speakers. 0.8 was chosen by running the
 * bundled multi-speaker fixture across the range and taking the value that
 * recovers the true speaker count — it is a tuned default, not a guarantee.
 */
const DEFAULT_CLUSTER_THRESHOLD = 0.8;

export interface LocalPyannoteProviderOptions {
  modelDirectory?: string;
  model?: string;
  numThreads?: number;
  clusterThreshold?: number;
}

export function defaultModelDirectory(): string {
  return (
    process.env.AIDUB_DIARIZATION_MODEL_DIR ??
    path.join(process.cwd(), ".aidub", "diarization-models")
  );
}

/**
 * Whether the optional native runtime is installed, without loading it: the
 * web process never needs the addon in memory, only the worker does.
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

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

const WORKER_FAILURE_CODES: Record<
  DiarizationWorkerFailure,
  Parameters<typeof diarizationError>[0]
> = {
  runtime_unavailable: "DIARIZATION_PROVIDER_UNAVAILABLE",
  unsupported_audio: "DIARIZATION_UNSUPPORTED_AUDIO",
  analysis_failed: "DIARIZATION_REQUEST_FAILED",
};

export class LocalPyannoteDiarizationProvider
  implements SpeakerDiarizationProvider
{
  readonly id = LOCAL_PYANNOTE_PROVIDER_ID;
  readonly displayName = "Local pyannote + speaker embeddings (self-hosted)";
  readonly capabilities: SpeakerDiarizationProviderCapabilities = {
    supportsKnownSpeakerCount: true,
    // Only an exact count is accepted by the clustering backend; a min/max
    // range is not expressible, so it is not advertised.
    supportsSpeakerRange: false,
    // The segmentation model detects simultaneous speech, but this binding
    // returns a flat turn list, so overlap is not reported by the provider.
    // The normaliser still derives it from the regions themselves.
    supportsOverlappingSpeech: false,
    // Clustering distances are not calibrated probabilities; nothing here is
    // presented as a confidence.
    reportsConfidence: false,
  };

  private readonly modelDirectory: string;
  private readonly model: string;
  private readonly numThreads: number;
  private readonly clusterThreshold: number;

  constructor(options: LocalPyannoteProviderOptions = {}) {
    this.modelDirectory = options.modelDirectory ?? defaultModelDirectory();
    this.model =
      options.model ??
      process.env.AIDUB_DIARIZATION_MODEL ??
      "pyannote-segmentation-3.0 + titanet-small";
    this.numThreads = options.numThreads ?? 2;
    this.clusterThreshold =
      options.clusterThreshold ??
      Number(
        process.env.AIDUB_DIARIZATION_CLUSTER_THRESHOLD ??
          DEFAULT_CLUSTER_THRESHOLD,
      );
  }

  private paths() {
    return {
      segmentation: path.join(this.modelDirectory, "segmentation.onnx"),
      embedding: path.join(this.modelDirectory, "embedding.onnx"),
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!runtimeInstalled()) {
      return false;
    }

    const present = await Promise.all(
      Object.values(this.paths()).map(fileExists),
    );

    return present.every(Boolean);
  }

  async diarize(
    input: SpeakerDiarizationInput,
    context: SpeakerDiarizationContext = {},
  ): Promise<SpeakerDiarizationResult> {
    if (!(await this.isAvailable())) {
      throw diarizationError("DIARIZATION_PROVIDER_UNAVAILABLE", {
        details: `local diarization runtime or model files missing in ${this.modelDirectory}`,
      });
    }

    if (!input.audio.path) {
      throw diarizationError("DIARIZATION_UNSUPPORTED_AUDIO", {
        details: "the local provider requires an audio file path",
      });
    }

    this.throwIfAborted(context);
    context.onProgress?.({ percent: 5, stage: "Loading diarization model" });

    // A known speaker count is honoured when the caller supplies one; the
    // default (-1) lets the model decide how many people are speaking.
    const numClusters = positiveInteger(input.expectedSpeakerCount) ?? -1;

    context.onProgress?.({ percent: 25, stage: "Analysing speaker turns" });

    let segments;
    try {
      segments = await runDiarizationWorker(
        {
          projectRoot: process.cwd(),
          audioPath: input.audio.path,
          segmentationModel: this.paths().segmentation,
          embeddingModel: this.paths().embedding,
          numClusters,
          clusterThreshold: this.clusterThreshold,
          numThreads: this.numThreads,
          expectedSampleRate: SAMPLE_RATE,
        },
        context.signal,
      );
    } catch (cause) {
      if (cause instanceof DiarizationWorkerAborted) {
        throw diarizationError("DIARIZATION_CANCELLED");
      }
      if (cause instanceof DiarizationWorkerError) {
        throw diarizationError(WORKER_FAILURE_CODES[cause.kind], {
          details: cause.message,
        });
      }

      throw diarizationError("DIARIZATION_REQUEST_FAILED", { cause });
    }

    this.throwIfAborted(context);
    context.onProgress?.({ percent: 90, stage: "Normalising speaker regions" });

    const regions: SpeakerDiarizationRegionResult[] = segments.map(
      (segment) => ({
        // The model's cluster number, kept as the provider label only. The
        // canonical `speaker_N` id is assigned downstream by first appearance.
        speakerLabel: `cluster_${segment.speaker}`,
        startTime: segment.start,
        endTime: segment.end,
        confidence: null,
        metadata: { model: this.model },
      }),
    );

    return {
      regions,
      provider: {
        id: this.id,
        model: this.model,
        metadata: {
          clusterThreshold: this.clusterThreshold,
          requestedSpeakerCount: numClusters > 0 ? numClusters : null,
        },
      },
    };
  }

  private throwIfAborted(context: SpeakerDiarizationContext): void {
    if (context.signal?.aborted) {
      throw diarizationError("DIARIZATION_CANCELLED");
    }
  }
}
