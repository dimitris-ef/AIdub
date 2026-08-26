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
