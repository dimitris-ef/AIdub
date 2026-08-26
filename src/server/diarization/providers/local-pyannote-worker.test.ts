import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DiarizationWorkerAborted,
  DiarizationWorkerError,
  runDiarizationWorker,
  type DiarizationWorkerRequest,
} from "@/server/diarization/providers/local-pyannote-worker";

/**
 * The worker boundary itself, exercised without any model files.
 *
 * These cover the paths that must behave correctly whether or not the optional
 * runtime is installed: a missing model file must fail as a reportable error
 * rather than hanging or crashing the process, and an abort must reject
 * promptly instead of waiting for the blocking native call to finish.
 */

function request(
  overrides: Partial<DiarizationWorkerRequest> = {},
): DiarizationWorkerRequest {
  return {
    projectRoot: process.cwd(),
    audioPath: path.join(process.cwd(), "does-not-exist.wav"),
    segmentationModel: path.join(process.cwd(), "missing-segmentation.onnx"),
    embeddingModel: path.join(process.cwd(), "missing-embedding.onnx"),
    numClusters: -1,
    clusterThreshold: 0.8,
    numThreads: 1,
    expectedSampleRate: 16_000,
    ...overrides,
  };
}

describe("runDiarizationWorker", () => {
  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runDiarizationWorker(request(), controller.signal),
    ).rejects.toBeInstanceOf(DiarizationWorkerAborted);
  });

  it("reports a structured failure instead of crashing on unreadable audio", async () => {
    await expect(runDiarizationWorker(request())).rejects.toBeInstanceOf(
      DiarizationWorkerError,
    );
  });

  it("never leaks a filesystem path into the reported message", async () => {
    try {
      await runDiarizationWorker(request());
      throw new Error("expected a failure");
    } catch (cause) {
      expect(cause).toBeInstanceOf(DiarizationWorkerError);
      expect((cause as DiarizationWorkerError).message).not.toContain(
        process.cwd(),
      );
    }
  }, 30_000);

  it("aborts a run in flight rather than waiting for it", async () => {
    const controller = new AbortController();
    const running = runDiarizationWorker(request(), controller.signal);

    controller.abort();

    await expect(running).rejects.toBeInstanceOf(DiarizationWorkerAborted);
  }, 30_000);
});
