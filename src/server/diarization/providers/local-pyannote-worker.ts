import { Worker } from "node:worker_threads";

/**
 * Runs the local diarization model on a worker thread.
 *
 * The model's analysis is a single blocking native call. On the main thread it
 * would freeze the Node event loop for seconds — no request served, including
 * the cancel the user just clicked. Moving it off-thread keeps the web process
 * responsive and makes cancellation real: aborting terminates the worker.
 *
 * The worker body is passed as source rather than loaded from a file, so it
 * survives bundling: there is no build-time asset to copy and no path to
 * resolve at runtime. It resolves the optional native runtime from the project
 * root itself, exactly as the availability check does.
 *
 * Cancellation detaches rather than kills. The native call cannot be
 * interrupted, and terminating a worker in the middle of it tears down a
 * thread the addon is still using, which aborts the entire process. So an
 * aborted run frees the caller immediately and abandons the worker: it
 * finishes on its own, its result is never read, and being unref'd it holds
 * nothing open. The cost is that the abandoned analysis keeps using CPU until
 * it ends — a documented limitation of running the model in-process, and one
 * that disappears once the model runs on a real external worker.
 */

export interface DiarizationWorkerRequest {
  projectRoot: string;
  audioPath: string;
  segmentationModel: string;
  embeddingModel: string;
  numClusters: number;
  clusterThreshold: number;
  numThreads: number;
  expectedSampleRate: number;
}

export interface DiarizationWorkerSegment {
  start: number;
  end: number;
  speaker: number;
}

/** Failure kinds the worker can report, mapped to error codes by the caller. */
export type DiarizationWorkerFailure =
  | "runtime_unavailable"
  | "unsupported_audio"
  | "analysis_failed";

export class DiarizationWorkerError extends Error {
  constructor(
    readonly kind: DiarizationWorkerFailure,
    message: string,
  ) {
    super(message);
    this.name = "DiarizationWorkerError";
  }
}

/** Raised when the caller's signal aborts before the worker finishes. */
export class DiarizationWorkerAborted extends Error {
  constructor() {
    super("Diarization was cancelled.");
    this.name = "DiarizationWorkerAborted";
  }
}

const WORKER_SOURCE = /* js */ `
const { parentPort, workerData } = require("node:worker_threads");
const { createRequire } = require("node:module");
const path = require("node:path");

function fail(kind, message) {
  parentPort.postMessage({ ok: false, kind, message });
}

function main() {
  let sherpa;
  try {
    const requireOptional = createRequire(
      path.join(workerData.projectRoot, "package.json"),
    );
    sherpa = requireOptional("sherpa-onnx-node");
  } catch (cause) {
    fail("runtime_unavailable", "the local diarization runtime is not installed");
    return;
  }

  let wave;
  try {
    wave = sherpa.readWave(workerData.audioPath);
  } catch (cause) {
    fail("unsupported_audio", "the audio file could not be read");
    return;
  }

  if (wave.sampleRate !== workerData.expectedSampleRate) {
    fail(
      "unsupported_audio",
      "expected " + workerData.expectedSampleRate + " Hz audio, received " + wave.sampleRate + " Hz",
    );
    return;
  }

  let diarizer;
  try {
    diarizer = new sherpa.OfflineSpeakerDiarization({
      segmentation: {
        pyannote: { model: workerData.segmentationModel },
        numThreads: workerData.numThreads,
        provider: "cpu",
        debug: false,
      },
      embedding: {
        model: workerData.embeddingModel,
        numThreads: workerData.numThreads,
        provider: "cpu",
        debug: false,
      },
      clustering: {
        numClusters: workerData.numClusters,
        threshold: workerData.clusterThreshold,
      },
      minDurationOn: 0.3,
      minDurationOff: 0.5,
    });
  } catch (cause) {
    fail("runtime_unavailable", "the local diarization model could not be loaded");
    return;
  }

  const segments = diarizer.process(wave.samples);

  parentPort.postMessage({
    ok: true,
    segments: segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      speaker: segment.speaker,
    })),
  });
}

try {
  main();
} catch (cause) {
  fail("analysis_failed", "the local diarization model failed while analysing the audio");
}
`;

export function runDiarizationWorker(
  request: DiarizationWorkerRequest,
  signal?: AbortSignal,
): Promise<DiarizationWorkerSegment[]> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DiarizationWorkerAborted());
      return;
    }

    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: request,
    });

    // The worker must never keep the process alive on its own account.
    worker.unref();

    let settled = false;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      // The worker is left to finish and exit by itself. Terminating it while
      // the native model call is running aborts the whole process (the addon
      // throws from a thread that is being torn down), so a cancelled run is
      // detached rather than killed: its result is never read, and the caller
      // is freed immediately.
      action();
    };

    function onAbort() {
      finish(() => reject(new DiarizationWorkerAborted()));
    }

    signal?.addEventListener("abort", onAbort, { once: true });

    worker.on("message", (message: unknown) => {
      const payload = message as
        | { ok: true; segments: DiarizationWorkerSegment[] }
        | { ok: false; kind: DiarizationWorkerFailure; message: string };

      if (payload && payload.ok) {
        finish(() => resolve(payload.segments));
        return;
      }

      finish(() =>
        reject(
          new DiarizationWorkerError(
            payload?.kind ?? "analysis_failed",
            payload?.message ?? "the local diarization model failed",
          ),
        ),
      );
    });

    worker.on("error", (cause: Error) => {
      finish(() =>
        reject(new DiarizationWorkerError("analysis_failed", cause.message)),
      );
    });

    worker.on("exit", (code) => {
      // A worker that exits without a message failed in a way it could not
      // report — a native crash, or an out-of-memory kill.
      finish(() =>
        reject(
          new DiarizationWorkerError(
            "analysis_failed",
            `the diarization worker exited unexpectedly (code ${code})`,
          ),
        ),
      );
    });
  });
}
