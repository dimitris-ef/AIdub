import { describe, expect, it } from "vitest";

import {
  LANGUAGES,
  formatLanguagePair,
  getLanguageLabel,
  isLanguageCode,
} from "@/lib/languages";
import {
  getProjectStatusLabel,
  getProjectStatusPresentation,
  isProjectStatus,
} from "@/lib/project-status";
import {
  formatAbsoluteDateTime,
  formatRelativeTime,
  parseTimestamp,
} from "@/lib/dates";
import {
  validateLanguageSelection,
  validateProjectName,
} from "@/lib/project-input";
import { PROJECT_STATUSES } from "@/types/project";

describe("languages", () => {
  it("maps codes to labels", () => {
    expect(getLanguageLabel("en")).toBe("English");
    expect(getLanguageLabel("pl")).toBe("Polish");
    expect(getLanguageLabel("el")).toBe("Greek");
  });

  it("falls back to the raw code for unknown languages", () => {
    expect(getLanguageLabel("xx")).toBe("xx");
  });

  it("formats a language pair for display", () => {
    expect(formatLanguagePair("en", "pl")).toBe("English → Polish");
  });

  it("recognises supported codes only", () => {
    expect(isLanguageCode("en")).toBe(true);
    expect(isLanguageCode("xx")).toBe(false);
    expect(isLanguageCode(42)).toBe(false);
  });

  it("has unique codes", () => {
    const codes = LANGUAGES.map((language) => language.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("project status", () => {
  it("labels every supported status", () => {
    expect(PROJECT_STATUSES.map(getProjectStatusLabel)).toEqual([
      "Draft",
      "Processing",
      "Ready",
      "Completed",
      "Error",
    ]);
  });

  it("degrades gracefully for unknown values", () => {
    const presentation = getProjectStatusPresentation("exploded");

    expect(presentation.label).toBe("Unknown");
    expect(presentation.className).toContain("text-muted-foreground");
  });

  it("guards status values", () => {
    expect(isProjectStatus("draft")).toBe(true);
    expect(isProjectStatus("Draft")).toBe(false);
    expect(isProjectStatus(undefined)).toBe(false);
  });
});

describe("dates", () => {
  const now = new Date("2026-08-25T12:00:00.000Z");

  it("parses ISO timestamps and rejects junk", () => {
    expect(parseTimestamp("2026-08-25T12:00:00.000Z")).toBeInstanceOf(Date);
    expect(parseTimestamp("yesterday")).toBeNull();
  });

  it.each([
    ["2026-08-25T11:59:40.000Z", "just now"],
    ["2026-08-25T11:59:00.000Z", "1 minute ago"],
    ["2026-08-25T11:48:00.000Z", "12 minutes ago"],
    ["2026-08-25T09:00:00.000Z", "3 hours ago"],
    ["2026-08-24T12:00:00.000Z", "1 day ago"],
    ["2026-08-22T12:00:00.000Z", "3 days ago"],
  ])("formats %s as %s", (iso, expected) => {
    expect(formatRelativeTime(iso, now)).toBe(expected);
  });

  it("falls back to an absolute date beyond a week", () => {
    expect(formatRelativeTime("2026-08-01T15:10:00.000Z", now)).toBe(
      formatAbsoluteDateTime("2026-08-01T15:10:00.000Z"),
    );
  });

  it("never crashes on malformed timestamps", () => {
    expect(formatRelativeTime("nonsense", now)).toBe("unknown");
    expect(formatAbsoluteDateTime("nonsense")).toBe("unknown");
  });
});

describe("project input validation", () => {
  it("accepts and trims a valid name", () => {
    expect(validateProjectName("  Travel Documentary  ")).toEqual({
      ok: true,
      value: "Travel Documentary",
    });
  });

  it("rejects empty and whitespace-only names", () => {
    expect(validateProjectName("").ok).toBe(false);
    expect(validateProjectName("    ").ok).toBe(false);
  });

  it("enforces the maximum length after trimming", () => {
    expect(validateProjectName("x".repeat(100)).ok).toBe(true);
    expect(validateProjectName("x".repeat(101)).ok).toBe(false);
  });

  it("requires two different, known languages", () => {
    expect(validateLanguageSelection("en", "pl")).toEqual({ ok: true });
    expect(validateLanguageSelection("en", "en").ok).toBe(false);
    expect(validateLanguageSelection("", "pl").ok).toBe(false);
    expect(validateLanguageSelection("en", "xx").ok).toBe(false);
  });
});
