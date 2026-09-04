import { Worker } from "node:worker_threads";

/**
 * Runs the local VITS model on a worker thread.
 *
 * Synthesis is a single blocking native call — hundreds of milliseconds for one
 * line, and a full project is hundreds of lines. On the main thread that would
 * freeze the Node event loop for the whole run: no request served, including
 * the cancel the user just clicked, and no progress reported.
 *
 * The worker body is passed as source rather than loaded from a file, so it
 * survives bundling: there is no build-time asset to copy and no path to resolve
 * at runtime. It resolves the optional native runtime from the project root
 * itself, exactly as the availability check does.
 *
 * Cancellation detaches rather than kills, for the same reason as diarization:
 * the native call cannot be interrupted, and terminating a worker in the middle
 * of it tears down a thread the addon is still using, which aborts the entire
 * process. An aborted line frees the caller immediately and abandons the
 * worker; it finishes on its own, its result is never read, and being unref'd it
 * holds nothing open.
 *
 * One worker per line rather than one long-lived worker holding a loaded model:
 * model load dominates only the first call, and a pool that survives
 * cancellation would have to keep a detached thread's model alive with no way to
 * know when it is safe to reuse. Correct cancellation is worth the reload.
 */

export interface TtsWorkerRequest {
  projectRoot: string;
  modelPath: string;
  tokensPath: string;
  dataDir: string;
  speakerId: number;
  text: string;
  /** VITS speed multiplier. 1.0 is the model's own pace. */
  speed: number;
  numThreads: number;
}

export interface TtsWorkerResult {
  /** 16-bit PCM WAV bytes. */
  wav: Uint8Array;
  sampleRate: number;
  durationSeconds: number;
}

/** Failure kinds the worker can report, mapped to error codes by the caller. */
export type TtsWorkerFailure =
  | "runtime_unavailable"
  | "model_unavailable"
  | "synthesis_failed"
  | "empty_audio";

export class TtsWorkerError extends Error {
  constructor(
    readonly kind: TtsWorkerFailure,
    message: string,
  ) {
    super(message);
    this.name = "TtsWorkerError";
  }
}

/** Raised when the caller's signal aborts before the worker finishes. */
export class TtsWorkerAborted extends Error {
  constructor() {
    super("Speech generation was cancelled.");
    this.name = "TtsWorkerAborted";
  }
}

const WORKER_SOURCE = /* js */ `
const { parentPort, workerData } = require("node:worker_threads");
const { createRequire } = require("node:module");
const path = require("node:path");

function fail(kind, message) {
  parentPort.postMessage({ ok: false, kind, message });
}

/**
 * Encodes float samples as a 16-bit PCM WAV.
 *
 * The runtime's own writeWave() only writes to a file path, and this audio is
 * bound for artifact storage rather than a location on this machine. Encoding
 * in memory keeps the worker from inventing temp files it would then have to
 * clean up, and keeps every backend path out of what the caller receives.
 */
function encodeWav(samples, sampleRate) {
  const channels = 1;
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);

  for (let index = 0; index < samples.length; index += 1) {
    // Clamp before scaling: a model can overshoot [-1, 1] and wrapping a
    // 16-bit integer turns a loud sample into a click.
    const sample = Math.max(-1, Math.min(1, samples[index]));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }

  return buffer;
}

function main() {
  let sherpa;
  try {
    const requireOptional = createRequire(
      path.join(workerData.projectRoot, "package.json"),
    );
    sherpa = requireOptional("sherpa-onnx-node");
  } catch (cause) {
    fail("runtime_unavailable", "the local speech runtime is not installed");
    return;
  }

  let tts;
  try {
    tts = new sherpa.OfflineTts({
      model: {
        vits: {
          model: workerData.modelPath,
          tokens: workerData.tokensPath,
          dataDir: workerData.dataDir,
        },
        numThreads: workerData.numThreads,
        debug: false,
        provider: "cpu",
      },
      maxNumSentences: 1,
    });
  } catch (cause) {
    fail("model_unavailable", "the local speech model could not be loaded");
    return;
  }

  const audio = tts.generate({
    text: workerData.text,
    sid: workerData.speakerId,
    speed: workerData.speed,
  });

  if (!audio || !audio.samples || audio.samples.length === 0) {
    fail("empty_audio", "the local speech model produced no audio");
    return;
  }

  const wav = encodeWav(audio.samples, audio.sampleRate);

  parentPort.postMessage(
    {
      ok: true,
      wav,
      sampleRate: audio.sampleRate,
      durationSeconds: audio.samples.length / audio.sampleRate,
    },
  );
}

try {
  main();
} catch (cause) {
  fail("synthesis_failed", "the local speech model failed while synthesising");
}
`;

export function runTtsWorker(
  request: TtsWorkerRequest,
  signal?: AbortSignal,
): Promise<TtsWorkerResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TtsWorkerAborted());
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
      // Left to finish and exit by itself — see the note at the top of the
      // file on why a cancelled run is detached rather than terminated.
      action();
    };

    function onAbort() {
      finish(() => reject(new TtsWorkerAborted()));
    }

    signal?.addEventListener("abort", onAbort, { once: true });

    worker.on("message", (message: unknown) => {
      const payload = message as
        | {
            ok: true;
            wav: Uint8Array;
            sampleRate: number;
            durationSeconds: number;
          }
        | { ok: false; kind: TtsWorkerFailure; message: string };

      if (payload && payload.ok) {
        finish(() =>
          resolve({
            wav: new Uint8Array(payload.wav),
            sampleRate: payload.sampleRate,
            durationSeconds:
              Math.round(payload.durationSeconds * 1000) / 1000,
          }),
        );
        return;
      }

      finish(() =>
        reject(
          new TtsWorkerError(
            payload?.kind ?? "synthesis_failed",
            payload?.message ?? "the local speech model failed",
          ),
        ),
      );
    });

    worker.on("error", (cause: Error) => {
      finish(() => reject(new TtsWorkerError("synthesis_failed", cause.message)));
    });

    worker.on("exit", (code) => {
      // A worker that exits without a message failed in a way it could not
      // report — a native crash, or an out-of-memory kill.
      finish(() =>
        reject(
          new TtsWorkerError(
            "synthesis_failed",
            `the speech worker exited unexpectedly (code ${code})`,
          ),
        ),
      );
    });
  });
}
