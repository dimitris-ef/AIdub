#!/usr/bin/env node
/**
 * Downloads the local speaker-diarization model files used by the
 * `local-pyannote` provider into AIDUB_DIARIZATION_MODEL_DIR (default
 * `.aidub/diarization-models`, gitignored).
 *
 * Both models are public ONNX exports served from a GitHub release: no
 * Hugging Face account, no access token and no GPU are required, and nothing
 * here is needed to build or run Aidub — without the models the provider
 * simply reports itself unavailable. Weights are never committed.
 *
 *   segmentation.onnx   pyannote/segmentation-3.0 (MIT), ONNX export
 *   embedding.onnx      NeMo TitaNet-small speaker embeddings
 *
 * The multi-speaker fixture is public test audio used by the provider
 * integration test; it is optional and the test skips without it.
 */
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const RELEASES = "https://github.com/k2-fsa/sherpa-onnx/releases/download";
const SEGMENTATION_ARCHIVE = "sherpa-onnx-pyannote-segmentation-3-0.tar.bz2";
const EMBEDDING_FILE = "nemo_en_titanet_small.onnx";
const SPEECH_FIXTURE = "0-four-speakers-zh.wav";

const modelDir =
  process.env.AIDUB_DIARIZATION_MODEL_DIR ??
  path.join(process.cwd(), ".aidub", "diarization-models");

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  process.stdout.write(`↓ ${path.basename(destination)}\n`);
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }

  await pipeline(response.body, createWriteStream(destination));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}

async function main() {
  await mkdir(modelDir, { recursive: true });

  const segmentation = path.join(modelDir, "segmentation.onnx");
  if (!(await exists(segmentation))) {
    const archive = path.join(modelDir, SEGMENTATION_ARCHIVE);
    await download(
      `${RELEASES}/speaker-segmentation-models/${SEGMENTATION_ARCHIVE}`,
      archive,
    );
    await run("tar", ["xjf", archive, "-C", modelDir]);
    await rm(archive, { force: true });

    const extracted = path.join(modelDir, "sherpa-onnx-pyannote-segmentation-3-0");
    // The provider expects a stable layout, not one vendor's directory names.
    await rename(path.join(extracted, "model.onnx"), segmentation);
    await rm(extracted, { recursive: true, force: true });
  }

  const embedding = path.join(modelDir, "embedding.onnx");
  if (!(await exists(embedding))) {
    await download(
      `${RELEASES}/speaker-recongition-models/${EMBEDDING_FILE}`,
      embedding,
    );
  }

  const fixture = path.join(modelDir, "..", "fixtures", "speakers.wav");
  if (!(await exists(fixture))) {
    await mkdir(path.dirname(fixture), { recursive: true });
    try {
      await download(
        `${RELEASES}/speaker-segmentation-models/${SPEECH_FIXTURE}`,
        fixture,
      );
    } catch {
      // Optional: the integration test skips when the fixture is absent.
      process.stdout.write(
        "· multi-speaker fixture unavailable (integration test will skip)\n",
      );
    }
  }

  process.stdout.write(`✓ Diarization models ready in ${modelDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
