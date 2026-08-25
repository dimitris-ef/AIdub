import { spawn, type ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import type { ProbeMediaResult } from "@/types/processing-job";
import { ProcessingError } from "@/server/processing/processing-errors";
import { summarizeProcessOutput } from "@/server/processing/processing-errors";
import {
  CANONICAL_AUDIO,
  type ConvertMediaInput,
  type ConvertMediaResult,
  type ExtractAudioInput,
  type ExtractAudioResult,
  type MediaProcessor,
  type ProbeMediaInput,
  type ProcessingCapabilities,
  type ProcessingContext,
} from "@/server/processing/media-processor";

/**
 * The one and only place that knows FFmpeg exists.
 *
 * Binary paths, argument arrays, stdout/stderr parsing, exit codes, signals
 * and process termination all stop here. Nothing above this file may import
 * `child_process` for media work, and no command is ever built as a shell
 * string — arguments are always arrays, so filenames cannot be interpolated
 * into a shell.
 */

const PROBE_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 4_000;

export interface FfmpegMediaProcessorOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
}

interface ProcessRunResult {
  stdout: string;
  stderr: string;
}

/**
 * Resolution order for the binaries:
 *   1. FFMPEG_PATH / FFPROBE_PATH environment variables
 *   2. the optional @ffmpeg-installer / @ffprobe-installer dev packages
 *   3. `ffmpeg` / `ffprobe` from PATH
 * Never a hard-coded machine-specific path.
 */
export function resolveBinaryPath(
  kind: "ffmpeg" | "ffprobe",
  explicitPath?: string,
): string {
  if (explicitPath) {
    return explicitPath;
  }

  const fromEnv =
    kind === "ffmpeg" ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;

  if (fromEnv) {
    return fromEnv;
  }

  const installerModule =
    kind === "ffmpeg"
      ? "@ffmpeg-installer/ffmpeg"
      : "@ffprobe-installer/ffprobe";

  try {
    // Optional: absent in environments that provide the binaries themselves.
    // Resolved from the project root at runtime (not from this module's
    // bundled location) so the web bundle never hard-depends on it.
    const requireOptional = createRequire(
      path.join(process.cwd(), "package.json"),
    );
    const resolved = requireOptional(installerModule) as { path?: string };

    if (resolved?.path) {
      return resolved.path;
    }
  } catch {
    // Fall through to PATH lookup.
  }

  return kind;
}

export function parseFrameRate(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  // FFprobe reports rationals such as "30000/1001" or "15/1".
  const [numerator, denominator] = value.split("/");
  const top = Number(numerator);
  const bottom = denominator === undefined ? 1 : Number(denominator);

  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) {
    return null;
  }

  const frameRate = top / bottom;

  return frameRate > 0 ? Math.round(frameRate * 1000) / 1000 : null;
}

function optionalNumber(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;

  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0
    ? parsed
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function buildProbeArgs(inputPath: string): string[] {
  return [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    inputPath,
  ];
}

/**
 * Parses FFprobe's JSON output defensively: any stream, duration, dimension
 * or rate that is missing or unparseable becomes `null` rather than a guess.
 */
export function parseProbeOutput(raw: string): ProbeMediaResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ProcessingError(
      "PROBE_FAILED",
      "The source media could not be inspected.",
      { details: "unreadable ffprobe output", cause },
    );
  }

  const root = (parsed ?? {}) as {
    streams?: unknown;
    format?: Record<string, unknown>;
  };
  const streams = Array.isArray(root.streams)
    ? (root.streams as Record<string, unknown>[])
    : [];
  const format = (root.format ?? {}) as Record<string, unknown>;

  const videoStream = streams.find(
    (stream) => stream.codec_type === "video",
  );
  const audioStream = streams.find(
    (stream) => stream.codec_type === "audio",
  );

  return {
    durationSeconds: optionalNumber(format.duration),
    container: optionalString(format.format_name),
    sizeBytes: optionalNumber(format.size),
    video: videoStream
      ? {
          codec: optionalString(videoStream.codec_name),
          width: optionalNumber(videoStream.width),
          height: optionalNumber(videoStream.height),
          frameRate:
            parseFrameRate(videoStream.avg_frame_rate) ??
            parseFrameRate(videoStream.r_frame_rate),
        }
      : null,
    audio: audioStream
      ? {
          codec: optionalString(audioStream.codec_name),
          sampleRate: optionalNumber(audioStream.sample_rate),
          channels: optionalNumber(audioStream.channels),
        }
      : null,
  };
}

export function buildExtractAudioArgs(input: ExtractAudioInput): string[] {
  const sampleRate = input.sampleRate ?? CANONICAL_AUDIO.sampleRate;
  const channels = input.channels ?? CANONICAL_AUDIO.channels;

  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-progress",
    "pipe:1",
    "-y",
    "-i",
    input.inputPath,
    "-vn",
    "-map",
    "0:a:0",
    "-ac",
    String(channels),
    "-ar",
    String(sampleRate),
    "-c:a",
    CANONICAL_AUDIO.codec,
    "-f",
    "wav",
    input.outputPath,
  ];
}

export function buildConvertArgs(input: ConvertMediaInput): string[] {
  const args = [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-progress",
    "pipe:1",
    "-y",
    ...(input.inputArgs ?? []),
    "-i",
    input.inputPath,
  ];

  if (input.audio) {
    args.push("-vn", "-c:a", input.audio.codec);

    if (input.audio.channels) {
      args.push("-ac", String(input.audio.channels));
    }
    if (input.audio.sampleRate) {
      args.push("-ar", String(input.audio.sampleRate));
    }
  }

  if (input.extraArgs?.length) {
    args.push(...input.extraArgs);
  }

  args.push(input.outputPath);

  return args;
}

/**
 * Reads FFmpeg's machine-readable `-progress pipe:1` output. Returns the
 * elapsed output time in seconds, or null for lines that carry none.
 */
export function parseProgressTimeSeconds(chunk: string): number | null {
  let latest: number | null = null;

  for (const line of chunk.split(/\r?\n/)) {
    const [key, value] = line.split("=");

    if (!key || value === undefined) {
      continue;
    }

    if (key.trim() === "out_time_us" || key.trim() === "out_time_ms") {
      const micros = Number(value.trim());
      // Both keys are reported in microseconds by FFmpeg.
      if (Number.isFinite(micros) && micros >= 0) {
        latest = micros / 1_000_000;
      }
    }
  }

  return latest;
}

export class FfmpegMediaProcessor implements MediaProcessor {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private capabilities: Promise<ProcessingCapabilities> | null = null;

  constructor(options: FfmpegMediaProcessorOptions = {}) {
    this.ffmpegPath = resolveBinaryPath("ffmpeg", options.ffmpegPath);
    this.ffprobePath = resolveBinaryPath("ffprobe", options.ffprobePath);
  }

  getCapabilities(): Promise<ProcessingCapabilities> {
    // Checked once per process, not per job.
    this.capabilities ??= this.detectCapabilities();

    return this.capabilities;
  }

  private async detectCapabilities(): Promise<ProcessingCapabilities> {
    const [ffmpegVersion, ffprobeVersion] = await Promise.all([
      this.readVersion(this.ffmpegPath),
      this.readVersion(this.ffprobePath),
    ]);

    return {
      ffmpegAvailable: ffmpegVersion !== null,
      ffprobeAvailable: ffprobeVersion !== null,
      ffmpegVersion,
      ffprobeVersion,
    };
  }

  private async readVersion(binaryPath: string): Promise<string | null> {
    try {
      const { stdout } = await this.run(binaryPath, ["-version"], {
        timeoutMs: 10_000,
      });

      return stdout.split(/\r?\n/)[0]?.trim() || null;
    } catch {
      return null;
    }
  }

  async probe(
    input: ProbeMediaInput,
    context: ProcessingContext = {},
  ): Promise<ProbeMediaResult> {
    await this.requireFfprobe();

    const { stdout, stderr } = await this.run(
      this.ffprobePath,
      buildProbeArgs(input.inputPath),
      {
        signal: context.signal,
        timeoutMs: PROBE_TIMEOUT_MS,
        failureCode: "PROBE_FAILED",
        failureMessage: "The source media could not be inspected.",
      },
    ).catch((error: unknown) => {
      throw error;
    });

    if (!stdout.trim()) {
      throw new ProcessingError(
        "PROBE_FAILED",
        "The source media could not be inspected.",
        { details: summarizeProcessOutput(stderr) },
      );
    }

    return parseProbeOutput(stdout);
  }

  async extractAudio(
    input: ExtractAudioInput,
    context: ProcessingContext = {},
  ): Promise<ExtractAudioResult> {
    await this.requireFfmpeg();

    const sampleRate = input.sampleRate ?? CANONICAL_AUDIO.sampleRate;
    const channels = input.channels ?? CANONICAL_AUDIO.channels;

    await this.run(this.ffmpegPath, buildExtractAudioArgs(input), {
      signal: context.signal,
      failureCode: "AUDIO_EXTRACTION_FAILED",
      failureMessage: "Audio extraction failed.",
      onStdout: (chunk) => reportProgress(chunk, input.durationSeconds, context),
    });

    const { size } = await stat(input.outputPath);

    if (size <= 0) {
      throw new ProcessingError(
        "AUDIO_EXTRACTION_FAILED",
        "Audio extraction produced an empty file.",
      );
    }

    return {
      outputPath: input.outputPath,
      sampleRate,
      channels,
      sizeBytes: size,
      durationSeconds: input.durationSeconds ?? null,
    };
  }

  async convert(
    input: ConvertMediaInput,
    context: ProcessingContext = {},
  ): Promise<ConvertMediaResult> {
    await this.requireFfmpeg();

    await this.run(this.ffmpegPath, buildConvertArgs(input), {
      signal: context.signal,
      failureCode: "CONVERSION_FAILED",
      failureMessage: "Media conversion failed.",
      onStdout: (chunk) => reportProgress(chunk, input.durationSeconds, context),
    });

    const { size } = await stat(input.outputPath);

    return { outputPath: input.outputPath, sizeBytes: size };
  }

  private async requireFfmpeg(): Promise<void> {
    const { ffmpegAvailable } = await this.getCapabilities();

    if (!ffmpegAvailable) {
      throw new ProcessingError(
        "FFMPEG_NOT_AVAILABLE",
        "FFmpeg is not available on the processing server.",
      );
    }
  }

  private async requireFfprobe(): Promise<void> {
    const { ffprobeAvailable } = await this.getCapabilities();

    if (!ffprobeAvailable) {
      throw new ProcessingError(
        "FFPROBE_NOT_AVAILABLE",
        "FFprobe is not available on the processing server.",
      );
    }
  }

  /**
   * Spawns a binary with an argument array (never a shell), streams its
   * output, and terminates it on abort or timeout — gracefully first, then
   * forcefully — so no child process is left orphaned.
   */
  private run(
    binaryPath: string,
    args: readonly string[],
    options: {
      signal?: AbortSignal;
      timeoutMs?: number;
      failureCode?: ProcessingError["code"];
      failureMessage?: string;
      onStdout?: (chunk: string) => void;
    } = {},
  ): Promise<ProcessRunResult> {
    const {
      signal,
      timeoutMs,
      failureCode = "INTERNAL_ERROR",
      failureMessage = "Processing failed.",
      onStdout,
    } = options;

    return new Promise<ProcessRunResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new ProcessingError("CANCELLED", "The job was cancelled."));
        return;
      }

      let child: ChildProcess;
      try {
        child = spawn(binaryPath, [...args], {
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (cause) {
        reject(
          new ProcessingError(
            "FFMPEG_NOT_AVAILABLE",
            "FFmpeg is not available on the processing server.",
            { cause },
          ),
        );
        return;
      }

      let stdout = "";
      let stderr = "";
      let settled = false;
      let cancelled = false;
      let killTimer: NodeJS.Timeout | undefined;
      let timeoutTimer: NodeJS.Timeout | undefined;

      const terminate = () => {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
        killTimer.unref?.();
      };

      const onAbort = () => {
        cancelled = true;
        terminate();
      };

      signal?.addEventListener("abort", onAbort, { once: true });

      if (timeoutMs) {
        timeoutTimer = setTimeout(() => {
          cancelled = false;
          terminate();
        }, timeoutMs);
        timeoutTimer.unref?.();
      }

      const finish = (error: ProcessingError | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        clearTimeout(timeoutTimer);
        signal?.removeEventListener("abort", onAbort);

        if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      };

      child.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        onStdout?.(chunk);
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("error", (cause) => {
        finish(
          new ProcessingError(
            "FFMPEG_NOT_AVAILABLE",
            "FFmpeg is not available on the processing server.",
            { details: `${binaryPath} could not be started`, cause },
          ),
        );
      });

      child.on("close", (code) => {
        if (cancelled) {
          finish(new ProcessingError("CANCELLED", "The job was cancelled."));
          return;
        }

        if (code === 0) {
          finish(null);
          return;
        }

        if (mentionsMissingAudioStream(stderr)) {
          finish(
            new ProcessingError(
              "NO_AUDIO_STREAM",
              "No audio track was found in this source video.",
            ),
          );
          return;
        }

        finish(
          new ProcessingError(failureCode, failureMessage, {
            details: summarizeProcessOutput(stderr),
          }),
        );
      });
    });
  }
}

function reportProgress(
  chunk: string,
  durationSeconds: number | null | undefined,
  context: ProcessingContext,
): void {
  if (!context.onProgress || !durationSeconds || durationSeconds <= 0) {
    return;
  }

  const elapsed = parseProgressTimeSeconds(chunk);

  if (elapsed === null) {
    return;
  }

  context.onProgress((elapsed / durationSeconds) * 100);
}

/** FFmpeg's wording when `-map 0:a:0` finds no audio track. */
export function mentionsMissingAudioStream(stderr: string): boolean {
  return /matches no streams|does not contain any stream|Output file (#\d+ )?does not contain any stream/i.test(
    stderr,
  );
}
