import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatDuration,
  formatResolution,
} from "@/lib/media/format";
import {
  containerFromExtension,
  containerFromMimeType,
  detectContainer,
  getFileExtension,
} from "@/lib/media/container";
import {
  UNSUPPORTED_FORMAT_MESSAGE,
  validateSourceVideoFile,
} from "@/lib/media/validate-video";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1000, "1 KB"],
    [842_000, "842 KB"],
    [1_700_000_000, "1.7 GB"],
    [5_200_000_000, "5.2 GB"],
    [123_400_000_000_000, "123 TB"],
  ])("formats %i as %s", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it("does not crash on invalid input", () => {
    expect(formatBytes(Number.NaN)).toBe("Unknown");
    expect(formatBytes(-1)).toBe("Unknown");
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "00:00"],
    [9, "00:09"],
    [92, "01:32"],
    [763, "12:43"],
    [3858, "1:04:18"],
    [3600, "1:00:00"],
  ])("formats %s seconds", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });

  it("reports unknown durations", () => {
    expect(formatDuration(null)).toBe("Unknown");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("Unknown");
    expect(formatDuration(Number.NaN)).toBe("Unknown");
  });
});

describe("formatResolution", () => {
  it("formats known dimensions", () => {
    expect(formatResolution(3840, 2160)).toBe("3840 × 2160");
  });

  it("reports unknown dimensions", () => {
    expect(formatResolution(null, 1080)).toBe("Unknown");
    expect(formatResolution(1920, null)).toBe("Unknown");
  });
});

describe("container detection", () => {
  it("reads the extension", () => {
    expect(getFileExtension("interview-final.MOV")).toBe("mov");
    expect(getFileExtension("no-extension")).toBeNull();
  });

  it.each([
    ["clip.mp4", "MP4"],
    ["clip.m4v", "MP4"],
    ["interview.mov", "MOV"],
    ["screen.webm", "WebM"],
  ])("maps %s to %s by extension", (filename, expected) => {
    expect(containerFromExtension(filename)).toBe(expected);
  });

  it.each([
    ["video/mp4", "MP4"],
    ["video/quicktime", "MOV"],
    ["video/webm;codecs=vp9", "WebM"],
  ])("maps %s to %s by MIME type", (mimeType, expected) => {
    expect(containerFromMimeType(mimeType)).toBe(expected);
  });

  it("prefers the extension but falls back to MIME", () => {
    expect(detectContainer("clip.mov", "video/mp4")).toBe("MOV");
    expect(detectContainer("clip", "video/webm")).toBe("WebM");
  });

  it("reports unknown containers instead of guessing", () => {
    expect(detectContainer("clip.avi", "video/x-msvideo")).toBeNull();
    expect(containerFromMimeType("")).toBeNull();
    expect(containerFromMimeType(null)).toBeNull();
  });
});

describe("validateSourceVideoFile", () => {
  const file = (
    name: string,
    type: string,
    size = 1_000_000,
  ): { name: string; type: string; size: number } => ({ name, type, size });

  it.each([
    ["MP4", file("clip.mp4", "video/mp4"), "MP4"],
    ["MOV", file("interview.mov", "video/quicktime"), "MOV"],
    ["WebM", file("screen.webm", "video/webm"), "WebM"],
    ["MP4 with no reported MIME type", file("clip.mp4", ""), "MP4"],
    [
      "MOV reported as octet-stream",
      file("interview.mov", "application/octet-stream"),
      "MOV",
    ],
  ])("accepts %s", (_label, selected, container) => {
    expect(validateSourceVideoFile(selected)).toEqual({ ok: true, container });
  });

  it("rejects a missing selection", () => {
    expect(validateSourceVideoFile(null).ok).toBe(false);
  });

  it("rejects a zero-byte file", () => {
    const result = validateSourceVideoFile(file("clip.mp4", "video/mp4", 0));

    expect(result).toEqual({
      ok: false,
      error: "This file is empty. Select a video file with content.",
    });
  });

  it.each([
    ["an unsupported extension", file("notes.txt", "text/plain")],
    ["a document renamed to .mp4", file("notes.mp4", "application/pdf")],
    ["an unsupported video container", file("clip.avi", "video/x-msvideo")],
    ["an audio file", file("track.mp3", "audio/mpeg")],
    ["no extension and no MIME type", file("clip", "")],
  ])("rejects %s", (_label, selected) => {
    expect(validateSourceVideoFile(selected)).toEqual({
      ok: false,
      error: UNSUPPORTED_FORMAT_MESSAGE,
    });
  });
});
