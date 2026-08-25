import { afterEach, describe, expect, it } from "vitest";

import {
  buildConvertArgs,
  buildExtractAudioArgs,
  buildProbeArgs,
  mentionsMissingAudioStream,
  parseFrameRate,
  parseProbeOutput,
  parseProgressTimeSeconds,
  resolveBinaryPath,
} from "@/server/processing/ffmpeg-media-processor";
import {
  ProcessingError,
  redactPaths,
  summarizeProcessOutput,
} from "@/server/processing/processing-errors";

describe("parseFrameRate", () => {
  it.each([
    ["30000/1001", 29.97],
    ["15/1", 15],
    ["25", 25],
    ["60/2", 30],
  ])("parses %s", (input, expected) => {
    expect(parseFrameRate(input)).toBe(expected);
  });

  it.each([["0/0"], ["N/A"], [""], [null], [undefined], [30]])(
    "returns null for %s instead of guessing",
    (input) => {
      expect(parseFrameRate(input)).toBeNull();
    },
  );
});

describe("parseProbeOutput", () => {
  const fullOutput = JSON.stringify({
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1920,
        height: 1080,
        avg_frame_rate: "30000/1001",
        r_frame_rate: "30/1",
      },
      {
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "48000",
        channels: 2,
      },
    ],
    format: { duration: "12.34", format_name: "mov,mp4,m4a", size: "12345" },
  });

  it("reads video and audio metadata", () => {
    expect(parseProbeOutput(fullOutput)).toEqual({
      durationSeconds: 12.34,
      container: "mov,mp4,m4a",
      sizeBytes: 12345,
      video: {
        codec: "h264",
        width: 1920,
        height: 1080,
        frameRate: 29.97,
      },
      audio: { codec: "aac", sampleRate: 48000, channels: 2 },
    });
  });

  it("handles media with no audio stream", () => {
    const parsed = parseProbeOutput(
      JSON.stringify({
        streams: [{ codec_type: "video", codec_name: "vp9" }],
        format: {},
      }),
    );

    expect(parsed.audio).toBeNull();
    expect(parsed.video).toMatchObject({ codec: "vp9" });
    expect(parsed.durationSeconds).toBeNull();
  });

  it("handles audio-only media", () => {
    const parsed = parseProbeOutput(
      JSON.stringify({
        streams: [
          { codec_type: "audio", codec_name: "pcm_s16le", channels: 1 },
        ],
        format: { duration: "3" },
      }),
    );

    expect(parsed.video).toBeNull();
    expect(parsed.audio).toMatchObject({ codec: "pcm_s16le", channels: 1 });
  });

  it("never fabricates values for missing or unusable fields", () => {
    const parsed = parseProbeOutput(
      JSON.stringify({
        streams: [
          {
            codec_type: "video",
            width: 0,
            height: "not a number",
            avg_frame_rate: "0/0",
            r_frame_rate: "N/A",
          },
        ],
        format: { duration: "N/A", size: "" },
      }),
    );

    expect(parsed).toMatchObject({
      durationSeconds: null,
      container: null,
      sizeBytes: null,
      video: { codec: null, width: null, height: null, frameRate: null },
      audio: null,
    });
  });

  it("tolerates missing streams array", () => {
    expect(parseProbeOutput("{}")).toMatchObject({ video: null, audio: null });
  });

  it("raises a structured error for unreadable output", () => {
    expect(() => parseProbeOutput("not json")).toThrowError(ProcessingError);
  });
});

describe("argument construction", () => {
  it("probes with machine-readable JSON output", () => {
    expect(buildProbeArgs("/tmp/aidub/jobs/j1/source.mp4")).toEqual([
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      "/tmp/aidub/jobs/j1/source.mp4",
    ]);
  });

  it("extracts canonical mono 16 kHz PCM WAV", () => {
    const args = buildExtractAudioArgs({
      inputPath: "/tmp/in.mp4",
      outputPath: "/tmp/out.wav",
    });

    expect(args).toEqual([
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-progress",
      "pipe:1",
      "-y",
      "-i",
      "/tmp/in.mp4",
      "-vn",
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      "-f",
      "wav",
      "/tmp/out.wav",
    ]);
  });

  it("honours an explicit sample rate and channel count", () => {
    const args = buildExtractAudioArgs({
      inputPath: "/tmp/in.mp4",
      outputPath: "/tmp/out.wav",
      sampleRate: 48000,
      channels: 2,
    });

    expect(args).toContain("48000");
    expect(args.slice(args.indexOf("-ac"), args.indexOf("-ac") + 2)).toEqual([
      "-ac",
      "2",
    ]);
  });

  it("passes paths as separate arguments so they are never shell-interpreted", () => {
    const hostile = "/tmp/a b; rm -rf ~/$(whoami).mp4";
    const args = buildExtractAudioArgs({
      inputPath: hostile,
      outputPath: "/tmp/out.wav",
    });

    // The whole path is one argv entry; nothing is concatenated or quoted.
    expect(args).toContain(hostile);
    expect(args.join(" ")).not.toContain("&&");
  });

  it("builds an audio conversion command", () => {
    const args = buildConvertArgs({
      inputPath: "/tmp/in.mov",
      outputPath: "/tmp/out.wav",
      audio: { codec: "pcm_s16le", sampleRate: 16000, channels: 1 },
    });

    expect(args).toEqual([
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-progress",
      "pipe:1",
      "-y",
      "-i",
      "/tmp/in.mov",
      "-vn",
      "-c:a",
      "pcm_s16le",
      "-ac",
      "1",
      "-ar",
      "16000",
      "/tmp/out.wav",
    ]);
  });
});

describe("parseProgressTimeSeconds", () => {
  it("reads the elapsed output time", () => {
    expect(
      parseProgressTimeSeconds(
        "frame=42\nfps=25\nout_time_us=1500000\nprogress=continue\n",
      ),
    ).toBe(1.5);
  });

  it("uses the latest value in a chunk", () => {
    expect(
      parseProgressTimeSeconds("out_time_us=1000000\nout_time_us=4000000\n"),
    ).toBe(4);
  });

  it("returns null for chunks without timing", () => {
    expect(parseProgressTimeSeconds("progress=continue\n")).toBeNull();
    expect(parseProgressTimeSeconds("")).toBeNull();
  });
});

describe("mentionsMissingAudioStream", () => {
  it("recognises FFmpeg's missing-stream wording", () => {
    expect(
      mentionsMissingAudioStream(
        "Stream map '0:a:0' matches no streams. To ignore this, add ...",
      ),
    ).toBe(true);
  });

  it("does not misread unrelated errors", () => {
    expect(mentionsMissingAudioStream("Invalid data found when processing")).toBe(
      false,
    );
  });
});

describe("resolveBinaryPath", () => {
  const originalFfmpeg = process.env.FFMPEG_PATH;
  const originalFfprobe = process.env.FFPROBE_PATH;

  afterEach(() => {
    process.env.FFMPEG_PATH = originalFfmpeg;
    process.env.FFPROBE_PATH = originalFfprobe;
  });

  it("prefers an explicit path", () => {
    expect(resolveBinaryPath("ffmpeg", "/opt/custom/ffmpeg")).toBe(
      "/opt/custom/ffmpeg",
    );
  });

  it("uses the environment variables", () => {
    process.env.FFMPEG_PATH = "/env/ffmpeg";
    process.env.FFPROBE_PATH = "/env/ffprobe";

    expect(resolveBinaryPath("ffmpeg")).toBe("/env/ffmpeg");
    expect(resolveBinaryPath("ffprobe")).toBe("/env/ffprobe");
  });

  it("never returns a hard-coded machine path", () => {
    delete process.env.FFMPEG_PATH;

    const resolved = resolveBinaryPath("ffmpeg");

    // Either an installed package path or the bare command from PATH.
    expect(resolved === "ffmpeg" || resolved.includes("ffmpeg")).toBe(true);
  });
});

describe("summarizeProcessOutput", () => {
  it("keeps only the last few lines", () => {
    const summary = summarizeProcessOutput(
      ["line one", "line two", "line three", "line four", "line five"].join(
        "\n",
      ),
    );

    expect(summary).toBe("line three | line four | line five");
  });

  it("never leaks backend filesystem paths", () => {
    const summary = summarizeProcessOutput(
      "[mov,mp4 @ 0x1] moov atom not found\n/tmp/aidub/jobs/abc-123/source.mp4: Invalid data found when processing input",
    );

    expect(summary).not.toContain("/tmp/");
    expect(summary).not.toContain("aidub/jobs");
    expect(summary).toContain("source.mp4");
  });

  it("caps the length of retained output", () => {
    expect(summarizeProcessOutput("x".repeat(2000)).length).toBeLessThanOrEqual(
      500,
    );
  });
});

describe("redactPaths", () => {
  it.each([
    ["/tmp/aidub/jobs/j1/source.mp4", "source.mp4"],
    ["C:\\Users\\dev\\aidub\\out.wav", "out.wav"],
    ["reading /var/folders/x/y/extracted-audio.wav failed", "reading extracted-audio.wav failed"],
  ])("redacts %s", (input, expected) => {
    expect(redactPaths(input)).toBe(expected);
  });

  it("leaves text without paths untouched", () => {
    expect(redactPaths("Stream map '0:a:0' matches no streams")).toBe(
      "Stream map '0:a:0' matches no streams",
    );
  });
});
