/**
 * Canonical timeline formatting.
 *
 * Aidub stores every timeline value — transcript segments, speaker regions and
 * whatever Part 7 merges out of them — as numeric seconds. These helpers exist
 * purely for display; a formatted string is never persisted or compared.
 */

/** "00:03.240" · "01:12.560" · "1:02:14.820" */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--:--.---";
  }

  const totalMilliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  const pad = (value: number, length = 2) =>
    String(value).padStart(length, "0");
  const tail = `${pad(minutes)}:${pad(wholeSeconds)}.${pad(milliseconds, 3)}`;

  return hours > 0 ? `${hours}:${tail}` : tail;
}

/** "00:03.240 – 00:07.910" */
export function formatTimeRange(startTime: number, endTime: number): string {
  return `${formatTimecode(startTime)} – ${formatTimecode(endTime)}`;
}

/**
 * Reads a human-typed timecode back into seconds.
 *
 * Accepts what `formatTimecode` produces and the shorthands people actually
 * type: `12`, `12.5`, `1:02`, `01:02.450`, `1:02:14.820`. Returns null for
 * anything it cannot read — a caller must never persist a guess.
 */
export function parseTimecode(value: string): number | null {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (!/^\d{1,2}(:\d{1,2}){0,2}([.,]\d{1,3})?$/.test(trimmed)) {
    return null;
  }

  const [wholePart, fractionPart = ""] = trimmed.split(/[.,]/);
  const parts = wholePart.split(":").map(Number);

  if (parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  // Minutes and seconds are 0–59 in any multi-part form; the leading unit is
  // free so "90" or "90:00" stay readable.
  if (parts.length > 1 && parts.slice(1).some((part) => part > 59)) {
    return null;
  }

  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  const fraction = fractionPart
    ? Number(`0.${fractionPart}`)
    : 0;

  const result = seconds + fraction;

  return Number.isFinite(result) && result >= 0 ? result : null;
}
