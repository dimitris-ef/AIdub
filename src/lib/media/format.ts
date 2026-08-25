/**
 * Display formatters for media metadata. The canonical model always stores
 * numbers (`sizeBytes`, `durationSeconds`) — formatted strings are never
 * persisted.
 */

const BYTE_UNITS = ["KB", "MB", "GB", "TB"] as const;

/** "0 B" · "842 KB" · "5.2 GB" (decimal units, as file managers report them) */
export function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return "Unknown";
  }
  if (sizeBytes < 1000) {
    return `${Math.round(sizeBytes)} B`;
  }

  let value = sizeBytes / 1000;
  let unitIndex = 0;

  while (value >= 1000 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }

  // One decimal below 100 keeps "5.2 GB" readable without false precision.
  const rounded = value < 100 ? Math.round(value * 10) / 10 : Math.round(value);

  return `${rounded} ${BYTE_UNITS[unitIndex]}`;
}

/** "01:32" · "12:43" · "1:04:18" */
export function formatDuration(durationSeconds: number | null): string {
  if (
    durationSeconds === null ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 0
  ) {
    return "Unknown";
  }

  const total = Math.round(durationSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/** "3840 × 2160" */
export function formatResolution(
  width: number | null,
  height: number | null,
): string {
  if (!width || !height) {
    return "Unknown";
  }

  return `${width} × ${height}`;
}
