#!/usr/bin/env node
/**
 * Downloads the local speech-to-text model files used by the `local-whisper`
 * provider into AIDUB_STT_MODEL_DIR (default `.aidub/stt-models`, gitignored).
 *
 * Nothing here is required to build or run Aidub — without the models the
 * provider simply reports itself unavailable. Weights are never committed.
 */
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models";
const WHISPER_ARCHIVE = "sherpa-onnx-whisper-tiny.en.tar.bz2";
const VAD_FILE = "silero_vad.onnx";
/** Public-domain speech sample used by the provider integration test. */
const SPEECH_FIXTURE =
  "https://raw.githubusercontent.com/ggerganov/whisper.cpp/master/samples/jfk.wav";

const modelDir =
  process.env.AIDUB_STT_MODEL_DIR ?? path.join(process.cwd(), ".aidub", "stt-models");

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
  await mkdir(path.join(modelDir, "whisper"), { recursive: true });

  const vadPath = path.join(modelDir, VAD_FILE);
  if (!(await exists(vadPath))) {
    await download(`${RELEASE}/${VAD_FILE}`, vadPath);
  }

  const encoder = path.join(modelDir, "whisper", "encoder.onnx");
  if (!(await exists(encoder))) {
    const archive = path.join(modelDir, WHISPER_ARCHIVE);
    await download(`${RELEASE}/${WHISPER_ARCHIVE}`, archive);
    await run("tar", ["xjf", archive, "-C", modelDir]);
    await rm(archive, { force: true });

    const extracted = path.join(modelDir, "sherpa-onnx-whisper-tiny.en");
    // The provider expects a stable layout, not one vendor's directory names.
    await rename(path.join(extracted, "tiny.en-encoder.int8.onnx"), encoder);
    await rename(
      path.join(extracted, "tiny.en-decoder.int8.onnx"),
      path.join(modelDir, "whisper", "decoder.onnx"),
    );
    await rename(
      path.join(extracted, "tiny.en-tokens.txt"),
      path.join(modelDir, "whisper", "tokens.txt"),
    );
    await rm(extracted, { recursive: true, force: true });
  }

  const fixture = path.join(modelDir, "..", "fixtures", "speech.wav");
  if (!(await exists(fixture))) {
    await mkdir(path.dirname(fixture), { recursive: true });
    try {
      await download(SPEECH_FIXTURE, fixture);
    } catch {
      // Optional: the integration test skips when the fixture is absent.
      process.stdout.write("· speech fixture unavailable (integration test will skip)\n");
    }
  }

  process.stdout.write(`✓ Speech models ready in ${modelDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
