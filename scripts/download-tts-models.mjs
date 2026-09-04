#!/usr/bin/env node
/**
 * Downloads the local text-to-speech voices used by the `local-vits` provider
 * into AIDUB_TTS_MODEL_DIR (default `.aidub/tts-models`, gitignored).
 *
 * These are public VITS/Piper ONNX exports served from a GitHub release: no
 * account, no access token and no GPU are required, and nothing here is needed
 * to build or run Aidub — without the models the provider simply reports itself
 * unavailable and the Voices workspace says so. Weights are never committed.
 *
 * One model per language is enough to speak it; a *multi-speaker* model is what
 * gives several distinct voices for the same language, which is what makes
 * per-speaker voice assignment meaningful. The catalogue in
 * `src/server/tts/providers/local-vits-catalog.ts` names which speakers of each
 * model are offered as voices.
 */
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const RELEASES =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models";

/**
 * Kept deliberately small. Every entry is a Piper VITS export with the same
 * on-disk layout, so the provider needs one loader rather than one per vendor.
 */
const MODELS = [
  {
    // Multi-speaker: many distinct English voices from a single download.
    directory: "vits-piper-en_US-libritts_r-medium",
    archive: "vits-piper-en_US-libritts_r-medium.tar.bz2",
  },
  {
    directory: "vits-piper-pl_PL-darkman-medium",
    archive: "vits-piper-pl_PL-darkman-medium.tar.bz2",
  },
  {
    directory: "vits-piper-pl_PL-gosia-medium",
    archive: "vits-piper-pl_PL-gosia-medium.tar.bz2",
  },
];

const modelDir =
  process.env.AIDUB_TTS_MODEL_DIR ??
  path.join(process.cwd(), ".aidub", "tts-models");

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

  for (const model of MODELS) {
    const target = path.join(modelDir, model.directory);

    if (await exists(path.join(target, "tokens.txt"))) {
      process.stdout.write(`· ${model.directory} already present\n`);
      continue;
    }

    const archive = path.join(modelDir, model.archive);
    await download(`${RELEASES}/${model.archive}`, archive);
    await run("tar", ["xjf", archive, "-C", modelDir]);
    await rm(archive, { force: true });
  }

  process.stdout.write(`✓ TTS voices ready in ${modelDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
